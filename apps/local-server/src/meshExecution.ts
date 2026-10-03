import { TeamRuntime, resolveRoster, createDefaultPresetRegistry, type TeamRuntimeOptions, type TeamRoster, type MeshExecution } from '@vessel/agents';
import { TeamStageRoutes } from './teamRoutes.js';

/** Receiver-owned runtime configuration; remote JSON cannot select a workspace, provider or tools. */
export function createTeamMeshExecution(options: TeamRuntimeOptions, roster: TeamRoster): MeshExecution {
  const registry = options.presetRegistry ?? createDefaultPresetRegistry();
  const members = resolveRoster(roster, registry);
  return {
    roster: members,
    async execute(task, context, signal, dependencies) {
      if (signal.aborted) throw new Error('mesh execution interrupted');
      const runtime = new TeamRuntime({ ...options, maxSteps: options.maxSteps ?? 8, signal });
      const routes = new TeamStageRoutes();
      const member = roster.find(spec => registry.getPreset(spec.presetId).role === task.assignedRole)!;
      const stage = routes.stage('mesh', runtime, {
        task: `${task.description}\nContext snapshot:\n${JSON.stringify(context)}\nCompleted dependency outputs:\n${dependencies.map(t => t.result?.output ?? '').join('\n')}`,
        roster: [member], tasks: [{ ...task, dependencies: [] }],
      }, options.workspaceRoot);
      await runtime.approve(stage.id);
      if (signal.aborted) throw new Error('mesh execution interrupted');
      const settled = runtime.getTaskResult(stage.id, task.id);
      if (settled.status !== 'completed' || !settled.result) throw new Error(settled.error ?? 'mesh task failed');
      const artifactDiffs = settled.result.artifacts.map((_, index) => {
        const artifact = routes.artifact(stage.id, task.id, index);
        return { path: artifact.path, diff: artifact.diff };
      });
      return { ...settled.result, artifacts: artifactDiffs.map(a => a.path), artifactDiffs };
    },
  };
}
