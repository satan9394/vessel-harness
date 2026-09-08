import * as crypto from 'node:crypto';

/**
 * engine/handoff — Context Reset + Structured Handoff（task 067）.
 * docs/Vessel_后续开发方向与产品化路线_v1.0.md §12：真正多小时任务在上下文接近预算时，
 * 把运行状态固化为结构化 handoff（§12 yaml 字段 goal/completed/current_state/changed_files/
 * tests/decisions/blockers/next_actions/evidence），新 Agent/新 Session 从 handoff 启动续跑；
 * 不要只靠无限 compact。与既有 Compaction（packages/context/src/compaction/Compaction.ts）
 * 并存但不同机制：compact = 对话内压缩（同一 session log 内替换旧段）；reset = 全新上下文 +
 * 结构化交接（新 Session 从 handoff 恢复，见 StartFromHandoff.ts）。
 *
 * 本模块只做类型 + 纯函数构造/校验/序列化；存储（目录/id/原子写/root 覆盖）在
 * HandoffStore.ts，触发条件（066 budget / 会话长度阈值）在 HandoffTrigger.ts，
 * 素材聚合（063 IterationStore / 任务对象）在 HandoffMaterial.ts。
 *
 * 字段命名纪律：记录字段名与 §12 yaml 字段**逐字一致**（current_state/changed_files/
 * next_actions 用 snake_case）—— JSON 存储即 §12 结构，零映射歧义；渲染投影（handoff.md）
 * 直接以同名输出。
 */

/** 一次结构化 handoff 记录（§12 yaml 字段逐字齐；JSON 可序列化，存储见 HandoffStore.ts）。 */
export interface HandoffRecord {
  /** id —— 沿用既有 `<kind>_<ts>_<hex>` 约定：handoff_<ts>_<hex>。 */
  id: string;
  /** §12 goal —— 续跑目标（非空校验，构建期 fail loud）。 */
  goal: string;
  /** §12 completed —— 已完成事项。 */
  completed: string[];
  /** §12 current_state —— 当前状态描述（现状/进展）。 */
  current_state: string;
  /** §12 changed_files —— 改动文件清单。 */
  changed_files: string[];
  /** §12 tests —— 测试证据/结果清单。 */
  tests: string[];
  /** §12 decisions —— 已做决策（含理由）。 */
  decisions: string[];
  /** §12 blockers —— 阻塞项（透传给新 Agent 继续处理）。 */
  blockers: string[];
  /** §12 next_actions —— 下一步行动（注入新 Session 起始上下文）。 */
  next_actions: string[];
  /** §12 evidence —— 证据（命令输出/路径/引用）。 */
  evidence: string[];
  createdAt: string;
  updatedAt: string;
  // ---- 引擎复用元数据（§12 超集；供 061-064 运行链 / 065 Goal UI seam） ----
  /** 来源任务 id（QueueTask.id；从 handoff 重建 LoopTask 的 key）。 */
  taskId?: string;
  /** 验收标准（透传 QueueTask.acceptance —— 评审判据来源）。 */
  acceptance?: string[];
  /** 所属项目工作区根（绝对路径）。 */
  projectRoot?: string;
  /** 前序 handoff id —— 长任务续跑链（handoff → handoff → …）。 */
  continuationOf?: string;
}

/**
 * 构建输入 = 记录除 id/时间戳外的全部字段（素材聚合产物，见 HandoffMaterial.ts）。
 * JSON 安全（纯字符串/数组），可直接序列化传递。
 */
export type HandoffMaterial = Omit<HandoffRecord, 'id' | 'createdAt' | 'updatedAt'>;

/** handoff id —— 沿用既有 `<kind>_<ts>_<hex>` 约定（sess_/task_/review_ 同款）。 */
export function newHandoffId(now = Date.now(), rand = crypto.randomBytes(4).toString('hex')): string {
  return `handoff_${now}_${rand}`;
}

/** ISO 时间戳。 */
function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

/** 数组归一：非数组 → []（构建/解析共用，宽容旧数据）。 */
function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === 'string');
}

/** 字符串归一：非字符串 → ''。 */
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** §12 九字段（逐字 snake_case）—— 校验/文档共用。 */
export const HANDOFF_SECTION_FIELDS = [
  'goal',
  'completed',
  'current_state',
  'changed_files',
  'tests',
  'decisions',
  'blockers',
  'next_actions',
  'evidence',
] as const;

/** 形状校验：是否是合法 HandoffRecord（id/goal/createdAt 必需；§12 字段存在）。 */
export function isHandoffRecord(x: unknown): x is HandoffRecord {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as HandoffRecord;
  return typeof r.id === 'string' && r.id.startsWith('handoff_') && typeof r.goal === 'string' && r.goal.trim() !== ''
    && typeof r.current_state === 'string' && typeof r.createdAt === 'string' && typeof r.updatedAt === 'string';
}

/**
 * 构造一条结构化 handoff（纯函数；不落盘）。
 * - goal 为空 fail loud（调用方 bug —— 无目标不可交接续跑）；
 * - §12 数组字段归一为合法字符串数组（去非字符串元素）；
 * - id 缺省 newHandoffId(now)；时间戳 = now（ISO）。
 */
export function buildHandoff(
  material: HandoffMaterial,
  opts: { now?: number; id?: string; continuationOf?: string } = {},
): HandoffRecord {
  if (typeof material?.goal !== 'string' || material.goal.trim() === '') {
    throw new Error(`handoff error: goal is required (a handoff must carry the continuation target)`);
  }
  const nowMs = opts.now ?? Date.now();
  const now = isoOf(nowMs);
  return {
    id: opts.id ?? newHandoffId(nowMs),
    goal: material.goal.trim(),
    completed: strArray(material.completed),
    current_state: str(material.current_state),
    changed_files: strArray(material.changed_files),
    tests: strArray(material.tests),
    decisions: strArray(material.decisions),
    blockers: strArray(material.blockers),
    next_actions: strArray(material.next_actions),
    evidence: strArray(material.evidence),
    createdAt: now,
    updatedAt: now,
    taskId: str(material.taskId) || undefined,
    acceptance: strArray(material.acceptance),
    projectRoot: str(material.projectRoot) || undefined,
    continuationOf: opts.continuationOf ?? (str(material.continuationOf) || undefined),
  };
}

/** 序列化（JSON；存储/传输共用）。 */
export function serializeHandoff(record: HandoffRecord): string {
  return JSON.stringify(record, null, 2);
}

/**
 * 反序列化 + 校验。形状非法（非对象/缺 goal/缺 id）throw —— 调用方决定
 * 如何暴露（HandoffStore.get 以 try/catch 容错返回 undefined）。
 */
export function parseHandoff(text: string): HandoffRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('handoff error: handoff JSON is malformed');
  }
  if (!isHandoffRecord(parsed)) {
    throw new Error('handoff error: parsed payload is not a valid handoff record');
  }
  return {
    ...parsed,
    completed: strArray(parsed.completed),
    current_state: str(parsed.current_state),
    changed_files: strArray(parsed.changed_files),
    tests: strArray(parsed.tests),
    decisions: strArray(parsed.decisions),
    blockers: strArray(parsed.blockers),
    next_actions: strArray(parsed.next_actions),
    evidence: strArray(parsed.evidence),
    acceptance: strArray(parsed.acceptance),
  };
}
