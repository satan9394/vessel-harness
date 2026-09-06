/**
 * llm/router — task category classifier (V0.4-M1; MISSION-V0.4 §3.1).
 *
 * Maps a user task prompt to a task category. Deterministic (keyword rules,
 * offline-testable) by default; an LLM classifier seam is declared but not
 * wired by default. Category set is configurable data, not hardcoded into
 * core/agents mechanisms (决策点 12/13: roles/presets are configuration).
 *
 * Categories align with the kinds of work a harness routes (implementation /
 * search / review / planning / simple-fix / architecture). Naming follows
 * 任务书 V0.5 Task Selection semantics — not copied from any product's roles.
 */

export type TaskCategory =
  | 'implementation'
  | 'simple_fix'
  | 'search'
  | 'review'
  | 'planning'
  | 'architecture'
  | 'unknown';

export const TASK_CATEGORIES: TaskCategory[] = [
  'implementation',
  'simple_fix',
  'search',
  'review',
  'planning',
  'architecture',
  'unknown',
];

export interface CategoryRule {
  category: Exclude<TaskCategory, 'unknown'>;
  /** keywords — any hit (case-insensitive) assigns the category */
  keywords: string[];
}

/** default deterministic rule table (configurable — replaceable preset). */
export const DEFAULT_CATEGORY_RULES: CategoryRule[] = [
  { category: 'search', keywords: ['搜索', '查找', 'find', 'search', 'grep', 'locate', 'where is', '调用点', '哪些'] },
  { category: 'review', keywords: ['审查', '评审', 'review', 'code review', '挑错', '检查代码', 'audit'] },
  { category: 'planning', keywords: ['规划', '计划', 'plan', '拆解', '步骤', '路线', 'roadmap', '设计任务'] },
  { category: 'architecture', keywords: ['架构', 'architecture', '设计', '模块边界', '依赖', '重构设计', '方案'] },
  { category: 'simple_fix', keywords: ['修一下', '修复', '修 bug', '小修', '改个', 'quick fix', 'fix', '报错', 'crash', 'typo', 'bug'] },
  { category: 'implementation', keywords: ['实现', '开发', '编写', 'implement', 'build', 'add', 'feature', '功能', '写出', '新增'] },
];

/** normalize for matching: lowercase + trim. */
function norm(s: string): string {
  return s.toLowerCase().trim();
}

/**
 * Deterministic classifier — first matching rule wins (rule order = priority).
 * Returns 'unknown' when no rule hits.
 */
export function classifyTask(prompt: string, rules: CategoryRule[] = DEFAULT_CATEGORY_RULES): TaskCategory {
  const text = norm(prompt);
  if (!text) return 'unknown';
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (text.includes(norm(kw))) return rule.category;
    }
  }
  return 'unknown';
}

/** LLM classifier seam (declared; deterministic impl is the default). */
export interface TaskClassifier {
  classify(prompt: string): Promise<TaskCategory>;
}

/** deterministic adapter of classifyTask to the TaskClassifier seam. */
export class DeterministicTaskClassifier implements TaskClassifier {
  constructor(private readonly rules: CategoryRule[] = DEFAULT_CATEGORY_RULES) {}
  async classify(prompt: string): Promise<TaskCategory> {
    return classifyTask(prompt, this.rules);
  }
}
