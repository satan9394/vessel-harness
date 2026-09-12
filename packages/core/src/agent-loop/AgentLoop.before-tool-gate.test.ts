import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockProvider } from '@vessel/llm';
import type { MockScriptEntry } from '@vessel/llm';
import { AgentLoop, EventBus, Session } from '@vessel/core';
import { ToolRegistry, createFsTools } from '@vessel/tools';
import { Executor, Sandbox } from '@vessel/runtime';
import type { SessionRecord, ToolCall, ToolSpec } from '@vessel/shared';

/**
 * BRIEF-决策点 fail-open 的端到端判别性用例（走生产路径 AgentLoop.dispatchToolCall）。
 *
 * 修复前：`bus.waterfall('before_tool', …)` 的 catch 分支是 `continue` ⇒ `current` 停在
 * 'defer' ⇒ `gate.result.kind !== 'deny'` ⇒ 直接落到执行分支 ⇒ **抛错的拦截器 = 工具静默执行**。
 * 修复后：该调用点显式声明 `listenerErrorPolicy: 'fail-closed'` ⇒ 铸出带
 * `listener-error:<listenerName>` 的 deny，走既有 deny 分支（audit/denial + policy_decision
 * + tool/result DENIED），工具**绝不执行**。
 */

const FS_POLICY = { protected: ['.git', '.git/**', '.env'], denyRead: [], allow: [] };

const TOOL_CALL_SCRIPT: MockScriptEntry[] = [
  { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Write', arguments: { path: 'out.txt', content: 'SHOULD-NOT-BE-WRITTEN' } }] } },
  { when: /.*/, response: { text: 'DONE' } },
];

async function makeHarness(dir: string, script: MockScriptEntry[]) {
  const session = await Session.open({ workspaceRoot: dir, sessionId: 'gate' });
  const bus = new EventBus();
  const sandbox = new Sandbox();
  const tools: ToolSpec[] = createFsTools({ workspaceRoot: dir, fsPolicy: FS_POLICY });
  const registry = new ToolRegistry(tools);
  const executor = new Executor();
  const provider = new MockProvider(script, { model: 'mock', vars: { cwd: dir } });
  /** every tool call that actually reached execution */
  const executed: ToolCall[] = [];

  const loop = new AgentLoop({
    session,
    bus,
    provider,
    model: 'mock',
    buildContext: async () => ({
      model: 'mock',
      messages: [
        { role: 'system' as const, content: 'test' },
        ...session.surface().map((r) => {
          if (r.type === 'user/message') return { role: 'user' as const, content: r.content };
          if (r.type === 'assistant/message') return { role: 'assistant' as const, content: r.content };
          return {
            role: 'tool' as const,
            content: r.type === 'tool/result' ? (r.content ?? '') : '',
            toolCallId: (r as { toolCallId: string }).toolCallId,
          };
        }),
      ],
      tools: registry.listVisible().map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.inputSchema as unknown as Record<string, unknown> },
      })),
      estimateTokens: 10,
    }),
    runTool: async (call: ToolCall) => {
      executed.push(call);
      const spec = registry.spec(call.toolName);
      if (!spec) return { content: '', error: { errorClass: 'INVALID_ARGS' as const, message: 'unknown' }, meta: {} };
      const r = await executor.runTool(spec, call, { workspaceRoot: dir, cwd: dir, sandbox });
      return { content: r.content, error: r.error, meta: r.meta };
    },
    getVisibleTools: () =>
      registry.listVisible().map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.inputSchema as unknown as Record<string, unknown> },
      })),
  });

  return { session, bus, loop, executed };
}

type DenialRecord = Extract<SessionRecord, { type: 'audit/denial' }>;
type ToolResultRecord = Extract<SessionRecord, { type: 'tool/result' }>;

describe('AgentLoop before_tool 门禁 — 监听器抛错不得静默放行（BRIEF-决策点 fail-open）', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-gate-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('① 抛错的 before_tool 监听器 ⇒ 拒绝且工具从未执行（删掉 AgentLoop 的 fail-closed 声明即红）', async () => {
    const { session, bus, loop, executed } = await makeHarness(dir, TOOL_CALL_SCRIPT);
    const decisions: { verdict: string; ruleRef?: string }[] = [];
    const handlerErrors: { eventName: string; listenerId: string; error: { kind: string; message: string } }[] = [];
    bus.on('policy_decision', (p) => {
      decisions.push(p as { verdict: string; ruleRef?: string });
    }, 'test:policy_decision');
    bus.on('handler_error', (p) => {
      handlerErrors.push(p as (typeof handlerErrors)[number]);
    }, 'test:handler_error');
    bus.on('before_tool', () => {
      throw new Error('policy engine exploded');
    }, 'policy:engine');

    const result = await loop.runTurn('写一个文件');

    // 工具从未到达执行面：既没有 runTool 调用，也没有落盘副作用
    expect(executed).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, 'out.txt'))).toBe(false);

    const records = session.replay();
    const denials = records.filter((r): r is DenialRecord => r.type === 'audit/denial');
    expect(denials).toHaveLength(1);
    // 与"规则命中"可机读区分：stage 'hook' + ruleRef/reason 带 listener-error:<listenerName>
    expect(denials[0]).toMatchObject({
      stage: 'hook',
      ruleRef: 'listener-error:policy:engine',
      toolName: 'Write',
    });
    expect(denials[0]?.reason).toBe('listener-error:policy:engine: policy engine exploded');

    const toolResults = records.filter((r): r is ToolResultRecord => r.type === 'tool/result');
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]?.error?.errorClass).toBe('DENIED');
    expect(toolResults[0]?.meta).toMatchObject({ denied: true, listenerError: true, ref: 'listener-error:policy:engine' });

    // 审计事件确实被铸出
    expect(decisions).toEqual([
      expect.objectContaining({ verdict: 'deny', ruleRef: 'listener-error:policy:engine' }),
    ]);
    expect(handlerErrors).toHaveLength(1);
    expect(handlerErrors[0]).toMatchObject({
      eventName: 'before_tool',
      listenerId: 'policy:engine',
      error: { kind: 'Error', message: 'policy engine exploded' },
    });

    // 拒绝被回灌给模型 ⇒ 该轮仍以正常语义收尾（不是崩轮次）
    expect(result.kind).toBe('success');
    expect(result.finalText).toBe('DONE');
    await session.close();
  });

  it('② 负对照：监听器返回 void / defer ⇒ 工具照常执行（没有被"一律拒绝"掐死）', async () => {
    const { session, bus, loop, executed } = await makeHarness(dir, TOOL_CALL_SCRIPT);
    const seen: string[] = [];
    bus.on('before_tool', () => {
      seen.push('observer');
    }, 'observer');
    bus.on('before_tool', () => ({ kind: 'defer' as const }), 'deferrer');

    const result = await loop.runTurn('写一个文件');

    expect(seen).toEqual(['observer']);
    expect(executed.map((c) => c.toolName)).toEqual(['Write']);
    expect(fs.readFileSync(path.join(dir, 'out.txt'), 'utf8')).toBe('SHOULD-NOT-BE-WRITTEN');
    expect(result.kind).toBe('success');
    expect(session.replay().filter((r) => r.type === 'audit/denial')).toHaveLength(0);
    await session.close();
  });

  it('③ 正向：正常 deny 监听器仍然拒绝，reason/ref 与今日一致（stage rule，无 listenerError 标记）', async () => {
    const { session, bus, loop, executed } = await makeHarness(dir, TOOL_CALL_SCRIPT);
    bus.on('before_tool', () => ({ kind: 'deny', reason: 'blocked by test listener', ref: 'test:always-deny' }), 'test-deny');

    const result = await loop.runTurn('写一个文件');

    expect(executed).toHaveLength(0);
    const denials = session.replay().filter((r): r is DenialRecord => r.type === 'audit/denial');
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({ stage: 'rule', ruleRef: 'test:always-deny', reason: 'blocked by test listener' });
    const toolResult = session.replay().find((r): r is ToolResultRecord => r.type === 'tool/result');
    expect(toolResult?.meta).toMatchObject({ denied: true, ref: 'test:always-deny' });
    expect(toolResult?.meta).not.toHaveProperty('listenerError');
    expect(result.kind).toBe('success');
    await session.close();
  });

  it('before_turn 显式 defer：抛错的 admission 监听器不阻断整轮（辅助决策点不受 fail-closed 影响）', async () => {
    const { session, bus, loop } = await makeHarness(dir, [{ when: /.*/, response: { text: 'DONE' } }]);
    const handlerErrors: { eventName: string }[] = [];
    bus.on('handler_error', (p) => {
      handlerErrors.push(p as { eventName: string });
    }, 'test:handler_error');
    bus.on('before_turn', () => {
      throw new Error('admission hook down');
    }, 'admission');

    const result = await loop.runTurn('你好');

    expect(result.kind).toBe('success');
    expect(result.finalText).toBe('DONE');
    // 但错误仍然留痕（不是静默）
    expect(handlerErrors).toEqual([expect.objectContaining({ eventName: 'before_turn' })]);
    await session.close();
  });
});
