import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { SyncCredentialStore } from '@vessel/application';
import { SessionRegistry, composeHarness, type ComposedHarness } from '@vessel/application';
import { MockProvider, type MockProviderOptions, type MockScriptEntry } from '@vessel/llm';
import type { ChatProvider, ChatRequest, ChatResponse, StreamChunk } from '@vessel/shared';
import { ProviderStore } from '../providers/ProviderStore.js';
import { providerStateRoot } from '../providers/defaultStore.js';
import type { PricingTable } from '../providers/pricing.js';
import { UsageStore } from '../usage/UsageStore.js';
import { dispatchSlash, renderTurnOutcome, runChat, makeLineReader, resolveChatStore, TwoStageCtrlC, type ChatOptions, type ChatSessionIO, type TurnOutcomeLike } from './chat.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url)); // apps/cli/src/tui → repo root
const POLICY = path.join(REPO_ROOT, 'configs', 'policy.default.yaml');
const BEHAVIOR = path.join(REPO_ROOT, 'configs', 'behavior.default.yaml');

/** 假密钥（只在本测试进程内存里流转，不落盘、不出真实网络）。 */
const TEST_KEY = 'sk-test-106-not-a-real-key';

/** 内存凭据后端（测试注入）：只做 secretRef → apiKey 解析，绝不碰真实 secrets.json。 */
function memoryCredentialStore(seed: Record<string, string> = {}): SyncCredentialStore {
  const map = new Map(Object.entries(seed));
  const k = (service: string, account: string): string => `${service}/${account}`;
  return {
    backend: 'memory-test',
    setSync: (service, account, secret) => { map.set(k(service, account), secret); },
    getSync: (service, account) => map.get(k(service, account)) ?? null,
    deleteSync: (service, account) => { map.delete(k(service, account)); },
  };
}

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

/** Scripted chat IO: feeds inputs from an array, captures output lines. */
function scriptedIO(inputs: string[]): { io: ChatSessionIO; output: string[]; consumed: () => number } {
  const output: string[] = [];
  let i = 0;
  return {
    output,
    io: {
      async readLine() {
        if (i < inputs.length) return inputs[i++] ?? null;
        return null; // EOF
      },
      write(line: string) {
        output.push(line);
      },
    },
    consumed: () => i,
  };
}

describe('TwoStageCtrlC — first press interrupts, second press exits (task 050)', () => {
  it('press with no active turn exits immediately (first press too)', () => {
    const c = new TwoStageCtrlC({ hasActiveTurn: () => false, interruptTurn: () => {} });
    expect(c.press()).toBe('exit');
  });

  it('first press interrupts the active turn and stays; second press exits', () => {
    let active = true;
    let interrupts = 0;
    const c = new TwoStageCtrlC({
      hasActiveTurn: () => active,
      interruptTurn: () => {
        interrupts += 1;
      },
    });
    expect(c.press()).toBe('stay');
    expect(interrupts).toBe(1);
    expect(c.press()).toBe('exit'); // second press → exit, no double interrupt
    expect(interrupts).toBe(1);
  });

  it('reset() gives the next turn fresh first-press semantics', () => {
    let active = true;
    let interrupts = 0;
    const c = new TwoStageCtrlC({
      hasActiveTurn: () => active,
      interruptTurn: () => {
        interrupts += 1;
      },
    });
    expect(c.press()).toBe('stay'); // turn A interrupted
    expect(interrupts).toBe(1);

    c.reset(); // a new turn begins
    expect(c.press()).toBe('stay'); // first press of turn B interrupts again
    expect(interrupts).toBe(2);
  });

  it('an interrupt that already happened still exits if pressed while idle', () => {
    let active = true;
    const c = new TwoStageCtrlC({ hasActiveTurn: () => active, interruptTurn: () => {} });
    expect(c.press()).toBe('stay'); // interrupt turn
    active = false; // the interrupted turn settled; back at the prompt
    expect(c.press()).toBe('exit');
  });
});

describe('chat TUI — slash dispatch (task 021)', () => {
  let root: string;
  let store: ProviderStore;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-tui-'));
    store = new ProviderStore({ rootDir: root });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('/help lists the slash commands', async () => {
    const { io, output } = scriptedIO([]);
    const res = await dispatchSlash('/help', { store, io, sessionWorkspace: root });
    expect(res?.output).toContain('/provider');
    expect(res?.output).toContain('/models');
    expect(res?.output).toContain('/permission');
    expect(res?.output).toContain('/quit');
    void output;
  });

  it('/quit returns quit=true', async () => {
    const { io } = scriptedIO([]);
    const res = await dispatchSlash('/quit', { store, io, sessionWorkspace: root });
    expect(res?.quit).toBe(true);
  });

  it('unknown command gets a hint', async () => {
    const { io } = scriptedIO([]);
    const res = await dispatchSlash('/nope', { store, io, sessionWorkspace: root });
    expect(res?.output).toContain('未知命令');
  });

  it('/models on mock current prints a guidance line', async () => {
    const { io } = scriptedIO([]);
    const res = await dispatchSlash('/models', { store, io, sessionWorkspace: root });
    expect(res?.output).toContain('mock');
  });
});

describe('chat TUI — runChat loop (task 021)', () => {
  let dir: string;
  let oldProviderRoot: string | undefined;
  let oldUsageRoot: string | undefined;
  let oldSessionRoot: string | undefined;
  let oldSettingsRoot: string | undefined;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-tui-run-'));
    // task 106 隔离：runChat 的默认 ProviderStore 必须落在这个临时 root，
    // 绝不能读真实 ~/.vessel（否则机器上 current=真实供应商时这些用例会打真网络）。
    oldProviderRoot = process.env.VESSEL_PROVIDER_ROOT;
    // task 106 / AGENTS.md §8：usage root 同款钉住（与 provider 同根，隔离口径一致）。
    oldUsageRoot = process.env.VESSEL_USAGE_ROOT;
    // G-10：runChat 的 `buildHarness` 还会 new SessionRegistry()（缺省根）——同款钉住，
    // 否则每个用例都会把测试会话写进真实 ~/.vessel/sessions.json（AGENTS.md §8）。
    oldSessionRoot = process.env.VESSEL_SESSION_ROOT;
    // G-13-P2：runChat 进循环前会 `resolveChatLocale(opts.settingsRoot)`，其根解析为
    // `VESSEL_SETTINGS_ROOT > VESSEL_USAGE_ROOT > ~/.vessel`——不钉就会读真实
    // `~/.vessel/settings.json`（本机 locale=en 时语义随机器而变）。
    oldSettingsRoot = process.env.VESSEL_SETTINGS_ROOT;
    process.env.VESSEL_PROVIDER_ROOT = dir;
    process.env.VESSEL_USAGE_ROOT = dir;
    process.env.VESSEL_SESSION_ROOT = dir;
    process.env.VESSEL_SETTINGS_ROOT = dir;
  });
  afterEach(() => {
    if (oldProviderRoot === undefined) delete process.env.VESSEL_PROVIDER_ROOT;
    else process.env.VESSEL_PROVIDER_ROOT = oldProviderRoot;
    if (oldUsageRoot === undefined) delete process.env.VESSEL_USAGE_ROOT;
    else process.env.VESSEL_USAGE_ROOT = oldUsageRoot;
    if (oldSessionRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
    else process.env.VESSEL_SESSION_ROOT = oldSessionRoot;
    if (oldSettingsRoot === undefined) delete process.env.VESSEL_SETTINGS_ROOT;
    else process.env.VESSEL_SETTINGS_ROOT = oldSettingsRoot;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exits cleanly on /quit after the welcome line', async () => {
    const { io, output } = scriptedIO(['/quit']);
    const code = await runChat({
      workspaceRoot: dir,
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      io,
    });
    expect(code).toBe(0);
    expect(output.some((l) => l.includes('交互会话开始'))).toBe(true);
  });

  it('runs a natural-language turn against mock and prints a reply', async () => {
    const { io, output } = scriptedIO(['你好', '/quit']);
    const code = await runChat({
      workspaceRoot: dir,
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      io,
    });
    expect(code).toBe(0);
    // the mock smoke script answers read/summary; a plain hello yields the mock fallback text
    expect(output.length).toBeGreaterThan(1);
    void code;
  });

  it('mock smoke: a failing Read (no README.md) prints the friendly fallback, not the raw [TOOL_FAILURE]', async () => {
    // 临时工作区刻意不放 README.md：mock 冒烟脚本第一轮会调 Read {cwd}/README.md，
    // 工具结果以 [TOOL_FAILURE] 开头 → 应命中友好文案分支（而不是把原始工具结果回显给用户）。
    expect(fs.existsSync(path.join(dir, 'README.md'))).toBe(false);
    const { io, output } = scriptedIO(['read README', '/quit']);
    const code = await runChat({
      workspaceRoot: dir,
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      io,
    });
    expect(code).toBe(0);
    const out = output.join('\n');
    expect(out).toMatch(/未能读取工作区 README\.md/); // 友好文案
    expect(out).not.toContain('[TOOL_FAILURE]'); // 原始工具失败文本不外泄
  });

  it('EOF (null input) exits cleanly', async () => {
    const { io } = scriptedIO([]);
    const code = await runChat({ workspaceRoot: dir, policySystemPath: POLICY, behaviorIRPath: BEHAVIOR, io });
    expect(code).toBe(0);
  });

  it('runs three rounds (/help → 你好 → /quit) without exiting early (task 023 regression)', async () => {
    const { io, output, consumed } = scriptedIO(['/help', '你好', '/quit']);
    const code = await runChat({
      workspaceRoot: dir,
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      io,
    });
    expect(code).toBe(0);
    // all three scripted inputs were served — the loop did NOT break after round 1
    expect(consumed()).toBe(3);
    const joined = output.join('\n');
    expect(joined).toContain('/provider'); // round 1: /help table rendered
    expect(joined).toContain('mock'); // round 2: NL turn hit the mock fallback reply
  });
});

describe('makeLineReader — sequential reads over ONE readline interface (task 023)', () => {
  /** Real node:readline over in-memory streams — same code path createStdioIO uses. */
  function setup() {
    const input = new PassThrough();
    const rl = readline.createInterface({ input, output: new PassThrough(), terminal: false });
    const reader = makeLineReader(rl);
    return { input, rl, reader };
  }
  const tick = () => new Promise<void>((r) => setImmediate(r));

  it('serves 3 sequential reads from the same interface without EOF', async () => {
    const { input, rl, reader } = setup();
    // strict one-read-at-a-time: exactly how runChat consumes stdin
    const a = reader.readLine();
    input.write('/help\n');
    await expect(a).resolves.toBe('/help');

    const b = reader.readLine();
    input.write('你好\n');
    await expect(b).resolves.toBe('你好');

    const c = reader.readLine();
    input.write('/quit\n');
    await expect(c).resolves.toBe('/quit');

    reader.close();
    rl.close();
    input.end();
  });

  it('buffers lines that arrive before the next read is requested', async () => {
    const { input, rl, reader } = setup();
    input.write('one\ntwo\n');
    await tick(); // let readline emit both 'line' events with no waiter attached
    await expect(reader.readLine()).resolves.toBe('one');
    await expect(reader.readLine()).resolves.toBe('two');
    reader.close();
    rl.close();
    input.end();
  });

  it('resolves a pending read with null when the interface closes (EOF)', async () => {
    const { input, rl, reader } = setup();
    const read = reader.readLine();
    input.end(); // EOF → rl 'close' → reader end
    await expect(read).resolves.toBeNull();
    rl.close();
  });

  it('close() ends the reader with null — the SIGINT path', async () => {
    const { rl, reader } = setup();
    const read = reader.readLine();
    reader.close(); // exactly what createStdioIO's SIGINT handler does
    await expect(read).resolves.toBeNull();
    await expect(reader.readLine()).resolves.toBeNull();
    rl.close();
  });
});

describe('task 106 — TUI 凭据接线 + 测试隔离', () => {
  let dir: string;
  let oldProviderRoot: string | undefined;
  let oldUsageRoot: string | undefined;
  let oldSessionRoot: string | undefined;
  let oldSettingsRoot: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-106-'));
    oldProviderRoot = process.env.VESSEL_PROVIDER_ROOT;
    process.env.VESSEL_PROVIDER_ROOT = dir; // 临时状态根：不读不写真实 ~/.vessel
    // task 106 / AGENTS.md §8：usage root 同款钉住（与 provider 同根）。
    oldUsageRoot = process.env.VESSEL_USAGE_ROOT;
    process.env.VESSEL_USAGE_ROOT = dir;
    // G-10：会话登记根同款隔离（runChat 的 buildHarness → new SessionRegistry()）。
    oldSessionRoot = process.env.VESSEL_SESSION_ROOT;
    process.env.VESSEL_SESSION_ROOT = dir;
    // G-13-P2：runChat 进循环前 `resolveChatLocale()` 会读 settings 根
    // （`VESSEL_SETTINGS_ROOT > VESSEL_USAGE_ROOT > ~/.vessel`）——不钉就读真实
    // `~/.vessel/settings.json`（只读，但违反 AGENTS.md §8 隔离，且语义随机器而变）。
    oldSettingsRoot = process.env.VESSEL_SETTINGS_ROOT;
    process.env.VESSEL_SETTINGS_ROOT = dir;
  });
  afterEach(() => {
    if (oldProviderRoot === undefined) delete process.env.VESSEL_PROVIDER_ROOT;
    else process.env.VESSEL_PROVIDER_ROOT = oldProviderRoot;
    if (oldUsageRoot === undefined) delete process.env.VESSEL_USAGE_ROOT;
    else process.env.VESSEL_USAGE_ROOT = oldUsageRoot;
    if (oldSessionRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
    else process.env.VESSEL_SESSION_ROOT = oldSessionRoot;
    if (oldSettingsRoot === undefined) delete process.env.VESSEL_SETTINGS_ROOT;
    else process.env.VESSEL_SETTINGS_ROOT = oldSettingsRoot;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('① 默认 store 已接 CredentialStore（修前是裸 new ProviderStore()）', () => {
    expect(providerStateRoot()).toBe(dir); // 状态根 = 临时目录（隔离前提）
    expect(resolveChatStore({}).credentialsEnabled).toBe(true); // ① 修复点
    // 控制组：修前的写法没有凭据后端，secretRef 永远解析不出来
    expect(new ProviderStore({ rootDir: dir }).credentialsEnabled).toBe(false);
  });

  it('① secretRef → apiKey：注入 mock CredentialStore，TUI 请求带上解析出的 Bearer（本地 loopback）', async () => {
    const endpoint = await startLoopback('CHAT-106-PONG');
    try {
      // providers.json 只留 secretRef（与 DPAPI 落盘形状一致，无明文 apiKey）
      fs.writeFileSync(
        path.join(dir, 'providers.json'),
        JSON.stringify([
          {
            id: 'ds106',
            name: 'ds106',
            protocol: 'openai-compatible',
            baseUrl: endpoint.baseUrl,
            model: 'm',
            secretRef: 'credential:vessel/ds106',
          },
        ]),
        'utf8',
      );
      fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify({ id: 'ds106' }), 'utf8');
      // 控制组：没有凭据后端 → secretRef 解析不出 apiKey（正是 106 的缺陷）
      expect(new ProviderStore({ rootDir: dir }).get('ds106')?.apiKey).toBeUndefined();

      const { io, output } = scriptedIO(['ping', '/quit']);
      const code = await runChat({
        workspaceRoot: dir,
        policySystemPath: POLICY,
        behaviorIRPath: BEHAVIOR,
        credentialStore: memoryCredentialStore({ 'vessel/ds106': TEST_KEY }),
        io,
      });

      expect(code).toBe(0);
      expect(endpoint.seen.length).toBeGreaterThanOrEqual(1);
      expect(endpoint.seen[0]?.authorization).toBe(`Bearer ${TEST_KEY}`); // secretRef → apiKey 成功
      expect(output.join('\n')).toContain('CHAT-106-PONG');
      expect(output.join('\n')).not.toContain('Missing API key');
    } finally {
      await endpoint.close();
    }
  });

  it('② 不读真实 ~/.vessel：把 home 下的 current.json 改成哨兵值，注入临时 root 后仍走 mock', async () => {
    // 模拟「机器状态」：把 os.homedir() 指到临时 home，并在它的 ~/.vessel 里放哨兵
    // current.json + 指向 127.0.0.1:1 的 provider —— 真去读它就会打印哨兵 id 并连接失败。
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-106-home-'));
    const savedHome = process.env.USERPROFILE;
    const savedRoot = process.env.VESSEL_PROVIDER_ROOT;
    try {
      fs.mkdirSync(path.join(fakeHome, '.vessel'), { recursive: true });
      fs.writeFileSync(path.join(fakeHome, '.vessel', 'current.json'), JSON.stringify({ id: 'SENTINEL-106' }), 'utf8');
      fs.writeFileSync(
        path.join(fakeHome, '.vessel', 'providers.json'),
        JSON.stringify([
          {
            id: 'SENTINEL-106',
            name: 'sentinel',
            protocol: 'openai-compatible',
            baseUrl: 'http://127.0.0.1:1/v1',
            model: 'sentinel-model',
          },
        ]),
        'utf8',
      );
      process.env.USERPROFILE = fakeHome;

      // 控制组：不注入 VESSEL_PROVIDER_ROOT → 默认 root 就是 home/.vessel，哨兵确实会被读到
      delete process.env.VESSEL_PROVIDER_ROOT;
      // G-10：控制组只放开 provider root——会话登记根必须继续钉在临时目录，
      // 否则 runChat 的 `new SessionRegistry()` 会往真实 ~/.vessel/sessions.json 写测试会话（AGENTS.md §8）。
      process.env.VESSEL_SESSION_ROOT = dir;
      const control = scriptedIO(['ping', '/quit']);
      await runChat({
        workspaceRoot: dir,
        policySystemPath: POLICY,
        behaviorIRPath: BEHAVIOR,
        credentialStore: memoryCredentialStore(),
        io: control.io,
      });
      expect(control.output.join('\n')).toContain('SENTINEL-106'); // 哨兵是「活的」→ 下面的阴性断言才有意义

      // 隔离组：注入临时 root → 哨兵不被读，走临时 root 的 mock provider
      process.env.VESSEL_PROVIDER_ROOT = dir;
      const isolated = scriptedIO(['你好', '/quit']);
      const code = await runChat({
        workspaceRoot: dir,
        policySystemPath: POLICY,
        behaviorIRPath: BEHAVIOR,
        credentialStore: memoryCredentialStore(),
        io: isolated.io,
      });
      expect(code).toBe(0);
      const text = isolated.output.join('\n');
      expect(text).toContain('当前 mock'); // 临时 root 为空 → current=mock
      expect(text).not.toContain('SENTINEL-106'); // 真实（被解析为 home 的）~/.vessel 没被读
    } finally {
      if (savedRoot === undefined) delete process.env.VESSEL_PROVIDER_ROOT;
      else process.env.VESSEL_PROVIDER_ROOT = savedRoot;
      if (savedHome === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = savedHome;
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});

describe('G-09 — TUI 会话内成本显示（/cost · /usage · 每回合增量）', () => {
  let root: string;
  let usageRoot: string;
  let oldProviderRoot: string | undefined;
  let oldUsageRoot: string | undefined;
  let oldSessionRoot: string | undefined;
  let oldSettingsRoot: string | undefined;

  /**
   * 固定价目（形状照抄 `UsageStore.recovery.test.ts` 的 PRICING）：
   * `deepseek-chat` 有专属单价 → 下面 `$` / `1000 in / 500 out` 的断言才非空转。
   */
  const PRICING: PricingTable = {
    models: {
      default: { input: 0.5, output: 1.5, cacheRead: 0.1 },
      'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07 },
    },
    protocols: {},
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-tui-'));
    usageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-tui-'));
    // task 106 / AGENTS.md 硬性约束 8：runChat 默认路径会构造默认 ProviderStore / UsageStore，
    // 两个 root 都必须指到临时目录 —— 绝不读真实 ~/.vessel（也不写真实用量历史）。
    // G-10 起还要加第三个：`buildHarness` 的 `new SessionRegistry()`（缺省根），
    // 漏钉就会把测试会话写进真实 ~/.vessel/sessions.json。
    oldProviderRoot = process.env.VESSEL_PROVIDER_ROOT;
    oldUsageRoot = process.env.VESSEL_USAGE_ROOT;
    oldSessionRoot = process.env.VESSEL_SESSION_ROOT;
    // G-13-P2：runChat 进循环前会 `resolveChatLocale(opts.settingsRoot)`，根解析
    // `VESSEL_SETTINGS_ROOT > VESSEL_USAGE_ROOT > ~/.vessel`——显式钉住第四根，
    // 不再依赖「usage 根恰好是临时目录」这条隐式回落（AGENTS.md §8）。
    oldSettingsRoot = process.env.VESSEL_SETTINGS_ROOT;
    process.env.VESSEL_PROVIDER_ROOT = root;
    process.env.VESSEL_USAGE_ROOT = usageRoot;
    process.env.VESSEL_SESSION_ROOT = usageRoot;
    process.env.VESSEL_SETTINGS_ROOT = usageRoot;
  });

  afterEach(() => {
    if (oldProviderRoot === undefined) delete process.env.VESSEL_PROVIDER_ROOT;
    else process.env.VESSEL_PROVIDER_ROOT = oldProviderRoot;
    if (oldUsageRoot === undefined) delete process.env.VESSEL_USAGE_ROOT;
    else process.env.VESSEL_USAGE_ROOT = oldUsageRoot;
    if (oldSessionRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
    else process.env.VESSEL_SESSION_ROOT = oldSessionRoot;
    if (oldSettingsRoot === undefined) delete process.env.VESSEL_SETTINGS_ROOT;
    else process.env.VESSEL_SETTINGS_ROOT = oldSettingsRoot;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(usageRoot, { recursive: true, force: true });
  });

  /** 注入 store（临时 root + 固定价目）并预先记一条用量：本会话基线之前就有数据。 */
  const seededUsageStore = (): UsageStore => {
    const usageStore = new UsageStore({ rootDir: usageRoot, pricing: PRICING });
    usageStore.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1000, outputTokens: 500 });
    return usageStore;
  };

  const newStore = (): ProviderStore => new ProviderStore({ rootDir: root });

  it('① 注入 usageStore 后 /cost 给出本会话与累计', async () => {
    const usageStore = seededUsageStore();
    const { io } = scriptedIO([]);
    const res = await dispatchSlash('/cost', {
      store: newStore(),
      io,
      sessionWorkspace: root,
      usageStore, // 不注入 usageBaseline → 基线 = 会话开始前的累计（0），本会话 = 全部
    });
    const out = res?.output ?? '';
    expect(out).toContain('本会话:'); // 本会话一行
    expect(out).toContain('累计:'); // 累计一行
    expect(out).toContain('$'); // 金额带 $ 前缀
    expect(out).toContain('次调用'); // 会话内调用次数
    expect(out).toContain('1000 in / 500 out'); // 数字确实来自那一条 record，不是占位符
  });

  it('② /usage 与 /cost 同义：同一 ctx 下输出逐字相同', async () => {
    const usageStore = seededUsageStore();
    const ctx = { store: newStore(), io: scriptedIO([]).io, sessionWorkspace: root, usageStore };
    const cost = await dispatchSlash('/cost', ctx);
    const usage = await dispatchSlash('/usage', ctx);
    expect(usage?.output).toBe(cost?.output); // 别名，不是另一套文案
    expect(usage?.output).toContain('本会话:');
    expect(usage?.output).toContain('累计:');
  });

  it('③ 未注入 usageStore 时 /cost（与 /usage）给出未启用提示', async () => {
    const { io } = scriptedIO([]);
    const res = await dispatchSlash('/cost', { store: newStore(), io, sessionWorkspace: root });
    expect(res?.output).toContain('成本显示未启用');
    const alias = await dispatchSlash('/usage', { store: newStore(), io, sessionWorkspace: root });
    expect(alias?.output).toContain('成本显示未启用');
  });

  it('④ 回归保护：runChat 未注入 usageStore → 输出中绝无「· 本回合」成本行', async () => {
    const { io, output } = scriptedIO(['你好', '/quit']);
    const code = await runChat({
      workspaceRoot: root,
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      io,
    });
    expect(code).toBe(0);
    const out = output.join('\n');
    expect(out).toContain('交互会话开始'); // 冒烟真的跑起来了 → 下面的阴性断言不是空转
    expect(out).not.toContain('· 本回合'); // 未注入 = 全程静默，一行成本都不打印
  });

  it('⑤ 对照：注入 usageStore → runChat 每回合打印「· 本回合」（证明 ④ 的阴性断言非空洞）', async () => {
    const { io, output } = scriptedIO(['你好', '/quit']);
    const code = await runChat({
      workspaceRoot: root,
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      io,
      usageStore: new UsageStore({ rootDir: usageRoot, pricing: PRICING }),
    });
    expect(code).toBe(0);
    expect(output.join('\n')).toContain('· 本回合'); // 同一冒烟路径，注入后确有成本行
  });

  /**
   * ⑥ 端到端**接线**判别（G-09 REJECT 根因回归）。
   *
   * ④/⑤ 只证明「注入后有一行 `· 本回合`」——但**接线断裂**时（`buildHarness` 不把
   * `usageStore` 传给 `composeHarness`）那行照样会打印，只是恒为
   * `· 本回合 $0.0000（无用量记录）`；⑤ 因此漏掉了缺陷。本用例换判据：
   * 不预置任何用量，全部数字只能来自 `runChat` 的真实记账链路
   * （MockProvider stream → usage chunk → AgentLoop(`packages/core/.../AgentLoop.ts:275/296`
   * 的 `after_model { usage }`) → `compose.ts:297-318` 的订阅者 → `UsageStore.record`）。
   * 接线一断，`totals()` 停在空表，下面两条断言必然红。
   *
   * 注意：**不断言金额数值**——MockProvider 默认 100 in / 20 out，按 PRICING 折算约
   * $0.00005，`toFixed(4)` 正确显示 `$0.0000`，断言「金额非 0」会把正确实现判红（假阴性）。
   * 真正判别的是 `calls` / `inputTokens` 这类 token 级记账。
   */
  it('⑥ 接线判别性：真实 UsageStore（不预置）+ mock provider 跑 runChat → 记账真的写进了 store', async () => {
    // 真 store、临时 root、固定价目；刻意**不** record → 一切只能由 runChat 产生。
    const usageStore = new UsageStore({ rootDir: usageRoot, pricing: PRICING });
    expect(usageStore.totals().calls).toBe(0); // 前置空表：下面的 > 0 不可能是既有数据

    const { io, output } = scriptedIO(['你好', '/quit']);
    const code = await runChat({
      workspaceRoot: root,
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      io,
      usageStore, // G-09 接线修复（chat.ts:275-276）：必须一路传到 composeHarness
    });

    expect(code).toBe(0);

    // —— 判别断言（接线断裂时必然为 0 → 必然红）——
    const totals = usageStore.totals();
    expect(totals.calls).toBeGreaterThan(0);
    // MockProvider 默认上报 { inputTokens: 100, outputTokens: 20 }（MockProvider.ts:85-86,125,139），
    // 所以真实记账路径跑通后这里的 in 计数不可能低于 100。
    expect(totals.inputTokens).toBeGreaterThanOrEqual(100);

    // —— 输出层佐证：有 usage → 走「含 token 明细」分支 ——
    const out = output.join('\n');
    expect(out).toContain('· 本回合');
    expect(out).toMatch(/· 本回合 \$[\d.]+（\d+ in \/ \d+ out）/); // 金额 + 明细都在
    // 明细非空就说明 after_model 真带了 usage（renderTurnDelta 的「无用量记录」分支未被选中）
    expect(out).not.toContain('· 本回合 $0.0000（无用量记录）');
  });

  it('⑦ /cost 输出三行：本会话 / 今日 / 累计（真实 UsageStore，空表也成立）', async () => {
    const usageStore = new UsageStore({ rootDir: usageRoot, pricing: PRICING }); // 空表：第一行走「暂无用量记录」
    const { io } = scriptedIO([]);
    const res = await dispatchSlash('/cost', {
      store: newStore(),
      io,
      sessionWorkspace: root,
      usageStore,
    });
    const out = res?.output ?? '';
    expect(out).toContain('本会话'); // 空表时为「本会话暂无用量记录」，三行结构不变
    expect(out).toContain('今日'); // 本地日聚合行（dispatchSlash 内 daily() 成功即出现）
    expect(out).toContain('累计');
  });
});

/**
 * G-13-P1 / G-13-P2 回归 —— Round 11 复评 REJECT 必修 3。
 *
 * 复评事实：`/permission`、`/model` 的实现看起来是对的（改状态 → 置空 harness →
 * `syncSessionMeta` 落盘），但 `apps/cli/src/tui` **零测试覆盖**——把 `runChat`
 * 主循环里「应用 `SlashResult`」那一段整块删掉，全量测试仍然全绿。同时 AC1 当时
 * 只有「文件没被写」一个 bit，无法排除「harness 重建抛错导致回合根本没跑」这一
 * 替代解释。
 *
 * 本块全部走**真实 `runChat`**（不是直接调 `dispatchSlash` 的纯函数旁路），并用
 * 负对照让每条断言都有判别性：
 *   ① /permission 返回值契约：合法值带 `permission` 字段；非法值**不带**字段（不假成功）
 *   ② /model 返回值契约：带 `model` 字段；无参数则不带
 *   ③ 主循环**真的**把 permission 应用进会话并落盘（负对照：不切 → 仍是 workspace-write）
 *   ④ 主循环**真的**把新 model 下达到 provider（负对照：不切 → 仍是旧 model）（AC2 仓内版）
 *   ⑤ AC1 的 deny 面证据：read-only 下 Write 被真实拒绝、且回合照常跑完（无 `[错误]`）；
 *      负对照：不切权限则同一个 Write **成功**（文件真被创建）
 *   ⑥ G-13-P2 locale 接线：`settings.json` 的 locale 真的被 `? <术语>` 消费
 *      （负对照：zh / 缺文件 → 中文头），并证明没有回落到真实 `~/.vessel`
 *
 * 隔离（AGENTS.md §8）：四个状态根（provider/usage/session/settings）全部
 * `mkdtempSync` 注入 env，afterEach 还原并清理——不读也不写真实 `~/.vessel`。
 * （`runChat` 在进循环前会 `resolveChatLocale(opts.settingsRoot)`，因此
 * `VESSEL_SETTINGS_ROOT` 必须与另外三个一起钉住，否则解释类断言随机器而变。）
 */
describe('G-13-P1/P2 — /permission 与 /model 在 runChat 主循环真正生效（含四根隔离）', () => {
  /** 四个状态根 env：全部钉到临时目录，afterEach 逐个还原。 */
  const ENV_KEYS = [
    'VESSEL_PROVIDER_ROOT',
    'VESSEL_USAGE_ROOT',
    'VESSEL_SESSION_ROOT',
    'VESSEL_SETTINGS_ROOT',
  ] as const;

  let providerRoot: string;
  let usageRoot: string;
  let sessionRoot: string;
  let sessionControlRoot: string;
  let sessionUpdateRoot: string;
  let settingsRoot: string;
  let altSettingsRoot: string;
  let workspace: string;
  let savedEnv: Array<[string, string | undefined]>;

  beforeEach(() => {
    providerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-g13-prov-'));
    usageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-g13-usage-'));
    sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-g13-sess-'));
    sessionControlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-g13-sess-ctl-'));
    sessionUpdateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-g13-sess-upd-'));
    settingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-g13-set-'));
    altSettingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-g13-set-alt-'));
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-g13-ws-'));
    savedEnv = ENV_KEYS.map((k): [string, string | undefined] => [k, process.env[k]]);
    process.env.VESSEL_PROVIDER_ROOT = providerRoot;
    process.env.VESSEL_USAGE_ROOT = usageRoot;
    process.env.VESSEL_SESSION_ROOT = sessionRoot;
    process.env.VESSEL_SETTINGS_ROOT = settingsRoot;
  });

  afterEach(() => {
    for (const [k, v] of savedEnv) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const d of [providerRoot, usageRoot, sessionRoot, sessionControlRoot, sessionUpdateRoot, settingsRoot, altSettingsRoot, workspace]) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  /**
   * 走真实 `runChat`：脚本化输入 → 退出码 + 逐行输出。
   *
   * 只开放 `provider` / `model` 两个注入口（显式传递，不做对象展开）——`runChat`
   * 的其余选项（四个状态根、policy/behavior 路径）一律走本块的临时环境。
   */
  const runScripted = async (
    inputs: string[],
    extra: { provider?: ChatOptions['provider']; model?: ChatOptions['model'] } = {},
  ): Promise<{ code: number; output: string[]; text: string }> => {
    const { io, output } = scriptedIO(inputs);
    const code = await runChat({
      workspaceRoot: workspace,
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      io,
      provider: extra.provider,
      model: extra.model,
    });
    return { code, output, text: output.join('\n') };
  };

  const slashCtx = () => ({
    store: new ProviderStore({ rootDir: providerRoot }),
    io: scriptedIO([]).io,
    sessionWorkspace: workspace,
  });

  /** 本会话登记的 meta（临时会话根；`list()` 最近活动在前）。 */
  const sessionMetaList = (root: string) => new SessionRegistry({ vesselHome: root }).list();

  /**
   * 记录型 provider（④⑤ 共用）：继承 `MockProvider` 保留脚本化行为，额外记录
   * 每次 model 调用收到的 **完整 `ChatRequest`** —— 直接证明主循环把什么 model /
   * 什么工具结果交给了 provider，而不是只看 runChat 打印了什么。
   */
  class RecordingProvider extends MockProvider {
    readonly requests: ChatRequest[] = [];

    constructor(script: MockScriptEntry[], opts: MockProviderOptions = {}) {
      super(script, opts);
    }

    override async chat(request: ChatRequest): Promise<ChatResponse> {
      this.requests.push(request);
      return super.chat(request);
    }

    override async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
      this.requests.push(request);
      yield* super.stream(request);
    }
  }

  const PLAIN_SCRIPT: MockScriptEntry[] = [{ when: /.*/, response: { text: 'PONG' } }];

  it('① /permission 合法值返回 permission 字段；非法值绝不返回该字段（不得宣称成功）', async () => {
    const ok = await dispatchSlash('/permission read-only', slashCtx());
    expect('permission' in ok).toBe(true); // 字段存在 = 主循环会应用
    expect(ok.permission).toBe('read-only'); // 且是校验后的字面量，不是原样回显
    expect(ok.output).toContain('已切换权限为 read-only');

    // 非法值：只回用法，**不返回** permission 字段 —— 否则就是「文案说切了、实际没切」。
    const bogus = await dispatchSlash('/permission bogus', slashCtx());
    expect('permission' in bogus).toBe(false);
    expect(Object.keys(bogus)).not.toContain('permission');
    expect(bogus.output).not.toContain('已切换权限'); // 不得出现成功文案
    expect(bogus.output).toContain('用法');

    // 无参数：同样不得返回字段。
    const bare = await dispatchSlash('/permission', slashCtx());
    expect('permission' in bare).toBe(false);
  });

  it('② /model <id> 返回 model 字段；无参数则不返回（用法提示）', async () => {
    const ok = await dispatchSlash('/model deepseek-chat', slashCtx());
    expect(ok.model).toBe('deepseek-chat');
    expect(ok.output).toContain('已切换模型为 deepseek-chat');

    const bare = await dispatchSlash('/model', slashCtx());
    expect('model' in bare).toBe(false);
    expect(bare.output).toContain('用法');
  });

  it('③ 主循环应用 /permission 并落盘会话 meta；负对照：不切权限 → 仍是 workspace-write', async () => {
    // —— 判别组：先 /permission read-only，再跑一个自然语言回合（harness 懒建 → 登记）——
    const switched = await runScripted(['/permission read-only', '你好', '/quit']);
    expect(switched.code).toBe(0);
    expect(switched.text).toContain('已切换权限为 read-only'); // 命令确实被执行

    const listed = sessionMetaList(sessionRoot);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.provider).toBe('mock'); // 确实是这次 TUI 会话登记的那条
    expect(listed[0]!.permission).toBe('read-only'); // 主循环的应用结果落了盘

    // —— 负对照：同一份脚本去掉 /permission → 同一路径下仍是缺省权限 ——
    // 若 ③ 的断言只是某个恒定值，这里必然一起变红。
    process.env.VESSEL_SESSION_ROOT = sessionControlRoot;
    const control = await runScripted(['你好', '/quit']);
    expect(control.code).toBe(0);
    const controlListed = sessionMetaList(sessionControlRoot);
    expect(controlListed).toHaveLength(1);
    expect(controlListed[0]!.permission).toBe('workspace-write'); // 缺省值，未被 /permission 改过
    expect(controlListed[0]!.permission).not.toBe(listed[0]!.permission); // 两条路径确实不同

    // —— 追加判别：harness **已建**之后才切换 → 覆盖 syncSessionMeta 回写既有登记项 ——
    // 顺序反过来（先自然语言回合建会话，再 /permission）时，登记项已存在，只能靠
    // syncSessionMeta 的 get → put 刷新；只改内存状态而不回写，这里必然仍是 workspace-write。
    process.env.VESSEL_SESSION_ROOT = sessionUpdateRoot;
    const late = await runScripted(['你好', '/permission read-only', '/quit']);
    expect(late.code).toBe(0);
    const lateListed = sessionMetaList(sessionUpdateRoot);
    expect(lateListed).toHaveLength(1); // 回写既有项，不是又新建一条
    expect(lateListed[0]!.permission).toBe('read-only'); // 既有登记项被同步成新权限
  });

  it('④ /model 后 provider 真实收到新 model（AC2 仓内版）；负对照：不切 → 仍是旧 model', async () => {
    const switched = new RecordingProvider(PLAIN_SCRIPT, { model: 'mock-model-1' });
    const out = await runScripted(['/model mock-model-2', '你好', '/quit'], {
      provider: switched,
      model: 'mock-model-1',
    });
    expect(out.code).toBe(0);
    expect(switched.requests.length).toBeGreaterThanOrEqual(1);
    // 判别断言：切换后**每一次** model 调用都带新 model（切换前没有任何 model 调用）。
    expect(switched.requests.map((r) => r.model)).toEqual(switched.requests.map(() => 'mock-model-2'));
    expect(switched.requests.some((r) => r.model === 'mock-model-1')).toBe(false);

    // 负对照：同一 provider 脚本、同一个 opts.model，去掉 /model → 仍是旧 model。
    const control = new RecordingProvider(PLAIN_SCRIPT, { model: 'mock-model-1' });
    const outControl = await runScripted(['你好', '/quit'], { provider: control, model: 'mock-model-1' });
    expect(outControl.code).toBe(0);
    expect(control.requests.length).toBeGreaterThanOrEqual(1);
    expect(control.requests[control.requests.length - 1]!.model).toBe('mock-model-1');
  });

  it('⑤ AC1 deny 面：read-only 下 Write 被真实拒绝且回合照常跑完；负对照：不切权限则写入成功', async () => {
    const probeName = 'deny-probe.txt';
    const probePath = path.join(workspace, probeName);
    // 脚本：第 1 步发一个真实 Write 工具调用；第 2 步把模型真正收到的工具结果回显出来。
    const writeScript: MockScriptEntry[] = [
      {
        when: /.*/,
        ifNoToolResult: true,
        response: { toolCalls: [{ name: 'Write', arguments: { path: probeName, content: 'probe-content' } }] },
      },
      { when: /.*/, minToolResults: 1, response: { text: 'WRITE_PROBE={last_tool_result}' } },
    ];

    // —— 判别组：切到 read-only → Write 必须被硬执法拒绝 ——
    const deniedProvider = new RecordingProvider(writeScript, { model: 'mock-model' });
    const denied = await runScripted(['/permission read-only', '写一个探针文件', '/quit'], {
      provider: deniedProvider,
    });
    expect(denied.code).toBe(0);
    expect(fs.existsSync(probePath)).toBe(false); // AC1 旧判据：文件没被写
    // 新增判据（deny 面）：模型**真的**收到了 [DENIED] 工具结果，而不是「回合没跑」。
    expect(denied.text).toContain('DENIED');
    expect(denied.text).toMatch(/\[DENIED\]/);
    expect(denied.text).not.toContain('[错误]'); // 排除「重建 harness 抛错导致回合没跑」
    expect(deniedProvider.requests.length).toBeGreaterThanOrEqual(2); // deny 之后模型被再次调用 → 回合继续跑完

    // —— 负对照：不切权限（workspace-write）→ 同一个 Write 成功，文件真被创建 ——
    const allowedProvider = new RecordingProvider(writeScript, { model: 'mock-model' });
    const allowed = await runScripted(['写一个探针文件', '/quit'], { provider: allowedProvider });
    expect(allowed.code).toBe(0);
    expect(fs.existsSync(probePath)).toBe(true); // 工具真的执行了
    expect(fs.readFileSync(probePath, 'utf8')).toBe('probe-content');
    expect(allowed.text).toContain('wrote'); // 成功工具结果回显
    expect(allowed.text).not.toContain('DENIED'); // ⑤ 的 DENIED 不是恒定文案
  });

  it('⑥ locale 接线：settings.json locale=en → 英文解释头；负对照 zh / 缺文件 → 中文头', async () => {
    // en：临时 settings 根下写 locale=en —— 若 runChat 去读了真实 ~/.vessel，这里不会命中。
    fs.writeFileSync(
      path.join(settingsRoot, 'settings.json'),
      JSON.stringify({ theme: 'dark', locale: 'en' }),
      'utf8',
    );
    const en = await runScripted(['? Call', '/quit']);
    expect(en.code).toBe(0);
    expect(en.text).toContain('=== Glossary:'); // renderExplain(entry, 'en') 的特征头
    expect(en.text).not.toContain('=== 术语解释:'); // 不是中文渲染

    // 负对照 1：同一位置写 locale=zh → 走中文头。
    process.env.VESSEL_SETTINGS_ROOT = altSettingsRoot;
    fs.writeFileSync(
      path.join(altSettingsRoot, 'settings.json'),
      JSON.stringify({ theme: 'dark', locale: 'zh' }),
      'utf8',
    );
    const zh = await runScripted(['? Call', '/quit']);
    expect(zh.code).toBe(0);
    expect(zh.text).toContain('=== 术语解释:');
    expect(zh.text).not.toContain('=== Glossary:');

    // 负对照 2：settings.json 缺失 → SettingsStore 缺省 'zh'（证明该路径不回落真实 ~/.vessel）。
    process.env.VESSEL_SETTINGS_ROOT = path.join(altSettingsRoot, 'no-settings-here');
    const missing = await runScripted(['? Call', '/quit']);
    expect(missing.code).toBe(0);
    expect(missing.text).toContain('=== 术语解释:');
    expect(missing.text).not.toContain('=== Glossary:');
  });
});

/**
 * BRIEF-17 —— 回合 `kind` 必须如实可见（TUI 侧）。
 *
 * 复现（改前）：`runChat` 主循环只对 `kind === 'interrupted'` 单独处理，其余一律
 * 「有 `finalText` 就当助手回复打印」。`AgentLoop` 在 `DenialLimitError` 时把错误文案
 * 写进 `finalText` 并置 `kind='error'`（不是抛异常——抛异常那条才走 `catch` 的 `[错误] …`），
 * 于是 `same intent denied 3 times: Write` 被 TUI 原样当作**助手回复**打印：
 * 整段输出里既没有 `[错误]` 也没有 `kind=` 痕迹（用例 ① 的两条判别断言在旧实现下必红）。
 *
 * 本块的判别性（"删掉修复就红"）：
 *   ① `kind='error'` ⇒ 必须出现 `[错误]` 且错误文本原样保留（旧实现零 `[错误]` ⇒ 红）；
 *   ② 负对照（最重要）：`kind='success'` 且带 `finalText` ⇒ 输出与今日**逐字一致**
 *      （回复行 == `'\n' + finalText`，无任何前缀/标记）—— 防"把一切都渲染成错误"；
 *   ③ 四种 `kind` 的呈现逐字钉死，含 `interrupted` 既有文案不变（脚本化 IO 驱动不到
 *      Ctrl+C，故用 `renderTurnOutcome` 纯函数钉；它正是主循环唯一出口所调用的函数）；
 *   ④ `kind='budget'` ⇒ 不得再与"正常回答 / 模型没说话"混同（真实 runChat 一条）。
 *
 * 隔离（AGENTS.md §8）：五个状态根（provider/usage/session/settings/mcp）全部
 * `mkdtempSync` 注入 env，afterEach 还原并清理——不读也不写真实 `~/.vessel`。
 */
describe('BRIEF-17 — TUI 回合 kind 呈现：error 必须可见 / success 逐字不变', () => {
  const ENV_KEYS = [
    'VESSEL_PROVIDER_ROOT',
    'VESSEL_USAGE_ROOT',
    'VESSEL_SESSION_ROOT',
    'VESSEL_SETTINGS_ROOT',
    'VESSEL_MCP_ROOT',
  ] as const;

  let roots: string[];
  let workspace: string;
  let savedEnv: Array<[string, string | undefined]>;

  beforeEach(() => {
    roots = ENV_KEYS.map(() => fs.mkdtempSync(path.join(os.tmpdir(), 'cah-b17-')));
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-b17-ws-'));
    savedEnv = ENV_KEYS.map((k): [string, string | undefined] => [k, process.env[k]]);
    ENV_KEYS.forEach((k, i) => {
      process.env[k] = roots[i]!;
    });
  });

  afterEach(() => {
    for (const [k, v] of savedEnv) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const d of [...roots, workspace]) fs.rmSync(d, { recursive: true, force: true });
  });

  /** 走真实 `runChat`：脚本化输入 → 退出码 + 逐行输出（与上面 G-13 块同法，根各自隔离）。 */
  const runScripted = async (
    inputs: string[],
    extra: { provider?: ChatOptions['provider'] } = {},
  ): Promise<{ code: number; output: string[]; text: string }> => {
    const { io, output } = scriptedIO(inputs);
    const code = await runChat({
      workspaceRoot: workspace,
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      io,
      provider: extra.provider,
    });
    return { code, output, text: output.join('\n') };
  };

  it('① kind=error 的回合：必须出现 [错误] 且保留错误文本（旧实现当助手回复打印 ⇒ 必红）', async () => {
    // read-only 下同一个 Write 连发 3 次 → AgentLoop 的 denial breaker 抛 DenialLimitError
    // → runTurn 把它折叠成 kind='error' 且 finalText=错误文案**正常返回**（不走 catch）。
    // maxToolResults: 2 → 第 1/2/3 次 model 调用都发同一意图（第 3 次即熔断）。
    const denialScript: MockScriptEntry[] = [
      {
        when: /.*/,
        maxToolResults: 2,
        response: { toolCalls: [{ name: 'Write', arguments: { path: 'deny-probe.txt', content: 'probe-content' } }] },
      },
    ];
    const provider = new MockProvider(denialScript, { model: 'mock-model' });
    const out = await runScripted(['/permission read-only', '写一个探针文件', '/quit'], { provider });

    expect(out.code).toBe(0);
    // 阳性控制：这轮真的以错误结束（文案来自 DenialLimitError），且真的被拒（不是假错误）
    expect(out.text).toContain('same intent denied 3 times: Write');
    expect(fs.existsSync(path.join(workspace, 'deny-probe.txt'))).toBe(false);
    // 判别断言 1：错误必须**可见**（旧实现整段输出里一个 [错误] 都没有 ⇒ 红）
    expect(out.text).toMatch(/\[错误\]/);
    expect(out.text).toContain('kind=error');
    // 判别断言 2：错误文本必须落在**错误行**上，而不是被当成助手回复（旧实现 ⇒ 红）
    const errLine = out.output.find((l) => l.startsWith('\n[错误]'));
    expect(errLine).toBeDefined();
    expect(errLine).toContain('same intent denied 3 times: Write');
    expect(errLine).not.toContain('（mock 离线冒烟）'); // 非模型文本不盖模型标记
    expect(out.output.some((l) => l.trim() === 'same intent denied 3 times: Write')).toBe(false);
  });

  it('② 负对照：kind=success 带 finalText ⇒ 输出与今日逐字一致（不加任何前缀/标记）', async () => {
    const provider = new MockProvider([{ when: /.*/, response: { text: 'BRIEF17-PLAIN-OK' } }], { model: 'mock-model' });
    const out = await runScripted(['打个招呼', '/quit'], { provider });

    expect(out.code).toBe(0);
    // **逐字**：回复行的完整内容（含前导换行）就等于 '\n' + finalText —— 数组元素全等比较，
    // 任何一个前缀/标记/换行差异都会红。
    expect(out.output).toContain('\nBRIEF17-PLAIN-OK');
    expect(out.output.some((l) => l.trim() === 'BRIEF17-PLAIN-OK')).toBe(true);
    expect(out.text).not.toContain('[错误]');
    expect(out.text).not.toContain('[提示]');
    expect(out.text).not.toContain('kind='); // 正常回合不带任何 kind 标注
    expect(out.text).not.toContain('（mock 离线冒烟）'); // 注入 provider ⇒ 不加 mock 标记（BRIEF-16 1C② 负对照）
  });

  it('③ 四种 kind 的呈现逐字钉死：success / interrupted 不变，error / budget 必须带标记', () => {
    const at = (over: Partial<TurnOutcomeLike> & { kind: TurnOutcomeLike['kind'] }): TurnOutcomeLike => ({
      finalText: 'TXT',
      steps: 3,
      toolCalls: 2,
      ...over,
    });

    // —— 不变的两条：success 逐字 + interrupted 既有文案 ——
    expect(renderTurnOutcome(at({ kind: 'success' }), false)).toBe('\nTXT');
    expect(renderTurnOutcome(at({ kind: 'success', finalText: '' }), false)).toBe('(无文本回复)');
    expect(renderTurnOutcome(at({ kind: 'interrupted' }), false)).toBe('\n^C turn 已中断（kind=interrupted）');

    // —— error：可见 + 保留错误文本；空文本也不退化成"像正常回复" ——
    const err = renderTurnOutcome(at({ kind: 'error', finalText: 'BOOM' }), false);
    expect(err).toContain('[错误]');
    expect(err).toContain('BOOM');
    expect(renderTurnOutcome(at({ kind: 'error', finalText: '' }), false)).toContain('[错误]');

    // —— budget：不再等于 (无文本回复)；带文本也不吞 ——
    const budget = renderTurnOutcome(at({ kind: 'budget', finalText: '' }), false);
    expect(budget).toContain('[提示]');
    expect(budget).toContain('kind=budget');
    expect(budget).toContain('3 步');
    expect(budget).not.toBe('(无文本回复)');
    expect(renderTurnOutcome(at({ kind: 'budget', finalText: 'PARTIAL' }), false)).toContain('PARTIAL');

    // —— mock 标记只属于"模型回复"：错误/预算行不盖模型标记；真 mock 回复仍带 ——
    expect(renderTurnOutcome(at({ kind: 'error', finalText: 'BOOM' }), true)).not.toContain('（mock 离线冒烟）');
    expect(renderTurnOutcome(at({ kind: 'budget', finalText: '' }), true)).not.toContain('（mock 离线冒烟）');
    expect(renderTurnOutcome(at({ kind: 'success' }), true)).toBe('\n（mock 离线冒烟）TXT');
  });

  it('④ kind=budget 的回合：不得再与「正常回答 / 模型没说话」混同（真实 runChat）', async () => {
    // 单步就置 budget：provider 返回**纯文本空串** ⇒ AgentLoop 走「纯文本即停」但 finalText=''
    // （AgentLoop.ts 末尾把 finalText==='' 的 success 折叠成 kind='budget'）——与「步数上限」
    // 同为 budget，TUI 侧改前只打 (无文本回复)，看不出"这轮没有产出最终回复"。
    const provider = new MockProvider([{ when: /.*/, response: { text: '' } }], { model: 'mock-model' });
    const out = await runScripted(['空回复', '/quit'], { provider });

    expect(out.code).toBe(0);
    const line = out.output.find((l) => l.startsWith('\n[提示]'));
    expect(line).toBeDefined();
    expect(line).toContain('kind=budget');
    expect(line).toContain('已跑 1 步'); // 如实给出实际步数（不猜原因）
    expect(out.text).not.toContain('(无文本回复)'); // 旧实现的呈现 ⇒ 红
  });

  /**
   * BRIEF-20（「kind 说谎」·核心修复的 TUI 消费面判别）—— 被 A03 `BeforeTurn` 拒绝的输入
   * 在核心侧已改为 `kind='error'`（`AgentLoop.ts` deny 分支三处一致）。本块的判别点：
   * TUI 的**唯一呈现出口** `renderTurnOutcome`（runChat 主循环就是调用它，chat.ts:755）
   * 在这条 kind 上必须给出**明确的错误标记** `[错误]`，而不是把 `[blocked] …` 当正常助手回复打。
   *
   * 「删哪行会红」：
   *   ⑤ 把 AgentLoop deny 分支的 `kind` 改回 `'success'` ⇒ `renderTurnOutcome` 落到
   *      `case 'success'` ⇒ 输出是裸的 `'\n' + finalText`、零 `[错误]` ⇒ 该用例三条断言红
   *      （这正是改前的真实呈现）；payload 里若把 `result` 换成手写 `{kind:'success'}` 也一样。
   *   ⑥ 负对照：同一构造、不挂否决监听器的正常回合 ⇒ 呈现仍是 `'\n' + finalText` 逐字不变
   *      （"把所有回合都渲染成错误"会在⑥红）。
   *
   * 路径说明（为什么不是 `runChat(…)`）：生产组合根今天**不挂** before_turn 否决监听器
   * （`compose.ts` 只有 before_tool + 两个观察者），`runChat` 内部自建 harness 且不回传 bus
   * ⇒ 脚本化 IO 驱动的 `runChat` 到不了这条分支。故用 `runChat` 用的**同一个组合根**建 harness，
   * 把"输入被拒绝"这一**输入面**挂到真实 bus 上，再把真实 `TurnResult` 喂给 runChat 用的
   * **同一个** `renderTurnOutcome` ——被测量对象逐字未替换。（正常回合的 `runChat` 端到端
   * 呈现由本文件用例①②/④逐字钉住，未受影响。）
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

  const composeBlockProbe = async (): Promise<{ h: ComposedHarness; provider: BlockProbeProvider }> => {
    const provider = new BlockProbeProvider();
    const h = await composeHarness({
      workspaceRoot: workspace,
      provider,
      model: 'block-probe',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
    });
    return { h, provider };
  };

  it('⑤ 被拦截的输入：TUI 必须带 [错误] 标记，不得当正常助手回复打印（改前 kind=success ⇒ 必红）', async () => {
    const { h, provider } = await composeBlockProbe();
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

      const rendered = renderTurnOutcome(result, false);

      // 判别断言 1：必须带明确的错误标记（与既有 error 分支逐字一致；改前零 [错误] ⇒ 红）
      expect(rendered).toContain('[错误]');
      expect(rendered).toContain('kind=error');
      // 判别断言 2：原因与 [blocked] 标记都不吞
      expect(rendered).toContain('[blocked]');
      expect(rendered).toContain(DENY_REASON);
      // 判别断言 3：不是"正常助手回复"的呈现 —— 既没有裸回复行，也不盖模型标记
      expect(rendered).not.toBe(`\n${result.finalText}`);
      expect(rendered).not.toContain('（mock 离线冒烟）');
      expect(rendered).not.toContain('MODEL-ANSWER-SHOULD-NOT-BE-REACHED');
    } finally {
      await h.close();
    }
  });

  it('⑥ 负对照：不挂否决监听器的正常回合，呈现与今日逐字一致', async () => {
    const { h, provider } = await composeBlockProbe();
    try {
      const result = await h.loop.runTurn('打个招呼');

      expect(provider.calls).toBe(1);
      expect(result.kind).toBe('success');
      expect(result.finalText).toBe('MODEL-ANSWER-SHOULD-NOT-BE-REACHED');
      // **逐字**：成功路径仍是 '\n' + finalText，无任何前缀/标记（防"把一切都渲染成错误"）
      expect(renderTurnOutcome(result, false)).toBe('\nMODEL-ANSWER-SHOULD-NOT-BE-REACHED');
      expect(renderTurnOutcome(result, false)).not.toContain('[错误]');
    } finally {
      await h.close();
    }
  });

  /**
   * 本卡（**回合文本判据共用**）—— TUI 侧的判别性验收。
   *
   * 缺陷形态（commit `dfe55b9` 的提交信息称 "the two faces share one criterion"，实际两份实现）：
   * `cli.ts` 有一份 `isModelReplyKind`，而**本文件**的 `renderTurnOutcome` 在 `case 'success'` 里
   * **自己**决定要不要走 `renderTurnReply` —— 那是第二份判据（不是"调用同一份"）。
   * 危害不是"重复"，而是**下一个人会按"改一处即两处生效"去改，而只改到一处**：本文件的 switch
   * 是穷尽的（新增 kind ⇒ 编译报错），CLI 那份却对第五种 kind **静默返回 false** ⇒ 必然分叉。
   *
   * 判别性（"删掉修复就红"）：
   *  - A（静态）：本文件不再 import 判据 / 又抄回一份判据 / 模型回复出口不再由判据把门 ⇒ 红；
   *  - B（负对照）：未识别 kind 落到"当成功打印"（或不再保持改前的 `undefined`）⇒ 红。
   *
   * 如实标注（见交付⑥）：动态那条（把 `turnText.js` 换成替身 ⇒ 两个面同时变）**需要
   * `vi.mock` 专用文件**（本仓既有做法：`packages/agents/src/turnStopReason.wiring.test.ts`；
   * 模块级 mock 会污染同文件全部用例，故不能塞进本文件），超出本卡声明的改动范围
   * （只允许在 `cli.test.ts` / 本文件里加用例）。替代证据见 `cli.test.ts`「本卡⑤/⑥/⑦」：
   * 静态唯一实现 + 运行期**函数对象身份**（`cli.isModelReplyKind === turnText.isModelReplyKind`）
   * + 两面对表（两个面在"盖不盖标记"上同进同退）。
   */
  it('本卡A（唯一实现·静态守卫）：模型回复出口由共用判据把门，且本文件不再自带判据', () => {
    const src = fs.readFileSync(path.join(fileURLToPath(new URL('.', import.meta.url)), 'chat.ts'), 'utf8');

    // (a) 从唯一实现（零依赖叶子模块）导入 ← 旧实现没有这个 import ⇒ 红
    expect(src).toMatch(/import\s*\{[^}]*\bisModelReplyKind\b[^}]*\}\s*from\s*'\.\.\/turnText\.js'/);
    // (b) 不得定义第二份判据、也不得出现旧判据的写法 ← 旧实现正是本文件自带一份判据
    expect(src).not.toMatch(/\b(?:function|const|let|var)\s+isModelReplyKind\b/);
    expect(src).not.toContain("kind === 'success'");

    // (c) 模型回复出口 `renderTurnReply` 在 `renderTurnOutcome` 里**只有一个调用点**，
    //     且它排在判据**之后** ⇒ 出口确实由共用判据把门（不是"import 了但没用"）
    const decisionSite = src.slice(src.indexOf('export function renderTurnOutcome'));
    expect((decisionSite.match(/renderTurnReply\(/g) ?? []).length).toBe(1);
    const gateAt = decisionSite.indexOf('isModelReplyKind(result.kind)');
    expect(gateAt).toBeGreaterThan(-1);
    expect(decisionSite.indexOf('renderTurnReply(')).toBeGreaterThan(gateAt);
  });

  it('本卡B（负对照）：未识别的 kind 不得"当成功打印"——保持改前的 undefined', () => {
    // 类型封闭（四个 kind），故用断言构造"运行期 union 之外的 kind"；生产路径不可达。
    const unknown = {
      kind: 'mystery',
      finalText: 'SHOULD-NOT-APPEAR',
      steps: 1,
      toolCalls: 0,
    } as unknown as TurnOutcomeLike;

    for (const usingMock of [true, false]) {
      const line = renderTurnOutcome(unknown, usingMock) as unknown;
      // ① 绝不"当成功打印"：既不盖模型标记，也不把 finalText 当模型回复打出来
      expect(String(line)).not.toContain('（mock 离线冒烟）');
      expect(String(line)).not.toContain('SHOULD-NOT-APPEAR');
      // ② 原行为逐字保持：改前的穷尽 switch 对未识别 kind 落空 ⇒ `undefined`。
      //    本卡只搬判据，**不改**这条边界（不新增"未知 kind 就当失败/当提示"的裁决）。
      expect(line).toBeUndefined();
    }
  });
});
