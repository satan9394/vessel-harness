import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProviderStore, BUILTIN_MOCK_PROVIDER } from './ProviderStore.js';
import { findPreset } from './presets.js';
import { runSetupWizard, maskKey, type SetupIO, type FetchOutcome } from './setup.js';
import type { ProviderPreset } from './presets.js';
import type { ProviderConfig } from './ProviderStore.js';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cah-setup-'));
}

/** deterministic fetch override: returns canned models for any openai-compatible call. */
function fakeFetch(models: string[]): (protocol: ProviderConfig['protocol'], baseUrl: string, apiKey?: string) => Promise<FetchOutcome> {
  return async (_protocol, _baseUrl) => ({ ok: true as const, models, note: 'fake' });
}

/** Scripted SetupIO: feeds canned answers in order; records calls. */
function scriptedIO(answers: {
  pick?: 'deepseek' | 'anthropic' | 'custom' | 'mock' | 'vllm';
  baseUrl?: string;
  apiKey?: string | symbol;
  reuse?: boolean;
  models?: string[];
  manual?: string[];
  write?: boolean;
  overwrite?: boolean;
  setDefault?: boolean;
  calls?: string[];
}): SetupIO {
  const calls = answers.calls ?? [];
  const pickPreset = (kind: string): { kind: 'preset'; preset: ProviderPreset } | { kind: 'custom' } => {
    if (kind === 'custom') return { kind: 'custom' };
    if (kind === 'mock') return { kind: 'preset', preset: BUILTIN_MOCK_PROVIDER as unknown as ProviderPreset };
    const id = kind === 'vllm' ? 'vllm' : kind;
    const preset = findPreset(id);
    if (!preset) return { kind: 'custom' };
    return { kind: 'preset', preset };
  };
  return {
    async pickProvider() {
      calls.push('pickProvider');
      return pickPreset(answers.pick ?? 'deepseek');
    },
    async askBaseUrl() {
      calls.push('askBaseUrl');
      return answers.baseUrl ?? 'https://custom.example/v1';
    },
    async askApiKey() {
      calls.push('askApiKey');
      return answers.apiKey ?? 'sk-test-12345';
    },
    async confirmReuseKey() {
      calls.push('confirmReuseKey');
      return answers.reuse ?? false;
    },
    async pickModels(models: string[]) {
      calls.push('pickModels');
      if (answers.models === undefined) return models.slice(0, 1);
      return answers.models;
    },
    async askManualModels() {
      calls.push('askManualModels');
      return answers.manual ?? ['manual-model-1'];
    },
    async confirmSetDefault() {
      calls.push('confirmSetDefault');
      return answers.setDefault ?? true;
    },
    async confirmOverwrite() {
      calls.push('confirmOverwrite');
      return answers.overwrite ?? true;
    },
    async confirmWrite() {
      calls.push('confirmWrite');
      return answers.write ?? true;
    },
  };
}

describe('setup wizard — scripted full flow (task 019)', () => {
  let root: string;
  let store: ProviderStore;
  beforeEach(() => {
    root = tmpRoot();
    store = new ProviderStore({ rootDir: root });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('full preset flow: deepseek → key → models → default → saved', async () => {
    const calls: string[] = [];
    const io = scriptedIO({
      calls,
      models: ['deepseek-chat', 'deepseek-reasoner'],
      setDefault: true,
    });
    const id = await runSetupWizard({ store, io, fetchModels: fakeFetch(['deepseek-chat', 'deepseek-reasoner', 'model-x']) });
    expect(id).toBe('deepseek');
    // order follows the spec: pick → key → models → write → set default
    expect(calls).toEqual(['pickProvider', 'askApiKey', 'pickModels', 'confirmWrite', 'confirmSetDefault']);
    const saved = store.get('deepseek');
    expect(saved?.protocol).toBe('openai-compatible');
    expect(saved?.baseUrl).toContain('deepseek');
    expect(saved?.apiKey).toBe('sk-test-12345');
    expect(saved?.models).toEqual(['deepseek-chat', 'deepseek-reasoner']);
    expect(saved?.model).toBe('deepseek-chat'); // first picked = default
    expect(store.getCurrent()).toBe('deepseek'); // set as default
  });

  it('mock preset returns without writing config files', async () => {
    const io = scriptedIO({ pick: 'mock' });
    const id = await runSetupWizard({ store, io, fetchModels: fakeFetch(['deepseek-chat', 'deepseek-reasoner', 'model-x']) });
    expect(id).toBe('mock');
    expect(store.load()).toEqual([]);
    expect(store.getCurrent()).toBe('mock');
  });

  it('cancel at provider pick returns null and writes nothing', async () => {
    const io = { ...scriptedIO({}), pickProvider: async () => ({ kind: 'custom' as const }), askBaseUrl: async () => ({}) } as unknown as SetupIO;
    // simulate cancel: make pickProvider return a symbol via an overridden io
    const cancelIO: SetupIO = { ...io, pickProvider: async () => Symbol('cancel') as unknown as symbol };
    const id = await runSetupWizard({ store, io: cancelIO });
    expect(id).toBeNull();
    expect(store.load()).toEqual([]);
  });

  it('key idempotence: saved key is reused without asking again', async () => {
    // pre-save a provider with a key
    store.add({ id: 'deepseek', name: 'DeepSeek', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-existing', model: 'deepseek-chat' });
    const calls: string[] = [];
    const io = scriptedIO({ calls, reuse: true, models: ['deepseek-chat'] });
    const id = await runSetupWizard({ store, io, fetchModels: fakeFetch(['deepseek-chat', 'deepseek-reasoner', 'model-x']) });
    expect(id).toBe('deepseek');
    expect(calls).not.toContain('askApiKey'); // reused, no re-entry
    expect(calls).toContain('confirmReuseKey');
    expect(store.get('deepseek')?.apiKey).toBe('sk-existing');
  });

  it('model fetch failure → manual model entry path is offered', async () => {
    const calls: string[] = [];
    const io = scriptedIO({ calls, pick: 'vllm', manual: ['custom-model'], models: undefined });
    // vllm preset baseUrl is localhost:8000 — simulate fetch failure → manual path
    const id = await runSetupWizard({
      store,
      io,
      fetchModels: async () => ({ ok: false, reason: 'network', message: '模拟网络失败' }),
    });
    expect(calls).toContain('askManualModels');
    const saved = store.get('vllm');
    expect(saved?.models).toEqual(['custom-model']);
    expect(id).toBe('vllm');
  });

  it('custom endpoint flow asks for base-url and derives the provider id', async () => {
    const calls: string[] = [];
    const io = scriptedIO({ calls, pick: 'custom', baseUrl: 'https://gateway.example.com/v1', apiKey: 'sk-custom', models: ['m1'] });
    const id = await runSetupWizard({ store, io, fetchModels: fakeFetch(['deepseek-chat', 'deepseek-reasoner', 'model-x']) });
    expect(id).toBe('gateway-example-com-v1'.slice(0, 40));
    expect(calls).toContain('askBaseUrl');
    const saved = store.load()[0];
    expect(saved?.baseUrl).toBe('https://gateway.example.com/v1');
  });

  it('confirmWrite=false cancels before writing', async () => {
    const io = scriptedIO({ write: false });
    const id = await runSetupWizard({ store, io, fetchModels: fakeFetch(['deepseek-chat', 'deepseek-reasoner', 'model-x']) });
    expect(id).toBeNull();
    expect(store.load()).toEqual([]);
  });

  it('maskKey hides the middle of the key', () => {
    expect(maskKey('sk-abcdef123456')).toBe('sk-****456');
    expect(maskKey('short')).toBe('****');
  });
});
