import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommandPalette, { isPaletteShortcut, isTypingTarget, trapFocus } from '../common/CommandPalette';
import MessageList from '../MessageList';
import NewSessionForm from '../NewSessionForm';
import type { ApiClient } from '../../api';
import { createCommandRegistry, searchCommands, type CommandItem } from './types';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }];
  },
  useRef: (initial: unknown) => { const index = hooks.cursor++; if (!(index in hooks.values)) hooks.values[index] = { current: initial }; return hooks.values[index]; },
  useId: () => 'palette',
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const index = hooks.cursor++; const previous = hooks.values[index] as unknown[] | undefined;
    if (!previous || deps.some((value, i) => value !== previous[i])) hooks.effects.push(() => { hooks.cleanups[index]?.(); hooks.cleanups[index] = effect() ?? (() => {}); });
    hooks.values[index] = deps;
  },
}));
function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}
class Element {
  isConnected = true;
  dataset: Record<string, string> = {};
  parent: Element | null = null;
  controls: Element[] = [];
  editable = false;
  choice: Element | null = null;
  focus = vi.fn(() => { doc.activeElement = this; });
  blur = vi.fn(() => { doc.activeElement = null; });
  scrollIntoView = vi.fn();
  closest = (selector: string): Element | null => selector.includes('input,') ? (this.editable ? this : null) : selector === '[data-message-card]' ? this.parent : null;
  querySelectorAll = () => this.controls;
  querySelector = (): Element | null => this.choice;
  contains = (value: unknown) => value === this || this.controls.includes(value as Element);
}
const doc = { activeElement: null as Element | null, querySelector: vi.fn((): Element | null => null) };
const listeners = new Set<(event: unknown) => void>();
const event = (key: string, extra = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, defaultPrevented: false, target: doc.activeElement, preventDefault: vi.fn(), stopPropagation: vi.fn(), nativeEvent: { isComposing: false }, ...extra });
const fire = (key: string, extra = {}) => { const value = event(key, extra); listeners.forEach(listener => listener(value)); return value; };
const command: CommandItem = { id: 'a', title: 'Canvas Inspector AST', category: 'navigation', execute: vi.fn() };
const flush = () => { hooks.effects.splice(0).forEach(effect => effect()); };
function palette(commands = [command]) {
  hooks.cursor = 0;
  const tree = nodes(CommandPalette({ commands }));
  tree.forEach(node => { if (node.props.ref) (node.props.ref as { current: unknown }).current = new Element(); });
  flush(); return tree;
}
const invoke = (node: ReactElement<Record<string, unknown>>, name: string, value?: unknown) => (node.props[name] as (event?: unknown) => void)(value);
beforeEach(() => {
  vi.stubGlobal('HTMLElement', Element); vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { addEventListener: (_: string, listener: (event: unknown) => void) => listeners.add(listener), removeEventListener: (_: string, listener: (event: unknown) => void) => listeners.delete(listener) });
  doc.querySelector.mockReturnValue(null); doc.activeElement = new Element();
});
afterEach(() => { hooks.cleanups.forEach(cleanup => cleanup?.()); hooks.values = []; hooks.effects = []; hooks.cleanups = []; listeners.clear(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('command palette keyboard and registry', () => {
  it('fuzzy matches title/keywords and unregisters only its own registration', () => {
    expect(searchCommands([command], 'cnvast')).toEqual([command]);
    expect(searchCommands([command], 'xyz')).toEqual([]);
    const registry = createCommandRegistry(); const old = registry.register(command);
    const replacement = { ...command, title: 'Session' }; const remove = registry.register(replacement);
    old(); expect(registry.search('session')).toEqual([replacement]); remove(); expect(registry.search('')).toEqual([]);
  });
  it.each(['ctrlKey', 'metaKey'])('opens with %s+K, closes with Esc and restores prior focus', modifier => {
    const previous = doc.activeElement!; palette(); fire('k', { [modifier]: true });
    const tree = palette(); const dialog = tree.find(node => node.props.role === 'dialog')!;
    expect(dialog).toBeDefined(); expect(doc.activeElement).not.toBe(previous);
    invoke(dialog, 'onKeyDown', event('Escape')); expect(palette().some(node => node.props.role === 'dialog')).toBe(false);
    expect(doc.activeElement).toBe(previous);
  });
  it('filters, selects with arrows and executes exactly once with Enter', async () => {
    const second = { ...command, id: 'b', title: 'Canvas Inspector cache', execute: vi.fn() };
    palette([command, second]); fire('k', { ctrlKey: true }); let tree = palette([command, second]);
    invoke(tree.find(node => node.type === 'input')!, 'onChange', { target: { value: 'canvas' } }); tree = palette([command, second]);
    invoke(tree.find(node => node.type === 'input')!, 'onKeyDown', event('ArrowDown')); tree = palette([command, second]);
    expect(tree.find(node => node.props.role === 'option' && node.props['aria-selected'] === true)?.props.children).toContain(second.title);
    invoke(tree.find(node => node.type === 'input')!, 'onKeyDown', event('Enter')); palette([command, second]); await Promise.resolve();
    expect(second.execute).toHaveBeenCalledOnce(); expect(command.execute).not.toHaveBeenCalled();
  });
  it('blocks opening over another dialog and ignores composition/extra modifiers', () => {
    palette(); doc.querySelector.mockReturnValue(new Element()); fire('k', { ctrlKey: true }); expect(palette().some(node => node.props.role === 'dialog')).toBe(false);
    expect(isPaletteShortcut(event('k', { ctrlKey: true, isComposing: true }))).toBe(false);
    expect(isPaletteShortcut(event('k', { ctrlKey: true, altKey: true }))).toBe(false);
  });
  it('does not treat typing ? as a shortcut and does not execute an empty result', async () => {
    palette(); doc.activeElement!.editable = true; fire('?'); expect(palette().some(node => node.props.role === 'dialog')).toBe(false);
    fire('k', { ctrlKey: true }); let tree = palette();
    invoke(tree.find(node => node.type === 'input')!, 'onChange', { target: { value: 'no match' } }); tree = palette();
    invoke(tree.find(node => node.type === 'input')!, 'onKeyDown', event('Enter')); await Promise.resolve(); expect(command.execute).not.toHaveBeenCalled();
  });
  it('traps forward/reverse Tab and recognizes editable descendants', () => {
    const dialog = new Element(); const first = new Element(); const last = new Element(); dialog.controls = [first, last];
    doc.activeElement = last; const forward = event('Tab'); trapFocus(forward, dialog as unknown as HTMLElement); expect(doc.activeElement).toBe(first); expect(forward.preventDefault).toHaveBeenCalled();
    trapFocus(event('Tab', { shiftKey: true }), dialog as unknown as HTMLElement); expect(doc.activeElement).toBe(last);
    first.editable = true; expect(isTypingTarget(first as unknown as EventTarget)).toBe(true);
  });
});

describe('message navigation guards', () => {
  it('navigates actual cards, folds with Space, exits with Esc, and respects typing/dialogs', () => {
    const first = new Element(); first.parent = first; first.dataset.messageCard = '1'; const second = new Element(); second.parent = second; second.dataset.messageCard = '2';
    const root = new Element(); root.controls = [first, second]; const previous = doc.activeElement!;
    const items = [{ id: '1', kind: 'message' as const }, { id: '2', kind: 'message' as const }];
    const render = () => { hooks.cursor = 0; const tree = nodes(MessageList({ items, thinking: false })); (tree[0].props.ref as { current: unknown }).current = root; flush(); return tree; };
    render(); previous.editable = true; fire('j'); expect(doc.activeElement).toBe(previous); previous.editable = false;
    doc.querySelector.mockReturnValue(new Element()); fire('j'); expect(doc.activeElement).toBe(previous); doc.querySelector.mockReturnValue(null);
    fire('j'); expect(doc.activeElement).toBe(first); fire('j'); expect(doc.activeElement).toBe(second); fire('k'); expect(doc.activeElement).toBe(first);
    fire(' '); expect(render().some(node => node.props.hidden === true)).toBe(true);
    fire(' '); render(); first.choice = new Element(); first.choice.parent = first; fire('Enter'); expect(doc.activeElement).toBe(first.choice);
    fire('Escape'); expect(doc.activeElement).toBe(previous);
  });
  it('submits the real new-session permission preset without modifying an existing session', async () => {
    const api = { listModels: vi.fn(async () => ({ models: [] })), openProject: vi.fn(async () => ({})), createSession: vi.fn(async () => ({ session: { id: 'new', workspaceRoot: 'E:/work' } })) };
    const onCreated = vi.fn(); const onClose = vi.fn();
    const render = () => { hooks.cursor = 0; return nodes(NewSessionForm({ api: api as unknown as ApiClient, initialPermission: 'read-only', onCreated, onClose })); };
    let tree = render(); flush(); tree = render(); expect(tree.find(node => node.props.id === 'sessionPermission')!.props.value).toBe('read-only');
    invoke(tree.find(node => node.type === 'input')!, 'onChange', { target: { value: 'E:/work' } }); await vi.waitFor(() => expect(render().find(node => node.type === 'button' && node.props.type === 'submit')!.props.disabled).toBe(false)); tree = render();
    await (tree.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => Promise<void>)(event('submit'));
    expect(api.createSession).toHaveBeenCalledWith({ workspaceRoot: 'E:/work', permission: 'read-only' }); expect(onCreated).toHaveBeenCalledWith({ sessionId: 'new', projectRoot: 'E:/work' }); expect(onClose).toHaveBeenCalledOnce();
  });
});

// Use the real English dictionary while exercising JSX handlers without a renderer.
vi.mock('../LanguageProvider', async () => {
  const { translate } = await import('../../i18n');
  return { useI18n: () => ({ lang: 'en', t: translate('en'), setLang: vi.fn() }) };
});
