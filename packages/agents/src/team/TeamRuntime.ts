/**
 * agents/team — TeamRuntime（task 057）：多 Agent 协作运行时（骨架 + 投影事实源）。
 *
 * 输入 = 任务 + 路由决定（056 AutoRoute 结构子集 TeamRouteLike）或显式阵容（TeamRoster）
 * → 组合 preset 化的 Agent 协作用于一次任务（§8.2：小→1 developer / 中→2 developer+reviewer /
 * 复杂→3 lead+developer+reviewer）。
 *
 * 复用铁律（不新造 primitive）：
 * - 每个团队成员跑在既有 AgentLoop/Session 机制上 —— createIsolatedRuntime 的隔离会话
 *   （source 'team'，session/created.agentPreset = memberId），回合经既有 runTurn；
 * - 含 orchestrator（lead）的 roster：其后 generator/evaluator 成员以**真实 delegate 机制**
 *   （SubagentManager.delegate + presetLookup，055 接线）作为 lead 会话的子代理执行
 *   （子会话 session/created{source:'subagent', agentPreset, parentSession: <lead session>}）；
 * - 顺序驱动骨架：orchestrator 编排 → generator 产出 → evaluator 检查（阶段顺序 = roster 序，
 *   gen→eval 的交接 = 前一成员产出进入下一成员 prompt）。
 *
 * 可观测性（TeamProjection 消费）：所有成员共享一个 team EventBus（IsolatedRuntime.bus 注入），
 * 运行事实以既有/新增扩展事件表达：
 * - team_start / team_phase / team_end —— 本卡按 EVENT-SPEC 规矩新增的三个 emit 事件
 *   （阵容快照 / 阶段-成员激活归属锚点 / 收尾摘要；见 docs/TEAM-RUNTIME.md 与 EVENT-SPEC §5.H）；
 * - 成员回合/工具 —— 复用 before_turn / after_turn / after_tool（team_phase 后的事件按成员归属）；
 * - delegate 关系 —— 复用 subagent_start / subagent_stop（team_phase.delegateOf = 父成员）。
 */
import * as crypto from 'node:crypto';
import type {
  ChatProvider,
  PolicyArtifacts,
  TeamEndPayload,
  TeamMemberBrief,
  TeamMemberSummary,
  TeamPhasePayload,
  TeamRoleName,
  TeamStartPayload,
  ToolSpec,
} from '@vessel/shared';
import { EventBus } from '@vessel/core';
import { createIsolatedRuntime, type IsolatedRuntime } from '../subagent/IsolatedRuntime.js';
import { SubagentManager } from '../subagent/SubagentManager.js';
// BRIEF「同一件事三处实现、两套口径」：kind → stopReason 的**唯一实现**。
// 本文件原先（:259）是第三套口径 `stopReason: turn.kind === 'success' ? undefined : turn.kind`
// —— 原样把**回合 kind** 当 stopReason 输出，于是产出 `'budget'`/`'interrupted'` 这两个
// **不在 `SubagentResultContract.stopReason` 词表内**的值。
import { mapTurnKindToStopReason } from '../turnStopReason.js';
import { applyPresetToolFace } from '../presets/capabilities.js';
import { PresetRegistry } from '../presets/registry.js';
import { createDefaultPresetRegistry } from '../presets/defaults.js';
import { composeRosterFromRoute, resolveRoster } from './roster.js';
import { parseReviewConclusion, REVIEW_OUTPUT_SCHEMA } from '../reviewer/conclusion.js';
import type { ResolvedTeamMember, TeamRunRequest, TeamRunSummary } from './types.js';

export interface TeamRuntimeOptions {
  workspaceRoot: string;
  cwd?: string;
  /** provider id → ChatProvider（成员 providerId 查表；未知 fail loud 列可用项） */
  providers: Record<string, ChatProvider>;
  policyArtifacts: PolicyArtifacts;
  /** 团队成员基座工具面 —— 每成员按 preset 能力面 shrink-only 收窄（write:false → 只读） */
  tools: ToolSpec[];
  /** preset registry（缺省：seed 默认三角色的 createDefaultPresetRegistry()） */
  presetRegistry?: PresetRegistry;
  /** team EventBus（TeamProjection 挂接点）；缺省自建（经 bus getter 取用） */
  bus?: EventBus;
  stableSections?: string[];
  policyGuidance?: string[];
  maxSteps?: number;
}

const PROMPT_PREVIEW_LIMIT = 300;

/** 角色显示标签（prompt 内；与 presets AgentRole 一一对应）。 */
const ROLE_TITLES: Record<TeamRoleName, string> = {
  orchestrator: 'Lead（orchestrator·编排）',
  generator: 'Developer（generator·产出）',
  evaluator: 'Reviewer（evaluator·评估·只读）',
};

/**
 * TeamRuntime —— 一次 runTeam = 一个团队运行：team_start → 逐阶段
 * （每阶段前 team_phase）→ team_end。成员失败即中止后续阶段（骨架 fail-fast），
 * 以 outcome 'failed' + error 收尾（不抛——运行失败是返回态不是异常）。
 * 结构性错误（空任务/空阵容/未知 preset/缺失 provider/roster 与 route 同给）在
 * team_start 之前抛出（调用方 bug，fail loud）。
 */
export class TeamRuntime {
  readonly bus: EventBus;
  private readonly registry: PresetRegistry;
  private readonly opts: TeamRuntimeOptions;

  constructor(opts: TeamRuntimeOptions) {
    this.opts = opts;
    this.registry = opts.presetRegistry ?? createDefaultPresetRegistry();
    this.bus = opts.bus ?? new EventBus();
  }

  /** 成员 preset 解析 registry（SubagentManager.presetLookup 用同一实例）。 */
  get presetRegistry(): PresetRegistry {
    return this.registry;
  }

  async runTeam(req: TeamRunRequest): Promise<TeamRunSummary> {
    const startedAt = Date.now();
    // ---- 结构性校验（任何事件发出之前 fail loud）----
    if (typeof req.task !== 'string' || req.task.trim() === '') {
      throw new Error('team error: task is required');
    }
    const hasRoster = req.roster !== undefined;
    const hasRoute = req.route !== undefined;
    if (hasRoster === hasRoute) {
      throw new Error('team error: provide exactly one of roster | route');
    }
    const rosterSpec = hasRoute ? composeRosterFromRoute(req.route!, this.registry) : req.roster!;
    const plans = resolveRoster(rosterSpec, this.registry);
    const available = Object.keys(this.opts.providers);
    for (const plan of plans) {
      if (!this.opts.providers[plan.providerId]) {
        throw new Error(
          `team error: member "${plan.memberId}" resolves provider "${plan.providerId}" which is not bound ` +
            `(available providers: ${available.length > 0 ? available.join(', ') : 'none'})`,
        );
      }
    }

    const teamRunId = `team_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const briefs: TeamMemberBrief[] = plans.map((p) => ({
      memberId: p.memberId,
      presetId: p.presetId,
      role: p.role,
      tier: p.tier,
      model: p.model,
      providerId: p.providerId,
    }));

    // ---- 运行体 ----
    const openRuntimes = new Map<string, IsolatedRuntime>();
    const members: TeamMemberSummary[] = [];
    let outcome: TeamRunSummary['outcome'] = 'completed';
    let error: string | undefined;
    let broken = false;

    await this.bus.emit('team_start', {
      teamRunId,
      task: req.task,
      complexity: req.route?.complexity,
      roster: briefs,
    } satisfies TeamStartPayload);

    try {
      for (let i = 0; i < plans.length; i += 1) {
        if (broken) break;
        const plan = plans[i]!;
        const delegateParentIdx = this.findDelegateParent(plans, i);
        const delegateOf = delegateParentIdx !== undefined ? plans[delegateParentIdx]!.memberId : undefined;
        const prompt = this.buildPhasePrompt(plan, req.task, members, req.acceptance);
        await this.bus.emit('team_phase', {
          teamRunId,
          ordinal: i + 1,
          phase: plan.phase,
          memberId: plan.memberId,
          presetId: plan.presetId,
          role: plan.role,
          delegateOf,
          promptPreview: trim(prompt, PROMPT_PREVIEW_LIMIT),
        } satisfies TeamPhasePayload);

        try {
          const summary =
            delegateOf !== undefined
              ? await this.runDelegatePhase(plan, prompt, delegateOf, openRuntimes)
              : await this.runMemberPhase(plan, prompt, openRuntimes);
          // task 058: evaluate 成员产出按 review JSON schema 解析为结构化结论（review 字段进
          // team_end/投影；not_met 的 unmet/suggestions 即回读反馈）。解析失败 = verdict 'error'
          // （如实暴露，绝不误判 met）—— 评审结论是数据，不是运行失败。
          if (plan.phase === 'evaluate' && summary.status === 'completed' && summary.output) {
            summary.review = parseReviewConclusion(summary.output);
          }
          members.push(summary);
          if (summary.status === 'failed') {
            outcome = 'failed';
            error = `phase ${i + 1} (${plan.memberId}/${plan.phase}) failed: ${summary.stopReason ?? 'error'}${delegateOf !== undefined ? ' (delegate of ' + delegateOf + ')' : ''}`;
            broken = true;
          }
        } catch (err) {
          // 阶段级意外异常 —— 骨架兜底：按失败收尾并中止后续阶段（不向调用方抛）
          outcome = 'failed';
          error = `phase ${i + 1} (${plan.memberId}/${plan.phase}) threw: ${(err as Error).message}`;
          members.push({
            memberId: plan.memberId,
            presetId: plan.presetId,
            role: plan.role,
            phase: plan.phase,
            status: 'failed',
            sessionId: '',
            delegationDepth: delegateOf !== undefined ? 1 : 0,
            durationMs: 0,
            stopReason: 'error',
          });
          broken = true;
        }
      }
    } finally {
      for (const runtime of openRuntimes.values()) {
        await runtime.close();
      }
      openRuntimes.clear();
      await this.bus.emit('team_end', {
        teamRunId,
        outcome,
        members,
        durationMs: Date.now() - startedAt,
        error,
      } satisfies TeamEndPayload);
    }

    return {
      teamRunId,
      task: req.task,
      complexity: req.route?.complexity,
      members,
      outcome,
      durationMs: Date.now() - startedAt,
      error,
    };
  }

  /** 最近的前置 orchestrator 成员下标（§8.2 默认阵容里即 lead@0；其后成员均为其 delegate）。 */
  private findDelegateParent(plans: readonly ResolvedTeamMember[], i: number): number | undefined {
    for (let j = i - 1; j >= 0; j -= 1) {
      if (plans[j]!.role === 'orchestrator') return j;
    }
    return undefined;
  }

  /** top-level 团队成员：隔离会话（source 'team'，agentPreset=memberId）跑一个回合，事件上 team bus。 */
  private async runMemberPhase(
    plan: ResolvedTeamMember,
    prompt: string,
    openRuntimes: Map<string, IsolatedRuntime>,
  ): Promise<TeamMemberSummary> {
    const runtime = await createIsolatedRuntime({
      workspaceRoot: this.opts.workspaceRoot,
      cwd: this.opts.cwd,
      provider: this.opts.providers[plan.providerId]!,
      model: plan.model,
      policyArtifacts: this.opts.policyArtifacts,
      tools: applyPresetToolFace(plan.preset, this.opts.tools),
      source: 'team',
      agentPreset: plan.memberId,
      bus: this.bus,
      stableSections: this.opts.stableSections,
      policyGuidance: this.opts.policyGuidance,
      maxSteps: this.opts.maxSteps,
    });
    openRuntimes.set(plan.memberId, runtime);
    const turn = await runtime.loop.runTurn(prompt);
    // BRIEF「同一件事三处实现、两套口径」—— 顶层成员的 stopReason 与 `SubagentManager` /
    // `EvaluatorAgent` 走**同一个函数**（../turnStopReason.js）。改前这里是原样吐 kind
    // （`turn.kind === 'success' ? undefined : turn.kind`）⇒ 产出 `'budget'`/`'interrupted'`，
    // 二者不在 `SubagentResultContract.stopReason`（shared/events.ts:242）词表内。
    //
    // 分界与失败位：`stopReason === 'completed'` ⟺ `turn.kind === 'success'`（映射是 1:1 的），
    // 故 `success` 回合的**既有行为逐字不变**（`status:'completed'` + `stopReason` 仍为 undefined，
    // 键仍在、值不变）；非 completed 一律 `status:'failed'`，即 A24/H11 的
    // "`isError === (stopReason !== 'completed')`" 在本结构里的同一判断（TeamMemberSummary 无
    // isError 字段，用 status 承载；delegate 阶段用 SubagentManager 的 result.isError）。
    //
    // 原始 kind 并未丢失：团队总线上的 after_turn 仍带真实 kind（TeamProjection.onAfterTurn 记为
    // 该回合行的 kind），此处只统一**对外契约**的 stopReason 口径。
    const stopReason = mapTurnKindToStopReason(turn.kind);
    const completed = stopReason === 'completed';
    return {
      memberId: plan.memberId,
      presetId: plan.presetId,
      role: plan.role,
      phase: plan.phase,
      status: completed ? 'completed' : 'failed',
      sessionId: runtime.session.sessionId,
      delegationDepth: 0,
      durationMs: turn.durationMs,
      stopReason: completed ? undefined : stopReason,
      output: turn.finalText,
    };
  }

  /** delegate 阶段（复杂阵容）：SubagentManager.delegate + presetLookup（055 接线），父 = delegateOf 成员的会话。 */
  private async runDelegatePhase(
    plan: ResolvedTeamMember,
    prompt: string,
    delegateOf: string,
    openRuntimes: Map<string, IsolatedRuntime>,
  ): Promise<TeamMemberSummary> {
    const parentRuntime = openRuntimes.get(delegateOf);
    if (!parentRuntime) {
      throw new Error(`team error: delegate parent "${delegateOf}" has no open session (run ordering broken)`);
    }
    const manager = new SubagentManager({
      workspaceRoot: this.opts.workspaceRoot,
      cwd: this.opts.cwd,
      provider: this.opts.providers[plan.providerId]!,
      model: plan.model,
      policyArtifacts: this.opts.policyArtifacts,
      tools: this.opts.tools,
      bus: this.bus,
      maxConcurrent: 1,
      maxDepth: 3,
      parentSessionId: parentRuntime.session.sessionId,
      // BRIEF-权限收窄静默失效：此前这里是 `hasPreset(id) ? getPreset(id) : undefined` —— 查找未命中
      // 被折叠成 undefined，而 undefined 在 055 语义下等于「跳过收窄」，于是名字对不上就静默拿到全量面
      // （fail-open）。registry 才是权威：未知 id 直接抛 PresetNotFoundError（带已注册列表），
      // SubagentManager 把「解析抛错」判为 unresolved 并**拒绝委派**（fail-closed，错误可读）。
      presetLookup: (presetId) => this.registry.getPreset(presetId),
      stableSections: this.opts.stableSections,
      policyGuidance: this.opts.policyGuidance,
    });
    const result = await manager.delegate({ prompt, preset: plan.presetId, delegationDepth: 0, maxSteps: this.opts.maxSteps });
    return {
      memberId: plan.memberId,
      presetId: plan.presetId,
      role: plan.role,
      phase: plan.phase,
      status: result.isError ? 'failed' : 'completed',
      sessionId: result.childSessionId,
      parentSessionId: parentRuntime.session.sessionId,
      delegationDepth: result.delegationDepth,
      durationMs: result.durationMs,
      stopReason: result.stopReason,
      output: result.output,
    };
  }

  /**
   * 阶段 prompt（交接 = 前序成员产出进入后续 prompt：orchestrator 计划 → generator；
   * generator 产出 → evaluator 独立评估）。evaluate 阶段（task 058 真流程）要求 reviewer
   * 按验收标准评估并只回复一行 review JSON（REVIEW_OUTPUT_SCHEMA —— 运行体解析为结构化结论）。
   */
  private buildPhasePrompt(
    plan: ResolvedTeamMember,
    task: string,
    members: readonly TeamMemberSummary[],
    acceptance?: readonly string[],
  ): string {
    const lines: string[] = [`# 团队任务\n${task}`, `# 你的角色\n${ROLE_TITLES[plan.role]}`];
    if (plan.role === 'orchestrator') {
      lines.push(
        '请分析任务并产出实现计划、分工与验收要点（实现交由 developer 执行——你负责委派与协调，不直接写实现）。',
      );
      return lines.join('\n');
    }
    if (plan.role === 'generator') {
      const leadPlan = lastCompleted(members, 'orchestrate');
      if (leadPlan?.output) {
        lines.push(`# Lead 计划（执行方向）\n${leadPlan.output}`);
      }
      lines.push('请直接实现该任务并产出结果（改动的文件/结论尽量完整、可被 reviewer 独立核验）。');
      return lines.join('\n');
    }
    // evaluator —— 独立评估（只读证据面；Generator 不得自证完成）
    const genOutput = lastCompleted(members, 'generate');
    lines.push(
      '请作为独立 Reviewer 评估下面的 Generator 产出是否满足任务要求——不信任其自证：',
      '先核对产出覆盖度与可验证性，再输出结论。',
    );
    if (acceptance && acceptance.length > 0) {
      lines.push(`# 验收标准\n${acceptance.map((a) => `- ${a}`).join('\n')}`);
    } else {
      lines.push('# 验收标准\n（任务未给出显式验收标准——按任务要求自行判断覆盖度）');
    }
    lines.push(`# Generator 产出\n${genOutput?.output ?? '(无 generator 产出可评估)'}`);
    lines.push('');
    lines.push(REVIEW_OUTPUT_SCHEMA);
    return lines.join('\n');
  }
}

function lastCompleted(members: readonly TeamMemberSummary[], phase: TeamMemberSummary['phase']): TeamMemberSummary | undefined {
  for (let i = members.length - 1; i >= 0; i -= 1) {
    const m = members[i]!;
    if (m.phase === phase && m.status === 'completed') return m;
  }
  return undefined;
}

function trim(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}
