The user wants a detailed audit and design report for refactoring the provider management and model switching architecture in Vessel Web UI, inspired by CC-Switch. Let me analyze the current state and design a comprehensive solution.

Key issues identified:
1. Frontend hardcodes only 4 presets while backend has 55+ presets
2. Model list is a comma-separated text input - poor UX
3. No quick switcher - users can't easily switch models in main UI
4. No zero-config onboarding guide

Let me structure my response as a comprehensive design report with:

1. Preset data bridge and categorization scheme
2. New ProviderSettingsModal.tsx design
3. New ModelQuickSwitcher.tsx + TaskComposer.tsx integration
4. CSS design specs

I need to provide concrete, actionable code. Let me think about the architecture.

### 1. Preset Data Bridge

The backend presets are in `packages/application/src/providers/presets.data.ts`. The web app is at `apps/web/src`. To bridge, we need:

Option A: API endpoint that returns the catalog
Option B: Shared package that both can import

Given Vessel's structure (`@vessel/application`), the cleanest approach is to expose a server route like `GET /api/providers/presets` that returns `PROVIDER_CATALOG`. The web client fetches once and caches it.

But we could also potentially import directly if there's a shared package. Let me check: `packages/application` — even if the web app doesn't have it as a dependency, they might be able to add it. However, the presets file imports `ProviderName` from `@vessel/llm`. If the web bundle doesn't already depend on `@vessel/llm`, adding it could bloat. So the API endpoint approach is safer.

Let me design:
- Add `GET /api/providers/presets` returning the catalog
- The web client caches the response

For categorization: I'll structure the presets into 4-5 groups:
- `cn` — 国内直连
- `official` — 国际官方
- `aggregator` — 聚合/网关
- `local` — 本地运行器
- `intl` — 国际（其他）

Each preset card shows:
- Logo/icon (letter-based avatar for now since we don't have logos)
- Name
- Category badge
- Recommended model badge
- Auth type hint (API Key / OAuth / env)
- One-click fill

### 2. ProviderSettingsModal.tsx Design

The new modal should have two states:
- **Gallery state**: Card grid of presets with search filter
- **Configure state**: Detailed form for the selected preset

Or a split view. I think the cleaner UX is:
- Default view: card grid with search at top
- Click a card → transitions to config form

Also need "My Providers" section at the top showing configured providers.

Let me design the component structure:

```tsx
// PresetsGallery.tsx - grid of preset cards
// PresetConfigForm.tsx - config form for selected preset
// ModelChips.tsx - chip-based model selection
// ProviderSettingsModal.tsx - container
```

### 3. ModelQuickSwitcher.tsx

A popover triggered from a capsule in TaskComposer. It shows:
- Grouped providers with their models
- Current selection highlighted
- Latency/status indicator
- Click to switch

The capsule shows:
- Provider name / model id
- Online status dot
- Latency

### 4. CSS Design

CC-Switch (and CDS design) uses:
- Precise corner radii (8px, 12px, 16px)
- Hairline borders (1px solid with low-opacity)
- Subtle shadows
- Frosted glass effects

Let me write this all out concretely.

Let me think about the data flow:

**API additions needed**:
1. `GET /api/providers/presets` — returns the catalog
2. Maybe a `setActiveProvider`/`setActiveModel` endpoint if not existing
3. `POST /api/providers/pull-models` — already exists (per task 215)

Actually looking at the TaskComposer, it already picks a model via `createSession` params. So "global active model" is a UI-level persistence concern (localStorage) rather than a server concern currently. But for true CC-Switch behavior we might want a server-persisted active provider. Let me consider it.

For simplicity, "active model" can be stored in localStorage and consumed by TaskComposer. That's the minimal path. Server-side persistence could come later.

Actually, re-reading the task: "一键秒切、全局热生效" — so we need a global store. Let me suggest a React context or a lightweight store (localStorage + event) for the active model selection.

Let me draft the solution now.

For the presets bridge, I need to check if there's a relevant route. Since we're told to design (not implement), I'll propose the endpoint.

Let me write the design report.

Actually, let me be careful about `PullModelsResult` and `TestProviderResult` — both are relevant. And the modal already has a `pull()` function.

Let me also note the model chips — after pulling, all discovered models become chips, user can toggle them on/off.

Layout for the new ProviderSettingsModal:
```
┌─────────────────────────────────────────────────────────┐
│ 模型与供应商设置                              [关闭]    │
├─────────────────────────────────────────────────────────┤
│ [已配置 (3)] [添加新供应商]                             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 已配置的供应商                                          │
│ ┌───────────┐ ┌─────────��─┐ ┌───────────┐             │
│ │ DeepSeek  │ │ Claude    │ │ Ollama    │             │
│ │ 5 models  │ │ 3 models  │ │ 12 models │             │
│ └───────────┘ └───────────┘ └───────────┘             │
│                                                         │
│ 或选择预设...                                           │
│ [搜索框 🔍]                                             │
│ 分类: [全部] [国内] [国际] [聚合] [本地]              │
│                                                         │
│ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐              │
│ │DeepSeek│ │Kimi  │ │Qwen   │ │GLM    │              │
│ └───────┘ └───────┘ └───────┘ └───────┘              │
│ ...                                                     │
└─────────────────────────────────────────────────────────┘
```

When user clicks a preset card → transitions to the config form with:
```
┌─────────────────────────────────────────────────────────┐
│ [← 返回]  DeepSeek                                       │
├─────────────────────────────────────────────────────────┤
│ 协议: OpenAI-compatible                                 │
│ Base URL: https://api.deepseek.com/v1                   │
│                                                         │
│ API Key: [•••••••••••••••] [测试连接]                   │
│                                                         │
│ 可用模型:                                                │
│ [拉取模型]                                              │
│                                                         │
│ ┌────────────┐ ┌────────────┐                          │
│ │deepseek-chat│ │deepseek-r...│ ← default            │
│ └────────────┘ └────────────┘                          │
│ 点击设默认 // 再次点击取消选择                          │
│                                                         │
│ [保存并启用]                                            │
└─────────────────────────────────────────────────────────┘
```

Let me now write the complete design report.

I should also note that the ProviderSettingsModal currently does a save with the form model as a comma-separated string. We need to change to chips.

For the "Model Chips" component:
- User clicks "拉取模型" → calls pull-models → populates chips
- Or user can manually add chips via input + Enter
- Click chip to toggle enabled/disabled
- Click "star" or default button to set as default
- Selected models become the `models` array on save

For TaskComposer:
- The current model select is a plain dropdown
- Change to a capsule button showing active model
- Click → opens ModelQuickSwitcher popover
- The popover lists providers grouped, with models under each, current highlighted
- Quick search within popover
- Keyboard nav support

Let me also add the zero-config onboarding:
- When no models are available, TaskComposer shows an "empty state" with quick-add cards

For CSS, I'll define classes with a clear naming scheme:
- `.provider-gallery`, `.provider-gallery-grid`, `.provider-gallery-card`
- `.provider-chip`, `.provider-chip--active`
- `.model-switcher`, `.model-switcher__trigger`, `.model-switcher__panel`
- etc.

Let me write the report now, making it very concrete with actual code.

I'll structure the report as:

## Executive Summary
## 1. Preset Data Bridge & Categorization
## 2. Refactored ProviderSettingsModal
## 3. ModelQuickSwitcher & TaskComposer
## 4. CSS Design System
## 5. Migration & Testing

Let me write actual code for each section.

For the API bridge, I need a small server route. Let me write the frontend types and the client method.

Actually, one thing to note — the current `AddProviderInput` requires `models: string[]`. So when the user clicks a preset card and pastes the API key, we need the models to be prefilled. Options:
1. If `defaultModel` is set on the preset, prefill the models array with just `[defaultModel]`.
2. If empty, require "拉取模型" before save.

That's reasonable. Let me include that.

For the API bridge, I need to handle the auth type. Presets can have `auth: 'api-key' | 'oauth' | 'env' | 'none'`. For env-based, we shouldn't ask for API key. For OAuth, we can't directly handle it. For none (mock), no key needed.

The form must adapt based on auth:
- `api-key`: show API key field
- `oauth`: show "OAuth 登录" button and hint
- `env`: show hint about env credential setup, no API key field
- `none`: no key field

The server side would need to accept these. Currently `validateProvider` requires an API key (unless local). For env-auth, we need to relax this. But that's beyond scope — let me note it as a design requirement but not fully rework server validation.

Let me also think about the "port" of `PROVIDER_PRESETS` in `ProviderSettingsModal.tsx`. The current constant only has 4 entries. We need to replace it with the full catalog fetched from the backend.

For the client type, we need:
```ts
export interface PresetInfo {
  id: string;
  name: string;
  protocol: 'openai-compatible' | 'anthropic' | 'mock';
  baseUrl: string;
  defaultModel: string;
  hint?: string;
  category: 'official' | 'cn' | 'intl' | 'aggregator' | 'local';
  auth?: 'api-key' | 'oauth' | 'env' | 'none';
}
```

Server route:
```ts
// apps/local-server/src/routes/providers.ts
router.get('/presets', (req, res) => {
  res.json({ presets: PROVIDER_CATALOG, categories: PROVIDER_CATEGORY_LABELS });
});
```

Actually let me check the categories. Current categories are: `official | cn | intl | aggregator | local`. Labels:
- official: '官方（国际）'
- cn: '国产官方'
- intl: '国际'
- aggregator: '聚合 / 网关'
- local: '本�� / 推理'

For the UI requested ("国内直连、国际官方、聚合平台、本地运行器"), we might want to merge some. Let me propose:
- cn (国内直连)
- official + intl (国际官方) — actually should keep separate maybe. Let me keep 5 categories to match backend.
- aggregator (聚合/网关)
- local (本地运行器)

Actually the task says "国内直连、国际官方、聚合平台、本地运行器" — 4 categories. But backend has 5. Maybe the user is simplifying. Let me keep the backend's 5 labels for accuracy but ensure the UI can render them all.

OK let me write the report now.

Let me also consider the storage for "active model". We need:

```ts
// apps/web/src/activeModel.ts
export interface ActiveModel {
  provider: string;
  model: string;
}

const KEY = 'vessel.active-model';

export function readActiveModel(): ActiveModel | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.provider === 'string' && typeof parsed?.model === 'string') return parsed;
    return null;
  } catch { return null; }
}

export function writeActiveModel(value: ActiveModel | null): void {
  if (value) {
    localStorage.setItem(KEY, JSON.stringify(value));
  } else {
    localStorage.removeItem(KEY);
  }
  window.dispatchEvent(new CustomEvent('vessel:active-model', { detail: value }));
}
```

TaskComposer uses `useActiveModel()` hook that subscribes to the event.

ModelQuickSwitcher is triggered by the capsule in TaskComposer.

Let me now write out all the code.

For ModelQuickSwitcher, I need it to:
- Accept `models: ModelOption[]` (or fetch itself)
- Accept `current: { provider, model } | null`
- Accept `onSelect(provider, model)`
- Render a trigger button AND the popover
- Support keyboard: Escape to close, arrow keys to navigate

Let me draft the components.

```tsx
// apps/web/src/components/providers/ModelQuickSwitcher.tsx
import { useEffect, useRef, useState, useMemo } from 'react';
import type { ApiClient, ModelOption } from '../../api';
import { useI18n } from '../LanguageProvider';
import { modelKey } from '../NewSessionForm';

export interface ActiveModel { provider: string; model: string }

export function ModelQuickSwitcher({
  api,
  current,
  onChange,
  disabled,
  compact,
}: {
  api: ApiClient;
  current: ActiveModel | null;
  onChange: (next: ActiveModel | null) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // fetch models when opened
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    void api.listModels()
      .then(({ models: catalog }) => { if (live) setModels(catalog.filter(m => m.providerName !== 'mock')); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [open, api]);

  // close on outside click / escape
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, ModelOption[]>();
    for (const m of models) {
      if (q && !`${m.providerName}/${m.id}`.toLowerCase().includes(q)) continue;
      if (!map.has(m.providerName)) map.set(m.providerName, []);
      map.get(m.providerName)!.push(m);
    }
    return Array.from(map.entries());
  }, [models, query]);

  const flat = useMemo(() => grouped.flatMap(([, items]) => items), [grouped]);
  useEffect(() => { setCursor(0); }, [query, open]);

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className={`model-switcher__trigger${compact ? ' is-compact' : ''}`}
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={false}
      >
        <span className="model-switcher__dot" data-state={current ? 'online' : 'offline'} />
        <span className="model-switcher__label">
          {current ? `${current.provider} / ${current.model}` : t('modelOffline')}
        </span>
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
    );
  }

  return (
    <div className="model-switcher" ref={panelRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`model-switcher__trigger${compact ? ' is-compact' : ''} is-open`}
        onClick={() => setOpen(false)}
        aria-haspopup="listbox"
        aria-expanded={true}
      >
        <span className="model-switcher__dot" data-state={current ? 'online' : 'offline'} />
        <span className="model-switcher__label">
          {current ? `${current.provider} / ${current.model}` : t('modelOffline')}
        </span>
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      <div className="model-switcher__panel" role="listbox">
        <input
          className="model-switcher__search"
          type="search"
          placeholder={t('modelSearchPlaceholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, flat.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
            else if (e.key === 'Enter') {
              e.preventDefault();
              const picked = flat[cursor];
              if (picked) { onChange({ provider: picked.providerName, model: picked.id }); setOpen(false); }
            }
          }}
          autoFocus
        />
        {loading && <p className="model-switcher__status">{t('loading')}</p>}
        {!loading && flat.length === 0 && <p className="model-switcher__status">{t('noModelsConfigured')}</p>}
        {grouped.map(([provider, items]) => (
          <div className="model-switcher__group" key={provider}>
            <div className="model-switcher__group-title">{provider}</div>
            {items.map(m => {
              const isCurrent = current?.provider === provider && current?.model === m.id;
              const idx = flat.indexOf(m);
              return (
                <button
                  key={modelKey(m)}
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  className={`model-switcher__item${isCurrent ? ' is-current' : ''}${idx === cursor ? ' is-focused' : ''}`}
                  onMouseEnter={() => setCursor(idx)}
                  onClick={() => { onChange({ provider, model: m.id }); setOpen(false); }}
                >
                  <span className="model-switcher__item-name">{m.id}</span>
                  {isCurrent && <span className="model-switcher__item-badge">{t('currentLabel')}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```

Then TaskComposer uses it:

```tsx
// In TaskComposer
const [active, setActive] = useState<ActiveModel | null>(() => readActiveModel());
useEffect(() => {
  // when models load, if no active model or it's gone, pick first
  if (!models.length) return;
  if (active && models.some(m => m.providerName === active.provider && m.id === active.model)) return;
  const first = models[0]!;
  const next = { provider: first.providerName, model: first.id };
  setActive(next);
  writeActiveModel(next);
}, [models]);
// ...
<ModelQuickSwitcher api={api} current={active} onChange={next => { setActive(next); writeActiveModel(next); }} disabled={busy} />
```

For zero-config, when `models.length === 0`, show an onboarding card instead of "no models":

```tsx
{!loading && !failed && !models.length && (
  <div className="task-composer__onboarding">
    <h3>{t('onboardingTitle')}</h3>
    <p>{t('onboardingSubtitle')}</p>
    <div className="task-composer__onboarding-grid">
      <button className="onboarding-card" onClick={() => onConfigureModels('deepseek')}>
        <span className="onboarding-card__logo" data-logo="deepseek">D</span>
        <strong>DeepSeek</strong>
        <small>{t('onboardingRecommendedModels', { models: 'deepseek-chat · deepseek-reasoner' })}</small>
      </button>
      <button className="onboarding-card" onClick={() => onConfigureModels('anthropic')}>
        <span className="onboarding-card__logo" data-logo="anthropic">A</span>
        <strong>Claude</strong>
        <small>{t('onboardingRecommendedModels', { models: 'claude-sonnet-4-5' })}</small>
      </button>
      <button className="onboarding-card" onClick={() => onConfigureModels('openrouter')}>
        <span className="onboarding-card__logo" data-logo="openrouter">O</span>
        <strong>OpenRouter</strong>
        <small>{t('onboardingRecommendedModels', { models: '200+ 模型' })}</small>
      </button>
      <button className="onboarding-card" onClick={() => onConfigureModels()}>
        <span className="onboarding-card__logo" data-logo="custom">+</span>
        <strong>{t('providerCustom')}</strong>
        <small>{t('onboardingCustomHint')}</small>
      </button>
    </div>
  </div>
)}
```

And `onConfigureModels` should accept an optional preset id to prefill.

Now the ProviderSettingsModal refactor. I'll create subcomponents:

**PresetsGallery**:
```tsx
export function PresetsGallery({
  presets,
  onPick,
  query,
  setQuery,
  category,
  setCategory,
}: {
  presets: PresetInfo[];
  onPick: (p: PresetInfo) => void;
  query: string;
  setQuery: (v: string) => void;
  category: ProviderCategory | 'all';
  setCategory: (v: ProviderCategory | 'all') => void;
}) {
  const { t } = useI18n();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return presets.filter(p => {
      if (category !== 'all' && p.category !== category) return false;
      if (q && !`${p.name} ${p.id} ${p.baseUrl}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [presets, query, category]);
  const categories: Array<{ id: ProviderCategory | 'all'; label: string }> = [
    { id: 'all', label: t('presetCategoryAll') },
    { id: 'cn', label: t('presetCategoryCn') },
    { id: 'official', label: t('presetCategoryOfficial') },
    { id: 'aggregator', label: t('presetCategoryAggregator') },
    { id: 'local', label: t('presetCategoryLocal') },
    { id: 'intl', label: t('presetCategoryIntl') },
  ];
  return (
    <div className="preset-gallery">
      <div className="preset-gallery__toolbar">
        <input
          className="preset-gallery__search"
          type="search"
          placeholder={t('presetSearchPlaceholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <div className="preset-gallery__tabs" role="tablist">
          {categories.map(c => (
            <button
              key={c.id}
              role="tab"
              aria-selected={category === c.id}
              className={`preset-gallery__tab${category === c.id ? ' is-active' : ''}`}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="preset-gallery__grid">
        {filtered.map(p => (
          <button key={p.id} type="button" className="preset-card" onClick={() => onPick(p)}>
            <div className="preset-card__header">
              <span className="preset-card__logo" data-logo={p.id}>{presetInitial(p)}</span>
              <div>
                <strong className="preset-card__name">{p.name}</strong>
                {p.hint && <small className="preset-card__hint">{p.hint}</small>}
              </div>
            </div>
            <div className="preset-card__meta">
              {p.defaultModel && (
                <span className="preset-card__badge" data-badge="model">{p.defaultModel}</span>
              )}
              {p.auth && p.auth !== 'api-key' && (
                <span className="preset-card__badge" data-badge="auth">
                  {p.auth === 'oauth' ? 'OAuth' : p.auth === 'env' ? 'Env' : 'No Key'}
                </span>
              )}
              <span className="preset-card__badge" data-badge="category">
                {categoryLabel(p.category)}
              </span>
            </div>
          </button>
        ))}
        {filtered.length === 0 && <p className="preset-gallery__empty">{t('presetNoResults')}</p>}
      </div>
    </div>
  );
}
```

**ModelChips**:
```tsx
export function ModelChips({
  models,         // all available chips (probed + manually added)
  selected,       // which are enabled
  defaultModel,
  onToggle,
  onSetDefault,
  onRemove,
  onAdd,
  busy,
}: {
  models: string[];
  selected: string[];
  defaultModel: string | null;
  onToggle: (m: string) => void;
  onSetDefault: (m: string) => void;
  onRemove: (m: string) => void;
  onAdd: (m: string) => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  return (
    <div className="model-chips">
      <div className="model-chips__list">
        {models.map(m => {
          const isSelected = selected.includes(m);
          const isDefault = defaultModel === m;
          return (
            <span
              key={m}
              className={`model-chip${isSelected ? ' is-selected' : ''}${isDefault ? ' is-default' : ''}`}
            >
              <button
                type="button"
                className="model-chip__toggle"
                onClick={() => onToggle(m)}
                aria-pressed={isSelected}
                disabled={busy}
              >
                {isSelected && (
                  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                    <path d="M2 6l3 3 5-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                )}
                <span>{m}</span>
              </button>
              {isSelected && (
                <button
                  type="button"
                  className="model-chip__default"
                  onClick={() => onSetDefault(m)}
                  aria-label={t('modelSetAsDefault')}
                  title={t('modelSetAsDefault')}
                >
                  {isDefault ? '★' : '☆'}
                </button>
              )}
              {!isSelected && (
                <button
                  type="button"
                  className="model-chip__remove"
                  onClick={() => onRemove(m)}
                  aria-label={t('remove')}
                  title={t('remove')}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        <input
          className="model-chip model-chip--input"
          placeholder={t('modelAddPlaceholder')}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const v = draft.trim();
              if (v && !models.includes(v)) { onAdd(v); }
              setDraft('');
            }
          }}
          disabled={busy}
        />
      </div>
    </div>
  );
}
```

Now the full ProviderSettingsModal. Let me structure it as a container with two views (gallery / config).

Actually, to preserve state transitions cleanly and avoid a full rewrite, let me propose a new component `ProviderSettingsModal.v2.tsx` (or just replace the existing file). I'll write the replacement.

Given the length, let me be strategic — I'll provide the key structural code and let the implementation fill in the details. But the task asks for "具体重构代码方案" so I should be reasonably complete.

Let me draft the full ProviderSettingsModal.tsx:

```tsx
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError, type AddProviderInput, type ApiClient, type PresetInfo, type ProviderInfo, type TestProviderResult } from '../../api';
import type { ModelMessages } from '../../i18n';
import CapabilityStatus from './CapabilityStatus';
import { useI18n } from '../LanguageProvider';
import { ModelChips } from './ModelChips';
import { PresetsGallery } from './PresetsGallery';
import { providerFailure } from './providerFailure';

type View = 'gallery' | 'config';

interface DraftState {
  presetId: string;
  name: string;
  protocol: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  models: string[];      // all discovered candidates
  selected: string[];    // enabled ones
  defaultModel: string | null;
  auth: 'api-key' | 'oauth' | 'env' | 'none';
}

function emptyDraft(): DraftState {
  return {
    presetId: '',
    name: '',
    protocol: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    models: [],
    selected: [],
    defaultModel: null,
    auth: 'api-key',
  };
}

export default function ProviderSettingsModal({ api, onClose, onChanged }: {
  api: ApiClient; onClose: () => void; onChanged?: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);

  const [view, setView] = useState<View>('gallery');
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PresetInfo['category'] | 'all'>('all');
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [busy, setBusy] = useState<'test' | 'save' | 'delete' | 'pull'>();
  const [error, setError] = useState<keyof ModelMessages>();
  const [errorParams, setErrorParams] = useState<Record<string, string>>();
  const [notice, setNotice] = useState<keyof ModelMessages>();
  const [noticeParams, setNoticeParams] = useState<Record<string, string>>();
  const [result, setResult] = useState<TestProviderResult>();
  const [deleting, setDeleting] = useState<string>();

  // ... load presets + providers on mount
  useEffect(() => {
    mounted.current = true;
    const restore = document.activeElement;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    void Promise.all([api.listProviders(), api.listPresets()])
      .then(([provRes, presRes]) => {
        if (!mounted.current) return;
        setProviders(provRes.providers.filter(p => p.name !== 'mock'));
        setPresets(presRes.presets);
        setLoaded(true);
      })
      .catch((thrown: unknown) => {
        if (!mounted.current) return;
        const failure = providerFailure(thrown);
        setError(failure.key); setErrorParams(failure.params);
      })
      .finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; if (restore instanceof HTMLElement && restore.isConnected) restore.focus(); };
  }, [api]);

  // ... run/test/pull/delete handlers reusing existing logic but reading draft
  // ... save maps draft.selected → models
  // ... onPick(preset) transitions to config view + fills draft

  const onPickPreset = (p: PresetInfo) => {
    setDraft({
      presetId: p.id,
      name: p.id,
      protocol: p.protocol === 'mock' ? 'openai-compatible' : p.protocol,
      baseUrl: p.baseUrl,
      apiKey: '',
      models: p.defaultModel ? [p.defaultModel] : [],
      selected: p.defaultModel ? [p.defaultModel] : [],
      defaultModel: p.defaultModel || null,
      auth: p.auth ?? 'api-key',
    });
    setResult(undefined);
    setError(undefined);
    setNotice(undefined);
    setView('config');
  };

  // ... render
}
```

OK, I think I have enough to write a thorough report. Let me also handle:

The current ProviderSettingsModal has `PROVIDER_PRESETS` hardcoded. We can either:
1. Delete it entirely and rely on the backend catalog.
2. Keep it as a fallback.

Since the task says the frontend is bad because it's hardcoded with only 4 presets, we should delete it or at least stop using it for the gallery. I'll note that the old `PROVIDER_PRESETS` can remain for backwards compatibility in `NewSessionForm` (if used there — let me check if NewSessionForm uses it)... The task doesn't say. It says `ProviderSettingsModal.tsx` has it. Let me just remove from the modal.

Actually, `PROVIDER_PRESETS` is exported from `ProviderSettingsModal.tsx`. If other files import it, we'd break them. Let me check... The task shows only `ProviderSettingsModal.tsx` referencing it internally. I'll note: keep the export as a deprecated shim or