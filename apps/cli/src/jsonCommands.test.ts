import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { main } from './cli.js';
import { UsageStore } from './usage/UsageStore.js';
import type { PricingTable } from './providers/pricing.js';

/**
 * jsonCommands.test.ts — `--json` 命令侧覆盖（G-11 / BRIEF-10，AGENTS.md 规则 7）。
 *
 * 背景：五条只读命令新增了 `--json` 输出（`cli/output.ts`），但此前只有 `output.ts`
 * 自身有单测，**命令侧零覆盖**：没人验证过「走真实 `main()` 时 stdout 到底是不是一段
 * 可解析 JSON」「JSON 与文本两模式数值是否同源」。本文件补这一层，并且一律走真实
 * CLI 入口 `main()`（判别性最强：连参数解析、命令分派、store 构造一起覆盖）。
 *
 * 判别性要点（每条用例要能真的失败）：
 *   1. `usage --json` → 五个键齐全 + 数值来自真实记录 + stdout **不出现**人类报表标题；
 *   2. 同一份数据下 `--json` 的 `totals.costUsd` 与文本报表解析出的数值**相等**（数值比，
 *      不比格式化字符串）——只改 JSON 分支就会挂；
 *   3. `provider list --json` 逐字段白名单外扩时**不得**漏出密钥字段；
 *   4. 空登记表 `sessions list --json` → 恰好 `{sessions: []}`，且**不落**人类提示；
 *   5. `settings list --json` → `{settings: {...}}`（默认值补齐，仍是合法 JSON）；
 *   6. 回归保护：**不带** `--json` 的三条默认路径文案一字不变，且**不是**合法 JSON；
 *   7. 损坏 usage.json 走隔离路径时，`--json` 仍给可解析文档（记录实际行为）。
 *
 * 隔离纪律（AGENTS.md §8，照抄 cli.unknownCommand.test.ts）：`beforeEach` 建临时根并把
 * `VESSEL_PROVIDER_ROOT` / `VESSEL_USAGE_ROOT` / `VESSEL_SETTINGS_ROOT` / `VESSEL_SESSION_ROOT`
 * 全部指向它，`afterEach` 还原 + 清理——**绝不碰真实 `~/.vessel`**。
 */

/** 固定价目（形状照抄 UsageStore.recovery.test.ts 的 PRICING）。 */
const PRICING: PricingTable = {
  models: {
    default: { input: 0.5, output: 1.5, cacheRead: 0.1 },
    'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07 },
  },
  protocols: {},
};

const ROOT_ENV = [
  'VESSEL_PROVIDER_ROOT',
  'VESSEL_USAGE_ROOT',
  'VESSEL_SETTINGS_ROOT',
  'VESSEL_SESSION_ROOT',
] as const;

let tmpRoot: string;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-jsoncmd-'));
  for (const key of ROOT_ENV) {
    saved.set(key, process.env[key]);
    process.env[key] = tmpRoot;
  }
});

afterEach(() => {
  for (const key of ROOT_ENV) {
    const prev = saved.get(key);
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * 收集 stdout / stderr / warn 文本。`main()` 与 `emitJson` 都是 `console.log`，
 * 断言一律用收集到的整段文本（`spy.mock.calls.flat().join('\n')` 口径）。
 * `clear()` 让同一用例内的两次调用可以分别断言（同一次 spyOn 的 calls 会累加）。
 */
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const warn: string[] = [];
  const spyLog = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => out.push(a.join(' ')));
  const spyErr = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => err.push(a.join(' ')));
  const spyWarn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => warn.push(a.join(' ')));
  return {
    out: () => out.join('\n'),
    err: () => err.join('\n'),
    warn: () => warn.join('\n'),
    clear: () => {
      out.length = 0;
      err.length = 0;
      warn.length = 0;
    },
    restore: () => {
      spyLog.mockRestore();
      spyErr.mockRestore();
      spyWarn.mockRestore();
    },
  };
}

/** 用真 UsageStore（临时 usage 根 + 固定价目）造一条记录，供各用例复用。 */
function seedUsage(): void {
  const store = new UsageStore({ rootDir: tmpRoot, pricing: PRICING });
  store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1000, outputTokens: 500 });
}

describe('--json 命令侧（G-11 / BRIEF-10）：走真实 main()', () => {
  it('1) usage --json：stdout 是一段可解析 JSON，五个键齐全且数值来自真实记录', async () => {
    seedUsage();
    const cap = capture();
    try {
      const code = await main(['usage', '--json']);
      expect(code).toBe(0);

      const text = cap.out();
      // JSON 模式不得混入人类报表标题（否则 stdout 不是「一段可解析 JSON」）
      expect(text).not.toContain('使用统计');
      expect(cap.err()).toBe('');

      const doc = JSON.parse(text) as Record<string, unknown>;
      for (const key of ['totals', 'daily', 'byProvider', 'byModel', 'recent']) {
        expect(doc).toHaveProperty(key);
      }
      expect(Array.isArray(doc.daily)).toBe(true);
      expect(Array.isArray(doc.byProvider)).toBe(true);
      expect(Array.isArray(doc.byModel)).toBe(true);
      expect(Array.isArray(doc.recent)).toBe(true);

      // 数值确实来自刚刚 record 的那条记录（不是空壳文档）
      const totals = doc.totals as { inputTokens: number; outputTokens: number; calls: number; costUsd: number };
      expect(totals.inputTokens).toBe(1000);
      expect(totals.outputTokens).toBe(500);
      expect(totals.calls).toBe(1);
      expect(totals.costUsd).toBeGreaterThan(0);
      expect((doc.recent as unknown[]).length).toBe(1);
    } finally {
      cap.restore();
    }
  });

  it('2) 两模式数值一致：JSON totals.costUsd 等于文本「估算成本: $X」解析出的数值', async () => {
    seedUsage();
    const cap = capture();
    try {
      expect(await main(['usage', '--json'])).toBe(0);
      const jsonCost = (JSON.parse(cap.out()) as { totals: { costUsd: number } }).totals.costUsd;
      expect(jsonCost).toBeGreaterThan(0);

      cap.clear();
      expect(await main(['usage'])).toBe(0);
      const text = cap.out();

      const m = /估算成本:\s*\$([0-9.]+)/.exec(text);
      expect(m).not.toBeNull();
      const textCost = Number(m![1]);
      // 比**数值**（不比格式化字符串）：文本侧 toFixed(4)，容差 1e-4 覆盖四舍五入
      expect(Math.abs(textCost - jsonCost)).toBeLessThan(1e-4);
    } finally {
      cap.restore();
    }
  });

  it('3) provider list --json：providers 是数组，且不出现密钥字段', async () => {
    const cap = capture();
    try {
      const code = await main(['provider', 'list', '--json']);
      expect(code).toBe(0);

      const text = cap.out();
      expect(text).not.toContain('"apiKey"');

      const doc = JSON.parse(text) as { providers: unknown };
      expect(Array.isArray(doc.providers)).toBe(true);
      // 逐条再验一遍：任何一条 provider 的键里都不得出现 apiKey
      for (const p of doc.providers as Record<string, unknown>[]) {
        expect(Object.keys(p)).not.toContain('apiKey');
      }
      expect(cap.err()).toBe('');
    } finally {
      cap.restore();
    }
  });

  it('4) sessions list --json 空表：恰好 {"sessions":[]}，不落人类提示', async () => {
    const cap = capture();
    try {
      const code = await main(['sessions', 'list', '--json']);
      expect(code).toBe(0);

      const text = cap.out();
      expect(JSON.parse(text)).toEqual({ sessions: [] });
      expect(text).not.toContain('暂无历史会话');
      expect(cap.err()).toBe('');
    } finally {
      cap.restore();
    }
  });

  it('5) settings list --json：{settings:{theme,locale}} 且仍是合法 JSON', async () => {
    const cap = capture();
    try {
      const code = await main(['settings', 'list', '--json']);
      expect(code).toBe(0);

      const text = cap.out();
      const doc = JSON.parse(text) as { settings: Record<string, unknown> };
      expect(typeof doc.settings).toBe('object');
      expect(doc.settings).not.toBeNull();
      expect(typeof doc.settings.theme).toBe('string');
      expect(typeof doc.settings.locale).toBe('string');
      // 人类渲染（`=== 设置项（vessel settings）===`）不得混进 JSON 模式
      expect(text).not.toContain('设置项');
    } finally {
      cap.restore();
    }
  });

  it('6) 默认路径零改动（回归保护）：不带 --json 仍是人类文案、不是合法 JSON', async () => {
    const cap = capture();
    try {
      expect(await main(['sessions', 'list'])).toBe(0);
      const sessionsText = cap.out();
      expect(sessionsText).toContain('暂无历史会话');
      expect(() => JSON.parse(sessionsText)).toThrow();

      cap.clear();
      expect(await main(['usage'])).toBe(0);
      const usageText = cap.out();
      expect(usageText).toContain('使用统计');
      // 文本报表读的是被隔离的临时根（顺带证明没碰真实 ~/.vessel）
      expect(usageText).toContain(tmpRoot);
      expect(() => JSON.parse(usageText)).toThrow();
    } finally {
      cap.restore();
    }
  });

  it('7) usage.json 损坏时 usage --json 走隔离路径：仍返回 0，stdout 仍可解析', async () => {
    const usageFile = path.join(tmpRoot, 'usage.json');
    fs.writeFileSync(usageFile, '{oops', 'utf8');

    const cap = capture();
    try {
      const code = await main(['usage', '--json']);
      expect(code).toBe(0); // 损坏 = 降级为隔离 + 空表，不是失败（失败才走 stderr 信封）

      const doc = JSON.parse(cap.out()) as { totals: { calls: number; costUsd: number } };
      expect(doc.totals.calls).toBe(0);
      expect(doc.totals.costUsd).toBe(0);
      expect(cap.err()).toBe(''); // 没有错误信封：本次是降级而非报错
      expect(cap.warn()).toContain('usage.json'); // 隔离留了告警（含路径线索）

      // 原字节被改名隔离（保留、未删除），符合仓库删除铁律
      const quarantined = fs.readdirSync(tmpRoot).filter((n) => n.includes('.corrupted-'));
      expect(quarantined).toHaveLength(1);
      expect(fs.readFileSync(path.join(tmpRoot, quarantined[0]!), 'utf8')).toBe('{oops');
    } finally {
      cap.restore();
    }
  });
});
