import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProviderStore, type ProviderConfig } from './ProviderStore.js';
import {
  PROVIDER_EXPORT_KIND,
  PROVIDER_EXPORT_VERSION,
  ProviderImportError,
  buildExport,
  importProviders,
  parseImportFile,
  redactProvider,
  serializeExport,
} from './providerTransfer.js';

/**
 * providerTransfer.test.ts — task 095 导入导出验收测试。
 *
 * 假密钥一律用 `sk-fake-*`；断言「导出文本里不含任何明文密钥」是核心。
 * 临时目录 mkdtempSync + afterEach rmSync（仓库统一先例，不碰真实 ~/.vessel）。
 */

const FAKE_KEY = 'sk-fake-export-do-not-leak-1234';

const DS: ProviderConfig = {
  id: 'ds',
  name: 'DeepSeek',
  protocol: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: FAKE_KEY,
  model: 'deepseek-chat',
  note: 'primary',
};

const ANT: ProviderConfig = {
  id: 'ant',
  name: 'Anthropic',
  protocol: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  secretRef: 'credential:vessel/ant',
  model: 'claude-sonnet-4-5',
};

describe('095 export 脱敏', () => {
  let dir: string;
  let store: ProviderStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-xfer-'));
    store = new ProviderStore({ rootDir: dir });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('导出文本不含任何明文 key，且给带 key 的条目写 secretRef 占位', () => {
    store.add(DS);
    const file = buildExport(store, { now: new Date('2026-09-09T00:00:00.000Z') });
    const text = serializeExport(file);

    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain('"apiKey"');
    const entry = file.providers.find((p) => p.id === 'ds')!;
    expect(entry.secretRef).toBe('credential:vessel/ds'); // 占位引用，不是密钥
    expect(file.redacted).toBe(true);
    expect(file.keysRedacted).toBe(1);
    expect(file.kind).toBe(PROVIDER_EXPORT_KIND);
    expect(file.version).toBe(PROVIDER_EXPORT_VERSION);
  });

  it('已存在的 secretRef 引用原样保留（不被占位覆盖），且不计入 keysRedacted', () => {
    store.add(ANT);
    const file = buildExport(store);
    const entry = file.providers.find((p) => p.id === 'ant')!;
    expect(entry.secretRef).toBe('credential:vessel/ant');
    expect(file.keysRedacted).toBe(0);
    expect(serializeExport(file)).not.toContain('"apiKey"');
  });

  it('导出不含内置 mock，带 count/current/exportedAt', () => {
    store.add(DS);
    store.add(ANT);
    store.setCurrent('ant');
    const file = buildExport(store, { now: new Date('2026-09-09T01:02:03.000Z') });
    expect(file.providers.map((p) => p.id)).toEqual(['ds', 'ant']);
    expect(file.count).toBe(2);
    expect(file.current).toBe('ant');
    expect(file.exportedAt).toBe('2026-09-09T01:02:03.000Z');
  });

  it('redactProvider 兜底：secretRef 里塞了非 credential: 的值 → 换成占位', () => {
    const { entry, hadKey } = redactProvider(
      { ...DS, secretRef: FAKE_KEY },
      'vessel',
    );
    expect(hadKey).toBe(true);
    expect(entry.secretRef).toBe('credential:vessel/ds');
    expect(JSON.stringify(entry)).not.toContain(FAKE_KEY);
  });

  it('export → 新机器 import：字段一致，且新机器 providers.json 不含明文 key', () => {
    store.add(DS);
    const text = serializeExport(buildExport(store));

    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-xfer2-'));
    try {
      const other = new ProviderStore({ rootDir: otherDir });
      const result = importProviders(other, text);
      expect(result.added).toEqual(['ds']);
      const imported = other.get('ds')!;
      expect(imported.name).toBe('DeepSeek');
      expect(imported.baseUrl).toBe('https://api.deepseek.com/v1');
      expect(imported.model).toBe('deepseek-chat');
      expect(imported.apiKey).toBeUndefined(); // 需本地补录
      expect(imported.secretRef).toBe('credential:vessel/ds');
      expect(fs.readFileSync(other.providersFile, 'utf8')).not.toContain(FAKE_KEY);
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });
});

describe('095 import 合并策略', () => {
  let dir: string;
  let store: ProviderStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-imp-'));
    store = new ProviderStore({ rootDir: dir });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const incoming = (over: Partial<ProviderConfig> = {}): string =>
    JSON.stringify({
      kind: PROVIDER_EXPORT_KIND,
      version: PROVIDER_EXPORT_VERSION,
      providers: [{ id: 'ds', name: 'DeepSeek-new', protocol: 'openai-compatible', baseUrl: 'https://new.example/v1', model: 'deepseek-v4', ...over }],
    });

  it('新增：dry-run 不写盘，真跑写盘并可读回', () => {
    const dry = importProviders(store, incoming(), { dryRun: true });
    expect(dry).toMatchObject({ added: ['ds'], written: false });
    expect(fs.existsSync(store.providersFile)).toBe(false);

    const real = importProviders(store, incoming());
    expect(real).toMatchObject({ added: ['ds'], written: true });
    expect(store.get('ds')?.model).toBe('deepseek-v4');
  });

  it('同名冲突默认 skip：本地配置不变，记入 skipped', () => {
    store.add(DS);
    const result = importProviders(store, incoming());
    expect(result).toMatchObject({ added: [], skipped: ['ds'] });
    expect(store.get('ds')?.name).toBe('DeepSeek');
    expect(store.get('ds')?.baseUrl).toBe('https://api.deepseek.com/v1');
  });

  it('onConflict=overwrite：文件内容覆盖，但保留本地 secretRef 绑定', () => {
    store.add({ ...DS, secretRef: 'credential:vessel/ds' });
    const result = importProviders(store, incoming(), { onConflict: 'overwrite' });
    expect(result).toMatchObject({ overwritten: ['ds'] });
    const next = store.get('ds')!;
    expect(next.name).toBe('DeepSeek-new');
    expect(next.model).toBe('deepseek-v4');
    expect(next.secretRef).toBe('credential:vessel/ds'); // 密钥引用不因覆盖而丢
  });

  it('文件里的明文 apiKey 一律剥离（不落盘、结果里报告）', () => {
    const result = importProviders(store, incoming({ apiKey: FAKE_KEY }));
    expect(result.strippedKeys).toEqual(['ds']);
    expect(fs.readFileSync(store.providersFile, 'utf8')).not.toContain(FAKE_KEY);
    expect(store.get('ds')?.apiKey).toBeUndefined();
  });

  it('内置 mock 一律跳过（不可持久化）', () => {
    const text = JSON.stringify({
      kind: PROVIDER_EXPORT_KIND,
      version: PROVIDER_EXPORT_VERSION,
      providers: [{ id: 'mock', name: 'mock', protocol: 'mock', model: 'mock' }],
    });
    const result = importProviders(store, text);
    expect(result.skipped).toEqual(['mock']);
    expect(fs.existsSync(store.providersFile)).toBe(false);
  });

  it('非法文件 fail loud 且不写盘（非 JSON / 缺 kind / 版本不支持 / protocol 非法 / id 重复）', () => {
    expect(() => importProviders(store, 'not json')).toThrow(ProviderImportError);
    expect(() => importProviders(store, JSON.stringify({ providers: [] }))).toThrow(/kind=/);
    expect(() =>
      importProviders(store, JSON.stringify({ kind: PROVIDER_EXPORT_KIND, version: 99, providers: [] })),
    ).toThrow(/版本不支持/);
    expect(() =>
      importProviders(store, JSON.stringify({ kind: PROVIDER_EXPORT_KIND, version: 1, providers: [{ id: 'x', name: 'x', protocol: 'grpc', model: 'm' }] })),
    ).toThrow(/protocol 非法/);
    expect(() =>
      importProviders(
        store,
        JSON.stringify({
          kind: PROVIDER_EXPORT_KIND,
          version: 1,
          providers: [
            { id: 'dup', name: 'a', protocol: 'mock', model: 'm' },
            { id: 'dup', name: 'b', protocol: 'mock', model: 'm' },
          ],
        }),
      ),
    ).toThrow(/id 重复/);
    expect(fs.existsSync(store.providersFile)).toBe(false);
  });

  it('裸数组（手写/第三方）也能解析，未知字段被白名单丢弃', () => {
    const parsed = parseImportFile(JSON.stringify([{ id: 'x', name: 'X', protocol: 'mock', model: 'm', junk: 'drop-me' }]));
    expect(parsed.providers).toEqual([{ id: 'x', name: 'X', protocol: 'mock', model: 'm' }]);
  });
});
