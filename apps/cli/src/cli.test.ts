import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { main, startServe } from './cli.js';
import * as cli from './cli.js';
import { composeHarness } from '@vessel/application';
import { MockProvider } from '@vessel/llm';
import { ProviderStore } from './providers/ProviderStore.js';
import { providerStateRoot } from './providers/defaultStore.js';
import { loadModelCatalog } from './providers/modelCatalog.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const POLICY = path.join(REPO_ROOT, 'configs', 'policy.default.yaml');
const BEHAVIOR = path.join(REPO_ROOT, 'configs', 'behavior.default.yaml');

/** 本地 loopback 端点替身（不发起真实网络）：记录请求头，回一句固定文本（SSE / JSON 都支持）。 */
async function startLoopback(
  marker: string,
): Promise<{ baseUrl: string; seen: http.IncomingHttpHeaders[]; close: () => Promise<void> }> {
  const seen: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      seen.push(req.headers);
      // AgentLoop 是 stream-first：请求带 stream:true 时必须回 SSE，否则正文为空。
      let stream = false;
      try {
        stream = (JSON.parse(raw) as { stream?: boolean }).stream === true;
      } catch {
        stream = false;
      }
      if (stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: marker }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 3, completion_tokens: 2 },
          })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: marker } }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

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
  let cfgDir: string;
  let usageDir: string;
  let oldProviderRoot: string | undefined;
  let oldUsageRoot: string | undefined;
  let oldSessionRoot: string | undefined;

  // task 106 隔离：`main()` 内部的默认 store / usage store 一律落在临时目录，
  // 绝不读写真实 ~/.vessel（否则机器上 current=真实供应商时 run smoke 会打真网络）。
  // G-10 起 `cmdRun` 还会 new SessionRegistry()（无参 = 缺省根），VESSEL_SESSION_ROOT
  // 必须同款钉住，否则这些用例会把测试会话写进真实 ~/.vessel/sessions.json（AGENTS.md §8）。
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-cli-'));
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-cli-cfg-'));
    usageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-cli-usage-'));
    oldProviderRoot = process.env.VESSEL_PROVIDER_ROOT;
    oldUsageRoot = process.env.VESSEL_USAGE_ROOT;
    oldSessionRoot = process.env.VESSEL_SESSION_ROOT;
    process.env.VESSEL_PROVIDER_ROOT = cfgDir;
    process.env.VESSEL_USAGE_ROOT = usageDir;
    process.env.VESSEL_SESSION_ROOT = usageDir; // 会话登记同样落在临时 root（sessions.json 随 usageDir 一起清掉）
  });
  afterEach(() => {
    if (oldProviderRoot === undefined) delete process.env.VESSEL_PROVIDER_ROOT;
    else process.env.VESSEL_PROVIDER_ROOT = oldProviderRoot;
    if (oldUsageRoot === undefined) delete process.env.VESSEL_USAGE_ROOT;
    else process.env.VESSEL_USAGE_ROOT = oldUsageRoot;
    if (oldSessionRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
    else process.env.VESSEL_SESSION_ROOT = oldSessionRoot;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(cfgDir, { recursive: true, force: true });
    fs.rmSync(usageDir, { recursive: true, force: true });
  });

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

  it('③ run 打印 sandbox 状态行：enforcement telemetry 的 reportStatus 生产可达（不再是死 seam）', async () => {
    fs.writeFileSync(path.join(dir, 'README.md'), 'CLI-SANDBOX-STATUS-7', 'utf8');
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
    // 修复前：reportStatus() 全仓只在测试里被调用 ⇒ snapshot().status() 恒 undefined
    // ⇒ 这两行永不出现（用户既看不到"生效"也看不到"未生效"）。本用例就是那个负对照。
    expect(out).toContain('安全执法遥测');
    expect(out).toContain('状态: backend=none');
    expect(out).toContain('active=false');
    expect(out).toContain('degraded='); // machine-readable "why confinement was not in force"
    // fallbackReason 文案随平台不同（win32 = 尚未附加；非 win32 = passthrough）
    expect(out).toMatch(/backend not attached yet|backend not active on this platform/);
  });

  it('② run 只读 VESSEL_PROVIDER_ROOT 临时 root：临时 current.json 决定 provider（不读真实 ~/.vessel）', async () => {
    const endpoint = await startLoopback('CLI-106-MARKER');
    try {
      // 临时 root 里放一个 loopback provider 并设为当前：若 run 读的是真实 ~/.vessel，
      // 这个端点永远收不到请求（真实 root 的 current 是 mock 或真实供应商）。
      fs.writeFileSync(
        path.join(cfgDir, 'providers.json'),
        JSON.stringify([
          { id: 'iso106', name: 'iso106', protocol: 'openai-compatible', baseUrl: endpoint.baseUrl, model: 'm' },
        ]),
        'utf8',
      );
      fs.writeFileSync(path.join(cfgDir, 'current.json'), JSON.stringify({ id: 'iso106' }), 'utf8');

      const { logs, restore } = capture();
      const code = await main([
        'run', '--workspace', dir, '--prompt', 'ping',
        '--policy', POLICY, '--behavior', BEHAVIOR,
      ]);
      restore();

      expect(code).toBe(0);
      expect(endpoint.seen.length).toBeGreaterThanOrEqual(1); // 临时 root 的 provider 真的被用了
      expect(logs.join('\n')).toContain('CLI-106-MARKER');
      // 默认 store / 状态根都指向临时目录（不是真实 ~/.vessel）
      expect(providerStateRoot()).toBe(cfgDir);
      expect(new ProviderStore({}).rootDir).toBe(cfgDir);
      // usage 也落在临时 root（不写真实 ~/.vessel/usage.json）
      expect(fs.existsSync(path.join(usageDir, 'usage.json'))).toBe(true);
    } finally {
      await endpoint.close();
    }
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
  let oldSessionRoot: string | undefined;
  let oldUsageRoot: string | undefined;

  beforeEach(() => {
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-pcfg-'));
    oldRoot = process.env.VESSEL_PROVIDER_ROOT;
    oldSessionRoot = process.env.VESSEL_SESSION_ROOT;
    oldUsageRoot = process.env.VESSEL_USAGE_ROOT;
    process.env.VESSEL_PROVIDER_ROOT = cfgDir;
    // G-10：`main()` 的默认 SessionRegistry 根同样钉到临时目录（不写真实 ~/.vessel/sessions.json）。
    process.env.VESSEL_SESSION_ROOT = cfgDir;
    // Round 20：`vessel models` 的价格注解现在会先看**用户态** catalog
    // （`<VESSEL_USAGE_ROOT>/model-catalog.json`）——同样钉住，否则会读真实 ~/.vessel。
    process.env.VESSEL_USAGE_ROOT = cfgDir;
  });
  afterEach(() => {
    if (oldRoot === undefined) delete process.env.VESSEL_PROVIDER_ROOT;
    else process.env.VESSEL_PROVIDER_ROOT = oldRoot;
    if (oldSessionRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
    else process.env.VESSEL_SESSION_ROOT = oldSessionRoot;
    if (oldUsageRoot === undefined) delete process.env.VESSEL_USAGE_ROOT;
    else process.env.VESSEL_USAGE_ROOT = oldUsageRoot;
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
  let oldSessionRoot: string | undefined;
  beforeEach(() => {
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-usage-cmd-'));
    oldRoot = process.env.VESSEL_USAGE_ROOT;
    oldSessionRoot = process.env.VESSEL_SESSION_ROOT;
    process.env.VESSEL_USAGE_ROOT = cfgDir;
    // G-10：会话登记根一并钉住（这些用例驱动 main()，不能漏到真实 ~/.vessel/sessions.json）。
    process.env.VESSEL_SESSION_ROOT = cfgDir;
  });
  afterEach(() => {
    if (oldRoot === undefined) delete process.env.VESSEL_USAGE_ROOT;
    else process.env.VESSEL_USAGE_ROOT = oldRoot;
    if (oldSessionRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
    else process.env.VESSEL_SESSION_ROOT = oldSessionRoot;
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
  let oldSessionRoot: string | undefined;
  // G-10：本 describe 同样驱动 CLI 入口 main()（默认 store 的汇聚点），会话登记根一并钉住。
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-br-'));
    oldSessionRoot = process.env.VESSEL_SESSION_ROOT;
    process.env.VESSEL_SESSION_ROOT = dir;
  });
  afterEach(() => {
    if (oldSessionRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
    else process.env.VESSEL_SESSION_ROOT = oldSessionRoot;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

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

/**
 * 安装态（tarball / registry 装出来的项目）缺 bench-runners 的失败面。
 *
 * `benchmarks/runners` 是 `"private": true`（永不发布），只在仓库内靠
 * `apps/cli/tsconfig.json` 的 project reference + vitest alias 解析得到；装出来的项目里
 * `vessel run --bench` / `vessel bench-report` 的动态 import 必然 `ERR_MODULE_NOT_FOUND`。
 * 本组锁三件事：① 解析失败 → 人话 + 既有 `fail` 出口（不再是裸模块解析错误）；
 * ② `--json` 下仍是既有的单一 JSON 信封出口；③ **非**解析失败的异常照旧抛出。
 *
 * 注入方式与既有 `serveRuntime` 同款（替换 `cli.benchRunnersRuntime.load`、用完还原）：
 * 判别点在 cli.ts 自己的 catch + fail 出口语义上，不需要用 `vi.mock` 去劫持真实解析。
 */
describe('vessel bench-runners 安装态不可用（private 包不随 npm 包分发）', () => {
  const ROOT_ENV = ['VESSEL_PROVIDER_ROOT', 'VESSEL_USAGE_ROOT', 'VESSEL_SESSION_ROOT'] as const;
  let dir: string;
  let savedRoots: Array<string | undefined>;
  let realLoad: typeof cli.benchRunnersRuntime.load;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-br-missing-'));
    savedRoots = ROOT_ENV.map((k) => process.env[k]);
    for (const k of ROOT_ENV) process.env[k] = dir;
    realLoad = cli.benchRunnersRuntime.load;
  });
  afterEach(() => {
    cli.benchRunnersRuntime.load = realLoad;
    ROOT_ENV.forEach((k, i) => {
      const prev = savedRoots[i];
      if (prev === undefined) delete process.env[k];
      else process.env[k] = prev;
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** 安装态实测同款：Node ESM 解析不到「不存在的包」时报的错。 */
  function failResolution(): void {
    cli.benchRunnersRuntime.load = () => Promise.reject(
      Object.assign(
        new Error(
          "Cannot find package '@vessel/bench-runners' imported from /tmp/installed/node_modules/@vessel/cli/dist/cli.js",
        ),
        { code: 'ERR_MODULE_NOT_FOUND' },
      ),
    );
  }

  /** stdout / stderr 分开收集（既有 `capture()` 只收 console.log）。 */
  function captureStreams() {
    const out: string[] = [];
    const err: string[] = [];
    const spyLog = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
    const spyErr = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
    return { out, err, restore: () => { spyLog.mockRestore(); spyErr.mockRestore(); } };
  }

  function writeRuns(): string {
    const p = path.join(dir, 'runs.json');
    fs.writeFileSync(p, JSON.stringify([]), 'utf8');
    return p;
  }

  it('run --bench 解析失败 → 人话 + exit 2（不再抛裸 ERR_MODULE_NOT_FOUND）', async () => {
    failResolution();
    const { out, err, restore } = captureStreams();
    let code: number;
    try {
      code = await main(['run', '--bench', 'B001']);
    } finally {
      restore();
    }
    expect(code).toBe(2);
    const text = [...out, ...err].join('\n');
    expect(text).toContain('需要在本仓库内以源码方式运行');
    expect(text).toContain('不随 npm 包分发');
    expect(text).toContain('npx tsx apps/cli/src/cli.ts run --bench');
    expect(text).not.toContain('ERR_MODULE_NOT_FOUND');
  });

  it('bench-report 解析失败 → 同一人话出口 + exit 2', async () => {
    failResolution();
    const runs = writeRuns();
    const { out, err, restore } = captureStreams();
    let code: number;
    try {
      code = await main(['bench-report', '--input', runs]);
    } finally {
      restore();
    }
    expect(code).toBe(2);
    const text = [...out, ...err].join('\n');
    expect(text).toContain('需要在本仓库内以源码方式运行');
    expect(text).toContain('不随 npm 包分发');
    expect(text).toContain('npx tsx apps/cli/src/cli.ts bench-report --input');
  });

  it('--json：解析失败走既有 fail 信封（stderr 单一合法 JSON、code=2），stdout 零输出', async () => {
    failResolution();
    const runs = writeRuns();
    const { out, err, restore } = captureStreams();
    let code: number;
    try {
      code = await main(['bench-report', '--input', runs, '--json']);
    } finally {
      restore();
    }
    expect(code).toBe(2);
    // output.ts 的契约：失败信封只进 stderr，stdout 只留给成功文档（此处零输出）
    expect(out).toEqual([]);
    expect(err).toHaveLength(1);
    const doc = JSON.parse(err[0]!) as { error: { message: string; code: number } };
    expect(Object.keys(doc)).toEqual(['error']);
    expect(doc.error.code).toBe(2);
    expect(doc.error.message).toContain('不随 npm 包分发');
  });

  it('负对照：非解析失败的异常照旧抛出（非 --json 下 main() reject，未被吞掉）', async () => {
    cli.benchRunnersRuntime.load = () => Promise.reject(new Error('runners exploded'));
    const runs = writeRuns();
    await expect(main(['bench-report', '--input', runs])).rejects.toThrow('runners exploded');
  });

  it('负对照：非解析失败的异常在 --json 下走 main() 兜底信封（code=1，不是新出口的 2）', async () => {
    cli.benchRunnersRuntime.load = () => Promise.reject(new Error('runners exploded'));
    const runs = writeRuns();
    const { out, err, restore } = captureStreams();
    let code: number;
    try {
      code = await main(['bench-report', '--input', runs, '--json']);
    } finally {
      restore();
    }
    expect(code).toBe(1);
    expect(out).toEqual([]);
    const doc = JSON.parse(err[0]!) as { error: { code: number } };
    expect(doc.error.code).toBe(1);
  });
});

describe('vessel serve / vessel web (task 044)', () => {
  // Exported const object; stub its members directly (cmdServe/cmdWeb call them
  // at runtime) and restore them after each test so real serve keeps working.
  let realPark: typeof cli.serveRuntime.park;
  let realOpen: typeof cli.serveRuntime.open;
  // G-10：startServe → createVesselServer 会 `new SessionRegistry()`（缺省根）；
  // 这里同样钉住会话登记根，serve 用例绝不写真实 ~/.vessel/sessions.json。
  let sessionDir: string;
  let oldSessionRoot: string | undefined;

  beforeEach(() => {
    realPark = cli.serveRuntime.park;
    realOpen = cli.serveRuntime.open;
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-cli-serve-session-'));
    oldSessionRoot = process.env.VESSEL_SESSION_ROOT;
    process.env.VESSEL_SESSION_ROOT = sessionDir;
  });
  afterEach(() => {
    cli.serveRuntime.park = realPark;
    cli.serveRuntime.open = realOpen;
    if (oldSessionRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
    else process.env.VESSEL_SESSION_ROOT = oldSessionRoot;
    fs.rmSync(sessionDir, { recursive: true, force: true });
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
  let oldSessionRoot: string | undefined;
  beforeEach(() => {
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-091-cmd-'));
    oldRoot = process.env.VESSEL_USAGE_ROOT;
    oldSessionRoot = process.env.VESSEL_SESSION_ROOT;
    process.env.VESSEL_USAGE_ROOT = cfgDir;
    // G-10：会话登记根一并钉住（这些用例驱动 main()，不能漏到真实 ~/.vessel/sessions.json）。
    process.env.VESSEL_SESSION_ROOT = cfgDir;
  });
  afterEach(() => {
    if (oldRoot === undefined) delete process.env.VESSEL_USAGE_ROOT;
    else process.env.VESSEL_USAGE_ROOT = oldRoot;
    if (oldSessionRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
    else process.env.VESSEL_SESSION_ROOT = oldSessionRoot;
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

describe('vessel pricing sync / provider costMultiplier (task 093/094)', () => {
  let dir: string;
  let oldProviderRoot: string | undefined;
  let oldUsageRoot: string | undefined;
  let oldSessionRoot: string | undefined;

  const MODELS_DEV_FIXTURE = {
    anthropic: {
      id: 'anthropic',
      models: {
        'claude-sonnet-4-5': {
          id: 'claude-sonnet-4-5',
          limit: { context: 200000, output: 64000 },
          cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
        },
      },
    },
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-093-cmd-'));
    oldProviderRoot = process.env.VESSEL_PROVIDER_ROOT;
    oldUsageRoot = process.env.VESSEL_USAGE_ROOT;
    oldSessionRoot = process.env.VESSEL_SESSION_ROOT;
    process.env.VESSEL_PROVIDER_ROOT = dir;
    process.env.VESSEL_USAGE_ROOT = dir;
    // G-10：会话登记根同样钉到临时 dir（main() 的默认 SessionRegistry 不碰真实 ~/.vessel）。
    process.env.VESSEL_SESSION_ROOT = dir;
  });
  afterEach(() => {
    if (oldProviderRoot === undefined) delete process.env.VESSEL_PROVIDER_ROOT;
    else process.env.VESSEL_PROVIDER_ROOT = oldProviderRoot;
    if (oldUsageRoot === undefined) delete process.env.VESSEL_USAGE_ROOT;
    else process.env.VESSEL_USAGE_ROOT = oldUsageRoot;
    if (oldSessionRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
    else process.env.VESSEL_SESSION_ROOT = oldSessionRoot;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** 本地 HTTP 服务充当 models.dev（不依赖真实网络）。 */
  async function withLocalModelsDev<T>(fn: (url: string) => Promise<T>): Promise<T> {
    const server = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(MODELS_DEV_FIXTURE));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      return await fn(`http://127.0.0.1:${port}/api.json`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  /**
   * 独立重算**默认写目标**（Round 20 起 = 实现里 `resolveUsageRoot()` 的口径；本 describe 已把
   * `VESSEL_USAGE_ROOT` 钉到 `dir`）——仅供前提校验，不共用实现代码。
   */
  function defaultSyncTarget(): string {
    return path.join(dir, 'model-catalog.json');
  }

  /**
   * 同时捕获 stdout（`console.log`）与 warn（`console.warn`），并保留**事件顺序**——
   * 「写盘前 warn」这一语义只能靠顺序断言锁住（分开两个数组就丢了先后）。
   */
  function captureOrdered() {
    const events: { kind: 'log' | 'warn'; text: string }[] = [];
    const spyLog = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => events.push({ kind: 'log', text: a.join(' ') }));
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => events.push({ kind: 'warn', text: a.join(' ') }));
    return {
      events,
      logs: (): string[] => events.filter((e) => e.kind === 'log').map((e) => e.text),
      warns: (): string[] => events.filter((e) => e.kind === 'warn').map((e) => e.text),
      restore: (): void => {
        spyLog.mockRestore();
        spyWarn.mockRestore();
      },
    };
  }

  it('pricing sync --dry-run 只打印差异、不写盘', async () => {
    const catalogPath = path.join(dir, 'model-catalog.json');
    const out = await withLocalModelsDev(async (url) => {
      const cap = capture();
      const code = await main(['pricing', 'sync', '--catalog', catalogPath, '--url', url, '--dry-run']);
      cap.restore();
      return { code, text: cap.logs.join('\n') };
    });
    expect(out.code).toBe(0);
    expect(out.text).toContain('vessel pricing sync');
    expect(out.text).toContain('新增 1');
    expect(out.text).toContain('--dry-run：未写盘');
    expect(fs.existsSync(catalogPath)).toBe(false);
  });

  it('pricing sync 写盘后二次同步幂等（无变更、文件不变）', async () => {
    const catalogPath = path.join(dir, 'model-catalog.json');
    await withLocalModelsDev(async (url) => {
      const first = capture();
      const code1 = await main(['pricing', 'sync', '--catalog', catalogPath, '--url', url]);
      first.restore();
      expect(code1).toBe(0);
      expect(first.logs.join('\n')).toContain('已写入');
      const written = fs.readFileSync(catalogPath, 'utf8');
      expect(written).toContain('models.dev');
      expect(fs.existsSync(`${catalogPath}.tmp`)).toBe(false);

      const second = capture();
      const code2 = await main(['pricing', 'sync', '--catalog', catalogPath, '--url', url]);
      second.restore();
      expect(code2).toBe(0);
      expect(second.logs.join('\n')).toContain('无变更');
      expect(fs.readFileSync(catalogPath, 'utf8')).toBe(written);
    });
  });

  it('pricing sync 拉取失败：保留旧表、exit 1、不静默清空', async () => {
    const catalogPath = path.join(dir, 'model-catalog.json');
    fs.writeFileSync(catalogPath, JSON.stringify({ version: 1, source: 'old', models: [{ model: 'keep-me', provider: 'acme', priceIn: 1, priceOut: 2 }] }), 'utf8');
    const before = fs.readFileSync(catalogPath, 'utf8');
    const cap = capture();
    // 127.0.0.1:1 必然连接失败（不发起外网请求）
    const code = await main(['pricing', 'sync', '--catalog', catalogPath, '--url', 'http://127.0.0.1:1/api.json']);
    cap.restore();
    expect(code).toBe(1);
    const text = cap.logs.join('\n');
    expect(text).toContain('⚠ 拉取/解析失败');
    expect(text).toContain('保留旧表 1 条');
    expect(fs.readFileSync(catalogPath, 'utf8')).toBe(before);
  });

  /**
   * 终评 B-⑤（EVALUATION-REPORT-24 第 ⑤ 条）**调用点盲点闭合**（Round 20 改判据）：
   * `pricingSyncMismatchWarning` 此前只被纯函数表驱动断言（cli.builtinConfigRoot.test.ts 第 5 条），
   * 而 `cmdPricingSync` 里真正的调用点（写盘前的 `if (mismatch !== null) console.warn(mismatch)`）
   * **零覆盖**——把那两行删掉，"warn 永不触发"没有任何测试会变红。本例在**调用点**上锁定它：
   * 真跑 `pricing sync`（models.dev 用本地 loopback 替身，**零真实网络**）并捕获 `console.warn`。
   *   ① 正例：`--catalog <临时目录>/…`（写目录 ≠ **用户态目录** `VESSEL_USAGE_ROOT=dir`）→ warn
   *      **恰好 1 条**，含写入路径 / 用户态目录 / 后果 / `--catalog` 补救，且**在「已写入」之前**；
   *   ② 负对照：不传 `--catalog`（默认目标 = 用户态目录，与判据右侧**同处**）→ warn **0 条**
   *      （证明 ① 不是恒定值——判据恒真 / 恒假的实现都会在这里或 ① 变红）。
   * 注：② 带 `--dry-run` 是为了让"负对照"不写盘；默认目标已是临时 `VESSEL_USAGE_ROOT`（不再碰
   * 仓库 `configs/`），dry-run 只是额外的安全冗余。守卫在 `syncModelCatalog` 之前执行，与是否
   * dry-run 无关，故覆盖力不受影响。
   */
  it('pricing sync 调用点：--catalog 与用户态目录不同 → 写盘前恰 1 条 warn；默认目标 → 0 条', async () => {
    const readDir = dir; // 本机实际最高优先级读取位置 = VESSEL_USAGE_ROOT（本 describe 已钉住）
    const catalogPath = path.join(dir, 'nested', 'model-catalog.json'); // 写目标在别处，且父目录尚不存在
    // 前提校验（判别力前提）：两个目录确实不同、判据此刻确实非 null，否则本例无从谈起
    expect(path.resolve(path.dirname(catalogPath))).not.toBe(path.resolve(readDir));
    expect(cli.pricingSyncMismatchWarning(catalogPath, readDir)).not.toBeNull();

    // 隔离加码（本用例局部）：settings / mcp 根同样钉进临时目录，绝不碰真实 ~/.vessel
    const savedSettings = process.env.VESSEL_SETTINGS_ROOT;
    const savedMcp = process.env.VESSEL_MCP_ROOT;
    process.env.VESSEL_SETTINGS_ROOT = dir;
    process.env.VESSEL_MCP_ROOT = dir;
    try {
      await withLocalModelsDev(async (url) => {
        // ① 正例：真跑 sync（远端 = 本地 loopback，不发起外网请求）
        const cap = captureOrdered();
        let code = 0;
        try {
          code = await main(['pricing', 'sync', '--catalog', catalogPath, '--url', url]);
        } finally {
          cap.restore();
        }
        expect(code).toBe(0); // 守卫只 warn：不改退出码
        expect(fs.existsSync(catalogPath)).toBe(true); // 写盘真的发生了（排除「提前退出才恰好 1 条」）

        const warns = cap.warns();
        expect(warns).toHaveLength(1); // 写目录 ≠ 用户态目录 → 恰好 1 条（删掉守卫 → 0 条，RED）
        expect(warns[0]).toContain(path.resolve(catalogPath)); // 写入的绝对路径
        expect(warns[0]).toContain(readDir); // 用户态（最高优先级）读取目录
        expect(warns[0]).toContain('不会被读到'); // 后果
        expect(warns[0]).toContain('--catalog'); // 补救一
        expect(warns[0]).toContain('pricing override'); // 补救二（不再是"写入 node_modules 才生效"那类失效指引）

        // 顺序锁：warn 必须在「已写入」之前（守卫语义 = **真正写盘之前**把话说清）
        const warnAt = cap.events.findIndex((e) => e.kind === 'warn');
        const wroteAt = cap.events.findIndex((e) => e.kind === 'log' && e.text.includes('已写入'));
        expect(wroteAt).toBeGreaterThan(-1); // 前提：这条路径确实打印了「已写入」
        expect(warnAt).toBeLessThan(wroteAt);

        // ② 负对照：不传 --catalog（默认写目标 = 用户态目录 == 判据右侧）→ 0 条
        const devTarget = defaultSyncTarget();
        expect(cli.pricingSyncMismatchWarning(devTarget, readDir)).toBeNull(); // 前提：此刻两者同值
        const quiet = captureOrdered();
        let codeDev = 0;
        try {
          codeDev = await main(['pricing', 'sync', '--url', url, '--dry-run']); // dry-run：连临时用户态目录也不写
        } finally {
          quiet.restore();
        }
        expect(codeDev).toBe(0);
        expect(quiet.logs().join('\n')).toContain('--dry-run：未写盘'); // 前提：这条路确实跑到了
        expect(quiet.warns()).toHaveLength(0); // 负对照：判据为 null → 一条都不许打（恒 warn 的实现 → RED）
      });
    } finally {
      if (savedSettings === undefined) delete process.env.VESSEL_SETTINGS_ROOT;
      else process.env.VESSEL_SETTINGS_ROOT = savedSettings;
      if (savedMcp === undefined) delete process.env.VESSEL_MCP_ROOT;
      else process.env.VESSEL_MCP_ROOT = savedMcp;
    }
  });

  /**
   * Round 20 AC3 + AC4（默认写目标 / 零噪音 / 读写同源）：不传 `--catalog` 时写的是**用户态目录**
   * （`resolveUsageRoot()` = 本 describe 的 `dir`），不再在 cwd（旧实现 = `repoRoot()`）里造 `configs/`，
   * 而且**写进去的那份就是 `loadModelCatalog` 下次读到的最高优先级层**（读写同源 = 本卡正题）。
   *
   * 判别性（删掉实现哪条会红）：
   *   - 把 `cmdPricingSync` 的默认目标改回 `path.join(repoRoot(), 'configs', 'model-catalog.json')`
   *     → ① `<dir>/model-catalog.json` 不存在（RED）② `<cwdTmp>/configs/model-catalog.json` 被写出（RED）
   *     ③ 读回的是包内快照（100+ 条）而不是刚同步的 1 条（RED）；
   *   - 把 `loadModelCatalogDetailed` 的用户态层删掉 → ③ 同样变红（读不到刚同步的那份）。
   * 为了让「删掉实现」时的失败**不污染仓库真实 catalog**，本用例把 cwd 临时切到空目录：
   * 旧实现会把 `configs/` 造在那里（可检出），而不是写进仓库。
   */
  it('Round20 AC3/AC4：pricing sync 默认写用户态目录（不在 cwd 建 configs/），写完即读得到且零 warn', async () => {
    // 用户态根用**尚不存在**的嵌套目录：顺带验证「目录不存在 → mkdirSync(recursive) 创建」
    const freshRoot = path.join(dir, 'fresh-usage-root');
    const userCatalog = path.join(freshRoot, 'model-catalog.json');
    expect(fs.existsSync(freshRoot)).toBe(false); // 前提：目录确实还不存在
    const savedUsageRoot = process.env.VESSEL_USAGE_ROOT;
    const savedSettings = process.env.VESSEL_SETTINGS_ROOT;
    const savedMcp = process.env.VESSEL_MCP_ROOT;
    process.env.VESSEL_USAGE_ROOT = freshRoot;
    process.env.VESSEL_SETTINGS_ROOT = dir;
    process.env.VESSEL_MCP_ROOT = dir;
    const cwdTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-093-cwd-'));
    const savedCwd = process.cwd();
    const cap = captureOrdered();
    try {
      await withLocalModelsDev(async (url) => {
        process.chdir(cwdTmp); // cwd 隔离（旧实现的 repoRoot() 会往这里落盘：可检出且不污染仓库）
        const code = await main(['pricing', 'sync', '--url', url]); // 无 --catalog、非 dry-run
        expect(code).toBe(0);
      });

      // ⚠ 位置不变量：以下断言**全部依赖 `VESSEL_USAGE_ROOT=freshRoot` 仍然生效**（读回的 catalog、
      // cwd 空目录对照都以此为据），因此必须留在 `try` 内、在 `finally` 还原 env / 删 `cwdTmp` **之前**：
      //   - 把 ③ 的 `loadModelCatalog(...)` 挪到 `finally` 之后 → env 已回落默认 usage 根（`~/.vessel`）
      //     → 无用户态 catalog → 按设计回落**包内内置目录** → 读到 27 条而非刚同步的 1 条（RED）。
      //   - 把 ② 的 cwd 对照挪到 `finally` 之后 → `cwdTmp` 已被 `rmSync` 删除 → 断言恒真（判别力归零）；
      //     留在 `try` 内才真的能检出「旧实现往 cwd 造 configs/」。
      expect(cap.warns()).toHaveLength(0); // AC4：默认路径零噪音（判据/调用点没跟着改 → 这里 1 条，RED）
      // AC3：写在用户态目录（且根目录由写入方按需创建），**不在 cwd 里凭空造 configs/**（旧实现写的正是后者）
      expect(fs.existsSync(userCatalog)).toBe(true);
      expect(fs.readFileSync(userCatalog, 'utf8')).toContain('models.dev');
      expect(fs.existsSync(path.join(cwdTmp, 'configs', 'model-catalog.json'))).toBe(false);
      // 读写同源（AC1 的端到端版）：sync 写下的那份就是 loadModelCatalog 读到的最高优先层
      const loaded = loadModelCatalog(cli.builtinConfigRoot());
      expect(loaded.models.map((m) => m.model)).toEqual(['claude-sonnet-4-5']);
      expect(loaded.source).toContain('models.dev');
    } finally {
      cap.restore();
      process.chdir(savedCwd);
      fs.rmSync(cwdTmp, { recursive: true, force: true });
      if (savedUsageRoot === undefined) delete process.env.VESSEL_USAGE_ROOT;
      else process.env.VESSEL_USAGE_ROOT = savedUsageRoot;
      if (savedSettings === undefined) delete process.env.VESSEL_SETTINGS_ROOT;
      else process.env.VESSEL_SETTINGS_ROOT = savedSettings;
      if (savedMcp === undefined) delete process.env.VESSEL_MCP_ROOT;
      else process.env.VESSEL_MCP_ROOT = savedMcp;
    }
  });

  it('provider add/set --cost-multiplier 落盘；非法倍率 exit 2 不落盘', async () => {
    const add = capture();
    const codeAdd = await main(['provider', 'add', 'proxy', '--protocol', 'openai-compatible', '--base-url', 'https://proxy.example/v1', '--model', 'gpt-5.1', '--cost-multiplier', '1.5']);
    add.restore();
    expect(codeAdd).toBe(0);
    expect(add.logs.join('\n')).toContain('costMultiplier=1.5');
    const providersFile = path.join(dir, 'providers.json');
    const persisted = JSON.parse(fs.readFileSync(providersFile, 'utf8')) as { id: string; costMultiplier?: number }[];
    expect(persisted[0]?.costMultiplier).toBe(1.5);

    const set = capture();
    const codeSet = await main(['provider', 'set', 'proxy', '--cost-multiplier', '2']);
    set.restore();
    expect(codeSet).toBe(0);
    expect(set.logs.join('\n')).toContain('总额 = 分项合计 × 倍率');

    const list = capture();
    await main(['provider', 'list']);
    list.restore();
    expect(list.logs.join('\n')).toContain('×2');

    const bad = captureBoth();
    const codeBad = await main(['provider', 'set', 'proxy', '--cost-multiplier', '-1']);
    bad.restore();
    expect(codeBad).toBe(2);
    expect(bad.logs.join('\n')).toContain('非负有限数字');
    const after = JSON.parse(fs.readFileSync(providersFile, 'utf8')) as { costMultiplier?: number }[];
    expect(after[0]?.costMultiplier).toBe(2); // 非法值没改坏已存配置

    const nan = captureBoth();
    const codeNan = await main(['provider', 'add', 'x', '--protocol', 'mock', '--model', 'm', '--cost-multiplier', 'abc']);
    nan.restore();
    expect(codeNan).toBe(2);
  });
});

describe('vessel provider export/import + endpoint (task 095/096)', () => {
  let dir: string;
  let outDir: string;
  let oldRoot: string | undefined;
  let oldSessionRoot: string | undefined;
  const FAKE_KEY = 'sk-fake-cli-export-9876';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-095-cfg-'));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-095-out-'));
    oldRoot = process.env.VESSEL_PROVIDER_ROOT;
    oldSessionRoot = process.env.VESSEL_SESSION_ROOT;
    process.env.VESSEL_PROVIDER_ROOT = dir;
    // G-10：会话登记根同样钉到临时 dir（main() 的默认 SessionRegistry 不碰真实 ~/.vessel）。
    process.env.VESSEL_SESSION_ROOT = dir;
  });

  afterEach(() => {
    if (oldRoot === undefined) delete process.env.VESSEL_PROVIDER_ROOT;
    else process.env.VESSEL_PROVIDER_ROOT = oldRoot;
    if (oldSessionRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
    else process.env.VESSEL_SESSION_ROOT = oldSessionRoot;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  async function addDs(): Promise<void> {
    const code = await main([
      'provider', 'add', 'ds',
      '--protocol', 'openai-compatible',
      '--base-url', 'https://api.deepseek.com/v1',
      '--api-key', FAKE_KEY,
      '--model', 'deepseek-chat',
    ]);
    expect(code).toBe(0);
  }

  it('export --out 写出脱敏 JSON（无明文 key，带 secretRef 占位）', async () => {
    await addDs();
    const outFile = path.join(outDir, 'export.json');
    const cap = capture();
    const code = await main(['provider', 'export', '--out', outFile]);
    cap.restore();
    expect(code).toBe(0);
    const text = fs.readFileSync(outFile, 'utf8');
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain('"apiKey"');
    const parsed = JSON.parse(text) as { kind: string; redacted: boolean; keysRedacted: number; providers: { id: string; secretRef?: string }[] };
    expect(parsed.kind).toBe('vessel-provider-export');
    expect(parsed.redacted).toBe(true);
    expect(parsed.keysRedacted).toBe(1);
    expect(parsed.providers[0]?.secretRef).toBe('credential:vessel/ds');
    expect(fs.existsSync(`${outFile}.tmp`)).toBe(false); // 原子写无残留
  });

  it('export --with-secrets 直接拒绝（exit 2），不产生任何文件', async () => {
    await addDs();
    const outFile = path.join(outDir, 'nope.json');
    const cap = captureBoth();
    const code = await main(['provider', 'export', '--out', outFile, '--with-secrets']);
    cap.restore();
    expect(code).toBe(2);
    expect(cap.logs.join('\n')).toContain('--with-secrets 不支持');
    expect(fs.existsSync(outFile)).toBe(false);
  });

  it('export 无 --out → JSON 打到 stdout；import 合并（默认跳过同名）', async () => {
    await addDs();
    const cap = capture();
    const code = await main(['provider', 'export']);
    cap.restore();
    expect(code).toBe(0);
    const json = cap.logs.join('\n');
    expect(json).not.toContain(FAKE_KEY);
    expect(JSON.parse(json).count).toBe(1);

    const file = path.join(outDir, 'x.json');
    fs.writeFileSync(file, json, 'utf8');
    // 再导入同一个文件 → 同名冲突默认跳过
    const cap2 = captureBoth();
    const code2 = await main(['provider', 'import', file]);
    cap2.restore();
    expect(code2).toBe(0);
    expect(cap2.logs.join('\n')).toContain('跳过 1');
    // 导入后 providers.json 仍无明文 key
    expect(fs.readFileSync(path.join(dir, 'providers.json'), 'utf8')).not.toContain(FAKE_KEY);
  });

  it('import --dry-run 不写盘；--on-conflict overwrite 覆盖字段', async () => {
    const file = path.join(outDir, 'in.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        kind: 'vessel-provider-export',
        version: 1,
        providers: [{ id: 'ds', name: 'DS-new', protocol: 'openai-compatible', baseUrl: 'https://new.example/v1', model: 'deepseek-v4' }],
      }),
      'utf8',
    );
    const dry = capture();
    const codeDry = await main(['provider', 'import', file, '--dry-run']);
    dry.restore();
    expect(codeDry).toBe(0);
    expect(dry.logs.join('\n')).toContain('[dry-run]');
    expect(fs.existsSync(path.join(dir, 'providers.json'))).toBe(false);

    const real = capture();
    const codeReal = await main(['provider', 'import', file, '--on-conflict', 'overwrite']);
    real.restore();
    expect(codeReal).toBe(0);
    const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'providers.json'), 'utf8')) as { id: string; model: string }[];
    expect(persisted[0]?.model).toBe('deepseek-v4');
    // 备份目录已生成
    expect(fs.existsSync(path.join(dir, 'backups'))).toBe(false); // 首次写无旧文件
  });

  it('import 非法 --on-conflict / 读不到文件 → 明确退出码', async () => {
    const bad = captureBoth();
    const codeBad = await main(['provider', 'import', 'whatever.json', '--on-conflict', 'ask']);
    bad.restore();
    expect(codeBad).toBe(2);
    expect(bad.logs.join('\n')).toContain('非法 --on-conflict');

    const missing = captureBoth();
    const codeMissing = await main(['provider', 'import', path.join(outDir, 'nope.json')]);
    missing.restore();
    expect(codeMissing).toBe(1);
    expect(missing.logs.join('\n')).toContain('读不到文件');
  });

  it('endpoint add/list/remove：候选池落盘，baseUrl 不变', async () => {
    await addDs();
    const add = capture();
    const codeAdd = await main(['provider', 'endpoint', 'add', 'ds', 'https://backup.example/v1', '--label', 'backup']);
    add.restore();
    expect(codeAdd).toBe(0);
    expect(add.logs.join('\n')).toContain('现有候选 2 个');

    const list = capture();
    const codeList = await main(['provider', 'endpoint', 'list', 'ds']);
    list.restore();
    expect(codeList).toBe(0);
    const text = list.logs.join('\n');
    expect(text).toContain('https://api.deepseek.com/v1');
    expect(text).toContain('[backup]');

    const remove = capture();
    const codeRemove = await main(['provider', 'endpoint', 'remove', 'ds', 'https://backup.example/v1']);
    remove.restore();
    expect(codeRemove).toBe(0);
    expect(remove.logs.join('\n')).toContain('剩余候选 0 个');
    const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'providers.json'), 'utf8')) as { baseUrl?: string; endpoints?: unknown[] }[];
    expect(persisted[0]?.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(persisted[0]?.endpoints).toBeUndefined();
  });

  it('endpoint test 探测本地端点 → 输出建议但不改默认端点；--set-default 才改', async () => {
    // 两个本地服务：baseUrl 返 503（可达但不可用），候选端点返 200（更快且可用）
    const badServer = http.createServer((_req, res) => { res.statusCode = 503; res.end('nope'); });
    const goodServer = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [] }));
    });
    await new Promise<void>((resolve) => badServer.listen(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => goodServer.listen(0, '127.0.0.1', resolve));
    const badUrl = `http://127.0.0.1:${(badServer.address() as AddressInfo).port}/v1`;
    const goodUrl = `http://127.0.0.1:${(goodServer.address() as AddressInfo).port}/v1`;
    try {
      await main(['provider', 'add', 'svc', '--protocol', 'openai-compatible', '--base-url', badUrl, '--model', 'm']);
      await main(['provider', 'endpoint', 'add', 'svc', goodUrl, '--label', 'local']);

      const cap = capture();
      const code = await main(['provider', 'endpoint', 'test', 'svc', '--timeout', '2000']);
      cap.restore();
      expect(code).toBe(0);
      const text = cap.logs.join('\n');
      expect(text).toContain(`建议：${goodUrl}`);
      expect(text).toContain('未改动默认端点');
      // 默认端点未被自动修改
      let persisted = JSON.parse(fs.readFileSync(path.join(dir, 'providers.json'), 'utf8')) as { baseUrl?: string }[];
      expect(persisted[0]?.baseUrl).toBe(badUrl);

      // 显式 --set-default 才改
      const cap2 = capture();
      const code2 = await main(['provider', 'endpoint', 'test', 'svc', '--set-default', '--timeout', '2000']);
      cap2.restore();
      expect(code2).toBe(0);
      persisted = JSON.parse(fs.readFileSync(path.join(dir, 'providers.json'), 'utf8')) as { baseUrl?: string }[];
      expect(persisted[0]?.baseUrl).toBe(goodUrl);
      expect(fs.readdirSync(path.join(dir, 'backups')).length).toBeGreaterThan(0); // 改默认端点前已备份
    } finally {
      await new Promise<void>((resolve) => badServer.close(() => resolve()));
      await new Promise<void>((resolve) => goodServer.close(() => resolve()));
    }
  });

  it('endpoint test 全不可达 → exit 1 且不写盘', async () => {
    await main(['provider', 'add', 'down', '--protocol', 'openai-compatible', '--base-url', 'http://127.0.0.1:1/v1', '--model', 'm']);
    const before = fs.readFileSync(path.join(dir, 'providers.json'), 'utf8');
    const cap = capture();
    const code = await main(['provider', 'endpoint', 'test', 'down', '--timeout', '500']);
    cap.restore();
    expect(code).toBe(1);
    expect(cap.logs.join('\n')).toContain('全部不可达');
    expect(fs.readFileSync(path.join(dir, 'providers.json'), 'utf8')).toBe(before);
  });

  it('endpoint test 用法错误：无 id 无 --all / --all 配 --set-default → exit 2', async () => {
    const noArgs = captureBoth();
    const codeNoArgs = await main(['provider', 'endpoint', 'test']);
    noArgs.restore();
    expect(codeNoArgs).toBe(2);

    const badAll = captureBoth();
    const codeBadAll = await main(['provider', 'endpoint', 'test', '--all', '--set-default']);
    badAll.restore();
    expect(codeBadAll).toBe(2);
    expect(badAll.logs.join('\n')).toContain('--set-default 需要指定单个');
  });
});
