/**
 * apps/cli/providers/presets — provider preset surface for the `vessel setup`
 * wizard. Data lives in @vessel/application (packages/application/src/providers/
 * presets.data.ts — V0.8 catalog, 55+ sourced entries; task 098 moved it down so
 * apps/cli and benchmarks/runners share one SSOT without a build-graph cycle);
 * this module re-exports it with the historical names so setup.ts / tests keep
 * working, and groups by category for the picker.
 */
export { PROVIDER_CATALOG, PROVIDER_CATEGORY_LABELS, findPreset, type ProviderPreset, type ProviderCategory } from '@vessel/application';

import { PROVIDER_CATALOG, type ProviderCategory } from '@vessel/application';

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

/** short searchable tag prefixed onto picker labels so the category is visible
 * and filterable by keyword (官方/国产/国际/聚合/本地) — @clack/prompts
 * autocomplete matches the whole label text. */
export const PICKER_CATEGORY_TAG: Record<ProviderCategory, string> = {
  official: '官方',
  cn: '国产',
  intl: '国际',
  aggregator: '聚合',
  local: '本地',
};

/** one autocomplete option row (value = provider id, '__custom__' = manual endpoint). */
export interface PickerOption {
  value: string;
  label: string;
  hint?: string;
}

/** value reserved for the manual custom-endpoint entry (searchable: label 含"自定义/聚合/自托管/未列出"，value 含 'custom'）。 */
export const CUSTOM_ENDPOINT_VALUE = '__custom__';

/**
 * Options for the supplier picker: every catalog preset with its category tag
 * (task 025 visibility: label 前缀分类标签，类别可辨别且可按中文类别词搜索；
 * English id 仍可经 value 命中 — clack 默认 filter 同时匹配 label|hint|value),
 * plus the always-searchable custom endpoint entry pinned at the end.
 */
export function providerPickerOptions(): PickerOption[] {
  const presets = PROVIDER_CATALOG.map((p) => ({
    value: p.id,
    label: `[${PICKER_CATEGORY_TAG[p.category]}] ${p.name}`,
    hint: p.hint,
  }));
  return [
    ...presets,
    {
      value: CUSTOM_ENDPOINT_VALUE,
      label: '[自定义] 自定义端点（聚合 / 自托管 / 未列出）',
      hint: '手动输入 base-url 与协议（opencode /connect Other 同义入口）',
    },
  ];
}
