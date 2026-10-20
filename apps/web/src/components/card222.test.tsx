import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApiClient } from '../api';
import { translate, type Lang } from '../i18n';
import TeamTaskTree from './tasks/TeamTaskTree';
import ActivityQueue from './activity/ActivityQueue';
import AgentStudioComposer from './studio/AgentStudioComposer';
import TracePanel from './trace/TracePanel';
import {
  childrenOf,
  flattenTree,
  formatDuration,
  groupActivity,
  readTraceLayout,
  reorderPriority,
  sortByPriority,
  taskStatusLabelKey,
  TRACE_LAYOUT_STORAGE_KEY,
  type ActivityResponse,
  type BehaviorConformanceReportView,
  type ComposerLibraryEntry,
  type TaskTreeSnapshotView,
  type TaskTreesResponse,
  type TraceReportView,
} from '../workbench';

let lang: Lang = 'en';
vi.mock('./LanguageProvider', () => ({ useI18n: () => ({ lang, t: translate(lang), setLang: vi.fn() }) }));

const snapshot: TaskTreeSnapshotView = {
  rootInstanceId: 'root', projectRoot: 'E:/repo', updatedAt: 1,
  nodes: [
    { instanceId: 'root', title: 'coordinate', status: 'completed', dependencies: [], permissionScope: { allowedTools: ['*'], deniedTools: [], approvals: 'inherit' }, attempt: 1, durationMs: 1200, children: ['read-a', 'write-b'] },
    { instanceId: 'read-a', parentInstanceId: 'root', title: 'read a', status: 'completed', dependencies: [], permissionScope: { allowedTools: ['Read'], deniedTools: [], approvals: 'inherit' }, attempt: 1, durationMs: 40, result: { output: 'read-a done' }, children: [] },
    { instanceId: 'write-b', parentInstanceId: 'root', title: 'write b', status: 'waiting_approval', dependencies: ['read-a'], permissionScope: { allowedTools: ['Read', 'Write'], deniedTools: ['Bash'], approvals: 'ask' }, attempt: 2, lease: { leaseId: 'l1', holder: 'scheduler:root', attempt: 2, acquiredAt: 1, expiresAt: 99, releaseReason: 'waiting_approval' }, children: [] },
  ],
};
const trees: TaskTreesResponse = { trees: [snapshot], updatedAt: 1 };

const activity: ActivityResponse = {
  updatedAt: 1,
  runs: [
    { id: 's1', kind: 'session', projectRoot: 'E:/repo', title: 'Fix navigation', status: 'needs_attention', needsApproval: true, updatedAt: 10, approval: { sessionId: 's1', widgetId: 'w1', actionType: 'filesystem_write', description: 'write src/app.ts', requestedAt: '2026-10-14T00:00:00Z', options: [{ id: 'allow-once', label: 'Allow once', tone: 'primary' }, { id: 'deny', label: 'Deny', tone: 'danger' }] } },
    { id: 'g1', kind: 'goal', projectRoot: 'E:/other', title: 'Ship card 222', status: 'running', needsApproval: false, updatedAt: 20 },
  ],
};

const trace: TraceReportView = {
  sessionId: 's1', recordCount: 3, redactedFields: ['content', 'arguments'],
  turns: [{ turnId: 'turn-1', steps: [
    { seq: 0, ts: 't0', type: 'turn/start', turnId: 'turn-1', title: 'Turn started', detail: { source: 'user' } },
    { seq: 1, ts: 't1', type: 'tool/call', turnId: 'turn-1', step: 1, title: 'Tool call Write', detail: { toolName: 'Write', argumentKeys: ['path'], argumentCount: 1 } },
    { seq: 2, ts: 't2', type: 'turn/end', turnId: 'turn-1', title: 'Turn ended', detail: { kind: 'success' } },
  ] }],
};

const library: ComposerLibraryEntry[] = [
  { id: 'style', class: 'style', channel: 'prompt_guidance', render: 'Be concise.' },
  { id: 'protect', class: 'safety', channel: 'runtime_policy', render: 'Never read .env.', policy_ref: 'filesystem.protected' },
];

const report: BehaviorConformanceReportView = {
  snapshotHash: 'deadbeefdeadbeef', verdict: 'rejected',
  conflicts: [{ domain: 'orphan', entryIds: ['orphan'], severity: 'error', code: 'missing_enforcement', message: 'Runtime constraint "orphan" has no policy_ref.' }],
  conformance: [{ entryId: 'style', category: 'Instruction', channel: 'prompt_guidance', priority: 10, policyRef: null, policyRuleFound: true, compatibility: 'Mappable' }],
  diagnostics: [{ entryId: 'orphan', severity: 'error', code: 'COMPILE_FAILED', message: 'no enforcement' }],
  warnings: [], levels: [{ level: 'L0', status: 'available' }, { level: 'L4', status: 'unavailable' }],
};

describe('card 222 workbench helpers', () => {
  it('flattens the tree depth-first and resolves children', () => {
    expect(flattenTree(snapshot).map(({ node, depth }) => `${node.instanceId}@${depth}`)).toEqual(['root@0', 'read-a@1', 'write-b@1']);
    expect(childrenOf(snapshot, 'root').map((node) => node.instanceId)).toEqual(['read-a', 'write-b']);
  });

  it('maps statuses, durations and activity groups', () => {
    expect(taskStatusLabelKey('waiting_approval')).toBe('taskStatusWaitingApproval');
    expect(formatDuration(1200)).toBe('1.2 s');
    expect(formatDuration(40)).toBe('40 ms');
    expect(formatDuration(undefined)).toBe('—');
    expect(groupActivity(activity.runs).map((group) => group.status)).toEqual(['needs_attention', 'running']);
  });

  it('keeps staged priorities stable under reordering', () => {
    const staged = sortByPriority([{ ...library[0]!, priority: 10 }, { ...library[1]!, priority: 20 }]);
    expect(staged.map((entry) => entry.id)).toEqual(['protect', 'style']);
    const moved = reorderPriority(staged, 1, -1);
    expect(moved.map((entry) => entry.id)).toEqual(['style', 'protect']);
    expect(moved[0]!.priority!).toBeGreaterThan(moved[1]!.priority!);
    expect(reorderPriority(staged, 0, -1).map((entry) => entry.id)).toEqual(['protect', 'style']);
  });

  it('reads and defaults the persisted trace layout', () => {
    expect(readTraceLayout({ getItem: () => null })).toEqual({ compact: false, showDetail: true });
    expect(readTraceLayout({ getItem: () => JSON.stringify({ compact: true, showDetail: false }) })).toEqual({ compact: true, showDetail: false });
    expect(readTraceLayout({ getItem: () => 'not json' })).toEqual({ compact: false, showDetail: true });
    expect(TRACE_LAYOUT_STORAGE_KEY).toBe('vessel.trace.layout');
  });
});

describe('card 222 API client contract', () => {
  it('targets the new endpoints with the right verbs and encoding', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({})));
    const api = createApiClient({ fetch: fetcher });
    await api.taskTrees({ rootInstanceId: 'root-1', status: 'failed' });
    expect(fetcher.mock.calls[0]![0]).toBe('/api/tasks/tree?rootInstanceId=root-1&status=failed');
    await api.activityRuns();
    expect(fetcher.mock.calls[1]![0]).toBe('/api/activity/runs');
    await api.behaviorLibrary();
    expect(fetcher.mock.calls[2]![0]).toBe('/api/behavior/library');
    await api.composeBehavior(library, 's /1');
    expect(fetcher.mock.calls[3]![0]).toBe('/api/behavior/compose');
    expect(JSON.parse(String(fetcher.mock.calls[3]![1]?.body))).toMatchObject({ sessionId: 's /1' });
    await api.sessionTrace('s /1');
    expect(fetcher.mock.calls[4]![0]).toBe('/api/sessions/s%20%2F1/trace');
  });
});

describe('card 222 components', () => {
  it('renders the team task tree topology, metrics and statuses (en + zh)', () => {
    lang = 'en';
    const html = renderToStaticMarkup(<TeamTaskTree initial={trees} />);
    for (const value of ['Team task tree', 'coordinate', 'read a', 'write b', 'Waiting approval', 'Completed', 'Dependencies', 'scheduler:root']) expect(html).toContain(value);
    expect(html).toContain('data-status="waiting_approval"');
    expect(html).toContain('role="tree"');
    lang = 'zh';
    const zh = renderToStaticMarkup(<TeamTaskTree initial={trees} />);
    expect(zh).toContain('团队任务树');
    expect(zh).toContain('等待授权');
    lang = 'en';
    expect(renderToStaticMarkup(<TeamTaskTree />)).toContain('No task tree yet');
  });

  it('renders the cross-project approval queue with inline decisions', () => {
    lang = 'en';
    const html = renderToStaticMarkup(<ActivityQueue initial={activity} />);
    for (const value of ['Activity &amp; approval queue', 'Needs attention', 'Running', 'Fix navigation', 'write src/app.ts', 'Allow once', 'Deny']) expect(html).toContain(value);
    expect(html).toContain('data-status="needs_attention"');
    expect(html).not.toContain('disabled=""');
    expect(renderToStaticMarkup(<ActivityQueue initial={{ runs: [], updatedAt: 1 }} />)).toContain('Nothing needs attention');
  });

  it('renders the composer staged set, conflicts and conformance verdict', () => {
    lang = 'en';
    const html = renderToStaticMarkup(<AgentStudioComposer initialLibrary={library} initialStaged={library} initialReport={report} />);
    for (const value of ['Agent Studio composer', 'Behavior library', 'Composed rules', 'Rejected (not activatable)', 'has no policy_ref', 'Mappable', 'Enforcement rule found']) expect(html).toContain(value);
    expect(html).toContain('data-severity="error"');
    expect(html).toContain('L4:unavailable');
    lang = 'zh';
    expect(renderToStaticMarkup(<AgentStudioComposer initialLibrary={library} initialStaged={library} initialReport={report} />)).toContain('已拒绝（不可激活）');
  });

  it('clearly marks advisory verification without claiming live activation (UI-07)', () => {
    lang = 'en';
    const html = renderToStaticMarkup(<AgentStudioComposer initialLibrary={library} initialStaged={library} initialReport={report} />);
    expect(html).toContain('Verify candidate configuration');
    expect(html).toContain('Advisory candidate evaluation');
    expect(html).toContain('Candidate draft');
    expect(html).toContain('Compile failed — cannot be activated');
    lang = 'zh';
    const zh = renderToStaticMarkup(<AgentStudioComposer initialLibrary={library} initialStaged={library} initialReport={report} />);
    expect(zh).toContain('验证候选配置');
    expect(zh).toContain('候选配置编译评估');
    expect(zh).toContain('候选草稿');
    expect(zh).toContain('编译未通过，禁止启用');
  });

  it('renders a structured sanitized trace (keys only, no raw values)', () => {
    lang = 'en';
    const html = renderToStaticMarkup(<TracePanel initial={trace} sessionId="s1" />);
    for (const value of ['Structured trace', 'Turn turn-1', 'Tool call Write', 'argumentKeys', 'content, arguments', 'records']) expect(html).toContain(value);
    expect(html).toContain('data-type="tool/call"');
    expect(html).toContain('trace-panel');
    expect(renderToStaticMarkup(<TracePanel initial={{ ...trace, recordCount: 0, turns: [] }} sessionId="s1" />)).toContain('No trace records');
  });
});
