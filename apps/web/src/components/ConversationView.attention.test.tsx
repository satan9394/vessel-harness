import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { ApiClient, TurnResult } from '../api';
import { ApiError } from '../api';
import type { StreamHandlers } from '../sse';
import { AttentionManager } from '../utils/attentionManager';
import ConversationView from './ConversationView';

// This package uses node, so exercise the component's real callbacks with a tiny
// hook lifecycle harness. Desktop/visual behavior is separately browser-verified.
const hooks = vi.hoisted(() => ({ cursor: 0, cells: [] as unknown[], effects: [] as Array<{ dependencies?: unknown[]; cleanup?: () => void; setup?: () => (() => void) | undefined }>, jobs: [] as Array<() => void> }));
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
      previous?.cleanup?.(); hooks.effects[index] = { dependencies, setup: effect, cleanup: effect() };
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
  (initial.find(node => node.type === 'textarea')!.props.onChange as (event: unknown) => void)({ target: { value: 'do task' } });
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
  it('preserves a newer draft and does not announce execution failure when the HTTP connection drops', async () => {
    let reject!: (reason: unknown) => void;
    vi.mocked(api.runTurn).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const request = submit();
    let tree = render();
    (tree.find(node => node.type === 'textarea')!.props.onChange as (event: unknown) => void)({ target: { value: 'keep newer draft' } });
    streams[0].handlers.onDisconnect?.();
    reject(new ApiError('connection dropped', 0, undefined)); await request;
    tree = render();
    expect(tree.find(node => node.type === 'textarea')!.props.value).toBe('keep newer draft');
    expect(completed).not.toHaveBeenCalled();
    streams[0].handlers.onTranscript?.({ messages: [], usage: [], run: { active: true } });
    streams[0].handlers.onRun?.({ active: true });
    expect(render().find(node => node.props.title === 'interruptTitle')!.props.disabled).toBe(false);
    streams[0].handlers.onRun?.({ active: false, kind: 'interrupted' });
    expect(render().find(node => node.props.title === 'interruptTitle')!.props.disabled).toBe(true);
  });
  it('restores observed messages, reasoning, widget, tool and usage after switching away and back', () => {
    render(); const first = streams[0].handlers;
    first.onConversation?.({ role: 'user', text: 'original user', ts: 1 });
    first.onThinking?.({ phase: 'start', callId: 'a', ts: 2 });
    first.onThinking?.({ phase: 'delta', callId: 'a', text: 'reasoning', ts: 3 });
    first.onConversation?.({ role: 'assistant', text: 'original assistant', ts: 4 });
    first.onTool?.({ toolCallId: 'read', toolName: 'read', status: 'started', ts: 5 });
    const widget = { id: 'approval', kind: 'permission_action' as const, status: 'pending' as const, turnIndex: 0, timestamp: 'now', payload: { actionType: 'filesystem_write' as const, description: 'allow', options: [{ id: 'yes', label: 'Yes', tone: 'primary' as const }] } };
    first.onWidget?.(widget);
    first.onUsage?.({ inputTokens: 7, outputTokens: 3, calls: 1, ts: 6 });
    const observation = { observedAt: 'snapshot' } as unknown as import('../inspector').InspectorObservation;
    first.onInspector?.(observation);
    const before = render(); const items = before.find(node => Array.isArray(node.props.items))!.props.items;
    const usage = before.find(node => node.props.usage)!.props.usage;
    render('s2'); render('s2');
    streams.at(-1)!.handlers.onConversation?.({ role: 'assistant', text: 'other session', ts: 7 }); render('s2');
    render('s1'); const restored = render('s1');
    expect(restored.find(node => Array.isArray(node.props.items))!.props.items).toEqual(items);
    expect(restored.find(node => node.props.usage)!.props.usage).toEqual(usage);
    expect(restored[0].props.observation).toEqual(observation);
    streams.at(-1)!.handlers.onWidget?.(widget);
    streams.at(-1)!.handlers.onTool?.({ toolCallId: 'read', toolName: 'read', status: 'done', ts: 15 });
    const next = render('s1').find(node => Array.isArray(node.props.items))!.props.items as import('./MessageList').ChatItem[];
    expect(next.filter(item => item.kind === 'widget')).toHaveLength(1);
    expect(next.filter(item => item.kind === 'tool')).toHaveLength(1);
    expect(next.find(item => item.kind === 'tool')?.tool).toMatchObject({ status: 'done', durationMs: 10 });
    expect(next.flatMap(item => item.msg?.text ?? [])).toEqual(['original user', 'original assistant']);
  });
  it('ignores every callback from a closed stream even after A to B to A', () => {
    render(); const old = streams[0].handlers;
    render('s2'); render('s2'); render('s1'); render('s1');
    old.onConversation?.({ role: 'assistant', text: 'stale', ts: 1 });
    old.onTool?.({ status: 'done', toolName: 'stale', ts: 1 });
    old.onUsage?.({ inputTokens: 999, calls: 99, ts: 1 });
    old.onThinking?.({ phase: 'delta', text: 'stale', ts: 1 });
    old.onInspector?.({ observedAt: 'stale' } as unknown as import('../inspector').InspectorObservation);
    const tree = render('s1');
    expect(tree.find(node => Array.isArray(node.props.items))!.props.items).toEqual([]);
    expect(tree.find(node => node.props.usage)!.props.usage).toMatchObject({ inputTokens: 0, calls: 0 });
    expect(tree[0].props.observation).toBeUndefined();
  });
  it('retains a page-local snapshot across unmount and closes incomplete reasoning', () => {
    render(); streams[0].handlers.onConversation?.({ role: 'user', text: 'remember', ts: 1 });
    streams[0].handlers.onThinking?.({ phase: 'delta', text: 'partial', callId: 'partial', ts: 2 });
    const tree = render();
    (tree.find(node => node.type === 'textarea')!.props.onChange as (event: unknown) => void)({ target: { value: 'draft' } }); render();
    for (const effect of hooks.effects) effect?.cleanup?.();
    hooks.cells = []; hooks.effects = []; hooks.jobs = []; render();
    // StrictMode repeats setup/cleanup before restored state has another render.
    for (const effect of hooks.effects) effect?.cleanup?.();
    for (const effect of hooks.effects) if (effect) effect.cleanup = effect.setup?.();
    const restored = render();
    const items = restored.find(node => Array.isArray(node.props.items))!.props.items as import('./MessageList').ChatItem[];
    expect(items[0]?.msg?.text).toBe('remember');
    expect(items.find(item => item.kind === 'thinking')?.thinking).toMatchObject({ text: 'partial', streaming: false });
    expect(restored.find(node => node.type === 'textarea')!.props.value).toBe('draft');
    expect(restored.find(node => node.type === 'button' && node.props.type === 'submit')!.props.children).toBe('send');
    api = { runTurn: vi.fn() } as unknown as ApiClient;
    for (const effect of hooks.effects) effect?.cleanup?.();
    hooks.cells = []; hooks.effects = []; hooks.jobs = []; render();
    expect(render().find(node => Array.isArray(node.props.items))!.props.items).toEqual([]);
  });
  it('keeps drafts isolated and does not resurrect a cleared screen on return', () => {
    let tree = render();
    (tree.find(node => node.type === 'textarea')!.props.onChange as (event: unknown) => void)({ target: { value: 's1 draft' } });
    streams[0].handlers.onConversation?.({ role: 'assistant', text: 'clear me', ts: 1 }); render();
    render('s2'); tree = render('s2');
    expect(tree.find(node => node.type === 'textarea')!.props.value).toBe('');
    (tree.find(node => node.type === 'textarea')!.props.onChange as (event: unknown) => void)({ target: { value: 's2 draft' } }); render('s2');
    render('s1'); tree = render('s1');
    expect(tree.find(node => node.type === 'textarea')!.props.value).toBe('s1 draft');
    render('s1', { action: 'clear', serial: 1 }); render('s1', { action: 'clear', serial: 1 });
    render('s2'); tree = render('s2');
    expect(tree.find(node => node.type === 'textarea')!.props.value).toBe('s2 draft');
    render('s1'); tree = render('s1');
    expect(tree.find(node => Array.isArray(node.props.items))!.props.items).toEqual([]);
    expect(tree.find(node => node.type === 'textarea')!.props.value).toBe('s1 draft');
  });
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
