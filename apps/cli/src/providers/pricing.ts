import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * apps/cli/providers/pricing — load configs/pricing.json (task 017).
 *
 * Per-1M-token USD price lookup with fallback chain:
 *   modelPrices[model] > protocolPrices[protocol] > default.
 * `cah models`-fetched model ids can be registered as modelPrices keys;
 * unknown models fall back to their protocol or the generic default.
 */

export interface TokenPrice {
  input: number;
  output: number;
  cacheRead?: number;
}

export interface PricingTable {
  models: Record<string, TokenPrice>;
  protocols: Record<string, TokenPrice>;
}

export function resolvePrice(table: PricingTable, model: string, protocol?: string): TokenPrice {
  const byModel = table.models[model];
  if (byModel) return byModel;
  const def = table.models.default ?? { input: 0.5, output: 1.5 };
  if (protocol) {
    const byProto = table.protocols[protocol] ?? table.protocols[protocol === 'anthropic' ? 'anthropic' : 'openai-compatible'];
    if (byProto) return byProto;
  }
  return def;
}

/** Load pricing.json from a repo/config root; missing/corrupt → default table. */
export function loadPricing(configRoot = process.cwd()): PricingTable {
  const file = path.join(configRoot, 'configs', 'pricing.json');
  const fallbackModels: Record<string, TokenPrice> = { default: { input: 0.5, output: 1.5, cacheRead: 0.1 } };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      models?: Record<string, TokenPrice>;
      protocols?: Record<string, TokenPrice>;
    };
    return {
      models: raw.models && raw.models.default ? raw.models : { ...fallbackModels, ...(raw.models ?? {}) },
      protocols: raw.protocols ?? {},
    };
  } catch {
    return { models: fallbackModels, protocols: {} };
  }
}
