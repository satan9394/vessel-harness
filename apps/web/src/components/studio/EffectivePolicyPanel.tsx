import { useEffect, useState } from 'react';
import type { EffectivePolicyInspection, PolicySource } from '@vessel/shared';
import { ApiError, type ApiClient } from '../../api';
import { useI18n } from '../LanguageProvider';
import '../card222.css';

const SOURCE_KEYS = { system: 'policySourceSystem', project: 'policySourceProject', session: 'policySourceSession', plugin: 'policySourcePlugin' } as const;
const PROFILE_KEYS = { 'read-only': 'permissionReadOnly', 'workspace-write': 'permissionWorkspaceWrite', 'danger-full-access': 'permissionDangerFull' } as const;

export function readEffectivePolicy(api: Pick<ApiClient, 'effectivePolicy'>, sessionId: string, receive: (policy: EffectivePolicyInspection) => void, fail: (error: unknown) => void) {
  let active = true;
  const ready = api.effectivePolicy(sessionId).then(result => { if (active && result.sessionId === sessionId) receive(result.policy); }, error => { if (active) fail(error); });
  return { ready, close: () => { active = false; } };
}

export function EffectivePolicyView({ policy }: { policy: EffectivePolicyInspection }) {
  const { t } = useI18n();
  const list = (items: string[]) => items.length ? <ul>{items.map(item => <li key={item}><code>{item}</code></li>)}</ul> : <span className="dim">{t('policyNone')}</span>;
  return <div className="effective-policy-view">
    <p>{t('policyRuntimeBoundary')}</p>
    <dl><dt>{t('policyProfile')}</dt><dd>{t(PROFILE_KEYS[policy.profile])}</dd>
      <dt>{t('policyApproval')}</dt><dd><code>{policy.approval}</code></dd>
      <dt>{t('policySnapshot')}</dt><dd><code>{policy.snapshotHash}</code></dd></dl>
    <h4>{t('policySources')}</h4>
    {policy.sources.length ? <ul>{policy.sources.map((source: PolicySource, index) => <li key={`${source.kind}:${index}`}>
      <strong>{t(SOURCE_KEYS[source.kind])}</strong> · <code>{source.ref}</code>
      {source.hash && <p><code>{source.hash}</code></p>}
      {source.overrides && <p>{t('policySessionOverrides')}: <code>{JSON.stringify(source.overrides)}</code></p>}
      {source.ruleIds && list(source.ruleIds)}
    </li>)}</ul> : <p role="status">{t('policySourcesUnknown')}</p>}
    <h4>{t('policyEnforced')}</h4>
    <p>{t('policyHardBoundary')}</p>
    <details><summary>{t('policyRuntimeRules')} ({policy.rules.length})</summary>
      <ul>{policy.rules.map(rule => <li key={rule.id}><code>{rule.id}</code> · {rule.domain} · <strong>{rule.action}</strong>{rule.reason && <p>{rule.reason}</p>}</li>)}</ul>
    </details>
    <details><summary>{t('policyDeniedTools')} ({policy.deniedTools.length})</summary>{list(policy.deniedTools)}</details>
    {policy.filesystem && <details><summary>{t('policyFilesystem')}</summary>
      <dl><dt>{t('policyProtectedPaths')}</dt><dd>{list(policy.filesystem.protected)}</dd>
        <dt>{t('policyDeniedReads')}</dt><dd>{list(policy.filesystem.denyRead)}</dd>
        <dt>{t('policyConfinement')}</dt><dd>{t(policy.filesystem.confinement ? 'policyEnabled' : 'policyDisabled')}</dd>
        <dt>{t('policyAllowedPaths')}</dt><dd>{list((policy.filesystem.allow ?? []).map(item => `${item.mode}: ${item.path}`))}</dd></dl>
    </details>}
    <details><summary>{t('policyShellReadonly')}</summary>{list(policy.shellAllow)}</details>
    <h4>{t('policyAdvisory')}</h4><p>{t('policyGuidanceCount', { count: String(policy.advisoryGuidanceCount) })}</p>
    <h4>{t('policyUnenforced')}</h4>
    {policy.declarationOnly.length ? <ul className="policy-unenforced">{policy.declarationOnly.map(item => <li key={item.id}>
      <strong>{t('policyNotEnforced')}</strong> · <code>{item.id}</code><p>{item.reason}</p>
    </li>)}</ul> : <p>{t('policyNone')}</p>}
  </div>;
}

export function PolicyReadFailure({ error }: { error: unknown }) {
  const { t } = useI18n();
  const unavailable = error instanceof ApiError && (error.status === 404 || error.status === 409);
  return <p role="alert">{t(unavailable ? 'policyUnavailable' : 'policyReadFailed')} <code>{error instanceof Error ? error.message : String(error)}</code></p>;
}

export default function EffectivePolicyPanel({ api, selectedSessionId }: { api: Pick<ApiClient, 'effectivePolicy'>; selectedSessionId: string | null }) {
  const { t } = useI18n();
  const [result, setResult] = useState<{ sessionId: string; policy?: EffectivePolicyInspection; error?: unknown } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setResult(null);
    if (!selectedSessionId) return;
    const read = readEffectivePolicy(api, selectedSessionId, policy => setResult({ sessionId: selectedSessionId, policy }), error => setResult({ sessionId: selectedSessionId, error }));
    return read.close;
  }, [api, selectedSessionId, revision]);
  const current = result?.sessionId === selectedSessionId ? result : null;
  return <section className="dashboard-panel effective-policy-panel" aria-label={t('policyEffectiveTitle')} aria-busy={!!selectedSessionId && !current}>
    <h3>{t('policyEffectiveTitle')}</h3><p>{t('policyReadOnlyHint')}</p>
    <button type="button" className="btn" disabled={!selectedSessionId || !current} onClick={() => setRevision(value => value + 1)}>{t('uiRefresh')}</button>
    {!selectedSessionId ? <p>{t('policySelectSession')}</p> : !current ? <p role="status">{t('loading')}</p>
      : current.policy ? <EffectivePolicyView policy={current.policy} /> : <PolicyReadFailure error={current.error} />}
  </section>;
}
