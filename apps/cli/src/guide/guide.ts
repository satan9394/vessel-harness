/**
 * apps/cli/src/guide/guide.ts — 新手分步引导（task 117）。
 *
 * `vessel guide` 输出分步新手指南：①这是什么（Vessel）②怎么问术语
 * ③常用命令 ④怎么设置主题/语言。文案跟随 locale（zh / en）；
 * locale 来源：`--locale` 标志 > settings 里存的 locale > zh。
 *
 * 文案为本项目自有表述（clean-room，与 116 的「提示词工程引导线」相互独立）。
 */

export type GuideLocale = 'zh' | 'en';

export interface GuideMap {
  header: string;
  steps: string[];
  footer: string;
}

export const GUIDE_ZH: GuideMap = {
  header: '=== 新手引导 · Vessel（vessel guide）===',
  steps: [
    '① 这是什么：Vessel 是一个本地优先的可组合 Agent Harness CLI/小助手。你把任务用自然语言告诉它（如「总结当前工作区 README」），它按需调用工具一步步完成；供应商、用量、会话等状态都在本机 ~/.vessel。',
    '② 怎么问术语：输入 `vessel explain <术语>`（如 `vessel explain Call`），得到中文解释 + 英文术语 + 一句话用途；`vessel list-terms` 查看全部词条。TUI 交互里用 `/explain <术语>` 或 `? <术语>` 触发同一词库。',
    '③ 常用命令：`vessel` 进交互对话；`vessel run --prompt "…"` 单发任务；`vessel setup` 或 `vessel provider add …` 配供应商；`vessel usage` 看用量与成本；`vessel guide` 随时重看本引导；`vessel --help` 看全部命令。',
    '④ 怎么设置主题/语言：`vessel settings list` 显示每个设置项的中英文说明与可选值；`vessel settings set theme dark|light` 仅保存主题偏好，当前版本不影响任何输出/渲染；`vessel settings set locale zh|en` 切换引导/解释的输出语言（本引导即跟随 locale）。',
  ],
  footer: '提示：任何词不懂，就先 `vessel explain <术语>`。',
};

export const GUIDE_EN: GuideMap = {
  header: '=== Getting Started · Vessel (vessel guide) ===',
  steps: [
    '① What this is: Vessel is a local-first, composable Agent Harness CLI assistant. Tell it a task in natural language (e.g. "summarize this workspace README") and it calls tools step by step; providers, usage and sessions stay on your machine under ~/.vessel.',
    '② Asking about terms: run `vessel explain <term>` (e.g. `vessel explain Call`) to get the Chinese explanation, the English term and a one-line usage; `vessel list-terms` shows the full glossary. In the TUI use `/explain <term>` or `? <term>` — same shared glossary.',
    '③ Common commands: `vessel` opens the interactive chat; `vessel run --prompt "…"` runs a one-shot task; `vessel setup` or `vessel provider add …` configures providers; `vessel usage` shows usage and cost; `vessel guide` re-reads this guide; `vessel --help` lists everything.',
    '④ Setting theme/language: `vessel settings list` shows each setting with bilingual explanation and allowed values; `vessel settings set theme dark|light` only stores the theme preference — it does not affect any output or rendering in this version; `vessel settings set locale zh|en` switches the guide/explain output language (this guide follows the locale).',
  ],
  footer: 'Tip: if a term is unfamiliar, start with `vessel explain <term>`.',
};

export function guideFor(locale: GuideLocale): GuideMap {
  return locale === 'en' ? GUIDE_EN : GUIDE_ZH;
}

/** 渲染分步引导（locale 决定输出语言）。 */
export function renderGuide(locale: GuideLocale): string {
  const g = guideFor(locale);
  return [g.header, ...g.steps, g.footer].join('\n');
}