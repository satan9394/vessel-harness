import { useI18n } from './LanguageProvider';

export interface TalkingMetrics {
  cacheMetrics?: import('../cacheUsage').CacheUsageMetrics;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  latencyMs?: number;
  costUsd?: number;
  estimated?: boolean;
}

export default function TalkingMetricsBar({ metrics }: { metrics: TalkingMetrics }) {
  const { t } = useI18n();
  const known = [
    metrics.inputTokens,
    metrics.outputTokens,
    metrics.reasoningTokens,
    metrics.cacheReadTokens,
    metrics.latencyMs,
    metrics.costUsd,
  ].some((value) => value !== undefined);
  if (!known) return null;

  const tokenValue = (value: number | undefined) => value === undefined ? '—' : `${value.toLocaleString()} ${t('tokenUnit')}`;
  const values: Array<[string, string]> = [
    [t('metricPrompt'), tokenValue(metrics.inputTokens)],
    [t('metricCompletion'), tokenValue(metrics.outputTokens)],
    [t('metricThinking'), tokenValue(metrics.reasoningTokens)],
    [t('metricCacheRead'), tokenValue(metrics.cacheReadTokens)],
  ];
  if (metrics.latencyMs !== undefined) values.push([t('metricLatency'), t('timeMilliseconds', { value: String(Math.round(metrics.latencyMs)) })]);
  if (metrics.costUsd !== undefined) {
    values.push([t('metricCost'), `${metrics.estimated === false ? '' : '~'}$${metrics.costUsd.toFixed(4)}`]);
  }
  return (
    <dl className="talking-metrics" aria-label={t('uiTurnMetrics')}>
      {metrics.cacheMetrics && <div className="talking-metric" style={{ color: 'var(--green)' }}><dt>{t('uiCache')}</dt><dd>
        {Math.round(metrics.cacheMetrics.billedHitRate * 100)}% · {metrics.cacheMetrics.estimated ? t('uiEstimated') : ''}{t('uiReadSavings')}{metrics.cacheMetrics.estimatedSavingsUsd.toFixed(4)}
      </dd></div>}
      {values.map(([label, value]) => (
        <div className="talking-metric" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
