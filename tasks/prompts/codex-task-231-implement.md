# Task 231 Implementation Contract for Codex (gpt-6.1-sol)

## Role & Mission
You are Codex (`gpt-6.1-sol`, reasoning_effort: medium), executing in your isolated sandbox workspace.
Your mission: Implement the CC-Switch inspired Provider Hub & Quick Switcher refactoring for Vessel Web UI based on OpenCode's audit report (`evidence/sessions/2026-10-19-opencode-audit-231.md`) and Task Card 231 (`tasks/231-provider-hub-and-cc-switch-reconstruction.md`).

## Hard Constraints
1. **Core Thinness**: `packages/core` modifications MUST BE EXACTLY 0 lines.
2. **Blast Radius**: Strictly modify/add files only within `apps/web/`.
3. **No Breaking Tests**: All existing web tests (including `ProviderSettingsModal.test.tsx` and `TaskComposer.test.tsx`) must pass 100%.
4. **Delete Discipline**: Do not permanently delete files. Windows Recycle Bin only if deletion is ever required.
5. **IME & Logic Integrity**: Retain all existing IME guard logic (`isComposingRef`, `nativeEvent.isComposing`, `keyCode === 229`) and form submission flows in `TaskComposer.tsx`.
6. **Backward Compatibility**: `ProviderSettingsModal.tsx` MUST preserve existing exports:
   - `export const PROVIDER_PRESETS: Record<string, AddProviderInput>`
   - `export function validateProvider(...)`
   - `export function providerFailure(...)`
   And keep DOM IDs (`provider-preset`, `provider-protocol`, `provider-url`, `provider-key`, `provider-models`) and button texts (`Test connection`, `Pull models`, `Testing connection…`, `Pulling models…`, `Delete`, `Cancel`) available so existing tests pass without regressions.

---

## Detailed Implementation Plan

### 1. `apps/web/src/components/providers/presetsData.ts` (New File)
Port and categorize the 55+ authoritative presets from `packages/application/src/providers/presets.data.ts`:
- Define:
  ```ts
  export type ProviderCategory = 'cn' | 'official' | 'aggregator' | 'local' | 'intl';
  export interface PresetInfo {
    id: string;
    name: string;
    protocol: 'openai-compatible' | 'anthropic';
    baseUrl: string;
    defaultModel: string;
    hint?: string;
    category: ProviderCategory;
    auth?: 'api-key' | 'oauth' | 'env' | 'none';
  }
  ```
- Export `PROVIDER_PRESETS_CATALOG: PresetInfo[]` containing the categorized presets (DeepSeek, Kimi Coding, Doubao Seed, Qwen, GLM, Claude Anthropic, OpenAI, Gemini, Grok, Ollama, SiliconFlow, OpenRouter, etc.).
- Export category metadata and helpers:
  ```ts
  export const PRESET_CATEGORIES: { id: ProviderCategory | 'all'; labelKey: keyof ModelMessages }[] = [
    { id: 'all', labelKey: 'presetCategoryAll' },
    { id: 'cn', labelKey: 'presetCategoryCn' },
    { id: 'official', labelKey: 'presetCategoryOfficial' },
    { id: 'aggregator', labelKey: 'presetCategoryAggregator' },
    { id: 'local', labelKey: 'presetCategoryLocal' },
    { id: 'intl', labelKey: 'presetCategoryIntl' },
  ];
  ```

### 2. `apps/web/src/components/providers/ModelChips.tsx` (New File)
Implement modern interactive capsule chips for model selection:
- Props:
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
  }
  ```
- Renders:
  - List of chips for discovered models:
    - Chip item: `.model-chip` (with `.is-selected` when active, `.is-default` when default).
    - Toggle button with checkmark icon when selected.
    - Default star button (★/☆) when selected.
    - Remove button (×) when unselected or custom.
  - Manual add input `.model-chip-input`: press Enter to add a custom model ID.

### 3. `apps/web/src/components/providers/PresetsGallery.tsx` (New File)
Gallery grid view of presets:
- Search filter input + Category tab bar (All / CN / Official / Aggregator / Local / Intl).
- Cards grid `.preset-gallery-grid`:
  - Avatar badge (e.g. `D` for DeepSeek, `A` for Anthropic, `O` for OpenAI, etc.).
  - Title and hint.
  - Default model badge & Category tag.
  - On click: calls `onSelect(preset)`.

### 4. `apps/web/src/components/providers/ModelQuickSwitcher.tsx` (New File)
On-the-fly model switching capsule and dropdown popover:
- Props:
  ```ts
  export interface ActiveModel {
    provider: string;
    model: string;
  }
  export interface ModelQuickSwitcherProps {
    models: ModelOption[];
    current: ActiveModel | null;
    onSelect: (model: ActiveModel) => void;
    onOpenSettings?: () => void;
    disabled?: boolean;
    compact?: boolean;
  }
  ```
- Trigger button:
  - Capsule pill `.model-switcher-trigger`.
  - Online/offline status dot `.model-switcher-dot` (`data-state="online"` / `"offline"`).
  - Display label: `${current.provider} / ${current.model}` or localized "Offline / Select Model".
  - Subtle chevron icon.
- Popover panel `.model-switcher-panel`:
  - Quick search input `.model-switcher-search`.
  - Grouped by provider: `.model-switcher-group` with header.
  - Items `.model-switcher-item` with selection badge.
  - Keyboard navigation: Arrow Up/Down, Enter to select, Escape to close.
  - Outside click listener to dismiss.
  - Footer button to open full provider settings.

### 5. `apps/web/src/components/providers/ProviderSettingsModal.tsx` (Refactor)
- Keep backward-compatible exports (`PROVIDER_PRESETS`, `validateProvider`, `providerFailure`).
- Modal structure:
  - Header: Title and Close button.
  - Existing configured providers section: list of cards showing provider name, masked key, model count, capabilities badge, and Delete button.
  - Preset Selector / Gallery:
    - Presets gallery with category tabs and search, plus a `<select id="provider-preset">` (or dual sync) to ensure existing tests that invoke `change('preset', 'Claude')` succeed seamlessly!
  - Form Fields:
    - Name: `<input id="provider-name" ... />`
    - Protocol: `<select id="provider-protocol" ...>`
    - Base URL: `<input id="provider-url" ... />`
    - API Key: `<input id="provider-key" ... />`
    - Models:
      - Visible `ModelChips` component for modern visual interaction.
      - Hidden or sync-bound `<input id="provider-models" ... />` reflecting comma-joined models so existing test assertions (`find(node => node.props.id === 'provider-models').props.value`) continue to pass!
  - Action buttons:
    - `Test connection` (and `Testing connection…`)
    - `Pull models` (and `Pulling models…`)
    - `Save provider`
    - Test result display: e.g. `Connected · 156 ms`
  - All aria labels, notices, and error messages matching `i18n.ts`.

### 6. `apps/web/src/components/TaskComposer.tsx` (Enhance)
- Maintain all existing refs, form submit logic, and IME guards.
- Integrate `ModelQuickSwitcher`:
  - Show the `ModelQuickSwitcher` component or keep a clean capsule button in the composer pill options.
  - Provide sync with `models` and `selection`.
- Zero-config onboarding section:
  - When `!loading && !failed && !models.length`, render a clean onboarding container `.task-composer-onboarding` with cards for DeepSeek, Claude, OpenRouter, and Custom.
  - Clicking an onboarding card opens `onConfigureModels(presetId)`.

### 7. `apps/web/src/i18n.ts` (Update)
- Add new message keys in `ModelMessages`:
  ```ts
  presetCategoryAll: MessageTemplate;
  presetCategoryCn: MessageTemplate;
  presetCategoryOfficial: MessageTemplate;
  presetCategoryAggregator: MessageTemplate;
  presetCategoryLocal: MessageTemplate;
  presetCategoryIntl: MessageTemplate;
  presetSearchPlaceholder: MessageTemplate;
  presetNoResults: MessageTemplate;
  modelSearchPlaceholder: MessageTemplate;
  modelAddPlaceholder: MessageTemplate;
  modelSetAsDefault: MessageTemplate;
  currentLabel: MessageTemplate;
  onboardingTitle: MessageTemplate;
  onboardingSubtitle: MessageTemplate;
  onboardingRecommendedModels: MessageTemplate<{ models: string }>;
  onboardingCustomHint: MessageTemplate;
  ```
- Implement translations in both `zhModel` and `enModel`.

### 8. `apps/web/src/styles.css` (Update)
- Add CSS classes for:
  - `.preset-gallery`, `.preset-gallery-tabs`, `.preset-gallery-tab`, `.preset-gallery-grid`, `.preset-card`
  - `.model-chips`, `.model-chip`, `.model-chip-toggle`, `.model-chip-input`
  - `.model-switcher`, `.model-switcher-trigger`, `.model-switcher-panel`, `.model-switcher-search`, `.model-switcher-group`, `.model-switcher-item`
  - `.task-composer-onboarding`, `.onboarding-grid`, `.onboarding-card`
  - Follow CDS design tokens: `--r-card: 12px`, `--r-pill: 9999px`, `--panel-2`, `--ring-hairline`, hairline borders, smooth transitions.

### 9. Unit Tests
- Ensure `apps/web/src/components/providers/ProviderSettingsModal.test.tsx` passes 100%.
- Ensure `apps/web/src/components/TaskComposer.test.tsx` passes 100%.
- Create `apps/web/src/components/providers/ModelQuickSwitcher.test.tsx` testing popover toggle, filtering, and model selection.
- Create `apps/web/src/components/providers/ModelChips.test.tsx` testing chip toggle, manual addition, and default star setting.

---

## Verification Commands to Run
1. `npx vitest run --root apps/web`
2. `npm run -w @vessel/web build`
3. `npm run typecheck:tests`
4. `npx tsc -b tsconfig.json`
