import { localizedValue } from '../i18n';
import { useI18n } from './LanguageProvider';
import {
  memberCards,
  toolSummary,
  type TeamRunState,
} from '../team';

/**
 * Team panel (task 060, docs §8/§9) — renders a 057 TeamProjection snapshot as
 * per-member cards: role/model/tier, phase status, prompt/output previews,
 * tool activity and the structured review conclusion. Friendly empty state when
 * no team run has happened in this session. Presentational only.
 */
export default function TeamPanel({ team }: { team: TeamRunState | null }) {
  const { t } = useI18n();
  if (!team) {
    return (
      <div className="team-empty dim">
        <div className="team-empty-title">{t('uiNoTeamRunYet')}</div>
        <div>{t('uiRunATaskWithThisSessionAndThe')}</div>
      </div>
    );
  }

  const cards = memberCards(team);
  const running = team.status === 'running';

  return (
    <div className="team-panel" data-testid="team-panel">
      <div className="team-run-head">
        <span className={`run-status run-status-${team.outcome ?? (running ? 'running' : 'idle')}`}>
          {localizedValue(running ? 'running' : team.outcome === 'failed' ? 'failed' : 'done', t)}
        </span>
        <span className="team-run-task" title={team.task}>
          {team.task}
        </span>
        <span className="team-run-summary dim">{t('agentCount', { count: String(team.roster.length), plural: team.roster.length === 1 ? '' : 's' })} · {running ? t('running') : team.outcome === 'failed' ? t('failedReason', { reason: team.error ?? t('stateError') }) : t('completedDuration', { count: String(Math.round((team.durationMs ?? 0) / 1000)) })}</span>
      </div>
      {team.error && <div className="error-text team-run-error">{team.error}</div>}
      <div className="team-cards">
        {cards.map((card) => (
          <div className={`team-member${card.running ? ' team-member-running' : ''}`} key={card.memberId}>
            <div className="team-member-head">
              <span className="team-member-name">{localizedValue(card.presetId, t)}</span>
              <span className="team-member-model" title={`${card.model} (${card.providerId})`}>
                {card.model}
              </span>
              {card.tier && <span className="team-member-tier dim">{localizedValue(card.tier, t)}</span>}
              {card.running && <span className="team-member-live">{t('uiLive')}</span>}
            </div>
            {card.phase ? (
              <div className="team-phase">
                <span className={`phase-status phase-${card.phase.status}`}>{localizedValue(card.phase.phase, t)}</span>
                <span className="dim">{t('uiPhase')} {card.phase.ordinal}</span>
                {card.phase.status === 'failed' && card.phase.stopReason && (
                  <span className="dim">· {card.phase.stopReason}</span>
                )}
              </div>
            ) : (
              <div className="dim team-phase-waiting">{t('uiQueued')}</div>
            )}
            {card.phase?.outputPreview && (
              <div className="team-output" title={t('uiOutputPreview')}>
                <div className="team-label">{t('uiOutput')}</div>
                <div className="team-pre">{card.phase.outputPreview}</div>
              </div>
            )}
            {card.phase?.review && <ReviewBox verdict={card.phase.review.verdict} reason={card.phase.review.reason} unmet={card.phase.review.unmet} suggestions={card.phase.review.suggestions} />}
            {card.turns.length > 0 && (
              <div className="team-turns dim">
                {t('turnCount', { count: String(card.turns.length), plural: card.turns.length === 1 ? '' : 's' })}  {t('uiLastLabel')} {localizedValue(card.turns[card.turns.length - 1]?.kind ?? '', t)}
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
                    <span className="dim">{t('uiDelegate')}</span> {d.preset ?? d.childSessionId}
                    <span className="dim"> · {localizedValue(d.status, t)}</span>
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
  const { t } = useI18n();
  return (
    <div className={`review-box review-${verdict}`}>
      <div className="review-verdict">
        {t('uiReview')} {localizedValue(verdict, t)}
        {reason && <span className="dim"> — {reason}</span>}
      </div>
      {unmet.length > 0 && (
        <ul className="review-list">
          {unmet.map((u) => (
            <li key={u}>{t('uiUnmet')} {u}</li>
          ))}
        </ul>
      )}
      {suggestions.length > 0 && (
        <ul className="review-list">
          {suggestions.map((s) => (
            <li key={s}>{t('uiSuggest')} {s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
