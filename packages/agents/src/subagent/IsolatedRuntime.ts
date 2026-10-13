import type { ChatUsage } from '@vessel/shared';
import { observeProviderCacheUsage } from '@vessel/llm';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { ChatProvider, PolicyArtifacts, ToolCall, ToolSpec } from '@vessel/shared';
import { AgentLoop, EventBus, Session, type ToolResultOutcome } from '@vessel/core';
import { CompactionBoundaryGuard, Compaction, ContextBuilder, discoverInstructions, createOverflowRecovery, type AdaptiveCompactionOptions } from '@vessel/context';
import { PolicyEngine } from '@vessel/policy';
import { Executor, Sandbox, EffectJournal } from '@vessel/runtime';
import { NoProgressGuard, ToolRegistry } from '@vessel/tools';

export type IsolatedSessionSource =
  | 'startup'
  | 'resume'
  | 'fork'
  | 'clear'
  | 'compact'
  | 'subagent'
  | 'evaluator'
  | 'plan'
  | 'team';

export interface IsolatedRuntimeOptions {
  workspaceRoot: string;
  cwd?: string;
  provider: ChatProvider;
  model: string;
  temperature?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  policyArtifacts: PolicyArtifacts;
  /** tool specs visible to this isolated session (already narrowed by the caller) */
  tools: ToolSpec[];
  sessionId?: string;
  sessionDir?: string;
  /** B10 session/created source — distinguishes subagent/evaluator/plan/team sessions */
  source?: IsolatedSessionSource;
  parentSession?: string;
  delegationDepth?: number;
  agentPreset?: string;
  /**
   * Task 057: shared team EventBus. When provided, this session joins the
   * team bus so its loop events (before_turn/after_turn/after_tool…) are
   * observable by TeamProjection (member attribution is anchored by the
   * runtime's team_phase markers). Absent => private bus (legacy behavior).
   */
  bus?: EventBus;
  /** behavior-compiled stable prompt sections (soft channel) */
  stableSections?: string[];
  policyGuidance?: string[];
  contextWindow?: number;
  compactionBudget?: Omit<AdaptiveCompactionOptions, 'contextWindow'>;
  maxSteps?: number;
  /** compaction summarizer (LLM); defaults to heuristic */
  summarize?: (regionText: string, context: { userRequest: string }) => Promise<string>;
}

export interface IsolatedRuntime {
  session: Session;
  bus: EventBus;
  registry: ToolRegistry;
  policyEngine: PolicyEngine;
  loop: AgentLoop;
  close(): Promise<void>;
}

/**
 * agents/runtime — isolated session factory (ARCHITECTURE §4.10 / D3 decision
 * point 12: subagent = ordinary Session reuse, zero new core primitives).
 *
 * Builds the same thin-loop composition as the parent harness (Session +
 * EventBus + PolicyEngine + ToolRegistry + Executor + ContextBuilder +
 * Compaction + AgentLoop) for one isolated session — used by Subagent,
 * Planner and the Evaluator Agent. The parent never sees the child's
 * intermediate records (info hiding); only the frozen result contract crosses.
 */
export async function createIsolatedRuntime(opts: IsolatedRuntimeOptions): Promise<IsolatedRuntime> {
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const cwd = path.resolve(opts.cwd ?? workspaceRoot);

  const sessionId = opts.sessionId ?? `sub_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const session = await Session.open({
    workspaceRoot,
    sessionId,
    sessionDir: opts.sessionDir,
  });
  await session.appendSync({
    type: 'session/created',
    sessionId,
    source: opts.source ?? 'startup',
    parentSession: opts.parentSession,
    delegationDepth: opts.delegationDepth,
    agentPreset: opts.agentPreset,
    surface: false,
  });

  const bus = opts.bus ?? new EventBus();
  const policyEngine = new PolicyEngine(opts.policyArtifacts);
  const sandbox = new Sandbox();
  const registry = new ToolRegistry(opts.tools);

  // Executor: pre-execute policy recheck (tool layer never trusts the caller)
  const effectJournal = new EffectJournal(path.join(session.dir, 'execution.jsonl'));
  const executor = new Executor({
    permitAuthority: policyEngine.permits,
    beforeDispatch: async (call, spec, invocation, context) => effectJournal.begin(call, spec, invocation, context.executionKey),
    afterDispatch: async (call, result, context) => effectJournal.finish(call, result, context.executionKey),
    decide: async (call, spec) => policyEngine.decide({ toolName: call.toolName, arguments: call.arguments }, spec),
  });
  const progressGuard = new NoProgressGuard(workspaceRoot, async (diagnostic, isCurrent) => {
    let interrupt = false;
    try { await session.appendSync({ type: 'audit/stagnation_break', ...diagnostic, surface: false }); }
    finally { interrupt = isCurrent(); if (interrupt) loop.interrupt(); }
    if (interrupt) await bus.emit('audit/stagnation_break', diagnostic);
  });
  const runTool = async (call: ToolCall, exec?: { signal?: AbortSignal | null }): Promise<ToolResultOutcome> => progressGuard.run(call.toolName, exec?.signal, async () => {
    const spec = registry.spec(call.toolName);
    if (!spec) {
      return {
        record: null,
        content: '',
        error: { errorClass: 'INVALID_ARGS' as const, message: `unknown tool: ${call.toolName}` },
        meta: {},
      };
    }
    const result = await executor.runTool(spec, call, { workspaceRoot, cwd, sandbox, signal: exec?.signal ?? undefined,
      executionKey: `${session.sessionId}:${session.replay().filter(record => record.type === 'tool/call').at(-1)?.seq ?? 0}:${call.toolCallId}`,
      subject: { sessionId: session.sessionId, runId: `turn:${session.replay().filter(record => record.type === 'user/message' && !record.source).length}`, agentInstanceId: opts.agentPreset ?? 'isolated' },
    });
    return { record: null, content: result.content, error: result.error, meta: result.meta };
  });

  const instructions = () => discoverInstructions(cwd, workspaceRoot);
  const builder = new ContextBuilder({
    session,
    model: opts.model,
    stableSections: () => opts.stableSections ?? [],
    policyGuidance: () => opts.policyGuidance ?? [],
    instructions,
    getVisibleTools: () => registry.listVisible(),
    contextWindow: opts.contextWindow,
  });
  const maxOutputTokens = opts.compactionBudget?.maxOutputTokens ?? opts.provider.defaultMaxOutputTokens ?? 4096;
  const compaction = new Compaction({ session, summarize: opts.summarize, adaptive: { ...opts.compactionBudget, maxOutputTokens } });

  const cacheObserver = observeProviderCacheUsage(opts.provider);
  const detachCache = bus.on('model_stream_end', payload => {
    const call = payload as { turnId: string; usage?: ChatUsage };
    if (call.usage && session.replay().some(record => record.type === 'turn/start' && record.turnId === call.turnId)) cacheObserver.annotate(call.usage);
  }, 'isolated:cache-metrics');

  const loop = new AgentLoop({
    session,
    bus,
    provider: cacheObserver.provider,
    temperature: opts.temperature,
    reasoningEffort: opts.reasoningEffort,
    model: opts.model,
    buildContext: async (step) => {
      const envelope = await builder.assemble(step);
      if (CompactionBoundaryGuard.canCompactHistory(step - 1, session.replay()) && compaction.shouldCompact(envelope.estimateTokens, builder.window)) {
        await compaction.compact('pressure');
        return { ...await builder.assemble(step), maxOutputTokens };
      }
      return { ...envelope, maxOutputTokens };
    },
    modelErrorRecovery: createOverflowRecovery({ session, bus, builder, compaction, maxOutputTokens }),
    runTool,
    getVisibleTools: () => [],
    maxSteps: opts.maxSteps,
  });

  return {
    session,
    bus,
    registry,
    policyEngine,
    loop,
    async close() {
      detachCache();
      await session.close();
    },
  };
}
