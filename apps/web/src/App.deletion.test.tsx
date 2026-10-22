import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import App from './App';
import Sidebar, { type SidebarProps } from './components/Sidebar';
import { ApiError, type ApiClient, type SessionMeta } from './api';
import { translate } from './i18n';

// Same node-only hook harness used by ConversationView.interaction.test.tsx.
const hooks = vi.hoisted(() => ({ cursor: 0, cells: [] as unknown[], effects: new Set<number>(), jobs: [] as (() => void)[] }));
const client = vi.hoisted(() => ({ current: undefined as unknown as ApiClient }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.cells)) hooks.cells[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.cells[index], (value: unknown) => {
      hooks.cells[index] = typeof value === 'function' ? (value as (previous: unknown) => unknown)(hooks.cells[index]) : value;
    }];
  },
  useRef: (initial: unknown) => { const index = hooks.cursor++; return hooks.cells[index] ??= { current: initial }; },
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => void) => {
    const index = hooks.cursor++;
    if (!hooks.effects.has(index)) { hooks.effects.add(index); hooks.jobs.push(effect); }
  },
}));
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), createApiClient: () => client.current }));
vi.mock('./components/LanguageProvider', () => ({
  LanguageProvider: ({ children }: { children: ReactNode }) => children,
  useI18n: () => ({ t: translate('en'), lang: 'en' }),
}));
vi.mock('./utils/attentionManager', () => ({ AttentionManager: class { attach() {} dispose() {} } }));
vi.mock('./utils/theme', () => ({ getStoredTheme: () => 'light', applyTheme: () => {} }));

function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}
function render(): SidebarProps {
  hooks.cursor = 0;
  const shell = App().props.children as ReactElement;
  const tree = (shell.type as () => ReactNode)();
  for (const job of hooks.jobs.splice(0)) job();
  return nodes(tree).find(node => node.type === Sidebar)!.props as unknown as SidebarProps;
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

beforeEach(async () => {
  hooks.cursor = 0; hooks.cells = []; hooks.effects.clear(); hooks.jobs = [];
  const sessions: SessionMeta[] = ['a', 'b', 'c'].map(id => ({ id, workspaceRoot: 'E:/fixture', createdAt: '2026-10-22T00:00:00Z',
    topic: { topicId: 'shared', title: 'Shared topic', createdAt: 1, updatedAt: 1 } }));
  client.current = {
    health: vi.fn().mockResolvedValue({ ok: true }), projects: vi.fn().mockResolvedValue({ projects: [] }),
    sessions: vi.fn().mockResolvedValue({ sessions }), deleteSession: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as ApiClient;
  render(); await settle();
});

describe('App deletion', () => {
  it('removes two successes, shows the failed item reason and retries only that item', async () => {
    const remove = vi.mocked(client.current.deleteSession);
    remove.mockImplementation(async id => {
      if (id === 'b') throw new ApiError('failed', 500, { error: 'session_recycle_failed', id, stage: 'recycle' });
      return { ok: true, id };
    });
    render().onDeleteSession?.(['a', 'b', 'c']); await settle();
    const props = render();
    expect(props.sessions.map(session => session.id)).toEqual(['b']);
    expect(props.deleteErrors).toEqual({ b: 'sessionDeleteRecycleFailed' });
    const sidebar = nodes(Sidebar(props));
    expect(JSON.stringify(sidebar.find(node => node.props.role === 'alert')!.props.children)).toContain('The session index was restored');
    const retry = sidebar.find(node => node.type === 'button' && node.props.children === 'Retry')!;
    remove.mockResolvedValue({ ok: true, id: 'b' });
    (retry.props.onClick as () => void)(); await settle();
    expect(remove.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c', 'b']);
    expect(render().sessions).toEqual([]);
    expect(render().deleteErrors).toEqual({});
  });

  it('retains per-item index and stale-index reasons and suppresses duplicate in-flight deletes', async () => {
    let finish!: () => void;
    const remove = vi.mocked(client.current.deleteSession).mockImplementationOnce(() => new Promise(resolve => {
      finish = () => resolve({ ok: true, id: 'a' });
    })).mockRejectedValueOnce(new ApiError('index', 500, { error: 'session_index_failed' }))
      .mockRejectedValueOnce(new ApiError('rollback', 500, { error: 'session_index_stale' }));
    render().onDeleteSession?.(['a', 'b', 'c']);
    render().onDeleteSession?.('a');
    expect(remove).toHaveBeenCalledTimes(3);
    expect(render().deletingIds).toContain('a');
    finish(); await settle();
    expect(render().sessions.map(session => session.id)).toEqual(['b', 'c']);
    expect(render().deleteErrors).toEqual({ b: 'sessionDeleteIndexFailed', c: 'sessionDeleteIndexStale' });
  });
});
