import { useI18n } from './LanguageProvider';
import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api';
import { createEventStream, type TeamDelta } from '../sse';
import {
  normalizeTeamState,
  sortReviews,
  type ReviewRecord,
  type RouteState,
  type TeamRunState,
} from '../team';
import TeamPanel from './TeamPanel';
import TeamStagesPanel from './team/TeamStagesPanel';
import ReviewRequiredPanel from './ReviewRequiredPanel';

interface Props {
  sessionId: string;
  api: ApiClient;
}

/**
 * Team module (task 060) — owns the session's route/team/review data:
 *  - route state (mode/pin/resolution) via /api/sessions/:id/route*
 *  - live team snapshots over the session SSE stream ('team' frames) +
 *    GET /team-runs/current as the page-load fallback
 *  - external review handoffs via /api/reviews
 * Renders TeamPanel + ReviewRequiredPanel.
 */
export default function TeamModule({ sessionId, api }: Props) {
  const { t } = useI18n();
  const [route, setRoute] = useState<RouteState | null>(null);
  const [team, setTeam] = useState<TeamRunState | null>(null);
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const showError = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [r, t, list] = await Promise.all([api.getRoute(sessionId), api.getTeamRun(sessionId), api.listReviews()]);
      setRoute(r);
      setTeam(normalizeTeamState(t.team));
      setReviews(sortReviews(list.reviews));
    } catch (err) {
      showError(err);
    }
  }, [api, sessionId, showError]);

  // Reset per session + subscribe to live 'team' SSE frames.
  useEffect(() => {
    setRoute(null);
    setTeam(null);
    setReviews([]);
    setTask('');
    setError(null);
    setNotice(null);
    void refresh();
    const stream = createEventStream(`/api/sessions/${encodeURIComponent(sessionId)}/events`, {
      onTeam: (delta: TeamDelta) => setTeam(normalizeTeamState(delta.state)),
    });
    return () => stream.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const run = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const prompt = task.trim();
      if (!prompt || busy) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await api.startTeamRun(sessionId, { task: prompt, mode: route?.mode });
        // auto resolution happens server-side; pull the updated route + snapshot
        await refresh();
      } catch (err) {
        showError(err);
      } finally {
        setBusy(false);
      }
    },
    [api, sessionId, task, busy, route?.mode, refresh, showError],
  );

  const copyHandoff = useCallback(
    async (review: ReviewRecord) => {
      setNotice(null);
      try {
        const markdown = await api.handoffMarkdown(review.id);
        await copyToClipboard(markdown, t('clipboardUnavailable'));
        setNotice(t('handoffCopied'));
      } catch (err) {
        showError(err);
      }
    },
    [api, showError, t],
  );

  const openFolder = useCallback(
    async (review: ReviewRecord) => {
      setNotice(null);
      try {
        await api.openReviewFolder(review.id);
        setNotice(t('folderOpened'));
      } catch (err) {
        showError(err);
      }
    },
    [api, showError, t],
  );

  const importResult = useCallback(
    async (review: ReviewRecord, text: string) => {
      setBusy(true);
      setNotice(null);
      try {
        const { review: updated } = await api.importReview(review.id, text);
        setReviews((prev) => sortReviews(prev.map((r) => (r.id === updated.id ? updated : r))));
        setNotice(t('reviewImported'));
      } catch (err) {
        showError(err);
      } finally {
        setBusy(false);
      }
    },
    [api, showError, t],
  );

  return (
    <div className="team-module">
      <TeamStagesPanel key={sessionId} api={api} sessionId={sessionId} />
      <form className="team-run-composer" onSubmit={run}>
        <input
          className="input composer-input"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder={t('uiTeamTaskAutoResolvesTheRosterSmallDev')}
          disabled={busy}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !task.trim()}>
          {busy ? t('uiRunning') : t('uiRunTeam')}
        </button>
      </form>
      {error && <div className="error-text">{error}</div>}
      {notice && <div className="team-notice dim">{notice}</div>}
      <div className="team-module-section">
        <TeamPanel team={team} />
      </div>
      <div className="team-module-section">
        <ReviewRequiredPanel
          reviews={reviews}
          busy={busy}
          onCopy={copyHandoff}
          onOpenFolder={openFolder}
          onImport={importResult}
        />
      </div>
      <div className="dim team-module-hint">{t('uiTeamActivityStreamsLiveFromTheSessionSSE')}</div>
    </div>
  );
}

async function copyToClipboard(text: string, unavailable: string): Promise<void> {
  try {
    const nav = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator;
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return;
    }
  } catch {
    // clipboard blocked — swallow (notice still shown)
  }
  throw new Error(unavailable);
}
