import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api';
import { createEventStream, type TeamDelta } from '../sse';
import {
  normalizeTeamState,
  routeLabel,
  sortReviews,
  type ReviewRecord,
  type RouteMode,
  type RouteState,
  type TeamRunState,
} from '../team';
import ModelSelector from './ModelSelector';
import TeamPanel from './TeamPanel';
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
 * Renders ModelSelector + TeamPanel + ReviewRequiredPanel.
 */
export default function TeamModule({ sessionId, api }: Props) {
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

  const setMode = useCallback(
    async (mode: RouteMode) => {
      setBusy(true);
      setError(null);
      try {
        const next = await api.setRouteMode(sessionId, mode);
        setRoute(next);
      } catch (err) {
        showError(err);
      } finally {
        setBusy(false);
      }
    },
    [api, sessionId, showError],
  );

  const resolve = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.resolveRoute(sessionId, task.trim() || undefined);
      await refresh();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }, [api, sessionId, task, refresh, showError]);

  const pin = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.pinRoute(sessionId);
      setRoute(next);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }, [api, sessionId, showError]);

  const unpin = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.unpinRoute(sessionId);
      setRoute(next);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }, [api, sessionId, showError]);

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
        await copyToClipboard(markdown);
        setNotice('Handoff copied to clipboard');
      } catch (err) {
        showError(err);
      }
    },
    [api, showError],
  );

  const openFolder = useCallback(
    async (review: ReviewRecord) => {
      setNotice(null);
      try {
        await api.openReviewFolder(review.id);
        setNotice('Folder opened');
      } catch (err) {
        showError(err);
      }
    },
    [api, showError],
  );

  const importResult = useCallback(
    async (review: ReviewRecord, text: string) => {
      setBusy(true);
      setNotice(null);
      try {
        const { review: updated } = await api.importReview(review.id, text);
        setReviews((prev) => sortReviews(prev.map((r) => (r.id === updated.id ? updated : r))));
        setNotice('Review result imported');
      } catch (err) {
        showError(err);
      } finally {
        setBusy(false);
      }
    },
    [api, showError],
  );

  const label = route ? routeLabel(route.route) : null;

  return (
    <div className="team-module">
      <ModelSelector
        mode={route?.mode ?? 'auto'}
        label={label}
        pinned={route?.pinned ?? false}
        busy={busy}
        onSelect={setMode}
        onResolve={resolve}
        onPin={pin}
        onUnpin={unpin}
      />
      <form className="team-run-composer" onSubmit={run}>
        <input
          className="input composer-input"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Team task… (Auto resolves the roster: small / dev+reviewer / lead+dev+reviewer)"
          disabled={busy}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !task.trim()}>
          {busy ? 'Running…' : 'Run team'}
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
      <div className="dim team-module-hint">Team activity streams live from the session SSE; review handoffs live under .vessel/reviews.</div>
    </div>
  );
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    const nav = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator;
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return;
    }
  } catch {
    // clipboard blocked — swallow (notice still shown)
  }
  throw new Error('Clipboard unavailable');
}
