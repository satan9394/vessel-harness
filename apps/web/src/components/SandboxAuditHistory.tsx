import { useEffect, useState } from 'react';
import type { ApiClient } from '../api';
import type { SandboxAuditSnapshot } from '../sandboxAudit';
import SandboxAuditBadge from './SandboxAuditBadge';

export default function SandboxAuditHistory({ api, sessionId, revision }: { api: ApiClient; sessionId: string; revision: number }) {
  const [snapshot, setSnapshot] = useState<SandboxAuditSnapshot | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setSnapshot(null);
    setError(false);
    void api.sandboxAudits(sessionId).then(value => {
      if (active) setSnapshot(value);
    }, () => { if (active) setError(true); });
    return () => { active = false; };
  }, [api, sessionId, revision]);
  return <details className="sandbox-audit-history">
    <summary>Talking sandbox audits</summary>
    {error ? <p role="alert">Unable to load execution audits.</p>
      : snapshot === null ? <p role="status">Loading execution audits…</p>
        : snapshot.audits.length === 0 ? <p>No sandbox execution audits recorded.</p>
          : <ul>{snapshot.audits.map((entry, index) => <li key={`${entry.ts}-${index}`}>
            <span>{entry.toolName} · {new Date(entry.ts).toLocaleString()} </span>
            <SandboxAuditBadge audit={entry.sandbox} />
          </li>)}</ul>}
  </details>;
}
