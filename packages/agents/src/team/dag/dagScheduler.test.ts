import { describe, it, expect } from 'vitest';
import { TeamDagScheduler, CyclicDependencyError } from './DagScheduler.js';
import type { TeamDagTask, TeamPlanStage } from './types.js';
import { resolveRoster } from '../roster.js';
import { createDefaultPresetRegistry } from '../../presets/defaults.js';
import { EventBus } from '@vessel/core';

const node = (id: string, dependencies: string[] = []): TeamDagTask => ({ id, title: id, description: id, dependencies, assignedRole: 'generator', status: 'pending' });
const stage = (tasks: TeamDagTask[]): TeamPlanStage => ({ id: 's', tasks, status: 'staged', createdAt: 0, roster: resolveRoster([
  { memberId: 'g1', presetId: 'developer', model: 'm', providerId: 'p' },
  { memberId: 'g2', presetId: 'developer', model: 'm', providerId: 'p' },
], createDefaultPresetRegistry()) });
const result = { output: 'ok', artifacts: [] };
describe('reactive team DAG', () => {
  it('disambiguates equal task ids in stages sharing one bus', async () => {
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.on('task:settled', payload => { events.push(payload); });
    for (const id of ['stage1', 'stage2']) {
      const dag = new TeamDagScheduler({ ...stage([node('A')]), id }, bus);
      dag.evaluateReadiness(); dag.claimTask('A', 'g1'); dag.startTask('A'); await dag.settleTask('A', result);
    }
    expect(events).toEqual(['stage1', 'stage2'].map(stageId => ({ stageId, taskId: 'A', memberId: 'g1', status: 'completed' })));
  });
  it('releases both diamond branches and joins only after both settle', async () => {
    const dag = new TeamDagScheduler(stage([node('A'), node('B', ['A']), node('C', ['A']), node('D', ['B', 'C'])]));
    expect(dag.evaluateReadiness().map(t => t.id)).toEqual(['A']);
    dag.claimTask('A', 'g1');
    await expect(dag.settleTask('A', result)).rejects.toThrow('running');
    dag.startTask('A'); await dag.settleTask('A', result);
    expect(dag.evaluateReadiness().map(t => t.id)).toEqual(['B', 'C']);
    dag.claimTask('B', 'g1'); dag.startTask('B');
    dag.claimTask('C', 'g2'); dag.startTask('C');
    await dag.settleTask('C', result); expect(dag.evaluateReadiness()).toEqual([]);
    await dag.settleTask('B', result); expect(dag.evaluateReadiness().map(t => t.id)).toEqual(['D']);
    dag.claimTask('D', 'g1'); dag.startTask('D'); await dag.settleTask('D', result);
    expect(dag.isSettled()).toBe(true);
  });
  it('rejects cycles, missing dependencies, duplicate ids and invalid transitions', () => {
    expect(() => new TeamDagScheduler(stage([]))).toThrow('contain tasks');
    expect(() => new TeamDagScheduler(stage([node('A'), node('B', ['A', 'A'])]))).toThrow('duplicate dependencies');
    expect(() => new TeamDagScheduler(stage([node('A', ['B']), node('B', ['A'])]))).toThrow(CyclicDependencyError);
    expect(() => new TeamDagScheduler(stage([node('A', ['missing'])]))).toThrow('missing dependency');
    expect(() => new TeamDagScheduler(stage([node('A'), node('A')]))).toThrow('duplicate');
    const dag = new TeamDagScheduler(stage([node('A')]));
    expect(() => dag.claimTask('A', 'g1')).toThrow('ready');
    dag.evaluateReadiness(); expect(() => dag.claimTask('A', 'unknown')).toThrow('role');
  });
  it('blocks downstream failures even in reverse ordering, while independent tasks finish', async () => {
    const input = stage([node('C', ['B']), node('B', ['A']), node('A'), node('other')]);
    const dag = new TeamDagScheduler(input);
    input.tasks[2]!.dependencies.push('C'); input.tasks[0]!.status = 'completed';
    dag.evaluateReadiness(); dag.claimTask('A', 'g1'); dag.startTask('A'); await dag.failTask('A', 'boom');
    expect(dag.snapshot().filter(t => t.error).map(t => t.id)).toEqual(['C', 'B', 'A']);
    expect(dag.isSettled()).toBe(false);
    dag.claimTask('other', 'g2'); dag.startTask('other'); await dag.settleTask('other', result);
    expect(dag.isSettled()).toBe(true);
  });
});
