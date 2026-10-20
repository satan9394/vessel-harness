The user wants a comprehensive architecture and UI audit design report for Task 232. They want code-level implementations for:

1. ProviderHub full-screen component architecture + App.tsx seamless integration (full-screen and modal reuse)
2. Advanced ModelChips component complete implementation (search filter, select all/deselect all/invert, count badge, keyboard access, scroll feathering)
3. Lark preset definition (presets.data.ts & presetsData.ts)
4. CSS spec + CDS visual tokens (aligned with impeccable / make-interfaces-feel-better)
5. Unit test strategy + backward compatibility

I should produce a thorough, detailed report with actual code. Let me think carefully about architecture.

Key design decisions:

**ProviderHub architecture:**
- Extract the *body* of ProviderSettingsModal into a shared `ProviderHubPanel` (or `ProviderHubBody`) that is layout-agnostic — no overlay, no modal chrome.
- `ProviderHub.tsx` — full-screen area view: uses the panel, with a page header, sidebar maybe (provider list as a left rail? ambience), and full-height layout.
- `ProviderSettingsModal.tsx` — keeps dialog semantics, focus trap, Escape handling, but renders `<ProviderHubPanel>` inside.
- Shared hook `useProviderRegistry(api)` encapsulates state: providers, loading, loaded, refresh, run, pull, busy, error, notice, form, etc. This avoids duplication — a single source of truth for logic. But the existing modal has all the state. We can extract into a hook `useProviderConsole.ts`.

Let me design:

```
src/components/providers/
  ProviderHub.tsx          // full-screen
  ProviderHubPanel.tsx     // shared body
  ProviderSettingsModal.tsx// modal shell (compat)
  useProviderConsole.ts    // shared state machine
  ModelChips.tsx           // advanced
  ModelFilter.tsx?         // maybe merged into ModelChips
  ProviderCard.tsx
  presetsData.ts
  presets.data.ts (Lark etc.)
  ProviderHub.css or styles
```

Actually the prompt says "presets.data.ts & presetsData.ts" — interesting, two files. Maybe they meant the same. I'll treat `presetsData.ts` as the catalog module. I could define Lark in both places: `presets.data.ts` as raw data (array of `PresetInfo`) and `presetsData.ts` re-exporting plus derived `PROVIDER_PRESETS`. I'll note the ambiguity and provide a coherent design: `presets.data.ts` holds the canonical catalog data, `presetsData.ts` derives typed exports, validation, and the PROVIDER_PRESETS map. That satisfies "presets.data.ts & presetsData.ts".

**Full-screen vs modal reuse:**
Use a single `ProviderHubPanel` with `variant: 'page' | 'dialog'` prop controlling heading semantics (h1 vs h3), scroll containers, max-height. Modal wraps it in the existing overlay/dialog with focus trap. Full-screen is rendered when `area === 'settings'` in App.tsx.

Also need: keep `setShowProviders(true)` global command working. So App.tsx:
- render `{area === 'settings' && <ProviderHub api={api} onChanged={bumpRevision} />}`
- keep modal rendered conditionally for command palette / other call sites.

Actually a cleaner approach: derive modal open state such that when `area === 'settings'`, the modal is *not* shown but navigation goes to the hub. And the palette command becomes "navigate to settings area" rather than opening modal. Backward compat: other callers of `setShowProviders(true)` (e.g., empty state CTA) — we can make a single function `openProviders()` that sets area to 'settings' and optionally focuses. Keep modal for deep-link cases like `initialPreset` (e.g., from a capability error). Provide both.

I'll design `useProviderEntry`:
```ts
const openProviders = useCallback((preset?: string) => {
  setArea('settings');
  setProviderPreset(preset);
}, []);
```
And modal remains available via `showProviders` state for legacy; but if `area === 'settings'` we don't render the modal. Actually simplest: keep the modal state, but the *primary* entry is the area. The palette command navigates to area. Should we delete modal? No — requirement: "保持全局 Modal 调用的兼容性" (keep global Modal call compatibility). So keep `ProviderSettingsModal` exported and functioning, but the settings area renders `ProviderHub`. To avoid double-render, guard: `showProviders && area !== 'settings'`. Hmm, but if user opens modal from palette while in settings area, nothing happens. Better: the compat helper `openProviders(preset)` does:
- if area already 'settings' → dispatch a focus/preset event to hub via a ref or state.
- else setArea('settings').

And keep modal mount only when `showProviders && !areaIsSettings`. Actually, if `openProviders` always navigates to settings, the modal would never be used... but third-party/legacy call sites that do `setShowProviders(true)` directly still work. I'll provide both and explain the deprecation path: `setShowProviders` kept as legacy escape hatch, mapped to a `ProviderHub` launcher that sets area. Then modal only used when `fullScreen={false}` feature flag or when embedded in e.g. a mobile drawer.

Hmm, I think a clean, defensible design:

- Introduce `ProviderHub` (area view).
- Introduce `ProviderHubPanel` (shared body, headless-ish).
- Refactor `ProviderSettingsModal` to render `<ProviderHubPanel variant="dialog" />` — the modal keeps its own overlay, focus trap, escape, aria-modal. All logic from `useProviderConsole`.
- App.tsx: `area === 'settings'` renders `<ProviderHub>`. Palette command `execute: () => { setArea('settings'); setShowProviders(false); }` — with an optional preset param.
- Keep `showProviders` state and the modal for compat: `<ProviderSettingsModal ... />` rendered only if `showProviders && area !== 'settings'`. Hmm this means opening modal from elsewhere still works. Fine.

Actually wait — simplicity: since the modal is now just a shell over the same panel, and the hub is the primary surface, maybe we can make the modal *delegate* to the hub in a "modal" variant. I'll do:

```tsx
// ProviderSettingsModal.tsx
export default function ProviderSettingsModal(props) {
  return <ProviderDialogShell onClose={props.onClose}>
    <ProviderHubPanel variant="dialog" api={props.api} onChanged={props.onChanged} initialPreset={props.initialPreset} />
  </ProviderDialogShell>;
}
```

And `ProviderHub.tsx`:
```tsx
export default function ProviderHub({ api, onChanged, initialPreset }) {
  return <section className="provider-hub" aria-label={t('modelSettings')}>
    <header className="hub-header">…</header>
    <ProviderHubPanel variant="page" …/>
  </section>;
}
```

But careful: the "hub" might want a left column of existing providers and right column of the editor form — a professional workbench. That's the "大气" (grand) design. Let's do a two-pane layout on wide screens:
- Left: `ProviderRegistryList` (list of configured providers with capability details, delete)
- Right: `ProviderComposer` (presets gallery, form, model chips, actions)

In dialog variant, single column stacked. Use CSS grid + container query or `data-variant`.

Good. Let's design the panel layout:

```
<section class="hub-panel" data-variant="page|dialog">
  <div class="hub-toolbar">  // status pills, refresh, close (dialog only)
  <div class="hub-grid">
    <section class="hub-column hub-column--registry">…</section>
    <section class="hub-column hub-column--composer">…</section>
  </div>
</section>
```

Now, the state hook. Let me write `useProviderConsole.ts` carefully, preserving all existing behavior including `providerFailure`, `validateProvider`, pull, test, save, delete, refresh.

Important subtlety from original code: `mounted` ref, focus restore. In the hook we handle mounted. Focus restore stays in the modal shell (dialog-specific).

Let me write:

```ts
export interface ProviderConsoleOptions {
  api: ApiClient;
  onChanged?: () => void;
  initialPreset?: string;
}

export function useProviderConsole({ api, onChanged, initialPreset }: ProviderConsoleOptions) { ... }
```

Returns everything the panel needs.

Now ModelChips advanced implementation. Requirements:
- realtime fuzzy search
- select all / deselect all / invert
- selected count badge ("已选 12 / 86")
- scroll feathering top/bottom masks
- keyboard access
- keep existing props for backward compat

Design:
```ts
export interface ModelChipsProps {
  models: string[];
  selected: string[];
  defaultModel?: string | null;
  onToggle: (model: string) => void;
  onSetDefault?: (model: string) => void;
  onRemove?: (model: string) => void;
  onAdd?: (model: string) => void;
  disabled?: boolean;
  // new
  onBulkChange?: (next: string[]) => void; // preferred bulk channel
  searchPlaceholder?: string;
  maxVisible?: number;
}
```

Bulk semantics: `onToggle` per model is the existing API. For select-all we can call `onToggle` for each unselected model — but that causes N setState calls; in React 18 they batch, fine, but if the parent computes from stale `selected` (each toggle does `selected.includes` on prop), calling toggle N times in a loop with a stale prop will produce wrong results. So bulk must be a dedicated callback `onBulkSelect(next: string[])` or a `onSelectionChange(next: string[])`. I'll add `onSelectionChange?: (next: string[]) => void` and in the panel implement it: `setModels(next.join(', '))`. Fallback if not provided: fall back to looping `onToggle` only when safe? Better: require `onSelectionChange` for bulk buttons; hide bulk controls when absent. Actually the panel always provides it, and for backward compat the bulk bar only appears when `onSelectionChange` is provided OR we derive a safe batched loop. I'll implement: if `onSelectionChange` missing, fall back to sequential `onToggle` inside `startTransition`? No — stale props. Hmm. Since toggles within a single click handler will all see the same `selected` prop (React doesn't re-render until handler returns), looping `onToggle` is actually *safe* if parent's toggle is a functional update keyed by identity: `setSelected(prev => ...)`. But we can't guarantee. The panel's toggle: `onToggle={(m) => setModels(prev => toggleInList(prev, m))}` — functional, so safe. I'll note this and still prefer `onSelectionChange`. Provide fallback with a documented caveat, or simply require. I'll make `onSelectionChange` optional but bulk controls render only when provided OR `onToggle` present, using a helper `applyBulk` that prefers `onSelectionChange`, else for each model computes `willBeSelected` from current `selected` snapshot and calls `onToggle` — documented as requiring a functional parent updater. Fine, mention it.

Actually cleaner and safer: compute the delta and call `onToggle` for each changed model. Since the difference set is computed from the same snapshot, if the parent uses functional updates, all good. If it uses `selected` prop snapshot (non-functional), the last write wins with only the last model toggled. Risk. I'll just recommend `onSelectionChange` and mark the fallback with a dev warning? I'll keep the fallback but document.

Hmm, to keep it clean, let me define the API as:

```ts
export interface ModelChipsProps {
  ...
  onSelectionChange?: (next: string[]) => void;
}
```

And in `ProviderHubPanel`, pass `onSelectionChange={(next) => updateModels(next)}`.

Search: normalize (lowercase, trim), support multi-token AND matching, plus subsequence fuzzy fallback? "实时模糊搜索" — implement a `matchModel(query, model)` with: direct substring (case-insensitive) → subsequence match → score-based sorting. Keep it deterministic and cheap. I'll implement a small scorer:

```ts
function scoreModel(model: string, tokens: string[]): number | null
```
- each token must match by substring or subsequence; score = sum with bonuses for prefix/word-boundary.
Sort filtered results by score desc, then alphabetical. But reordering chips on every keystroke can be jarring — for a filter list it's fine and helpful.

Hmm, but ModelChips is a chip cloud, not a list. With search, chips filtered. Sorting by score is nice. But stability matters: I'll sort by score only when a query is present; otherwise preserve the source order (models then selected).

Selection preservation: selected models that don't match the query should still be visible? Standard UX in filters: show matches; but a selected model hidden by filter is confusing. Options: "已选但被过滤" hint. I'll keep matches-only, with the count badge showing overall selection, plus a toggle "仅显示已选" on the bulk bar. Actually add a filter segmented control: 全部 / 已选 / 未选. That's a nice advanced touch and directly helps "那么多，我不好选择".

Let's do:
- Search input with clear button and `⌘F`-ish? No, just `/` shortcut maybe. Keep simple: Escape clears query when focused.
- Filter tabs: 全部 (all) / 已选 (selected) / 未选 (unselected) with counts.
- Bulk actions: 全选 (select all *visible*) / 全不选 (deselect all *visible*) / 反选 (invert visible). Important: operate on the *filtered* set, so search + select-all is powerful ("Lark 的模型搜索后全选"). Show count of visible matches in the buttons' aria labels ("全选 12 项").
- Count badge: `已选 12 / 86`.
- Scroll region with feathering masks: implement with a wrapper that tracks scrollTop/scrollHeight/clientHeight via `useRef` + `onScroll` + `ResizeObserver`, setting `data-overflow="top|bottom|both|none"` to apply mask-image gradients. Use `mask-image` with `linear-gradient` and CSS custom property for the fade height. Prefers-reduced-transparency? No. Provide fallback: `@supports not (mask-image: linear-gradient(#000, transparent))` → solid border shading.

Also cap height for the chip cloud: `max-height: clamp(...)`.

Keyboard: each chip is a `<button aria-pressed>`; roving tabindex? With many chips, tabbing through 86 chips is painful. Implement roving tabindex within the chip list: arrow keys Left/Right/Up/Down move focus, Home/End, Space/Enter toggles, `*` or `a` toggles all? Keep to ARIA: role="listbox" with aria-multiselectable? Chips as options with `aria-selected`. Hmm — buttons with aria-pressed are simpler and accessible. But roving tabindex requires a composite widget role. Let's use `role="listbox" aria-multiselectable="true"` on the chip container, and each chip `role="option" aria-selected`. Then keyboard: arrows, Home/End, Space toggles. That's a proper ARIA listbox pattern. But the chips also contain a "set default" star button and "remove" button inside — nested interactive elements inside an `option` are not allowed. So better: keep the chip *cloud* as a group of toggle buttons with roving tabindex using `role="toolbar"`? Toolbar with roving tabindex is legit (single tab stop, arrows navigate). Each chip stays a button with aria-pressed. That solves the nested-button problem, since the toolbar roving applies to the chip toggle buttons.

Hmm, but a toolbar containing buttons with inner buttons is also weird. Simplest accessible approach preserving current markup: keep `role="group"`, all buttons tabbable (current behavior), and add optional roving tabindex as enhancement — but nested buttons already exist today (the star/remove buttons are siblings inside a span, not nested inside the toggle button — actually they ARE siblings: `<span class=model-chip><button toggle/><button star/><button remove/></span>`). So toggles are siblings. Good.

I'll implement roving tabindex on the toggle buttons only, within the group, via a container `onKeyDown` handler that finds all `.model-chip-toggle` buttons in the current filtered list and moves focus. tabindex: focused index or 0 for first. That makes the cloud one tab stop. Arrow keys move, Home/End, Space/Enter native. Also `Ctrl/Cmd+A` selects all visible.

Wait: careful with `role="group"` + roving — it's fine, it's a common pattern ("composite widget" without a specific role). I'll document it.

Also need `aria-live` announcement for bulk actions and count changes: a visually hidden `role="status"` element.

Also keep the `onAdd` free-text input: place it in the toolbar area or keep at end of list? Keep as a separate "add custom model" row in the footer, with Enter-to-add and a validation rule (no control chars, no commas).

Also the search should never be a controlled component if `disabled`. Fine.

Now performance: 86 models is fine, but maybe hundreds. Use `useMemo` for filtered list; avoid virtualization (chips are cheap). Mention a `maxVisible` guard? Not needed.

**Lark preset**: 飞书/火山方舟. Lark (Feishu) open platform has an OpenAI-compatible endpoint? Volcengine Ark (火山方舟) base URL: `https://ark.cn-beijing.volces.com/api/v3`. Models: `doubao-pro-32k`, `doubao-pro-128k`, `doubao-lite-32k`, `doubao-1-5-pro-32k-250115`, `deepseek-v3-250324`, etc. Lark/Feishu itself — 飞书开放平台 provides "智能伙伴创建平台" (Aily) — hmm. The user says "Lark（飞书/火山方舟）". I'll define a preset with id `lark`, name `Lark (飞书 · 火山方舟)`, protocol `openai-compatible`, baseUrl `https://ark.cn-beijing.volces.com/api/v3`, defaultModel `doubao-1-5-pro-32k-250115`, models list including doubao series and deepseek on ark, plus `ark` alias maybe. Auth via env `ARK_API_KEY`.

I'll make the preset data shape match the existing `PresetInfo`:
```ts
export interface PresetInfo {
  id: string;
  name: string;
  protocol: AddProviderInput['protocol'];
  baseUrl: string;
  auth?: 'apiKey' | 'oauth' | 'env';
  docsUrl?: string;
  defaultModel?: string;
  models?: string[];  // NEW: seed catalog for the advanced picker
  tags?: string[];
  accent?: string;
}
```
The original code referenced `preset.defaultModel`, `preset.auth`, `preset.protocol`, `preset.baseUrl`, `preset.name`, `preset.id`. I'll extend with `models`, `region`, `docsUrl`, `brand`.

Also the modal's `PROVIDER_PRESETS` maps `preset.defaultModel ? [preset.defaultModel] : []`. With `models` seed, the candidate list can be the full seed catalog and pre-select the default model — that's exactly what enables "已选 1 / 24" then 全选. 

So `PROVIDER_PRESETS` generation becomes:
```ts
const seedModels = preset.models?.length ? preset.models : preset.defaultModel ? [preset.defaultModel] : [];
models: preset.defaultModel && !seedModels.includes(preset.defaultModel) ? [preset.defaultModel, ...seedModels] : ...
```
Simpler: `models: preset.defaultModel ? [preset.defaultModel] : []` for selection, and a separate `candidates` seed = `preset.models`. The panel sets `candidates` from `preset.models ?? preset.models? [defaultModel]`. And `models` (selected) = `[defaultModel]` if present. That preserves backward compat with `AddProviderInput.models` (which is the selected set) while giving the picker a rich candidate list.

Important: `AddProviderInput.models` must remain the *selected* models (that's what gets sent). So `candidates` is UI-only. Good — the existing code already has `candidates` state separate from `models` string.

Lark models list — let me pick plausible ones:
- `doubao-1-5-pro-32k-250115`
- `doubao-1-5-pro-256k-250115`
- `doubao-1-5-lite-32k-250115`
- `doubao-pro-32k`
- `doubao-pro-128k`
- `doubao-lite-32k`
- `doubao-lite-128k`
- `doubao-embedding`? no, chat models only.
- `deepseek-v3-250324`
- `deepseek-r1-250120`
- `kimi-k2-250711`? maybe on ark.
- `qwen-235b-a22b`? Ark hosts some.
Keep to a defensible list of doubao + deepseek + a couple.

Also add `lark` as an alias id maybe `lark` with `tags: ['cn', 'chat', 'vision']`.

Also mention 飞书 Aily / 开放平台 base URL `https://open.feishu.cn/...`? Lark's own AI is not OpenAI-compatible. I'll present the preset as "Lark · 火山方舟 (Volcengine Ark)" with the Ark OpenAI-compatible endpoint and a note that 飞书 Aily 走 OAuth, hence `auth: 'env'` note. Actually to be safe: provide `lark` preset pointing at Ark, with `docsUrl` to Volcengine docs, and note in the report that 飞书自有的 Aily 智能伙伴 uses a different auth and is out of scope / handled by `auth: 'oauth'`.

**CSS/CDS tokens**: Define token layer:
- spacing scale `--cds-space-1..8` (4px base)
- radii `--cds-radius-sm/md/lg/xl/full`
- surface colors: `--cds-surface-0/1/2`, `--cds-border-subtle`, `--cds-text-primary/secondary/tertiary`
- elevation shadows
- motion: `--cds-ease-out`, `--cds-dur-fast/normal`
- focus ring: `--cds-focus-ring` with `:focus-visible` `outline: 2px solid var(--cds-accent); outline-offset: 2px`
- glass/feather masks.

"impeccable / make-interfaces-feel-better" — these are aesthetic principles: optical alignment, tight spacing rhythm, no default browser blue, consistent radii, hairline borders (1px at low alpha), subtle inner highlights, no heavy shadows, purposeful motion (150-200ms), reduced motion support, focus-visible only, tabular numbers for counts, `text-wrap: balance` for headings, `text-wrap: pretty` for body, `font-variant-numeric: tabular-nums` for the badge.

I'll write a full CSS block for the hub + chips + masks.

Also mention `content-visibility: auto` for provider cards? and `scrollbar-gutter: stable`.

**Tests**: 
- `ModelChips.test.tsx`: search filters, bulk select only affects visible, invert, counts, keyboard roving, add model validation, disabled, aria-pressed, back-compat when onSelectionChange absent.
- `ProviderHub.test.tsx`: renders full-screen, loads providers, palette navigation, modal still works, focus trap preserved.
- `useProviderConsole` tests: test/pull/save/delete flows, refresh failure, unmount safety.
- `presetsData` snapshot test: Lark preset shape, unique ids, valid URLs/protocols, no duplicate baseUrl collisions, models ≤ 256, all model names pass the allowed charset.
- Backward compat: `PROVIDER_PRESETS` still exports same keys (DeepSeek/OpenAI/Claude/Ollama/custom + catalog ids); `providerFailure` unchanged; `validateProvider` unchanged.
- i18n keys added; a test asserting every `t()` key used exists in ModelMessages (there may be an existing test pattern).

Let me now write the actual code.

### presets.data.ts

```ts
import type { AddProviderInput } from '../../api';

export type ProviderProtocol = AddProviderInput['protocol'];
export type PresetAuth = 'apiKey' | 'oauth' | 'env';

export interface PresetModelGroup { label: string; models: string[] }

export interface PresetInfo {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  auth?: PresetAuth;
  docsUrl?: string;
  defaultModel?: string;
  models: string[];
  tags?: Array<'cn' | 'global' | 'fast' | 'reasoning' | 'vision' | 'local'>;
  /** brand color for the preset tile accent (hex, contrast-checked against surface) */
  accent?: string;
}
```

Then the catalog array, including Lark.

I need to be careful: the existing catalog is imported as `PROVIDER_PRESETS_CATALOG` from `./presetsData`. I'll keep `presetsData.ts` as the public module that imports from `presets.data.ts`.

Now, code for ProviderHubPanel. Let me sketch the component structure:

```tsx
// ProviderHubPanel.tsx
export type ProviderHubVariant = 'page' | 'dialog';

export interface ProviderHubPanelProps {
  api: ApiClient;
  variant?: ProviderHubVariant;
  initialPreset?: string;
  onChanged?: () => void;
  onRequestClose?: () => void;
}
```

Inside: `const console = useProviderConsole({api, onChanged, initialPreset});`

Render:
- toolbar (variant page: title + status + refresh; dialog: handled by shell header, so maybe just refresh)
- registry column
- composer column

Let me write it.

```tsx
<section className="provider-hub-panel" data-variant={variant} aria-busy={console.loading || !!console.busy}>
  <div className="hub-registry" aria-label={t('providerConfigured')}>
    ...
  </div>
  <form className="hub-composer" ...>
    <PresetsGallery .../>
    <div className="hub-fields">…</div>
    <ModelChips … />
    <div className="hub-actions">…</div>
  </form>
</section>
```

For the registry: search filter for configured providers too? Nice-to-have. Keep a compact list. Actually, with a left column, a small filter input when >8 providers. I'll add a simple filter input — cheap and consistent with "search everywhere". Maybe skip to limit scope; I'll add it as it's a few lines (`useState` + filter). Hmm, keep focus. I'll add a simple one, it's fine.

Let me be careful with the `PresetsGallery` API: `onSelect(preset)` `selectedId` `disabled`. Keep.

Now the ModelChips full implementation. Let me write it thoroughly.

```tsx
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useI18n } from '../LanguageProvider';

export type ModelChipsFilter = 'all' | 'selected' | 'unselected';

export interface ModelChipsProps {
  models: string[];
  selected: string[];
  defaultModel?: string | null;
  onToggle: (model: string) => void;
  onSetDefault?: (model: string) => void;
  onRemove?: (model: string) => void;
  onAdd?: (model: string) => void;
  disabled?: boolean;
  onSelectionChange?: (next: string[]) => void;
  /** optional external query control */
  query?: string;
  onQueryChange?: (q: string) => void;
  emptyHint?: string;
}
```

Implementation details:

```tsx
const universe = useMemo(() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of models) if (!seen.has(m)) { seen.add(m); out.push(m); }
  for (const m of selected) if (!seen.has(m)) { seen.add(m); out.push(m); }
  return out;
}, [models, selected]);
```

Wait — should `selected` models not in `models` be shown? Original does `[...new Set([...models, ...selected])]` — yes. Keep.

Hmm, but for a candidate picker, `models` = candidates, `selected` = chosen. The union preserves user-added ones. Keep same.

Search scoring:

```ts
function normalize(v: string) { return v.toLowerCase(); }
function isSubsequence(needle: string, haystack: string) { ... }
function matchScore(model: string, tokens: string[]): number {
  const hay = model.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    const at = hay.indexOf(token);
    if (at === -1) {
      if (!isSubsequence(token, hay)) return -1;
      score -= 2;
      continue;
    }
    score += 10;
    if (at === 0) score += 8;
    else if (/[^a-z0-9]/.test(hay[at - 1]!)) score += 4;
    score -= Math.min(at, 20) * 0.1;
  }
  if (hay === tokens.join(' ')) score += 20;
  return score;
}
```

Sort only when `tokens.length > 0`.

Filter:
```ts
const visible = useMemo(() => {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const base = universe.filter(m => {
    if (filter === 'selected' && !selected.includes(m)) return false;
    if (filter === 'unselected' && selected.includes(m)) return false;
    if (!tokens.length) return true;
    return matchScore(m, tokens) >= 0;
  });
  if (!tokens.length) return base;
  return base.map(m => ({m, s: matchScore(m, tokens)})).sort((a,b) => b.s - a.s || a.m.localeCompare(b.m)).map(x => x.m);
}, [universe, query, filter, selected]);
```

Note `selected.includes` is O(n) inside filter → O(n²) with 300 models = 90k ops, fine, but let's use a Set.

```ts
const selectedSet = useMemo(() => new Set(selected), [selected]);
```

Bulk:
```ts
const applyBulk = useCallback((mode: 'all' | 'none' | 'invert') => {
  if (disabled) return;
  const visibleSet = new Set(visible);
  let next: string[];
  if (mode === 'all') next = [...new Set([...selected, ...visible])];
  else if (mode === 'none') next = selected.filter(m => !visibleSet.has(m));
  else {
    const kept = selected.filter(m => !visibleSet.has(m));
    const flipped = visible.filter(m => !selectedSet.has(m));
    next = [...kept, ...flipped];
  }
  next = [...new Set(next)];
  onChangeSelection(next, mode);
}, [...]);
```

`onChangeSelection`:
```ts
function onChangeSelection(next: string[], mode) {
  if (onSelectionChange) { onSelectionChange(next); announce(...); return; }
  // legacy fallback: emit toggles for the symmetric difference
  const before = new Set(selected);
  const after = new Set(next);
  for (const m of selected) if (!after.has(m)) onToggle(m);
  for (const m of next) if (!before.has(m)) onToggle(m);
}
```

Note: fallback requires the parent to use functional updates — document in JSDoc. Actually I can make it safe-ish: since the parent's `onToggle` in the old panel does `setModels([...new Set(next)].join(', '))` with `next` computed from `models.split(...)` — that's non-functional (reads `models` state directly). In React, calling setState N times in one handler: each call re-computes from the same closure `models` value → last call wins → only one toggle applied. So the fallback is broken for the current parent. Therefore I should NOT silently fall back. 

Better: make `onSelectionChange` required for bulk UI; if absent, hide bulk controls *unless* `legacyBulk` — no. Cleanest: make bulk controls render only when `onSelectionChange` is provided, and note that ProviderHubPanel always provides it (and that we also updated the panel's toggle to a functional updater). Hmm, but then a standalone ModelChips without `onSelectionChange` loses the feature — acceptable and safe. But it's nicer to always show bulk. Compromise: derive `canBulk = !!onSelectionChange`. And additionally, since we control all in-repo usages, we can just update them. Let's do `canBulk`. And I'll also update the legacy toggle in the panel to functional form regardless, so the fallback... no, keep it simple: `canBulk`.

Hmm, but the audit wants "全选/全不选" — as long as the panel passes `onSelectionChange`, it works. Good. I'll document that `onSelectionChange` is the preferred path and that we pass it from the composer.

Actually — I realize there's another approach that keeps a single prop: define the bulk operation in terms of `onToggle` but require the parent contract "onToggle must be a functional update". The existing panel's `updateModels` uses `setModels(next.join(', '))` where `next` comes from splitting the `models` state string. I could refactor `updateModels` to `setModels(prev => toggle(prev, model))`. Then the fallback works. I'll do both: refactor the composer to functional updates AND provide `onSelectionChange`. Then `canBulk` can be `!!(onSelectionChange || onToggle)` and the fallback is documented as requiring functional parent updates. I'll implement the fallback guarded by a dev-time `console.warn`? No warnings in prod code. I'll just document. Actually no — silent breakage is bad. Decision: bulk controls require `onSelectionChange`. Simple, explicit, testable. The composer provides it. Done.

Hmm, but then the fallback never exists and tests for "legacy" just assert bulk is hidden. That's a clean backward-compat story: no behavior change for existing consumers, new capability opt-in. I like it.

Wait, but the *audit requirement* is the feature must work in the product. It will, via the composer. OK.

Scroll feathering: 

```tsx
const scrollRef = useRef<HTMLDivElement>(null);
const [edges, setEdges] = useState({ top: false, bottom: false });
const measure = useCallback(() => {
  const el = scrollRef.current;
  if (!el) return;
  const top = el.scrollTop > 1;
  const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  setEdges(prev => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
}, []);
useEffect(() => {
  measure();
  const el = scrollRef.current;
  if (!el) return;
  const ro = new ResizeObserver(measure);
  ro.observe(el);
  // also observe the inner list
  const inner = el.firstElementChild;
  if (inner) ro.observe(inner);
  return () => ro.disconnect();
}, [measure, visible.length]);
```
Plus `onScroll={measure}` with `{ passive: true }`? React onScroll is fine.

`data-fade={edges.top && edges.bottom ? 'both' : edges.top ? 'top' : edges.bottom ? 'bottom' : 'none'}`.

CSS uses `mask-image` with two gradients.

Roving tabindex:
```tsx
const [focusIndex, setFocusIndex] = useState(0);
const toggleRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
```
On filter change, if focusIndex >= visible.length, clamp. Use `useEffect` to clamp.

Keyboard handler on the container:
```tsx
function onKeyDown(e