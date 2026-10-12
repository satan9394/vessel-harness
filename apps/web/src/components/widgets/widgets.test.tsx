import type { ReactNode as I18nTestNode } from 'react';
import { LanguageProvider } from '../LanguageProvider';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import type { PermissionActionWidget, DiffInspectorWidget, WidgetBlock } from '@vessel/shared';
import { WidgetDispatcher } from './WidgetDispatcher';
import { parseUnifiedDiff } from './InlineDiffInspector';
import MessageList, { upsertWidget, resolveWidget } from '../MessageList';
import { createEventStream } from '../../sse';
import { createApiClient } from '../../api';

const base = { id: 'w', turnIndex: 0, timestamp: '2026-10-09T00:00:00Z', status: 'pending' as const };
const action: PermissionActionWidget = { ...base, kind: 'permission_action', payload: { actionType: 'filesystem_write', description: 'Write file?', options: [{ id: 'yes', label: 'Allow', tone: 'primary' }, { id: 'no', label: 'Deny', tone: 'danger' }] } };
const diff: DiffInspectorWidget = { ...base, kind: 'diff_inspector', payload: { filePath: 'a.ts', additions: 1, deletions: 1, patch: '--- a/a.ts\n+++ b/a.ts\n@@ -8,2 +8,2 @@\n old\n-bad\n+good' } };
afterEach(() => vi.unstubAllGlobals());

describe('inline widget rendering and timeline reconciliation', () => {
  it('distinguishes hunk content beginning with triple signs from file headers', () => {
    const patch = '--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n---counter;\n+++counter;\n unchanged\n--- a/b.ts\n+++ b/b.ts\n@@ -0,0 +1 @@\n+++next;';
    const rows = parseUnifiedDiff(patch);
    expect(rows[3]).toMatchObject({ kind: 'remove', oldLine: 1 });
    expect(rows[4]).toMatchObject({ kind: 'add', newLine: 1 });
    expect(rows[5]).toMatchObject({ kind: 'context', oldLine: 2, newLine: 2 });
    expect(rows[6].kind).toBe('meta'); expect(rows[7].kind).toBe('meta');
    expect(rows[9]).toMatchObject({ kind: 'add', newLine: 1 });
    const html = renderToStaticMarkup(<WidgetDispatcher widget={{ ...diff, payload: { ...diff.payload, patch } }} sessionId="s" />);
    expect(html).toContain('+2'); expect(html).toContain('−1');
  });
  it('parses unified hunks, aligned line numbers and actual added/removed counts', () => {
    const rows = parseUnifiedDiff(diff.payload.patch);
    expect(rows.filter(row => row.kind === 'add')).toEqual([{ text: '+good', kind: 'add', oldLine: undefined, newLine: 9 }]);
    expect(rows.filter(row => row.kind === 'remove')[0].oldLine).toBe(9);
    const html = renderToStaticMarkup(<WidgetDispatcher widget={diff} sessionId="s" />);
    expect(html).toContain('+1'); expect(html).toContain('−1'); expect(html).toContain('aria-expanded="true"'); expect(html).toContain('diff-number');
  });
  it('collapses more than 20 lines and honors an explicit default', () => {
    const long = { ...diff, payload: { ...diff.payload, patch: Array(21).fill('+new').join('\n') } };
    expect(renderToStaticMarkup(<WidgetDispatcher widget={long} sessionId="s" />)).toContain('Expand 21 lines');
    expect(renderToStaticMarkup(<WidgetDispatcher widget={{ ...long, payload: { ...long.payload, collapsedByDefault: false } }} sessionId="s" />)).toContain('aria-expanded="true"');
  });
  it.each(['red_verified', 'green_verified', 'rejected'] as const)('renders %s, hash prefix and expandable full verification', phase => {
    const html = renderToStaticMarkup(<WidgetDispatcher sessionId="s" widget={{ ...base, kind: 'red_green_gate', payload: { phase, command: 'test', exitCode: 1, proofSha256: 'a'.repeat(64), failureSummary: 'assertion failed' } }} />);
    expect(html).toContain(`gate-${phase}`); expect(html).toContain('SHA-256 aaaaaaaaaaaa'); expect(html).toContain('a'.repeat(64)); expect(html).toContain('<details>'); expect(html).toContain('assertion failed');
  });
  it('renders callers and files safely as text', () => {
    const html = renderToStaticMarkup(<WidgetDispatcher sessionId="s" widget={{ ...base, kind: 'impact_radar', payload: { targetSymbol: '<script>', blastRadius: { modifiedFiles: ['a.ts'], affectedCallers: [{ filePath: 'b.ts', symbolName: 'caller' }] } } }} />);
    expect(html).toContain('&lt;script&gt;'); expect(html).toContain('a.ts'); expect(html).toContain('caller'); expect(html).toContain('b.ts');
  });
  it('upserts replay IDs and never reopens a resolved action', () => {
    let items = upsertWidget([], action); items = upsertWidget(items, action);
    expect(items).toHaveLength(1);
    items = resolveWidget(items, { widgetId: 'w', selectedOptionId: 'yes', resolvedAt: base.timestamp });
    expect(upsertWidget(items, action)).toBe(items);
    const html = renderToStaticMarkup(<MessageList items={items} thinking={false} sessionId="s" onRespond={async () => {}} />);
    expect(html).toContain('Resolved · Allow'); expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(resolveWidget(items, { widgetId: 'w', selectedOptionId: 'invalid', resolvedAt: base.timestamp })).toEqual(items);
  });
  it('renders expired permissions with disabled choices', () => {
    const expired = upsertWidget([], { ...action, status: 'expired' });
    expect(upsertWidget(expired, action)).toBe(expired);
    const html = renderToStaticMarkup(<WidgetDispatcher widget={{ ...action, status: 'expired' }} sessionId="s" onRespond={async () => {}} />);
    expect(html).toContain('Expired'); expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});

describe('widget API and SSE transports', () => {
  it('posts encoded IDs, JSON selection and the configured bearer header', async () => {
    const fetcher = vi.fn(async () => new Response('{"success":true}'));
    const api = createApiClient({ fetch: fetcher, token: () => 'ab'.repeat(24) });
    await expect(api.respondWidget('s /', 'w /', 'yes')).resolves.toEqual({ success: true });
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('/api/session/s%20%2F/widget/w%20%2F/respond');
    expect(call[1].method).toBe('POST'); expect(call[1].body).toBe('{"selectedOptionId":"yes"}');
    expect(call[1].headers).toMatchObject({ Authorization: `Bearer ${'ab'.repeat(24)}` });
  });
  it('subscribes native named events, validates frames and ignores callbacks after close', () => {
    const listeners = new Map<string, (event: MessageEvent) => void>(); let native!: { onmessage: ((event: MessageEvent) => void) | null; close: ReturnType<typeof vi.fn> };
    vi.stubGlobal('EventSource', class {
      onmessage = null; onopen = null; close = vi.fn();
      constructor() { native = this; }
      addEventListener(name: string, listener: (event: MessageEvent) => void) { listeners.set(name, listener); }
    });
    const onWidget = vi.fn(); const onWidgetResponse = vi.fn(); const onError = vi.fn();
    const stream = createEventStream('/events', { onWidget, onWidgetResponse, onError });
    for (const type of ['widget', 'widget_block', 'action_request']) listeners.get(type)!(new MessageEvent(type, { data: JSON.stringify({ type, delta: action }) }));
    expect(onWidget).toHaveBeenCalledTimes(3);
    listeners.get('action_response')!(new MessageEvent('action_response', { data: JSON.stringify({ type: 'action_response', delta: { widgetId: 'w', selectedOptionId: 'yes', resolvedAt: base.timestamp } }) }));
    expect(onWidgetResponse).toHaveBeenCalledOnce();
    native.onmessage!(new MessageEvent('message', { data: JSON.stringify({ type: 'widget_block', delta: {} }) })); expect(onError).toHaveBeenCalledOnce();
    stream.close(); native.onmessage!(new MessageEvent('message', { data: JSON.stringify({ type: 'widget_block', delta: action }) }));
    expect(onWidget).toHaveBeenCalledTimes(3); expect(native.close).toHaveBeenCalledOnce();
  });
  it('dispatches canonical named widget envelopes over a fragmented Bearer stream', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    const widgets: WidgetBlock[] = []; const onWidgetResponse = vi.fn();
    const stream = createEventStream('/events', { onWidget: widget => widgets.push(widget), onWidgetResponse }, { token: 'ab'.repeat(24), fetch: async () => new Response(body) });
    const data = new TextEncoder().encode(`event: action_request\ndata: ${JSON.stringify({ type: 'action_request', delta: action })}\n\nevent: action_response\ndata: ${JSON.stringify({ type: 'action_response', delta: { widgetId: 'w', selectedOptionId: 'yes', resolvedAt: base.timestamp } })}\n\n`);
    for (let i = 0; i < data.length; i += 7) controller.enqueue(data.slice(i, i + 7));
    await vi.waitFor(() => expect(widgets).toEqual([action])); await vi.waitFor(() => expect(onWidgetResponse).toHaveBeenCalledOnce()); stream.close();
  });
});

function renderToStaticMarkup(node: I18nTestNode): string {
  return renderMarkup(<LanguageProvider>{node}</LanguageProvider>).replace(/\s+/g, ' ');
}

vi.mock('../../i18n', async original => ({ ...await original<typeof import('../../i18n')>(), getInitialLang: () => 'en' as const }));
