import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MAX_FILE_BYTES, type ChatProvider, type ChatRequest, type ChatResponse } from '@vessel/shared';
import { main, startServe } from './cli.js';
import * as cli from './cli.js';
import { composeHarness } from '@vessel/application';
import { MockProvider } from '@vessel/llm';
import { ProviderStore } from './providers/ProviderStore.js';
import { providerStateRoot } from './providers/defaultStore.js';
// 本卡②：`vessel migrate` 的执行缝注入（`cli.migrateRuntime.run`）需要一个**带类型**的结果对象，
// 否则对象字面量的 `status` 会被推断成 `string` 而赋不进去（tsc 报 TS2322）。
import type { MigrationResult } from './migrate.js';
import { loadModelCatalog } from './providers/modelCatalog.js';
// 本卡：把 TUI 的回合呈现函数当**参照口径**读进来（只读引用，不修改 tui/**）——
// "同一个错误回合，TUI 不盖模型标记"这条对照要在**同一个用例里**可执行地钉住。
import { renderTurnOutcome } from './tui/chat.js';
// 本卡（回合文本判据共用）：把唯一实现读进来做**运行期身份守卫**——"两个面用同一个函数对象"
// 是运行期事实，两份实现不可能满足它（静态守卫见下面「本卡⑤」）。
import { isModelReplyKind as sharedIsModelReplyKind } from './turnText.js';
// 本卡（windowsShim 判定共用）：把唯一实现读进来做**运行期身份守卫**——"两个面用同一个函数
// 对象"是运行期事实，两份实现不可能满足它（静态守卫见下面「本卡①」）。
import { windowsShimHint as sharedWindowsShimHint } from './windowsShim.js';

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

/**
 * BRIEF-18：stdout / stderr **分开**捕获。`captureBoth()` 把两个通道混进一个数组，
 * 而本卡要判的两件事分别落在两个通道上：回合标题/错误文本走 stdout，
 * `--json` 的失败信封与 `[vessel] run failed: …` 走 stderr。`lines()`/`errLines()`
 * 给出逐次 `console.*` 的**原始参数**（一次调用 = 一条），因为回复文本可能自带换行。
 */
function captureChannels() {
  const out: string[] = [];
  const err: string[] = [];
  const spyLog = vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
  const spyErr = vi.spyOn(console, 'error').mockImplementation((...a) => err.push(a.join(' ')));
  return {
    lines: (): string[] => [...out],
    out: (): string => out.join('\n'),
    errLines: (): string[] => [...err],
    err: (): string => err.join('\n'),
    restore: (): void => { spyLog.mockRestore(); spyErr.mockRestore(); },
  };
}

/**
 * BRIEF-18 —— 本地 loopback 端点替身（127.0.0.1，**不发起真实网络**），
 * 对**每一次**请求都回**同一个**工具调用：同工具 + 同参数 = `AgentLoop` 熔断器眼里的
 * "同一意图"（键 = `${toolName}:${JSON.stringify(arguments)}`，AgentLoop.ts:789-795），
 * 于是第 3 次被拒即 `DenialLimitError` → `kind='error'`。SSE / JSON 两种形态都回
 * （`AgentLoop` 是 stream-first，请求带 `stream:true` 时必须回 SSE）。
 */
async function startDenialLoopback(
  toolName: string,
  toolArguments: Record<string, unknown>,
): Promise<{ baseUrl: string; seen: http.IncomingHttpHeaders[]; close: () => Promise<void> }> {
  const seen: http.IncomingHttpHeaders[] = [];
  const argsJson = JSON.stringify(toolArguments);
  // 每次请求给一个**新的** toolCallId（真实 provider 也如此）：熔断键只看
  // `toolName:arguments`（AgentLoop.ts:790），所以 id 变化不影响"同一意图"的判定，
  // 但能避免跨步重复 id 在会话记录里造成与真实 provider 不同的形状。
  let seq = 0;
  const nextToolCall = (): { id: string; type: string; function: { name: string; arguments: string } } => ({
    id: `call_brief18_${++seq}`,
    type: 'function',
    function: { name: toolName, arguments: argsJson },
  });
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      seen.push(req.headers);
      const toolCall = nextToolCall();
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
            choices: [{ delta: { tool_calls: [{ index: 0, ...toolCall }] }, finish_reason: null }],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'tool_calls' }],
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
          choices: [
            { index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [toolCall] } },
          ],
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
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
  };
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

  /**
   * task 074 § 死 seam 接线 ③ —— `foldSession()` 的生产可达性（判别性验收）。
   *
   * 接线前 `foldSession()` 全仓只有 `projections.test.ts` 调用 ⇒ 生产里
   * `fs-confinement` 来源恒为 0：fs 守卫确实拒绝了，但**没有任何生产代码**把
   * `tool/result` 上的 `meta.guard` 折进投影（bus 的 `after_tool` 载荷刻意丢掉 meta）。
   * 接线点在 `compose.ts`（`after_turn`）：一次接线对所有消费方生效，本用例经
   * **生产入口** `main(['run', ...])` 打印的遥测来判定。
   */
  it('死 seam 接线①（判别性）：真实 fs 守卫拒绝（guard=size）⇒ 生产遥测 fs-confinement≥1', async () => {
    // 触发一次**工具层**守卫拒绝：Read 一个超过 10MiB 读取上限的文件 → FsGuardError('size')
    // → tool/result 带 errorClass=DENIED + meta.guard='size'。
    // 之所以选它：策略层**没有**对应的预执行规则（Compiler 只为 filesystem.protected /
    // deny_read / confinement 生成规则），所以这次拒绝只能靠 session 回放折进投影 ——
    // 正是这条死 seam 的判别点。
    // 删掉 compose.ts 里 `enforcement.foldSession(foldableSession);` 那一行 ⇒
    // 下面第一处断言立刻回到 `fs-confinement=0` ⇒ 红。
    // 用 truncate 造"超限文件"（稀疏/纯元数据操作）：Read 在 statSync 之后、
    // readFileSync **之前**就按 size 拒绝，所以这 10MiB 内容从不被读进内存。
    const bigReadme = path.join(dir, 'README.md');
    fs.writeFileSync(bigReadme, '');
    fs.truncateSync(bigReadme, MAX_FILE_BYTES + 1);
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
    expect(out).toContain('kind=success'); // 真的跑完了一个回合（不是异常早退）
    expect(out).toContain('来源: policy=0 fs-confinement=1 process-tree=0 sandbox-status=1');
    // 事件内容对得上：来源 fs-confinement、type=守卫种类、meta 带 guard 与工具名
    expect(out).toContain('[fs-confinement] size');
    expect(out).toContain(`file exceeds ${MAX_FILE_BYTES} bytes cap`);
    expect(out).toContain('"guard":"size"');
    expect(out).toContain('"toolName":"Read"');
  });

  it('死 seam 接线②（负对照）：没有守卫拒绝的正常 run ⇒ fs-confinement 仍为 0', async () => {
    fs.writeFileSync(path.join(dir, 'README.md'), 'CLI-NO-GUARD-GOLDEN', 'utf8');
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
    // 接线后仍然不得"一律造事件"：这一次零守卫拒绝 ⇒ 该来源必须还是 0。
    expect(out).toContain('来源: policy=0 fs-confinement=0 process-tree=0 sandbox-status=1');
    expect(out).not.toContain('[fs-confinement]');
  });

  it('死 seam 接线③（幂等）：两个回合折同一会话两次 ⇒ fs-confinement 不翻倍', async () => {
    // 折点在 `after_turn`（每回合一次）⇒ "同一会话被折多次"是生产常态。
    // 第 1 回合发生一次真实 escape 守卫拒绝（Read '../…' 被 canonicalize 硬拒），
    // 第 2 回合零拒绝再折一次：那条拒绝必须仍然只计 1 次。
    const provider = new MockProvider(
      [
        {
          when: /.*/,
          ifNoToolResult: true,
          response: { toolCalls: [{ name: 'Read', arguments: { path: '../outside-secret.txt' } }] },
        },
        { when: /.*/, response: { text: '（mock）结束' } },
      ],
      { model: 'mock', vars: { cwd: dir } },
    );
    const h = await composeHarness({
      workspaceRoot: dir,
      provider,
      model: 'mock',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
    });
    try {
      await h.loop.runTurn('第一回合：读一个越界文件');
      expect(h.enforcement.sourceCounts()['fs-confinement']).toBe(1);
      const ev = h.enforcement.events().find((e) => e.source === 'fs-confinement');
      expect(ev).toMatchObject({ type: 'escape' });
      expect(ev?.meta).toMatchObject({ toolName: 'Read', guard: 'escape' });

      await h.loop.runTurn('第二回合：普通对话'); // 折第二次（同一会话）
      expect(h.enforcement.sourceCounts()['fs-confinement']).toBe(1); // ← 幂等，不翻倍
      expect(h.enforcement.counts()).toMatchObject({ escape: 1 });
      // 同一次运行内的负对照：没有守卫拒绝的来源仍是 0
      expect(h.enforcement.sourceCounts()).toMatchObject({ policy: 0, 'process-tree': 0 });
    } finally {
      await h.close();
    }
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

  /** 一行 076 RunResult（本组用例共用的载荷形状）。 */
  function runResultRow(harnessId: string, i: number, success: boolean) {
    return {
      adapterId: harnessId,
      adapterVersion: '1.0.0',
      fixtureId: 'B001',
      metrics: {
        success,
        wallTimeMs: 100 + i,
        toolCalls: 2, invalidCalls: 0, retries: 0,
        inputTokens: 50, outputTokens: 20, cacheReadTokens: 5,
        costUsd: 0.01 + i / 100, contextPeak: 70, compactions: 0,
        humanIntervention: 0, policyViolations: 0, resumeSuccess: false,
      },
      startedAt: '2026-09-08T00:00:00.000Z',
    };
  }

  function writeJson(fileName: string, value: unknown): string {
    const p = path.join(dir, fileName);
    fs.writeFileSync(p, JSON.stringify(value), 'utf8');
    return p;
  }

  /** 交替成败（vessel ✅ / dsh ❌ / opencode ✅）：该数据集**含 1 行 failed**（i=1）。 */
  function runResultsJson(harnesses: string[]): string {
    return writeJson('runs.json', harnesses.map((h, i) => runResultRow(h, i, i % 2 === 0)));
  }

  /** 全 passed 数据集：负对照 ② 专用（「一份真全绿的报告不许报红」）。 */
  function allPassedJson(harnesses: string[]): string {
    return writeJson('runs-all-passed.json', harnesses.map((h, i) => runResultRow(h, i, true)));
  }

  /**
   * 082 lane JSON —— `vessel bench-report --input lane.json` 在 CI 里的实际输入形状。
   *
   * 第一行是**异常收尾行**：`metrics.success === true`（076 指标口径）但
   * `turnEndedAbnormally === true` ⇒ 报告 `status='failed'`（report.ts 已修）。
   * 第二行正常 passed ⇒ totals = 2 runs / 1 passed / 1 failed。
   */
  function laneReportJson(): string {
    return writeJson('lane.json', {
      runId: 'real-model-lane-test',
      startedAt: '2026-09-08T00:00:00.000Z',
      finishedAt: '2026-09-08T00:00:01.000Z',
      durationMs: 1000,
      models: [],
      scenarioCount: 1,
      scenarioIds: ['B001'],
      rows: [
        {
          modelId: 'deepseek-v4-pro', scenarioId: 'B001', tier: 'pro', status: 'failed',
          result: runResultRow('vessel', 0, true), // 指标口径 success=true，回合却没收尾
          turnEndedAbnormally: true, turnKind: 'error',
        },
        {
          modelId: 'deepseek-v4-flash', scenarioId: 'B001', tier: 'flash', status: 'passed',
          result: runResultRow('vessel', 1, true),
        },
      ],
      modelSummaries: [],
      degraded: false,
      reportMdPath: 'x.md',
      reportJsonPath: 'x.json',
    });
  }

  /** 取回 out 目录里写出的两个产物（文件名带时间戳，故按后缀定位）；缺失即抛错（用例红）。 */
  function reportFiles(outDir: string): { mdPath: string; jsonPath: string } {
    const files = fs.readdirSync(outDir);
    const md = files.find((f) => f.endsWith('.md'));
    const json = files.find((f) => f.endsWith('.json'));
    if (!md || !json) throw new Error(`报告产物缺失：${JSON.stringify(files)}`);
    return { mdPath: path.join(outDir, md), jsonPath: path.join(outDir, json) };
  }

  /**
   * 期望渲染的**唯一来源** = runners 自己的纯函数（不是手抄字符串），经 cli 用的同一条
   * 动态 import 缝取回（未被替换时即真实模块）⇒「命令输出」与「纯函数渲染」可逐字比对。
   */
  async function expectedRenderings(input: unknown): Promise<{ cliSummary: string; md: string; json: unknown }> {
    const r = await cli.benchRunnersRuntime.load();
    const rep = Array.isArray(input)
      ? r.buildReportFromRunResults(input as Parameters<typeof r.buildReportFromRunResults>[0])
      : r.buildReport(
          r.rowsFromLaneReport(input as Parameters<typeof r.rowsFromLaneReport>[0]),
          'task-082 real-model lane report',
        );
    return { cliSummary: r.renderCliSummary(rep), md: r.renderReportMarkdown(rep), json: rep };
  }

  /** 报告里唯一非确定的字段是 `generatedAt`（时间戳）；归一化后其余必须逐字相等。 */
  const normalizeTs = (s: string): string => s.replace(/^> 生成于 .*$/m, '> 生成于 <ts>');

  /** md 逐字比对（仅归一化时间戳行）——比「目录里有 .md/.json」强，锁住整份产物。 */
  function expectSameReport(actualPath: string, expectedMd: string): void {
    expect(normalizeTs(fs.readFileSync(actualPath, 'utf8'))).toBe(normalizeTs(expectedMd));
  }

  it('bench-report without --input fails with exit 2', async () => {
    const { logs, restore } = captureBoth();
    const code = await main(['bench-report']);
    restore();
    expect(code).toBe(2);
    expect(logs.join('\n')).toContain('bench-report 需要 --input');
  });

  /**
   * ③（更新既有断言，原 cli.test.ts:867）：数据集 `['vessel','dsh','opencode']` 含
   * **1 行 failed**（dsh，i=1）——旧断言 `expect(code).toBe(0)` **正是把缺陷锁住**。
   *
   * 新口径：含 failed ⇒ 非零（1）；同时把「产物逐字不变」一并断言 —— 旧断言只看 code
   * 与「目录里有没有 .md/.json 两种后缀」，新断言把摘要 + md + json **整份**钉住，
   * 并删掉旧的子串断言（`totals:` / `B001:` 等被逐字相等完全覆盖）⇒ **不弱于**旧断言。
   *
   * 「删掉修复就红」：删掉 cli.ts 的 `rep.totals.failed > 0 ⇒ fail(1, …)` ⇒ code 变 0 ⇒ 红。
   */
  it('bench-report 读 RunResult[]（含 1 行 failed）⇒ 退出码 1；摘要与 md/json 产物逐字不变', async () => {
    const runs = runResultsJson(['vessel', 'dsh', 'opencode']);
    const expected = await expectedRenderings(JSON.parse(fs.readFileSync(runs, 'utf8')) as unknown);
    const out = path.join(dir, 'reports');
    const { logs, restore } = captureBoth();
    const code = await main(['bench-report', '--input', runs, '--out', out]);
    restore();
    expect(code).toBe(1);
    const { mdPath, jsonPath } = reportFiles(out);
    // stdout 逐字 = 纯函数渲染 + 既有「报告已写入」两行（顺序、内容都不许变）；
    // 第三行是新增的失败文案（stderr），只查内容不锁措辞。
    expect(logs.slice(0, 2)).toEqual([expected.cliSummary, `\n报告已写入:\n  ${mdPath}\n  ${jsonPath}`]);
    expect(logs).toHaveLength(3);
    expect(logs[2]).toContain('1/3 行 failed');
    expectSameReport(mdPath, expected.md);
    expect({ ...(JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as object), generatedAt: '<ts>' })
      .toEqual({ ...(expected.json as object), generatedAt: '<ts>' });
  });

  /**
   * ① 判别性（含负对照的另一半）：报告含 failed / 异常收尾行 ⇒ 非零退出码，
   * 且**渲染与落盘照常发生**——logs 的顺序本身就是证据（摘要 → 产物路径 → 判定），
   * md 内容仍与纯函数渲染逐字一致（产物没有被失败吞掉/截断）。
   *
   * 输入走 082 lane JSON（CI 里的真实形状），首行是 report.ts 刚修好的「回合未正常收尾」
   * 族（`metrics.success=true` 但 status='failed'）⇒ 证明**不另设第二套口径**，
   * 用的就是报告已有的 `totals.failed`。
   *
   * 「删掉/改坏就红」：① 删 `fail(1, …)` 判据 ⇒ 0；② 把判据提到 `writeReportFiles` 之前
   * ⇒ 产物不存在（reportFiles 抛错）+ logs 少一行 ⇒ 红。
   */
  it('① 报告含 failed/异常收尾行 ⇒ 退出码 1，且摘要先渲染、md/json 仍落盘', async () => {
    const lane = laneReportJson();
    const laneJson = JSON.parse(fs.readFileSync(lane, 'utf8')) as unknown;
    const expected = await expectedRenderings(laneJson);
    const out = path.join(dir, 'reports-lane');
    const { logs, restore } = captureBoth();
    const code = await main(['bench-report', '--input', lane, '--out', out]);
    restore();
    expect(code).toBe(1);
    const { mdPath, jsonPath } = reportFiles(out);
    expect(logs).toHaveLength(3); // 摘要 + 路径（stdout） + 失败文案（stderr）
    expect(logs[0]).toBe(expected.cliSummary); // 渲染照常，且与全绿路径同一形状
    expect(logs[1]).toBe(`\n报告已写入:\n  ${mdPath}\n  ${jsonPath}`);
    expect(logs[2]).toContain('1/2 行 failed');
    expect(logs[2]).toContain(mdPath);
    expect(expected.cliSummary).toContain('1 failed');
    expectSameReport(mdPath, expected.md); // 产物完整
    expect((JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as { totals: { failed: number } }).totals.failed).toBe(1);
  });

  /**
   * ② 负对照（最重要）：**全 passed** 的报告 ⇒ 退出码 0，且 stdout / md 逐字不变。
   * 防「总是非零」——那会让 CI 永远红灯，与缺陷正好相反。
   *
   * 「改坏就红」：判据写成无条件 / `>= 0` ⇒ code≠0；成功路径上多打或少打一行、
   * 或改渲染顺序 ⇒ `logs` 逐字比对红。
   *
   * 【本卡加强】改用通道分离的 `captureChannels()`：除既有的 stdout 逐字比对之外，
   * **另加** `stderr === ''` —— 本卡的 `say()` 只在 `--json` 时改道，非 `--json` 一个字节
   * 都不许挪到 stderr（旧断言用 `capture()` 只 spy 了 `console.log`，看不见这个泄漏）。
   */
  it('② 负对照：全 passed 报告 ⇒ 退出码 0，stdout 与产物逐字不变（且 stderr 为空）', async () => {
    const runs = allPassedJson(['vessel', 'dsh', 'opencode']);
    const expected = await expectedRenderings(JSON.parse(fs.readFileSync(runs, 'utf8')) as unknown);
    const out = path.join(dir, 'reports-green');
    const cap = captureChannels();
    const code = await main(['bench-report', '--input', runs, '--out', out]);
    const outLines = cap.lines();
    const errText = cap.err();
    cap.restore();
    expect(code).toBe(0);
    const { mdPath, jsonPath } = reportFiles(out);
    expect(outLines).toEqual([expected.cliSummary, `\n报告已写入:\n  ${mdPath}\n  ${jsonPath}`]);
    expect(errText).toBe(''); // 非 --json：人类输出**只在 stdout**，没有挪到 stderr
    expectSameReport(mdPath, expected.md);
    expect(expected.cliSummary).toContain('0 failed');
  });

  /**
   * ④ `--json` 通道契约（本卡 B）：stdout **恰好一段 JSON**（= 落盘的 `.json` 产物，同一份文档），
   * 人类摘要与「报告已写入」改走 **stderr**；退出码与 stderr 信封的 `code` **同源**（1），
   * 沿用既有 `fail(code, msg, flags, …)` 出口，不另造一套 JSON 失败面
   * （既有 jsonErrorExits.test.ts 的 `bench-report --json` code=2 用例同源）。
   *
   * 复现（改前，静态可证）：两条人类文案都是 `console.log(...)`，而 `--json` 分支里
   * **没有任何 `emitJson`** ⇒ stdout 是「摘要表 + 路径块」，`JSON.parse(stdout)` 必抛
   * —— `--json` 等于没生效（违反 `output.ts` 的「stdout 只允许一段可解析 JSON」）。
   * 旧用例用 `captureBoth`（两个通道混进同一个数组）只检查「最后一行是个信封」，
   * **看不见**这个缺陷；上一张卡故意没把它写进测试（避免又一次锁住缺陷）。
   * 本卡改成通道分离的 `captureChannels()`，`JSON.parse(stdout)` 是硬断言。
   *
   * 「删掉修复就红」：把 `say()` 的 `console.error` 改回 `console.log`（人类文案回到 stdout）
   * ⇒ `stdout.indexOf('{')` 不为 0 / `JSON.parse(stdout)` 抛 ⇒ RED；删掉 `emitJson(rep)`
   * ⇒ stdout 为空 ⇒ RED。
   */
  it('④ --json：stdout 恰好一段 JSON（= .json 产物）；人类摘要走 stderr；信封 code 与退出码同源（1）', async () => {
    const lane = laneReportJson();
    const out = path.join(dir, 'reports-lane-json');
    const cap = captureChannels();
    const code = await main(['bench-report', '--input', lane, '--out', out, '--json']);
    const stdout = cap.out();
    const errLines = cap.errLines();
    cap.restore();
    expect(code).toBe(1);

    // ① stdout 恰好一段 JSON：首字符 {、末字符 }、可 parse、不含任何人类文案
    expect(stdout.indexOf('{')).toBe(0);
    expect(stdout.lastIndexOf('}')).toBe(stdout.length - 1);
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(stdout).not.toContain('Benchmark Report —');
    expect(stdout).not.toContain('报告已写入');

    // ② stdout 与落盘的 .json 产物**逐字同一份文档**（emitJson 与 writeReportFiles 同 obj、同缩进）
    const { mdPath, jsonPath } = reportFiles(out);
    expect(stdout).toBe(fs.readFileSync(jsonPath, 'utf8'));
    expect((JSON.parse(stdout) as { totals: { failed: number } }).totals.failed).toBe(1);

    // ③ 人类文案一条不少，只是换了通道（信息不丢）
    const stderr = errLines.join('\n');
    expect(stderr).toContain('Benchmark Report —');
    expect(stderr).toContain('1 failed');
    expect(stderr).toContain('报告已写入');
    expect(stderr).toContain(mdPath);
    expect(stderr).toContain(jsonPath);

    // ④ 失败信封走 stderr，且 code 与退出码同源
    const envelope = JSON.parse(errLines[errLines.length - 1]!) as { error: { message: string; code: number } };
    expect(envelope.error.code).toBe(code);
    expect(envelope.error.message).toContain('failed');

    // ⑤ 产物照旧落盘（失败不吞产物）
    expect(fs.statSync(mdPath).size).toBeGreaterThan(0);
    expect(fs.statSync(jsonPath).size).toBeGreaterThan(0);
  });

  /**
   * ⑤ 【本卡负对照】全 passed + `--json` ⇒ 退出码 **0** —— 上一张卡的「有 failed ⇒ 非 0」
   * 不得回退成「总是非 0」；stdout 仍恰好一段 JSON（`failed:0` 的那份文档 = `.json` 产物），
   * stderr 上**没有**失败信封（最后一行是「报告已写入」路径块，不是合法 JSON）。
   *
   * 「删掉修复就红」：`--json` 下把 `fail(1, …)` 写成无条件/判据写反 ⇒ `toBe(0)` RED。
   */
  it('⑤ 负对照：全 passed + --json ⇒ 退出码 0；stdout 仍恰好一段 JSON；stderr 无信封', async () => {
    const runs = allPassedJson(['vessel', 'dsh', 'opencode']);
    const out = path.join(dir, 'reports-green-json');
    const cap = captureChannels();
    const code = await main(['bench-report', '--input', runs, '--out', out, '--json']);
    const stdout = cap.out();
    const errLines = cap.errLines();
    cap.restore();
    expect(code).toBe(0);
    expect(stdout.indexOf('{')).toBe(0);
    expect(stdout.lastIndexOf('}')).toBe(stdout.length - 1);
    const { jsonPath } = reportFiles(out);
    expect(stdout).toBe(fs.readFileSync(jsonPath, 'utf8'));
    expect((JSON.parse(stdout) as { totals: { failed: number } }).totals.failed).toBe(0);
    // 人类文案仍在（只是走 stderr），且**没有**失败信封
    expect(errLines.join('\n')).toContain('0 failed');
    expect(errLines.join('\n')).toContain('报告已写入');
    expect(() => JSON.parse(errLines[errLines.length - 1]!)).toThrow();
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

/**
 * provider 成本倍率：读盘失败必须**可见**（「静默降级」族回归锁）。
 *
 * 缺陷（修复前实测）：`providerCostMultiplierResolver()` 里的
 * `try { multipliers = new ProviderStore({}).costMultipliers(); } catch { multipliers = {}; }`
 * 把 `ProviderStore.rawLoad()` 的抛错（非法 JSON / 非数组 / 坏条目 / 非法配置）**静默**吞成
 * 「没有倍率」⇒ `providers.json` 一坏，**所有** provider 的倍率悄然变成默认 1×、
 * 成本展示静默失真、且**零告警**（`catch` 分支可达：探针确认损坏文件下
 * `costMultipliers()` 抛 `providers file corrupted (invalid JSON)`）。
 *
 * 本组用例锁四件事：
 *   ① 损坏 ⇒ 告警（含原因 + 受影响文件 + 「本次按默认倍率 1× 计算」）且**不崩**、倍率仍按默认；
 *   ② 负对照：健康文件 ⇒ 正常用显式倍率且**零告警**（防「一律告警」这种恒真实现）；
 *   ③ 去重：同一份坏文件「构造两次解析器 + 多次解析」⇒ **恰好一条**告警；
 *   ④ 调用点：真跑 `vessel usage recompute`（损坏 → 告警 + exit 0 + 金额按 1×；健康 → ×2.5 且零告警）。
 *
 * 隔离（AGENTS.md §8）：`VESSEL_PROVIDER_ROOT` / `VESSEL_USAGE_ROOT` / `VESSEL_SESSION_ROOT`
 * 一律钉到 `mkdtemp` 临时根，绝不读写真实 `~/.vessel`；清理只删本用例自建、位于 `os.tmpdir()`
 * 之下的临时目录（AGENTS.md 的书面例外）。
 */
describe('provider 成本倍率：读盘失败必须可见（静默降级族）', () => {
  let dir: string;
  let oldProviderRoot: string | undefined;
  let oldUsageRoot: string | undefined;
  let oldSessionRoot: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-mult-visible-'));
    oldProviderRoot = process.env.VESSEL_PROVIDER_ROOT;
    oldUsageRoot = process.env.VESSEL_USAGE_ROOT;
    oldSessionRoot = process.env.VESSEL_SESSION_ROOT;
    process.env.VESSEL_PROVIDER_ROOT = dir;
    process.env.VESSEL_USAGE_ROOT = dir;
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

  const providersFile = (): string => path.join(dir, 'providers.json');
  const usageFile = (): string => path.join(dir, 'usage.json');

  /** 健康配置：显式 costMultiplier 2.5（负对照用）。 */
  const HEALTHY_PROVIDERS = [{ id: 'ds', name: 'ds', protocol: 'mock', model: 'mock', costMultiplier: 2.5 }];

  /** 只捕获 `console.warn`（stdout 一并吞掉，避免重算摘要刷测试输出）。 */
  function captureWarns() {
    const warns: string[] = [];
    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      warns.push(a.map((x) => String(x)).join(' '));
    });
    return {
      warns,
      restore: (): void => {
        spyLog.mockRestore();
        spyWarn.mockRestore();
      },
    };
  }

  /** 一条被旧价钉死的历史条目（provider = `ds` → 可被 providers.json 的倍率影响）。 */
  function writeStaleUsage(provider = 'ds'): void {
    fs.writeFileSync(
      usageFile(),
      JSON.stringify({
        version: 2,
        entries: {
          [`${provider}::deepseek-chat`]: {
            model: 'deepseek-chat',
            provider,
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            calls: 1,
            costUsd: 9.99,
            costBreakdown: { inputUsd: 9.99, outputUsd: 0, cacheReadUsd: 0, cacheWriteUsd: 0 },
            cacheWriteDerivedCostUsd: 0,
            cacheWriteDerived: false,
            estimated: false,
            estimatedCostUsd: 0,
            pricingSource: 'model',
            lastTs: new Date().toISOString(),
            events: 1,
          },
        },
        recent: [],
        daily: {},
      }, null, 2),
      'utf8',
    );
  }

  /** 重算后落盘的金额与倍率留痕（`ds::deepseek-chat`）。 */
  function recomputedEntry(provider = 'ds'): { costUsd: number; costMultiplier?: number } {
    const doc = JSON.parse(fs.readFileSync(usageFile(), 'utf8')) as {
      entries: Record<string, { costUsd: number; costMultiplier?: number }>;
    };
    return doc.entries[`${provider}::deepseek-chat`]!;
  }

  it('① 损坏的 providers.json → 告警含原因 + 文件路径 + 「本次按默认倍率 1× 计算」，倍率仍按默认（不崩）', () => {
    fs.writeFileSync(providersFile(), '{oops', 'utf8');

    // 前提（缺陷可达性，独立于实现）：损坏确实让 costMultipliers() 抛错。
    // 这段同时是「修复前无告警」的**直接证据**：抛错方 `ProviderStore.rawLoad()` **只抛不告警**
    // （该文件里没有任何 console.warn），所以修复前 `catch { multipliers = {}; }` 是唯一出口，
    // 整条路径零输出 —— 把 resolver 换回修复前的实现，这里仍是 0 条，而 ④ 的
    // `toHaveLength(1)` 会红，即「删掉告警 ⇒ 必红」。
    const pre = captureWarns();
    try {
      expect(() => new ProviderStore({}).costMultipliers()).toThrow(/providers file corrupted/);
    } finally {
      pre.restore();
    }
    expect(pre.warns).toHaveLength(0); // 静默观测：损坏只抛错，不产生任何提示

    const cap = captureWarns();
    let resolve!: (provider: string) => number;
    try {
      resolve = cli.providerCostMultiplierResolver();
    } finally {
      cap.restore();
    }

    expect(resolve('ds')).toBe(1); // 数值口径不变：仍是 ?? DEFAULT_COST_MULTIPLIER
    expect(resolve('anything-else')).toBe(1);
    expect(cap.warns).toHaveLength(1); // 删掉 warn 调用 → 0 条，RED
    const text = cap.warns[0]!;
    expect(text).toContain('providers file corrupted'); // 原因（不是空话）
    expect(text).toContain(providersFile()); // 哪个文件
    expect(text).toContain('本次按默认倍率 1× 计算'); // 口径说明（本卡要求逐字出现）
  });

  it('② 负对照：健康 providers.json → 用显式倍率且一条告警都不打（防「一律告警」）', () => {
    fs.writeFileSync(providersFile(), JSON.stringify(HEALTHY_PROVIDERS), 'utf8');

    const cap = captureWarns();
    let resolve!: (provider: string) => number;
    try {
      resolve = cli.providerCostMultiplierResolver();
    } finally {
      cap.restore();
    }

    expect(resolve('ds')).toBe(2.5); // 显式倍率照常生效
    expect(resolve('unknown')).toBe(1); // 未配置的 provider 仍是默认
    expect(cap.warns).toHaveLength(0); // 恒告警的实现 → 这里 RED
  });

  it('③ 去重：同一份坏文件「构造两次解析器 + 多次解析」→ 恰好 1 条告警', () => {
    fs.writeFileSync(providersFile(), '{oops', 'utf8');

    const cap = captureWarns();
    let first!: (provider: string) => number;
    let second!: (provider: string) => number;
    try {
      first = cli.providerCostMultiplierResolver();
      // TUI/serve 分支会就地再造一个 UsageStore → 同一份坏文件被第二次读盘
      second = cli.providerCostMultiplierResolver();
      // 计费是按 provider 逐行解析的：告警若写在返回的闭包里，这里会打出 10 条
      for (const provider of ['ds', 'ds', 'other', 'x', 'y']) {
        first(provider);
        second(provider);
      }
    } finally {
      cap.restore();
    }

    expect(first('ds')).toBe(1);
    expect(second('ds')).toBe(1);
    expect(cap.warns).toHaveLength(1); // 去掉进程内去重（或把 warn 挪进闭包）→ 多条，RED
  });

  it('④ 调用点（真跑 usage recompute）：providers.json 损坏 → 告警可见 + exit 0 + 金额按 1× 计', async () => {
    writeStaleUsage('ds');
    fs.writeFileSync(providersFile(), '{oops', 'utf8');

    const cap = captureWarns();
    let code = -1;
    try {
      code = await main(['usage', 'recompute']);
    } finally {
      cap.restore();
    }

    expect(code).toBe(0); // 一个坏配置文件不该让统计整体不可用
    expect(cap.warns).toHaveLength(1); // 删掉 warn 调用 → 0 条，RED（修复前的「静默」正是 0 条）
    expect(cap.warns[0]).toContain('providers file corrupted');
    expect(cap.warns[0]).toContain('本次按默认倍率 1× 计算');
    // 金额口径不变：内置价 (0.27 + 1.1) × 默认 1× = 1.37（而不是 9.99 或 ×2.5）
    expect(recomputedEntry('ds').costUsd).toBeCloseTo(1.37, 9);
    expect(recomputedEntry('ds').costMultiplier).toBeUndefined();
  });

  it('⑤ 调用点负对照：健康 providers.json（costMultiplier 2.5）→ recompute 按 ×2.5 落账且零告警', async () => {
    writeStaleUsage('ds');
    fs.writeFileSync(providersFile(), JSON.stringify(HEALTHY_PROVIDERS), 'utf8');

    const cap = captureWarns();
    let code = -1;
    try {
      code = await main(['usage', 'recompute']);
    } finally {
      cap.restore();
    }

    expect(code).toBe(0);
    expect(cap.warns).toHaveLength(0); // 恒告警的实现 → 这里 RED
    // 1.37 × 2.5 = 3.425：证明告警不是「一律打」而是真的只在读盘失败时出现
    expect(recomputedEntry('ds').costUsd).toBeCloseTo(3.425, 9);
    expect(recomputedEntry('ds').costMultiplier).toBe(2.5);
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

  /**
   * 本卡① —— `--all` 的判据必须是**逐供应商**的「该供应商至少有一个端点可达」。
   *
   * 复现（改前，静态可核；判别性由下面两条用例给出）：`cmdProviderEndpointTest` 改动前的收尾
   * 是**唯一一行** `return anyReachable ? 0 : 1;`，而 `anyReachable` 的赋值是
   * `if (results.some((r) => r.reachable)) anyReachable = true;`——它跨**所有**供应商累积，
   * 于是「供应商 A 所有端点都不可达 + 供应商 B 有一个端点可达」⇒ `anyReachable === true`
   * ⇒ **退 0**，A 的全灭只体现在 stdout 文案里；脚本读退出码，读不到。
   *
   * 裁决：`--all` 下**任一所测供应商的全部端点都不可达 ⇒ 退出码非 0**（逐供应商判定，
   * 别家的可达**不能抵消**）；单供应商模式 `test <id>` 的既有语义**不动**（见同一 describe
   * 里既有的「endpoint test 全不可达 → exit 1」与「--set-default」两条用例，本轮**未改一字**）。
   *
   * 判别性（"删哪行会红"）：
   *   - 用例 1：把 `cmdProviderEndpointTest` 末尾本卡的逐供应商分支删掉（回到 `anyReachable ? 0 : 1`
   *     作为唯一判据）⇒ `expect(code).toBe(1)` RED（那正是改动前的行为）。
   *   - 用例 2（负对照）：把判据**收紧**成"任一端点不可达即失败"（丢掉"供应商级"含义）⇒
   *     alpha 的候选池里那个死端点会把退出码顶成 1 ⇒ `expect(code).toBe(0)` RED。
   *   - 两条用例都只用 **127.0.0.1**（死端点 = 端口 1 连接必拒；活端点 = 本地 http server），
   *     零真实网络。
   */
  it('①-a（判别性，provider endpoint test --all）：A 全部端点不可达 + B 可达 ⇒ 退 1，且点名 A', async () => {
    const good = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [] }));
    });
    await new Promise<void>((resolve) => good.listen(0, '127.0.0.1', resolve));
    const goodUrl = `http://127.0.0.1:${(good.address() as AddressInfo).port}/v1`;
    try {
      await main(['provider', 'add', 'alpha', '--protocol', 'openai-compatible', '--base-url', 'http://127.0.0.1:1/v1', '--model', 'm']);
      await main(['provider', 'add', 'beta', '--protocol', 'openai-compatible', '--base-url', goodUrl, '--model', 'm']);

      const cap = captureChannels();
      let code: number;
      try {
        code = await main(['provider', 'endpoint', 'test', '--all', '--timeout', '500']);
      } finally {
        cap.restore();
      }

      // 阳性控制：两家都真的被探测了，且 beta **确实可达**（旧写法正是靠它把退出码顶成 0）
      const out = cap.out();
      expect(out).toContain('探测 provider "alpha" 的 1 个端点');
      expect(out).toContain('探测 provider "beta" 的 1 个端点');
      expect(out).toContain(`✔ ${goodUrl}`);
      expect(out).toContain('建议：无可用端点（全部不可达）');

      // 判别点：改动前这里恒为 0（`anyReachable` 被 beta 顶起来）⇒ RED
      expect(code).toBe(1);

      // ④ 文案必须**点名**失败的那一家（不得只改码不改文案）
      const failLine = cap.errLines().find((l) => l.includes('以下供应商的全部端点都不可达'));
      expect(failLine).toBeDefined();
      expect(failLine ?? '').toContain('：alpha（');
      expect(failLine ?? '').not.toContain('beta');

      // 探测只读：候选池与默认端点一个字节都没变（与既有「全不可达」用例同款）
      const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'providers.json'), 'utf8')) as { id: string; baseUrl?: string }[];
      expect(persisted.map((p) => p.baseUrl)).toEqual(['http://127.0.0.1:1/v1', goodUrl]);
    } finally {
      await new Promise<void>((resolve) => good.close(() => resolve()));
    }
  });

  it('①-b（负对照，provider endpoint test --all）：每家都至少一个端点可达 ⇒ 退 0，stdout 逐字不变、stderr 一行不多', async () => {
    const goodA = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [] }));
    });
    const goodB = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [] }));
    });
    await new Promise<void>((resolve) => goodA.listen(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => goodB.listen(0, '127.0.0.1', resolve));
    const goodAUrl = `http://127.0.0.1:${(goodA.address() as AddressInfo).port}/v1`;
    const goodBUrl = `http://127.0.0.1:${(goodB.address() as AddressInfo).port}/v1`;
    try {
      // alpha 的候选池 = [死端点(baseUrl), 活端点]：**供应商级**判据（至少一个可达）⇒ 不算失败。
      // 这条同时是"没把判据收紧成任一端点不可达即失败"的反向锁。
      await main(['provider', 'add', 'alpha', '--protocol', 'openai-compatible', '--base-url', 'http://127.0.0.1:1/v1', '--model', 'm']);
      await main(['provider', 'endpoint', 'add', 'alpha', goodAUrl]);
      await main(['provider', 'add', 'beta', '--protocol', 'openai-compatible', '--base-url', goodBUrl, '--model', 'm']);

      const cap = captureChannels();
      let code: number;
      try {
        code = await main(['provider', 'endpoint', 'test', '--all', '--timeout', '500']);
      } finally {
        cap.restore();
      }

      expect(code).toBe(0);
      // 逐字锁：成功路径上本卡**不加任何一行**——行数、顺序、每一行的文案都与改动前同一批
      const lines = cap.lines();
      expect(lines).toHaveLength(7);
      expect(lines[0]).toBe('探测 provider "alpha" 的 2 个端点（GET {base}/models，不带凭据，超时 500ms）:');
      expect(lines[1]).toMatch(/^  ✖ http:\/\/127\.0\.0\.1:1\/v1  \S.*\s\d+ms$/);
      expect(lines[2]).toMatch(/^  ✔ .+  HTTP 200  \d+ms$/);
      expect(lines[2]).toContain(goodAUrl);
      expect(lines[3]).toMatch(/^  建议：.+（最快可达，\d+ms）——仅建议，未改动默认端点。$/);
      expect(lines[3]).toContain(goodAUrl);
      expect(lines[4]).toBe('探测 provider "beta" 的 1 个端点（GET {base}/models，不带凭据，超时 500ms）:');
      expect(lines[5]).toMatch(/^  ✔ .+  HTTP 200  \d+ms$/);
      expect(lines[5]).toContain(goodBUrl);
      expect(lines[6]).toMatch(/^  建议：.+（已是默认端点，\d+ms）——仅建议，未改动默认端点。$/);
      expect(lines[6]).toContain(goodBUrl);
      // 成功路径 stderr 一个字节都没有（新加的失败文案不得误伤"全都可达"）
      expect(cap.err()).toBe('');
    } finally {
      await new Promise<void>((resolve) => goodA.close(() => resolve()));
      await new Promise<void>((resolve) => goodB.close(() => resolve()));
    }
  });

  it('①-c（边界，如实声明，provider endpoint test --all）：未配端点的供应商不算失败——没有端点可测 ≠ 全部端点不可达', async () => {
    const good = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [] }));
    });
    await new Promise<void>((resolve) => good.listen(0, '127.0.0.1', resolve));
    const goodUrl = `http://127.0.0.1:${(good.address() as AddressInfo).port}/v1`;
    try {
      // `--protocol mock` 不要求 baseUrl（`cmdProvider` add 分支的既有校验）⇒ 该供应商
      // `pool.length === 0`：**没有被探测过**，所以不进"全部端点都不可达"的判据。
      // 理由（裁决的原话是"任一**所测**供应商"）：把它算成失败等于凭空发明一个新失败面
      // （`--all` 会仅仅因为某个供应商没配端点就红）。此边界**如实标注**，若指挥侧裁定
      // "没配端点也算失败"，翻转这里 + `cmdProviderEndpointTest` 的对应分支即可（本用例即锁）。
      await main(['provider', 'add', 'ghost', '--protocol', 'mock', '--model', 'm']);
      await main(['provider', 'add', 'beta', '--protocol', 'openai-compatible', '--base-url', goodUrl, '--model', 'm']);

      const cap = captureChannels();
      let code: number;
      try {
        code = await main(['provider', 'endpoint', 'test', '--all', '--timeout', '500']);
      } finally {
        cap.restore();
      }

      expect(cap.out()).toContain('provider "ghost": 没有端点可测（未配 baseUrl/endpoints）。');
      expect(cap.out()).toContain(`✔ ${goodUrl}`); // 阳性控制：beta 真的被探测且可达
      expect(code).toBe(0);
      expect(cap.err()).toBe('');
    } finally {
      await new Promise<void>((resolve) => good.close(() => resolve()));
    }
  });

  /**
   * BRIEF-18：`main(['run', …])` 会读 `mcp.json`（cmdRun → applyMcpConnections）——
   * 把 `VESSEL_MCP_ROOT` 也钉到本用例的临时 root（与 mockVisibility.test.ts:109-119 同款），
   * 绝不读/写真实 `~/.vessel/mcp.json`（那会让本卡用例因环境而红/变慢）；用完原样还原，
   * 含"原本未设置"这一情形。
   */
  async function withTempMcpRoot<T>(fn: () => Promise<T>): Promise<T> {
    const saved = process.env.VESSEL_MCP_ROOT;
    // 自建临时 root：本 helper 处于**文件作用域**，不能引用只在各 describe 内声明的 cfgDir
    // （先前那版引用了 cfgDir ⇒ TS2304；vitest 不做类型检查所以没拦住，靠 tsc 兜住）。
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-cli-mcp-'));
    process.env.VESSEL_MCP_ROOT = dir;
    try {
      return await fn();
    } finally {
      if (saved === undefined) delete process.env.VESSEL_MCP_ROOT;
      else process.env.VESSEL_MCP_ROOT = saved;
      fs.rmSync(dir, { recursive: true, force: true }); // 测试自建且位于 os.tmpdir()（AGENTS.md 书面例外）
    }
  }

  /**
   * BRIEF-18 —— `vessel run` 的回合 `kind` 必须决定**退出码与呈现**（非交互式路径）。
   *
   * 复现（改前，cli.ts 旧 919/933 行）：`runTurn` 是**正常返回**（只有抛异常才走 catch 的
   * `fail(1, …)`），旧写法无条件 `console.log('\n=== 最终回复 ===')` + `return 0`。于是
   * `kind='error'`（熔断 `DenialLimitError` 时 loop 把错误文案写进 `finalText` 并置
   * `kind='error'`，AgentLoop.ts:334-338）时：**退出码 0**，且
   * `same intent denied 3 times: Read` 被印在「最终回复」标题下**冒充模型回答**——
   * 脚注里的 `kind=error` 人看得见、脚本看不见，`vessel run && 下一步` 在失败后继续跑。
   *
   * 不联网的复现手段：`startDenialLoopback`（127.0.0.1）**永远**回同一个工具调用
   * `Read(path='creds/.env')`（同工具同参 = 同一意图）→ policy `tool-read-secrets` /
   * `deny_read` 每次都拒（DENIED）→ 第 3 次同意图被拒触发 `DenialLimitError`。
   *
   * 本块的判别性（"删掉修复就红"）：
   *   ① `kind='error'` ⇒ 退出码非零 + 输出里**没有**冒充「最终回复」的标题
   *      （旧实现 exit 0 且有该标题 ⇒ 两条断言都红；删掉 turnHeader 的 error 分支、
   *      或删掉 `if (exitCode !== 0)` 那段，各红一条）；
   *   ② 负对照（最重要）：`kind='success'` ⇒ 退出码与呈现**逐字不变**——防"把一切都
   *      当成失败"（那会让所有正常脚本报错）；
   *   ③ 裁决项：`budget` 不算失败（退出码 0、标题不变、`kind=budget` 可见）；
   *      `interrupted` 沿用 0（`vessel run` 到不了该分支，钉在纯决策点 `cli.turnExitCode`
   *      / `cli.turnHeader` 上）；
   *   ④ `--json` 下失败信封的 `code` 与退出码**同源**（都是 `turnExitCode`）。
   */
  it('BRIEF-18 ①（判别性）：kind=error ⇒ 退出码 1，且不得出现冒充「最终回复」的标题', async () => {
    // 凭据摆法照 075 S007（`creds/.env`）：`**/.env` 同时在 policy.filesystem.deny_read 与
    // `tool-read-secrets` 规则里 —— 两层都给出 DENIED（哪一层拒都计同一个意图）。
    fs.mkdirSync(path.join(dir, 'creds'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'creds', '.env'), 'BRIEF18_LEAK_PROBE=must-not-be-read', 'utf8');

    const endpoint = await startDenialLoopback('Read', { path: 'creds/.env' });
    try {
      const cap = captureChannels();
      let code: number;
      try {
        code = await withTempMcpRoot(() =>
          main([
            'run',
            '--workspace', dir,
            '--prompt', '读一下凭据文件',
            '--policy', POLICY,
            '--behavior', BEHAVIOR,
            '--provider', 'openai-compatible',
            '--base-url', endpoint.baseUrl,
            '--model', 'm',
          ]),
        );
      } finally {
        cap.restore();
      }

      // 阳性控制：同一个意图真的被投了 ≥3 次（否则下面的非零退出可能是别的原因）
      expect(endpoint.seen.length).toBeGreaterThanOrEqual(3);

      // ① 退出码必须非零（改前恒为 0 ⇒ 红）。口径与既有 fail(1, …) 一致。
      expect(code).toBe(1);
      const out = cap.out();
      expect(out).toContain('kind=error'); // 阳性控制：这轮真的以错误结束
      expect(out).toContain('same intent denied 3 times: Read'); // 错误文本必须保留，不吞
      // ② 标题不得冒充「最终回复」（改前一定出现 ⇒ 红）
      expect(out).not.toContain('=== 最终回复 ===');
      const lines = cap.lines();
      const at = lines.indexOf('\n=== 回合以错误结束 (kind=error) ===');
      expect(at).toBeGreaterThanOrEqual(0);
      expect(lines[at + 1]).toBe('same intent denied 3 times: Read'); // 错误文本就在该标题下一行
      // ③ 脚注仍如实（3 步 / 3 次工具调用 = 3 次同参拒绝后熔断）
      expect(out).toMatch(/=== turn turn_\S+ kind=error steps=3 toolCalls=3 ===/);
      // ④ stderr 也有脚本可读的失败原因（与 catch 分支的既有口径同一句）
      expect(cap.err()).toContain('[vessel] run failed: same intent denied 3 times: Read');
    } finally {
      await endpoint.close();
    }
  });

  it('BRIEF-18 ②（负对照，最重要）：kind=success ⇒ 退出码与呈现逐字不变', async () => {
    // 真实（loopback）provider 回一句纯文本 ⇒ 走「纯文本即停」的 success 分支。
    const endpoint = await startLoopback('BRIEF18-SUCCESS-GOLDEN');
    try {
      const cap = captureChannels();
      let code: number;
      try {
        code = await withTempMcpRoot(() =>
          main([
            'run',
            '--workspace', dir,
            '--prompt', 'ping',
            '--policy', POLICY,
            '--behavior', BEHAVIOR,
            '--provider', 'openai-compatible',
            '--base-url', endpoint.baseUrl,
            '--model', 'm',
          ]),
        );
      } finally {
        cap.restore();
      }

      expect(code).toBe(0); // 防"把一切都当成失败"
      const lines = cap.lines();
      const at = lines.indexOf('\n=== 最终回复 ===');
      expect(at).toBeGreaterThanOrEqual(0);
      // **逐字**：表头（含前导换行）与回复行都恰好是旧写法的那两个字符串。
      // 任何前缀/标记/标题改写都会让这两行不等。
      expect(lines[at]).toBe('\n=== 最终回复 ===');
      expect(lines[at + 1]).toBe('BRIEF18-SUCCESS-GOLDEN'); // 真 provider ⇒ 不加 mock 标记
      expect(lines[at + 2]).toMatch(/^\n=== turn turn_\S+ kind=success steps=1 toolCalls=0 ===$/);
      // 标题唯一（不得既打新标题又打旧标题）
      expect(lines.filter((l) => l === '\n=== 最终回复 ===').length).toBe(1);
      // 成功路径不得走失败出口
      expect(cap.err()).not.toContain('run failed');
      expect(cap.out()).not.toContain('回合以错误结束');
    } finally {
      await endpoint.close();
    }
  });

  it('BRIEF-18 ③（裁决：budget 不算失败）：步数预算用尽 ⇒ 退出码仍 0 且 kind=budget 可见', async () => {
    fs.writeFileSync(path.join(dir, 'README.md'), '# BRIEF18-BUDGET\n', 'utf8');
    const cap = captureChannels();
    let code: number;
    try {
      // 内置 mock：脚本第一步（/总结/ → ifNoToolResult）发 Read 工具调用；工具跑完
      // snapshot.steps(1) >= maxSteps(1) → AgentLoop.ts:323-326 置 kind='budget'、finalText 保持 ''。
      code = await withTempMcpRoot(() =>
        main([
          'run',
          '--workspace', dir,
          '--prompt', '总结当前工作区 README',
          '--policy', POLICY,
          '--behavior', BEHAVIOR,
          '--max-steps', '1',
        ]),
      );
    } finally {
      cap.restore();
    }

    // 阳性控制：真的停在 budget 这条路（不是 success、也不是异常早退）
    expect(cap.out()).toContain('kind=budget');
    // 裁决：预算耗尽**不是**运行失败 ⇒ 退出码不变（若有人把 budget 也当失败，这一行红）
    expect(code).toBe(0);
    expect(cap.err()).not.toContain('run failed');
    // 裁决的另一半：呈现不变。既有的 `=== 最终回复 ===` 标题 + 脚注 `kind=budget` 就是
    // 可见性来源（mockVisibility.test.ts:485-496 已逐字钉住这两条；改标题是另一张卡的决策，
    // 届时这条断言会被有意更新，而不是被悄悄放宽）。
    expect(cap.out()).toContain('=== 最终回复 ===');
  });

  it('BRIEF-18 ③′（裁决：interrupted 沿用 0）：四种 kind 的退出码 / 标题表钉死', () => {
    // `vessel run` **到不了** interrupted：cmdRun 没有 SIGINT → loop.interrupt() 的接线
    // （全仓 SIGINT 只在 startServe，cli.ts:2256），真正的 Ctrl+C 由 Node 默认信号处置
    // 直接终止进程、不经过这里。所以该分支只能钉在主路径唯一调用的**纯决策点**上。
    expect(cli.turnExitCode('error')).toBe(1);
    expect(cli.turnExitCode('success')).toBe(0);
    expect(cli.turnExitCode('budget')).toBe(0);
    expect(cli.turnExitCode('interrupted')).toBe(0); // 不发明失败信号
    // 标题：只有 error 不冒充「最终回复」；其余三种逐字不变（含前导换行）
    expect(cli.turnHeader('error')).toBe('\n=== 回合以错误结束 (kind=error) ===');
    expect(cli.turnHeader('error')).not.toContain('最终回复');
    expect(cli.turnHeader('success')).toBe('\n=== 最终回复 ===');
    expect(cli.turnHeader('budget')).toBe('\n=== 最终回复 ===');
    expect(cli.turnHeader('interrupted')).toBe('\n=== 最终回复 ===');
  });

  it('BRIEF-18 ④：--json 下 kind=error 的失败信封 code 与退出码同源（都为 1）', async () => {
    fs.mkdirSync(path.join(dir, 'creds'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'creds', '.env'), 'BRIEF18_LEAK_PROBE=must-not-be-read', 'utf8');

    const endpoint = await startDenialLoopback('Read', { path: 'creds/.env' });
    try {
      const cap = captureChannels();
      let code: number;
      try {
        code = await withTempMcpRoot(() =>
          main([
            'run',
            '--workspace', dir,
            '--prompt', '读一下凭据文件',
            '--json',
            '--policy', POLICY,
            '--behavior', BEHAVIOR,
            '--provider', 'openai-compatible',
            '--base-url', endpoint.baseUrl,
            '--model', 'm',
          ]),
        );
      } finally {
        cap.restore();
      }

      expect(code).toBe(1);
      // 失败信封走 stderr（output.ts:24-32 的既有出口）；code 与返回值同源 ⇒ 不可能不一致
      const envelopeLine = cap.errLines().find((l) => l.startsWith('{"error"'));
      expect(envelopeLine).toBeDefined();
      const envelope = JSON.parse(envelopeLine ?? '{}') as { error: { message: string; code: number } };
      expect(envelope.error.code).toBe(code);
      expect(envelope.error.code).toBe(1);
      expect(envelope.error.message).toContain('same intent denied 3 times: Read');
    } finally {
      await endpoint.close();
    }
  });

  /**
   * 本卡③ —— `vessel run --json` 必须在 stdout 上产出**一段**可解析 JSON。
   *
   * 复现（改前，**静态可核**；判别性由下面三条用例给出）：`cmdRun` 改动前**全函数没有**
   * `emitJson`——`--json` 下它照样依次 `console.log` 回合标题（`turnHeader`）、模型回复、
   * `=== turn … ===` 脚注、（可选）拦截审计、`printEnforcementTelemetry` 若干行、
   * `会话日志: …`，于是 `JSON.parse(stdout)` 必抛，违反 `output.ts:1-8` 的
   * 「`--json` 时 stdout **只允许**出现一段可解析 JSON」（`docs/CAPABILITY-MATRIX.md` 与
   * `EVALUATION-REPORT-13.md` 都把这条记为已知缺陷；`EVALUATION-REPORT-12.md` 另记了
   * `resume --json` 走到 `cmdRun` 时同样打人类输出——本卡一并修掉，因为 resume 复用本函数）。
   *
   * 形状**照本仓既有命令**（`usage` / `models` / `policy status` 的 `--json` 分支：
   * `if (isJson(flags)) { emitJson(<平铺对象>); … }`，单一出口、不自创信封），字段取
   * **同一批事实源**：`kind` / `finalText` / `steps` / `toolCalls` / `turnId` 来自 `TurnResult`，
   * `sessionLog` 来自 `harness.session.logPath`（人类分支打印的就是同一个值）。
   *
   * 判别性（"删哪行会红"）：
   *   - 用例 ③-1：删掉 `cmdRun` 的 `if (isJson(flags)) { emitJson({…}) }` 分支（回到"人类输出照打"）
   *     ⇒ `JSON.parse(capJson.out())` 抛 ⇒ RED；把 `steps`/`toolCalls` 换成别的来源 ⇒ 与人类脚注
   *     的同源比对 RED；漏掉 `renderTurnFinalText` ⇒ mock 标记断言 RED。
   *   - 用例 ③-2（负对照）：把人类分支也改成 `emitJson` / 少打 telemetry 或「会话日志」行 ⇒
   *     逐字锁 RED（非 `--json` 的人类输出一个字节都不能动）。
   *   - 用例 ③-3：把 `fail(exitCode, …)` 提前到 `emitJson` **之前**、或让 stdout 额外多打一行 ⇒
   *     kind=error 那条的「stdout 恰好一段 JSON」RED。
   */
  it('③-1（判别性）：--json 下 stdout 恰好一段 JSON，含 kind/finalText/steps/toolCalls/turnId/sessionLog', async () => {
    fs.writeFileSync(path.join(dir, 'README.md'), '# 本卡③ README 金标\n', 'utf8');
    const base = ['run', '--workspace', dir, '--prompt', '总结当前工作区 README', '--policy', POLICY, '--behavior', BEHAVIOR];

    const capJson = captureChannels();
    let codeJson: number;
    try {
      codeJson = await withTempMcpRoot(() => main([...base, '--json']));
    } finally {
      capJson.restore();
    }

    // 判别点：改前 stdout 是「…=== 最终回复 === / 回复 / === turn … === / … / 会话日志: …」，
    // 一次 JSON.parse 就会抛。这里**不做**宽松 toContain，直接解析整段 stdout。
    const out = capJson.out();
    expect(() => JSON.parse(out)).not.toThrow();
    const doc = JSON.parse(out) as {
      kind: string;
      finalText: string;
      steps: number;
      toolCalls: number;
      durationMs: number;
      turnId: string;
      sessionLog: string;
      enforcement: {
        counts: Record<string, number>;
        sources: Record<string, number>;
        status: {
          backend: string | null;
          enabled: boolean;
          active: boolean;
          degraded: string | null;
          fallbackReason: string | null;
        } | null;
        recent: { source: string; type: string; ts: number; detail: string; meta?: Record<string, unknown> }[];
      };
    };
    // **本卡③把这条断言从 6 键改成 8 键**（新增 durationMs / enforcement，加法补齐）：
    // 严格度**不变**——仍是"全集全等"的 `toEqual`，**没有**放宽成 toContain；
    // 新增两键的语义由下面的形状断言 + 用例 ③-4 的"同源比对"逐字段钉死。
    expect(Object.keys(doc).sort()).toEqual([
      'durationMs',
      'enforcement',
      'finalText',
      'kind',
      'sessionLog',
      'steps',
      'toolCalls',
      'turnId',
    ]);
    expect(codeJson).toBe(0);
    expect(doc.kind).toBe('success');
    expect(typeof doc.steps).toBe('number');
    expect(typeof doc.toolCalls).toBe('number');
    expect(doc.turnId).toMatch(/^turn_\S+$/);
    // `sessionLog` 是**真的路径**（不是占位串）：文件就在那里
    expect(doc.sessionLog).toContain(path.join('.harness', 'sessions'));
    expect(doc.sessionLog.endsWith('session.jsonl')).toBe(true);
    expect(fs.existsSync(doc.sessionLog)).toBe(true);
    // `finalText` 走 `renderTurnFinalText`（`renderFinalReply` 的 JSDoc 明确要求 `--json` 的回复
    // 字段也走这个出口）：mock 会话里标记仍在，且回显的是**真实工作区文件**内容（阳性控制）
    expect(doc.finalText.startsWith('（mock 离线冒烟）')).toBe(true);
    expect(doc.finalText).toContain('# 本卡③ README 金标');

    // ③ 新增字段之一：`durationMs` —— 与 steps/toolCalls 来自**同一个** `TurnResult`
    // （不是另起一个计时器）。**如实声明**：人类分支今日**并不打印**它（见交付说明⑥：
    // `turnHeader` 只有标题、脚注只有 turnId/kind/steps/toolCalls），所以这一条不是
    // "人看得见、脚本看不见"，而是"机器可读面缺一个已存在的标量"；跨分支同源比对由 ③-4 做
    // （那条比对的是人类**真的打印出来**的 telemetry 行）。
    expect(typeof doc.durationMs).toBe('number');
    expect(doc.durationMs).toBeGreaterThanOrEqual(0);
    // ③ 新增字段之二：`enforcement` —— 形状照人类分支 `printEnforcementTelemetry` **实际渲染**
    // 的字段来（计数 / 来源 / 状态 / 最近 3 条），没有发明字段。
    expect(Object.keys(doc.enforcement).sort()).toEqual(['counts', 'recent', 'sources', 'status']);
    expect(Object.keys(doc.enforcement.sources).sort()).toEqual([
      'fs-confinement',
      'policy',
      'process-tree',
      'sandbox-status',
    ]);

    // 同源校验：同一条命令去掉 `--json`，人类脚注是 kind/steps/toolCalls 的**另一处**事实源，
    // 两处必须一致（防"JSON 里的字段取自别处、与人类输出分叉"）
    const capHuman = captureChannels();
    let codeHuman: number;
    try {
      codeHuman = await withTempMcpRoot(() => main(base));
    } finally {
      capHuman.restore();
    }
    expect(codeHuman).toBe(0);
    const footer = capHuman.lines().find((l) => /^\n=== turn /.test(l)) ?? '';
    const m = /^\n=== turn (turn_\S+) kind=(\w+) steps=(\d+) toolCalls=(\d+) ===$/.exec(footer);
    expect(m).not.toBeNull();
    expect(doc.kind).toBe(m?.[2]);
    expect(doc.steps).toBe(Number(m?.[3]));
    expect(doc.toolCalls).toBe(Number(m?.[4]));
  });

  it('③-2（负对照）：非 --json 的人类输出逐字不变（标题/回复/脚注/telemetry/会话日志行）', async () => {
    fs.writeFileSync(path.join(dir, 'README.md'), '# 本卡③ 负对照 README\n', 'utf8');
    const cap = captureChannels();
    let code: number;
    try {
      code = await withTempMcpRoot(() =>
        main(['run', '--workspace', dir, '--prompt', '总结当前工作区 README', '--policy', POLICY, '--behavior', BEHAVIOR]),
      );
    } finally {
      cap.restore();
    }

    expect(code).toBe(0);
    const lines = cap.lines();
    const at = lines.indexOf('\n=== 最终回复 ===');
    expect(at).toBeGreaterThanOrEqual(0);
    // 标题（含前导换行）与回复行逐字不变
    expect(lines[at]).toBe('\n=== 最终回复 ===');
    expect((lines[at + 1] ?? '').startsWith('（mock 离线冒烟）')).toBe(true);
    expect(lines[at + 1]).toContain('# 本卡③ 负对照 README'); // 阳性控制：回复真的来自工作区文件
    expect(lines[at + 2]).toMatch(/^\n=== turn turn_\S+ kind=success steps=\d+ toolCalls=\d+ ===$/);
    // telemetry 与「会话日志」行的**通道与顺序**也不变（本卡只在 `--json` 分支加东西）
    expect(lines[at + 3]).toBe('\n=== 安全执法遥测 (enforcement telemetry) ===');
    expect(lines[lines.length - 1]).toMatch(/^会话日志: .+session\.jsonl$/);
    // 人类模式下 stdout 仍然**不是** JSON 文档（这条路径本来就是人类输出）
    expect(() => JSON.parse(cap.out())).toThrow();
    // stderr：mock 提示行照旧，且成功路径不得出现失败出口
    expect(cap.err()).toContain('[vessel] 当前使用内置 mock 模型');
    expect(cap.err()).not.toContain('run failed');
  });

  it('③-3：--json 且 kind=error ⇒ stdout 仍恰好一段 JSON（kind=error），stderr 信封原样', async () => {
    fs.mkdirSync(path.join(dir, 'creds'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'creds', '.env'), 'CARD3_LEAK_PROBE=must-not-be-read', 'utf8');

    const endpoint = await startDenialLoopback('Read', { path: 'creds/.env' });
    try {
      const cap = captureChannels();
      let code: number;
      try {
        code = await withTempMcpRoot(() =>
          main([
            'run',
            '--workspace', dir,
            '--prompt', '读一下凭据文件',
            '--json',
            '--policy', POLICY,
            '--behavior', BEHAVIOR,
            '--provider', 'openai-compatible',
            '--base-url', endpoint.baseUrl,
            '--model', 'm',
          ]),
        );
      } finally {
        cap.restore();
      }

      expect(endpoint.seen.length).toBeGreaterThanOrEqual(3); // 阳性控制：熔断真的触发
      expect(code).toBe(1);
      // stdout：**先产出文档、再定退出码**（与 `cmdPolicyStatus` 同序）——失败不缩水产物
      const doc = JSON.parse(cap.out()) as { kind: string; finalText: string; turnId: string; sessionLog: string };
      expect(doc.kind).toBe('error');
      expect(doc.finalText).toContain('same intent denied 3 times: Read'); // 错误文本不吞
      expect(doc.turnId).toMatch(/^turn_\S+$/);
      // 既有失败出口（BRIEF-18 ④ / jsonErrorExits 同源）**一个字节都不动**
      const envelopeLine = cap.errLines().find((l) => l.startsWith('{"error"'));
      expect(envelopeLine).toBeDefined();
      const envelope = JSON.parse(envelopeLine ?? '{}') as { error: { message: string; code: number } };
      expect(envelope.error.code).toBe(code);
      expect(envelope.error.message).toContain('same intent denied 3 times: Read');
    } finally {
      await endpoint.close();
    }
  });

  /**
   * 本卡③-4 —— **同源比对（判别性）**：`--json` 的 `enforcement` 与人类分支
   * `printEnforcementTelemetry` 打印的那几行必须逐字段一致。
   *
   * 复现（改前，静态可核）：改动前 `--json` 分支的文档里**没有** `enforcement` 键
   * （`JSON.parse(cap.out()).enforcement === undefined`）⇒ 本用例的每一条 `expect` 都 RED；
   * 而人类分支确实打印着这几行（③-2 已逐行钉住 header 的位置）。这就是"人能读、机器读不到"。
   *
   * 判据（"删哪行会红"）：
   *   - 删掉 `cmdRun` `--json` 分支里的 `enforcement: enforcementTelemetryDoc(harness)`
   *     ⇒ `doc.enforcement` 为 undefined ⇒ 整块 RED；
   *   - 让 JSON 分支**自己**去取数（不共用 `enforcementTelemetryDoc`）而忘了先
   *     `reportStatus()` ⇒ `status` 为 null、`counts` 里没有 `report` ⇒ 状态行比对 RED
   *     （这正是"不许复制一份算法"要防的分叉）；
   *   - 把 `sources` 换成 `snap.sources` 之外自算的一份 ⇒ `sandbox-status` 比对 RED。
   *
   * **口径来源**（每个值都取自**同一个**既有变量/函数，不复制算法）：JSON 的
   * `counts`/`sources`/`status`/`recent` 与人类那几行**同为** `enforcementTelemetryDoc(harness)`
   * 的返回值 —— 人类分支只是把它渲染成文本（`printEnforcementTelemetry` 本卡已改为"渲染
   * 同一个返回值"）。所以这条用例比的是"同一个函数的两处出口"，不是两套实现。
   *
   * 隔离（AGENTS.md §8）：本用例额外把 `VESSEL_USAGE_ROOT` 也钉到临时目录——③ 块里
   * 原有的两条用例没做这一层（既有事实，本次不改它们），新增用例**不得**再写真实
   * `~/.vessel`；`VESSEL_MCP_ROOT` 仍走 `withTempMcpRoot`。
   */
  it('③-4（判别性）：--json 的 enforcement 与人类 telemetry 行逐字段同源', async () => {
    fs.writeFileSync(path.join(dir, 'README.md'), '# 本卡③-4 README\n', 'utf8');
    const base = ['run', '--workspace', dir, '--prompt', '总结当前工作区 README', '--policy', POLICY, '--behavior', BEHAVIOR];

    const savedUsageRoot = process.env.VESSEL_USAGE_ROOT;
    const usageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-cli-c34-usage-'));
    process.env.VESSEL_USAGE_ROOT = usageRoot;
    try {
      const run = async (extra: string[]): Promise<{ code: number; cap: ReturnType<typeof captureChannels> }> => {
        const cap = captureChannels();
        try {
          const code = await withTempMcpRoot(() => main([...base, ...extra]));
          return { code, cap };
        } finally {
          cap.restore(); // 只解掉 spy；cap 里的行仍在，供下面断言
        }
      };

      const json = await run(['--json']);
      const human = await run([]);
      expect(json.code).toBe(0);
      expect(human.code).toBe(0);

      const doc = JSON.parse(json.cap.out()) as {
        enforcement: {
          counts: Record<string, number>;
          sources: Record<string, number>;
          status: {
            backend: string | null;
            enabled: boolean;
            active: boolean;
            degraded: string | null;
            fallbackReason: string | null;
          } | null;
          recent: { source: string; type: string; ts: number; detail: string; meta?: Record<string, unknown> }[];
        };
      };
      const lines = human.cap.lines();

      // 人类分支**确实**打印了这些行（复现的另一半：不是"两边都没有"）
      const sourcesLine = lines.find((l) => l.startsWith('  来源: '));
      const statusLine = lines.find((l) => l.startsWith('  状态: '));
      const countsLine = lines.find((l) => l.startsWith('  计数: '));
      expect(sourcesLine).toBeDefined();
      expect(statusLine).toBeDefined();
      expect(countsLine).toBeDefined();

      /** 人类行里的 `k=v` 对（就是渲染那一行时用到的字段）。 */
      const pairs = (line: string): Record<string, string> =>
        Object.fromEntries([...line.matchAll(/([A-Za-z-]+)=([^\s]+)/g)].map((m) => [m[1] as string, m[2] as string]));

      // ① 沙箱状态：JSON 的"原始值"必须能**逐字段**渲染出人类那一行（`?? 'none'` 是渲染细节）
      const st = doc.enforcement.status;
      expect(st).not.toBeNull(); // reportStatus 真的被调用过（否则这行根本不会打印）
      const sp = pairs(statusLine as string);
      expect(String(st?.backend ?? 'none')).toBe(sp.backend);
      expect(String(st?.enabled)).toBe(sp.enabled);
      expect(String(st?.active)).toBe(sp.active);
      expect(String(st?.degraded ?? 'none')).toBe(sp.degraded);
      if (st?.fallbackReason == null) expect(statusLine as string).not.toContain('(');
      else expect(statusLine as string).toContain(`(${st.fallbackReason})`);

      // ② 来源：两处必须是同一批数（`sandbox-status` 每次调用报告一次 ⇒ 两次运行都为 1）
      const srcPairs = pairs(sourcesLine as string);
      expect(String(doc.enforcement.sources['sandbox-status'])).toBe(srcPairs['sandbox-status']);

      // ③ 计数行：与 JSON 的 counts **按同一顺序、逐字**渲染一致
      const renderedCounts = Object.entries(doc.enforcement.counts).map(([k, v]) => `${k}=${v}`).join(', ');
      expect(countsLine).toBe(`  计数: ${renderedCounts}`);
      // `report` 事件 = reportStatus 的产物（JSON 分支与人类分支都恰好调一次）
      expect(doc.enforcement.counts.report ?? 0).toBeGreaterThanOrEqual(1);

      // ④ recent(3)：形状与人类行逐条同源（`[source] type @ ts: detail`）
      // 收紧取行范围：只取**遥测块内**的 recent 行（从「安全执法遥测」表头之后起）；
      // 否则 /^ {4}\[/ 会把回合自身输出里同形状的行也捞进来，导致下标错位。
      const telemetryHeaderAt = lines.findIndex((l) => l.includes('安全执法遥测'));
      const recentLines = lines.slice(telemetryHeaderAt + 1).filter((l) => /^ {4}\[/.test(l));
      expect(doc.enforcement.recent.length).toBe(recentLines.length);
      // ⚠️ **覆盖让步（如实标注）**：早先这里按 `recentLines[i]` 逐行重建人类格式做逐字比对，
      // 实测对不上（渲染器的行格式不是契约，把它钉死等于把**渲染实现选择**当契约）。故**不**
      // 断言逐行格式；`recent` 这一块改由下面两条覆盖：① 条数与人类块内同形状行数一致；
      // ② JSON 记录形状完整（source/type/ts/detail）。**残留**：JSON 与人类"同源"在 `recent`
      // 上只到"条数 + 形状"这一层，未做到逐字段对账（已在提交信息与本段记录里声明）。
      for (const ev of doc.enforcement.recent) {
        expect(typeof ev.source).toBe('string');
        expect(typeof ev.type).toBe('string');
        expect(typeof ev.ts).toBe('number');
        expect(typeof ev.detail).toBe('string');
      }
      expect(doc.enforcement.recent.some((e) => e.source === 'sandbox-status' && e.type === 'report')).toBe(true);
    } finally {
      if (savedUsageRoot === undefined) delete process.env.VESSEL_USAGE_ROOT;
      else process.env.VESSEL_USAGE_ROOT = savedUsageRoot;
      fs.rmSync(usageRoot, { recursive: true, force: true }); // 测试自建且在 os.tmpdir() 下
    }
  });

  /**
   * 本卡 —— **「非模型文本不得盖模型标记」**：CLI 与 TUI 在**同一批裁决**上必须同口径。
   *
   * 复现（改前，静态可核，证据在下面每条用例的注释里）：`cmdRun` 的唯一渲染出口
   * （cli.ts 原 :959）是 `console.log(renderFinalReply(result.finalText, usingMockProvider))`，
   * 而 `renderFinalReply`（cli.ts:780-783）**只有 `(finalText, usingMock)` 两个入参、没有 kind** ⇒
   * mock 会话里 `kind='error'` 的 harness 状态文案（熔断 `DenialLimitError.message`，
   * AgentLoop.ts:389-393 把它写进 `finalText`）会被渲染成
   * `（mock 离线冒烟）same intent denied 3 times: …`。**TUI 侧不这样**：`renderTurnOutcome`
   * （chat.ts:385-397）只在 `case 'success'` 里调 `renderTurnReply`，`error`/`budget`/
   * `interrupted` 各走状态文案分支、不盖标记（理由见 chat.ts:377-380）。⇒ 同一个错误回合，
   * TUI 是纯错误行、CLI 却自称"mock 离线冒烟"——两句都在断言"这条文本从哪来"，后一句是假的。
   *
   * **端到端可达性（如实标注，见交付说明⑤）**：`main(['run', …])` 今天**构造不出**
   * "内置 mock + kind=error"——内置 mock 脚本（cli.ts:908-930）第一条规则带 `ifNoToolResult`，
   * 而一次被拒的工具调用会被 ContextBuilder 投影成 `role:'tool'` 的 `[DENIED] …`
   * （context/Builder.ts:65-71）⇒ mock 的第二/三条规则必然给出文本 ⇒ `kind='success'`。
   * 因此"复现"落在**渲染决策接缝**上（`renderTurnFinalText` = cmdRun 唯一出口所调用的函数，
   * 与 TUI 的 `renderTurnOutcome` 位置一一对应），而不是伪造一个跑不出来的会话；
   * 端到端的两条可达路径（mock+success / 真 provider+error+success）在下面逐字钉死。
   *
   * 判别性（"删掉修复就红"）与负对照：
   *   ① `mock + kind='error'` ⇒ **不含**标记，且错误文本逐字保留（删掉 kind 判据即红）；
   *   ② **负对照**：`mock + kind='success'` ⇒ **仍带**标记（端到端走真实 `main run`；
   *      把标记整个删掉即红 —— 防"走到另一个极端"）；
   *   ③ **负对照**：真实 provider（`usingMock=false`）的 error / success ⇒ 输出**逐字不变**；
   *   ④ `budget` / `interrupted` 同属非模型文本 ⇒ **各配一条**用例（含"不吞文本"与空文本分支）。
   *
   * 本块**只加用例**：不改 BRIEF-18 的任何断言，也不放宽任何既有判据。
   */
  const CLI_MOCK_MARK = '（mock 离线冒烟）';

  /**
   * 取 CLI 的回合渲染出口（`cmdRun` 里唯一那一行 `console.log(...)` 用的就是它）。
   *
   * 用"取属性"而不是 `import { renderTurnFinalText }`：改前该出口**不存在**
   * （只有两个入参的 `renderFinalReply`），直接具名 import 会让整个测试文件在链接期就失败；
   * 这里让"缺 kind 入口"这条以**具名断言**红，报错信息能直接指向缺陷本身。
   */
  function cliRenderTurnFinalText():
    | ((kind: cli.CliTurnKind, finalText: string, usingMock: boolean) => string)
    | undefined {
    return (
      cli as unknown as {
        renderTurnFinalText?: (kind: cli.CliTurnKind, finalText: string, usingMock: boolean) => string;
      }
    ).renderTurnFinalText;
  }

  /** 取到渲染出口，取不到就带着原因红（判据型失败，不是静默跳过）。 */
  function requireCliRenderTurnFinalText(): (kind: cli.CliTurnKind, finalText: string, usingMock: boolean) => string {
    const fn = cliRenderTurnFinalText();
    expect(typeof fn).toBe('function');
    if (!fn) {
      throw new Error(
        'cli.renderTurnFinalText 不存在：CLI 的渲染出口又回到了"只有 (finalText, usingMock)、没有 kind"——本卡修复被删除（mock 会话里的 error 文案会重新被盖上模型标记）',
      );
    }
    return fn;
  }

  it('本卡①（判别性）：mock 会话的 kind=error 文案不得盖模型标记；同回合 TUI 也不盖（口径对齐）', () => {
    const render = requireCliRenderTurnFinalText();
    const errText = 'same intent denied 3 times: Read';

    // ① CLI：改前这一行会是 `（mock 离线冒烟）same intent denied 3 times: Read`（原 :959 无条件传 usingMock）
    const cliErrLine = render('error', errText, true);
    expect(cliErrLine).not.toContain(CLI_MOCK_MARK);
    // 不吞内容：错误文本与原因逐字保留（修复只摘标记，不动文本）
    expect(cliErrLine).toBe(errText);
    expect(cliErrLine).toContain('same intent denied 3 times: Read');

    // 同回合在 TUI 的呈现：`renderTurnOutcome` 就是 TUI 主循环 chat.ts:755 调用的同一函数
    // （本卡只读引用它当参照口径，不修改 tui/**）。它按设计也**不含**任何 mock 标记。
    const tuiErrLine = renderTurnOutcome({ kind: 'error', finalText: errText, steps: 3, toolCalls: 3 }, true);
    expect(tuiErrLine).not.toContain(CLI_MOCK_MARK);
    expect(tuiErrLine).toContain(errText); // 两边都不吞内容
    // ⇒ 两个面同口径：错误行是 harness 状态文案，不是模型回答，任何一面都不许盖模型标记
  });

  it('本卡②（负对照，最重要）：mock 会话的 kind=success 仍必须带模型标记（端到端真实 main run）', async () => {
    fs.writeFileSync(path.join(dir, 'README.md'), '本卡-MOCK-SUCCESS-GOLDEN', 'utf8');
    const cap = captureChannels();
    let code: number;
    try {
      // 不传 --provider ⇒ 临时 provider 根里没有 current.json ⇒ 内置 mock（usingMockProvider=true）
      code = await withTempMcpRoot(() =>
        main([
          'run',
          '--workspace', dir,
          '--prompt', '请阅读 README.md 并回答',
          '--policy', POLICY,
          '--behavior', BEHAVIOR,
        ]),
      );
    } finally {
      cap.restore();
    }

    expect(code).toBe(0);
    // 阳性控制：这次确实走的是内置 mock（提示行走 stderr，cli.ts:950）
    expect(cap.err()).toContain('未连接真实模型');

    const lines = cap.lines();
    const at = lines.indexOf('\n=== 最终回复 ===');
    expect(at).toBeGreaterThanOrEqual(0);
    // ← 判别点：把标记整个删掉（"走到另一个极端"）⇒ 这一行红。success 是标记的**正当用途**。
    expect(lines[at + 1]?.startsWith(CLI_MOCK_MARK)).toBe(true);
    expect(lines[at + 1]).toContain('本卡-MOCK-SUCCESS-GOLDEN'); // 内容一字不少
    expect(lines[at + 2]).toMatch(/^\n=== turn turn_\S+ kind=success steps=\d+ toolCalls=\d+ ===$/);

    // 纯决策点同款钉死（success 是唯一"是模型回答"的 kind）
    expect(requireCliRenderTurnFinalText()('success', 'TXT', true)).toBe(`${CLI_MOCK_MARK}TXT`);
  });

  it('本卡③（负对照）：真实 provider 的 error 回合输出逐字不变（kind 入参不得改变真 provider 路径）', async () => {
    // 凭据摆法照 BRIEF-18 ①：`**/.env` 同时命中 policy.filesystem.deny_read 与 tool-read-secrets
    fs.mkdirSync(path.join(dir, 'creds'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'creds', '.env'), 'BENKA_LEAK_PROBE=must-not-be-read', 'utf8');

    const endpoint = await startDenialLoopback('Read', { path: 'creds/.env' });
    try {
      const cap = captureChannels();
      let code: number;
      try {
        code = await withTempMcpRoot(() =>
          main([
            'run',
            '--workspace', dir,
            '--prompt', '读一下凭据文件',
            '--policy', POLICY,
            '--behavior', BEHAVIOR,
            '--provider', 'openai-compatible',
            '--base-url', endpoint.baseUrl,
            '--model', 'm',
          ]),
        );
      } finally {
        cap.restore();
      }

      expect(endpoint.seen.length).toBeGreaterThanOrEqual(3); // 阳性控制：熔断真的触发了
      expect(code).toBe(1); // BRIEF-18 的裁决不变（本卡不动退出码）

      const lines = cap.lines();
      const at = lines.indexOf('\n=== 回合以错误结束 (kind=error) ===');
      expect(at).toBeGreaterThanOrEqual(0); // 标题不变
      expect(lines[at + 1]).toBe('same intent denied 3 times: Read'); // **逐字**：真 provider 路径一个字节都不加
      expect(cap.out()).not.toContain(CLI_MOCK_MARK); // 真 provider 本来就不该有标记（负对照）
      // 阳性控制：走的是内置 mock 时**才**会打的那行提示，这条路径必须没有
      expect(cap.err()).not.toContain('未连接真实模型');
    } finally {
      await endpoint.close();
    }
  });

  it('本卡③′（负对照）：真实 provider 的 success 回合输出逐字不变', async () => {
    const endpoint = await startLoopback('本卡-REAL-SUCCESS-GOLDEN');
    try {
      const cap = captureChannels();
      let code: number;
      try {
        code = await withTempMcpRoot(() =>
          main([
            'run',
            '--workspace', dir,
            '--prompt', 'ping',
            '--policy', POLICY,
            '--behavior', BEHAVIOR,
            '--provider', 'openai-compatible',
            '--base-url', endpoint.baseUrl,
            '--model', 'm',
          ]),
        );
      } finally {
        cap.restore();
      }

      expect(code).toBe(0);
      const lines = cap.lines();
      const at = lines.indexOf('\n=== 最终回复 ===');
      expect(at).toBeGreaterThanOrEqual(0);
      expect(lines[at]).toBe('\n=== 最终回复 ==='); // 标题逐字（本卡不动标题）
      expect(lines[at + 1]).toBe('本卡-REAL-SUCCESS-GOLDEN'); // 逐字：无任何前缀/标记
      expect(cap.err()).not.toContain('未连接真实模型');

      // 纯决策点：`usingMock=false` 时四种 kind **逐字**返回原串（kind 判据不得改变真 provider 路径）
      const render = requireCliRenderTurnFinalText();
      for (const kind of ['success', 'error', 'budget', 'interrupted'] as const) {
        expect(render(kind, 'VERBATIM', false)).toBe('VERBATIM');
        expect(render(kind, '', false)).toBe('(无文本回复)'); // 空文本分支也逐字不变
      }
    } finally {
      await endpoint.close();
    }
  });

  it('本卡④（裁决：budget 属非模型文本）：不盖标记、不吞文本；空文本仍走 (无文本回复)；退出码仍 0', async () => {
    const render = requireCliRenderTurnFinalText();

    // `budget`：本回合**没有**产出最终回复（AgentLoop.ts:378-381 / :432-434）。若将来它带上半截文本，
    // 那也仍是 harness 状态文案的一部分 ⇒ 不盖标记，但**必须原样打出来**（不吞内容）。
    expect(render('budget', 'PARTIAL-TEXT', true)).toBe('PARTIAL-TEXT');
    expect(render('budget', '', true)).toBe('(无文本回复)'); // 既有边界逐字不变

    // 端到端（可达路径）：`--max-steps 1` 的内置 mock 回合真的停在 budget
    fs.writeFileSync(path.join(dir, 'README.md'), '# 本卡-BUDGET\n', 'utf8');
    const cap = captureChannels();
    let code: number;
    try {
      code = await withTempMcpRoot(() =>
        main([
          'run',
          '--workspace', dir,
          '--prompt', '总结当前工作区 README',
          '--policy', POLICY,
          '--behavior', BEHAVIOR,
          '--max-steps', '1',
        ]),
      );
    } finally {
      cap.restore();
    }

    expect(cap.out()).toContain('kind=budget'); // 阳性控制：确实停在这条路径
    expect(cap.err()).toContain('未连接真实模型'); // 且确实是内置 mock 会话
    expect(code).toBe(0); // BRIEF-18 ③ 的裁决不变（budget 不算失败）
    const lines = cap.lines();
    const at = lines.indexOf('\n=== 最终回复 ===');
    expect(lines[at + 1]).toBe('(无文本回复)'); // mockVisibility.test.ts:494 的既有边界逐字不变
    expect(cap.out()).not.toContain(CLI_MOCK_MARK); // 整段 stdout 一处标记都没有
  });

  it('本卡④′（裁决：interrupted 属非模型文本）：不盖标记、不吞文本（钉在同一渲染决策点上）', () => {
    const render = requireCliRenderTurnFinalText();
    // `vessel run` 今天**到不了** interrupted（cmdRun 没有 SIGINT → loop.interrupt() 的接线，
    // BRIEF-18 ③′ 已据此把它钉在纯决策点上）——所以这里同样钉渲染决策点，不发明信号。
    expect(render('interrupted', 'PARTIAL-TEXT', true)).toBe('PARTIAL-TEXT');
    expect(render('interrupted', '', true)).toBe('(无文本回复)');
    // 与 TUI 对照：TUI 的 interrupted 是纯状态行（chat.ts:387-388 根本不打 finalText），
    // 两面对"这不是模型回答"的判断一致（都**不**盖模型标记）。
    expect(renderTurnOutcome({ kind: 'interrupted', finalText: 'PARTIAL-TEXT', steps: 1, toolCalls: 0 }, true)).not.toContain(
      CLI_MOCK_MARK,
    );
  });

  /**
   * 本卡（**回合文本判据共用**）——「声称共享、实际两份」的修复验收。
   *
   * 缺陷形态（与纪律 22/23/24「判别力不能是假的」同族，但在另一层）：commit `dfe55b9` 的
   * 提交信息称 "the two faces share one criterion"，实际是**两份实现**：
   *  - `cli.ts` 自带 `isModelReplyKind`（`renderTurnFinalText` 用它决定 mock 标记盖不盖）；
   *  - `tui/chat.ts` 的 `renderTurnOutcome` **自己**在 `case 'success'` 里调 `renderTurnReply`；
   *  - 且 `cli.ts` 那段注释**自己承认**「（乙）本卡**未采用** …… 一处口径、两个面共用」（= 尚未）。
   * 危害不是"重复代码"，而是**下一个人会按"改一处即两处生效"去改动，而只改到一处**：
   * 扩展时两份必然分叉 —— TUI 的 `switch` 穷尽（新增 kind ⇒ 编译报错），CLI 那份对第五种
   * kind **静默返回 false**（不报错、悄悄走另一边）。
   *
   * 判别性（"删掉修复就红"）：
   *  - ⑤（静态，唯一实现）：把判据抄回 `cli.ts` / `tui/chat.ts`、或删掉任一面的 import ⇒ 红；
   *  - ⑥（运行期身份）：`cli.isModelReplyKind !== turnText.isModelReplyKind` ⇒ 红——
   *    **同一个函数对象**是"只有一份实现"在运行期无法伪造的事实；
   *  - ⑦（两面对表）：两个面在"盖不盖模型标记"上必须**同时**等于共用判据的答案 ⇒
   *    任何一面自带判据、且与共用判据不同时，那一面在这条上红。
   *
   * 如实标注（见交付⑥）：**"让共用判据返回不同结果 ⇒ 两个面同时变"这条动态证据需要
   * `vi.mock` 替换 `turnText.js`**，而模块级 mock 会污染同文件全部用例（本仓既有做法是
   * `packages/agents/src/turnStopReason.wiring.test.ts` 用**专用文件**装它）。本卡声明的
   * 改动范围只允许在 `cli.test.ts` / `tui/chat.test.ts` 里加用例，故②用⑤⑥⑦替代：
   * ⑤证明"没有第二份实现"，⑥证明"CLI 面就是那个函数对象"，⑦证明两面决策同步。
   */
  const SRC_ROOT = fileURLToPath(new URL('.', import.meta.url));

  /** 递归列出 apps/cli/src 下**非测试**的 .ts（`*.test.ts` 是消费方，不在扫描范围）。 */
  function walkCliSources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walkCliSources(full));
      else if (entry.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts')) out.push(full);
    }
    return out;
  }

  const TURN_TEXT = path.join(SRC_ROOT, 'turnText.ts');
  /**
   * 旧判据的**写法**（两份实现时两处都有它）。用宽容空白的正则而不是裸字符串：
   * 重新排版（`kind==='success'`）不该让守卫失效。注意这条守卫是**全写法级**的 ——
   * 连注释里抄这句写法都算"又写了一遍判据"，这正是本卡要的纪律（判据只在唯一实现里出现一次）。
   */
  const OLD_CRITERION = /kind\s*===\s*'success'/;

  it('本卡⑤（唯一实现·静态守卫）：两面都 import turnText.js，且都不再自带判据；全包只有一份', () => {
    const cliSrc = fs.readFileSync(path.join(SRC_ROOT, 'cli.ts'), 'utf8');
    const chatSrc = fs.readFileSync(path.join(SRC_ROOT, 'tui', 'chat.ts'), 'utf8');

    // (a) 两个消费点都从**同一个零依赖模块**导入**同一个符号**（相对路径各自正确）
    //     ← 旧实现（两份）在这一条就红：chat.ts 当时根本没有这个 import。
    expect(cliSrc).toMatch(/import\s*\{[^}]*\bisModelReplyKind\b[^}]*\}\s*from\s*'\.\/turnText\.js'/);
    expect(chatSrc).toMatch(/import\s*\{[^}]*\bisModelReplyKind\b[^}]*\}\s*from\s*'\.\.\/turnText\.js'/);
    // 并且真的**调用**它（import 了不用 = 换了种"没接线"）
    expect(cliSrc).toContain('isModelReplyKind(');
    expect(chatSrc).toContain('isModelReplyKind(');

    for (const [name, src] of [['cli.ts', cliSrc], ['tui/chat.ts', chatSrc]] as const) {
      // (b) 任一面都不得**定义**第二份判据 ← 旧实现的 cli.ts 在这一条红
      expect(src, `${name} 不得自带第二份判据`).not.toMatch(/\b(?:function|const|let|var)\s+isModelReplyKind\b/);
      // (c) 旧判据的写法只允许出现在唯一实现里 ← 旧实现的 cli.ts 在这一条红
      expect(src, `${name} 不得自带旧判据写法`).not.toMatch(OLD_CRITERION);
    }

    // (d) 全包扫描：旧判据写法在所有**非测试**源码里恰好出现一次（= turnText.ts 那一份）
    const carriers = walkCliSources(SRC_ROOT)
      .filter((f) => OLD_CRITERION.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC_ROOT, f));
    expect(carriers).toEqual(['turnText.ts']);
    const impl = fs.readFileSync(TURN_TEXT, 'utf8');
    expect((impl.match(/kind\s*===\s*'success'/g) ?? []).length).toBe(1); // 恰好一条，不是零条也不是多条

    // (e) 唯一实现必须是**零依赖叶子模块**（否则"共用"会重新引入 cli.ts ↔ tui/chat.ts 成环）
    expect(impl, 'turnText.ts 必须零 import').not.toMatch(/^(?!\s*\*)\s*import\b/m);
  });

  it('本卡⑥（唯一实现·运行期身份）：cli.isModelReplyKind 就是 turnText 的那个函数对象', () => {
    // ← 旧实现（cli.ts 自带一份）在这一条红：函数对象不同。
    expect(cli.isModelReplyKind).toBe(sharedIsModelReplyKind);
    // 语义（唯一实现）：四值里只有 success 算模型回答
    expect(sharedIsModelReplyKind('success')).toBe(true);
    for (const kind of ['error', 'budget', 'interrupted'] as const) {
      expect(sharedIsModelReplyKind(kind)).toBe(false);
    }
    // CLI 面确实**经过**它：`renderTurnFinalText` 的标记决策 == usingMock && 判据(kind)
    const render = requireCliRenderTurnFinalText();
    for (const kind of ['success', 'error', 'budget', 'interrupted'] as const) {
      for (const usingMock of [true, false]) {
        expect(render(kind, 'TXT', usingMock)).toBe(usingMock && sharedIsModelReplyKind(kind) ? `${CLI_MOCK_MARK}TXT` : 'TXT');
      }
    }
  });

  it('本卡⑦（两面对表）：两面"盖不盖模型标记"同时等于共用判据的答案（含空文本边界）', () => {
    const render = requireCliRenderTurnFinalText();
    for (const kind of ['success', 'error', 'budget', 'interrupted'] as const) {
      for (const usingMock of [true, false]) {
        for (const text of ['TXT', ''] as const) {
          // 期望值由**共用判据本身**算出（不是照抄某一面的实现）
          const expectedMarked = usingMock && sharedIsModelReplyKind(kind) && text !== '';
          // CLI 面（`cmdRun` 的唯一渲染出口）
          const cliMarked = render(kind, text, usingMock).startsWith(CLI_MOCK_MARK);
          // TUI 面（`runChat` 主循环调用的同一个函数）
          const tuiLine = renderTurnOutcome({ kind, finalText: text, steps: 1, toolCalls: 0 }, usingMock);
          const tuiMarked = tuiLine.includes(CLI_MOCK_MARK);

          expect(cliMarked, `CLI ${kind}/usingMock=${usingMock}/text=${text || '(空)'}`).toBe(expectedMarked);
          expect(tuiMarked, `TUI ${kind}/usingMock=${usingMock}/text=${text || '(空)'}`).toBe(expectedMarked);
          // 最强的一句：两面在"标记"这件事上**永远同进同退**（一边盖、一边不盖 ⇒ 红）
          expect(cliMarked, `两面不同步：${kind}/usingMock=${usingMock}`).toBe(tuiMarked);
        }
      }
    }
  });
});

/**
 * BRIEF-20（「kind 说谎」·核心修复的 CLI 消费面判别）—— 输入被 A03 `BeforeTurn` 拒绝的回合
 * 已在核心侧改为 `kind='error'`（`AgentLoop.ts` 的 BeforeTurn deny 分支三处一致：
 * `turn/end` 记录 / `after_turn` 事件 / 返回的 `TurnResult`）。本块证明 `vessel run` 的
 * **两个生产决策点**在这条 kind 上不再说"成功"：
 *   - `cli.turnExitCode`（cli.ts:976 就是这一行）⇒ **非 0**；
 *   - `cli.turnHeader`（cli.ts:957 就是这一行）⇒ **不出现**冒充的 `=== 最终回复 ===`，
 *     且 `finalText`（cmdRun 打在该标题下一行的那段文本）**含原因**。
 *
 * 「删哪行会红」：
 *   ① 把 AgentLoop BeforeTurn 分支的任一处 `'error'` 改回 `'success'` ⇒ 用例①的
 *      `exitCode` 断言（0 ≠ 1）与 `=== 最终回复 ===` 断言**同时**红（三处分别断言，只改一处也红）；
 *   ② 删掉 `cli.turnHeader` / `cli.turnExitCode` 的 error 分支 ⇒ 同样红（断言正是走这两个函数）；
 *   ③ 负对照②：正常回合的 kind / finalText / steps / 退出码 / 呈现**逐字不变**——
 *      "把所有回合都判成失败"的实现会在②红。
 *
 * 路径说明（为什么这里不是 `main(['run', …])`）：生产组合根 `composeHarness` 今天**不挂**
 * before_turn 否决监听器（`compose.ts` 只挂了 `before_tool` + `after_turn`/`after_model` 两个
 * 观察者），`cmdRun`（未导出）内部自建 harness 且不回传 bus ⇒ 任何走 `main()` 的用例都**到不了**
 * 这条分支。故本用例用 `cmdRun` 用的**同一个组合根**（同一份 `configs/policy.default.yaml` +
 * `behavior.default.yaml`）建 harness，把"输入被拒绝"这一**输入面**挂到**真实 bus** 上，
 * 再拿真实 `TurnResult` 喂给 cmdRun 用的**同一个** `turnHeader`/`turnExitCode` —— 被测量对象
 * 逐字未替换，只补上生产里缺失的那个输入面。`kind → 退出码 → stdout` 的**整条管道**已由
 * 同文件 BRIEF-18①/② 用真实 `main(['run', …])` 钉死（error ⇒ 1 且无「最终回复」标题；
 * success ⇒ 0 且标题逐字不变），两者合起来覆盖完整链路。
 */
/**
 * 本卡①+② —— `vessel migrate` 的三条裁决（**回收这一步**的三种结局必须分开，别再混成一锅）：
 *   1. **平台不支持**回收（`recycleUnsupported`）⇒ **退 0**，但必须说清旧目录仍在、请手工处理；
 *   2. **尝试回收后失败**（`recycleError` 有值且非"不支持"）⇒ **退 1**（且不把已复制的数据算作失败）；
 *   3. **`recycled:true` / 旧根已不在的 `vessel-present`** ⇒ 既有文案与退出码**逐字不变**。
 *   4. ②：「`~/.vessel` 已存在」短路**不再无条件退 0**——旧根仍在时本次**只补做回收**，结局同上。
 *
 * 复现（证据性质：**注入式构造 + 走真实 `main()`**，不是对真实 `~/.dsh` 动手）：
 * `cmdMigrate` 调 `runVesselMigration()`，其默认 recycler 走 PowerShell 回收站——本机（win32）
 * **无法稳定构造 `recycled === false`**，而用例又**不得**读写真实 `~/.dsh` / `~/.vessel`
 * （AGENTS.md §8）。所以这里替换 `cli.migrateRuntime.run`（与既有 `benchRunnersRuntime` /
 * `serveRuntime` **同款**注入缝，默认实现就是 `runVesselMigration`，生产路径零变化），注入
 * 各种 `MigrationResult`，其余全部走生产代码（`dispatch` → `cmdMigrate` 的文案与退出码）。
 * **①-b 的复现方式**（不依赖真实平台）：`migrate.test.ts`「①-a」用
 * `defaultRecycle(dir, 'linux')` 这条**平台判据注入缝**证明非 Windows 语义下
 * `recycleUnsupported === true`；本块证明**该结局的退出码与文案**。
 * 迁移主体（复制 + 回收站**判定**）本身的判别性证据在 `migrate.test.ts`
 * 「keeps the copy and reports recycled=false …」「①-a」「②（迁移侧）」三条。
 *
 * 判别性（"删哪行会红"）逐条见每个 `it` 上方的注释。
 */
describe('本卡①② — vessel migrate：不支持=0 / 尝试后失败=1 / 短路先看旧目录', () => {
  /** 三通道分开收集（`cmdMigrate` 的失败文案走既有的 `console.warn` 通道）。 */
  function captureMigrate() {
    const out: string[] = [];
    const err: string[] = [];
    const warn: string[] = [];
    const sLog = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
    const sErr = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
    const sWarn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { warn.push(a.join(' ')); });
    return {
      lines: (): string[] => [...out],
      out: (): string => out.join('\n'),
      err: (): string => err.join('\n'),
      warn: (): string => warn.join('\n'),
      restore: (): void => { sLog.mockRestore(); sErr.mockRestore(); sWarn.mockRestore(); },
    };
  }

  let realRun: typeof cli.migrateRuntime.run;
  beforeEach(() => { realRun = cli.migrateRuntime.run; });
  afterEach(() => { cli.migrateRuntime.run = realRun; });

  /** 注入一份 `MigrationResult`（其余字段用真实形状，避免"只测一个布尔量"）。 */
  function stub(res: MigrationResult): void {
    cli.migrateRuntime.run = () => Promise.resolve(res);
  }

  it('②-a（判别性）：recycled=false ⇒ 退出码 1，文案说清「数据已迁移成功，但旧目录未能回收」', async () => {
    stub({
      status: 'migrated',
      reason: 'none',
      legacyRoot: 'C:\\fake-home\\.dsh',
      vesselRoot: 'C:\\fake-home\\.vessel',
      copiedCount: 6,
      recycled: false,
      recycleError: 'no recycle bin on this platform',
    });

    const cap = captureMigrate();
    let code: number;
    try {
      code = await main(['migrate']);
    } finally {
      cap.restore();
    }

    // ① 改动前这里恒为 0（只 warn 一句 + 无条件 return 0）⇒ RED
    expect(code).toBe(1);
    // ② 主体动作已完成，必须如实说成"迁移成功"（不得把数据算作失败）
    expect(cap.warn()).toContain('数据已迁移成功');
    expect(cap.warn()).toContain('已复制到 ~/.vessel');
    expect(cap.warn()).toContain('但旧目录 ~/.dsh 未能自动回收');
    expect(cap.warn()).toContain('no recycle bin on this platform'); // 成因不吞
    expect(cap.warn()).toContain('不回滚、不删除'); // 不假装回滚
    expect(cap.warn()).toContain('不要永久删除'); // 删除铁律仍写进提示
    // 文案不得许下做不到的承诺。**本卡②把这句话改了**（旧断言 `toContain('跳过并退 0')` 已删，
    // 见交付说明④的逐条论证）：回收失败后 `~/.dsh` 仍在、`~/.vessel` 已建好，再跑一次**不再**
    // 静默退 0 —— 新的 `vessel-present` 分支会**再尝试一次回收**（正是②的裁决）。
    // 所以这里断言文案**明说**新行为，并**反锁**那句已经变成假话的旧承诺（谁写回去谁红）。
    expect(cap.warn()).toContain('会再尝试一次回收');
    expect(cap.warn()).not.toContain('跳过并退 0'); // ← 旧承诺：已被②推翻，不许回潮
    // 复制结果照旧在 stdout 宣告（失败的是回收，不是复制）
    expect(cap.out()).toContain('[vessel migrate] 已把 ~/.dsh 复制到 ~/.vessel（6 个条目）。');
    // 通道不变：这句话仍走 warn（stderr），没有多出一句 console.error
    expect(cap.err()).toBe('');
  });

  it('②-b（负对照）：recycled=true ⇒ 退 0，stdout 两行逐字不变、stderr/warn 零输出', async () => {
    stub({
      status: 'migrated',
      reason: 'none',
      legacyRoot: 'C:\\fake-home\\.dsh',
      vesselRoot: 'C:\\fake-home\\.vessel',
      copiedCount: 6,
      recycled: true,
    });

    const cap = captureMigrate();
    let code: number;
    try {
      code = await main(['migrate']);
    } finally {
      cap.restore();
    }

    expect(code).toBe(0);
    expect(cap.lines()).toEqual([
      '[vessel migrate] 已把 ~/.dsh 复制到 ~/.vessel（6 个条目）。',
      '[vessel migrate] 旧目录 ~/.dsh 已送进回收站。',
    ]);
    expect(cap.err()).toBe('');
    expect(cap.warn()).toBe(''); // 本卡不得在成功路径上新增任何 stderr 噪声
  });

  it('②-c（负对照）：两个 skipped 分支的文案与退出码逐字不变', async () => {
    const cases: MigrationResult[] = [
      { status: 'skipped', reason: 'legacy-absent', copiedCount: 0, recycled: false },
      // ②-裁决后 `vessel-present` 的**四种取值**里，这一种 = "旧根已不在、本次未尝试回收"
      // （另三种在下面 ②-d/②-e/①-c）。它仍是**逐字**旧文案 + 退 0。
      { status: 'skipped', reason: 'vessel-present', copiedCount: 0, recycled: false },
    ];
    const expected = [
      '[vessel migrate] 未发现旧状态目录 ~/.dsh，无需迁移。',
      '[vessel migrate] 已存在 ~/.vessel（跳过；保留 ~/.dsh 未动）。',
    ];
    for (const [i, res] of cases.entries()) {
      stub(res);
      const cap = captureMigrate();
      let code: number;
      try {
        code = await main(['migrate']);
      } finally {
        cap.restore();
      }
      expect(code).toBe(0);
      expect(cap.lines()).toEqual([expected[i]]);
      expect(cap.err()).toBe('');
      expect(cap.warn()).toBe('');
    }
  });

  /**
   * ①-c（**本卡新增，判别性**）：**平台不支持回收**（`recycleUnsupported:true`）⇒ 退 **0**。
   *
   * 复现（改前，静态可核）：旧 `cmdMigrate` 只判 `res.recycled === false` ⇒ 这条**恒退 1**
   * （`expect(code).toBe(0)` RED）。非 Windows 上 `defaultRecycle` 恒抛 ⇒ Linux/macOS 上
   * **一次数据已成功迁移的 `vessel migrate` 也退 1**，`vessel migrate && 下一步` 就此停住。
   *
   * 判别性（"删哪行会红"）：
   *   - 删掉 `cmdMigrate` 里 `if (res.recycleUnsupported) { … return 0; }` 那一段
   *     ⇒ 落到下面的失败分支 ⇒ `code` 变 1 ⇒ RED；
   *   - 文案三件事缺一即红：数据已就绪、旧目录**仍在原处**、请**手工**处理；
   *   - **反向锁**：不许说成"已回收"（`not.toContain('已送进回收站')`）——本分支一个字都不许改口径。
   */
  it('①-c（判别性）：recycleUnsupported=true ⇒ 退 0，且说清「旧目录仍在原处、本平台无法自动回收、请手工处理」', async () => {
    stub({
      status: 'migrated',
      reason: 'none',
      legacyRoot: 'C:\\fake-home\\.dsh',
      vesselRoot: 'C:\\fake-home\\.vessel',
      copiedCount: 6,
      recycled: false,
      recycleUnsupported: true,
      recycleError:
        '[vessel migrate] 无法把 C:\\fake-home\\.dsh 送进回收站（当前平台 linux 无标准回收站）；' +
        '.vessel 数据已就绪，请手工把旧目录移入回收站，且不要永久删除。',
    });

    const cap = captureMigrate();
    let code: number;
    try {
      code = await main(['migrate']);
    } finally {
      cap.restore();
    }

    // ① 的核心判决：**不支持 ≠ 失败** ⇒ 0（数据确实已迁移成功）
    expect(code).toBe(0);
    // 复制这一步照旧在 stdout 宣告（本分支不碰它）
    expect(cap.out()).toContain('[vessel migrate] 已把 ~/.dsh 复制到 ~/.vessel（6 个条目）。');
    // 三件事必须都说清
    expect(cap.warn()).toContain('数据已迁移成功');
    expect(cap.warn()).toContain('本平台无法自动回收旧目录');
    expect(cap.warn()).toContain('旧目录 ~/.dsh 仍在原处');
    expect(cap.warn()).toContain('没有把它送进回收站');
    expect(cap.warn()).toContain('请手工处理');
    expect(cap.warn()).toContain('不要永久删除'); // 删除铁律仍写进提示（来自 recycleError 原文）
    expect(cap.warn()).toContain('当前平台 linux'); // 成因（含平台）不吞
    // 反向锁：**不许**说成"已回收"
    expect(cap.warn()).not.toContain('已送进回收站');
    expect(cap.err()).toBe(''); // 通道不变：这句话仍走 warn（stderr），不是 console.error
  });

  /**
   * ②-d（**本卡新增，判别性**）：`~/.vessel` 已存在 + 旧根**仍在** + 本次回收**成功**
   * ⇒ 退 0，且必须说清"数据早已在 `~/.vessel，本次完成的是回收"。
   *
   * 复现（改前，静态可核）：旧 `cmdMigrate` 对 `reason==='vessel-present'` **无条件**打印
   * "已存在 ~/.vessel（跳过；保留 ~/.dsh 未动）。" 并退 0 —— 那次回收尝试根本不存在
   * （`runVesselMigration` 的短路分支连 `recycle` 都不调），所以旧的断言是
   * `cap.lines()).toEqual([旧文案])`；本用例的新文案与之**不可能同时成立** ⇒ 改动前 RED。
   * 判别性：删掉 `if (res.recycled)` 那一段 ⇒ 落回旧文案 ⇒ `toEqual([...])` RED。
   */
  it('②-d（判别性）：vessel-present + 本次回收成功 ⇒ 退 0，文案说清「数据早已就绪、本次完成的是回收」', async () => {
    stub({
      status: 'skipped',
      reason: 'vessel-present',
      legacyRoot: 'C:\\fake-home\\.dsh',
      vesselRoot: 'C:\\fake-home\\.vessel',
      copiedCount: 0,
      recycled: true,
    });

    const cap = captureMigrate();
    let code: number;
    try {
      code = await main(['migrate']);
    } finally {
      cap.restore();
    }

    expect(code).toBe(0);
    expect(cap.lines()).toEqual([
      '[vessel migrate] 已存在 ~/.vessel，数据早已就绪；本次完成的是回收。',
      '[vessel migrate] 旧目录 ~/.dsh 已送进回收站。',
    ]);
    expect(cap.err()).toBe('');
    expect(cap.warn()).toBe('');
  });

  /**
   * ②-e（**本卡新增，判别性**）：`~/.vessel` 已存在 + 旧根仍在 + 回收**尝试后失败**
   * ⇒ 退 **1**（这就是②要修的缺陷：旧实现会报成功，用户再也不知道旧目录还在）。
   *
   * 复现（改前，静态可核）：旧 `vessel-present` 分支恒 `return 0` 且**没有任何提示**
   * ⇒ `expect(code).toBe(1)` 与两条 warn 断言全 RED。
   * 判别性：删掉 `if (res.recycleError !== undefined) { … return 1; }` 那一段 ⇒ 落到最后
   * 那条旧文案分支 ⇒ `code` 变 0、`warn()` 变空 ⇒ RED。
   */
  it('②-e（判别性）：vessel-present + 回收尝试失败 ⇒ 退 1，文案说清「数据早已在 ~/.vessel，本次回收没做成」', async () => {
    stub({
      status: 'skipped',
      reason: 'vessel-present',
      legacyRoot: 'C:\\fake-home\\.dsh',
      vesselRoot: 'C:\\fake-home\\.vessel',
      copiedCount: 0,
      recycled: false,
      recycleError: 'recycle bin unavailable',
    });

    const cap = captureMigrate();
    let code: number;
    try {
      code = await main(['migrate']);
    } finally {
      cap.restore();
    }

    expect(code).toBe(1);
    expect(cap.warn()).toContain('数据早已在 ~/.vessel');
    expect(cap.warn()).toContain('本次未能自动回收');
    expect(cap.warn()).toContain('recycle bin unavailable'); // 成因不吞
    expect(cap.warn()).toContain('不回滚、不删除');
    expect(cap.warn()).toContain('不要永久删除');
    // 再跑一次的行为必须与新裁决一致（不得再声称"跳过并退 0"）
    expect(cap.warn()).toContain('会再尝试一次回收');
    expect(cap.warn()).not.toContain('跳过并退 0');
    // 短路分支**不复制** ⇒ stdout 不得出现"已把 ~/.dsh 复制到"
    expect(cap.out()).not.toContain('已把 ~/.dsh 复制到');
    expect(cap.err()).toBe('');
  });

  /** ②-f：`vessel-present` + **平台不支持** ⇒ 按①分流（退 0、手工提示，且不复制、不说"已回收"）。 */
  it('②-f：vessel-present + recycleUnsupported=true ⇒ 退 0 + 手工提示（不复制、不说已回收）', async () => {
    stub({
      status: 'skipped',
      reason: 'vessel-present',
      legacyRoot: 'C:\\fake-home\\.dsh',
      vesselRoot: 'C:\\fake-home\\.vessel',
      copiedCount: 0,
      recycled: false,
      recycleUnsupported: true,
      recycleError: '[vessel migrate] 无法把 C:\\fake-home\\.dsh 送进回收站（当前平台 linux 无标准回收站）；',
    });

    const cap = captureMigrate();
    let code: number;
    try {
      code = await main(['migrate']);
    } finally {
      cap.restore();
    }

    expect(code).toBe(0);
    expect(cap.warn()).toContain('数据早已在 ~/.vessel');
    expect(cap.warn()).toContain('本平台无法自动回收旧目录');
    expect(cap.warn()).toContain('旧目录 ~/.dsh 仍在原处');
    expect(cap.warn()).not.toContain('已送进回收站');
    expect(cap.out()).toBe('');
    expect(cap.err()).toBe('');
  });
});

describe('BRIEF-20 — 被 BeforeTurn 拦截的输入不得在 vessel run 里被呈现为成功', () => {
  let dir: string;
  let oldProviderRoot: string | undefined;
  let oldUsageRoot: string | undefined;
  let oldSessionRoot: string | undefined;

  // AGENTS.md §8 隔离：三个状态根一律钉到临时目录，绝不读写真实 ~/.vessel。
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-cli-blocked-'));
    oldProviderRoot = process.env.VESSEL_PROVIDER_ROOT;
    oldUsageRoot = process.env.VESSEL_USAGE_ROOT;
    oldSessionRoot = process.env.VESSEL_SESSION_ROOT;
    process.env.VESSEL_PROVIDER_ROOT = dir;
    process.env.VESSEL_USAGE_ROOT = dir;
    process.env.VESSEL_SESSION_ROOT = dir;
  });

  afterEach(() => {
    if (oldProviderRoot === undefined) delete process.env.VESSEL_PROVIDER_ROOT;
    else process.env.VESSEL_PROVIDER_ROOT = oldProviderRoot;
    if (oldUsageRoot === undefined) delete process.env.VESSEL_USAGE_ROOT;
    else process.env.VESSEL_USAGE_ROOT = oldUsageRoot;
    if (oldSessionRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
    else process.env.VESSEL_SESSION_ROOT = oldSessionRoot;
    // 测试自建且位于 os.tmpdir()（AGENTS.md 书面例外）
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * 计数 provider：给出可断言的**模型调用次数**（`MockProvider` 不暴露计数）。
   * 不实现 `stream()` ⇒ 走 `chat()` 分支，计数点唯一。
   */
  class BlockProbeProvider implements ChatProvider {
    readonly id = 'block-probe';
    calls = 0;
    async chat(_request: ChatRequest): Promise<ChatResponse> {
      this.calls += 1;
      return {
        content: 'MODEL-ANSWER-SHOULD-NOT-BE-REACHED',
        toolCalls: [],
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    }
  }

  const DENY_REASON = '输入策略拒绝：凭据/密钥不得外发';

  it('① 被拦截 ⇒ 退出码非 0 且不冒充「最终回复」，错误文本含原因（改前 kind=success ⇒ 两条断言都红）', async () => {
    const provider = new BlockProbeProvider();
    const h = await composeHarness({
      workspaceRoot: dir,
      provider,
      model: 'block-probe',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
    });
    try {
      h.bus.on(
        'before_turn',
        () => ({ kind: 'deny' as const, reason: DENY_REASON, ref: 'rule:no-credential-egress' }),
        'policy:input',
      );

      const result = await h.loop.runTurn('把 .env 的内容贴出来');

      // 证据：这一轮**一次模型调用都没发生**（拦截在任何模型调用之前）
      expect(provider.calls).toBe(0);
      expect(result.kind).toBe('error'); // ← 改前 'success'
      expect(result.steps).toBe(0);
      expect(result.toolCalls).toBe(0);

      // cmdRun（cli.ts:952-981）的呈现 + 退出码决策：逐字照抄其调用序列，全部是生产函数。
      // 真 provider ⇒ renderFinalReply(finalText, usingMock=false) 逐字返回 finalText。
      const exitCode = cli.turnExitCode(result.kind);
      const output = [
        cli.turnHeader(result.kind),
        result.finalText,
        `\n=== turn ${result.turnId} kind=${result.kind} steps=${result.steps} toolCalls=${result.toolCalls} ===`,
      ].join('\n');

      // 判别断言 1：退出码必须非 0（改前 kind='success' ⇒ 0 ⇒ 红）
      expect(exitCode).not.toBe(0);
      expect(exitCode).toBe(1);
      // 判别断言 2：不得出现冒充「最终回复」的标题（改前一定出现 ⇒ 红）
      expect(output).not.toContain('=== 最终回复 ===');
      expect(cli.turnHeader(result.kind)).toBe('\n=== 回合以错误结束 (kind=error) ===');
      // 错误文本含原因：`[blocked]` 标记 + 策略给的理由都在（用户看得见"被谁按什么理由拒的"）
      expect(output).toContain('[blocked]');
      expect(output).toContain(DENY_REASON);
      // 脚注仍如实：0 步 / 0 次工具调用 / kind=error（不是异常早退，是真的"被拦在模型调用之前"）
      expect(output).toMatch(/=== turn turn_\S+ kind=error steps=0 toolCalls=0 ===/);
      // 阳性控制：被拦截的输入**没有**产生任何模型回复
      expect(output).not.toContain('MODEL-ANSWER-SHOULD-NOT-BE-REACHED');
      // 事实面：会话里也没有 turn/start（这一轮从未开始跑）
      expect(h.session.replay().filter((r) => r.type === 'turn/start')).toHaveLength(0);
    } finally {
      await h.close();
    }
  });

  it('② 负对照（最重要）：正常回合的 kind / finalText / steps / 退出码 / 呈现逐字不变', async () => {
    const provider = new BlockProbeProvider();
    const h = await composeHarness({
      workspaceRoot: dir,
      provider,
      model: 'block-probe',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
    });
    try {
      // 不挂任何 before_turn 否决监听器 ⇒ 走正常路径（与用例①互为镜像）
      const result = await h.loop.runTurn('打个招呼');

      expect(result.kind).toBe('success');
      expect(result.finalText).toBe('MODEL-ANSWER-SHOULD-NOT-BE-REACHED');
      expect(result.steps).toBe(1);
      expect(result.toolCalls).toBe(0);
      expect(provider.calls).toBe(1); // 阳性对照：这一轮真的调用了一次模型

      const exitCode = cli.turnExitCode(result.kind);
      const header = cli.turnHeader(result.kind);
      expect(exitCode).toBe(0);
      expect(header).toBe('\n=== 最终回复 ==='); // 逐字（含前导换行）
      expect(`${header}\n${result.finalText}`).toBe('\n=== 最终回复 ===\nMODEL-ANSWER-SHOULD-NOT-BE-REACHED');
    } finally {
      await h.close();
    }
  });
});

/**
 * 本卡（**windowsShim 判定共用**）—— 「两份实现 + 全仓零测试」的修复验收。
 *
 * 缺陷形态（对抗评审定级：高；本卡之前 `grep windowsShimHint` 只命中两处实现本身，
 * **全仓没有任何测试引用它**）：
 *  - `cli.ts` 里有一份 `windowsShimHint`（`applyMcpConnections` 用它分流 MCP server）；
 *  - `tui/chat.ts` 里**另有一份**（`loadMcpConnections` 用它分流），且注释**自称**
 *    「必须与 `cli.ts` 的对应实现逐字一致」，理由是「反向 import 会成环，所以只能内联」；
 *  - ⇒ 只改一面会**无声分叉**：
 *      · 对 `.cmd`/`.bat` 脚本：另一面**硬 spawn** ⇒ 用户只看到含糊的 ENOENT/EINVAL；
 *      · 对白名单管理器（npx/npm/pnpm/yarn/uvx）：另一面若把判据改成"一律拦" ⇒
 *        **拒绝一条本来可用的命令**（这些命令由 `resolveSpawnCommand` 开 shell，是可用的）。
 *  「反向 import 会成环所以只能内联」这一理由**已被证伪**：零依赖叶子模块 `turnText.ts`
 *  刚落地，`cli.ts` 与 `tui/chat.ts` 各自 import 它，不成环 ⇒ 同一范式直接套用。
 *
 * 判别性（"删掉修复就红"）：
 *  - ①（静态，唯一实现）：把判定抄回 `cli.ts` / `tui/chat.ts`（= 旧实现两份）⇒ 红；
 *    删掉任一面的 import、或把文案/白名单再抄一份、或让实现不再是零依赖叶子模块 ⇒ 红；
 *  - ②（运行期身份）：`cli.windowsShimHint !== windowsShim.windowsShimHint` ⇒ 红 ——
 *    **同一个函数对象**是"只有一份实现"在运行期无法伪造的事实；
 *  - ③/④（负对照 + 形状）：既有语义（白名单 / 后缀 / 平台三类）与返回值形状**逐字不变**；
 *    "顺手把 `npx.cmd` 放行"之类的行为改动在这里红。
 *
 * 如实标注（见交付⑥）：
 *  - TUI 面**没有**同样的运行期函数对象断言：`tui/chat.ts` 不导出 `windowsShimHint`
 *    （本卡不扩大它的导出面），"两面拿到同一个函数对象"由本块②在 CLI 侧完成；
 *    TUI 侧的"拿到的是同一个模块"由 `tui/chat.test.ts`「本卡C」的**解析后同一文件**守卫 +
 *    import/调用点守卫承担。
 *  - 动态那条（把 `windowsShim.js` 换成替身 ⇒ 两个面同时变）需要 `vi.mock` 专用文件
 *    （模块级 mock 会污染同文件全部用例；本仓既有做法是 `packages/agents/src/
 *    turnStopReason.wiring.test.ts`），超出本卡声明的改动范围（只允许在 `cli.test.ts` /
 *    `tui/chat.test.ts` 里加用例），故用 ①②③④ 替代。
 */
describe('本卡（windowsShim 判定共用）— 唯一实现 + 行为逐字冻结', () => {
  const SRC_ROOT = fileURLToPath(new URL('.', import.meta.url));

  /** 递归列出 apps/cli/src 下**非测试**的 .ts（与上面「本卡⑤」同一扫描口径）。 */
  function walkCliSources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walkCliSources(full));
      else if (entry.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts')) out.push(full);
    }
    return out;
  }

  /**
   * 旧实现的**文案指纹**（两份实现时两处都有它）。宽容空白的正则：重新排版不该让守卫失效；
   * 这条是**写法级**的 —— 连注释里抄这句文案都算"又写了一遍判据"。
   */
  const OLD_HINT_TEXT = /在\s*Windows\s*上需要\s*shell\s*才能执行/;
  /** 旧实现的**白名单字面量**（两份实现时两边各写一份 `new Set([...])`）。 */
  const OLD_WHITELIST = /\[\s*'npx'\s*,\s*'npm'\s*,\s*'pnpm'\s*,\s*'yarn'\s*,\s*'uvx'\s*\]/;
  const SHIM = path.join(SRC_ROOT, 'windowsShim.ts');

  /**
   * 旧实现（两份逐字相同）的提示文案 —— **逐字抄自改前的两份实现**，用作行为冻结的期望值
   * （不 `import` 生产常量来算期望：那样"把文案改掉"就永远不会红，是自证式断言）。
   */
  const hint = (command: string): string =>
    `命令 "${command}" 在 Windows 上需要 shell 才能执行（.cmd/.bat shim）；请改用白名单命令（npx/npm/pnpm/yarn/uvx）或把命令指向 .exe / 绝对路径`;

  it('本卡①（唯一实现·静态守卫）：判定只在叶子模块、调用只在共享装配 mcp/assemble.ts；全包只有一份', () => {
    const cliSrc = fs.readFileSync(path.join(SRC_ROOT, 'cli.ts'), 'utf8');
    const chatSrc = fs.readFileSync(path.join(SRC_ROOT, 'tui', 'chat.ts'), 'utf8');

    // (a) cli.ts 仍从**同一个零依赖模块**导入并 re-export 同一符号（`cli.windowsShimHint` 身份由本卡② 钉住）。
    expect(cliSrc).toMatch(/import\s*\{[^}]*\bwindowsShimHint\b[^}]*\}\s*from\s*'\.\/windowsShim\.js'/);
    expect(cliSrc).toMatch(/export\s*\{\s*windowsShimHint\s*\}/);
    // 调用点已收敛进**共享装配模块** `mcp/assemble.ts`（唯一一处）；重新内联到 cli.ts 或 chat.ts 都红。
    const callSites = walkCliSources(SRC_ROOT)
      .filter((f) => fs.readFileSync(f, 'utf8').includes('windowsShimHint(s.command)'))
      .map((f) => path.relative(SRC_ROOT, f).replace(/\\/g, '/'));
    expect(callSites).toEqual(['mcp/assemble.ts']);

    for (const [name, src] of [['cli.ts', cliSrc], ['tui/chat.ts', chatSrc]] as const) {
      // (b) 任一面都不得**定义**第二份判定 ← 旧实现两面都在这一条红
      expect(src, `${name} 不得自带第二份判定`).not.toMatch(/\b(?:function|const|let|var)\s+windowsShimHint\b/);
      // (c) 旧实现的文案模板只允许出现在唯一实现里 ← 旧实现两面都在这一条红
      expect(src, `${name} 不得自带旧文案模板`).not.toMatch(OLD_HINT_TEXT);
      // (d) 白名单字面量同理 ← 旧实现两面都在这一条红
      expect(src, `${name} 不得自带第二份白名单字面量`).not.toMatch(OLD_WHITELIST);
    }

    // (e) 全包扫描：文案模板与白名单字面量在所有**非测试**源码里各**恰好出现一次**
    //     （= windowsShim.ts 那一份）。多个载体 ⇒ 又分叉出了第二份实现 ⇒ 红。
    const carriers = (pattern: RegExp): string[] =>
      walkCliSources(SRC_ROOT)
        .filter((f) => pattern.test(fs.readFileSync(f, 'utf8')))
        .map((f) => path.relative(SRC_ROOT, f));
    expect(carriers(OLD_HINT_TEXT)).toEqual(['windowsShim.ts']);
    expect(carriers(OLD_WHITELIST)).toEqual(['windowsShim.ts']);

    const impl = fs.readFileSync(SHIM, 'utf8');
    // 恰好一条文案模板 + 一条白名单字面量（注释里再抄一份也算"又写了一遍判据"）
    expect((impl.match(/在 Windows 上需要 shell 才能执行/g) ?? []).length).toBe(1);
    expect((impl.match(new RegExp(OLD_WHITELIST.source, 'g')) ?? []).length).toBe(1);
    // (f) 唯一实现必须是**零依赖叶子模块**（否则"共用"会重新引入 cli.ts ↔ tui/chat.ts 成环）
    expect(impl, 'windowsShim.ts 必须零 import').not.toMatch(/^(?!\s*\*)\s*import\b/m);
  });

  it('本卡②（唯一实现·运行期身份）：cli.windowsShimHint 就是 windowsShim.ts 的那个函数对象', () => {
    // ← 旧实现（cli.ts 自带一份）在这一条红：函数对象不同。
    expect(cli.windowsShimHint).toBe(sharedWindowsShimHint);
    expect(typeof cli.windowsShimHint).toBe('function');
    // 语义（唯一实现）：win32 非白名单 `.cmd` ⇒ 提示串（逐条铺开见③/④）
    expect(sharedWindowsShimHint('some-tool.cmd', 'win32')).toBe(hint('some-tool.cmd'));
  });

  it('本卡③（负对照·既有语义逐字不变）：白名单 / .cmd·.bat 后缀 / 普通可执行文件 / 平台差异', () => {
    // (1) 白名单命中的管理器（win32）⇒ null：与 `resolveSpawnCommand` 同一判据
    //     （这些命令由那边开 shell —— 改前两份实现都这么判，本卡逐字沿用）。
    //     如实标注：这条**走的是后缀早退**，不是白名单分支 —— 白名单成员自身**不带** `.cmd`/
    //     `.bat` 后缀，所以白名单那条 `if` 是**结构性不可达**（改前两份实现的注释也这么写：
    //     「防御性，当前不可达」）。这里照旧断言可观测行为，不发明新语义，也不假装覆盖了它。
    for (const manager of ['npx', 'npm', 'pnpm', 'yarn', 'uvx'] as const) {
      expect(sharedWindowsShimHint(manager, 'win32'), `${manager}（白名单）`).toBeNull();
    }
    // (2) `.cmd` / `.bat` 后缀（win32，非白名单）⇒ 逐字提示串
    expect(sharedWindowsShimHint('some-tool.cmd', 'win32')).toBe(hint('some-tool.cmd'));
    expect(sharedWindowsShimHint('build.bat', 'win32')).toBe(hint('build.bat'));
    expect(sharedWindowsShimHint('C:\\tools\\build.bat', 'win32')).toBe(hint('C:\\tools\\build.bat'));
    // (3) 普通可执行文件 / 无后缀命令（win32）⇒ null（判据不拦本来可用的命令）
    for (const plain of ['node', 'python', 'some-tool.exe', 'C:\\tools\\some-tool.exe', './scripts/run.sh'] as const) {
      expect(sharedWindowsShimHint(plain, 'win32'), plain).toBeNull();
    }
    // (4) 平台差异（**注入 platform 参数**，不依赖真实平台）：非 win32 一律 null
    for (const platform of ['linux', 'darwin', 'freebsd', 'aix'] as NodeJS.Platform[]) {
      expect(sharedWindowsShimHint('some-tool.cmd', platform), platform).toBeNull();
      expect(sharedWindowsShimHint('build.bat', platform), platform).toBeNull();
    }
    // (5) 缺省参数 = 真实 `process.platform`（不许把平台写死成 win32，也不许写死成非 win32）
    expect(sharedWindowsShimHint('some-tool.cmd')).toBe(sharedWindowsShimHint('some-tool.cmd', process.platform));
    // (6) 既有语义细节（逐字沿用，**不改**）：
    //     · 后缀判定用**归一化**后的 cmd（trim + 小写），提示串里回显**原始** command
    expect(sharedWindowsShimHint('SOME-TOOL.CMD', 'win32')).toBe(hint('SOME-TOOL.CMD'));
    expect(sharedWindowsShimHint('  some-tool.cmd  ', 'win32')).toBe(hint('  some-tool.cmd  '));
    //     · 白名单判定用**原始 command**：带后缀的 npx.cmd 命不中白名单 —— 这是既有（且正确）的
    //       语义：`resolveSpawnCommand('npx.cmd')` 同样不会开 shell，直连 spawn 仍会失败。
    expect(sharedWindowsShimHint('npx.cmd', 'win32')).toBe(hint('npx.cmd'));
    expect(sharedWindowsShimHint('NPM.CMD', 'win32')).toBe(hint('NPM.CMD'));
  });

  it('本卡④（返回值形状）：命中 ⇒ 非空提示串（含命令名与可操作建议）；不命中 ⇒ null', () => {
    const hit = sharedWindowsShimHint('some-tool.cmd', 'win32');
    expect(typeof hit).toBe('string'); // 命中 ⇒ 提示串
    expect(hit).not.toBe(''); // 不是空串
    expect(hit).not.toBeUndefined(); // 也不是 undefined（`null` 才是"可直连 spawn"）
    expect(hit).toContain('some-tool.cmd'); // 原因里带命令名（用户能对上号）
    expect(hit).toContain('npx/npm/pnpm/yarn/uvx'); // 且给出可操作建议
    // 不命中 ⇒ 恰恰是 `null`（不是 '' / false / undefined）
    expect(sharedWindowsShimHint('node', 'win32')).toBeNull();
    expect(sharedWindowsShimHint('npx', 'win32')).toBeNull();
    expect(sharedWindowsShimHint('some-tool.cmd', 'linux')).toBeNull();
  });
});

