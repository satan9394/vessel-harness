import { describe, it, expect } from 'vitest';
import { PROVIDER_CATALOG, findPreset, PROVIDER_CATEGORY_LABELS } from './presets.data.js';

// task 098: catalog assertions moved here with the module (apps/cli and
// benchmarks/runners both consume it via @vessel/application). The CLI-side
// picker surface tests stay in apps/cli/src/providers/presets.test.ts.
describe('provider catalog (V0.8, task 025)', () => {
  it('has 55+ sourced provider presets', () => {
    expect(PROVIDER_CATALOG.length).toBeGreaterThanOrEqual(55);
  });

  it('all preset ids are unique', () => {
    const ids = PROVIDER_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every preset has a legal protocol and category', () => {
    const protocols = new Set(['mock', 'openai-compatible', 'anthropic']);
    for (const p of PROVIDER_CATALOG) {
      expect(protocols.has(p.protocol), `bad protocol on ${p.id}`).toBe(true);
      expect(p.category in PROVIDER_CATEGORY_LABELS, `bad category on ${p.id}`).toBe(true);
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it('every category is covered by the labels map', () => {
    const cats = new Set(PROVIDER_CATALOG.map((p) => p.category));
    for (const c of cats) expect(PROVIDER_CATEGORY_LABELS[c as keyof typeof PROVIDER_CATEGORY_LABELS]).toBeTruthy();
  });

  it('non-mock presets that need auth carry a non-empty baseUrl (except env/oauth/placeholder note)', () => {
    // exempt: env-credential auth (azure/vertex/bedrock/cloudflare), self-host
    // placeholders (newapi/oneapi-override), subscription-no-public-endpoint (packycode)
    const exempt = new Set(['mock', 'azure-openai', 'cloudflare', 'newapi', 'github-copilot', 'packycode']);
    for (const p of PROVIDER_CATALOG) {
      if (exempt.has(p.id) || p.auth === 'env' || p.auth === 'oauth') continue;
      if (p.protocol !== 'mock') {
        expect(p.baseUrl.length, `baseUrl empty on ${p.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('MiniMax uses the current minimaxi.com endpoint (old minimax.chat deprecated)', () => {
    expect(findPreset('minimax')?.baseUrl).toContain('minimaxi.com');
    expect(findPreset('minimax')?.baseUrl).not.toContain('minimax.chat');
  });

  it('keeps the original 12 preset ids intact (backward compat)', () => {
    for (const id of ['anthropic', 'openai', 'deepseek', 'qwen', 'kimi', 'glm', 'minimax', 'hunyuan', 'openrouter', 'vllm', 'ollama', 'mock']) {
      expect(findPreset(id), `missing ${id}`).toBeDefined();
    }
  });

  it('covers all four target categories with real entries', () => {
    const byCat = (c: string) => PROVIDER_CATALOG.filter((p) => p.category === c);
    expect(byCat('official').length).toBeGreaterThanOrEqual(8);
    expect(byCat('cn').length).toBeGreaterThanOrEqual(10);
    expect(byCat('aggregator').length).toBeGreaterThanOrEqual(8);
    expect(byCat('local').length).toBeGreaterThanOrEqual(3);
  });

  it('exposes the opencode-go preset consumed by the real-model lane (task 098 SSOT)', () => {
    const preset = findPreset('opencode-go');
    expect(preset?.protocol).toBe('openai-compatible');
    expect(preset?.baseUrl).toBe('https://opencode.ai/zen/go/v1');
  });
});
