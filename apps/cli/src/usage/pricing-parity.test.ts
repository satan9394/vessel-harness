import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventBus } from '@vessel/core';
import { UsageProjection } from '@vessel/application';
import { UsageStore } from './UsageStore.js';
import { catalogPriceSource, loadModelCatalog } from '../providers/modelCatalog.js';
import { loadPricing, type PricingTable } from '../providers/pricing.js';

/**
 * task 087 — 统一计价回归：UsageProjection（application 路径）与 UsageStore
 * （CLI 落盘路径）对同一模型、同一 token、同一价目表必须给出同一个价。
 */

const TABLE: PricingTable = {
  models: {
    default: { input: 0.5, output: 1.5, cacheRead: 0.1 },
    'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07 },
    'claude-3-5-sonnet': { input: 3, output: 15, cacheRead: 0.3 },
  },
  protocols: { anthropic: { input: 3, output: 15, cacheRead: 0.3 } },
};

const CATALOG_ENTRIES = [
  { model: 'gemini-2.5-pro', priceIn: 1.25, priceOut: 10, priceCache: 0.12 },
  { model: 'kimi-k2.7-code', priceIn: 0.95, priceOut: 4, priceCache: 0.19 },
];
const CATALOG = catalogPriceSource({ version: 1, source: 'test', models: CATALOG_ENTRIES.map((m) => ({ ...m, provider: 'test' })) });

const TOKENS = { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 250_000 };

async function projectionCost(model: string, protocol: string, tokens: typeof TOKENS, opts: { strict?: boolean } = {}): Promise<number> {
  return projectionCostWith(model, protocol, TABLE, CATALOG, tokens, opts);
}

async function projectionCostWith(
  model: string,
  protocol: string,
  table: PricingTable,
  catalog: ReturnType<typeof catalogPriceSource>,
  tokens: typeof TOKENS,
  opts: { strict?: boolean } = {},
): Promise<number> {
  const bus = new EventBus();
  const projection = new UsageProjection({ model, protocol, pricingTable: table, catalog, strict: opts.strict });
  const detach = projection.attach(bus);
  await bus.emit('after_model', { turnId: 't', step: 1, response: {}, usage: tokens });
  const cost = projection.usage().costUsd;
  detach();
  return cost;
}

describe('087 统一计价 — projection 与 usage-store 同模型同价', () => {
  let dir: string;
  let store: UsageStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-parity-'));
    store = new UsageStore({ rootDir: dir, pricing: TABLE, catalog: CATALOG });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const cases: { model: string; protocol: string }[] = [
    { model: 'deepseek-chat', protocol: 'openai-compatible' }, // model 级
    { model: 'openrouter/anthropic/claude-3.5-sonnet-20241022', protocol: 'anthropic' }, // 归一 + model 级
    { model: 'gemini-2.5-pro', protocol: 'openai-compatible' }, // catalog 级
    { model: 'moonshotai/kimi-k2.7-code', protocol: 'openai-compatible' }, // 归一 + catalog
    { model: 'unknown-model-x', protocol: 'anthropic' }, // protocol 级
    { model: 'unknown-model-y', protocol: 'nope' }, // default 兜底（估算）
  ];

  for (const c of cases) {
    it(`same price for "${c.model}"`, async () => {
      const fromProjection = await projectionCost(c.model, c.protocol, TOKENS);
      const fromStore = store.record({ provider: c.protocol, model: c.model, ...TOKENS }).costUsd;
      expect(fromStore).toBeCloseTo(fromProjection, 10);
    });
  }

  it('strict 口径两条路径同样一致（未收录 → 0）', async () => {
    const strictStore = new UsageStore({ rootDir: dir, pricing: TABLE, catalog: CATALOG, strict: true });
    const fromProjection = await projectionCost('unknown-model-y', 'nope', TOKENS, { strict: true });
    const res = strictStore.record({ provider: 'nope', model: 'unknown-model-y', ...TOKENS });
    expect(fromProjection).toBe(0);
    expect(res.costUsd).toBe(0);
    expect(res.source).toBe('unpriced');
  });

  it('真实价目表（configs/）+ 目录价源两条路径一致', async () => {
    const root = fileURLToPath(new URL('../../../../', import.meta.url)); // usage -> src -> cli -> apps -> repo root
    const realStore = new UsageStore({ rootDir: dir, pricing: loadPricing(root), catalog: catalogPriceSource(loadModelCatalog(root)) });
    const realCatalog = catalogPriceSource(loadModelCatalog(root));
    const model = 'google/gemini-2.5-pro-001';
    const fromProjection = await projectionCostWith(model, 'openai-compatible', loadPricing(root), realCatalog, TOKENS);
    const fromStore = realStore.record({ provider: 'openai-compatible', model, ...TOKENS }).costUsd;
    expect(fromStore).toBeCloseTo(fromProjection, 10);
    expect(fromStore).toBeGreaterThan(0);
  });
});
