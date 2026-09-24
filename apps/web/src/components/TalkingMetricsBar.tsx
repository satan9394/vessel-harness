import { useI18n } from './LanguageProvider';

export interface TalkingMetrics {
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

  const tokenValue = (value: number | undefined) => value === undefined ? '—' : `${value.toLocaleString()} tok`;
  const values: Array<[string, string]> = [
    [t('metricPrompt'), tokenValue(metrics.inputTokens)],
    [t('metricCompletion'), tokenValue(metrics.outputTokens)],
    [t('metricThinking'), tokenValue(metrics.reasoningTokens)],
    [t('metricCacheRead'), tokenValue(metrics.cacheReadTokens)],
  ];
  if (metrics.latencyMs !== undefined) values.push([t('metricLatency'), `${Math.round(metrics.latencyMs)}ms`]);
  if (metrics.costUsd !== undefined) {
    values.push([t('metricCost'), `${metrics.estimated === false ? '' : '~'}$${metrics.costUsd.toFixed(4)}`]);
  }
  return (
    <dl className="talking-metrics" aria-label="Turn metrics">
      {values.map(([label, value]) => (
        <div className="talking-metric" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
