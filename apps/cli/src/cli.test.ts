import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { main } from './cli.js';
import { composeHarness } from './compose.js';
import { MockProvider } from '@cah/llm';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const POLICY = path.join(REPO_ROOT, 'configs', 'policy.default.yaml');
const BEHAVIOR = path.join(REPO_ROOT, 'configs', 'behavior.default.yaml');

function capture() {
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
  return { logs, restore: () => spy.mockRestore() };
}

describe('CLI (apps/cli)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-cli-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('--help prints usage and exits 0', async () => {
    const { logs, restore } = capture();
    const code = await main(['--help']);
    restore();
    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('用法');
  });

  it('--version prints the version', async () => {
    const { logs, restore } = capture();
    const code = await main(['--version']);
    restore();
    expect(code).toBe(0);
    expect(logs[0]).toContain('cah v0.1.0');
  });

  it('run with mock provider completes read → tool → answer (acceptance 2 smoke)', async () => {
    fs.writeFileSync(path.join(dir, 'README.md'), 'CLI-SMOKE-GOLDEN-77', 'utf8');
    const { logs, restore } = capture();
    const code = await main([
      'run',
      '--workspace', dir,
      '--prompt', '请阅读 README.md 并回答',
      '--policy', POLICY,
      '--behavior', BEHAVIOR,
    ]);
    restore();
    expect(code).toBe(0);
    const out = logs.join('\n');
    expect(out).toContain('CLI-SMOKE-GOLDEN-77'); // final answer reflects real file content
    expect(out).toContain('kind=success');
  });

  it('policy DENY demo: destructive shell command is DENIED + audited, not just prompted (acceptance 3)', async () => {
    const provider = new MockProvider([
      { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Shell', arguments: { command: 'rm -rf ./node_modules' } }] } },
      { when: /.*/, response: { text: '命令被策略引擎拒绝（audit/denial 已记录）。' } },
    ], { model: 'mock', vars: { cwd: dir } });

    const h = await composeHarness({ workspaceRoot: dir, provider, model: 'mock', policySystemPath: POLICY, behaviorIRPath: BEHAVIOR });
    const result = await h.loop.runTurn('删除 node_modules');
    const denials = h.session.replay().filter((r) => r.type === 'audit/denial');
    expect(denials.length).toBeGreaterThanOrEqual(1);
    const d = denials[0] as { ruleRef?: string; reason: string; toolName: string };
    expect(d.toolName).toBe('Shell');
    expect(d.reason).toMatch(/dangerous|denied|删除|deny/i);
    expect(result.finalText).toContain('拒绝');
    // the destructive command was never executed: node_modules dir untouched
    expect(fs.existsSync(path.join(dir, 'node_modules'))).toBe(false);
    await h.close();
  });

  it('V0.4 task routing: taskPrompt routes the session provider/model by category', async () => {
    const pro = new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'ROUTED-TO-PRO' } }], { model: 'claude-pro' });
    const fast = new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'ROUTED-TO-FAST' } }], { model: 'gpt-fast' });
    const tierModel = {
      pro: { providerId: 'pro', model: 'claude-pro' },
      fast: { providerId: 'fast', model: 'gpt-fast' },
      mini: { providerId: 'fast', model: 'mini' },
    };
    const fallback = fast; // never used when routing succeeds

    // implementation task → pro tier → 'pro' provider
    const h = await composeHarness({
      workspaceRoot: dir,
      provider: fallback,
      model: 'fallback',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      taskRouter: {
        providers: { pro, fast },
        tierModel,
        taskPrompt: '请实现一个用户登录功能',
      },
    });
    expect(h.routedCategory).toBe('implementation');
    expect(h.taskRouter).toBeDefined();
    const result = await h.loop.runTurn('继续实现');
    expect(result.finalText).toContain('ROUTED-TO-PRO');
    await h.close();
  });

  it('V0.4 task routing: no taskPrompt keeps the explicit provider/model (backward compatible)', async () => {
    const explicit = new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'EXPLICIT-MODEL' } }], { model: 'pinned' });
    const other = new MockProvider([], { model: 'unused' });
    const h = await composeHarness({
      workspaceRoot: dir,
      provider: explicit,
      model: 'pinned',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      taskRouter: {
        providers: { pro: other, fast: other },
        tierModel: { pro: { providerId: 'pro', model: 'x' }, fast: { providerId: 'fast', model: 'y' }, mini: { providerId: 'fast', model: 'z' } },
        // no taskPrompt → no routing
      },
    });
    expect(h.routedCategory).toBeUndefined();
    const result = await h.loop.runTurn('do something');
    expect(result.finalText).toContain('EXPLICIT-MODEL');
    await h.close();
  });
});
