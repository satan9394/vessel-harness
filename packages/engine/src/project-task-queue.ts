import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { envRoot, renameWithRetry, statWithRetry, vesselHome } from '@vessel/shared';
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

/**
 * 缺省 taskqueue 根目录：~/.vessel/taskqueue（env VESSEL_TASKQUEUE_ROOT 可覆盖）。
 *
 * 口径（唯一实现 `envRoot`）：未设置/空串/纯空白 ⇒ 默认根；其余 trim。不能写 `??`——
 * `??` 只挡 undefined，`VESSEL_TASKQUEUE_ROOT=` 会让根成为 `''` ⇒ `path.resolve('')` = 进程 CWD
 * （生产调用点 `apps/local-server/src/goalSeam.ts` 的 `new ProjectTaskQueue()`）。
 */
export function defaultTaskQueueRoot(home = os.homedir()): string {
  return envRoot('VESSEL_TASKQUEUE_ROOT') ?? path.join(vesselHome(home), 'taskqueue');
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

  /**
   * 索引状态（V1.1-B：claimNext/list 不再每次全目录扫描 + 读遍所有 meta —— 改内存索引 + mtime 校验）。
   * `byId`：id → { 最近一次解析的任务快照, 该 meta.json 的 mtimeMs }。写操作在本实例落盘即透传；
   * 跨实例改动经 runSync 的 mtime 校验廉价刷新（只重读真正变过的文件，不重读未变 meta —— 命中磁盘 IO
   * 退化为 stat，远低于旧的「每调用全目录 meta 读 + JSON parse」）。
   * `pendingDirty`：pending 顺序需按 byId 重建（写操作/刷新后置脏，claim 前惰性重建 —— O(N) 内存，仅 stat）。
   * `loaded`：是否已完成首次装载（每实例一次；跨实例各自装载，正确性以 disk 为锚）。
   */
  private readonly byId = new Map<string, { record: QueueTask; mtimeMs: number }>();
  private _pendingIds: string[] = [];
  private pendingDirty = true;
  private loaded = false;

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

  /**
   * 全部任务（最新 createdAt 在前；损坏条目跳过）—— list 是管理视图。
   * V1.1-B：读内存索引（每实例装载一次 + 增量 sync + 本实例写透传），不每次读全目录 meta。
   */
  list(opts: TaskListOptions = {}): QueueTask[] {
    this.runSync();
    const project = opts.projectRoot !== undefined ? path.resolve(opts.projectRoot) : undefined;
    const out: QueueTask[] = [];
    for (const { record } of this.byId.values()) {
      if (opts.status !== undefined && record.status !== opts.status) continue;
      if (project !== undefined && record.projectRoot !== project) continue;
      out.push(record);
    }
    return out.sort(compareNewestFirst);
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
   * V1.1-B：候选来自内存 pending 顺序（惰性重建，无全目录 meta 读）；领取前仍重读 meta 校验
   * 仍 pending（并发领取不重复）；同进程内绝无重复领取。
   */
  claimNext(opts: { projectRoot?: string } = {}): QueueTask | null {
    this.ensureLoaded();
    if (this.pendingDirty) this.rebuildPending();
    const project = opts.projectRoot !== undefined ? path.resolve(opts.projectRoot) : undefined;
    for (const pendingId of this.pendingIds()) {
      const fresh = this.readMeta(pendingId);
      if (!fresh || fresh.status !== 'pending') continue; // 已被并发领取/变更 → 跳过（锚定 disk）
      if (project !== undefined && fresh.projectRoot !== project) continue;
      return this.claimCandidate(fresh);
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

  /** meta.json —— tmp+rename 原子写（同 SessionRegistry.persist / ReviewHandoffStore.writeMeta）。
   *  写透传索引：每次落盘同步更新内存 byId + 记录该文件 mtime（本实例后续 list/claimNext 免重读）。 */
  private writeMeta(record: QueueTask): void {
    const dir = this.dirFor(record.id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, META_FILE);
    const tmp = path.join(dir, `${META_FILE}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
    renameWithRetry(tmp, file);
    let mtimeMs = Date.now();
    try {
      // statWithRetry（task 115）：Windows 杀软瞬时锁 stat EPERM 有界重试 3 次/5-15ms
      mtimeMs = statWithRetry(file).mtimeMs;
    } catch {
      /* 目录立即被清等极端竞态 —— 用当前时钟兜底（保守置脏，下次 sync 会以 disk 为准；
         非静默 stale：此处 byId 刚写入本实例写后 record，mtime 仅作缓存校验值） */
    }
    this.byId.set(record.id, { record, mtimeMs });
    this.pendingDirty = true;
  }

  // ------------------------------------------------------------------
  // index helpers（V1.1-B）
  // ------------------------------------------------------------------

  /** pending 候选 id 列表（最旧在前）。调用方需先 ensureLoaded/runSync + （必要时）rebuildPending。 */
  private pendingIds(): string[] {
    return this._pendingIds;
  }

  /**
   * claimNext 热路径装载：首次做全量索引装载；之后本实例作为（文档约定的）单写者自行写透传 byId，
   * 不重复 readdir/stat 全部 —— 领取 O(1) 候选 + 单条 disk 重读校验。跨实例改动靠 list 的 runSync
   * 兜底刷新（管理视图恒盘面为准）。
   */
  private ensureLoaded(): void {
    if (this.loaded) return;
    this.runSync();
  }

  /** 惰性重建 pending 顺序（byId 内存计算，仅 stat，无 meta 重读）。 */
  private rebuildPending(): void {
    const pending: QueueTask[] = [];
    for (const { record } of this.byId.values()) {
      if (record.status === 'pending') pending.push(record);
    }
    pending.sort(compareOldestFirst);
    this._pendingIds = pending.map((t) => t.id);
    this.pendingDirty = false;
  }

  /**
   * 装载 + 增量 sync（list 每次调用；claimNext 仅首次）：readdir + 按 meta mtime 校验刷新。
   * - 首次：全目录扫描读各 meta 建索引（每实例一次；跨实例各自装载）。
   * - 之后/每调用：readdir 合并新增 id；对每个已知 id `statWithRetry(meta.json).mtimeMs`
   *   （task 115：stat 读路径的 Windows 锁 EPERM 有界重试 3 次/5-15ms，与 renameWithRetry 同语义），
   *   与缓存不一致（本实例写或跨实例改）才重读 meta，未变条目只 stat 不 parse —— 磁盘IO从
   *   旧「全目录 meta 读 + JSON parse」退化为 stat（内容读降为 O(changed)）。正确性以 disk 为锚。
   */
  private runSync(): void {
    if (!fs.existsSync(this.root)) {
      this.byId.clear();
      this._pendingIds = [];
      this.pendingDirty = false;
      this.loaded = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const id = e.name;
      const cached = this.byId.get(id);
      const file = this.metaPath(id);
      let mtimeMs: number;
      try {
        // statWithRetry（task 115）：Windows 杀软瞬时锁 stat EPERM 有界重试 3 次/5-15ms
        mtimeMs = statWithRetry(file).mtimeMs;
      } catch (error) {
        // 锁类错误（EPERM/EBUSY/EACCES）已被 helper 重试 3 次尽；ENOENT/ENOTDIR 说明
        // 目录存在但 meta 真缺失/被外部删除 —— 视同损坏，跳过（合法语义，非 stale）
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') continue;
        // 锁重试尽仍失败：**不静默 continue**（静默 = 沿用旧索引 = stale，114 实测 flaky 根源）。
        // 按队列语义降级：保守置脏强制重读 meta，正确性以 disk 为锚（与 writeMeta 兜底同语义）
        mtimeMs = Date.now();
      }
      if (cached && cached.mtimeMs === mtimeMs) continue; // 未变条目：仅 stat，不重读
      const rec = this.readMeta(id);
      if (rec) this.byId.set(id, { record: rec, mtimeMs });
      else if (cached) this.byId.delete(id); // 已损坏/被删 —— 移除（软，不删文件）
    }
    this.loaded = true;
    this.pendingDirty = true;
  }

  /** claimNext 内部：把已校验仍 pending 的候选落盘 in-progress 并写透传索引，返回写后记录。 */
  private claimCandidate(fresh: QueueTask): QueueTask {
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
