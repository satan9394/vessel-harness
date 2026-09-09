import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZERO_TOKEN_PRICE, resolvePrice, loadPricing, type PricingTable } from './pricing.js';

const TABLE: PricingTable = {
  models: {
    default: { input: 0.5, output: 1.5, cacheRead: 0.1 },
    mock: { input: 0, output: 0, cacheRead: 0 },
    'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07 },
    'claude-3-5-sonnet': { input: 3, output: 15, cacheRead: 0.3 },
  },
  protocols: {
    anthropic: { input: 3, output: 15, cacheRead: 0.3 },
    'openai-compatible': { input: 0.5, output: 1.5, cacheRead: 0.1 },
  },
};

describe('pricing — resolvePrice (task 017 + 085/086)', () => {
  it('model-specific price wins', () => {
    const r = resolvePrice(TABLE, 'deepseek-chat', 'openai-compatible');
    expect(r.price.input).toBe(0.27);
    expect(r).toMatchObject({ source: 'model', estimated: false, matchedKey: 'deepseek-chat' });
  });

  it('unknown model falls back to its protocol price', () => {
    expect(resolvePrice(TABLE, 'claude-whatever', 'anthropic').price.input).toBe(3);
    expect(resolvePrice(TABLE, 'random-model', 'openai-compatible').price.input).toBe(0.5);
    expect(resolvePrice(TABLE, 'random-model', 'openai-compatible').source).toBe('protocol');
  });

  it('unknown model + unknown protocol falls back to default (estimated=true)', () => {
    const r = resolvePrice(TABLE, 'zzz', undefined);
    expect(r.price.input).toBe(0.5);
    expect(r).toMatchObject({ source: 'default', estimated: true });
  });

  it('mock has zero price', () => {
    const r = resolvePrice(TABLE, 'mock', 'mock');
    expect(r.price.input).toBe(0);
    expect(r.estimated).toBe(false);
  });

  it('normalizes namespaced / dated / dotted / effort-suffixed names (task 085)', () => {
    expect(resolvePrice(TABLE, 'openrouter/anthropic/claude-3.5-sonnet', 'anthropic').matchedKey).toBe('claude-3-5-sonnet');
    expect(resolvePrice(TABLE, 'claude-3-5-sonnet-20241022', 'anthropic').price.input).toBe(3);
    expect(resolvePrice(TABLE, 'CLAUDE-3.5-SONNET', 'anthropic').price.input).toBe(3);
    expect(resolvePrice(TABLE, 'anthropic/claude-3-5-sonnet-thinking', 'anthropic').price.input).toBe(3);
  });

  it('strict mode only accepts model-specific prices (task 086)', () => {
    const r = resolvePrice(TABLE, 'zzz', undefined, undefined, { strict: true });
    expect(r).toMatchObject({ source: 'unpriced', estimated: false });
    expect(r.price).toEqual(ZERO_TOKEN_PRICE);
    // 已知模型在 strict 下照常命中
    expect(resolvePrice(TABLE, 'deepseek-chat', undefined, undefined, { strict: true }).source).toBe('model');
    // 协议级兜底在 strict 下不可用（它不是该模型的价）
    expect(resolvePrice(TABLE, 'zzz', 'anthropic', undefined, { strict: true }).source).toBe('unpriced');
  });

});

describe('pricing — loadPricing (task 017)', () => {
  it('loads the repo pricing.json with model + protocol tables', () => {
    const root = fileURLToPath(new URL('../../../../', import.meta.url)); // repo root
    const table = loadPricing(root);
    expect(table.models['deepseek-chat']).toBeDefined();
    expect(table.protocols['anthropic']).toBeDefined();
  });

  it('missing file falls back to the default table without throwing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-price-'));
    const table = loadPricing(tmp);
    expect(table.models.default!.input).toBe(0.5);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
