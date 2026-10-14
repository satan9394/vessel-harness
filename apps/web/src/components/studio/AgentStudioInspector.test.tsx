import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BehaviorInspection } from '@vessel/shared';
import { createApiClient } from '../../api';
import { translate, type Lang } from '../../i18n';
import AgentStudioInspector, { BehaviorInspectionView, readBehaviorInspection } from './AgentStudioInspector';

let lang: Lang = 'en';
vi.mock('../LanguageProvider', () => ({ useI18n: () => ({ lang, t: translate(lang), setLang: vi.fn() }) }));

const inspection: BehaviorInspection = {
  version: '1', snapshotHash: 'snapshot-hash',
  layers: ['L0', 'L1', 'L2', 'L3', 'L4'].map(level => ({ level: level as BehaviorInspection['layers'][number]['level'], status: level === 'L4' ? 'unavailable' : 'available', sourceRefs: ['behavior.yaml'], snapshot: level === 'L4' ? null : { entry: '<script>unsafe()</script>' }, reason: level === 'L4' ? 'conformance_not_run' : undefined })),
  entries: [{ id: 'read-only', category: 'Constraint', sourceRef: 'behavior.yaml', priority: 10, channel: 'runtime_policy', compatibility: 'Enforceable', policyRef: 'policy.default', policyRuleIds: ['deny-write'], assertions: ['cannot-write'], assertionResults: [], provenance: { channel: { sourceRef: 'behavior.yaml', priority: 10, strategy: 'immutable' } } }],
  diagnostics: [{ entryId: 'read-only', sourceRef: 'behavior.yaml', severity: 'warning', code: 'unverified', message: 'No runtime evidence' }],
};

describe('Agent Studio inspection', () => {
  it('renders actual layers, mappings, provenance and escaped snapshots without claiming L4 verification', () => {
    lang = 'en';
    const html = renderToStaticMarkup(<BehaviorInspectionView inspection={inspection} />);
    for (const value of ['L0', 'L1', 'L2', 'L3', 'L4', 'behavior.yaml', 'policy.default', 'deny-write', 'immutable', 'cannot-write', 'snapshot-hash', 'unverified']) expect(html).toContain(value);
    expect(html).toContain('this layer is not verified');
    expect(html).not.toContain('conformance_not_run');
    expect(html).toContain('aria-current="step">Enforceable');
    expect(html).not.toContain('aria-current="step">Verified');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
  it('localizes categories, compatibility and unavailable evidence in Chinese', () => {
    lang = 'zh';
    const html = renderToStaticMarkup(<BehaviorInspectionView inspection={inspection} />);
    for (const value of ['约束', '可导入', '可渲染', '可映射', '可执法', '已验证', '不得视为已验证', '字段合并溯源', '策略执法映射']) expect(html).toContain(value);
  });
  it('shows an explicit no-session state and accessible loading', () => {
    lang = 'en';
    const api = { inspectBehavior: vi.fn() };
    expect(renderToStaticMarkup(<AgentStudioInspector api={api} selectedSessionId={null} />)).toContain('Select a session');
    const pending = renderToStaticMarkup(<AgentStudioInspector api={api} selectedSessionId="s1" />);
    expect(pending).toContain('aria-busy="true"');
    expect(pending).toContain('role="status"');
    expect(pending).toContain('disabled=""');
    expect(api.inspectBehavior).not.toHaveBeenCalled();
  });
  it('reads authenticated and encoded session inspection through the API', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ sessionId: 's /1', inspection })));
    const api = createApiClient({ fetch: fetcher, token: () => 'fixture-token' });
    await expect(api.inspectBehavior('s /1')).resolves.toEqual({ sessionId: 's /1', inspection });
    expect(fetcher.mock.calls[0]![0]).toBe('/api/behavior/inspect?sessionId=s%20%2F1');
    expect(fetcher.mock.calls[0]![1]?.headers).toMatchObject({ Authorization: 'Bearer fixture-token' });
  });
  it('ignores late success after session switching and late failure after unmount', async () => {
    let resolve!: (value: { sessionId: string; inspection: BehaviorInspection }) => void;
    let reject!: (reason: Error) => void;
    const api = { inspectBehavior: vi.fn(() => new Promise<{ sessionId: string; inspection: BehaviorInspection }>((yes, no) => { resolve = yes; reject = no; })) };
    const receive = vi.fn(); const fail = vi.fn();
    const first = readBehaviorInspection(api, 'old', receive, fail);
    first.close(); resolve({ sessionId: 'old', inspection }); await first.ready;
    const second = readBehaviorInspection(api, 'next', receive, fail);
    second.close(); reject(new Error('late error')); await second.ready;
    expect(receive).not.toHaveBeenCalled(); expect(fail).not.toHaveBeenCalled();
  });
  it('delivers available inspection and current errors without fabricating fallback data', async () => {
    const receive = vi.fn(); const fail = vi.fn();
    const api = { inspectBehavior: vi.fn().mockResolvedValueOnce({ sessionId: 's1', inspection }).mockRejectedValueOnce(new Error('behavior_snapshot_unavailable')) };
    await readBehaviorInspection(api, 's1', receive, fail).ready;
    expect(receive).toHaveBeenCalledWith(inspection);
    await readBehaviorInspection(api, 's2', receive, fail).ready;
    expect(receive).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ message: 'behavior_snapshot_unavailable' }));
  });
  it('refreshes evidence for the same session through a new read', async () => {
    const updated: BehaviorInspection = { ...inspection, layers: inspection.layers.map(layer => layer.level === 'L4' ? { ...layer, status: 'available', reason: undefined, snapshot: { assertionResults: [{ assertionId: 'cannot-write', passed: true, evidence: 'runtime audit' }] } } : layer) };
    const api = { inspectBehavior: vi.fn().mockResolvedValueOnce({ sessionId: 's1', inspection }).mockResolvedValueOnce({ sessionId: 's1', inspection: updated }) };
    const receive = vi.fn(); const fail = vi.fn();
    await readBehaviorInspection(api, 's1', receive, fail).ready;
    await readBehaviorInspection(api, 's1', receive, fail).ready;
    expect(api.inspectBehavior.mock.calls).toEqual([['s1'], ['s1']]);
    expect(receive).toHaveBeenLastCalledWith(updated);
    lang = 'en';
    const html = renderToStaticMarkup(<BehaviorInspectionView inspection={updated} />);
    expect(html).toContain('runtime audit');
    expect(html).not.toContain('this layer is not verified');
  });
});
