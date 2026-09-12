import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '@vessel/core';
import { MockProvider } from '@vessel/llm';
import { compilePolicyYaml } from '@vessel/policy';
import { EvaluatorAgent, createReadOnlyExplorationTools } from '@vessel/agents';
import type {
  ChatProvider,
  PolicyArtifacts,
  SubagentStartPayload,
  SubagentStopPayload,
  TeamEndPayload,
  TeamMemberSummary,
  TeamPhasePayload,
  TeamStartPayload,
} from '@vessel/shared';
import { TeamProjection } from './TeamProjection.js';

function startPayload(over: Partial<TeamStartPayload> = {}): TeamStartPayload {
  return {
    teamRunId: 'run-1',
    task: '做一个登录功能',
    roster: [
      { memberId: 'developer', presetId: 'developer', role: 'generator', model: 'm', providerId: 'p' },
      { memberId: 'reviewer', presetId: 'reviewer', role: 'evaluator', model: 'm', providerId: 'p' },
    ],
    ...over,
  };
}

function phasePayload(over: Partial<TeamPhasePayload> & { ordinal: number }): TeamPhasePayload {
  return {
    teamRunId: 'run-1',
    memberId: 'developer',
    presetId: 'developer',
    role: 'generator',
    phase: 'generate',
    ...over,
  };
}

function memberSummary(over: Partial<TeamMemberSummary> & { memberId: string; phase: TeamMemberSummary['phase'] }): TeamMemberSummary {
  return {
    presetId: over.memberId,
    role: 'generator',
    status: 'completed',
    sessionId: `sess-${over.memberId}`,
    delegationDepth: 0,
    durationMs: 10,
    output: `OUT-${over.memberId}`,
    ...over,
  };
}

function endPayload(over: Partial<TeamEndPayload> = {}): TeamEndPayload {
  return {
    teamRunId: 'run-1',
    outcome: 'completed',
    members: [
      memberSummary({ memberId: 'developer', phase: 'generate', output: 'DEV-OUT: login implemented' }),
      memberSummary({ memberId: 'reviewer', phase: 'evaluate', role: 'evaluator', output: 'REV-MET: passes' }),
    ],
    durationMs: 42,
    ...over,
  };
}

describe('TeamProjection（057）', () => {
  it('未开始任何运行时 state() 为 null；team_start 后呈现 run + roster，status running', async () => {
    const bus = new EventBus();
    const projection = new TeamProjection();
    const detach = projection.attach(bus);
    expect(projection.state()).toBeNull();

    await bus.emit('team_start', startPayload({ complexity: 'medium' }));
    const state = projection.state();
    expect(state).not.toBeNull();
    expect(state?.runId).toBe('run-1');
    expect(state?.status).toBe('running');
    expect(state?.complexity).toBe('medium');
    expect(state?.roster.map((m) => m.memberId)).toEqual(['developer', 'reviewer']);
    detach();
  });

  it('中阵容事件流：team_phase 归属成员回合（before_turn/after_turn），team_end 闭合阶段行与产出', async () => {
    const bus = new EventBus();
    const projection = new TeamProjection();
    const detach = projection.attach(bus);

    await bus.emit('team_start', startPayload());
    await bus.emit('team_phase', phasePayload({ ordinal: 1, phase: 'generate', memberId: 'developer', promptPreview: '开发' }));
    await bus.emit('before_turn', { turnId: 't1', input: '实现登录接口' });
    await bus.emit('after_turn', { turnId: 't1', kind: 'success' });
    await bus.emit('team_phase', phasePayload({ ordinal: 2, phase: 'evaluate', memberId: 'reviewer', presetId: 'reviewer', role: 'evaluator' }));
    await bus.emit('before_turn', { turnId: 't2', input: '评估产出' });
    await bus.emit('after_turn', { turnId: 't2', kind: 'success' });
    await bus.emit('team_end', endPayload());

    const state = projection.state()!;
    expect(state.status).toBe('done');
    expect(state.outcome).toBe('completed');
    expect(state.durationMs).toBe(42);
    // 阶段行：generate 在下一 phase 到来时 closed（completed），evaluate 由 team_end 闭合，产出预览入行
    expect(state.phases.map((p) => p.memberId)).toEqual(['developer', 'reviewer']);
    expect(state.phases[0]).toMatchObject({ phase: 'generate', status: 'completed' });
    expect(state.phases[1]).toMatchObject({ phase: 'evaluate', status: 'completed', outputPreview: expect.stringContaining('REV-MET') });
    expect(state.phases[0]?.promptPreview).toBe('开发');
    // 成员回合按当前阶段归属
    expect(state.turns).toHaveLength(2);
    expect(state.turns[0]).toMatchObject({ memberId: 'developer', phase: 'generate', turnId: 't1', kind: 'success' });
    expect(state.turns[1]).toMatchObject({ memberId: 'reviewer', phase: 'evaluate', turnId: 't2', kind: 'success' });
    expect(state.turns[1]?.promptPreview).toBe('评估产出');
    detach();
  });

  it('复杂阵容：delegate 关系行（subagent_start/stop，父=team_phase.delegateOf）', async () => {
    const bus = new EventBus();
    const projection = new TeamProjection();
    const detach = projection.attach(bus);

    await bus.emit('team_start', startPayload());
    await bus.emit('team_phase', phasePayload({ ordinal: 1, phase: 'orchestrate', memberId: 'lead', presetId: 'lead', role: 'orchestrator' }));
    await bus.emit('team_phase', phasePayload({ ordinal: 2, phase: 'generate', memberId: 'developer', delegateOf: 'lead' }));
    await bus.emit('subagent_start', { delegateId: 'del-1', childAgentId: 'agent-c1', childSessionId: 'sess-dev', preset: 'developer' });
    await bus.emit('subagent_stop', {
      delegateId: 'del-1',
      childAgentId: 'agent-c1',
      childSessionId: 'sess-dev',
      result: { output: 'DEV-OUT: implemented', stopReason: 'completed' },
      isError: false,
      durationMs: 20,
      delegationDepth: 1,
    });
    await bus.emit('team_phase', phasePayload({ ordinal: 3, phase: 'evaluate', memberId: 'reviewer', presetId: 'reviewer', role: 'evaluator', delegateOf: 'lead' }));
    await bus.emit('subagent_start', { delegateId: 'del-2', childAgentId: 'agent-c2', childSessionId: 'sess-rev', preset: 'reviewer' });
    await bus.emit('subagent_stop', {
      delegateId: 'del-2',
      childAgentId: 'agent-c2',
      childSessionId: 'sess-rev',
      result: { output: 'REV: met', stopReason: 'completed' },
      isError: false,
      durationMs: 10,
      delegationDepth: 1,
    });
    await bus.emit('team_end', endPayload());

    const state = projection.state()!;
    expect(state.delegates).toHaveLength(2);
    expect(state.delegates[0]).toMatchObject({
      delegateId: 'del-1',
      parentMemberId: 'lead', // team_phase.delegateOf → 父成员
      childSessionId: 'sess-dev',
      preset: 'developer',
      status: 'done',
      stopReason: 'completed',
      isError: false,
    });
    expect(state.delegates[1]?.outputPreview).toContain('REV');
    expect(state.delegates[1]?.parentMemberId).toBe('lead');
    // delegate 阶段无 before_turn（子会话内部信息隐藏）→ 无 member turn 行
    expect(state.turns).toHaveLength(0);
    detach();
  });

  it('成员失败：team_end outcome=failed 时失败阶段行落 failed、未启动阶段无行、error 透传', async () => {
    const bus = new EventBus();
    const projection = new TeamProjection();
    const detach = projection.attach(bus);

    await bus.emit('team_start', startPayload());
    await bus.emit('team_phase', phasePayload({ ordinal: 1, phase: 'generate', memberId: 'developer' }));
    await bus.emit('before_turn', { turnId: 't1', input: 'x' });
    await bus.emit('after_turn', { turnId: 't1', kind: 'error' });
    await bus.emit('team_end', endPayload({ outcome: 'failed', members: [memberSummary({ memberId: 'developer', phase: 'generate', status: 'failed', stopReason: 'error' })], error: 'phase 1 (developer/generate) failed: error' }));

    const state = projection.state()!;
    expect(state.status).toBe('done');
    expect(state.outcome).toBe('failed');
    expect(state.error).toContain('developer/generate');
    expect(state.phases).toHaveLength(1); // 后续 reviewer 阶段从未 team_phase → 无行
    expect(state.phases[0]).toMatchObject({ status: 'failed', stopReason: 'error' });
    expect(state.turns[0]?.kind).toBe('error');
    detach();
  });

  it('工具活动按当前成员归属（after_tool：DENIED→denied / 其他错误→error / 正常→done）', async () => {
    const bus = new EventBus();
    const projection = new TeamProjection();
    const detach = projection.attach(bus);

    await bus.emit('team_start', startPayload());
    await bus.emit('team_phase', phasePayload({ ordinal: 1, phase: 'generate', memberId: 'developer' }));
    await bus.emit('after_tool', { toolName: 'Read', result: { content: 'data' } });
    await bus.emit('after_tool', { toolName: 'Shell', result: { error: { errorClass: 'DENIED', message: 'no' } } });
    await bus.emit('team_phase', phasePayload({ ordinal: 2, phase: 'evaluate', memberId: 'reviewer', presetId: 'reviewer', role: 'evaluator' }));
    await bus.emit('after_tool', { toolName: 'Grep', result: { error: { errorClass: 'TOOL_FAILURE' } } });
    await bus.emit('team_end', endPayload());

    const state = projection.state()!;
    expect(state.toolActivities).toHaveLength(3);
    expect(state.toolActivities[0]).toMatchObject({ memberId: 'developer', toolName: 'Read', status: 'done' });
    expect(state.toolActivities[1]).toMatchObject({ memberId: 'developer', toolName: 'Shell', status: 'denied' });
    expect(state.toolActivities[2]).toMatchObject({ memberId: 'reviewer', toolName: 'Grep', status: 'error' });
    detach();
  });

  it('058：evaluate 成员的结构化 review 结论上阶段行（评审结论可直接读，不需解析文本）', async () => {
    const bus = new EventBus();
    const projection = new TeamProjection();
    const detach = projection.attach(bus);

    await bus.emit('team_start', startPayload());
    await bus.emit('team_phase', phasePayload({ ordinal: 1, phase: 'generate', memberId: 'developer' }));
    await bus.emit('team_phase', phasePayload({ ordinal: 2, phase: 'evaluate', memberId: 'reviewer', presetId: 'reviewer', role: 'evaluator' }));
    await bus.emit('team_end', endPayload({
      members: [
        memberSummary({ memberId: 'developer', phase: 'generate', output: 'DEV-OUT' }),
        memberSummary({
          memberId: 'reviewer',
          phase: 'evaluate',
          role: 'evaluator',
          output: '{"verdict":"not_met","unmet":["AC-1 未满足"],"suggestions":["补实现"],"reason":"差距","evidence":["src/a.ts"]}',
          review: {
            verdict: 'not_met',
            unmet: ['AC-1 未满足'],
            suggestions: ['补实现'],
            reason: '差距',
            evidence: ['src/a.ts'],
          },
        }),
      ],
    }));

    const state = projection.state()!;
    const revRow = state.phases[1]!;
    expect(revRow.review).toBeDefined();
    expect(revRow.review).toMatchObject({
      verdict: 'not_met',
      unmet: ['AC-1 未满足'],
      suggestions: ['补实现'],
    });
    expect(revRow.outputPreview).toContain('"verdict":"not_met"');
    detach();
  });

  it('detach 后不再接收事件；第二次 team_start 重置旧 run 状态', async () => {
    const bus = new EventBus();
    const projection = new TeamProjection();
    const detach = projection.attach(bus);

    await bus.emit('team_start', startPayload());
    await bus.emit('team_end', endPayload());
    expect(projection.state()?.runId).toBe('run-1');

    detach();
    await bus.emit('team_start', startPayload({ teamRunId: 'run-2' }));
    // detached → 不重建 state（仍为 run-1 的 done 快照…… 见断言）
    expect(projection.state()).not.toBeNull();

    const projection2 = new TeamProjection();
    projection2.attach(bus);
    await bus.emit('team_start', startPayload({ teamRunId: 'run-3' }));
    await bus.emit('team_end', endPayload({ teamRunId: 'run-3' }));
    expect(projection2.state()?.runId).toBe('run-3');
    expect(projection2.state()?.roster).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// BRIEF — evaluator 镜像事件（A23/A24）× **真实 TeamProjection** 的端到端配对
//
// 背景：`EvaluatorAgent.evaluate()` 在**父 bus** 上镜像 subagent_start / subagent_stop
// （EvaluatorAgent.ts:240-249 / :253-271）。旧实现两处各自现算 delegateId —— start 带
// `_<hex>` 后缀、stop 不带 —— 按构造永不相等，于是 TeamProjection.onSubagentStop 按 id
// 反查不到 start 建的那一行，直接 `return`（TeamProjection.ts:198-199）**静默丢弃**：
// 该行永远停在 'running'，stopReason / isError / durationMs / outputPreview 一概不写。
//
// 上一张卡（packages/agents/src/evaluator/evaluator-agent.test.ts 的 mirrorDelegateRows）
// 只能在 agents 包内**镜像**那一行 find + return，因为依赖方向是 application → agents
// （packages/application/package.json:29），在 agents 里 import application 会造反向边。
// 所以「真实投影能不能收到 evaluator 的 stop」直到这里才有端到端证据。
//
// 装配形状与生产一致（apps/local-server/src/teamSeam.ts:217-228：同一个 bus 上先
// `new TeamProjection().attach(bus)`，再把该 bus 交给运行体成员；生产消费方
// InternalReviewer → EvaluatorAgent 同样把 bus 透传，packages/agents/src/reviewer/InternalReviewer.ts:113）：
//   const bus = new EventBus();
//   const projection = new TeamProjection();
//   projection.attach(bus);
//   await bus.emit('team_start', …);                          // TeamProjection.ts:180 要求 run 非空，否则 start 行不建
//   await bus.emit('team_phase', { …, delegateOf: 'lead' });  // 阶段窗口 = delegate 行归属锚点
//   await new EvaluatorAgent({ …, bus }).evaluate({ … });     // 真实 A23/A24 镜像事件落进同一个 bus
// ---------------------------------------------------------------------------

const EVAL_POLICY_YAML = `
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
`;

/** 只读探索面 + denyRead：读 secret/** 必被 fs 守卫判 DENIED（guards.ts:281-284 → fsTools.ts:47）。 */
const EVAL_DENY_READ_POLICY = { protected: ['.git', '.git/**'], denyRead: ['secret/**'], allow: [] };

/** AgentLoop 熔断文案（AgentLoop.ts:794 `same intent denied ${n} times: ${toolName}`，n=3）。 */
const EVAL_BREAKER_TEXT = 'same intent denied 3 times: Read';

function evalArtifacts(): PolicyArtifacts {
  return compilePolicyYaml(EVAL_POLICY_YAML);
}

/** 每个用例自建的临时 workspace（os.tmpdir() 之下 —— 按项目铁律由本用例自行清理）。 */
function evalTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cah-team-proj-eval-'));
}

/** kind='success' 的评审回合：模型直接给一行合法 verdict JSON（无工具调用）。 */
function verdictProvider(verdictJson: string): ChatProvider {
  return new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: verdictJson } }], { model: 'eval-model' });
}

/**
 * kind='error' 的评审回合（沿用 evaluator-agent.test.ts 的既有装置）：每次调用都请求**同一个**
 * denyRead 路径 ⇒ 连续三次工具层 DENIED ⇒ 第 3 次抛 DenialLimitError ⇒ AgentLoop **正常返回**
 * kind='error'、finalText=熔断文案（AgentLoop.ts:334-338）。这正是"评审没跑完"的那条真实路径。
 */
function breakingProvider(): ChatProvider {
  return new MockProvider(
    [{ when: /.*/, response: { toolCalls: [{ name: 'Read', arguments: { path: 'secret/x.txt' } }] } }],
    { model: 'eval-model' },
  );
}

/** A23 镜像载荷采集（packages/shared/src/events.ts:239-246）。 */
function collectDelegateStarts(bus: EventBus): SubagentStartPayload[] {
  const starts: SubagentStartPayload[] = [];
  bus.on('subagent_start', (p) => {
    starts.push(p as SubagentStartPayload);
  });
  return starts;
}

/** A24 镜像载荷采集（packages/shared/src/events.ts:249-257）。 */
function collectDelegateStops(bus: EventBus): SubagentStopPayload[] {
  const stops: SubagentStopPayload[] = [];
  bus.on('subagent_stop', (p) => {
    stops.push(p as SubagentStopPayload);
  });
  return stops;
}

interface EvaluatorOnProjectionRun {
  projection: TeamProjection;
  starts: SubagentStartPayload[];
  stops: SubagentStopPayload[];
  /** 每次 subagent_start 处理完后立刻取的投影快照：证明那一行**先以 'running' 建出来**（不是根本没有行） */
  snapshotsAtStart: { delegateId: string; status: 'running' | 'done' }[][];
}

/**
 * 把一次真实 EvaluatorAgent 评审接到**真实** TeamProjection 上（生产接线形状，见本节头注释）。
 * 用例只提供"评审回合怎么跑"（provider / 工具面），bus + 投影 + team_start/team_phase 三者
 * 的装配全仓只有这一份，三条用例共用，避免出现第二套装配。
 */
async function runEvaluatorOnProjection(opts: {
  workspace: string;
  makeAgent: (bus: EventBus, workspace: string) => EvaluatorAgent;
}): Promise<EvaluatorOnProjectionRun> {
  const bus = new EventBus();
  const projection = new TeamProjection();
  projection.attach(bus);

  const snapshotsAtStart: { delegateId: string; status: 'running' | 'done' }[][] = [];
  // 注册在投影之后 ⇒ 运行顺序也在投影的 onSubagentStart 之后（EventBus.emit 按注册顺序 await）
  bus.on('subagent_start', () => {
    snapshotsAtStart.push((projection.state()?.delegates ?? []).map((d) => ({ delegateId: d.delegateId, status: d.status })));
  });
  const starts = collectDelegateStarts(bus);
  const stops = collectDelegateStops(bus);

  await bus.emit('team_start', startPayload());
  // 评审阶段窗口：evaluator 角色、delegateOf=lead（与既有「复杂阵容」用例同一形状）
  await bus.emit(
    'team_phase',
    phasePayload({ ordinal: 1, phase: 'evaluate', memberId: 'reviewer', presetId: 'reviewer', role: 'evaluator', delegateOf: 'lead' }),
  );
  await opts.makeAgent(bus, opts.workspace).evaluate({
    goal: '实现导出功能',
    generatorOutput: '已完成（自证无效）',
    acceptance: ['AC-1: 导出 run'],
  });

  return { projection, starts, stops, snapshotsAtStart };
}

/** 只读探索面 + denyRead 的熔断评审装置（复用 evaluator-agent.test.ts 的 breakingAgent 构造）。 */
function breakingEvaluator(bus: EventBus, workspace: string): EvaluatorAgent {
  fs.mkdirSync(path.join(workspace, 'secret'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'secret', 'x.txt'), 'CLASSIFIED', 'utf8');
  return new EvaluatorAgent({
    workspaceRoot: workspace,
    provider: breakingProvider(),
    model: 'eval-model',
    policyArtifacts: evalArtifacts(),
    tools: createReadOnlyExplorationTools(workspace, EVAL_DENY_READ_POLICY),
    bus,
  });
}

/** 成功评审装置（默认只读探索面，无 denyRead）。 */
function succeedingEvaluator(bus: EventBus, workspace: string, verdictJson: string): EvaluatorAgent {
  return new EvaluatorAgent({
    workspaceRoot: workspace,
    provider: verdictProvider(verdictJson),
    model: 'eval-model',
    policyArtifacts: evalArtifacts(),
    bus,
  });
}

/**
 * 端到端配对：evaluator 的 A23/A24 落到**真实投影**的同一行。
 *
 * 判别性（删哪行/回退哪次修复会红）：把 `EvaluatorAgent.evaluate()` 顶部那次
 * `const delegateId = ...` 拆回"两处各自现算"（start 带 `_<hex>`、stop 不带）⇒ stop 在
 * `TeamProjection.ts:198` 反查不到行 ⇒ `:199` return ⇒ 以下断言全红（那一行停在 'running'）。
 */
describe('BRIEF — 真实 TeamProjection 收到 evaluator 的 stop（旧实现 delegateId 不配对 ⇒ 行停在 running）', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = evalTempDir();
  });
  afterEach(() => {
    // 本用例自建、位于 os.tmpdir() 之下 —— AGENTS.md 书面例外允许用 Node 删除 API 清理
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('① 熔断回合（kind=error）：投影那一行由 running 落定为 done，start/stop 的 delegateId 成对', async () => {
    const run = await runEvaluatorOnProjection({
      workspace,
      makeAgent: (bus, ws) => breakingEvaluator(bus, ws),
    });

    expect(run.starts).toHaveLength(1);
    expect(run.stops).toHaveLength(1);
    const startId = run.starts[0]!.delegateId;

    // 删掉 evaluate() 里 `const delegateId = …` 的单次生成（改回两处各自现算）⇒ 此处红
    expect(run.stops[0]!.delegateId).toBe(startId);

    // 投影以 start 的 delegateId 建行，且当时确为 'running'（排除"根本没有这一行"的假绿）
    expect(run.snapshotsAtStart).toEqual([[{ delegateId: startId, status: 'running' }]]);

    // 真投影按**同一个** delegateId 反查（TeamProjection.ts:198）：旧实现查不到 ⇒ 这一行仍是 'running'
    const delegates = run.projection.state()!.delegates;
    expect(delegates).toHaveLength(1);
    expect(delegates.find((d) => d.delegateId === startId)).toMatchObject({
      delegateId: startId,
      parentMemberId: 'lead', // team_phase.delegateOf → 父成员（TeamProjection.ts:184）
      preset: 'evaluator',
      status: 'done', // 旧实现：'running'
      stopReason: 'error',
      isError: true,
    });
  });

  it('② kind=error 的评审回合：stopReason（非 completed）/isError/durationMs/产出预览都真的到达投影那一行', async () => {
    const run = await runEvaluatorOnProjection({
      workspace,
      makeAgent: (bus, ws) => breakingEvaluator(bus, ws),
    });
    const startId = run.starts[0]!.delegateId;
    const row = run.projection.state()!.delegates.find((d) => d.delegateId === startId);

    // 这里正是「刚修好的 stopReason 现在真的能到达投影」的证据：旧实现 :199 就 return，
    // 下列字段（连同 durationMs / outputPreview）全部静默丢失。
    expect(row).toBeDefined();
    expect(row!.stopReason).not.toBe('completed');
    expect(row!.stopReason).toBe(run.stops[0]!.result.stopReason);
    expect(row!.stopReason).toBe('error');
    expect(row!.isError).toBe(true);
    expect(row!.isError).toBe(run.stops[0]!.isError);
    expect(row!.durationMs).toBe(run.stops[0]!.durationMs);
    expect(row!.outputPreview).toContain(EVAL_BREAKER_TEXT);
  });

  it('③ 负对照：kind=success 的评审回合 ⇒ 投影行 status 终态、stopReason=completed、isError=false', async () => {
    const VERDICT_JSON = '{"verdict":"not_met","evidence":["src/fee.js 缺少 computeFee"],"reason":"产物不存在"}';
    const run = await runEvaluatorOnProjection({
      workspace,
      makeAgent: (bus, ws) => succeedingEvaluator(bus, ws, VERDICT_JSON),
    });
    const startId = run.starts[0]!.delegateId;

    expect(run.snapshotsAtStart).toEqual([[{ delegateId: startId, status: 'running' }]]);
    const row = run.projection.state()!.delegates.find((d) => d.delegateId === startId);
    expect(row).toMatchObject({
      delegateId: startId,
      status: 'done',
      stopReason: 'completed',
      isError: false,
    });
    // 产出预览也随 stop 落进同一行（旧实现同样丢失）
    expect(row!.outputPreview).toContain(VERDICT_JSON);
  });
});
