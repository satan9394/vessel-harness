import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../../i18n';
import { ModelChips, type ModelChipsProps } from './ModelChips';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock('../LanguageProvider', () => ({ useI18n: () => ({ t: translate('en') }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: (initial: unknown) => {
  const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = initial;
  return [hooks.values[i], (value: unknown) => { hooks.values[i] = value; }];
} }));
function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}
function invoke(node: ReactElement<Record<string, unknown>>, handler: string, event = {}) { (node.props[handler] as (event: unknown) => void)(event); }
const onToggle = vi.fn(), onAdd = vi.fn(), onSetDefault = vi.fn(), onRemove = vi.fn();
function render(extra: Partial<ModelChipsProps> = {}) { hooks.cursor = 0; return nodes(ModelChips({ models: ['alpha', 'beta'], selected: ['alpha', 'custom'], defaultModel: 'alpha', onToggle, onAdd, onSetDefault, onRemove, ...extra })); }
beforeEach(() => { hooks.values = []; vi.clearAllMocks(); });
describe('ModelChips', () => {
  it('toggles discovered candidates and marks selection and default separately', () => {
    const tree = render();
    const toggles = tree.filter(node => node.props.className === 'model-chip-toggle');
    expect(toggles.map(node => node.props['aria-pressed'])).toEqual([true, false, true]);
    invoke(toggles[1]!, 'onClick'); expect(onToggle).toHaveBeenCalledWith('beta');
    expect(tree.filter(node => String(node.props.className).includes('is-default'))).toHaveLength(1);
  });
  it('adds trimmed manual IDs without submitting the parent form', () => {
    invoke(render().find(node => node.props.className === 'input model-chip-input')!, 'onChange', { target: { value: ' custom-model ' } });
    const event = { key: 'Enter', nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    invoke(render().find(node => node.props.className === 'input model-chip-input')!, 'onKeyDown', event);
    expect(onAdd).toHaveBeenCalledWith('custom-model'); expect(event.preventDefault).toHaveBeenCalledOnce(); expect(hooks.values[0]).toBe('');
  });
  it('keeps IME Enter intact and rejects empty and delimiter-containing IDs', () => {
    for (const value of ['', '   ', 'one,two', 'one，two', 'bad\nname']) {
      hooks.values[0] = value;
      invoke(render().find(node => node.props.className === 'input model-chip-input')!, 'onKeyDown', { key: 'Enter', nativeEvent: {}, preventDefault() {}, stopPropagation() {} });
    }
    hooks.values[0] = 'model';
    for (const extra of [{ nativeEvent: { isComposing: true } }, { keyCode: 229 }]) {
      const event = { key: 'Enter', nativeEvent: {}, preventDefault: vi.fn(), ...extra };
      invoke(render().find(node => node.props.className === 'input model-chip-input')!, 'onKeyDown', event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(onAdd).not.toHaveBeenCalled();
  });
  it('sets a default and removes unselected or manually added models', () => {
    invoke(render().find(node => node.props['aria-label'] === 'Set as default model: custom')!, 'onClick');
    expect(onSetDefault).toHaveBeenCalledWith('custom');
    invoke(render().find(node => node.props['aria-label'] === 'Remove model: beta')!, 'onClick');
    expect(onRemove).toHaveBeenCalledWith('beta');
    expect(render().some(node => node.props['aria-label'] === 'Remove model: alpha')).toBe(false);
  });
  it('disables every interactive control while busy', () => {
    expect(render({ disabled: true }).filter(node => node.type === 'button' || node.type === 'input').every(node => node.props.disabled)).toBe(true);
  });
  it('filters case-insensitively, clears with Escape, and reports no matches', () => {
    const search = () => render().find(node => node.props.type === 'search')!;
    invoke(search(), 'onChange', { target: { value: ' ALP ' } });
    expect(render().filter(node => node.props.className === 'model-chip-toggle').map(node => node.props['aria-pressed'])).toEqual([true]);
    invoke(search(), 'onKeyDown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
    expect(render().filter(node => node.props.className === 'model-chip-toggle')).toHaveLength(3);
    invoke(search(), 'onChange', { target: { value: 'missing' } });
    expect(render().some(node => node.props.children === 'No matching results')).toBe(true);
    invoke(render().find(node => node.props['aria-label'] === 'Clear model search')!, 'onClick');
    expect(search().props.value).toBe('');
  });
  it('batches only filtered models atomically and keeps hidden selections and default order', () => {
    const onSelectionChange = vi.fn();
    const extra = { models: ['alpha', 'beta', 'ALPINE', 'beta'], onSelectionChange };
    invoke(render(extra).find(node => node.props.type === 'search')!, 'onChange', { target: { value: 'alp' } });
    const action = (label: string) => invoke(render(extra).find(node => node.props.children === label)!, 'onClick');
    action('Select All'); expect(onSelectionChange).toHaveBeenLastCalledWith(['alpha', 'custom', 'ALPINE']);
    action('Deselect All'); expect(onSelectionChange).toHaveBeenLastCalledWith(['custom']);
    action('Invert'); expect(onSelectionChange).toHaveBeenLastCalledWith(['custom', 'ALPINE']);
    expect(onToggle).not.toHaveBeenCalled();
    expect(render(extra).find(node => node.props.className === 'model-chips-count')!.props.children).toBe('Selected 2 / 4');
  });
  it('filters by selection and handles hundreds of candidates without dropping manual models', () => {
    const extra = { models: Array.from({ length: 400 }, (_, i) => `model-${i}`), onSelectionChange: vi.fn() };
    const tab = (label: string) => render(extra).find(node => node.props.className === 'preset-gallery-tab' && (node.props.children as unknown[])[0] === label)!;
    invoke(tab('Selected'), 'onClick');
    expect(render(extra).filter(node => node.props.className === 'model-chip-toggle')).toHaveLength(2);
    invoke(tab('Unselected'), 'onClick');
    expect(render(extra).filter(node => node.props.className === 'model-chip-toggle')).toHaveLength(400);
    invoke(render(extra).find(node => node.props.children === 'Select All')!, 'onClick');
    expect(extra.onSelectionChange.mock.calls[0]![0]).toHaveLength(402);
  });
});
