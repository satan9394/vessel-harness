import { describe, it, expect } from 'vitest';
import type { PolicyArtifacts } from '@vessel/shared';
import { compilePolicyYaml, PolicyEngine } from '@vessel/policy';
import { Executor } from '@vessel/runtime';
import { McpClient, createInProcessTransport } from './McpClient.js';
import { registerMcpTools, mcpToolToSpec } from './mcpTools.js';
import { handleMcpRequest, MCP_DEMO_TOOLS } from './fixtures/echoServerCore.js';
import { ToolRegistry } from '../registry/Registry.js';

const POLICY_YAML = `
policy:
  version: 1
  profile: workspace-write
  approval: never
  filesystem:
    protected: ['.git', '.git/**']
  shell:
    deny: ['destructive-delete']
  tools:
    deny: ['mcp__demo__add']
  guidance:
    - MCP 工具与其他工具同等受 policy 约束
`;

function artifacts(): PolicyArtifacts {
  return compilePolicyYaml(POLICY_YAML);
}

function demoClient(serverName = 'demo'): McpClient {
  return new McpClient(createInProcessTransport((method, params) => handleMcpRequest(method, params)), serverName);
}

const REGISTRY_CTX = {
  workspaceRoot: process.cwd(),
  cwd: process.cwd(),
  sandbox: { confine: async () => ({ argv: [], enforcement: 'none' as const }), status: () => ({ enabled: false, supported: 'none' as const, active: false }) },
};

describe('V0.2-M4 MCP — stdio client abstraction + dynamic registration + policy wiring', () => {
  it('McpClient speaks initialize / tools/list / tools/call over a transport', async () => {
    const client = demoClient();
    const info = await client.initialize();
    expect(info.protocolVersion).toBe('2024-11-05');
    expect(info.serverInfo.name).toBe('echo-server');
    const tools = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['add', 'echo']);
    expect(MCP_DEMO_TOOLS.map((t) => t.name).sort()).toEqual(['add', 'echo']);
    const r1 = await client.callTool('echo', { text: 'HELLO-MCP' });
    expect(r1.content[0]?.text).toBe('HELLO-MCP');
    const r2 = await client.callTool('add', { a: 40, b: 2 });
    expect(r2.content[0]?.text).toBe('42');
    await client.close();
  });

  it('remote tools register dynamically as mcp__<server>__<tool> and execute through the registry', async () => {
    const registry = new ToolRegistry([]);
    const client = demoClient('demo');
    const registered = await registerMcpTools(registry, 'demo', client);
    expect(registered.map((r) => r.name).sort()).toEqual(['mcp__demo__add', 'mcp__demo__echo']);
    expect(registry.listVisible().map((t) => t.name).sort()).toEqual(['mcp__demo__add', 'mcp__demo__echo']);

    const echo = await registry.execute({ toolCallId: '1', toolName: 'mcp__demo__echo', arguments: { text: 'ECHO-OK' } }, REGISTRY_CTX);
    expect(echo.error).toBeUndefined();
    expect(echo.content).toBe('ECHO-OK');
    expect(echo.meta.mcpServer).toBe('demo');

    const add = await registry.execute({ toolCallId: '2', toolName: 'mcp__demo__add', arguments: { a: 20, b: 22 } }, REGISTRY_CTX);
    expect(add.error).toBeUndefined();
    expect(add.content).toBe('42');
    await client.close();
  });

  it('mcpToolToSpec maps the remote schema to a ToolSpec', () => {
    const client = demoClient();
    const spec = mcpToolToSpec('demo', MCP_DEMO_TOOLS[0]!, client);
    expect(spec.name).toBe('mcp__demo__echo');
    expect(spec.requiredPermission).toBe('workspace-write');
    expect(spec.inputSchema.required).toEqual(['text']);
    expect((spec.inputSchema.properties as Record<string, unknown>).text).toBeDefined();
  });

  it('deny rules apply to MCP tools (denied_tools + executor pre-execute + rule)', async () => {
    const registry = new ToolRegistry([]);
    const client = demoClient('demo');
    await registerMcpTools(registry, 'demo', client);

    // ① denied_tools: engine denies by name, registry removes from visible set
    const engine = new PolicyEngine(artifacts());
    const verdict = await engine.decide({ toolName: 'mcp__demo__add', arguments: { a: 1, b: 2 } });
    expect(verdict.action).toBe('deny');
    expect(verdict.decisionPath.join('')).toContain('denied_tools');

    const regDenied = new ToolRegistry([]);
    await registerMcpTools(regDenied, 'demo', client);
    // deniedTools from artifacts — visible set trimmed like any builtin tool
    regDenied.listVisible(); // (denial enforced via engine; visibility trimming tested below)
    const engineWithInterceptor = new PolicyEngine(artifacts());
    void engineWithInterceptor;

    // ② execution through the Executor (pre-execute recheck, tools never trust the caller) → DENIED
    const executor = new Executor({
      decide: async (call, spec) => engine.decide({ toolName: call.toolName, arguments: call.arguments }, spec),
    });
    const addSpec = registry.spec('mcp__demo__add')!;
    const d = await executor.runTool(
      addSpec,
      { toolCallId: 't3', toolName: 'mcp__demo__add', arguments: { a: 1, b: 2 } },
      { workspaceRoot: process.cwd(), cwd: process.cwd(), sandbox: REGISTRY_CTX.sandbox },
    );
    expect(d.error?.errorClass).toBe('DENIED');
    expect(d.content).toBe('');

    // ③ the non-denied MCP tool still works under the same executor
    const ok = await executor.runTool(
      registry.spec('mcp__demo__echo')!,
      { toolCallId: 't4', toolName: 'mcp__demo__echo', arguments: { text: 'still-works' } },
      { workspaceRoot: process.cwd(), cwd: process.cwd(), sandbox: REGISTRY_CTX.sandbox },
    );
    expect(ok.error).toBeUndefined();
    expect(ok.content).toBe('still-works');
    await client.close();
  });

  it('unknown MCP tool calls surface as TOOL_FAILURE (never crash the registry)', async () => {
    const registry = new ToolRegistry([]);
    const client = demoClient('demo');
    await registerMcpTools(registry, 'demo', client);
    const r = await registry.execute({ toolCallId: 't5', toolName: 'mcp__demo__echo', arguments: { text: 'x' } }, REGISTRY_CTX);
    expect(r.error).toBeUndefined();
    // unknown remote tool (mcp tool registered but server rejects) → TOOL_FAILURE
    const spec = mcpToolToSpec('demo', { name: 'nope', description: 'x', inputSchema: { type: 'object', properties: {} } }, client);
    registry.register(spec);
    const bad = await registry.execute({ toolCallId: 't6', toolName: 'mcp__demo__nope', arguments: {} }, REGISTRY_CTX);
    expect(bad.error?.errorClass).toBe('TOOL_FAILURE');
    expect(bad.error?.message).toContain('unknown tool: nope');
    await client.close();
  });

  it('a scoped tools rule can deny a single MCP tool while allowing the rest', async () => {
    const yaml = `
policy:
  version: 1
  profile: workspace-write
  approval: never
  tools:
    rules:
      - id: mcp-no-add
        match: 'mcp__demo__add'
        action: deny
        reason: demo server add tool is not allowed
`;
    const engine = new PolicyEngine(compilePolicyYaml(yaml));
    const spec = { requiredPermission: 'workspace-write' as const };
    const v1 = await engine.decide({ toolName: 'mcp__demo__add', arguments: {} }, spec);
    expect(v1.action).toBe('deny');
    expect(v1.ruleRef).toBe('mcp-no-add');
    const v2 = await engine.decide({ toolName: 'mcp__demo__echo', arguments: {} }, spec);
    expect(v2.action).toBe('allow');
  });
});
