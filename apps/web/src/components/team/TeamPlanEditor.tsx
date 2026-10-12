import { useI18n } from '../LanguageProvider';
import { useState } from 'react';
import type { TeamPlanRevision, TeamPlanStage } from '../../teamStages';

export function TeamPlanEditorFields({ plan, providers, busy, onChange, onSave }: {
  plan: TeamPlanRevision; providers: string[]; busy?: boolean; onChange: (plan: TeamPlanRevision) => void; onSave: () => void;
}) {
  const { t } = useI18n();
  return <form aria-label={t('uiEditStagedTeamPlan')} onSubmit={e => { e.preventDefault(); onSave(); }}>
    <fieldset disabled={busy}><legend>{t('uiMemberRoutes')}</legend>
      {plan.roster.map((member, index) => {
        const update = (changes: Partial<typeof member>) => onChange({ ...plan, roster: plan.roster.map((row, i) => i === index ? { ...row, ...changes } : row) });
        return <div className="team-plan-editor-row" key={member.memberId}>
          <strong>{member.memberId}</strong>
          <label>{t('uiRole')} <select value={member.presetId} onChange={e => update({ presetId: e.target.value })}>
            <option value="lead">{t('uiLead')}</option><option value="developer">{t('uiGenerator')}</option><option value="reviewer">{t('uiEvaluator')}</option>
          </select></label>
          <label>{t('uiProvider')} <select value={member.providerId} onChange={e => update({ providerId: e.target.value })}>{providers.map(provider => <option key={provider} value={provider}>{provider}</option>)}</select></label>
          <label>{t('uiModel')} <input required value={member.model} onChange={e => update({ model: e.target.value })} /></label>
          <label>{t('uiReasoning')} <select value={member.reasoningEffort ?? ''} onChange={e => update({ reasoningEffort: (e.target.value || undefined) as typeof member.reasoningEffort })}>
            <option value="">{t('uiDefault')}</option><option value="low">{t('uiLow')}</option><option value="medium">{t('uiMedium')}</option><option value="high">{t('uiHigh')}</option>
          </select></label>
          <label>{t('uiTemperature')} <input type="number" min="0" max="2" step="0.1" value={member.temperature ?? ''} onChange={e => update({ temperature: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
        </div>;
      })}
    </fieldset>
    <fieldset disabled={busy}><legend>{t('uiTaskParameters')}</legend>
      {plan.tasks.map((task, index) => {
        const update = (changes: Partial<typeof task>) => onChange({ ...plan, tasks: plan.tasks.map((row, i) => i === index ? { ...row, ...changes } : row) });
        return <div className="team-plan-editor-row" key={task.id}>
          <strong>{task.id}</strong>
          <label>{t('uiTitle')} <input required value={task.title} onChange={e => update({ title: e.target.value })} /></label>
          <label>{t('uiAssignedRole')} <select value={task.assignedRole} onChange={e => update({ assignedRole: e.target.value as typeof task.assignedRole })}><option value="generator">{t('uiGenerator')}</option><option value="evaluator">{t('uiEvaluator')}</option></select></label>
          <label>{t('uiDescription')} <textarea value={task.description} onChange={e => update({ description: e.target.value })} /></label>
          <label>{t('uiDependenciesCommaSeparated')} <input value={task.dependencies.join(', ')} onChange={e => update({ dependencies: e.target.value.split(',').map(id => id.trim()).filter(Boolean) })} /></label>
        </div>;
      })}
    </fieldset>
    <button className="btn" disabled={busy}>{t('uiSaveRevisedPreview')}</button>
  </form>;
}

export default function TeamPlanEditor({ stage, busy, onSave }: { stage: TeamPlanStage; busy?: boolean; onSave: (plan: TeamPlanRevision) => void }) {
  const { t } = useI18n();
  const [plan, setPlan] = useState<TeamPlanRevision>(() => ({ roster: stage.roster.map(member => ({ memberId: member.memberId,
    presetId: member.presetId ?? (member.role === 'evaluator' ? 'reviewer' : member.role === 'orchestrator' ? 'lead' : 'developer'), ...member.routeSnapshot })), tasks: structuredClone(stage.tasks) }));
  if (stage.status !== 'staged') return null;
  return <details><summary>{t('uiEditPlanBeforeApproval')}</summary><TeamPlanEditorFields plan={plan} providers={stage.availableProviders ?? [...new Set(stage.roster.map(member => member.routeSnapshot.providerId))]} busy={busy} onChange={setPlan} onSave={() => onSave(plan)} /></details>;
}
