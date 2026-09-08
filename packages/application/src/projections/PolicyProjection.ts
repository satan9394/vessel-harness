import type { EventBus } from '@vessel/core';
import type { PolicyDenial } from './types.js';

type PolicyDecisionPayload = {
  toolCallId: string;
  toolName: string;
  verdict: 'allow' | 'deny' | 'ask';
  decisionPath?: string[];
  ruleRef?: string;
  reason?: string;
};

/**
 * PolicyProjection — audit of denied tool calls.
 *
 * Source (verified from packages/core/src/agent-loop/AgentLoop.ts): a denial is
 * recorded via `bus.emit('policy_decision', { …, verdict: 'deny', ruleRef, reason })`
 * inside `recordDenial`. We project only `verdict === 'deny'` rows.
 */
export class PolicyProjection {
  private readonly items: PolicyDenial[] = [];

  attach(bus: EventBus): () => void {
    return bus.on(
      'policy_decision',
      (payload) => {
        const p = payload as PolicyDecisionPayload;
        if (p.verdict !== 'deny') return;
        this.items.push({
          toolName: p.toolName,
          rule: p.ruleRef,
          reason: p.reason,
          ts: Date.now(),
        });
      },
      'projection:policy',
    );
  }

  denials(): PolicyDenial[] {
    return this.items;
  }
}