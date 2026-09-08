import {
  memberCards,
  phaseDisplay,
  roleDisplay,
  runSummary,
  toolSummary,
  verdictDisplay,
  type TeamRunState,
} from '../team';

/**
 * Team panel (task 060, docs §8/§9) — renders a 057 TeamProjection snapshot as
 * per-member cards: role/model/tier, phase status, prompt/output previews,
 * tool activity and the structured review conclusion. Friendly empty state when
 * no team run has happened in this session. Presentational only.
 */
export default function TeamPanel({ team }: { team: TeamRunState | null }) {
  if (!team) {
    return (
      <div className="team-empty dim">
        <div className="team-empty-title">No team run yet</div>
        <div>Run a task with this session and the 3-agent activity (Lead / Developer / Reviewer) will appear here.</div>
      </div>
    );
  }

  const cards = memberCards(team);
  const running = team.status === 'running';

  return (
    <div className="team-panel" data-testid="team-panel">
      <div className="team-run-head">
        <span className={`run-status run-status-${team.outcome ?? (running ? 'running' : 'idle')}`}>
          {running ? 'running' : team.outcome === 'failed' ? 'failed' : 'done'}
        </span>
        <span className="team-run-task" title={team.task}>
          {team.task}
        </span>
        <span className="team-run-summary dim">{runSummary(team)}</span>
      </div>
      {team.error && <div className="error-text team-run-error">{team.error}</div>}
      <div className="team-cards">
        {cards.map((card) => (
          <div className={`team-member${card.running ? ' team-member-running' : ''}`} key={card.memberId}>
            <div className="team-member-head">
              <span className="team-member-name">{roleDisplay(card.presetId, card.role)}</span>
              <span className="team-member-model" title={`${card.model} (${card.providerId})`}>
                {card.model}
              </span>
              {card.tier && <span className="team-member-tier dim">{card.tier}</span>}
              {card.running && <span className="team-member-live">live</span>}
            </div>
            {card.phase ? (
              <div className="team-phase">
                <span className={`phase-status phase-${card.phase.status}`}>{phaseDisplay(card.phase.phase)}</span>
                <span className="dim">phase {card.phase.ordinal}</span>
                {card.phase.status === 'failed' && card.phase.stopReason && (
                  <span className="dim">· {card.phase.stopReason}</span>
                )}
              </div>
            ) : (
              <div className="dim team-phase-waiting">queued…</div>
            )}
            {card.phase?.outputPreview && (
              <div className="team-output" title="output preview">
                <div className="team-label">Output</div>
                <div className="team-pre">{card.phase.outputPreview}</div>
              </div>
            )}
            {card.phase?.review && <ReviewBox verdict={card.phase.review.verdict} reason={card.phase.review.reason} unmet={card.phase.review.unmet} suggestions={card.phase.review.suggestions} />}
            {card.turns.length > 0 && (
              <div className="team-turns dim">
                {card.turns.length} turn{card.turns.length === 1 ? '' : 's'} · last {card.turns[card.turns.length - 1]?.kind}
              </div>
            )}
            {toolSummary(card.tools).length > 0 && (
              <div className="team-tools">
                {toolSummary(card.tools).map((t) => (
                  <span key={t.toolName} className={`tool-chip tool-${t.status}`} title={`${t.toolName} (${t.status})`}>
                    {t.toolName}
                    {t.count > 1 ? ` ×${t.count}` : ''}
                  </span>
                ))}
              </div>
            )}
            {card.delegates.length > 0 && (
              <div className="team-delegates">
                {card.delegates.map((d) => (
                  <div key={d.delegateId} className="team-delegate">
                    <span className="dim">delegate →</span> {d.preset ?? d.childSessionId}
                    <span className="dim"> · {d.status}</span>
                    {d.outputPreview && <div className="team-pre team-delegate-output">{d.outputPreview}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Structured Internal Review conclusion block (task 058 data, readable). */
function ReviewBox({
  verdict,
  reason,
  unmet,
  suggestions,
}: {
  verdict: 'met' | 'not_met' | 'impossible' | 'error';
  reason: string;
  unmet: string[];
  suggestions: string[];
}) {
  return (
    <div className={`review-box review-${verdict}`}>
      <div className="review-verdict">
        Review: {verdictDisplay(verdict)}
        {reason && <span className="dim"> — {reason}</span>}
      </div>
      {unmet.length > 0 && (
        <ul className="review-list">
          {unmet.map((u) => (
            <li key={u}>unmet: {u}</li>
          ))}
        </ul>
      )}
      {suggestions.length > 0 && (
        <ul className="review-list">
          {suggestions.map((s) => (
            <li key={s}>suggest: {s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
