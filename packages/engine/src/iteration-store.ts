import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { envRoot, renameWithRetry, vesselHome } from '@vessel/shared';
import type { IterationResult } from './LoopEngine.js';
import type { GeneratorRunRecord } from './real-generator-adapter.js';
import type { EvaluatorRunRecord } from './real-evaluator-adapter.js';
import type { TaskStatus } from './project-task-queue.js';

/**
 * engine/IterationStore — task 063（V1.3 迭代持久化，docs/Vessel_后续开发方向与产品化路线_v1.0.md
 * §11：真实运行链 gen → test → eval → met/not_met 每次迭代留痕，供 065 UI / 067 handoff 回放）。
 *
 * 一次任务的迭代记录（per-task 日志）：目录式记录 `<root>/<task-id>/meta.json`（059 ReviewHandoffStore
 * 同款：目录 / id 约定 / tmp+rename 原子写 / env root 覆盖 —— `VESSEL_ITERATIONS_ROOT`，缺省
 * `~/.vessel/iterations`），iterations[] 追加式（同 059 importResult 追加 results[] 后整写 meta.json）。
 *
 * 与既有产出接上：
 * - LoopEngine `persist` seam：`appendEngineResult` 落 IterationResult 1:1（verdict/evidence/reason/
 *   outputPath/retryCount/metAfterRetries），engineIteration 记参考号（跨引擎不恒唯一）；
 * - 061 `GeneratorRunRecord`（generator 产出快照：output + artifactPaths + developer 摘要）与
 *   062 `EvaluatorRunRecord`（评审快照：conclusion 含 verdict/unmet/suggestions/evidence + evidencePaths）
 *   经 entry.generator / entry.evaluator 整记录快照（可回放/审计；058 review 结论即 evaluator.conclusion）；
 * - 状态转移（队列侧）：entry.transition 记本次迭代把任务从哪态带到哪态（如 in-progress → met）。
 *
 * iteration 序号 = **store 按任务的 1..n 序数**（append 次序即回放顺序；不采用 LoopEngine 的
 * 实例内迭代号 —— 引擎实例重启计数会复位，per-task 序数才是跨引擎唯一的回放/展示索引）。
 *
 * 并发安全同 ProjectTaskQueue：单进程同步 IO + 原子写；多写者需自行串行（063 不引入锁）。
 */

/** 迭代评审结论（058/062 语义：met 之外如实记录，绝不自证 met）。 */
export type IterationVerdict = 'met' | 'not_met' | 'impossible' | 'error';

/**
 * 缺省 iterations 根目录：~/.vessel/iterations（env VESSEL_ITERATIONS_ROOT 可覆盖）。
 *
 * 口径（唯一实现 `envRoot`）：未设置/空串/纯空白 ⇒ 默认根；其余 trim。不能写 `??`——
 * `??` 只挡 undefined，`VESSEL_ITERATIONS_ROOT=` 会让根成为 `''` ⇒ `path.resolve('')` = 进程 CWD
 * （生产调用点 `apps/local-server/src/goalSeam.ts` 的 `new IterationStore()`）。
 */
export function defaultIterationRoot(home = os.homedir()): string {
  return envRoot('VESSEL_ITERATIONS_ROOT') ?? path.join(vesselHome(home), 'iterations');
}

/** 迭代条目 id —— 沿用既有 `<kind>_<ts>_<hex>` 约定。 */
export function newIterationEntryId(now = Date.now(), rand = crypto.randomBytes(4).toString('hex')): string {
  return `iter_${now}_${rand}`;
}

/** 任务快照（每条迭代记录的基座；首次 append 落库，之后仅校验 taskId 一致）。 */
export interface IterationTaskInput {
  taskId: string;
  goal: string;
  acceptance?: readonly string[];
  /** 所属项目工作区根（绝对路径；上下文/回放展示） */
  projectRoot?: string;
}

/**
 * 一次迭代条目（append 输入）：LoopEngine IterationResult 字段 1:1 + 063 扩展
 * （transition / testResults / 061 generator 快照 / 062 evaluator 快照）。
 */
export interface IterationEntryInput {
  /** evaluator 结论（met/not_met/impossible/error） */
  verdict: IterationVerdict;
  evidence?: readonly string[];
  reason?: string;
  /** 产出工作区绝对路径（IterationResult.outputPath） */
  outputPath?: string;
  /** 本次迭代消耗的 generate→evaluate 尝试数（缺省 1） */
  retryCount?: number;
  /** 在先前 not_met 重试后才 met */
  metAfterRetries?: boolean;
  /** LoopEngine 实例内顶层迭代号（参考；跨引擎不恒唯一） */
  engineIteration?: number;
  /** 队列状态转移（本次迭代把任务引向的状态对，如 in-progress → met） */
  transition?: { from: TaskStatus; to: TaskStatus };
  /** 真实链「Tests」步的独立产出摘要（若有） */
  testResults?: string;
  /** 061 GeneratorRunRecord 整记录快照（产出 + 磁盘证据；JSON 可序列化） */
  generator?: GeneratorRunRecord;
  /** 062 EvaluatorRunRecord 整记录快照（conclusion 含 058 评审五字段） */
  evaluator?: EvaluatorRunRecord;
}

/** 一条已落库的迭代记录（不可变追加；回放单元）。 */
export interface IterationEntry {
  id: string;
  /** per-task 序数（1..n；= 该任务第几次迭代） */
  iteration: number;
  taskId: string;
  createdAt: string;
  verdict: IterationVerdict;
  evidence: string[];
  reason: string;
  outputPath?: string;
  retryCount: number;
  metAfterRetries?: boolean;
  engineIteration?: number;
  transition?: { from: TaskStatus; to: TaskStatus };
  testResults?: string;
  generator?: GeneratorRunRecord;
  evaluator?: EvaluatorRunRecord;
}

/** 持久化在 <root>/<task-id>/meta.json 的完整记录（任务基座 + 追加式迭代日志）。 */
export interface IterationTaskRecord {
  taskId: string;
  goal: string;
  acceptance: string[];
  projectRoot?: string;
  /** 首次 append 时间 */
  createdAt: string;
  /** 最近一次 append 时间 */
  updatedAt: string;
  iterations: IterationEntry[];
}

export interface IterationStoreOptions {
  /** iterations 根目录（缺省 defaultIterationRoot()）；测试注入 tmp */
  iterationsRoot?: string;
  /** 时钟注入（测试用；缺省 Date.now） */
  now?: () => number;
}

/** 可接受的 taskId 字符（目录名安全；id 走 `<kind>_<ts>_<hex>` 约定） */
const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const META_FILE = 'meta.json';

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * IterationStore —— per-task 迭代日志（目录式记录 + 原子写追加，059 同款模式）。
 * IO 同步；读取容忍损坏条目；append 对空 taskId / 非法 verdict / 非法字符 fail loud。
 */
export class IterationStore {
  readonly root: string;
  private readonly now: () => number;

  constructor(opts: IterationStoreOptions = {}) {
    this.root = path.resolve(opts.iterationsRoot ?? defaultIterationRoot());
    this.now = opts.now ?? Date.now;
  }

  /** 任务记录目录：<root>/<task-id>/ */
  dirFor(taskId: string): string {
    return path.join(this.root, taskId);
  }

  /** meta.json 完整路径。 */
  metaPath(taskId: string): string {
    return path.join(this.dirFor(taskId), META_FILE);
  }

  /** 全部任务记录（最近更新在前；损坏条目跳过）。 */
  list(): IterationTaskRecord[] {
    if (!fs.existsSync(this.root)) return [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: IterationTaskRecord[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const rec = this.readMeta(e.name);
      if (rec) out.push(rec);
    }
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.taskId < b.taskId ? 1 : -1));
    return out;
  }

  /** 按 taskId 读完整记录；不存在/损坏 → undefined。 */
  get(taskId: string): IterationTaskRecord | undefined {
    return this.readMeta(taskId);
  }

  /** 回放：该任务全部迭代（append 次序 = 序数 1..n）；无记录 → []（给 065 UI / 067 handoff）。 */
  replay(taskId: string): readonly IterationEntry[] {
    return this.readMeta(taskId)?.iterations ?? [];
  }

  /**
   * 追加一次迭代（低层入口）。首次 append 以 task 快照建记录；之后仅校验 taskId 一致，
   * 基座（goal/acceptance/projectRoot）保持首次值不变（不可变基座）。iteration 序数 =
   * 现有条目数 + 1。返回写后完整记录。
   */
  appendIteration(task: IterationTaskInput, entry: IterationEntryInput): IterationTaskRecord {
    if (typeof task?.taskId !== 'string' || !TASK_ID_RE.test(task.taskId)) {
      throw new Error(
        `iteration store error: taskId must be a non-empty safe id (alnum start; alnum/._- only), got "${String(task?.taskId)}"`,
      );
    }
    if (typeof task.goal !== 'string' || task.goal.trim() === '') {
      throw new Error(`iteration store error: goal is required (task "${task.taskId}")`);
    }
    if (!isIterationVerdict(entry.verdict)) {
      throw new Error(
        `iteration store error: invalid verdict "${String(entry.verdict)}" (expected met|not_met|impossible|error)`,
      );
    }
    const now = isoOf(this.now());
    const existing = this.readMeta(task.taskId);
    const tsMs = Date.parse(now);
    const record: IterationTaskRecord = existing ?? {
      taskId: task.taskId,
      goal: task.goal,
      acceptance: [...(task.acceptance ?? [])],
      projectRoot: task.projectRoot ? path.resolve(task.projectRoot) : undefined,
      createdAt: now,
      updatedAt: now,
      iterations: [],
    };
    const e: IterationEntry = {
      id: newIterationEntryId(tsMs),
      iteration: record.iterations.length + 1,
      taskId: task.taskId,
      createdAt: now,
      verdict: entry.verdict,
      evidence: [...(entry.evidence ?? [])],
      reason: entry.reason ?? '',
      outputPath: entry.outputPath,
      retryCount: entry.retryCount ?? 1,
      metAfterRetries: entry.metAfterRetries,
      engineIteration: entry.engineIteration,
      transition: entry.transition ? { from: entry.transition.from, to: entry.transition.to } : undefined,
      testResults: entry.testResults,
      generator: entry.generator,
      evaluator: entry.evaluator,
    };
    record.iterations.push(e);
    record.updatedAt = now;
    this.writeMeta(record);
    return record;
  }

  /**
   * LoopEngine `persist` seam 直连：IterationResult → 迭代条目（1:1 落库）。
   * engineIteration = result.iteration（参考号）；回放序数仍为 store per-task 序数。
   */
  appendEngineResult(task: IterationTaskInput, result: IterationResult): IterationTaskRecord {
    return this.appendIteration(task, {
      verdict: result.verdict,
      evidence: result.evidence,
      reason: result.reason,
      outputPath: result.outputPath,
      retryCount: result.retryCount,
      metAfterRetries: result.metAfterRetries,
      engineIteration: result.iteration,
    });
  }

  // ------------------------------------------------------------------
  // internal
  // ------------------------------------------------------------------

  private readMeta(taskId: string): IterationTaskRecord | undefined {
    const file = this.metaPath(taskId);
    if (!fs.existsSync(file)) return undefined;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as IterationTaskRecord;
      if (typeof parsed?.taskId !== 'string' || parsed.taskId !== taskId) return undefined;
      if (typeof parsed.goal !== 'string' || !Array.isArray(parsed.iterations)) return undefined;
      return {
        ...parsed,
        acceptance: Array.isArray(parsed.acceptance) ? parsed.acceptance : [],
        projectRoot: parsed.projectRoot ? path.resolve(parsed.projectRoot) : undefined,
        iterations: parsed.iterations.filter((it) => typeof it?.id === 'string' && typeof it.iteration === 'number'),
      };
    } catch {
      return undefined;
    }
  }

  /** meta.json —— tmp+rename 原子写（同 SessionRegistry.persist / ReviewHandoffStore.writeMeta）。 */
  private writeMeta(record: IterationTaskRecord): void {
    const dir = this.dirFor(record.taskId);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, META_FILE);
    const tmp = path.join(dir, `${META_FILE}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
    renameWithRetry(tmp, file);
  }
}

function isIterationVerdict(v: unknown): v is IterationVerdict {
  return v === 'met' || v === 'not_met' || v === 'impossible' || v === 'error';
}
