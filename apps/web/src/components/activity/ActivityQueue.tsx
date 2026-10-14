import { useEffect, useState } from 'react';
import { useI18n } from '../LanguageProvider';
import type { ApiClient } from '../../api';
import { activityStatusLabelKey, groupActivity, type ActivityResponse, type ActivityRunView } from '../../workbench';
import '../card222.css';

export interface ActivityQueueProps {
  api?: Pick<ApiClient, 'activityRuns' | 'respondWidget'>;
  onOpenSession?: (sessionId: string) => void;
  /** server-side render / test fixture: preloaded queue, no fetch. */
  initial?: ActivityResponse;
}

const KIND_KEYS = { session: 'activityKindSession', team: 'activityKindTeam', subagent: 'activityKindSubagent', goal: 'activityKindGoal' } as const;

/**
 * UI-013 — cross-project Activity queue. Surfaces every `needs_attention` /
 * `running` / `failed` run and lets the user decide a pending approval inline.
 * State comes from the backend aggregation; the UI never infers completion.
 */
export default function ActivityQueue({ api, onOpenSession, initial }: ActivityQueueProps) {
  const { t } = useI18n();
  const [data, setData] = useState<ActivityResponse | null>(initial ?? null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!api) return;
    let active = true;
    api.activityRuns()
      .then((response) => { if (active) { setData(response); setError(null); } })
      .catch((failure) => { if (active) setError(failure); });
    return () => { active = false; };
  }, [api, revision]);

  const decide = async (run: ActivityRunView, optionId: string) => {
    if (!api || !run.approval) return;
    setBusy(`${run.id}:${optionId}`);
    setNotice(null);
    try {
      await api.respondWidget(run.approval.sessionId, run.approval.widgetId, optionId);
      setNotice(t('activityApprovalDone'));
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(null);
    }
  };

  const groups = data ? groupActivity(data.runs) : [];

  return (
    <section className="dashboard-panel activity-queue" aria-label={t('activityQueueTitle')}>
      <h3>{t('activityQueueTitle')}</h3>
      <p className="dim">{t('activityQueueHint')}</p>
      <button className="btn" onClick={() => setRevision((value) => value + 1)}>{t('modelRetry')}</button>
      {error ? <p role="alert" className="error-text">{t('activityQueueReadError', { error: String((error as Error)?.message ?? error) })}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {data && data.runs.length === 0 ? <p className="dim">{t('activityQueueEmpty')}</p> : null}

      {groups.map((group) => (
        <section key={group.status} aria-label={t(activityStatusLabelKey(group.status))}>
          <h4>{t(activityStatusLabelKey(group.status))} · {group.runs.length}</h4>
          <ul className="activity-queue-list">
            {group.runs.map((run) => (
              <li key={`${run.kind}:${run.id}`} className="activity-run" data-status={run.status} data-kind={run.kind} data-run-id={run.id}>
                <span className={`status-badge status-${run.status}`}>{t(activityStatusLabelKey(run.status))}</span>
                <span className="status-badge">{t(KIND_KEYS[run.kind])}</span>
                <strong>{run.title}</strong>
                <span className="dim">{t('activityProject')}: {run.projectRoot || '—'}</span>
                <span className="dim">{t('activityUpdated')}: {run.updatedAt ? new Date(run.updatedAt).toLocaleString() : '—'}</span>
                {onOpenSession && <button className="btn" onClick={() => onOpenSession(run.id)}>{t('activityKindSession')}</button>}
                {run.approval && (
                  <>
                    <span className="dim">{t('activityApprovalFor')}: {run.approval.description}</span>
                    {run.approval.options.map((option) => (
                      <button key={option.id} className="btn" disabled={busy !== null}
                        onClick={() => void decide(run, option.id)}>
                        {option.tone === 'danger' ? t('activityDeny') : t('activityApprove')} ({option.label})
                      </button>
                    ))}
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
