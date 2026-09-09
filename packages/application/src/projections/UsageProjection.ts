import type { EventBus } from '@vessel/core';
import {
  EMPTY_PRICING_TABLE,
  costBreakdown,
  resolvePrice,
  type CatalogPriceSource,
  type CostBreakdown,
  type PriceResolution,
  type PricingTable,
} from '@vessel/shared';
import type { UsageRecord } from './types.js';

type AfterModelPayload = {
  turnId: string;
  step: number;
  response: unknown;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number };
};

export interface UsageProjectionOptions {
  /** model id used for the price lookup (normalized by @vessel/shared/pricing). */
  model?: string;
  /**
   * 注入的价目表（configs/pricing.json 形状）。缺省 → 空表，查价落到
   * `default` 兜底并把 `estimated` 标为 true（task 086：估算必须显式）。
   */
  pricingTable?: PricingTable;
  /** 目录价源（configs/model-catalog.json）——回退链第二级（task 087）。 */
  catalog?: CatalogPriceSource;
  /** 线协议（protocol 级价）；不传则不参与回退。 */
  protocol?: string;
  /** strict：只用模型专属价目（model/catalog），未收录模型按 0 计价（标 unpriced）。 */
  strict?: boolean;
}

/**
 * UsageProjection — cumulative model token + cost accounting.
 *
 * Source (verified from packages/core/src/agent-loop/AgentLoop.ts): `after_model`
 * is emitted with a `usage` field shaped like `ChatUsage`
 * (`{ inputTokens, outputTokens, cacheReadTokens? }`).
 *
 * 计价（task 087）：与 apps/cli UsageStore / benchmarks 共用
 * `@vessel/shared/pricing` 的 `resolvePrice` —— 同一份归一规则、同一条回退链
 * （model > catalog > protocol > default）、同一套 estimated 语义。本类不再
 * 持有任何硬编码价目或默认价。
 */
export class UsageProjection {
  private readonly model: string;
  private readonly resolution: PriceResolution;
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheCreationTokens = 0;
  private calls = 0;

  constructor(opts: UsageProjectionOptions = {}) {
    this.model = opts.model ?? 'default';
    this.resolution = resolvePrice(
      opts.pricingTable ?? EMPTY_PRICING_TABLE,
      this.model,
      opts.protocol,
      opts.catalog,
      { strict: opts.strict },
    );
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
        this.cacheCreationTokens += usage.cacheCreationTokens ?? 0;
        this.calls += 1;
      },
      'projection:usage',
    );
  }

  /** 本次会话的查价结果（价格 / 来源 / 是否估算）——审计与 UI 展示用。 */
  pricing(): PriceResolution {
    return this.resolution;
  }

  usage(): UsageRecord {
    const input = this.inputTokens;
    const output = this.outputTokens;
    const cache = this.cacheReadTokens;
    const cacheWrite = this.cacheCreationTokens;
    // task 090：与 UsageStore / benchmarks 共用 costBreakdown（四项分算，含 cache 写入）
    const breakdown: CostBreakdown = costBreakdown(this.resolution.price, {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cache,
      cacheCreationTokens: cacheWrite,
    });
    return {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cache,
      cacheCreationTokens: cacheWrite,
      calls: this.calls,
      costUsd: breakdown.totalUsd,
      costBreakdown: breakdown,
      pricingSource: this.resolution.source,
      estimated: this.resolution.estimated,
    };
  }
}
