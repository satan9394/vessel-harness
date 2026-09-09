import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProviderStore, type ProviderConfig } from './ProviderStore.js';

/**
 * providerEndpoints.test.ts — task 096 多端点（store 层）验收测试。
 *
 * 语义：`baseUrl` 恒为默认端点，`endpoints` 是候选池；缺省候选池 = [baseUrl]。
 * 端点增删只动候选池，**不动 baseUrl**（测速建议要不要采纳是用户的事）。
 */

const DS: ProviderConfig = {
  id: 'ds',
  name: 'DeepSeek',
  protocol: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
};

describe('096 ProviderConfig.endpoints', () => {
  let dir: string;
  let store: ProviderStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-ep-'));
    store = new ProviderStore({ rootDir: dir });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('缺省时候选池回退到 baseUrl（source=baseUrl）', () => {
    store.add(DS);
    expect(store.effectiveEndpoints('ds')).toEqual([{ url: 'https://api.deepseek.com/v1', source: 'baseUrl' }]);
  });

  it('addEndpoint 首次把 baseUrl 物化进候选池，再追加新端点；baseUrl 不变', () => {
    store.add(DS);
    store.addEndpoint('ds', 'https://backup.example/v1', 'backup');
    expect(store.effectiveEndpoints('ds')).toEqual([
      { url: 'https://api.deepseek.com/v1', source: 'endpoints' },
      { url: 'https://backup.example/v1', label: 'backup', source: 'endpoints' },
    ]);
    expect(store.get('ds')?.baseUrl).toBe('https://api.deepseek.com/v1');
    // 落盘可读回
    expect(new ProviderStore({ rootDir: dir }).get('ds')?.endpoints).toHaveLength(2);
  });

  it('重复端点 / 空 url / 未知 provider fail loud，且不写盘', () => {
    store.add(DS);
    const before = fs.readFileSync(store.providersFile, 'utf8');
    expect(() => store.addEndpoint('ds', 'https://api.deepseek.com/v1')).toThrow(/already exists/);
    expect(() => store.addEndpoint('ds', '  ')).toThrow(/invalid endpoint url/);
    expect(() => store.addEndpoint('nope', 'https://x/v1')).toThrow(/provider not found/);
    expect(fs.readFileSync(store.providersFile, 'utf8')).toBe(before);
  });

  it('removeEndpoint 按 url 移除；未知 url fail loud；默认端点（baseUrl 回退）不可移除', () => {
    store.add(DS);
    store.addEndpoint('ds', 'https://backup.example/v1');
    store.removeEndpoint('ds', 'https://backup.example/v1');
    expect(store.get('ds')?.endpoints).toBeUndefined(); // 清空 → 回退 baseUrl 语义
    expect(() => store.removeEndpoint('ds', 'https://nope/v1')).toThrow(/endpoint not found/);

    const bare = new ProviderStore({ rootDir: dir });
    expect(() => bare.removeEndpoint('ds', 'https://api.deepseek.com/v1')).toThrow(/默认端点/);
  });

  it('手工写盘的非法 endpoints fail loud（非数组 / url 空 / 重复 url / label 非法）', () => {
    fs.mkdirSync(dir, { recursive: true });
    const cases: unknown[] = [
      'https://x/v1',
      [{ label: 'no-url' }],
      [{ url: '' }],
      [{ url: 'https://a/v1' }, { url: 'https://a/v1' }],
      [{ url: 'https://a/v1', label: '   ' }],
    ];
    for (const bad of cases) {
      fs.writeFileSync(store.providersFile, JSON.stringify([{ ...DS, endpoints: bad }]), 'utf8');
      expect(() => store.load(), JSON.stringify(bad)).toThrow(/endpoint/);
    }
  });

  it('endpoints 随 costMultiplier 等字段一起往返（不干扰既有字段）', () => {
    store.add({ ...DS, costMultiplier: 1.5, endpoints: [{ url: 'https://a/v1', label: 'a' }, { url: 'https://b/v1' }] });
    const cfg = store.get('ds')!;
    expect(cfg.costMultiplier).toBe(1.5);
    expect(cfg.endpoints).toEqual([{ url: 'https://a/v1', label: 'a' }, { url: 'https://b/v1' }]);
    expect(store.effectiveEndpoints('ds').map((e) => e.url)).toEqual(['https://a/v1', 'https://b/v1']);
  });

  it('未知 provider 调 effectiveEndpoints fail loud', () => {
    expect(() => store.effectiveEndpoints('nope')).toThrow(/provider not found/);
  });
});
