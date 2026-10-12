import { localizedValue } from '../i18n';
import { useI18n } from './LanguageProvider';
import { useId, useRef } from 'react';
import type { SandboxAudit } from '../sandboxAudit';
import './sandboxAudit.css';

export function sandboxAuditColor(audit: SandboxAudit): 'green' | 'yellow' | 'gray' {
  if (!audit.sandboxed || audit.outcome !== 'enforced') return 'gray';
  if (audit.isolationTier === 'windows-job-restricted' || audit.isolationTier === 'bwrap-ns') return 'green';
  if (audit.isolationTier === 'lowIntegrity' || audit.isolationTier === 'macos-seatbelt') return 'yellow';
  return 'gray';
}

export function SandboxAuditDetails({ audit }: { audit: SandboxAudit }) {
  const { t } = useI18n();
  const privilege = audit.isolationTier === 'windows-job-restricted'
    ? t('privilegeWindows')
    : audit.isolationTier === 'bwrap-ns'
      ? t('privilegeBwrap')
      : audit.isolationTier === 'lowIntegrity'
        ? t('privilegeLow')
        : audit.isolationTier === 'macos-seatbelt'
          ? t('privilegeMac')
          : t('privilegeNone');
  return <dl className="sandbox-audit-details">
    <dt>{t('uiExecutionOutcome')}</dt><dd>{localizedValue(audit.outcome, t)}</dd>
    <dt>{t('uiIsolationTier')}</dt><dd>{localizedValue(audit.isolationTier, t)}</dd>
    <dt>{t('uiReadOnlyPathWhitelist')}</dt><dd>{audit.constraints === undefined ? t('uiNotRecordedByTheExecutionAudit')
      : audit.constraints.readOnlyPaths.length === 0 ? t('uiNoExplicitReadOnlyRootsHostPermissionsApply')
        : <ul>{audit.constraints.readOnlyPaths.map(path => <li key={path}><code>{path}</code></li>)}</ul>}</dd>
    <dt>{t('uiWritePathWhitelist')}</dt><dd>{audit.allowedWritePaths === undefined
      ? t('uiNotRecordedByTheExecutionAudit')
      : audit.allowedWritePaths.length === 0 ? t('uiNoWritePathsAllowed')
        : <ul>{audit.allowedWritePaths.map(path => <li key={path}><code>{path}</code></li>)}</ul>}</dd>
    <dt>{t('uiMemoryLimit')}</dt><dd>{audit.constraints === undefined ? t('uiNotRecordedByTheExecutionAudit')
      : audit.constraints.memoryLimitBytes === null ? t('uiNoNativeMemoryCapConfigured') : t('byteCount', { count: audit.constraints.memoryLimitBytes.toLocaleString() })}</dd>
    <dt>{t('uiPrivilegeReduction')}</dt><dd>{audit.sandboxed && audit.outcome === 'enforced' ? audit.constraints?.privilegeReduction ?? privilege : t('uiNotEnforcedForThisExecution')}</dd>
    {audit.reason && <><dt>{t('uiReason')}</dt><dd>{audit.reason}</dd></>}
  </dl>;
}

export function SandboxAuditBadge({ audit }: { audit: SandboxAudit }) {
  const { t } = useI18n();
  const id = useId();
  const root = useRef<HTMLDetailsElement>(null);
  return <details ref={root} className={`sandbox-audit sandbox-${sandboxAuditColor(audit)}`}
    onKeyDown={event => { if (event.key === 'Escape' && root.current) { root.current.open = false; root.current.querySelector('summary')?.focus(); } }}>
    <summary aria-controls={id}>{t('uiSandbox')} {audit.sandboxed && audit.outcome === 'enforced' ? localizedValue(audit.isolationTier, t) : localizedValue(audit.outcome, t)}</summary>
    <aside id={id} className="sandbox-audit-drawer" aria-label={t('uiSandboxSecurityConstraints')}>
      <button type="button" className="btn" onClick={() => { if (root.current) { root.current.open = false; root.current.querySelector('summary')?.focus(); } }}>{t('uiCloseSandboxDetails')}</button>
      <SandboxAuditDetails audit={audit} />
    </aside>
  </details>;
}

export default SandboxAuditBadge;
