/**
 * engine/handoff/HandoffTrigger — Context Reset 的触发条件（task 067）。
 *
 * 与 Compaction 的触发并存但分层：Compaction 在 0.8×contextWindow 压力阈值处压缩
 * （packages/context/src/compaction/Compaction.ts shouldCompact）；Context Reset 是
 * 更大的动作（全新上下文 + 结构化交接），默认在更晚的 0.9×contextWindow（budget）或
 * 会话长度阈值（recordCount）到达时生成 handoff 供续跑 —— compact 先于 reset，reset
 * 是压缩多次后仍接近上限的最后手段（§12：不要只靠无限 compact）。
 *
 * 纯函数（可单测）；066 budget（RunControl）与 065 Goal UI 的可见 seam 均通过
 * shouldGenerateHandoff / handoffSeamState 表达，UI/HTTP 接入只消费该纯状态。
 */

/** 缺省 reset 压力阈值比 —— 高于 Compaction 的 0.8（先 compact，后 reset）。 */
export const HANDOFF_THRESHOLD_RATIO = 0.9;
/** 缺省会话长度阈值（条数）—— 会话记录数到达即建议 reset（配合长度阈值触发）。 */
export const HANDOFF_LENGTH_THRESHOLD = 1500;

/** 触发原因：budget（上下文预算比例）/ length（会话长度）/ manual（强制）/ null（未触发）。 */
export type HandoffTriggerReason = 'budget' | 'length' | 'manual' | null;

export interface HandoffTriggerOptions {
  /** 上下文预算触发比例（缺省 0.9 —— 晚于 Compaction 0.8）。 */
  thresholdRatio?: number;
  /** 会话长度阈值（记录条数；缺省 1500）。 */
  lengthThreshold?: number;
  /** 强制生成（manual 触发，无视阈值）。 */
  force?: boolean;
}

export interface HandoffTriggerDecision {
  generate: boolean;
  reason: HandoffTriggerReason;
}

/**
 * 触发判定（纯函数）：estimateTokens >= ratio×contextWindow → 'budget'；
 * recordCount >= lengthThreshold → 'length'；force → 'manual'。
 * budget 优先于 length（更明确的「上下文将满」信号）；阈值非法（ratio ≤0/≥1 等）
 * fail loud = 调用方 bug。
 */
export function shouldGenerateHandoff(
  estimateTokens: number,
  contextWindow: number,
  recordCount: number,
  opts: HandoffTriggerOptions = {},
): HandoffTriggerDecision {
  const ratio = opts.thresholdRatio ?? HANDOFF_THRESHOLD_RATIO;
  const length = opts.lengthThreshold ?? HANDOFF_LENGTH_THRESHOLD;
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
    throw new Error(`handoff trigger: thresholdRatio must be in (0,1), got ${ratio}`);
  }
  if (!Number.isFinite(length) || length < 1) {
    throw new Error(`handoff trigger: lengthThreshold must be an integer ≥ 1, got ${length}`);
  }
  if (opts.force) return { generate: true, reason: 'manual' };
  if (Number.isFinite(estimateTokens) && Number.isFinite(contextWindow) && estimateTokens >= ratio * contextWindow) {
    return { generate: true, reason: 'budget' };
  }
  if (recordCount >= length) return { generate: true, reason: 'length' };
  return { generate: false, reason: null };
}

/**
 * 065 Goal UI 可见 seam 的纯状态（不深做 UI）：给定运行上下文（任务 id + 估算 token
 * + contextWindow + 会话记录数 + 最近 handoff id），输出「是否生成 + 原因 + 最近
 * handoff」—— Goal UI 后续接入只读此状态即可展示/触发。本卡只提供 seam。
 */
export interface HandoffRunState {
  taskId?: string;
  generate: boolean;
  reason: HandoffTriggerReason;
  estimateTokens: number;
  contextWindow: number;
  recordCount: number;
  /** 该任务最近一次生成的 handoff id（若有；新 Agent 续跑入口）。 */
  latestHandoffId?: string;
}

export function handoffSeamState(input: {
  taskId?: string;
  estimateTokens: number;
  contextWindow: number;
  recordCount: number;
  latestHandoffId?: string;
  opts?: HandoffTriggerOptions;
}): HandoffRunState {
  const decision = shouldGenerateHandoff(input.estimateTokens, input.contextWindow, input.recordCount, input.opts);
  return {
    taskId: input.taskId,
    generate: decision.generate,
    reason: decision.reason,
    estimateTokens: input.estimateTokens,
    contextWindow: input.contextWindow,
    recordCount: input.recordCount,
    latestHandoffId: input.latestHandoffId,
  };
}
