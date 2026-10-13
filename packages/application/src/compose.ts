import { observeProviderCacheUsage } from '@vessel/llm';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { CacheUsageMetrics, ChatUsage, ChatProvider, ChatToolDef, ToolCall, ToolResultRecord } from '@vessel/shared';
import { AgentLoop, EventBus, Session } from '@vessel/core';
import { ContextBuilder, AdaptiveContextPruner, CompactionBoundaryGuard, Compaction, createOverflowRecovery, type AdaptiveCompactionOptions, type ContextPruneOptions } from '@vessel/context';
import { NoProgressGuard, ToolRegistry, createFsTools, createSearchTools, createShellTool, createSymbolGraphAccess, McpClient, registerMcpTools, type McpTransport, type NativeSandboxRunner } from '@vessel/tools';
import { PolicyEngine, loadPolicyArtifacts, ModPipeline, RedGreenGate } from '@vessel/policy';
import { guardBugfixCompletion } from './redGreenCompletion.js';
import { Executor, Sandbox, ClaudeModAdapter, EffectJournal } from '@vessel/runtime';
import { loadBehaviorIR, compileBehavior } from '@vessel/behavior';
import { discoverInstructions } from '@vessel/context';
import {
  listIndex,
  formatIndexText,
  createSkillTool,
  createSkillSearchTool,
  discoverClaudePlugins,
  type DiscoveredPlugin,
  type PluginSkillSource,
} from '@vessel/skills';
import { Telemetry } from '@vessel/telemetry';
import { ExternalAgentRuntime, SubagentManager, createSubagentTool, type ExternalAgentConfig } from '@vessel/agents';
import { ProjectStore, createMemoryTool, HybridMemoryStore, AutonomousReflectionEngine, collectSessionTrajectory, collectEvaluatorTrajectory, type SessionTrajectoryEvent, streamJsonlRecords, resolveSessionDir, type SessionIndexSource } from '@vessel/memory';
import { CacheDriftDetector, AutoTaskRouter, type AutoRoute, type RouteMode, type TierBindings, type TierModelMap } from '@vessel/llm';
import { EnforcementProjection } from './projections/EnforcementProjection.js';
import { ExecutionLoop } from './ExecutionLoop.js';
import type { ExecutionBudget } from '@vessel/engine';
import type { ProcessTreeAuditEvent } from './projections/types.js';

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
    cacheMetrics?: CacheUsageMetrics;
  }): void;
}

export interface ComposeMcpConnection {
  serverName: string;
  transport: McpTransport;
}

export interface ComposeOptions {
  /** Opt-in transient AST graph; only these explicit files are indexed. */
  symbolGraph?: { filePaths: string[]; paths?: Record<string, string[]>; baseUrl?: string };
  /** Opt-in tail pruning requires the explicitly guarded symbolGraph file set. */
  adaptivePruning?: ContextPruneOptions & { activeFiles?: string[] };
  /** Trusted evaluator-owned gate; no verification API is exposed to generator tools. */
  taskType?: 'bugfix';
  redGreenGate?: RedGreenGate;
  /** Explicit opt-in directories; discovered manifests are never executed. */
  mods?: string[];
  /** Offline/embedding replacement for native OS shell confinement. */
  nativeSandbox?: NativeSandboxRunner;
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
  executionBudget?: Partial<ExecutionBudget>;
  contextWindow?: number;
  compactionBudget?: Omit<AdaptiveCompactionOptions, 'contextWindow'>;
  /** injected compaction summarizer (LLM); defaults to heuristic */
  summarize?: (regionText: string, context: { userRequest: string }) => Promise<string>;
  /** V0.2: register the `Subagent` tool (isolated child sessions, concurrency 1–3) */
  subagent?: {
    enabled?: boolean;
    maxConcurrent?: number;
    maxDepth?: number;
    delegationDepth?: number;
    externalAgents?: ExternalAgentConfig[];
    /** Test/embedding seam for the outbound process and workspace adapter. */
    externalRuntimeOptions?: Omit<ConstructorParameters<typeof ExternalAgentRuntime>[0], 'agents' | 'bus'>;
  };
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
  loadedMods: readonly { name: string; status: 'worker-isolated' }[];
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
  /** Workspace plugins discovered during composition; hook commands remain opaque data. */
  discoveredPlugins: DiscoveredPlugin[];
  subagentManager?: SubagentManager;
  externalAgentRuntime?: ExternalAgentRuntime;
  mcpClients: McpClient[];
  /**
   * MCP 装载失败清单（BRIEF-13 §6 分区语义）：单个 server 起不来 / initialize 失败
   * 时已降级（warn + 跳过），调用方据此提示用户或断言。空数组 = 全部装载成功。
   */
  mcpFailures?: { serverName: string; reason: string }[];
  /** V0.4/056: AutoTaskRouter instance (when task routing was wired) — callers can re-route per task */
  taskRouter?: AutoTaskRouter;
  /** 056: the actual resolved route (mode/category/complexity/roles/primary model/hints) — 「Auto → <model>」展示依据 */
  route?: AutoRoute;
  /** category the session was routed to on start (when routing triggered) */
  routedCategory?: string;
  /** V0.9: usage store wired (when provided) */
  usageStore?: UsageStoreLike;
  /**
   * task 074 § 死 seam 接线: the ONE sandbox instance the Shell tool confines
   * with. Exposed so a consumer (the CLI's enforcement telemetry) can read the
   * REAL `statusSnapshot()` instead of guessing from the platform — without it,
   * `EnforcementProjection.reportStatus()` had no production caller and the
   * CLI's sandbox status line was unreachable dead code.
   */
  sandbox: Sandbox;
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
  let discoveredPlugins: DiscoveredPlugin[] = [];
  try {
    discoveredPlugins = discoverClaudePlugins(workspaceRoot);
  } catch {
    // Plugin discovery is optional ecosystem data. A malformed workspace must
    // not prevent a session from starting, and hook commands are never run.
    discoveredPlugins = [];
  }
  const pluginSkillSources: PluginSkillSource[] = discoveredPlugins
    .flatMap((plugin) => plugin.skills.map((skill) => ({
      ...skill,
      pluginRoot: plugin.rootDir,
      // Project skills (100/200) win over namespaced plugin skills (300).
      rank: 300,
    })))
    .slice(0, 2048);

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

  // Policy: one declaration -> four artifacts -> engine (hard) + guidance (soft)
  const artifacts = loadPolicyArtifacts({
    systemPath: opts.policySystemPath,
    projectPath: opts.policyProjectPath,
    // V0.7: permission mode maps to the policy profile slot (read-only /
    // workspace-write / danger-full-access). approval stays fail-closed
    // (never) unless an interactive ask surface (TUI) is present.
    sessionOverrides: opts.permission ? { profile: opts.permission } : undefined,
  });
  for (const plugin of discoveredPlugins) {
    // Only declarative pre-tool deny rules are executable by PolicyEngine.
    // Commands and lifecycle events remain visible in `discoveredPlugins` but
    // are never handed to a process runner.
    artifacts.rules.push(...(plugin.policyRules ?? []));
  }
  // Mandatory behavior must compile before acquiring a session lease or invoking Mods.
  const ir = loadBehaviorIR(opts.behaviorIRPath);
  const compiled = compileBehavior(ir, artifacts);
  const behaviorWarnings = compiled.warnings;
  const session = await Session.open({ workspaceRoot, sessionId: opts.sessionId });
  const bus = new EventBus();
  const redGreenGate = opts.taskType === 'bugfix' ? opts.redGreenGate ?? new RedGreenGate() : undefined;
  const policyEngine = new PolicyEngine(artifacts, redGreenGate ? [call => call.toolName === 'claim_task_complete' ? redGreenGate.completionVerdict(cwd) : undefined] : []);

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
  // Optional SQLite projection stays workspace-scoped and lazy (Node 20 can still compose).
  let cognitiveStore: HybridMemoryStore | undefined;
  let cognitiveReady: Promise<void> | undefined;
  const initializeCognitive = async () => {
    if (!cognitiveReady) cognitiveReady = (async () => {
      try {
        cognitiveStore = new HybridMemoryStore(path.join(workspaceRoot, '.harness', 'cache', 'session_index.db'));
        await cognitiveStore.rebuild(async function* (): AsyncIterable<SessionIndexSource> {
          const root = path.join(workspaceRoot, '.harness', 'sessions');
          if (fs.existsSync(root)) for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            if (entry.isDirectory()) yield { sessionId: entry.name, records: () => streamJsonlRecords(path.join(root, entry.name, 'session.jsonl')) };
          }
        });
      } catch (error) {
        await cognitiveStore?.close().catch(() => {}); cognitiveStore = undefined;
        console.warn('[vessel] cognitive memory unavailable; JSONL remains authoritative: ' + String(error));
      }
    })();
    await cognitiveReady;
  };
  const historicalRules = async (goal: string) => {
    await initializeCognitive();
    if (!cognitiveStore) return [];
    try {
      await cognitiveStore.indexRecords(session.sessionId, session.replay());
      return await cognitiveStore.matchRelevantRules(goal.slice(0, 10000), 5);
    } catch (error) {
      console.warn('[vessel] cognitive recall unavailable; continuing without historical guidance: ' + String(error));
      return [];
    }
  };
  if (opts.adaptivePruning && !opts.symbolGraph) throw new Error('adaptivePruning requires symbolGraph');
  const graphAccess = opts.symbolGraph ? createSymbolGraphAccess({ workspaceRoot, fsPolicy, ...opts.symbolGraph }) : undefined;
  const tools = [
    ...createFsTools({ workspaceRoot, fsPolicy }),
    ...createSearchTools({ workspaceRoot, fsPolicy }),
    ...(graphAccess ? [graphAccess.tool] : []),
    createShellTool({ workspaceRoot, sandbox, nativeSandbox: opts.nativeSandbox, nativeAudit: async event => {
      const record = await session.appendSync({ ...event, type: 'audit/sandbox_enforced', surface: false });
      await bus.emit('audit/sandbox_enforced', record);
    } }),
    createSkillTool({ workspaceRoot, pluginSkills: pluginSkillSources }),
    createSkillSearchTool({ workspaceRoot, pluginSkills: pluginSkillSources }),
    ...(projectStore ? [createMemoryTool({ workspaceRoot })] : []),
  ];

  // Executor: pre-execute policy recheck (tool layer never trusts the caller)
  // Task 072 escape-audit wiring: the Shell tool carries the escape/termination
  // events it observed on `meta.sandbox.audit`; this post-execute hook is the
  // PRODUCTION consumer that pushes them into the enforcement projection, so an
  // escape is never left only in runtime memory. Only escape/terminate/failure
  // events are forwarded (the tool already filtered out routine bookkeeping).
  const modPipeline = opts.mods?.length ? new ModPipeline() : undefined;
  const loadedMods: { name: string; status: 'worker-isolated' }[] = [];
  const contributions: string[] = [];
  const modPolicy = async (call: ToolCall, spec: import('@vessel/shared').ToolSpec) => policyEngine.decide({ toolName: call.toolName, arguments: call.arguments }, spec);
  const effectJournal = new EffectJournal(path.join(session.dir, 'execution.jsonl'));
  const effectHooks = {
    beforeDispatch: async (call: ToolCall, spec: import('@vessel/shared').ToolSpec, invocation: import('@vessel/shared').CanonicalToolInvocation, context: import('@vessel/runtime').ExecutorCtx) => effectJournal.begin(call, spec, invocation, context.executionKey),
    afterDispatch: async (call: ToolCall, result: import('@vessel/shared').ToolExecutionResult, context: import('@vessel/runtime').ExecutorCtx) => effectJournal.finish(call, result, context.executionKey),
  };
  const rpcExecutor = new Executor({ decide: modPolicy, permitAuthority: policyEngine.permits, ...effectHooks });
  // ponytail: file-only RPC uses a separate confined tool set; hooks never recurse.
  const rpcTools = createFsTools({ workspaceRoot, fsPolicy: { ...fsPolicy, confinement: true, allow: [] } });
  for (const directory of opts.mods ?? []) {
    const loaded = await ClaudeModAdapter.loadFromDirectory(path.resolve(cwd, directory));
    const middleware = ClaudeModAdapter.createMiddleware(loaded, {
      authorizeTool: async (name, input) => {
        if (typeof input.path !== 'string') return false;
        const relative = path.relative(fs.realpathSync.native(workspaceRoot), input.path);
        if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
        const spec = rpcTools.find(tool => tool.name === name);
        return Boolean(spec && ['Read', 'Write', 'Edit'].includes(name) && (await modPolicy({ toolCallId: 'mod-rpc', toolName: name, arguments: { ...input, path: relative } }, spec)).action === 'allow');
      },
      delegateTool: async (name, input, signal) => {
        const spec = rpcTools.find(tool => tool.name === name);
        if (!spec || !['Read', 'Write', 'Edit'].includes(name)) throw new Error('Mod RPC tool denied');
        const arguments_ = { ...input, path: path.relative(fs.realpathSync.native(workspaceRoot), String(input.path)) };
        return rpcExecutor.runTool(spec, { toolCallId: 'mod-rpc', toolName: name, arguments: arguments_ }, { workspaceRoot, cwd, sandbox, signal, executionKey: `mod-rpc:${randomUUID()}`, subject: { sessionId: session.sessionId, runId: 'mod-rpc', agentInstanceId: loaded.manifest.name } });
      },
    });
    modPipeline!.register(middleware);
    loadedMods.push({ name: loaded.manifest.name, status: 'worker-isolated' });
    // Only contribution bytes reach the callback, once at session startup.
    const text = loaded.manifest.systemPromptContribution?.replace(/\r\n?/g, '\n').trim() ?? '';
    if (text) {
      const formatted = await middleware.rewritePromptFragment!(text, { sessionId: session.sessionId, turnIndex: 0, metadata: {} });
      if (typeof formatted !== 'string') throw new TypeError('Invalid Mod prompt fragment');
      contributions.push(`[Mod: ${loaded.manifest.name}]\n${formatted}`);
    }
  }
  const executor = new Executor({
    permitAuthority: policyEngine.permits,
    ...effectHooks,
    mods: modPipeline,
    modContext: () => ({ sessionId: session.sessionId, turnIndex: session.replay().filter(record => record.type === 'user/message' && !record.source).length, metadata: {} }),
    onPreExecuteDeny: modPipeline ? async (call, verdict) => {
      await session.appendSync({ type: 'audit/denial', toolCallId: call.toolCallId, toolName: call.toolName, stage: 'rule', ruleRef: verdict.ruleRef, reason: verdict.reason ?? 'Mod tool policy denied', sandboxMode: artifacts.profile, surface: false });
    } : undefined,
    onModFailure: async (call, error) => {
      await session.appendSync({ type: 'audit/denial', toolCallId: call.toolCallId, toolName: call.toolName, stage: 'hook', ruleRef: 'mod:pipeline', listener: 'runtime:mods', reason: String(error), surface: false });
    },
    decide: async (call, spec) => policyEngine.decide({ toolName: call.toolName, arguments: call.arguments }, spec),
    onResult: (_call, result) => {
      const sandbox = result.meta?.sandbox as { audit?: readonly ProcessTreeAuditEvent[] } | undefined;
      const events = sandbox?.audit;
      if (!events) return;
      for (const e of events) enforcement.recordProcessTree(e);
    },
  });
  if (modPipeline) bus.on('before_turn', async () => {
    try {
      await modPipeline.dispatchObserve('turn_start', {}, { sessionId: session.sessionId, turnIndex: session.replay().filter(record => record.type === 'user/message' && !record.source).length, metadata: {} });
      return { kind: 'defer' as const };
    } catch {
      return { kind: 'deny' as const, reason: 'Mod pipeline failed closed', ref: 'mod:pipeline' };
    }
  }, 'runtime:mods');
  const progressGuard = new NoProgressGuard(workspaceRoot, async (diagnostic, isCurrent) => {
    let interrupt = false;
    try { await session.appendSync({ type: 'audit/stagnation_break', ...diagnostic, surface: false }); }
    finally { interrupt = isCurrent(); if (interrupt) loop.interrupt(); }
    if (interrupt) await bus.emit('audit/stagnation_break', diagnostic);
  });
  const runTool = async (call: ToolCall, exec?: { signal?: AbortSignal | null }) => progressGuard.run(call.toolName, exec?.signal, async () => {
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
    // Observations follow the policy waterfall, whose allow verdict short-circuits later listeners.
    await bus.emit('application/tool_started', { toolCallId: call.toolCallId, toolName: call.toolName, arguments: call.arguments });
    const result = await executor.runTool(spec, call, { workspaceRoot, cwd, sandbox, signal: exec?.signal ?? undefined,
      executionKey: `${session.sessionId}:${session.replay().filter(record => record.type === 'tool/call').at(-1)?.seq ?? 0}:${call.toolCallId}`,
      subject: { sessionId: session.sessionId, runId: loop.executionRunId, agentInstanceId: 'primary' },
    });
    return { record: null, content: result.content, error: result.error, meta: result.meta };
  });

  // V0.2 subagent: manager + `Subagent` tool (isolated child sessions, caps 1–3)
  let subagentManager: SubagentManager | undefined;
  const subagentOptions = opts.subagent;
  if (subagentOptions && (subagentOptions.enabled || (subagentOptions.externalAgents?.length ?? 0) > 0)) {
    subagentManager = new SubagentManager({
      workspaceRoot,
      cwd,
      provider: effectiveProvider,
      model: effectiveModel,
      policyArtifacts: artifacts,
      tools,
      bus,
      maxConcurrent: subagentOptions.maxConcurrent,
      maxDepth: subagentOptions.maxDepth,
      parentSessionId: session.sessionId,
      stableSections: compiled.promptSections,
      policyGuidance: artifacts.promptGuidance,
    });
  }
  const externalAgents = subagentOptions?.externalAgents;
  const externalAgentRuntime = externalAgents && externalAgents.length > 0
    ? new ExternalAgentRuntime({ ...subagentOptions?.externalRuntimeOptions, agents: externalAgents, bus })
    : undefined;
  const finalTools = subagentManager
    ? [...tools, createSubagentTool(subagentManager, { externalRuntime: externalAgentRuntime })]
    : tools;
  const registry = new ToolRegistry(finalTools, { deniedTools: artifacts.deniedTools });

  // V0.2 MCP: dynamically register remote tools (same pipeline as builtins).
  // BRIEF-13 §6 失败分区：**配置结构非法**由读取器更早 fail-loud（apps/cli/src/mcp/config.ts，
  // application 不依赖 apps/cli）；**单个 server 起不来 / initialize 失败 → 降级**：warn
  // （含 server 名与原因）后跳过它，其余 server 与主流程照常——用户 mcp.json 里写错一个
  // server，不该让整个 CLI/TUI 都打不开。
  const mcpClients: McpClient[] = [];
  const mcpFailures: { serverName: string; reason: string }[] = [];
  for (const conn of opts.mcp ?? []) {
    // 循环体是唯一的作用域边界：任一环节抛错都只落在本连接上，不传播给其余 server。
    let client: McpClient | undefined;
    try {
      client = new McpClient(conn.transport, conn.serverName);
      await client.initialize(); // MCP 握手：server 起不来 / 协议错误在这里先暴露
      await registerMcpTools(registry, conn.serverName, client);
      mcpClients.push(client);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // 降级但不静默：warn 带 server 名与原因（与 apps/cli/src/cli.ts:250 同一文案）。
      console.warn(`[vessel] MCP server "${conn.serverName}" 未启动（已跳过）：${reason}`);
      mcpFailures.push({ serverName: conn.serverName, reason });
      // 失败连接不进 mcpClients（close() 仍只关成功项），但已 spawn 的子进程就地收掉，
      // 否则残留的子进程会吊住 Node 事件循环。清理失败不掩盖原始原因。
      await client?.close().catch(() => {});
    }
  }

  // Context: builder (stable cached per session) + compaction (pressure-triggered)
  const instructions = () => discoverInstructions(cwd, workspaceRoot);
  const skillsIndex = () => {
    const entries = listIndex(workspaceRoot);
    const seen = new Set(entries.map((entry) => entry.name));
    for (const { pluginRoot: _pluginRoot, ...entry } of pluginSkillSources) {
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      entries.push(entry);
    }
    return formatIndexText(entries.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)));
  };
  const builder = new ContextBuilder({
    adaptivePruning: opts.adaptivePruning && graphAccess ? {
      pruner: new AdaptiveContextPruner({ workspaceRoot, graph: graphAccess.graph, refreshGraph: graphAccess.refresh,
        activeFiles: () => opts.adaptivePruning?.activeFiles ?? [] }),
      options: opts.adaptivePruning,
    } : undefined,
    scopedAppendix: contributions.join('\n\n'),
    session,
    model: effectiveModel,
    stableSections: () => compiled.promptSections,
    policyGuidance: () => artifacts.promptGuidance,
    instructions,
    getVisibleTools: () => registry.listVisible(),
    volatileText: skillsIndex,
    projectMemory: projectStore ? () => projectStore.snapshot() : undefined,
    reflectiveRules: memoryEnabled ? historicalRules : undefined,
    contextWindow: opts.contextWindow,
  });
  const maxOutputTokens = opts.compactionBudget?.maxOutputTokens ?? effectiveProvider.defaultMaxOutputTokens ?? 4096;
  const compaction = new Compaction({ session, summarize: opts.summarize, adaptive: { ...opts.compactionBudget, maxOutputTokens } });

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
  // task 074 § 死 seam 接线 ③：fs-confinement 来源的**生产折点**。
  //
  // 接线前：`foldSession()` 全仓只有 `projections.test.ts` 调用 ⇒ 生产路径**从不**把
  // `tool/result` 上的 `meta.guard` 折进投影 ⇒ enforcement telemetry 的
  // `fs-confinement` 计数在生产恒为 0（fs 守卫确实拒绝了，但没有任何生产代码记录它）。
  // 注意为什么不能用 bus：`after_tool` 的载荷**刻意丢掉 `meta`**（见 EnforcementProjection
  // 类文档），守卫种类只存在于 session 记录里 ⇒ 只能走**会话回放**。
  //
  // 为什么折在 `after_turn`：`AgentLoop.runTurnInner` 在 turn 内的全部 tool/result 落库
  // **之后**才发这个事件（AgentLoop.ts:354），所以折进去的是本回合真实发生的全部守卫拒绝；
  // 又因为它在组合根上接线，一次接线对**所有**消费方同时生效（CLI 的遥测打印、
  // SessionController/TUI、未来的 web 面），而不是只在 CLI 打印那一处补。
  //
  // 幂等：`foldSession()` 自身保证同一记录最多折一次（见 EnforcementProjection 的两把去重锁），
  // 所以"每回合折一次"不会让上一回合的拒绝在下一回合再计一遍。
  //
  // 会话对象取自本函数持有的 `session`（`Session.open()` 的产物，compose.ts:178）——
  // 就是 `ComposedHarness.session` 暴露的同一个实例；`Session.replay()` 返回内存里
  // 同一批记录对象（packages/core/src/session/Session.ts:187）。
  const foldableSession = {
    sessionId: session.sessionId,
    replay: () => session.replay().filter((r): r is ToolResultRecord => r.type === 'tool/result'),
  };
  const enforcementFoldDetach = bus.on(
    'after_turn',
    () => {
      enforcement.foldSession(foldableSession);
    },
    'projection:enforcement:fs-confinement-fold',
  );

  // Queue reflection outside the EventBus critical path; close awaits the final flush.
  let reflectionQueue: Promise<void> = Promise.resolve();
  const evaluatorEvents: SessionTrajectoryEvent[] = [];
  const reflect = () => {
    if (!memoryEnabled) return;
    reflectionQueue = reflectionQueue.then(async () => {
      await initializeCognitive();
      if (!cognitiveStore) return;
      await cognitiveStore.indexRecords(session.sessionId, session.replay());
      await new AutonomousReflectionEngine(cognitiveStore).processSessionEnd(session.sessionId, [...collectSessionTrajectory(session.replay()), ...evaluatorEvents]);
    }).catch(error => console.warn('[vessel] session reflection unavailable: ' + String(error)));
  };
  const reflectionDetach = bus.on('after_turn', () => { reflect(); }, 'memory:reflection');
  const evaluatorReflectionDetach = bus.on('team_end', payload => {
    evaluatorEvents.push(...collectEvaluatorTrajectory(payload as import('@vessel/shared').TeamEndPayload));
    reflect();
  }, 'memory:evaluator-reflection');

  const toChatTools = (): ChatToolDef[] =>
    registry.listVisible().map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema as unknown as Record<string, unknown> },
    }));

  let prefixHash: string | undefined;
  const drift = new CacheDriftDetector();
  const cacheObserver = observeProviderCacheUsage(effectiveProvider);
  bus.on('model_stream_end', payload => {
    const call = payload as { usage?: ChatUsage };
    if (call.usage) cacheObserver.annotate(call.usage);
  }, 'application:stream-cache-metrics');
  // Registered before controller/SSE projections; annotate usage synchronously before async audit writes.
  bus.on('after_model', async payload => {
    const call = payload as { usage?: ChatUsage };
    if (!call.usage) return;
    cacheObserver.annotate(call.usage);
    const metrics = call.usage.cacheMetrics;
    if (!metrics) return;
    call.usage.cacheMetrics = metrics;
    const alert = drift.check(session.sessionId, metrics, prefixHash);
    if (alert) {
      await session.appendSync({ type: 'audit/cache_drift', ...alert, surface: false });
      await bus.emit('audit/cache_drift', alert);
    }
  }, 'application:cache-metrics');

  // V0.9 usage statistics: persist after_model usage into the store when wired
  if (opts.usageStore) {
    const usageProvider = opts.usageProvider ?? 'default';
    bus.on(
      'after_model',
      (payload) => {
        const p = payload as {
          usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number; cacheMetrics?: CacheUsageMetrics };
        };
        if (!p.usage) return;
        opts.usageStore!.record({
          provider: usageProvider,
          model: effectiveModel,
          inputTokens: p.usage.inputTokens ?? 0,
          outputTokens: p.usage.outputTokens ?? 0,
          cacheReadTokens: p.usage.cacheReadTokens,
          cacheMetrics: p.usage.cacheMetrics,
          // task 090：cache 写入 token 透传（上游上报后即自动分项计价）
          cacheCreationTokens: p.usage.cacheCreationTokens,
        });
      },
      'vessel:usage',
    );
  }

  const loop = new ExecutionLoop({
    session,
    bus,
    provider: redGreenGate ? guardBugfixCompletion(cacheObserver.provider, policyEngine, async reason => {
      await session.appendSync({ type: 'audit/denial', toolCallId: 'completion', toolName: 'claim_task_complete', stage: 'rule', ruleRef: 'gate:red-green', reason, sandboxMode: artifacts.profile, surface: false });
    }) : cacheObserver.provider,
    model: effectiveModel,
    buildContext: async (step) => {
      const envelope = await builder.assemble(step);
      prefixHash = envelope.prefixLayout.prefixByteHash;
      if (CompactionBoundaryGuard.canCompactHistory(step - 1, session.replay()) && compaction.shouldCompact(envelope.estimateTokens, builder.window)) {
        await compaction.compact('pressure');
        const compacted = await builder.assemble(step);
        prefixHash = compacted.prefixLayout.prefixByteHash;
        return { ...compacted, maxOutputTokens };
      }
      return { ...envelope, maxOutputTokens };
    },
    modelErrorRecovery: createOverflowRecovery({ session, bus, builder, compaction, maxOutputTokens }),
    runTool,
    getVisibleTools: toChatTools,
    maxSteps: opts.maxSteps,
  }, opts.executionBudget);
  await loop.recoverIncompleteRuns();

  return {
    loadedMods,
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
    discoveredPlugins,
    subagentManager,
    externalAgentRuntime,
    mcpClients,
    mcpFailures,
    taskRouter,
    route,
    routedCategory,
    usageStore: opts.usageStore,
    sandbox,
    enforcement,
    async close() {
      telemetry.detach();
      enforcementDetach();
      enforcementFoldDetach();
      reflectionDetach();
      evaluatorReflectionDetach();
      reflect();
      await reflectionQueue;
      await cognitiveReady;
      if (cognitiveStore) {
        try { await cognitiveStore.reconcileSession({ sessionId: session.sessionId, records: () => streamJsonlRecords(path.join(resolveSessionDir(workspaceRoot, session.sessionId), 'session.jsonl')) }); }
        catch (error) { console.warn('[vessel] cognitive memory projection failed; JSONL preserved: ' + String(error)); }
        finally { await cognitiveStore.close().catch(error => console.warn('[vessel] cognitive memory close failed: ' + String(error))); }
      }
      await session.close();
      for (const c of mcpClients) {
        await c.close();
      }
    },
  };
}
