import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api';
import { translate } from '../../i18n';
import ProviderHub from './ProviderHub';
import ProviderSettingsModal from './ProviderSettingsModal';
import { ModelChips, type ModelChipsProps } from './ModelChips';
import { PresetsGallery } from './PresetsGallery';
import { PROVIDER_PRESETS_CATALOG } from './presetsData';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
vi.mock('../LanguageProvider', () => ({ useI18n: () => ({ t: translate('en') }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (next: unknown) => { hooks.values[i] = typeof next === 'function' ? next(hooks.values[i]) : next; }];
  },
  useRef: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = { current: initial }; return hooks.values[i]; },
  useEffect: (effect: () => (() => void), deps: unknown[]) => {
    const i = hooks.cursor++; const previous = hooks.values[i] as unknown[] | undefined;
    if (!previous || deps.some((dep, j) => dep !== previous[j])) hooks.effects.push(() => { hooks.cleanups[i]?.(); hooks.cleanups[i] = effect(); });
    hooks.values[i] = deps;
  },
}));
function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup() {
  const provider = { name: 'existing', protocol: 'openai-compatible', baseUrl: 'https://example.com/v1', apiKeyMasked: '****1234', models: ['alpha'] };
  const api = { listProviders: vi.fn(async () => ({ providers: [provider] })), addProvider: vi.fn(async () => ({ provider })), listModels: vi.fn(async () => ({ models: [] })), testProvider: vi.fn(async () => ({ ok: true, latencyMs: 42 })) } as unknown as ApiClient;
  const onChanged = vi.fn();
  function render(initialPreset?: string) {
    hooks.cursor = 0;
    const panel = ProviderHub({ api, onChanged, initialPreset });
    expect(panel.type).toBe(ProviderSettingsModal);
    const tree = nodes(ProviderSettingsModal(panel.props));
    hooks.effects.splice(0).forEach(effect => effect());
    return tree;
  }
  return { api, onChanged, render };
}
afterEach(() => { hooks.cleanups.forEach(cleanup => cleanup?.()); hooks.values = []; hooks.effects = []; hooks.cleanups = []; vi.clearAllMocks(); });

describe('ProviderHub page', () => {
  it('renders the registry and editor immediately without dialog semantics or focus interception', async () => {
    const { render } = setup(); render(); await settle(); const tree = render();
    expect(tree.some(node => node.type === 'h2' && node.props.children === 'Model settings')).toBe(true);
    expect(tree.some(node => node.props.role === 'dialog' || node.props['aria-modal'])).toBe(false);
    expect(tree.some(node => node.props.children === '****1234')).toBe(true);
    expect(tree.some(node => node.type === PresetsGallery)).toBe(true);
    expect(tree.filter(node => node.type === 'button').map(node => node.props.children)).toContain('Test connection');
    const stopPropagation = vi.fn();
    (tree.find(node => node.props.role === 'region')!.props.onKeyDown as (event: unknown) => void)({ key: 'Escape', stopPropagation });
    expect(stopPropagation).not.toHaveBeenCalled();
  });
  it('configures Lark from the gallery and saves an atomic model selection with its default first', async () => {
    const { api, onChanged, render } = setup(); render(); await settle();
    const gallery = render().find(node => node.type === PresetsGallery)!;
    (gallery.props.onSelect as (preset: typeof PROVIDER_PRESETS_CATALOG[number]) => void)(PROVIDER_PRESETS_CATALOG.find(preset => preset.id === 'lark')!);
    const key = render().find(node => node.props.id === 'provider-key')!;
    (key.props.onChange as (event: unknown) => void)({ target: { value: 'fixture-key' } });
    const chips = () => render().find(node => node.type === ModelChips)!.props as unknown as ModelChipsProps;
    chips().onSelectionChange?.(['doubao-1-5-pro-32k-250115', 'custom-endpoint']);
    chips().onSetDefault?.('custom-endpoint');
    (render().find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
    await settle();
    expect(api.addProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'lark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: ['custom-endpoint', 'doubao-1-5-pro-32k-250115'] }));
    expect(onChanged).toHaveBeenCalledOnce();
  });
  it('responds to a new initial preset while the page remains mounted', async () => {
    const { render } = setup(); render('openai'); await settle();
    render('lark');
    expect(render('lark').find(node => node.props.id === 'provider-name')!.props.value).toBe('lark');
    expect(render('lark').find(node => node.props.id === 'provider-models')!.props.value).toBe('doubao-1-5-pro-32k-250115');
  });
  it('directly tests a configured provider without re-entering the API key', async () => {
    const { api, onChanged, render } = setup(); render(); await settle();
    const directBtn = render().find(node => node.type === 'button' && typeof node.props.children === 'string' && (node.props.children as string).includes('Test connection'))!;
    (directBtn.props.onClick as () => void)();
    await settle();
    expect(api.testProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'existing', apiKey: '' }));
    expect(onChanged).toHaveBeenCalledOnce();
    expect(render().some(node => node.props.children === 'Connected · 42 ms')).toBe(true);
  });
  it('retests a saved provider with a re-entered key and never sends its masked key', async () => {
    const { api, onChanged, render } = setup(); render(); await settle();
    (render().find(node => node.props.children === 'Retest connection')!.props.onClick as () => void)();
    const testForm = () => render().find(node => node.props.className === 'provider-card-test')!;
    const submit = () => (testForm().props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
    submit(); await settle(); expect(api.testProvider).not.toHaveBeenCalled();
    const input = nodes(testForm()).find(node => node.type === 'input')!;
    (input.props.onChange as (event: unknown) => void)({ target: { value: 'fixture-key' } });
    submit(); await settle();
    expect(api.testProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'existing', apiKey: 'fixture-key' }));
    expect(api.addProvider).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledOnce();
    expect(nodes(testForm()).find(node => node.type === 'input')!.props.value).toBe('');
    expect(render().some(node => node.props.children === 'Connected · 42 ms')).toBe(true);
  });
});
