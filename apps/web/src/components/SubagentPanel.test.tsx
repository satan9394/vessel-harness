import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApiClient } from '../api';
import { watchSubagents, type SubagentItem } from '../subagents';
import { SubagentDetailDrawer, SubagentListPanel, SubagentPanel } from './SubagentPanel';

const running: SubagentItem = { id: 'sub/1', name: 'Fixture worker', provider: 'mock', status: 'running', startedAt: '2026-10-01T00:00:00Z', worktreePath: 'E:/tmp/isolated' };

/** Inspect native JSX nodes and exercise their real click handlers without adding a DOM dependency. */
function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}

class FakeSource {
  static current: FakeSource;
  onmessage?: (event: { data: string }) => void;
  onopen?: () => void;
  close = vi.fn();
  constructor(public url: string) { FakeSource.current = this; }
  emit(type: string, delta: unknown) { this.onmessage?.({ data: JSON.stringify({ type, delta, ts: 1000 }) }); }
}

afterEach(() => vi.unstubAllGlobals());

describe('Subagent workspace', () => {
  it('renders empty state and accessible running/completed/failed cards', () => {
    expect(renderToStaticMarkup(<SubagentPanel subagents={[]} />)).toContain('No active subagents');
    const html = renderToStaticMarkup(<SubagentListPanel subagents={[running, { ...running, id: '2', status: 'completed' }, { ...running, id: '3', status: 'failed' }]} onSelect={() => {}} onCancel={() => {}} />);
    expect(html).toContain('status-running');
    expect(html).toContain('status-completed');
    expect(html).toContain('status-failed');
    expect(html.match(/>Cancel<\/button>/g)).toHaveLength(1);
  });

  it('card click selects exact worker and cancel targets only that id', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const tree = SubagentListPanel({ subagents: [running], selectedId: running.id, onSelect, onCancel });
    const buttons = nodes(tree).filter((node) => node.type === 'button');
    (buttons[0]!.props.onClick as () => void)();
    (buttons[1]!.props.onClick as () => void)();
    expect(onSelect).toHaveBeenCalledWith(running.id);
    expect(onCancel).toHaveBeenCalledWith(running.id);
    expect(buttons[0]!.props['aria-expanded']).toBe(true);
    const disabled = nodes(SubagentListPanel({ subagents: [running], onSelect, onCancel, cancellingId: running.id }))
      .find((node) => node.props['aria-label'] === `Cancel ${running.name}`);
    expect(disabled?.props.disabled).toBe(true);
  });

  it('drawer exposes worktree, stage logs, all four token dimensions and close/cancel actions', () => {
    const close = vi.fn();
    const cancel = vi.fn();
    const tree = SubagentDetailDrawer({ subagent: running, onClose: close, onCancel: cancel,
      detail: { summary: running, logs: [{ phase: 'handoff', message: 'Artifact preserved', ts: 1000 }],
        usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 } } });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('E:/tmp/isolated');
    expect(html).toContain('Artifact preserved');
    for (const count of [10, 20, 30, 40]) expect(html).toContain(`${count} tok`);
    expect(html).toContain('role="dialog"');
    const buttons = nodes(tree).filter((node) => node.type === 'button');
    (buttons[0]!.props.onClick as () => void)();
    (buttons[1]!.props.onClick as () => void)();
    (tree.props.onKeyDown as (event: { key: string }) => void)({ key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledWith(running.id);
    expect(renderToStaticMarkup(<SubagentDetailDrawer subagent={{ ...running, status: 'failed', lastError: 'Process failed', exitCode: 7 }} onClose={close} />)).toContain('Process failed');
    const completed = renderToStaticMarkup(<SubagentDetailDrawer subagent={{ ...running, status: 'completed', endedAt: '2026-10-01T00:00:02.500Z' }} onClose={close} />);
    expect(completed).toContain('Duration');
    expect(completed).toContain('2,500ms');
  });

  it('uses exact list/detail/cancel routes and surfaces server failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{"ok":true}', { status: 200 }));
    const api = createApiClient({ base: '/api', fetch: fetcher });
    await api.listSubagents();
    await api.getSubagent(running.id);
    await api.cancelSubagent(running.id);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/subagents', '/api/subagents/sub%2F1', '/api/subagents/sub%2F1/cancel']);
    expect(fetcher.mock.calls[2]![1]?.method).toBe('POST');
    fetcher.mockResolvedValueOnce(new Response('{"error":"subagent_not_running"}', { status: 404 }));
    await expect(api.cancelSubagent(running.id)).rejects.toThrow('subagent_not_running');
  });

  it('SSE completion wins over stale initial list, streams logs/tokens and closes on teardown', async () => {
    vi.stubGlobal('EventSource', FakeSource);
    let resolve!: (value: { subagents: SubagentItem[] }) => void;
    const pending = new Promise<{ subagents: SubagentItem[] }>((done) => { resolve = done; });
    const change = vi.fn();
    const frame = vi.fn();
    const watcher = watchSubagents({ listSubagents: () => pending, subagentEventsUrl: '/api/subagents/events' }, change, frame, vi.fn());
    expect(FakeSource.current.url).toBe('/api/subagents/events');
    FakeSource.current.emit('subagent:start', { id: running.id, summary: running });
    FakeSource.current.emit('subagent:step', { id: running.id, phase: 'execute', message: 'Complete artifact', usage: { inputTokens: 8, outputTokens: 9, cacheReadTokens: 2, cacheWriteTokens: 1 } });
    FakeSource.current.emit('subagent:end', { id: running.id, summary: { ...running, status: 'completed', exitCode: 0 } });
    resolve({ subagents: [running] });
    await watcher.ready;
    expect(change.mock.lastCall?.[0][0].status).toBe('completed');
    expect(frame.mock.calls[1]![0]).toMatchObject({ phase: 'execute', message: 'Complete artifact', usage: { inputTokens: 8, outputTokens: 9, cacheReadTokens: 2, cacheWriteTokens: 1 } });
    watcher.close();
    expect(FakeSource.current.close).toHaveBeenCalledOnce();
    FakeSource.current.emit('subagent:start', { id: 'late', summary: { ...running, id: 'late' } });
    expect(frame).toHaveBeenCalledTimes(3);
  });

  it('ignores unrelated or malformed frames and late snapshot after unmount', async () => {
    vi.stubGlobal('EventSource', FakeSource);
    let resolve!: (value: { subagents: SubagentItem[] }) => void;
    const pending = new Promise<{ subagents: SubagentItem[] }>((done) => { resolve = done; });
    const change = vi.fn();
    const frame = vi.fn();
    const watcher = watchSubagents({ listSubagents: () => pending, subagentEventsUrl: '/api/subagents/events' }, change, frame, vi.fn());
    FakeSource.current.emit('ping', {});
    FakeSource.current.emit('subagent:step', { message: 'missing id' });
    watcher.close();
    resolve({ subagents: [running] });
    await watcher.ready;
    expect(change).not.toHaveBeenCalled();
    expect(frame).not.toHaveBeenCalled();
  });

  it('keeps an already-running worker when a step arrives before its list snapshot', async () => {
    vi.stubGlobal('EventSource', FakeSource);
    let resolve!: (value: { subagents: SubagentItem[] }) => void;
    const pending = new Promise<{ subagents: SubagentItem[] }>((done) => { resolve = done; });
    const change = vi.fn();
    const watcher = watchSubagents({ listSubagents: () => pending, subagentEventsUrl: '/api/subagents/events' }, change, vi.fn(), vi.fn());
    FakeSource.current.emit('subagent:step', { id: running.id, phase: 'execute', message: 'Already running' });
    resolve({ subagents: [running] });
    await watcher.ready;
    expect(change.mock.lastCall?.[0]).toEqual([running]);
    watcher.close();
  });

  it('surfaces initial list failures without abandoning the live stream', async () => {
    vi.stubGlobal('EventSource', FakeSource);
    const error = vi.fn();
    const change = vi.fn();
    const watcher = watchSubagents({ listSubagents: async () => { throw new Error('Server unavailable'); }, subagentEventsUrl: '/api/subagents/events' }, change, vi.fn(), error);
    await watcher.ready;
    expect(error.mock.lastCall?.[0].message).toBe('Server unavailable');
    FakeSource.current.emit('subagent:start', { id: running.id, summary: running });
    expect(change.mock.lastCall?.[0]).toEqual([running]);
    watcher.close();
  });

  it('refreshes summaries on SSE reconnect after missing a completion frame', async () => {
    vi.stubGlobal('EventSource', FakeSource);
    const listSubagents = vi.fn().mockResolvedValueOnce({ subagents: [running] })
      .mockResolvedValueOnce({ subagents: [{ ...running, status: 'completed' }] });
    const change = vi.fn();
    const watcher = watchSubagents({ listSubagents, subagentEventsUrl: '/api/subagents/events' }, change, vi.fn(), vi.fn());
    await watcher.ready;
    FakeSource.current.onopen?.();
    await vi.waitFor(() => expect(change.mock.lastCall?.[0][0].status).toBe('completed'));
    expect(listSubagents).toHaveBeenCalledTimes(2);
    watcher.close();
  });

  it('removes evicted or restarted workers on reconnect while preserving newer live deltas', async () => {
    vi.stubGlobal('EventSource', FakeSource);
    let resolve!: (value: { subagents: SubagentItem[] }) => void;
    const reconnect = new Promise<{ subagents: SubagentItem[] }>((done) => { resolve = done; });
    const listSubagents = vi.fn().mockResolvedValueOnce({ subagents: [running, { ...running, id: 'terminal', status: 'completed' }] })
      .mockReturnValueOnce(reconnect);
    const change = vi.fn();
    const watcher = watchSubagents({ listSubagents, subagentEventsUrl: '/api/subagents/events' }, change, vi.fn(), vi.fn());
    await watcher.ready;
    FakeSource.current.onopen?.();
    const newWorker = { ...running, id: 'new-worker' };
    FakeSource.current.emit('subagent:start', { id: newWorker.id, summary: newWorker });
    resolve({ subagents: [] });
    await vi.waitFor(() => expect(change.mock.lastCall?.[0]).toEqual([newWorker]));
    watcher.close();
  });
});

// Use the real English dictionary while exercising JSX handlers without a renderer.
vi.mock('./LanguageProvider', async () => {
  const { translate } = await import('../i18n');
  return { useI18n: () => ({ lang: 'en', t: translate('en'), setLang: vi.fn() }) };
});
