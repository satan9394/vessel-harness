/**
 * agents/turnStopReason — `turn.kind` → `stopReason` 的**唯一实现**（BRIEF「同一件事三处实现、
 * 两套口径」）。
 *
 * 背景（改前的事实，逐条可核）：
 * - `subagent/SubagentManager.ts:424-435` 与 `evaluator/EvaluatorAgent.ts:138-149` 是**两份逐字
 *   重复的 switch**（同一组 kind、同一组结果，各自维护 ⇒ 改一处不会带动另一处）；
 * - `team/TeamRuntime.ts:259` 是**第三套口径**：`stopReason: turn.kind === 'success' ? undefined
 *   : turn.kind` —— 直接把**回合 kind** 当 `stopReason` 输出，于是会产出 `'budget'`/`'interrupted'`，
 *   而 `SubagentResultContract.stopReason`（packages/shared/src/events.ts:242）的词表是
 *   `'completed' | 'aborted' | 'error' | 'max_tokens' | 'refusal' | 'denied'` —— **不含**这两个值。
 *
 * 本模块把口径收敛为**一份词表、一个函数**，三处消费点（evaluator / subagent / team）一律调用它：
 *
 * | `TurnResult.kind` | `stopReason`（契约词表内） | 依据 |
 * | --- | --- | --- |
 * | `success`     | `'completed'` | 正常收尾 |
 * | `error`       | `'error'`     | DenialLimitError 熔断 / BeforeTurn 拒绝 / finishReason='length' 截断 |
 * | `budget`      | `'max_tokens'`| 本回合**步数预算**耗尽（AgentLoop 的 maxSteps 兜底） |
 * | `interrupted` | `'aborted'`   | 被外部叫停（用户/父级中断），不是自身失败 |
 *
 * **`isError` 与 `stopReason` 的关系**（EVENT-SPEC A24 / H11，docs/EVENT-SPEC.md:391）：
 * `isError === (stopReason !== 'completed')` —— 单向蕴含的硬要求，两个方向的消费点都照此：
 * `SubagentManager:350` 的严格等式、`EvaluatorAgent.resolveEvaluatorTurnOutcome` 的并集
 * （`stopReason !== 'completed' || verdict === 'error'`，只增不减）、`TeamRuntime` 的
 * `status === 'failed'`（该结构没有 `isError` 字段，用 status 承载同一判断）。
 * 即：**任何非 `'completed'` 的收尾都不得被读成"这轮跑完了"**；反过来 `'completed'` 也不等于
 * "结论有效"（evaluator 的 verdict 解析失败仍算失败）。
 *
 * 为什么放在 `packages/agents` 而不是 `packages/shared`：本映射的**输入** `TurnResult['kind']`
 * 属 `@vessel/core`，**输出** `SubagentResultContract['stopReason']` 属 `@vessel/shared`；
 * 提到 shared 会让 shared 要么反向依赖 core，要么把 kind 联合**再抄一份**（正是本卡要消灭的
 * 第二套口径）。影响面与最小改法见交付⑤（只报告，本卡未动 shared/core）。
 */
import type { TurnResult } from '@vessel/core';
import type { SubagentResultContract } from '@vessel/shared';

/** 回合 kind —— 与 core `TurnResult['kind']` **同源**（不复制联合：core 增删取值即编译期报错）。 */
export type TurnKind = TurnResult['kind'];

/** 结果契约词表 —— 与 shared `SubagentResultContract['stopReason']` **同源**（不会漂移）。 */
export type TurnStopReason = SubagentResultContract['stopReason'];

/**
 * 全仓**唯一**的一份 `kind → stopReason` 词表。
 *
 * `satisfies Record<TurnKind, TurnStopReason>` 是刻意的双重约束：
 * 左侧必须**穷尽** `TurnKind`（core 新增一个 kind ⇒ 此处编译期报错，绝不静默返回 undefined），
 * 右侧每个值必须落在 `SubagentResultContract.stopReason` 词表内（写错词 ⇒ 同样编译期报错）。
 */
const STOP_REASON_BY_TURN_KIND = {
  success: 'completed',
  error: 'error',
  budget: 'max_tokens',
  interrupted: 'aborted',
} as const satisfies Record<TurnKind, TurnStopReason>;

/**
 * `turn.kind` → `stopReason`。三处消费点（`SubagentManager`、`EvaluatorAgent`、`TeamRuntime`）
 * 一律调用本函数；改这里即三处同时变（回归护栏见 turnStopReason.test.ts）。
 */
export function mapTurnKindToStopReason(kind: TurnKind): TurnStopReason {
  return STOP_REASON_BY_TURN_KIND[kind];
}
