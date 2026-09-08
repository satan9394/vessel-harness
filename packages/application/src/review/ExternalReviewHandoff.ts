/**
 * application/review — External Review Handoff domain types + markdown render (task 059).
 *
 * §9.1（docs/Vessel_后续开发方向与产品化路线_v1.0.md L1094-1124）权威形状：
 * handoff artifact 存 `.vessel/reviews/<review-id>/handoff.md`，内容含八个 section：
 *   Task / Acceptance Criteria / Changed Files / Diff Summary / Test Results /
 *   Architecture Constraints / Review Checklist / Required Output Schema
 *
 * External Review Adapter 不是 ChatProvider —— 走 artifact 交换而非 API provider。
 * 结论形状复用 058 内部评审协议（reviewer/conclusion.ts：ReviewConclusion =
 * TeamReviewConclusion，解析单点 parseReviewConclusion）——外部评审结果导入后与内部
 * 结论同型，仅按结果条目的 source（external / internal）区分来源。
 */
import type { ReviewConclusion } from '@vessel/agents';

/** 评审结果来源：external（AGY/Gemini 等外部工具粘贴导入）vs internal（058 内部评审结论）。 */
export type ReviewResultSource = 'external' | 'internal';

/** handoff 记录生命周期：pending（等待外部评审结果）→ imported（≥1 条结果已导入）。 */
export type ReviewStatus = 'pending' | 'imported';

/** §9.1 handoff.md 载荷（全部为手工/上层组装输入；渲染时逐节输出）。 */
export interface ReviewHandoffContent {
  /** Task —— 任务目标（与 InternalReviewer input.goal / LoopTask.goal 同义） */
  task: string;
  /** Acceptance Criteria —— 验收标准（评审判据来源，逐条交给外部评审者） */
  acceptance: string[];
  /** Changed Files —— 改动文件列表 */
  changedFiles: string[];
  /** Diff Summary —— diff 摘要（自由文本；通常来自 git diff --stat / 任务卡 diff 摘要） */
  diffSummary: string;
  /** Test Results —— 测试结果摘要（自由文本；命令/数量/失败项说明） */
  testResults: string;
  /** Architecture Constraints —— 架构约束（分层纪律/依赖/删除铁律等，评审依据） */
  constraints: string[];
  /** Review Checklist —— 外部评审检查清单（缺省按 acceptance 生成默认清单） */
  checklist: string[];
  /** Required Output Schema —— 要求外部评审者回传的 review JSON schema */
  outputSchema: string;
}

/** 一条已导入的评审结果（来源可区分 external / internal）。 */
export interface ReviewResultEntry {
  id: string;
  source: ReviewResultSource;
  importedAt: string;
  /** 结构化评审结论（058 同型：verdict + reason + unmet + suggestions + evidence） */
  conclusion: ReviewConclusion;
  /** 导入的原始文本（评审者粘贴的内容，保留可回读） */
  raw: string;
}

/** 持久化在 <root>/<review-id>/meta.json 的完整记录（handoff 快照 + 元数据 + 已导入结果）。 */
export interface ReviewHandoffRecord extends ReviewHandoffContent {
  id: string;
  /** pending → imported */
  status: ReviewStatus;
  /** 记录级来源：handoff 面向外部评审（external）；结果条目级 source 更细 */
  source: 'external';
  createdAt: string;
  updatedAt: string;
  /** 被评审任务所在工作区（上下文/展示；改动文件路径相对它解释） */
  workspaceRoot?: string;
  /** 已导入的评审结果（按导入时间追加） */
  results: ReviewResultEntry[];
}

/** createHandoff 输入 —— 上层把任务+验收+改动+测试组装成载荷；checklist 缺省按 acceptance 生成。 */
export interface HandoffCreateInput {
  task: string;
  acceptance?: readonly string[];
  changedFiles?: readonly string[];
  diffSummary?: string;
  testResults?: string;
  constraints?: readonly string[];
  /** 显式检查清单；缺省 = defaultReviewChecklist() */
  checklist?: readonly string[];
  workspaceRoot?: string;
}

/** 记录级来源恒为 external（本记录 = 一次外部评审 handoff）。 */
export type ReviewRecordSource = 'external';
