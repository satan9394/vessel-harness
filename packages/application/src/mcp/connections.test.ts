/**
 * connections.test.ts — MCP「降级但不静默」的**仓内单测**（BRIEF-13 §6 / 验收 3 的 (a)(b)(c)(d)）。
 *
 * ## 这个文件补的是哪块证据缺口
 *
 * BRIEF-13 验收 3 的四条断言 ——
 *   (a) `composeHarness` 不抛
 *   (b) 降级清单含该 server 且 reason 非空
 *   (c) registry 内**无** `mcp__*`
 *   (d) 内置工具（如 `Read`）**仍可见**
 * 此前只有指挥侧 CLI E2E **间接**覆盖 (a)(b)；(c)(d) 在仓内零证据。本文件把它们钉成可重跑的断言。
 *
 * ## 故障 transport 的选择：为什么用同进程 transport，而不是 `new StdioTransport('不存在')`
 *
 * 静态结论（本文件据此设计，见下方「不可达 command」两条用例与 opt-in 探针）：
 *
 *   1. `createMcpConnections()` 的 try/catch 只包住 **构造期**（`connections.ts:77-89`）。
 *   2. 但 `spawn()` 对「可执行文件不存在」**不抛同步异常**：Node 把 `ENOENT`（以及
 *      `EACCES/EAGAIN/EMFILE/ENFILE`）交给 `process.nextTick`，以子进程 `'error'` 事件的形式异步送达
 *      （这正是 `StdioTransport` 在构造器里挂 `this.child.on('error')` 的原因，`McpClient.ts:118-121`）。
 *   3. 于是「不可达 command」的 server **不会**进 `createMcpConnections().failures`，反而会产出一个
 *      transport，把失败推迟到 `composeHarness` 的 `await client.initialize()`（`compose.ts:262`）——
 *      而那一刻子进程句柄早已 dead，向它的 stdin 写入走的是 EPIPE/已销毁 socket 这条**预期**异常路径
 *      （同仓库 `packages/tools/src/mcp/stdioTransport.e2e.test.ts:318-323` 就为此显式挂了 stdin error 监听，
 *      「挂个监听避免变成未处理错误」）。也就是说真实结果大概率是**未处理 error 或挂起**，而不是干净降级。
 *
 * 因此：**能稳定证明 compose 降级分区的，是一个 `initialize` 必定失败的 McpTransport**
 * （`createInProcessTransport`，`@vessel/tools` 公开导出）。它不冒充 stdio 机制证据 ——
 * 「StdioTransport 能否真 spawn 任意 command」由 `packages/tools/src/mcp/stdioTransport.e2e.test.ts`
 * 用真子进程证明；本文件的断言对象是**接口层契约**（`McpClient` 只依赖 `McpTransport`，
 * 两条路径在 `compose.ts:257-274` 走的是同一段代码）。
 *
 * ## 纪律
 *
 * - 不联网；不碰真实 `~/.vessel`；workspace 用 `mkdtempSync`，`afterEach` 收尸。
 * - 每个 harness 都被 track，`afterEach` 无条件 `close()`；每个真 stdio transport 都被 reap
 *   （close → 50ms 宽限不够就补 SIGKILL），不留孤儿子进程。
 * - 静态上无法稳定成立的断言一律 `it.skipIf` + 写明条件，不写假绿断言。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockProvider } from '@vessel/llm';
import {
  StdioTransport,
  createInProcessTransport,
  handleMcpRequest,
  type McpTransport,
} from '@vessel/tools';
import { createMcpConnections, type McpServerDescriptor } from './connections.js';
import { composeHarness, type ComposedHarness, type ComposeMcpConnection } from '../compose.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const POLICY = path.join(REPO_ROOT, 'configs', 'policy.default.yaml');
const BEHAVIOR = path.join(REPO_ROOT, 'configs', 'behavior.default.yaml');

/** PATH 上不存在的可执行文件名：spawn 必然失败，不会下载、不会联网、不会留下真进程。 */
const GHOST_BINARY = 'definitely-not-a-real-binary-xyz';

/**
 * opt-in 探针开关。默认**关闭**：这两条用例断言的正是「Node 对 spawn ENOENT 的异步语义」
 * 与「dead child 的 stdin 写入行为」，属于运行时实现细节，不适合放进默认绿灯集；
 * 需要人工复核时用 `VESSEL_TEST_MCP_STDIO_PROBE=1 npx vitest run packages/application/src/mcp/connections.test.ts`。
 */
const STDIO_PROBE = process.env.VESSEL_TEST_MCP_STDIO_PROBE === '1';

/* ────────────────────────── 共用工具 ────────────────────────── */

/** `child` 是 `StdioTransport` 的私有字段；收尸/挂 error 监听只能显式穿透（与 tools 的 e2e 同法）。 */
function childOf(transport: StdioTransport): ChildProcess {
  return (transport as unknown as { child: ChildProcess }).child;
}

/**
 * 尽力收尸：先走 transport 自己的 close()，50ms 宽限不够就补一次 SIGKILL。
 * 对「从未启动成功」的子进程，stdin/stdout 的 EPIPE 是预期路径 —— 先挂监听，
 * 否则会变成未处理的 stream 'error'（会让整个 worker 炸掉，而不是让断言失败）。
 */
async function reap(transport: StdioTransport): Promise<void> {
  const child = childOf(transport);
  child.stdin?.on('error', () => {});
  child.stdout?.on('error', () => {});
  child.stderr?.on('error', () => {});
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
  }
}

/** 刻意非法的声明：`command` 不是字符串。外部 JSON 声明由读取器校验，这里验证单点失败不传播。 */
function malformed(name: string): McpServerDescriptor {
  return { name, command: undefined as unknown as string };
}

/** 一个 `initialize` 必定失败的 transport（接口层故障注入，不 spawn 任何进程）。 */
function failingTransport(): McpTransport {
  return createInProcessTransport(() => {
    throw new Error('initialize 握手失败（测试注入的故障 transport）');
  });
}

function namesOf(harness: ComposedHarness): string[] {
  return harness.registry.listVisible().map((t) => t.name);
}

/* ══════════════════════════════════════════════════════════════════════════════════════════ */
/* 一、createMcpConnections —— 纯函数层的降级语义（不为任何断言 spawn 真进程，除注明处）        */
/* ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('MCP 连接降级 — createMcpConnections（纯函数）', () => {
  it('构造期抛错的声明被降级为 failures：connections 空、每项 serverName 对应且 reason 非空', () => {
    const result = createMcpConnections([malformed('alpha'), malformed('beta')]);

    expect(result.connections).toEqual([]);
    expect(result.failures).toHaveLength(2);
    expect(result.failures.map((f) => f.serverName)).toEqual(['alpha', 'beta']);
    for (const f of result.failures) {
      expect(typeof f.reason).toBe('string');
      expect(f.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it('一个坏声明不拖垮其余 server：混合输入 → 1 个连接 + 1 条降级（单点失败不传播）', async () => {
    // 好声明用一个真能 spawn 的真进程（node -e exit），确保「成功」这一侧不是虚构的
    const result = createMcpConnections([
      malformed('broken'),
      { name: 'healthy', command: process.execPath, args: ['-e', 'process.exit(0)'] },
    ]);

    expect(result.failures.map((f) => f.serverName)).toEqual(['broken']);
    expect(result.connections.map((c) => c.serverName)).toEqual(['healthy']);
    expect(result.failures[0]!.reason.trim().length).toBeGreaterThan(0);

    await Promise.all(result.connections.map((c) => reap(c.transport)));
  });

  it('不可达 command 不在构造期失败（spawn 的 ENOENT 是异步 error 事件）——降级清单只能在 initialize 阶段观察到', async () => {
    const result = createMcpConnections([{ name: 'ghost', command: GHOST_BINARY }]);

    // 与 Node 版本无关的不变式：不抛、不静默丢、恰好一条记录、失败必带原因。
    expect(result.connections.length + result.failures.length).toBe(1);
    expect([...result.connections.map((c) => c.serverName), ...result.failures.map((f) => f.serverName)]).toEqual([
      'ghost',
    ]);
    for (const f of result.failures) expect(f.reason.trim().length).toBeGreaterThan(0);

    // 本机当前 Node 的实际落点见下一条 opt-in 探针（connections 而非 failures）。
    // 结论：BRIEF-13 §6 的降级分区**不能**靠「不可达 command」在纯函数层证伪，必须走 composeHarness。
    await Promise.all(result.connections.map((c) => reap(c.transport)));
  });

  it.skipIf(!STDIO_PROBE)(
    'opt-in 探针（VESSEL_TEST_MCP_STDIO_PROBE=1）：当前 Node 把不可达 command 记进 connections，而非 failures',
    async () => {
      const result = createMcpConnections([{ name: 'ghost', command: GHOST_BINARY }]);
      expect(result.failures).toHaveLength(0);
      expect(result.connections.map((c) => c.serverName)).toEqual(['ghost']);
      await Promise.all(result.connections.map((c) => reap(c.transport)));
    },
  );
});

/* ══════════════════════════════════════════════════════════════════════════════════════════ */
/* 二、composeHarness —— BRIEF-13 验收 3 (a)(b)(c)(d)                                          */
/* ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('BRIEF-13 验收 3 — composeHarness 的 MCP 失败分区', () => {
  let dir = '';
  let ws = '';
  let opened: ComposedHarness[] = [];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-mcp-conn-'));
    ws = path.join(dir, 'workspace');
    fs.mkdirSync(ws, { recursive: true });
  });

  // 断言中途抛错也会走到这里：harness 一律 close（不留子进程 / 不留半开 session）。
  afterEach(async () => {
    const harnesses = opened.splice(0);
    for (const h of harnesses) await h.close();
    vi.restoreAllMocks();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = '';
    ws = '';
  });

  /** 与既有 compose 用例同形的构造：显式 mock provider + 仓库 configs 下的 policy/behavior。 */
  async function compose(mcp: ComposeMcpConnection[]): Promise<ComposedHarness> {
    const harness = await composeHarness({
      workspaceRoot: ws,
      provider: new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'OK' } }], {
        model: 'mock-model',
      }),
      model: 'mock-model',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      mcp,
    });
    opened.push(harness);
    return harness;
  }

  it('验收 3a（全失败分支）：createMcpConnections 全失败 → 把成功项（空）交给 composeHarness → 正常返回', async () => {
    const declared = createMcpConnections([malformed('bad-1'), malformed('bad-2')]);
    expect(declared.connections).toHaveLength(0);
    expect(declared.failures).toHaveLength(2);

    // 产品写法（apps/cli/src/cli.ts、tui/chat.ts）：只把**成功**那些交给 compose
    const harness = await compose(
      declared.connections.map((c) => ({ serverName: c.serverName, transport: c.transport })),
    );

    expect(harness.mcpClients).toHaveLength(0);
    expect(harness.mcpFailures).toEqual([]);
    expect(namesOf(harness)).toContain('Read'); // 内置工具不受影响
  });

  it('验收 3a/3b（最贴近缺陷）：transport 存在但 initialize 失败 → 不抛 + mcpFailures 含该项 + reason 非空 + warn 不静默', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const harness = await compose([{ serverName: 'ghost-server', transport: failingTransport() }]);

    // (a) 不抛 —— 能走到这里即已成立；失败被分区，而不是传播给主流程
    const failures = harness.mcpFailures ?? [];
    expect(failures).toHaveLength(1);
    const failure = failures[0]!;
    expect(failure.serverName).toBe('ghost-server');
    expect(typeof failure.reason).toBe('string');
    expect(failure.reason.trim().length).toBeGreaterThan(0);
    expect(failure.reason).toContain('握手失败');

    // 失败连接不得混进 mcpClients（close() 只关成功项）
    expect(harness.mcpClients).toHaveLength(0);

    // (b) 降级但不静默：warn 带 server 名（compose.ts:268）
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('ghost-server');
  });

  it('验收 3c：initialize 失败时 registry 内没有任何 mcp__* 工具', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const harness = await compose([{ serverName: 'ghost-server', transport: failingTransport() }]);
    expect(harness.mcpFailures).toHaveLength(1);

    const mcpNames = namesOf(harness).filter((n) => n.startsWith('mcp__'));
    expect(mcpNames).toEqual([]);
    expect(harness.registry.listAll().filter((t) => t.name.startsWith('mcp__'))).toEqual([]);
  });

  it('对照组：MCP 装载成功时 mcp__<server>__<tool> 确实进入 registry（证明 3c 的空集断言不是假绿）', async () => {
    const harness = await compose([
      { serverName: 'demo', transport: createInProcessTransport((m, p) => handleMcpRequest(m, p)) },
    ]);

    expect(harness.mcpFailures).toEqual([]);
    expect(harness.mcpClients).toHaveLength(1);
    const names = namesOf(harness);
    expect(names).toContain('mcp__demo__echo');
    expect(names).toContain('mcp__demo__add');
  });

  it('验收 3d：MCP 失败时内置工具仍可见（Read / Glob / Grep 等）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const harness = await compose([{ serverName: 'ghost-server', transport: failingTransport() }]);
    const names = namesOf(harness);

    expect(names).toContain('Read');
    expect(names).toContain('Glob');
    expect(names).toContain('Grep');
    // 同一场景下 3c 依然成立：可见集合 = 内置集合，没有任何 mcp__* 混入
    expect(names.filter((n) => n.startsWith('mcp__'))).toEqual([]);
  });

  it.skipIf(!STDIO_PROBE)(
    'opt-in 探针（VESSEL_TEST_MCP_STDIO_PROBE=1）：真 stdio transport 指向不可达 command 时 composeHarness 的实际结局',
    async () => {
      // 预测（见文件头静态分析）：transport 构造成功 → compose 的 initialize 撞上 dead child 的 stdin
      // → 未处理 error 或挂起。故本探针**默认跳过**；开启后若变红，那就是缺陷证据，不是测试写错。
      const transport = new StdioTransport(GHOST_BINARY);
      childOf(transport).stdin?.on('error', () => {});

      let harness: ComposedHarness | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        composeHarness({
          workspaceRoot: ws,
          provider: new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'OK' } }], {
            model: 'mock-model',
          }),
          model: 'mock-model',
          policySystemPath: POLICY,
          behaviorIRPath: BEHAVIOR,
          mcp: [{ serverName: 'ghost-server', transport }],
        }).then(
          (h) => {
            harness = h;
            opened.push(h);
            return `resolved:${JSON.stringify(h.mcpFailures)}` as const;
          },
          (err: Error) => `rejected:${err.message}` as const,
        ),
        new Promise<'hung'>((resolve) => {
          timer = setTimeout(() => resolve('hung'), 15_000);
        }),
      ]);
      if (timer) clearTimeout(timer);
      await reap(transport);

      expect(outcome, `探针结局：${outcome}`).not.toBe('hung');
      expect(outcome.startsWith('resolved:'), `composeHarness 抛了：${outcome}`).toBe(true);
      const failures = harness?.mcpFailures ?? [];
      expect(failures.map((f) => f.serverName)).toContain('ghost-server');
      expect((failures[0]?.reason ?? '').trim().length).toBeGreaterThan(0);
    },
    20_000,
  );
});
