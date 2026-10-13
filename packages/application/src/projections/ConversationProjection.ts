import type { EventBus } from '@vessel/core';
import type { ConversationMessage } from './types.js';
import type { SessionProjection } from '@vessel/shared';

type BeforeTurnPayload = { turnId: string; input: string };
type AfterModelPayload = {
  turnId: string;
  step: number;
  response: { content: string; toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] };
  usage?: unknown;
};

/**
 * ConversationProjection — user/assistant message stream derived from the bus.
 *
 * Sources (verified from packages/core/src/agent-loop/AgentLoop.ts):
 *  - `before_turn` (waterfall, visited by `bus.on`) → the user prompt
 *  - `after_model` (emit) → assistant text or one tool-call summary per call
 *
 * The listener returns `void` so it never short-circuits the `before_turn`
 * waterfall (the policy/steering listeners own that decision point).
 */
export class ConversationProjection {
  private readonly items: ConversationMessage[] = [];

  constructor(private readonly source?: () => SessionProjection) {}

  attach(bus: EventBus): () => void {
    const offPrompt = bus.on(
      'before_turn',
      (payload) => {
        const p = payload as BeforeTurnPayload;
        if (typeof p.input !== 'string') return;
        this.items.push({ role: 'user', text: p.input, ts: Date.now() });
      },
      'projection:conversation:user',
    );

    const offModel = bus.on(
      'after_model',
      (payload) => {
        const p = payload as AfterModelPayload;
        const response = p.response;
        if (!response) return;
        if (response.toolCalls && response.toolCalls.length > 0) {
          for (const tc of response.toolCalls) {
            this.items.push({ role: 'assistant', toolName: tc.name, ts: Date.now() });
          }
        } else if (typeof response.content === 'string' && response.content !== '') {
          this.items.push({ role: 'assistant', text: response.content, ts: Date.now() });
        }
      },
      'projection:conversation:assistant',
    );

    return () => {
      offPrompt();
      offModel();
    };
  }

  messages(): ConversationMessage[] {
    if (this.source) return this.source().visibleMessages.flatMap<ConversationMessage>(record => {
      const ts = Date.parse(record.ts);
      if (record.type === 'user/message' && (!record.source || record.source === 'user' || record.source === 'steer' || record.source === 'compacted-summary')) return [{ role: 'user', text: record.content, ts }];
      if (record.type === 'assistant/message') return [{ role: 'assistant', text: record.content, ts }];
      if (record.type === 'assistant/attempt') return record.toolCalls.map(call => ({ role: 'assistant', toolName: call.name, ts }));
      return [];
    });
    return this.items;
  }
}
