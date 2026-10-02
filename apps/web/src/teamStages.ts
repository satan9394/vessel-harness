/** Browser wire projection of the agents DAG; no runtime imports in the UI. */
export interface TeamDagTask {
  id: string; title: string; description: string;
  assignedRole: 'generator' | 'evaluator'; dependencies: string[];
  status: 'pending' | 'ready' | 'claimed' | 'running' | 'completed' | 'failed';
  claimedBy?: string; result?: { output: string; artifacts: string[] }; error?: string;
}
export interface TeamPlanStage {
  id: string; sessionId?: string; tasks: TeamDagTask[];
  status: 'staged' | 'approved' | 'running' | 'finished' | 'rejected'; error?: string;
  availableProviders?: string[];
  roster: { memberId: string; presetId?: string; role: string; routeSnapshot: { providerId: string; model: string; reasoningEffort?: 'low' | 'medium' | 'high'; temperature?: number } }[];
}
export interface TeamPlanRevision {
  roster: { memberId: string; presetId: string; providerId: string; model: string; reasoningEffort?: 'low' | 'medium' | 'high'; temperature?: number }[];
  tasks: TeamDagTask[];
}

export function layoutDag(tasks: TeamDagTask[]) {
  const levels = new Map<string, number>();
  const visiting = new Set<string>();
  const byId = new Map(tasks.map(task => [task.id, task]));
  function level(id: string): number {
    if (levels.has(id)) return levels.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const deps = byId.get(id)?.dependencies.filter(dep => byId.has(dep)) ?? [];
    const value = deps.length ? Math.max(...deps.map(level)) + 1 : 0;
    visiting.delete(id); levels.set(id, value); return value;
  }
  const rows = new Map<number, number>();
  return tasks.map(task => {
    const column = level(task.id); const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return { task, x: 24 + column * 240, y: 24 + row * 100 };
  });
}
