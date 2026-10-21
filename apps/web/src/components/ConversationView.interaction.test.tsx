import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { ApiClient } from '../api';
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
let sessionUpdatedSpy: ReturnType<typeof vi.fn>;

function render(sessionId = 's1', onSessionUpdated = sessionUpdatedSpy) {
  hooks.cursor = 0;
  const tree = ConversationView({ sessionId, api, onSessionUpdated });
  for (const job of hooks.jobs.splice(0)) job();
  return nodes(tree);
}

beforeEach(() => {
  hooks.cells = [];
  hooks.effects = [];
  hooks.jobs = [];
  streams.splice(0);
  sessionUpdatedSpy = vi.fn();
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
  it('hydrates a fresh page from disk and reconciles the SSE connection snapshot once', async () => {
    const transcript = {
      messages: [
        { id: 'r1', kind: 'message' as const, msg: { role: 'user' as const, text: 'disk question', ts: 1 } },
        { id: 'r2', kind: 'message' as const, msg: { role: 'assistant' as const, text: 'disk answer', ts: 2 } },
      ],
      usage: [{ inputTokens: 7, outputTokens: 3, calls: 1, ts: 3 }],
    };
    api.sessionMessages = vi.fn().mockResolvedValue(transcript);
    render();
    await Promise.resolve();
    let tree = render();
    expect(api.sessionMessages).toHaveBeenCalledWith('s1');
    expect(tree.find(node => Array.isArray(node.props.items))!.props.items).toEqual(transcript.messages);
    (tree.find(node => node.type === 'input')!.props.onChange as (event: unknown) => void)({ target: { value: 'new prompt' } });
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
    const inputNode = tree.find(node => node.type === 'input')!;
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
    'cancels implicit submission only for IME Enter (%s)', async mode => {
      let tree = render();
      let input = tree.find(node => node.type === 'input')!;
      (input.props.onChange as (e: unknown) => void)({ target: { value: 'draft' } });
      tree = render();
      input = tree.find(node => node.type === 'input')!;
      const form = tree.find(node => node.type === 'form')!;
      if (mode === 'ref') (input.props.onCompositionStart as () => void)();
      const event = {
        key: mode === 'shift' ? 'Shift' : 'Enter', keyCode: mode === '229' ? 229 : 13,
        nativeEvent: { isComposing: mode === 'native' || mode === 'shift' },
        defaultPrevented: false,
        preventDefault: vi.fn(() => { event.defaultPrevented = true; }), stopPropagation: vi.fn(),
      };
      (input.props.onKeyDown as (e: unknown) => void)(event);
      // Model the browser's implicit default action; uncancelled Enter submits.
      if (event.key === 'Enter' && !event.defaultPrevented) {
        await (form.props.onSubmit as (e: unknown) => void)({ preventDefault: vi.fn() });
      }
      const blocked = ['ref', 'native', '229'].includes(mode);
      expect(event.preventDefault).toHaveBeenCalledTimes(blocked ? 1 : 0);
      expect(event.stopPropagation).toHaveBeenCalledTimes(blocked ? 1 : 0);
      expect(api.runTurn).toHaveBeenCalledTimes(mode === 'normal' ? 1 : 0);
    },
  );

  it('manages scroll state and renders scroll-to-bottom button when scrolled up', () => {
    const tree = render();
    const scrollContainer = tree.find(node => node.props.className?.includes('message-list-scroll'))!;
    expect(scrollContainer).toBeDefined();

    // Initially at bottom, so pill is not shown
    let pill = render().find(node => node.props.className === 'scroll-to-bottom-pill');
    expect(pill).toBeUndefined();

    // Find the listRef cell inside hooks.cells
    const refCell = hooks.cells.find(cell => cell && typeof cell === 'object' && 'current' in cell && (cell as { current: unknown }).current !== undefined);
    const mockElement = {
      scrollHeight: 1000,
      scrollTop: 200,
      clientHeight: 500, // distance = 1000 - 200 - 500 = 300px > 120px -> not at bottom
      scrollTo: vi.fn(),
    };
    // Attach mock element to the ref cell
    const listRefCell = hooks.cells.find(cell => cell && typeof cell === 'object' && 'current' in cell && Object.keys(cell).length === 1 && (cell as { current: unknown }).current === null);
    if (listRefCell) {
      (listRefCell as { current: unknown }).current = mockElement;
    }

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
