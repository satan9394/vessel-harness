/**
 * Vessel Local Web — Server-Sent Events consumer (task 042).
 *
 * A thin, dependency-free wrapper around the browser's native EventSource.
 * The local server (`apps/local-server`) streams deltas from its projections
 * over `GET /api/sessions/:id/events` as:
 *
 *   data: {"type":"conversation"|"tool"|"usage"|"policy","delta":{...},"ts":...}
 *   data: {"type":"ping","ts":...}
 *
 * EventSource reconnects automatically on network drop (heartbeats every 15s
 * keep the connection alive); no manual retry logic is needed here.
 */

/** One incoming SSE frame after JSON parsing. */
export interface SseFrame {
  type: string;
  delta?: unknown;
  ts?: number;
}

// ---- Delta shapes (mirror packages/application projections + server SSE) ----

/** conversation delta — a user prompt or an assistant text / tool-call marker. */
export interface ConversationDelta {
  role: 'user' | 'assistant';
  text?: string;
  toolName?: string;
  ts: number;
}

/** tool delta — lifecycle of a single tool dispatch. */
export interface ToolDelta {
  toolName?: string;
  status: 'started' | 'done' | 'denied' | 'error';
  argsSummary?: string;
  durationMs?: number;
  ts: number;
}

/** usage delta — incremental tokens for this model call (calls is cumulative). */
export interface UsageDelta {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  /** cache 写入（cache_creation）tokens，task 107；缺省未上报时为 undefined */
  cacheCreationTokens?: number;
  calls?: number;
  ts: number;
}

/** policy delta — a deny decision from the policy runtime. */
export interface PolicyDelta {
  toolName?: string;
  rule?: string;
  reason?: string;
  ts: number;
}

import type { TeamRunState } from './team';

/**
 * team delta — one snapshot frame of the session's team run (task 060). The
 * local server pushes the whole TeamProjection state after each team/phase/turn
 * event so the panel can render live without a delta-reconciliation protocol.
 */
export interface TeamDelta {
  kind: 'start' | 'phase' | 'end' | 'turn' | 'tool' | 'delegate';
  state: TeamRunState | null;
  ts: number;
}

export interface StreamHandlers {
  onConversation?: (delta: ConversationDelta) => void;
  onTool?: (delta: ToolDelta) => void;
  onUsage?: (delta: UsageDelta) => void;
  onPolicy?: (delta: PolicyDelta) => void;
  /** team run snapshot frames (task 060) */
  onTeam?: (delta: TeamDelta) => void;
  /** called for every well-formed frame (default handlers above are the main path). */
  onEvent?: (frame: SseFrame) => void;
  /** schema-validation / parse failures; non-fatal. */
  onError?: (err: unknown) => void;
}

export interface EventStream {
  close: () => void;
}

/**
 * Open an EventSource against `url` and dispatch each data frame by its `type`.
 * Returns { close } so callers can tear the stream down (unmount / session switch).
 */
export function createEventStream(url: string, handlers: StreamHandlers = {}): EventStream {
  let source: EventSource;
  try {
    source = new EventSource(url);
  } catch (err) {
    // EventSource constructor can throw in odd environments; surface it.
    handlers.onError?.(err);
    return { close: () => {} };
  }

  source.onmessage = (ev: MessageEvent) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(ev.data as string);
    } catch (err) {
      handlers.onError?.(err);
      return;
    }
    const frame = parsed as SseFrame;
    if (!frame || typeof frame.type !== 'string') {
      handlers.onError?.(new Error('malformed SSE frame'));
      return;
    }
    handlers.onEvent?.(frame);
    const delta = (frame.delta ?? {}) as Record<string, unknown>;
    const ts = typeof frame.ts === 'number' ? frame.ts : Date.now();
    switch (frame.type) {
      case 'conversation':
        handlers.onConversation?.({ ...delta, ts } as unknown as ConversationDelta);
        break;
      case 'tool':
        handlers.onTool?.({ ...delta, ts } as unknown as ToolDelta);
        break;
      case 'usage':
        handlers.onUsage?.({ ...delta, ts } as unknown as UsageDelta);
        break;
      case 'policy':
        handlers.onPolicy?.({ ...delta, ts } as unknown as PolicyDelta);
        break;
      case 'team':
        handlers.onTeam?.({ ...delta, ts } as unknown as TeamDelta);
        break;
      default:
        // unknown frame types (e.g. 'ping') are ignored unless the caller wants them.
        break;
    }
  };

  return {
    close() {
      source.close();
    },
  };
}