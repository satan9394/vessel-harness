/**
 * agents/reviewer — InternalReviewer（task 058）：独立 Internal Review 调用流程。
 *
 * 复用铁律（不新造 Agent primitive）：
 * - 评审由既有 EvaluatorAgent（它自身复用 IsolatedRuntime/AgentLoop/Session）执行；
 * - reviewer 角色语义（evaluator/no-write/只读证据面）来自 055 reviewer preset —— 工具面
 *   applyPresetToolFace(preset, tools) shrink-only 收窄（write:false → 只保留 read 工具）；
 * - 会话标注 agentPreset='reviewer'（B10 session/created 可区分 reviewer 产出），
 *   可选挂到 parent bus（subagent_start/stop 镜像，与 EvaluatorAgent 一致）。
 *
 * 输入（产出上下文 = 任务 + 验收标准 + 改动文件/diff/测试结果 + generator 产出自述），
 * 输出结构化 ReviewConclusion（verdict met/not_met/impossible/error + reason + unmet +
 * suggestions + evidence，schema 见 ./conclusion.ts）。not_met 的 unmet/suggestions 即
 * 可回读的反馈（供 TeamRuntime 投影与 Wave 3 rework 循环消费）。
 */
import type { ChatProvider, PolicyArtifacts, ToolSpec } from '@vessel/shared';
import type { EventBus } from '@vessel/core';
import type { AgentPreset } from '../presets/types.js';
import { DEFAULT_REVIEWER_PRESET } from '../presets/defaults.js';
import { applyPresetToolFace } from '../presets/capabilities.js';
import { createReadOnlyExplorationTools, EvaluatorAgent, type EvaluationRequest } from '../evaluator/EvaluatorAgent.js';
import type { ReviewConclusion } from './conclusion.js';

/** 产出上下文（generator 交付物摘要 —— 评审依据，由调用方组装）。 */
export interface ReviewProductionContext {
  /** 改动文件列表 */
  files?: readonly string[];
  /** diff 摘要（自由文本） */
  diffSummary?: string;
  /** 测试结果摘要（自由文本） */
  testResults?: string;
}

/** Internal Review 输入：任务对象字段（goal/acceptance）+ 产出上下文 + generator 产出。 */
export interface InternalReviewInput {
  /** 任务目标（任务对象字段，如 engine LoopTask.goal / planner Plan.goal） */
  goal: string;
  /** 验收标准（任务对象字段 acceptance —— 评审判据来源，明确传给 reviewer） */
  acceptance?: readonly string[];
  /** 产出上下文：改动文件 / diff / 测试结果（§9.1 handoff 载荷同构） */
  changes?: ReviewProductionContext;
  /** generator 产出自述（其改动、结论、声称的测试结果；独立核验，不自证） */
  generatorOutput: string;
  /** 只读磁盘证据路径（reviewer 可按需 Read/Glob/Grep 核验） */
  evidencePaths?: readonly string[];
}

export interface InternalReviewerOptions {
  workspaceRoot: string;
  cwd?: string;
  provider: ChatProvider;
  model: string;
  policyArtifacts: PolicyArtifacts;
  /** parent bus（可选）—— 评审会话事件经 subagent_start/stop 镜像可见 */
  bus?: EventBus;
  /**
   * reviewer preset（role 须为 evaluator，write:false）。缺省 = 默认 reviewer preset。
   * 只用于工具面收窄 + 语义校验；不改 EvaluatorAgent 只读默认面。
   */
  preset?: AgentPreset;
  /** 候选工具面（缺省 = createReadOnlyExplorationTools 只读探索面）；preset 面再收窄 */
  tools?: ToolSpec[];
  stableSections?: string[];
  policyGuidance?: string[];
}

/**
 * 组装产出上下文文本（改动文件 / diff / 测试结果 / 产出自述分节）—— 注入评审 prompt 的
 * generatorOutput 部分，便于 mock/断言核验上下文确实到达 reviewer。
 */
export function renderProductionContext(input: InternalReviewInput): string {
  const parts: string[] = [];
  const c = input.changes;
  if (c?.files?.length) parts.push(`改动文件：\n${c.files.map((f) => `- ${f}`).join('\n')}`);
  if (c?.diffSummary) parts.push(`Diff 摘要：\n${c.diffSummary}`);
  if (c?.testResults) parts.push(`测试结果：\n${c.testResults}`);
  if (input.generatorOutput.trim()) parts.push(`Generator 产出自述：\n${input.generatorOutput.trim()}`);
  return parts.join('\n\n');
}

/**
 * InternalReviewer —— 一次评审 = 一次 EvaluatorAgent review 调用（隔离只读会话）→ 结构化结论。
 * 复用 EvaluatorAgent / AgentLoop / Session / preset 面机制；异常不抛（返回 verdict 'error'，
 * 评审失败是结论不是异常 —— 与 EvaluatorAgent 的 error verdict 语义一致）。
 */
export class InternalReviewer {
  private readonly opts: InternalReviewerOptions;
  private readonly preset: AgentPreset;
  private readonly agent: EvaluatorAgent;
  /** 评审会话可见工具面（preset 面已收窄；只读断言用） */
  readonly visibleTools: readonly ToolSpec[];

  constructor(opts: InternalReviewerOptions) {
    this.opts = opts;
    const preset = opts.preset ?? DEFAULT_REVIEWER_PRESET;
    if (preset.role !== 'evaluator') {
      throw new Error(
        `reviewer error: preset "${preset.id}" role must be "evaluator" (internal reviewer is an evaluator role)`,
      );
    }
    if (preset.write !== false) {
      throw new Error(`reviewer error: preset "${preset.id}" must be write:false (read-only reviewer face)`);
    }
    this.preset = preset;
    const baseTools = opts.tools ?? createReadOnlyExplorationTools(opts.workspaceRoot);
    this.visibleTools = applyPresetToolFace(preset, baseTools);
    this.agent = new EvaluatorAgent({
      workspaceRoot: opts.workspaceRoot,
      cwd: opts.cwd,
      provider: opts.provider,
      model: opts.model,
      policyArtifacts: opts.policyArtifacts,
      bus: opts.bus,
      tools: [...this.visibleTools],
      agentPreset: preset.id,
      stableSections: opts.stableSections,
      policyGuidance: opts.policyGuidance,
    });
  }

  /** 执行一次 Internal Review → ReviewConclusion（verdict/evidence/reason/unmet/suggestions 恒有值）。 */
  async review(input: InternalReviewInput): Promise<ReviewConclusion> {
    if (typeof input.goal !== 'string' || input.goal.trim() === '') {
      return { verdict: 'error', reason: 'review error: goal is required', evidence: [], unmet: [], suggestions: [] };
    }
    const req: EvaluationRequest = {
      goal: input.goal.trim(),
      acceptance: input.acceptance ? [...input.acceptance] : [],
      generatorOutput: renderProductionContext(input),
      evidencePaths: input.evidencePaths ? [...input.evidencePaths] : [],
      review: true,
    };
    const verdict = await this.agent.evaluate(req).catch((err: unknown) => {
      // 评审基础设施失败（provider/loop/session 异常）→ 如实返回 error 结论，不把失败当 met
      return {
        verdict: 'error' as const,
        evidence: [],
        reason: `internal review call failed: ${(err as Error).message ?? String(err)}`,
        unmet: [],
        suggestions: [],
      };
    });
    return {
      verdict: verdict.verdict,
      evidence: verdict.evidence ?? [],
      reason: verdict.reason,
      unmet: verdict.unmet ?? [],
      suggestions: verdict.suggestions ?? [],
    };
  }
}
