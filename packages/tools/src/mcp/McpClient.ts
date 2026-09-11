import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import type { McpToolDescriptor } from './fixtures/echoServerCore.js';

export type { McpToolDescriptor };

/**
 * Minimal JSON-RPC 2.0 transport for an MCP server (MISSION V0.2-M4).
 * `request` sends a request and resolves with the result payload.
 */
export interface McpTransport {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
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
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private closed = false;

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
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
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
      for (const [, p] of this.pending) p.reject(err);
      this.pending.clear();
    });
    this.child.on('exit', () => {
      for (const [, p] of this.pending) p.reject(new Error('MCP server exited'));
      this.pending.clear();
    });
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error('MCP transport closed'));
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }) + '\n');
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.rl.close();
    this.child.stdin?.end();
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 2000);
    await new Promise<void>((resolve) => {
      this.child.once('exit', () => resolve());
      this.child.once('error', () => resolve());
      // if already exited, resolve on next tick
      setTimeout(() => resolve(), 50);
    });
    clearTimeout(timer);
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

  async initialize(): Promise<{ protocolVersion: string; serverInfo: { name: string; version: string } }> {
    return this.transport.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'cah', version: '0.2.0' },
    });
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const res = await this.transport.request<{ tools: McpToolDescriptor[] }>('tools/list', {});
    return res.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    return this.transport.request<McpCallResult>('tools/call', { name, arguments: args });
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}
