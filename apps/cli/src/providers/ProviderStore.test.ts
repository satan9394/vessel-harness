import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlaintextCredentialStore } from '@vessel/application';
import {
  BUILTIN_MOCK_PROVIDER,
  ProviderStore,
  type ProviderConfig,
} from './ProviderStore.js';

/**
 * apps/cli/providers/ProviderStore.test.ts — task 014 验收测试。
 * 临时目录一律 mkdtempSync(os.tmpdir()/...) 并在 afterEach rmSync 清理
 * （仓库统一先例；不触碰真实 ~/.vessel，也不做任何永久删除）。
 */

const SAMPLE: ProviderConfig = {
  id: 'ds',
  name: 'DeepSeek',
  protocol: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  models: ['deepseek-chat', 'deepseek-reasoner'],
};

const ANTH: ProviderConfig = {
  id: 'claude',
  name: 'Anthropic Claude',
  protocol: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'sk-ant-test',
  model: 'claude-sonnet-4-5',
};

describe('ProviderStore', () => {
  let dir: string;
  let store: ProviderStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-provider-'));
    store = new ProviderStore({ rootDir: dir });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('load() on first run returns [] (no file → no error)', () => {
    expect(fs.existsSync(store.providersFile)).toBe(false);
    expect(store.load()).toEqual([]);
  });

  it('add() persists to providers.json (id/name/protocol/baseUrl/apiKey/model/models/note round-trip)', () => {
    store.add(SAMPLE);
    expect(fs.existsSync(store.providersFile)).toBe(true);
    expect(store.load()).toEqual([SAMPLE]);

    // 读回磁盘原文再校验一遍（绕过内存状态）
    const raw = JSON.parse(fs.readFileSync(store.providersFile, 'utf8')) as ProviderConfig[];
    expect(raw).toEqual([SAMPLE]);
  });

  it('list() shows built-in mock first, then user configs in insertion order', () => {
    expect(store.list()).toEqual([BUILTIN_MOCK_PROVIDER]);
    store.add(ANTH);
    store.add(SAMPLE);
    expect(store.list()).toEqual([BUILTIN_MOCK_PROVIDER, ANTH, SAMPLE]);
  });

  it('list() does not duplicate mock even if hand-edited into providers.json', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      store.providersFile,
      JSON.stringify([{ id: 'mock', name: 'mock', protocol: 'mock', model: 'mock' }, SAMPLE]),
      'utf8',
    );
    expect(store.list()).toEqual([BUILTIN_MOCK_PROVIDER, SAMPLE]);
  });

  it('get() finds added configs by id and resolves built-in mock', () => {
    store.add(SAMPLE);
    expect(store.get('ds')).toEqual(SAMPLE);
    expect(store.get('mock')).toEqual(BUILTIN_MOCK_PROVIDER);
    expect(store.get('nope')).toBeUndefined();
  });

  it('remove() deletes a config and keeps the rest', () => {
    store.add(SAMPLE);
    store.add(ANTH);
    store.remove('ds');
    expect(store.get('ds')).toBeUndefined();
    expect(store.load()).toEqual([ANTH]);
  });

  it('rejects duplicate id on add() (fail loud, nothing persisted)', () => {
    store.add(SAMPLE);
    expect(() => store.add({ ...SAMPLE, name: 'Another' })).toThrow(/duplicate provider id: "ds"/);
    expect(store.load()).toEqual([SAMPLE]);
  });

  it('rejects duplicate id inside save()', () => {
    expect(() =>
      store.save([
        SAMPLE,
        { ...ANTH, id: 'ds', name: 'dup' },
      ]),
    ).toThrow(/duplicate provider id: "ds"/);
    // fail loud：未落盘
    expect(fs.existsSync(store.providersFile)).toBe(false);
  });

  it('rejects illegal protocol on add() (fail loud)', () => {
    expect(() =>
      store.add({ ...SAMPLE, protocol: 'gemini' as ProviderConfig['protocol'] }),
    ).toThrow(/invalid protocol "gemini"/);
    expect(store.load()).toEqual([]);
  });

  it('rejects add() without model (fail loud)', () => {
    const { model: _model, ...noModel } = SAMPLE;
    // 运行期校验测试：编译期已缺 model，用 as ProviderConfig 绕过类型检查
    expect(() => store.add(noModel as ProviderConfig)).toThrow(/requires a non-empty "model"/);
    expect(store.load()).toEqual([]);
  });

  it('rejects empty/blank id and missing name (fail loud)', () => {
    expect(() => store.add({ ...SAMPLE, id: '  ' })).toThrow(/invalid provider id/);
    expect(() => store.add({ ...ANTH, name: '' })).toThrow(/requires a non-empty "name"/);
  });

  it('rejects adding or removing built-in mock', () => {
    expect(() => store.add({ ...SAMPLE, id: 'mock' })).toThrow(/built-in/);
    expect(() => store.remove('mock')).toThrow(/built-in/);
  });

  it('current.json persists across store instances (setCurrent → new store → getCurrent)', () => {
    expect(store.getCurrent()).toBe('mock'); // 缺省 mock
    store.add(SAMPLE);
    store.setCurrent('ds');
    expect(fs.existsSync(store.currentFile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(store.currentFile, 'utf8'))).toEqual({ id: 'ds' });

    const reopened = new ProviderStore({ rootDir: dir });
    expect(reopened.getCurrent()).toBe('ds');
  });

  it('setCurrent rejects unknown id (including before any add)', () => {
    expect(() => store.setCurrent('ghost')).toThrow(/provider not found: "ghost"/);
  });

  it('getCurrent falls back to mock when current points at a removed/unknown id', () => {
    store.add(SAMPLE);
    store.setCurrent('ds');
    store.remove('ds');
    expect(store.getCurrent()).toBe('mock');
  });

  it('remove() of the current provider resets current to mock', () => {
    store.add(SAMPLE);
    store.setCurrent('ds');
    store.remove('ds');
    expect(store.getCurrent()).toBe('mock');
    expect(JSON.parse(fs.readFileSync(store.currentFile, 'utf8'))).toEqual({ id: 'mock' });
  });

  it('atomic write: after save the file is parseable, complete, and no .tmp residue', () => {
    store.add(SAMPLE);
    store.add(ANTH);
    const text = fs.readFileSync(store.providersFile, 'utf8');
    expect(text.trim().length).toBeGreaterThan(0);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(JSON.parse(text)).toEqual([SAMPLE, ANTH]);
    expect(fs.existsSync(`${store.providersFile}.tmp`)).toBe(false);
    expect(fs.existsSync(`${store.currentFile}.tmp`)).toBe(false);
  });

  it('rootDir injection isolates stores from real ~/.vessel and from each other', () => {
    expect(store.rootDir).toBe(dir);
    expect(store.providersFile.startsWith(dir)).toBe(true);

    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-provider-iso-'));
    try {
      const other = new ProviderStore({ rootDir: otherDir });
      store.add(SAMPLE);
      expect(store.load()).toEqual([SAMPLE]);
      expect(other.load()).toEqual([]); // 互不干扰
      expect(fs.existsSync(other.providersFile)).toBe(false);
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it('default root is ~/.vessel (os.homedir()/.vessel convention)', () => {
    const dflt = new ProviderStore();
    expect(dflt.providersFile).toBe(path.join(os.homedir(), '.vessel', 'providers.json'));
    expect(dflt.currentFile).toBe(path.join(os.homedir(), '.vessel', 'current.json'));
    // 缺省实例只做路径断言，绝不读写真实 ~/.vessel
  });

  it('load() fails loud on corrupted providers.json', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(store.providersFile, '{ not json', 'utf8');
    expect(() => store.load()).toThrow(/providers file corrupted/);
  });

  it('load() fails loud on a non-array providers.json', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(store.providersFile, JSON.stringify({ id: 'x' }), 'utf8');
    expect(() => store.load()).toThrow(/expected array/);
  });
});

describe('ProviderStore × CredentialStore integration (task 034)', () => {
  let dir: string;
  let credFile: string;
  let cred: PlaintextCredentialStore;
  let store: ProviderStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-provider-cred-'));
    credFile = path.join(dir, 'secrets.json');
    cred = new PlaintextCredentialStore({ secretsFile: credFile });
    store = new ProviderStore({ rootDir: dir, credentialStore: cred });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('add() with apiKey stores the secret and writes secretRef, NOT plaintext in providers.json', () => {
    store.add({ ...SAMPLE }); // SAMPLE.apiKey = 'sk-test'
    // providers.json 不再落明文
    const raw = fs.readFileSync(store.providersFile, 'utf8');
    expect(raw).not.toContain('sk-test');
    const persisted = JSON.parse(raw) as ProviderConfig[];
    expect(persisted[0]?.secretRef).toBe('credential:vessel/ds');
    expect(persisted[0]?.apiKey).toBeUndefined();
    // secret 已入 secrets.json
    expect(cred.getSync('vessel', 'ds')).toBe('sk-test');
  });

  it('get() resolves secretRef back to apiKey transparently', () => {
    store.add({ ...SAMPLE });
    const got = store.get('ds');
    expect(got?.secretRef).toBe('credential:vessel/ds');
    expect(got?.apiKey).toBe('sk-test'); // 解析回 apiKey，调用方无感
  });

  it('migrates a legacy plaintext apiKey in providers.json to secretRef on load', () => {
    // 直接手写旧格式 providers.json（含明文 apiKey、无 secretRef）
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      store.providersFile,
      JSON.stringify([
        { id: 'ds', name: 'DeepSeek', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-legacy', model: 'deepseek-chat' },
      ]),
      'utf8',
    );
    const list = store.load();
    expect(list[0]?.apiKey).toBe('sk-legacy'); // 仍能读出
    // 迁移后：providers.json 改 secretRef、清明文；secret 已入 store
    const raw = JSON.parse(fs.readFileSync(store.providersFile, 'utf8')) as ProviderConfig[];
    expect(raw[0]?.secretRef).toBe('credential:vessel/ds');
    expect(raw[0]?.apiKey).toBeUndefined();
    expect(raw[0]?.name).toBe('DeepSeek'); // 其它字段不受影响
    expect(cred.getSync('vessel', 'ds')).toBe('sk-legacy');
  });

  it('migration is idempotent: second load does not rewrite or re-store', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      store.providersFile,
      JSON.stringify([{ id: 'ds', name: 'DeepSeek', protocol: 'openai-compatible', apiKey: 'sk-x', model: 'm' }]),
      'utf8',
    );
    store.load();
    const afterFirst = fs.readFileSync(store.providersFile, 'utf8');
    const beforeSecond = fs.readFileSync(store.providersFile, 'utf8');
    store.load();
    const afterSecond = fs.readFileSync(store.providersFile, 'utf8');
    expect(afterSecond).toBe(beforeSecond);
    expect(afterSecond).toBe(afterFirst);
    expect(afterSecond).not.toContain('sk-x');
  });

  it('secretRef-only providers (no apiKey) resolve through the store', () => {
    cred.setSync('vessel', 'claude', 'sk-ant-resolved');
    const cfg: ProviderConfig = {
      id: 'claude',
      name: 'Anthropic',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      secretRef: 'credential:vessel/claude',
      model: 'claude-sonnet-4-5',
    };
    store.add(cfg);
    expect(store.get('claude')?.apiKey).toBe('sk-ant-resolved');
  });

  it('without a credentialStore, providers.json keeps plaintext apiKey (backward compat)', () => {
    const plainStore = new ProviderStore({ rootDir: dir });
    plainStore.add({ ...SAMPLE });
    const persisted = JSON.parse(fs.readFileSync(plainStore.providersFile, 'utf8')) as ProviderConfig[];
    expect(persisted[0]?.apiKey).toBe('sk-test');
    expect(persisted[0]?.secretRef).toBeUndefined();
  });

  it('secrets.json uses atomic write (no .tmp residue)', () => {
    store.add({ ...SAMPLE });
    expect(fs.existsSync(`${credFile}.tmp`)).toBe(false);
    expect(fs.existsSync(`${store.providersFile}.tmp`)).toBe(false);
  });
});

describe('ProviderStore 成本倍率 (task 094)', () => {
  let dir: string;
  let store: ProviderStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-provider-mult-'));
    store = new ProviderStore({ rootDir: dir });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('add 写入 costMultiplier 并持久化到 providers.json（重开可读）', () => {
    store.add({ ...SAMPLE, costMultiplier: 1.5 });
    const raw = JSON.parse(fs.readFileSync(store.providersFile, 'utf8')) as ProviderConfig[];
    expect(raw[0]?.costMultiplier).toBe(1.5);
    const reopened = new ProviderStore({ rootDir: dir });
    expect(reopened.get('ds')?.costMultiplier).toBe(1.5);
    expect(reopened.costMultiplierOf('ds')).toBe(1.5);
    expect(reopened.costMultipliers()).toEqual({ ds: 1.5 });
  });

  it('缺省倍率 = 1（字段不写盘；costMultiplierOf 对未设置/不存在的 id 都返回 1）', () => {
    store.add({ ...SAMPLE });
    expect(store.get('ds')?.costMultiplier).toBeUndefined();
    expect(store.costMultiplierOf('ds')).toBe(1);
    expect(store.costMultiplierOf('mock')).toBe(1);
    expect(store.costMultiplierOf('nonexistent')).toBe(1);
    expect(store.costMultipliers()).toEqual({});
    expect(fs.readFileSync(store.providersFile, 'utf8')).not.toContain('costMultiplier');
  });

  it('update 可设 / 可清倍率，且不动其它字段（id 不存在 fail loud）', () => {
    store.add({ ...SAMPLE });
    const next = store.update('ds', { costMultiplier: 2 });
    expect(next.costMultiplier).toBe(2);
    expect(next.model).toBe(SAMPLE.model);
    expect(store.get('ds')?.costMultiplier).toBe(2);

    store.update('ds', { costMultiplier: undefined }); // 显式清除 → 回到缺省 1
    expect(store.get('ds')?.costMultiplier).toBeUndefined();
    expect(store.costMultiplierOf('ds')).toBe(1);

    expect(() => store.update('nope', { costMultiplier: 2 })).toThrow(/provider not found/);
    expect(() => store.update('mock', { costMultiplier: 2 })).toThrow(/built-in/);
  });

  it('非法倍率 fail loud（add / update / 读盘都拦），不落盘半成品', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, '2' as unknown as number]) {
      expect(() => store.add({ ...SAMPLE, id: `bad-${String(bad)}`, costMultiplier: bad }), String(bad)).toThrow(/costMultiplier/);
    }
    expect(fs.existsSync(store.providersFile)).toBe(false); // 一条都没写进去

    store.add({ ...SAMPLE });
    expect(() => store.update('ds', { costMultiplier: -0.5 })).toThrow(/必须是非负有限数字/);
    expect(store.get('ds')?.costMultiplier).toBeUndefined(); // 原值未被改坏

    // 手工把非法值写进 providers.json → 读盘 fail loud（不静默当 1）
    fs.writeFileSync(store.providersFile, JSON.stringify([{ ...SAMPLE, costMultiplier: -3 }]), 'utf8');
    expect(() => store.load()).toThrow(/costMultiplier/);
  });

  it('倍率 0 合法（免计费），并随 save/load 往返', () => {
    store.add({ ...SAMPLE, costMultiplier: 0 });
    expect(store.costMultiplierOf('ds')).toBe(0);
    expect(store.costMultipliers()).toEqual({ ds: 0 });
  });
});
