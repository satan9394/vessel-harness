import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { SessionController, SessionRegistry, ProjectRegistry, ReviewHandoffStore } from '@vessel/application';
import type { SessionPermission, ReviewHandoffRecord } from '@vessel/application';
import type { Listener, TurnResult } from '@vessel/core';
import { MockProvider } from '@vessel/llm';
import type { ChatProvider } from '@vessel/shared';
import { loadPolicyArtifacts } from '@vessel/policy';
import type { SessionMeta } from '@vessel/application';
import { DEFAULT_TIER_BINDINGS, RouteSeam, startTeamRun } from './teamSeam.js';
import type { ActiveTeamRun, TeamEventKind } from './teamSeam.js';
import { GoalSeam } from './goalSeam.js';
import type { GoalRunResult, GoalTaskStatus } from './goalSeam.js';

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
  /** port to bind; defaults to 5678. Pass 0 for a random free port (tests). */
  port?: number;
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
}

export interface VesselServer {
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

/** Split a URL pathname into segments (`/api/sessions/abc` → ['api','sessions','abc']). */
function segment(pathname: string): string[] {
  return pathname.split('/').filter((s) => s.length > 0);
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
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
 * - `error` ⇒ **500**：回合**跑完了**（`turn/start` → `turn/end` 配对成立、最终文案在
 *   `finalText` 里），只是以错误收场（熔断 `DenialLimitError` 等，AgentLoop.ts:334-338）。
 *   这是 harness 侧"回合以错误结束"，没有代理/上游可归因 ⇒ 用 500，不用 502/503
 *   （那两个是网关语义：上游无响应/不可用，本仓无此对象）。
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
  const port = opts.port ?? DEFAULT_PORT;
  const staticDir = path.resolve(opts.staticDir ?? DEFAULT_STATIC);
  const projectRegistry = opts.projectRegistry ?? new ProjectRegistry();
  const sessionRegistry = opts.sessionRegistry ?? new SessionRegistry();
  const defaultFactory: SessionFactory = async (input) => {
    const provider = new MockProvider([{ when: /.*/, response: { text: `(mock) ${input.model ?? 'default'}` } }], {
      model: input.model ?? 'default',
    });
    return SessionController.create({
      workspaceRoot: input.workspaceRoot,
      provider,
      model: input.model ?? 'default',
      policySystemPath: DEFAULT_POLICY,
      behaviorIRPath: DEFAULT_BEHAVIOR,
      permission: input.permission ?? 'workspace-write',
      registry: input.registry,
    });
  };
  const sessionFactory = opts.sessionFactory ?? defaultFactory;

  /** live session controllers keyed by session id (owns the run loop). */
  const controllers = new Map<string, SessionController>();

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
    const segs = segment(url.pathname);

    // API namespace
    if (segs[0] === 'api') {
      return handleApi(method, segs, req, res);
    }
    // everything else → static assets
    return serveStatic(url.pathname, res);
  }

  async function handleApi(method: string, segs: string[], req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // GET /api/health
    if (segs.length === 2 && segs[1] === 'health' && method === 'GET') {
      return json(res, 200, { ok: true, version: VERSION });
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

    // GET /api/sessions
    if (segs.length === 2 && segs[1] === 'sessions' && method === 'GET') {
      return json(res, 200, { sessions: sessionRegistry.list() });
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
      if (!body.workspaceRoot) return json(res, 400, { error: 'missing_workspaceRoot' });
      try {
        const ctl = await sessionFactory({
          workspaceRoot: body.workspaceRoot,
          provider: body.provider,
          model: body.model,
          permission: body.permission,
          registry: sessionRegistry,
        });
        controllers.set(ctl.sessionId, ctl);
        const meta = sessionRegistry.get(ctl.sessionId);
        return json(res, 201, { session: (meta ?? ctl.state) });
      } catch (err) {
        return json(res, 400, { error: 'session_create_failed', message: err instanceof Error ? err.message : String(err) });
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
    if (segs.length >= 3 && segs[1] === 'sessions') {
      const id = segs[2] ?? '';
      const sub = segs[3];
      const ctl = controllers.get(id);

      // GET /api/sessions/:id
      if (segs.length === 3 && method === 'GET') {
        if (!ctl) return json(res, 404, suggestNotFound(id));
        return json(res, 200, { session: ctl.state });
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
        const body = (await readJsonBody(req)) as { projectRoot?: string; goal?: string; acceptance?: string[] } | null;
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
        return json(res, 200, { result });
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
    res.writeHead(200, SSE_HEADERS);
    res.write(`data: ${JSON.stringify({ type: 'ping', ts: Date.now() })}\n\n`);

    // Emit a single SSE data frame from a projection delta.
    const sse = (type: string, delta: unknown) => {
      // best-effort; responder may already be closed
      res.write(`data: ${JSON.stringify({ type, delta, ts: Date.now() })}\n\n`);
    };

    // task 060: forward team-run snapshots to this connection (session-scoped).
    const teamSend = (kind: TeamEventKind, state: unknown) => sse('team', { kind, state });
    let senders = teamSenders.get(ctl.sessionId);
    if (!senders) {
      senders = new Set();
      teamSenders.set(ctl.sessionId, senders);
    }
    senders.add(teamSend);
    const current = teamStates.get(ctl.sessionId)?.run?.snapshot?.();
    if (current) teamSend('start', current);

    const forwards = new Map<string, () => void>();
    const forward = (key: string, type: string, fn: Listener): void => {
      const off = ctl.bus.on(type, (payload, ctx) => fn(payload, ctx), `local-server:sse:${key}`);
      forwards.set(key, off);
    };

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
        usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number };
      };
      const usage = p.usage;
      if (!usage) return;
      sse('usage', {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheCreationTokens: usage.cacheCreationTokens ?? 0,
        calls: ctl.projections.usage.usage().calls,
      });
    });

    // before_tool → tool delta (started). Listener returns void (noop) so it
    // never short-circuits the policy waterfall.
    forward('tool:start', 'before_tool', (payload) => {
      const p = payload as { toolName?: string; arguments?: Record<string, unknown> };
      sse('tool', { toolName: p.toolName, status: 'started', argsSummary: summarizeArgs(p.arguments) });
    });

    // after_tool → tool delta (terminal status)
    forward('tool:end', 'after_tool', (payload) => {
      const p = payload as { toolName?: string; result?: { error?: { errorClass?: string } } };
      let status = 'done';
      if (p.result?.error) status = p.result.error.errorClass === 'DENIED' ? 'denied' : 'error';
      sse('tool', { toolName: p.toolName, status });
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

  function serveStatic(pathname: string, res: http.ServerResponse): void {
    let file = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    // prevent path traversal
    const safe = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, '');
    const target = path.join(staticDir, safe);
    if (!target.startsWith(staticDir + path.sep) && target !== staticDir) {
      return json(res, 403, { error: 'forbidden' });
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return json(res, 404, { error: 'not_found' });
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
    port,
    async listen() {
      server.listen(port, '127.0.0.1');
      await once(server, 'listening');
      const addr = server.address();
      (vesselServer as { port: number }).port = typeof addr === 'object' && addr ? addr.port : port;
      return vesselServer;
    },
    async close() {
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