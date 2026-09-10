/** Cumulative usage/cost triple after applying an incremental usage delta. */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** cache 写入（cache_creation）tokens，task 107（与 shared ChatUsage 同名单字段） */
  cacheCreationTokens: number;
  calls: number;
  costUsd: number;
}

export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, calls: 0, costUsd: 0 };
}

/** Rough per-1M-token USD pricing mirroring configs/pricing.json default entry. */
const PRICE_INPUT = 0.5;
const PRICE_OUTPUT = 1.5;
const PRICE_CACHE_READ = 0.1;
/**
 * cache 写入价按 input × 1.25 推导（089 cacheWrite 三档的 derived 档：价目缺
 * cacheWrite 字段时的兜底估算；configs/pricing.json default 无 cacheWrite）。
 */
const PRICE_CACHE_WRITE = PRICE_INPUT * 1.25;

/** Add one incremental usage delta to the running totals. */
export function applyUsageDelta(totals: UsageTotals, delta: {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  calls?: number;
}): UsageTotals {
  const inputTokens = totals.inputTokens + (delta.inputTokens ?? 0);
  const outputTokens = totals.outputTokens + (delta.outputTokens ?? 0);
  const cacheReadTokens = totals.cacheReadTokens + (delta.cacheReadTokens ?? 0);
  const cacheCreationTokens = totals.cacheCreationTokens + (delta.cacheCreationTokens ?? 0);
  const costUsd =
    (inputTokens / 1_000_000) * PRICE_INPUT +
    (outputTokens / 1_000_000) * PRICE_OUTPUT +
    (cacheReadTokens / 1_000_000) * PRICE_CACHE_READ +
    (cacheCreationTokens / 1_000_000) * PRICE_CACHE_WRITE;
  // Preference the server's cumulative call count when present, else count locally.
  const calls = typeof delta.calls === 'number' ? delta.calls : totals.calls + (delta.calls ?? 0);
  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, calls, costUsd };
}

function fmtUsd(n: number): string {
  if (n < 0.001) return '~$0.0000';
  return `$${n.toFixed(4)}`;
}

/** Thin read-only usage strip (session header or footer). */
export default function UsageBar({ usage }: { usage: UsageTotals }) {
  if (usage.calls === 0 && usage.inputTokens === 0 && usage.outputTokens === 0) {
    return null;
  }
  // cache 分项：读/写并列（task 107）。只显示实际发生的项，缺字段一律按 0 回退。
  const cacheParts: string[] = [];
  if (usage.cacheReadTokens > 0) cacheParts.push(`读 ${usage.cacheReadTokens}`);
  if (usage.cacheCreationTokens > 0) cacheParts.push(`写 ${usage.cacheCreationTokens}`);
  const cacheLabel = cacheParts.length > 0 ? ` (cache ${cacheParts.join(' / ')})` : '';
  const derivedHint =
    usage.cacheCreationTokens > 0
      ? '；cache 写价按 input×1.25 估算（价目缺 cacheWrite 字段时，089 derived）'
      : '';
  return (
    <div className="usage-bar" title={`累计模型用量（calls / tokens / 估算成本）${derivedHint}`}>
      <span className="usage-calls">calls {usage.calls}</span>
      <span className="usage-tokens">
        {usage.inputTokens}+{usage.outputTokens} tok{cacheLabel}
      </span>
      <span className="usage-cost">{fmtUsd(usage.costUsd)}</span>
    </div>
  );
}