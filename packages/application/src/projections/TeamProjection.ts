import type { TeamEndPayload, TeamPhasePayload, TeamStartPayload } from '@vessel/shared';
import type { EventBus } from '@vessel/core';
import type {
  TeamDelegateRow,
  TeamPhaseRow,
  TeamRunState,
  TeamToolRow,
  TeamTurnRow,
} from './types.js';

const PREVIEW_LIMIT = 300;

/**
 * TeamProjection — 团队运行过程的只读投影（task 057，给 060 team UI 消费）。
 *
 * 照 040/052 的 projections 框架：挂在 TeamRuntime 的 team EventBus 上增量订阅，
 * 复用既有词汇 + 057 新增的三个 team 事件（EVENT-SPEC §5.H）：
 * - team_start / team_phase / team_end → run / phase 行（阶段-成员归属锚点）；
 * - before_turn / after_turn / after_tool → 成员回合与工具（team_phase 窗口归属）；
 * - subagent_start / subagent_stop → delegate 关系（复杂阵容 lead → developer/reviewer）。
 *
 * 与其它投影一致：监听器只返回 void（不短路 before_turn waterfall 等决策点）；
 * attach(bus) 返回 detach；state() 暴露整次运行的查询面。
 */
export class TeamProjection {
  private run: TeamRunState | null = null;
  private readonly phases: TeamPhaseRow[] = [];
  private readonly turns: TeamTurnRow[] = [];
  private readonly delegates: TeamDelegateRow[] = [];
  private readonly tools: TeamToolRow[] = [];
  /** 当前阶段窗口（team_phase 之后、下一 team_phase/team_end 之前的事件归属） */
  private currentPhase: TeamPhaseRow | null = null;

  attach(bus: EventBus): () => void {
    const offStart = bus.on('team_start', (payload) => this.onTeamStart(payload as TeamStartPayload), 'projection:team:start');
    const offPhase = bus.on('team_phase', (payload) => this.onTeamPhase(payload as TeamPhasePayload), 'projection:team:phase');
    const offEnd = bus.on('team_end', (payload) => this.onTeamEnd(payload as TeamEndPayload), 'projection:team:end');
    const offBeforeTurn = bus.on('before_turn', (payload) => this.onBeforeTurn(payload as { turnId: string; input: string }), 'projection:team:before_turn');
    const offAfterTurn = bus.on(
      'after_turn',
      (payload) =>
        this.onAfterTurn(payload as { turnId: string; kind: 'success' | 'error' | 'interrupted' | 'budget' }),
      'projection:team:after_turn',
    );
    const offAfterTool = bus.on('after_tool', (payload) => this.onAfterTool(payload as { toolName: string; result?: { error?: { errorClass?: string } } }), 'projection:team:after_tool');
    const offSubStart = bus.on(
      'subagent_start',
      (payload) =>
        this.onSubagentStart(payload as { delegateId: string; childAgentId: string; childSessionId: string; preset?: string }),
      'projection:team:subagent_start',
    );
    const offSubStop = bus.on(
      'subagent_stop',
      (payload) =>
        this.onSubagentStop(
          payload as { delegateId: string; childSessionId: string; result?: { stopReason?: string; output?: string }; isError?: boolean; durationMs?: number },
        ),
      'projection:team:subagent_stop',
    );

    return () => {
      offStart();
      offPhase();
      offEnd();
      offBeforeTurn();
      offAfterTurn();
      offAfterTool();
      offSubStart();
      offSubStop();
    };
  }

  state(): TeamRunState | null {
    if (!this.run) return null;
    return {
      ...this.run,
      phases: [...this.phases],
      turns: [...this.turns],
      delegates: [...this.delegates],
      toolActivities: [...this.tools],
    };
  }

  private onTeamStart(p: TeamStartPayload): void {
    this.run = {
      runId: p.teamRunId,
      task: p.task,
      complexity: p.complexity,
      roster: p.roster,
      status: 'running',
      startedAt: Date.now(),
      phases: [],
      turns: [],
      delegates: [],
      toolActivities: [],
    };
    this.phases.length = 0;
    this.turns.length = 0;
    this.delegates.length = 0;
    this.tools.length = 0;
    this.currentPhase = null;
  }

  private onTeamPhase(p: TeamPhasePayload): void {
    if (!this.run || this.run.runId !== p.teamRunId) return;
    this.closeRunningPhase();
    const row: TeamPhaseRow = {
      ordinal: p.ordinal,
      phase: p.phase,
      memberId: p.memberId,
      presetId: p.presetId,
      role: p.role,
      status: 'running',
      delegateOf: p.delegateOf,
      promptPreview: p.promptPreview,
      ts: Date.now(),
    };
    this.phases.push(row);
    this.currentPhase = row;
  }

  private onTeamEnd(p: TeamEndPayload): void {
    if (!this.run || this.run.runId !== p.teamRunId) return;
    // 逐成员摘要闭合阶段行（team_phase 只标记开始；成败/产出在 team_end 落定）
    for (const m of p.members) {
      const row = this.phases.find((ph) => ph.memberId === m.memberId && ph.phase === m.phase);
      if (!row) continue;
      row.status = m.status;
      row.stopReason = m.stopReason;
      if (m.output) row.outputPreview = trim(m.output, PREVIEW_LIMIT);
      // task 058: 结构化 Internal Review 结论（evaluate 成员）直接可读，不靠解析文本
      if (m.review) row.review = m.review;
    }
    // 兜底：仍为 running 的阶段行（理论上每个 phase 都有摘要）按 outcome 落定
    if (this.currentPhase && this.currentPhase.status === 'running') {
      this.currentPhase.status = p.outcome === 'failed' ? 'failed' : 'completed';
    }
    this.currentPhase = null;
    this.run = {
      ...this.run,
      status: 'done',
      outcome: p.outcome,
      error: p.error,
      endedAt: Date.now(),
      durationMs: p.durationMs,
    };
  }

  private onBeforeTurn(p: { turnId: string; input: string }): void {
    if (!this.run) return;
    const current = this.currentPhase;
    if (!current) return;
    if (!current.promptPreview) current.promptPreview = trim(p.input, PREVIEW_LIMIT);
    this.turns.push({
      memberId: current.memberId,
      role: current.role,
      phase: current.phase,
      turnId: p.turnId,
      kind: 'running',
      promptPreview: trim(p.input, PREVIEW_LIMIT),
      ts: Date.now(),
    });
  }

  private onAfterTurn(p: { turnId: string; kind: 'success' | 'error' | 'interrupted' | 'budget' }): void {
    const row = [...this.turns].reverse().find((t) => t.turnId === p.turnId);
    if (!row) return;
    row.kind = p.kind;
  }

  private onAfterTool(p: { toolName: string; result?: { error?: { errorClass?: string } } }): void {
    if (!this.run) return;
    const current = this.currentPhase;
    if (!current) return;
    const errClass = p.result?.error?.errorClass;
    const status = errClass === undefined ? 'done' : errClass === 'DENIED' ? 'denied' : 'error';
    this.tools.push({ memberId: current.memberId, role: current.role, toolName: p.toolName, status, ts: Date.now() });
  }

  private onSubagentStart(p: { delegateId: string; childSessionId: string; preset?: string }): void {
    if (!this.run) return;
    const current = this.currentPhase;
    // 父成员：delegate 阶段（team_phase.delegateOf）里以父成员为准，否则为当前窗口成员
    const parentMemberId = current?.delegateOf ?? current?.memberId ?? '';
    this.delegates.push({
      delegateId: p.delegateId,
      parentMemberId,
      childSessionId: p.childSessionId,
      preset: p.preset,
      status: 'running',
      ts: Date.now(),
    });
  }

  private onSubagentStop(
    p: { delegateId: string; result?: { stopReason?: string; output?: string }; isError?: boolean; durationMs?: number },
  ): void {
    const row = [...this.delegates].reverse().find((d) => d.delegateId === p.delegateId);
    if (!row) return;
    row.status = 'done';
    row.stopReason = p.result?.stopReason;
    row.isError = p.isError;
    row.durationMs = p.durationMs;
    if (p.result?.output) row.outputPreview = trim(p.result.output, PREVIEW_LIMIT);
  }

  /** 上一阶段在下一 team_phase 到来时即 'completed'（运行体只在成员成功后推进阶段；终态由 team_end 摘要落定）。 */
  private closeRunningPhase(): void {
    if (this.currentPhase) {
      this.currentPhase.status = 'completed';
      this.currentPhase = null;
    }
  }
}

function trim(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}
