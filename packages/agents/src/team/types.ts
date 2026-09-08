/**
 * agents/team — TeamRuntime domain types (task 057).
 *
 * TeamRuntime 组合 preset 化的 Agent 协作用于一次任务（§8.2：小→1 / 中→2 / 复杂→3），
 * 复用既有 AgentLoop/Session/delegate（IsolatedRuntime + SubagentManager + presetLookup），
 * 不新造 Agent primitive。本层（agents）不 import @vessel/llm —— 056 AutoRoute 以结构类型
 * TeamRouteLike 传入（AutoRoute 实例结构上兼容），分层纪律：llm 只透传 preset id、agents 只消费数据。
 */
import type { AgentPreset, AgentRole } from '../presets/types.js';
import type { TeamMemberSummary, TeamPhaseName } from '@vessel/shared';

/**
 * 一张 roster 行（显式阵容时由调用方给出；route 路径由 composeRosterFromRoute 生成）。
 * memberId 缺省 = presetId（默认阵容一角色一实例，天然唯一）。
 */
export interface TeamMemberSpec {
  /** roster 内唯一（缺省 = presetId） */
  memberId?: string;
  /** agents/presets registry key（lead/developer/reviewer…） */
  presetId: string;
  /** 已解析模型（route.roleModels[i].model / 显式指定） */
  model: string;
  /** providers 表键（route.roleModels[i].providerId / 显式指定） */
  providerId: string;
  /** 档位意图（展示/审计；显式阵容可省） */
  tier?: string;
}

/** 有序阵容（执行顺序即数组序：orchestrator → generator → evaluator）。 */
export type TeamRoster = readonly TeamMemberSpec[];

/**
 * 056 AutoRoute 的结构化子集（agents 不 import llm —— 结构类型即可容纳 AutoRoute 实例）：
 * 消费 route.roles（§8.2 有序 preset id）+ route.roleModels（每角色 model/tier/providerId）。
 */
export interface TeamRouteLike {
  /** §8.2 复杂度（small/medium/complex；透传展示用） */
  complexity?: string;
  /** 有序角色 preset id 计划（小=['developer'] 中=['developer','reviewer'] 复杂=['lead','developer','reviewer']） */
  roles: readonly string[];
  /** 与 roles 一一对应的每角色模型解析 */
  roleModels: readonly { role?: string; tier?: string; providerId?: string; model?: string }[];
}

/** runTeam 输入：任务 + 路由决定（route）或显式阵容（roster），二选一。 */
export interface TeamRunRequest {
  task: string;
  /** 显式阵容（与 route 二选一） */
  roster?: TeamRoster;
  /** 056 路由结果（roles + roleModels → roster） */
  route?: TeamRouteLike;
  /**
   * 任务对象的验收标准字段（task 058；与 engine LoopTask.acceptance / planner Plan.acceptance
   * 同形的结构字段）—— reviewer 阶段按此评估 generator 产出并输出结构化结论。
   */
  acceptance?: readonly string[];
}

/** 已解析团队成员计划（运行时内部/校验后形状：role/phase/preset 已解析）。 */
export interface ResolvedTeamMember {
  memberId: string;
  presetId: string;
  preset: AgentPreset;
  role: AgentRole;
  phase: TeamPhaseName;
  tier?: string;
  model: string;
  providerId: string;
}

/** 一次团队运行的收尾摘要（members 与 team_end 载荷同形）。 */
export interface TeamRunSummary {
  teamRunId: string;
  task: string;
  /** §8.2 复杂度（route 路径透传；显式阵容为 undefined） */
  complexity?: string;
  /** 已解析成员计划（含 role/phase；与 team_start roster 同序） */
  members: readonly TeamMemberSummary[];
  outcome: 'completed' | 'failed';
  durationMs: number;
  /** failed 时的原因（失败阶段 kind / delegate stopReason / diagnostic） */
  error?: string;
}
