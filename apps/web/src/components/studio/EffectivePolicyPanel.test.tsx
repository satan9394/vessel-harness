import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EffectivePolicyInspection } from '@vessel/shared';
import { ApiError, createApiClient } from '../../api';
import { translate, type Lang } from '../../i18n';
import EffectivePolicyPanel, { EffectivePolicyView, PolicyReadFailure, readEffectivePolicy } from './EffectivePolicyPanel';

let lang: Lang = 'en';
vi.mock('../LanguageProvider', () => ({ useI18n: () => ({ lang, t: translate(lang) }) }));
const policy: EffectivePolicyInspection = {
  readOnly: true, snapshotHash: 'bound-hash', profile: 'read-only', approval: 'never',
  sources: [{ kind: 'system', ref: 'system-policy.yaml', hash: 'source-hash' },
    { kind: 'session', ref: 'session overrides', overrides: { profile: 'read-only' } },
    { kind: 'plugin', ref: 'plugin-path', ruleIds: ['plugin-deny'] }],
  rules: [{ id: 'deny-write', domain: 'filesystem', action: 'deny', reason: '<script>blocked</script>' }],
  deniedTools: ['Write'], filesystem: { protected: ['.env'], denyRead: ['credentials'], confinement: true, allow: [] },
  shellAllow: ['git status'], advisoryGuidanceCount: 2,
  declarationOnly: [{ id: 'net-deny:example', domain: 'network', enforced: false, reason: 'proxy enforcement unavailable' }],
};

describe('current effective Policy panel', () => {
  it.each(['en', 'zh'] as const)('distinguishes hard rules, advisory guidance and unenforced declarations (%s)', locale => {
    lang = locale;
    const html = renderToStaticMarkup(<EffectivePolicyView policy={policy} />);
    const t = translate(locale);
    for (const text of [t('policyEnforced'), t('policyAdvisory'), t('policyNotEnforced'), t('policySources'), t('policyRuntimeBoundary'),
      'system-policy.yaml', 'source-hash', 'session overrides', 'plugin-path', 'plugin-deny', 'bound-hash', 'deny-write', '.env', 'proxy enforcement unavailable']) expect(html).toContain(text);
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
    expect(html).not.toContain('<button'); expect(html).not.toContain('<input'); expect(html).not.toContain('<select');
    expect(html).toContain('<details><summary>'); expect(html).not.toContain('<details open');
  });

  it('does not infer absent provenance or fabricate a successful policy on read failure', () => {
    lang = 'en';
    expect(renderToStaticMarkup(<EffectivePolicyView policy={{ ...policy, sources: [] }} />)).toContain('source files cannot be inferred');
    const unavailable = renderToStaticMarkup(<PolicyReadFailure error={new ApiError('session_restore_failed', 409, {})} />);
    expect(unavailable).toContain('role="alert"'); expect(unavailable).toContain('session_restore_failed'); expect(unavailable).toContain('Reopen the session');
    expect(renderToStaticMarkup(<PolicyReadFailure error={new Error('offline')} />)).toContain('Refresh to retry');
  });

  it('requires a selected session and provides accessible loading with a disabled refresh', () => {
    lang = 'en'; const api = { effectivePolicy: vi.fn() };
    expect(renderToStaticMarkup(<EffectivePolicyPanel api={api} selectedSessionId={null} />)).toContain('Select an existing session');
    const html = renderToStaticMarkup(<EffectivePolicyPanel api={api} selectedSessionId="s1" />);
    expect(html).toContain('aria-busy="true"'); expect(html).toContain('role="status"'); expect(html).toContain('disabled=""');
    expect(api.effectivePolicy).not.toHaveBeenCalled();
  });

  it('encodes the selected session and uses a read-only API request', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    await createApiClient({ fetch: fetcher }).effectivePolicy('s / 1');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/sessions/s%20%2F%201/policy');
    expect(fetcher.mock.calls[0]![1]?.method ?? 'GET').toBe('GET');
  });

  it('drops late reads and errors after switching session while allowing the new snapshot', async () => {
    let finish!: (value: { sessionId: string; policy: EffectivePolicyInspection }) => void;
    let reject!: (error: Error) => void;
    const api = { effectivePolicy: vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValueOnce({ sessionId: 'new', policy }) };
    const receive = vi.fn(), fail = vi.fn();
    const old = readEffectivePolicy(api, 'old', receive, fail); old.close();
    finish({ sessionId: 'old', policy }); await old.ready;
    const error = readEffectivePolicy(api, 'error', receive, fail); error.close(); reject(new Error('late')); await error.ready;
    expect(receive).not.toHaveBeenCalled(); expect(fail).not.toHaveBeenCalled();
    await readEffectivePolicy(api, 'new', receive, fail).ready;
    expect(receive).toHaveBeenCalledExactlyOnceWith(policy);
  });
});
