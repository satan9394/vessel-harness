import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { composeHarness, type ComposedHarness } from './compose.js';

const repo = path.resolve(import.meta.dirname, '../../..');
let root: string;
let harness: ComposedHarness | undefined;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-native-compose-')); });
afterEach(async () => { await harness?.close(); harness = undefined; fs.rmSync(root, { recursive: true, force: true }); });

it('persists native shell outcomes before emitting their observation event', async () => {
  harness = await composeHarness({ workspaceRoot: root, provider: new MockProvider([]), model: 'mock',
    policySystemPath: path.join(repo, 'configs/policy.default.yaml'), behaviorIRPath: path.join(repo, 'configs/behavior.default.yaml'),
    nativeSandbox: { isAvailable: async () => true, execute: async () => ({ stdout: 'offline', stderr: '', exitCode: 0, sandboxed: true, isolationTier: 'bwrap-ns' }) } });
  const observations: unknown[] = [];
  harness.bus.on('audit/sandbox_enforced', payload => {
    observations.push(payload);
    expect(harness!.session.replay()).toContainEqual(payload);
  }, 'test:durable-native-audit');
  const result = await harness.registry.spec('Shell')!.execute({ command: 'echo offline' }, { workspaceRoot: root, cwd: root });
  expect(result.error).toBeUndefined();
  expect(result.content).toBe('offline');
  expect(observations).toHaveLength(1);
  expect(observations[0]).toMatchObject({ type: 'audit/sandbox_enforced', sandboxed: true, isolationTier: 'bwrap-ns', outcome: 'enforced', surface: false });
  await harness.session.flush();
  const file = path.join(root, '.harness', 'sessions', harness.session.sessionId, 'session.jsonl');
  expect(fs.readFileSync(file, 'utf8')).toContain('audit/sandbox_enforced');
});
