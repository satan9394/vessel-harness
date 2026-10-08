export interface UsageSummary {
  measuredCalls?: number;
  promptTokensTotal: number;
  cachedTokensTotal: number;
  overallCacheHitRate: number;
  estimatedSavingsUsd: number;
  costUsd: number;
  estimated: boolean;
}
export interface CacheUsageMetrics {
  promptTokens: number;
  cachedTokens: number;
  creationTokens: number;
  billedHitRate: number;
  estimatedSavingsUsd: number;
  provider: string;
  model: string;
  estimated?: boolean;
}

