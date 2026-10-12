import type { ReactNode as I18nTestNode } from 'react';
import { describe, expect, it , vi } from 'vitest';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import UsageBar, { applyUsageDelta, emptyUsage, usageCallCost } from '../UsageBar';
import TalkingMetricsBar from '../TalkingMetricsBar';
import { LanguageProvider } from '../LanguageProvider';
describe('server priced cache badges', () => {
  const summary = { promptTokensTotal: 1000, cachedTokensTotal: 920, overallCacheHitRate: 0.92, estimatedSavingsUsd: 0.1234, costUsd: 0.9876, estimated: false };
  it('renders the server hit rate, savings and cost', () => {
    const usage = applyUsageDelta(emptyUsage(), { inputTokens: 1000, calls: 1, summary });
    const html = renderToStaticMarkup(<UsageBar usage={usage} />);
    expect(html).toContain('Cache 92%'); expect(html).toContain('0.1234'); expect(html).toContain('0.9876');
  });
  it('labels fallback estimates and replaces cumulative totals', () => {
    let usage = applyUsageDelta(emptyUsage(), { calls: 1, summary });
    usage = applyUsageDelta(usage, { calls: 2, summary: { ...summary, estimated: true } });
    expect(usage.estimatedSavingsUsd).toBe(0.1234);
    expect(renderToStaticMarkup(<UsageBar usage={usage} />)).toContain('estimated read savings');
  });
  it('does not show a false zero percent badge when cache metrics were not reported', () => {
    const usage = applyUsageDelta(emptyUsage(), { calls: 1, summary: { ...summary, measuredCalls: 0, overallCacheHitRate: 0 } });
    expect(renderToStaticMarkup(<UsageBar usage={usage} />)).not.toContain('Cache 0%');
  });
  it('shows per-message server-priced cache metadata', () => {
    const html = renderToStaticMarkup(<LanguageProvider><TalkingMetricsBar metrics={{ inputTokens: 1000, cacheMetrics: { promptTokens: 1000, cachedTokens: 920, creationTokens: 0, billedHitRate: 0.92, estimatedSavingsUsd: 0.1234, provider: 'p', model: 'm', estimated: true } }} /></LanguageProvider>);
    expect(html).toContain('92%'); expect(html).toContain('estimated read savings'); expect(html).toContain('0.1234');
  });
  it('keeps a reselected session header cumulative while the next turn cost is incremental', () => {
    const delta = { calls: 2, costUsd: 0.10, summary: { ...summary, costUsd: 1.10 } };
    const reselected = applyUsageDelta(emptyUsage(), delta);
    expect(reselected.costUsd).toBe(1.10);
    expect(usageCallCost(delta)).toBe(0.10);
    const afterLongerHistory = { ...delta, summary: { ...summary, costUsd: 51.10 } };
    expect(usageCallCost(afterLongerHistory)).toBe(0.10);
  });
});

function renderToStaticMarkup(node: I18nTestNode): string {
  return renderMarkup(<LanguageProvider>{node}</LanguageProvider>).replace(/\s+/g, ' ');
}

vi.mock('../../i18n', async original => ({ ...await original<typeof import('../../i18n')>(), getInitialLang: () => 'en' as const }));
