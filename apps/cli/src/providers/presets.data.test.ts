import { describe, it, expect } from 'vitest';
import { PROVIDER_CATALOG, findPreset, PROVIDER_CATEGORY_LABELS } from './presets.data.js';

describe('provider catalog (V0.7, task 020)', () => {
  it('has 50+ sourced provider presets', () => {
    expect(PROVIDER_CATALOG.length).toBeGreaterThanOrEqual(50);
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

  it('non-mock presets that need auth carry a non-empty baseUrl (except env/oauth note)', () => {
    for (const p of PROVIDER_CATALOG) {
      if (p.id === 'mock' || p.auth === 'oauth' || p.id === 'azure-openai' || p.id === 'newapi') continue;
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
});
