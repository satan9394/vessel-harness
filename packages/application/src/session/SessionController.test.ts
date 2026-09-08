import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { SessionController } from './SessionController.js';
import { SessionRegistry } from './SessionRegistry.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const POLICY = path.join(REPO_ROOT, 'configs', 'policy.default.yaml');
const BEHAVIOR = path.join(REPO_ROOT, 'configs', 'behavior.default.yaml');

describe('SessionController', () => {
  let dir: string;
  let ws: string;
  let home: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-ctl-'));
    ws = path.join(dir, 'workspace');
    home = path.join(dir, 'vessel-home');
    fs.mkdirSync(ws, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('create → runTurn → state → close works with a mock provider', async () => {
    const provider = new MockProvider([
      { when: /.*/, ifNoToolResult: true, response: { text: 'HELLO-CONTROLLED' } },
    ], { model: 'mock-model' });

    const ctl = await SessionController.create({
      workspaceRoot: ws,
      provider,
      model: 'mock-model',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      permission: 'read-only',
    });

    expect(ctl.state.workspaceRoot).toBe(path.resolve(ws));
    expect(ctl.state.provider).toBe('mock');
    expect(ctl.state.model).toBe('mock-model');
    expect(ctl.state.permission).toBe('read-only');
    expect(ctl.session.sessionId).toBe(ctl.state.id);

    const result = await ctl.runTurn('打招呼');
    expect(result.finalText).toContain('HELLO-CONTROLLED');

    await ctl.close();
  });

  it('create registers its session in a shared registry', async () => {
    const registry = new SessionRegistry({ vesselHome: home });
    const provider = new MockProvider([{ when: /.*/, response: { text: 'OK' } }], { model: 'm' });

    const ctl = await SessionController.create({
      workspaceRoot: ws,
      provider,
      model: 'm',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      permission: 'workspace-write',
      registry,
    });

    const meta = registry.get(ctl.state.id);
    expect(meta).toBeDefined();
    expect(meta!.workspaceRoot).toBe(path.resolve(ws));
    expect(meta!.provider).toBe('mock');
    expect(meta!.model).toBe('m');
    expect(meta!.permission).toBe('workspace-write');

    await ctl.close();
  });

  it('interrupt()/steer() are safe no-op seams that never crash', async () => {
    const provider = new MockProvider([{ when: /.*/, response: { text: 'OK' } }], { model: 'm' });
    const ctl = await SessionController.create({
      workspaceRoot: ws,
      provider,
      model: 'm',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
    });

    // must not throw
    ctl.interrupt();
    ctl.steer('please keep it short');
    expect(ctl.pendingSteerCount).toBe(1);

    // still fully usable after a steer
    const result = await ctl.runTurn('hi');
    expect(result.finalText).toBeDefined();

    // close also cleans up the abort controller
    await ctl.close();
  });

  it('run with a workspace pin works and session uses the given workspace', async () => {
    const provider = new MockProvider([{ when: /.*/, response: { text: 'PINNED' } }], { model: 'p' });
    const ctl = await SessionController.create({
      workspaceRoot: ws,
      provider,
      model: 'p',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
    });
    expect(ctl.session.workspaceRoot).toBe(path.resolve(ws));
    await ctl.close();
  });
});