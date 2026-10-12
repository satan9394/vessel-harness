import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../api';
import { ApiError, failureMessage } from '../api';
import { createEventStream, type ConversationDelta, type ThinkingDelta, type ToolDelta, type UsageDelta } from '../sse';
import ModelSelector from './ModelSelector';
import MessageList, { upsertWidget, resolveWidget, type ChatItem } from './MessageList';
import UsageBar, { applyUsageDelta, usageCallCost, emptyUsage, type UsageTotals } from './UsageBar';
import TalkingMetricsBar, { type TalkingMetrics } from './TalkingMetricsBar';
import { useI18n } from './LanguageProvider';
import SandboxAuditHistory from './SandboxAuditHistory';
import { DualSurfaceLayout, appendCacheObservation, type InspectorTab } from './layout/DualSurfaceLayout';
import type { CacheUsageMetrics } from '../cacheUsage';
import type { InspectorObservation } from '../inspector';
import type { ImpactRadarWidget } from '@vessel/shared';
import type { AttentionManager } from '../utils/attentionManager';

interface Props {
  providerRevision?: number;
  onConfigureModels?: () => void;
  attention?: AttentionManager;
  sessionId: string;
  api: ApiClient;
  onSessionUpdated?: () => void;
  viewRequest?: { action: 'clear' | 'collapse' | 'expand' | 'export' | InspectorTab; serial: number };
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `${Date.now()}-${counter}`;
}

function conversationItem(delta: ConversationDelta): ChatItem {
  return { id: nextId(), kind: 'message', msg: delta };
}

/**
 * Conversation main view for a selected session: message list + input, plus a
 * live SSE stream over /api/sessions/:id/events that appends assistant text,
 * tool activity, usage and policy deltas as they happen.
 */
export default function ConversationView({ sessionId, api, onSessionUpdated, viewRequest, attention, providerRevision, onConfigureModels }: Props) {
  const { t } = useI18n();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [usage, setUsage] = useState<UsageTotals>(emptyUsage);
  const [turnMetrics, setTurnMetrics] = useState<TalkingMetrics>({});
  const [cacheHistory, setCacheHistory] = useState<CacheUsageMetrics[]>([]);
  const [observation, setObservation] = useState<InspectorObservation>();
  const [input, setInput] = useState('');
  const [modelBusy, setModelBusy] = useState(false);
  const [busy, setBusy] = useState(false); // a turn is in flight
  const [error, setError] = useState<string | null>(null);
  const [serverDown, setServerDown] = useState(false);
  const [auditRevision, setAuditRevision] = useState(0);
  const pendingTool = useRef<Record<string, ToolDelta>>({});
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeSession = useRef(sessionId);
  const sessionGeneration = useRef(0);
  activeSession.current = sessionId;
  useEffect(() => {
    if (viewRequest?.action === 'clear') setItems([]);
    if (viewRequest?.action === 'export') {
      const url = URL.createObjectURL(new Blob([JSON.stringify({ sessionId, items }, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `vessel-${sessionId}-visible.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }, [viewRequest]);
  const respondWidget = useCallback(async (widgetId: string, optionId: string) => {
    const generation = sessionGeneration.current;
    await api.respondWidget(sessionId, widgetId, optionId);
    if (activeSession.current === sessionId && sessionGeneration.current === generation) {
      attention?.resolvedWidget(sessionId, widgetId);
      attention?.clear();
      setItems(previous => resolveWidget(previous, { widgetId, selectedOptionId: optionId, resolvedAt: new Date().toISOString() }));
    }
  }, [api, sessionId, attention]);

  const appendMessage = useCallback((delta: ConversationDelta) => {
    setItems((prev) => [...prev, conversationItem(delta)]);
  }, []);

  const onTool = useCallback((delta: ToolDelta) => {
    if (delta.sandbox) setAuditRevision(value => value + 1);
    setItems((prev) => {
      const next = [...prev];
      const key = delta.toolCallId ?? delta.toolName ?? '?';
      if (delta.status === 'started') {
        pendingTool.current[key] = delta;
        next.push({ id: nextId(), kind: 'tool', tool: delta });
      } else {
        // replace the matching started row (by toolName) with its terminal delta
        const idx = next.findIndex(
          (it) => it.kind === 'tool' && (it.tool?.toolCallId ?? it.tool?.toolName ?? '?') === key && it.tool?.status === 'started',
        );
        const start = pendingTool.current[key];
        const closed: ToolDelta = {
          ...(start ?? {}),
          ...delta,
          durationMs: typeof delta.durationMs === 'number' ? delta.durationMs : durationFrom(start, delta),
        };
        delete pendingTool.current[key];
        if (idx >= 0) next[idx] = { id: nextId(), kind: 'tool', tool: closed };
        else next.push({ id: nextId(), kind: 'tool', tool: closed });
      }
      return next;
    });
  }, []);

  const onUsage = useCallback((delta: UsageDelta) => {
    if (delta.cacheMetrics) setCacheHistory(history => appendCacheObservation(history, delta.cacheMetrics!));
    setUsage((prev) => applyUsageDelta(prev, delta));
    const deltaCost = usageCallCost(delta);
    setTurnMetrics((prev) => ({
      inputTokens: (prev.inputTokens ?? 0) + (delta.inputTokens ?? 0),
      outputTokens: (prev.outputTokens ?? 0) + (delta.outputTokens ?? 0),
      ...(prev.reasoningTokens !== undefined || delta.reasoningTokens !== undefined
        ? { reasoningTokens: (prev.reasoningTokens ?? 0) + (delta.reasoningTokens ?? 0) }
        : {}),
      cacheReadTokens: (prev.cacheReadTokens ?? 0) + (delta.cacheReadTokens ?? 0),
      ...(prev.latencyMs !== undefined || delta.latencyMs !== undefined
        ? { latencyMs: (prev.latencyMs ?? 0) + (delta.latencyMs ?? 0) }
        : {}),
      costUsd: (prev.costUsd ?? 0) + deltaCost,
      estimated: Boolean(prev.estimated || (delta.estimated ?? true)),
      ...(delta.cacheMetrics ? { cacheMetrics: {
        ...delta.cacheMetrics,
        promptTokens: (prev.cacheMetrics?.promptTokens ?? 0) + delta.cacheMetrics.promptTokens,
        cachedTokens: (prev.cacheMetrics?.cachedTokens ?? 0) + delta.cacheMetrics.cachedTokens,
        creationTokens: (prev.cacheMetrics?.creationTokens ?? 0) + delta.cacheMetrics.creationTokens,
        estimatedSavingsUsd: (prev.cacheMetrics?.estimatedSavingsUsd ?? 0) + delta.cacheMetrics.estimatedSavingsUsd,
        billedHitRate: ((prev.cacheMetrics?.cachedTokens ?? 0) + delta.cacheMetrics.cachedTokens) / Math.max(1, (prev.cacheMetrics?.promptTokens ?? 0) + delta.cacheMetrics.promptTokens),
        estimated: Boolean(prev.cacheMetrics?.estimated || delta.cacheMetrics.estimated),
      } } : {}),
    }));
  }, []);

  const onThinking = useCallback((delta: ThinkingDelta) => {
    setItems(prev => applyThinkingDelta(prev, delta));
  }, []);

  // Open the SSE stream for this session; reset local state per session switch.
  useEffect(() => {
    sessionGeneration.current += 1;
    attention?.clear();
    setItems([]);
    setUsage(emptyUsage);
    setTurnMetrics({});
    setCacheHistory([]);
    setObservation(undefined);
    setBusy(false);
    setError(null);
    setServerDown(false);
    pendingTool.current = {};

    let connected = true;
    const stream = createEventStream(`/api/sessions/${encodeURIComponent(sessionId)}/events`, {
      onConversation: delta => { setItems(previous => finishThinking(previous)); appendMessage(delta); },
      onTool,
      onUsage,
      onThinking: delta => { if (connected && activeSession.current === sessionId) onThinking(delta); },
      onWidget: widget => {
        if (!connected || activeSession.current !== sessionId) return;
        attention?.widget(sessionId, widget);
        setItems(previous => upsertWidget(previous, widget));
      },
      onWidgetResponse: response => {
        if (!connected || activeSession.current !== sessionId) return;
        attention?.resolvedWidget(sessionId, response.widgetId);
        setItems(previous => resolveWidget(previous, response));
      },
      onInspector: setObservation,
      // policy denies surface as tool rows with status 'denied' via onTool.
    });
    return () => { connected = false; sessionGeneration.current += 1; stream.close(); attention?.clear(); };
    // api is stable across mounts; only the session drives reconnects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const send = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const prompt = input.trim();
      if (!prompt || busy || modelBusy) return;
      attention?.unlockAudio();
      setInput('');
      setTurnMetrics({});
      appendMessage({ role: 'user', text: prompt, ts: Date.now() });
      setBusy(true);
      setError(null);
      setServerDown(false);
      const generation = sessionGeneration.current;
      const startedAt = Date.now();
      try {
        const result = await api.runTurn(sessionId, prompt);
        if (activeSession.current !== sessionId || sessionGeneration.current !== generation) return;
        attention?.completed(result.kind, Date.now() - startedAt);
        if (result.kind === 'interrupted') {
          // task 050 minimal feedback: the turn was stopped mid-flight by Stop
          appendMessage({ role: 'assistant', text: t('interrupted'), ts: Date.now() });
        }
      } catch (err) {
        if (activeSession.current !== sessionId || sessionGeneration.current !== generation) return;
        attention?.completed('error', Date.now() - startedAt);
        if (err instanceof ApiError && err.status === 0) {
          setServerDown(true);
          setError(t('serverDown'));
        } else {
          setError(turnErrorText(err));
        }
      } finally {
        if (activeSession.current !== sessionId || sessionGeneration.current !== generation) return;
        setItems(previous => finishThinking(previous));
        setBusy(false);
        void onSessionUpdated?.();
      }
    },
    [api, busy, modelBusy, input, sessionId, appendMessage, onSessionUpdated, t, attention],
  );

  const stop = useCallback(() => {
    // Stop (task 050): ask the server to interrupt the in-flight turn. Best
    // effort — the server answers quickly; ignore failures (turn may end first).
    void api.interruptSession(sessionId).catch(() => undefined);
  }, [api, sessionId]);

  // Keep the newest row scrolled into view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items, busy]);

  return (
    <DualSurfaceLayout tabRequest={viewRequest && !['clear', 'collapse', 'expand', 'export'].includes(viewRequest.action) ? { tab: viewRequest.action as InspectorTab, serial: viewRequest.serial } : undefined} sessionId={sessionId} api={api} cacheHistory={cacheHistory} observation={observation} impacts={items.flatMap(item => item.widget?.kind === 'impact_radar' ? [item.widget as ImpactRadarWidget] : [])} patches={items.flatMap(item => item.widget?.kind === 'diff_inspector' ? [item.widget] : [])}>
    <div className="conversation">
      <header className="conversation-head">
        <span className="dim">{t('uiSession')} {sessionId.slice(0, 8)}</span>
        <ModelSelector key={sessionId} sessionId={sessionId} api={api} providerRevision={providerRevision} busy={busy} onConfigureModels={onConfigureModels} onUpdated={onSessionUpdated} onBusyChange={setModelBusy} />
        <UsageBar usage={usage} />
      </header>
      <div className="message-list-scroll" ref={listRef}>
        {serverDown ? (
          <div className="error-text conversation-empty">{t('serverDown')}</div>
        ) : (
          <MessageList foldRequest={viewRequest && (viewRequest.action === 'collapse' || viewRequest.action === 'expand') ? { collapsed: viewRequest.action === 'collapse', serial: viewRequest.serial } : undefined} items={items} thinking={busy} sessionId={sessionId} onRespond={respondWidget} />
        )}
        {error && !serverDown && <ConversationError text={error} />}
      </div>
      <TalkingMetricsBar metrics={turnMetrics} />
      <SandboxAuditHistory api={api} sessionId={sessionId} revision={auditRevision} />
      <form className="composer" onSubmit={send}>
        <input
          className="input composer-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('inputPlaceholder')}
          disabled={serverDown}
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={busy || modelBusy || !input.trim() || serverDown}>
          {busy ? t('running') : t('send')}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!busy}
          title={t('interruptTitle')}
          onClick={stop}
        >
          {t('stop')}
        </button>
      </form>
    </div>
    </DualSurfaceLayout>
  );
}

function durationFrom(start: ToolDelta | undefined, end: ToolDelta): number | undefined {
  if (!start || typeof start.ts !== 'number' || typeof end.ts !== 'number') return undefined;
  return Math.max(0, end.ts - start.ts);
}

/** Longest reason rendered in the banner (see turnErrorText). */
export const MAX_ERROR_TEXT = 400;

/**
 * Inline failure banner in the message scroll area. Extracted so the rendering
 * can be pinned by a test without a DOM; it is the same element and the same
 * `.error-text .conversation-error` styling the component used inline.
 */
export function ConversationError({ text }: { text: string }) {
  return <div className="error-text conversation-error">{text}</div>;
}

/**
 * Text shown when a turn fails. The server writes the actual reason into the
 * body (`failureMessage`: `finalText` first) — a `kind='error'` turn answers 500
 * with no `message` field at all, so `err.message` alone used to render the bare
 * `HTTP 500` and the reason never reached the user. Kept readable for the
 * banner, which uses the default `white-space: normal` (so newlines collapse
 * anyway) and has no truncation rule of its own: whitespace is flattened and
 * very long reasons are cut at MAX_ERROR_TEXT with a trailing ellipsis.
 */
export function turnErrorText(err: unknown): string {
  const raw =
    err instanceof ApiError
      ? failureMessage(err.body, err.status)
      : err instanceof Error
        ? err.message
        : String(err);
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_ERROR_TEXT ? flat : `${flat.slice(0, MAX_ERROR_TEXT)}…`;
}

/** Reconcile keyed model calls; late usage updates the completed call, not the next one. */
export function applyThinkingDelta(items: ChatItem[], delta: ThinkingDelta): ChatItem[] {
  let index = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]?.kind === 'thinking' && (delta.callId ? items[i]?.thinking?.callId === delta.callId : items[i]?.thinking?.streaming)) { index = i; break; }
  }
  if (delta.phase === 'start') {
    if (index >= 0) return items;
    return [...finishThinking(items, delta.ts), { id: nextId(), kind: 'thinking', thinking: { text: '', streaming: true, startedAt: delta.ts, callId: delta.callId, matchedRules: delta.matchedRules } }];
  }
  if (index < 0) {
    if (delta.phase !== 'delta') return items;
    return [...items, { id: nextId(), kind: 'thinking', thinking: { text: delta.text ?? '', streaming: true, startedAt: delta.ts, callId: delta.callId, matchedRules: delta.matchedRules } }];
  }
  const item = items[index]!;
  const thinking = item.thinking!;
  return items.map((entry, i) => i !== index ? entry : { ...item, thinking: {
    ...thinking,
    ...(delta.phase === 'delta' && thinking.streaming ? { text: thinking.text + (delta.text ?? '') } : {}),
    ...(delta.outputTokens !== undefined ? { outputTokens: delta.outputTokens } : {}),
    ...(delta.modelDurationMs !== undefined ? { modelDurationMs: delta.modelDurationMs } : {}),
    ...(delta.reasoningTokens !== undefined ? { reasoningTokens: delta.reasoningTokens } : {}),
    ...(delta.matchedRules ? { matchedRules: delta.matchedRules } : {}),
    ...(delta.phase === 'end' ? { streaming: false, durationMs: delta.durationMs ?? Math.max(0, delta.ts - (thinking.startedAt ?? delta.ts)) } : {}),
  } });
}
export function finishThinking(items: ChatItem[], now = Date.now()): ChatItem[] {
  return items.map(item => item.thinking?.streaming ? { ...item, thinking: { ...item.thinking, streaming: false, durationMs: Math.max(0, now - (item.thinking.startedAt ?? now)) } } : item);
}
