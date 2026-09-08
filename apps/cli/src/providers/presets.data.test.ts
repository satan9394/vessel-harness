import { describe, it, expect } from 'vitest';
import { PROVIDER_CATALOG, findPreset, PROVIDER_CATEGORY_LABELS } from './presets.data.js';
import { providerPickerOptions, PICKER_CATEGORY_TAG, CUSTOM_ENDPOINT_VALUE, PROVIDER_PRESETS } from './presets.js';

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

describe('provider picker surface (task 025 visibility)', () => {
  /** mirror of @clack/prompts default autocomplete filter: query must hit
   * label | hint | value as a lowercase substring (see @clack/prompts dist). */
  function clackFilter(opt: { label: string; hint?: string; value: string }, query: string): boolean {
    const hay = [opt.label, opt.hint ?? '', String(opt.value)].map((s) => s.toLowerCase());
    return hay.some((s) => s.includes(query.toLowerCase()));
  }

  it('exposes every catalog preset plus the custom-endpoint entry, in order', () => {
    const options = providerPickerOptions();
    expect(options.length).toBe(PROVIDER_PRESETS.length + 1);
    expect(options.map((o) => o.value)).toEqual([...PROVIDER_PRESETS.map((p) => p.id), CUSTOM_ENDPOINT_VALUE]);
  });

  it('prefixes every preset label with its category tag (grouped/可辨别)', () => {
    for (const preset of PROVIDER_PRESETS) {
      const opt = providerPickerOptions().find((o) => o.value === preset.id);
      expect(opt, `missing picker option for ${preset.id}`).toBeDefined();
      expect(opt!.label).toBe(`[${PICKER_CATEGORY_TAG[preset.category]}] ${preset.name}`);
    }
  });

  it('custom endpoint is searchable by 自定义, custom (value) and 端点', () => {
    const custom = providerPickerOptions().find((o) => o.value === CUSTOM_ENDPOINT_VALUE);
    expect(custom).toBeDefined();
    expect(String(custom!.value).toLowerCase()).toContain('custom');
    for (const q of ['自定义', 'custom', '端点', '自托管']) {
      expect(clackFilter(custom!, q), `query "${q}" should hit the custom entry`).toBe(true);
    }
  });

  it('every preset stays reachable by english id (value) and by chinese label/category keyword', () => {
    const options = providerPickerOptions();
    // an English-id-only case and a Chinese-name case
    expect(clackFilter(options.find((o) => o.value === 'doubao')!, 'doubao')).toBe(true);
    expect(clackFilter(options.find((o) => o.value === 'doubao')!, '豆包')).toBe(true);
    // category keyword reaches at least one entry per tag
    for (const tag of Object.values(PICKER_CATEGORY_TAG)) {
      expect(options.some((o) => clackFilter(o, tag)), `category keyword "${tag}" should match something`).toBe(true);
    }
    // ids are unique across picker rows
    expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
  });
});
