import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { LanguageProvider } from './LanguageProvider';
import type { ReactNode } from 'react';
import { approvalTier, contextOccupancy, formatCount, MetersRow, permissionLabelKey, resolveModelLabel } from './ComposerMeters';
import { emptyUsage, applyUsageDelta } from './UsageBar';
import type { SessionMeta } from '../api';

function render(node: ReactNode): string {
  return renderToStaticMarkup(<LanguageProvider>{node}</LanguageProvider>);
}

describe('P5 composer capsules + meters', () => {
  it('wraps whole metric groups instead of stacking individual label characters', () => {
    const css = readFileSync(new URL('./composerMeters.css', import.meta.url), 'utf8');
    expect(css).toContain('.meters > .meter:not(.meter-keys)');
    expect(css).toMatch(/flex-shrink:\s*0\s*;/);
    expect(css).toMatch(/white-space:\s*nowrap\s*;/);
  });
  it('keeps English key hints visible with wrapping classes and non-shrinking composer CSS', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const shell = css.match(/\.composer-shell\s*\{([^}]+)\}/)![1];
    const hints = css.match(/\.meter-keys\s*\{([^}]+)\}/)![1];
    expect(shell).toMatch(/flex:\s*none\s*;/);
    expect(hints).toMatch(/flex-wrap:\s*wrap\s*;/);
    expect(hints).toMatch(/min-width:\s*0\s*;/);
    expect(hints).toMatch(/max-width:\s*100%\s*;/);
    vi.stubGlobal('localStorage', { getItem: () => 'en' });
    try {
      const html = render(<MetersRow usage={emptyUsage()} metrics={{}} />);
      expect(html).toContain('meter meter-keys');
      expect(html).toContain('key hints');
      expect(html).toContain('newline');
    } finally { vi.unstubAllGlobals(); }
    // Structural/CSS regression only: neither Node nor jsdom calculates layout geometry.
    // Browser: populated Mock session, Inspector closed, English, 360x900; compare
    // .meter-keys.parentElement and .module-card-goal rectangles (card 277 Result).
  });
  it('maps the session permission to an existing dictionary key (B16 reuse)', () => {
    expect(permissionLabelKey('read-only')).toBe('permissionReadOnly');
    expect(permissionLabelKey('workspace-write')).toBe('permissionWorkspaceWrite');
    expect(permissionLabelKey('danger-full-access')).toBe('permissionDangerFull');
    expect(permissionLabelKey(undefined)).toBeNull();
    expect(permissionLabelKey('weird')).toBeNull();
  });

  it('resolves the approval tier from the session, falling back to the workbench default', () => {
    const session = { id: 's', createdAt: 'now', workspaceRoot: 'E:/repo', permission: 'workspace-write' } as SessionMeta;
    expect(approvalTier(session)).toBe('workspace-write');
    expect(approvalTier(undefined, 'read-only')).toBe('read-only');
    expect(approvalTier(undefined)).toBeUndefined();
  });

  it('computes context occupancy only when a real window is known', () => {
    const usage = applyUsageDelta(emptyUsage(), { inputTokens: 5000, cacheReadTokens: 5000 });
    expect(contextOccupancy(usage, 100000)).toBeCloseTo(0.1, 5);
    expect(contextOccupancy(usage, 8000)).toBe(1); // clamped
    expect(contextOccupancy(usage, undefined)).toBeUndefined();
    expect(contextOccupancy(usage, 0)).toBeUndefined();
  });

  it('formats thousands for the meter row', () => {
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1500)).toBe('1.5k');
  });

  it('renders the four capsules (project/model/approval/mode) and the meters row', () => {
    const usage = applyUsageDelta(emptyUsage(), { inputTokens: 4600, outputTokens: 100, calls: 2 });
    const html = render(<>
      <MetersRow usage={usage} metrics={{ inputTokens: 4600, cacheMetrics: { promptTokens: 4600, cachedTokens: 2800, creationTokens: 0, billedHitRate: 0.61, estimatedSavingsUsd: 0.0124, provider: 'p', model: 'm' } }} contextWindow={10000} plan={{ done: 3, total: 5 }} />
    </>);
    expect(html).toContain('meters');
    expect(html).toContain('cbar');
    expect(html).toMatch(/46%/); // 4600/10000
    expect(html).toMatch(/61%/); // cache hit rate
    expect(html).toMatch(/3\/5/);
  });

  it('shows an em dash instead of a fabricated percentage when the window is unknown', () => {
    const html = render(<MetersRow usage={emptyUsage()} metrics={{}} />);
    expect(html).toContain('meters');
    expect(html).not.toMatch(/\d+%/);
  });

  it('never renders a bare placeholder as the model label', () => {
    // The real bug: `session.model === 'default'` was shown verbatim.
    expect(resolveModelLabel('acme', 'default')).toEqual({ kind: 'named', text: 'acme' });
    expect(resolveModelLabel('acme', 'unknown')).toEqual({ kind: 'named', text: 'acme' });
    expect(resolveModelLabel(undefined, 'default')).toEqual({ kind: 'unknown' });
    expect(resolveModelLabel(undefined, undefined)).toEqual({ kind: 'unknown' });
  });

  it('reads a real session as `provider / model`', () => {
    expect(resolveModelLabel('opencode-go', 'mimo-v2.5')).toEqual({ kind: 'named', text: 'opencode-go / mimo-v2.5' });
    expect(resolveModelLabel(undefined, 'mimo-v2.5')).toEqual({ kind: 'named', text: 'mimo-v2.5' });
  });

  it('routes the offline demo provider to the localized wording', () => {
    expect(resolveModelLabel('mock', 'default')).toEqual({ kind: 'offline' });
    expect(resolveModelLabel('mock', 'anything')).toEqual({ kind: 'offline' });
  });
});
