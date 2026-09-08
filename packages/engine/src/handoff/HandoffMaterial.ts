import type { IterationEntry } from '../iteration-store.js';
import type { QueueTask } from '../project-task-queue.js';
import type { HandoffMaterial } from './Handoff.js';

/**
 * engine/handoff/HandoffMaterial — handoff 素材聚合（task 067「素材来源」）。
 *
 * §12 九字段的素材取自 063 IterationStore（per-task 迭代日志：verdict/evidence/reason/
 * outputPath/testResults/transition）与 063 任务对象（QueueTask：goal/acceptance/
 * projectRoot/status）以及 064 清理前快照（改动文件/测试/证据 —— snapshot 入参，由
 * 调用方在清理前收集）。聚合产物是纯 JSON 安全的 HandoffMaterial，直接喂
 * HandoffStore.create / buildHandoff。素材不足的字段给安全缺省（[] / ''），
 * goal 恒取自任务（构建期非空校验兜底）。
 *
 * 映射规则（可单测断言）：
 * - goal / taskId / projectRoot / acceptance ← 任务对象（透传）；
 * - completed ← 迭代中 verdict==='met' 的条目（iter N: reason）；
 * - decisions ← 每条迭代的 verdict+reason（一次迭代 = 一个决策点）；
 * - blockers ← verdict 为 not_met/impossible/error 的条目 reason（+ snapshot.blockers）；
 * - evidence ← 迭代 evidence 数组 + outputPath + snapshot.evidence；
 * - tests ← snapshot.tests + 迭代 testResults（非空）；
 * - nextActions ← 派生：无迭代 → 第一轮；末次 met → 收尾；否则 → 下一轮 + 阻塞摘要；
 * - currentState ← 任务状态 + 迭代数 + snapshot.currentState（现状/进展）。
 */

/** 064 清理前快照（调用方在清理/退出前收集的运行事实）。 */
export interface HandoffSnapshot {
  /** 当前状态描述（进展/现状）；可多行。 */
  currentState?: string;
  /** 本运行轮次改动文件（064 清理前快照）。 */
  changedFiles?: readonly string[];
  /** 测试结果清单（命令 + 输出摘要）。 */
  tests?: readonly string[];
  /** 证据（命令输出/路径/引用）。 */
  evidence?: readonly string[];
  /** 阻塞项（运行侧追加的 blockers）。 */
  blockers?: readonly string[];
}

export interface CollectHandoffMaterialInput {
  /** 063 任务对象（QueueTask；goal/acceptance 透传进 handoff）。 */
  task: Pick<QueueTask, 'id' | 'goal' | 'acceptance' | 'projectRoot' | 'status'>;
  /** 063 IterationStore 回放（该任务全部迭代，序数 1..n；缺省 []）。 */
  iterations?: readonly IterationEntry[];
  /** 064 清理前快照（缺省空）。 */
  snapshot?: HandoffSnapshot;
}

/** 迭代结论摘要：`iter N: <verdict> — <reason>`（reason 空则只 verdict）。 */
function verdictLine(it: IterationEntry): string {
  return it.reason ? `iter ${it.iteration}: ${it.verdict} — ${it.reason}` : `iter ${it.iteration}: ${it.verdict}`;
}

/** 派生 next_actions：从迭代历史推导「下一步做什么」（无 LLM，确定性规则）。 */
function deriveNextActions(iterations: readonly IterationEntry[], blockers: readonly string[]): string[] {
  if (iterations.length === 0) return ['开始第一轮迭代（从 handoff.goal 起）'];
  const last = iterations[iterations.length - 1]!;
  if (last.verdict === 'met') {
    return ['验收已 met：收尾提交（核对 changed_files 与 tests 证据后提交）'];
  }
  const blockHint = blockers.length > 0 ? `；阻塞：${blockers.join('; ')}` : '';
  return [`继续第 ${iterations.length + 1} 轮迭代（上一轮 ${last.verdict}：${last.reason || '无理由'}${blockHint}）`];
}

/**
 * 聚合素材 → HandoffMaterial（纯函数；JSON 安全）。素材字段全部归一；
 * goal 空时由 buildHandoff 的校验兜底 fail loud。
 */
export function collectHandoffMaterial(input: CollectHandoffMaterialInput): HandoffMaterial {
  const iterations = input.iterations ?? [];
  const snapshot = input.snapshot ?? {};
  const met = iterations.filter((it) => it.verdict === 'met').map(verdictLine);
  const decisions = iterations.map(verdictLine);
  const blockers = [
    ...iterations
      .filter((it) => it.verdict === 'not_met' || it.verdict === 'impossible' || it.verdict === 'error')
      .map((it) => verdictLine(it)),
    ...(snapshot.blockers ?? []),
  ];
  const evidence = [
    ...iterations.flatMap((it) => it.evidence ?? []),
    ...iterations
      .map((it) => it.outputPath)
      .filter((p): p is string => typeof p === 'string' && p !== ''),
    ...(snapshot.evidence ?? []),
  ];
  const tests = [
    ...(snapshot.tests ?? []),
    ...iterations.map((it) => it.testResults).filter((t): t is string => typeof t === 'string' && t.trim() !== ''),
  ];
  const status = input.task.status;
  const iterationCount = iterations.length;
  const currentStateParts = [
    `任务状态：${status}；已完成迭代：${iterationCount}`,
    ...(snapshot.currentState ? [snapshot.currentState] : []),
  ];

  return {
    goal: input.task.goal,
    completed: met,
    current_state: currentStateParts.join('\n'),
    changed_files: [...(snapshot.changedFiles ?? [])],
    tests,
    decisions,
    blockers,
    next_actions: deriveNextActions(iterations, blockers),
    evidence,
    taskId: input.task.id,
    acceptance: [...(input.task.acceptance ?? [])],
    projectRoot: input.task.projectRoot,
  };
}
