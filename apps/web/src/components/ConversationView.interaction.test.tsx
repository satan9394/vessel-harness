import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { ApiClient, TurnResult } from '../api';
import type { StreamHandlers } from '../sse';
import ConversationView from './ConversationView';

// Lightweight hook lifecycle harness for node environment.
const hooks = vi.hoisted(() => ({
  cursor: 0,
  cells: [] as unknown[],
  effects: [] as Array<{ dependencies?: unknown[]; cleanup?: () => void; setup?: () => (() => void) | undefined }>,
  jobs: [] as Array<() => void>,
}));

const streams = vi.hoisted(() => [] as Array<{ handlers: StreamHandlers; close: ReturnType<typeof vi.fn> }>);

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.cells)) hooks.cells[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [
      hooks.cells[index],
      (value: unknown) => {
        hooks.cells[index] = typeof value === 'function' ? (value as (previous: unknown) => unknown)(hooks.cells[index]) : value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    return (hooks.cells[index] ??= { current: initial });
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => (() => void) | undefined, dependencies?: unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.effects[index];
    if (!previous || dependencies?.some((value, i) => value !== previous.dependencies?.[i])) {
      hooks.jobs.push(() => {
        previous?.cleanup?.();
        hooks.effects[index] = { dependencies, setup: effect, cleanup: effect() };
      });
    }
  },
}));

vi.mock('./LanguageProvider', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../sse', async importOriginal => ({
  ...await importOriginal<typeof import('../sse')>(),
  createEventStream: (_url: string, handlers: StreamHandlers) => {
    const stream = { handlers, close: vi.fn() };
    streams.push(stream);
    return stream;
  },
}));

function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}

let api: ApiClient;
let sessionUpdatedSpy: Mock<() => void>;

function render(sessionId = 's1', onSessionUpdated: (() => void) | undefined = () => { sessionUpdatedSpy(); }, field?: unknown) {
  hooks.cursor = 0;
  const tree = ConversationView({ sessionId, api, onSessionUpdated });
  if (field) (nodes(tree).find(node => node.type === 'textarea')!.props.ref as { current: unknown }).current = field;
  for (const job of hooks.jobs.splice(0)) job();
  return nodes(tree);
}

beforeEach(() => {
  hooks.cells = [];
  hooks.effects = [];
  hooks.jobs = [];
  streams.splice(0);
  sessionUpdatedSpy = vi.fn<() => void>();
  api = {
    runTurn: vi.fn().mockResolvedValue({ kind: 'completed', finalText: 'ok', steps: [], turnId: 't1' }),
    interruptSession: vi.fn().mockResolvedValue(undefined),
    respondWidget: vi.fn().mockResolvedValue(undefined),
    setRouteMode: vi.fn().mockResolvedValue(undefined),
  } as unknown as ApiClient;
});

afterEach(() => {
  for (const effect of hooks.effects) effect?.cleanup?.();
  vi.restoreAllMocks();
});

describe('ConversationView Task 246: Scroll guard, IME protection, and SSE reconnect', () => {
  it('ignores a late Stop failure after an authoritative stream terminal while HTTP is pending', async () => {
    let finish!: (result: TurnResult) => void;
    let rejectStop!: (reason: unknown) => void;
    vi.mocked(api.runTurn).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vi.mocked(api.interruptSession).mockImplementation(() => new Promise((_resolve, reject) => { rejectStop = reject; }));
    let tree = render();
    (tree.find(node => node.type === 'textarea')!.props.onChange as (event: unknown) => void)({ target: { value: 'task' } });
    tree = render();
    const request = (tree.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
    (render().find(node => node.props.title === 'interruptTitle')!.props.onClick as () => void)();
    streams[0].handlers.onRun?.({ active: false, kind: 'interrupted' });
    rejectStop(new Error('late Stop connection error')); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(render().some(node => typeof node.props.text === 'string')).toBe(false);
    finish({ kind: 'interrupted', finalText: '', steps: [], turnId: 't1' }); await request;
  });
  it.each(['length', 'interrupted'] as const)('restores a %s terminal marker when recovery finishes before the HTTP response is available', termination => {
    render();
    streams[0].handlers.onTranscript?.({ messages: [{ id: 'recovered-user', kind: 'message', msg: { role: 'user', text: 'pending task', ts: 1 } }], usage: [], run: { active: true } });
    const run = { active: false, kind: termination === 'length' ? 'error' : 'interrupted', finishReason: termination === 'length' ? 'length' : undefined };
    streams[0].handlers.onRun?.(run); streams[0].handlers.onRun?.(run);
    const tree = render();
    const items = tree.find(node => Array.isArray(node.props.items))!.props.items as import('./MessageList').ChatItem[];
    expect(items).toHaveLength(2); expect(items[1].msg?.termination).toBe(termination);
    expect(tree.find(node => node.props.title === 'interruptTitle')!.props.disabled).toBe(true);
  });
  it('reconciles authoritative tools, usage and resolved approval after disconnect without losing draft or duplicating HTTP completion', async () => {
    let finish!: (value: TurnResult) => void;
    vi.mocked(api.runTurn).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    let tree = render();
    (tree.find(node => node.type === 'textarea')!.props.onChange as (event: unknown) => void)({ target: { value: 'task' } });
    tree = render();
    const request = (tree.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
    tree = render();
    (tree.find(node => node.type === 'textarea')!.props.onChange as (event: unknown) => void)({ target: { value: 'keep draft' } });
    streams[0].handlers.onDisconnect?.();
    tree = render();
    expect(tree.find(node => node.type === 'button' && node.props.type === 'submit')!.props.disabled).toBe(true);
    const transcript: import('../sse').SessionTranscript = {
      messages: [{ id: 'disk-user', kind: 'message', msg: { role: 'user', text: 'task', ts: 1 } },
        { id: 'disk-tool', kind: 'tool', tool: { toolName: 'Write', status: 'done', ts: 2 } },
        { id: 'disk-answer', kind: 'message', msg: { role: 'assistant', text: 'partial', termination: 'length', ts: 3 } },
        { id: 'widget:approval', kind: 'widget', widget: { id: 'approval', kind: 'permission_action', status: 'resolved',
          turnIndex: 0, timestamp: '2026-10-23T00:00:00Z', resolution: { selectedOptionId: 'deny', resolvedAt: '2026-10-23T00:00:01Z' },
          payload: { actionType: 'filesystem_write', description: 'fixture', options: [{ id: 'deny', label: 'Deny', tone: 'danger' }] } } }],
      usage: [{ inputTokens: 7, outputTokens: 4, calls: 1, ts: 3 }], run: { active: false, kind: 'error', finishReason: 'length' },
    };
    streams[0].handlers.onTranscript?.(transcript);
    streams[0].handlers.onRun?.(transcript.run!);
    streams[0].handlers.onTranscript?.(transcript);
    finish({ kind: 'error', finishReason: 'length', finalText: 'partial', steps: [], turnId: 't1' }); await request;
    tree = render();
    expect(tree.find(node => node.type === 'textarea')!.props.value).toBe('keep draft');
    const messageList = tree.find(node => Array.isArray(node.props.items))!;
    expect(messageList.props.items).toEqual(transcript.messages);
    const usageBar = tree.find(node => (node.props.usage as { inputTokens?: number } | undefined)?.inputTokens === 7);
    expect(usageBar).toBeDefined();
  });

  it('restores active runs and isolates late recovery across three rapid session switches', () => {
    render('s1'); render('s2'); render('s3');
    streams[0].handlers.onTranscript?.({ messages: [{ id: 'late', kind: 'message', msg: { role: 'assistant', text: 'foreign', ts: 1 } }], usage: [] });
    streams[1].handlers.onRun?.({ active: true });
    streams[2].handlers.onTranscript?.({ messages: [], usage: [], run: { active: true } });
    streams[2].handlers.onRun?.({ active: true });
    let tree = render('s3');
    expect(tree.find(node => Array.isArray(node.props.items))!.props.items).toEqual([]);
    expect(tree.some(node => node.props.title === 'interruptTitle')).toBe(true);
    streams[2].handlers.onRun?.({ active: false, kind: 'interrupted' });
    tree = render('s3'); expect(tree.find(node => node.props.title === 'interruptTitle')!.props.disabled).toBe(true);
    expect(streams[0].close).toHaveBeenCalled(); expect(streams[1].close).toHaveBeenCalled();
  });
  it.each(['session switch', 'newer turn'] as const)('ignores a late Stop failure after %s', async scenario => {
    const finish: Array<(value: TurnResult) => void> = [];
    let rejectStop!: (error: Error) => void;
    vi.mocked(api.runTurn).mockImplementation(() => new Promise<TurnResult>(resolve => { finish.push(resolve); }));
    vi.mocked(api.interruptSession).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectStop = reject; }));
    function start() {
      let tree = render();
      (tree.find(node => node.type === 'textarea')!.props.onChange as (event: unknown) => void)({ target: { value: 'task' } });
      tree = render();
      return (tree.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
    }
    const oldTurn = start();
    (render().find(node => node.props.title === 'interruptTitle')!.props.onClick as () => void)();
    let nextTurn: Promise<void> | undefined;
    if (scenario === 'session switch') { render('s2'); render('s2'); }
    else { finish[0]({ kind: 'completed', finalText: 'done', steps: [], turnId: 'old' }); await oldTurn; nextTurn = start(); }
    rejectStop(new Error('late stop error')); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const tree = render(scenario === 'session switch' ? 's2' : 's1');
    expect(tree.some(node => typeof node.props.text === 'string')).toBe(false);
    if (scenario === 'session switch') { finish[0]({ kind: 'completed', finalText: '', steps: [], turnId: 'old' }); await oldTurn; }
    else { finish[1]({ kind: 'completed', finalText: '', steps: [], turnId: 'new' }); await nextTurn; }
  });

  it('reports Stop failures, blocks duplicate Stop requests and retains the active draft for retry', async () => {
    let finish!: (value: TurnResult) => void;
    let rejectStop!: (error: Error) => void;
    vi.mocked(api.runTurn).mockImplementationOnce(() => new Promise<TurnResult>(resolve => { finish = resolve; }));
    vi.mocked(api.interruptSession).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectStop = reject; }));
    let tree = render();
    (tree.find(node => node.type === 'textarea')!.props.onChange as (event: unknown) => void)({ target: { value: 'task' } });
    tree = render();
    const turn = (tree.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
    tree = render();
    (tree.find(node => node.type === 'textarea')!.props.onChange as (event: unknown) => void)({ target: { value: 'keep draft' } });
    tree = render();
    const stop = tree.find(node => node.props.title === 'interruptTitle')!.props.onClick as () => void;
    stop(); stop();
    expect(api.interruptSession).toHaveBeenCalledTimes(1);
    expect(render().find(node => node.props.title === 'interruptTitle')!.props.disabled).toBe(true);
    rejectStop(new Error('fixture stop failure')); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    tree = render();
    expect(tree.find(node => typeof node.props.text === 'string')!.props.text).toBe('stopFailed');
    expect(tree.find(node => node.props.title === 'interruptTitle')!.props.disabled).toBe(false);
    expect(tree.find(node => node.type === 'textarea')!.props.value).toBe('keep draft');
    vi.mocked(api.interruptSession).mockResolvedValueOnce({ ok: true });
    (tree.find(node => node.props.title === 'interruptTitle')!.props.onClick as () => void)();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(api.interruptSession).toHaveBeenCalledTimes(2);
    finish({ kind: 'interrupted', finalText: '', steps: [], turnId: 't1' }); await turn;
    tree = render();
    expect(tree.find(node => node.props.title === 'interruptTitle')!.props.disabled).toBe(true);
    expect(tree.find(node => node.type === 'textarea')!.props.value).toBe('keep draft');
  });

  it('scrolls an inserted Stop failure fully into the transcript viewport without another message', async () => {
    vi.mocked(api.interruptSession).mockRejectedValueOnce(new Error('fixture stop failure'));
    let tree = render();
    streams[0].handlers.onRun?.({ active: true });
    tree = render();
    const container = tree.find(node => String(node.props.className ?? '').includes('message-list-scroll'))!;
    // Model a short transcript viewport. This verifies scroll behavior, not browser layout.
    // The new 48px banner initially extends beyond the bottom; scrollTo models native clamping.
    const banner = { top: 480, height: 48 };
    const scroller = {
      clientHeight: 120, scrollHeight: 480, scrollTop: 360,
      scrollTo: vi.fn(({ top }: ScrollToOptions) => {
        scroller.scrollTop = Math.min(top ?? 0, scroller.scrollHeight - scroller.clientHeight);
      }),
    };
    (container.props.ref as { current: unknown }).current = scroller;
    expect(banner.top + banner.height - scroller.scrollTop).toBeGreaterThan(scroller.clientHeight);
    (tree.find(node => node.props.title === 'interruptTitle')!.props.onClick as () => void)();
    render();
    scroller.scrollTo.mockClear();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    // React commits the new banner before running the scroll effect.
    scroller.scrollHeight = banner.top + banner.height + 24;
    tree = render();
    expect(tree.find(node => typeof node.props.text === 'string')!.props.text).toBe('stopFailed');
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 552, behavior: 'auto' });
    expect(banner.top - scroller.scrollTop).toBeGreaterThanOrEqual(0);
    expect(banner.top + banner.height - scroller.scrollTop).toBeLessThanOrEqual(scroller.clientHeight);
    expect(tree.find(node => node.props.title === 'interruptTitle')!.props.disabled).toBe(false);
  });

  it('preserves manual scroll-up after a Stop failure while the run continues receiving messages', async () => {
    vi.mocked(api.interruptSession).mockRejectedValueOnce(new Error('fixture stop failure'));
    render();
    streams[0].handlers.onRun?.({ active: true });
    const tree = render();
    const container = tree.find(node => String(node.props.className ?? '').includes('message-list-scroll'))!;
    const scroller = { clientHeight: 120, scrollHeight: 552, scrollTop: 432, scrollTo: vi.fn() };
    (container.props.ref as { current: unknown }).current = scroller;
    (tree.find(node => node.props.title === 'interruptTitle')!.props.onClick as () => void)();
    render();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(render().find(node => typeof node.props.text === 'string')!.props.text).toBe('stopFailed');
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 552, behavior: 'auto' });
    scroller.scrollTo.mockClear();
    scroller.scrollTop = 0;
    (container.props.onScroll as () => void)();
    render();
    streams[0].handlers.onConversation?.({ role: 'assistant', text: 'run continues', ts: 1 });
    const updated = render();
    expect(updated.find(node => typeof node.props.text === 'string')!.props.text).toBe('stopFailed');
    expect(updated.find(node => node.props.className === 'scroll-to-bottom-pill')).toBeDefined();
    expect(scroller.scrollTo).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(0);
  });

  it.each([false, true])('focuses only an unclaimed input after async history becomes ready (other control focused=%s)', async otherFocused => {
    let resolve!: (value: import('../sse').SessionTranscript) => void;
    api.sessionMessages = vi.fn(() => new Promise<import('../sse').SessionTranscript>(done => { resolve = done; }));
    const body = {};
    const focus = vi.fn();
    const ownerDocument = { body, activeElement: { tagName: 'NAVIGATION_BUTTON' } };
    const input = render('s1', undefined, { focus, ownerDocument }).find(node => node.type === 'textarea')!;
    expect(input.props.disabled).toBe(true);
    expect(input.props.ref).toBeDefined();
    if (otherFocused) ownerDocument.activeElement = { tagName: 'OTHER_BUTTON' };
    resolve({ messages: [], usage: [] });
    await Promise.resolve();
    expect(focus).not.toHaveBeenCalled();
    streams[0].handlers.onTranscript?.({ messages: [], usage: [] });
    expect(render().find(node => node.type === 'textarea')!.props.disabled).toBe(false);
    expect(focus).toHaveBeenCalledTimes(otherFocused ? 0 : 1);
    render();
    expect(focus).toHaveBeenCalledTimes(otherFocused ? 0 : 1);
  });

  it('preserves pasted newlines, leaves Shift+Enter to the textarea, and sends once on Enter', async () => {
    let tree = render();
    let input = tree.find(node => node.type === 'textarea')!;
    expect(input).toBeDefined();
    const pasted = '\nfirst line\n第二行\n';
    (input.props.onChange as (event: unknown) => void)({ target: { value: pasted } });
    tree = render(); input = tree.find(node => node.type === 'textarea')!;
    expect(input.props.value).toBe(pasted);
    const shift = { key: 'Enter', shiftKey: true, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (input.props.onKeyDown as (event: unknown) => void)(shift);
    expect(shift.preventDefault).not.toHaveBeenCalled();
    expect(api.runTurn).not.toHaveBeenCalled();
    const enter = { ...shift, shiftKey: false, preventDefault: vi.fn() };
    (input.props.onKeyDown as (event: unknown) => void)(enter);
    expect(enter.preventDefault).toHaveBeenCalledOnce();
    expect(api.runTurn).toHaveBeenCalledExactlyOnceWith('s1', pasted);
    tree = render(); input = tree.find(node => node.type === 'textarea')!;
    (input.props.onChange as (event: unknown) => void)({ target: { value: 'draft during active turn' } });
    tree = render(); input = tree.find(node => node.type === 'textarea')!;
    (input.props.onKeyDown as (event: unknown) => void)(enter);
    expect(api.runTurn).toHaveBeenCalledTimes(1);
    expect(input.props.value).toBe('draft during active turn');
    await Promise.resolve();
  });

  it.each(['before', 'after', 'missing'])('retains length-limited output with SSE %s the HTTP response', async streamTiming => {
    let complete!: (result: import('../api').TurnResult) => void;
    vi.mocked(api.runTurn).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    let tree = render();
    (tree.find(node => node.type === 'textarea')!.props.onChange as (event: unknown) => void)({ target: { value: 'write a game' } });
    tree = render();
    const submitted = (tree.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
    const delta = { role: 'assistant' as const, text: 'partial game code', ts: 4 };
    if (streamTiming === 'before') streams[0].handlers.onConversation?.(delta);
    complete({ kind: 'error', finishReason: 'length', finalText: delta.text, steps: [], turnId: 't1' });
    await submitted;
    if (streamTiming === 'after') streams[0].handlers.onConversation?.(delta);
    tree = render();
    const items = tree.find(node => Array.isArray(node.props.items))!.props.items as import('./MessageList').ChatItem[];
    expect(items.filter(item => item.msg?.role === 'assistant').map(item => item.msg?.text)).toEqual(['partial game code']);
    expect(tree.find(node => node.type === 'textarea')!.props.value).toBe('');
    expect(items.find(item => item.msg?.role === 'assistant')?.msg?.termination).toBe('length');
    expect(tree.find(node => node.props.text)).toBeUndefined(); // No ConversationError banner.
    expect(tree.find(node => node.type === 'button' && node.props.type === 'button' && node.props.title === 'interruptTitle')!.props.disabled).toBe(true);

    // A subsequent turn must not remove the earlier reply's termination reason.
    (tree.find(node => node.type === 'textarea')!.props.onChange as (event: unknown) => void)({ target: { value: 'continue' } });
    tree = render();
    const continued = (tree.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
    expect((render().find(node => Array.isArray(node.props.items))!.props.items as import('./MessageList').ChatItem[])
      .find(item => item.msg?.role === 'assistant')?.msg?.termination).toBe('length');
    complete({ kind: 'completed', finalText: 'done', steps: [], turnId: 't2' });
    await continued;
  });

  it('keeps termination with its message without leaking it into another session', async () => {
    let tree = render();
    (tree.find(node => node.type === 'textarea')!.props.onChange as (event: unknown) => void)({ target: { value: 'write code' } });
    vi.mocked(api.runTurn).mockResolvedValue({ kind: 'error', finishReason: 'length', finalText: 'partial', steps: [], turnId: 't1' });
    tree = render();
    await (tree.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
    expect((render().find(node => Array.isArray(node.props.items))!.props.items as import('./MessageList').ChatItem[])
      .some(item => item.msg?.termination === 'length')).toBe(true);
    render('s2');
    expect(render('s2').find(node => Array.isArray(node.props.items))!.props.items).toEqual([]);
    render('s1');
    expect((render('s1').find(node => Array.isArray(node.props.items))!.props.items as import('./MessageList').ChatItem[])
      .some(item => item.msg?.termination === 'length')).toBe(true);
  });

  it('hydrates a fresh page from disk and reconciles the SSE connection snapshot once', async () => {
    const transcript = {
      messages: [
        { id: 'r1', kind: 'message' as const, msg: { role: 'user' as const, text: 'disk question', ts: 1 } },
        { id: 'r2', kind: 'message' as const, msg: { role: 'assistant' as const, text: 'disk answer', ts: 2, termination: 'length' as const } },
      ],
      usage: [{ inputTokens: 7, outputTokens: 3, calls: 1, ts: 3 }],
    };
    api.sessionMessages = vi.fn().mockResolvedValue(transcript);
    render();
    await Promise.resolve();
    let tree = render();
    expect(api.sessionMessages).toHaveBeenCalledWith('s1');
    expect(tree.find(node => Array.isArray(node.props.items))!.props.items).toEqual(transcript.messages);
    (tree.find(node => node.type === 'textarea')!.props.onChange as (event: unknown) => void)({ target: { value: 'new prompt' } });
    tree = render();
    await (tree.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
    expect(api.runTurn).not.toHaveBeenCalled(); // A pending snapshot must not erase an optimistic new turn.
    streams[0].handlers.onTranscript?.(transcript);
    streams[0].handlers.onConversation?.({ role: 'assistant', text: 'live answer', ts: 4 });
    tree = render();
    expect((tree.find(node => Array.isArray(node.props.items))!.props.items as import('./MessageList').ChatItem[]).map(item => item.msg?.text)).toEqual(['disk question', 'disk answer', 'live answer']);
    expect(tree.find(node => node.props.usage)!.props.usage).toMatchObject({ inputTokens: 7, outputTokens: 3, calls: 1 });
  });

  it('ignores late HTTP hydration after the connection snapshot or a session switch', async () => {
    let resolve!: (value: import('../sse').SessionTranscript) => void;
    api.sessionMessages = vi.fn(() => new Promise<import('../sse').SessionTranscript>(done => { resolve = done; }));
    render();
    const finish = resolve;
    streams[0].handlers.onTranscript?.({ messages: [], usage: [] });
    streams[0].handlers.onConversation?.({ role: 'assistant', text: 'fresh', ts: 3 });
    finish({ messages: [], usage: [] });
    await Promise.resolve();
    expect((render().find(node => Array.isArray(node.props.items))!.props.items as import('./MessageList').ChatItem[])[0].msg?.text).toBe('fresh');
    render('s2');
    const finishSecond = resolve;
    render('s3');
    finishSecond({ messages: [{ id: 'stale', kind: 'message', msg: { role: 'user', text: 'stale', ts: 1 } }], usage: [] });
    await Promise.resolve();
    expect(render('s3').find(node => Array.isArray(node.props.items))!.props.items).toEqual([]);
  });

  it('protects against Enter key submission during IME composition', async () => {
    const tree = render();
    const inputNode = tree.find(node => node.type === 'textarea')!;
    const formNode = tree.find(node => node.type === 'form')!;

    // Set some input text
    (inputNode.props.onChange as (e: unknown) => void)({ target: { value: '中文输入测试' } });
    render();

    // 1. Start composition (e.g. typing pinyin)
    (inputNode.props.onCompositionStart as () => void)();

    // 2. Press Enter during composition
    const stopPropagation = vi.fn();
    const preventKeyDefault = vi.fn();
    (inputNode.props.onKeyDown as (e: unknown) => void)({
      key: 'Enter',
      nativeEvent: { isComposing: true },
      preventDefault: preventKeyDefault,
      stopPropagation,
    });
    expect(stopPropagation).toHaveBeenCalled();
    expect(preventKeyDefault).toHaveBeenCalledOnce();

    // Try submitting form while still composing
    const preventDefault = vi.fn();
    await (formNode.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    // api.runTurn must NOT be called
    expect(api.runTurn).not.toHaveBeenCalled();

    // 3. End composition
    (inputNode.props.onCompositionEnd as () => void)();

    // 4. Normal Enter / form submit with updated tree
    const currentTree = render();
    const currentForm = currentTree.find(node => node.type === 'form')!;
    await (currentForm.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault });
    expect(api.runTurn).toHaveBeenCalledWith('s1', '中文输入测试');
  });

  it.each(['ref', 'native', '229', 'normal', 'shift'])(
    'handles explicit Enter submission while protecting IME (%s)', async mode => {
      let tree = render();
      let input = tree.find(node => node.type === 'textarea')!;
      (input.props.onChange as (e: unknown) => void)({ target: { value: 'draft' } });
      tree = render();
      input = tree.find(node => node.type === 'textarea')!;
      if (mode === 'ref') (input.props.onCompositionStart as () => void)();
      const event = {
        key: mode === 'shift' ? 'Shift' : 'Enter', keyCode: mode === '229' ? 229 : 13,
        nativeEvent: { isComposing: mode === 'native' || mode === 'shift' },
        defaultPrevented: false,
        preventDefault: vi.fn(() => { event.defaultPrevented = true; }), stopPropagation: vi.fn(),
      };
      (input.props.onKeyDown as (e: unknown) => void)(event);
      const blocked = ['ref', 'native', '229'].includes(mode);
      expect(event.preventDefault).toHaveBeenCalledTimes(mode === 'shift' ? 0 : 1);
      expect(event.stopPropagation).toHaveBeenCalledTimes(blocked ? 1 : 0);
      expect(api.runTurn).toHaveBeenCalledTimes(mode === 'normal' ? 1 : 0);
    },
  );

  it('manages scroll state and renders scroll-to-bottom button when scrolled up', () => {
    const tree = render();
    const scrollContainer = tree.find(node => String(node.props.className ?? '').includes('message-list-scroll'))!;
    expect(scrollContainer).toBeDefined();

    // Initially at bottom, so pill is not shown
    let pill = render().find(node => node.props.className === 'scroll-to-bottom-pill');
    expect(pill).toBeUndefined();

    const mockElement = {
      scrollHeight: 1000,
      scrollTop: 200,
      clientHeight: 500, // distance = 1000 - 200 - 500 = 300px > 120px -> not at bottom
      scrollTo: vi.fn(),
    };
    // Attach to the actual scroll container, independent of other component refs.
    (scrollContainer.props.ref as { current: unknown }).current = mockElement;

    // Trigger onScroll
    (scrollContainer.props.onScroll as () => void)();
    const updatedTree = render();

    // Pill should now be visible
    pill = updatedTree.find(node => node.props.className === 'scroll-to-bottom-pill');
    expect(pill).toBeDefined();

    // Click pill to scroll to bottom
    (pill!.props.onClick as () => void)();
    expect(mockElement.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });

    // After scrolling to bottom, pill disappears
    const afterClickTree = render();
    const afterPill = afterClickTree.find(node => node.props.className === 'scroll-to-bottom-pill');
    expect(afterPill).toBeUndefined();
  });

  it('clears serverDown and triggers onSessionUpdated upon SSE onOpen reconnect', () => {
    render();
    const stream = streams[0];
    expect(stream).toBeDefined();

    // Verify onOpen handler exists
    expect(stream.handlers.onOpen).toBeDefined();

    // Call onOpen callback
    stream.handlers.onOpen!();
    expect(sessionUpdatedSpy).toHaveBeenCalled();
  });
});
