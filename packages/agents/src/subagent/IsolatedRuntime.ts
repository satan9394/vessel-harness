import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { ChatProvider, PolicyArtifacts, ToolCall, ToolSpec } from '@vessel/shared';
import { AgentLoop, EventBus, Session, type ToolResultOutcome } from '@vessel/core';
import { Compaction, ContextBuilder, discoverInstructions } from '@vessel/context';
import { PolicyEngine } from '@vessel/policy';
import { Executor, Sandbox } from '@vessel/runtime';
import { ToolRegistry } from '@vessel/tools';

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
  const executor = new Executor({
    decide: async (call, spec) => policyEngine.decide({ toolName: call.toolName, arguments: call.arguments }, spec),
  });
  const runTool = async (call: ToolCall, exec?: { signal?: AbortSignal | null }): Promise<ToolResultOutcome> => {
    const spec = registry.spec(call.toolName);
    if (!spec) {
      return {
        record: null,
        content: '',
        error: { errorClass: 'INVALID_ARGS' as const, message: `unknown tool: ${call.toolName}` },
        meta: {},
      };
    }
    const result = await executor.runTool(spec, call, { workspaceRoot, cwd, sandbox, signal: exec?.signal ?? undefined });
    return { record: null, content: result.content, error: result.error, meta: result.meta };
  };

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
  const compaction = new Compaction({ session, summarize: opts.summarize });

  const loop = new AgentLoop({
    session,
    bus,
    provider: opts.provider,
    model: opts.model,
    buildContext: async (step) => {
      const envelope = await builder.assemble(step);
      if (compaction.shouldCompact(envelope.estimateTokens, builder.window)) {
        await compaction.compact('pressure');
      }
      return envelope;
    },
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
      await session.close();
    },
  };
}
