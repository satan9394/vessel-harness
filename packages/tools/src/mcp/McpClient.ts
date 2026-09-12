import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import type { McpToolDescriptor } from './fixtures/echoServerCore.js';

export type { McpToolDescriptor };

/**
 * 默认请求超时（ms）：MCP server 不响应时**快速失败**而不是永久挂起
 * （BRIEF-13 错误场景：server 起得来但不回 initialize）。
 */
export const DEFAULT_MCP_TIMEOUT_MS = 5000;

/**
 * 单次 `request` 的可选语义（**向后兼容**：作为第 4 个**可选**参数追加，
 * 既有实现只声明 3 个参数也依然满足 `McpTransport`，可整体忽略它）。
 */
export interface McpRequestOptions {
  /**
   * 超时是否**致命** —— 决定「一次超时」是废掉整条连接，还是只废掉这一次调用：
   *
   * - `true`：该次超时判定连接已死 → 置 `closed` + 记录原因；后续请求立即以
   *   `MCP transport closed` 快速失败。**建连/握手**用：server 起不来就该放弃。
   * - `false` / **缺省**：只让**这一次**调用 reject（错误信息里说明 transport 仍可用），
   *   清理该条 pending、**不置 `closed`**，后续调用照常。
   *   **业务调用**用：一次慢 RPC（网络/IO 超过 `timeoutMs`）不该永久废掉一个健康的 server。
   *
   * 缺省取 `false`（安全侧）：漏传参数的代价只是「这次调用失败」，而不是误杀整条连接；
   * 需要「超时即判死」的路径（`McpClient.initialize()`）必须**显式**传 `true`。
   */
  fatalOnTimeout?: boolean;
}

/**
 * Minimal JSON-RPC 2.0 transport for an MCP server (MISSION V0.2-M4).
 * `request` sends a request and resolves with the result payload.
 */
export interface McpTransport {
  /**
   * `timeoutMs` 是**可选**的：实现可以忽略它（例如 in-process transport），
   * 接口语义不变；`McpClient` 侧另有兜底超时，保证任何 transport 都不会永久挂起。
   *
   * `opts.fatalOnTimeout` 同样是**可选**的：忽略它的实现语义退化为「超时只作废本次调用」，
   * 不影响其余契约；能识别的 transport（`StdioTransport`）据此决定是否永久关闭连接。
   */
  request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs?: number,
    opts?: McpRequestOptions,
  ): Promise<T>;
  close(): Promise<void>;
}

export interface McpCallContent {
  type: string;
  text?: string;
}

export interface McpCallResult {
  content: McpCallContent[];
  isError?: boolean;
}

/** In-process transport (fixture/testing): routes directly to a handler fn. */
export function createInProcessTransport(
  handler: (method: string, params: unknown) => unknown | Promise<unknown>,
): McpTransport {
  return {
    async request<T = unknown>(method: string, params?: unknown): Promise<T> {
      return (await handler(method, params)) as T;
    },
    async close() {
      /* nothing to close */
    },
  };
}

/**
 * Windows 下 `npx`/`npm` 等是 `.cmd` shim：无 shell 的 spawn 会 ENOENT。
 * 只对已知包管理器 shim 走 shell（白名单），其余命令保持直连 spawn（避免参数二次解析）。
 * 非 win32 一律不 shell。
 */
export function resolveSpawnCommand(
  command: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; shell: boolean } {
  const SHELL_SHIMS = new Set(['npx', 'npm', 'pnpm', 'yarn', 'uvx']);
  if (platform === 'win32' && SHELL_SHIMS.has(command)) {
    return { command, shell: true };
  }
  return { command, shell: false };
}

/**
 * stdio transport: spawns an arbitrary command and speaks line-delimited
 * JSON-RPC over stdin/stdout. The legacy `node <serverPath>` behaviour is
 * expressed by the caller passing `process.execPath` as `command`.
 */
export class StdioTransport implements McpTransport {
  private readonly child: ChildProcess;
  private readonly rl: readline.Interface;
  private seq = 0;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  /**
   * 连接已不可用（被 close() 关闭，或被**标记为 fatal 的**请求超时判定为死连接）。
   * 业务调用（tools/list、tools/call）的超时**不**置这一位——那只是一次调用失败。
   */
  private closed = false;
  /** close() 是否已经跑过——与 `closed` 分开，避免「致命超时置 closed」把收尸的 close() 变成空操作。 */
  private closing = false;
  /** 置 `closed` 的原因（致命超时时带上方法名，便于定位）。 */
  private closedReason: string | null = null;

  /**
   * @param command executable to spawn. Pass `process.execPath` (with the script
   *   path as the first arg) to keep the legacy `node <serverPath>` behaviour;
   *   for `npx`/`npm` on Windows use `resolveSpawnCommand()` first.
   * @param args arguments handed to `command` verbatim; they are never re-parsed
   *   by a command line unless `opts.shell` is explicitly true.
   * @param opts optional env/cwd overrides and an explicit shell opt-in.
   */
  constructor(
    command: string,
    args: string[] = [],
    opts: { env?: Record<string, string>; cwd?: string; shell?: boolean } = {},
  ) {
    this.child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...(opts.shell ? { shell: true } : {}),
      ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    });
    const stdout = this.child.stdout;
    if (!stdout) {
      // No silent fallback to process.stdin: that would never see a server line
      // and would mask the real spawn failure behind a 2s close() timeout.
      this.child.kill();
      throw new Error('[mcp] stdio transport 启动失败：子进程 stdout 不可用');
    }
    this.rl = readline.createInterface({ input: stdout, crlfDelay: Infinity });
    this.rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        msg = JSON.parse(trimmed) as { id?: number; result?: unknown; error?: { message?: string } };
      } catch {
        return;
      }
      if (msg.id === undefined) return;
      const entry = this.takePending(msg.id);
      if (!entry) return;
      if (msg.error) {
        entry.reject(new Error(msg.error.message ?? 'MCP RPC error'));
      } else {
        entry.resolve(msg.result);
      }
    });
    this.child.stderr?.on('data', () => {
      /* server diagnostics — ignore for the seam */
    });
    this.child.on('error', (err) => {
      this.failAllPending(err);
    });
    this.child.on('exit', () => {
      this.failAllPending(new Error('MCP server exited'));
    });
  }

  /** 取出并清除某条 pending（连同它的超时定时器）——避免悬挂 resolver / 定时器泄漏。 */
  private takePending(
    id: number,
  ): { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | undefined {
    const entry = this.pending.get(id);
    if (!entry) return undefined;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    return entry;
  }

  /** 子进程出错 / 退出：一次性 reject 所有在途请求并清理各自的定时器。 */
  private failAllPending(err: Error): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
  }

  /**
   * 发送请求并在 `timeoutMs` 内等待响应。
   *
   * 超时语义**按 `opts.fatalOnTimeout` 分区**（BRIEF-13 缺陷 1 + Round 13 复评）：
   * 两条路径都 **reject** 一个带方法名的明确错误、都清掉该条 pending（不留悬挂 resolver）；
   * 区别只在 transport 的生死：
   *
   * - `fatalOnTimeout: true`（建连/握手）：置 `closed` + 记录原因，后续调用立即快速失败，
   *   不会继续挂在同一个死连接上。
   * - `fatalOnTimeout: false`/缺省（业务调用）：**只作废这一次调用**，transport 保持可用，
   *   后续请求照常发送——一次慢 RPC 不该把整个 server 在本会话里永久废掉。
   */
  request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs: number = DEFAULT_MCP_TIMEOUT_MS,
    opts: McpRequestOptions = {},
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error(this.closedReason ?? 'MCP transport closed'));
    }
    const fatalOnTimeout = opts.fatalOnTimeout ?? false;
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        // 无论致命与否都必须清 pending：否则会留下悬挂 resolver / 定时器。
        this.pending.delete(id);
        if (fatalOnTimeout) {
          this.closed = true;
          this.closedReason = `mcp request timeout after ${timeoutMs}ms: ${method} (transport closed)`;
          reject(new Error(`mcp request timeout after ${timeoutMs}ms: ${method}`));
          return;
        }
        // 非致命：transport 不置 closed，后续调用仍可继续（错误信息里明说这一点）。
        reject(
          new Error(
            `mcp request timeout after ${timeoutMs}ms: ${method} (call-scoped timeout, transport still usable)`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        this.child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }) + '\n');
      } catch (err) {
        // 写不进去（EPIPE / 流已关闭）：立即失败，别等超时。
        const entry = this.takePending(id);
        entry?.reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * 关停子进程。
   *
   * 关键：不响应 stdin EOF 的 MCP server 很常见，所以 `SIGKILL` 兜底**不可被取消**。
   * 这里保留 50ms 的「快速返回」语义，但那个 2s 定时器只在子进程真的退出/出错时
   * 才被清掉——`close()` 返回后绝不会留下「既不响应 EOF 又永远活着」的子进程。
   */
  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.closed = true;
    this.rl.close();
    this.child.stdin?.end();

    const killTimer = setTimeout(() => {
      this.child.kill('SIGKILL');
    }, 2000);
    const disarmKill = (): void => clearTimeout(killTimer);
    this.child.once('exit', disarmKill);
    this.child.once('error', disarmKill);

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      this.child.once('exit', finish);
      this.child.once('error', finish);
      // 50ms 宽限只为「尽快返回」；`killTimer` 不受影响，2s 后照常补刀。
      setTimeout(finish, 50);
    });
  }
}

/**
 * McpClient — minimal MCP client (tools/list + tools/call; stdio + in-process
 * transports). Dynamic registration of remote tools into the registry is the
 * responsibility of registerMcpTools(); schema is loaded at registration
 * (D3 decision point 7: MCP is the only dynamic extension channel).
 */
export class McpClient {
  constructor(
    private readonly transport: McpTransport,
    public readonly serverName: string,
  ) {}

  /**
   * MCP 握手。
   *
   * @param timeoutMs 超时（默认 `DEFAULT_MCP_TIMEOUT_MS`）。超时会 reject 一个
   *   `mcp request timeout after <n>ms: initialize` 的明确错误，**不会**静默挂起；
   *   即使 transport 忽略该参数（如 in-process），`withTimeout` 也会兜底。
   *
   * 握手是**建连**语义：超时视为 server 不可用 → 显式传 `fatalOnTimeout: true`，
   * 让 transport 永久关闭（`compose.ts` 逐 server try/catch 依赖这次失败做降级）。
   */
  async initialize(
    timeoutMs: number = DEFAULT_MCP_TIMEOUT_MS,
  ): Promise<{ protocolVersion: string; serverInfo: { name: string; version: string } }> {
    return this.withTimeout(
      this.transport.request<{ protocolVersion: string; serverInfo: { name: string; version: string } }>(
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'cah', version: '0.2.0' },
        },
        timeoutMs,
        { fatalOnTimeout: true },
      ),
      'initialize',
      timeoutMs,
    );
  }

  /**
   * 兜底超时：transport 自身没实现超时也不会永久挂起（超时后同样明确报错）。
   * 这里**只** reject 本次调用：连接是否被永久关闭由 transport 按
   * `opts.fatalOnTimeout` 决定（`initialize` 传 true，业务调用传 false）。
   */
  private withTimeout<T>(request: Promise<T>, method: string, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`mcp request timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      request.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  /**
   * `tools/list` —— **业务调用**（Round 13 复评缺陷 2）：单次超时只让这次调用失败
   * （`fatalOnTimeout: false`），**不**永久关闭 transport；后续调用仍可继续。
   */
  async listTools(): Promise<McpToolDescriptor[]> {
    const res = await this.transport.request<{ tools: McpToolDescriptor[] }>(
      'tools/list',
      {},
      DEFAULT_MCP_TIMEOUT_MS,
      { fatalOnTimeout: false },
    );
    return res.tools ?? [];
  }

  /**
   * `tools/call` —— **业务调用**：慢而健康的 server 只该赔上这一次调用，
   * 不该在会话剩余时间里被整体作废（同 `listTools`，超时非致命）。
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    return this.transport.request<McpCallResult>(
      'tools/call',
      { name, arguments: args },
      DEFAULT_MCP_TIMEOUT_MS,
      { fatalOnTimeout: false },
    );
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}
