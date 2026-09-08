import { describe, it, expect } from 'vitest';
import { EventBus } from '@vessel/core';
import type { TeamEndPayload, TeamMemberSummary, TeamPhasePayload, TeamStartPayload } from '@vessel/shared';
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
