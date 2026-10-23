import { localizedValue } from '../i18n';
import { useI18n } from './LanguageProvider';
import type { ToolDelta } from '../sse';
import SandboxAuditBadge from './SandboxAuditBadge';

/** Color semantics per docs/UI-THEME.md: green=ok, yellow=warn, red=danger. */
function statusTone(status: ToolDelta['status']): 'running' | 'ok' | 'danger' {
  switch (status) {
    case 'started':
      return 'running';
    case 'done':
      return 'ok';
    case 'denied':
    case 'error':
      return 'danger';
  }
}

/** One tool dispatch row: name + status dot + optional duration & args. */
export default function ToolActivityRow({ delta }: { delta: ToolDelta }) {
  const { t } = useI18n();
  const name = delta.toolName ?? t('noTool');
  const status = localizedValue(delta.status, t);
  const tone = statusTone(delta.status);
  return (
    <div className={`tool-row tool-row--${tone}`} data-status={delta.status} data-tone={tone}
      role="group" aria-label={`${name} · ${status}`}>
      <span className="tool-rail" aria-hidden="true"><span className="tool-dot" /></span>
      <div className="tool-main">
        <div className="tool-head">
          <span className="tool-name">{name}</span>
          <span className="tool-status">{status}</span>
          {typeof delta.durationMs === 'number' && (
            <span className="tool-dur">{delta.durationMs >= 1000
              ? t('timeSeconds', { value: (delta.durationMs / 1000).toFixed(1) })
              : t('timeMilliseconds', { value: String(delta.durationMs) })}</span>
          )}
        </div>
        {delta.argsSummary && <details className="tool-details"><summary>{t('toolDetails')}</summary><div className="tool-args" title={delta.argsSummary}>{delta.argsSummary}</div></details>}
        {(delta.status === 'error' || delta.status === 'denied') && delta.errorDetail && <p role="alert" className="tool-error">{delta.errorDetail}</p>}
      </div>
      {delta.sandbox && <div className="tool-badge"><SandboxAuditBadge audit={delta.sandbox} /></div>}
    </div>
  );
}
