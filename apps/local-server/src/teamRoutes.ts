import { TeamRuntime, type TeamDagTask, type TeamPlanStage, type TeamRunRequest, type TeamRoster } from '@vessel/agents';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Owns stage handles; all execution and task states remain in TeamRuntime. */
export class TeamStageRoutes {
  private readonly stages = new Map<string, { runtime: TeamRuntime; sessionId: string; workspaceRoot?: string; request: TeamRunRequest; availableProviders: string[]; error?: string }>();
  private readonly runs = new Set<Promise<unknown>>();
  constructor(private readonly onStatus?: (id: string, status: TeamPlanStage['status']) => void) {}

  stage(sessionId: string, runtime: TeamRuntime, request: TeamRunRequest & { tasks: readonly TeamDagTask[] }, workspaceRoot?: string, availableProviders: string[] = []): TeamPlanStage {
    const stage = runtime.stageTeam(request);
    this.stages.set(stage.id, { runtime, sessionId, workspaceRoot, request: structuredClone(request), availableProviders: [...availableProviders] });
    this.onStatus?.(stage.id, stage.status);
    return stage;
  }

  list(sessionId?: string) {
    return [...this.stages.keys()].filter(id => !sessionId || this.stages.get(id)!.sessionId === sessionId).map(id => this.get(id));
  }

  get(id: string) {
    const entry = this.stages.get(id);
    if (!entry) return undefined;
    return { ...entry.runtime.getStage(id), sessionId: entry.sessionId, error: entry.error, availableProviders: [...entry.availableProviders] };
  }

  revise(id: string, changes: unknown) {
    const entry = this.stages.get(id);
    if (!entry || entry.runtime.getStage(id).status !== 'staged') throw new Error('stage is not awaiting approval');
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('invalid plan changes');
    const { roster, tasks } = changes as { roster?: TeamRoster; tasks?: TeamDagTask[] };
    if (!Array.isArray(roster) || !roster.length || !roster.every(member => member && typeof member.memberId === 'string' && member.memberId.trim() && typeof member.presetId === 'string' && member.presetId.trim() && typeof member.providerId === 'string' && member.providerId.trim() && typeof member.model === 'string' && member.model.trim() && (member.reasoningEffort === undefined || ['low', 'medium', 'high'].includes(member.reasoningEffort)) && (member.temperature === undefined || Number.isFinite(member.temperature) && member.temperature >= 0 && member.temperature <= 2))) throw new Error('invalid member routes');
    if (!Array.isArray(tasks) || !tasks.every(task => task && typeof task.id === 'string' && typeof task.title === 'string' && typeof task.description === 'string' && Array.isArray(task.dependencies) && task.dependencies.every(dep => typeof dep === 'string'))) throw new Error('invalid tasks');
    // Validate and bind the replacement before retiring the original preview.
    const replacement = this.stage(entry.sessionId, entry.runtime, { task: entry.request.task, acceptance: entry.request.acceptance, roster, tasks }, entry.workspaceRoot, entry.availableProviders);
    this.reject(id);
    return replacement;
  }

  /** Only recorded artifacts, confined by real paths; diff is workspace evidence against Git HEAD. */
  artifact(id: string, taskId: string, index: number) {
    const entry = this.stages.get(id);
    const file = entry?.runtime.getStage(id).tasks.find(task => task.id === taskId)?.result?.artifacts[index];
    if (!entry?.workspaceRoot || !file) throw new Error('artifact not found');
    const root = fs.realpathSync(entry.workspaceRoot);
    const target = fs.realpathSync(path.resolve(root, file));
    const relative = path.relative(root, target);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('artifact outside workspace');
    const fd = fs.openSync(target, 'r');
    let content: string;
    try {
      const stat = fs.fstatSync(fd);
      const current = fs.realpathSync(target);
      const currentRelative = path.relative(root, current);
      if (currentRelative.startsWith(`..${path.sep}`) || currentRelative === '..' || path.isAbsolute(currentRelative)) throw new Error('artifact outside workspace');
      const identity = fs.statSync(current);
      if (identity.dev !== stat.dev || identity.ino !== stat.ino) throw new Error('artifact changed during open');
      if (!stat.isFile() || stat.size > 65536) throw new Error('artifact must be a text file up to 64 KiB');
      const bytes = Buffer.alloc(stat.size); fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (bytes.includes(0)) throw new Error('binary artifact');
      content = bytes.toString('utf8');
    } finally { fs.closeSync(fd); }
    let diff: string;
    try {
      const tracked = execFileSync('git', ['--literal-pathspecs', 'ls-files', '--', relative], { cwd: root, encoding: 'utf8', maxBuffer: 131072, windowsHide: true }).trim();
      diff = tracked ? execFileSync('git', ['--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--', relative], { cwd: root, encoding: 'utf8', maxBuffer: 262144, windowsHide: true })
        : `--- /dev/null\n+++ ${relative}\n${content.split('\n').map(line => `+${line}`).join('\n')}`;
    } catch { diff = 'Git comparison unavailable for this workspace.'; }
    return { path: relative, content, diff: diff.slice(0, 65536), comparison: 'Current workspace against Git HEAD' };
  }

  approve(id: string): void {
    const entry = this.stages.get(id);
    if (!entry) throw new Error(`unknown stage: ${id}`);
    if (entry.runtime.getStage(id).status !== 'staged') throw new Error('stage is not awaiting approval');
    const run = entry.runtime.approve(id).catch((err: unknown) => {
      entry.error = err instanceof Error ? err.message : String(err);
    }).finally(() => { this.runs.delete(run); this.onStatus?.(id, entry.runtime.getStage(id).status); });
    this.runs.add(run);
  }

  reject(id: string): void {
    const entry = this.stages.get(id);
    if (!entry) throw new Error(`unknown stage: ${id}`);
    entry.runtime.reject(id); this.onStatus?.(id, 'rejected');
  }
  async close(): Promise<void> { await Promise.allSettled(this.runs); }
}
