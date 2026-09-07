import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePrice, loadPricing, type PricingTable } from './pricing.js';

const TABLE: PricingTable = {
  models: {
    default: { input: 0.5, output: 1.5, cacheRead: 0.1 },
    mock: { input: 0, output: 0, cacheRead: 0 },
    'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07 },
  },
  protocols: {
    anthropic: { input: 3, output: 15, cacheRead: 0.3 },
    'openai-compatible': { input: 0.5, output: 1.5, cacheRead: 0.1 },
  },
};

describe('pricing — resolvePrice (task 017)', () => {
  it('model-specific price wins', () => {
    expect(resolvePrice(TABLE, 'deepseek-chat', 'openai-compatible').input).toBe(0.27);
  });

  it('unknown model falls back to its protocol price', () => {
    expect(resolvePrice(TABLE, 'claude-whatever', 'anthropic').input).toBe(3);
    expect(resolvePrice(TABLE, 'random-model', 'openai-compatible').input).toBe(0.5);
  });

  it('unknown model + unknown protocol falls back to default', () => {
    expect(resolvePrice(TABLE, 'zzz', undefined).input).toBe(0.5);
  });

  it('mock has zero price', () => {
    expect(resolvePrice(TABLE, 'mock', 'mock').input).toBe(0);
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
