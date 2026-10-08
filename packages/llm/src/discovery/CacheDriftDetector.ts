import type { CacheUsageMetrics } from '@vessel/shared';
export interface CacheDriftAlert {
  sessionId: string;
  previousHitRate: number;
  currentHitRate: number;
  previousPrefixHash?: string;
  currentPrefixHash?: string;
  droppedTokens: number;
  timestamp: number;
}
export class CacheDriftDetector {
  private previous = new Map<string, { metrics: CacheUsageMetrics; prefixHash?: string }>();
  check(sessionId: string, metrics: CacheUsageMetrics, prefixHash?: string): CacheDriftAlert | null {
    if (metrics.promptTokens <= 0) return null;
    const previous = this.previous.get(sessionId);
    this.previous.set(sessionId, { metrics, prefixHash });
    if (!previous || previous.metrics.model !== metrics.model || previous.metrics.provider !== metrics.provider
      || previous.metrics.billedHitRate <= 0.8 || metrics.billedHitRate !== 0) return null;
    return { sessionId, previousHitRate: previous.metrics.billedHitRate, currentHitRate: metrics.billedHitRate,
      previousPrefixHash: previous.prefixHash, currentPrefixHash: prefixHash,
      droppedTokens: previous.metrics.cachedTokens, timestamp: Date.now() };
  }
}
