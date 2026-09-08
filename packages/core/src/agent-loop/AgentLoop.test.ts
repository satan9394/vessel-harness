import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockProvider } from '@vessel/llm';
import type { MockScriptEntry } from '@vessel/llm';
import { EventBus, Session, AgentLoop } from '@vessel/core';
import { ToolRegistry, createFsTools, createSearchTools, createShellTool } from '@vessel/tools';
import { Executor, Sandbox } from '@vessel/runtime';
import type { ToolCall, ToolSpec } from '@vessel/shared';

const FS_POLICY = { protected: ['.git', '.git/**', '.env'], denyRead: [], allow: [] };

async function makeLoop(dir: string, script: MockScriptEntry[], prompt: string) {
  const session = await Session.open({ workspaceRoot: dir, sessionId: 'loop' });
  const bus = new EventBus();
  const sandbox = new Sandbox();
  const tools: ToolSpec[] = [
    ...createFsTools({ workspaceRoot: dir, fsPolicy: FS_POLICY }),
    ...createSearchTools({ workspaceRoot: dir, fsPolicy: FS_POLICY }),
    createShellTool({ workspaceRoot: dir, sandbox }),
  ];
  const registry = new ToolRegistry(tools);
  const executor = new Executor();
  const provider = new MockProvider(script, { model: 'mock', vars: { cwd: dir } });
  const loop = new AgentLoop({
    session, bus, provider, model: 'mock',
    buildContext: async () => ({
      model: 'mock',
      messages: [
        { role: 'system', content: 'test' },
        ...session.surface().map((r) => {
          if (r.type === 'user/message') return { role: 'user' as const, content: r.content };
          if (r.type === 'assistant/message') return { role: 'assistant' as const, content: r.content };
          return { role: 'tool' as const, content: r.type === 'tool/result' ? (r.content ?? '') : '', toolCallId: (r as { toolCallId: string }).toolCallId };
        }),
      ],
      tools: registry.listVisible().map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.inputSchema as unknown as Record<string, unknown> } })),
      estimateTokens: 10,
    }),
    runTool: async (call: ToolCall) => {
      const spec = registry.spec(call.toolName);
      if (!spec) return { content: '', error: { errorClass: 'INVALID_ARGS', message: 'unknown' }, meta: {} };
      const r = await executor.runTool(spec, call, { workspaceRoot: dir, cwd: dir, sandbox });
      return { content: r.content, error: r.error, meta: r.meta };
    },
    getVisibleTools: () => registry.listVisible().map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.inputSchema as unknown as Record<string, unknown> } })),
  });
  return { session, bus, registry, loop };
}

describe('AgentLoop (thin core)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-loop-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('runs read → tool → answer within one turn (M3 closed loop)', async () => {
    fs.writeFileSync(path.join(dir, 'README.md'), 'GOLDEN-PHRASE-42', 'utf8');
    const { session, loop } = await makeLoop(dir, [
      { when: /read|阅读/i, ifNoToolResult: true, response: { toolCalls: [{ name: 'Read', arguments: { path: 'README.md' } }] } },
      { when: /.*/, response: { text: 'file content: {last_tool_result}' } },
    ], '请阅读 README.md');

    const result = await loop.runTurn('请阅读 README.md');
    expect(result.kind).toBe('success');
    expect(result.toolCalls).toBe(1);
    expect(result.finalText).toContain('GOLDEN-PHRASE-42');

    const surface = session.surface();
    expect(surface.some((r) => r.type === 'tool/result')).toBe(true);
    const audit = session.replay().filter((r) => r.type === 'audit/denial');
    expect(audit).toHaveLength(0);
    await session.close();
  });

  it('pure-text response stops immediately (no tool dispatch)', async () => {
    const { session, loop } = await makeLoop(dir, [
      { when: /.*/, response: { text: '直接回答，不调工具' } },
    ], '你好');
    const result = await loop.runTurn('你好');
    expect(result.kind).toBe('success');
    expect(result.toolCalls).toBe(0);
    expect(result.finalText).toContain('直接回答');
    await session.close();
  });

  it('denied tool call produces audit/denial and feeds back to the model', async () => {
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1', 'utf8');
    // no policy engine listener registered here — the executor has no decide hook,
    // but the Write to .env hits the fs guard (protected path) at the tool layer
    const { session, loop } = await makeLoop(dir, [
      { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Write', arguments: { path: '.env', content: 'x' } }] } },
      { when: /.*/, response: { text: '写操作被守卫拦截。' } },
    ], '写 .env');
    const result = await loop.runTurn('写 .env');
    expect(result.finalText).toContain('拦截');
    await session.close();
  });

  it('budget: max steps hard cap stops the turn', async () => {
    const { session, loop } = await makeLoop(dir, [
      { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Glob', arguments: { pattern: '**/*' } }] } },
      { when: /.*/, response: { toolCalls: [{ name: 'Glob', arguments: { pattern: '**/*' } }] } },
    ], 'loop forever');
    const result = await loop.runTurn('loop forever');
    expect(['budget', 'success']).toContain(result.kind);
    expect(result.steps).toBeGreaterThanOrEqual(1);
    await session.close();
  });

  it('denial breaker: same intent denied >=3 closes the turn with kind=error and a paired turn/end', async () => {
    // MockProvider re-matches the same script entry on every model call (haystack =
    // the last user message), so the model keeps issuing the identical Shell command.
    // A before_tool listener denies every Shell call; the third denial of the same
    // intent trips DenialLimitError, which runTurn must fold into a proper
    // turn/end (pairing invariant: turn/start -> turn/end) instead of leaking.
    const { session, bus, loop } = await makeLoop(dir, [
      { when: /.*/, response: { toolCalls: [{ name: 'Shell', arguments: { command: 'rm -rf ./x' } }] } },
    ], 'run the delete');
    bus.on('before_tool', () => ({ kind: 'deny', reason: 'blocked by test listener', ref: 'test:always-deny' }), 'test-deny');

    const result = await loop.runTurn('run the delete');
    expect(result.kind).toBe('error');

    const records = session.replay();
    const starts = records.filter((r) => r.type === 'turn/start').length;
    const ends = records.filter((r) => r.type === 'turn/end').length;
    const denials = records.filter((r) => r.type === 'audit/denial').length;
    // turn/start <-> turn/end pairing is intact even on the denial-breaker path
    expect(starts).toBe(1);
    expect(ends).toBe(1);
    expect(denials).toBeGreaterThanOrEqual(3);
    const endRecord = records.find((r) => r.type === 'turn/end');
    expect(endRecord).toMatchObject({ turnId: result.turnId, kind: 'error' });
    await session.close();
  });
});
