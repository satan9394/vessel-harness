/**
 * application/review — ReviewHandoffStore（task 059）：External Review Handoff 的
 * 目录存储 + handoff.md 渲染 + 外部/内部评审结果导入。
 *
 * §9.1 权威路径：`.vessel/reviews/<review-id>/handoff.md`；本实现走既有用户级
 * `~/.vessel` 约定（SessionRegistry / ProviderStore / UsageStore 同款），根目录
 * 可注入（测试用 tmp；缺省 `~/.vessel/reviews`，env `VESSEL_REVIEWS_ROOT` 可覆盖）。
 *
 * 目录布局（每条记录一个目录，UI 060 Open Folder 即打开它）：
 *   <root>/<review-id>/
 *     handoff.md     —— §9.1 八 section artifact（生成后保持不变，供复制发送）
 *     meta.json      —— 结构化记录：id/status/createdAt/updatedAt/source +
 *                       handoff 载荷快照 + results[]（导入结果落库于此）
 *
 * 结论协议复用（不新造解析）：importResult 的文本经 agents reviewer/conclusion 的
 * parseReviewConclusion 解析 —— 与 058 内部评审结论同型（ReviewConclusion ≡
 * TeamReviewConclusion），仅 results[].source 区分 external / internal。
 * 解析失败如实记录 verdict 'error'（绝不误判 met）。
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseReviewConclusion, REVIEW_OUTPUT_SCHEMA } from '@vessel/agents';
import { envRoot, renameWithRetry } from '@vessel/shared';
import type {
  HandoffCreateInput,
  ReviewHandoffRecord,
  ReviewResultEntry,
  ReviewResultSource,
} from './ExternalReviewHandoff.js';

/**
 * 缺省 reviews 根目录：~/.vessel/reviews（env VESSEL_REVIEWS_ROOT 可覆盖）。
 *
 * 口径（唯一实现 `envRoot`，与全仓其它状态根一致）：未设置/空串/纯空白 ⇒ 默认根；其余 trim。
 * 不能写 `process.env.VESSEL_REVIEWS_ROOT ?? …`：`??` 只挡 undefined，`VESSEL_REVIEWS_ROOT=`
 * 会让根成为 `''` ⇒ `path.resolve('')` = **进程 CWD**（生产调用点
 * `apps/local-server/src/server.ts` 的 `new ReviewHandoffStore()` 即落到服务进程工作目录）。
 */
export function defaultReviewsRoot(home = os.homedir()): string {
  return envRoot('VESSEL_REVIEWS_ROOT') ?? path.join(home, '.vessel', 'reviews');
}

/** review id —— 沿用既有 `<kind>_<ts>_<hex>` 约定（sess_/team_/sub_/del_ 同款）。 */
export function newReviewId(now = Date.now(), rand = crypto.randomBytes(4).toString('hex')): string {
  return `review_${now}_${rand}`;
}

/** 结果条目 id。 */
export function newResultId(now = Date.now(), rand = crypto.randomBytes(4).toString('hex')): string {
  return `res_${now}_${rand}`;
}

/**
 * 缺省 Review Checklist（checklist 未显式给出时使用）—— 面向外部评审者的核验指引，
 * 与 058 reviewer 评估语义一致（对照验收标准判定、不信任自证、按 schema 回传）。
 */
export function defaultReviewChecklist(): string[] {
  return [
    '逐条对照 Acceptance Criteria 判定（每条给出 met / not_met 与依据）',
    '核对 Changed Files 与 Diff Summary 是否一致、无无关改动',
    '核对 Test Results 是否可复现（命令/数量/失败项说明）',
    '核对是否违反 Architecture Constraints（分层/依赖/删除铁律等）',
    '结论按 Required Output Schema 输出（仅一行可解析 JSON，勿加叙述）',
  ];
}

/** 时间戳（ISO）。 */
function isoNow(): string {
  return new Date().toISOString();
}

/**
 * 渲染 §9.1 handoff.md —— 记录快照的只读投影。metadata 头（id/状态/时间/来源）+
 * 八个 section；空字段给占位说明，保证八节结构永远齐。
 */
export function renderHandoffMarkdown(record: ReviewHandoffRecord): string {
  const bullets = (items: readonly string[], empty: string): string =>
    items.length > 0 ? items.map((s) => `- ${s}`).join('\n') : empty;

  const out: string[] = [];
  out.push(`# External Review Handoff`);
  out.push('');
  out.push(`> review-id: \`${record.id}\``);
  out.push(`> status: ${record.status}`);
  out.push(`> source: ${record.source}`);
  out.push(`> createdAt: ${record.createdAt}`);
  out.push(`> updatedAt: ${record.updatedAt}`);
  if (record.workspaceRoot) out.push(`> workspaceRoot: ${record.workspaceRoot}`);
  out.push('');
  out.push(`## Task`);
  out.push('');
  out.push(record.task.trim() || '（未提供任务描述）');
  out.push('');
  out.push(`## Acceptance Criteria`);
  out.push('');
  out.push(bullets(record.acceptance, '（未提供验收标准）'));
  out.push('');
  out.push(`## Changed Files`);
  out.push('');
  out.push(bullets(record.changedFiles, '（未提供改动文件列表）'));
  out.push('');
  out.push(`## Diff Summary`);
  out.push('');
  out.push(record.diffSummary.trim() || '（未提供 diff 摘要）');
  out.push('');
  out.push(`## Test Results`);
  out.push('');
  out.push(record.testResults.trim() || '（未提供测试结果）');
  out.push('');
  out.push(`## Architecture Constraints`);
  out.push('');
  out.push(bullets(record.constraints, '（未提供架构约束）'));
  out.push('');
  out.push(`## Review Checklist`);
  out.push('');
  out.push(bullets(record.checklist, '（未提供检查清单）'));
  out.push('');
  out.push(`## Required Output Schema`);
  out.push('');
  out.push(record.outputSchema);
  out.push('');
  out.push('评审完成后请按上述 Required Output Schema 回复（仅一行 review JSON），并把回复粘贴/导入回本记录。');
  return out.join('\n');
}

export interface ReviewHandoffStoreOptions {
  /** reviews 根目录（缺省 defaultReviewsRoot()）；测试注入 tmp。 */
  reviewsRoot?: string;
}

/** 记录文件布局辅助。 */
const META_FILE = 'meta.json';
const HANDOFF_FILE = 'handoff.md';

/**
 * ReviewHandoffStore —— 目录式存储：create（生成 handoff.md + meta.json）/
 * get/list（读 meta.json）/ importResult（解析并追加结果、状态转 imported）。
 * IO 同步（与 SessionRegistry/ProviderStore 同风格）；写 meta.json 走 tmp+rename 原子替换。
 */
export class ReviewHandoffStore {
  readonly root: string;

  constructor(opts: ReviewHandoffStoreOptions = {}) {
    this.root = path.resolve(opts.reviewsRoot ?? defaultReviewsRoot());
  }

  /** 记录目录：<root>/<review-id>/ */
  dirFor(id: string): string {
    return path.join(this.root, id);
  }

  /** handoff.md 的完整路径（060 Copy Handoff / Open Folder 用）。 */
  handoffPath(id: string): string {
    return path.join(this.dirFor(id), HANDOFF_FILE);
  }

  /** meta.json 的完整路径。 */
  metaPath(id: string): string {
    return path.join(this.dirFor(id), META_FILE);
  }

  /**
   * 生成一次 handoff：由输入载荷构造记录（status pending / source external，
   * createdAt/updatedAt = now）→ 落盘 handoff.md + meta.json → 返回记录。
   * task 为空 fail loud（调用方 bug）。
   */
  createHandoff(input: HandoffCreateInput): ReviewHandoffRecord {
    if (typeof input.task !== 'string' || input.task.trim() === '') {
      throw new Error('review error: task is required');
    }
    const now = isoNow();
    const acceptance = [...(input.acceptance ?? [])];
    const record: ReviewHandoffRecord = {
      id: newReviewId(),
      status: 'pending',
      source: 'external',
      createdAt: now,
      updatedAt: now,
      workspaceRoot: input.workspaceRoot ? path.resolve(input.workspaceRoot) : undefined,
      task: input.task.trim(),
      acceptance,
      changedFiles: [...(input.changedFiles ?? [])],
      diffSummary: input.diffSummary ?? '',
      testResults: input.testResults ?? '',
      constraints: [...(input.constraints ?? [])],
      checklist: input.checklist && input.checklist.length > 0 ? [...input.checklist] : defaultReviewChecklist(),
      outputSchema: REVIEW_OUTPUT_SCHEMA,
      results: [],
    };
    this.writeMeta(record, { writeMarkdown: true });
    return record;
  }

  /** 按 id 读记录；不存在/损坏 → undefined（registry 同款容忍）。 */
  get(id: string): ReviewHandoffRecord | undefined {
    return this.readMeta(id);
  }

  /** 全部记录（按 createdAt 倒序 = 最新在前），目录损坏条目跳过。 */
  list(): ReviewHandoffRecord[] {
    if (!fs.existsSync(this.root)) return [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: ReviewHandoffRecord[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const rec = this.readMeta(e.name);
      if (rec) out.push(rec);
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
    return out;
  }

  /**
   * 导入评审结果（落库到 meta.json.results）：
   * - text 模式：外部粘贴文本 → parseReviewConclusion 解析（解析失败 = verdict 'error'，如实记录）；
   * - conclusion 模式：结构化结论直接入库（供 058 内部结论同型写入）。
   * source 缺省 'external'，可显式 'internal' —— 结果来源可区分。
   * 导入后 status → 'imported'。未知 id fail loud（调用方 bug）。
   */
  importResult(
    id: string,
    input: { source?: ReviewResultSource; text?: string; conclusion?: ReviewHandoffRecord['results'][number]['conclusion'] },
  ): ReviewHandoffRecord {
    const record = this.get(id);
    if (!record) {
      throw new Error(`review error: unknown review id "${id}"`);
    }
    const source: ReviewResultSource = input.source ?? 'external';
    if (source !== 'external' && source !== 'internal') {
      throw new Error(`review error: invalid result source "${String(source)}" (expected external|internal)`);
    }
    const text = input.text ?? '';
    if (!input.conclusion && !text.trim()) {
      throw new Error(`review error: importResult requires text or a structured conclusion`);
    }
    const conclusion = input.conclusion ?? parseReviewConclusion(text);
    const raw = input.text ?? JSON.stringify(conclusion);
    const entry: ReviewResultEntry = {
      id: newResultId(),
      source,
      importedAt: isoNow(),
      conclusion,
      raw,
    };
    record.results.push(entry);
    record.status = 'imported';
    record.updatedAt = entry.importedAt;
    // 只更新 meta.json（handoff.md 保持生成时的快照，供 Copy/发送）；writeMarkdown=false
    this.writeMeta(record, { writeMarkdown: false });
    return record;
  }

  // ------------------------------------------------------------------
  // internal
  // ------------------------------------------------------------------

  private readMeta(id: string): ReviewHandoffRecord | undefined {
    const file = this.metaPath(id);
    if (!fs.existsSync(file)) return undefined;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ReviewHandoffRecord;
      if (typeof parsed?.id !== 'string' || parsed.id !== id) return undefined;
      // 宽容归一：旧/手工记录缺字段时给安全缺省，字段级形状不符则视为损坏
      if (typeof parsed.status !== 'string' || typeof parsed.task !== 'string') return undefined;
      return {
        ...parsed,
        acceptance: Array.isArray(parsed.acceptance) ? parsed.acceptance : [],
        changedFiles: Array.isArray(parsed.changedFiles) ? parsed.changedFiles : [],
        constraints: Array.isArray(parsed.constraints) ? parsed.constraints : [],
        checklist: Array.isArray(parsed.checklist) ? parsed.checklist : [],
        results: Array.isArray(parsed.results) ? parsed.results : [],
      };
    } catch {
      return undefined;
    }
  }

  private writeMeta(record: ReviewHandoffRecord, opts: { writeMarkdown: boolean }): void {
    const dir = this.dirFor(record.id);
    fs.mkdirSync(dir, { recursive: true });
    // handoff.md —— 生成时的 artifact（快照；import 后不再重写，保持"已发送给外部"的原样）
    if (opts.writeMarkdown) {
      fs.writeFileSync(path.join(dir, HANDOFF_FILE), renderHandoffMarkdown(record), 'utf8');
    }
    // meta.json —— tmp+rename 原子写（同 SessionRegistry.persist）；task 113 起走
    // 共享有界重试（EPERM/EBUSY/EACCES，3 次 5/15ms），原子语义不变。
    const file = path.join(dir, META_FILE);
    const tmp = path.join(dir, `${META_FILE}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
    renameWithRetry(tmp, file);
  }
}
