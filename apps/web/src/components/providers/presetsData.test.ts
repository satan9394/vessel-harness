import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { en, zh } from '../../i18n';
import { PRESET_CATEGORIES, PROVIDER_PRESETS_CATALOG } from './presetsData';

describe('web provider catalog snapshot', () => {
  it('keeps all configurable application presets and metadata in sync', () => {
    const source = readFileSync(new URL('../../../../../packages/application/src/providers/presets.data.ts', import.meta.url), 'utf8');
    const entries = source.split('\n').filter(line => line.trim().startsWith('{ id:') && !line.includes("id: 'mock'"));
    expect(PROVIDER_PRESETS_CATALOG.length).toBeGreaterThanOrEqual(55);
    expect(PROVIDER_PRESETS_CATALOG).toEqual(entries.map(line => Object.fromEntries([...line.matchAll(/(\w+): '([^']*)'/g)].map(match => [match[1], match[2]]))));
    expect(new Set(PROVIDER_PRESETS_CATALOG.map(preset => preset.id)).size).toBe(PROVIDER_PRESETS_CATALOG.length);
  });
  it('localizes every category and supports onboarding model interpolation', () => {
    for (const category of PRESET_CATEGORIES) { expect(zh[category.labelKey]).not.toContain('?'); expect(en[category.labelKey]).toBeTruthy(); }
    expect(zh.onboardingRecommendedModels).toContain('{models}'); expect(en.onboardingRecommendedModels).toContain('{models}');
  });
});
