import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../../i18n';
import { PresetsGallery } from './PresetsGallery';
import { PROVIDER_PRESETS_CATALOG } from './presetsData';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock('../LanguageProvider', () => ({ useI18n: () => ({ t: translate('en') }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: (initial: unknown) => {
  const index = hooks.cursor++; if (!(index in hooks.values)) hooks.values[index] = initial;
  return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
} }));
function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}
function invoke(node: ReactElement<Record<string, unknown>>, handler: string, event = {}) { (node.props[handler] as (event: unknown) => void)(event); }
const onSelect = vi.fn();
function render() { hooks.cursor = 0; return nodes(PresetsGallery({ onSelect, selectedId: 'deepseek' })); }
function cards() { return render().filter(node => node.props.className === 'preset-card'); }
beforeEach(() => { hooks.values = []; vi.clearAllMocks(); });
describe('PresetsGallery', () => {
  it('renders English display names and descriptions across the catalog', () => {
    const labels = render().filter(node => node.type === 'strong' || node.type === 'small').map(node => node.props.children).join(' ');
    expect(labels).toContain('Lark (Volcengine Ark)');
    expect(labels).toContain('Built-in offline provider');
    expect(labels).not.toMatch(/[\u3400-\u9fff]/);
  });
  it('finds and selects the built-in offline Mock preset', () => {
    invoke(render().find(node => node.type === 'input')!, 'onChange', { target: { value: 'mock' } });
    expect(cards()).toHaveLength(1);
    invoke(cards()[0]!, 'onClick');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'mock', protocol: 'mock', auth: 'none' }));
  });
  it('shows the full catalog and filters by category and case-insensitive search together', () => {
    expect(cards()).toHaveLength(PROVIDER_PRESETS_CATALOG.length);
    invoke(render().find(node => node.props.children === 'CN')!, 'onClick');
    expect(cards()).toHaveLength(PROVIDER_PRESETS_CATALOG.filter(preset => preset.category === 'cn').length);
    invoke(render().find(node => node.type === 'input')!, 'onChange', { target: { value: '  DEEPSEEK  ' } });
    expect(cards()).toHaveLength(1); expect(cards()[0]!.props['aria-pressed']).toBe(true);
    invoke(cards()[0]!, 'onClick'); expect(onSelect).toHaveBeenCalledWith(PROVIDER_PRESETS_CATALOG.find(preset => preset.id === 'deepseek'));
  });
  it('shows an empty state for a nonmatching query', () => {
    invoke(render().find(node => node.type === 'input')!, 'onChange', { target: { value: 'no-such-provider' } });
    expect(cards()).toHaveLength(0); expect(render().some(node => node.props.role === 'status')).toBe(true);
  });
});
