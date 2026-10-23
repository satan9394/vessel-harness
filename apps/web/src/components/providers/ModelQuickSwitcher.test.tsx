import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelOption } from '../../api';
import { translate } from '../../i18n';
import { ModelQuickSwitcher } from './ModelQuickSwitcher';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
vi.mock('../LanguageProvider', () => ({ useI18n: () => ({ t: translate('en') }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = initial; return [hooks.values[i], (next: unknown) => { hooks.values[i] = typeof next === 'function' ? next(hooks.values[i]) : next; }]; },
  useRef: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = { current: initial }; return hooks.values[i]; },
  useId: () => 'switcher',
  useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
    const i = hooks.cursor++; const previous = hooks.values[i] as unknown[] | undefined;
    if (!previous || deps.some((dep, index) => dep !== previous[index])) hooks.effects.push(() => { hooks.cleanups[i]?.(); const cleanup = effect(); if (cleanup) hooks.cleanups[i] = cleanup; });
    hooks.values[i] = deps;
  },
}));
function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}
function invoke(node: ReactElement<Record<string, unknown>>, handler: string, event = {}) { (node.props[handler] as (event: unknown) => void)(event); }
const onSelect = vi.fn(), onOpenSettings = vi.fn();
const focus = vi.fn(), scrollIntoView = vi.fn();
const search = { focus }, trigger = { focus };
const root = { contains: (target: unknown) => target === search, querySelectorAll: () => [{ scrollIntoView }, { scrollIntoView }, { scrollIntoView }] };
const models: ModelOption[] = [
  { id: 'a', providerName: 'alpha', name: 'A', protocol: 'openai-compatible' },
  { id: 'b', providerName: 'beta', name: 'B', protocol: 'anthropic' },
  { id: 'c', providerName: 'alpha', name: 'C', protocol: 'openai-compatible' },
  { id: 'mock', providerName: 'mock', name: 'Mock', protocol: 'mock' },
];
function render(disabled = false) {
  hooks.cursor = 0;
  const tree = nodes(ModelQuickSwitcher({ models, current: { provider: 'alpha', model: 'a' }, onSelect, onOpenSettings, disabled }));
  for (const node of tree) if (node.props.ref) (node.props.ref as { current: unknown }).current = node.type === 'input' ? search : node.type === 'button' ? trigger : root;
  hooks.effects.splice(0).forEach(effect => effect());
  return tree;
}
function open() { invoke(render().find(node => node.props.className === 'model-switcher-trigger')!, 'onClick'); return render(); }
const doc = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
beforeEach(() => { hooks.values = []; hooks.effects = []; hooks.cleanups = []; vi.clearAllMocks(); vi.stubGlobal('document', doc); });
afterEach(() => { hooks.cleanups.forEach(cleanup => cleanup?.()); vi.unstubAllGlobals(); });
describe('ModelQuickSwitcher', () => {
  it('finds and explicitly chooses the offline Mock model', () => {
    open();
    invoke(render().find(node => node.type === 'input')!, 'onChange', { target: { value: 'mock' } });
    const options = render().filter(node => node.props.role === 'option');
    expect(options).toHaveLength(1);
    invoke(options[0]!, 'onClick');
    expect(onSelect).toHaveBeenCalledWith({ provider: 'mock', model: 'mock' });
  });

  it('toggles the panel, groups providers, and filters models', () => {
    expect(render().some(node => node.props.role === 'dialog')).toBe(false);
    expect(open().filter(node => node.props.role === 'option').map(node => node.props.id)).toEqual(['switcher-item-0', 'switcher-item-1', 'switcher-item-2', 'switcher-item-3']);
    invoke(render().find(node => node.type === 'input')!, 'onChange', { target: { value: ' beta ' } });
    expect(render().filter(node => node.props.role === 'option')).toHaveLength(1);
    invoke(render().find(node => node.props.role === 'option')!, 'onClick');
    expect(onSelect).toHaveBeenCalledWith({ provider: 'beta', model: 'b' });
    expect(render().some(node => node.props.role === 'dialog')).toBe(false);
    expect(focus).toHaveBeenCalled();
  });
  it('navigates the grouped display order with arrows and Enter', () => {
    open();
    const event = { key: 'ArrowDown', nativeEvent: {}, preventDefault: vi.fn() };
    invoke(render()[0]!, 'onKeyDown', event); render();
    invoke(render()[0]!, 'onKeyDown', { ...event, key: 'Enter', target: search });
    expect(onSelect).toHaveBeenCalledWith({ provider: 'alpha', model: 'c' });
    expect(scrollIntoView).toHaveBeenCalled();
  });
  it('wraps ArrowUp and dismisses with Escape without submitting or selecting', () => {
    open();
    invoke(render()[0]!, 'onKeyDown', { key: 'ArrowUp', nativeEvent: {}, preventDefault() {} });
    expect(render().find(node => node.type === 'input')!.props['aria-activedescendant']).toBe('switcher-item-3');
    invoke(render()[0]!, 'onKeyDown', { key: 'Escape', nativeEvent: {}, preventDefault() {}, stopPropagation() {} });
    expect(render().some(node => node.props.role === 'dialog')).toBe(false); expect(onSelect).not.toHaveBeenCalled();
  });
  it('dismisses outside clicks and unregisters listeners on close', () => {
    open();
    const outside = doc.addEventListener.mock.calls[0]![1] as (event: unknown) => void;
    outside({ target: search }); expect(render().some(node => node.props.role === 'dialog')).toBe(true);
    outside({ target: {} }); expect(render().some(node => node.props.role === 'dialog')).toBe(false);
    expect(doc.removeEventListener).toHaveBeenCalledWith('pointerdown', outside);
  });
  it('handles no matches, settings, and disabled state', () => {
    open(); invoke(render().find(node => node.type === 'input')!, 'onChange', { target: { value: 'missing' } });
    invoke(render()[0]!, 'onKeyDown', { key: 'Enter', nativeEvent: {}, target: search, preventDefault() {} });
    expect(onSelect).not.toHaveBeenCalled();
    expect(render().some(node => node.props.role === 'status')).toBe(true);
    invoke(render().find(node => node.props.className === 'btn model-switcher-footer')!, 'onClick'); expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(render(true).find(node => node.props.className === 'model-switcher-trigger')!.props.disabled).toBe(true);
    expect(render(true).some(node => node.props.role === 'dialog')).toBe(false);
  });
});
