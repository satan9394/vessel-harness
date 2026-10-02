import type { EventBus } from '@vessel/core';
import type { TeamDagTask, TeamPlanStage, TeamTaskResult } from './types.js';

export class CyclicDependencyError extends Error {
  constructor() { super('team DAG contains a cycle'); this.name = 'CyclicDependencyError'; }
}

/** Owns topology and state; caller views cannot alter readiness or claim ownership. */
export class TeamDagScheduler {
  private readonly tasks = new Map<string, TeamDagTask>();
  private readonly members: TeamPlanStage['roster'];
  private readonly stageId: string;
  constructor(stage: TeamPlanStage, private readonly eventBus?: EventBus) {
    this.members = structuredClone(stage.roster);
    this.stageId = stage.id;
    if (stage.tasks.length === 0) throw new Error('team DAG must contain tasks');
    for (const task of stage.tasks) {
      if (!['generator', 'evaluator'].includes(task.assignedRole) || typeof task.title !== 'string' || typeof task.description !== 'string') throw new Error('invalid task role or description');
      if (!Array.isArray(task.dependencies) || new Set(task.dependencies).size !== task.dependencies.length) throw new Error('invalid or duplicate dependencies');
      if (!task.id.trim() || this.tasks.has(task.id)) throw new Error(`invalid or duplicate task id: ${task.id}`);
      this.tasks.set(task.id, { ...structuredClone(task), status: 'pending', claimedBy: undefined, result: undefined, error: undefined });
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new CyclicDependencyError();
      if (visited.has(id)) return;
      const task = this.tasks.get(id);
      if (!task) throw new Error(`missing dependency: ${id}`);
      visiting.add(id);
      for (const dep of task.dependencies) visit(dep);
      visiting.delete(id); visited.add(id);
    };
    for (const id of this.tasks.keys()) visit(id);
    for (const task of this.tasks.values()) {
      if (!this.members.some(m => m.role === task.assignedRole)) throw new Error(`no team member for role: ${task.assignedRole}`);
    }
  }
  snapshot(): TeamDagTask[] { return structuredClone([...this.tasks.values()]); }
  evaluateReadiness(): TeamDagTask[] {
    let changed: boolean;
    do {
      changed = false;
      for (const task of this.tasks.values()) {
        if (task.status !== 'pending') continue;
        if (task.dependencies.some(id => this.tasks.get(id)!.status === 'failed')) {
          task.status = 'failed'; task.error = 'blocked by failed dependency'; changed = true;
        } else if (task.dependencies.every(id => this.tasks.get(id)!.status === 'completed')) {
          task.status = 'ready'; changed = true;
        }
      }
    } while (changed);
    return this.snapshot().filter(t => t.status === 'ready');
  }
  claimTask(taskId: string, memberId: string): void {
    const task = this.task(taskId);
    const member = this.members.find(m => m.memberId === memberId);
    if (task.status !== 'ready' || member?.role !== task.assignedRole) throw new Error('task is not ready or member role mismatches');
    if ([...this.tasks.values()].some(t => t.claimedBy === memberId && (t.status === 'claimed' || t.status === 'running'))) throw new Error('member already busy');
    task.status = 'claimed'; task.claimedBy = memberId;
  }
  startTask(taskId: string): void {
    const task = this.task(taskId);
    if (task.status !== 'claimed') throw new Error('task must be claimed before running');
    task.status = 'running';
  }
  async settleTask(taskId: string, result: TeamTaskResult): Promise<void> {
    const task = this.task(taskId);
    if (task.status !== 'running') throw new Error('task must be running before settling');
    task.status = 'completed'; task.result = structuredClone(result);
    this.evaluateReadiness();
    await this.eventBus?.emit('task:settled', { stageId: this.stageId, taskId, memberId: task.claimedBy, status: task.status });
  }
  async failTask(taskId: string, error: string): Promise<void> {
    const task = this.task(taskId);
    if (task.status !== 'running') throw new Error('task must be running before failing');
    task.status = 'failed'; task.error = error;
    this.evaluateReadiness();
    await this.eventBus?.emit('task:settled', { stageId: this.stageId, taskId, memberId: task.claimedBy, status: task.status });
  }
  isSettled(): boolean { return [...this.tasks.values()].every(t => t.status === 'completed' || t.status === 'failed'); }
  private task(id: string): TeamDagTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`unknown task: ${id}`);
    return task;
  }
}
