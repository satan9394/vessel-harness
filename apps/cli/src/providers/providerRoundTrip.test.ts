import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capabilitiesFor } from '@vessel/llm';
import type { SyncCredentialStore } from '@vessel/application';
import { ProviderStore, type ProviderConfig } from './ProviderStore.js';
import { buildExport, importProviders, serializeExport } from './providerTransfer.js';

class FakeCredentials implements SyncCredentialStore {
  readonly backend = 'fake';
  private readonly values = new Map<string, string>();
  setSync(service: string, account: string, secret: string): void { this.values.set(`${service}/${account}`, secret); }
  getSync(service: string, account: string): string | null { return this.values.get(`${service}/${account}`) ?? null; }
  deleteSync(service: string, account: string): void { this.values.delete(`${service}/${account}`); }
}

describe('provider export/import round trip', () => {
  let dir: string;
  const key = 'fake-round-trip-secret-78643';
  const config: ProviderConfig = {
    id: 'example', name: 'Example', protocol: 'openai-compatible',
    baseUrl: 'https://example.invalid/v1', model: 'model-a', models: ['model-a', 'model-b'],
    endpoints: [{ url: 'https://example.invalid/v1', label: 'primary' }, { url: 'https://backup.invalid/v1', label: 'backup' }],
    modelCapabilities: { 'model-a': capabilitiesFor('openai-compatible') },
    catalogEvidence: { verifiedAt: 1, expiresAt: 2, lastAttemptAt: 3, lastError: 'http_500', modelIds: ['model-a'] },
    costMultiplier: 1.25, note: 'round trip', apiKey: key,
  };
  const store = (name: string) => new ProviderStore({ rootDir: path.join(dir, name), credentialStore: new FakeCredentials(), backupKeep: 0 });

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-round-trip-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('preserves every exported provider field without exposing the key', () => {
    const source = store('source');
    source.add(config);
    const first = serializeExport(buildExport(source));
    const target = store('target');
    expect(importProviders(target, first)).toMatchObject({ added: ['example'], skipped: [], written: true });
    const second = serializeExport(buildExport(target));
    expect(JSON.parse(second).providers).toEqual(JSON.parse(first).providers);
    expect(JSON.parse(second).providers[0].endpoints).toEqual(config.endpoints);
    expect(JSON.parse(second).providers[0].modelCapabilities).toEqual(config.modelCapabilities);
    for (const text of [first, second, fs.readFileSync(path.join(dir, 'source', 'providers.json'), 'utf8'), fs.readFileSync(path.join(dir, 'target', 'providers.json'), 'utf8')]) {
      expect(text).not.toContain(key);
      expect(text).not.toContain('"apiKey"');
    }
  });

  it('skips an existing id without changing its record', () => {
    const source = store('source');
    source.add(config);
    const target = store('target');
    target.add({ ...config, name: 'Existing', note: 'keep this', apiKey: 'different-fake-key' });
    const before = fs.readFileSync(path.join(dir, 'target', 'providers.json'), 'utf8');
    const result = importProviders(target, serializeExport(buildExport(source)));
    expect(result).toMatchObject({ added: [], overwritten: [], skipped: ['example'], written: false });
    expect(fs.readFileSync(path.join(dir, 'target', 'providers.json'), 'utf8')).toBe(before);
    expect(target.get('example')).toMatchObject({ name: 'Existing', note: 'keep this', apiKey: 'different-fake-key' });
  });
});
