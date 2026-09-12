import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChatProvider, ChatRequest, ChatResponse, PolicyArtifacts, ToolSpec } from '@vessel/shared';
import { EventBus } from '@vessel/core';
import { AutoTaskRouter, MockProvider } from '@vessel/llm';
import { compilePolicyYaml } from '@vessel/policy';
import { TeamRuntime } from './TeamRuntime.js';
import { PresetRegistry } from '../presets/registry.js';
import { createDefaultPresetRegistry } from '../presets/defaults.js';
import type { AgentPreset } from '../presets/types.js';
import type { TeamRunSummary } from './types.js';

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cah-team-'));
}

function prov(entries: { when: RegExp | string; text: string }[], model: string): ChatProvider {
  return new MockProvider(
    entries.map((e) => ({ when: e.when, response: { text: e.text } })),
    { model },
  );
}

/** chat() 直接抛错 —— 模拟模型/传输层不可恢复错误。 */
class ThrowingProvider implements ChatProvider {
  readonly id = 'boom';
  constructor(private readonly message: string) {}
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    throw new Error(this.message);
  }
}

/** 事件磁带：按真实到达顺序记录团队相关事件（只观察、不短路决策点）。 */
function tape(bus: EventBus): { events: { name: string; payload: unknown }[] } {
  const events: { name: string; payload: unknown }[] = [];
  for (const name of ['team_start', 'team_phase', 'team_end', 'subagent_start', 'subagent_stop', 'before_turn', 'after_turn', 'after_tool']) {
    bus.on(name, (payload) => {
      events.push({ name, payload });
    }, `tap:${name}`);
  }
  return { events };
}

function sessionLog(workspace: string, sessionId: string): string {
  return fs.readFileSync(path.join(workspace, '.harness', 'sessions', sessionId, 'session.jsonl'), 'utf8');
}

describe('agents/team — TeamRuntime（057）', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = tempDir();
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('显式小阵容（单 developer）：跑一次 top-level 团队会话，事件序 = team_start → team_phase → team_end', async () => {
    const bus = new EventBus();
    const runtime = new TeamRuntime({
      workspaceRoot: workspace,
      providers: { mock: prov([{ when: /.*/, text: 'SMALL-DONE: 修复完成' }], 'mock-model') },
      policyArtifacts: artifacts(),
      tools: [],
      bus,
    });
    const t = tape(bus);

    const summary = await runtime.runTeam({ task: '修复登录 bug', roster: [{ presetId: 'developer', model: 'mock-model', providerId: 'mock' }] });

    expect(summary.outcome).toBe('completed');
    expect(summary.error).toBeUndefined();
    expect(summary.members).toHaveLength(1);
    expect(summary.members[0]).toMatchObject({
      memberId: 'developer',
      phase: 'generate',
      status: 'completed',
      delegationDepth: 0,
    });
    expect(summary.members[0]?.output).toContain('SMALL-DONE');
    expect(summary.members[0]?.sessionId.length).toBeGreaterThan(0);

    const names = t.events.map((e) => e.name);
    expect(names[0]).toBe('team_start');
    expect(names.filter((n) => n === 'team_phase')).toHaveLength(1);
    expect(names[names.length - 1]).toBe('team_end');
    const start = t.events.find((e) => e.name === 'team_start')!.payload as { roster: unknown[] };
    expect(start.roster).toHaveLength(1);
    const phase = t.events.find((e) => e.name === 'team_phase')!.payload as { phase: string; memberId: string; delegateOf?: string };
    expect(phase).toMatchObject({ phase: 'generate', memberId: 'developer' });
    expect(phase.delegateOf).toBeUndefined();

    // 会话/记录可区分成员：session/created source=team + agentPreset=developer
    const log = sessionLog(workspace, summary.members[0]!.sessionId);
    expect(log).toContain('"session/created"');
    expect(log).toContain('"source":"team"');
    expect(log).toContain('"agentPreset":"developer"');
  });

  it('route 中阵容（developer+reviewer）：顺序骨架 gen→eval，developer 产出进入 reviewer prompt（交接），无 delegate', async () => {
    const bus = new EventBus();
    const runtime = new TeamRuntime({
      workspaceRoot: workspace,
      providers: {
        pro: prov([{ when: /.*/, text: 'DEV-7-DONE: 登录接口已实现 + 单测' }], 'pro-model'),
        review: prov([{ when: /DEV-7-DONE/, text: 'REV-MET: 产出覆盖任务要求，验收通过' }], 'review-model'),
      },
      policyArtifacts: artifacts(),
      tools: [],
      bus,
    });
    const t = tape(bus);

    const summary = await runtime.runTeam({
      task: '实现登录接口',
      route: {
        complexity: 'medium',
        roles: ['developer', 'reviewer'],
        roleModels: [
          { role: 'developer', tier: 'pro', providerId: 'pro', model: 'pro-model' },
          { role: 'reviewer', tier: 'review', providerId: 'review', model: 'review-model' },
        ],
      },
    });

    expect(summary.outcome).toBe('completed');
    expect(summary.members.map((m) => m.phase)).toEqual(['generate', 'evaluate']);
    expect(summary.members.map((m) => m.delegationDepth)).toEqual([0, 0]);
    // reviewer 只在 prompt 中出现 developer 产出（DEV-7-DONE）时才应答 REV-MET —— 产出交接被证明
    expect(summary.members[1]?.output).toContain('REV-MET');

    const phases = t.events.filter((e) => e.name === 'team_phase').map((e) => (e.payload as { phase: string }).phase);
    expect(phases).toEqual(['generate', 'evaluate']);
    // 无 lead → 无 delegate 事件
    expect(t.events.some((e) => e.name === 'subagent_start' || e.name === 'subagent_stop')).toBe(false);
    // 两个 top-level 成员各一次完整 turn（before_turn/after_turn 对在 team bus 上）
    expect(t.events.filter((e) => e.name === 'before_turn')).toHaveLength(2);
    expect(t.events.filter((e) => e.name === 'after_turn')).toHaveLength(2);
  });

  it('复杂 route（lead+developer+reviewer）：lead 编排 → developer/reviewer 以真实 delegate 机制作为 lead 的子代理', async () => {
    const bus = new EventBus();
    const runtime = new TeamRuntime({
      workspaceRoot: workspace,
      providers: {
        lead: prov([{ when: /.*/, text: 'PLAN-9: 拆分为登录实现 + 验收；实现交 developer' }], 'lead-model'),
        dev: prov([{ when: /PLAN-9/, text: 'IMPL-9-OK: 已实现登录接口与单测' }], 'dev-model'),
        rev: prov([{ when: /IMPL-9-OK/, text: 'REVIEW-PASS: 产出覆盖任务，未见明显差距' }], 'rev-model'),
      },
      policyArtifacts: artifacts(),
      tools: [],
      bus,
    });
    const t = tape(bus);

    const summary = await runtime.runTeam({
      task: '做一个登录功能',
      route: {
        complexity: 'complex',
        roles: ['lead', 'developer', 'reviewer'],
        roleModels: [
          { role: 'lead', tier: 'pro', providerId: 'lead', model: 'lead-model' },
          { role: 'developer', tier: 'pro', providerId: 'dev', model: 'dev-model' },
          { role: 'reviewer', tier: 'review', providerId: 'rev', model: 'rev-model' },
        ],
      },
    });

    expect(summary.outcome).toBe('completed');
    expect(summary.members).toHaveLength(3);
    const [lead, developer, reviewer] = summary.members as TeamRunSummary['members'];
    expect(lead!.phase).toBe('orchestrate');
    expect(lead!.delegationDepth).toBe(0);
    expect(developer!.phase).toBe('generate');
    expect(reviewer!.phase).toBe('evaluate');
    // lead 计划进入 developer prompt、dev 产出进入 reviewer prompt（各自只应答含上游标记的 prompt）
    expect(developer!.output).toContain('IMPL-9-OK');
    expect(reviewer!.output).toContain('REVIEW-PASS');
    // delegate 关系：developer/reviewer 都是 lead 会话的子代理
    expect(developer!.parentSessionId).toBe(lead!.sessionId);
    expect(reviewer!.parentSessionId).toBe(lead!.sessionId);
    expect(developer!.delegationDepth).toBe(1);
    expect(reviewer!.delegationDepth).toBe(1);
    // 子会话记录可区分：source=subagent + parentSession=lead + agentPreset=developer
    const devLog = sessionLog(workspace, developer!.sessionId);
    expect(devLog).toContain('"source":"subagent"');
    expect(devLog).toContain(`"parentSession":"${lead!.sessionId}"`);
    expect(devLog).toContain('"agentPreset":"developer"');

    // 事件面：3 个 team_phase（developer/reviewer 带 delegateOf=lead）+ 2 对 delegate 事件
    const phases = t.events.filter((e) => e.name === 'team_phase').map((e) => e.payload as { ordinal: number; memberId: string; delegateOf?: string });
    expect(phases.map((p) => p.memberId)).toEqual(['lead', 'developer', 'reviewer']);
    expect(phases[1]?.delegateOf).toBe('lead');
    expect(phases[2]?.delegateOf).toBe('lead');
    expect(phases[0]?.delegateOf).toBeUndefined();
    expect(t.events.filter((e) => e.name === 'subagent_start')).toHaveLength(2);
    expect(t.events.filter((e) => e.name === 'subagent_stop')).toHaveLength(2);
  });

  it('056 AutoTaskRouter 真实产物（AutoRoute）直接喂 runTeam —— 结构兼容、零 agents→llm 源码依赖', async () => {
    const proP = prov([{ when: /编排/, text: 'PLAN-AUTO: 分工方案' }, { when: /.*/, text: 'IMPL-AUTO: 已实现' }], 'pro-model');
    const fastP = prov([{ when: /.*/, text: 'FAST' }], 'fast-model');
    const revP = prov([{ when: /IMPL-AUTO/, text: 'REV-AUTO-MET' }], 'rev-model');
    const router = new AutoTaskRouter({
      providers: { pro: proP, fast: fastP, review: revP },
      bindings: {
        pro: { providerId: 'pro', model: 'pro-model' },
        fast: { providerId: 'fast', model: 'fast-model' },
        review: { providerId: 'review', model: 'rev-model' },
      },
    });
    const route = router.resolve({ category: 'architecture' }); // architecture → complex
    expect(route.roles).toEqual(['lead', 'developer', 'reviewer']);

    const bus = new EventBus();
    const runtime = new TeamRuntime({
      workspaceRoot: workspace,
      providers: { pro: proP, fast: fastP, review: revP },
      policyArtifacts: artifacts(),
      tools: [],
      bus,
    });
    const summary = await runtime.runTeam({ task: '设计系统模块边界', route });
    expect(summary.outcome).toBe('completed');
    expect(summary.members).toHaveLength(3);
    expect(summary.members[0]?.memberId).toBe('lead');
    expect(summary.members[2]?.output).toContain('REV-AUTO-MET');
  });

  it('成员 delegate 失败 → 运行 outcome failed + 中止后续阶段（骨架 fail-fast）', async () => {
    const bus = new EventBus();
    const runtime = new TeamRuntime({
      workspaceRoot: workspace,
      providers: {
        lead: prov([{ when: /.*/, text: 'PLAN-X' }], 'lead-model'),
        dev: new ThrowingProvider('BOOM-dev'),
        rev: prov([{ when: /.*/, text: 'never' }], 'rev-model'),
      },
      policyArtifacts: artifacts(),
      tools: [],
      bus,
    });
    const t = tape(bus);

    const summary = await runtime.runTeam({
      task: '任务',
      route: {
        complexity: 'complex',
        roles: ['lead', 'developer', 'reviewer'],
        roleModels: [
          { role: 'lead', tier: 'pro', providerId: 'lead', model: 'lead-model' },
          { role: 'developer', tier: 'pro', providerId: 'dev', model: 'dev-model' },
          { role: 'reviewer', tier: 'review', providerId: 'rev', model: 'rev-model' },
        ],
      },
    });

    expect(summary.outcome).toBe('failed');
    expect(summary.members).toHaveLength(2); // reviewer 阶段被中止
    expect(summary.members[1]).toMatchObject({ memberId: 'developer', status: 'failed' });
    expect(summary.error).toContain('developer/generate');
    expect(summary.error).toContain('delegate of lead');
    // team_phase 只到 ordinal 2（reviewer 未启动）
    const ordinals = t.events.filter((e) => e.name === 'team_phase').map((e) => (e.payload as { ordinal: number }).ordinal);
    expect(ordinals).toEqual([1, 2]);
    const end = t.events.find((e) => e.name === 'team_end')!.payload as { outcome: string };
    expect(end.outcome).toBe('failed');
  });

  it('before_delegate deny（A22 服务端裁决）→ delegate 成员被拒，运行按失败收尾', async () => {
    const bus = new EventBus();
    bus.on('before_delegate', () => ({ kind: 'deny' as const, reason: 'no delegation in this test' }));
    const runtime = new TeamRuntime({
      workspaceRoot: workspace,
      providers: {
        lead: prov([{ when: /.*/, text: 'PLAN' }], 'lead-model'),
        dev: prov([{ when: /.*/, text: 'IMPL' }], 'dev-model'),
      },
      policyArtifacts: artifacts(),
      tools: [],
      bus,
    });
    const summary = await runtime.runTeam({
      task: '任务',
      route: {
        roles: ['lead', 'developer'],
        roleModels: [
          { role: 'lead', tier: 'pro', providerId: 'lead', model: 'lead-model' },
          { role: 'developer', tier: 'pro', providerId: 'dev', model: 'dev-model' },
        ],
      },
    });
    expect(summary.outcome).toBe('failed');
    expect(summary.members[1]).toMatchObject({ memberId: 'developer', status: 'failed', stopReason: 'denied' });
    expect(summary.error).toContain('denied');
  });

  it('结构性错误在任何事件发出前 fail loud（不抛 team 事件）', async () => {
    const bus = new EventBus();
    const runtime = new TeamRuntime({
      workspaceRoot: workspace,
      providers: { mock: prov([{ when: /.*/, text: 'x' }], 'm') },
      policyArtifacts: artifacts(),
      tools: [],
      bus,
    });
    const t = tape(bus);
    const run = (req: Parameters<TeamRuntime['runTeam']>[0]) => runtime.runTeam(req);

    await expect(run({ task: '  ', roster: [{ presetId: 'developer', model: 'm', providerId: 'mock' }] })).rejects.toThrow(/task is required/);
    await expect(
      run({
        task: 'x',
        roster: [{ presetId: 'developer', model: 'm', providerId: 'mock' }],
        route: { roles: ['developer'], roleModels: [{ model: 'm', providerId: 'mock' }] },
      }),
    ).rejects.toThrow(/exactly one of roster \| route/);
    await expect(run({ task: 'x', roster: [{ presetId: 'ghost', model: 'm', providerId: 'mock' }] })).rejects.toThrow(/unknown agent preset "ghost"/);
    await expect(run({ task: 'x', roster: [{ presetId: 'developer', model: 'm', providerId: 'nope' }] })).rejects.toThrow(/not bound/);
    await expect(run({ task: 'x', roster: [] })).rejects.toThrow(/roster is empty/);
    expect(t.events.filter((e) => e.name === 'team_start')).toHaveLength(0);
    expect(t.events.filter((e) => e.name === 'team_end')).toHaveLength(0);
  });

  // ---- task 058: Internal Reviewer 真流程集成 ----

  it('058 e2e：mock generator 产出 → reviewer 判 not_met → 结构化结论附 evaluate 成员（反馈可回读）', async () => {
    const bus = new EventBus();
    const runtime = new TeamRuntime({
      workspaceRoot: workspace,
      providers: {
        pro: prov([{ when: /.*/, text: 'IMPL-7-DONE: 已实现登录接口（改动 src/login.ts），单测 2/2' }], 'pro-model'),
        review: prov(
          [{ when: /IMPL-7-DONE/, text: '{"verdict":"not_met","unmet":["错误路径未覆盖"],"suggestions":["补 401/500 分支用例"],"reason":"验收标准 2 未满足","evidence":["tests/login.test.ts"]}' }],
          'review-model',
        ),
      },
      policyArtifacts: artifacts(),
      tools: [],
      bus,
    });

    const summary = await runtime.runTeam({
      task: '实现登录接口',
      acceptance: ['登录成功分支', '错误路径覆盖'],
      route: {
        complexity: 'medium',
        roles: ['developer', 'reviewer'],
        roleModels: [
          { role: 'developer', tier: 'pro', providerId: 'pro', model: 'pro-model' },
          { role: 'reviewer', tier: 'review', providerId: 'review', model: 'review-model' },
        ],
      },
    });

    // not_met 是评审结论不是运行失败 —— run 仍 completed，结论在 evaluate 成员上
    expect(summary.outcome).toBe('completed');
    expect(summary.error).toBeUndefined();
    const reviewer = summary.members[1]!;
    expect(reviewer.phase).toBe('evaluate');
    expect(reviewer.status).toBe('completed');
    expect(reviewer.review).toBeDefined();
    expect(reviewer.review!.verdict).toBe('not_met');
    expect(reviewer.review!.unmet).toEqual(['错误路径未覆盖']);
    expect(reviewer.review!.suggestions).toEqual(['补 401/500 分支用例']);
    expect(reviewer.review!.reason).toBe('验收标准 2 未满足');
    // 反馈可回读：结构化 review + 原始产出文本都在
    expect(reviewer.output).toContain('not_met');
    expect(reviewer.review!.evidence).toEqual(['tests/login.test.ts']);
  });

  it('058：reviewer 判 met → review.verdict met；无验收标准时提示不阻塞', async () => {
    const bus = new EventBus();
    const runtime = new TeamRuntime({
      workspaceRoot: workspace,
      providers: {
        pro: prov([{ when: /.*/, text: 'IMPL-8-DONE: 完成' }], 'pro-model'),
        review: prov(
          [{ when: /IMPL-8-DONE/, text: '{"verdict":"met","unmet":[],"suggestions":[],"reason":"符合验收","evidence":[]}' }],
          'review-model',
        ),
      },
      policyArtifacts: artifacts(),
      tools: [],
      bus,
    });

    const summary = await runtime.runTeam({
      task: '做一个导出',
      roster: [
        { memberId: 'developer', presetId: 'developer', model: 'pro-model', providerId: 'pro' },
        { memberId: 'reviewer', presetId: 'reviewer', model: 'review-model', providerId: 'review' },
      ],
    });
    expect(summary.outcome).toBe('completed');
    expect(summary.members[1]?.review?.verdict).toBe('met');
    expect(summary.members[1]?.review?.suggestions).toEqual([]);
  });

  it('058 异常路径：reviewer 产出非 JSON → review.verdict error（如实暴露、运行不崩）', async () => {
    const bus = new EventBus();
    const runtime = new TeamRuntime({
      workspaceRoot: workspace,
      providers: {
        pro: prov([{ when: /.*/, text: 'IMPL-9-DONE: 实现完成' }], 'pro-model'),
        review: prov([{ when: /IMPL-9-DONE/, text: '评审结论：实现完成，无测试证据' }], 'review-model'),
      },
      policyArtifacts: artifacts(),
      tools: [],
      bus,
    });
    const summary = await runtime.runTeam({
      task: '实现 X',
      roster: [
        { memberId: 'developer', presetId: 'developer', model: 'pro-model', providerId: 'pro' },
        { memberId: 'reviewer', presetId: 'reviewer', model: 'review-model', providerId: 'review' },
      ],
    });
    expect(summary.outcome).toBe('completed');
    expect(summary.members[1]?.review?.verdict).toBe('error');
    expect(summary.members[1]?.review?.reason).toContain('not a valid');
  });

  it('058 复杂阵容 delegate：reviewer 结论同样解析到 delegate 成员摘要（review.verdict not_met）', async () => {
    const bus = new EventBus();
    const runtime = new TeamRuntime({
      workspaceRoot: workspace,
      providers: {
        lead: prov([{ when: /.*/, text: 'PLAN-58: 分工方案' }], 'lead-model'),
        dev: prov([{ when: /PLAN-58/, text: 'IMPL-58-OK: 已实现（改动 src/a.ts）' }], 'dev-model'),
        rev: prov(
          [{ when: /IMPL-58-OK/, text: '{"verdict":"not_met","unmet":["a.ts 缺导出"],"suggestions":["补导出"],"reason":"AC-1 不满足","evidence":["src/a.ts"]}' }],
          'rev-model',
        ),
      },
      policyArtifacts: artifacts(),
      tools: [],
      bus,
    });

    const summary = await runtime.runTeam({
      task: '复杂任务',
      acceptance: ['AC-1: a.ts 导出 api', 'AC-2: 测试通过'],
      route: {
        complexity: 'complex',
        roles: ['lead', 'developer', 'reviewer'],
        roleModels: [
          { role: 'lead', tier: 'pro', providerId: 'lead', model: 'lead-model' },
          { role: 'developer', tier: 'pro', providerId: 'dev', model: 'dev-model' },
          { role: 'reviewer', tier: 'review', providerId: 'rev', model: 'rev-model' },
        ],
      },
    });
    expect(summary.outcome).toBe('completed');
    const reviewer = summary.members[2]!;
    expect(reviewer.phase).toBe('evaluate');
    expect(reviewer.delegationDepth).toBe(1);
    expect(reviewer.review?.verdict).toBe('not_met');
    expect(reviewer.review?.unmet).toEqual(['a.ts 缺导出']);
    expect(reviewer.review?.suggestions).toEqual(['补导出']);
  });

  it('BRIEF：delegate 阶段的 preset 在委派时已不可解析 → 拒绝并让运行失败（fail-closed），绝不退化为全量工具面', async () => {
    // 模拟「roster 校验之后，真正委派时该 preset 已不在这个环境的 registry 里」——
    // 同一 id 的第二次解析失败（首解析=resolveRoster 校验）。旧实现（hasPreset ? getPreset : undefined）
    // 会把这次未命中折叠成 undefined ⇒ 跳过收窄 ⇒ developer 子代理拿到父代理全量面（含 Write）。
    class DelegateTimeMissRegistry extends PresetRegistry {
      private readonly resolutions = new Map<string, number>();
      override getPreset(id: string): AgentPreset {
        const n = (this.resolutions.get(id) ?? 0) + 1;
        this.resolutions.set(id, n);
        if (n > 1) throw new Error(`preset "${id}" 已从该环境移除（模拟运行期未注册）`);
        return super.getPreset(id);
      }
      override hasPreset(id: string): boolean {
        // 首次解析后（roster 校验用过一次）即视为「这个环境没有它」
        return (this.resolutions.get(id) ?? 0) < 1 && super.hasPreset(id);
      }
    }
    const registry = new DelegateTimeMissRegistry(createDefaultPresetRegistry().listPresets());
    const writeTool: ToolSpec = {
      name: 'Write',
      description: 'write a file',
      family: 'file_write',
      requiredPermission: 'workspace-write',
      exclusive: true,
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      async execute(args, ctx) {
        fs.writeFileSync(path.join(ctx.workspaceRoot, String(args.path ?? 'out.txt')), String(args.content ?? ''), 'utf8');
        return { content: 'wrote', meta: {} };
      },
    };
    const bus = new EventBus();
    const runtime = new TeamRuntime({
      workspaceRoot: workspace,
      providers: {
        lead: prov([{ when: /.*/, text: 'PLAN-MISS' }], 'lead-model'),
        dev: new MockProvider(
          [
            { when: /PLAN-MISS/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Write', arguments: { path: 'forbidden.txt', content: 'X' } }] } },
            { when: /.*/, minToolResults: 1, response: { text: 'IMPL-MISS' } },
          ],
          { model: 'dev-model' },
        ),
      },
      policyArtifacts: artifacts(),
      tools: [writeTool],
      presetRegistry: registry,
      bus,
    });

    const summary = await runtime.runTeam({
      task: '任务',
      // 显式阵容（route 路径会额外解析一次 preset，本用例要的是「校验通过、委派时失配」）
      roster: [
        { presetId: 'lead', model: 'lead-model', providerId: 'lead' },
        { presetId: 'developer', model: 'dev-model', providerId: 'dev' },
      ],
    });

    expect(summary.outcome).toBe('failed');
    expect(summary.members[1]).toMatchObject({ memberId: 'developer', status: 'failed', stopReason: 'denied' });
    // 拒绝发生在子会话构造之前：没有 child session，也没有任何工具落地（旧实现这里会真写盘）
    expect(summary.members[1]?.sessionId).toBe('');
    expect(summary.error).toContain('denied');
    expect(fs.existsSync(path.join(workspace, 'forbidden.txt'))).toBe(false);
  });

  it('058：reviewer 会话可区分（evaluate 成员 B10 agentPreset=reviewer 且 review 结论上团队总线事件）', async () => {
    const bus = new EventBus();
    const runtime = new TeamRuntime({
      workspaceRoot: workspace,
      providers: {
        pro: prov([{ when: /.*/, text: 'IMPL-10-DONE: ok' }], 'pro-model'),
        review: prov(
          [{ when: /IMPL-10-DONE/, text: '{"verdict":"not_met","unmet":["缺证据"],"suggestions":[],"reason":"r","evidence":[]}' }],
          'review-model',
        ),
      },
      policyArtifacts: artifacts(),
      tools: [],
      bus,
    });
    const summary = await runtime.runTeam({
      task: '任务',
      roster: [
        { memberId: 'developer', presetId: 'developer', model: 'pro-model', providerId: 'pro' },
        { memberId: 'reviewer', presetId: 'reviewer', model: 'review-model', providerId: 'review' },
      ],
    });
    const rev = summary.members[1]!;
    // 成员会话记录 source=team + agentPreset=reviewer
    const log = sessionLog(workspace, rev.sessionId);
    expect(log).toContain('"source":"team"');
    expect(log).toContain('"agentPreset":"reviewer"');
    // team_end 成员摘要带结构化 review（投影消费面）
    expect(rev.review?.verdict).toBe('not_met');
  });
});
