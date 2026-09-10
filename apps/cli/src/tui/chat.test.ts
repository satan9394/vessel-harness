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
import { ProviderStore } from '../providers/ProviderStore.js';
import { providerStateRoot } from '../providers/defaultStore.js';
import { dispatchSlash, runChat, makeLineReader, resolveChatStore, TwoStageCtrlC, type ChatSessionIO } from './chat.js';

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
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-tui-run-'));
    // task 106 隔离：runChat 的默认 ProviderStore 必须落在这个临时 root，
    // 绝不能读真实 ~/.vessel（否则机器上 current=真实供应商时这些用例会打真网络）。
    oldProviderRoot = process.env.VESSEL_PROVIDER_ROOT;
    process.env.VESSEL_PROVIDER_ROOT = dir;
  });
  afterEach(() => {
    if (oldProviderRoot === undefined) delete process.env.VESSEL_PROVIDER_ROOT;
    else process.env.VESSEL_PROVIDER_ROOT = oldProviderRoot;
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

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-106-'));
    oldProviderRoot = process.env.VESSEL_PROVIDER_ROOT;
    process.env.VESSEL_PROVIDER_ROOT = dir; // 临时状态根：不读不写真实 ~/.vessel
  });
  afterEach(() => {
    if (oldProviderRoot === undefined) delete process.env.VESSEL_PROVIDER_ROOT;
    else process.env.VESSEL_PROVIDER_ROOT = oldProviderRoot;
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
