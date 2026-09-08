/**
 * engine/RunControl — run-time control seam: pause/resume + iteration/retry
 * budget (task 066). docs/Vessel_后续开发方向与产品化路线_v1.0.md §11.1:
 * default autonomy is maxIterations=1 / maxRetries=1 — only relaxed on explicit
 * user entry into Goal / Loop Mode. This object is the shared, mutable control
 * surface the LoopEngine consults at every iteration/attempt boundary and that
 * the UI / HTTP seam drives (pause → suspend, resume → continue, setBudget →
 * tighten/loosen the cap).
 *
 * 与 050 InterruptController 的语义区分（务必保持）：
 *  - interrupt（050）＝ 终止（abort）：abort 信号，正在进行的 turn 以 kind='interrupted'
 *    结束，不可恢复；
 *  - pause/resume（本卡）＝ 挂起/恢复：绝不 abort。pause 只在边界打开一个
 *    pending-gate（resume 解析该 gate），边界上 await 到这个 gate 才挂起；
 *    恢复后在原边界继续（同一个 iteration/attempt 继续跑，绝不丢半步）。
 *
 * 并发模型：pause/resume 都是幂等门控；多个 pause 只产生一个 gate（重复 pause
 * 是 no-op），resume 一次性释放 gate 并复位 paused。恢复采用「读完当前 gate 闭包
 * 的释放函数」而非布尔翻转，避免「pause→resume 快速来回」把旧的 gate 泄漏给新边界。
 *
 * Budget exhaustion：maxIterations 用尽 = 外层迭代循环第 maxIterations 次之后停止；
 * maxRetries 用尽 = 某 iteration 内 attempt 数 = maxRetries+1 后以 not_met/… admit。
 * RunControl 记录最后一次预算咨询触发的 exhaust（exhausted iter/retry 哨兵），
 * 调用方可查询「为什么停」。
 */

/** 一次 budget 快照（查询/设置共用）。 */
export interface RunBudget {
  /** 外层最大迭代轮数（§11.1 默认 1） */
  maxIterations: number;
  /** 每 iteration 的最大 generate→evaluate 重试数（§11.1 默认 1） */
  maxRetries: number;
}

/** 预算用尽的哨兵：明确「为什么停」。 */
export type RunExhausted =
  | { kind: 'iterations'; atIteration: number }
  | { kind: 'retries'; atIteration: number; attempt: number }
  | null;

/** RunControl 对外可读状态快照（供 UI / 测试断言）。 */
export interface RunControlState {
  paused: boolean;
  budget: RunBudget;
  /** 最近一次预算触发用尽的哨兵；null = 未触发（仍可继续）。 */
  exhausted: RunExhausted;
}

/** 把外来 budget 字段归一为合法值（越界 fail loud = 调用方 bug，不静默 clamp）。 */
function normalizeBudget(b: Partial<RunBudget>): RunBudget {
  const maxIterations = b.maxIterations ?? 1;
  const maxRetries = b.maxRetries ?? 1;
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new Error(`RunControl: maxIterations must be an integer ≥ 1 (got ${maxIterations})`);
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error(`RunControl: maxRetries must be an integer ≥ 0 (got ${maxRetries})`);
  }
  return { maxIterations, maxRetries };
}

/**
 * RunControl —— 引擎运行控制门（pause/resume + budget）。
 *
 * - pause()：在下一个迭代/attempt 边界挂起（等价于「下一跳不执行」）；不 abort，
 *   不丢当前迭代。返回 true = 本次真正置位；false = 已挂起（幂等 no-op）。
 * - resume()：释放挂起 gate，边界继续。返回 true = 本次真正恢复；false = 未挂起（no-op）。
 * - getBudget()/setBudget()：查询/设置 maxIterations/maxRetries（默认 1/1，§11.1）。
 * - awaitIterationBoundary()/awaitAttemptBoundary()：LoopEngine 在边界 await；
 *   若已 pause 则挂起直到 resume。
 */
export class RunControl {
  /** 挂起 gate —— 非 null 表示边界需等待该 promise；resume 解析之。 */
  private gate: Promise<void> | null = null;
  /** 定义在 gate 上的释放函数（读取时快照，避免旧 gate 泄漏给新边界）。 */
  private release: (() => void) | null = null;
  /** 当前是否处于挂起状态（resume() 回 false 的判据）。 */
  private pausedFlag = false;

  private budget: RunBudget;
  private exhaustedFlag: RunExhausted = null;

  constructor(initial?: Partial<RunBudget>) {
    this.budget = normalizeBudget(initial ?? {});
  }

  // -- pause / resume -------------------------------------------------------

  /** 是否处于挂起状态（UIt 查询）。 */
  get paused(): boolean {
    return this.pausedFlag;
  }

  /**
   * 挂起：打开一个 awaitable gate。幂等 —— 已挂起再 pause 是 no-op（返回 false）。
   * 挂起只在边界生效：已越过边界的 in-flight generate/evaluate 继续跑完，
   * 下一跳（下一次迭代 select / 下一次 attempt generate）才会被 gate 挡下。
   */
  pause(): boolean {
    if (this.pausedFlag) return false;
    let resolve: () => void = () => {};
    const gate = new Promise<void>((r) => {
      resolve = r;
    });
    this.gate = gate;
    this.release = resolve;
    this.pausedFlag = true;
    return true;
  }

  /**
   * 恢复：释放挂起 gate。幂等 —— 未挂起再 resume 是 no-op（返回 false）。
   * 恢复后边界原样继续（同一个 iteration/attempt 接着跑），不丢半步、不 abort。
   */
  resume(): boolean {
    if (!this.pausedFlag) return false;
    const r = this.release;
    this.gate = null;
    this.release = null;
    this.pausedFlag = false;
    if (r) r();
    return true;
  }

  // -- budget ---------------------------------------------------------------

  /** 当前 budget 快照（maxIterations/maxRetries，默认 1/1）。 */
  getBudget(): RunBudget {
    return { maxIterations: this.budget.maxIterations, maxRetries: this.budget.maxRetries };
  }

  /** 设置 maxIterations/maxRetries（§11.1：默认 1/1，Goal/Loop 模式放宽时调高）。 */
  setBudget(update: Partial<RunBudget>): RunBudget {
    this.budget = normalizeBudget({ ...this.budget, ...update });
    return this.getBudget();
  }

  /**
   * 预算是否已用尽（可查「为什么停」）。null = 未触发。
   * 由 LoopEngine 在边界咨询（iterations）或末次 attempt admit 时标记（retries）。
   */
  get exhausted(): RunExhausted {
    return this.exhaustedFlag;
  }

  /**
   * 记录 maxRetries 用尽（该迭代以最后一次 evaluator verdict admit，未 met）。
   * 由 LoopEngine 在 retry 循环末次 attempt 调用；幂等（只记第一次用尽）。
   */
  noteRetryExhausted(iteration: number, attempt: number): void {
    if (this.exhaustedFlag) return;
    this.exhaustedFlag = { kind: 'retries', atIteration: iteration, attempt };
  }

  /** 状态快照（UI / 测试断言用：paused + budget + exhausted）。 */
  state(): RunControlState {
    return {
      paused: this.pausedFlag,
      budget: this.getBudget(),
      exhausted: this.exhaustedFlag,
    };
  }

  // -- engine 边界咨询（LoopEngine 调用；不对外暴露语义） --------------------

  /**
   * 迭代边界：await 到当前挂起 gate 被释放（resume）后继续。若预算用尽，置
   * exhausted 哨兵并返回 false，让外层循环停止；返回 true = 该轮可继续执行。
   */
  async awaitIterationBoundary(iteration: number): Promise<boolean> {
    if (this.pausedFlag) {
      const gate = this.gate;
      if (gate) await gate;
      // 恢复后继续原迭代（原样，不丢半步）
    }
    if (iteration > this.budget.maxIterations) {
      this.exhaustedFlag = { kind: 'iterations', atIteration: iteration };
      return false;
    }
    return true;
  }

  /**
   * attempt 边界：仅 await 挂起 gate（恢复继续同一个 attempt）；不咨询 iteration
   * 预算（那是外层负责）。返回该 attempt 是否仍在预算内（attempt > maxRetries+1
   * 由内层 attempts 上限约束，这里只返回 true —— 调用方已按 budget 建 attempts 循环）。
   */
  async awaitAttemptBoundary(): Promise<void> {
    if (this.pausedFlag) {
      const gate = this.gate;
      if (gate) await gate;
    }
  }
}

/** 纯函数便捷：白手起家建一个默认 1/1 的 RunControl（无 control 时 LoopEngine 兜底）。 */
export function createDefaultRunControl(): RunControl {
  return new RunControl({ maxIterations: 1, maxRetries: 1 });
}