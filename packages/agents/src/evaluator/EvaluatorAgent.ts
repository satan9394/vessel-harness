import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { ChatProvider, PolicyArtifacts, SubagentResultContract, ToolSpec } from '@vessel/shared';
import type { EventBus, TurnResult } from '@vessel/core';
import { createFsTools, createSearchTools, type FsPolicyConfig } from '@vessel/tools';
import { createIsolatedRuntime } from '../subagent/IsolatedRuntime.js';
// BRIEF「同一件事三处实现、两套口径」：kind → stopReason 的唯一实现（本文件原有那份 switch 已删除）。
import { mapTurnKindToStopReason } from '../turnStopReason.js';
import type { EvaluatorVerdict, EvaluatorVerdictKind } from './Evaluator.js';

export interface EvaluatorAgentOptions {
  workspaceRoot: string;
  cwd?: string;
  provider: ChatProvider;
  model: string;
  policyArtifacts: PolicyArtifacts;
  /** parent bus — optional; evaluator events are visible here (subagent_start/stop mirror) */
  bus?: EventBus;
  /** read-only tool set for evidence inspection (default: Read/Glob/Grep bound to workspace) */
  tools?: ToolSpec[];
  stableSections?: string[];
  policyGuidance?: string[];
  /**
   * Session/record label (task 058): recorded in the isolated session's B10
   * session/created.agentPreset so an Internal Reviewer run is distinguishable
   * from a plain evaluator run. Default: 'evaluator'.
   */
  agentPreset?: string;
}

export interface EvaluationRequest {
  goal: string;
  /** the generator's claimed artifact (final text / transcript tail) — never trusted as proof */
  generatorOutput: string;
  /** acceptance criteria the verdict is judged against */
  acceptance?: string[];
  /** read-only disk evidence paths the evaluator MAY inspect (transcript_and_disk, E49) */
  evidencePaths?: string[];
  delegationDepth?: number;
  /**
   * Internal Review output mode (task 058): when true the brief additionally
   * requires unmet (failed acceptance criteria) + suggestions (feedback for the
   * generator side) and the parser captures them on the returned verdict.
   */
  review?: boolean;
}

/** Default read-only exploration toolset for the evaluator agent (transcript + disk evidence). */
export function createReadOnlyExplorationTools(workspaceRoot: string, fsPolicy?: FsPolicyConfig): ToolSpec[] {
  const policy: FsPolicyConfig = fsPolicy ?? { protected: ['.git', '.git/**'], denyRead: [], allow: [] };
  const [read] = createFsTools({ workspaceRoot, fsPolicy: policy });
  return [read!, ...createSearchTools({ workspaceRoot, fsPolicy: policy })];
}

const VERDICTS: ReadonlySet<string> = new Set(['met', 'not_met', 'impossible', 'error']);

/**
 * Review-mode JSON line (task 058): evaluator emits unmet + suggestions so the
 * Internal Reviewer conclusion carries generator-side feedback, not just a verdict.
 */
export const REVIEW_OUTPUT_SCHEMA =
  '只输出一行 JSON：{"verdict":"met|not_met|impossible|error","evidence":["..."],"reason":"...",' +
  '"unmet":["..."],"suggestions":["..."]}（not_met/impossible 时 unmet=未满足的验收标准、suggestions=给生成方的改进建议）';

function buildReviewBrief(req: EvaluationRequest): string {
  const lines = [
    '你是独立 Evaluator Agent。你的评审对象是 Generator 的产出，由你独立判定，不信任任何自证。',
    `目标：${req.goal}`,
  ];
  if (req.acceptance?.length) lines.push(`验收标准：\n${req.acceptance.map((a) => `- ${a}`).join('\n')}`);
  lines.push('Generator 产出（仅供参考，需用证据核验）：\n' + req.generatorOutput.slice(0, 8000));
  if (req.evidencePaths?.length) {
    lines.push('可用只读证据（可用 Read/Glob/Grep 检查）：\n' + req.evidencePaths.map((p) => `- ${p}`).join('\n'));
  }
  lines.push('');
  lines.push(req.review ? REVIEW_OUTPUT_SCHEMA : '只输出一行 JSON：{"verdict":"met|not_met|impossible|error","evidence":["..."],"reason":"..."}');
  return lines.join('\n');
}

/**
 * 容错解析评审/评估 JSON（单一实现，供 evaluator 会话与 TeamRuntime/InternalReviewer 共用）：
 * 优先整段 JSON，其次抽取文本中的 {…} 对象；verdict 不合法 → verdict 'error'
 * （如实暴露、绝不误判 met，Generator 不得自证完成）。文本前后可有叙述（真实模型常见）。
 * review 模式要求 unmet/suggestions，缺省给空数组（verdict 模式不受影响）。
 */
export function parseVerdict(text: string): EvaluatorVerdict {
  const candidates = [text.trim(), /(\{[\s\S]*\})/.exec(text)?.[1] ?? ''];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const parsed = JSON.parse(c) as { verdict?: string; evidence?: unknown; reason?: unknown; unmet?: unknown; suggestions?: unknown };
      if (parsed.verdict && VERDICTS.has(parsed.verdict)) {
        return {
          verdict: parsed.verdict as EvaluatorVerdictKind,
          evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
          reason: typeof parsed.reason === 'string' ? parsed.reason : 'no reason',
          unmet: Array.isArray(parsed.unmet) ? parsed.unmet.map(String) : [],
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [],
        };
      }
    } catch {
      // try next candidate
    }
  }
  return { verdict: 'error', evidence: [], reason: `evaluator agent output is not a valid verdict JSON: ${text.slice(0, 200)}`, unmet: [], suggestions: [] };
}

/**
 * 评审回合的 stopReason —— **复用**既有契约词汇表 `SubagentResultContract['stopReason']`
 * （EVENT-SPEC A24 / H11），不新造词。
 */
export type EvaluatorStopReason = SubagentResultContract['stopReason'];

/**
 * 回合裁决结果：stopReason / isError / verdict 三者一次性定死，是 `evaluate()` 消费
 * `TurnResult` 的**唯一**落点（也因此可直接被测试驱动，覆盖 success/error/budget/interrupted 四种 kind）。
 */
export interface EvaluatorTurnOutcome {
  /** 由 `turn.kind` 决定（见 mapTurnKindToStopReason），不再是无条件常量。 */
  stopReason: EvaluatorStopReason;
  /** 与 stopReason 一致的失败位（口径见 resolveEvaluatorTurnOutcome）。 */
  isError: boolean;
  /** 交给调用方的评审结论（未跑完的回合强制为 'error'，绝不产出"有效 verdict"）。 */
  verdict: EvaluatorVerdict;
}

/**
 * `turn.kind` → `stopReason` 的映射**不再是本文件的实现**（BRIEF「同一件事三处实现、两套口径」）。
 *
 * 本文件原先自带一份 switch（旧 `mapTurnKindToStopReason`），与
 * `subagent/SubagentManager.ts` 的私有 `mapTurnKind` **逐字重复**（两份实现、同一口径），
 * 而 `team/TeamRuntime.ts` 又是第三套口径（原样吐 kind ⇒ 越词表）。现三处一律调用
 * `../turnStopReason.js` 的 `mapTurnKindToStopReason`（单一实现、单一词表，见该模块的映射表）：
 *
 * - `success`     → `'completed'`
 * - `error`       → `'error'`      （DenialLimitError 熔断等：AgentLoop.ts:334-338 **正常返回** kind='error'）
 * - `budget`      → `'max_tokens'` （步数预算耗尽）
 * - `interrupted` → `'aborted'`    （用户/父级中断）
 *
 * 为什么 interrupted 映射到 `'aborted'` 而不是 `'error'`：中断是"被外部叫停"，不是评审自身失败；
 * A24 词表里 `aborted` 就是为它准备的既有值。两者对**verdict** 的后果相同（都强制 'error'）
 * ——"没跑完"不因中止原因而变成有效结论。
 *
 * `EvaluatorStopReason` 保留为与契约**同源**的类型别名（`SubagentResultContract['stopReason']`，
 * 不新造词、不会漂移）。
 */

/**
 * BRIEF — EvaluatorAgent 对 `kind='error'`（及 budget/interrupted）的回合此前**无条件**上报
 * `stopReason:'completed'`（旧 EvaluatorAgent.ts:160），于是"这轮评审其实没跑完"对上游不可见；
 * 同一处还用 `verdict==='error'` 冒充回合成败。此处按 kind 如实裁决：
 *
 * 1. `stopReason = mapTurnKindToStopReason(turn.kind)`——由**回合结果**决定，不是常量；
 * 2. `isError = stopReason !== 'completed' || verdict.verdict === 'error'`。前者是 EVENT-SPEC
 *    A24 / H11 的硬要求（"stopReason≠completed 一律 isError"，docs/EVENT-SPEC.md:391）与
 *    SubagentManager 先例（:350）；后者保留 evaluator 既有的"解析不出 verdict 也算失败"信号。
 *    这是两者的**并集**：相对旧实现只增不减（绝不放宽判据），kind='success' 回合的 isError
 *    与旧实现逐字相同（仍只由 verdict 决定）；
 * 3. **未跑完的回合不产出"有效 verdict"**：verdict 强制为既有词表的 `'error'`（不新增 'unknown'
 *    一类词），evidence/unmet/suggestions 一律留空，kind/stopReason 与原文写在 reason 里可读可核。
 *    若沿用解析结果，一个 budget/interrupted 的回合可能带着半截 JSON 被当成正常评审结论；
 *    'met' 是最危险的误报（生成方自证完成），'not_met'/'impossible' 也是无根据的语义断言。
 *
 * kind='success' 分支**完全**走 parseVerdict，不做任何改写（旧行为逐字不变）。
 */
export function resolveEvaluatorTurnOutcome(turn: Pick<TurnResult, 'kind' | 'finalText'>): EvaluatorTurnOutcome {
  const stopReason = mapTurnKindToStopReason(turn.kind);
  const parsed = parseVerdict(turn.finalText);
  if (stopReason === 'completed') {
    return { stopReason, isError: parsed.verdict === 'error', verdict: parsed };
  }
  const detail = turn.finalText.trim() === '' ? '(no final text)' : turn.finalText.slice(0, 200);
  return {
    stopReason,
    isError: true,
    verdict: {
      verdict: 'error',
      evidence: [],
      reason:
        `evaluator turn did not complete (kind=${turn.kind}, stopReason=${stopReason}) — ` +
        `未跑完的评审回合不产出有效 verdict；raw final text: ${detail}`,
      unmet: [],
      suggestions: [],
    },
  };
}

/**
 * Evaluator Agent (ARCHITECTURE §4.10 / D3 decision point 12 / H12) — the
 * independent-review agent FORM of the Evaluator contract.
 *
 * Runs in an ISOLATED session (source='evaluator') with a read-only tool set,
 * reviewing the generator's output + read-only disk evidence. It emits
 * met/not_met/impossible/error + evidence. The generator never self-declares
 * completion: its output is data for this agent to verify, not proof.
 */
export class EvaluatorAgent {
  private readonly tools: ToolSpec[];
  private readonly opts: EvaluatorAgentOptions;

  constructor(opts: EvaluatorAgentOptions) {
    this.opts = opts;
    this.tools = opts.tools ?? createReadOnlyExplorationTools(path.resolve(opts.workspaceRoot));
  }

  get visibleTools(): readonly ToolSpec[] {
    return this.tools;
  }

  async evaluate(req: EvaluationRequest): Promise<EvaluatorVerdict> {
    const runtime = await createIsolatedRuntime({
      workspaceRoot: path.resolve(this.opts.workspaceRoot),
      cwd: this.opts.cwd,
      provider: this.opts.provider,
      model: this.opts.model,
      policyArtifacts: this.opts.policyArtifacts,
      tools: this.tools,
      source: 'evaluator',
      agentPreset: this.opts.agentPreset,
      delegationDepth: req.delegationDepth ?? 0,
      stableSections: this.opts.stableSections,
      policyGuidance: this.opts.policyGuidance,
    });
    try {
      // A23/A24 mirrors: the evaluator child is observable on the parent bus.
      //
      // BRIEF-delegateId 不成对：A23 与 A24 的 `delegateId` 是**同一次委派**的关联键
      // （EVENT-SPEC A23/A24 是同一个字段名，docs/EVENT-SPEC.md:384/391），必须由 start 建立、
      // 由 stop 用**同一个字符串**闭合。旧实现两处各自现算：start = `eval_${Date.now()}_${hex}`、
      // stop = `eval_${Date.now()}` —— 两者永不相等，于是所有按 id 反查的消费方（如
      // application/src/projections/TeamProjection.ts:195-205，反查不到那一行就直接 `return`）
      // **永远收不到 evaluator 的 stop**：stopReason / isError / durationMs / 产出预览全部静默丢失
      // —— 「行为正确 ≠ 可观测」。
      // 因此这里**只生成一次**、两处引用同一个常量。格式沿用 start 既有形状（毫秒 + 3 字节随机
      // 后缀，同毫秒的两次评审不会撞 id）；stop 因此由 `eval_<ts>` 变为 `eval_<ts>_<hex>`
      // —— 这是**有意的修正**（见同目录 evaluator-agent.test.ts 的 BRIEF 用例组）。
      const delegateId = `eval_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      if (this.opts.bus) {
        await this.opts.bus.emit('subagent_start', {
          delegateId,
          childAgentId: `eval_agent_${runtime.session.sessionId}`,
          childSessionId: runtime.session.sessionId,
          preset: this.opts.agentPreset ?? 'evaluator',
          isContinuable: false,
        });
      }
      const turn = await runtime.loop.runTurn(buildReviewBrief(req));
      // BRIEF: stopReason/isError 由 turn.kind 决定，verdict 在回合未跑完时被强制为 'error'
      const outcome = resolveEvaluatorTurnOutcome(turn);
      if (this.opts.bus) {
        await this.opts.bus.emit('subagent_stop', {
          // 与上面 subagent_start **同一个** delegateId（A24 与 A23 共用同一次委派的关联键）
          delegateId,
          childAgentId: `eval_agent_${runtime.session.sessionId}`,
          childSessionId: runtime.session.sessionId,
          result: {
            output: turn.finalText,
            stopReason: outcome.stopReason,
            // 仅在**回合未跑完**时附带诊断：kind='success' 的载荷因此逐字不变（仍是 {output, stopReason}）
            ...(outcome.stopReason === 'completed'
              ? {}
              : { diagnostic: `evaluator turn ended with kind=${turn.kind}` }),
          },
          isError: outcome.isError,
          durationMs: turn.durationMs,
          delegationDepth: req.delegationDepth ?? 0,
        });
      }
      return outcome.verdict;
    } finally {
      await runtime.close();
    }
  }
}
