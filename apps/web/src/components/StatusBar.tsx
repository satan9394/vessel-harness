import type { Health } from '../api';
import { useI18n } from './LanguageProvider';

export interface ServerStatusProps {
  health: Health | null;
  /** set when the last health fetch or any request failed (server down). */
  error: boolean;
}

/** Main-area server status row: connecting, ok, or down. */
export default function StatusBar({ health, error }: ServerStatusProps) {
  const { t } = useI18n();
  const isOk = !error && !!health?.ok;
  return (
    <div className="statusbar">
      <span className={`dot ${error ? 'dot-err' : isOk ? 'dot-ok' : ''}`} style={!error && !isOk ? { background: 'var(--dim)' } : undefined} aria-hidden="true" />
      <span className={`status-text ${error ? 'status-err' : ''}`}>
        {error ? t('statusDown') : isOk
          ? t('statusOk', { version: health?.version ?? '' })
          : t('statusConnecting')}
      </span>
    </div>
  );
}
