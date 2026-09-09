import * as path from 'node:path';
import type { ChatProvider, ChatToolDef, ToolCall } from '@vessel/shared';
import { AgentLoop, EventBus, Session } from '@vessel/core';
import { ContextBuilder, Compaction } from '@vessel/context';
import { ToolRegistry, createFsTools, createSearchTools, createShellTool, McpClient, registerMcpTools, type McpTransport } from '@vessel/tools';
import { PolicyEngine, loadPolicyArtifacts } from '@vessel/policy';
import { Executor, Sandbox } from '@vessel/runtime';
import { loadBehaviorIR, compileBehavior } from '@vessel/behavior';
import { discoverInstructions } from '@vessel/context';
import { listIndex, formatIndexText, createSkillTool, createSkillSearchTool } from '@vessel/skills';
import { Telemetry } from '@vessel/telemetry';
import { SubagentManager, createSubagentTool } from '@vessel/agents';
import { ProjectStore, createMemoryTool } from '@vessel/memory';
import { AutoTaskRouter, type AutoRoute, type RouteMode, type TierBindings, type TierModelMap } from '@vessel/llm';
import { EnforcementProjection } from './projections/EnforcementProjection.js';

/**
 * Minimal structural contract for a persistent usage store. apps/cli wires its
 * own UsageStore (apps/cli/src/usage, tied to the CLI pricing catalog); the
 * application layer only needs `.record()` to stay free of a cli dependency
 * (dependency zero-cycle), so we type the option against this small surface.
 */
export interface UsageStoreLike {
  record(input: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    /** cache 写入 token（Anthropic cache_creation）——task 090 的落库入口 */
    cacheCreationTokens?: number;
  }): void;
}

export interface ComposeMcpConnection {
  serverName: string;
  transport: McpTransport;
}

export interface ComposeOptions {
  workspaceRoot: string;
  cwd?: string;
  provider: ChatProvider;
  model: string;
  policySystemPath: string;
  /** project-scope policy override (.harness/policy.yaml) — merged when present */
  policyProjectPath?: string;
  behaviorIRPath: string;
  sessionId?: string;
  maxSteps?: number;
  contextWindow?: number;
  /** injected compaction summarizer (LLM); defaults to heuristic */
  summarize?: (regionText: string, context: { userRequest: string }) => Promise<string>;
  /** V0.2: register the `Subagent` tool (isolated child sessions, concurrency 1–3) */
  subagent?: { enabled?: boolean; maxConcurrent?: number; maxDepth?: number; delegationDepth?: number };
  /** V0.2: register MCP server tools dynamically (mcp__<server>__<tool>) */
  mcp?: ComposeMcpConnection[];
  /** V0.3: Project Memory (file-based, .harness/memory) — Memory tool + frozen snapshot injection */
  memory?: { enabled?: boolean };
  /** V0.7: permission mode → policy profile override (read-only / workspace-write / danger-full-access) */
  permission?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /**
   * V0.4/V0.5 task routing (056: 默认 Auto 产品路径). When `providers` + a tier
   * binding are given AND a routing trigger is present (taskPrompt, or an
   * explicit mode fast/pro), the session is routed via AutoTaskRouter —
   * Auto default: classify category → choose role (§8.2) → choose tier (§8.3)
   * → resolve provider/model from the injected bindings. Explicit mode fast/pro
   * bypasses classification straight to that tier. Callers that pin
   * provider/model simply omit the triggers (explicit pinning wins by
   * construction, backward compatible).
   */
  taskRouter?: {
    providers: Record<string, ChatProvider>;
    /** legacy core-tier binding (pro/fast/mini) — provider layer supplies */
    tierModel: TierModelMap;
    /** open tier → model binding (review 等扩展档) — merged over tierModel */
    bindings?: TierBindings;
    /** first-task prompt that triggers Auto routing */
    taskPrompt?: string;
    /** user choice: auto (default) | fast | pro */
    mode?: RouteMode;
    /** pin the resolved choice for this session (no re-judge on later turns) */
    pin?: boolean;
  };
  /** V0.9: persistent usage statistics — record after_model usage into this store */
  usageStore?: UsageStoreLike;
  /** provider id label attached to usage records (when usageStore wired) */
  usageProvider?: string;
}

export interface ComposedHarness {
  bus: EventBus;
  session: Session;
  registry: ToolRegistry;
  policyEngine: PolicyEngine;
  builder: ContextBuilder;
  compaction: Compaction;
  loop: AgentLoop;
  telemetry: Telemetry;
  artifacts: ReturnType<typeof loadPolicyArtifacts>;
  behaviorWarnings: string[];
  subagentManager?: SubagentManager;
  mcpClients: McpClient[];
  /** V0.4/056: AutoTaskRouter instance (when task routing was wired) — callers can re-route per task */
  taskRouter?: AutoTaskRouter;
  /** 056: the actual resolved route (mode/category/complexity/roles/primary model/hints) — 「Auto → <model>」展示依据 */
  route?: AutoRoute;
  /** category the session was routed to on start (when routing triggered) */
  routedCategory?: string;
  /** V0.9: usage store wired (when provided) */
  usageStore?: UsageStoreLike;
  /** task 074: runtime enforcement telemetry projection (071-073 + 050 overload) */
  enforcement: EnforcementProjection;
  close(): Promise<void>;
}

/**
 * Composition root — wires the modular monolith for one session (apps/cli).
 * Dependency direction: mechanism packages never import each other's internals;
 * the CLI composes them through their public interfaces.
 */
export async function composeHarness(opts: ComposeOptions): Promise<ComposedHarness> {
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const cwd = path.resolve(opts.cwd ?? workspaceRoot);

  // V0.4/056 task routing: when the caller wires providers + tier bindings AND a
  // trigger is present (taskPrompt, or explicit mode fast/pro without a prompt),
  // the session's provider/model are resolved through AutoTaskRouter — Auto by
  // default: classify category → choose role (§8.2) → choose tier (§8.3) →
  // resolve provider/model from the injected bindings. Explicit mode fast/pro
  // bypasses classification. Callers that want to pin provider/model simply
  // omit the triggers (explicit pinning wins by construction).
  let effectiveProvider = opts.provider;
  let effectiveModel = opts.model;
  let taskRouter: AutoTaskRouter | undefined;
  let route: AutoRoute | undefined;
  let routedCategory: string | undefined;
  const trOpts = opts.taskRouter;
  const routingTriggered = Boolean(trOpts?.taskPrompt) || trOpts?.mode === 'fast' || trOpts?.mode === 'pro';
  if (trOpts?.providers && trOpts?.tierModel && routingTriggered) {
    // open bindings = caller extensions (review 等) merged over the legacy core tiers
    const bindings: TierBindings = Object.assign({}, trOpts.tierModel, trOpts.bindings ?? {}) as TierBindings;
    taskRouter = new AutoTaskRouter({
      providers: trOpts.providers,
      bindings,
      mode: trOpts.mode ?? 'auto',
    });
    route = taskRouter.resolve(
      trOpts.taskPrompt !== undefined
        ? { task: trOpts.taskPrompt, mode: trOpts.mode }
        : { mode: trOpts.mode },
    );
    // pin for this session: the resolved choice is locked (no automatic re-judge)
    if (trOpts.pin) route = taskRouter.pinCurrent();
    routedCategory = route.category;
    effectiveModel = route.primary.model;
    const routedProvider = trOpts.providers[route.primary.providerId];
    if (!routedProvider) {
      throw new Error(`task route resolved to unknown provider "${route.primary.providerId}"`);
    }
    effectiveProvider = routedProvider;
  }

  const session = await Session.open({ workspaceRoot, sessionId: opts.sessionId });
  const bus = new EventBus();

  // Policy: one declaration -> four artifacts -> engine (hard) + guidance (soft)
  const artifacts = loadPolicyArtifacts({
    systemPath: opts.policySystemPath,
    projectPath: opts.policyProjectPath,
    // V0.7: permission mode maps to the policy profile slot (read-only /
    // workspace-write / danger-full-access). approval stays fail-closed
    // (never) unless an interactive ask surface (TUI) is present.
    sessionOverrides: opts.permission ? { profile: opts.permission } : undefined,
  });
  const policyEngine = new PolicyEngine(artifacts);

  // Tools: 6 builtin, bound to workspace + fs guards from the policy artifacts.
  // task 073: allow-set confinement — pass explicit authorization paths + the
  // confinement flag through to the tool-layer guards (hard enforcement point).
  const fsPolicy = {
    protected: artifacts.fsConfig?.protected ?? [],
    denyRead: artifacts.fsConfig?.denyRead ?? [],
    allow: artifacts.fsConfig?.allow ?? [],
    confinement: artifacts.fsConfig?.confinement ?? false,
  };
  const sandbox = new Sandbox();
  // V0.3 project memory: file-based store + Memory tool + frozen snapshot for context injection
  const memoryEnabled = opts.memory?.enabled ?? true;
  const projectStore = memoryEnabled ? new ProjectStore(workspaceRoot) : null;
  const tools = [
    ...createFsTools({ workspaceRoot, fsPolicy }),
    ...createSearchTools({ workspaceRoot, fsPolicy }),
    createShellTool({ workspaceRoot, sandbox }),
    createSkillTool({ workspaceRoot }),
    createSkillSearchTool({ workspaceRoot }),
    ...(projectStore ? [createMemoryTool({ workspaceRoot })] : []),
  ];

  // Executor: pre-execute policy recheck (tool layer never trusts the caller)
  const executor = new Executor({
    decide: async (call, spec) => policyEngine.decide({ toolName: call.toolName, arguments: call.arguments }, spec),
  });
  const runTool = async (call: ToolCall, exec?: { signal?: AbortSignal | null }) => {
    const spec = registry.spec(call.toolName);
    if (!spec) {
      return {
        record: null,
        content: '',
        error: { errorClass: 'INVALID_ARGS' as const, message: `unknown tool: ${call.toolName}` },
        meta: {},
      };
    }
    // task 050: forward the turn's AbortSignal so in-flight tools (shell/MCP/subagent) can stop
    const result = await executor.runTool(spec, call, { workspaceRoot, cwd, sandbox, signal: exec?.signal ?? undefined });
    return { record: null, content: result.content, error: result.error, meta: result.meta };
  };

  // Behavior: IR -> compiler -> stable prompt sections (+ dual-channel warnings)
  const ir = loadBehaviorIR(opts.behaviorIRPath);
  const compiled = compileBehavior(ir, artifacts);
  const behaviorWarnings = compiled.warnings;

  // V0.2 subagent: manager + `Subagent` tool (isolated child sessions, caps 1–3)
  let subagentManager: SubagentManager | undefined;
  if (opts.subagent?.enabled) {
    subagentManager = new SubagentManager({
      workspaceRoot,
      cwd,
      provider: effectiveProvider,
      model: effectiveModel,
      policyArtifacts: artifacts,
      tools,
      bus,
      maxConcurrent: opts.subagent.maxConcurrent,
      maxDepth: opts.subagent.maxDepth,
      parentSessionId: session.sessionId,
      stableSections: compiled.promptSections,
      policyGuidance: artifacts.promptGuidance,
    });
  }
  const finalTools = subagentManager ? [...tools, createSubagentTool(subagentManager)] : tools;
  const registry = new ToolRegistry(finalTools, { deniedTools: artifacts.deniedTools });

  // V0.2 MCP: dynamically register remote tools (same pipeline as builtins)
  const mcpClients: McpClient[] = [];
  for (const conn of opts.mcp ?? []) {
    const client = new McpClient(conn.transport, conn.serverName);
    await registerMcpTools(registry, conn.serverName, client);
    mcpClients.push(client);
  }

  // Context: builder (stable cached per session) + compaction (pressure-triggered)
  const instructions = () => discoverInstructions(cwd, workspaceRoot);
  const skillsIndex = () => formatIndexText(listIndex(workspaceRoot));
  const builder = new ContextBuilder({
    session,
    model: effectiveModel,
    stableSections: () => compiled.promptSections,
    policyGuidance: () => artifacts.promptGuidance,
    instructions,
    getVisibleTools: () => registry.listVisible(),
    volatileText: skillsIndex,
    projectMemory: projectStore ? () => projectStore.snapshot() : undefined,
    contextWindow: opts.contextWindow,
  });
  const compaction = new Compaction({ session, summarize: opts.summarize });

  // BeforeTool authoritative listener: the policy engine
  bus.on(
    'before_tool',
    async (payload) => {
      const p = payload as { toolName: string; arguments: Record<string, unknown> };
      const verdict = await policyEngine.decide({ toolName: p.toolName, arguments: p.arguments }, registry.spec(p.toolName));
      if (verdict.action === 'deny') {
        return { kind: 'deny' as const, reason: verdict.reason ?? 'denied', ref: verdict.ruleRef };
      }
      if (verdict.action === 'ask') {
        return { kind: 'ask' as const, ref: verdict.ruleRef, reason: verdict.reason };
      }
      return { kind: 'allow' as const, updatedInput: verdict.updatedInput };
    },
    'policy:engine',
  );

  // Telemetry: observation-only subscriber
  const telemetry = new Telemetry();
  telemetry.attach(bus);

  // Task 074 runtime enforcement telemetry: unify 071-073 + 050 audit sources
  // into one queryable projection (reuses policy_decision + session tool/result
  // records; runtime-side process-tree/status injected via the seam).
  const enforcement = new EnforcementProjection();
  const enforcementDetach = enforcement.attach(bus);

  // V0.9 usage statistics: persist after_model usage into the store when wired
  if (opts.usageStore) {
    const usageProvider = opts.usageProvider ?? 'default';
    bus.on(
      'after_model',
      (payload) => {
        const p = payload as {
          usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number };
        };
        if (!p.usage) return;
        opts.usageStore!.record({
          provider: usageProvider,
          model: effectiveModel,
          inputTokens: p.usage.inputTokens ?? 0,
          outputTokens: p.usage.outputTokens ?? 0,
          cacheReadTokens: p.usage.cacheReadTokens,
          // task 090：cache 写入 token 透传（上游上报后即自动分项计价）
          cacheCreationTokens: p.usage.cacheCreationTokens,
        });
      },
      'vessel:usage',
    );
  }

  const toChatTools = (): ChatToolDef[] =>
    registry.listVisible().map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema as unknown as Record<string, unknown> },
    }));

  const loop = new AgentLoop({
    session,
    bus,
    provider: effectiveProvider,
    model: effectiveModel,
    buildContext: async (step) => {
      const envelope = await builder.assemble(step);
      if (compaction.shouldCompact(envelope.estimateTokens, builder.window)) {
        await compaction.compact('pressure');
      }
      return envelope;
    },
    runTool,
    getVisibleTools: toChatTools,
    maxSteps: opts.maxSteps,
  });

  return {
    bus,
    session,
    registry,
    policyEngine,
    builder,
    compaction,
    loop,
    telemetry,
    artifacts,
    behaviorWarnings,
    subagentManager,
    mcpClients,
    taskRouter,
    route,
    routedCategory,
    usageStore: opts.usageStore,
    enforcement,
    async close() {
      telemetry.detach();
      enforcementDetach();
      await session.close();
      for (const c of mcpClients) {
        await c.close();
      }
    },
  };
}
