/**
 * stdioTransport.e2e.test.ts — BRIEF-13 验收 1/2：`StdioTransport` 的**真跨进程** E2E。
 *
 * ## 这个文件存在的唯一理由：防「假绿」
 *
 * MCP 的协议核心（initialize / tools/list / tools/call）可以被一个**同进程函数**直接实现，
 * 用那种写法跑出来的绿灯**证明不了** BRIEF-13 要证的任何东西——本切片唯一的硬缺口是
 * 「`StdioTransport` 能不能真的 spawn 一个任意 command 并跟它说 JSON-RPC」。
 *
 * 因此本文件的判别性断言是**子进程句柄**：`StdioTransport` 实例上挂着一个真实
 * `ChildProcess`，`child.pid` 存在、不是 `process.pid`、且 `process.kill(pid, 0)` 探测为活。
 * 同进程的假传输没有 `child`，在第一条断言就会失败。
 * （文件末尾还有一条读自身源码的防作弊守卫，见 describe「anti-fake-green」。）
 *
 * 另外，**本文件不 import 任何同进程传输 / 协议核心函数**——不是自律，是被那条守卫机器检查。
 *
 * ## 三组用例
 *
 *   1. E2E（真 spawn fixture）：两条路径，各跑一遍完整链路
 *      - `npx` shim：`resolveSpawnCommand('npx')` → win32 下 `shell: true`（BRIEF-13 主诉求）
 *      - `node` + 本地 tsx CLI：不开 shell、不经 npx 的最短路径（无 npx 环境下的等价证明）
 *   2. Windows `.cmd` shim 解析：纯函数断言，无条件必绿
 *   3. 显式失败：服务器立刻退出 → 首次请求**抛错**而不是静默挂起；
 *      外加一条 mocked spawn 的守卫分支（子进程无 stdout → 构造期抛错）
 *
 * ## 纪律
 *
 * - 不碰真实 `~/.vessel`（fixture 是纯内存协议服务器，无状态根）。
 * - 不依赖网络：`npx` 路径只在**本地** `node_modules/.bin/tsx` 存在时启用（否则 `npx` 会去下载）；
 *   `node` + tsx CLI 路径直接跑本地 devDependency，完全不联网。
 * - 不依赖构建产物：直接跑 `src` 下的 `.ts` fixture（tsx 边上转译边跑）。
 * - 每个 transport 都被 track，`afterEach`/`afterAll` 收尸；若 `close()` 的 50ms 宽限不够，
 *   补一次 `SIGKILL` 再等 exit——**不留孤儿子进程**。
 * - 本机条件不满足的用例一律 `it.skipIf` 并写明跳过条件，绝不写会假绿的断言。
 *
 * ## 全量并发下不假红（本文件的稳定性闸门）
 *
 * 单跑时 npx 用例约 2.8s；全量 `vitest run`（上百个测试文件并行）时 `npx` 链路
 * （shell → `npx.cmd` → node → tsx → fixture）冷启动被 CPU/IO 挤压，**真正先咬人的不是
 * 用例级 30s 超时，而是单次 JSON-RPC 请求的默认超时 `DEFAULT_MCP_TIMEOUT_MS`（5s）**——
 * initialize 握手还没回来就被判死。因此闸门必须同时放宽两层：
 *   ① 握手请求超时 → `E2E_REQUEST_TIMEOUT_MS`（30s），用例预算 → 120s；
 *   ② 环境性启动/握手失败**有界退避重试 1 次**（`isRetryableEnvFailure` 精确分类）。
 * **断言失败（AssertionError）永不重试**：`content !== '42'` 这类真实红必须第一次就原样抛。
 * 判别性断言（`instanceof StdioTransport` / `child.pid !== process.pid` / `'42'`）一条不动。
 */
import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpClient, StdioTransport, resolveSpawnCommand } from './McpClient.js';
import { registerMcpTools } from './mcpTools.js';
import { ToolRegistry } from '../registry/Registry.js';

/* ────────────────────────── 路径与可用性探测（纯文件系统判断，不联网） ────────────────────────── */

const SELF_PATH = fileURLToPath(import.meta.url);
const HERE = path.dirname(SELF_PATH); // packages/tools/src/mcp
const REPO_ROOT = path.resolve(HERE, '../../../..');
const FIXTURE_REL = 'packages/tools/src/mcp/fixtures/echo-server.ts';
const FIXTURE_ABS = path.join(REPO_ROOT, 'packages', 'tools', 'src', 'mcp', 'fixtures', 'echo-server.ts');

/** 解析仓库本地 tsx CLI（devDependency，`bin: ./dist/cli.mjs`），拿不到返回 null。 */
function resolveLocalTsxCli(): string | null {
  const candidates: string[] = [];
  try {
    const req = createRequire(import.meta.url);
    const pkgPath = req.resolve('tsx/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      bin?: string | Record<string, string>;
    };
    const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['tsx'];
    if (rel) candidates.push(path.resolve(path.dirname(pkgPath), rel));
  } catch {
    /* 包解析失败（未安装 / exports 不含 package.json）→ 退回下面的直连路径 */
  }
  candidates.push(path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** `command` 是否能在 PATH 上找到（win32 认 .cmd/.exe/.bat）。 */
function commandOnPath(command: string): boolean {
  const dirs = (process.env['PATH'] ?? '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  return dirs.some((dir) => exts.some((ext) => existsSync(path.join(dir, command + ext))));
}

const TSX_CLI = resolveLocalTsxCli();

/** npx 只有配上**本地** tsx bin 才敢用（否则 npx 会尝试下载 → 依赖网络）。 */
const LOCAL_TSX_BIN = path.join(
  REPO_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
);
const NPX_E2E_AVAILABLE = commandOnPath('npx') && existsSync(LOCAL_TSX_BIN);

/* ────────────────────────── 并发稳定性闸门（超时 + 仅环境性失败的有界重试） ────────────────────────── */

/**
 * 单次 JSON-RPC 请求的超时（默认 `DEFAULT_MCP_TIMEOUT_MS` = 5s）。
 * 全量并发时 npx 链路冷启动会被拖长，5s 会在**握手阶段**就判死——抬到 30s
 * （单跑整例约 2.8s，留 ~10x 余量）。
 */
const E2E_REQUEST_TIMEOUT_MS = 30_000;
/** 单个用例的总预算：最坏 2 次尝试（每次 ≤ ~40s）+ 退避 3s，仍有余量。 */
const E2E_TEST_TIMEOUT_MS = 120_000;
/** 收尸钩子预算：默认 hookTimeout 30s 其实够（reap ≤ ~5s/子进程），显式写死免随全局配置漂移。 */
const E2E_HOOK_TIMEOUT_MS = 60_000;
/** 最多尝试次数：首次 + 1 次「环境性失败」重试（不针对断言失败重试）。 */
const E2E_MAX_ATTEMPTS = 2;
const E2E_RETRY_BACKOFF_MS = 3_000;

/** 环境性失败用固定前缀标记，与真实断言失败区分开（便于日志定位假红来源）。 */
const ENV_FLAKE_MARK = '[mcp-e2e env-flake]';

function envFlake(message: string): Error {
  return new Error(`${ENV_FLAKE_MARK} ${message}`);
}

/**
 * **只**把环境性启动/握手失败判为可重试：请求超时、EPIPE、spawn ENOENT、子进程意外消失。
 * 判别性断言失败（Vitest/Chai 的 `AssertionError`，如 `'41' !== '42'`）永不在此列，
 * 也不能靠消息文本碰巧命中——否则就是拿判别力换稳定。
 */
function isRetryableEnvFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AssertionError') return false; // 断言失败：不重试，原样抛
  if (err.message.includes(ENV_FLAKE_MARK)) return true;
  return /mcp request timeout after \d+ms|EPIPE|ENOENT|ECONNRESET|socket hang up|MCP server exited/i.test(
    err.message,
  );
}

/**
 * registry 执行结果里的**传输层**失败（`mcpTools` 会把 MCP RPC 错误包成 TOOL_FAILURE 结果
 * 返回而**不抛错**）→ 抛可重试的环境性错误；其它错误（含真实业务失败）原样留给断言。
 */
function throwIfTransportFlake(result: { error?: { message?: string } }, label: string): void {
  const message = result.error?.message;
  if (message && isRetryableEnvFailure(new Error(message))) {
    throw envFlake(`${label} 传输层失败：${message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ────────────────────────── 子进程句柄工具（判别性的关键） ────────────────────────── */

/** `child` 是 StdioTransport 的私有字段；测试要拿它做判别 + 收尸，只能显式穿透。 */
function childOf(transport: StdioTransport): ChildProcess {
  return (transport as unknown as { child: ChildProcess }).child;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    child.once('exit', finish);
  });
}

const live: StdioTransport[] = [];
function track(transport: StdioTransport): StdioTransport {
  live.push(transport);
  return transport;
}

/** 尽力收尸：先走 transport 自己的 close()，50ms 宽限不够就补一次硬杀。 */
async function reap(transport: StdioTransport): Promise<void> {
  const child = childOf(transport);
  try {
    await transport.close();
  } catch {
    /* 服务器可能已经自己死了 */
  }
  if (child && child.exitCode === null && child.signalCode === null) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    await waitForExit(child, 5_000);
  }
}

afterEach(async () => {
  for (const transport of live.splice(0)) await reap(transport);
}, E2E_HOOK_TIMEOUT_MS);

// 兜底：某条用例在断言中途抛错时，afterEach 仍会跑；afterAll 只做最后一次清扫。
afterAll(async () => {
  for (const transport of live.splice(0)) await reap(transport);
}, E2E_HOOK_TIMEOUT_MS);

/* ────────────────────────── 与 mcp.test.ts 同形的 registry 上下文 ────────────────────────── */

const REGISTRY_CTX = {
  workspaceRoot: process.cwd(),
  cwd: process.cwd(),
  sandbox: {
    confine: async () => ({ argv: [], enforcement: 'none' as const }),
    status: () => ({ enabled: false, supported: 'none' as const, active: false }),
  },
};

/* ────────────────────────── E2E 主体：一次真跨进程的完整链路 ────────────────────────── */

interface SpawnDescriptor {
  command: string;
  args: string[];
}

/**
 * 一个 transport = 一个**真** MCP server 子进程，跑完整链路并断言。
 * 判别性断言在最前面：没有真 `child` 的同进程实现到不了协议断言。
 */
async function assertRealStdioEndToEnd(transport: StdioTransport, spawned: SpawnDescriptor): Promise<void> {
  // ① 判别性：实例类型 + 真子进程句柄 + pid 独立且在跑
  expect(transport).toBeInstanceOf(StdioTransport);
  const child = childOf(transport);
  expect(child).toBeTruthy();
  expect(typeof child.pid).toBe('number');
  expect(child.pid).not.toBe(process.pid);
  expect(pidAlive(child.pid as number)).toBe(true);

  // ② 启动命令是 npx 或 node（即真正被 spawn 的命令），不是任何同进程标记
  expect([process.execPath, 'npx']).toContain(spawned.command);
  expect(spawned.args.join(' ')).toContain('echo-server.ts');

  // ③ 协议：initialize → tools/list（经 registerMcpTools 动态注册）
  const client = new McpClient(transport, 'demo');
  // 显式放宽**单次请求**超时：并发全量下 npx/tsx 冷启动可能远超默认 5s，
  // 而超时会把 transport 永久置为 closed——那才是这条用例在全量里变红的直接原因。
  const info = await client.initialize(E2E_REQUEST_TIMEOUT_MS);
  expect(info.protocolVersion).toBe('2024-11-05');
  expect(info.serverInfo.name).toBe('echo-server'); // fixture 自报的名字

  const registry = new ToolRegistry([]);
  const registered = await registerMcpTools(registry, 'demo', client);
  // fixture（echoServerCore.ts）注册的工具名是 echo / add → mcp__demo__echo / mcp__demo__add
  expect(registered.map((r) => r.name).sort()).toEqual(['mcp__demo__add', 'mcp__demo__echo']);

  const visible = registry.listVisible().map((t) => t.name);
  expect(visible).toContain('mcp__demo__add');
  expect(visible.sort()).toEqual(['mcp__demo__add', 'mcp__demo__echo']);

  // ④ tools/call：经 registry 执行，跨进程拿回 fixture 的 content[0].text
  const add = await registry.execute(
    { toolCallId: 'e2e', toolName: 'mcp__demo__add', arguments: { a: 20, b: 22 } },
    REGISTRY_CTX,
  );
  // 传输层失败（RPC 超时 / 断连）不算断言失败——交给重试闸门；真实业务失败照常走断言。
  throwIfTransportFlake(add, 'mcp__demo__add');
  expect(add.error).toBeUndefined();
  expect(add.content).toBe('42'); // 20 + 22，fixture 返回 String(a + b)
  expect(add.meta.mcpServer).toBe('demo');
  expect(add.meta.mcpTool).toBe('add');

  // echo 一并过一遍，确认不是只有一条硬编码路径能通
  const echo = await registry.execute(
    { toolCallId: 'e2e-echo', toolName: 'mcp__demo__echo', arguments: { text: 'STDIO-E2E-OK' } },
    REGISTRY_CTX,
  );
  throwIfTransportFlake(echo, 'mcp__demo__echo');
  expect(echo.error).toBeUndefined();
  expect(echo.content).toBe('STDIO-E2E-OK');
}

/** 用例收尾：close 之后子进程必须已经收尸（退出码/信号已知，或被标记 killed）。 */
async function closeAndAssertReaped(transport: StdioTransport): Promise<void> {
  const child = childOf(transport);
  await reap(transport);
  expect(child.exitCode !== null || child.signalCode !== null || child.killed).toBe(true);
  if (typeof child.pid === 'number') {
    expect(pidAlive(child.pid)).toBe(false);
  }
}

/**
 * 一次尝试：新建**真** transport（判别性句柄来自它）→ 判别性断言 + 完整链路断言 → 收尸。
 * 失败先把这次尝试的子进程收干净再抛：请求超时后的 transport 已被永久 `closed`，
 * 重试必须新建实例，绝不能把孤儿进程叠起来。
 */
async function runE2EAttempt(spawned: SpawnDescriptor, opts: { shell?: boolean }): Promise<void> {
  const transport = track(new StdioTransport(spawned.command, spawned.args, { ...opts, cwd: REPO_ROOT }));
  try {
    await assertRealStdioEndToEnd(transport, spawned);
    await closeAndAssertReaped(transport);
  } catch (err) {
    await reap(transport);
    throw err;
  }
}

/**
 * 有界退避重试：并发全量下的**环境性**启动/握手失败最多重来 `E2E_MAX_ATTEMPTS - 1` 次；
 * 真实断言失败（`isRetryableEnvFailure` 明确排除 AssertionError）第一次就原样抛出。
 */
async function runE2EWithEnvRetry(spawned: SpawnDescriptor, opts: { shell?: boolean }): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await runE2EAttempt(spawned, opts);
      return;
    } catch (err) {
      if (attempt >= E2E_MAX_ATTEMPTS || !isRetryableEnvFailure(err)) throw err;
      console.warn(
        `[e2e] 第 ${attempt}/${E2E_MAX_ATTEMPTS} 次尝试为环境性失败，` +
          `${E2E_RETRY_BACKOFF_MS}ms 后退避重试：${(err as Error).message}`,
      );
      await sleep(E2E_RETRY_BACKOFF_MS);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('BRIEF-13 — StdioTransport 真跨进程 E2E（MCP over stdio）', () => {
  it.skipIf(!NPX_E2E_AVAILABLE)(
    'e2e：经 npx shim（win32 shell:true）spawn fixture，registry 里 mcp__demo__add 返回 42',
    async () => {
      // 走产品路径：resolveSpawnCommand 决定 shell（win32 上 npx 是 .cmd shim）
      const { command, shell } = resolveSpawnCommand('npx');
      const args = ['tsx', FIXTURE_REL];
      // 每次尝试都重新 spawn 一个真子进程；判别性断言仍在 assertRealStdioEndToEnd 里原样执行
      await runE2EWithEnvRetry({ command, args }, { shell });
    },
    E2E_TEST_TIMEOUT_MS,
  );

  it.skipIf(!TSX_CLI)(
    'e2e：经 node + 本地 tsx CLI（无 shell、不经 npx）spawn fixture，链路同样走通',
    async () => {
      const tsxCli = TSX_CLI;
      expect(tsxCli, 'tsx CLI 未解析到（本用例本该被 skipIf 跳过）').toBeTruthy();
      if (!tsxCli) return;

      const args = [tsxCli, FIXTURE_ABS];
      // 同样走「超时放宽 + 仅环境性失败重试」：这条虽短（无 npx/shell），
      // 冷启动仍受并发挤压，且它是全量下**始终执行**的那条真跨进程证据。
      await runE2EWithEnvRetry({ command: process.execPath, args }, {});
    },
    E2E_TEST_TIMEOUT_MS,
  );

  it.skipIf(!existsSync(SELF_PATH))(
    'anti-fake-green：本文件的源码里没有同进程传输 / 协议核心函数的任何调用',
    () => {
      const src = readFileSync(SELF_PATH, 'utf8');
      // 数组拼接：这两个名字一旦**字面**出现在本文件里，下面的断言就会自己失败
      const forbidden = [
        ['create', 'In', 'Process', 'Transport'].join(''),
        ['handle', 'Mcp', 'Request'].join(''),
      ];
      for (const name of forbidden) {
        expect(new RegExp(`\\b${name}\\b`).test(src), `不得出现 ${name}`).toBe(false);
      }
      expect(src).toContain('new StdioTransport(');
      expect(src).toContain('resolveSpawnCommand(');
    },
  );
});

describe('BRIEF-13 验收 2 — Windows .cmd shim 解析（纯函数，无条件必绿）', () => {
  it('win32 上 npx 走 shell（.cmd shim），linux 上不开 shell', () => {
    expect(resolveSpawnCommand('npx', 'win32')).toEqual({ command: 'npx', shell: true });
    expect(resolveSpawnCommand('npx', 'linux')).toEqual({ command: 'npx', shell: false });
    expect(resolveSpawnCommand('npx', 'darwin')).toEqual({ command: 'npx', shell: false });
  });

  it('白名单外的命令在 win32 上也不开 shell（避免参数被二次解析）', () => {
    expect(resolveSpawnCommand('node', 'win32')).toEqual({ command: 'node', shell: false });
    expect(resolveSpawnCommand('python', 'win32')).toEqual({ command: 'python', shell: false });
    // 即使名字带 .cmd 后缀，也不在白名单内 → 直连 spawn
    expect(resolveSpawnCommand('my-mcp-server.cmd', 'win32')).toEqual({
      command: 'my-mcp-server.cmd',
      shell: false,
    });
  });

  it('白名单内的包管理器 shim 在 win32 上一律走 shell', () => {
    for (const shim of ['npx', 'npm', 'pnpm', 'yarn', 'uvx']) {
      expect(resolveSpawnCommand(shim, 'win32')).toEqual({ command: shim, shell: true });
    }
  });

  it('默认平台取 process.platform（本机行为与显式传入一致）', () => {
    const viaDefault = resolveSpawnCommand('npx');
    expect(viaDefault).toEqual(resolveSpawnCommand('npx', process.platform));
    // 本机是 win32 → shell:true；否则 shell:false
    expect(viaDefault.shell).toBe(process.platform === 'win32');
  });
});

describe('BRIEF-13 — stdout / 服务器消失时的显式失败（不静默挂起）', () => {
  it('服务器立刻退出时，首次请求抛错而不是挂起', async () => {
    const transport = track(new StdioTransport(process.execPath, ['-e', 'process.exit(0)'], { cwd: REPO_ROOT }));
    const child = childOf(transport);
    // 服务器已消失时向 stdin 写入会 EPIPE；这是预期路径，挂个监听避免变成未处理错误
    child.stdin?.on('error', () => {
      /* expected: server already gone */
    });

    const client = new McpClient(transport, 'dead-server');

    let timer: ReturnType<typeof setTimeout> | undefined;
    const hung = new Promise<'hung'>((resolve) => {
      timer = setTimeout(() => resolve('hung'), 5_000);
    });
    const outcome = await Promise.race([
      client.initialize().then(
        () => 'resolved' as const,
        (err: Error) => `rejected:${err.message}` as const,
      ),
      hung,
    ]);
    if (timer) clearTimeout(timer);

    expect(outcome).not.toBe('hung'); // 关键：不允许静默挂起
    expect(outcome.startsWith('rejected:')).toBe(true);

    await closeAndAssertReaped(transport);
  }, 20_000);

  it('子进程拿不到 stdout 时，构造期就抛错（守卫分支，mocked spawn）', async () => {
    // 真实 spawn 永远会给 stdout（构造器硬编码 stdio:['pipe','pipe','pipe']），
    // 这条守卫分支无法用真子进程廉价触发 → 用 mocked spawn 精确打靶，不做任何 e2e 声明。
    vi.resetModules();
    let killed = false;
    vi.doMock('node:child_process', () => ({
      spawn: () => ({
        stdout: null,
        stderr: null,
        stdin: null,
        killed: false,
        kill: () => {
          killed = true;
          return true;
        },
        on: () => undefined,
      }),
    }));
    try {
      const mod = await import('./McpClient.js');
      expect(() => new mod.StdioTransport('definitely-not-a-real-command')).toThrow(/stdout/);
      expect(killed).toBe(true); // 抛错前必须先把半启动的子进程杀掉
    } finally {
      vi.doUnmock('node:child_process');
      vi.resetModules();
    }
  });
});
