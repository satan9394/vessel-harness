import type { EventBus } from '@vessel/core';
import { DEFAULT_PRICING, type PricingTable, type UsageRecord } from './types.js';

type AfterModelPayload = {
  turnId: string;
  step: number;
  response: unknown;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number };
};

export interface UsageProjectionOptions {
  /** model id to look up in the pricing table (falls back to `default`). */
  model?: string;
  /** optional injected pricing per 1M tokens (USD). Defaults to 0.5/1.5/0.1. */
  pricingTable?: PricingTable;
}

/**
 * UsageProjection — cumulative model token + cost accounting.
 *
 * Source (verified from packages/core/src/agent-loop/AgentLoop.ts): `after_model`
 * is emitted with a `usage` field shaped like `ChatUsage`
 * (`{ inputTokens, outputTokens, cacheReadTokens? }`).
 *
 * Cost is estimated from the injected pricing table (or the task-card default
 * 0.5 / 1.5 / 0.1 per 1M tokens when absent) — @vessel/application has no
 * `loadPricing` helper, so the table is injected rather than read from disk.
 */
export class UsageProjection {
  private readonly model: string;
  private readonly pricing: PricingTable;
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private calls = 0;

  constructor(opts: UsageProjectionOptions = {}) {
    this.model = opts.model ?? 'default';
    this.pricing = opts.pricingTable ?? DEFAULT_PRICING;
  }

  attach(bus: EventBus): () => void {
    return bus.on(
      'after_model',
      (payload) => {
        const p = payload as AfterModelPayload;
        const usage = p.usage;
        if (!usage) return;
        this.inputTokens += usage.inputTokens ?? 0;
        this.outputTokens += usage.outputTokens ?? 0;
        this.cacheReadTokens += usage.cacheReadTokens ?? 0;
        this.calls += 1;
      },
      'projection:usage',
    );
  }

  private rate(key: 'input' | 'output' | 'cacheRead'): number {
    const row =
      this.pricing[this.model] ?? this.pricing.default ?? { input: 0.5, output: 1.5, cacheRead: 0.1 };
    return row?.[key] ?? 0;
  }

  usage(): UsageRecord {
    const input = this.inputTokens;
    const output = this.outputTokens;
    const cache = this.cacheReadTokens;
    const costUsd =
      (input / 1_000_000) * this.rate('input') +
      (output / 1_000_000) * this.rate('output') +
      (cache / 1_000_000) * this.rate('cacheRead');
    return { inputTokens: input, outputTokens: output, cacheReadTokens: cache, calls: this.calls, costUsd };
  }
}