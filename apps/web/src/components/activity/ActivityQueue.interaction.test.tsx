import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import ActivityQueue, { type ActivityQueueProps } from './ActivityQueue';
import type { ActivityRunView } from '../../workbench';

const hooks = vi.hoisted(() => ({ cells: [] as unknown[], cursor: 0 }));
vi.mock('../LanguageProvider', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.cursor++; if (!(i in hooks.cells)) hooks.cells[i] = initial;
    return [hooks.cells[i], (next: unknown) => { hooks.cells[i] = typeof next === 'function' ? next(hooks.cells[i]) : next; }];
  },
  useRef: (initial: unknown) => { const i = hooks.cursor++; return hooks.cells[i] ??= { current: initial }; },
  useEffect: () => {},
}));
function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}
const run: ActivityRunView = { id: 'team', kind: 'team', title: 'Team', projectRoot: '/fixture', status: 'needs_attention', needsApproval: true, updatedAt: 1, entity: { status: 'staged', tasks: [{ title: 'Review change', status: 'pending' }] } };
function render(props: ActivityQueueProps) { hooks.cursor = 0; return nodes(ActivityQueue(props)); }
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(() => { hooks.cells = []; hooks.cursor = 0; });

describe('UI-04 entity actions', () => {
  it('keeps team approval pending until the server refresh converges and blocks duplicate decisions', async () => {
    let resolve!: () => void;
    const api = { activityRuns: vi.fn(async () => ({ updatedAt: 2, runs: [{ ...run, status: 'running' as const, needsApproval: false, entity: { status: 'running' } }] })), respondWidget: vi.fn(), approveTeamStage: vi.fn(() => new Promise<{ ok: boolean; status: string }>(done => { resolve = () => done({ ok: true, status: 'running' }); })) };
    const props = { api, initial: { runs: [run], updatedAt: 1 } };
    const approve = render(props).find(node => node.props.children === 'activityApprove')!;
    (approve.props.onClick as () => void)(); (approve.props.onClick as () => void)();
    expect(api.approveTeamStage).toHaveBeenCalledTimes(1);
    expect(render(props).some(node => node.props['data-status'] === 'needs_attention')).toBe(true);
    resolve(); await settle();
    expect(render(props).some(node => node.props['data-status'] === 'running')).toBe(true);
    expect(api.activityRuns).toHaveBeenCalledTimes(1);
  });
  it('retains actionable approval on backend rejection and disables transportless decisions', async () => {
    const api = { activityRuns: vi.fn(), respondWidget: vi.fn(), rejectTeamStage: vi.fn(async () => { throw new Error('stage_conflict'); }) };
    const props = { api, initial: { runs: [run], updatedAt: 1 } };
    (render(props).find(node => node.props.children === 'activityDeny')!.props.onClick as () => void)(); await settle();
    expect(render(props).some(node => node.props.role === 'alert')).toBe(true);
    expect(api.activityRuns).not.toHaveBeenCalled();
    expect(render(props).some(node => node.props['data-status'] === 'needs_attention')).toBe(true);
    expect(render({ initial: props.initial }).find(node => node.props.children === 'activityApprove')?.props.disabled).toBe(true);
  });
});
