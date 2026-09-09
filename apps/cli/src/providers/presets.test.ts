import { describe, it, expect } from 'vitest';
import { providerPickerOptions, PICKER_CATEGORY_TAG, CUSTOM_ENDPOINT_VALUE, PROVIDER_PRESETS } from './presets.js';

// task 098: the catalog data assertions moved to
// packages/application/src/providers/presets.data.test.ts with the module; this
// file keeps the CLI-side picker surface (apps/cli/src/providers/presets.ts).
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
