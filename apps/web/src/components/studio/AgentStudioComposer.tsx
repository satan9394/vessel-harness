import { useEffect, useState } from 'react';
import { useI18n } from '../LanguageProvider';
import type { ApiClient } from '../../api';
import type { MessageKey } from '../../i18n';
import {
  reorderPriority,
  sortByPriority,
  type BehaviorConformanceReportView,
  type ComposerLibraryEntry,
} from '../../workbench';
import '../card222.css';

export interface AgentStudioComposerProps {
  api?: Pick<ApiClient, 'behaviorLibrary' | 'composeBehavior'>;
  sessionId?: string | null;
  /** server-side render / test fixture: preloaded library + staged set + report. */
  initialLibrary?: ComposerLibraryEntry[];
  initialStaged?: ComposerLibraryEntry[];
  initialReport?: BehaviorConformanceReportView;
}

const VERDICT_KEYS: Record<BehaviorConformanceReportView['verdict'], MessageKey> = {
  verified: 'composerVerdictVerified',
  enforceable: 'composerVerdictEnforceable',
  incomplete: 'composerVerdictIncomplete',
  rejected: 'composerVerdictRejected',
};

/**
 * UI-015 — interactive Agent Studio Composer. Stage rules from the library,
 * reorder priorities, then verify against the live compiler. Verification is
 * advisory only: a `rejected` candidate is never activated by this panel.
 */
export default function AgentStudioComposer({ api, sessionId, initialLibrary, initialStaged, initialReport }: AgentStudioComposerProps) {
  const { t } = useI18n();
  const [library, setLibrary] = useState<ComposerLibraryEntry[]>(initialLibrary ?? []);
  const [staged, setStaged] = useState<ComposerLibraryEntry[]>(initialStaged ?? []);
  const [report, setReport] = useState<BehaviorConformanceReportView | null>(initialReport ?? null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(api && !initialLibrary));

  useEffect(() => {
    if (!api) return;
    let active = true;
    setLoading(true);
    api.behaviorLibrary()
      .then((response) => { if (active) { setLibrary(response.entries); setError(null); } })
      .catch((failure) => { if (active) setError(failure); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api]);

  const stagedIds = new Set(staged.map((entry) => entry.id));
  const add = (entry: ComposerLibraryEntry) => {
    if (stagedIds.has(entry.id)) return;
    setStaged((current) => sortByPriority([...current, { ...entry, priority: (current.length + 1) * 10 }]));
    setReport(null);
  };
  const remove = (id: string) => { setStaged((current) => current.filter((entry) => entry.id !== id)); setReport(null); };
  const move = (index: number, direction: -1 | 1) => {
    setStaged((current) => {
      const sorted = sortByPriority(current);
      const target = sorted[index];
      if (!target) return current;
      return reorderPriority(sorted, sorted.findIndex((entry) => entry.id === target.id), direction);
    });
    setReport(null);
  };
  const verify = async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      setReport(await api.composeBehavior(sortByPriority(staged), sessionId ?? undefined));
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dashboard-panel agent-studio-composer" aria-label={t('composerTitle')}>
      <h3>{t('composerTitle')}</h3>
      <p className="dim">{t('composerHint')}</p>
      {error ? <p role="alert" className="error-text">{t('composerReadError', { error: String((error as Error)?.message ?? error) })}</p> : null}

      <div className="composer-grid">
        <div className="composer-col">
          <h4>{t('composerLibrary')}</h4>
          {loading ? <p className="composer-empty dim" role="status">{t('composerLoadingLibrary')}</p>
            : library.length === 0 ? <p className="composer-empty dim">{t('composerEmptyLibrary')}</p> : (
            <ul className="composer-library-list">
              {library.map((entry) => (
                <li key={entry.id} className="composer-rule" data-entry={entry.id}>
                  <strong>{entry.id}</strong>
                  <span className="status-badge">{entry.channel}</span>
                  <span className="dim">{entry.render}</span>
                  <button className="btn" disabled={stagedIds.has(entry.id)} onClick={() => add(entry)}>{t('composerAdd')}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="composer-col">
          <h4>{t('composerStaged')}</h4>
          {staged.length === 0 ? <p className="dim">{t('composerEmptyStaged')}</p> : (
            <ul className="composer-staged-list">
              {staged.map((entry, index) => (
                <li key={entry.id} className="composer-rule" data-entry={entry.id}>
                  <strong>{entry.id}</strong>
                  <span className="status-badge">{t('composerPriority')} {entry.priority ?? 0}</span>
                  <span className="status-badge">{entry.channel}</span>
                  <span className="composer-rule-actions">
                    <button className="btn" aria-label={`${t('composerMoveUp')} ${entry.id}`} onClick={() => move(index, -1)}>↑</button>
                    <button className="btn" aria-label={`${t('composerMoveDown')} ${entry.id}`} onClick={() => move(index, 1)}>↓</button>
                    <button className="btn" onClick={() => remove(entry.id)}>{t('composerRemove')}</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button className="btn" disabled={busy || staged.length === 0} onClick={() => void verify()}>{busy ? t('composerVerifying') : t('composerVerify')}</button>
        </div>
      </div>

      {report && (
        <div className="card222-detail composer-report" aria-label={t('composerVerdict')}>
          <p>{t('composerVerdict')}: <strong className={`status-badge verdict-${report.verdict}`}>{t(VERDICT_KEYS[report.verdict])}</strong></p>
          {report.snapshotHash && <p>{t('composerSnapshot')}: <code>{report.snapshotHash.slice(0, 16)}…</code></p>}
          <h4>{t('composerConflicts')}</h4>
          {report.conflicts.length === 0 ? <p className="dim">{t('composerNoConflicts')}</p> : (
            <ul className="composer-conflicts">
              {report.conflicts.map((conflict, index) => (
                <li key={`${conflict.code}:${index}`} data-severity={conflict.severity}>
                  <span className={`status-badge status-${conflict.severity}`}>{conflict.severity}</span> {conflict.domain}: {conflict.message}
                </li>
              ))}
            </ul>
          )}
          <h4>{t('composerConformance')}</h4>
          <ul className="composer-conformance">
            {report.conformance.map((entry) => (
              <li key={entry.entryId} data-entry={entry.entryId}>
                <strong>{entry.entryId}</strong> · {t('composerCompatibility')}: <span className="status-badge">{entry.compatibility}</span>
                {entry.policyRef && <> · {t('composerPolicyRef')}: <code>{entry.policyRef}</code></>}
                {' '}{entry.policyRuleFound ? t('composerPolicyFound') : t('composerPolicyMissing')}
              </li>
            ))}
          </ul>
          <h4>{t('composerLevels')}</h4>
          <p>{report.levels.map((level) => `${level.level}:${level.status}`).join(' · ') || '—'}</p>
          <h4>{t('composerDiagnostics')}</h4>
          {report.diagnostics.length === 0 ? <p className="dim">{t('composerNoDiagnostics')}</p> : (
            <ul>{report.diagnostics.map((diagnostic, index) => <li key={index}>{diagnostic.severity} {diagnostic.code}: {diagnostic.message}</li>)}</ul>
          )}
          {report.warnings.length > 0 && <ul>{report.warnings.map((warning, index) => <li key={index} className="dim">{warning}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}
