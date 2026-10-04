import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { composeHarness, type ComposedHarness } from './compose.js';
import { SessionController } from './session/SessionController.js';

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

it('projects real offline tool-loop native audits despite after_tool omitting metadata', async () => {
  const controller = await SessionController.create({ workspaceRoot: root, model: 'mock', permission: 'danger-full-access',
    provider: new MockProvider([
      { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Shell', arguments: { command: 'echo offline' } }] } },
      { when: /.*/, minToolResults: 1, response: { text: 'done' } },
    ]),
    policySystemPath: path.join(repo, 'configs/policy.default.yaml'), behaviorIRPath: path.join(repo, 'configs/behavior.default.yaml'),
    nativeSandbox: { isAvailable: async () => false, execute: async () => ({ stdout: 'offline', stderr: '', exitCode: 0, sandboxed: false, isolationTier: 'passthrough-fallback',
      constraints: { readOnlyPaths: [], memoryLimitBytes: null, privilegeReduction: 'No native privilege reduction.' } }) } });
  try {
    await controller.runTurn('Run the offline tool');
    expect(controller.projections.toolActivity.activities()).toMatchObject([{ toolName: 'Shell', status: 'done', sandbox: {
      isolationTier: 'passthrough-fallback', sandboxed: false, outcome: 'fallback', allowedWritePaths: [root, os.tmpdir()], reason: 'native-helper-unavailable',
      constraints: { memoryLimitBytes: null, readOnlyPaths: [] },
    } }]);
  } finally { await controller.close(); }
});
