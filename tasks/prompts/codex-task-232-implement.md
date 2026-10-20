# Task 232 Implementation Contract for Codex (gpt-6.1-sol)

## Role & Mission
You are Codex (`gpt-6.1-sol`, reasoning_effort: medium), executing in your isolated sandbox workspace.
Your mission: Implement the full-screen Provider Hub transition, advanced model search/batch selection, and Lark preset integration for Vessel Web UI based on OpenCode's audit report (`evidence/sessions/2026-10-19-opencode-audit-232.md`) and Task Card 232 (`tasks/232-provider-hub-full-surface-and-advanced-model-picker.md`).

## Hard Constraints
1. **Core Thinness**: `packages/core` modifications MUST BE EXACTLY 0 lines.
2. **Blast Radius**: Modify/add files strictly within `apps/web/` and `packages/application/src/providers/presets.data.ts` (for the canonical preset addition).
3. **No Breaking Tests**: All existing web tests (47 files, 389 tests) and root tests must pass 100%.
4. **Delete Discipline**: Do not permanently delete files. Windows Recycle Bin only if deletion is ever required.
5. **Backward Compatibility**: `ProviderSettingsModal.tsx` MUST preserve existing exports:
   - `export const PROVIDER_PRESETS: Record<string, AddProviderInput>`
   - `export function validateProvider(...)`
   - `export function providerFailure(...)`
   And keep DOM IDs (`provider-preset`, `provider-protocol`, `provider-url`, `provider-key`, `provider-models`) and button texts (`Test connection`, `Pull models`, `Save provider`, `Delete`, `Cancel`) available so existing tests pass without regressions.

---

## Detailed Implementation Plan

### 1. Preset Updates (`packages/application/src/providers/presets.data.ts` & `apps/web/src/components/providers/presetsData.ts`)
Add the official Lark / Feishu (Volcengine Ark) preset in both files with exact parity:
```ts
  { id: 'lark', name: '飞书 Lark（火山方舟）', protocol: 'openai-compatible', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-1-5-pro-32k-250115', category: 'cn', hint: '飞书 / 火山方舟端点；支持豆包大模型与自建 Endpoint' },
```
Make sure `apps/web/src/components/providers/presetsData.test.ts` passes with exact parity.

### 2. Advanced `ModelChips.tsx`
Upgrade `ModelChips.tsx` to handle hundreds of models with ease:
- **Search filter input**: A clean search bar `.model-chips-search` with icon and clear button, filtering models by case-insensitive matching.
- **Bulk actions bar** `.model-chips-toolbar`:
  - Quick filter tabs: All (`全部`) / Selected (`已选`) / Unselected (`未选`) with counts.
  - Action buttons:
    - `Select All` (`全选`): Selects all currently visible (filtered) models.
    - `Deselect All` (`全不选`): Deselects all currently visible models.
    - `Invert` (`反选`): Inverts selection of visible models.
  - Count badge: `.model-chips-count` displaying e.g. `已选 12 / 86` (with `font-variant-numeric: tabular-nums`).
- **Scroll container with feathering fade mask**:
  - Class `.model-chips-scroll` with `max-height: 240px` and overflow scroll.
  - Top/bottom fade masks (`mask-image: linear-gradient(...)`) so large model lists feel organic and do not blow out the layout.
- **Retain interactive features**:
  - Model toggle with checkmark.
  - Default star button (★/☆).
  - Manual model input with Enter to add custom model.
  - Full keyboard accessibility and `aria-pressed`.

### 3. Provider Hub Architecture (`ProviderHub.tsx` & `App.tsx`)
- Create `apps/web/src/components/providers/ProviderHub.tsx`:
  - Full-screen first-class view component used when `area === 'settings'`.
  - Can accept `api: ApiClient; onChanged?: () => void; initialPreset?: string;`.
  - Renders the full provider management center directly on the page:
    - Page heading: `<h2>{t('modelSettings')}</h2>` (or combined settings header).
    - Configured providers section: cards showing status, masked key, model count, capabilities badge, and delete/test actions.
    - Presets gallery: Searchable category tabs grid with 70+ presets.
    - Edit/Configure form: Protocol, Base URL, API Key, ModelChips (advanced picker), Test/Pull buttons, and Save button.
- Refactor `apps/web/src/components/providers/ProviderSettingsModal.tsx`:
  - Can delegate to the core provider panel or keep the modal shell wrapping the full-featured form while preserving all legacy DOM IDs and exports.
- Update `apps/web/src/App.tsx`:
  - In `area === 'settings'`:
    Instead of only rendering `<button>{t('modelSettings')}</button>`, directly render:
    ```tsx
    {area === 'settings' ? (
      <section className="main-body provider-hub-page">
        <ProviderHub api={api} initialPreset={providerPreset} onChanged={() => setProviderRevision(v => v + 1)} />
        <div className="settings-secondary-panel">
          <h3>{t('preferences')}</h3>
          <CustomizePanel modules={modules} onChange={handleModulesChange} />
          <LanguageSwitcher />
          <AttentionControls attention={attention} />
        </div>
      </section>
    ) : null}
    ```
  - Global `showProviders` modal continues to function when opened via `CommandPalette` or `TaskComposer` when not already on the settings page.

### 4. Internationalization (`apps/web/src/i18n.ts`)
Add message keys for batch actions and search in `ModelMessages`:
```ts
selectAll: MessageTemplate;
deselectAll: MessageTemplate;
invertSelection: MessageTemplate;
modelFilterAll: MessageTemplate;
modelFilterSelected: MessageTemplate;
modelFilterUnselected: MessageTemplate;
modelSearchCount: MessageTemplate<{ selected: string | number; total: string | number }>;
```
Add translations in both `zhModel` and `enModel`.

### 5. Styles & CDS Elevation (`apps/web/src/styles.css`)
- `.provider-hub-page`: Clean full-surface grid/flex container.
- `.model-chips-toolbar`: Flex row, gap 8px, compact pills, hairline border.
- `.model-chips-search`: Input with search icon, pill radius.
- `.model-chips-scroll`: Scroll area with smooth fade masks.
- `.model-chips-count`: Pill badge with subtle background.
- Respect reduced motion and responsive breakpoints.

### 6. Unit Tests
- Update/extend `ModelChips.test.tsx` to verify:
  - Search filtering.
  - Select all, deselect all, and invert.
  - Count badge calculation.
- Add `ProviderHub.test.tsx` verifying full-page rendering and interaction.
- Verify existing `ProviderSettingsModal.test.tsx`, `TaskComposer.test.tsx`, and `presetsData.test.ts` pass 100%.

---

## Verification Commands
1. `npx vitest run --root apps/web`
2. `npm run -w @vessel/web build -- --emptyOutDir false`
3. `npm run typecheck:tests`
4. `npx tsc -b tsconfig.json`
