import { describe, expect, it, vi } from 'vitest';
import { LazyMcpClientProxy } from './LazyMcpClientProxy.js';
import { McpClient, createInProcessTransport, type McpTransport } from './McpClient.js';
import { MCP_DEMO_TOOLS, handleMcpRequest } from './fixtures/echoServerCore.js';

describe('lazy MCP proxy', () => {
  it('stays cold through composition handshake/list and wakes once for parallel calls', async () => {
    const physical = createInProcessTransport(handleMcpRequest);
    const request = vi.spyOn(physical, 'request');
    const factory = vi.fn(async () => physical);
    const proxy = new LazyMcpClientProxy('demo', factory, MCP_DEMO_TOOLS);
    const client = new McpClient(proxy, 'demo');
    await client.initialize();
    const tools = await client.listTools();
    tools[0]!.name = 'mutated';
    expect((await client.listTools())[0]!.name).toBe('echo');
    expect(proxy.isSpawned()).toBe(false);
    await Promise.all([client.callTool('echo', { text: 'a' }), client.callTool('echo', { text: 'b' })]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.filter(([method]) => method === 'initialize')).toHaveLength(1);
    expect(proxy.isSpawned()).toBe(true);
    await proxy.close();
    expect(proxy.isSpawned()).toBe(false);
  });

  it('requires real discovery when static schemas are absent', async () => {
    const factory = vi.fn(async () => createInProcessTransport(handleMcpRequest));
    const proxy = new LazyMcpClientProxy('demo', factory);
    const result = await proxy.request<{ tools: unknown[] }>('tools/list');
    expect(result.tools).toHaveLength(2);
    expect(factory).toHaveBeenCalledTimes(1);
    await proxy.close();
  });

  it('cold close does not create a process and forbids subsequent calls', async () => {
    const factory = vi.fn(async () => createInProcessTransport(handleMcpRequest));
    const proxy = new LazyMcpClientProxy('demo', factory, []);
    await proxy.close();
    await expect(proxy.request('tools/call')).rejects.toThrow('closed');
    expect(factory).not.toHaveBeenCalled();
  });

  it('closes a late factory result after close wins the race', async () => {
    let resolve!: (value: McpTransport) => void;
    const physical = createInProcessTransport(handleMcpRequest);
    const close = vi.spyOn(physical, 'close');
    const proxy = new LazyMcpClientProxy('demo', () => new Promise((r) => { resolve = r; }), []);
    const call = proxy.request('tools/call').catch((err: Error) => err.message);
    const closing = proxy.close();
    resolve(physical);
    await closing;
    expect(await call).toContain('closed');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('handshake failure closes physical transport and rejects all concurrent calls', async () => {
    const physical = { request: vi.fn().mockRejectedValue(new Error('bad handshake')), close: vi.fn().mockResolvedValue(undefined) };
    const factory = vi.fn(async () => physical);
    const proxy = new LazyMcpClientProxy('demo', factory, []);
    const results = await Promise.allSettled([proxy.request('tools/call'), proxy.request('tools/call')]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(physical.close).toHaveBeenCalledTimes(1);
    await expect(proxy.request('tools/call')).rejects.toThrow('bad handshake');
    expect(factory).toHaveBeenCalledTimes(2);
    await proxy.close();
  });
});
