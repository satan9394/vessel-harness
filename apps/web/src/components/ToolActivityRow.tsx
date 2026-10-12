import { localizedValue } from '../i18n';
import { useI18n } from './LanguageProvider';
import type { ToolDelta } from '../sse';
import SandboxAuditBadge from './SandboxAuditBadge';

/** Color semantics per docs/UI-THEME.md: green=ok, yellow=warn, red=danger. */
function statusClass(status: ToolDelta['status']): string {
  switch (status) {
    case 'started':
      return 'dot-warn'; // in flight → amber
    case 'done':
      return 'dot-ok'; // green
    case 'denied':
    case 'error':
      return 'dot-err'; // red
    default:
      return 'dot-warn';
  }
}

/** One tool dispatch row: name + status dot + optional duration & args. */
export default function ToolActivityRow({ delta }: { delta: ToolDelta }) {
  const { t } = useI18n();
  const name = delta.toolName ?? t('noTool');
  return (
    <div className={`tool-row tool-${statusClass(delta.status)}`}>
      <span className={`dot ${statusClass(delta.status)}`} aria-hidden="true" />
      <span className="tool-name">{name}</span>
      <span className="tool-status">{localizedValue(delta.status, t)}</span>
      {typeof delta.durationMs === 'number' && (
        <span className="tool-dur">{t('timeMilliseconds', { value: String(delta.durationMs) })}</span>
      )}
      {delta.argsSummary && <span className="tool-args" title={delta.argsSummary}>{delta.argsSummary}</span>}
      {delta.sandbox && <SandboxAuditBadge audit={delta.sandbox} />}
    </div>
  );
}
