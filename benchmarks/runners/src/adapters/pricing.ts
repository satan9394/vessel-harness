import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolvePrice, type PricingTable, type TokenPrice } from '@vessel/shared';

/**
 * benchmarks/runners/adapters/pricing — 基准侧查价（task 087）。
 *
 * 以前 6 个 adapter（vessel/claude/dsh/opencode/codex/pi）各抄了一份 loadPrices，
 * 各自一套默认价与匹配逻辑 → 口径会漂移。现在统一走 `@vessel/shared/pricing`
 * 的 `resolvePrice`（与 CLI UsageStore / application UsageProjection 同一实现）。
 *
 * 注意：基准只取价目数字（RunResult.metrics.costUsd），不落 estimated/source；
 * 缺价时仍按 default 兜底，保持既有基准数值口径不变。
 */

/** Load configs/pricing.json; missing/corrupt → default-only table. */
export function loadBenchPricing(configRoot: string): PricingTable {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(configRoot, 'configs', 'pricing.json'), 'utf8')) as PricingTable;
    return { models: raw.models ?? {}, protocols: raw.protocols ?? {} };
  } catch {
    return { models: {}, protocols: {} };
  }
}

/** Resolve one model's per-1M-token price with the shared fallback chain. */
export function resolveBenchPrice(configRoot: string, model: string, protocol?: string): TokenPrice {
  return resolvePrice(loadBenchPricing(configRoot), model, protocol).price;
}
