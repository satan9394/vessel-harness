import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import type { ChatProvider, ChatRequest } from '@vessel/shared';
import { compilePolicyYaml } from '@vessel/policy';
import { TeamRuntime } from './TeamRuntime.js';
import { resolveRoster } from './roster.js';
import { createDefaultPresetRegistry } from '../presets/defaults.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
describe('team model route snapshot', () => {
  it('freezes independent route values at roster resolution', () => {
    const source = { presetId: 'developer', providerId: 'original', model: 'old', reasoningEffort: 'high' as const, temperature: 0.3 };
    const member = resolveRoster([source], createDefaultPresetRegistry())[0]!;
    source.model = 'new'; source.temperature = 1;
    expect(Object.isFrozen(member.routeSnapshot)).toBe(true);
    expect(member.routeSnapshot).toMatchObject({ providerId: 'original', model: 'old', reasoningEffort: 'high', temperature: 0.3 });
  });
  it('rejects invalid execution parameters', () => {
    const source = { presetId: 'developer', model: 'm', providerId: 'p' };
    expect(() => resolveRoster([{ ...source, temperature: NaN }], createDefaultPresetRegistry())).toThrow('temperature');
    expect(() => resolveRoster([{ ...source, temperature: 3 }], createDefaultPresetRegistry())).toThrow('temperature');
    expect(() => resolveRoster([{ ...source, reasoningEffort: 'invalid' as 'high' }], createDefaultPresetRegistry())).toThrow('reasoning');
  });
  it('uses selected provider object, model, reasoning and temperature across global changes and later tasks', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-route-')); dirs.push(workspaceRoot);
    const calls: ChatRequest[] = [];
    const replacement: ChatProvider = { id: 'new', chat: async () => { throw new Error('route drift'); } };
    const providers: Record<string, ChatProvider> = { old: { id: 'old', chat: async req => { calls.push(req); providers.old = replacement; return { content: 'done', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } }; } } };
    const team = new TeamRuntime({ workspaceRoot, providers, tools: [], policyArtifacts: compilePolicyYaml('policy:\n  version: 1\n  profile: workspace-write\n  approval: never') });
    const roster = [{ presetId: 'developer', providerId: 'old', model: 'fixed', reasoningEffort: 'high' as const, temperature: 0.4 }];
    const preview = team.stageTeam({ task: 'build', roster, tasks: ['A', 'B'].map((id, i) => ({ id, title: id, description: id, assignedRole: 'generator', dependencies: i ? ['A'] : [], status: 'pending' })) });
    roster[0]!.model = 'drift'; providers.old = replacement;
    preview.roster[0]!.providerId = 'new'; preview.roster[0]!.routeSnapshot = { providerId: 'new', model: 'drift', snapshottedAt: 0 };
    const done = await team.approve(preview.id);
    expect(done.tasks.every(t => t.status === 'completed')).toBe(true); expect(calls).toHaveLength(2);
    for (const call of calls) expect(call).toMatchObject({ model: 'fixed', reasoningEffort: 'high', temperature: 0.4 });
  });
});
