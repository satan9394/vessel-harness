import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UsageStore } from './UsageStore.js';
import type { PricingTable } from '../providers/pricing.js';

const PRICING: PricingTable = {
  models: {
    default: { input: 0.5, output: 1.5, cacheRead: 0.1 },
    'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07 },
  },
  protocols: { 'openai-compatible': { input: 0.5, output: 1.5, cacheRead: 0.1 } },
};

describe('usage — UsageStore (V0.9, task 029)', () => {
  let dir: string;
  let store: UsageStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-usage-'));
    store = new UsageStore({ rootDir: dir, pricing: PRICING });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('accumulates tokens/calls/cost per provider::model across records', () => {
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000 });
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    const t = store.totals();
    expect(t.inputTokens).toBe(2_000_000);
    expect(t.outputTokens).toBe(2_000_000);
    expect(t.calls).toBe(2);
    // cost: 1M input @0.27 + 1M output @1.1 + 1M cache @0.07 = 1.44 per record; x2 but second has no cache
    // record1: 0.27+1.1+0.07=1.44; record2: 0.27+1.1=1.37; total 2.81
    expect(t.costUsd).toBeCloseTo(2.81, 5);
    const byModel = store.byModel();
    expect(byModel).toHaveLength(1);
    expect(byModel[0]!.model).toBe('deepseek-chat');
    expect(byModel[0]!.calls).toBe(2);
  });

  it('tracks multiple providers and models separately', () => {
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 100, outputTokens: 50 });
    store.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', inputTokens: 200, outputTokens: 100 });
    expect(store.byProvider().map((p) => p.provider).sort()).toEqual(['anthropic', 'deepseek']);
    expect(store.byModel()).toHaveLength(2);
    expect(store.totals().providers).toBe(2);
    expect(store.totals().models).toBe(2);
  });

  it('persists across instances (reopen reads the same file)', () => {
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 500, outputTokens: 250 });
    const store2 = new UsageStore({ rootDir: dir, pricing: PRICING });
    const t2 = store2.totals();
    expect(t2.inputTokens).toBe(500);
    expect(t2.calls).toBe(1);
    expect(fs.existsSync(path.join(dir, 'usage.json'))).toBe(true);
    // no .tmp leftover (atomic write)
    expect(fs.existsSync(path.join(dir, 'usage.json.tmp'))).toBe(false);
  });

  it('recent ring keeps last N events in order', () => {
    for (let i = 0; i < 5; i++) {
      store.record({ provider: 'deepseek', model: 'm', inputTokens: i, outputTokens: 0 });
    }
    const rec = store.recent(3);
    expect(rec).toHaveLength(3);
    expect(rec[2]!.inputTokens).toBe(4); // last event first in slice? recent returns tail
    expect(rec[0]!.inputTokens).toBe(2);
  });

  it('missing/corrupt file starts empty without throwing', () => {
    const empty = new UsageStore({ rootDir: dir, pricing: PRICING });
    expect(empty.totals().calls).toBe(0);
    fs.writeFileSync(path.join(dir, 'usage.json'), '{bad json', 'utf8');
    const corrupt = new UsageStore({ rootDir: dir, pricing: PRICING });
    expect(corrupt.totals().calls).toBe(0);
  });
});
