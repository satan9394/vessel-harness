import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockProvider } from '@vessel/llm';
import type { MockScriptEntry } from '@vessel/llm';
import { AgentLoop, EventBus, Session } from '@vessel/core';
import { ToolRegistry, createFsTools } from '@vessel/tools';
import { Executor, Sandbox } from '@vessel/runtime';
import type { SessionRecord, ToolCall, ToolExecutionResult, ToolSpec } from '@vessel/shared';

/**
 * BRIEF — denial breaker 只统计"执行前"的拒绝 ⇒ 工具内的拒绝可以无限重试。
 *
 * 修复前：熔断计数埋点在 `gate.result.kind === 'deny'` 分支内部（AgentLoop
 * dispatchToolCall）⇒ **只有执行前的策略门禁拒绝**进 `denialCounts`；工具执行**之后**才返回的
 * `errorClass:'DENIED'`（fs 守卫 `assertSizeWithin`/`canonicalize`、Skill untrusted、
 * Executor pre-execute recheck、registry denied tool）完全不计数 ⇒ 同一个必然被拒的意图可以
 * 无限重复（烧轮次与 token）。修复后：任何 DENIED 的收口处都走同一个 `noteDenial`，同一
 * `toolName:arguments` 累计 ≥3 即 DenialLimitError。
 *
 * 本文件全部走生产路径：`loop.runTurn(...)` → `dispatchToolCall` → `before_tool` waterfall →
 * `raceToolRun` → `runTool` 闭包 → `Executor.runTool` → `ToolSpec.execute`，不手调私有函数。
 *
 * 用例与"删哪行会红"的对应见各 `it` 名称与注释；① 用真实 fs 守卫（本仓真实场景），
 * ② 是最小复现（自定义恒拒工具）。
 */

const FS_POLICY = { protected: ['.git', '.git/**', '.env'], denyRead: [], allow: [] };

type ToolResultRecord = Extract<SessionRecord, { type: 'tool/result' }>;
type DenialRecord = Extract<SessionRecord, { type: 'audit/denial' }>;

const breakerMessage = (toolName: string): string => `same intent denied 3 times: ${toolName}`;

/** 恒拒工具：拒绝发生在**工具层**（Executor 之后），不经过任何 before_tool 门禁。 */
function alwaysDeniedTool(name: string): ToolSpec {
  return {
    name,
    description: `${name} always refuses at the tool layer`,
    family: 'other',
    requiredPermission: 'read',
    exclusive: false,
    inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
    async execute(): Promise<ToolExecutionResult> {
      return {
        content: '',
        error: { errorClass: 'DENIED', message: `${name} refused at tool layer` },
        meta: { guard: 'test-guard' },
      };
    },
  };
}

/** 恒成功工具：负对照用（成功调用绝不计入熔断）。 */
function alwaysOkTool(name: string): ToolSpec {
  return {
    name,
    description: `${name} always succeeds`,
    family: 'other',
    requiredPermission: 'read',
    exclusive: false,
    inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
    async execute(): Promise<ToolExecutionResult> {
      return { content: `${name}-ok`, meta: {} };
    },
  };
}

/** 恒失败工具：负对照用（非 DENIED 的错误类不得计入熔断）。 */
function alwaysFailingTool(name: string): ToolSpec {
  return {
    name,
    description: `${name} always fails with TOOL_FAILURE`,
    family: 'other',
    requiredPermission: 'read',
    exclusive: false,
    inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
    async execute(): Promise<ToolExecutionResult> {
      return { content: '', error: { errorClass: 'TOOL_FAILURE', message: `${name} broke` }, meta: {} };
    },
  };
}

async function makeHarness(
  dir: string,
  script: MockScriptEntry[],
  opts: { extraTools?: ToolSpec[]; maxSteps?: number } = {},
) {
  const session = await Session.open({ workspaceRoot: dir, sessionId: 'denial-breaker' });
  const bus = new EventBus();
  const sandbox = new Sandbox();
  const tools: ToolSpec[] = [
    ...createFsTools({ workspaceRoot: dir, fsPolicy: FS_POLICY }),
    ...(opts.extraTools ?? []),
  ];
  const registry = new ToolRegistry(tools);
  const executor = new Executor();
  const provider = new MockProvider(script, { model: 'mock', vars: { cwd: dir } });
  /** every tool call that actually reached the execution face (tool layer) */
  const executed: ToolCall[] = [];

  const toolDefs = () =>
    registry.listVisible().map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as unknown as Record<string, unknown>,
      },
    }));

  const loop = new AgentLoop({
    session,
    bus,
    provider,
    model: 'mock',
    maxSteps: opts.maxSteps,
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
      tools: toolDefs(),
      estimateTokens: 10,
    }),
    runTool: async (call: ToolCall) => {
      executed.push(call);
      const spec = registry.spec(call.toolName);
      if (!spec) return { content: '', error: { errorClass: 'INVALID_ARGS' as const, message: 'unknown' }, meta: {} };
      const r = await executor.runTool(spec, call, { workspaceRoot: dir, cwd: dir, sandbox });
      return { content: r.content, error: r.error, meta: r.meta };
    },
    getVisibleTools: toolDefs,
  });

  return { session, bus, loop, executed };
}

function deniedResults(records: readonly SessionRecord[]): ToolResultRecord[] {
  return records.filter(
    (r): r is ToolResultRecord => r.type === 'tool/result' && r.error?.errorClass === 'DENIED',
  );
}

function denialRecords(records: readonly SessionRecord[]): DenialRecord[] {
  return records.filter((r): r is DenialRecord => r.type === 'audit/denial');
}

function toolResults(records: readonly SessionRecord[]): ToolResultRecord[] {
  return records.filter((r): r is ToolResultRecord => r.type === 'tool/result');
}

/** 同一 intent 的模型脚本：先连发 N 次同参调用，之后退出（用于反证"不熔断时会走多远"）。 */
function sameIntentScript(toolName: string, maxDenials: number, args: Record<string, unknown> = { n: 1 }): MockScriptEntry[] {
  return [
    { when: /.*/, maxToolResults: maxDenials - 1, response: { toolCalls: [{ name: toolName, arguments: args }] } },
    { when: /.*/, response: { text: 'GAVE-UP' } },
  ];
}

describe('AgentLoop denial breaker — 工具内 DENIED 同样熔断（BRIEF: 拒绝可无限重试）', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-denial-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('① 真实 fs 守卫（Write .env）同参连发 3 次 ⇒ DenialLimitError（删掉 post-execute 计数行即红：旧实现跑到 maxSteps ⇒ kind=budget）', async () => {
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1', 'utf8');
    // 无任何 before_tool 监听器 ⇒ 门禁 allow ⇒ 拒绝必然来自**工具层**（fs 守卫 protected）
    const { session, loop, executed } = await makeHarness(dir, [
      { when: /.*/, response: { toolCalls: [{ name: 'Write', arguments: { path: '.env', content: 'x' } }] } },
    ], { maxSteps: 5 });

    const result = await loop.runTurn('写 .env');

    // 第 3 次即熔断：kind=error + 文案逐字
    expect(result.kind).toBe('error');
    expect(result.finalText).toBe(breakerMessage('Write'));
    expect(result.steps).toBe(3);
    expect(result.toolCalls).toBe(3);

    const records = session.replay();
    const denied = deniedResults(records);
    expect(denied).toHaveLength(3);
    // 三次都是**工具层**拒绝（meta.guard 来自 FsGuardError），不是门禁拒绝
    for (const r of denied) {
      expect(r.error?.message).toContain('write protected path');
      expect(r.meta).toMatchObject({ guard: 'protected' });
    }
    // 工具真的执行了 3 次（证明走的是 tool-layer 路径），且落盘副作用从未发生
    expect(executed).toHaveLength(3);
    expect(fs.readFileSync(path.join(dir, '.env'), 'utf8')).toBe('SECRET=1');

    // 逐字未变：工具层拒绝**不**产生 audit/denial（recordDenial 行为不动）
    expect(denialRecords(records)).toHaveLength(0);
    // 配对不变量：turn/start ↔ turn/end 仍然 1:1
    expect(records.filter((r) => r.type === 'turn/start')).toHaveLength(1);
    const end = records.find((r) => r.type === 'turn/end');
    expect(end).toMatchObject({ turnId: result.turnId, kind: 'error' });
    await session.close();
  });

  it('② 最小复现：自定义恒拒工具同参连发 3 次 ⇒ DenialLimitError（旧实现得 GAVE-UP ⇒ success）', async () => {
    const { session, loop, executed } = await makeHarness(dir, sameIntentScript('Flaky', 3), {
      extraTools: [alwaysDeniedTool('Flaky')],
      maxSteps: 8,
    });

    const result = await loop.runTurn('do the impossible');

    expect(result.kind).toBe('error');
    expect(result.finalText).toBe(breakerMessage('Flaky'));
    expect(result.toolCalls).toBe(3);

    const records = session.replay();
    expect(deniedResults(records)).toHaveLength(3);
    expect(toolResults(records)).toHaveLength(3);
    expect(executed).toHaveLength(3);
    expect(denialRecords(records)).toHaveLength(0);
    await session.close();
  });

  it('③ 负对照：同一工具 5 次**成功**调用不计数、不熔断（计数任何 tool/result 的实现会红）', async () => {
    const { session, loop, executed } = await makeHarness(dir, sameIntentScript('Ok', 5), {
      extraTools: [alwaysOkTool('Ok')],
      maxSteps: 12,
    });

    const result = await loop.runTurn('keep succeeding');

    expect(result.kind).toBe('success');
    expect(result.finalText).toBe('GAVE-UP');
    expect(executed).toHaveLength(5);
    const results = toolResults(session.replay());
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.error === undefined)).toBe(true);
    await session.close();
  });

  it('④ 负对照：非 DENIED 错误（TOOL_FAILURE）同参连发 5 次不计数、不熔断（按 error!==undefined 计数的实现会红）', async () => {
    const { session, loop, executed } = await makeHarness(dir, sameIntentScript('Broken', 5), {
      extraTools: [alwaysFailingTool('Broken')],
      maxSteps: 12,
    });

    const result = await loop.runTurn('keep failing');

    expect(result.kind).toBe('success');
    expect(result.finalText).toBe('GAVE-UP');
    expect(executed).toHaveLength(5);
    const results = toolResults(session.replay());
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.error?.errorClass === 'TOOL_FAILURE')).toBe(true);
    expect(deniedResults(session.replay())).toHaveLength(0);
    await session.close();
  });

  it('⑤ 负对照：不同参数不合并（3 次 DENIED 但 args 各异 ⇒ 不熔断；同 args 第 3 次才熔断，共 5 次调用）', async () => {
    const script: MockScriptEntry[] = [
      { when: /.*/, minToolResults: 0, maxToolResults: 0, response: { toolCalls: [{ name: 'Flaky', arguments: { n: 1 } }] } },
      { when: /.*/, minToolResults: 1, maxToolResults: 1, response: { toolCalls: [{ name: 'Flaky', arguments: { n: 2 } }] } },
      { when: /.*/, minToolResults: 2, maxToolResults: 2, response: { toolCalls: [{ name: 'Flaky', arguments: { n: 3 } }] } },
      { when: /.*/, minToolResults: 3, maxToolResults: 4, response: { toolCalls: [{ name: 'Flaky', arguments: { n: 1 } }] } },
      { when: /.*/, response: { text: 'GAVE-UP' } },
    ];
    const { session, loop, executed } = await makeHarness(dir, script, {
      extraTools: [alwaysDeniedTool('Flaky')],
      maxSteps: 10,
    });

    const result = await loop.runTurn('vary then repeat');

    // 前 3 次 args 各异 ⇒ 未熔断；第 5 次调用（{n:1} 的第 3 次）才熔断
    expect(result.kind).toBe('error');
    expect(result.finalText).toBe(breakerMessage('Flaky'));
    expect(executed).toHaveLength(5);
    expect(deniedResults(session.replay())).toHaveLength(5);
    expect(executed.map((c) => JSON.stringify(c.arguments))).toEqual([
      '{"n":1}', '{"n":2}', '{"n":3}', '{"n":1}', '{"n":1}',
    ]);
    await session.close();
  });

  it('⑥ 跨阶段同一 key 只计一次：先门禁拒 1 次、后工具拒 2 次 ⇒ 恰在第 3 次熔断（重复计数的实现会在第 2 次就红）', async () => {
    const { session, bus, loop, executed } = await makeHarness(dir, sameIntentScript('Flaky', 3), {
      extraTools: [alwaysDeniedTool('Flaky')],
      maxSteps: 8,
    });
    let gateCalls = 0;
    bus.on('before_tool', () => {
      gateCalls += 1;
      // 只拒第 1 次：之后的调用落到工具层，被工具自己拒 —— 两种来源、同一个 intent key
      if (gateCalls === 1) return { kind: 'deny' as const, reason: 'first call denied by listener', ref: 'test:first-only' };
      return;
    }, 'test:first-only');

    const result = await loop.runTurn('mixed refusal sources');

    expect(result.kind).toBe('error');
    expect(result.finalText).toBe(breakerMessage('Flaky'));
    // 门禁拒 1 次（1 条 audit/denial，stage 'rule'）+ 工具拒 2 次 = 3 次；两处各计一次、互不重复
    const records = session.replay();
    expect(denialRecords(records)).toHaveLength(1);
    expect(denialRecords(records)[0]).toMatchObject({ stage: 'rule', ruleRef: 'test:first-only' });
    expect(deniedResults(records)).toHaveLength(3);
    // 工具只在下两次真正执行过 —— 重复计数会让熔断提前到第 2 次（executed=1 / results=2）
    expect(executed).toHaveLength(2);
    await session.close();
  });

  it('⑦ 不回归：执行前门禁拒绝的既有熔断语义逐字不变（stage/reason/ref/文案/第 3 次/配对/工具从未执行）', async () => {
    const { session, bus, loop, executed } = await makeHarness(dir, sameIntentScript('Flaky', 3), {
      extraTools: [alwaysDeniedTool('Flaky')],
      maxSteps: 8,
    });
    bus.on('before_tool', () => ({ kind: 'deny' as const, reason: 'blocked by test listener', ref: 'test:always-deny' }), 'test-deny');

    const result = await loop.runTurn('always denied at the gate');

    expect(result.kind).toBe('error');
    expect(result.finalText).toBe(breakerMessage('Flaky'));
    expect(result.toolCalls).toBe(3);
    expect(executed).toHaveLength(0);

    const records = session.replay();
    const denials = denialRecords(records);
    expect(denials).toHaveLength(3);
    for (const d of denials) {
      expect(d).toMatchObject({
        stage: 'rule',
        ruleRef: 'test:always-deny',
        reason: 'blocked by test listener',
        toolName: 'Flaky',
        sandboxMode: 'workspace-write',
      });
    }
    const denied = deniedResults(records);
    expect(denied).toHaveLength(3);
    for (const r of denied) {
      expect(r.meta).toMatchObject({ denied: true, ref: 'test:always-deny' });
      expect(r.meta).not.toHaveProperty('listenerError');
    }
    expect(records.filter((r) => r.type === 'turn/start')).toHaveLength(1);
    expect(records.filter((r) => r.type === 'turn/end')).toHaveLength(1);
    await session.close();
  });

  it('⑧ 新增口径（本卡）：ask 分支（approval unavailable fail-closed）的 DENIED 同样熔断，stage 仍为 approval', async () => {
    const { session, bus, loop, executed } = await makeHarness(dir, sameIntentScript('Flaky', 3), {
      extraTools: [alwaysDeniedTool('Flaky')],
      maxSteps: 8,
    });
    bus.on('before_tool', () => ({ kind: 'ask' as const, reason: 'needs approval', ref: 'test:ask' }), 'test-ask');

    const result = await loop.runTurn('needs approval');

    expect(result.kind).toBe('error');
    expect(result.finalText).toBe(breakerMessage('Flaky'));
    expect(executed).toHaveLength(0);

    const records = session.replay();
    const denials = denialRecords(records);
    expect(denials).toHaveLength(3);
    for (const d of denials) expect(d).toMatchObject({ stage: 'approval', ruleRef: 'test:ask', reason: 'needs approval' });
    const denied = deniedResults(records);
    expect(denied).toHaveLength(3);
    for (const r of denied) {
      // tool/result 形状逐字未变
      expect(r.error?.message).toBe('approval unavailable (fail-closed)');
      expect(r.meta).toMatchObject({ denied: true, stage: 'approval' });
    }
    await session.close();
  });
});
