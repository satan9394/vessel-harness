import { describe, expect, it } from 'vitest';
import { applyThinkingDelta, finishThinking } from './ConversationView';
import type { ChatItem } from './MessageList';
describe('reasoning conversation lifecycle', () => {
  it('assembles text, folds at end and assigns late measured tokens to the exact completed call', () => {
    let items: ChatItem[] = applyThinkingDelta([], { phase: 'start', callId: 'a', ts: 100 });
    items = applyThinkingDelta(items, { phase: 'delta', callId: 'a', text: 'a', ts: 101 });
    items = applyThinkingDelta(items, { phase: 'end', callId: 'a', durationMs: 500, ts: 600 });
    items = applyThinkingDelta(items, { phase: 'start', callId: 'b', ts: 700 });
    items = applyThinkingDelta(items, { phase: 'usage', callId: 'a', reasoningTokens: 12, ts: 800 });
    expect(items[0].thinking).toMatchObject({ text: 'a', streaming: false, durationMs: 500, reasoningTokens: 12 });
    expect(items[1].thinking).toMatchObject({ text: '', streaming: true });
    expect(items[1].thinking?.reasoningTokens).toBeUndefined();
    items = finishThinking(items, 1000); expect(items[1].thinking).toMatchObject({ streaming: false, durationMs: 300 });
  });
  it('recovers missing start/end, ignores late text and duplicate start without losing content', () => {
    let items = applyThinkingDelta([], { phase: 'delta', callId: 'a', text: 'fallback', ts: 100 });
    expect(applyThinkingDelta(items, { phase: 'start', callId: 'a', ts: 101 })).toBe(items);
    items = applyThinkingDelta(items, { phase: 'start', callId: 'b', ts: 200 });
    expect(items[0].thinking?.streaming).toBe(false);
    items = applyThinkingDelta(items, { phase: 'delta', callId: 'a', text: 'late', ts: 300 });
    expect(items[0].thinking?.text).toBe('fallback');
  });
});
