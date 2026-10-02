import { type McpTransport, type McpRequestOptions, type McpToolDescriptor } from './McpClient.js';

/** Static descriptors allow composition to stay cold; discovery without them wakes. */
export class LazyMcpClientProxy implements McpTransport {
  private active?: McpTransport;
  private waking?: Promise<McpTransport>;
  private closed = false;
  private closePromise?: Promise<void>;
  private initializeParams?: unknown;
  private initializeResult?: unknown;
  private readonly tools?: McpToolDescriptor[];

  constructor(
    private readonly serverName: string,
    private readonly factory: () => Promise<McpTransport>,
    staticTools?: McpToolDescriptor[],
  ) {
    this.tools = staticTools === undefined ? undefined : structuredClone(staticTools);
  }

  isSpawned(): boolean { return this.active !== undefined; }

  private wake(timeoutMs?: number): Promise<McpTransport> {
    if (this.active) return Promise.resolve(this.active);
    if (!this.waking) {
      this.waking = (async () => {
        const transport = await this.factory();
        if (this.closed) { await transport.close(); throw new Error('MCP transport closed'); }
        try {
          this.initializeResult = await transport.request('initialize', this.initializeParams ?? {
            protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'vessel', version: '1.5' },
          }, timeoutMs, { fatalOnTimeout: true });
          if (this.closed) throw new Error('MCP transport closed');
          this.active = transport;
          return transport;
        } catch (err) { await transport.close(); throw err; }
      })().catch((err: unknown) => { this.waking = undefined; throw err; });
    }
    return this.waking;
  }

  async request<T = unknown>(method: string, params?: unknown, timeoutMs?: number, opts?: McpRequestOptions): Promise<T> {
    if (this.closed) throw new Error('MCP transport closed');
    if (method === 'initialize') {
      this.initializeParams = structuredClone(params);
      if (this.tools !== undefined && !this.active) {
        return { protocolVersion: '2024-11-05', serverInfo: { name: this.serverName, version: 'lazy' } } as T;
      }
      await this.wake(timeoutMs);
      return this.initializeResult as T;
    }
    if (method === 'tools/list' && this.tools !== undefined) return { tools: structuredClone(this.tools) } as T;
    const transport = await this.wake(timeoutMs);
    return transport.request<T>(method, params, timeoutMs, opts);
  }

  close(): Promise<void> {
    this.closed = true;
    return this.closePromise ??= (async () => {
      const transport = this.active ?? await this.waking?.catch(() => undefined);
      await transport?.close();
      this.active = undefined;
    })();
  }
}
