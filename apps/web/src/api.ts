/**
 * Vessel Local Web — API client for the local server (apps/local-server).
 *
 * A thin, dependency-free fetch wrapper. Base URL defaults to the same-origin
 * `/api` namespace (dev mode proxies `/api` to 127.0.0.1:5678 via Vite; the
 * production build is served statically by the local server itself). Inject a
 * custom base for tests or direct cross-origin use.
 */

// Team/route/review wire shapes (task 060) — see ./team for the full mirrors.
import type { ReviewRecord, RouteMode, RouteState, TeamRunState } from './team';
// Goal/Loop wire shapes (task 065) — see ./goal for the full mirrors.
import type { GoalBudget, GoalIteration, GoalRunResult, GoalTask } from './goal';

export interface ApiOptions {
  /** base URL, default '/api'. May be 'http://127.0.0.1:5678/api'. */
  base?: string;
  /** underlying fetch; defaults to globalThis.fetch (injectable for tests). */
  fetch?: typeof globalThis.fetch;
}

export interface Health {
  ok: boolean;
  version: string;
}

export interface Project {
  root: string;
}

export interface SessionMeta {
  id: string;
  workspaceRoot: string;
  createdAt: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface TurnResult {
  finalText: string;
  kind: string;
  steps: unknown[];
  turnId: string;
}

export interface CreateSessionInput {
  workspaceRoot: string;
  provider?: string;
  model?: string;
  permission?: 'workspace-write' | 'read-only';
}

/** HTTP + JSON errors from the server are surfaced together for the UI. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Body fields that carry a human-readable failure reason, in precedence order.
 *
 * `finalText` comes first because a *turn* that ends in `kind='error'` reports
 * its reason there and the server deliberately sends **no** `message` for it:
 * `apps/local-server` `turnStatusFor()` answers 500 while the body stays
 * `{ finalText, kind, steps, turnId }` (e.g. `[blocked] …` from a BeforeTurn
 * deny, or the denial-limit text `same intent denied 3 times: Write`). Reading
 * only `message` here left the UI with nothing but `HTTP 500`.
 */
const FAILURE_TEXT_FIELDS = ['finalText', 'message', 'error'] as const;

/**
 * Nested locations that carry the same kind of readable reason when the body has
 * none at the top level, in precedence order (absolute paths from the root).
 *
 * `result.error` is the **structural goal-run failure**: `POST
 * /api/goal/tasks/:id/run` answers 500 with its body shape unchanged — still
 * `{ result }`, pinned field-for-field by `apps/local-server/src/
 * goal-run-status.test.ts` (`Object.keys(body)` is exactly `['result']`) — and
 * the reason the run crashed (`'developer run failed: …'`, from `GoalSeam`'s
 * catch) lives on `result.error` only. There is no top-level `finalText` /
 * `message` / `error` on that body, so without this hop the UI showed the bare
 * `HTTP 500`: literally the symptom the top-level `finalText` hop was added to
 * cure, on a sibling route.
 *
 * This is deliberately a list of *known, defined* shapes and not a recursive
 * walk of the body: a generic "any string anywhere" search would render machine
 * fields (`outcome: 'error'`, task ids, queue statuses) as user-facing copy, and
 * would silently change what unrelated payloads display. Surveyed against every
 * non-2xx body this server emits (`apps/local-server/src/server.ts`): all of them
 * are flat `{ error, message }` / `{ error }` except this one `{ result }` body,
 * and no wrapper anywhere else in the API carries a readable reason.
 */
const NESTED_FAILURE_TEXT_PATHS: readonly (readonly string[])[] = [
  ['result', 'error'], // POST /api/goal/tasks/:id/run — outcome='error' ⇒ 500
];

/** Plain JSON object (not null, not an array) — the only shape we read fields off. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value only when it is a non-blank string; never `undefined`/`''`/objects. */
function readableString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Follow `path` from `root` and return the readable string there, if any. */
function readableStringAt(root: Record<string, unknown>, path: readonly string[]): string | undefined {
  let current: unknown = root;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return readableString(current);
}

/**
 * Human-readable reason for a non-2xx response body: the first non-blank string
 * among the top-level `finalText` → `message` → `error`, then the known nested
 * locations in {@link NESTED_FAILURE_TEXT_PATHS} (`result.error`), otherwise
 * `HTTP ${status}`.
 *
 * The top level always wins, verbatim: those three fields are the reason source
 * for the `turns` route (`{ finalText, kind, steps, turnId }`) and for every
 * existing 4xx (`{ error, message }`), so their behaviour — including a blank
 * value being *skipped* — is unchanged; nesting is consulted only when the top
 * level offers nothing readable.
 *
 * Non-string / blank values are skipped at every level, so the result is never
 * `undefined`, `[object Object]` or an empty string, and the body itself is never
 * dumped as user-facing copy. Long reasons are passed through untruncated, which
 * is the existing convention for JSON reason fields (the banner applies its own
 * `MAX_ERROR_TEXT` cut in `turnErrorText`); only non-JSON raw bodies are clipped,
 * by `rawBodyReason`.
 */
export function failureMessage(body: unknown, status: number): string {
  if (isRecord(body)) {
    for (const field of FAILURE_TEXT_FIELDS) {
      const reason = readableString(body[field]);
      if (reason !== undefined) return reason;
    }
    for (const path of NESTED_FAILURE_TEXT_PATHS) {
      const reason = readableStringAt(body, path);
      if (reason !== undefined) return reason;
    }
  }
  return `HTTP ${status}`;
}

/** Longest raw (non-JSON) error-body excerpt folded into an `ApiError` message. */
export const RAW_BODY_REASON_MAX = 200;

/**
 * Readable reason for a **failure** whose body could not be parsed as JSON.
 *
 * `failureMessage` only reads fields off an object, and there is no such object
 * here — the raw text is the whole body (a proxy's `<html>502 Bad Gateway</html>`
 * page, a plain-text `upstream timeout`, an empty body with a BOM). The status
 * is prefixed so it is never lost, and the text is flattened to one line and
 * clipped (the untruncated text stays on `ApiError.body`) so a full HTML page
 * cannot be dumped into the banner or a log line.
 */
function rawBodyReason(text: string, status: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat === '') return `HTTP ${status}`;
  const excerpt = flat.length > RAW_BODY_REASON_MAX ? `${flat.slice(0, RAW_BODY_REASON_MAX)}…` : flat;
  return `HTTP ${status}: ${excerpt}`;
}

/**
 * The `message` + machine-readable `body` of a **non-2xx** response, derived from
 * the response body text in exactly one place for the whole client.
 *
 * Two readers must never fork here again. This is the same reason `request()`
 * carries a non-2xx reason at all (`failureMessage`: top-level
 * `finalText`/`message`/`error`, then the known nested paths, else
 * `HTTP <status>`) and the same reason a body that is *not* JSON still yields
 * something readable (`rawBodyReason`; a proxy's `<html>502 …</html>`, a
 * plain-text `upstream timeout`, a blank body). `handoffMarkdown()` used to skip
 * both — it read the body and threw `new ApiError(\`HTTP ${res.status}\`, …)`,
 * so `404 { error: 'handoff_missing', reviewId }` reached the user as a bare
 * `HTTP 404` while `handoff_missing` was dropped on the floor.
 *
 * The parse must never throw out of here: it runs *before* the caller can build
 * its `ApiError`, so a `SyntaxError` escaping would drop `res.status` and render
 * V8's `Unexpected token '<' …` to the user instead of a real reason or
 * `HTTP <status>`.
 *
 * `body` keeps its existing meaning: the parsed JSON value when the body **is**
 * JSON, otherwise the raw text verbatim and untruncated (`rawBodyReason` only
 * clips the excerpt it folds into the message).
 */
function failureFromRawText(text: string, status: number): { message: string; body: unknown } {
  let body: unknown;
  let bodyIsRawText = false;
  try {
    body = text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    body = text;
    bodyIsRawText = true;
  }
  return {
    message: bodyIsRawText ? rawBodyReason(text, status) : failureMessage(body, status),
    body,
  };
}

export function createApiClient(opts: ApiOptions = {}) {
  const base = (opts.base ?? '/api').replace(/\/+$/, '');
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      });
    } catch (err) {
      // Network-level failure (e.g. local server not running).
      throw new ApiError(
        '无法连接 local server——请先 vessel serve（127.0.0.1:5678）',
        0,
        err,
      );
    }

    const text = await res.text();

    if (!res.ok) {
      // The reason a turn failed lives in the body (see failureMessage); the
      // status alone would show the user nothing but "HTTP 500".
      //
      // The parse must never throw here: a failing intermediary (the Vite dev
      // proxy, a gateway, a crashing upstream) answers with HTML or plain text,
      // and `JSON.parse` raising a SyntaxError on this line would run **before**
      // the status is read — dropping `res.status` and skipping failureMessage
      // entirely, so the UI rendered `Unexpected token '<' …` instead of a real
      // reason or `HTTP <status>`. The raw text *is* the body, so it is kept
      // verbatim, and `rawBodyReason` turns it into the message.
      //
      // Both of those live in `failureFromRawText` now, shared with
      // `handoffMarkdown()` — the sibling reader that used to drop the body it
      // had just read. The inputs and the expressions evaluated are unchanged.
      const failure = failureFromRawText(text, res.status);
      throw new ApiError(failure.message, res.status, failure.body);
    }

    // Success path — unchanged: a well-formed body is returned verbatim, and a
    // 2xx whose body is not JSON still fails loudly, exactly as it always has.
    return (text ? (JSON.parse(text) as unknown) : undefined) as T;
  }

  return {
    /** GET /api/health */
    async health(): Promise<Health> {
      return request<Health>('/health');
    },
    /** GET /api/projects */
    async projects(): Promise<{ projects: Project[] }> {
      return request<{ projects: Project[] }>('/projects');
    },
    /** GET /api/sessions */
    async sessions(): Promise<{ sessions: SessionMeta[] }> {
      return request<{ sessions: SessionMeta[] }>('/sessions');
    },
    /** POST /api/projects/open */
    async openProject(workspaceRoot: string): Promise<{ project: Project }> {
      return request<{ project: Project }>('/projects/open', {
        method: 'POST',
        body: JSON.stringify({ workspaceRoot }),
      });
    },
    /** POST /api/sessions */
    async createSession(input: CreateSessionInput): Promise<{ session: SessionMeta }> {
      return request<{ session: SessionMeta }>('/sessions', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    /** POST /api/sessions/:id/turns */
    async runTurn(id: string, prompt: string): Promise<TurnResult> {
      return request<TurnResult>(`/sessions/${encodeURIComponent(id)}/turns`, {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      });
    },
    /** POST /api/sessions/:id/interrupt — stop the current turn (task 050) */
    async interruptSession(id: string): Promise<{ ok: boolean }> {
      return request<{ ok: boolean }>(`/sessions/${encodeURIComponent(id)}/interrupt`, {
        method: 'POST',
      });
    },

    // ------------------------------------------------------------------
    // Team UI (task 060) — route selection + team run + external review
    // ------------------------------------------------------------------

    /** GET /api/sessions/:id/route — session mode + pin + last resolution */
    async getRoute(id: string): Promise<RouteState> {
      return request<RouteState>(`/sessions/${encodeURIComponent(id)}/route`);
    },
    /** POST /api/sessions/:id/route — set the user's Auto/Fast/Pro choice */
    async setRouteMode(id: string, mode: RouteMode): Promise<RouteState> {
      return request<RouteState>(`/sessions/${encodeURIComponent(id)}/route`, {
        method: 'POST',
        body: JSON.stringify({ mode }),
      });
    },
    /** POST /api/sessions/:id/route/resolve — resolve mode → actual model(s) */
    async resolveRoute(id: string, task?: string): Promise<RouteState> {
      return request<RouteState>(`/sessions/${encodeURIComponent(id)}/route/resolve`, {
        method: 'POST',
        body: JSON.stringify({ task: task ?? '' }),
      });
    },
    /** POST /api/sessions/:id/route/pin — lock the auto resolution for the session */
    async pinRoute(id: string): Promise<RouteState> {
      return request<RouteState>(`/sessions/${encodeURIComponent(id)}/route/pin`, { method: 'POST' });
    },
    /** POST /api/sessions/:id/route/unpin — release the session lock */
    async unpinRoute(id: string): Promise<RouteState> {
      return request<RouteState>(`/sessions/${encodeURIComponent(id)}/route/unpin`, { method: 'POST' });
    },

    /** GET /api/sessions/:id/team-runs/current — latest TeamProjection snapshot */
    async getTeamRun(id: string): Promise<{ team: TeamRunState | null }> {
      return request<{ team: TeamRunState | null }>(`/sessions/${encodeURIComponent(id)}/team-runs/current`);
    },
    /** POST /api/sessions/:id/team-runs — start a team run for this session */
    async startTeamRun(
      id: string,
      input: { task: string; acceptance?: string[]; mode?: RouteMode; roster?: unknown[] },
    ): Promise<{ run: { runId: string; status: string } }> {
      return request<{ run: { runId: string; status: string } }>(`/sessions/${encodeURIComponent(id)}/team-runs`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },

    // ------------------------------------------------------------------
    // Goal/Loop UI (task 065) — task queue + iteration replay + run control
    // ------------------------------------------------------------------

    /** GET /api/goal/tasks — persistent task queue (optional projectRoot filter) */
    async listGoalTasks(projectRoot?: string): Promise<{ tasks: GoalTask[] }> {
      const query = projectRoot ? `?projectRoot=${encodeURIComponent(projectRoot)}` : '';
      return request<{ tasks: GoalTask[] }>(`/goal/tasks${query}`);
    },
    /** POST /api/goal/tasks — enqueue a goal into the project task queue */
    async enqueueGoal(projectRoot: string, goal: string, acceptance?: string[]): Promise<{ task: GoalTask }> {
      return request<{ task: GoalTask }>('/goal/tasks', {
        method: 'POST',
        body: JSON.stringify({ projectRoot, goal, acceptance }),
      });
    },
    /** GET /api/goal/tasks/:id — one task record */
    async getGoalTask(id: string): Promise<{ task: GoalTask }> {
      return request<{ task: GoalTask }>(`/goal/tasks/${encodeURIComponent(id)}`);
    },
    /** GET /api/goal/tasks/:id/iterations — replay the per-task iteration log */
    async goalIterations(id: string): Promise<{ taskId: string; iterations: GoalIteration[] }> {
      return request<{ taskId: string; iterations: GoalIteration[] }>(
        `/goal/tasks/${encodeURIComponent(id)}/iterations`,
      );
    },
    /** POST /api/goal/tasks/:id/run — trigger one bounded real run (§11.1) */
    async runGoalTask(id: string): Promise<{ result: GoalRunResult }> {
      return request<{ result: GoalRunResult }>(`/goal/tasks/${encodeURIComponent(id)}/run`, { method: 'POST' });
    },
    /** POST /api/goal/tasks/:id/pause — suspend a live run (066, not an abort) */
    async pauseGoalTask(id: string): Promise<{ task: GoalTask; paused: boolean }> {
      return request<{ task: GoalTask; paused: boolean }>(`/goal/tasks/${encodeURIComponent(id)}/pause`, {
        method: 'POST',
      });
    },
    /** POST /api/goal/tasks/:id/resume — continue a paused run from the same boundary (066) */
    async resumeGoalTask(id: string): Promise<{ task: GoalTask; paused: boolean }> {
      return request<{ task: GoalTask; paused: boolean }>(`/goal/tasks/${encodeURIComponent(id)}/resume`, {
        method: 'POST',
      });
    },
    /** GET /api/goal/tasks/:id/budget — query maxIterations/maxRetries + paused (066) */
    async getGoalBudget(id: string): Promise<{ taskId: string; budget: GoalBudget; paused: boolean }> {
      return request<{ taskId: string; budget: GoalBudget; paused: boolean }>(
        `/goal/tasks/${encodeURIComponent(id)}/budget`,
      );
    },
    /** POST /api/goal/tasks/:id/budget — set maxIterations/maxRetries (Goal/Loop relax, 066) */
    async setGoalBudget(id: string, budget: Partial<GoalBudget>): Promise<{ taskId: string; budget: GoalBudget }> {
      return request<{ taskId: string; budget: GoalBudget }>(`/goal/tasks/${encodeURIComponent(id)}/budget`, {
        method: 'POST',
        body: JSON.stringify(budget),
      });
    },

    /** GET /api/reviews — external review handoff records (059) */
    async listReviews(): Promise<{ reviews: ReviewRecord[] }> {
      return request<{ reviews: ReviewRecord[] }>('/reviews');
    },
    /** GET /api/reviews/:id — one record */
    async getReview(id: string): Promise<{ review: ReviewRecord }> {
      return request<{ review: ReviewRecord }>(`/reviews/${encodeURIComponent(id)}`);
    },
    /** POST /api/reviews — create a handoff artifact */
    async createReview(input: {
      task: string;
      acceptance?: string[];
      changedFiles?: string[];
      diffSummary?: string;
      testResults?: string;
      workspaceRoot?: string;
    }): Promise<{ review: ReviewRecord }> {
      return request<{ review: ReviewRecord }>('/reviews', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    /** POST /api/reviews/:id/import — import an external review result (paste/file) */
    async importReview(id: string, text: string, source?: 'external' | 'internal'): Promise<{ review: ReviewRecord }> {
      return request<{ review: ReviewRecord }>(`/reviews/${encodeURIComponent(id)}/import`, {
        method: 'POST',
        body: JSON.stringify({ text, source }),
      });
    },
    /**
     * GET /api/reviews/:id/handoff.md — the raw artifact text (for Copy Handoff).
     *
     * The **success** body is markdown, not JSON: it is returned verbatim and is
     * deliberately never parsed (the UI puts it on the clipboard as-is).
     *
     * Only the **failure** body is inspected, through the same
     * `failureFromRawText` chain `request()` uses. The server answers `404
     * { error: 'handoff_missing', reviewId }` (and the catch-all `404
     * { error: 'not_found' }`) with a flat JSON body, and a failing intermediary
     * may answer with HTML or plain text; both now reach the user as a readable
     * reason. The previous `throw new ApiError(\`HTTP ${res.status}\`, …)` read
     * the body into `bodyText` and then ignored it, so `COPY_HANDOFF` on a review
     * whose artifact was never written showed the user exactly `HTTP 404` and
     * `handoff_missing` never appeared.
     */
    async handoffMarkdown(id: string): Promise<string> {
      let res: Response;
      try {
        res = await doFetch(`${base}/reviews/${encodeURIComponent(id)}/handoff.md`);
      } catch {
        throw new ApiError('无法连接 local server——请先 vessel serve（127.0.0.1:5678）', 0, undefined);
      }
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        const failure = failureFromRawText(bodyText, res.status);
        throw new ApiError(failure.message, res.status, failure.body);
      }
      return res.text();
    },
    /** POST /api/reviews/:id/open — ask the local server to open the folder */
    async openReviewFolder(id: string): Promise<{ ok: boolean }> {
      return request<{ ok: boolean }>(`/reviews/${encodeURIComponent(id)}/open`, { method: 'POST' });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;