import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChatProvider, ChatRequest, ChatResponse, PolicyArtifacts, ToolSpec } from '@vessel/shared';
import { EventBus, Session } from '@vessel/core';
import { MockProvider } from '@vessel/llm';
import { compilePolicyYaml } from '@vessel/policy';
import { ToolRegistry } from '@vessel/tools';
import { SubagentManager } from './SubagentManager.js';
import { createSubagentTool } from './createSubagentTool.js';
import { createIsolatedRuntime } from './IsolatedRuntime.js';

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
    deny: []
  guidance:
    - 只调用显式允许的工具
`;

function artifacts(): PolicyArtifacts {
  return compilePolicyYaml(POLICY_YAML);
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cah-subagent-'));
}

/** Blocker provider: chat() waits until released (used for concurrency tests). */
class GateProvider implements ChatProvider {
  readonly id = 'gate';
  private releaseFn: (() => void) | null = null;
  private readonly gate: Promise<void>;
  constructor(private readonly inner: ChatProvider) {
    this.gate = new Promise((res) => {
      this.releaseFn = res;
    });
  }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    await this.gate;
    return this.inner.chat(req);
  }
  release(): void {
    this.releaseFn?.();
  }
}

describe('V0.2-M1 subagent — delegation (H11)', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = tempDir();
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('delegates a task to an isolated child session and returns the result contract', async () => {
    const bus = new EventBus();
    const provider = new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'CHILD-DONE-42' } }], { model: 'child-model' });
    const manager = new SubagentManager({
      workspaceRoot: workspace,
      provider,
      model: 'child-model',
      policyArtifacts: artifacts(),
      tools: [],
      bus,
      parentSessionId: 'parent-sess-1',
    });
    const started: string[] = [];
    const stopped: string[] = [];
    bus.on('subagent_start', (p) => {
      started.push((p as { childSessionId: string }).childSessionId);
    });
    bus.on('subagent_stop', (p) => {
      stopped.push((p as { result: { stopReason: string } }).result.stopReason);
    });

    const result = await manager.delegate({ prompt: '做一件独立的事', delegationDepth: 0 });

    expect(result.output).toBe('CHILD-DONE-42');
    expect(result.stopReason).toBe('completed');
    expect(result.isError).toBe(false);
    expect(result.delegationDepth).toBe(1);
    expect(result.childSessionId.length).toBeGreaterThan(0);
    expect(result.childSessionId).not.toBe('parent-sess-1');
    expect(started).toHaveLength(1);
    expect(stopped).toEqual(['completed']);
    expect(manager.activeChildren).toBe(0);

    // child session log records session/created with source=subagent + depth
    const childDir = path.join(workspace, '.harness', 'sessions', result.childSessionId);
    const log = fs.readFileSync(path.join(childDir, 'session.jsonl'), 'utf8');
    expect(log).toContain('"session/created"');
    expect(log).toContain('"source":"subagent"');
    expect(log).toContain('"delegationDepth":1');
    expect(log).toContain('"parentSession":"parent-sess-1"');
  });

  it('parent never sees the child intermediate records (info hiding)', async () => {
    const bus = new EventBus();
    // child provider: Read a file first, then answer — exercises child tools + policy
    const provider = new MockProvider(
      [
        { when: /读|read|文件/i, ifNoToolResult: true, response: { toolCalls: [{ name: 'Read', arguments: { path: 'data.txt' } }] } },
        { when: /.*/, minToolResults: 1, response: { text: '子代理已读取：{last_tool_result}' } },
      ],
      { model: 'child-model' },
    );
    const readTool: ToolSpec = {
      name: 'Read',
      description: 'read a file',
      family: 'file_read',
      requiredPermission: 'read',
      exclusive: false,
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async execute(args, ctx) {
        const p = path.join(ctx.workspaceRoot, String(args.path ?? ''));
        return { content: fs.readFileSync(p, 'utf8'), meta: {} };
      },
    };
    fs.writeFileSync(path.join(workspace, 'data.txt'), 'FILE-BODY-77', 'utf8');
    const parentSession = await Session.open({ workspaceRoot: workspace, sessionId: 'parent-sess-1' });
    await parentSession.appendSync({ type: 'user/message', msgId: 'm1', role: 'user', content: '父会话上下文', surface: true });

    const manager = new SubagentManager({
      workspaceRoot: workspace,
      provider,
      model: 'child-model',
      policyArtifacts: artifacts(),
      tools: [readTool],
      bus,
      parentSessionId: parentSession.sessionId,
    });
    const result = await manager.delegate({ prompt: '读文件 data.txt 并汇报', delegationDepth: 0 });

    expect(result.stopReason).toBe('completed');
    expect(result.output).toContain('FILE-BODY-77');

    // child's own records are separate from the parent's
    const childLogPath = path.join(workspace, '.harness', 'sessions', result.childSessionId, 'session.jsonl');
    const childRecords = (await fs.promises.readFile(childLogPath, 'utf8')).split('\n').filter((l) => l.trim());
    expect(childRecords.some((l) => l.includes('FILE-BODY-77'))).toBe(true);
    const parentRecords = parentSession.replay();
    expect(parentRecords.some((r) => r.type === 'user/message' && r.content.includes('子代理已读取'))).toBe(false);
    expect(parentRecords.some((r) => r.type === 'tool/call')).toBe(false);
    await parentSession.close();
  });

  it('enforces the concurrency cap (1–3) — second delegate is denied while one is active', async () => {
    const bus = new EventBus();
    const inner = new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'SLOW-DONE' } }], { model: 'child-model' });
    const gate = new GateProvider(inner);
    const manager = new SubagentManager({
      workspaceRoot: workspace,
      provider: gate,
      model: 'child-model',
      policyArtifacts: artifacts(),
      tools: [],
      bus,
      maxConcurrent: 1,
    });
    const p1 = manager.delegate({ prompt: '任务A', delegationDepth: 0 });
    // wait until the first child occupies the slot
    await vi.waitFor(() => expect(manager.activeChildren).toBe(1));
    const p2 = await manager.delegate({ prompt: '任务B', delegationDepth: 0 });
    expect(p2.stopReason).toBe('denied');
    expect(p2.isError).toBe(true);
    expect(p2.diagnostic).toContain('concurrency');

    gate.release();
    const r1 = await p1;
    expect(r1.stopReason).toBe('completed');
    expect(manager.activeChildren).toBe(0);
  });

  it('clamps maxConcurrent into [1,3] and enforces depth limits', async () => {
    const bus = new EventBus();
    const provider = new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'OK' } }], { model: 'child-model' });
    const m1 = new SubagentManager({ workspaceRoot: workspace, provider, model: 'child-model', policyArtifacts: artifacts(), tools: [], bus, maxConcurrent: 5 });
    expect(m1.maxConcurrentChildren).toBe(3);
    const m2 = new SubagentManager({ workspaceRoot: workspace, provider, model: 'child-model', policyArtifacts: artifacts(), tools: [], bus, maxConcurrent: 0 });
    expect(m2.maxConcurrentChildren).toBe(1);

    const m3 = new SubagentManager({ workspaceRoot: workspace, provider, model: 'child-model', policyArtifacts: artifacts(), tools: [], bus, maxDepth: 1 });
    const denied = await m3.delegate({ prompt: 'x', delegationDepth: 1 });
    expect(denied.stopReason).toBe('denied');
    expect(denied.diagnostic).toContain('depth');
    expect(m3.canDelegate(1)).toBe(false);
    expect(m3.canDelegate(0)).toBe(true);
  });

  it('BeforeDelegate (A22) waterfall can deny a delegation', async () => {
    const bus = new EventBus();
    bus.on('before_delegate', () => ({ kind: 'deny' as const, reason: 'no delegation allowed' }));
    const provider = new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'NEVER' } }], { model: 'child-model' });
    const manager = new SubagentManager({ workspaceRoot: workspace, provider, model: 'child-model', policyArtifacts: artifacts(), tools: [], bus });
    const result = await manager.delegate({ prompt: 'x', delegationDepth: 0 });
    expect(result.stopReason).toBe('denied');
    expect(result.diagnostic).toContain('no delegation allowed');
  });

  // BRIEF-决策点 fail-open：委派是安全门禁点，监听器抛错必须 fail-closed（旧语义 = 静默放行）。
  it('抛错的 BeforeDelegate 监听器 ⇒ 委派被拒（fail-closed，diagnostic 带 listener-error 标记）', async () => {
    const bus = new EventBus();
    bus.on('before_delegate', () => { throw new Error('delegate interceptor crashed'); }, 'interceptor');
    const provider = new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'NEVER' } }], { model: 'child-model' });
    const manager = new SubagentManager({ workspaceRoot: workspace, provider, model: 'child-model', policyArtifacts: artifacts(), tools: [], bus });
    const result = await manager.delegate({ prompt: 'x', delegationDepth: 0 });
    expect(result.stopReason).toBe('denied');
    expect(result.isError).toBe(true);
    expect(result.diagnostic).toContain('listener-error:interceptor');
    expect(result.diagnostic).toContain('delegate interceptor crashed');
    expect(manager.activeChildren).toBe(0); // 没有任何子运行时/槽位被创建
  });

  // 负对照：同一条链上的"没有意见"（void / defer）不得被 fail-closed 掐死。
  it('负对照：BeforeDelegate 监听器返回 void / defer ⇒ 委派照常发生', async () => {
    const bus = new EventBus();
    bus.on('before_delegate', () => undefined, 'observer');
    bus.on('before_delegate', () => ({ kind: 'defer' as const }), 'deferrer');
    const provider = new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'CHILD-RAN' } }], { model: 'child-model' });
    const manager = new SubagentManager({ workspaceRoot: workspace, provider, model: 'child-model', policyArtifacts: artifacts(), tools: [], bus });
    const result = await manager.delegate({ prompt: 'x', delegationDepth: 0 });
    expect(result.stopReason).toBe('completed');
    expect(result.output).toBe('CHILD-RAN');
    expect(manager.activeChildren).toBe(0);
  });

  it('Subagent tool executes through the registry and flows through policy', async () => {
    const bus = new EventBus();
    const provider = new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'TOOL-CHILD-DONE' } }], { model: 'child-model' });
    const manager = new SubagentManager({ workspaceRoot: workspace, provider, model: 'child-model', policyArtifacts: artifacts(), tools: [], bus });
    const subagentTool = createSubagentTool(manager);
    const registry = new ToolRegistry([subagentTool]);
    const ctx = { workspaceRoot: workspace, cwd: workspace, sandbox: { confine: async () => ({ argv: [], enforcement: 'none' as const }), status: () => ({ enabled: false, supported: 'none' as const, active: false }) } };

    const r = await registry.execute({ toolCallId: 't1', toolName: 'Subagent', arguments: { prompt: '做一件事' } }, ctx);
    expect(r.error).toBeUndefined();
    expect(r.content).toBe('TOOL-CHILD-DONE');
    expect((r.meta.subagent as { stopReason: string }).stopReason).toBe('completed');

    // policy deny on the Subagent tool name works (denied_tools)
    const reg2 = new ToolRegistry([subagentTool], { deniedTools: ['Subagent'] });
    const d = await reg2.execute({ toolCallId: 't2', toolName: 'Subagent', arguments: { prompt: 'x' } }, ctx);
    expect(d.error?.errorClass).toBe('DENIED');
  });

  it('createIsolatedRuntime produces a working isolated session with loop + registry', async () => {
    const provider = new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'ISO-DONE' } }], { model: 'iso-model' });
    const runtime = await createIsolatedRuntime({
      workspaceRoot: workspace,
      provider,
      model: 'iso-model',
      policyArtifacts: artifacts(),
      tools: [],
      source: 'subagent',
      parentSession: 'parent-sess-1',
      delegationDepth: 2,
    });
    const turn = await runtime.loop.runTurn('独立任务');
    expect(turn.finalText).toBe('ISO-DONE');
    const rec = runtime.session.replay().find((r) => r.type === 'session/created') as { source: string; delegationDepth: number; parentSession?: string };
    expect(rec.source).toBe('subagent');
    expect(rec.delegationDepth).toBe(2);
    expect(rec.parentSession).toBe('parent-sess-1');
    await runtime.close();
  });

  it('Subagent tool passes an agent preset label through to the delegation (V0.4 roles-as-presets)', async () => {
    const bus = new EventBus();
    const provider = new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'PRESET-CHILD-DONE' } }], { model: 'child-model' });
    // onWarn 静音：本用例未接线 presetLookup，声明 preset 会走「最严格面兜底」并告警（BRIEF 新语义）
    const manager = new SubagentManager({ workspaceRoot: workspace, provider, model: 'child-model', policyArtifacts: artifacts(), tools: [], bus, onWarn: () => {} });
    const delegateSpy = vi.spyOn(manager, 'delegate');
    const subagentTool = createSubagentTool(manager);
    const registry = new ToolRegistry([subagentTool]);
    const ctx = { workspaceRoot: workspace, cwd: workspace, sandbox: { confine: async () => ({ argv: [], enforcement: 'none' as const }), status: () => ({ enabled: false, supported: 'none' as const, active: false }) } };

    const r = await registry.execute({ toolCallId: 'p1', toolName: 'Subagent', arguments: { prompt: '审查这段代码', preset: 'reviewer' } }, ctx);
    expect(r.error).toBeUndefined();
    expect(delegateSpy).toHaveBeenCalledWith(expect.objectContaining({ preset: 'reviewer' }));
    expect((r.meta.subagent as { preset?: string }).preset).toBe('reviewer');
    // BRIEF：未接线查找器时「收窄到最严格面」在工具边界也可见（不再静默全量面）
    expect((r.meta.subagent as { presetNarrowing?: string }).presetNarrowing).toBe('strictest-fallback');
    delegateSpy.mockRestore();
  });

  it('BRIEF：未解析 preset 的兜底状态在工具边界可见（meta + content 提示）；声明 output_schema 时不污染 content', async () => {
    const provider = new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: '{"verdict":"met"}' } }], { model: 'child-model' });
    const manager = new SubagentManager({ workspaceRoot: workspace, provider, model: 'child-model', policyArtifacts: artifacts(), tools: [], bus: new EventBus(), onWarn: () => {} });
    const registry = new ToolRegistry([createSubagentTool(manager)]);
    const ctx = { workspaceRoot: workspace, cwd: workspace, sandbox: { confine: async () => ({ argv: [], enforcement: 'none' as const }), status: () => ({ enabled: false, supported: 'none' as const, active: false }) } };

    // ① 普通委派：content 带一行可见提示（模型只看得到 content）
    const plain = await registry.execute({ toolCallId: 'f1', toolName: 'Subagent', arguments: { prompt: '评审', preset: 'reviewer' } }, ctx);
    expect(plain.error).toBeUndefined();
    expect(plain.content.startsWith('【preset 未解析】')).toBe(true);
    expect(plain.content).toContain('{"verdict":"met"}');
    expect((plain.meta.subagent as { presetNarrowing?: string }).presetNarrowing).toBe('strictest-fallback');

    // ② output_schema 委派：调用方按 content 解析 JSON ⇒ 不并入提示，只走 meta
    const structured = await registry.execute(
      { toolCallId: 'f2', toolName: 'Subagent', arguments: { prompt: '评审', preset: 'reviewer', output_schema: { type: 'object' } } },
      ctx,
    );
    expect(structured.error).toBeUndefined();
    expect(structured.content).toBe('{"verdict":"met"}');
    expect((structured.meta.subagent as { presetNarrowing?: string }).presetNarrowing).toBe('strictest-fallback');
  });
});
