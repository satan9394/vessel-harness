import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CapabilityStatus from './CapabilityStatus';
import ProviderSettingsModal, { PROVIDER_PRESETS, validateProvider } from './ProviderSettingsModal';
import { createApiClient, ApiError, type ApiClient, type ProviderInfo } from '../../api';
import { translate } from '../../i18n';
import { ModelChips, type ModelChipsProps } from './ModelChips';
import { PresetsGallery } from './PresetsGallery';
import { PROVIDER_PRESETS_CATALOG } from './presetsData';

// Exercise event handlers with the repository's dependency-free hook harness.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[], lang: 'en' as 'en' | 'zh' }));
vi.mock('../LanguageProvider', () => ({ useI18n: () => ({ t: translate(hooks.lang), lang: hooks.lang }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[i], (next: unknown) => { hooks.values[i] = typeof next === 'function' ? next(hooks.values[i]) : next; }];
  },
  useRef: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = { current: initial }; return hooks.values[i]; },
  useId: () => 'provider',
  useEffect: (effect: () => (() => void), deps: unknown[]) => {
    const i = hooks.cursor++; const previous = hooks.values[i] as unknown[] | undefined;
    if (!previous || deps.some((dep, index) => dep !== previous[index])) hooks.effects.push(() => { hooks.cleanups[i]?.(); hooks.cleanups[i] = effect(); });
    hooks.values[i] = deps;
  },
}));
function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}
function invoke(node: ReactElement<Record<string, unknown>>, handler: string, event = {}) { (node.props[handler] as (event: unknown) => void)(event); }
class Element {
  hidden = false;
  closest() { return this.hidden ? this : null; }
  isConnected = true;
  controls: Element[] = [];
  focus() { doc.activeElement = this; }
  querySelector() { return this.controls[0]; }
  querySelectorAll() { return this.controls; }
  contains(element: unknown) { return this.controls.includes(element as Element); }
}
const doc = { activeElement: new Element() };
const configured: ProviderInfo = { name: 'existing', protocol: 'openai-compatible', baseUrl: 'https://example.com/v1', apiKeyMasked: '****1234', models: ['model-a'] };
let api: ApiClient;
const onChanged = vi.fn(); const onClose = vi.fn();
const root = new Element();
function render() {
  hooks.cursor = 0;
  const tree = nodes(ProviderSettingsModal({ api, onChanged, onClose }));
  (tree.find(node => node.props.role === 'dialog')!.props.ref as { current: unknown }).current = root;
  hooks.effects.splice(0).forEach(effect => effect());
  return tree;
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function change(field: string, value: string) { invoke(render().find(node => node.props.id === `provider-${field}`)!, 'onChange', { target: { value } }); }
function button(text: string) { return render().find(node => node.type === 'button' && node.props.children === text)!; }
beforeEach(() => {
  hooks.lang = 'en'; vi.stubGlobal('document', doc); vi.stubGlobal('HTMLElement', Element);
  doc.activeElement = new Element(); root.controls = [new Element(), new Element()];
  api = { listProviders: vi.fn(async () => ({ providers: [configured, { ...configured, name: 'mock' }] })), listProviderUsage: vi.fn(async () => ({ byProvider: [], totals: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 } })), addProvider: vi.fn(async () => ({ provider: configured })), deleteProvider: vi.fn(async () => ({ ok: true })), testProvider: vi.fn(async () => ({ ok: true, latencyMs: 156, availableModels: ['discovered'] })), pullProviderModels: vi.fn(async () => ({ ok: true, latencyMs: 120, models: ['alpha', 'beta'] })), listModels: vi.fn(async () => ({ models: [] })) } as unknown as ApiClient;
  api.listProfiles = vi.fn(async () => ({ profiles: [] }));
  api.useProfile = vi.fn(async () => ({ provider: configured }));
});
afterEach(() => { hooks.cleanups.forEach(cleanup => cleanup?.()); hooks.values = []; hooks.effects = []; hooks.cleanups = []; vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('provider settings', () => {
  it.each([5, 6])('shows search only above five configured providers (%i)', async count => {
    vi.mocked(api.listProviders).mockResolvedValue({ providers: Array.from({ length: count }, (_, i) => ({ ...configured, name: `provider-${i}` })) });
    render(); await settle();
    expect(render().some(node => node.type === 'input' && node.props.type === 'search')).toBe(count > 5);
  });
  it.each([
    ['PROVIDER-2', ['provider-2']],
    ['HOST-3', ['provider-3']],
    ['missing', []],
  ])('filters names/URLs for %s and restores all providers on clear', async (query, expected) => {
    vi.mocked(api.listProviders).mockResolvedValue({ providers: Array.from({ length: 6 }, (_, i) => ({ ...configured, name: `provider-${i}`, baseUrl: `https://host-${i}.example/v1` })) });
    render(); await settle();
    const search = () => render().find(node => node.type === 'input' && node.props.type === 'search')!;
    expect(String(search().props['aria-label'])).not.toMatch(/[\u3400-\u9fff]/);
    invoke(search(), 'onChange', { target: { value: query } });
    expect(render().filter(node => node.props.className === 'provider-card').map(node => nodes(node).find(child => child.type === 'strong')!.props.children)).toEqual(expected);
    expect(render().some(node => node.props.children === 'No matching providers')).toBe(expected.length === 0);
    invoke(search(), 'onChange', { target: { value: '' } });
    expect(render().filter(node => node.props.className === 'provider-card')).toHaveLength(6);
    expect(render().some(node => node.props.children === 'No matching providers')).toBe(false);
  });
  it.each(['en', 'zh'] as const)('shows a gentle missing-key hint in %s', async lang => {
    hooks.lang = lang;
    vi.mocked(api.listProviders).mockResolvedValue({ providers: [{ ...configured, apiKeyMasked: '' }] });
    render(); await settle();
    const message = lang === 'en' ? 'API key not configured' : '未配置密钥';
    expect(render().find(node => node.props.children === message)?.props.className).toBe('dim');
    if (lang === 'en') expect(message).not.toMatch(/[\u3400-\u9fff]/);
    expect(render().some(node => node.props.children === '****1234')).toBe(false);
  });
  it('preserves the masked-key display', async () => {
    render(); await settle();
    expect(render().some(node => node.props.children === '****1234')).toBe(true);
    expect(render().some(node => node.props.children === 'API key not configured')).toBe(false);
  });
  it.each([
    ['cache-inclusive', 'Cache-inclusive', '输入包含缓存'],
    ['cache-exclusive', 'Cache-exclusive', '输入不含缓存'],
    ['mixed', 'Mixed', '混合'],
    [undefined, undefined, undefined],
  ] as const)('renders input accounting %s in both languages', async (semantics, en, zh) => {
    vi.mocked(api.listProviderUsage).mockResolvedValue({ byProvider: [{ provider: 'existing', models: [], inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, calls: 1, costUsd: 0, estimated: false, ...(semantics ? { inputTokenSemantics: semantics } : {}) }], totals: { calls: 1, inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 } });
    render(); await settle();
    const english = render().find(node => node.props.className === 'provider-input-semantics');
    expect(english?.props.children).toBe(en ? `Input accounting: ${en}` : undefined);
    if (en) expect(english?.props.children).not.toMatch(/[\u3400-\u9fff]/);
    hooks.lang = 'zh';
    expect(render().find(node => node.props.className === 'provider-input-semantics')?.props.children).toBe(zh ? `口径：${zh}` : undefined);
  });
  it('expands and collapses the top models in server order', async () => {
    vi.mocked(api.listProviderUsage).mockResolvedValue({ byProvider: [{ provider: 'existing', models: [{ model: 'expensive', tokens: 20, costUsd: 2, calls: 1 }, { model: 'cheaper', tokens: 10, costUsd: 1, calls: 1 }], inputTokens: 20, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0, calls: 2, costUsd: 3, estimated: false }], totals: { calls: 2, inputTokens: 20, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 3 } });
    render(); await settle();
    expect(button('Top 3 models').props['aria-expanded']).toBe(false);
    expect(render().some(node => node.props.className === 'provider-top-models')).toBe(false);
    invoke(button('Top 3 models'), 'onClick');
    expect(button('Top 3 models').props['aria-expanded']).toBe(true);
    const list = render().find(node => node.props.className === 'provider-top-models')!;
    expect(nodes(list).filter(node => node.type === 'li').map(node => node.props.children)).toEqual([
      ['expensive', ' · ', '20 tokens · $2.0000'], ['cheaper', ' · ', '10 tokens · $1.0000'],
    ]);
    invoke(button('Top 3 models'), 'onClick');
    expect(render().some(node => node.props.className === 'provider-top-models')).toBe(false);
  });
  it('omits the model expander when there are no models', async () => {
    render(); await settle();
    expect(button('Top 3 models')).toBeUndefined();
  });
  it.each(['en', 'zh'] as const)('shows relative last-use time in %s', async lang => {
    hooks.lang = lang;
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-26T12:00:00Z'));
    vi.mocked(api.listProviderUsage).mockResolvedValue({ byProvider: [{ models: [], provider: 'existing', inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, calls: 1, costUsd: 0, estimated: false, lastTs: '2026-10-26T10:00:00Z' }], totals: { calls: 1, inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 } });
    render(); await settle();
    expect(render().find(node => node.props.className === 'provider-last-used')?.props.children).toBe(lang === 'en' ? 'Last used: 2 hours ago' : '最近：2小时前');
    vi.mocked(Date.now).mockRestore();
  });
  it('omits last-use text when no timestamp is supplied', async () => {
    render(); await settle();
    expect(render().some(node => node.props.className === 'provider-last-used')).toBe(false);
  });
  it('renders profile fields, activates through the API and refreshes providers and usage', async () => {
    vi.mocked(api.listProfiles).mockResolvedValue({ profiles: [{ name: 'work', provider: 'existing', model: 'fast', baseUrl: 'https://work.example/v1' }] });
    render(); await settle();
    const section = render().find(node => node.type === 'section' && node.props['aria-label'] === 'Profiles')!;
    const dump = JSON.stringify(section);
    for (const text of ['work', 'existing', 'fast', 'https://work.example/v1']) expect(dump).toContain(text);
    expect(api.listProviders).toHaveBeenCalledTimes(1); expect(api.listProviderUsage).toHaveBeenCalledTimes(1);
    vi.mocked(api.listProviders).mockResolvedValue({ providers: [{ ...configured, models: ['fast'], isDefault: true }] });
    vi.mocked(api.listProviderUsage).mockResolvedValue({ byProvider: [{ models: [], provider: 'existing', inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0, calls: 1, costUsd: 0.5, estimated: false }], totals: { calls: 1, inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.5 } });
    invoke(button('Use'), 'onClick'); await settle();
    expect(api.useProfile).toHaveBeenCalledWith('work');
    expect(api.listProviders).toHaveBeenCalledTimes(2); expect(api.listProviderUsage).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalledOnce();
    expect(JSON.stringify(render())).toContain('120 tokens · $0.5000');
    expect(render().some(node => node.props.role === 'status' && node.props.children === 'Profile work is active.')).toBe(true);
    expect(button('Use').props.disabled).toBe(false);
  });
  it('uses a placeholder for empty profiles and omitted overrides without inventing values', async () => {
    render(); await settle();
    expect(render().some(node => node.props.children === '— No profiles yet')).toBe(true);
    vi.mocked(api.listProfiles).mockResolvedValue({ profiles: [{ name: 'plain', provider: 'existing' }] });
    hooks.values = []; render(); await settle();
    const section = render().find(node => node.type === 'section' && node.props['aria-label'] === 'Profiles')!;
    expect(JSON.stringify(section)).not.toContain('model-a');
    expect(JSON.stringify(section)).not.toContain('https://example.com/v1');
    expect(nodes(section).filter(node => Array.isArray(node.props.children) && node.props.children.includes('—'))).toHaveLength(2);
  });
  it('isolates profile list failures, retries locally and preserves the configured provider list', async () => {
    vi.mocked(api.listProfiles).mockRejectedValueOnce(new Error('private-profile-error'));
    render(); await settle();
    let tree = render();
    expect(tree.some(node => node.type === 'strong' && node.props.children === 'existing')).toBe(true);
    const section = tree.find(node => node.type === 'section' && node.props['aria-label'] === 'Profiles')!;
    expect(nodes(section).some(node => node.props.role === 'alert')).toBe(true);
    expect(JSON.stringify(tree)).not.toContain('private-profile-error');
    invoke(button('Retry'), 'onClick'); await settle(); tree = render();
    expect(tree.some(node => node.props.role === 'alert')).toBe(false);
    expect(api.listProviders).toHaveBeenCalledTimes(1);
    expect(button('Save').props.disabled).toBe(false);
  });
  it('retains rows after failed activation and localizes profile messages in both languages', async () => {
    hooks.lang = 'zh';
    vi.mocked(api.listProfiles).mockResolvedValue({ profiles: [{ name: 'work', provider: 'existing' }] });
    vi.mocked(api.useProfile).mockRejectedValueOnce(new Error('private-use-error'));
    render(); await settle(); invoke(button('启用'), 'onClick'); await settle();
    const section = render().find(node => node.type === 'section' && node.props['aria-label'] === 'Profiles')!;
    expect(nodes(section).some(node => node.props.role === 'alert')).toBe(true);
    expect(nodes(section).some(node => node.type === 'strong' && node.props.children === 'work')).toBe(true);
    expect(JSON.stringify(section)).not.toContain('private-use-error');
    expect(api.listProviders).toHaveBeenCalledTimes(1); expect(onChanged).not.toHaveBeenCalled();
    for (const key of ['profilesTitle', 'profilesProvider', 'profilesModel', 'profilesUse', 'profilesUseNamed', 'profilesEmpty', 'profilesUsed', 'profilesLoadFailed', 'profilesUseFailed', 'profilesRefreshFailed'] as const) {
      expect(translate('en')(key, { name: 'work' })).not.toMatch(/[\u3400-\u9fff]/u);
      expect(translate('zh')(key, { name: 'work' })).not.toBe(key);
    }
  });
  it('retries failed provider readback locally without activating twice', async () => {
    vi.mocked(api.listProfiles).mockResolvedValue({ profiles: [{ name: 'work', provider: 'existing' }] });
    render(); await settle();
    vi.mocked(api.listProviders).mockRejectedValueOnce(new Error('readback failed'));
    invoke(button('Use'), 'onClick'); await settle();
    expect(JSON.stringify(render())).toContain('Profile is active, but providers could not refresh. Retry.');
    expect(onChanged).toHaveBeenCalledOnce();
    invoke(button('Retry'), 'onClick'); await settle();
    expect(render().some(node => node.props.role === 'alert')).toBe(false);
    expect(api.useProfile).toHaveBeenCalledTimes(1);
    expect(api.listProviderUsage).toHaveBeenCalledTimes(2);
  });
  it('selects the built-in Mock preset without credential fields or registration', async () => {
    render(); await settle();
    const mock = PROVIDER_PRESETS_CATALOG.find(preset => preset.id === 'mock');
    expect(mock).toBeDefined();
    const gallery = render().find(node => node.type === PresetsGallery)!;
    (gallery.props.onSelect as (preset: typeof PROVIDER_PRESETS_CATALOG[number]) => void)(mock!);
    const tree = render();
    expect(tree.find(node => node.props.id === 'provider-preset')!.props.value).toBe('mock');
    expect(tree.find(node => node.type === PresetsGallery)!.props.selectedId).toBe('mock');
    expect(tree.some(node => node.props.id === 'provider-key')).toBe(false);
    expect(tree.some(node => node.props.id === 'provider-url')).toBe(false);
    expect(tree.some(node => node.props.children === 'Built-in offline model. Select mock / mock in the task model picker. No endpoint or API key is needed.')).toBe(true);
    invoke(tree.find(node => node.type === 'form')!, 'onSubmit', { preventDefault() {} }); await settle();
    expect(api.addProvider).not.toHaveBeenCalled(); expect(api.testProvider).not.toHaveBeenCalled();
    change('preset', 'OpenAI');
    const protocol = render().find(node => node.props.id === 'provider-protocol')!;
    expect(protocol.props.value).toBe('openai-compatible');
    expect(nodes(protocol.props.children as ReactNode).filter(node => node.type === 'option').map(node => node.props.value)).toEqual(['openai-compatible', 'anthropic']);
  });

  it('shows per-provider tokens and cost from the usage endpoint', async () => {
    vi.mocked(api.listProviderUsage).mockResolvedValue({
      byProvider: [{ models: [], provider: 'existing', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, calls: 2, costUsd: 0.25, estimated: false }],
      totals: { calls: 2, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.25 },
    });
    render(); await settle();
    const shown = render().find(node => node.props.className === 'provider-usage');
    expect(String(shown?.props.children)).toContain('15 tokens');
    expect(String(shown?.props.children)).toContain('0.2500');
  });

  it('shows an em dash when the provider has no recorded usage', async () => {
    render(); await settle();
    expect(render().some(node => node.props.className === 'provider-usage' && node.props.children === '—')).toBe(true);
  });

  it('prefills the form from a gallery card and persists the chip default first', async () => {
    render(); await settle();
    const gallery = render().find(node => node.type === PresetsGallery)!;
    (gallery.props.onSelect as (preset: typeof PROVIDER_PRESETS_CATALOG[number]) => void)(PROVIDER_PRESETS_CATALOG.find(preset => preset.id === 'openrouter')!);
    expect(render().find(node => node.props.id === 'provider-name')!.props.value).toBe('openrouter');
    expect(render().find(node => node.props.id === 'provider-url')!.props.value).toBe('https://openrouter.ai/api/v1');
    change('key', 'test-key');
    function chips() { return render().find(node => node.type === ModelChips)!.props as unknown as ModelChipsProps; }
    chips().onAdd?.('custom-model');
    chips().onSetDefault?.('custom-model');
    expect(chips().defaultModel).toBe('custom-model');
    invoke(render().find(node => node.type === 'form')!, 'onSubmit', { preventDefault() {} }); await settle();
    expect(api.addProvider).toHaveBeenCalledWith(expect.objectContaining({ models: ['custom-model', 'openrouter/auto'] }));
  });
  it('keeps pulled candidates visible when deselected and supports removing and reselecting', async () => {
    render(); await settle(); change('preset', 'Ollama'); invoke(button('Pull models'), 'onClick'); await settle();
    function chips() { return render().find(node => node.type === ModelChips)!.props as unknown as ModelChipsProps; }
    chips().onToggle('alpha'); expect(chips().selected).toEqual(['beta']); expect(chips().models).toEqual(['alpha', 'beta']);
    chips().onToggle('alpha'); expect(chips().selected).toEqual(['beta', 'alpha']);
    chips().onRemove?.('alpha'); expect(chips().models).toEqual(['beta']); expect(chips().selected).toEqual(['beta']);
  });
  it('shows masked config and excludes mock, switches presets and locale immediately', async () => {
    render(); await settle(); let tree = render();
    expect(tree.some(node => node.props.children === '****1234')).toBe(true);
    expect(tree.some(node => node.props.children === 'mock')).toBe(false);
    change('preset', 'Claude'); tree = render(); expect(tree.find(node => node.props.id === 'provider-protocol')!.props.value).toBe('anthropic');
    change('preset', 'Ollama'); tree = render(); expect(tree.find(node => node.props.id === 'provider-url')!.props.value).toBe('http://localhost:11434/v1');
    hooks.lang = 'zh'; expect(render().find(node => node.props.role === 'dialog')!.props['aria-label']).toBe('模型设置');
  });
  it('binds per-model evidence and carries discovered capabilities through save', async () => {
    const modelCapabilities = { alpha: { tools: { status: 'declared', value: false } } as import('@vessel/shared').ProviderCapabilities };
    vi.mocked(api.listProviders).mockResolvedValue({ providers: [{ ...configured, models: ['alpha'], modelCapabilities }] });
    render(); await settle(); expect(render().find(node => node.type === CapabilityStatus)?.props.capabilities).toBe(modelCapabilities.alpha);
    change('preset', 'Ollama'); vi.mocked(api.pullProviderModels).mockResolvedValue({ ok: true, models: ['alpha'], modelCapabilities });
    invoke(button('Pull models'), 'onClick'); await settle();
    invoke(render().find(node => node.type === 'form')!, 'onSubmit', { preventDefault() {} }); await settle();
    expect(api.addProvider).toHaveBeenCalledWith(expect.objectContaining({ models: ['alpha'], modelCapabilities }));
    change('url', 'http://localhost:11435/v1');
    invoke(render().find(node => node.type === 'form')!, 'onSubmit', { preventDefault() {} }); await settle();
    expect(api.addProvider).toHaveBeenLastCalledWith(expect.objectContaining({ modelCapabilities: undefined }));
  });
  it('validates before making requests and discovers models over keyless loopback', async () => {
    render(); await settle(); invoke(button('Test connection'), 'onClick'); await settle();
    expect(api.testProvider).not.toHaveBeenCalled(); expect(render().some(node => node.props.role === 'alert')).toBe(true);
    change('preset', 'Ollama'); invoke(button('Test connection'), 'onClick');
    expect(button('Testing connection…').props.disabled).toBe(true); await settle();
    expect(api.testProvider).toHaveBeenCalledWith(expect.objectContaining({ apiKey: '', baseUrl: 'http://localhost:11434/v1' }));
    expect(render().some(node => node.props.children === 'Connected · 156 ms')).toBe(true);
    expect(render().find(node => node.props.id === 'provider-models')!.props.value).toBe('discovered');
    change('url', 'http://localhost:11435/v1'); expect(render().some(node => node.props.children === 'Connected · 156 ms')).toBe(false);
  });
  it('saves deduplicated models, clears key and refreshes discovery', async () => {
    render(); await settle(); change('key', 'secret-value'); change('models', 'one, two，one');
    invoke(render().find(node => node.type === 'form')!, 'onSubmit', { preventDefault() {} }); await settle();
    expect(api.addProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'deepseek', apiKey: 'secret-value', models: ['one', 'two'] }));
    expect(api.listModels).toHaveBeenCalledOnce(); expect(onChanged).toHaveBeenCalledOnce();
    expect(render().find(node => node.props.id === 'provider-key')!.props.value).toBe('');
    expect(render().some(node => node.props.children === 'Provider saved.')).toBe(true);
  });
  it('requires explicit delete confirmation and supports cancellation', async () => {
    render(); await settle(); invoke(button('Delete'), 'onClick'); expect(api.deleteProvider).not.toHaveBeenCalled();
    invoke(button('Cancel'), 'onClick'); expect(button('Delete')).toBeDefined();
    invoke(button('Delete'), 'onClick'); invoke(button('Confirm'), 'onClick'); await settle();
    expect(api.deleteProvider).toHaveBeenCalledWith('existing'); expect(onChanged).toHaveBeenCalledOnce();
  });
  it.each(['save', 'delete'] as const)('announces committed %s even when discovery fails', async action => {
    render(); await settle();
    vi.mocked(api.listModels).mockRejectedValueOnce(new Error('private readback error'));
    if (action === 'save') {
      change('key', 'secret-value');
      invoke(render().find(node => node.type === 'form')!, 'onSubmit', { preventDefault() {} });
    } else { invoke(button('Delete'), 'onClick'); invoke(button('Confirm'), 'onClick'); }
    await settle();
    expect(onChanged).toHaveBeenCalledOnce();
    expect(render().some(node => node.props.children === (action === 'save' ? 'Provider saved.' : 'Provider deleted.'))).toBe(true);
    expect(render().some(node => node.props.role === 'alert')).toBe(true);
    expect(JSON.stringify(render())).not.toContain('private readback error');
    if (action === 'save') expect(render().find(node => node.props.id === 'provider-key')!.props.value).toBe('');
  });
  it('notifies before failed provider-list readback and never notifies a rejected write', async () => {
    render(); await settle(); change('key', 'secret-value');
    vi.mocked(api.addProvider).mockRejectedValueOnce(new Error('write failed'));
    invoke(render().find(node => node.type === 'form')!, 'onSubmit', { preventDefault() {} }); await settle();
    expect(onChanged).not.toHaveBeenCalled();
    expect(render().find(node => node.props.id === 'provider-key')!.props.value).toBe('secret-value');
    vi.mocked(api.listProviders).mockRejectedValueOnce(new Error('readback failed'));
    invoke(render().find(node => node.type === 'form')!, 'onSubmit', { preventDefault() {} }); await settle();
    expect(onChanged).toHaveBeenCalledOnce();
    expect(render().some(node => node.props.children === 'Provider saved.')).toBe(true);
    expect(button('Save').props.disabled).toBe(false);
  });
  it.each([['http_401', 'Connection failed · HTTP 401'], ['connection_timeout', 'Connection timed out. Check your network and retry.'], ['invalid_models_response', 'The endpoint returned an invalid model list.'], ['secret-value upstream stack', 'Connection failed. Check the endpoint and key.']])('localizes connection failure %s without exposing arbitrary server text', async (error, expected) => {
    render(); await settle(); change('preset', 'Ollama'); vi.mocked(api.testProvider).mockResolvedValue({ ok: false, error });
    invoke(button('Test connection'), 'onClick'); await settle(); expect(render().some(node => node.props.children === expected)).toBe(true);
  });
  it('handles rejected requests, releases busy state and retries list loading', async () => {
    vi.mocked(api.listProviders).mockRejectedValueOnce(new Error('private stack')); render(); await settle();
    expect(render().some(node => node.props.role === 'alert')).toBe(true);
    expect(button('Save').props.disabled).toBe(true);
    invoke(render().find(node => node.type === 'form')!, 'onSubmit', { preventDefault() {} }); await settle(); expect(api.addProvider).not.toHaveBeenCalled();
    invoke(button('Retry'), 'onClick'); await settle(); expect(button('Save').props.disabled).toBe(false);
    change('preset', 'Ollama'); vi.mocked(api.testProvider).mockRejectedValue(new Error('secret-value')); invoke(button('Test connection'), 'onClick'); await settle();
    expect(button('Test connection').props.disabled).toBe(false);
    expect(JSON.stringify(render())).not.toContain('secret-value');
  });
  it('traps tab, closes on escape and restores previous focus', async () => {
    const previous = doc.activeElement; render(); await settle(); doc.activeElement = root.controls[1]!;
    const event = { key: 'Tab', shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    invoke(render().find(node => node.props.role === 'dialog')!, 'onKeyDown', event); expect(doc.activeElement).toBe(root.controls[0]);
    invoke(render().find(node => node.props.role === 'dialog')!, 'onKeyDown', { ...event, key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce();
    hooks.cleanups.forEach(cleanup => cleanup?.()); expect(doc.activeElement).toBe(previous);
  });
  it('skips hidden pane controls when wrapping focus in either direction', async () => {
    render(); await settle();
    const hidden = new Element(); hidden.hidden = true; root.controls.push(hidden);
    const event = { key: 'Tab', shiftKey: true, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    doc.activeElement = root.controls[0]!;
    invoke(render().find(node => node.props.role === 'dialog')!, 'onKeyDown', event);
    expect(doc.activeElement).toBe(root.controls[1]);
    invoke(render().find(node => node.props.role === 'dialog')!, 'onKeyDown', { ...event, shiftKey: false });
    expect(doc.activeElement).toBe(root.controls[0]);
  });
  it('pulls the live model list into the form (task 215)', async () => {
    render(); await settle(); change('preset', 'Ollama');
    invoke(button('Pull models'), 'onClick'); await settle();
    expect(api.pullProviderModels).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', apiKey: '' }));
    expect(render().find(node => node.props.id === 'provider-models')!.props.value).toBe('alpha, beta');
    expect(render().some(node => node.props.children === 'Pulled 2 models.')).toBe(true);
  });
  it('localizes a pull failure with the concrete endpoint reason (task 215)', async () => {
    render(); await settle(); change('preset', 'Ollama');
    vi.mocked(api.pullProviderModels).mockResolvedValueOnce({ ok: false, error: 'connection_timeout' });
    invoke(button('Pull models'), 'onClick'); await settle();
    expect(render().some(node => node.props.role === 'alert')).toBe(true);
    expect(JSON.stringify(render())).toContain('Connection timed out');
  });
  it('surfaces the concrete server reason instead of a generic failure (task 215)', async () => {
    render(); await settle();
    vi.mocked(api.deleteProvider).mockRejectedValueOnce(new ApiError('unknown_provider', 404, { error: 'unknown_provider' }));
    invoke(button('Delete'), 'onClick'); invoke(button('Confirm'), 'onClick'); await settle();
    const dump = JSON.stringify(render());
    expect(dump).toContain('That provider does not exist or was already removed.');
    expect(dump).not.toContain('Operation failed');
  });
  it('labels protocols and the key field with developer-standard copy (task 215)', async () => {
    render(); await settle(); const tree = render();
    const options = tree.find(node => node.props.id === 'provider-protocol')!.props.children as ReactElement<Record<string, unknown>>[];
    expect(options.map(option => option.props.children)).toEqual(['OpenAI Compatible', 'Anthropic (Claude)']);
    expect(tree.some(node => node.type === 'label' && node.props.htmlFor === 'provider-key' && node.props.children === 'API Key')).toBe(true);
  });
  it('surfaces a corrupted provider store as an actionable reason (task 215)', async () => {
    vi.mocked(api.listProviders).mockRejectedValueOnce(new ApiError('provider_store_corrupted', 400, { error: 'provider_store_corrupted' }));
    render(); await settle();
    expect(render().some(node => node.props.role === 'alert')).toBe(true);
    const dump = JSON.stringify(render());
    expect(dump).toContain('configuration file is corrupted');
    expect(dump).not.toContain('Operation failed');
  });
  it('ignores async results after unmount', async () => {
    let resolve!: (result: { ok: boolean; latencyMs: number }) => void;
    vi.mocked(api.testProvider).mockReturnValue(new Promise(done => { resolve = done; }));
    render(); await settle(); change('preset', 'Ollama'); invoke(button('Test connection'), 'onClick'); hooks.cleanups.forEach(cleanup => cleanup?.());
    resolve({ ok: true, latencyMs: 99 }); await settle(); expect(render().some(node => node.props.children === 'Connected · 99 ms')).toBe(false);
  });
});

describe('provider validation and wire calls', () => {
  it('calls the four profile endpoints with encoded names and unchanged snapshot bodies', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}'));
    const client = createApiClient({ fetch: fetcher });
    const profile = { name: 'work/one', provider: 'existing', model: 'fast', baseUrl: 'https://work.example/v1', label: 'Work' };
    await client.listProfiles(); await client.saveProfile(profile); await client.useProfile(profile.name); await client.deleteProfile(profile.name);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/providers/profiles', '/api/providers/profiles', '/api/providers/profiles/work%2Fone/use', '/api/providers/profiles/work%2Fone']);
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]!.body))).toEqual(profile);
    expect(fetcher.mock.calls.map(call => call[1]?.method ?? 'GET')).toEqual(['GET', 'POST', 'POST', 'DELETE']);
  });
  it('rejects unsafe URLs, remote blank keys, reserved/duplicate names and empty models', () => {
    const valid = { ...PROVIDER_PRESETS.DeepSeek!, apiKey: 'key' };
    for (const baseUrl of ['file:///tmp', 'https://user:pass@example.com', 'https://example.com?key=x', 'https://example.com/#x']) expect(validateProvider({ ...valid, baseUrl }, [], true)).toBe('providerInvalidUrl');
    expect(validateProvider({ ...valid, apiKey: '' }, [], false)).toBe('providerKeyRequired');
    expect(validateProvider({ ...valid, name: 'mock' }, [], true)).toBe('providerInvalidName');
    expect(validateProvider({ ...valid, name: configured.name }, [configured], true)).toBe('providerDuplicate');
    expect(validateProvider({ ...valid, models: [] }, [], true)).toBe('providerModelsRequired');
  });
  it('uses real API endpoints, JSON bodies and encoded deletion names', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, text: async () => '{}' }) as Response);
    const client = createApiClient({ fetch: fetcher as typeof fetch }); const input = { ...PROVIDER_PRESETS.DeepSeek!, apiKey: 'key' };
    await client.listProviders(); await client.addProvider(input); await client.testProvider(input); await client.pullProviderModels(input); await client.deleteProvider('供应商/one'); await client.listModels();
    expect(fetcher.mock.calls.map(call => (call as unknown[])[0])).toEqual(['/api/providers', '/api/providers', '/api/providers/test', '/api/providers/pull-models', `/api/providers/${encodeURIComponent('供应商/one')}`, '/api/models']);
    expect(JSON.parse(String((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual(input);
    expect((fetcher.mock.calls[4] as unknown as [string, RequestInit])[1].method).toBe('DELETE');
  });
});
