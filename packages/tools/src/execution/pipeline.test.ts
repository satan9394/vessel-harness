import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolExecutionResult, ToolSpec } from '@vessel/shared';
import { Executor, Sandbox } from '@vessel/runtime';
import { createIsolatedRuntime } from '@vessel/agents';
import { MockProvider } from '@vessel/llm';
import { compilePolicyYaml } from '@vessel/policy';
import { createFsTools } from '../filesystem/fsTools.js';
import { ToolRegistry } from '../registry/Registry.js';
import { createShellTool } from '../shell/shellTool.js';
import { McpClient, createInProcessTransport } from '../mcp/McpClient.js';
import { registerMcpTools } from '../mcp/mcpTools.js';

vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>() }));
const transient = (code = 'EBUSY') => Object.assign(new Error('fixture transient'), { code });
const authorizedExecutor = () => new Executor({ decide: async () => ({ action: 'allow', decisionPath: ['fixture:host-policy'] }) });
const tool = (name: string, execute: ToolSpec['execute']): ToolSpec => ({ name, execute, family: 'other', requiredPermission: 'read', exclusive: false, description: name, inputSchema: { type: 'object', properties: {} } });

describe('production tool protection', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-tool-pipeline-')); });
  afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
  const policy = () => compilePolicyYaml('policy:\n  version: 1\n  profile: workspace-write\n  approval: never');
  function context(signal?: AbortSignal) { return { workspaceRoot: root, cwd: root, sandbox: new Sandbox(), signal }; }
  async function run(registry: ToolRegistry, name: string, args: Record<string, unknown> = {}, executor = authorizedExecutor(), signal?: AbortSignal) {
    return executor.runTool(registry.spec(name)!, { toolName: name, toolCallId: 'fixture-call', arguments: args }, context(signal));
  }

  it('protects Executor direct spec execution and prevents retry multiplication in child registries', async () => {
    const execute = vi.fn().mockRejectedValue(transient());
    const parent = new ToolRegistry([tool('Flaky', execute)]);
    const child = new ToolRegistry(parent.listVisible().map(spec => ({ ...spec })));
    expect(child.spec('Flaky')!.execute).toBe(parent.spec('Flaky')!.execute);
    const result = await run(child, 'Flaky');
    expect(execute).toHaveBeenCalledTimes(3); expect(result.error?.message).toBe('fixture transient');
    const success = vi.fn().mockRejectedValueOnce(transient('ECONNRESET')).mockResolvedValue({ content: 'ok', meta: {} });
    child.register(tool('Dynamic', success));
    const healed = await run(child, 'Dynamic');
    expect(success).toHaveBeenCalledTimes(2); expect(healed.meta.selfHealing).toMatchObject({ retries: [{ code: 'ECONNRESET', attempt: 1 }] });
  });

  it('retries actual filesystem Read errors but leaves the full written file untouched', async () => {
    const registry = new ToolRegistry(createFsTools({ workspaceRoot: root, fsPolicy: { protected: ['.env'], denyRead: [], allow: [] } }));
    const content = '完整🙂'.repeat(20000);
    const wrote = await run(registry, 'Write', { path: 'large.txt', content });
    expect(wrote.error).toBeUndefined(); expect(fs.readFileSync(path.join(root, 'large.txt'), 'utf8')).toBe(content);
    const read = fs.readFileSync;
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => { throw transient('ETXTBSY'); }).mockImplementation(read);
    const result = await run(registry, 'Read', { path: 'large.txt' });
    expect(spy).toHaveBeenCalledTimes(2); expect(result.error).toBeUndefined();
    expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(65536); expect(result.content).not.toContain('�');
    expect(result.meta.boundedOutput).toMatchObject({ originalBytes: Buffer.byteLength(content) });
    expect(fs.readFileSync(path.join(root, 'large.txt'), 'utf8')).toBe(content);
  });

  it('retries a locked Write operation without truncating its input', async () => {
    const registry = new ToolRegistry(createFsTools({ workspaceRoot: root, fsPolicy: { protected: [], denyRead: [], allow: [] } }));
    const write = fs.writeFileSync;
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => { throw transient(); }).mockImplementation(write);
    const content = 'code'.repeat(30000);
    const result = await run(registry, 'Write', { path: 'code.txt', content });
    expect(result.error).toBeUndefined(); expect(spy).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(path.join(root, 'code.txt'), 'utf8')).toBe(content);
  });

  it('protects dynamically registered MCP calls, preserving network cause codes', async () => {
    let attempts = 0;
    const client = new McpClient(createInProcessTransport((method) => {
      if (method === 'tools/list') return { tools: [{ name: 'read', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] };
      if (++attempts === 1) throw new Error('fetch failed', { cause: transient('ECONNRESET') });
      return { content: [{ type: 'text', text: 'MCP-HEAD' + 'x'.repeat(200000) + 'MCP-TAIL' }] };
    }), 'fixture');
    const registry = new ToolRegistry([]); const registered = await registerMcpTools(registry, 'fixture', client);
    expect(registered[0]!.tool).toBe(registry.spec('mcp__fixture__read'));
    const result = await run(registry, 'mcp__fixture__read');
    expect(attempts).toBe(2); expect(result.content.startsWith('MCP-HEAD')).toBe(true); expect(result.content.endsWith('MCP-TAIL')).toBe(true);
    expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(65536); await client.close();
  });

  it('does not replay an unacknowledged remote effect after timeout or disconnect', async () => {
    for (const code of ['ETIMEDOUT', 'ECONNRESET']) {
      let effects = 0;
      const client = new McpClient(createInProcessTransport(method => {
        if (method === 'tools/list') return { tools: [{ name: 'write', inputSchema: { type: 'object', properties: {} } }] };
        effects++; // The effect happened remotely before the response was lost.
        throw transient(code);
      }), 'fixture');
      const registry = new ToolRegistry([]);
      await registerMcpTools(registry, 'fixture', client);
      const result = await run(registry, 'mcp__fixture__write');
      expect(effects).toBe(1);
      expect(result.error?.detail).toMatchObject({ code });
      expect(result.meta.retryUnsafe).toBe(true);
      expect(result.meta.selfHealing).toBeUndefined();
      await client.close();
    }
  });

  it('never executes a denied tool or retries a returned denial', async () => {
    const execute = vi.fn().mockRejectedValue(transient()); const registry = new ToolRegistry([tool('Blocked', execute)]);
    const executor = new Executor({ decide: async () => ({ action: 'deny', decisionPath: ['fixture'], reason: 'blocked' }) });
    expect((await run(registry, 'Blocked', {}, executor)).error?.errorClass).toBe('DENIED'); expect(execute).not.toHaveBeenCalled();
    const deny = vi.fn().mockResolvedValue({ content: '', error: { errorClass: 'DENIED', message: 'deny', detail: { code: 'EBUSY' } }, meta: {} });
    registry.register(tool('Deny', deny)); expect((await run(registry, 'Deny')).error?.errorClass).toBe('DENIED'); expect(deny).toHaveBeenCalledOnce();
  });
  it('rechecks policy before a retry so a newly denied tool cannot run again', async () => {
    let decisions = 0;
    const execute = vi.fn().mockRejectedValueOnce(transient()).mockResolvedValue({ content: 'should not run', meta: {} });
    const registry = new ToolRegistry([tool('GuardedRetry', execute)]);
    const executor = new Executor({ decide: async () => ({ action: ++decisions === 1 ? 'allow' : 'deny', decisionPath: ['fixture'], reason: 'policy changed' }) });
    const result = await run(registry, 'GuardedRetry', {}, executor);
    expect(result.error).toMatchObject({ errorClass: 'DENIED', message: 'policy changed' }); expect(execute).toHaveBeenCalledOnce();
  });

  it('aborts between failed attempts and skips a pre-cancelled invocation', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => { controller.abort(); throw transient(); });
    const registry = new ToolRegistry([tool('Cancel', execute)]);
    await run(registry, 'Cancel', {}, authorizedExecutor(), controller.signal); expect(execute).toHaveBeenCalledOnce();
    await run(registry, 'Cancel', {}, authorizedExecutor(), controller.signal); expect(execute).toHaveBeenCalledOnce();
  });

  it('bounds returned and thrown huge errors while preserving small thrown-error identity', async () => {
    const huge = 'stderr'.repeat(30000);
    const small = new Error('unchanged');
    const registry = new ToolRegistry([tool('HugeThrown', async () => { throw new Error(huge); }), tool('Small', async () => { throw small; }), tool('HugeReturned', async () => ({ content: '', error: { errorClass: 'TOOL_FAILURE', message: huge }, meta: {} }))]);
    for (const name of ['HugeThrown', 'HugeReturned']) {
      const result = await run(registry, name); expect(Buffer.byteLength(result.error!.message)).toBeLessThanOrEqual(65536);
      expect(result.meta.boundedError).toMatchObject({ originalBytes: Buffer.byteLength(huge) });
    }
    await expect(registry.spec('Small')!.execute({}, context())).rejects.toBe(small);
  });

  it('does not retry an already-completed shell command when its audit/output processing fails', async () => {
    const sandbox = new Sandbox();
    const runShell = vi.spyOn(sandbox, 'run').mockResolvedValue({ stdout: 'done', stderr: '', exitCode: 0, timedOut: false, killed: false, sandbox: sandbox.status(), processTree: { nodes: [], aliveCount: 0, exitedCount: 0 }, audit: [{ kind: 'escape-detected', detail: 'fixture', at: 1 }] });
    const registry = new ToolRegistry([createShellTool({ workspaceRoot: root, sandbox, audit: () => { throw transient(); } })]);
    const result = await run(registry, 'Shell', { command: 'fixture command' });
    expect(result.error?.message).toContain('fixture transient'); expect(runShell).toHaveBeenCalledOnce();
  });

  it('keeps output processing outside retry scope after a successful effect', async () => {
    let effects = 0;
    const result: ToolExecutionResult = { get content(): string { throw transient(); }, meta: {} };
    const registry = new ToolRegistry([tool('Effect', async () => { effects++; return result; })]);
    expect((await run(registry, 'Effect')).error).toBeDefined(); expect(effects).toBe(1);
  });

  it('protects the isolated AgentLoop path and persists only bounded tool output', async () => {
    const runtime = await createIsolatedRuntime({ workspaceRoot: root, model: 'mock', policyArtifacts: policy(), tools: [tool('HugeRead', async () => ({ content: 'start' + 'x'.repeat(200000) + 'end', meta: {} }))],
      provider: new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'HugeRead', arguments: {} }] } }, { when: /.*/, response: { text: 'done' } }]) });
    try {
      await runtime.loop.runTurn('read fixture');
      const records = runtime.session.replay().filter(record => record.type === 'tool/result');
      expect(records).toHaveLength(1);
      const record = records[0]!; if (record.type !== 'tool/result') throw new Error('missing result');
      expect(Buffer.byteLength(record.content!)).toBeLessThanOrEqual(65536); expect(record.meta.boundedOutput).toBeDefined();
    } finally { await runtime.close(); }
  });
});
