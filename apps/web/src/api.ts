/**
 * Vessel Local Web — API client for the local server (apps/local-server).
 *
 * A thin, dependency-free fetch wrapper. Base URL defaults to the same-origin
 * `/api` namespace (dev mode proxies `/api` to 127.0.0.1:5678 via Vite; the
 * production build is served statically by the local server itself). Inject a
 * custom base for tests or direct cross-origin use.
 */

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
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;