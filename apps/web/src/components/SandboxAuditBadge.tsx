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
  const privilege = audit.isolationTier === 'windows-job-restricted'
    ? 'Restricted token, Low Integrity, and Job Object confinement.'
    : audit.isolationTier === 'bwrap-ns'
      ? 'Bubblewrap namespace confinement.'
      : audit.isolationTier === 'lowIntegrity'
        ? 'Low Integrity token; full native isolation is not reported.'
        : audit.isolationTier === 'macos-seatbelt'
          ? 'macOS Seatbelt profile confinement.'
          : 'No native privilege reduction reported.';
  return <dl className="sandbox-audit-details">
    <dt>Execution outcome</dt><dd>{audit.outcome}</dd>
    <dt>Isolation tier</dt><dd>{audit.isolationTier}</dd>
    <dt>Read-only path whitelist</dt><dd>{audit.constraints === undefined ? 'Not recorded by the execution audit.'
      : audit.constraints.readOnlyPaths.length === 0 ? 'No explicit read-only roots; host permissions apply.'
        : <ul>{audit.constraints.readOnlyPaths.map(path => <li key={path}><code>{path}</code></li>)}</ul>}</dd>
    <dt>Write path whitelist</dt><dd>{audit.allowedWritePaths === undefined
      ? 'Not recorded by the execution audit.'
      : audit.allowedWritePaths.length === 0 ? 'No write paths allowed.'
        : <ul>{audit.allowedWritePaths.map(path => <li key={path}><code>{path}</code></li>)}</ul>}</dd>
    <dt>Memory limit</dt><dd>{audit.constraints === undefined ? 'Not recorded by the execution audit.'
      : audit.constraints.memoryLimitBytes === null ? 'No native memory cap configured.' : `${audit.constraints.memoryLimitBytes.toLocaleString()} bytes`}</dd>
    <dt>Privilege reduction</dt><dd>{audit.sandboxed && audit.outcome === 'enforced' ? audit.constraints?.privilegeReduction ?? privilege : 'Not enforced for this execution.'}</dd>
    {audit.reason && <><dt>Reason</dt><dd>{audit.reason}</dd></>}
  </dl>;
}

export function SandboxAuditBadge({ audit }: { audit: SandboxAudit }) {
  const id = useId();
  const root = useRef<HTMLDetailsElement>(null);
  return <details ref={root} className={`sandbox-audit sandbox-${sandboxAuditColor(audit)}`}
    onKeyDown={event => { if (event.key === 'Escape' && root.current) { root.current.open = false; root.current.querySelector('summary')?.focus(); } }}>
    <summary aria-controls={id}>Sandbox: {audit.sandboxed && audit.outcome === 'enforced' ? audit.isolationTier : audit.outcome}</summary>
    <aside id={id} className="sandbox-audit-drawer" aria-label="Sandbox security constraints">
      <button type="button" className="btn" onClick={() => { if (root.current) { root.current.open = false; root.current.querySelector('summary')?.focus(); } }}>Close sandbox details</button>
      <SandboxAuditDetails audit={audit} />
    </aside>
  </details>;
}

export default SandboxAuditBadge;
