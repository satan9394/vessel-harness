import type { TeamPlanStage } from '../../teamStages';

export default function TeamStagedBanner({ stage, busy, onApprove, onReject }: {
  stage: TeamPlanStage; busy?: boolean; onApprove: () => void; onReject: () => void;
}) {
  if (stage.status !== 'staged') return null;
  return <section className="team-staged-banner" aria-label="Team plan awaiting approval">
    <strong>Review team plan · {stage.tasks.length} tasks</strong>
    <ul>{stage.roster.map(member => <li key={member.memberId}>{member.memberId} · {member.role} · {member.routeSnapshot.providerId}/{member.routeSnapshot.model}{member.routeSnapshot.reasoningEffort && ` · ${member.routeSnapshot.reasoningEffort}`}</li>)}</ul>
    <button className="btn btn-primary" disabled={busy} onClick={onApprove}>Approve &amp; Run</button>{' '}
    <button className="btn" disabled={busy} onClick={onReject}>Reject</button>
  </section>;
}
