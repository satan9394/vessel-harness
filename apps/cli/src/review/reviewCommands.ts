/**
 * apps/cli/review — `vessel review` 命令族（task 059）：External Review Handoff 的
 * CLI seam —— 触发生成 handoff、导入外部/内部评审结果、列出 reviews。
 *
 * 设计（§9.1：External Review Adapter 走 artifact 交换，不伪装成 ChatProvider）：
 * - `vessel review handoff <request.json> [--root <dir>] [--workspace <dir>]`
 *   由请求 JSON 生成 .vessel/reviews/<id>/handoff.md + meta.json；请求含
 *   task/acceptance/changedFiles/diffSummary/testResults/constraints/checklist。
 * - `vessel review import <review-id> <result 文件> [--source external|internal]
 *   [--root <dir>]` —— 结果文本经 058 结论解析（parseReviewConclusion）落库，
 *   来源缺省 external。
 * - `vessel review list [--root <dir>]` —— 列出 reviews（id/状态/任务/结果数）。
 *
 * root 解析：--root > env VESSEL_REVIEWS_ROOT > ~/.vessel/reviews（defaultReviewsRoot）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ReviewHandoffStore, type HandoffCreateInput, type ReviewHandoffRecord } from '@vessel/application';

export interface ReviewCliOptions {
  /** 覆盖 reviews 根（测试注入 tmp）；缺省 defaultReviewsRoot() */
  root?: string;
  /** 覆盖工作区（meta.workspaceRoot）；缺省 process.cwd() */
  workspace?: string;
  /** io seam（测试 capture console 用；缺省走 console） */
  log?: (line: string) => void;
  error?: (line: string) => void;
}

function resolveRoot(opts: ReviewCliOptions): string | undefined {
  const override = opts.root ?? process.env.VESSEL_REVIEWS_ROOT;
  return override ? path.resolve(override) : undefined;
}

function storeFor(opts: ReviewCliOptions): ReviewHandoffStore {
  const reviewsRoot = resolveRoot(opts);
  return reviewsRoot ? new ReviewHandoffStore({ reviewsRoot }) : new ReviewHandoffStore();
}

function readHandoffRequest(file: string): HandoffCreateInput {
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (typeof parsed.task !== 'string' || parsed.task.trim() === '') {
    throw new Error(`review error: request "${file}" must contain a non-empty "task" string`);
  }
  return {
    task: parsed.task,
    acceptance: asStrArr(parsed.acceptance),
    changedFiles: asStrArr(parsed.changedFiles),
    diffSummary: typeof parsed.diffSummary === 'string' ? parsed.diffSummary : undefined,
    testResults: typeof parsed.testResults === 'string' ? parsed.testResults : undefined,
    constraints: asStrArr(parsed.constraints),
    checklist: asStrArr(parsed.checklist),
  };
}

function asStrArr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string');
}

function summaryLine(record: ReviewHandoffRecord): string {
  const verdicts = record.results.map((r) => `${r.source}:${r.conclusion.verdict}`).join(', ') || '无';
  return `${record.id}  [${record.status}]  task=${record.task.slice(0, 40)}  results(${record.results.length})=${verdicts}`;
}

async function cmdHandoff(args: string[], flags: Map<string, string>, opts: ReviewCliOptions): Promise<number> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const requestPath = args[0];
  if (!requestPath) {
    (opts.error ?? ((s: string) => console.error(s)))(
      '用法: vessel review handoff <request.json> [--root <dir>] [--workspace <dir>]',
    );
    return 2;
  }
  let input: HandoffCreateInput;
  try {
    input = readHandoffRequest(requestPath);
  } catch (err) {
    (opts.error ?? ((s: string) => console.error(s)))(`[vessel review] ${(err as Error).message}`);
    return 2;
  }
  if (!input.workspaceRoot) {
    input = { ...input, workspaceRoot: path.resolve(flags.get('workspace') ?? opts.workspace ?? process.cwd()) };
  }
  try {
    const store = storeFor(opts);
    const record = store.createHandoff(input);
    log(`[vessel review] handoff 已生成: ${record.id}`);
    log(`  status: ${record.status}`);
    log(`  handoff.md: ${store.handoffPath(record.id)}`);
    log(`  目录: ${store.dirFor(record.id)}`);
    return 0;
  } catch (err) {
    (opts.error ?? ((s: string) => console.error(s)))(`[vessel review] ${(err as Error).message}`);
    return 1;
  }
}

async function cmdImport(args: string[], flags: Map<string, string>, opts: ReviewCliOptions): Promise<number> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const reviewId = args[0];
  const resultPath = args[1];
  if (!reviewId || !resultPath) {
    (opts.error ?? ((s: string) => console.error(s)))(
      '用法: vessel review import <review-id> <result 文件> [--source external|internal] [--root <dir>]',
    );
    return 2;
  }
  const source = flags.get('source') ?? 'external';
  if (source !== 'external' && source !== 'internal') {
    (opts.error ?? ((s: string) => console.error(s)))(`[vessel review] 无效 source "${source}"（expected external|internal）`);
    return 2;
  }
  let text: string;
  try {
    text = fs.readFileSync(resultPath, 'utf8');
  } catch {
    (opts.error ?? ((s: string) => console.error(s)))(`[vessel review] 无法读取结果文件: ${resultPath}`);
    return 2;
  }
  try {
    const store = storeFor(opts);
    const record = store.importResult(reviewId, { source: source as 'external' | 'internal', text });
    const last = record.results[record.results.length - 1]!;
    log(`[vessel review] 结果已导入: ${record.id}`);
    log(`  source: ${last.source}  verdict: ${last.conclusion.verdict}`);
    if (last.conclusion.reason) log(`  reason: ${last.conclusion.reason}`);
    return 0;
  } catch (err) {
    (opts.error ?? ((s: string) => console.error(s)))(`[vessel review] ${(err as Error).message}`);
    return 1;
  }
}

async function cmdList(_args: string[], _flags: Map<string, string>, opts: ReviewCliOptions): Promise<number> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const store = storeFor(opts);
  const records = store.list();
  if (records.length === 0) {
    log('[vessel review] 暂无 reviews。生成: vessel review handoff <request.json>');
    return 0;
  }
  for (const r of records) log(summaryLine(r));
  return 0;
}

/** `vessel review <handoff|import|list> [...]` —— 命令族入口（apps/cli main 分发）。 */
export async function cmdReview(args: string[], flags: Map<string, string>, opts: ReviewCliOptions = {}): Promise<number> {
  const merged: ReviewCliOptions = {
    root: flags.get('root') ?? opts.root,
    workspace: flags.get('workspace') ?? opts.workspace,
    log: opts.log,
    error: opts.error,
  };
  const sub = args[0];
  switch (sub) {
    case 'handoff':
      return cmdHandoff(args.slice(1), flags, merged);
    case 'import':
      return cmdImport(args.slice(1), flags, merged);
    case 'list':
      return cmdList(args.slice(1), flags, merged);
    default:
      (merged.error ?? ((s: string) => console.error(s)))(
        '[vessel review] 未知子命令（可用: handoff / import / list）。查看用法: vessel review handoff --help',
      );
      return 2;
  }
}
