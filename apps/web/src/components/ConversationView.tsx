import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../api';
import { ApiError, failureMessage } from '../api';
import { createEventStream, type ConversationDelta, type ToolDelta, type UsageDelta } from '../sse';
import MessageList, { type ChatItem } from './MessageList';
import UsageBar, { applyUsageDelta, emptyUsage, type UsageTotals } from './UsageBar';
import { useI18n } from './LanguageProvider';

interface Props {
  sessionId: string;
  api: ApiClient;
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
export default function ConversationView({ sessionId, api }: Props) {
  const { t } = useI18n();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [usage, setUsage] = useState<UsageTotals>(emptyUsage);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false); // a turn is in flight
  const [error, setError] = useState<string | null>(null);
  const [serverDown, setServerDown] = useState(false);
  const pendingTool = useRef<Record<string, ToolDelta>>({});
  const listRef = useRef<HTMLDivElement | null>(null);

  const appendMessage = useCallback((delta: ConversationDelta) => {
    setItems((prev) => [...prev, conversationItem(delta)]);
  }, []);

  const onTool = useCallback((delta: ToolDelta) => {
    setItems((prev) => {
      const next = [...prev];
      const key = delta.toolName ?? '?';
      if (delta.status === 'started') {
        pendingTool.current[key] = delta;
        next.push({ id: nextId(), kind: 'tool', tool: delta });
      } else {
        // replace the matching started row (by toolName) with its terminal delta
        const idx = next.findIndex(
          (it) => it.kind === 'tool' && (it.tool?.toolName ?? '?') === key && it.tool?.status === 'started',
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
    setUsage((prev) => applyUsageDelta(prev, delta));
  }, []);

  // Open the SSE stream for this session; reset local state per session switch.
  useEffect(() => {
    setItems([]);
    setUsage(emptyUsage);
    setBusy(false);
    setError(null);
    setServerDown(false);
    pendingTool.current = {};

    const stream = createEventStream(`/api/sessions/${encodeURIComponent(sessionId)}/events`, {
      onConversation: appendMessage,
      onTool,
      onUsage,
      // policy denies surface as tool rows with status 'denied' via onTool.
    });
    return () => stream.close();
    // api is stable across mounts; only the session drives reconnects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const send = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const prompt = input.trim();
      if (!prompt || busy) return;
      setInput('');
      appendMessage({ role: 'user', text: prompt, ts: Date.now() });
      setBusy(true);
      setError(null);
      setServerDown(false);
      try {
        const result = await api.runTurn(sessionId, prompt);
        if (result.kind === 'interrupted') {
          // task 050 minimal feedback: the turn was stopped mid-flight by Stop
          appendMessage({ role: 'assistant', text: '[interrupted]', ts: Date.now() });
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 0) {
          setServerDown(true);
          setError(t('serverDown'));
        } else {
          setError(turnErrorText(err));
        }
      } finally {
        setBusy(false);
      }
    },
    [api, busy, input, sessionId, appendMessage, t],
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
    <div className="conversation">
      <header className="conversation-head">
        <span className="dim">session {sessionId.slice(0, 8)}</span>
        <UsageBar usage={usage} />
      </header>
      <div className="message-list-scroll" ref={listRef}>
        {serverDown ? (
          <div className="error-text conversation-empty">{t('serverDown')}</div>
        ) : (
          <MessageList items={items} thinking={busy} />
        )}
        {error && !serverDown && <ConversationError text={error} />}
      </div>
      <form className="composer" onSubmit={send}>
        <input
          className="input composer-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('inputPlaceholder')}
          disabled={serverDown}
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim() || serverDown}>
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