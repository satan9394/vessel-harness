import type { ToolDelta } from '../sse';

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

function statusLabel(status: ToolDelta['status']): string {
  switch (status) {
    case 'started':
      return 'started';
    case 'done':
      return 'done';
    case 'denied':
      return 'denied';
    case 'error':
      return 'error';
    default:
      return status;
  }
}

/** One tool dispatch row: name + status dot + optional duration & args. */
export default function ToolActivityRow({ delta }: { delta: ToolDelta }) {
  const name = delta.toolName ?? '(tool)';
  return (
    <div className={`tool-row tool-${statusClass(delta.status)}`}>
      <span className={`dot ${statusClass(delta.status)}`} aria-hidden="true" />
      <span className="tool-name">{name}</span>
      <span className="tool-status">{statusLabel(delta.status)}</span>
      {typeof delta.durationMs === 'number' && (
        <span className="tool-dur">{delta.durationMs}ms</span>
      )}
      {delta.argsSummary && <span className="tool-args" title={delta.argsSummary}>{delta.argsSummary}</span>}
    </div>
  );
}