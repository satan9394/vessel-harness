import { localizedValue } from '../i18n';
import { useI18n } from './LanguageProvider';
import { useEffect, useRef, useState } from 'react';
import { hasOpenDialog, isTypingTarget } from './common/CommandPalette';
import type { ConversationDelta, ToolDelta } from '../sse';
import ToolActivityRow from './ToolActivityRow';
import StreamingReasoningBlock from './widgets/StreamingReasoningBlock';
import type { MatchedReasoningRule } from '@vessel/shared';
import type { WidgetBlock, WidgetActionResponse } from '@vessel/shared';
import { WidgetDispatcher } from './widgets/WidgetDispatcher';

/** A renderable conversation item: either a message bubble or a tool activity row. */
export interface ChatItem {
  id: string;
  kind: 'message' | 'tool' | 'thinking' | 'widget';
  widget?: WidgetBlock;
  msg?: ConversationDelta;
  tool?: ToolDelta;
  thinking?: { text: string; durationMs?: number; streaming: boolean; callId?: string; startedAt?: number; reasoningTokens?: number; outputTokens?: number; modelDurationMs?: number; matchedRules?: MatchedReasoningRule[] };
}

interface Props {
  sessionId?: string;
  onRespond?: (widgetId: string, optionId: string) => Promise<void>;
  items: ChatItem[];
  /** assistant is streaming — show a "thinking" indicator at the end. */
  thinking: boolean;
  foldRequest?: { collapsed: boolean; serial: number };
}

/** Scroll container for the conversation, with user/assistant bubbles + tool rows. */
export function upsertWidget(items: ChatItem[], widget: WidgetBlock): ChatItem[] {
  const index = items.findIndex(item => item.kind === 'widget' && item.widget?.id === widget.id);
  if (index < 0) return [...items, { id: `widget:${widget.id}`, kind: 'widget', widget }];
  // Replay must never reopen a terminal action.
  if (items[index].widget?.status !== 'pending' && widget.status === 'pending') return items;
  return items.map((item, i) => i === index ? { ...item, widget } : item);
}
export function resolveWidget(items: ChatItem[], response: WidgetActionResponse): ChatItem[] {
  return items.map(item => item.widget?.kind === 'permission_action' && item.widget.id === response.widgetId && item.widget.payload.options.some(option => option.id === response.selectedOptionId)
    ? { ...item, widget: { ...item.widget, status: 'resolved', resolution: { selectedOptionId: response.selectedOptionId, resolvedAt: response.resolvedAt } } } : item);
}
export default function MessageList({ items, thinking, sessionId = '', onRespond, foldRequest }: Props) {
  const { t } = useI18n();
  const list = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (foldRequest) setCollapsed(new Set(foldRequest.collapsed ? items.map(item => item.id) : []));
  }, [foldRequest?.serial]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const root = list.current;
      if (!root || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || hasOpenDialog()) return;
      const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-message-card]'));
      const active = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[data-message-card]') : null;
      if (event.key === 'Escape' && active && root.contains(active)) {
        event.preventDefault();
        (previousFocus.current?.isConnected ? previousFocus.current : root.closest('.conversation')?.querySelector<HTMLElement>('.composer-input'))?.focus();
        if (root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
        previousFocus.current = null;
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (['j', 'k', 'ArrowDown', 'ArrowUp'].includes(event.key) && !event.shiftKey) {
        const current = active ? cards.indexOf(active) : -1;
        const backwards = event.key === 'k' || event.key === 'ArrowUp';
        const next = current < 0 ? (backwards ? cards.length - 1 : 0) : Math.max(0, Math.min(cards.length - 1, current + (backwards ? -1 : 1)));
        if (!cards[next]) return;
        event.preventDefault();
        if (!active) previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        cards[next].focus(); cards[next].scrollIntoView?.({ block: 'nearest' });
      }
      if (active && document.activeElement === active && event.key === ' ') {
        event.preventDefault();
        const id = active.dataset.messageCard!;
        setCollapsed(previous => new Set(previous.has(id) ? [...previous].filter(value => value !== id) : [...previous, id]));
      }
      // Enter focuses choices before the user explicitly executes one.
      if (active && document.activeElement === active && event.key === 'Enter') {
        const choice = active.querySelector<HTMLButtonElement>('[data-permission-action] button:not(:disabled)');
        if (choice) { event.preventDefault(); choice.focus(); }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [items]);
  return (
    <div ref={list} className="message-list" role="log" aria-live="polite">
      {items.length === 0 && !thinking && (
        <div className="conversation-empty">{t('conversationEmpty')}</div>
      )}
      {items.map((item) => <div key={item.id} className="message-keyboard-card" data-message-card={item.id} tabIndex={0} role="group" aria-label={t('messageCard', { kind: localizedValue(item.kind, t) })} aria-expanded={!collapsed.has(item.id)}>
        {collapsed.has(item.id) && <span className="dim">{t('uiCollapsed')} {localizedValue(item.kind, t)}  {t('uiCardSpaceToExpand')}</span>}
        <div hidden={collapsed.has(item.id)}>{item.kind === 'widget' && item.widget ? (
          <WidgetDispatcher key={item.id} widget={item.widget} sessionId={sessionId} onRespond={onRespond} />
        ) : item.kind === 'tool' && item.tool ? (
          <ToolActivityRow key={item.id} delta={item.tool} />
        ) : item.kind === 'thinking' && item.thinking ? (
          <div key={item.id} className="msg msg-assistant">
            <div className="msg-role">Vessel</div>
            <StreamingReasoningBlock content={item.thinking.text} elapsedMs={item.thinking.durationMs} isStreaming={item.thinking.streaming} reasoningTokens={item.thinking.reasoningTokens} matchedRules={item.thinking.matchedRules} outputTokens={item.thinking.outputTokens} modelDurationMs={item.thinking.modelDurationMs} />
          </div>
        ) : (
          <div key={item.id} className={`msg msg-${item.msg?.role ?? 'assistant'}`}>
            <div className="msg-role">{item.msg?.role === 'user' ? t('uiYou') : 'Vessel'}</div>
            <div className="msg-body">
              {item.msg?.text ?? ''}
              {item.msg?.toolName ? (
                <span className="msg-tool-call">({t('toolCalled', { name: item.msg.toolName })})</span>
              ) : null}
            </div>
          </div>
        )}</div>
      </div>)}
      {thinking && (
        <div className="msg msg-assistant">
          <div className="msg-role">Vessel</div>
          <div className="msg-body msg-thinking">
            <span className="thinking-dot" />{t('thinking')} </div>
        </div>
      )}
    </div>
  );
}
