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
import { TaskRouter, type TierModelMap, type TaskCategoryPresets } from '@vessel/llm';

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
   * V0.4: Task Router wiring. When `providers` + `tierModel` are given and the
   * caller does NOT pin an explicit provider/model, the session is routed from
   * the first task prompt via TaskRouter (category → preset → tier). Explicit
   * opts.provider/opts.model always win (backward compatible).
   */
  taskRouter?: {
    providers: Record<string, ChatProvider>;
    tierModel: TierModelMap;
    presets?: TaskCategoryPresets;
    taskPrompt?: string;
  };
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
  /** V0.4: TaskRouter instance (when task routing was wired) — callers can re-route per task */
  taskRouter?: TaskRouter;
  /** category the session was routed to on start (when taskPrompt given) */
  routedCategory?: string;
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

  // V0.4 task routing: when the caller explicitly provides a router AND a
  // taskPrompt, the session's provider/model are resolved from the task
  // (category → preset → tier). Callers that want to pin provider/model
  // simply omit taskPrompt (explicit pinning wins by construction).
  let effectiveProvider = opts.provider;
  let effectiveModel = opts.model;
  let taskRouter: TaskRouter | undefined;
  let routedCategory: string | undefined;
  if (opts.taskRouter?.providers && opts.taskRouter?.tierModel && opts.taskRouter.taskPrompt) {
    taskRouter = new TaskRouter({
      providers: opts.taskRouter.providers,
      tierModel: opts.taskRouter.tierModel,
      presets: opts.taskRouter.presets,
    });
    const route = taskRouter.resolve({ task: opts.taskRouter.taskPrompt });
    routedCategory = route.category;
    effectiveModel = route.model;
    effectiveProvider = route.provider;
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

  // Tools: 6 builtin, bound to workspace + fs guards from the policy artifacts
  const fsPolicy = {
    protected: artifacts.fsConfig?.protected ?? [],
    denyRead: artifacts.fsConfig?.denyRead ?? [],
    allow: [],
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
  const runTool = async (call: ToolCall) => {
    const spec = registry.spec(call.toolName);
    if (!spec) {
      return {
        record: null,
        content: '',
        error: { errorClass: 'INVALID_ARGS' as const, message: `unknown tool: ${call.toolName}` },
        meta: {},
      };
    }
    const result = await executor.runTool(spec, call, { workspaceRoot, cwd, sandbox });
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
    routedCategory,
    async close() {
      telemetry.detach();
      await session.close();
      for (const c of mcpClients) {
        await c.close();
      }
    },
  };
}
