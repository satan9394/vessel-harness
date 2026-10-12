import type { ReactNode as I18nTestNode } from 'react';
import { LanguageProvider } from '../LanguageProvider';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import SandboxAuditBadge, { sandboxAuditColor, SandboxAuditDetails } from '../SandboxAuditBadge';
import ToolActivityRow from '../ToolActivityRow';
import SandboxAuditHistory from '../SandboxAuditHistory';
import MessageList from '../MessageList';
import { createApiClient } from '../../api';
import type { SandboxAudit } from '../../sandboxAudit';

const enforced: SandboxAudit = { isolationTier: 'windows-job-restricted', sandboxed: true, outcome: 'enforced', allowedWritePaths: ['C:\\workspace', 'C:\\tmp'] };

describe('sandbox execution audits', () => {
  it('displays recorded readonly roots, enforced memory caps and platform privilege constraints', () => {
    const html = renderToStaticMarkup(<SandboxAuditDetails audit={{ ...enforced, constraints: { readOnlyPaths: ['/'], memoryLimitBytes: 536870912, privilegeReduction: 'Native restricted token audit' } }} />);
    expect(html).toContain('<code>/</code>');
    expect(html).toContain(`${(536870912).toLocaleString()} bytes`);
    expect(html).toContain('Native restricted token audit');
    expect(html).not.toContain('Not recorded');
    const uncapped = renderToStaticMarkup(<SandboxAuditDetails audit={{ ...enforced, constraints: { readOnlyPaths: [], memoryLimitBytes: null, privilegeReduction: 'Native profile' } }} />);
    expect(uncapped).toContain('No native memory cap configured.');
    expect(uncapped).toContain('No explicit read-only roots');
  });
  it('colors actual enforced tiers and never colors a denied native attempt green', () => {
    expect(sandboxAuditColor(enforced)).toBe('green');
    expect(sandboxAuditColor({ ...enforced, isolationTier: 'bwrap-ns' })).toBe('green');
    expect(sandboxAuditColor({ ...enforced, isolationTier: 'lowIntegrity' })).toBe('yellow');
    expect(sandboxAuditColor({ ...enforced, sandboxed: false, outcome: 'denied' })).toBe('gray');
    expect(sandboxAuditColor({ ...enforced, isolationTier: 'passthrough-fallback', sandboxed: false, outcome: 'fallback' })).toBe('gray');
  });
  it('renders keyboard-operable disclosure and truthful constraints', () => {
    const html = renderToStaticMarkup(<SandboxAuditBadge audit={enforced} />);
    expect(html).toContain('<details');
    expect(html).toContain('<summary aria-controls=');
    expect(html).toContain('Sandbox: windows-job-restricted');
    expect(html).toContain('Close sandbox details');
    expect(html).toContain('C:\\workspace');
    expect(html).toContain('Restricted token, Low Integrity, and Job Object');
    expect(html).toContain('Read-only path whitelist');
    expect(html).toContain('Memory limit');
    expect(html.match(/Not recorded by the execution audit/g)).toHaveLength(2);
  });
  it('does not invent whitelist/privilege enforcement on fallback', () => {
    const html = renderToStaticMarkup(<SandboxAuditDetails audit={{ isolationTier: 'passthrough-fallback', sandboxed: false, outcome: 'fallback', reason: 'helper unavailable' }} />);
    expect(html).toContain('helper unavailable');
    expect(html).toContain('Not enforced for this execution.');
    expect(html.match(/Not recorded by the execution audit/g)).toHaveLength(3);
  });
  it('renders the execution badge in cards and the Talking message flow only with audit evidence', () => {
    const delta = { toolName: 'Shell', status: 'done' as const, ts: 1, sandbox: enforced };
    expect(renderToStaticMarkup(<ToolActivityRow delta={delta} />)).toContain('Sandbox: windows-job-restricted');
    expect(renderToStaticMarkup(<MessageList items={[{ id: 'call', kind: 'tool', tool: delta }]} thinking={false} />)).toContain('Sandbox: windows-job-restricted');
    expect(renderToStaticMarkup(<ToolActivityRow delta={{ toolName: 'Read', status: 'done', ts: 1 }} />)).not.toContain('Sandbox:');
    expect(renderToStaticMarkup(<SandboxAuditHistory api={createApiClient()} sessionId="s" revision={0} />)).toContain('Talking sandbox audits');
  });
  it('uses authenticated read-only API requests with encoded session IDs', async () => {
    const fetcher = vi.fn(async () => new Response('{}'));
    const api = createApiClient({ fetch: fetcher, token: () => 'mock-token' });
    await api.meshPeers(); await api.cognitiveRules(); await api.sandboxAudits('s/&');
    expect(fetcher.mock.calls.map(call => String((call as unknown[])[0]))).toEqual(['/api/mesh/peers', '/api/memory/rules', '/api/system/sandbox-tier?sessionId=s%2F%26']);
    for (const call of fetcher.mock.calls) {
      const init = (call as unknown[])[1] as RequestInit;
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer mock-token');
      expect(init.method ?? 'GET').toBe('GET');
    }
  });
});

function renderToStaticMarkup(node: I18nTestNode): string {
  return renderMarkup(<LanguageProvider>{node}</LanguageProvider>).replace(/\s+/g, ' ');
}

vi.mock('../../i18n', async original => ({ ...await original<typeof import('../../i18n')>(), getInitialLang: () => 'en' as const }));
