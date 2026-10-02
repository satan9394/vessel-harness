import { useState } from 'react';
import type { TeamPlanRevision, TeamPlanStage } from '../../teamStages';

export function TeamPlanEditorFields({ plan, providers, busy, onChange, onSave }: {
  plan: TeamPlanRevision; providers: string[]; busy?: boolean; onChange: (plan: TeamPlanRevision) => void; onSave: () => void;
}) {
  return <form aria-label="Edit staged team plan" onSubmit={e => { e.preventDefault(); onSave(); }}>
    <fieldset disabled={busy}><legend>Member routes</legend>
      {plan.roster.map((member, index) => {
        const update = (changes: Partial<typeof member>) => onChange({ ...plan, roster: plan.roster.map((row, i) => i === index ? { ...row, ...changes } : row) });
        return <div className="team-plan-editor-row" key={member.memberId}>
          <strong>{member.memberId}</strong>
          <label>Role <select value={member.presetId} onChange={e => update({ presetId: e.target.value })}>
            <option value="lead">Lead</option><option value="developer">Generator</option><option value="reviewer">Evaluator</option>
          </select></label>
          <label>Provider <select value={member.providerId} onChange={e => update({ providerId: e.target.value })}>{providers.map(provider => <option key={provider} value={provider}>{provider}</option>)}</select></label>
          <label>Model <input required value={member.model} onChange={e => update({ model: e.target.value })} /></label>
          <label>Reasoning <select value={member.reasoningEffort ?? ''} onChange={e => update({ reasoningEffort: (e.target.value || undefined) as typeof member.reasoningEffort })}>
            <option value="">Default</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select></label>
          <label>Temperature <input type="number" min="0" max="2" step="0.1" value={member.temperature ?? ''} onChange={e => update({ temperature: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
        </div>;
      })}
    </fieldset>
    <fieldset disabled={busy}><legend>Task parameters</legend>
      {plan.tasks.map((task, index) => {
        const update = (changes: Partial<typeof task>) => onChange({ ...plan, tasks: plan.tasks.map((row, i) => i === index ? { ...row, ...changes } : row) });
        return <div className="team-plan-editor-row" key={task.id}>
          <strong>{task.id}</strong>
          <label>Title <input required value={task.title} onChange={e => update({ title: e.target.value })} /></label>
          <label>Assigned role <select value={task.assignedRole} onChange={e => update({ assignedRole: e.target.value as typeof task.assignedRole })}><option value="generator">Generator</option><option value="evaluator">Evaluator</option></select></label>
          <label>Description <textarea value={task.description} onChange={e => update({ description: e.target.value })} /></label>
          <label>Dependencies (comma separated) <input value={task.dependencies.join(', ')} onChange={e => update({ dependencies: e.target.value.split(',').map(id => id.trim()).filter(Boolean) })} /></label>
        </div>;
      })}
    </fieldset>
    <button className="btn" disabled={busy}>Save revised preview</button>
  </form>;
}

export default function TeamPlanEditor({ stage, busy, onSave }: { stage: TeamPlanStage; busy?: boolean; onSave: (plan: TeamPlanRevision) => void }) {
  const [plan, setPlan] = useState<TeamPlanRevision>(() => ({ roster: stage.roster.map(member => ({ memberId: member.memberId,
    presetId: member.presetId ?? (member.role === 'evaluator' ? 'reviewer' : member.role === 'orchestrator' ? 'lead' : 'developer'), ...member.routeSnapshot })), tasks: structuredClone(stage.tasks) }));
  if (stage.status !== 'staged') return null;
  return <details><summary>Edit plan before approval</summary><TeamPlanEditorFields plan={plan} providers={stage.availableProviders ?? [...new Set(stage.roster.map(member => member.routeSnapshot.providerId))]} busy={busy} onChange={setPlan} onSave={() => onSave(plan)} /></details>;
}
