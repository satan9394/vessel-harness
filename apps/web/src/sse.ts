/**
 * Vessel Local Web — Server-Sent Events consumer (task 042).
 *
 * Native EventSource for foreground servers; header-bearing fetch streams for daemons.
 * The local server (`apps/local-server`) streams deltas from its projections
 * over `GET /api/sessions/:id/events` as:
 *
 *   data: {"type":"conversation"|"tool"|"usage"|"policy","delta":{...},"ts":...}
 *   data: {"type":"ping","ts":...}
 *
 * Both transports reconnect on network drop; daemon streams stop retrying on auth rejection.
 */

import { isMatchedReasoningRule, type MatchedReasoningRule } from '../../../packages/shared/src/reasoning.js';
import { daemonToken } from './auth.js';
// ponytail: root conformance imports this module; its package alias has no subpath support.
import { isWidgetBlock, type WidgetBlock, type WidgetActionResponse } from '../../../packages/shared/src/widgets.js';
import type { SandboxAudit } from './sandboxAudit.js';
import { isInspectorObservation, type InspectorObservation } from './inspector.js';

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
  toolCallId?: string;
  sandbox?: SandboxAudit;
  toolName?: string;
  status: 'started' | 'done' | 'denied' | 'error';
  argsSummary?: string;
  durationMs?: number;
  ts: number;
}

/** usage delta — incremental tokens for this model call (calls is cumulative). */
export interface UsageDelta {
  costUsd?: number;
  estimated?: boolean;
  cacheMetrics?: import('./cacheUsage.js').CacheUsageMetrics;
  summary?: import('./cacheUsage.js').UsageSummary;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  /** cache 写入（cache_creation）tokens，task 107；缺省未上报时为 undefined */
  cacheCreationTokens?: number;
  calls?: number;
  latencyMs?: number;
  ts: number;
}

/** Live reasoning text and lifecycle, projected from existing model-stream events. */
export interface ThinkingDelta {
  phase: 'start' | 'delta' | 'end' | 'usage';
  callId?: string;
  reasoningTokens?: number;
  outputTokens?: number;
  modelDurationMs?: number;
  matchedRules?: MatchedReasoningRule[];
  text?: string;
  durationMs?: number;
  ts: number;
}

/** policy delta — a deny decision from the policy runtime. */
export interface PolicyDelta {
  toolName?: string;
  rule?: string;
  reason?: string;
  ts: number;
}

import type { TeamRunState } from './team.js';

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
  onInspector?: (observation: InspectorObservation) => void;
  onWidget?: (widget: WidgetBlock) => void;
  onWidgetResponse?: (response: WidgetActionResponse) => void;
  /** Native EventSource open/reconnect boundary, for snapshot reconciliation. */
  onOpen?: () => void;
  onConversation?: (delta: ConversationDelta) => void;
  onTool?: (delta: ToolDelta) => void;
  onUsage?: (delta: UsageDelta) => void;
  onThinking?: (delta: ThinkingDelta) => void;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Open an EventSource against `url` and dispatch each data frame by its `type`.
 * Returns { close } so callers can tear the stream down (unmount / session switch).
 */
export function createEventStream(url: string, handlers: StreamHandlers = {}, options: { token?: string; fetch?: typeof globalThis.fetch; reconnectMs?: number } = {}): EventStream {
  let source: { onmessage: ((event: MessageEvent) => void) | null; onopen: ((event: Event) => void) | null; close(): void; addEventListener?: (type: string, listener: (event: MessageEvent) => void) => void };
  let closed = false;
  try {
    const token = options.token ?? daemonToken();
    source = token ? new BearerEventSource(url, token, handlers, options) : new EventSource(url);
  } catch (err) {
    // EventSource constructor can throw in odd environments; surface it.
    handlers.onError?.(err);
    return { close: () => {} };
  }

  source.onmessage = (ev: MessageEvent) => {
    if (closed) return;
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
      case 'inspector':
        if (isInspectorObservation(frame.delta)) handlers.onInspector?.(frame.delta);
        else handlers.onError?.(new Error('malformed inspector observation'));
        break;
      case 'widget':
      case 'widget_block':
      case 'action_request':
        if (isWidgetBlock(frame.delta)) handlers.onWidget?.(frame.delta);
        else handlers.onError?.(new Error('malformed widget frame'));
        break;
      case 'action_response':
        if (isRecord(frame.delta) && typeof delta.widgetId === 'string' && typeof delta.selectedOptionId === 'string' && typeof delta.resolvedAt === 'string' && Number.isFinite(Date.parse(delta.resolvedAt))) handlers.onWidgetResponse?.(delta as unknown as WidgetActionResponse);
        else handlers.onError?.(new Error('malformed widget response'));
        break;
      case 'conversation':
        handlers.onConversation?.({ ...delta, ts } as unknown as ConversationDelta);
        break;
      case 'tool':
        handlers.onTool?.({ ...delta, ts } as unknown as ToolDelta);
        break;
      case 'usage':
        handlers.onUsage?.({ ...delta, ts } as unknown as UsageDelta);
        break;
      case 'thinking':
        if (!isRecord(frame.delta) || !['start', 'delta', 'end', 'usage'].includes(String(frame.delta.phase))) {
          handlers.onError?.(new Error('malformed thinking frame'));
          break;
        }
        if (frame.delta.phase === 'delta' && typeof frame.delta.text !== 'string') {
          handlers.onError?.(new Error('malformed thinking delta'));
          break;
        }
        if (
          frame.delta.durationMs !== undefined &&
          (typeof frame.delta.durationMs !== 'number' || !Number.isFinite(frame.delta.durationMs) || frame.delta.durationMs < 0)
        ) {
          handlers.onError?.(new Error('malformed thinking duration'));
          break;
        }
        if ((frame.delta.outputTokens !== undefined && (typeof frame.delta.outputTokens !== 'number' || !Number.isInteger(frame.delta.outputTokens) || frame.delta.outputTokens < 0)) ||
          (frame.delta.modelDurationMs !== undefined && (typeof frame.delta.modelDurationMs !== 'number' || !Number.isFinite(frame.delta.modelDurationMs) || frame.delta.modelDurationMs < 0)) ||
          (frame.delta.callId !== undefined && typeof frame.delta.callId !== 'string') ||
          (frame.delta.reasoningTokens !== undefined && (typeof frame.delta.reasoningTokens !== 'number' || !Number.isInteger(frame.delta.reasoningTokens) || frame.delta.reasoningTokens < 0)) ||
          (frame.delta.matchedRules !== undefined && (!Array.isArray(frame.delta.matchedRules) || frame.delta.matchedRules.length > 20 || !frame.delta.matchedRules.every(isMatchedReasoningRule)))) {
          handlers.onError?.(new Error('malformed thinking metadata'));
          break;
        }
        handlers.onThinking?.({
          phase: frame.delta.phase as ThinkingDelta['phase'],
          ...(typeof frame.delta.outputTokens === 'number' ? { outputTokens: frame.delta.outputTokens } : {}),
          ...(typeof frame.delta.modelDurationMs === 'number' ? { modelDurationMs: frame.delta.modelDurationMs } : {}),
          ...(typeof frame.delta.callId === 'string' ? { callId: frame.delta.callId } : {}),
          ...(typeof frame.delta.reasoningTokens === 'number' ? { reasoningTokens: frame.delta.reasoningTokens } : {}),
          ...(Array.isArray(frame.delta.matchedRules) ? { matchedRules: frame.delta.matchedRules } : {}),
          ...(typeof frame.delta.text === 'string' ? { text: frame.delta.text } : {}),
          ...(typeof frame.delta.durationMs === 'number' ? { durationMs: frame.delta.durationMs } : {}),
          ts,
        });
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

  source.onopen = () => { if (!closed) handlers.onOpen?.(); };
  // Native EventSource does not send named events to onmessage. Bearer frames
  // already enter the same dispatcher through their JSON envelope.
  for (const name of ['widget', 'widget_block', 'action_request', 'action_response', 'inspector']) source.addEventListener?.(name, source.onmessage);

  return {
    close() {
      closed = true;
      source.close();
    },
  };
}

/** Header-bearing SSE transport with bounded parsing, reconnect and cancellation. */
class BearerEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  private closed = false;
  private readonly abort = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  constructor(private readonly url: string, private readonly token: string, private readonly handlers: StreamHandlers,
    private readonly options: { fetch?: typeof globalThis.fetch; reconnectMs?: number }) { void this.connect(); }
  close(): void { this.closed = true; this.abort.abort(); clearTimeout(this.timer); void this.reader?.cancel().catch(() => {}); }
  private async connect(): Promise<void> {
    let retry = true;
    try {
      const response = await (this.options.fetch ?? globalThis.fetch)(this.url, {
        headers: { Authorization: `Bearer ${this.token}` }, signal: this.abort.signal,
      });
      if (response.status === 401 || response.status === 403) retry = false;
      if (!response.ok || !response.body) throw new Error(`SSE connection failed: HTTP ${response.status}`);
      if (this.closed) { await response.body.cancel(); return; }
      this.onopen?.(new Event('open'));
      const reader = response.body.getReader(); this.reader = reader; const decoder = new TextDecoder(); let pending = '';
      try {
        while (!this.closed) {
          const chunk = await reader.read(); if (chunk.done) break;
          pending += decoder.decode(chunk.value, { stream: true });
          if (pending.length > 1024 * 1024) throw new Error('SSE frame exceeds parsing limit');
          let boundary: RegExpExecArray | null;
          while ((boundary = /\r?\n\r?\n/.exec(pending))) {
            const raw = pending.slice(0, boundary.index); pending = pending.slice(boundary.index + boundary[0].length);
            const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
            if (data && !this.closed) this.onmessage?.(new MessageEvent('message', { data }));
          }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); this.reader = undefined; }
    } catch (error) { if (!this.closed) this.handlers.onError?.(error); }
    if (!this.closed && retry) this.timer = setTimeout(() => void this.connect(), this.options.reconnectMs ?? 1000);
  }
}
