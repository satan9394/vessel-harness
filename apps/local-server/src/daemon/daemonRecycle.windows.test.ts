import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recycleDaemonPath } from './daemonLifecycle.js';
import { MockProvider } from '@vessel/llm';
import { SessionController } from '@vessel/application';

describe.runIf(process.platform === 'win32')('Windows native recycling', () => {
  let root: string;

  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-native-recycle-')); });
  afterEach(() => {
    // Only this test's own system-temp fixture is permanently cleaned up.
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('recycles a Unicode and apostrophe path through Windows PowerShell', async () => {
    const target = path.join(root, "会话's fixture");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'session.jsonl'), '{}\n');
    await recycleDaemonPath(target);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(root)).toBe(true);
  }, 30_000);

  it('closes the actual session writer before native recycling', async () => {
    const controller = await SessionController.create({
      workspaceRoot: root, provider: new MockProvider([{ when: /.*/, response: { text: 'fixture reply' } }]),
      model: 'mock', policySystemPath: path.resolve('configs/policy.default.yaml'),
      behaviorIRPath: path.resolve('configs/behavior.default.yaml'),
    });
    const target = path.dirname(controller.session.logPath);
    try {
      await controller.runTurn('hello');
      await expect(recycleDaemonPath(target)).rejects.toThrow('recycle failed');
      expect(fs.existsSync(target)).toBe(true);
    } finally { await controller.close(); }
    await recycleDaemonPath(target);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(root)).toBe(true);
  }, 30_000);
});
