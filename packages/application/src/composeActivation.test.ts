import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { BehaviorCompileError } from '@vessel/behavior';
import { Session } from '@vessel/core';
import { composeHarness } from './compose.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

it('releases the session lease after synchronous and asynchronous assembly failures', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-rollback-'));
  const options = {
    workspaceRoot: root, sessionId: 'retry', model: 'mock', memory: { enabled: false },
    provider: new MockProvider([]),
    policySystemPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
    behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
  };
  try {
    await expect(composeHarness({ ...options, adaptivePruning: { tokenThreshold: 100, targetTokenBudget: 0, preserveRecentTurns: 3 } })).rejects.toThrow('adaptivePruning requires symbolGraph');
    expect(fs.existsSync(path.join(root, '.harness', 'sessions', 'retry', '.lease'))).toBe(false);
    const reopened = await Session.open({ workspaceRoot: root, sessionId: 'retry' });
    await reopened.close();
    await expect(composeHarness({ ...options, mods: ['missing-mod'] })).rejects.toThrow();
    expect(fs.existsSync(path.join(root, '.harness', 'sessions', 'retry', '.lease'))).toBe(false);
    const harness = await composeHarness(options);
    await harness.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('rejects an unenforced candidate before session activation and retains the previous runnable harness', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-activation-'));
  const invalidBehavior = path.join(root, 'invalid-behavior.json');
  fs.writeFileSync(invalidBehavior, JSON.stringify({ version: '0.1', entries: [{
    id: 'network-denial', class: 'safety', channel: 'runtime_policy',
    policy_ref: 'network.deny_domains', render: 'Block denied domains.',
  }] }));
  const options = {
    workspaceRoot: root, model: 'mock', memory: { enabled: false },
    provider: new MockProvider([{ when: /.*/, response: { text: 'previous remains runnable' } }], { model: 'mock' }),
    policySystemPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
    behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
  };
  let previous: Awaited<ReturnType<typeof composeHarness>> | undefined;
  try {
    previous = await composeHarness({ ...options, sessionId: 'previous' });
    // This candidate must fail compilation rather than attempt to acquire the active lease.
    await expect(composeHarness({ ...options, sessionId: 'previous', behaviorIRPath: invalidBehavior })).rejects.toBeInstanceOf(BehaviorCompileError);
    // An invalid Mod path must remain untouched until mandatory behavior is certified.
    await expect(composeHarness({ ...options, sessionId: 'candidate', behaviorIRPath: invalidBehavior,
      mods: [path.join(root, 'missing-mod')] })).rejects.toBeInstanceOf(BehaviorCompileError);
    expect(fs.existsSync(path.join(path.dirname(previous.session.dir), 'candidate'))).toBe(false);
    expect(await previous.loop.runTurn('task')).toMatchObject({ kind: 'success', finalText: 'previous remains runnable' });
    const accepted = await composeHarness({ ...options, sessionId: 'candidate' });
    await accepted.close();
  } finally {
    await previous?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
