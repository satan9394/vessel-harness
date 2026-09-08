import type { Health } from '../api';
import { useI18n } from './LanguageProvider';

export interface ServerStatusProps {
  health: Health | null;
  /** set when the last health fetch or any request failed (server down). */
  error: boolean;
}

/** Main-area server status row: green ok / red down, with the version. */
export default function StatusBar({ health, error }: ServerStatusProps) {
  const { t } = useI18n();
  const isOk = !error && !!health?.ok;
  return (
    <div className="statusbar">
      <span className={`dot ${isOk ? 'dot-ok' : 'dot-err'}`} aria-hidden="true" />
      <span className={`status-text ${isOk ? '' : 'status-err'}`}>
        {isOk
          ? t('statusOk', { version: health?.version ?? '' })
          : t('statusDown')}
      </span>
    </div>
  );
}