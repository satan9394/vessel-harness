import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChatProvider, PolicyArtifacts, ToolSpec } from '@vessel/shared';
import type { EventBus } from '@vessel/core';
import {
  REVIEWER_PRESET_ID,
  createDefaultPresetRegistry,
  InternalReviewer,
  type AgentPreset,
  type EvaluatorVerdict,
  type PresetRegistry,
  type ReviewConclusion,
} from '@vessel/agents';
import type { EvaluateContext } from './LoopEngine.js';
import { RingHistory, DEFAULT_HISTORY_LIMIT } from './bounded-history.js';

/**
 * engine/RealEvaluatorAdapter — task 062（V1.3 Goal Loop 真接线，docs/Vessel…§11；
 * 对称前置 061 RealGeneratorAdapter，docs/REAL-EVALUATOR-ADAPTER.md）。
 *
 * 把 055/058 建的 preset 化 Reviewer Agent（evaluator，InternalReviewer 只读调用流程）接到
 * LoopEngine 的 Evaluator seam（`LoopEngineDeps.evaluate`）上，不重写 LoopEngine、不写 core、
 * 不新造 Agent primitive、不新造结论/解析（全部复用 058 InternalReviewer + TeamReviewConclusion）：
 *
 *   generator 产出（061 GeneratorRunRecord：output + 磁盘证据 artifactPaths + 测试结果摘要）
 *     + 验收标准（LoopTask.acceptance）
 *     → reviewer（058 InternalReviewer，reviewer preset 只读面 —— write:false shrink-only）
 *     → met/not_met + 理由 + 建议（058 TeamReviewConclusion 形状）
 *     → 回读给 loop 决策 retry/met（EvaluatorVerdict 契约；loop 按 verdict 在 maxRetries 内重试）。
 *
 * 分层纪律与 061 一致：engine 已有对 agents 的引用（LoopEngine type-import EvaluatorVerdict），
 * 本文件把 agents/InternalReviewer 作为注入的「真实 Evaluator」实现组合进来 —— adapter 就是那个
 * 「调用方真实实现」。Generator/Evaluator 分离：本 adapter 只消费 061 的产出（含自述）做独立评审，
 * acceptance 是唯一评审判据来源，评审结论即 retry 决策数据（不信任 generator 自证）。
 *
 * 默认自治受限（§11.1，沿用 061 机制）：本 adapter 每次 evaluate() 只跑 ONE 次有界 Internal Review
 * （无内部循环）；maxIterations=1 / maxRetries=1 由 LoopEngine 默认选项实施，e2e 验证不超。
 *
 * 复用铁律：结论形状 = 058 TeamReviewConclusion（verdict/reason/unmet/suggestions/evidence），
 * 解析/语义全部来自 058（InternalReviewer → EvaluatorAgent parseVerdict），本文件不实现任何解析。
 */

export interface RealEvaluatorAdapterOptions {
  /** providerId → ChatProvider（reviewer 会话查表；未知 fail loud） */
  providers: Record<string, ChatProvider>;
  /** policy 产物（InternalReviewer/隔离会话共用；read-only 档由 reviewer preset 语义表达） */
  policyArtifacts: PolicyArtifacts;
  /**
   * reviewer 会话可见基础工具面（preset write:false 只读收窄前；缺省 = InternalReviewer 的
   * 只读探索面 Read/Glob/Grep，绑定每次 evaluate 的 workspace root）。
   */
  tools?: ToolSpec[];
  /** reviewer preset id（registry 内 role=evaluator 且 write:false；默认 REVIEWER_PRESET_ID） */
  reviewerPresetId?: string;
  /** reviewer 会话的 providers 表键 */
  reviewerProviderId: string;
  /** reviewer 会话模型 */
  reviewerModel: string;
  /** preset registry（缺省 seed 默认三角色的 createDefaultPresetRegistry()） */
  presetRegistry?: PresetRegistry;
  /** parent EventBus（评审会话 subagent_start/stop 镜像；缺省无） */
  bus?: EventBus;
  stableSections?: string[];
  policyGuidance?: string[];
  /**
   * history 有界上限（V1.1-B）：adapter 内存内保最近 N 条评审记录（FIFO 覆盖最旧；计数走 total）。
   * 缺省 100（见 DEFAULT_HISTORY_LIMIT）—— 约数 KB/record，内存上界稳定，杜绝 soak 观察到的
   * heap 单调上行。lastRun 恒在环内可得；runs 返回最近 N 条；IterationStore 不做全量 history 扫描
   * （append 时 lastRun 整记录即时入参），有界不破坏迭代完整性。传 0/负数 → fail loud。
   */
  historyLimit?: number;
}

/** 一次评审的输入（评审对象形状 —— 与 061 GeneratorRunRecord / engine GeneratorOutput 同构）。 */
export interface EvaluatorRunRequest {
  id: string;
  goal: string;
  /** 验收标准（评审判据来源 —— 061 record.acceptance / LoopTask.acceptance 透传） */
  acceptance?: readonly string[];
  /** 被评 workspace 根（LoopEngine workspaceFactory / 064 worktree 提供；reviewer 会话绑定于此） */
  workspaceRoot: string;
  /** generator 产出文本（061 GeneratorRunRecord.output / engine GeneratorOutput.output） */
  generatorOutput: string;
  /** 磁盘证据相对路径（061 artifactPaths 同形；adapter 解析为绝对只读证据路径给 reviewer） */
  artifactPaths?: readonly string[];
  /** 测试结果摘要（真实链「Tests」步的独立产出，若有；缺省不注入 —— 产出自述与磁盘仍进评审） */
  testResults?: string;
  /** engine 迭代/尝试编号（evaluate seam 传入；独立调用缺省 1） */
  iteration?: number;
  attempt?: number;
}

/**
 * 一次评审的完整记录 —— 结论可回读（比 EvaluatorVerdict 契约更全；与 GeneratorRunRecord 对称）：
 * verdict/reason/unmet/suggestions/evidence 全部复用 058 ReviewConclusion 形状，恒有值。
 */
export interface EvaluatorRunRecord {
  taskId: string;
  goal: string;
  acceptance?: readonly string[];
  workspaceRoot: string;
  iteration: number;
  attempt: number;
  /** 被评产出文本（回读：评的是什么） */
  generatorOutput: string;
  /** 磁盘证据（相对路径；与 061 artifactPaths 同形，排序稳定） */
  artifactPaths: readonly string[];
  /** reviewer 实际可见的只读证据路径（绝对路径；与 061 相对 artifactPaths 的解析面） */
  evidencePaths: readonly string[];
  /** 评审会话可见工具名（reviewer preset 只读收窄后；审计 reviewer 面） */
  visibleTools: readonly string[];
  /** 复用 058 ReviewConclusion = TeamReviewConclusion（verdict/reason/unmet/suggestions/evidence） */
  conclusion: ReviewConclusion;
  reviewerPresetId: string;
  startedAt: number;
  durationMs: number;
}

function fail(message: string): never {
  throw new Error(`RealEvaluatorAdapter: ${message}`);
}

/**
 * RealEvaluatorAdapter —— LoopEngine Evaluator seam 的真实实现（task 062）。
 *
 * 用法（引擎侧接线，对称 061）：
 * ```ts
 * const evaluator = new RealEvaluatorAdapter({
 *   providers, policyArtifacts,
 *   reviewerProviderId: 'pro', reviewerModel: 'deepseek-v4',
 * });
 * const engine = new LoopEngine({ selectTask, generate: (ctx) => generator.generate(ctx), evaluate: (ctx) => evaluator.evaluate(ctx), persist, workspaceFactory, disposeWorkspace });
 * ```
 * 每次 evaluate() = 一次有界 Internal Review（058 InternalReviewer 单会话只读评审）。
 */
export class RealEvaluatorAdapter {
  private readonly opts: RealEvaluatorAdapterOptions;
  private readonly registry: PresetRegistry;
  private readonly reviewerPreset: AgentPreset;
  private readonly history: RingHistory<EvaluatorRunRecord>;
  /** history 有界上限（= options.historyLimit ?? DEFAULT_HISTORY_LIMIT）。 */
  readonly historyLimit: number;

  constructor(opts: RealEvaluatorAdapterOptions) {
    if (!opts.reviewerProviderId || !opts.reviewerProviderId.trim()) {
      fail('options.reviewerProviderId must be a non-empty string');
    }
    if (!opts.reviewerModel || !opts.reviewerModel.trim()) {
      fail('options.reviewerModel must be a non-empty string');
    }
    if (!opts.providers[opts.reviewerProviderId]) {
      const available = Object.keys(opts.providers);
      fail(
        `reviewer provider "${opts.reviewerProviderId}" is not bound ` +
          `(available providers: ${available.length > 0 ? available.join(', ') : 'none'})`,
      );
    }
    if (!opts.policyArtifacts) fail('options.policyArtifacts is required');
    this.opts = opts;
    this.registry = opts.presetRegistry ?? createDefaultPresetRegistry();
    // evaluator-side 守卫：reviewer preset 必须是 evaluator 角色 + write:false（只读评审面）
    const presetId = opts.reviewerPresetId ?? REVIEWER_PRESET_ID;
    const preset = this.registry.getPreset(presetId);
    if (preset.role !== 'evaluator') {
      fail(
        `preset "${presetId}" has role "${preset.role}" — RealEvaluatorAdapter is evaluator-side, ` +
          `use an evaluator preset (e.g. "${REVIEWER_PRESET_ID}")`,
      );
    }
    if (preset.write !== false) {
      fail(`preset "${presetId}" must be write:false (evaluator review face is read-only)`);
    }
    this.reviewerPreset = preset;
    this.historyLimit = opts.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.history = new RingHistory<EvaluatorRunRecord>(this.historyLimit);
  }

  get presetId(): string {
    return this.opts.reviewerPresetId ?? REVIEWER_PRESET_ID;
  }

  /**
   * 已完成的评审记录（按调用序，保最近 historyLimit 条）—— 结论可回读
   * （retry 决策数据：verdict/unmet/suggestions）。有界环超过上限后覆盖最旧；
   * 计数看 totalRuns（覆盖不清零），lastRun 恒在环内。
   */
  get runs(): readonly EvaluatorRunRecord[] {
    return this.history.items;
  }

  /** 单调已产生评审总数（覆盖不清零 —— 计数消费方不因有界环失真）。 */
  get totalRuns(): number {
    return this.history.total;
  }

  get lastRun(): EvaluatorRunRecord | undefined {
    return this.history.last;
  }

  /**
   * LoopEngine Evaluator seam：一次有界 Internal Review → EvaluatorVerdict
   * （verdict/evidence/reason/unmet/suggestions —— 全部来自 058 ReviewConclusion，映射即契约）。
   * 每次调用新起一个 InternalReviewer（workspaceRoot = ctx.workspace.root）—— 无跨调用状态泄漏。
   */
  async evaluate(ctx: EvaluateContext): Promise<EvaluatorVerdict> {
    const rec = await this.evaluateRun({
      id: ctx.task.id,
      goal: ctx.task.goal,
      acceptance: ctx.task.acceptance,
      workspaceRoot: ctx.workspace.root,
      iteration: ctx.iteration,
      attempt: ctx.attempt,
      generatorOutput: ctx.generatorOutput.output,
      artifactPaths: ctx.generatorOutput.artifactPaths,
    });
    // 058 结论 → loop evaluator 输出契约（1:1；unmet/suggestions 恒为数组，feedback 可回读）
    return {
      verdict: rec.conclusion.verdict,
      evidence: [...rec.conclusion.evidence],
      reason: rec.conclusion.reason,
      unmet: [...rec.conclusion.unmet],
      suggestions: [...rec.conclusion.suggestions],
    };
  }

  /**
   * 直接入口（不经 engine ctx；供队列/测试/061 记录同形状复用）：
   * generator 产出（output + 磁盘证据 + 测试结果）→ reviewer → 完整结论记录回读。
   */
  async evaluateRun(req: EvaluatorRunRequest): Promise<EvaluatorRunRecord> {
    if (!req.id || !req.goal) {
      fail(`task needs id + goal (got ${JSON.stringify({ id: req.id, goal: req.goal })})`);
    }
    if (typeof req.generatorOutput !== 'string' || req.generatorOutput.trim() === '') {
      fail('evaluate requires a non-empty generatorOutput (nothing produced to review)');
    }
    const workspaceRoot = path.resolve(req.workspaceRoot);
    if (!req.workspaceRoot || !fs.existsSync(workspaceRoot)) {
      fail(
        `evaluate requires an existing isolated workspace root (task 064 worktree / TempDirWorkspaceFactory); got "${req.workspaceRoot ?? ''}"`,
      );
    }
    const startedAt = Date.now();

    // 磁盘证据：相对路径（061 artifactPaths 同形）→ 排序稳定 + 解析为绝对只读证据路径
    const artifactPaths = [...(req.artifactPaths ?? [])].filter((p) => p.trim() !== '').sort();
    const evidencePaths = artifactPaths.map((p) => path.resolve(workspaceRoot, p));

    // 每次评审 = 一个新的 InternalReviewer（workspaceRoot 绑定本次 workspace；preset 只读面已收窄）
    const reviewer = new InternalReviewer({
      workspaceRoot,
      provider: this.opts.providers[this.opts.reviewerProviderId]!,
      model: this.opts.reviewerModel,
      policyArtifacts: this.opts.policyArtifacts,
      bus: this.opts.bus,
      preset: this.reviewerPreset,
      tools: this.opts.tools,
      stableSections: this.opts.stableSections,
      policyGuidance: this.opts.policyGuidance,
    });

    // 058 复用：结论由 InternalReviewer（EvaluatorAgent review 模式 + parseVerdict）产出；不新造解析
    const conclusion = await reviewer.review({
      goal: req.goal,
      acceptance: req.acceptance ? [...req.acceptance] : undefined,
      changes: {
        files: artifactPaths.length > 0 ? artifactPaths : undefined,
        testResults: req.testResults && req.testResults.trim() !== '' ? req.testResults : undefined,
      },
      generatorOutput: req.generatorOutput,
      evidencePaths,
    });

    const record: EvaluatorRunRecord = {
      taskId: req.id,
      goal: req.goal,
      acceptance: req.acceptance ? [...req.acceptance] : undefined,
      workspaceRoot,
      iteration: req.iteration ?? 1,
      attempt: req.attempt ?? 1,
      generatorOutput: req.generatorOutput,
      artifactPaths,
      evidencePaths,
      visibleTools: reviewer.visibleTools.map((t) => t.name),
      conclusion,
      reviewerPresetId: this.presetId,
      startedAt,
      durationMs: Date.now() - startedAt,
    };
    this.history.push(record);
    return record;
  }
}
