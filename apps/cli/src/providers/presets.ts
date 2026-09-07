/**
 * apps/cli/providers/presets — provider preset surface for the `cah setup`
 * wizard. Data lives in presets.data.ts (V0.7 catalog, 50+ sourced entries);
 * this module re-exports it with the historical names so setup.ts / tests keep
 * working, and groups by category for the picker.
 */
export { PROVIDER_CATALOG, PROVIDER_CATEGORY_LABELS, findPreset, type ProviderPreset, type ProviderCategory } from './presets.data.js';

import { PROVIDER_CATALOG } from './presets.data.js';

/** all presets (same list; kept for compatibility with existing imports). */
export const PROVIDER_PRESETS = PROVIDER_CATALOG;

/** presets grouped by category (for a grouped picker / multi-column UI). */
export function presetsByCategory(): Map<string, typeof PROVIDER_PRESETS> {
  const map = new Map<string, typeof PROVIDER_PRESETS>();
  for (const p of PROVIDER_PRESETS) {
    const list = map.get(p.category) ?? [];
    list.push(p);
    map.set(p.category, list);
  }
  return map;
}
