import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { ApiClient, TurnResult } from '../api';
import type { StreamHandlers } from '../sse';
import { AttentionManager } from '../utils/attentionManager';
import ConversationView from './ConversationView';

// This package uses node, so exercise the component's real callbacks with a tiny
// hook lifecycle harness. Desktop/visual behavior is separately browser-verified.
const hooks = vi.hoisted(() => ({ cursor: 0, cells: [] as unknown[], effects: [] as Array<{ dependencies?: unknown[]; cleanup?: () => void }>, jobs: [] as Array<() => void> }));
const streams = vi.hoisted(() => [] as Array<{ handlers: StreamHandlers; close: ReturnType<typeof vi.fn> }>);
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.cells)) hooks.cells[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.cells[index], (value: unknown) => { hooks.cells[index] = typeof value === 'function' ? (value as (previous: unknown) => unknown)(hooks.cells[index]) : value; }];
  },
  useRef: (initial: unknown) => { const index = hooks.cursor++; return hooks.cells[index] ??= { current: initial }; },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => (() => void) | undefined, dependencies?: unknown[]) => {
    const index = hooks.cursor++; const previous = hooks.effects[index];
    if (!previous || dependencies?.some((value, i) => value !== previous.dependencies?.[i])) hooks.jobs.push(() => {
      previous?.cleanup?.(); hooks.effects[index] = { dependencies, cleanup: effect() };
    });
  },
}));
vi.mock('./LanguageProvider', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../sse', async importOriginal => ({
  ...await importOriginal<typeof import('../sse')>(),
  createEventStream: (_url: string, handlers: StreamHandlers) => { const stream = { handlers, close: vi.fn() }; streams.push(stream); return stream; },
}));
function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}
let api: ApiClient;
let attention: AttentionManager;
let completed: ReturnType<typeof vi.spyOn>;
function render(sessionId = 's1', viewRequest?: Parameters<typeof ConversationView>[0]['viewRequest']) {
  hooks.cursor = 0;
  const tree = ConversationView({ sessionId, api, attention, viewRequest });
  for (const job of hooks.jobs.splice(0)) job();
  return nodes(tree);
}
function submit() {
  const initial = render();
  (initial.find(node => node.type === 'input')!.props.onChange as (event: unknown) => void)({ target: { value: 'do task' } });
  const tree = render();
  return (tree.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
}
beforeEach(() => {
  hooks.cells = []; hooks.effects = []; hooks.jobs = []; streams.splice(0);
  api = { runTurn: vi.fn() } as unknown as ApiClient;
  attention = new AttentionManager(); completed = vi.spyOn(attention, 'completed').mockImplementation(() => {});
  vi.spyOn(attention, 'unlockAudio').mockImplementation(() => {});
});
afterEach(() => { for (const effect of hooks.effects) effect?.cleanup?.(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('attention integration and stale turn guards', () => {
  it('uses actual successful local runTurn duration and unlocks from submit', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    let finish!: (value: TurnResult) => void;
    vi.mocked(api.runTurn).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = submit(); expect(attention.unlockAudio).toHaveBeenCalledOnce();
    vi.setSystemTime(5500); finish({ kind: 'success', finalText: 'done', steps: [], turnId: 'turn' }); await pending;
    expect(completed).toHaveBeenCalledWith('success', 5500);
  });
  it.each(['success', 'error'])('ignores a stale %s turn even after switching away and back', async kind => {
    let finish!: (value: TurnResult) => void; let reject!: (reason: Error) => void;
    vi.mocked(api.runTurn).mockImplementation(() => new Promise((resolve, fail) => { finish = resolve; reject = fail; }));
    const pending = submit(); const old = streams[0]; render('s2'); render('s1');
    if (kind === 'error') reject(new Error('old error'));
    else finish({ kind, finalText: 'old', steps: [], turnId: 'old' });
    await pending; expect(completed).not.toHaveBeenCalled(); expect(old.close).toHaveBeenCalledOnce();
    const widget = vi.spyOn(attention, 'widget');
    old.handlers.onWidget?.({ id: 'stale', kind: 'permission_action', status: 'pending', turnIndex: 0, timestamp: 'now', payload: { actionType: 'filesystem_write', description: 'stale', options: [] } });
    expect(widget).not.toHaveBeenCalled();
  });
  it('routes actual failed local request to warning attention', async () => {
    vi.mocked(api.runTurn).mockRejectedValue(new Error('provider unavailable'));
    await submit(); expect(completed).toHaveBeenCalledWith('error', expect.any(Number));
  });
  it('clears attention after an actual local decision response', async () => {
    api.respondWidget = vi.fn(async () => ({ success: true as const }));
    const tree = render(); const clear = vi.spyOn(attention, 'clear'); const resolved = vi.spyOn(attention, 'resolvedWidget');
    await (tree.find(node => node.props.onRespond)!.props.onRespond as (widget: string, option: string) => Promise<void>)('permission', 'allow');
    expect(api.respondWidget).toHaveBeenCalledWith('s1', 'permission', 'allow');
    expect(resolved).toHaveBeenCalledWith('s1', 'permission'); expect(clear).toHaveBeenCalledOnce();
  });
  it('does not clear current attention for a stale local decision response', async () => {
    let finish!: (value: { success: true }) => void;
    api.respondWidget = vi.fn(() => new Promise<{ success: true }>(resolve => { finish = resolve; }));
    const tree = render();
    const pending = (tree.find(node => node.props.onRespond)!.props.onRespond as (widget: string, option: string) => Promise<void>)('permission', 'allow');
    render('s2'); render('s1'); const resolved = vi.spyOn(attention, 'resolvedWidget'); const clear = vi.spyOn(attention, 'clear');
    finish({ success: true }); await pending;
    expect(resolved).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
  });
  it.each(['clear', 'collapse', 'expand', 'export', 'ast', 'cache'] as const)('finishes an active turn after same-session %s view command', async action => {
    if (action === 'export') vi.stubGlobal('document', { createElement: () => ({ click: vi.fn() }) });
    let finish!: (value: TurnResult) => void;
    vi.mocked(api.runTurn).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = submit();
    const busy = render('s1', { action, serial: 1 });
    expect(busy.find(node => node.type === 'button' && node.props.type === 'submit')!.props.children).toBe('running');
    finish({ kind: 'success', finalText: 'done', steps: [], turnId: 'turn' }); await pending;
    expect(completed).toHaveBeenCalledWith('success', expect.any(Number));
    const finished = render('s1', { action, serial: 1 });
    expect(finished.find(node => node.type === 'button' && node.props.type === 'submit')!.props.children).toBe('send');
  });
  it('accepts a local permission response after a same-session view command', async () => {
    let finish!: (value: { success: true }) => void;
    api.respondWidget = vi.fn(() => new Promise<{ success: true }>(resolve => { finish = resolve; }));
    const tree = render();
    const pending = (tree.find(node => node.props.onRespond)!.props.onRespond as (widget: string, option: string) => Promise<void>)('permission', 'allow');
    render('s1', { action: 'collapse', serial: 1 });
    const resolved = vi.spyOn(attention, 'resolvedWidget');
    finish({ success: true }); await pending; expect(resolved).toHaveBeenCalledWith('s1', 'permission');
  });
});
