import { localizedValue } from '../../i18n';
import { useI18n } from '../LanguageProvider';
import type { TeamPlanStage } from '../../teamStages';

export default function TeamStagedBanner({ stage, busy, onApprove, onReject }: {
  stage: TeamPlanStage; busy?: boolean; onApprove: () => void; onReject: () => void;
}) {
  const { t } = useI18n();
  if (stage.status !== 'staged') return null;
  return <section className="team-staged-banner" aria-label={t('uiTeamPlanAwaitingApproval')}>
    <strong>{t('uiReviewTeamPlan')} {t('taskCount', { count: String(stage.tasks.length), plural: stage.tasks.length === 1 ? '' : 's' })}</strong>
    <ul>{stage.roster.map(member => <li key={member.memberId}>{member.memberId} · {localizedValue(member.role, t)} · {member.routeSnapshot.providerId}/{member.routeSnapshot.model}{member.routeSnapshot.reasoningEffort && ` · ${localizedValue(member.routeSnapshot.reasoningEffort, t)}`}</li>)}</ul>
    <button className="btn btn-primary" disabled={busy} onClick={onApprove}>{t('uiApproveAmpRun')}</button>{' '}
    <button className="btn" disabled={busy} onClick={onReject}>{t('uiReject')}</button>
  </section>;
}
