import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../api';
import { InteractivePatchPicker } from './InteractivePatchPicker';
import type { DiffHunk } from '@vessel/shared';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(), useState: (initial: unknown) => {
  const index = hooks.cursor++;
  if (!(index in hooks.values)) hooks.values[index] = initial;
  return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }];
} }));
function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}
const hunk: DiffHunk = { id: 'a.txt#hunk-0', filePath: 'a.txt', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'], status: 'pending' };
const render = (action: (id: string, action: 'accept' | 'reject') => Promise<void>, hunks = [hunk]) => { hooks.cursor = 0; return nodes(InteractivePatchPicker({ hunks, onAction: action })); };
const click = (tree: ReturnType<typeof render>, label: string) => (tree.find(node => node.type === 'button' && node.props.children === label)!.props.onClick as () => Promise<void>)();
afterEach(() => { hooks.values = []; vi.unstubAllGlobals(); });
describe('interactive hunk decisions', () => {
  it('reconciles two instances with authoritative SSE statuses after accept, revert and reapply', async () => {
    const instanceA: unknown[] = []; const instanceB: unknown[] = [];
    let serverStatus: DiffHunk['status'] = 'pending';
    const action = vi.fn(async (_id: string, next: 'accept' | 'reject') => { serverStatus = next === 'accept' ? 'accepted' : 'rejected'; });
    const view = (state: unknown[]) => { hooks.values = state; return render(action, [{ ...hunk, status: serverStatus }]); };
    const status = (tree: ReturnType<typeof render>) => tree.find(node => node.props.role === 'status')!.props.children;
    await click(view(instanceA), 'Accept hunk');
    expect(status(view(instanceA))).toBe('accepted');
    await click(view(instanceB), 'Revert hunk');
    expect(status(view(instanceB))).toBe('rejected');
    expect(status(view(instanceA))).toBe('rejected');
    await click(view(instanceA), 'Reapply hunk');
    expect(status(view(instanceA))).toBe('accepted');
    expect(status(view(instanceB))).toBe('accepted');
    expect(action.mock.calls.map(call => call[1])).toEqual(['accept', 'reject', 'accept']);
  });
  it('invokes discard with exact ID, waits before marking rejected and permits safe reapply', async () => {
    let settle!: () => void; const action = vi.fn(() => new Promise<void>(resolve => { settle = resolve; }));
    const pending = click(render(action), 'Discard hunk');
    expect(action).toHaveBeenCalledWith(hunk.id, 'reject');
    expect(render(action).filter(node => node.props.disabled === true)).toHaveLength(2);
    settle(); await pending;
    expect(render(action).find(node => node.props.role === 'status')!.props.children).toBe('rejected');
    const reapply = click(render(action), 'Reapply hunk'); settle(); await reapply;
    expect(action).toHaveBeenCalledTimes(2);
    expect(render(action).find(node => node.props.role === 'status')!.props.children).toBe('accepted');
  });
  it('surfaces server conflicts and permits retry without inventing accepted status', async () => {
    const action = vi.fn().mockRejectedValueOnce(new Error('stale_patch')).mockResolvedValue(undefined);
    await click(render(action), 'Accept hunk');
    expect(render(action).find(node => node.props.role === 'alert')!.props.children).toBe('stale_patch');
    expect(render(action).find(node => node.props.role === 'status')!.props.children).toBe('pending');
    await click(render(action), 'Accept hunk');
    expect(render(action).find(node => node.props.role === 'status')!.props.children).toBe('accepted');
  });
  it('toggles unified/side-by-side views and respects replayed terminal states', async () => {
    const action = vi.fn(); await click(render(action), 'Side-by-side view');
    expect(render(action).find(node => node.type === 'table')!.props['aria-label']).toBe('Side-by-side patch');
    await click(render(action), 'Unified view');
    expect(render(action).find(node => node.type === 'table')!.props['aria-label']).toBe('Unified patch');
    const tree = render(action, [{ ...hunk, status: 'accepted' }]); await click(tree, 'Revert hunk'); expect(action).toHaveBeenCalledWith(hunk.id, 'reject');
  });
  it('posts only server-owned identity and action through authenticated transport', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ hunk: { ...hunk, status: 'accepted' } })));
    await createApiClient({ fetch: fetcher, token: () => 'token' }).applyPatch('s /', 'w', hunk.id, 'accept');
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/session/s%20%2F/patch/apply');
    expect(options.body).toBe(JSON.stringify({ widgetId: 'w', hunkId: hunk.id, action: 'accept' }));
    expect(options.headers).toMatchObject({ Authorization: 'Bearer token' });
  });
});

// Use the real English dictionary while exercising JSX handlers without a renderer.
vi.mock('../LanguageProvider', async () => {
  const { translate } = await import('../../i18n');
  return { useI18n: () => ({ lang: 'en', t: translate('en'), setLang: vi.fn() }) };
});
