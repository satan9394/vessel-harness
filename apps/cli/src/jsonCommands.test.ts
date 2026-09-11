import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SyncCredentialStore } from '@vessel/application';
import { main } from './cli.js';
import { ProviderStore } from './providers/ProviderStore.js';
import { createDefaultProviderStore } from './providers/defaultStore.js';
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
 *   3. `provider list --json` **先 seed 真实 provider 再断言**：`providers` 非空（空登记表
 *      会让断言退化成「空集永真」，这正是 Round 10 复评点名的缺口）、seed 的 id 出现在输出
 *      里、逐字段白名单外扩时**不得**漏出密钥字段（整体展开 `ProviderConfig` 即 RED）；
 *   4. 空登记表 `sessions list --json` → 恰好 `{sessions: []}`，且**不落**人类提示；
 *   5. `settings list --json` → `{settings: {...}}`（默认值补齐，仍是合法 JSON）；
 *   6. 回归保护：**不带** `--json` 的三条默认路径文案一字不变，且**不是**合法 JSON；
 *   7. 损坏 usage.json 走隔离路径时，`--json` 仍给可解析文档（记录实际行为）；
 *   8. `models --json`（BRIEF-10 第五条只读命令）两条**完全离线**的分支各一例：内置 mock
 *      （`{models:[]}`）与 anthropic 内置清单（**非空**数组，空数组/人类表头混入都会 RED）；
 *   9. 错误路径：providers.json 损坏时 `--json` → **stdout 为空** + stderr 是合法
 *      `{error:{message,code}}` 信封 + 退出码非 0；同状态下**不带** `--json` → `main()` reject。
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

/** 假密钥（只在本测试进程内存 / 临时根里流转：不出真实网络、不落真实 `~/.vessel`）。 */
const FAKE_KEY = 'sk-test-not-a-real-key-123';

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

/**
 * 内存凭据假后端（测试注入）：只做 secretRef → apiKey 的存取，**绝不碰真实 secrets.json**。
 *
 * 写法照抄 `apps/cli/src/tui/chat.test.ts:25-34`（仓库里唯一的「真·内存」假后端；
 * `providers/ProviderStore.test.ts` / `providers/defaultStore.recovery.test.ts` 用的是
 * 落临时文件的 `PlaintextCredentialStore`，隔离效果等价，这里选不产生任何文件的那种）。
 */
function memoryCredentialStore(seed: Record<string, string> = {}): SyncCredentialStore {
  const map = new Map(Object.entries(seed));
  const k = (service: string, account: string): string => `${service}/${account}`;
  return {
    backend: 'memory-test',
    setSync: (service, account, secret) => { map.set(k(service, account), secret); },
    getSync: (service, account) => map.get(k(service, account)) ?? null,
    deleteSync: (service, account) => { map.delete(k(service, account)); },
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

  it('3) provider list --json：先 seed 真实 provider → providers 非空、id 可见，且不漏密钥字段', async () => {
    const cap = capture();
    try {
      // seed ①（内存假后端）：providers.json 只落 secretRef，密钥只在假后端内存里流转。
      const memCred = memoryCredentialStore();
      new ProviderStore({ rootDir: tmpRoot, credentialStore: memCred }).add({
        id: 'ds',
        name: 'ds',
        protocol: 'openai-compatible',
        model: 'm',
        baseUrl: 'https://example.invalid',
        apiKey: FAKE_KEY,
      });
      expect(memCred.getSync('vessel', 'ds')).toBe(FAKE_KEY); // seed 不是空壳 id：密钥真的进了后端

      // seed ②（CLI 自己的默认构造路径）：`main()` 用的是**默认凭据后端**（同根 secrets.json），
      // 只有它也存有密钥，`store.list()` 才会带着解析出来的明文 apiKey 进内存——否则下面的
      // 「stdout 不含密钥」又会退化成「没有密钥可漏」的永真断言（Round 10 复评的判别力缺口）。
      const cliStore = createDefaultProviderStore({ rootDir: tmpRoot });
      cliStore.add({
        id: 'ds2',
        name: 'ds2',
        protocol: 'openai-compatible',
        model: 'm',
        baseUrl: 'https://example.invalid',
        apiKey: FAKE_KEY,
      });
      expect(cliStore.get('ds2')?.apiKey).toBe(FAKE_KEY); // 前提校验：密钥确实会被 main() 载入内存

      cap.clear(); // 丢掉 seed 期可能的构造告警（如平台凭据后端降级 warn），只断言 main() 的输出
      const code = await main(['provider', 'list', '--json']);
      expect(code).toBe(0);

      const text = cap.out();
      const doc = JSON.parse(text) as { providers: { id: string; apiKey?: unknown }[] };

      // 判别力核心：providers **非空** 且 seed 的 id 出现在输出里（空登记表会让这两条 RED）
      expect(Array.isArray(doc.providers)).toBe(true);
      expect(doc.providers.length).toBeGreaterThan(0);
      const ids = doc.providers.map((p) => p.id);
      expect(ids).toContain('ds');
      expect(ids).toContain('ds2');

      // 逐字段白名单：密钥既不落 stdout 文本，也不出现在任何一条 provider 的键里
      expect(text).not.toContain(FAKE_KEY);
      expect(text).not.toContain('"apiKey"');
      for (const p of doc.providers) {
        expect(Object.keys(p)).not.toContain('apiKey');
        expect(p.apiKey).toBeUndefined();
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

  /**
   * BRIEF-10 第五条只读命令 `models`。该命令有**三条**分支（cli.ts cmdModels）：
   *   ① 内置 mock（`getCurrent()` 缺省即 mock）→ 离线，无模型清单；
   *   ② openai-compatible + baseUrl → 实时拉取（**要网络**，本文件不碰）；
   *   ③ anthropic 或「openai-compatible 但没 baseUrl」→ 内置清单（离线）。
   * 下面两条分别走 ① 与 ③：全程零网络（分支 ② 的 URL 一次都没配）。
   */
  it('8) models --json（内置 mock 分支）：getCurrent() 缺省 mock → {models:[]}，不落人类文案', async () => {
    const cap = capture();
    try {
      // 临时根里既无 providers.json 也无 current.json → getCurrent() = 'mock' → 分支 ①
      const code = await main(['models', '--json']);
      expect(code).toBe(0);

      const text = cap.out();
      // 人类提示（cli.ts:427）不得混进 JSON 模式
      expect(text).not.toContain('(mock provider 是离线的');
      const doc = JSON.parse(text) as { models: unknown };
      expect(Array.isArray(doc.models)).toBe(true);
      expect(doc.models).toEqual([]); // mock 是内置离线供应商：没有模型清单，但仍是合法 JSON 文档
      expect(cap.err()).toBe('');
    } finally {
      cap.restore();
    }
  });

  it('9) models --json（anthropic 内置清单分支，零网络）：models 非空数组，不落人类表头', async () => {
    // seed 一个 anthropic provider 并设为 current → 命中分支 ③（不构造 baseUrl，绝不触发实时拉取）
    const store = new ProviderStore({ rootDir: tmpRoot, credentialStore: memoryCredentialStore() });
    store.add({
      id: 'claude',
      name: 'claude',
      protocol: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: FAKE_KEY,
    });
    store.setCurrent('claude');

    const cap = capture();
    try {
      const code = await main(['models', '--json']);
      expect(code).toBe(0);

      const text = cap.out();
      expect(text).not.toContain('模型列表（'); // 人类表头（含「内置清单（非实时拉取）」注释）不得混入
      const doc = JSON.parse(text) as { models: string[] };
      expect(Array.isArray(doc.models)).toBe(true);
      expect(doc.models.length).toBeGreaterThan(0); // 内置清单非空（返回空数组会让这条 RED）
      expect(doc.models.every((m) => typeof m === 'string')).toBe(true);
      expect(cap.err()).toBe('');

      // 对照：不带 --json 时同一份内置清单走人类渲染（回归保护，且不是可解析 JSON）
      cap.clear();
      expect(await main(['models'])).toBe(0);
      expect(cap.out()).toContain('模型列表');
      expect(() => JSON.parse(cap.out())).toThrow();
    } finally {
      cap.restore();
    }
  });

  /**
   * 错误路径（BRIEF-10 验收 4 的兜底出口）：`providers.json` 损坏时 `ProviderStore.rawLoad()`
   * 抛 `providers file corrupted (...)`；`--json` 下由 `main()` 的 catch（cli.ts:1682-1690）
   * 就地转成 stderr 信封 + 退出码 1，**绝不再走人话渲染、绝不落 stdout**。
   */
  it('10) providers.json 损坏：--json 走 stderr 错误信封（stdout 空 + 非 0），非 --json 则 reject', async () => {
    const providersFile = path.join(tmpRoot, 'providers.json');
    fs.writeFileSync(providersFile, '{broken', 'utf8');

    const cap = capture();
    try {
      const code = await main(['provider', 'list', '--json']);
      expect(code).not.toBe(0); // 失败不能伪装成成功
      expect(code).toBe(1);

      expect(cap.out()).toBe(''); // stdout 为空：console.log 一次都没被调用
      const doc = JSON.parse(cap.err()) as { error: { message: string; code: number } };
      expect(Object.keys(doc)).toEqual(['error']);
      expect(Object.keys(doc.error).sort()).toEqual(['code', 'message']);
      expect(typeof doc.error.message).toBe('string');
      expect(typeof doc.error.code).toBe('number');
      expect(doc.error.code).toBe(1); // 信封里的 code 与退出码同源
      expect(doc.error.message).toContain('providers file corrupted');
      expect(doc.error.message).toContain(tmpRoot); // 指向被隔离的临时根，不是真实 ~/.vessel

      // 抛错路径不改写、不隔离源文件（原字节逐字保留）
      expect(fs.readFileSync(providersFile, 'utf8')).toBe('{broken');

      // 对照：同一损坏状态下**不带** `--json` → `main()` 原样上抛（reject）。
      // 人话渲染在入口 `.catch` 的 `describeStartupFailure`（见 cli.crashSurface.test.ts），
      // 在 `main()` 作用域内既没有 JSON 信封、也没有人类文案输出。
      cap.clear();
      await expect(main(['provider', 'list'])).rejects.toThrow(/providers file corrupted/);
      expect(cap.out()).toBe('');
      expect(cap.err()).toBe('');
      expect(fs.readFileSync(providersFile, 'utf8')).toBe('{broken');
    } finally {
      cap.restore();
    }
  });
});
