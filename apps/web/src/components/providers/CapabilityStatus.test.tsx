import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProviderCapabilities } from '@vessel/shared';
import { translate } from '../../i18n';
import CapabilityStatus from './CapabilityStatus';

const locale = vi.hoisted(() => ({ lang: 'en' as 'en' | 'zh' }));
vi.mock('../LanguageProvider', () => ({ useI18n: () => ({ t: translate(locale.lang) }) }));

describe('Backend capability evidence', () => {
  it.each(['en', 'zh'] as const)('labels expired model metadata without presenting it as fresh support in %s', lang => {
    locale.lang = lang;
    const capabilities = { tools: { status: 'declared', value: true, evidence: { observedAt: 1, expiresAt: 2, origin: 'provider_metadata' } } } as ProviderCapabilities;
    expect(renderToStaticMarkup(<CapabilityStatus capabilities={capabilities} />)).toContain(translate(lang)('capabilityExpired'));
  });
  it.each(['en', 'zh'] as const)('distinguishes declared false, detected zero and unknown in %s', lang => {
    locale.lang = lang;
    const capabilities = { tools: { status: 'declared', value: false, source: '<metadata>' }, contextWindow: { status: 'detected', value: 0 }, reasoning: { status: 'unknown' } } as ProviderCapabilities;
    const html = renderToStaticMarkup(<CapabilityStatus capabilities={capabilities} />);
    for (const key of ['capabilityDeclared', 'capabilityUnsupported', 'capabilityDetected', 'capabilityUnknown', 'capabilityTokenUsage'] as const) expect(html).toContain(translate(lang)(key));
    expect(html).toContain(' · 0'); expect(html).toContain('&lt;metadata&gt;');
    const empty = renderToStaticMarkup(<CapabilityStatus />);
    expect(empty.match(new RegExp(translate(lang)('capabilityUnknown'), 'g'))).toHaveLength(8);
    expect(empty).not.toContain(translate(lang)('capabilitySupported'));
  });
});
