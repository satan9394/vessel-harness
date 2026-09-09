import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_SYNC_RETRIES,
  catalogSourceLine,
  matchGlob,
  parseModelsDevCatalog,
  syncModelCatalog,
  type SyncFetch,
  type SyncFetchResponse,
} from './pricingSync.js';
import { readModelCatalog, catalogPriceSource } from './modelCatalog.js';
import { resolvePrice } from './pricing.js';
import { PricingOverrideStore } from '../usage/pricingOverride.js';

/**
 * task 093 — models.dev 价目同步（`vessel pricing sync`）。
 *
 * 全部用**注入的 fetch mock**，不依赖真实网络；离线语义（保留旧表 + 提示）
 * 用「fetch 抛错 / HTTP 5xx / 非法 JSON / 超时」四种失败形态验证。
 */

/** 一份缩微的 models.dev 响应（形状与真实 api.json 一致）。 */
const MODELS_DEV = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    models: {
      'claude-sonnet-4-5': {
        id: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 200000, output: 64000 },
        cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
      },
      'claude-opus-4-5': {
        id: 'claude-opus-4-5',
        limit: { context: 200000, output: 32000 },
        cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
      },
    },
  },
  openai: {
    id: 'openai',
    models: {
      'gpt-5.1': {
        id: 'gpt-5.1',
        limit: { context: 400000, output: 128000 },
        cost: { input: 1.25, output: 10, cache_read: 0.125 },
      },
      // 非文本输出 → 不进价目表
      'text-embedding-3-large': {
        id: 'text-embedding-3-large',
        modalities: { input: ['text'], output: ['embedding'] },
        cost: { input: 0.13, output: 0 },
      },
      // 已弃用 → 不收录
      'gpt-4o-audio-preview': {
        id: 'gpt-4o-audio-preview',
        deprecated: true,
        cost: { input: 2.5, output: 10 },
      },
      // 缺价 → 不收录（不制造 0 价条目）
      'gpt-no-price': { id: 'gpt-no-price' },
    },
  },
  deepseek: {
    id: 'deepseek',
    models: {
      'deepseek-chat': { id: 'deepseek-chat', limit: { context: 128000, output: 8192 }, cost: { input: 0.27, output: 1.1 } },
    },
  },
};

function ok(data: unknown): SyncFetchResponse {
  return { ok: true, status: 200, json: async () => data };
}

function httpError(status: number): SyncFetchResponse {
  return { ok: false, status, json: async () => ({}) };
}

const fetchOk: SyncFetch = async () => ok(MODELS_DEV);

describe('093 — models.dev 解析映射', () => {
  it('cost/limit → priceIn/priceOut/priceCache/priceCacheWrite/contextWindow/outputLimit', () => {
    const parsed = parseModelsDevCatalog(MODELS_DEV);
    const sonnet = parsed.models.find((m) => m.model === 'claude-sonnet-4-5');
    expect(sonnet).toEqual({
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      contextWindow: 200000,
      outputLimit: 64000,
      priceIn: 3,
      priceOut: 15,
      priceCache: 0.3,
      priceCacheWrite: 3.75,
    });
    // 没有 cache_write 的条目就不写该字段（不写假值）
    const gpt = parsed.models.find((m) => m.model === 'gpt-5.1');
    expect(gpt).toMatchObject({ priceIn: 1.25, priceOut: 10, priceCache: 0.125 });
    expect(gpt!.priceCacheWrite).toBeUndefined();
    // 过滤原因逐条计数（不静默丢）
    expect(parsed.skipped).toMatchObject({ nonText: 1, noPrice: 1, deprecated: 1, excluded: 0 });
    expect(parsed.models.map((m) => m.model)).not.toContain('text-embedding-3-large');
    expect(parsed.models.map((m) => m.model)).not.toContain('gpt-no-price');
    // 排序确定性：provider → model
    expect(parsed.models.map((m) => `${m.provider}/${m.model}`)).toEqual([
      'anthropic/claude-opus-4-5',
      'anthropic/claude-sonnet-4-5',
      'deepseek/deepseek-chat',
      'openai/gpt-5.1',
    ]);
  });

  it('--provider / --exclude 过滤（glob 大小写不敏感，匹配 model / provider / provider/model）', () => {
    const onlyAnthropic = parseModelsDevCatalog(MODELS_DEV, { providers: ['anthropic'] });
    expect(onlyAnthropic.models.every((m) => m.provider === 'anthropic')).toBe(true);
    expect(onlyAnthropic.skipped.provider).toBe(5); // openai 4 条 + deepseek 1 条被 provider 过滤

    const excluded = parseModelsDevCatalog(MODELS_DEV, { exclude: ['openai/*', '*opus*'] });
    expect(excluded.models.map((m) => m.model)).toEqual(['claude-sonnet-4-5', 'deepseek-chat']);
    expect(excluded.skipped.excluded).toBe(3); // openai/gpt-5.1 + openai/gpt-no-price + anthropic/claude-opus-4-5

    // 排除整个 provider 名即可清掉它
    expect(parseModelsDevCatalog(MODELS_DEV, { exclude: ['openai'] }).models.some((m) => m.provider === 'openai')).toBe(false);

    expect(matchGlob('claude-*', 'claude-sonnet-4-5')).toBe(true);
    expect(matchGlob('CLAUDE-*', 'claude-opus-4-5')).toBe(true);
    expect(matchGlob('claude-*', 'openai/gpt-5.1')).toBe(false);
  });
});

describe('093 — sync 写盘 / dry-run / 幂等 / 离线回退', () => {
  let dir: string;
  let catalogPath: string;
  let overridePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-sync-'));
    catalogPath = path.join(dir, 'model-catalog.json');
    overridePath = path.join(dir, 'pricing.override.json');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('首次同步写盘：原子写（无 .tmp）、source 含 models.dev、lastSyncAt、条目可被查价消费', async () => {
    const now = new Date('2026-09-09T12:00:00.000Z');
    const res = await syncModelCatalog({ catalogPath, fetchImpl: fetchOk, now: () => now });
    expect(res.status).toBe('updated');
    expect(res.wrote).toBe(true);
    expect(res.added).toHaveLength(4);
    expect(res.updated).toHaveLength(0);
    expect(res.total).toBe(4);
    expect(fs.existsSync(`${catalogPath}.tmp`)).toBe(false);

    const written = readModelCatalog(catalogPath);
    expect(written.source).toContain('models.dev');
    expect(written.source).toBe(catalogSourceLine());
    expect(written.lastSyncAt).toBe(now.toISOString());
    expect(written.models).toHaveLength(4);

    // 写出的目录能被查价链消费（catalog 源，estimated=false）
    const table = { models: { default: { input: 0.5, output: 1.5 } }, protocols: {} };
    const resolved = resolvePrice(table, 'claude-sonnet-4-5', 'anthropic', catalogPriceSource(written));
    expect(resolved.source).toBe('catalog');
    expect(resolved.price.input).toBe(3);
    // 同步只写 catalog：不会凭空造出用户覆盖文件
    expect(fs.existsSync(overridePath)).toBe(false);
  });

  it('dry-run 只打印差异、不写盘', async () => {
    const res = await syncModelCatalog({ catalogPath, fetchImpl: fetchOk, dryRun: true });
    expect(res.status).toBe('dry-run');
    expect(res.wrote).toBe(false);
    expect(res.added).toHaveLength(4);
    expect(fs.existsSync(catalogPath)).toBe(false); // 一个字节都没写
  });

  it('幂等：相同远端数据二次同步零变更、文件逐字节不变', async () => {
    const first = await syncModelCatalog({ catalogPath, fetchImpl: fetchOk });
    expect(first.status).toBe('updated');
    const before = fs.readFileSync(catalogPath, 'utf8');

    const second = await syncModelCatalog({ catalogPath, fetchImpl: fetchOk, now: () => new Date('2030-01-01T00:00:00.000Z') });
    expect(second.status).toBe('unchanged');
    expect(second.wrote).toBe(false);
    expect(second.added).toHaveLength(0);
    expect(second.updated).toHaveLength(0);
    expect(second.unchanged).toBe(4);
    // 时间戳变了但没写盘 → 内容逐字节相同（幂等写）
    expect(fs.readFileSync(catalogPath, 'utf8')).toBe(before);
  });

  it('增量更新：只有价格变化的条目算 updated，远端未覆盖的既有条目保留', async () => {
    fs.writeFileSync(catalogPath, JSON.stringify({
      version: 1,
      source: 'handwritten',
      models: [
        { model: 'claude-sonnet-4-5', provider: 'anthropic', priceIn: 2.5, priceOut: 15, priceCache: 0.3, priceCacheWrite: 3.75 },
        { model: 'legacy-model', provider: 'acme', priceIn: 1, priceOut: 2 },
      ],
    }, null, 2), 'utf8');

    const res = await syncModelCatalog({ catalogPath, fetchImpl: fetchOk });
    expect(res.status).toBe('updated');
    expect(res.updated.map((u) => u.after.model)).toEqual(['claude-sonnet-4-5']);
    expect(res.updated[0]!.before.priceIn).toBe(2.5);
    expect(res.kept.map((m) => m.model)).toEqual(['legacy-model']); // 同步不删条目
    expect(res.total).toBe(5);
    const written = readModelCatalog(catalogPath);
    expect(written.models.find((m) => m.model === 'legacy-model')).toBeDefined();
    expect(written.models.find((m) => m.model === 'claude-sonnet-4-5')!.priceIn).toBe(3);
  });

  it('离线回退：fetch 抛错 → status=offline、旧表逐字节保留、带错误原因', async () => {
    const first = await syncModelCatalog({ catalogPath, fetchImpl: fetchOk });
    expect(first.wrote).toBe(true);
    const before = fs.readFileSync(catalogPath, 'utf8');

    const boom: SyncFetch = async () => { throw new Error('getaddrinfo ENOTFOUND models.dev'); };
    const res = await syncModelCatalog({ catalogPath, fetchImpl: boom });
    expect(res.status).toBe('offline');
    expect(res.wrote).toBe(false);
    expect(res.error).toContain('ENOTFOUND');
    expect(res.total).toBe(4); // 旧表条目数原样
    expect(fs.readFileSync(catalogPath, 'utf8')).toBe(before); // 不静默清空

    // Node fetch 把连接层错误包成 `fetch failed`，原因在 cause → 提示里要带上
    const wrapped = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    const refused: SyncFetch = async () => { throw wrapped; };
    const res2 = await syncModelCatalog({ catalogPath, fetchImpl: refused, retries: 0 });
    expect(res2.status).toBe('offline');
    expect(res2.error).toContain('ECONNREFUSED');
    expect(fs.readFileSync(catalogPath, 'utf8')).toBe(before);
  });

  it('离线回退：HTTP 5xx 与非法 JSON 同样保留旧表', async () => {
    const first = await syncModelCatalog({ catalogPath, fetchImpl: fetchOk });
    const before = fs.readFileSync(catalogPath, 'utf8');

    const server500 = await syncModelCatalog({ catalogPath, fetchImpl: async () => httpError(503) });
    expect(server500.status).toBe('offline');
    expect(server500.error).toContain('HTTP 503');

    const badJson: SyncFetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error('Unexpected token <'); } });
    const bad = await syncModelCatalog({ catalogPath, fetchImpl: badJson });
    expect(bad.status).toBe('offline');
    expect(bad.error).toContain('Unexpected token');

    // 空响应（解析后 0 条）也按失败处理，不清空旧表
    const empty = await syncModelCatalog({ catalogPath, fetchImpl: async () => ok({}) });
    expect(empty.status).toBe('offline');
    expect(empty.error).toContain('0 条');

    expect(first.wrote).toBe(true);
    expect(fs.readFileSync(catalogPath, 'utf8')).toBe(before);
  });

  it('重试上限 1 次：首次失败、第二次成功 → attempts=2', async () => {
    let calls = 0;
    const flaky: SyncFetch = async () => {
      calls += 1;
      if (calls === 1) throw new Error('socket hang up');
      return ok(MODELS_DEV);
    };
    const res = await syncModelCatalog({ catalogPath, fetchImpl: flaky });
    expect(calls).toBe(2);
    expect(res.attempts).toBe(2);
    expect(res.status).toBe('updated');

    // 两次都失败 → 只请求 1 + MAX_SYNC_RETRIES 次，随后离线回退
    let alwaysCalls = 0;
    const alwaysFail: SyncFetch = async () => { alwaysCalls += 1; throw new Error('offline'); };
    const failed = await syncModelCatalog({ catalogPath, fetchImpl: alwaysFail });
    expect(alwaysCalls).toBe(1 + MAX_SYNC_RETRIES);
    expect(failed.status).toBe('offline');
    expect(failed.attempts).toBe(1 + MAX_SYNC_RETRIES);
  });

  it('超时：mock fetch 不返回 → AbortSignal 触发 → 离线回退（保留旧表）', async () => {
    const hanging: SyncFetch = (_url, init) =>
      new Promise<SyncFetchResponse>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')));
      });
    const res = await syncModelCatalog({ catalogPath, fetchImpl: hanging, timeoutMs: 5, retries: 0 });
    expect(res.status).toBe('offline');
    expect(res.attempts).toBe(1);
    expect(res.wrote).toBe(false);
    expect(res.error).toContain('abort');
    expect(fs.existsSync(catalogPath)).toBe(false);
  });

  it('同步不覆盖用户 override：覆盖文件原样，查价仍走 override', async () => {
    const overrideStore = new PricingOverrideStore({ rootDir: dir });
    overrideStore.set('claude-sonnet-4-5', { input: 0.01, output: 0.02 });
    const overrideBefore = fs.readFileSync(overridePath, 'utf8');

    const res = await syncModelCatalog({ catalogPath, fetchImpl: fetchOk });
    expect(res.wrote).toBe(true);
    expect(fs.readFileSync(overridePath, 'utf8')).toBe(overrideBefore); // 一个字节都没动

    // 优先级链不变：override > 内置 > catalog
    const table = { models: { default: { input: 0.5, output: 1.5 } }, protocols: {} };
    const resolved = resolvePrice(table, 'claude-sonnet-4-5', 'anthropic', catalogPriceSource(readModelCatalog(catalogPath)), {
      override: overrideStore.source(),
    });
    expect(resolved.source).toBe('override');
    expect(resolved.price.input).toBe(0.01);
  });
});
