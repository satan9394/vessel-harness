import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../../api';
import type { TeamPlanStage } from '../../teamStages';
import TeamDagCanvas from './TeamDagCanvas';
import TeamStagedBanner from './TeamStagedBanner';
import TeamNodeDrawer from './TeamNodeDrawer';
import TeamPlanEditor from './TeamPlanEditor';

export default function TeamStagesPanel({ api, sessionId }: { api: ApiClient; sessionId: string }) {
  const [stages, setStages] = useState<TeamPlanStage[]>([]);
  const [task, setTask] = useState('');
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const revision = useRef(0);
  const acting = useRef(false);
  useEffect(() => {
    let live = true;
    setStages([]); setSelected(undefined); setError(undefined);
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const current = revision.current;
      try { if (!acting.current) { const result = await api.listTeamStages(sessionId); if (live && current === revision.current) setStages(result.stages); } }
      catch (err) { if (live && current === revision.current) setError(String(err)); }
      finally { if (live) timer = setTimeout(() => void refresh(), 1000); }
    };
    void refresh();
    return () => { live = false; revision.current++; clearTimeout(timer); };
  }, [api, sessionId]);
  async function act(action: () => Promise<unknown>) {
    if (acting.current) return;
    acting.current = true;
    setBusy(true); setError(undefined);
    const current = ++revision.current;
    try { await action(); const result = await api.listTeamStages(sessionId); if (current === revision.current) setStages(result.stages); }
    catch (err) { if (current === revision.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { acting.current = false; if (current === revision.current) setBusy(false); }
  }
  return <section className="team-stages-panel" aria-label="Staged team plans">
    <form className="team-run-composer" onSubmit={e => { e.preventDefault(); if (task.trim()) void act(() => api.stageTeam(sessionId, { task: task.trim() })); }}>
      <input className="input" aria-label="Team plan task" placeholder="Preview a team plan…" value={task} onChange={e => setTask(e.target.value)} />
      <button className="btn" disabled={busy || !task.trim()}>Stage plan</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {stages.map(stage => <section key={stage.id} aria-label={`Team stage ${stage.id}`}>
      <TeamStagedBanner stage={stage} busy={busy} onApprove={() => void act(() => api.approveTeamStage(stage.id))} onReject={() => void act(() => api.rejectTeamStage(stage.id))} />
      <TeamPlanEditor stage={stage} busy={busy} onSave={plan => void act(() => api.reviseTeamStage(stage.id, plan))} />
      <p>{stage.status}</p>{stage.error && <p role="alert">{stage.error}</p>}
      <TeamDagCanvas tasks={stage.tasks} activeTaskId={stage.tasks.find(node => `${stage.id}:${node.id}` === selected)?.id} onSelectTask={id => setSelected(`${stage.id}:${id}`)} />
      {stage.tasks.filter(node => `${stage.id}:${node.id}` === selected).map(node => <TeamNodeDrawer key={`${stage.id}:${node.id}`} api={api} stageId={stage.id} task={node} onClose={() => setSelected(undefined)} />)}
    </section>)}
  </section>;
}
