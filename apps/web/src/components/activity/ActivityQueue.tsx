import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../LanguageProvider';
import type { ApiClient } from '../../api';
import { activityStatusLabelKey, groupActivity, type ActivityResponse, type ActivityRunView } from '../../workbench';
import { formatStamp, shortPathLabel } from '../../utils/timeFormat';
import '../card222.css';

export interface ActivityQueueProps {
  api?: Pick<ApiClient, 'activityRuns' | 'respondWidget'> & Partial<Pick<ApiClient, 'approveTeamStage' | 'rejectTeamStage'>>;
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
  const deciding = useRef(false);

  useEffect(() => {
    if (!api) return;
    let active = true;
    api.activityRuns()
      .then((response) => { if (active) { setData(response); setError(null); } })
      .catch((failure) => { if (active) setError(failure); });
    return () => { active = false; };
  }, [api, revision]);

  const decide = async (run: ActivityRunView, optionId: string) => {
    if (!api || !run.approval || deciding.current) return;
    deciding.current = true;
    setBusy(`${run.id}:${optionId}`);
    setNotice(null);
    try {
      await api.respondWidget(run.approval.sessionId, run.approval.widgetId, optionId);
      setData(await api.activityRuns());
      setError(null);
      setNotice(t('activityApprovalDone'));
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(null);
      deciding.current = false;
    }
  };

  const decideTeam = async (run: ActivityRunView, approve: boolean) => {
    const respond = approve ? api?.approveTeamStage : api?.rejectTeamStage;
    if (!api || !respond || deciding.current) return;
    deciding.current = true; setBusy(run.id); setNotice(null);
    try {
      await respond(run.id);
      setData(await api.activityRuns());
      setError(null); setNotice(t('activityApprovalDone'));
    } catch (failure) { setError(failure); }
    finally { deciding.current = false; setBusy(null); }
  };

  const groups = data ? groupActivity(data.runs) : [];

  return (
    <section className="dashboard-panel activity-queue" aria-label={t('activityQueueTitle')}>
      <h3>{t('activityQueueTitle')}</h3>
      <p className="dim">{t('activityQueueHint')}</p>
      <button className="btn" onClick={() => setRevision((value) => value + 1)}>{t('activityRefresh')}</button>
      {error ? <p role="alert" className="error-text">{t('activityQueueReadError', { error: String((error as Error)?.message ?? error) })}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {data && data.runs.length === 0 ? <p className="dim">{t('activityQueueEmpty')}</p> : null}

      {groups.map((group) => {
        const isCompleted = group.status === 'completed';
        const content = (
          <ul className="activity-queue-list">
            {group.runs.map((run) => (
              <li key={`${run.kind}:${run.id}`} className="activity-run" data-status={run.status} data-kind={run.kind} data-run-id={run.id}>
                <span className={`status-badge status-${run.status}`}>{t(activityStatusLabelKey(run.status))}</span>
                <span className="status-badge">{t(KIND_KEYS[run.kind])}</span>
                <strong>{run.title}</strong>
                {run.kind !== 'session' && (
                  <details className="activity-run-details">
                    <summary>{t('traceShowDetail')}</summary>
                    <p>{run.detail || run.title}</p>
                    <p>{t('activityProject')}: {run.projectRoot}</p>
                    {run.entity ? <>
                      <p>{t(activityStatusLabelKey(run.status))} · {run.entity.status}</p>
                      {run.entity.provider && <p>{run.entity.provider}</p>}
                      {run.entity.startedAt && <p>{run.entity.startedAt} — {run.entity.endedAt ?? '…'}</p>}
                      {run.entity.error && <p role="alert">{run.entity.error}</p>}
                      {run.entity.tasks && <ul>{run.entity.tasks.map((task, index) => <li key={task.id ?? index}>{task.title ?? task.id} · {task.status}</li>)}</ul>}
                      {run.entity.acceptance && <ul>{run.entity.acceptance.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul>}
                    </> : <p>{t('activityUnknown')}</p>}
                  </details>
                )}
                <span className="dim" title={run.projectRoot}>{t('activityProject')}: {shortPathLabel(run.projectRoot)}</span>
                <span className="dim">{t('activityUpdated')}: {formatStamp(run.updatedAt)}</span>
                {run.kind === 'session' && onOpenSession && (
                  <button className="btn" onClick={() => onOpenSession(run.id)}>
                    {t('activityKindSession')}
                  </button>
                )}
                {run.approval && (
                  <>
                    <span className="dim">{t('activityApprovalFor')}: {run.approval.description}</span>
                    {run.approval.options.map((option) => (
                      <button key={option.id} className={`btn ${option.tone === 'danger' ? 'btn-danger' : 'btn-secondary'}`} disabled={!api || busy !== null}
                        onClick={() => void decide(run, option.id)}>
                        {option.tone === 'danger' ? t('activityDeny') : t('activityApprove')} ({option.label})
                      </button>
                    ))}
                  </>
                )}
                {run.kind === 'team' && run.entity?.status === 'staged' && <>
                  <button className="btn" disabled={!api?.approveTeamStage || busy !== null} onClick={() => void decideTeam(run, true)}>{t('activityApprove')}</button>
                  <button className="btn btn-danger" disabled={!api?.rejectTeamStage || busy !== null} onClick={() => void decideTeam(run, false)}>{t('activityDeny')}</button>
                </>}
                {run.needsApproval && (run.approval ? !api : run.kind !== 'team' || !api?.approveTeamStage || !api?.rejectTeamStage)
                  && <p className="dim">{t('activityDecisionUnavailable')}</p>}
              </li>
            ))}
          </ul>
        );

        if (isCompleted) {
          return (
            <details key={group.status} className="activity-completed-group" aria-label={t(activityStatusLabelKey(group.status))}>
              <summary><h4>{t(activityStatusLabelKey(group.status))} · {group.runs.length}</h4></summary>
              {content}
            </details>
          );
        }

        return (
          <section key={group.status} aria-label={t(activityStatusLabelKey(group.status))}>
            <h4>{t(activityStatusLabelKey(group.status))} · {group.runs.length}</h4>
            {content}
          </section>
        );
      })}
    </section>
  );
}
