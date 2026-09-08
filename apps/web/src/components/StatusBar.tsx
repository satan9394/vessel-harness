import type { Health } from '../api';

export interface ServerStatusProps {
  health: Health | null;
  /** set when the last health fetch or any request failed (server down). */
  error: boolean;
}

/** Main-area server status row: green ok / red down, with the version. */
export default function StatusBar({ health, error }: ServerStatusProps) {
  const isOk = !error && !!health?.ok;
  return (
    <div className="statusbar">
      <span className={`dot ${isOk ? 'dot-ok' : 'dot-err'}`} aria-hidden="true" />
      <span className={`status-text ${isOk ? '' : 'status-err'}`}>
        {isOk
          ? `Vessel local server ok (v${health?.version})`
          : 'local server 未连接——请先 vessel serve（127.0.0.1:5678）'}
      </span>
    </div>
  );
}