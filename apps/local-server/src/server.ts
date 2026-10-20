import { SessionModelHub } from './sessionModelHub.js';
import { ReasoningStream } from './reasoning.js';
import { isWidgetBlock, priceCacheMetrics, TASK_TREE_STATUSES, type BehaviorEntry, type CacheUsageMetrics, type TaskTreeStatus } from '@vessel/shared';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { SessionController, SessionRegistry, ProjectRegistry, ReviewHandoffStore, TaskTreeRegistry, loadBehaviorLibrary } from '@vessel/application';
import { resolveSessionDir } from '@vessel/memory';
import { recycleDaemonPath } from './daemon/daemonLifecycle.js';
import type { SessionPermission, ReviewHandoffRecord } from '@vessel/application';
import type { Listener, TurnResult } from '@vessel/core';
import { MockProvider, createProvider, providerNameForConfig } from '@vessel/llm';
import type { ChatProvider } from '@vessel/shared';
import { loadPolicyArtifacts } from '@vessel/policy';
import type { SessionMeta } from '@vessel/application';
import { DEFAULT_TIER_BINDINGS, RouteSeam, startTeamRun } from './teamSeam.js';
import type { ActiveTeamRun, TeamEventKind } from './teamSeam.js';
import { GoalSeam } from './goalSeam.js';
import type { GoalRunResult, GoalTaskStatus } from './goalSeam.js';
import type { ExternalAgentConfig } from '@vessel/agents';
import { SubagentSeam } from './subagentSeam.js';
import { TeamRuntime, type TeamDagTask } from '@vessel/agents';
import type { NativeMeshEventBus } from '@vessel/agents';
import { TeamStageRoutes } from './teamRoutes.js';
import { authMiddleware, DAEMON_LOGIN_HTML } from './daemon/authMiddleware.js';
import type { DaemonServerControl } from './daemon/types.js';
import type { Notify } from './daemon/notifications.js';
import { WidgetRoutes } from './routes/widgetRoutes.js';
import { PatchRoutes } from './routes/patchRoutes.js';
import { SessionInspector, type WorkspaceObserver } from './routes/sessionInspector.js';
import { ProviderRoutes } from './routes/providerRoutes.js';
import { BehaviorRoutes } from './routes/behaviorRoutes.js';
import { BehaviorComposeRoutes } from './routes/behaviorCompose.js';
import { TaskTreeRoutes } from './routes/taskTrees.js';
import { ActivityRoutes } from './routes/activityRoutes.js';
import { TraceRoutes } from './routes/traceRoutes.js';
import { createDefaultProviderStore } from './providers/defaultStore.js';
import type { ProviderStore, ProviderConfig } from './providers/ProviderStore.js';

/**
 * SessionController factory. The server never composes a session itself — that
 * is the application layer's job. Callers (tests / CLI / future web) inject an
 * optional factory; when omitted the server builds a smoke controller backed by
 * the deterministic MockProvider so `vessel serve` works offline with zero
 * external dependencies.
 */
export type SessionFactory = (input: {
  workspaceRoot: string;
  provider?: string;
  model?: string;
  permission?: SessionPermission;
  registry?: SessionRegistry;
}) => Promise<SessionController>;

export interface VesselServerOptions {
  /** Optional startup workspace directory; when supplied, automatically registered in ProjectRegistry. */
  workspace?: string;
  /** Lazy credential-backed store; tests inject a temporary store. */
  providerStore?: ProviderStore;
  providerFetch?: typeof fetch;
  providerProbeTimeoutMs?: number;
  providerBuilder?: (config: ProviderConfig) => ChatProvider;
  /** Optional read-only workspace observer supplied by the CLI composition surface. */
  observeWorkspace?: WorkspaceObserver;
  /** port to bind; defaults to 5678. Pass 0 for a random free port (tests). */
  port?: number;
  /** Non-loopback binding is explicit and requires daemon authentication. */
  host?: string;
  mesh?: NativeMeshEventBus;
  projectRegistry?: ProjectRegistry;
  sessionRegistry?: SessionRegistry;
  /** directory to serve static assets from; defaults to <package>/public */
  staticDir?: string;
  /** provider label → wired ChatProvider (see notes in default session factory). */
  providers?: Record<string, { providerLabel?: string; model?: string }>;
  /** session factory override (defaults to a mock-backed smoke controller). */
  sessionFactory?: SessionFactory;
  /**
   * task 060 team/route seam:
   * - tierBindings: tier → { providerId, model } for the route chain and team
   *   runs (defaults to the offline mock bindings).
   * - teamProviders: providerId → ChatProvider the members run on (defaults to
   *   a single mock provider). Real wiring (CLI/provider layer) injects these.
   * - policySystemPath: policy declaration used to compose member runtimes
   *   (defaults to the repo policy.default.yaml).
   */
  tierBindings?: Record<string, { providerId: string; model: string }>;
  teamProviders?: Record<string, ChatProvider>;
  policySystemPath?: string;
  /** review handoff store (059) — defaults to ReviewHandoffStore() (~/.vessel/reviews) */
  reviewStore?: ReviewHandoffStore;
  /** "Open Folder" action — defaults to a best-effort OS opener; tests inject */
  openFolder?: (dir: string) => void;
  /** task 065 goal seam — persistent task queue + iteration log + real run chain */
  goalSeam?: GoalSeam;
  subagentSeam?: SubagentSeam;
  externalAgents?: ExternalAgentConfig[];
  teamStages?: TeamStageRoutes;
  /** Daemon launch token. When supplied, every HTTP/SSE request except exact health requires Bearer. */
  authToken?: string;
  daemon?: DaemonServerControl;
  notify?: Notify;
  /** ARC-10 team task-tree registry (read side of `/api/tasks/tree`). */
  taskTrees?: TaskTreeRegistry;
  /** behavior IR used to populate the Studio Composer library (defaults to repo behavior.default.yaml). */
  behaviorLibraryPath?: string;
}

export interface VesselServer {
  /** Available on the concrete server; optional for existing control-only adapters. */
  readonly widgets?: WidgetRoutes;
  /** ARC-10 team task-tree registry exposed for the Web task tree. */
  readonly taskTrees?: TaskTreeRegistry;
  /** Start listening. Resolves once the underlying http server is bound. */
  listen(): Promise<VesselServer>;
  /** Close the http server and all live sessions. */
  close(): Promise<void>;
  /** the bound port (useful when started with port 0) */
  readonly port: number;
}

const DEFAULT_PORT = 5678;
const VERSION = '0.10.0';

/** repo root resolved from this file (apps/local-server/src/server.ts → up 3). */
const PKG_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(PKG_DIR, '..', '..', '..');
const DEFAULT_POLICY = path.join(REPO_ROOT, 'configs', 'policy.default.yaml');
const DEFAULT_BEHAVIOR = path.join(REPO_ROOT, 'configs', 'behavior.default.yaml');
const DEFAULT_STATIC = path.join(PKG_DIR, '..', 'public');

/** Resolve once at startup; candidate roots are injectable for filesystem-isolated tests. */
export function resolveStaticDir(
  staticDir?: string,
  webDistDir = path.join(REPO_ROOT, 'apps', 'web', 'dist'),
  publicDir = DEFAULT_STATIC,
): string {
  if (staticDir !== undefined) return path.resolve(staticDir);
  const index = path.join(webDistDir, 'index.html');
  return path.resolve(fs.existsSync(index) && fs.statSync(index).isFile() ? webDistDir : publicDir);
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

/**
 * Simple request-body reader: read the whole stream, parse JSON. Returns null on
 * empty/undecodable bodies so handlers can respond with a 400.
 */
async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Authenticated remote hosts remain available; unauthenticated Host must be loopback. */
function trustedOrigin(req: http.IncomingMessage, url: URL, authenticated: boolean): boolean {
  const isLoopback = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
  if (!req.headers.origin) return authenticated || isLoopback(url.hostname);
  try {
    const originUrl = new URL(req.headers.origin);
    if (isLoopback(originUrl.hostname) && isLoopback(url.hostname)) return true;
    return authenticated || req.headers.origin === url.origin;
  } catch {
    return false;
  }
}

/** Split a URL pathname into segments (`/api/sessions/abc` → ['api','sessions','abc']). */
function segment(pathname: string): string[] {
  return pathname.split('/').filter((s) => s.length > 0);
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

/** 允许透传给客户端的机器错误码（task 215）。形如 `invalid_models` / `provider_not_found`。 */
const PROVIDER_ERROR_CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * `ProviderStore` 的**自由文本**失败（文件损坏 / 条目非法）→ 概括但仍可操作的码。
 * 这些 message 自带 `providers.json` 绝对路径甚至条目 id，**绝不能**原样外泄，
 * 但对用户来说「配置坏了」比「未知失败」可操作得多（task 215 的删除自愈诉求）。
 */
const PROVIDER_CORRUPTION_RE = /^(providers|current) file corrupted\b|^invalid provider\b|^provider "/;

/**
 * 把供应商路由抛出的异常收敛为**可安全外泄**的具体错误码（task 215）。
 *
 * 纯机器码（`invalid_models` 等）原样透传；文件损坏/条目非法归为
 * `provider_store_corrupted`；其余自由文本一律回落 `provider_request_failed`。
 */
function providerErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : '';
  if (PROVIDER_ERROR_CODE_RE.test(message)) return message;
  if (PROVIDER_CORRUPTION_RE.test(message)) return 'provider_store_corrupted';
  return 'provider_request_failed';
}

/**
 * BRIEF-19（失败被上报为成功 · HTTP 面）—— 回合结束 `kind` → HTTP 状态码的**唯一**决策点。
 *
 * 复现（改前）：`POST /api/sessions/:id/turns` 恒回 200，`kind='error'` 只写在 body 里
 * （旧 :315-320）。于是**只看状态码**的客户端（`curl -f`、fetch 的 `res.ok`、各类 HTTP
 * 中间件）把失败的回合读成成功——同族已在 `vessel run`（cli.ts `turnExitCode`：`error` ⇒ 1）
 * 与 TUI（error 显式标记）上定案，本函数是同一裁决在 HTTP 面的落地。
 *
 * 裁决（四个 kind 全部钉死，与 CLI `turnExitCode` 逐条对齐）：
 * - `error` ⇒ **500**：这是 harness 侧"回合**没有正常完成**"（没有代理/上游可归因 ⇒ 用 500，
 *   不用 502/503——那两个是网关语义：上游无响应/不可用，本仓无此对象）。
 *   **Round 99 更正（此前这里的理由不准确）**：原文写"回合**跑完了**（`turn/start` → `turn/end`
 *   配对成立）"，但 `kind='error'` 至少有**两类**来源，其中一类**根本没有 `turn/start`**：
 *   ① 熔断 `DenialLimitError` 等（`AgentLoop` 的 catch 把消息写进 `finalText`）——这类**跑过**回合；
 *   ② **`BeforeTurn` 拦截**（输入级否决）——该分支**从不写 `turn/start`/`step/start`**、
 *      0 次模型调用，只写 `assistant/message`(=`[blocked] …`,带原因)、`turn/end{kind:'error'}`
 *      与一条 `audit/denial{stage:'before_turn'}`。
 *   两类共用同一个 `kind='error'` ⇒ **HTTP 面无法区分**，故此处**只能**按"回合以错误结束"统一给 500；
 *   而"**策略拒绝用户输入**是否更该是 403/422"是一个**未裁决的语义问题**——`finalText` 与审计能告诉
 *   人"被拒的原因"，但**机读面分辨不出**。若要分开，需要给 `TurnResult` 加一个**可机读的判别字段**
 *   （并同步 `turn/end` 与四个消费面），属独立卡；**在那之前，本函数不做假设**。
 * - `success` ⇒ 200（逐字不变）、`budget` ⇒ 200、`interrupted` ⇒ 200：
 *   budget 是用户自己下的预算（`--max-steps` / `maxSteps`）耗尽，且还覆盖"模型回了纯空文本"
 *   这条既有边界（AgentLoop.ts:344-347）；interrupted 是用户自己按的停止（POST /interrupt，
 *   既有 server.test.ts:426 已把 200 钉住）。两者都**不是**失败，改成 5xx 等于凭空发明失败信号，
 *   会让正常/主动停止的客户端报错。
 *
 * body 形状不变（仍 `{ finalText, kind, steps, turnId }`）：不复用本文件的
 * `{ error: 'turn_failed', message }` 形状——那个形状属于"请求没能跑起来"（`ctl.runTurn` 抛异常），
 * 与"回合跑完但以 error 收场"是两回事；在同一路径上塞第二种 body 形状会逼客户端按字段存在性分支。
 */
export function turnStatusFor(kind: TurnResult['kind']): number {
  return kind === 'error' ? 500 : 200;
}

/**
 * BRIEF-21（失败被上报为成功 · HTTP 面 · Goal run）—— `GoalRunResult.outcome` → HTTP
 * 状态码的**唯一**决策点，与上方 `turnStatusFor` 同族裁决。
 *
 * 复现（改前）：`POST /api/goal/tasks/:id/run` 恒回 200（旧 :632，`return json(res, 200, { result })`），
 * 而 `GoalSeam.runTask` 的两条出口语义**完全不同**却共用这一个 200：
 * - 领域裁决（`met` / `not_met` / `stopped`）：run 跑完了，迭代已 persist、队列已 settle，
 *   结论就写在 `outcome` 上——「评估结论未达成」不是运行失败。
 * - **结构性失败**（`error`）：`goalSeam.ts:329-345` 的 catch——generate/evaluate/工作区
 *   抛异常，run **根本没跑完**，任务被 `queue.requeue` 退回 pending 等重试，原因在 `error` 里
 *   （`GoalRunResult.outcome` 的取值域见 `goalSeam.ts:83`；`'error'` 只由那个 catch 产出）。
 * 于是只看状态码的客户端（`curl -f`、fetch 的 `res.ok`、HTTP 中间件）无法区分「跑完了、
 * 结论 not_met」与「跑崩了、被 requeue」——两者都读成成功。
 *
 * 裁决（四个 outcome 全部钉死，与 `turnStatusFor` 逐条对齐）：
 * - `error` ⇒ **500**：与回合的 `kind='error'` 同理——run 是本仓自己跑的，没有上游/代理可
 *   归因，故不是 502/503（那是网关语义，本仓无此对象）。也不是 400：请求本身合法，
 *   是运行崩了；400 留给既有的 `goal_run_failed` 分支（`runTask` 自身抛出：任务未知、
 *   已终态、工作区不存在——`goalSeam.ts:226-232`，那条路径根本没进 try）。
 * - `met` / `not_met` / `stopped` ⇒ **200**：领域裁决。把 `not_met` 一并变成 5xx 是
 *   **把一种坏换成另一种坏**——那会让「结论未达成」与「运行崩溃」同样不可区分。
 *
 * body 形状不变（仍 `{ result }`：`outcome` / `error` / `queueTask` / `entry` / `record` 语义逐字
 * 不变）：**不复用**本文件的 `{ error: 'goal_run_failed', message }` 形状——那个形状属于
 * 「run 没能跑起来」，与「run 跑崩了但 seam 如实回传了 result」是两回事；在同一路径上塞
 * 第二种 body 形状会逼客户端按字段存在性分支。
 */
export function goalRunStatusFor(outcome: GoalRunResult['outcome']): number {
  return outcome === 'error' ? 500 : 200;
}

/** Compact single-line tool-arguments summary for SSE tool deltas. */
function summarizeArgs(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  try {
    const json = JSON.stringify(args);
    return json.length > 120 ? `${json.slice(0, 120)}…` : json;
  } catch {
    return String(args);
  }
}

/** Best-effort OS "reveal folder" (Explorer / Finder / xdg-open), fire-and-forget. */
function defaultOpenFolder(dir: string): void {
  const opener = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(opener, [dir], { detached: true, stdio: 'ignore' });
  child.unref();
}

export function createVesselServer(opts: VesselServerOptions = {}): VesselServer {
  if (opts.authToken !== undefined && !/^[0-9a-f]{48}$/.test(opts.authToken)) throw new Error('invalid daemon launch token');
  if (opts.daemon && !opts.authToken) throw new Error('daemon control requires a launch token');
  if (opts.host && !['127.0.0.1', 'localhost', '::1'].includes(opts.host) && !opts.authToken) throw new Error('remote bind requires a launch token');
  if (opts.mesh && (!opts.authToken || opts.mesh.local.token !== opts.authToken || opts.daemon && opts.mesh.local.nodeId !== opts.daemon.status().instanceId)) throw new Error('mesh identity must match daemon');
  const port = opts.port ?? DEFAULT_PORT;
  const staticDir = resolveStaticDir(opts.staticDir);
  const webUi = staticDir === path.resolve(REPO_ROOT, 'apps', 'web', 'dist')
    && fs.existsSync(path.join(staticDir, 'index.html')) && fs.statSync(path.join(staticDir, 'index.html')).isFile();
  const workspace = opts.workspace === undefined ? undefined : path.resolve(opts.workspace);
  const projectRegistry = opts.projectRegistry ?? new ProjectRegistry();
  if (workspace !== undefined) {
    try { projectRegistry.open(workspace); }
    catch { /* ponytail: startup registration is best-effort; explicit project/open retains its errors. */ }
  }
  const sessionRegistry = opts.sessionRegistry ?? new SessionRegistry({ index: true });
  let store = opts.providerStore;
  const providerRoutes = new ProviderRoutes(() => store ??= createDefaultProviderStore(), opts.providerFetch, opts.providerProbeTimeoutMs);
  const modelHubs = new Map<string, SessionModelHub>();
  const buildProvider = (cfg: ProviderConfig): ChatProvider => opts.providerBuilder?.(cfg) ?? createProvider(providerNameForConfig(cfg), { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, modelCapabilities: cfg.modelCapabilities });
  const defaultFactory: SessionFactory = async (input) => {
    const cfg = input.provider && input.provider !== 'mock' ? providerRoutes.resolve(input.provider, input.model) : undefined;
    const model = cfg?.model ?? input.model ?? 'default';
    const provider = cfg ? buildProvider(cfg) : new MockProvider([{ when: /.*/, response: { text: `(mock) ${model}` } }], {
      model: input.model ?? 'default',
    });
    const hub = new SessionModelHub({ provider: cfg?.id ?? 'mock', model }, provider);
    const ctl = await SessionController.create({
      workspaceRoot: input.workspaceRoot,
      provider: hub,
      providerId: hub.id,
      model: hub.id,
      contextModelSelection: () => ({ providerId: hub.selection.provider, model: hub.selection.model }),
      strictPricing: true,
      policySystemPath: DEFAULT_POLICY,
      behaviorIRPath: DEFAULT_BEHAVIOR,
      permission: input.permission ?? 'workspace-write',
      registry: input.registry,
      subagent: opts.externalAgents?.length ? { externalAgents: opts.externalAgents } : undefined,
    });
    hub.attach(ctl.session.dir);
    try { const meta = input.registry?.get(ctl.sessionId); if (meta) input.registry!.put({ ...meta, ...hub.selection }); }
    catch (error) { await ctl.close(); throw error; }
    modelHubs.set(ctl.sessionId, hub);
    return ctl;
  };
  const sessionFactory = opts.sessionFactory ?? defaultFactory;

  /** live session controllers keyed by session id (owns the run loop). */
  const controllers = new Map<string, SessionController>();
  const behaviorRoutes = new BehaviorRoutes(id => controllers.get(id)?.behaviorInspection);
  const patches = new PatchRoutes(id => controllers.get(id)?.state);
  const widgets = new WidgetRoutes(id => controllers.has(id), (id, widget) => {
    if (widget.kind === 'diff_inspector') patches.publish(id, widget);
  });
  const inspector = new SessionInspector(opts.observeWorkspace);

  // ------------------------------------------------------------------
  // task 060 team seam — route state + live team run per session id
  // ------------------------------------------------------------------

  const tierBindings = (opts.tierBindings ?? DEFAULT_TIER_BINDINGS) as Record<string, { providerId: string; model: string }>;
  const teamProviders: Record<string, ChatProvider> =
    opts.teamProviders ??
    ({
      mock: new MockProvider([{ when: /.*/, response: { text: '(mock team member turn)' } }], { model: 'mock' }),
    } as Record<string, ChatProvider>);
  const policyArtifacts = loadPolicyArtifacts({ systemPath: opts.policySystemPath ?? DEFAULT_POLICY });
  const reviewStore = opts.reviewStore ?? new ReviewHandoffStore();
  const openFolder = opts.openFolder ?? defaultOpenFolder;
  const goalSeam = opts.goalSeam ?? new GoalSeam();
  const subagentSeam = opts.subagentSeam ?? new SubagentSeam();
  const notify: Notify = (title, message) => { try { opts.notify?.(title, message); } catch { /* optional desktop service */ } };
  const teamStages = opts.teamStages ?? new TeamStageRoutes((id, status) => {
    if (status === 'staged') notify('Vessel approval required', `Team plan ${id} is awaiting approval.`);
    if (status === 'finished') {
      const stage = teamStages.get(id);
      const failed = stage?.error || stage?.tasks.some(task => task.status === 'failed');
      notify(failed ? 'Vessel team failed' : 'Vessel team completed', `Team plan ${id}: ${failed ? 'failed' : 'completed'}`);
    }
  });
  const subagentDetaches: (() => void)[] = [];
  if (opts.notify) subagentDetaches.push(subagentSeam.subscribe((kind, delta) => {
    if (kind === 'subagent:end') notify(delta.summary?.status === 'failed' ? 'Vessel subagent failed' : 'Vessel subagent finished', `Subagent ${delta.id}: ${delta.summary?.status ?? 'finished'}`);
  }));
  const subagentStreams = new Set<http.ServerResponse>();

  // ---------------- card 222: ARC-10/UI-016, UI-013, UI-015, UI-017 read sides ----------------
  const taskTrees = opts.taskTrees ?? new TaskTreeRegistry();
  const taskTreeRoutes = new TaskTreeRoutes(taskTrees);
  const composeRoutes = new BehaviorComposeRoutes(id => id ? controllers.get(id)?.policyArtifacts : policyArtifacts);
  const traceRoutes = new TraceRoutes(id => controllers.get(id)?.session.replay());
  const activityRoutes = new ActivityRoutes({
    sessions: () => sessionRegistry.listIndexed(500, 0),
    live: (id) => {
      const ctl = controllers.get(id);
      if (!ctl) return undefined;
      const records = [...ctl.session.replay()];
      const lastTurnEnd = records.filter((r) => r.type === 'turn/end').at(-1) as { kind?: string } | undefined;
      let lastRunStatus: 'completed' | 'failed' | 'interrupted' | 'cancelled' | undefined;
      if (lastTurnEnd?.kind === 'failure') lastRunStatus = 'failed';
      else if (lastTurnEnd?.kind === 'interrupted') lastRunStatus = 'interrupted';
      else if (lastTurnEnd?.kind === 'cancelled') lastRunStatus = 'cancelled';
      else if (lastTurnEnd?.kind === 'success') lastRunStatus = 'completed';

      return {
        turnActive: ctl.loop.turnActive,
        lastRunStatus,
        recordCount: records.length,
      };
    },
    approvals: () => widgets.pendingApprovals().map((approval) => ({
      sessionId: approval.sessionId, widgetId: approval.widgetId, actionType: approval.actionType,
      description: approval.description, requestedAt: approval.requestedAt,
      options: approval.options.map((option) => ({ id: option.id, label: option.label, tone: option.tone })),
    })),
    subagents: () => subagentSeam.listSubagents(),
    teamStages: () => teamStages.list().flatMap(stage => stage ? [{ id: stage.id, status: stage.status, createdAt: stage.createdAt, tasks: stage.tasks.map(task => ({ status: task.status })) }] : []),
    goalTasks: () => goalSeam.listTasks(),
  });
  let behaviorLibrary: BehaviorEntry[] | undefined;
  const libraryEntries = (): BehaviorEntry[] => {
    if (behaviorLibrary) return behaviorLibrary;
    try { behaviorLibrary = loadBehaviorLibrary(opts.behaviorLibraryPath ?? DEFAULT_BEHAVIOR); }
    catch { behaviorLibrary = []; }
    return behaviorLibrary;
  };

  interface SessionTeamState {
    route: RouteSeam;
    /** current run handle (finished or running) — snapshot source for the UI */
    run: ActiveTeamRun | null;
    /** a run is currently executing (blocks a second concurrent run) */
    inFlight: boolean;
    /** last run failure detail (surfaced via GET /team-runs/current) */
    error?: string;
  }
  const teamStates = new Map<string, SessionTeamState>();

  function teamStateFor(id: string): SessionTeamState {
    let st = teamStates.get(id);
    if (!st) {
      st = { route: new RouteSeam({ bindings: tierBindings }), run: null, inFlight: false };
      teamStates.set(id, st);
    }
    return st;
  }

  /** live team-frame senders per session id (registered by open SSE streams). */
  const teamSenders = new Map<string, Set<(kind: TeamEventKind, state: unknown) => void>>();

  function broadcastTeam(sessionId: string, kind: TeamEventKind, state: unknown): void {
    if (kind === 'end') notify('Vessel team finished', `Team run for session ${sessionId} finished.`);
    const set = teamSenders.get(sessionId);
    if (!set) return;
    for (const send of set) send(kind, state);
  }

  const server = http.createServer((req, res) => {
    void handleRequest(req, res).catch((err) => {
      if (res.writableEnded) return;
      json(res, 500, { error: 'internal_error', message: err instanceof Error ? err.message : String(err) });
    });
  });

  server.on('error', (err) => {
    // surface bind failures (e.g. 5678 taken) to the caller via attachment below
    server.emit('vessel:error', err);
  });

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    if (opts.authToken && !authMiddleware(req, res, opts.authToken, url.pathname)) return;
    // Inspect the raw target: URL parsing removes literal and encoded dot segments.
    let rawPath: string;
    try {
      rawPath = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    } catch {
      return json(res, 400, { error: 'invalid_path' });
    }
    if (rawPath.split(/[\\/]/).includes('..')) return json(res, 403, { error: 'forbidden' });
    const providerRoute = url.pathname === '/api/models' || url.pathname === '/api/providers' || url.pathname.startsWith('/api/providers/');
    const sameOrigin = trustedOrigin(req, url, Boolean(opts.authToken));
    if (url.pathname === '/api/behavior/effective' || url.pathname === '/api/behavior/inspect') {
      if (!sameOrigin) return json(res, 403, { error: 'origin_denied' });
      if (method !== 'GET') return json(res, 405, { error: 'read_only' });
      const snapshot = behaviorRoutes.inspect(url.searchParams.get('sessionId'));
      return snapshot ? json(res, 200, snapshot) : json(res, 404, { error: 'behavior_snapshot_unavailable' });
    }
    if (url.pathname === '/api/behavior/library') {
      if (!sameOrigin) return json(res, 403, { error: 'origin_denied' });
      if (method !== 'GET') return json(res, 405, { error: 'read_only' });
      return json(res, 200, { entries: libraryEntries() });
    }
    if (url.pathname === '/api/behavior/compose') {
      if (!sameOrigin) return json(res, 403, { error: 'origin_denied' });
      if (method !== 'POST') return json(res, 405, { error: 'read_only' });
      const result = composeRoutes.compose(await readJsonBody(req));
      return json(res, result.status, result.body);
    }
    if (providerRoute) {
      if (!sameOrigin) return json(res, 403, { error: 'cross_origin_denied' });
      try {
        if (url.pathname === '/api/models' && method === 'GET') return json(res, 200, { models: providerRoutes.models() });
        if (url.pathname === '/api/providers' && method === 'GET') return json(res, 200, { providers: providerRoutes.list() });
        if (url.pathname === '/api/providers' && method === 'POST') return json(res, 201, { provider: providerRoutes.save(await readJsonBody(req)) });
        if (url.pathname === '/api/providers/test' && method === 'POST') return json(res, 200, await providerRoutes.test(await readJsonBody(req)));
        if (url.pathname === '/api/providers/pull-models' && method === 'POST') return json(res, 200, await providerRoutes.pullModels(await readJsonBody(req)));
        if (/^\/api\/providers\/[^/]+$/.test(url.pathname) && method === 'DELETE') return providerRoutes.remove(decodeURIComponent(url.pathname.slice('/api/providers/'.length))) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'unknown_provider' });
        return json(res, 405, { error: 'method_not_allowed' });
      } catch (error) {
        // task 215：透传**具体**错误码，不再一律 400 provider_request_failed。
        // 只放行形如 `invalid_models` 的机器码；文件损坏等自由文本 message
        // （可能夹带路径/密钥）一律回落到通用码，绝不外泄。
        return json(res, 400, { error: providerErrorCode(error) });
      }
    }
    if (url.pathname === '/api/mesh/peers') {
      if (method !== 'GET') return json(res, 405, { error: 'read_only' });
      const dagId = url.searchParams.get('dagId');
      if (dagId !== null && (!dagId.trim() || dagId.length > 128)) return json(res, 400, { error: 'invalid_dag_id' });
      const local = opts.mesh?.local;
      return json(res, 200, { configured: !!opts.mesh, local: local ? { nodeId: local.nodeId, endpoint: local.endpoint,
        roleCapabilities: local.roleCapabilities, status: local.status, latencyMs: local.latencyMs } : null,
        peers: opts.mesh?.listPeers().map(peer => {
          const snapshot = dagId === null ? undefined : opts.mesh?.remoteSnapshot(peer.nodeId, dagId);
          return { ...peer, ...(snapshot ? { remoteTasks: snapshot.tasks.map(task => ({ id: task.id, title: task.title, assignedRole: task.assignedRole, status: task.status })) } : {}) };
        }) ?? [], observedAt: Date.now() });
    }
    if (url.pathname === '/api/memory/rules') {
      if (method !== 'GET') return json(res, 405, { error: 'read_only' });
      const category = url.searchParams.get('category') ?? undefined;
      const limit = Number(url.searchParams.get('limit') ?? 1000);
      if (category !== undefined && !['policy_denial', 'tool_failure', 'architecture_constraint'].includes(category) || !Number.isInteger(limit) || limit < 1 || limit > 1000) return json(res, 400, { error: 'invalid_rule_filter' });
      const rules = await sessionRegistry.listReflectiveRules(limit, category as 'policy_denial' | 'tool_failure' | 'architecture_constraint' | undefined);
      return json(res, 200, { rules, available: sessionRegistry.indexAvailable });
    }
    if (url.pathname === '/api/system/sandbox-tier') {
      if (method !== 'GET') return json(res, 405, { error: 'read_only' });
      const sessionId = url.searchParams.get('sessionId') ?? undefined;
      if (sessionId !== undefined && !sessionRegistry.get(sessionId)) return json(res, 404, { error: 'session_not_found' });
      return json(res, 200, { scope: 'execution', audits: await sessionRegistry.sandboxAudits(sessionId), observedAt: Date.now() });
    }
    if (url.pathname.startsWith('/api/control/mesh/')) {
      if (!opts.authToken) return json(res, 403, { error: 'daemon_auth_required' });
      if (!opts.mesh) return json(res, 404, { error: 'mesh_unconfigured' });
      if (method === 'GET' && url.pathname === '/api/control/mesh/status') return json(res, 200, { nodeId: opts.mesh.local.nodeId, peers: opts.mesh.listPeers() });
      if (method === 'POST' && url.pathname.startsWith('/api/control/mesh/ping/')) {
        let id: string;
        try { id = decodeURIComponent(url.pathname.slice('/api/control/mesh/ping/'.length)); }
        catch { return json(res, 400, { error: 'invalid_peer_id' }); }
        if (!opts.mesh.peer(id)) return json(res, 404, { error: 'unknown_mesh_peer' });
        try { await opts.mesh.probePeer(id); }
        catch { return json(res, 502, { error: 'mesh_peer_unreachable' }); }
        return json(res, 200, { nodeId: id, latencyMs: opts.mesh.peer(id)!.latencyMs });
      }
      return json(res, 404, { error: 'not_found' });
    }
    if (url.pathname.startsWith('/api/mesh/')) {
      if (!opts.mesh) return json(res, 404, { error: 'mesh_unconfigured' });
      return opts.mesh.handleRequest(req, res);
    }
    if (opts.authToken && req.method === 'GET' && url.pathname === '/api/health' && req.headers.accept?.includes('text/html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      res.end(DAEMON_LOGIN_HTML); return;
    }
    const segs = segment(url.pathname);

    // API namespace
    if (segs[0] === 'api') {
      return handleApi(method, segs, req, res, url);
    }
    // everything else → static assets
    return serveStatic(decodeURIComponent(url.pathname), method, res);
  }

  async function handleApi(method: string, segs: string[], req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const sameOrigin = trustedOrigin(req, url, Boolean(opts.authToken));
    if (segs.length === 2 && segs[1] === 'sessions' && method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? 1000); const offset = Number(url.searchParams.get('offset') ?? 0);
      try { return json(res, 200, { sessions: await sessionRegistry.listIndexed(limit, offset, url.searchParams.get('topicId') ?? undefined) }); }
      catch (error) { if (error instanceof RangeError) return json(res, 400, { error: 'invalid_pagination' }); throw error; }
    }
    if (segs.length === 3 && segs[1] === 'sessions' && segs[2] === 'search' && method === 'GET') {
      try { const results = await sessionRegistry.search({ query: url.searchParams.get('q') ?? '', limit: Number(url.searchParams.get('limit') ?? 20), offset: Number(url.searchParams.get('offset') ?? 0) }); return json(res, 200, { results, indexed: sessionRegistry.indexAvailable }); }
      catch (error) { if (error instanceof RangeError) return json(res, 400, { error: 'invalid_search' }); throw error; }
    }

    if (segs.length === 3 && segs[1] === 'tasks' && segs[2] === 'tree' && method === 'GET') {
      const status = url.searchParams.get('status') ?? undefined;
      if (status !== undefined && !TASK_TREE_STATUSES.includes(status as TaskTreeStatus)) return json(res, 400, { error: 'invalid_status' });
      return json(res, 200, taskTreeRoutes.list({
        projectRoot: url.searchParams.get('projectRoot') ?? undefined,
        rootInstanceId: url.searchParams.get('rootInstanceId') ?? undefined,
        status: status as TaskTreeStatus | undefined,
      }));
    }
    if (segs.length === 3 && segs[1] === 'activity' && segs[2] === 'runs' && method === 'GET') {
      return json(res, 200, await activityRoutes.list());
    }

    if (opts.daemon && segs.length === 3 && segs[1] === 'daemon') {
      if (method === 'GET' && segs[2] === 'status') return json(res, 200, opts.daemon.status());
      if (method === 'POST' && segs[2] === 'stop') {
        json(res, 202, { stopping: true });
        setImmediate(() => opts.daemon!.stop()); return;
      }
    }
    if (segs[1] === 'team' && segs[2] === 'stages') {
      if (segs.length === 3 && method === 'GET') return json(res, 200, { stages: teamStages.list() });
      const id = segs[3]!;
      const stage = teamStages.get(id);
      if (!stage) return json(res, 404, { error: 'stage_not_found' });
      if (segs.length === 4 && method === 'GET') return json(res, 200, { stage });
      if (segs.length === 5 && segs[4] === 'revise' && method === 'POST') {
        if (stage.status !== 'staged') return json(res, 409, { error: 'stage_conflict' });
        try { return json(res, 201, { stage: teamStages.revise(id, await readJsonBody(req)) }); }
        catch (err) { return json(res, 400, { error: 'invalid_plan_changes', message: err instanceof Error ? err.message : String(err) }); }
      }
      if ((segs.length === 8 || segs.length === 9 && segs[8] === 'content') && method === 'GET' && segs[4] === 'tasks' && segs[6] === 'artifacts') {
        try {
          const index = Number(segs[7]);
          if (!Number.isSafeInteger(index) || index < 0) return json(res, 400, { error: 'invalid_artifact_index' });
          const artifact = teamStages.artifact(id, decodeURIComponent(segs[5]!), index);
          if (segs[8] === 'content') {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
            return void res.end(artifact.content);
          }
          return json(res, 200, artifact);
        } catch (err) { return json(res, 400, { error: 'artifact_unavailable', message: err instanceof Error ? err.message : String(err) }); }
      }
      if (segs.length === 5 && method === 'POST' && (segs[4] === 'approve' || segs[4] === 'reject')) {
        try {
          if (segs[4] === 'approve') teamStages.approve(id);
          else teamStages.reject(id);
          return json(res, 200, { ok: true, status: segs[4] === 'approve' ? 'running' : 'rejected' });
        } catch (err) {
          return json(res, 409, { error: 'stage_conflict', message: err instanceof Error ? err.message : String(err) });
        }
      }
      return json(res, 404, { error: 'not_found' });
    }
    if ((segs.length === 2 && segs[1] === 'events' || segs.length === 3 && segs[1] === 'subagents' && segs[2] === 'events') && method === 'GET') {
      res.writeHead(200, SSE_HEADERS);
      res.write(`data: ${JSON.stringify({ type: 'ping', ts: Date.now() })}\n\n`);
      subagentStreams.add(res);
      const off = subagentSeam.subscribe((type, delta) => res.write(`data: ${JSON.stringify({ type, delta, ts: Date.now() })}\n\n`));
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const cleanup = () => { closed = true; off(); clearInterval(heartbeat); subagentStreams.delete(res); };
      res.on('close', cleanup);
      res.on('error', cleanup);
      for (const summary of await subagentSeam.listSubagents()) {
        if (closed) return;
        res.write(`data: ${JSON.stringify({ type: 'subagent:step', delta: { id: summary.id, summary, usage: subagentSeam.detail(summary.id)?.usage }, ts: Date.now() })}\n\n`);
      }
      if (closed) return;
      heartbeat = setInterval(() => res.write(`data: ${JSON.stringify({ type: 'ping', ts: Date.now() })}\n\n`), 15000);
      return;
    }
    if (segs[1] === 'subagents') {
      if (segs.length === 2 && method === 'GET') return json(res, 200, { ok: true, subagents: await subagentSeam.listSubagents() });
      if (segs.length === 3 && method === 'GET') {
        const detail = subagentSeam.detail(segs[2]!);
        return json(res, detail ? 200 : 404, detail ?? { error: 'subagent_not_found' });
      }
      if (segs.length === 4 && segs[3] === 'cancel' && method === 'POST') {
        const ok = await subagentSeam.cancelSubagent(segs[2]!);
        return json(res, ok ? 200 : 404, ok ? { ok, cancelled: true } : { error: 'subagent_not_running' });
      }
      return json(res, 404, { error: 'not_found' });
    }
    // GET /api/health
    if (segs.length === 2 && segs[1] === 'health' && method === 'GET') {
      return json(res, 200, { ok: true, version: VERSION, webUi, ...(workspace ? { workspace } : {}) });
    }

    // GET /api/projects
    if (segs.length === 2 && segs[1] === 'projects' && method === 'GET') {
      return json(res, 200, { projects: projectRegistry.list() });
    }

    // POST /api/projects/open
    if (segs.length === 3 && segs[1] === 'projects' && segs[2] === 'open' && method === 'POST') {
      const body = (await readJsonBody(req)) as { workspaceRoot?: string } | null;
      if (!body) return json(res, 400, { error: 'bad_json' });
      if (!body.workspaceRoot) return json(res, 400, { error: 'missing_workspaceRoot' });
      try {
        const project = projectRegistry.open(body.workspaceRoot);
        return json(res, 200, { project });
      } catch (err) {
        return json(res, 400, { error: 'open_failed', message: err instanceof Error ? err.message : String(err) });
      }
    }

    // PATCH /api/sessions/:id/topic — rename and/or archive session Topic metadata.
    if (segs.length === 4 && segs[1] === 'sessions' && segs[3] === 'topic' && method === 'PATCH') {
      const body = (await readJsonBody(req)) as { title?: unknown; isArchived?: unknown } | null;
      if (!body) return json(res, 400, { error: 'bad_json' });
      if (body.title !== undefined && (typeof body.title !== 'string' || body.title.trim() === '')) {
        return json(res, 400, { error: 'invalid_topic_title' });
      }
      if (body.isArchived !== undefined && typeof body.isArchived !== 'boolean') {
        return json(res, 400, { error: 'invalid_topic_archive_state' });
      }
      if (body.title === undefined && body.isArchived === undefined) {
        return json(res, 400, { error: 'missing_topic_update' });
      }
      if (!sessionRegistry.get(segs[2]!)) return json(res, 404, suggestNotFound(segs[2]!));
      let session = sessionRegistry.get(segs[2]!);
      if (typeof body.title === 'string') session = sessionRegistry.renameTopic(segs[2]!, body.title);
      if (typeof body.isArchived === 'boolean') session = sessionRegistry.setTopicArchived(segs[2]!, body.isArchived);
      return json(res, 200, { session });
    }

    // POST /api/sessions
    if (segs.length === 2 && segs[1] === 'sessions' && method === 'POST') {
      const body = (await readJsonBody(req)) as {
        workspaceRoot?: string;
        provider?: string;
        model?: string;
        permission?: SessionPermission;
      } | null;
      if (!body) return json(res, 400, { error: 'bad_json' });
      if (typeof body.workspaceRoot !== 'string' || !body.workspaceRoot.trim()) return json(res, 400, { error: 'missing_workspaceRoot' });
      if (body.provider !== undefined && (typeof body.provider !== 'string' || !body.provider.trim()) || body.model !== undefined && (typeof body.model !== 'string' || !body.model.trim()) || body.permission !== undefined && !['read-only', 'workspace-write', 'danger-full-access'].includes(body.permission)) return json(res, 400, { error: 'invalid_session_input' });
      if (body.provider && body.provider !== 'mock' && !sameOrigin) return json(res, 403, { error: 'cross_origin_denied' });
      try {
        if (body.provider && body.provider !== 'mock') providerRoutes.resolve(body.provider, body.model);
        const ctl = await sessionFactory({
          workspaceRoot: body.workspaceRoot,
          provider: body.provider,
          model: body.model,
          permission: body.permission,
          registry: sessionRegistry,
        });
        controllers.set(ctl.sessionId, ctl);
        subagentDetaches.push(ctl.bus.on('before_model', payload => {
          inspector.observe(ctl.sessionId, payload, ctl.state.workspaceRoot);
        }, 'local-server:inspector'));
        subagentDetaches.push(ctl.bus.on('ui/widget_block', payload => {
          if (isWidgetBlock(payload)) widgets.publish(ctl.sessionId, payload);
        }, 'local-server:widgets'));
        if (opts.notify) subagentDetaches.push(ctl.bus.on('policy_decision', payload => {
          const decision = payload as { verdict?: string; toolName?: string };
          if (decision.verdict === 'ask') notify('Vessel approval required', `Session ${ctl.sessionId}: ${decision.toolName ?? 'tool'} needs approval.`);
        }, 'local-server:notification:approval'));
        subagentDetaches.push(subagentSeam.attach(ctl.bus, id => ctl.cancelSubagent(id)));
        const meta = sessionRegistry.get(ctl.sessionId);
        return json(res, 201, { session: (meta ?? ctl.state) });
      } catch (err) {
        return json(res, 400, { error: 'session_create_failed' });
      }
    }

    // /api/reviews — external review handoffs (059) + task 060 UI actions
    if (segs[1] === 'reviews' && segs.length >= 2) {
      return handleReviews(method, segs, req, res);
    }

    // ---------------- task 065: Goal/Loop seam (task queue + iterations + run) ----------------
    if (segs[1] === 'goal' && segs.length >= 3) {
      return handleGoal(method, segs, req, res);
    }

    // /api/sessions/:id/...
    if (segs.length >= 3 && (segs[1] === 'sessions' || segs[1] === 'session')) {
      const id = segs[2] ?? '';
      const sub = segs[3];
      const ctl = controllers.get(id);

      if (segs.length === 5 && sub === 'patch' && segs[4] === 'apply' && method === 'POST') {
        const body = await readJsonBody(req);
        const result = patches.apply(id, body);
        if (result.status === 200) {
          const decision = body as { widgetId: string; hunkId: string; action: string };
          widgets.patchDecision(id, decision.widgetId, decision.hunkId, decision.action === 'accept' ? 'accepted' : 'rejected');
        }
        return json(res, result.status, result.body);
      }

      if (segs.length === 6 && sub === 'widget' && segs[5] === 'respond' && method === 'POST') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        const result = widgets.respond(id, segs[4]!, await readJsonBody(req));
        return json(res, result.status, result.body);
      }

      // DELETE /api/sessions/:id
      if (segs.length === 3 && method === 'DELETE') {
        if (!sameOrigin) return json(res, 403, { error: 'cross_origin_denied' });
        const existing = sessionRegistry.get(id);
        if (!existing && !ctl) return json(res, 404, suggestNotFound(id));
        if (ctl) {
          ctl.interrupt();
          controllers.delete(id);
        }
        sessionRegistry.remove(id);
        if (existing?.workspaceRoot) {
          try {
            const sessionDir = resolveSessionDir(existing.workspaceRoot, id);
            if (fs.existsSync(sessionDir)) {
              void recycleDaemonPath(sessionDir).catch(() => {});
            }
          } catch {
            // best-effort cleanup
          }
        }
        return json(res, 200, { ok: true, id });
      }

      // GET /api/sessions/:id
      if (segs.length === 3 && method === 'GET') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        return json(res, 200, { session: { ...ctl.state, ...modelHubs.get(id)?.selection } });
      }

      // PATCH /api/sessions/:id/model — transport is replaced only at an idle boundary.
      if (segs.length === 4 && sub === 'model' && method === 'PATCH') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        if (!sameOrigin) return json(res, 403, { error: 'cross_origin_denied' });
        const body = await readJsonBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'invalid_model_selection' });
        const { provider, model } = body as { provider?: unknown; model?: unknown };
        const valid = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);
        if (!valid(provider) || !valid(model)) return json(res, 400, { error: 'invalid_model_selection' });
        const hub = modelHubs.get(id);
        if (!hub) return json(res, 409, { error: 'model_switch_unavailable' });
        if (ctl.loop.turnActive || teamStates.get(id)?.inFlight || teamStages.list(id).some(stage => stage?.status === 'running')) return json(res, 409, { error: 'session_busy' });
        const previous = sessionRegistry.get(id);
        try {
          const config = providerRoutes.resolve(provider, model);
          const target = buildProvider(config);
          ctl.validateBehaviorModel(target, model, provider);
          if (!previous) return json(res, 404, suggestNotFound(id));
          try { sessionRegistry.put({ ...previous, provider, model }); }
          catch (error) { sessionRegistry.put(previous); throw error; }
          hub.select({ provider, model }, target);
          return json(res, 200, { session: { ...ctl.state, ...hub.selection } });
        } catch { return json(res, 400, { error: 'model_switch_failed' }); }
      }

      // POST /api/sessions/:id/turns
      if (segs.length === 4 && sub === 'turns' && method === 'POST') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        const body = (await readJsonBody(req)) as { prompt?: string } | null;
        if (!body || typeof body.prompt !== 'string' || body.prompt.trim() === '') {
          return json(res, 400, { error: 'missing_prompt' });
        }
        try {
          const result = await ctl.runTurn(body.prompt);
          notify(result.kind === 'error' ? 'Vessel task failed' : 'Vessel task finished', `Session ${id}: ${result.kind}`);
          // BRIEF-19: a turn that ended in error must not be reported as HTTP 200 —
          // status-code-only clients would read the failure as success. Body shape
          // (and every field's meaning) is unchanged; only the status differs.
          return json(res, turnStatusFor(result.kind), {
            finalText: result.finalText,
            kind: result.kind,
            steps: result.steps,
            turnId: result.turnId,
          });
        } catch (err) {
          notify('Vessel task failed', `Session ${id} encountered an error.`);
          return json(res, 500, { error: 'turn_failed', message: err instanceof Error ? err.message : String(err) });
        }
      }

      // POST /api/sessions/:id/interrupt
      if (segs.length === 4 && sub === 'interrupt' && method === 'POST') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        ctl.interrupt();
        return json(res, 200, { ok: true });
      }

      // POST /api/sessions/:id/steer
      if (segs.length === 4 && sub === 'steer' && method === 'POST') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        const body = (await readJsonBody(req)) as { message?: string } | null;
        if (!body || typeof body.message !== 'string') {
          return json(res, 400, { error: 'missing_message' });
        }
        ctl.steer(body.message);
        return json(res, 200, { ok: true, pendingSteerCount: ctl.pendingSteerCount });
      }

      // GET /api/sessions/:id/trace — structured, sanitized step trace (UI-017)
      if (segs.length === 4 && sub === 'trace' && method === 'GET') {
        const report = traceRoutes.report(id);
        if (!report) return json(res, 404, suggestNotFound(id));
        return json(res, 200, { trace: report });
      }

      // GET /api/sessions/:id/events → SSE
      if (segs.length === 4 && sub === 'events' && method === 'GET') {
        if (!ctl) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(suggestNotFound(id)));
          return;
        }
        return streamEvents(ctl, req, res);
      }

      // ---------------- task 060: route selection (Auto/Fast/Pro + pin) ----------------
      // GET /api/sessions/:id/route
      if (segs.length === 4 && sub === 'route' && method === 'GET') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        return json(res, 200, teamStateFor(id).route.state());
      }
      // POST /api/sessions/:id/route — { mode: 'auto'|'fast'|'pro' }
      if (segs.length === 4 && sub === 'route' && method === 'POST') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        const body = (await readJsonBody(req)) as { mode?: unknown } | null;
        const state = teamStateFor(id).route;
        if (!state.setMode(body?.mode)) {
          return json(res, 400, { error: 'invalid_mode', message: 'mode must be one of auto | fast | pro' });
        }
        return json(res, 200, state.state());
      }
      // POST /api/sessions/:id/route/resolve — { task?, mode? } → actual route
      if (segs.length === 5 && sub === 'route' && segs[4] === 'resolve' && method === 'POST') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        const body = (await readJsonBody(req)) as { task?: string; mode?: 'auto' | 'fast' | 'pro' } | null;
        const state = teamStateFor(id).route;
        try {
          state.resolve({ task: body?.task ?? '', mode: body?.mode });
          return json(res, 200, state.state());
        } catch (err) {
          return json(res, 400, { error: 'route_resolve_failed', message: err instanceof Error ? err.message : String(err) });
        }
      }
      // POST /api/sessions/:id/route/pin — lock the auto resolution
      if (segs.length === 5 && sub === 'route' && segs[4] === 'pin' && method === 'POST') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        const state = teamStateFor(id).route;
        try {
          state.pin();
          return json(res, 200, state.state());
        } catch (err) {
          return json(res, 400, { error: 'route_pin_failed', message: err instanceof Error ? err.message : String(err) });
        }
      }
      // POST /api/sessions/:id/route/unpin — release the session lock
      if (segs.length === 5 && sub === 'route' && segs[4] === 'unpin' && method === 'POST') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        teamStateFor(id).route.unpin();
        return json(res, 200, teamStateFor(id).route.state());
      }

      if (segs.length === 4 && sub === 'team-stages') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        if (method === 'GET') return json(res, 200, { stages: teamStages.list(id) });
        if (method === 'POST') {
          const body = await readJsonBody(req) as { task?: string; mode?: 'auto' | 'fast' | 'pro'; acceptance?: string[]; tasks?: TeamDagTask[] } | null;
          if (!body || typeof body.task !== 'string' || !body.task.trim() || (body.mode !== undefined && !['auto', 'fast', 'pro'].includes(body.mode)) || (body.acceptance !== undefined && (!Array.isArray(body.acceptance) || !body.acceptance.every(x => typeof x === 'string')))) return json(res, 400, { error: 'invalid_stage_request' });
          try {
            const route = teamStateFor(id).route.resolve({ task: body.task, mode: body.mode });
            const roles = route.roles.filter(role => role !== 'lead');
            const tasks: TeamDagTask[] = body.tasks !== undefined ? body.tasks : roles.map((role, index) => ({ id: `task_${index + 1}`, title: role === 'reviewer' ? 'Review' : 'Generate', description: body.task!, assignedRole: role === 'reviewer' ? 'evaluator' : 'generator', dependencies: index ? [`task_${index}`] : [], status: 'pending' }));
            if (!Array.isArray(tasks) || !tasks.every(t => t && typeof t.id === 'string' && typeof t.title === 'string' && typeof t.description === 'string' && Array.isArray(t.dependencies) && t.dependencies.every(d => typeof d === 'string'))) return json(res, 400, { error: 'invalid_tasks' });
            const runtime = new TeamRuntime({ workspaceRoot: ctl.state.workspaceRoot, providers: teamProviders, policyArtifacts: ctl.policyArtifacts, tools: ctl.tools });
            const stage = teamStages.stage(id, runtime, { task: body.task, route, acceptance: body.acceptance, tasks }, ctl.state.workspaceRoot, Object.keys(teamProviders));
            return json(res, 201, { stage });
          } catch (err) {
            return json(res, 400, { error: 'invalid_stage', message: err instanceof Error ? err.message : String(err) });
          }
        }
      }
      // ---------------- task 060: team runs (057 TeamRuntime projection) ----------------
      // GET /api/sessions/:id/team-runs/current — latest TeamProjection snapshot
      if (segs.length === 5 && sub === 'team-runs' && segs[4] === 'current' && method === 'GET') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        const st = teamStateFor(id);
        return json(res, 200, { team: st.run?.snapshot() ?? null, error: st.error });
      }
      // POST /api/sessions/:id/team-runs — { task, acceptance?, mode? } start a run
      if (segs.length === 4 && sub === 'team-runs' && method === 'POST') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        const body = (await readJsonBody(req)) as { task?: string; acceptance?: string[]; mode?: 'auto' | 'fast' | 'pro' } | null;
        if (!body || typeof body.task !== 'string' || body.task.trim() === '') {
          return json(res, 400, { error: 'missing_task' });
        }
        const st = teamStateFor(id);
        if (st.inFlight) {
          return json(res, 409, { error: 'team_run_in_progress', message: 'a team run is already executing for this session' });
        }
        try {
          const route = st.route.resolve({ task: body.task, mode: body.mode });
          st.inFlight = true;
          const handle = await startTeamRun({
            workspaceRoot: ctl.state.workspaceRoot,
            task: body.task,
            acceptance: Array.isArray(body.acceptance) ? body.acceptance : undefined,
            route,
            providers: teamProviders,
            policyArtifacts,
          });
          // replace the previous run: detach its bus listeners, wire the new one
          st.run?.close();
          st.run = handle;
          st.inFlight = true;
          st.error = undefined;
          const offUpdate = handle.onUpdate((kind, state) => broadcastTeam(id, kind, state));
          void handle.settled.then((result) => {
            st.inFlight = false;
            if (result.error) st.error = result.error;
            offUpdate();
          });
          // push the initial snapshot so already-open SSE streams render immediately
          broadcastTeam(id, 'start', handle.snapshot());
          return json(res, 202, { run: { runId: handle.runId, status: 'running' } });
        } catch (err) {
          st.inFlight = false;
          return json(res, 400, { error: 'team_run_failed', message: err instanceof Error ? err.message : String(err) });
        }
      }

      return json(res, 404, { error: 'not_found' });
    }

    return json(res, 404, { error: 'not_found' });
  }

  /** /api/reviews* — External Review Handoff store operations (059) + 060 actions. */
  async function handleReviews(
    method: string,
    segs: string[],
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    // GET /api/reviews
    if (segs.length === 2 && method === 'GET') {
      return json(res, 200, { reviews: reviewStore.list() });
    }
    // POST /api/reviews — create a handoff artifact
    if (segs.length === 2 && method === 'POST') {
      const body = (await readJsonBody(req)) as Partial<ReviewHandoffRecord> | null;
      if (!body || typeof body.task !== 'string' || body.task.trim() === '') {
        return json(res, 400, { error: 'missing_task' });
      }
      try {
        const review = reviewStore.createHandoff({
          task: body.task,
          acceptance: body.acceptance,
          changedFiles: body.changedFiles,
          diffSummary: body.diffSummary,
          testResults: body.testResults,
          constraints: body.constraints,
          checklist: body.checklist,
          workspaceRoot: body.workspaceRoot,
        });
        return json(res, 201, { review });
      } catch (err) {
        return json(res, 400, { error: 'review_create_failed', message: err instanceof Error ? err.message : String(err) });
      }
    }

    const id = segs[2] ?? '';
    const review = reviewStore.get(id);
    if (!review) {
      return json(res, 404, { error: 'review_not_found', reviewId: id });
    }

    // GET /api/reviews/:id
    if (segs.length === 3 && method === 'GET') {
      return json(res, 200, { review });
    }
    // POST /api/reviews/:id/import — { text, source? } → parsed external result
    if (segs.length === 4 && segs[3] === 'import' && method === 'POST') {
      const body = (await readJsonBody(req)) as { text?: string; source?: 'external' | 'internal' } | null;
      if (!body || typeof body.text !== 'string' || body.text.trim() === '') {
        return json(res, 400, { error: 'missing_text' });
      }
      try {
        const updated = reviewStore.importResult(id, { source: body.source, text: body.text });
        return json(res, 200, { review: updated });
      } catch (err) {
        return json(res, 400, { error: 'review_import_failed', message: err instanceof Error ? err.message : String(err) });
      }
    }
    // GET /api/reviews/:id/handoff.md — raw artifact (Copy Handoff source)
    if (segs.length === 4 && segs[3] === 'handoff.md' && method === 'GET') {
      const file = reviewStore.handoffPath(id);
      if (!fs.existsSync(file)) {
        return json(res, 404, { error: 'handoff_missing', reviewId: id });
      }
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(fs.readFileSync(file, 'utf8'));
      return;
    }
    // GET /api/reviews/:id/folder — the record directory (UI shows it)
    if (segs.length === 4 && segs[3] === 'folder' && method === 'GET') {
      return json(res, 200, { folder: reviewStore.dirFor(id) });
    }
    // POST /api/reviews/:id/open — reveal the folder in the OS file manager
    if (segs.length === 4 && segs[3] === 'open' && method === 'POST') {
      try {
        openFolder(reviewStore.dirFor(id));
        return json(res, 200, { ok: true, folder: reviewStore.dirFor(id) });
      } catch (err) {
        return json(res, 500, { error: 'open_folder_failed', message: err instanceof Error ? err.message : String(err) });
      }
    }

    return json(res, 404, { error: 'not_found' });
  }

  /**
   * /api/goal* — Goal/Loop seam (065): persistent task queue + iteration replay +
   * one real run per task + 066 run control (pause/resume/budget).
   */
  async function handleGoal(
    method: string,
    segs: string[],
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    // /api/goal/tasks
    if (segs.length === 3 && segs[2] === 'tasks') {
      if (method === 'GET') {
        const q = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`).searchParams;
        const tasks = goalSeam.listTasks({
          projectRoot: q.get('projectRoot') ?? undefined,
          status: (q.get('status') as GoalTaskStatus | null) ?? undefined,
        });
        return json(res, 200, { tasks });
      }
      if (method === 'POST') {
        const body = (await readJsonBody(req)) as { projectRoot?: string; goal?: string; acceptance?: string[]; tasks?: TeamDagTask[] } | null;
        if (!body || typeof body.goal !== 'string' || body.goal.trim() === '') {
          return json(res, 400, { error: 'missing_goal' });
        }
        if (!body.projectRoot || typeof body.projectRoot !== 'string') {
          return json(res, 400, { error: 'missing_projectRoot' });
        }
        try {
          const task = goalSeam.enqueue({
            projectRoot: body.projectRoot,
            goal: body.goal,
            acceptance: Array.isArray(body.acceptance) ? body.acceptance : undefined,
          });
          return json(res, 201, { task });
        } catch (err) {
          return json(res, 400, { error: 'goal_enqueue_failed', message: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    // /api/goal/tasks/:id
    if (segs.length === 4 && segs[2] === 'tasks') {
      const id = segs[3] ?? '';
      if (method === 'GET') {
        const task = goalSeam.getTask(id);
        if (!task) return json(res, 404, { error: 'goal_task_not_found', taskId: id });
        return json(res, 200, { task });
      }
      // POST /api/goal/tasks/:id — no generic POST; actions live at /:id/run|pause|resume|budget
    }

    // /api/goal/tasks/:id/run — trigger one bounded task run (§11.1)
    if (segs.length === 5 && segs[2] === 'tasks' && segs[4] === 'run' && method === 'POST') {
      const id = segs[3] ?? '';
      if (!goalSeam.getTask(id)) return json(res, 404, { error: 'goal_task_not_found', taskId: id });
      try {
        const result: GoalRunResult = await goalSeam.runTask(id, {
          providers: teamProviders,
          policyArtifacts,
          developerProviderId: 'mock',
          developerModel: 'mock-pro',
          reviewerProviderId: 'mock',
          reviewerModel: 'mock-review',
        });
        notify(result.outcome === 'error' ? 'Vessel goal failed' : 'Vessel goal finished', `Goal ${id}: ${result.outcome}`);
        // BRIEF-21: outcome='error' is a structural failure (runTask's own catch —
        // the run crashed and the task was requeued), not a domain verdict like
        // not_met. Reporting both as 200 makes them indistinguishable to
        // status-code-only clients. Body shape (and every field's meaning) is
        // unchanged; only the status differs.
        return json(res, goalRunStatusFor(result.outcome), { result });
      } catch (err) {
        return json(res, 400, { error: 'goal_run_failed', message: err instanceof Error ? err.message : String(err) });
      }
    }

    // /api/goal/tasks/:id/iterations — replay the per-task iteration log
    if (segs.length === 5 && segs[2] === 'tasks' && segs[4] === 'iterations' && method === 'GET') {
      const id = segs[3] ?? '';
      if (!goalSeam.getTask(id)) return json(res, 404, { error: 'goal_task_not_found', taskId: id });
      const iterations = goalSeam.replay(id);
      const record = goalSeam.taskRecord(id);
      return json(res, 200, { taskId: id, iterations, record });
    }

    // ---------------- task 066: run control (pause/resume/budget) ----------------
    // POST /api/goal/tasks/:id/pause — suspend a live run (not abort)
    if (segs.length === 5 && segs[2] === 'tasks' && segs[4] === 'pause' && method === 'POST') {
      const id = segs[3] ?? '';
      if (!goalSeam.getTask(id)) return json(res, 404, { error: 'goal_task_not_found', taskId: id });
      try {
        const task = goalSeam.pauseTask(id);
        return json(res, 200, { task, paused: true });
      } catch (err) {
        return json(res, 400, { error: 'goal_pause_failed', message: err instanceof Error ? err.message : String(err) });
      }
    }
    // POST /api/goal/tasks/:id/resume — continue a paused run from the same boundary
    if (segs.length === 5 && segs[2] === 'tasks' && segs[4] === 'resume' && method === 'POST') {
      const id = segs[3] ?? '';
      if (!goalSeam.getTask(id)) return json(res, 404, { error: 'goal_task_not_found', taskId: id });
      try {
        const task = goalSeam.resumeTask(id);
        return json(res, 200, { task, paused: false });
      } catch (err) {
        return json(res, 400, { error: 'goal_resume_failed', message: err instanceof Error ? err.message : String(err) });
      }
    }
    // GET /api/goal/tasks/:id/budget — query maxIterations/maxRetries + paused/exhausted
    if (segs.length === 5 && segs[2] === 'tasks' && segs[4] === 'budget' && method === 'GET') {
      const id = segs[3] ?? '';
      const info = goalSeam.getTaskBudget(id);
      if (!info) return json(res, 404, { error: 'goal_task_not_found', taskId: id });
      return json(res, 200, { taskId: id, budget: info.budget, paused: info.paused });
    }
    // POST /api/goal/tasks/:id/budget — set maxIterations/maxRetries (Goal/Loop relax)
    if (segs.length === 5 && segs[2] === 'tasks' && segs[4] === 'budget' && method === 'POST') {
      const id = segs[3] ?? '';
      if (!goalSeam.getTask(id)) return json(res, 404, { error: 'goal_task_not_found', taskId: id });
      const body = (await readJsonBody(req)) as { maxIterations?: unknown; maxRetries?: unknown } | null;
      const asInt = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
      try {
        const budget = goalSeam.setTaskBudget(id, {
          maxIterations: asInt(body?.maxIterations),
          maxRetries: asInt(body?.maxRetries),
        });
        return json(res, 200, { taskId: id, budget });
      } catch (err) {
        return json(res, 400, { error: 'goal_budget_failed', message: err instanceof Error ? err.message : String(err) });
      }
    }

    return json(res, 404, { error: 'not_found' });
  }

  function streamEvents(ctl: SessionController, req: http.IncomingMessage, res: http.ServerResponse): void {
    subagentStreams.add(res);
    res.once('close', () => subagentStreams.delete(res));
    res.writeHead(200, SSE_HEADERS);
    res.write(`data: ${JSON.stringify({ type: 'ping', ts: Date.now() })}\n\n`);

    // Emit a single SSE data frame from a projection delta.
    const sse = (type: string, delta: unknown) => {
      // best-effort; responder may already be closed
      res.write(`data: ${JSON.stringify({ type, delta, ts: Date.now() })}\n\n`);
    };
    // Named events also carry the existing {type, delta, ts} envelope.
    const detachWidgets = widgets.subscribe(ctl.sessionId, (type, delta) => {
      res.write(`event: ${type}\ndata: ${JSON.stringify({ type, delta, ts: Date.now() })}\n\n`);
      if (type === 'widget_block') res.write(`event: widget\ndata: ${JSON.stringify({ type: 'widget', delta, ts: Date.now() })}\n\n`);
    });
    const detachInspector = inspector.subscribe(ctl.sessionId, observation => sse('inspector', observation));

    // task 060: forward team-run snapshots to this connection (session-scoped).
    const teamSend = (kind: TeamEventKind, state: unknown) => sse('team', { kind, state });
    let senders = teamSenders.get(ctl.sessionId);
    if (!senders) {
      senders = new Set();
      teamSenders.set(ctl.sessionId, senders);
    }
    senders.add(teamSend);
    const detachSubagents = subagentSeam.subscribe((type, delta) => sse(type, delta));
    const current = teamStates.get(ctl.sessionId)?.run?.snapshot?.();
    if (current) teamSend('start', current);

    const forwards = new Map<string, () => void>();
    const modelStartedAt = new Map<string, number>();
    const reasoning = new ReasoningStream(delta => sse('thinking', delta));
    const modelCallKey = (payload: unknown): string | undefined => {
      if (!payload || typeof payload !== 'object') return undefined;
      const p = payload as { turnId?: unknown; step?: unknown };
      return typeof p.turnId === 'string' && typeof p.step === 'number' ? `${p.turnId}:${p.step}` : undefined;
    };
    const forward = (key: string, type: string, fn: Listener): void => {
      const off = ctl.bus.on(type, (payload, ctx) => fn(payload, ctx), `local-server:sse:${key}`);
      forwards.set(key, off);
    };

    // Model-call boundaries feed per-call latency and the opt-in thinking view.
    forward('model-start', 'before_model', (payload) => {
      const key = modelCallKey(payload);
      if (key) modelStartedAt.set(key, Date.now());
      reasoning.before(payload);
    });
    forward('thinking-start', 'model_stream_start', payload => reasoning.start(payload));
    forward('thinking-delta', 'model_stream_delta', payload => reasoning.delta(payload));
    forward('thinking-end', 'model_stream_end', payload => reasoning.end(payload));
    forward('thinking-after', 'after_model', payload => reasoning.after(payload));
    forward('thinking-turn-end', 'after_turn', () => { reasoning.finish(); modelStartedAt.clear(); });

    // after_model → conversation delta (assistant text / tool-call summary)
    forward('conversation', 'after_model', (payload) => {
      const p = payload as { response?: { content?: string; toolCalls?: { name?: string }[] } };
      const response = p.response;
      if (!response) return;
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const tc of response.toolCalls) {
          sse('conversation', { role: 'assistant', toolName: tc.name });
        }
      } else if (typeof response.content === 'string' && response.content !== '') {
        sse('conversation', { role: 'assistant', text: response.content });
      }
    });

    // after_model usage → usage delta (incremental tokens from this call).
    // task 107: carry cacheWrite (cache_creation) tokens alongside cacheRead so
    // the web UsageBar can show both cache 读/写分项 (099 upstream pipes
    // cacheCreationTokens through after_model usage already).
    forward('usage', 'after_model', (payload) => {
      const p = payload as {
        turnId?: string;
        step?: number;
        usage?: {
          inputTokens?: number;
          outputTokens?: number;
          reasoningTokens?: number;
          cacheMetrics?: CacheUsageMetrics;
          cacheReadTokens?: number;
          cacheCreationTokens?: number;
        };
      };
      const usage = p.usage;
      if (!usage) return;
      const key = modelCallKey(p);
      const started = key ? modelStartedAt.get(key) : undefined;
      if (key) modelStartedAt.delete(key);
      const totals = ctl.projections.usage.usage();
      const cache = usage.cacheMetrics ? priceCacheMetrics(usage.cacheMetrics, ctl.projections.usage.pricing()) : undefined;
      sse('usage', {
        cacheMetrics: cache,
        ...ctl.projections.usage.costForUsage(usage),
        summary: totals,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        reasoningTokens: usage.reasoningTokens,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheCreationTokens: usage.cacheCreationTokens ?? 0,
        latencyMs: started === undefined ? undefined : Math.max(0, Date.now() - started),
        calls: ctl.projections.usage.usage().calls,
      });
    });

    // Application execution observation follows the policy waterfall's allow verdict.
    forward('tool:start', 'application/tool_started', (payload) => {
      const p = payload as { toolCallId?: string; toolName?: string; arguments?: Record<string, unknown> };
      sse('tool', { toolCallId: p.toolCallId, toolName: p.toolName, status: 'started', argsSummary: summarizeArgs(p.arguments) });
    });

    // after_tool → tool delta (terminal status)
    forward('tool:end', 'after_tool', (payload) => {
      const p = payload as { toolCallId: string; toolName?: string; result?: { error?: { errorClass?: string } } };
      let status = 'done';
      if (p.result?.error) status = p.result.error.errorClass === 'DENIED' ? 'denied' : 'error';
      const sandbox = ctl.projections.toolActivity.activity(p.toolCallId)?.sandbox;
      sse('tool', { toolCallId: p.toolCallId, toolName: p.toolName, status, ...(sandbox ? { sandbox } : {}) });
    });

    // policy_decision (deny) → policy delta
    forward('policy', 'policy_decision', (payload) => {
      const p = payload as { verdict?: string; toolName?: string; ruleRef?: string; reason?: string };
      if (p.verdict !== 'deny') return;
      sse('policy', { toolName: p.toolName, rule: p.ruleRef, reason: p.reason });
    });

    const heartbeat = setInterval(() => {
      res.write(`data: ${JSON.stringify({ type: 'ping', ts: Date.now() })}\n\n`);
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      detachSubagents();
      detachWidgets();
      detachInspector();
      for (const off of forwards.values()) off();
      senders.delete(teamSend);
      if (senders.size === 0) teamSenders.delete(ctl.sessionId);
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  }

  function suggestNotFound(id: string): { error: string; sessionId: string } {
    return { error: 'session_not_found', sessionId: id };
  }

  function serveStatic(pathname: string, method: string, res: http.ServerResponse): void {
    const file = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    // prevent path traversal
    const targetPath = path.resolve(staticDir, file);
    let target = targetPath;
    if (!target.startsWith(staticDir + path.sep) && target !== staticDir) {
      return json(res, 403, { error: 'forbidden' });
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      // Concrete asset names take precedence over HTML Accept headers.
      if (method !== 'GET' || path.extname(pathname)) return json(res, 404, { error: 'not_found' });
      target = path.join(staticDir, 'index.html');
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return json(res, 404, { error: 'not_found' });
    }
    const ext = path.extname(target).toLowerCase();
    const mime =
      ext === '.html' ? 'text/html; charset=utf-8'
      : ext === '.js' ? 'text/javascript; charset=utf-8'
      : ext === '.css' ? 'text/css; charset=utf-8'
      : ext === '.json' ? 'application/json'
      : ext === '.svg' ? 'image/svg+xml'
      : ext === '.png' ? 'image/png'
      : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(target).pipe(res);
  }

  const vesselServer: VesselServer = {
    widgets,
    taskTrees,
    port,
    async listen() {
      server.listen(port, opts.host ?? '127.0.0.1');
      await once(server, 'listening');
      const addr = server.address();
      (vesselServer as { port: number }).port = typeof addr === 'object' && addr ? addr.port : port;
      if (opts.mesh) {
        const advertised = new URL(opts.mesh.local.endpoint);
        if (advertised.port === '0') { advertised.port = String(vesselServer.port); opts.mesh.local.endpoint = advertised.origin; }
        opts.mesh.startHeartbeat();
      }
      return vesselServer;
    },
    async close() {
      inspector.close();
      widgets.close();
      await opts.mesh?.close();
      for (const ctl of controllers.values()) ctl.interrupt();
      for (const res of subagentStreams) res.end();
      for (const off of subagentDetaches) off();
      for (const ctl of controllers.values()) {
        try {
          await ctl.close();
        } catch {
          // best-effort close of a live session
        }
      }
      controllers.clear();
      for (const st of teamStates.values()) {
        st.run?.close();
      }
      await teamStages.close();
      await sessionRegistry.closeIndex();
      teamStates.clear();
      teamSenders.clear();
      if (server.listening) {
        server.close();
        await once(server, 'close');
      }
    },
  };

  return vesselServer;
}

export { VERSION };
export type { SessionMeta };
