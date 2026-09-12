import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadModelCatalog,
  loadModelCatalogDetailed,
  readModelCatalog,
  userModelCatalogPath,
  findCatalogModel,
  findCatalogModelByBase,
  findCatalogModelMatch,
  catalogPriceSource,
  listCatalogModels,
} from './modelCatalog.js';
import { resolvePrice, loadPricing } from './pricing.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url)); // providers -> src -> cli -> apps -> repo root

/**
 * 隔离（AGENTS.md §8）：Round 20 起 `loadModelCatalog` 会先读**用户态**目录
 * `<VESSEL_USAGE_ROOT>/model-catalog.json`（缺省 `~/.vessel/…`）。
 * 这里把根钉进临时目录，保证①不读真实 `~/.vessel`、②「无用户态文件 → 包内兜底」
 * 这一前提在每台机器上都成立（否则本文件既有断言会随开发者本机状态飘）。
 */
let userRoot: string;
let savedUsageRoot: string | undefined;
beforeEach(() => {
  userRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-catalog-user-'));
  savedUsageRoot = process.env.VESSEL_USAGE_ROOT;
  process.env.VESSEL_USAGE_ROOT = userRoot;
});
afterEach(() => {
  if (savedUsageRoot === undefined) delete process.env.VESSEL_USAGE_ROOT;
  else process.env.VESSEL_USAGE_ROOT = savedUsageRoot;
  fs.rmSync(userRoot, { recursive: true, force: true });
});

describe('modelCatalog (V0.9, task 030)', () => {
  it('loads the repo catalog with 20+ mainstream models', () => {
    const c = loadModelCatalog(REPO_ROOT);
    expect(c.models.length).toBeGreaterThanOrEqual(20);
    expect(c.source).toContain('models.dev');
  });

  it('finds a model by exact id and by basename', () => {
    const c = loadModelCatalog(REPO_ROOT);
    const claude = findCatalogModel(c, 'claude-sonnet-4-5');
    expect(claude).toBeDefined();
    expect(claude!.priceIn).toBeGreaterThan(0);
    // basename lookup tolerates provider prefixes
    const byBase = findCatalogModelByBase(c, 'anthropic/claude-sonnet-4-5');
    expect(byBase?.model).toBe('claude-sonnet-4-5');
  });

  it('normalizes real-world model name variants (task 085)', () => {
    const c = loadModelCatalog(REPO_ROOT);
    const cases: { input: string; expect: string }[] = [
      { input: 'anthropic/claude-sonnet-4-5', expect: 'claude-sonnet-4-5' },
      { input: 'claude-sonnet-4-5-20250929', expect: 'claude-sonnet-4-5' },
      { input: 'claude-opus-4.5', expect: 'claude-opus-4-5' },
      { input: 'CLAUDE-HAIKU-4-5', expect: 'claude-haiku-4-5' },
      { input: 'openai/gpt-5.1-codex-high', expect: 'gpt-5.1' },
      { input: 'gpt-4o-mini-2024-07-18', expect: 'gpt-4o-mini' },
      { input: 'google/gemini-2.5-pro-001', expect: 'gemini-2.5-pro' },
      { input: 'moonshotai/kimi-k2.7-code', expect: 'kimi-k2.7-code' },
      { input: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash', expect: 'deepseek-ai/DeepSeek-V4-Flash' },
      { input: 'zai-org/GLM-5', expect: 'zai-org/GLM-5' },
    ];
    for (const c2 of cases) {
      expect(findCatalogModelMatch(c, c2.input)?.key, c2.input).toBe(c2.expect);
    }
  });

  it('lists models sorted by provider then model', () => {
    const c = loadModelCatalog(REPO_ROOT);
    const list = listCatalogModels(c);
    expect(list.length).toBe(c.models.length);
    for (let i = 1; i < list.length; i++) {
      expect(list[i]!.provider >= list[i - 1]!.provider).toBe(true);
    }
  });

  it('missing catalog returns empty without throwing', () => {
    const empty = loadModelCatalog('/nonexistent');
    expect(empty.models).toEqual([]);
  });

  it('resolvePrice falls back to catalog price when pricing.json has no entry', () => {
    const table = loadPricing(REPO_ROOT);
    const catalog = loadModelCatalog(REPO_ROOT);
    const src = catalogPriceSource(catalog);
    const price = resolvePrice(table, 'claude-sonnet-4-5', 'anthropic', src);
    expect(price.price.input).toBe(3); // catalog: claude-sonnet-4-5 input $3/1M
    expect(price.source).toBe('model'); // pricing.json also has claude-sonnet-4-5
    // pricing.json deepseek-chat still wins over catalog
    expect(resolvePrice(table, 'deepseek-chat', 'openai-compatible', src).price.input).toBe(0.27);
    // catalog-only model resolves through the catalog source
    const gemini = resolvePrice(table, 'google/gemini-2.5-pro-001', 'openai-compatible', src);
    expect(gemini.source).toBe('catalog');
    expect(gemini.price.input).toBe(1.25);
  });

  it('catalog price source normalizes namespaced/dated variants (task 085/087)', () => {
    const src = catalogPriceSource(loadModelCatalog(REPO_ROOT));
    expect(src.findPrice('moonshotai/kimi-k2.7-code')?.input).toBe(0.95);
    expect(src.findPrice('zai-org/GLM-5')?.input).toBe(0.95); // 目录里 glm-5 有多家 → 首条命中
    expect(src.findPrice('nonexistent-model')).toBeUndefined();
  });
});

/**
 * Round 20 — 目录读取的**用户态优先 → 包内兜底**（读写落点对齐）。
 * 每条断言后的「删哪行会红」= 判别性来源（把该分支删掉/改回去，本条必红）。
 */
describe('modelCatalog — 用户态优先、包内兜底（Round 20）', () => {
  const SENTINEL = {
    version: 1,
    source: 'user-sentinel',
    models: [{ model: 'sentinel-model', provider: 'sentinel', priceIn: 42.5, priceOut: 99 }],
  };

  /** 包内目录（改动前 `loadModelCatalog` 的唯一来源）——用作「逐字相同」的对照物。 */
  const builtinCatalog = (): ReturnType<typeof readModelCatalog> =>
    readModelCatalog(path.join(REPO_ROOT, 'configs', 'model-catalog.json'));

  it('AC1 用户态命中即终结：读到哨兵价，包内目录整份被压掉（不是合并）', () => {
    fs.writeFileSync(userModelCatalogPath(), JSON.stringify(SENTINEL), 'utf8');
    const c = loadModelCatalog(REPO_ROOT);
    // 删掉 loadModelCatalogDetailed 里 `status === 'ok' || 'empty'` 命中用户态就 return 的分支
    // → 这里读到的是仓库目录（100+ 条）→ RED
    expect(c.models).toHaveLength(1);
    expect(c.source).toBe('user-sentinel');
    expect(c.models[0]).toMatchObject({ model: 'sentinel-model', priceIn: 42.5, priceOut: 99 });
    // 把两层写成「合并」（concat）而不是「命中即终结」→ 下面两条 RED
    expect(findCatalogModel(c, 'claude-sonnet-4-5')).toBeUndefined();
    expect(loadModelCatalogDetailed(REPO_ROOT).origin).toBe('user');
  });

  it('AC2 无用户态文件 → 包内兜底，且与改动前 readModelCatalog(包内) 逐字相同', () => {
    expect(fs.existsSync(userModelCatalogPath())).toBe(false); // 前提：用户态确实没有文件
    const load = loadModelCatalogDetailed(REPO_ROOT);
    // 删掉「回落 builtinFile」那几行 → catalog 为空目录 → RED
    expect(load.origin).toBe('builtin');
    expect(load.file).toBe(path.join(REPO_ROOT, 'configs', 'model-catalog.json'));
    expect(load.catalog).toEqual(builtinCatalog()); // 逐字相同（usage 成本不漂移）
    expect(load.catalog.models.length).toBeGreaterThanOrEqual(20);
    expect(load.warning).toBeUndefined(); // 零噪音：默认路径下没有警告
    expect(loadModelCatalog(REPO_ROOT)).toEqual(builtinCatalog());
  });

  it('AC-错误场景 用户态损坏 → 回落包内 + 一条 warn（不抛、不静默当空表）', () => {
    fs.writeFileSync(userModelCatalogPath(), '{ this is not json', 'utf8');
    const load = loadModelCatalogDetailed(REPO_ROOT);
    // 删掉 `status === 'invalid'` 分支里的 warning → load.warning 变 undefined → RED
    expect(load.warning).toBeDefined();
    expect(load.warning).toContain(userModelCatalogPath());
    // 把 invalid 当「空表生效」（不回落）→ catalog 为空 → 下面两条 RED（= 目录价被静默算丢）
    expect(load.origin).toBe('builtin');
    expect(load.catalog).toEqual(builtinCatalog());
    expect(load.catalog.models.length).toBeGreaterThanOrEqual(20);

    // 读入口不抛（成本计算不该因为用户文件坏了就失败），并恰好打 1 条 warn
    const warns: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((m: unknown) => void warns.push(String(m)));
    let loaded: ReturnType<typeof loadModelCatalog> | undefined;
    try {
      expect(() => { loaded = loadModelCatalog(REPO_ROOT); }).not.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(warns).toHaveLength(1);
    expect(loaded).toEqual(builtinCatalog());
  });

  it('AC-错误场景 用户态空对象 {} → 按“有文件”处理：空目录生效（不回落）+ 一条说明', () => {
    fs.writeFileSync(userModelCatalogPath(), '{}', 'utf8');
    const load = loadModelCatalogDetailed(REPO_ROOT);
    // 决策理由（也写在 modelCatalog.ts 的 readModelCatalogFile 注释里）：`{}` 是「我不要这份目录」
    // 的明确表达 → 空表生效；若改成「无 models 数组就回落包内」，下面两条 RED
    // （= 用户清了文件却还在按旧价算钱，正是本卡要防的镜像问题）。
    expect(load.origin).toBe('user');
    expect(load.catalog.models).toEqual([]);
    expect(load.warning).toBeDefined();
    expect(load.warning).toContain(userModelCatalogPath());
  });

  it('AC3 写侧与读侧同根：userModelCatalogPath() = <VESSEL_USAGE_ROOT>/model-catalog.json', () => {
    // 删掉 userModelCatalogPath 里的 resolveUsageRoot()（改成 os.homedir()/写死 ~/.vessel）
    // → 这里读不到临时根 → RED，且本文件会去碰真实 ~/.vessel
    expect(userModelCatalogPath()).toBe(path.join(userRoot, 'model-catalog.json'));
  });
});
