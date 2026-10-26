import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderStore } from './ProviderStore.js';

describe('provider profile snapshots', () => {
  let dir: string;
  let store: ProviderStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-profiles-'));
    store = new ProviderStore({ rootDir: dir });
    store.add({ id: 'local', name: 'Local', protocol: 'openai-compatible', model: 'original',
      baseUrl: 'http://localhost:9999/v1', endpoints: [{ url: 'http://localhost:9998/v1' }] });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('saves sorted snapshots, trims names, overwrites by name and preserves the bare provider array', () => {
    const before = fs.readFileSync(store.providersFile, 'utf8');
    store.saveProfile('z', { provider: 'local', model: 'z' });
    store.saveProfile(' a ', { provider: 'local', model: 'a', label: 'First' });
    store.saveProfile('z', { provider: 'local', baseUrl: 'http://localhost:8888/v1' });
    expect(store.listProfiles()).toEqual([
      { name: 'a', provider: 'local', model: 'a', label: 'First' },
      { name: 'z', provider: 'local', baseUrl: 'http://localhost:8888/v1' },
    ]);
    expect(JSON.parse(fs.readFileSync(store.profilesFile, 'utf8'))).toEqual({ version: 1, profiles: {
      a: { provider: 'local', model: 'a', label: 'First' }, z: { provider: 'local', baseUrl: 'http://localhost:8888/v1' },
    } });
    expect(fs.readFileSync(store.providersFile, 'utf8')).toBe(before);
    expect(Array.isArray(JSON.parse(before))).toBe(true);
  });

  it.each(['', '   ', 'x'.repeat(65), 'two words', 'two\twords', 'two\nwords'])('rejects invalid name %j', name => {
    expect(() => store.saveProfile(name, { provider: 'local' })).toThrow('invalid_profile_name');
    expect(fs.existsSync(store.profilesFile)).toBe(false);
  });
  it('rejects missing providers and invalid optional fields', () => {
    expect(() => store.saveProfile('absent', { provider: 'absent' })).toThrow('unknown_provider');
    expect(() => store.saveProfile('bad', { provider: 'local', model: '' })).toThrow('invalid_profile_input');
    expect(() => store.saveProfile('bad', { provider: 'local', baseUrl: 'file:///tmp' })).toThrow('invalid_base_url');
  });
  it('applies only supplied overrides, retains provider metadata and selects the provider', () => {
    const original = store.get('local')!;
    store.saveProfile('model', { provider: 'local', model: 'changed', label: 'Display only' });
    expect(store.useProfile('model')).toEqual({ ...original, model: 'changed' });
    expect(store.getCurrent()).toBe('local');
    store.saveProfile('url', { provider: 'local', baseUrl: 'http://localhost:8888/v1' });
    expect(store.useProfile('url')).toEqual({ ...original, model: 'changed', baseUrl: 'http://localhost:8888/v1' });
    store.saveProfile('plain', { provider: 'local' });
    expect(store.useProfile('plain')).toEqual(store.get('local'));
    expect(Array.isArray(JSON.parse(fs.readFileSync(store.providersFile, 'utf8')))).toBe(true);
  });
  it('reports unknown and dangling profiles without recreating the removed provider', () => {
    expect(() => store.useProfile('missing')).toThrow('unknown_profile');
    store.saveProfile('saved', { provider: 'local' });
    // Simulate an external edit, bypassing the store's deletion guard.
    fs.writeFileSync(store.providersFile, '[]');
    expect(() => store.useProfile('saved')).toThrow('dangling_profile_provider');
    expect(store.load()).toEqual([]);
  });
  it('renames only the profile name, preserving content and provider bytes', () => {
    store.saveProfile('old', { provider: 'local', model: 'saved', baseUrl: 'http://localhost:8888/v1', label: 'Work' });
    store.saveProfile('keep', { provider: 'local', label: 'Keep' });
    store.setCurrent('local');
    const before = store.listProfiles();
    const providerBytes = fs.readFileSync(store.providersFile, 'utf8');
    const currentBytes = fs.readFileSync(store.currentFile, 'utf8');
    expect(store.renameProfile(' old ', ' new ')).toEqual({ ...before.find(p => p.name === 'old'), name: 'new' });
    expect(store.listProfiles()).toEqual(before.map(p => p.name === 'old' ? { ...p, name: 'new' } : p));
    expect(fs.readFileSync(store.providersFile, 'utf8')).toBe(providerBytes);
    expect(fs.readFileSync(store.currentFile, 'utf8')).toBe(currentBytes);
    expect(() => store.useProfile('old')).toThrow('unknown_profile');
    expect(store.useProfile('new').model).toBe('saved');
  });
  it('rejects renaming to an existing profile without changing either snapshot', () => {
    store.saveProfile('old', { provider: 'local', model: 'old-model' });
    store.saveProfile('new', { provider: 'local', model: 'new-model' });
    const before = fs.readFileSync(store.profilesFile, 'utf8');
    expect(() => store.renameProfile('old', 'new')).toThrow('profile_already_exists');
    expect(fs.readFileSync(store.profilesFile, 'utf8')).toBe(before);
  });
  it('rejects renaming a missing profile without writing a file', () => {
    expect(() => store.renameProfile('missing', 'new')).toThrow('unknown_profile');
    expect(store.listProfiles()).toEqual([]);
    expect(fs.existsSync(store.profilesFile)).toBe(false);
  });
  it('validates rename target names before writing', () => {
    store.saveProfile('old', { provider: 'local' });
    const before = fs.readFileSync(store.profilesFile, 'utf8');
    expect(() => store.renameProfile('old', 'two words')).toThrow('invalid_profile_name');
    expect(fs.readFileSync(store.profilesFile, 'utf8')).toBe(before);
  });

  it('deletes existing snapshots and returns false for missing ones', () => {
    expect(store.deleteProfile('missing')).toBe(false);
    expect(fs.existsSync(store.profilesFile)).toBe(false);
    store.saveProfile('saved', { provider: 'local' });
    expect(store.deleteProfile('saved')).toBe(true);
    expect(store.deleteProfile('saved')).toBe(false);
    expect(store.listProfiles()).toEqual([]);
  });
  it('refuses removal with sorted reference names and leaves files unchanged', () => {
    store.saveProfile('z', { provider: 'local' });
    store.saveProfile('a', { provider: 'local' });
    const before = [store.providersFile, store.profilesFile].map(file => fs.readFileSync(file, 'utf8'));
    expect(store.profilesFor('local')).toEqual(['a', 'z']);
    expect(() => store.remove('local')).toThrow('provider_in_use: "local" profiles: a, z; use --force');
    expect([store.providersFile, store.profilesFile].map(file => fs.readFileSync(file, 'utf8'))).toEqual(before);
  });
  it('force cascades only referencing profiles and resets the current provider', () => {
    store.add({ id: 'other', name: 'Other', protocol: 'openai-compatible', model: 'other' });
    store.saveProfile('keep', { provider: 'other' });
    store.saveProfile('work', { provider: 'local' });
    store.saveProfile('home', { provider: 'local' });
    store.setCurrent('local');
    store.remove('local', { force: true });
    expect(store.listProfiles()).toEqual([{ name: 'keep', provider: 'other' }]);
    expect(store.get('local')).toBeUndefined();
    expect(store.getCurrent()).toBe('mock');
  });
  it('removes a provider without profile references normally', () => {
    store.remove('local');
    expect(store.load()).toEqual([]);
    expect(store.listProfiles()).toEqual([]);
    expect(fs.existsSync(store.profilesFile)).toBe(false);
  });
  it('rolls back profiles and current selection when provider persistence fails', () => {
    store.saveProfile('work', { provider: 'local', model: 'saved' });
    store.setCurrent('local');
    const files = [store.providersFile, store.profilesFile, store.currentFile];
    const before = files.map(file => fs.readFileSync(file, 'utf8'));
    const save = vi.spyOn(store, 'save').mockImplementationOnce(() => { throw new Error('write_failed'); });
    try { expect(() => store.remove('local', { force: true })).toThrow('write_failed'); }
    finally { save.mockRestore(); }
    expect(files.map(file => fs.readFileSync(file, 'utf8'))).toEqual(before);
    expect(store.getCurrent()).toBe('local');
    expect(store.profilesFor('local')).toEqual(['work']);
  });
  it('reads a missing file as empty without creating it or its parent', () => {
    const fresh = new ProviderStore({ rootDir: path.join(dir, 'absent') });
    expect(fresh.listProfiles()).toEqual([]);
    expect(fs.existsSync(fresh.rootDir)).toBe(false);
  });
  it.each(['{broken', '[]', '{"version":2,"profiles":{}}', '{"version":1,"profiles":{"bad name":{"provider":"local"}}}'])('fails loudly on corrupt file %s', content => {
    fs.writeFileSync(store.profilesFile, content);
    expect(() => store.listProfiles()).toThrow('provider_profiles_corrupted');
    expect(() => store.saveProfile('safe', { provider: 'local' })).toThrow('provider_profiles_corrupted');
    expect(fs.readFileSync(store.profilesFile, 'utf8')).toBe(content);
  });
});
