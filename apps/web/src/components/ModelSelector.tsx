import { ROUTE_MODES, ROUTE_MODE_LABELS, type RouteMode } from '../team';

/**
 * Model selection control (task 060, docs §10): Auto / Fast / Pro with the
 * resolved actual model shown as 「Auto → <model>」and a Pin for this session
 * toggle. Presentational — state + actions are lifted into TeamModule.
 */
export interface ModelSelectorProps {
  mode: RouteMode;
  /** resolved display label (e.g. "Auto → mock-pro"); null until resolved */
  label: string | null;
  pinned: boolean;
  busy?: boolean;
  onSelect: (mode: RouteMode) => void;
  onResolve: () => void;
  onPin: () => void;
  onUnpin: () => void;
}

export default function ModelSelector({
  mode,
  label,
  pinned,
  busy = false,
  onSelect,
  onResolve,
  onPin,
  onUnpin,
}: ModelSelectorProps) {
  return (
    <div className="model-selector" aria-label="model mode">
      <div className="model-modes" role="group" aria-label="model mode">
        {ROUTE_MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={`mode-btn${mode === m ? ' mode-btn-active' : ''}`}
            aria-pressed={mode === m}
            disabled={busy}
            onClick={() => onSelect(m)}
          >
            {ROUTE_MODE_LABELS[m]}
          </button>
        ))}
      </div>
      <span className={`model-resolved${label ? '' : ' dim'}`} title="resolved actual model">
        {label ?? '—'}
      </span>
      <div className="model-actions">
        <button type="button" className="btn" disabled={busy} onClick={onResolve} title="resolve the actual model for this mode">
          Resolve
        </button>
        {pinned ? (
          <button
            type="button"
            className="btn model-pin-on"
            disabled={busy}
            onClick={onUnpin}
            title="unpin — the next auto resolution re-judges"
          >
            Pinned · Unpin
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={onPin}
            title="pin this resolution for the session (no automatic re-judge)"
          >
            Pin for this session
          </button>
        )}
      </div>
    </div>
  );
}
