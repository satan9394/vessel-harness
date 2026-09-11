/**
 * tui/costView — 会话内成本文案的纯渲染（G-09 / BRIEF-08）。
 *
 * 为什么单独成模块：TUI 主循环（chat.ts）很大，展示逻辑抽成纯函数后
 * 既可单测、又不必在主循环里塞字符串拼接。
 * 约定：只做「数字 → 文案」，不读文件、不访问 store、不抛异常。
 */

/** 用量累计的最小快照（`UsageStore.totals()` 的子集，便于单测构造）。 */
export interface UsageTotalsLike {
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

const money = (n: number): string => `$${n.toFixed(4)}`;

/** `/cost`（别名 `/usage`）的多行输出：本会话 / 累计（今日行由调用方按需追加）。 */
export function renderCostLines(now: UsageTotalsLike, base?: UsageTotalsLike): string {
  const dCalls = now.calls - (base?.calls ?? 0);
  const dCost = now.costUsd - (base?.costUsd ?? 0);
  const session =
    dCalls === 0
      ? '本会话暂无用量记录'
      : `本会话: ${money(dCost)} · ${dCalls} 次调用 · ${now.inputTokens - (base?.inputTokens ?? 0)} in / ${now.outputTokens - (base?.outputTokens ?? 0)} out`;
  return [session, `累计: ${money(now.costUsd)} · ${now.calls} 次`].join('\n');
}

/** 单回合增量的一行摘要（供 TUI 每回合打印）。 */
export function renderTurnDelta(now: UsageTotalsLike, base?: UsageTotalsLike): string {
  const dCost = now.costUsd - (base?.costUsd ?? 0);
  const dIn = now.inputTokens - (base?.inputTokens ?? 0);
  const dOut = now.outputTokens - (base?.outputTokens ?? 0);
  const detail = dIn + dOut === 0 ? '（无用量记录）' : `（${dIn} in / ${dOut} out）`;
  return `· 本回合 ${money(dCost)}${detail}`;
}
