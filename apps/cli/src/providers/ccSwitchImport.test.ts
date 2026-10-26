import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlaintextCredentialStore } from '@vessel/application';
import { ProviderStore } from './ProviderStore.js';
import { importCcSwitch } from './ccSwitchImport.js';

describe('cc-switch explicit export import', () => {
  let dir: string;
  let credentials: PlaintextCredentialStore;
  let store: ProviderStore;
  const key = 'fake-import-secret-793';
  const entry = { id: 'one', protocol: 'openai-compatible', model: 'm', apiKey: key };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-import-'));
    credentials = new PlaintextCredentialStore({ secretsFile: path.join(dir, 'secrets.json') });
    store = new ProviderStore({ rootDir: dir, credentialStore: credentials });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('previews by default and with dryRun + yes without any writes or key output', () => {
    for (const options of [{}, { yes: true, dryRun: true }]) {
      const result = importCcSwitch(store, JSON.stringify([entry]), options);
      expect(result).toMatchObject({ dryRun: true, written: false, added: ['one'] });
      expect(JSON.stringify(result)).not.toContain(key);
      expect(fs.readdirSync(dir)).toEqual([]);
    }
  });

  it('maps both shapes and all aliases, stores credentials, and marks missing keys', () => {
    const result = importCcSwitch(store, JSON.stringify({ providers: [
      { ...entry, baseUrl: 'https://first.example', base_url: 'https://ignored.example' },
      { name: 'two', app_type: 'anthropic', models: ['claude'], base_url: 'https://second.example', key },
      { id: 'three', protocol: 'anthropic', model: 'claude', settingsConfig: { base_url: 'https://third.example' } },
    ] }), { yes: true });
    expect(result).toMatchObject({ written: true, added: ['one', 'two', 'three'], needsKey: ['three'] });
    const raw = fs.readFileSync(store.providersFile, 'utf8');
    expect(raw).not.toContain(key);
    expect(raw).not.toContain('"apiKey"');
    expect(JSON.parse(raw)).toMatchObject([
      { id: 'one', baseUrl: 'https://first.example', secretRef: 'credential:vessel/one' },
      { id: 'two', baseUrl: 'https://second.example', secretRef: 'credential:vessel/two' },
      { id: 'three', baseUrl: 'https://third.example' },
    ]);
    expect(credentials.getSync('vessel', 'one')).toBe(key);
    expect(credentials.getSync('vessel', 'two')).toBe(key);
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it('skips existing and duplicate ids, preserves config, and supports a prefix', () => {
    importCcSwitch(store, JSON.stringify([entry]), { yes: true });
    const before = fs.readFileSync(store.providersFile, 'utf8');
    const skipped = importCcSwitch(store, JSON.stringify([{ ...entry, model: 'changed' }]), { yes: true });
    expect(skipped).toMatchObject({ written: false, skippedExisting: ['one'] });
    expect(fs.readFileSync(store.providersFile, 'utf8')).toBe(before);
    const result = importCcSwitch(store, JSON.stringify([entry, entry]), { yes: true, prefix: 'copy-' });
    expect(result).toMatchObject({ added: ['copy-one'], skippedExisting: ['copy-one'] });
    expect(JSON.parse(fs.readFileSync(store.providersFile, 'utf8')).map((p: { id: string }) => p.id)).toEqual(['one', 'copy-one']);
  });

  it('isolates unsupported rows, reserves mock, and redacts keys mirrored in ids', () => {
    const result = importCcSwitch(store, JSON.stringify([
      null, { ...entry, protocol: 'codex' }, { ...entry, protocol: 'mock' },
      { id: 'missing-model', protocol: 'anthropic', models: [] },
      { ...entry, id: 'mock' }, { ...entry, id: key },
    ]));
    expect(result.unsupported).toEqual([1, 2, 3, 4]);
    expect(result.skippedExisting).toEqual(['mock']);
    expect(result.added).toEqual(['[redacted]']);
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it.each(['{', 'null', '1', '"string"', '{}', '{"providers":{}}'])('rejects invalid input safely: %s', (text) => {
    expect(() => importCcSwitch(store, text)).toThrow(/JSON|array/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('does not migrate legacy keys during preview, accepts BOM and empty arrays', () => {
    fs.writeFileSync(store.providersFile, JSON.stringify([{ ...entry, name: 'One' }]));
    const before = fs.readFileSync(store.providersFile, 'utf8');
    expect(importCcSwitch(store, '\uFEFF[]').added).toEqual([]);
    expect(fs.readFileSync(store.providersFile, 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(dir, 'secrets.json'))).toBe(false);
  });

  it('refuses saving with a store lacking credential support', () => {
    const unsafe = new ProviderStore({ rootDir: dir });
    expect(() => importCcSwitch(unsafe, JSON.stringify([entry]), { yes: true })).toThrow(/CredentialStore/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
