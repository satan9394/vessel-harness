import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderRoutes } from '@vessel/local-server';
import { ProviderStore } from './ProviderStore.js';
import { profileCommands } from './profileCommands.js';

describe('provider profile commands', () => {
  let dir: string;
  let store: ProviderStore;
  const key = 'fake-profile-test-key';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-profile-cli-'));
    const secrets = new Map<string, string>();
    store = new ProviderStore({ rootDir: dir, credentialStore: { backend: 'memory',
      setSync: (s, a, value) => { secrets.set(`${s}/${a}`, value); },
      getSync: (s, a) => secrets.get(`${s}/${a}`) ?? null,
      deleteSync: (s, a) => { secrets.delete(`${s}/${a}`); },
    } });
    store.add({ id: 'local', name: 'Local', protocol: 'openai-compatible', model: 'old', baseUrl: 'http://localhost:9999/v1', apiKey: key });
  });
  afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });
  function run(args: string[], entries: [string, string][] = []) {
    const out: string[] = []; const err: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation(value => { out.push(String(value)); });
    const error = vi.spyOn(console, 'error').mockImplementation(value => { err.push(String(value)); });
    try {
      const code = profileCommands(store, args, new Map(entries));
      expect(out.join('') + err.join('')).not.toContain(key);
      expect(out.join('') + err.join('')).not.toContain('secretRef');
      expect(out.join('') + err.join('')).not.toMatch(/"apiKey"/);
      return { code, out: out.join('\n'), err: err.join('\n') };
    } finally { log.mockRestore(); error.mockRestore(); }
  }
  it('lists empty and saved profiles in human and JSON form, using store methods', () => {
    expect(run(['list'])).toEqual({ code: 0, out: '无 profile。', err: '' });
    expect(JSON.parse(run(['list'], [['json', 'true']]).out)).toEqual({ profiles: [] });
    const save = vi.spyOn(store, 'saveProfile');
    expect(run(['save', 'work'], [['provider', 'local'], ['model', 'new'], ['base-url', 'http://localhost:8888/v1'], ['label', 'Work']]).out).toBe('已保存 profile work');
    expect(save).toHaveBeenCalledWith('work', { provider: 'local', model: 'new', baseUrl: 'http://localhost:8888/v1', label: 'Work' });
    expect(run(['list']).out).toBe('work  provider=local  model=new  baseUrl=http://localhost:8888/v1');
    expect(JSON.parse(run(['list'], [['json', 'true']]).out)).toEqual({ profiles: store.listProfiles() });
    run(['save', 'work'], [['provider', 'local']]);
    expect(run(['list']).out).toBe('work  provider=local  model=-  baseUrl=-');
  });
  it('uses profiles via the store and emits the same safe DTO as HTTP', () => {
    store.saveProfile('work', { provider: 'local', model: 'new' });
    const use = vi.spyOn(store, 'useProfile');
    expect(run(['use', 'work']).out).toBe('已启用 profile work（provider=local）');
    expect(use).toHaveBeenCalledWith('work');
    const result = run(['use', 'work'], [['json', 'true']]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({ provider: new ProviderRoutes(() => store).list()[0] });
    expect(store.get('local')?.model).toBe('new');
    expect(store.getCurrent()).toBe('local');
  });
  it.each([
    { args: ['save', 'work'], flags: [] },
    { args: ['save', 'bad name'], flags: [['provider', 'local']] },
    { args: ['save', 'work'], flags: [['provider', 'absent']] },
    { args: ['save', 'work'], flags: [['provider', 'local'], ['base-url', 'file:///tmp']] },
    { args: ['use', 'absent'], flags: [] },
    { args: ['use'], flags: [] },
    { args: ['delete'], flags: [] },
    { args: ['unknown'], flags: [] },
  ] satisfies { args: string[]; flags: [string, string][] }[])('returns 2 with actionable errors for $args', ({ args, flags }) => {
    const result = run(args, flags);
    expect(result.code).toBe(2); expect(result.out).toBe(''); expect(result.err).not.toBe('');
  });
  it('deletes idempotently and reports dangling profiles without exposing backend errors', () => {
    expect(run(['delete', 'missing']).code).toBe(0);
    store.saveProfile('work', { provider: 'local' });
    expect(run(['delete', 'work']).out).toBe('已删除 profile work');
    expect(run(['delete', 'work']).code).toBe(0);
    store.saveProfile('work', { provider: 'local' });
    expect(run(['delete', 'work'], [['json', 'true']])).toEqual({ code: 0, out: JSON.stringify({ ok: true }, null, 2), err: '' });
    expect(run(['delete', 'work'], [['json', 'true']])).toEqual({ code: 0, out: JSON.stringify({ ok: true }, null, 2), err: '' });
    store.saveProfile('work', { provider: 'local' });
    // Simulate externally removed provider data; normal removal rejects profile references.
    fs.writeFileSync(path.join(dir, 'providers.json'), '[]');
    expect(run(['use', 'work']).code).toBe(2);
    vi.spyOn(store, 'listProfiles').mockImplementation(() => { throw new Error(key); });
    const failed = run(['list'], [['json', 'true']]);
    expect(JSON.parse(failed.err)).toMatchObject({ error: { code: 2 } });
  });
});
