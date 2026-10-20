import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { isValidElement, type ReactNode, type ReactElement } from 'react';
import type { ImpactRadarWidget } from '@vessel/shared';
import { appendCacheObservation, AstTopologyPanel, CacheEconomicsPanel, ContextPanel, DualSurfaceLayout, INSPECTOR_STORAGE_KEY, isInspectorShortcut, readInspectorState, PatchCanvasPanel } from './DualSurfaceLayout';
import { isInspectorObservation } from '../../inspector';
import { createEventStream } from '../../sse';

const cache = { promptTokens: 100, cachedTokens: 70, creationTokens: 20, billedHitRate: .7, estimatedSavingsUsd: .012, provider: 'provider', model: 'model' };
afterEach(() => vi.unstubAllGlobals());
function browser(tab: string, narrow = false) {
  vi.stubGlobal('window', { localStorage: { getItem: () => JSON.stringify({ open: true, tab }) }, matchMedia: () => ({ matches: narrow }) });
}
describe('Inspector layout and state controller', () => {
  it('renders a server proposal in the canvas and routes the selected hunk through injected API', async () => {
    const applyPatch = vi.fn(async () => ({ hunk: {} as import('@vessel/shared').DiffHunk }));
    const proposal: import('@vessel/shared').DiffInspectorWidget = { id: 'proposal', kind: 'diff_inspector', status: 'pending', turnIndex: 0, timestamp: 'now', payload: { filePath: 'a.txt', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new\n' } };
    const tree = PatchCanvasPanel({ sessionId: 'session', patches: [proposal], api: { applyPatch } });
    function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
      if (Array.isArray(root)) return root.flatMap(nodes);
      if (!isValidElement<Record<string, unknown>>(root)) return [];
      return [root, ...nodes(root.props.children as ReactNode)];
    }
    const child = nodes(tree).find(node => node.props.onAction)!;
    await (child.props.onAction as (id: string, action: 'accept') => Promise<void>)('a.txt#hunk-0', 'accept');
    expect(applyPatch).toHaveBeenCalledWith('session', 'proposal', 'a.txt#hunk-0', 'accept');
    expect(renderToStaticMarkup(tree)).toContain('Interactive patch picker');
    expect(renderToStaticMarkup(<PatchCanvasPanel sessionId="empty" />)).toContain('No patch proposals');
  });
  it('honors default visibility and persisted visibility/tab independently', () => {
    expect(readInspectorState(undefined, false)).toEqual({ open: false, tab: 'swarm' });
    expect(readInspectorState(undefined, true)).toEqual({ open: true, tab: 'swarm' });
    const getItem = vi.fn(() => '{"open":false,"tab":"ast"}');
    expect(readInspectorState({ getItem }, true)).toEqual({ open: false, tab: 'ast' });
    expect(getItem).toHaveBeenCalledWith(INSPECTOR_STORAGE_KEY);
    expect(readInspectorState({ getItem: () => '{"open":"false","tab":"unknown"}' }, true)).toEqual({ open: true, tab: 'swarm' });
    expect(readInspectorState({ getItem: () => { throw Error('blocked'); } }, true).open).toBe(true);
    expect(readInspectorState({ getItem: () => 'broken' }, false).open).toBe(false);
  });
  it('renders folded conversation and default docked inspector', () => {
    const folded = renderToStaticMarkup(<DualSurfaceLayout sessionId="session"><p>Timeline</p></DualSurfaceLayout>);
    expect(folded).toContain('Timeline'); expect(folded).toContain('aria-expanded="false"'); expect(folded).not.toContain('role="tabpanel"');
    const docked = renderToStaticMarkup(<DualSurfaceLayout sessionId="session" inspectorDefaultOpen><p>Timeline</p></DualSurfaceLayout>);
    expect(docked).toContain('role="complementary"'); expect(docked).toContain('Swarm topology'); expect(docked).not.toContain('aria-modal');
    expect(docked.match(/role="tab"/g)).toHaveLength(8);
  });
  it.each([['swarm', 'Swarm topology'], ['cognition', 'Cognitive rules'], ['context', 'Context cache layers'], ['cache', 'KV Cache economics'], ['ast', 'AST symbol dependencies'], ['patch', 'Patch workbench'], ['tasks', 'Team task tree'], ['trace', 'Structured trace']])('mounts selected %s panel', (tab, heading) => {
    browser(tab);
    const html = renderToStaticMarkup(<DualSurfaceLayout sessionId="s">Timeline</DualSurfaceLayout>);
    expect(html).toContain(heading); expect(html.match(/aria-selected="true"/g)).toHaveLength(1); expect(html.match(/role="tabpanel"/g)).toHaveLength(1);
  });
  it('makes a narrow inspector modal with background inert and a backdrop', () => {
    browser('cache', true);
    const html = renderToStaticMarkup(<DualSurfaceLayout sessionId="s">Timeline</DualSurfaceLayout>);
    expect(html).toContain('role="dialog"'); expect(html).toContain('aria-modal="true"'); expect(html).toContain('inert=""'); expect(html).toContain('inspector-backdrop');
  });
  it.each([1024, 1100, 1180, 1181, 1440])('keeps modal semantics aligned with docking at %ipx', width => {
    browser('cache');
    window.matchMedia = vi.fn(query => ({ matches: width <= Number(query.match(/max-width: (\d+)px/)?.[1]) }) as MediaQueryList);
    const html = renderToStaticMarkup(<DualSurfaceLayout sessionId="s">Timeline</DualSurfaceLayout>);
    if (width <= 1180) {
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('inspector-backdrop');
      expect(html).toContain('inert=""');
    } else {
      expect(html).toContain('role="complementary"');
      expect(html).not.toContain('inspector-backdrop');
      expect(html).not.toContain('inert=""');
    }
  });
  it('recognizes platform shortcuts, ignores editable controls and unrelated modifiers', () => {
    const key = { key: 'i', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
    expect(isInspectorShortcut(key, false)).toBe(true); expect(isInspectorShortcut({ ...key, ctrlKey: false, metaKey: true }, false)).toBe(true);
    expect(isInspectorShortcut(key, true)).toBe(false); expect(isInspectorShortcut({ ...key, key: 'k' }, false)).toBe(false);
    expect(isInspectorShortcut({ ...key, altKey: true }, false)).toBe(false); expect(isInspectorShortcut({ ...key, shiftKey: true }, false)).toBe(false);
  });
});
describe('Observed Inspector telemetry', () => {
  it('bounds cache history to the last 40 observations without mutating previous samples', () => {
    const previous = Array.from({ length: 40 }, (_, i) => ({ ...cache, promptTokens: i }));
    const next = appendCacheObservation(previous, cache);
    expect(next).toHaveLength(40); expect(next[0].promptTokens).toBe(1); expect(next.at(-1)).toBe(cache); expect(previous[0].promptTokens).toBe(0);
    const html = renderToStaticMarkup(<CacheEconomicsPanel history={next} />);
    expect(html).toContain('70.0%'); expect(html).toContain('Observed billed cache hit rate history'); expect(html).toMatch(/Last 40\s+observed/);
  });
  it('distinguishes missing observations from measured zeroes and prefix from workspace hashes', () => {
    const empty = renderToStaticMarkup(<CacheEconomicsPanel />); expect(empty).toContain('No cache usage observed'); expect(empty).toContain('No workspace fingerprint observed');
    const observation = { observedAt: 1, prefix: { stableBytes: 0, scopedBytes: 4, volatileBytes: 8, sha256: 'a'.repeat(64) }, workspace: { trackedFilesHash: 'b'.repeat(64), fileCount: 0, uncommittedDiffBytes: 0, timestamp: 1 } };
    const html = renderToStaticMarkup(<CacheEconomicsPanel history={[{ ...cache, billedHitRate: 0 }]} observation={observation} />);
    expect(html).toContain('0.0%'); expect(html).toMatch(/Stable · 0\s+bytes/); expect(html).toContain('a'.repeat(64)); expect(html).toContain('b'.repeat(64)); expect(html).toMatch(/0\s+tracked files/);
  });
  it('renders four backend cache dependency versions and rejects corrupt snapshots', () => {
    const observation = { observedAt: 1, projectionRevision: 3, cacheLayers: (['assembly', 'provider-prefix', 'projection', 'token-estimation'] as const).map(layer => ({ layer, dependencyHash: 'c'.repeat(64), hits: 0, misses: 2, invalidations: 1, entries: 1 })) };
    expect(isInspectorObservation(observation)).toBe(true);
    const html = renderToStaticMarkup(<ContextPanel observation={observation} />);
    for (const label of ['Assembly cache', 'Provider prefix cache', 'Projection cache', 'Token estimation cache']) expect(html).toContain(label);
    expect(html).toContain('Hits 0 · Misses 2 · Invalidations 1 · Entries 1'); expect(html).toContain('c'.repeat(64));
    expect(html).toContain('upstream provider cache acceptance'); expect(html).toContain('Effective projection revision 3');
    expect(renderToStaticMarkup(<ContextPanel />)).toContain('No context cache snapshot observed');
    for (const cacheLayers of [[{ ...observation.cacheLayers[0], hits: -1 }], [{ ...observation.cacheLayers[0], layer: 'invented' }], [observation.cacheLayers[0], observation.cacheLayers[0]], [{ ...observation.cacheLayers[0], dependencyHash: 'secret' }], null]) expect(isInspectorObservation({ ...observation, cacheLayers })).toBe(false);
  });
  it('renders actual observed target/callers/files without claiming a complete dependency graph', () => {
    const widget: ImpactRadarWidget = { id: 'impact', kind: 'impact_radar', timestamp: '2026-10-09T00:00:00Z', turnIndex: 0, status: 'resolved', payload: { targetSymbol: '<target>', blastRadius: { modifiedFiles: ['a.ts'], affectedCallers: [{ filePath: 'b.ts', symbolName: 'caller' }] } } };
    const html = renderToStaticMarkup(<AstTopologyPanel impacts={[widget]} />);
    expect(html).toContain('&lt;target&gt;'); expect(html).toContain('caller'); expect(html).toContain('a.ts'); expect(html).toContain('b.ts'); expect(html).toContain('Observed impact reports');
    expect(renderToStaticMarkup(<AstTopologyPanel />)).toContain('No AST impact reports observed');
  });
  it('rejects malformed metadata and dispatches valid snapshots over the live SSE seam', () => {
    const observation = { observedAt: 1, prefix: { stableBytes: 1, scopedBytes: 2, volatileBytes: 3, sha256: 'a'.repeat(64) } };
    expect(isInspectorObservation(observation)).toBe(true);
    for (const invalid of [null, {}, { observedAt: 1 }, { ...observation, prefix: null }, { ...observation, prefix: { ...observation.prefix, stableBytes: -1 } }, { ...observation, workspace: null }]) expect(isInspectorObservation(invalid)).toBe(false);
    let native!: { onmessage: ((event: MessageEvent) => void) | null };
    vi.stubGlobal('EventSource', class { onmessage = null; onopen = null; close() {} constructor() { native = this; } });
    const onInspector = vi.fn(); const onError = vi.fn(); const stream = createEventStream('/events', { onInspector, onError });
    native.onmessage!(new MessageEvent('message', { data: JSON.stringify({ type: 'inspector', delta: observation }) }));
    expect(onInspector).toHaveBeenCalledWith(observation);
    native.onmessage!(new MessageEvent('message', { data: JSON.stringify({ type: 'inspector', delta: { ...observation, prefix: null } }) }));
    expect(onError).toHaveBeenCalledOnce(); expect(onInspector).toHaveBeenCalledOnce();
    stream.close(); native.onmessage!(new MessageEvent('message', { data: JSON.stringify({ type: 'inspector', delta: observation }) })); expect(onInspector).toHaveBeenCalledOnce();
  });
});

// Use the real English dictionary while exercising JSX handlers without a renderer.
vi.mock('../LanguageProvider', async () => {
  const { translate } = await import('../../i18n');
  return { useI18n: () => ({ lang: 'en', t: translate('en'), setLang: vi.fn() }) };
});
