export type ContextCacheLayer = 'assembly' | 'provider-prefix' | 'projection' | 'token-estimation';

/** Process-local derived cache evidence, never a claim of upstream cache acceptance. */
export interface ContextCacheLayerSnapshot {
  readonly layer: ContextCacheLayer;
  readonly dependencyHash: string;
  readonly hits: number;
  readonly misses: number;
  readonly invalidations: number;
  readonly entries: number;
}
