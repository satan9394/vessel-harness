import type { ReactNode as I18nTestNode } from 'react';
import { LanguageProvider } from '../LanguageProvider';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../api';
import { layoutDag, type TeamDagTask, type TeamPlanStage } from '../../teamStages';
import TeamDagCanvas from './TeamDagCanvas';
import { TeamNodeDetails, loadArtifactDiff } from './TeamNodeDrawer';
import { TeamPlanEditorFields } from './TeamPlanEditor';
import TeamStagedBanner from './TeamStagedBanner';
import TeamModule from '../TeamModule';

function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}
const task = (id: string, dependencies: string[] = [], status: TeamDagTask['status'] = 'pending'): TeamDagTask => ({ id, title: id, description: `Task ${id}`, assignedRole: 'generator', dependencies, status });
const stage: TeamPlanStage = { id: 's', status: 'staged', tasks: [task('a')], roster: [{ memberId: 'developer', role: 'generator', routeSnapshot: { providerId: 'mock', model: 'model-1', reasoningEffort: 'medium' } }] };

describe('team DAG workspace', () => {
  it('layers out-of-order diamond dependencies and draws all four edges', () => {
    const tasks = [task('d', ['b', 'c']), task('c', ['a']), task('b', ['a']), task('a')];
    const positions = layoutDag(tasks);
    expect(positions.find(p => p.task.id === 'a')!.x).toBeLessThan(positions.find(p => p.task.id === 'b')!.x);
    expect(positions[0]!.x).toBeGreaterThan(positions[1]!.x);
    expect(positions[1]!.y).not.toBe(positions[2]!.y);
    const html = renderToStaticMarkup(<TeamDagCanvas tasks={tasks} onSelectTask={() => {}} />);
    expect(html.match(/data-edge=/g)).toHaveLength(4);
    expect(html).toContain(' C ');
    expect(renderToStaticMarkup(<TeamDagCanvas tasks={[]} onSelectTask={() => {}} />)).toContain('Team task dependencies');
  });
  it('renders every lifecycle state and selects the exact keyboard-accessible node', () => {
    const tasks = (['pending', 'ready', 'claimed', 'running', 'completed', 'failed'] as const).map(s => task(s, [], s));
    const select = vi.fn();
    const tree = TeamDagCanvas({ tasks, activeTaskId: 'running', onSelectTask: select });
    const html = renderToStaticMarkup(tree);
    for (const t of tasks) expect(html).toContain(`status-${t.status}`);
    const button = nodes(tree).find(n => n.type === 'button' && n.props['aria-pressed'] === true)!;
    (button.props.onClick as () => void)();
    expect(select).toHaveBeenCalledWith('running');
  });
  it('shows frozen roster routes and invokes approve/reject buttons only for staged plans', () => {
    const approve = vi.fn(); const reject = vi.fn();
    const tree = TeamStagedBanner({ stage, onApprove: approve, onReject: reject });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('1 task'); expect(html).toContain('mock/model-1'); expect(html).toContain('Medium');
    const buttons = nodes(tree).filter(n => n.type === 'button');
    (buttons[0]!.props.onClick as () => void)(); (buttons[1]!.props.onClick as () => void)();
    expect(approve).toHaveBeenCalledOnce(); expect(reject).toHaveBeenCalledOnce();
    expect(nodes(TeamStagedBanner({ stage, busy: true, onApprove: approve, onReject: reject })).filter(n => n.type === 'button').every(n => n.props.disabled)).toBe(true);
    expect(TeamStagedBanner({ stage: { ...stage, status: 'running' }, onApprove: approve, onReject: reject })).toBeNull();
  });
  it('shows dependency/executor/error/artifacts and limits output to 300 characters', () => {
    const close = vi.fn();
    const tree = TeamNodeDetails({ task: { ...task('b', ['a'], 'failed'), claimedBy: 'dev', error: 'fixture error', result: { output: 'x'.repeat(350), artifacts: ['src/out.ts'] } }, onClose: close });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('Dependencies: a'); expect(html).toContain('Executor: dev'); expect(html).toContain('fixture error'); expect(html).toContain('src/out.ts');
    expect(html).toContain('x'.repeat(300)); expect(html).not.toContain('x'.repeat(301));
    (nodes(tree).find(n => n.type === 'button')!.props.onClick as () => void)(); expect(close).toHaveBeenCalledOnce();
  });
  it('renders actual artifact comparison and invokes diff and close controls', () => {
    const view = vi.fn();
    const tree = TeamNodeDetails({ task: { ...task('a'), result: { output: 'done', artifacts: ['output.txt'] } }, onClose: () => {}, onArtifact: view,
      artifactUrl: index => `/api/artifacts/${index}/content`, artifact: { diff: '--- /dev/null\n+++ output.txt\n+real content', comparison: 'Current workspace against Git HEAD' } });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('href="/api/artifacts/0/content"'); expect(html).toContain('+real content'); expect(html).toContain('Current workspace against Git HEAD');
    const button = nodes(tree).find(n => n.type === 'button' && n.props.children === 'View diff')!;
    (button.props.onClick as () => void)(); expect(view).toHaveBeenCalledWith(0);
  });
  it('edits member routes and task parameters through native controls and saves a revised preview', () => {
    const change = vi.fn(); const save = vi.fn();
    const plan = { roster: [{ memberId: 'developer', presetId: 'developer', providerId: 'mock', model: 'model-1' }], tasks: stage.tasks };
    const tree = TeamPlanEditorFields({ plan, providers: ['mock', 'second'], onChange: change, onSave: save });
    const all = nodes(tree);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('Task parameters'); expect(html).toContain('Save revised preview'); expect(html).toContain('second');
    const update = (node: ReactElement<Record<string, unknown>>, value: string) => (node.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
    update(all.find(n => n.type === 'input' && n.props.value === 'model-1')!, 'chosen');
    expect(change).toHaveBeenLastCalledWith({ ...plan, roster: [{ ...plan.roster[0], model: 'chosen' }] });
    update(all.find(n => n.type === 'select' && n.props.value === 'mock')!, 'second');
    expect(change).toHaveBeenLastCalledWith({ ...plan, roster: [{ ...plan.roster[0], providerId: 'second' }] });
    update(all.find(n => n.type === 'select' && n.props.value === 'generator')!, 'evaluator');
    expect(change).toHaveBeenLastCalledWith({ ...plan, tasks: [{ ...plan.tasks[0], assignedRole: 'evaluator' }] });
    update(all.find(n => n.type === 'input' && n.props.value === '' && n.props.type === undefined)!, 'x, y');
    expect(change).toHaveBeenLastCalledWith({ ...plan, tasks: [{ ...plan.tasks[0], dependencies: ['x', 'y'] }] });
    (all.find(n => n.type === 'form')!.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: () => {} });
    expect(save).toHaveBeenCalledOnce();
    expect(nodes(TeamPlanEditorFields({ plan, providers: ['mock'], busy: true, onChange: change, onSave: save })).filter(n => n.type === 'fieldset').every(n => n.props.disabled)).toBe(true);
  });
  it('ignores stale artifact diff responses after a newer selection or drawer cancellation', async () => {
    const responses: ((value: Response) => void)[] = [];
    const fetch = vi.fn(() => new Promise<Response>(resolve => responses.push(resolve))) as unknown as typeof globalThis.fetch;
    const api = createApiClient({ fetch }); const revision = { current: 0 }; const result = vi.fn();
    const a = loadArtifactDiff(api, 's', 'task', 0, revision, result);
    const b = loadArtifactDiff(api, 's', 'task', 1, revision, result);
    responses[1]!(new Response(JSON.stringify({ path: 'b.txt', diff: '+new selection', comparison: 'HEAD' })));
    await b;
    responses[0]!(new Response(JSON.stringify({ path: 'a.txt', diff: '+stale', comparison: 'HEAD' })));
    await a;
    expect(result).toHaveBeenCalledOnce(); expect(result).toHaveBeenCalledWith({ path: 'b.txt', diff: '+new selection', comparison: 'HEAD' });
    const closed = loadArtifactDiff(api, 's', 'task', 2, revision, result); revision.current++;
    responses[2]!(new Response(JSON.stringify({ path: 'closed.txt', diff: '+closed', comparison: 'HEAD' })));
    await closed; expect(result).toHaveBeenCalledOnce();
  });
  it('wires the stage workspace into the existing Team module and targets encoded HTTP ids', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => { calls.push([String(url), init]); return new Response(JSON.stringify({ stages: [], stage }), { status: 200 }); }) as unknown as typeof globalThis.fetch;
    const api = createApiClient({ fetch });
    expect(renderToStaticMarkup(<TeamModule sessionId="session" api={api} />)).toContain('Staged team plans');
    await api.listTeamStages('s/1'); await api.stageTeam('s/1', { task: 'build' }); await api.approveTeamStage('id/1'); await api.rejectTeamStage('id/1');
    expect(calls.map(c => c[0])).toEqual(['/api/sessions/s%2F1/team-stages', '/api/sessions/s%2F1/team-stages', '/api/team/stages/id%2F1/approve', '/api/team/stages/id%2F1/reject']);
    expect(calls[1]![1]?.body).toBe(JSON.stringify({ task: 'build' })); expect(calls[2]![1]?.method).toBe('POST');
    const plan = { roster: [{ memberId: 'g', presetId: 'developer', providerId: 'mock', model: 'new' }], tasks: stage.tasks };
    await api.reviseTeamStage('id/1', plan);
    expect(calls[4]![0]).toBe('/api/team/stages/id%2F1/revise'); expect(calls[4]![1]?.body).toBe(JSON.stringify(plan));
  });
});

function renderToStaticMarkup(node: I18nTestNode): string {
  return renderMarkup(<LanguageProvider>{node}</LanguageProvider>).replace(/\s+/g, ' ');
}

vi.mock('../../i18n', async original => ({ ...await original<typeof import('../../i18n')>(), getInitialLang: () => 'en' as const }));

vi.mock('../LanguageProvider', async original => {
  const { translate } = await import('../../i18n');
  return { ...await original<typeof import('../LanguageProvider')>(), useI18n: () => ({ lang: 'en', t: translate('en'), setLang: vi.fn() }) };
});
