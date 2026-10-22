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
import PlanChecklist, { usePlanTasks, planProgress } from './PlanChecklist';
import ComposerCapsules, { MetersRow, useContextWindow } from './ComposerMeters';
import { DualSurfaceLayout, appendCacheObservation, type InspectorTab } from './layout/DualSurfaceLayout';
import type { CacheUsageMetrics } from '../cacheUsage';
import type { InspectorObservation } from '../inspector';
import type { ImpactRadarWidget } from '@vessel/shared';
import type { AttentionManager } from '../utils/attentionManager';

interface Props {
  initialTask?: { sessionId: string; text: string };
  onInitialTaskConsumed?: () => void;
  sessionTitle?: string;
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

interface ConversationSnapshot {
  items: ChatItem[];
  usage: UsageTotals;
  turnMetrics: TalkingMetrics;
  cacheHistory: CacheUsageMetrics[];
  observation?: InspectorObservation;
  input: string;
  pendingTool: Record<string, ToolDelta>;
}
// Weak API ownership keeps page-local drafts and observations isolated by client.
const snapshotsByClient = new WeakMap<ApiClient, Map<string, ConversationSnapshot>>();

/**
 * Conversation main view for a selected session: message list + input, plus a
 * live SSE stream over /api/sessions/:id/events that appends assistant text,
 * tool activity, usage and policy deltas as they happen.
 */
export default function ConversationView({ sessionId, api, onSessionUpdated, viewRequest, attention, providerRevision, onConfigureModels, initialTask, onInitialTaskConsumed, sessionTitle }: Props) {
  const { t } = useI18n();
  const saved = snapshotsByClient.get(api)?.get(sessionId);
  const [items, setItems] = useState<ChatItem[]>(() => saved?.items ?? []);
  const [usage, setUsage] = useState<UsageTotals>(() => saved?.usage ?? emptyUsage());
  const [turnMetrics, setTurnMetrics] = useState<TalkingMetrics>(() => saved?.turnMetrics ?? {});
  const [cacheHistory, setCacheHistory] = useState<CacheUsageMetrics[]>(() => saved?.cacheHistory ?? []);
  const [observation, setObservation] = useState<InspectorObservation | undefined>(() => saved?.observation);
  const [input, setInput] = useState(() => saved?.input ?? '');
  const [modelBusy, setModelBusy] = useState(false);
  const [busy, setBusy] = useState(false); // a turn is in flight
  const [historyReady, setHistoryReady] = useState(() => Boolean(saved?.items.length) || !api.sessionMessages);
  const hydrationPending = useRef(!historyReady);
  const [error, setError] = useState<string | null>(null);
  const [lengthLimited, setLengthLimited] = useState(false);
  const [serverDown, setServerDown] = useState(false);
  const [auditRevision, setAuditRevision] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const isComposingRef = useRef(false);
  const contextWindow = useContextWindow(api, sessionId, providerRevision);
  const planTasks = usePlanTasks(api, sessionId, items.length);
  const planProgressValue = planProgress(planTasks);
  const setRouteMode = useCallback((mode: 'auto' | 'fast' | 'pro') => { void api.setRouteMode(sessionId, mode).catch(() => { /* best effort: the capsule keeps its previous value */ }); }, [api, sessionId]);
  const pendingTool = useRef<Record<string, ToolDelta>>({});
  const fallbackAssistant = useRef<string | null>(null);
  const latest = useRef({ items, usage, turnMetrics, cacheHistory, observation, input });
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

  useEffect(() => {
    latest.current = { items, usage, turnMetrics, cacheHistory, observation, input };
  }, [items, usage, turnMetrics, cacheHistory, observation, input]);

  // Restore this page's observations and subscribe only to new live deltas.
  useEffect(() => {
    const generation = ++sessionGeneration.current;
    let snapshots = snapshotsByClient.get(api);
    if (!snapshots) { snapshots = new Map(); snapshotsByClient.set(api, snapshots); }
    const saved = snapshots.get(sessionId);
    hydrationPending.current = !saved?.items.length && Boolean(api.sessionMessages);
    setHistoryReady(Boolean(saved?.items.length) || !api.sessionMessages);
    attention?.clear();
    setItems(saved?.items ?? []);
    setUsage(saved?.usage ?? emptyUsage());
    setTurnMetrics(saved?.turnMetrics ?? {});
    setCacheHistory(saved?.cacheHistory ?? []);
    setObservation(saved?.observation);
    setInput(saved?.input ?? '');
    setModelBusy(false);
    setBusy(false);
    setError(null);
    setLengthLimited(false);
    fallbackAssistant.current = null;
    setServerDown(false);
    pendingTool.current = { ...saved?.pendingTool };

    let connected = true;
    const current = () => connected && activeSession.current === sessionId && sessionGeneration.current === generation;
    let streamHydrated = false;
    const hydrate = (transcript: import('../sse').SessionTranscript) => {
      if (!current()) return;
      setItems(transcript.messages);
      setUsage(emptyUsage());
      setTurnMetrics({});
      setCacheHistory([]);
      pendingTool.current = {};
      for (const item of transcript.messages) if (item.tool?.status === 'started') pendingTool.current[item.tool.toolCallId ?? item.tool.toolName ?? '?'] = item.tool;
      for (const delta of transcript.usage) onUsage(delta);
    };
    const needsHistory = !saved?.items.length;
    if (needsHistory && api.sessionMessages) void api.sessionMessages(sessionId).then(transcript => {
      if (!streamHydrated) hydrate(transcript);
    }).catch(err => { if (current() && !streamHydrated) setError(turnErrorText(err)); });
    const stream = createEventStream(`/api/sessions/${encodeURIComponent(sessionId)}/events${needsHistory ? '?hydrate=1' : ''}`, {
      onTranscript: transcript => { if (!current()) return; streamHydrated = true; hydrate(transcript); hydrationPending.current = false; setHistoryReady(true); setError(null); },
      onOpen: () => {
        if (!current()) return;
        setServerDown(false);
        setError(prev => prev === t('serverDown') ? null : prev);
        void onSessionUpdated?.();
      },
      onConversation: delta => {
        if (!current()) return;
        const fallback = delta.role === 'assistant' && delta.text ? fallbackAssistant.current : null;
        if (fallback) fallbackAssistant.current = null;
        setItems(previous => finishThinking(fallback ? previous.filter(item => item.id !== fallback) : previous));
        appendMessage(delta);
      },
      onTool: delta => { if (current()) onTool(delta); },
      onUsage: delta => { if (current()) onUsage(delta); },
      onThinking: delta => { if (current()) onThinking(delta); },
      onWidget: widget => {
        if (!current()) return;
        attention?.widget(sessionId, widget);
        setItems(previous => upsertWidget(previous, widget));
      },
      onWidgetResponse: response => {
        if (!current()) return;
        attention?.resolvedWidget(sessionId, response.widgetId);
        setItems(previous => resolveWidget(previous, response));
      },
      onInspector: delta => { if (current()) setObservation(delta); },
      // policy denies surface as tool rows with status 'denied' via onTool.
    });
    return () => {
      connected = false; sessionGeneration.current += 1; stream.close(); attention?.clear();
      snapshots.set(sessionId, { ...latest.current, items: finishThinking(latest.current.items), pendingTool: { ...pendingTool.current } });
    };
    // api is stable across mounts; only the session drives reconnects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, sessionId]);

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || busy || modelBusy || !historyReady || hydrationPending.current) return;
      attention?.unlockAudio();
      setInput('');
      setTurnMetrics({});
      const userItem = conversationItem({ role: 'user', text: prompt, ts: Date.now() });
      setItems(previous => [...previous, userItem]);
      setBusy(true);
      setError(null);
      setLengthLimited(false);
      fallbackAssistant.current = null;
      setServerDown(false);
      const generation = sessionGeneration.current;
      const startedAt = Date.now();
      try {
        const result = await api.runTurn(sessionId, prompt);
        if (activeSession.current !== sessionId || sessionGeneration.current !== generation) return;
        attention?.completed(result.kind, Date.now() - startedAt);
        if (result.finishReason === 'length') {
          setLengthLimited(true);
          if (result.finalText) {
            const fallback = conversationItem({ role: 'assistant', text: result.finalText, ts: Date.now() });
            fallbackAssistant.current = fallback.id;
            setItems(previous => {
              const turnItems = previous.slice(previous.findIndex(item => item.id === userItem.id) + 1);
              if (turnItems.some(item => item.msg?.role === 'assistant' && item.msg.text)) return previous;
              return [...previous, fallback];
            });
          }
        }
        if (result.kind === 'interrupted') {
          // task 050 minimal feedback: the turn was stopped mid-flight by Stop
          appendMessage({ role: 'assistant', text: t('interrupted'), ts: Date.now() });
        }
      } catch (err) {
        if (activeSession.current !== sessionId || sessionGeneration.current !== generation) return;
        attention?.completed('error', Date.now() - startedAt);
        setInput(prompt);
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
    [api, busy, modelBusy, historyReady, input, sessionId, appendMessage, onSessionUpdated, t, attention],
  );

  const claimedTask = useRef<string | null>(null);
  useEffect(() => {
    if (!initialTask || initialTask.sessionId !== sessionId || claimedTask.current === sessionId || !historyReady) return;
    let cancelled = false;
    // Delay until the stream effect has mounted; StrictMode cleanup cancels its first pass.
    queueMicrotask(() => {
      if (cancelled || claimedTask.current === sessionId || hydrationPending.current) return;
      claimedTask.current = sessionId;
      onInitialTaskConsumed?.();
      void send(initialTask.text);
    });
    return () => { cancelled = true; };
  }, [initialTask, sessionId, send, onInitialTaskConsumed, historyReady]);

  const stop = useCallback(() => {
    // Stop (task 050): ask the server to interrupt the in-flight turn. Best
    // effort — the server answers quickly; ignore failures (turn may end first).
    void api.interruptSession(sessionId).catch(() => undefined);
  }, [api, sessionId]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance <= 120;
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      isAtBottomRef.current = true;
      setIsAtBottom(true);
    }
  }, []);

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (isComposingRef.current || e.nativeEvent.isComposing || (e as unknown as { keyCode?: number }).keyCode === 229) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }, []);

  // Keep the newest row scrolled into view if already at bottom.
  useEffect(() => {
    if (isAtBottomRef.current && listRef.current) {
      listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [items, busy]);

  // When switching sessions, reset scroll state to bottom.
  useEffect(() => {
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [sessionId]);

  return (
    <DualSurfaceLayout tabRequest={viewRequest && !['clear', 'collapse', 'expand', 'export'].includes(viewRequest.action) ? { tab: viewRequest.action as InspectorTab, serial: viewRequest.serial } : undefined} sessionId={sessionId} api={api} cacheHistory={cacheHistory} observation={observation} impacts={items.flatMap(item => item.widget?.kind === 'impact_radar' ? [item.widget as ImpactRadarWidget] : [])} patches={items.flatMap(item => item.widget?.kind === 'diff_inspector' ? [item.widget] : [])}>
    <div className="conversation">
      <header className="conversation-head">
        <span className="dim">{t('uiSession')} · {sessionTitle || t('sessionNew')}</span>
        <ModelSelector key={sessionId} sessionId={sessionId} api={api} providerRevision={providerRevision} busy={busy} onConfigureModels={onConfigureModels} onUpdated={onSessionUpdated} onBusyChange={setModelBusy} />
        <UsageBar usage={usage} />
      </header>
      <div className="message-list-scroll scroll-fade-mask" ref={listRef} onScroll={handleScroll}>
        <PlanChecklist sessionId={sessionId} api={api} revision={items.length} />
        {serverDown ? (
          <div className="error-text conversation-empty">{t('serverDown')}</div>
        ) : (
          <MessageList foldRequest={viewRequest && (viewRequest.action === 'collapse' || viewRequest.action === 'expand') ? { collapsed: viewRequest.action === 'collapse', serial: viewRequest.serial } : undefined} items={items} thinking={busy} sessionId={sessionId} onRespond={respondWidget} />
        )}
        {error && !serverDown && <ConversationError text={error} />}
        {lengthLimited && <div className="dim conversation-error" role="status">{t('responseLengthLimit')}</div>}
      </div>
      {!isAtBottom && (
        <button
          type="button"
          className="scroll-to-bottom-pill"
          onClick={scrollToBottom}
          title={t('scrollToBottom')}
        >
          <span aria-hidden="true">↓</span>
          <span>{t('scrollToBottom')}</span>
        </button>
      )}
      <TalkingMetricsBar metrics={turnMetrics} />
      <SandboxAuditHistory api={api} sessionId={sessionId} revision={auditRevision} />
      <div className="composer-shell">
        <ComposerCapsules api={api} sessionId={sessionId} fallbackMode="auto" onModeChange={mode => setRouteMode(mode)} />
        <form
          className="composer"
          onSubmit={event => {
            event.preventDefault();
            if (isComposingRef.current) return;
            void send(input);
          }}
        >
          <input
            className="input composer-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onKeyDown={handleKeyDown}
            placeholder={t('inputPlaceholder')}
            disabled={serverDown || !historyReady}
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={busy || modelBusy || !historyReady || !input.trim() || serverDown}>
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
        <MetersRow usage={usage} metrics={turnMetrics} contextWindow={contextWindow} plan={planProgressValue} />
      </div>
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
