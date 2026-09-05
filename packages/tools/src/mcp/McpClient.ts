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

/** stdio transport: spawns `node <serverPath>` and speaks line-delimited JSON-RPC over stdin/stdout. */
export class StdioTransport implements McpTransport {
  private readonly child: ChildProcess;
  private readonly rl: readline.Interface;
  private seq = 0;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private closed = false;

  constructor(serverPath: string, args: string[] = []) {
    this.child = spawn(process.execPath, [serverPath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.rl = readline.createInterface({ input: this.child.stdout ?? process.stdin, crlfDelay: Infinity });
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
