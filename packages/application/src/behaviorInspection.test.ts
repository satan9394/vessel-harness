import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { it, expect } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { BehaviorCompileError } from '@vessel/behavior';
import { composeHarness } from './compose.js';

it('binds activated L2 to provider capabilities and rejects an incompatible model candidate before dispatch', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-behavior-model-'));
  const behavior = path.join(root, 'behavior.json');
  fs.writeFileSync(behavior, JSON.stringify({ version: '1', entries: [{ id: 'deny-shell', class: 'safety', channel: 'runtime_policy',
    render: 'Deny destructive shell operations', policy_ref: 'shell.deny', requiredCapabilities: { tools: true } }] }));
  const provider = new MockProvider([]);
  const harness = await composeHarness({ workspaceRoot: root, provider, model: 'mock', memory: { enabled: false },
    policySystemPath: path.resolve('configs/policy.default.yaml'), behaviorIRPath: behavior });
  try {
    const snapshot = harness.behaviorInspection;
    expect(snapshot.layers[2]!.snapshot).toMatchObject({ modelProfile: { provider: 'mock', model: 'mock' } });
    const unavailable = { id: 'unknown', chat: async () => { throw new Error('transport must not run'); } };
    expect(() => harness.validateBehaviorModel(unavailable, 'other')).toThrow(BehaviorCompileError);
    expect(harness.behaviorInspection.snapshotHash).toBe(snapshot.snapshotHash);
    const binding = { providerId: 'unknown', model: 'other' };
    await expect(composeHarness({ workspaceRoot: root, provider, model: 'mock', memory: { enabled: false },
      policySystemPath: path.resolve('configs/policy.default.yaml'), behaviorIRPath: behavior,
      taskRouter: { providers: { unknown: unavailable }, tierModel: { pro: binding, fast: binding, mini: binding }, mode: 'pro' },
    })).rejects.toThrow(BehaviorCompileError);
  } finally { await harness.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
