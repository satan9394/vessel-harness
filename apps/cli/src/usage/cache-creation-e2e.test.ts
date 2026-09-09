import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentLoop, EventBus, Session } from '@vessel/core';
import type { ToolResultOutcome } from '@vessel/core';
import { MockProvider } from '@vessel/llm';
import { UsageProjection } from '@vessel/application';
import type { ChatUsage, ToolCall } from '@vessel/shared';
import { UsageStore } from './UsageStore.js';
import type { PricingTable } from '../providers/pricing.js';

/**
 * task 099 — cache_creation 端到端：MockProvider 上报 cacheCreationTokens →
 * AgentLoop after_model → UsageProjection（application 路径）与 UsageStore
 * （CLI 落盘路径）都出现 cacheWrite 分项。这是「089 入口已就绪但上游未上报」
 * 的收口断言：真实链路上报后，下游无需任何改动即自动分项计价。
 */

const CLAUDE = 'claude-sonnet-4';
/** 显式 cacheWrite（Anthropic 写价比读价贵一个量级）—— 089 的三档回退第一档。 */
const PRICING: PricingTable = {
  models: { [CLAUDE]: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  protocols: {},
};

/** cache_creation_input_tokens=2095 是 Anthropic 文档示例值（PROVIDER-RESEARCH-ANTHROPIC.md）。 */
const CACHE_WRITE_USAGE: ChatUsage = {
  inputTokens: 12,
  outputTokens: 5,
  cacheReadTokens: 1024,
  cacheCreationTokens: 2095,
};

interface Harness {
  session: Session;
  bus: EventBus;
  loop: AgentLoop;
  store: UsageStore;
  projection: UsageProjection;
}

async function makeLoop(dir: string, usage: ChatUsage | undefined, storeDir: string): Promise<Harness> {
  const session = await Session.open({ workspaceRoot: dir, sessionId: 'cache-creation' });
  const bus = new EventBus();
  const store = new UsageStore({ rootDir: storeDir, pricing: PRICING });
  const projection = new UsageProjection({ model: CLAUDE, pricingTable: PRICING });
  projection.attach(bus);
  // mirror packages/application/src/compose.ts (task 090 wiring): after_model → store.record
  bus.on(
    'after_model',
    (payload) => {
      const p = payload as { usage?: ChatUsage };
      if (!p.usage) return;
      store.record({
        provider: 'anthropic',
        model: CLAUDE,
        inputTokens: p.usage.inputTokens ?? 0,
        outputTokens: p.usage.outputTokens ?? 0,
        cacheReadTokens: p.usage.cacheReadTokens,
        cacheCreationTokens: p.usage.cacheCreationTokens,
      });
    },
    'test:usage',
  );

  const provider = new MockProvider([{ when: /.*/, response: { text: 'done' } }], { model: CLAUDE, usage });
  const loop = new AgentLoop({
    session,
    bus,
    provider,
    model: CLAUDE,
    buildContext: async () => ({
      model: CLAUDE,
      messages: [{ role: 'system' as const, content: 'test' }, { role: 'user' as const, content: 'hi' }],
      tools: [],
      estimateTokens: 10,
    }),
    runTool: async (call: ToolCall): Promise<ToolResultOutcome> => {
      void call;
      return { content: 'ok', meta: {} };
    },
    getVisibleTools: () => [],
  });
  return { session, bus, loop, store, projection };
}

describe('099 cache_creation 端到端（provider → ChatUsage → after_model → 统计）', () => {
  let dir: string;
  let storeDir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-cache-e2e-'));
    storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-cache-store-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it('provider 上报 cacheCreationTokens → UsageStore 出现 cacheWrite token + 分项成本', async () => {
    const h = await makeLoop(dir, CACHE_WRITE_USAGE, storeDir);
    await h.loop.runTurn('hi');

    const t = h.store.totals();
    expect(t.cacheCreationTokens).toBe(2095);
    expect(t.cacheReadTokens).toBe(1024);
    expect(t.calls).toBe(1);
    // 分项：2095/1M × 3.75 = 0.00785625（显式写入价，非推导）
    expect(t.costBreakdown.cacheWriteUsd).toBeCloseTo((2095 / 1_000_000) * 3.75, 12);
    expect(t.cacheWriteDerivedCostUsd).toBe(0);
    expect(t.costUsd).toBeCloseTo(
      (12 / 1_000_000) * 3 + (5 / 1_000_000) * 15 + (1024 / 1_000_000) * 0.3 + (2095 / 1_000_000) * 3.75,
      12,
    );
    await h.session.close();
  });

  it('同一链路上 UsageProjection 给出同额 cacheWrite 分项（两条路径同源）', async () => {
    const h = await makeLoop(dir, CACHE_WRITE_USAGE, storeDir);
    await h.loop.runTurn('hi');

    const u = h.projection.usage();
    expect(u.cacheCreationTokens).toBe(2095);
    expect(u.costBreakdown.cacheWriteUsd).toBeCloseTo((2095 / 1_000_000) * 3.75, 12);
    expect(u.costBreakdown.cacheWritePriceSource).toBe('explicit');
    expect(u.costUsd).toBeCloseTo(h.store.totals().costUsd, 12);
    await h.session.close();
  });

  it('OpenAI 系（无该字段）不误报：cacheCreationTokens 缺省 → 分项为 0 且不产生假成本', async () => {
    const h = await makeLoop(dir, { inputTokens: 12, outputTokens: 5, cacheReadTokens: 1024 }, storeDir);
    await h.loop.runTurn('hi');

    const t = h.store.totals();
    expect(t.cacheCreationTokens).toBe(0);
    expect(t.costBreakdown.cacheWriteUsd).toBe(0);
    expect(t.costUsd).toBeCloseTo((12 / 1_000_000) * 3 + (5 / 1_000_000) * 15 + (1024 / 1_000_000) * 0.3, 12);
    expect(h.projection.usage().cacheCreationTokens).toBe(0);
    await h.session.close();
  });

  it('回归：未注入 usage 的默认 mock（100/20）仍只记 input/output，无 cache 分项', async () => {
    const h = await makeLoop(dir, undefined, storeDir);
    await h.loop.runTurn('hi');

    const t = h.store.totals();
    expect(t.inputTokens).toBe(100);
    expect(t.outputTokens).toBe(20);
    expect(t.cacheReadTokens).toBe(0);
    expect(t.cacheCreationTokens).toBe(0);
    expect(t.costBreakdown.cacheWriteUsd).toBe(0);
    await h.session.close();
  });
});
