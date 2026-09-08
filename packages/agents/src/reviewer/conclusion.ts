/**
 * agents/reviewer — Internal Review 结构化结论协议（task 058）。
 *
 * 单一事实源 = evaluator/EvaluatorAgent.ts 的 review 输出模式（REVIEW_OUTPUT_SCHEMA 提示行 +
 * parseVerdict 解析）：reviewer 角色 ≡ evaluator 角色（055 presets 判别），评审结论 JSON 协议
 * 归 evaluator agent form 所有，本文件只做领域侧类型镜像 + 再导出，避免两处解析逻辑漂移。
 *
 * 结论形状（可注入/可断言）：verdict(met/not_met/impossible/error) + reason + unmet（未满足的
 * 验收标准）+ suggestions（给生成方的改进建议）+ evidence。not_met 时 unmet/suggestions 即
 * 返回给生成侧的可回读反馈（rework 循环基础，Wave 3）。
 *
 * 消费方：
 * - EvaluatorAgent review 模式（内部使用同一实现）；
 * - TeamRuntime evaluate 成员产出（成员会话按同 schema 回复后，解析附到成员摘要/投影）；
 * - InternalReviewer（独立 Internal Review 调用流程）。
 */
import type { TeamReviewConclusion, TeamReviewVerdict } from '@vessel/shared';
import { parseVerdict, REVIEW_OUTPUT_SCHEMA } from '../evaluator/EvaluatorAgent.js';

export type ReviewVerdictKind = TeamReviewVerdict;

/** 评审结论 —— 与 @vessel/shared TeamReviewConclusion（事件/投影载荷镜像）同形状。 */
export type ReviewConclusion = TeamReviewConclusion;

export { REVIEW_OUTPUT_SCHEMA };

/**
 * 容错解析评审结论（委托 evaluator parseVerdict —— 单一实现）：
 * 优先整段 JSON，其次抽取文本中的 {…} 对象；verdict 不合法 → verdict 'error'
 * （如实暴露、绝不误判 met，Generator 不得自证完成）。
 */
export function parseReviewConclusion(text: string): ReviewConclusion {
  const v = parseVerdict(text);
  return {
    verdict: v.verdict,
    evidence: v.evidence,
    reason: v.reason,
    unmet: v.unmet ?? [],
    suggestions: v.suggestions ?? [],
  };
}
