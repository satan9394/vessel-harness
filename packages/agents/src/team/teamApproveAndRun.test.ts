import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatProvider, ChatRequest } from '@vessel/shared';
import { compilePolicyYaml } from '@vessel/policy';
import { TeamRuntime } from './TeamRuntime.js';
import type { TeamDagTask } from './dag/types.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const node = (id: string, dependencies: string[] = []): TeamDagTask => ({ id, title: id, description: id, assignedRole: 'generator', dependencies, status: 'pending' });
function runtime(provider: ChatProvider): TeamRuntime {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-staged-')); dirs.push(workspaceRoot);
  return new TeamRuntime({ workspaceRoot, providers: { mock: provider }, tools: [], policyArtifacts: compilePolicyYaml('policy:\n  version: 1\n  profile: workspace-write\n  approval: never') });
}
describe('Approve & Run', () => {
  it('never executes staged plans and ignores caller attempts to rewrite state or topology', async () => {
    const requests: ChatRequest[] = [];
    const team = runtime({ id: 'mock', chat: async req => { requests.push(req); return { content: 'done', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } }; } });
    const tasks = [node('A'), node('B', ['A'])];
    const preview = team.stageTeam({ task: 'build', roster: [{ presetId: 'developer', model: 'm', providerId: 'mock' }], tasks });
    preview.status = 'approved'; preview.tasks[1]!.dependencies = []; preview.tasks[0]!.status = 'completed';
    tasks[0]!.description = 'mutated';
    await Promise.resolve(); expect(requests).toHaveLength(0);
    expect(team.getStage(preview.id).status).toBe('staged');
    const done = await team.approve(preview.id);
    expect(done.status).toBe('finished'); expect(done.tasks.map(t => t.status)).toEqual(['completed', 'completed']);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.messages.some(m => m.content.includes('Dependency results:\ndone'))).toBe(true);
    await expect(team.approve(preview.id)).rejects.toThrow('approval');
  });
  it('runs diamond siblings concurrently on separate members, then executes the join', async () => {
    let release!: () => void;
    const barrier = new Promise<void>(r => { release = r; });
    const calls: string[] = [];
    const team = runtime({ id: 'mock', chat: async req => {
      const prompt = req.messages.filter(m => m.role === 'user').at(-1)!.content;
      const id = ['A', 'B', 'C', 'D'].find(x => prompt.includes(`\n${x}\n${x}\n`))!;
      calls.push(id);
      if (id === 'B') await barrier;
      if (id === 'C') release();
      return { content: id, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } };
    } });
    const plan = team.stageTeam({ task: 'build', roster: [
      { memberId: 'g1', presetId: 'developer', model: 'm', providerId: 'mock' },
      { memberId: 'g2', presetId: 'developer', model: 'm', providerId: 'mock' },
    ], tasks: [node('A'), node('B', ['A']), node('C', ['A']), node('D', ['B', 'C'])] });
    const done = await team.approve(plan.id);
    expect(calls[0]).toBe('A'); expect(new Set(calls.slice(1, 3))).toEqual(new Set(['B', 'C'])); expect(calls[3]).toBe('D');
    expect(done.tasks.every(t => t.status === 'completed')).toBe(true);
  });
  it('rejected plans remain inactive', async () => {
    let calls = 0;
    const team = runtime({ id: 'mock', chat: async () => { calls++; return { content: 'done', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } }; } });
    const stage = team.stageTeam({ task: 'build', roster: [{ presetId: 'developer', providerId: 'mock', model: 'm' }], tasks: [node('A')] });
    team.reject(stage.id); await expect(team.approve(stage.id)).rejects.toThrow('approval'); expect(calls).toBe(0);
  });
  it.each(['not_met', 'error'])('hands generator evidence to evaluator and preserves review %s', async verdict => {
    const requests: ChatRequest[] = [];
    const team = runtime({ id: 'mock', chat: async req => {
      requests.push(req);
      return { content: requests.length === 1 ? 'generator evidence' : verdict === 'error' ? 'invalid review' : '{"verdict":"not_met","reason":"missing assertion","unmet":["test"],"suggestions":["add test"],"evidence":[]}',
        toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } };
    } });
    const preview = team.stageTeam({ task: 'build', acceptance: ['test'], roster: [
      { presetId: 'developer', model: 'm', providerId: 'mock' },
      { presetId: 'reviewer', model: 'm', providerId: 'mock' },
    ], tasks: [node('A'), { ...node('review', ['A']), assignedRole: 'evaluator' }] });
    const done = await team.approve(preview.id);
    const prompt = requests[1]!.messages.map(m => m.content).join('\n');
    expect(prompt).toContain('# Generator 产出\ngenerator evidence');
    expect(prompt).not.toContain('(无 generator 产出可评估)');
    expect(done.tasks[1]!.status).toBe('completed'); expect(done.tasks[1]!.result?.review?.verdict).toBe(verdict);
  });
  it('limits outward result previews while retaining full dependency evidence internally', async () => {
    const requests: ChatRequest[] = [];
    const full = 'evidence '.repeat(200);
    const team = runtime({ id: 'mock', chat: async req => { requests.push(req); return { content: full, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } }; } });
    const preview = team.stageTeam({ task: 'build', roster: [{ presetId: 'developer', model: 'm', providerId: 'mock' }], tasks: [node('A'), node('B', ['A'])] });
    const done = await team.approve(preview.id);
    expect(done.tasks[0]!.result!.output.length).toBeLessThanOrEqual(301);
    expect(requests[1]!.messages.some(m => m.content.includes(full))).toBe(true);
    expect(team.getTaskResult(preview.id, 'A').result?.output).toBe(full);
    const other = team.stageTeam({ task: 'other', roster: [{ presetId: 'developer', model: 'm', providerId: 'mock' }], tasks: [node('C')] });
    expect(() => team.getTaskResult('missing', 'A')).toThrow('unknown stage task');
    expect(() => team.getTaskResult(preview.id, 'missing')).toThrow('unknown stage task');
    expect(() => team.getTaskResult(other.id, 'A')).toThrow('unknown stage task');
    expect(() => team.getTaskResult(preview.id, 'C')).toThrow('unknown stage task');
  });
});
