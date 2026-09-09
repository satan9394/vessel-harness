/**
 * engine/BoundedHistory — V1.1-B 有界环/retention（task 068 soak 发现 adapter history 无界：
 * RealGeneratorAdapter/RealEvaluatorAdapter 的 history 数组单调增长，1801 attempts 后 heap 13.5→24.3MB）。
 *
 * 有界环语义：保最近 N 条（FIFO 覆盖最旧条目）+ 单调 total 计数（覆盖不清零）。
 * - `last`（最近一条）恒可得 —— 消费方只读最近记录的调用点（goalSeam persist 取 generator/evaluator
 *   lastRun 快照）在任意 N 下都正常。
 * - `items`/`toArray()` 返回有界近 N 条（最旧在前，保持原 runs 顺序）。
 * - `total` 单调递增（计入被覆盖的旧条目）—— 计数型消费方不因覆盖失真。
 *
 * 记录完整性（IterationStore append）：IterationStore 不扫描 adapter 全量 history —— append 时以
 * `IterationEntryInput.generator/evaluator` 整记录即时入参落库（goalSeam / soak 均在 persist 时取
 * lastRun 传入）。故有界环只约束 adapter 内存 history，不破坏任何已落库的回放完整性（回放读 store，
 * 不读 adapter）。retention 只影响「adapter 内存内可回首查看的旧记录条数」，不影响持久迭代日志。
 */
export interface BoundedHistory<T> {
  readonly items: readonly T[];
  readonly limit: number;
  readonly total: number;
  readonly last: T | undefined;
}

/**
 * 默认 history 有界上限（V1.1-B）：adapter 内存内保最近 N 条运行/评审记录。
 * 约 6KB/record → 上界 ≈600KB；lastRun 恒在环内可得；runs 返回近 N 条；计数走 total。
 * 不破坏 IterationStore 完整性（append 时 lastRun 整记录即时入参，非全量 history 扫描）。
 */
export const DEFAULT_HISTORY_LIMIT = 100;

/** 环索引的稳定正模函数（JS % 对负数给出负余数 —— 统一规整到 [0, limit)）。 */
function positiveMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * 定长环形缓冲。push 覆盖最旧条目，至多保留 `limit` 条；
 * toArray() 返回最旧在前（与既有 runs 顺序一致）。total 单调递增，覆盖不清零。
 */
export class RingHistory<T> implements BoundedHistory<T> {
  readonly limit: number;
  private readonly buf: T[];
  private head = 0; // 下一个写入槽
  private size = 0; // 有效元素数
  private _total = 0;

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(`historyLimit must be a positive integer, got ${JSON.stringify(limit)}`);
    }
    this.limit = limit;
    this.buf = new Array<T>(limit);
  }

  push(record: T): void {
    this.buf[this.head] = record;
    this.head = (this.head + 1) % this.limit;
    if (this.size < this.limit) this.size += 1;
    this._total += 1;
  }

  /** 最旧在前的有界快照（复制；与既有 runs 数组顺序一致）。 */
  toArray(): T[] {
    const out: T[] = new Array(this.size);
    for (let i = 0; i < this.size; i += 1) {
      out[i] = this.buf[positiveMod(this.head - this.size + i, this.limit)]!;
    }
    return out;
  }

  get items(): readonly T[] {
    return this.toArray();
  }

  get total(): number {
    return this._total;
  }

  get last(): T | undefined {
    return this.size === 0 ? undefined : this.buf[positiveMod(this.head - 1, this.limit)];
  }
}