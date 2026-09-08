/** Cumulative usage/cost triple after applying an incremental usage delta. */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  calls: number;
  costUsd: number;
}

export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, calls: 0, costUsd: 0 };
}

/** Rough per-1M-token USD pricing mirroring configs/pricing.json default entry. */
const PRICE_INPUT = 0.5;
const PRICE_OUTPUT = 1.5;
const PRICE_CACHE_READ = 0.1;

/** Add one incremental usage delta to the running totals. */
export function applyUsageDelta(totals: UsageTotals, delta: {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  calls?: number;
}): UsageTotals {
  const inputTokens = totals.inputTokens + (delta.inputTokens ?? 0);
  const outputTokens = totals.outputTokens + (delta.outputTokens ?? 0);
  const cacheReadTokens = totals.cacheReadTokens + (delta.cacheReadTokens ?? 0);
  const costUsd =
    (inputTokens / 1_000_000) * PRICE_INPUT +
    (outputTokens / 1_000_000) * PRICE_OUTPUT +
    (cacheReadTokens / 1_000_000) * PRICE_CACHE_READ;
  // Preference the server's cumulative call count when present, else count locally.
  const calls = typeof delta.calls === 'number' ? delta.calls : totals.calls + (delta.calls ?? 0);
  return { inputTokens, outputTokens, cacheReadTokens, calls, costUsd };
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
  return (
    <div className="usage-bar" title="累计模型用量（calls / tokens / 估算成本）">
      <span className="usage-calls">calls {usage.calls}</span>
      <span className="usage-tokens">
        {usage.inputTokens}+{usage.outputTokens} tok{usage.cacheReadTokens > 0 ? ` (cache ${usage.cacheReadTokens})` : ''}
      </span>
      <span className="usage-cost">{fmtUsd(usage.costUsd)}</span>
    </div>
  );
}