import { useEffect, useRef, useState } from 'react';
import type { MatchedReasoningRule } from '@vessel/shared';
import { useI18n } from '../LanguageProvider';

export interface StreamingReasoningBlockProps {
  content: string;
  isStreaming: boolean;
  elapsedMs?: number;
  reasoningTokens?: number;
  outputTokens?: number;
  modelDurationMs?: number;
  matchedRules?: MatchedReasoningRule[];
  defaultExpanded?: boolean;
}

/** Timed disclosure; only provider-reported reasoning tokens yield a measured rate. */
export function StreamingReasoningBlock({ content, isStreaming, elapsedMs, reasoningTokens, outputTokens, modelDurationMs, matchedRules = [], defaultExpanded }: StreamingReasoningBlockProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(defaultExpanded ?? isStreaming);
  const [clockMs, setClockMs] = useState(0);
  const started = useRef(Date.now());
  const priorStreaming = useRef(isStreaming);
  useEffect(() => {
    if (isStreaming) {
      started.current = Date.now();
      setClockMs(0);
      if (!priorStreaming.current) setExpanded(true);
      const timer = setInterval(() => setClockMs(Date.now() - started.current), 100);
      priorStreaming.current = true;
      return () => clearInterval(timer);
    }
    if (priorStreaming.current) {
      setClockMs(Date.now() - started.current);
      setExpanded(false);
    }
    priorStreaming.current = false;
  }, [isStreaming]);
  if (!content && !isStreaming) return null;
  const duration = elapsedMs ?? clockMs;
  const time = duration >= 1000 ? t('timeSeconds', { value: (duration / 1000).toFixed(1) }) : t('timeMilliseconds', { value: String(Math.round(duration)) });
  const label = isStreaming ? `${t('thinking')} ${time}` : t('thinkingFor', { duration: time });
  const rate = reasoningTokens !== undefined && duration > 0 ? t('reasoningRate', { rate: (reasoningTokens * 1000 / duration).toFixed(1) }) : outputTokens !== undefined && outputTokens > 0 && modelDurationMs !== undefined && modelDurationMs > 0 ? t('outputRate', { rate: (outputTokens * 1000 / modelDurationMs).toFixed(1) }) : t('tokenRateUnavailable');
  return <section className="streaming-reasoning">
    {matchedRules.length > 0 && <div className="reasoning-rules" aria-label={t('cognitiveRulesHit')}>
      {matchedRules.map(rule => <details className="reasoning-rule" key={rule.id}>
        <summary>{t('uiRule')} {rule.id} · {rule.trigger}</summary>
        <p>{rule.lesson}</p>{rule.recommendedAction && <p>{t('uiReflection')} {rule.recommendedAction}</p>}
        <small>{t('uiHistoricalGuidanceCurrentPolicyTakesPrecedence')}</small>
      </details>)}
    </div>}
    <details className="thinking-block" open={expanded}>
      <summary aria-label={label} onClick={event => { event.preventDefault(); setExpanded(value => !value); }}>
        <span className={isStreaming ? 'thinking-dot' : 'thinking-mark'} aria-hidden="true" />{label}
        <span className="reasoning-rate"> · {rate}</span>
      </summary>
      {content && <pre className="thinking-content">{content}</pre>}
    </details>

  </section>;
}
export default StreamingReasoningBlock;
