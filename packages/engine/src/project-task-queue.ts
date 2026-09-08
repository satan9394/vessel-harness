import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LoopTask } from './LoopEngine.js';

/**
 * engine/ProjectTaskQueue — task 063（V1.3 持久 TaskQueue，docs/Vessel_后续开发方向与产品化路线_v1.0.md
 * §11：真实运行链 Task Selection → … → persist 的任务选择来源；供 064 worktree / 066 budget /
 * 065 UI 消费）。
 *
 * 项目级任务的持久队列：`enqueue`（入队）→ `claimNext`/`claim`（dequeue → in-progress）→
 * `settle`（met/not_met 终态）/ `requeue`（开新一轮迭代）/ `cancel`（软移除，无永久删除）。
 * 每个任务 = 一个目录式记录 `<root>/<task-id>/meta.json`，走 059 ReviewHandoffStore 同款模式：
 * 目录 / `<kind>_<ts>_<hex>` id 约定 / tmp+rename 原子写 / env root 覆盖（`VESSEL_TASKQUEUE_ROOT`，
 * 缺省 `~/.vessel/taskqueue`），测试注入 tmp 根。
 *
 * 任务字段对齐 LoopEngine `LoopTask`（id/goal/acceptance —— 061/062 adapter 的 GeneratorRunRequest /
 * EvaluatorRunRequest 同构输入）＋ 项目归属 `projectRoot`（绝对路径；"项目级"即任务按所属项目
 * 入队/领取/过滤）。QueueTask 是 LoopTask 的超集，可直接喂 LoopEngine.runTask。
 *
 * 状态机（本队列的**持久协调**状态；evaluator 的 met/not_met/impossible/error 是每次评审的
 * 瞬时结论，落库后映射为队列终态）：
 *
 *   pending ──claim──▶ in-progress ──settle(met)──▶ met       （终态）
 *       ▲                  │                        ▲
 *       │                  ├──settle(not_met)──────▶│──▶ not_met（终态；可 requeue 开新轮）
 *       │                  ├──cancel───────────────▶│──▶ cancelled（终态：软移除）
 *       │                  ├──pause────────────────▶│──▶ paused（066：挂起可恢复）
 *       │                  │      │                 │
 *       │                  │      └─resume──────────┘（paused → in-progress）
 *       │                  └──requeue───────────────┘
 *       └──── requeue ◀────┘（not_met → pending）
 *
 * 066 pause/resume：`in-progress ⇄ paused`（仅运行中可挂起；paused 是持久可见的
 * 中间态，非 abort，可原样恢复）。其余转移与原一致；pause/resume 与 050 interrupt
 * （中止）语义区分 —— 队列状态机只有「挂起/恢复」两个方向，没有「已中断」终态。
 *
 * 并发安全：单进程同步 IO + 原子 tmp+rename（写坏/半写不可能落盘，崩溃后重读仍完整）；
 * claim 前重读 meta 校验仍为 pending，同进程多实例顺序调用不会重复领取同一个任务。
 * 跨进程无文件锁 —— 多写者需自行串行（上层当前单写者，063 范围不引入锁）。
 */

/** 队列任务状态。 */
export type TaskStatus = 'pending' | 'in-progress' | 'paused' | 'met' | 'not_met' | 'cancelled';

/** evaluator 瞬时结论全集（058/062 语义：met/not_met/impossible/error）。 */
export type TerminalVerdict = 'met' | 'not_met' | 'impossible' | 'error';

/** 队列 settle 终态（met = 满足；其余一律 not_met —— 绝不自证 met）。 */
export type QueueSettleStatus = 'met' | 'not_met';

/**
 * 状态机转移表（只允许表内转移；非法转移 fail loud = 调用方 bug）。
 * 设计：cancel 承接「不做永久删除」的项目铁律（软移除留审计）；not_met → pending 是 requeue
 * （预算/迭代轮次放宽留 066，本卡只提供状态能力）。
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['in-progress', 'cancelled'],
  'in-progress': ['pending', 'paused', 'met', 'not_met', 'cancelled'],
  paused: ['in-progress', 'cancelled'],
  met: [],
  not_met: ['pending'],
  cancelled: [],
};

/** 纯函数：状态机允许 from → to 吗（测试可直接断言）。 */
export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

/** evaluator 瞬时 verdict → 队列 settle 终态（met 之外一律 not_met）。 */
export function queueSettleStatusFromVerdict(verdict: TerminalVerdict): QueueSettleStatus {
  return verdict === 'met' ? 'met' : 'not_met';
}

/** 缺省 taskqueue 根目录：~/.vessel/taskqueue（env VESSEL_TASKQUEUE_ROOT 可覆盖）。 */
export function defaultTaskQueueRoot(home = os.homedir()): string {
  return process.env.VESSEL_TASKQUEUE_ROOT ?? path.join(home, '.vessel', 'taskqueue');
}

/** task id —— 沿用既有 `<kind>_<ts>_<hex>` 约定（sess_/team_/review_ 同款）。 */
export function newTaskId(now = Date.now(), rand = crypto.randomBytes(4).toString('hex')): string {
  return `task_${now}_${rand}`;
}

/** 任务 settle 时的结论快照（回读：为什么终态；iteration 关联 IterationStore 的同次运行）。 */
export interface TaskOutcome {
  /** 队列 settle 终态（status 字段同步） */
  status: QueueSettleStatus;
  /** 原始 evaluator verdict（met/not_met/impossible/error，可回读） */
  verdict: TerminalVerdict;
  reason?: string;
  /** engine 迭代号（IterationStore 关联键，若调用方提供） */
  iteration?: number;
  settledAt: string;
}

/** 队列任务记录（持久化在 <root>/<task-id>/meta.json）。LoopTask 超集：可直接喂 LoopEngine。 */
export interface QueueTask {
  id: string;
  /** 所属项目工作区根（绝对路径；"项目级"归属） */
  projectRoot: string;
  goal: string;
  /** 验收标准（对齐 LoopTask.acceptance —— 评审判据来源，透传不进 developer 自评） */
  acceptance: string[];
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  /** 最近一次 claim（in-progress）的开始时间 */
  startedAt?: string;
  /** 终态时间（met/not_met/cancelled） */
  settledAt?: string;
  outcome?: TaskOutcome;
}

/** enqueue 输入。 */
export interface EnqueueTaskInput {
  projectRoot: string;
  goal: string;
  acceptance?: readonly string[];
}

export interface ProjectTaskQueueOptions {
  /** taskqueue 根目录（缺省 defaultTaskQueueRoot()）；测试注入 tmp */
  tasksRoot?: string;
  /** 时钟注入（测试用；缺省 Date.now） */
  now?: () => number;
}

/** 查询过滤。 */
export interface TaskListOptions {
  /** 只列该项目的任务 */
  projectRoot?: string;
  /** 只列该状态的任务 */
  status?: TaskStatus;
}

/** meta.json 文件名（每条任务记录一个目录）。 */
const META_FILE = 'meta.json';

/** ISO 时间戳。 */
function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

/** 比较器：createdAt 升序（FIFO；同毫秒按 id 字典序，结果确定）。 */
function compareOldestFirst(a: QueueTask, b: QueueTask): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 比较器：createdAt 降序（list 最新在前；同毫秒按 id 逆字典序）。 */
function compareNewestFirst(a: QueueTask, b: QueueTask): number {
  return -compareOldestFirst(a, b);
}

/**
 * ProjectTaskQueue —— 项目级任务的持久队列（目录式记录 + 原子写，059 同款模式）。
 * IO 同步（与 SessionRegistry / ReviewHandoffStore 同风格）。读取容忍损坏条目；写操作
 * 对未知 id / 非法状态转移 / 空 goal fail loud（调用方 bug 如实暴露）。
 */
export class ProjectTaskQueue {
  readonly root: string;
  private readonly now: () => number;

  constructor(opts: ProjectTaskQueueOptions = {}) {
    this.root = path.resolve(opts.tasksRoot ?? defaultTaskQueueRoot());
    this.now = opts.now ?? Date.now;
  }

  /** 任务记录目录：<root>/<task-id>/ */
  dirFor(id: string): string {
    return path.join(this.root, id);
  }

  /** meta.json 完整路径。 */
  metaPath(id: string): string {
    return path.join(this.dirFor(id), META_FILE);
  }

  /** 全部任务（最新 createdAt 在前；损坏条目跳过）—— list 是管理视图。 */
  list(opts: TaskListOptions = {}): QueueTask[] {
    const all = this.readAll();
    const filtered = all.filter((t) => {
      if (opts.projectRoot !== undefined && t.projectRoot !== path.resolve(opts.projectRoot)) return false;
      if (opts.status !== undefined && t.status !== opts.status) return false;
      return true;
    });
    return filtered.sort(compareNewestFirst);
  }

  /** 按 id 读；不存在/损坏 → undefined（registry 同款容忍）。 */
  get(id: string): QueueTask | undefined {
    return this.readMeta(id);
  }

  /**
   * 入队：goal 非空 fail loud；任务落盘 status pending。
   */
  enqueue(input: EnqueueTaskInput, opts: { now?: number; id?: string } = {}): QueueTask {
    if (typeof input.goal !== 'string' || input.goal.trim() === '') {
      throw new Error(`task queue error: enqueue requires a non-empty goal`);
    }
    if (typeof input.projectRoot !== 'string' || input.projectRoot.trim() === '') {
      throw new Error(`task queue error: enqueue requires projectRoot (the owning project workspace)`);
    }
    const tsMs = opts.now ?? this.now();
    const createdAt = isoOf(tsMs);
    const record: QueueTask = {
      id: opts.id ?? newTaskId(tsMs),
      projectRoot: path.resolve(input.projectRoot),
      goal: input.goal,
      acceptance: [...(input.acceptance ?? [])],
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    };
    this.writeMeta(record);
    return record;
  }

  /**
   * dequeue（领取下一个待办）：FIFO 取最早 pending 的任务 → in-progress。
   * 空队列 / 无该项目的 pending → null（与 LoopEngine selectTask null=stop 契约一致）。
   * 领取前重读 meta 校验仍 pending（并发领取不重复）；同进程内绝无重复领取。
   */
  claimNext(opts: { projectRoot?: string } = {}): QueueTask | null {
    const all = this.readAll();
    const project = opts.projectRoot !== undefined ? path.resolve(opts.projectRoot) : undefined;
    const candidates = all
      .filter((t) => t.status === 'pending' && (project === undefined || t.projectRoot === project))
      .sort(compareOldestFirst);
    for (const candidate of candidates) {
      const fresh = this.readMeta(candidate.id);
      if (!fresh || fresh.status !== 'pending') continue; // 已被并发领取/变更 → 跳过
      const now = isoOf(this.now());
      const record: QueueTask = {
        ...fresh,
        status: 'in-progress',
        updatedAt: now,
        startedAt: now,
      };
      this.writeMeta(record);
      return record;
    }
    return null;
  }

  /**
   * 显式领取指定 pending 任务（非 FIFO 入口；已 in-progress/终态 → fail loud）。
   */
  claim(id: string): QueueTask {
    const record = this.transition(id, 'in-progress');
    this.writeMeta(record);
    return record;
  }

  /**
   * settle（终态结论落库）：只允许 in-progress → met/not_met。
   * verdict 是 evaluator 瞬时结论（met/not_met/impossible/error → 队列终态 met/not_met 归一，
   * met 之外一律 not_met，绝不自证 met）。outcome 快照留原始 verdict/reason/iteration 可回读。
   */
  settle(id: string, verdict: TerminalVerdict, opts: { reason?: string; iteration?: number } = {}): QueueTask {
    const status = queueSettleStatusFromVerdict(verdict);
    const now = isoOf(this.now());
    const record = this.transition(id, status);
    record.outcome = {
      status,
      verdict,
      reason: opts.reason,
      iteration: opts.iteration,
      settledAt: now,
    };
    record.settledAt = now;
    this.writeMeta(record);
    return record;
  }

  /**
   * requeue：in-progress（中断/工作区失败）或 not_met（评估未过，预算允许开新轮）→ pending。
   * 清除 outcome/settledAt/startedAt（新一轮从零开始；运行留痕归 IterationStore）。
   */
  requeue(id: string): QueueTask {
    const record = this.transition(id, 'pending');
    record.outcome = undefined;
    record.settledAt = undefined;
    record.startedAt = undefined;
    this.writeMeta(record);
    return record;
  }

  /** cancel（软移除，不删文件）：pending / in-progress → cancelled（终态，留审计记录）。 */
  cancel(id: string): QueueTask {
    const record = this.transition(id, 'cancelled');
    this.writeMeta(record);
    return record;
  }

  /**
   * pause（066）：in-progress → paused —— 运行中任务挂起（持久可见中间态，非 abort，
   * 可原样恢复）。与 050 interrupt（终止）区分：这里只改状态，不产生任何中止信号。
   * 仅运行中可挂起；pending/终态 → fail loud（调用方 bug）。
   */
  pause(id: string): QueueTask {
    const record = this.transition(id, 'paused');
    this.writeMeta(record);
    return record;
  }

  /**
   * resume（066）：paused → in-progress —— 恢复之前挂起的运行（原样继续，不丢半步）。
   * 仅 paused 可恢复；其余状态 → fail loud（调用方 bug）。
   */
  resume(id: string): QueueTask {
    const record = this.transition(id, 'in-progress');
    this.writeMeta(record);
    return record;
  }

  // ------------------------------------------------------------------
  // internal
  // ------------------------------------------------------------------

  /** 读 + 校验转移（表外转移 / 未知 id fail loud）→ 返回待写记录（不落盘，调用方决定写）。 */
  private transition(id: string, to: TaskStatus): QueueTask {
    const record = this.readMeta(id);
    if (!record) {
      throw new Error(`task queue error: unknown task id "${id}"`);
    }
    if (!canTransitionTaskStatus(record.status, to)) {
      throw new Error(
        `task queue error: task "${id}" cannot transition from "${record.status}" to "${to}"`,
      );
    }
    record.status = to;
    record.updatedAt = isoOf(this.now());
    return record;
  }

  private readAll(): QueueTask[] {
    if (!fs.existsSync(this.root)) return [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: QueueTask[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const rec = this.readMeta(e.name);
      if (rec) out.push(rec);
    }
    return out;
  }

  private readMeta(id: string): QueueTask | undefined {
    const file = this.metaPath(id);
    if (!fs.existsSync(file)) return undefined;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as QueueTask;
      if (typeof parsed?.id !== 'string' || parsed.id !== id) return undefined;
      // 宽容归一：旧/手工记录缺字段给安全缺省；字段级形状不符视为损坏
      if (
        typeof parsed.status !== 'string' ||
        typeof parsed.goal !== 'string' ||
        typeof parsed.projectRoot !== 'string'
      ) {
        return undefined;
      }
      if (!Object.prototype.hasOwnProperty.call(TASK_TRANSITIONS, parsed.status)) return undefined;
      return {
        ...parsed,
        projectRoot: path.resolve(parsed.projectRoot),
        acceptance: Array.isArray(parsed.acceptance) ? parsed.acceptance : [],
      };
    } catch {
      return undefined;
    }
  }

  /** meta.json —— tmp+rename 原子写（同 SessionRegistry.persist / ReviewHandoffStore.writeMeta）。 */
  private writeMeta(record: QueueTask): void {
    const dir = this.dirFor(record.id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, META_FILE);
    const tmp = path.join(dir, `${META_FILE}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }
}

/**
 * 把持久队列接到 LoopEngine 的 selectTask seam：claimNext（pending → in-progress）→ LoopTask。
 * 空队列 → null（LoopEngine null=stop 契约，与 queueSelectTask(ArrayTaskQueue) 语义一致）。
 */
export function projectQueueSelectTask(
  queue: ProjectTaskQueue,
  opts: { projectRoot?: string } = {},
): () => Promise<LoopTask | null> {
  return async () => {
    const task = queue.claimNext(opts);
    if (!task) return null;
    return { id: task.id, goal: task.goal, acceptance: task.acceptance };
  };
}
