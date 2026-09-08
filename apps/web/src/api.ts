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
    const body = text ? (JSON.parse(text) as unknown) : undefined;

    if (!res.ok) {
      const message =
        typeof body === 'object' && body !== null && 'message' in body && typeof (body as { message?: unknown }).message === 'string'
          ? (body as { message: string }).message
          : `HTTP ${res.status}`;
      throw new ApiError(message, res.status, body);
    }
    return body as T;
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
    /** GET /api/reviews/:id/handoff.md — the raw artifact text (for Copy Handoff) */
    async handoffMarkdown(id: string): Promise<string> {
      let res: Response;
      try {
        res = await doFetch(`${base}/reviews/${encodeURIComponent(id)}/handoff.md`);
      } catch {
        throw new ApiError('无法连接 local server——请先 vessel serve（127.0.0.1:5678）', 0, undefined);
      }
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new ApiError(`HTTP ${res.status}`, res.status, bodyText);
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