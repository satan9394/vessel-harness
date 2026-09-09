import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { main, startServe } from './cli.js';
import * as cli from './cli.js';
import { composeHarness } from '@vessel/application';
import { MockProvider } from '@vessel/llm';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const POLICY = path.join(REPO_ROOT, 'configs', 'policy.default.yaml');
const BEHAVIOR = path.join(REPO_ROOT, 'configs', 'behavior.default.yaml');

function capture() {
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
  return { logs, restore: () => spy.mockRestore() };
}

/** Capture both stdout (console.log) and stderr (console.error). */
function captureBoth() {
  const logs: string[] = [];
  const spyLog = vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
  const spyErr = vi.spyOn(console, 'error').mockImplementation((...a) => logs.push(a.join(' ')));
  return { logs, restore: () => { spyLog.mockRestore(); spyErr.mockRestore(); } };
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
    expect(logs[0]).toContain('Vessel CLI v0.10.0');
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

describe('CLI provider/models commands (task 016/015)', () => {
  let cfgDir: string;
  let oldRoot: string | undefined;

  beforeEach(() => {
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-pcfg-'));
    oldRoot = process.env.VESSEL_PROVIDER_ROOT;
    process.env.VESSEL_PROVIDER_ROOT = cfgDir;
  });
  afterEach(() => {
    if (oldRoot === undefined) delete process.env.VESSEL_PROVIDER_ROOT;
    else process.env.VESSEL_PROVIDER_ROOT = oldRoot;
    // isolated temp cfg dir — same cleanup convention as the rest of the suite
    fs.rmSync(cfgDir, { recursive: true, force: true });
  });

  it('provider list shows built-in mock and current defaults to mock', async () => {
    const { logs, restore } = capture();
    const code = await main(['provider', 'list']);
    restore();
    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('mock');
    expect(logs.join('\n')).toContain('*');
  });

  it('provider add + switch + current round-trip', async () => {
    const addLogs: string[] = [];
    const spyAdd = vi.spyOn(console, 'log').mockImplementation((...a) => addLogs.push(a.join(' ')));
    const code1 = await main(['provider', 'add', 'ds', '--protocol', 'openai-compatible', '--base-url', 'https://api.deepseek.com/v1', '--api-key', 'sk-x', '--model', 'deepseek-chat']);
    spyAdd.mockRestore();
    expect(code1).toBe(0);
    expect(addLogs.join('\n')).toContain('已添加');
    const code2 = await main(['provider', 'switch', 'ds']);
    expect(code2).toBe(0);
    const { logs, restore } = capture();
    const code3 = await main(['provider', 'current']);
    restore();
    expect(code3).toBe(0);
    expect(logs[0]).toBe('ds');
  });

  it('provider add without base-url for a real protocol fails with exit 2', async () => {
    const code = await main(['provider', 'add', 'bad', '--protocol', 'anthropic', '--model', 'claude-x']);
    expect(code).toBe(2);
  });

  it('provider remove refuses to remove built-in mock', async () => {
    const code = await main(['provider', 'remove', 'mock']);
    expect(code).toBe(1);
  });

  it('models with no provider (current=mock) prints the offline note and exits 0', async () => {
    const { logs, restore } = capture();
    const code = await main(['models']);
    restore();
    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('mock');
  });

  it('models for an anthropic provider falls back to the built-in list', async () => {
    await main(['provider', 'add', 'ant', '--protocol', 'anthropic', '--base-url', 'https://api.anthropic.com', '--api-key', 'k', '--model', 'claude-sonnet-4']);
    await main(['provider', 'switch', 'ant']);
    const { logs, restore } = capture();
    const code = await main(['models']);
    restore();
    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('claude');
    expect(logs.join('\n')).toContain('内置清单');
  });
});

describe('V0.7 permission modes — three-level policy enforcement (task 022)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-perm-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  async function runWithPermission(permission: string, toolScript: { name: string; arguments: Record<string, unknown> }[]): Promise<{ finalText: string; denials: number; toolCalls: number }> {
    const provider = new MockProvider([
      { when: /.*/, ifNoToolResult: true, response: { toolCalls: toolScript } },
      { when: /.*/, response: { text: 'DONE-AFTER-TOOL' } },
    ], { model: 'mock', vars: { cwd: dir } });
    const h = await composeHarness({
      workspaceRoot: dir, provider, model: 'mock',
      policySystemPath: POLICY, behaviorIRPath: BEHAVIOR,
      permission: permission as 'read-only' | 'workspace-write' | 'danger-full-access',
    });
    const result = await h.loop.runTurn('做个操作');
    const denials = h.session.replay().filter((r) => r.type === 'audit/denial').length;
    const toolCalls = h.session.replay().filter((r) => r.type === 'tool/call').length;
    await h.close();
    return { finalText: result.finalText, denials, toolCalls };
  }

  it('read-only denies a Write tool call (write not allowed under read-only profile)', async () => {
    const r = await runWithPermission('read-only', [{ name: 'Write', arguments: { path: 'x.txt', content: 'y' } }]);
    expect(r.denials).toBeGreaterThanOrEqual(1);
  });

  it('read-only allows a Read tool call', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hi', 'utf8');
    const r = await runWithPermission('read-only', [{ name: 'Read', arguments: { path: 'a.txt' } }]);
    expect(r.denials).toBe(0);
    expect(r.toolCalls).toBeGreaterThanOrEqual(1);
  });

  it('workspace-write (default) allows a Write tool call', async () => {
    const w = await runWithPermission('workspace-write', [{ name: 'Write', arguments: { path: 'ok.txt', content: 'x' } }]);
    expect(w.denials).toBe(0);
    expect(w.toolCalls).toBeGreaterThanOrEqual(1);
  });
});

describe('V0.9 usage/pricing commands (task 031)', () => {
  let cfgDir: string;
  let oldRoot: string | undefined;
  beforeEach(() => {
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-usage-cmd-'));
    oldRoot = process.env.VESSEL_USAGE_ROOT;
    process.env.VESSEL_USAGE_ROOT = cfgDir;
  });
  afterEach(() => {
    if (oldRoot === undefined) delete process.env.VESSEL_USAGE_ROOT;
    else process.env.VESSEL_USAGE_ROOT = oldRoot;
    fs.rmSync(cfgDir, { recursive: true, force: true });
  });

  it('vessel usage shows empty stats when nothing recorded', async () => {
    const { logs, restore } = capture();
    const code = await main(['usage']);
    restore();
    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('使用统计');
    expect(logs.join('\n')).toContain('调用 0');
  });

  it('vessel pricing lists catalog and queries a single model', async () => {
    const { logs, restore } = capture();
    const code = await main(['pricing']);
    restore();
    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('模型价目');
    const { logs: logs2, restore: restore2 } = capture();
    const code2 = await main(['pricing', 'claude-sonnet-4-5']);
    restore2();
    expect(code2).toBe(0);
    expect(logs2.join('\n')).toContain('claude-sonnet-4-5');
    expect(logs2.join('\n')).toContain('$3');
  });

  it('vessel pricing shows the normalized match for a namespaced/dated model (task 085)', async () => {
    const { logs, restore } = capture();
    const code = await main(['pricing', 'openrouter/anthropic/claude-sonnet-4-5-20250929']);
    restore();
    expect(code).toBe(0);
    const out = logs.join('\n');
    expect(out).toContain('claude-sonnet-4-5');
    expect(out).toContain('归一匹配');
  });

  it('vessel usage flags estimated entries + source distribution (task 086)', async () => {
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(cfgDir, 'usage.json'),
      JSON.stringify({
        version: 1,
        entries: {
          'deepseek::deepseek-chat': {
            model: 'deepseek-chat', provider: 'deepseek', inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0,
            calls: 1, costUsd: 0.27, estimated: false, estimatedCostUsd: 0, pricingSource: 'model', lastTs: now, events: 1,
          },
          'unknown::zzz': {
            model: 'zzz', provider: 'unknown', inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0,
            calls: 1, costUsd: 0.5, estimated: true, estimatedCostUsd: 0.5, pricingSource: 'default', lastTs: now, events: 1,
          },
        },
        recent: [],
      }),
      'utf8',
    );
    const { logs, restore } = capture();
    const code = await main(['usage']);
    restore();
    expect(code).toBe(0);
    const out = logs.join('\n');
    expect(out).toContain('价格来源分布');
    expect(out).toContain('含估算条目 1 条');
    expect(out).toContain('model 1条');
  });

  it('vessel usage --strict reports unpriced models without the fallback (task 086)', async () => {
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(cfgDir, 'usage.json'),
      JSON.stringify({
        version: 1,
        entries: {
          'deepseek::deepseek-chat': {
            model: 'deepseek-chat', provider: 'deepseek', inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0,
            calls: 1, costUsd: 0.27, estimated: false, estimatedCostUsd: 0, pricingSource: 'model', lastTs: now, events: 1,
          },
          'unknown::zzz': {
            model: 'zzz', provider: 'unknown', inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0,
            calls: 1, costUsd: 0.5, estimated: true, estimatedCostUsd: 0.5, pricingSource: 'default', lastTs: now, events: 1,
          },
        },
        recent: [],
      }),
      'utf8',
    );
    const { logs, restore } = capture();
    const code = await main(['usage', '--strict']);
    restore();
    expect(code).toBe(0);
    const out = logs.join('\n');
    expect(out).toContain('--strict 审计');
    expect(out).toContain('未收录模型 1 条');
    expect(out).toContain('0.2700'); // strict 口径只剩 model 级条目
  });

  // ---- task 089：本地日窗口 / 按日列出 ----
  const dayKey = (d: Date): string =>
    `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
  const dailyBucket = (costUsd: number, calls: number) => ({
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd,
    calls,
    estimatedCostUsd: 0,
    cacheWriteDerivedCostUsd: 0,
    firstTs: '2026-01-01T01:00:00.000Z',
    lastTs: '2026-01-01T01:00:00.000Z',
  });
  /** 写入一份带 daily 分桶的 v2 usage.json（前两天完整、今天未完整）。 */
  function writeDailyUsageFile(): { before: string; yesterday: string; today: string } {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const before = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
    fs.writeFileSync(
      path.join(cfgDir, 'usage.json'),
      JSON.stringify({
        version: 2,
        entries: {
          'anthropic::claude-sonnet-4-5': {
            model: 'claude-sonnet-4-5', provider: 'anthropic',
            inputTokens: 3000, outputTokens: 600, cacheReadTokens: 0, cacheCreationTokens: 1_000_000,
            calls: 4, costUsd: 4.5,
            costBreakdown: { inputUsd: 0.009, outputUsd: 0.009, cacheReadUsd: 0, cacheWriteUsd: 3.75 },
            cacheWriteDerivedCostUsd: 0, cacheWriteDerived: false,
            estimated: false, estimatedCostUsd: 0, pricingSource: 'model',
            lastTs: now.toISOString(), events: 4,
          },
        },
        recent: [],
        daily: {
          [dayKey(before)]: dailyBucket(1, 1),
          [dayKey(yesterday)]: dailyBucket(2, 2),
          [dayKey(today)]: dailyBucket(1.5, 1),
        },
      }),
      'utf8',
    );
    return { before: dayKey(before), yesterday: dayKey(yesterday), today: dayKey(today) };
  }

  it('vessel usage --by-day lists local-day buckets and splits complete/partial days (task 089)', async () => {
    const { before, yesterday, today } = writeDailyUsageFile();
    const { logs, restore } = capture();
    const code = await main(['usage', '--by-day', '--since', before, '--until', today]);
    restore();
    expect(code).toBe(0);
    const out = logs.join('\n');
    expect(out).toContain('时间窗口（本地日，含首含尾）');
    expect(out).toContain('完整本地日合计: 2 天');
    expect(out).toContain('未完整本地日（今天/未来，不计入上面合计）: 1 天');
    expect(out).toContain(before);
    expect(out).toContain(yesterday);
    expect(out).toContain(`${today}（未完整）`);
    expect(out).toContain('按日:');
    expect(out).toContain('$3.0000'); // 完整两日合计 1 + 2
  });

  it('vessel usage prints the cost breakdown incl. cache write (task 090)', async () => {
    writeDailyUsageFile();
    const { logs, restore } = capture();
    const code = await main(['usage']);
    restore();
    expect(code).toBe(0);
    const out = logs.join('\n');
    expect(out).toContain('成本分项: input');
    expect(out).toContain('cacheWrite $3.7500');
    expect(out).toContain('今日（本地日');
    expect(out).toContain('本月（');
  });

  it('vessel usage --since rejects a malformed date with exit 2 (task 089)', async () => {
    const { logs, restore } = captureBoth();
    const code = await main(['usage', '--since', '2026-13-40']);
    restore();
    expect(code).toBe(2);
    expect(logs.join('\n')).toContain('--since');
  });

  it('vessel usage notes a legacy file without daily buckets (task 089 migration)', async () => {
    fs.writeFileSync(
      path.join(cfgDir, 'usage.json'),
      JSON.stringify({
        version: 1,
        entries: {
          'deepseek::deepseek-chat': {
            model: 'deepseek-chat', provider: 'deepseek', inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0,
            calls: 1, costUsd: 0.27, estimated: false, estimatedCostUsd: 0, pricingSource: 'model',
            lastTs: new Date().toISOString(), events: 1,
          },
        },
        recent: [],
      }),
      'utf8',
    );
    const { logs, restore } = capture();
    const code = await main(['usage']);
    restore();
    expect(code).toBe(0);
    const out = logs.join('\n');
    expect(out).toContain('无本地日分桶');
    expect(out).toContain('历史条目 1 条无成本分项');
  });
});

describe('vessel bench-report (task 083 dashboard)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-br-')); });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });

  function runResultsJson(harnesses: string[]): string {
    const arr = harnesses.map((h, i) => ({
      adapterId: h,
      adapterVersion: '1.0.0',
      fixtureId: 'B001',
      metrics: {
        success: i % 2 === 0,
        wallTimeMs: 100 + i,
        toolCalls: 2, invalidCalls: 0, retries: 0,
        inputTokens: 50, outputTokens: 20, cacheReadTokens: 5,
        costUsd: 0.01 + i / 100, contextPeak: 70, compactions: 0,
        humanIntervention: 0, policyViolations: 0, resumeSuccess: false,
      },
      startedAt: '2026-09-08T00:00:00.000Z',
    }));
    const p = path.join(dir, 'runs.json');
    fs.writeFileSync(p, JSON.stringify(arr), 'utf8');
    return p;
  }

  it('bench-report without --input fails with exit 2', async () => {
    const { logs, restore } = captureBoth();
    const code = await main(['bench-report']);
    restore();
    expect(code).toBe(2);
    expect(logs.join('\n')).toContain('bench-report 需要 --input');
  });

  it('bench-report reads RunResult[] and prints dashboard summary + writes md/json', async () => {
    const runs = runResultsJson(['vessel', 'dsh', 'opencode']);
    const out = path.join(dir, 'reports');
    const { logs, restore } = capture();
    const code = await main(['bench-report', '--input', runs, '--out', out]);
    restore();
    expect(code).toBe(0);
    const joined = logs.join('\n');
    expect(joined).toContain('totals:');
    expect(joined).toContain('vessel');
    expect(joined).toContain('dsh');
    expect(joined).toContain('opencode');
    expect(joined).toContain('B001:');
    // reports written
    const files = fs.readdirSync(out);
    expect(files.some((f) => f.endsWith('.md'))).toBe(true);
    expect(files.some((f) => f.endsWith('.json'))).toBe(true);
  });

  it('bench-report rejects a JSON object that is neither RunResult[] nor a lane report', async () => {
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({ hello: 'world' }), 'utf8');
    const { logs, restore } = captureBoth();
    const code = await main(['bench-report', '--input', bad]);
    restore();
    expect(code).toBe(2);
    expect(logs.join('\n')).toContain('必须是 076 RunResult[] 数组或 082 RealModelLaneReport JSON');
  });
});

describe('vessel serve / vessel web (task 044)', () => {
  // Exported const object; stub its members directly (cmdServe/cmdWeb call them
  // at runtime) and restore them after each test so real serve keeps working.
  let realPark: typeof cli.serveRuntime.park;
  let realOpen: typeof cli.serveRuntime.open;

  beforeEach(() => {
    realPark = cli.serveRuntime.park;
    realOpen = cli.serveRuntime.open;
  });
  afterEach(() => {
    cli.serveRuntime.park = realPark;
    cli.serveRuntime.open = realOpen;
  });

  it('startServe with port 0 binds a real server on 127.0.0.1 and close() frees it', async () => {
    const { logs, restore } = capture();
    const handle = await startServe({ port: 0 });
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(logs.join('\n')).toContain('Vessel local server: http://127.0.0.1:');
    // the bound server is live: hit /api/health over the returned URL
    const res = await fetch(new URL('/api/health', handle.url));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    restore();
    // close() returns normally and frees the port
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it('main dispatch: vessel serve --port 0 starts a real server and parks without hanging', async () => {
    cli.serveRuntime.park = async () => 0;
    const { logs, restore } = capture();
    const code = await main(['serve', '--port', '0']);
    restore();
    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('Vessel local server: http://127.0.0.1:');
  });

  it('main dispatch: vessel web starts the server, opens the browser, and parks', async () => {
    let opened = '';
    cli.serveRuntime.park = async () => 0;
    cli.serveRuntime.open = (url: string) => { opened = url; };
    const { logs, restore } = capture();
    const code = await main(['web', '--port', '0']);
    restore();
    expect(code).toBe(0);
    expect(opened).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(logs.join('\n')).toContain('Vessel local server:');
  });

  it('help text mentions vessel serve and vessel web', async () => {
    const { logs, restore } = capture();
    const code = await main(['--help']);
    restore();
    expect(code).toBe(0);
    const out = logs.join('\n');
    expect(out).toContain('vessel serve');
    expect(out).toContain('vessel web');
  });
});

describe('vessel usage recompute / pricing override (task 091/092)', () => {
  let cfgDir: string;
  let oldRoot: string | undefined;
  beforeEach(() => {
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-091-cmd-'));
    oldRoot = process.env.VESSEL_USAGE_ROOT;
    process.env.VESSEL_USAGE_ROOT = cfgDir;
  });
  afterEach(() => {
    if (oldRoot === undefined) delete process.env.VESSEL_USAGE_ROOT;
    else process.env.VESSEL_USAGE_ROOT = oldRoot;
    fs.rmSync(cfgDir, { recursive: true, force: true });
  });

  const usageFile = (): string => path.join(cfgDir, 'usage.json');
  const overrideFile = (): string => path.join(cfgDir, 'pricing.override.json');
  const readJson = (file: string): Record<string, never> => JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, never>;

  /** 一条被旧价钉死的历史条目（costUsd 9.99 ≠ 当前 deepseek-chat 价 0.27+1.1）。 */
  function writeStaleUsage(): void {
    fs.writeFileSync(
      usageFile(),
      JSON.stringify({
        version: 2,
        entries: {
          'deepseek::deepseek-chat': {
            model: 'deepseek-chat', provider: 'deepseek',
            inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0,
            calls: 1, costUsd: 9.99,
            costBreakdown: { inputUsd: 9.99, outputUsd: 0, cacheReadUsd: 0, cacheWriteUsd: 0 },
            cacheWriteDerivedCostUsd: 0, cacheWriteDerived: false,
            estimated: false, estimatedCostUsd: 0, pricingSource: 'model',
            lastTs: new Date().toISOString(), events: 1,
          },
        },
        recent: [], daily: {},
      }, null, 2),
      'utf8',
    );
  }

  it('vessel usage recompute 按当前价目重算并落盘，第二次幂等（无差异）', async () => {
    writeStaleUsage();
    const first = capture();
    const code1 = await main(['usage', 'recompute']);
    first.restore();
    expect(code1).toBe(0);
    const out1 = first.logs.join('\n');
    expect(out1).toContain('按当前价目重算历史成本');
    expect(out1).toContain('已落盘');
    const after = readJson(usageFile()) as unknown as { entries: Record<string, { costUsd: number; pricingSource: string; inputTokens: number }> };
    expect(after.entries['deepseek::deepseek-chat']!.costUsd).toBeCloseTo(1.37, 9); // 当前内置价 0.27 + 1.1
    expect(after.entries['deepseek::deepseek-chat']!.inputTokens).toBe(1_000_000); // token 原样
    expect(after.entries['deepseek::deepseek-chat']!.pricingSource).toBe('model');

    const second = capture();
    const code2 = await main(['usage', 'recompute']);
    second.restore();
    expect(code2).toBe(0);
    expect(second.logs.join('\n')).toContain('无差异');
  });

  it('vessel usage recompute --dry-run 出差异摘要且不落盘', async () => {
    writeStaleUsage();
    const before = fs.readFileSync(usageFile(), 'utf8');
    const { logs, restore } = capture();
    const code = await main(['usage', 'recompute', '--dry-run']);
    restore();
    expect(code).toBe(0);
    const out = logs.join('\n');
    expect(out).toContain('--dry-run：未落盘');
    expect(out).toContain('9.9900'); // 差异摘要里能看到旧金额
    expect(fs.readFileSync(usageFile(), 'utf8')).toBe(before); // 未落盘
  });

  it('vessel usage recompute --since 非法日期 exit 2（与 vessel usage 同一校验）', async () => {
    const { logs, restore } = captureBoth();
    const code = await main(['usage', 'recompute', '--since', '2026-13-40']);
    restore();
    expect(code).toBe(2);
    expect(logs.join('\n')).toContain('--since 需要本地日 YYYY-MM-DD');
  });

  it('vessel pricing override set/list/delete/restore 落盘并驱动查价', async () => {
    const set = capture();
    const codeSet = await main(['pricing', 'override', 'set', 'deepseek-chat', '--input', '0.1', '--output', '0.2', '--cache-read', '0.01']);
    set.restore();
    expect(codeSet).toBe(0);
    expect(set.logs.join('\n')).toContain('已写入覆盖');
    const file = readJson(overrideFile()) as unknown as { models: Record<string, unknown>; deleted: string[] };
    expect(file.models['deepseek-chat']).toEqual({ input: 0.1, output: 0.2, cacheRead: 0.01 });

    const list = capture();
    const codeList = await main(['pricing', 'override', 'list']);
    list.restore();
    expect(codeList).toBe(0);
    const outList = list.logs.join('\n');
    expect(outList).toContain('deepseek-chat');
    expect(outList).toContain('加载优先级: override > 内置 pricing.json > model-catalog > protocols > default');

    // 目录查询同时显示覆盖（优先级最高）
    const query = capture();
    const codeQuery = await main(['pricing', 'deepseek-chat']);
    query.restore();
    expect(codeQuery).toBe(0);
    expect(query.logs.join('\n')).toContain('用户覆盖');

    const del = capture();
    const codeDel = await main(['pricing', 'override', 'delete', 'deepseek-chat']);
    del.restore();
    expect(codeDel).toBe(0);
    const tombstoned = readJson(overrideFile()) as unknown as { models: Record<string, unknown>; deleted: string[] };
    expect(tombstoned.deleted).toEqual(['deepseek-chat']);
    expect(tombstoned.models['deepseek-chat']).toBeUndefined(); // 覆盖与墓碑互斥

    const back = capture();
    const codeBack = await main(['pricing', 'override', 'restore', 'deepseek-chat']);
    back.restore();
    expect(codeBack).toBe(0);
    expect((readJson(overrideFile()) as unknown as { deleted: string[] }).deleted).toEqual([]);
  });

  it('vessel pricing override set 缺 --input/--output exit 2，非法价不落盘', async () => {
    const missing = captureBoth();
    const codeMissing = await main(['pricing', 'override', 'set', 'deepseek-chat', '--input', '0.1']);
    missing.restore();
    expect(codeMissing).toBe(2);
    expect(missing.logs.join('\n')).toContain('必须给 --input 与 --output');

    const negative = captureBoth();
    const codeNeg = await main(['pricing', 'override', 'set', 'deepseek-chat', '--input', '-1', '--output', '2']);
    negative.restore();
    expect(codeNeg).toBe(2);
    expect(fs.existsSync(overrideFile())).toBe(false);
  });

  it('vessel pricing override repair --file 走值守卫：现值=from 才改，手改过的行不动', async () => {
    const seed = capture();
    await main(['pricing', 'override', 'set', 'claude-sonnet-4-5', '--input', '3', '--output', '15', '--cache-read', '0.3', '--cache-write', '3.75']);
    await main(['pricing', 'override', 'set', 'deepseek-chat', '--input', '0.5', '--output', '5']);
    seed.restore();
    const repairs = path.join(cfgDir, 'repairs.json');
    fs.writeFileSync(repairs, JSON.stringify([
      { key: 'claude-sonnet-4-5', from: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, to: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 } },
      { key: 'deepseek-chat', from: { input: 0.27, output: 1.1 }, to: { input: 0.99, output: 9.9 } },
    ]), 'utf8');

    const { logs, restore } = capture();
    const code = await main(['pricing', 'override', 'repair', '--file', repairs]);
    restore();
    expect(code).toBe(0);
    const out = logs.join('\n');
    expect(out).toContain('已改');
    expect(out).toContain('跳过（现值已被用户改过）');
    expect(out).toContain('共 1/2 条生效');
    const file = readJson(overrideFile()) as unknown as { models: Record<string, { input: number }> };
    expect(file.models['claude-sonnet-4-5']!.input).toBe(4); // 现值 = from → 改
    expect(file.models['deepseek-chat']!.input).toBe(0.5); // 手改值保住
  });

  it('覆盖 + recompute 联动：加了覆盖后 recompute 把历史条目按覆盖价重算', async () => {
    writeStaleUsage();
    const set = capture();
    await main(['pricing', 'override', 'set', 'deepseek-chat', '--input', '0.01', '--output', '0.02']);
    set.restore();
    const { logs, restore } = capture();
    const code = await main(['usage', 'recompute']);
    restore();
    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('override');
    const after = readJson(usageFile()) as unknown as { entries: Record<string, { costUsd: number; pricingSource: string }> };
    expect(after.entries['deepseek::deepseek-chat']!.pricingSource).toBe('override');
    expect(after.entries['deepseek::deepseek-chat']!.costUsd).toBeCloseTo(0.03, 9);
  });
});
