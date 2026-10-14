import { useEffect, useState } from 'react';
import { useI18n } from '../LanguageProvider';
import type { ApiClient } from '../../api';
import { readTraceLayout, TRACE_LAYOUT_STORAGE_KEY, type TraceReportView } from '../../workbench';
import '../card222.css';

export interface TracePanelProps {
  api?: Pick<ApiClient, 'sessionTrace'>;
  sessionId?: string | null;
  /** server-side render / test fixture: preloaded trace, no fetch. */
  initial?: TraceReportView;
}

/**
 * UI-017 — structured, sanitized trace. Steps are grouped by turn; raw prompt
 * text and tool arguments never reach the DOM (the backend exports keys only).
 * The layout preference persists so the panel reopens the way the user left it.
 */
export default function TracePanel({ api, sessionId, initial }: TracePanelProps) {
  const { t } = useI18n();
  const [report, setReport] = useState<TraceReportView | null>(initial ?? null);
  const [error, setError] = useState<unknown>(null);
  const [layout, setLayout] = useState(() => {
    try { return readTraceLayout(typeof window === 'undefined' ? undefined : window.localStorage); }
    catch { return readTraceLayout(undefined); }
  });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!api || !sessionId) { setReport(null); return; }
    let active = true;
    api.sessionTrace(sessionId)
      .then((response) => { if (active) { setReport(response.trace); setError(null); } })
      .catch((failure) => { if (active) setError(failure); });
    return () => { active = false; };
  }, [api, sessionId, revision]);

  useEffect(() => {
    try { window.localStorage.setItem(TRACE_LAYOUT_STORAGE_KEY, JSON.stringify(layout)); } catch { /* optional persistence */ }
  }, [layout]);

  return (
    <section className="dashboard-panel trace-panel" aria-label={t('traceTitle')}>
      <h3>{t('traceTitle')}</h3>
      <p className="dim">{t('traceHint')}</p>
      <div className="trace-toolbar">
        <button className="btn" aria-pressed={layout.compact} onClick={() => setLayout((value) => ({ ...value, compact: !value.compact }))}>{t('traceCompact')}</button>
        <button className="btn" aria-pressed={layout.showDetail} onClick={() => setLayout((value) => ({ ...value, showDetail: !value.showDetail }))}>{t('traceShowDetail')}</button>
        <button className="btn" onClick={() => setRevision((value) => value + 1)}>{t('modelRetry')}</button>
      </div>
      {error ? <p role="alert" className="error-text">{t('traceReadError', { error: String((error as Error)?.message ?? error) })}</p> : null}
      {!error && report && report.recordCount === 0 ? <p className="dim">{t('traceEmpty')}</p> : null}

      {report && report.recordCount > 0 && (
        <>
          <p>{t('traceTurns')}: {report.turns.length} · {report.recordCount} {t('traceRecords')}</p>
          <p className="dim">{t('traceRedacted')}: <code>{report.redactedFields.join(', ')}</code></p>
          <div className={`trace-turns${layout.compact ? ' trace-compact' : ''}`}>
            {report.turns.map((turn) => (
              <section key={turn.turnId} className="trace-turn" aria-label={t('traceTurn', { turnId: turn.turnId })}>
                <h4>{t('traceTurn', { turnId: turn.turnId })}</h4>
                <ol className="trace-turns">
                  {turn.steps.map((step) => (
                    <li key={step.seq} className="trace-step" data-type={step.type} data-seq={step.seq}>
                      <span className="status-badge">{t('traceStepSeq')} {step.seq}</span>
                      <span className="status-badge">{step.type}</span>
                      <strong>{step.title}</strong>
                      {step.step !== undefined && <span className="dim">{t('traceStepLabel', { step: String(step.step) })}</span>}
                      {layout.showDetail && Object.keys(step.detail).length > 0 && (
                        <pre className="trace-detail">{JSON.stringify(step.detail)}</pre>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
