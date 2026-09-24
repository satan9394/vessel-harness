import { useI18n } from './LanguageProvider';

export interface ThinkingBlockProps {
  text: string;
  durationMs?: number;
  streaming?: boolean;
}

function formatDuration(durationMs: number): string {
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.round(durationMs)}ms`;
}

/** Native details/summary provides keyboard-accessible collapse without UI state churn. */
export default function ThinkingBlock({ text, durationMs, streaming = false }: ThinkingBlockProps) {
  const { t } = useI18n();
  if (!text && !streaming) return null;
  const label = streaming || durationMs === undefined ? t('thinking') : t('thinkingFor', { duration: formatDuration(durationMs) });
  return (
    <details className="thinking-block">
      <summary aria-label={label}>
        <span className={streaming ? 'thinking-dot' : 'thinking-mark'} aria-hidden="true" />
        {label}
      </summary>
      {text && <pre className="thinking-content">{text}</pre>}
    </details>
  );
}
