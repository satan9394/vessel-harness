import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { en, zh } from '../../i18n';
import { localizePreset, PRESET_CATEGORIES, PROVIDER_PRESETS_CATALOG } from './presetsData';

describe('web provider catalog snapshot', () => {
  it('localizes every English name and description without changing connection metadata', () => {
    for (const preset of PROVIDER_PRESETS_CATALOG) {
      const english = localizePreset(preset, 'en');
      expect(`${english.name} ${english.hint ?? ''}`, preset.id).not.toMatch(/[\u3400-\u9fff]/);
      expect({ ...english, name: preset.name, hint: preset.hint }).toEqual({ ...preset, hint: preset.hint });
      expect(localizePreset(preset, 'zh')).toEqual(preset);
    }
  });
  it('keeps all configurable application presets and metadata in sync', () => {
    const source = readFileSync(new URL('../../../../../packages/application/src/providers/presets.data.ts', import.meta.url), 'utf8');
    const entries = source.split('\n').filter(line => line.trim().startsWith('{ id:'));
    expect(PROVIDER_PRESETS_CATALOG.length).toBeGreaterThanOrEqual(55);
    expect(PROVIDER_PRESETS_CATALOG).toEqual(entries.map(line => Object.fromEntries([...line.matchAll(/(\w+): '([^']*)'/g)].map(match => [match[1], match[2]]))));
    expect(new Set(PROVIDER_PRESETS_CATALOG.map(preset => preset.id)).size).toBe(PROVIDER_PRESETS_CATALOG.length);
  });
  it('localizes every category and supports onboarding model interpolation', () => {
    for (const category of PRESET_CATEGORIES) { expect(zh[category.labelKey]).not.toContain('?'); expect(en[category.labelKey]).toBeTruthy(); }
    expect(zh.onboardingRecommendedModels).toContain('{models}'); expect(en.onboardingRecommendedModels).toContain('{models}');
  });
});
