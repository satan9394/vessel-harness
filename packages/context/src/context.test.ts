import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Session } from '@vessel/core';
import { Compaction } from './compaction/Compaction.js';
import { ContextBuilder } from './builder/Builder.js';
import { discoverInstructions } from './instructions/Instructions.js';
import type { ToolSpec } from '@vessel/shared';

describe('context/compaction — Basic Compaction', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-compact-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('pressure trigger fires at 0.8 x contextWindow', () => {
    const s = null as unknown as Session;
    const c = new Compaction({ session: s });
    expect(c.shouldCompact(160_000, 200_000)).toBe(true);
    expect(c.shouldCompact(100_000, 200_000)).toBe(false);
  });

  it('replaces the oldest balanced region, keeps tail verbatim, pairs never split', async () => {
    const session = await Session.open({ workspaceRoot: dir, sessionId: 'c1' });
    // build a history: user → assistant tool call → result → assistant tool call → result → assistant text
    await session.appendSync({ type: 'turn/start', turnId: 't1', surface: false });
    await session.appendSync({ type: 'user/message', msgId: 'm1', role: 'user', content: '任务：读取并处理', surface: true });
    await session.appendSync({ type: 'assistant/attempt', msgId: 'a1', role: 'assistant', content: '', toolCalls: [{ toolCallId: 'tc1', name: 'Read', arguments: {} }], attemptNo: 1, surface: false });
    await session.appendSync({ type: 'tool/call', toolCallId: 'tc1', toolName: 'Read', arguments: {}, mode: 'auto', surface: false });
    await session.appendSync({ type: 'tool/result', toolCallId: 'tc1', toolName: 'Read', content: 'DATA', meta: {}, surface: true });
    await session.appendSync({ type: 'assistant/attempt', msgId: 'a2', role: 'assistant', content: '', toolCalls: [{ toolCallId: 'tc2', name: 'Write', arguments: {} }], attemptNo: 1, surface: false });
    await session.appendSync({ type: 'tool/call', toolCallId: 'tc2', toolName: 'Write', arguments: {}, mode: 'auto', surface: false });
    await session.appendSync({ type: 'tool/result', toolCallId: 'tc2', toolName: 'Write', content: 'ok', meta: {}, surface: true });
    await session.appendSync({ type: 'assistant/message', msgId: 'a3', role: 'assistant', content: 'TAIL-KEEP-ME', surface: true });
    await session.appendSync({ type: 'turn/end', turnId: 't1', kind: 'success', stats: { steps: 2, toolCalls: 2, durationMs: 1 }, surface: false });
    const before = session.size;

    const compaction = new Compaction({ session });
    const result = await compaction.compact('pressure');
    expect(result.removedRecords).toBeGreaterThan(0);

    const records = session.replay();
    // tail kept verbatim
    expect(records.some((r) => r.type === 'assistant/message' && r.content === 'TAIL-KEEP-ME')).toBe(true);
    // summary present
    expect(records.some((r) => r.type === 'user/message' && (r as { source?: string }).source === 'compacted-summary')).toBe(true);
    // compaction events paired
    const starts = records.filter((r) => r.type === 'compaction/start').length;
    const ends = records.filter((r) => r.type === 'compaction/end').length;
    expect(starts).toBe(1);
    expect(ends).toBe(1);
    // seq continuous
    const seqs = records.map((r) => r.seq);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
    // no tool/call without its pair inside OR outside the region
    const openCalls = new Set<string>();
    let balanced = true;
    for (const r of records) {
      if (r.type === 'tool/call') openCalls.add(r.toolCallId);
      if (r.type === 'tool/result') openCalls.delete(r.toolCallId);
      if (r.type === 'user/message' && (r as { source?: string }).source === 'compacted-summary' && openCalls.size > 0) balanced = false;
    }
    expect(balanced).toBe(true);
    expect(session.size).toBeLessThan(before);
    await session.close();
  });

  it('uses the injected LLM-style summarizer when provided', async () => {
    const session = await Session.open({ workspaceRoot: dir, sessionId: 'c2' });
    await session.appendSync({ type: 'user/message', msgId: 'm1', role: 'user', content: '请求内容XYZ', surface: true });
    await session.appendSync({ type: 'assistant/message', msgId: 'a1', role: 'assistant', content: '做了一些事', surface: true });
    const summarize = vi.fn(async () => 'LLM-SUMMARY');
    const compaction = new Compaction({ session, summarize });
    await compaction.compact('manual');
    expect(summarize).toHaveBeenCalled();
    expect(session.replay().some((r) => r.type === 'user/message' && r.content.includes('LLM-SUMMARY'))).toBe(true);
    await session.close();
  });
});

describe('context/builder — three-layer assembly', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-builder-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('assembles stable + history + visible tools; instructions injected as user messages once', async () => {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '项目指令：先读后写。', 'utf8');
    const session = await Session.open({ workspaceRoot: dir, sessionId: 'b1' });
    await session.appendSync({ type: 'user/message', msgId: 'm1', role: 'user', content: '第一问', surface: true });

    const tools: ToolSpec[] = [
      { name: 'Read', description: 'read', family: 'file_read', requiredPermission: 'read', exclusive: false, inputSchema: { type: 'object', properties: {} }, execute: async () => ({ content: '', meta: {} }) },
      { name: 'Write', description: 'write', family: 'file_write', requiredPermission: 'workspace-write', exclusive: true, inputSchema: { type: 'object', properties: {} }, execute: async () => ({ content: '', meta: {} }) },
    ];
    const builder = new ContextBuilder({
      session,
      model: 'm',
      stableSections: () => ['行为段A', '行为段B'],
      policyGuidance: () => ['策略引导1'],
      instructions: () => discoverInstructions(dir, dir),
      getVisibleTools: () => tools,
      volatileText: () => 'time=now',
    });

    const env = await builder.assemble(1);
    const system = env.messages.find((m) => m.role === 'system');
    expect(system?.content).toContain('行为段A');
    expect(system?.content).toContain('策略引导1');
    // instructions injected as user message with the AGENTS.md content
    expect(env.messages.some((m) => m.role === 'user' && m.content.includes('项目指令'))).toBe(true);
    // history derived from surface
    expect(env.messages.some((m) => m.role === 'user' && m.content === '第一问')).toBe(true);
    // visible tools
    expect(env.tools.map((t) => t.function.name)).toEqual(['Read', 'Write']);
    expect(env.estimateTokens).toBeGreaterThan(0);
    await session.close();
  });

  it('project memory frozen snapshot injected once as a user message with source=memory', async () => {
    const session = await Session.open({ workspaceRoot: dir, sessionId: 'b3' });
    const tools: ToolSpec[] = [];
    const builder = new ContextBuilder({
      session, model: 'm',
      stableSections: () => [], policyGuidance: () => [],
      instructions: () => [],
      projectMemory: () => '[Project Memory 快照]\n## arch\ncore 薄核',
      getVisibleTools: () => tools,
      volatileText: () => '',
    });
    const env = await builder.assemble(1);
    expect(env.messages.some((m) => m.role === 'user' && m.content.includes('[Project Memory 快照]'))).toBe(true);
    // injected once — second assemble does not duplicate the snapshot record
    await builder.assemble(2);
    const snapRecs = session.replay().filter((r) => r.type === 'user/message' && (r as { source?: string }).source === 'memory');
    expect(snapRecs).toHaveLength(1);
    await session.close();
  });

  it('denied tools never reach the model (schema-level trimming)', async () => {
    const session = await Session.open({ workspaceRoot: dir, sessionId: 'b2' });
    const visible: ToolSpec[] = [
      { name: 'Read', description: 'r', family: 'file_read', requiredPermission: 'read', exclusive: false, inputSchema: { type: 'object', properties: {} }, execute: async () => ({ content: '', meta: {} }) },
    ];
    const builder = new ContextBuilder({
      session, model: 'm',
      stableSections: () => [], policyGuidance: () => [],
      instructions: () => [], getVisibleTools: () => visible.filter((t) => t.name !== 'Read'),
      volatileText: () => '',
    });
    const env = await builder.assemble(1);
    expect(env.tools).toHaveLength(0);
    await session.close();
  });
});

describe('context/builder — wire 历史投影（task 109 线协议修复）', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-wire109-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  async function makeBuilder(session: Session): Promise<ContextBuilder> {
    return new ContextBuilder({
      session, model: 'm',
      stableSections: () => [], policyGuidance: () => [],
      instructions: () => [], getVisibleTools: () => [],
      volatileText: () => '',
    });
  }

  /** 工具多轮序列：user → assistant/attempt(Read) → tool/result → assistant/attempt(Write) → tool/result → assistant/message。 */
  async function seedToolSequence(session: Session): Promise<void> {
    await session.appendSync({ type: 'turn/start', turnId: 't1', surface: false });
    await session.appendSync({ type: 'user/message', msgId: 'm1', role: 'user', content: '任务', surface: true });
    await session.appendSync({ type: 'assistant/attempt', msgId: 'a1', role: 'assistant', content: '', toolCalls: [{ toolCallId: 'tc1', name: 'Read', arguments: { path: 'a.txt' } }], reasoningContent: '想：先读文件', attemptNo: 1, surface: false });
    await session.appendSync({ type: 'tool/call', toolCallId: 'tc1', toolName: 'Read', arguments: { path: 'a.txt' }, mode: 'auto', surface: false });
    await session.appendSync({ type: 'tool/result', toolCallId: 'tc1', toolName: 'Read', content: 'DATA', meta: {}, surface: true });
    await session.appendSync({ type: 'assistant/attempt', msgId: 'a2', role: 'assistant', content: '', toolCalls: [{ toolCallId: 'tc2', name: 'Write', arguments: { path: 'b.txt', content: 'x' } }], attemptNo: 1, surface: false });
    await session.appendSync({ type: 'tool/call', toolCallId: 'tc2', toolName: 'Write', arguments: { path: 'b.txt', content: 'x' }, mode: 'auto', surface: false });
    await session.appendSync({ type: 'tool/result', toolCallId: 'tc2', toolName: 'Write', content: 'ok', meta: {}, surface: true });
    await session.appendSync({ type: 'assistant/message', msgId: 'a3', role: 'assistant', content: '完成', reasoningContent: '想：都做完了', surface: true });
    await session.appendSync({ type: 'turn/end', turnId: 't1', kind: 'success', stats: { steps: 2, toolCalls: 2, durationMs: 1 }, surface: false });
  }

  it('assistant/attempt（承载 tool_calls）也投影进 wire 历史，tool 消息紧跟其后的 assistant', async () => {
    const session = await Session.open({ workspaceRoot: dir, sessionId: 'w1' });
    await seedToolSequence(session);
    const env = await (await makeBuilder(session)).assemble(1);

    const roles = env.messages.map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'tool', 'assistant']);

    const asst1 = env.messages[2]!;
    expect(asst1.toolCalls).toEqual([{ id: 'tc1', name: 'Read', arguments: { path: 'a.txt' } }]);
    const asst2 = env.messages[4]!;
    expect(asst2.toolCalls).toEqual([{ id: 'tc2', name: 'Write', arguments: { path: 'b.txt', content: 'x' } }]);
    // 纯文本终态无 tool_calls
    expect(env.messages[6]!.toolCalls).toBeUndefined();
    await session.close();
  });

  it('严格上游形状：每条 tool 消息前都有带 tool_calls 的 assistant 且 tool_call_id 对应（108 400 复现反转）', async () => {
    const session = await Session.open({ workspaceRoot: dir, sessionId: 'w2' });
    await seedToolSequence(session);
    const env = await (await makeBuilder(session)).assemble(1);

    const msgs = env.messages.filter((m) => m.role !== 'system');
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i]!.role !== 'tool') continue;
      const prev = msgs[i - 1]!;
      expect(prev.role).toBe('assistant');
      expect(prev.toolCalls?.map((tc) => tc.id)).toContain(msgs[i]!.toolCallId);
    }
    await session.close();
  });

  it('reasoning_content 回传：assistant 记录带 reasoningContent → 历史携带；非推理（无字段）不受影响', async () => {
    const session = await Session.open({ workspaceRoot: dir, sessionId: 'w3' });
    await seedToolSequence(session);
    const env = await (await makeBuilder(session)).assemble(1);
    const asst1 = env.messages[2]!;
    expect(asst1.reasoningContent).toBe('想：先读文件');
    const asstFinal = env.messages[6]!;
    expect(asstFinal.reasoningContent).toBe('想：都做完了');

    // 非推理模型：无 reasoningContent 字段 → 历史里是 undefined（wire 序列化不产生 reasoning_content）
    const plain = await Session.open({ workspaceRoot: dir, sessionId: 'w4' });
    await plain.appendSync({ type: 'user/message', msgId: 'p1', role: 'user', content: 'hi', surface: true });
    await plain.appendSync({ type: 'assistant/message', msgId: 'p2', role: 'assistant', content: 'ok', surface: true });
    const env2 = await (await makeBuilder(plain)).assemble(1);
    expect(env2.messages.find((m) => m.role === 'assistant')?.reasoningContent).toBeUndefined();
    await plain.close();
    await session.close();
  });
});
