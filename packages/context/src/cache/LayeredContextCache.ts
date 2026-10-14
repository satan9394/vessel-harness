import { createHash } from 'node:crypto';
import { canonicalJson } from '@vessel/llm';
import type { ContextCacheLayer, ContextCacheLayerSnapshot } from '@vessel/shared';

export function contextDependencyHash(dependencies: unknown): string {
  return createHash('sha256').update(canonicalJson(dependencies)).digest('hex');
}

const layers: readonly ContextCacheLayer[] = ['assembly', 'provider-prefix', 'projection', 'token-estimation'];

/** One current version per fixed assembly slot: old revisions do not accumulate. */
export class LayeredContextCache {
  private readonly entries = new Map<ContextCacheLayer, Map<string, { hash: string; value: unknown }>>();
  private readonly stats = new Map<ContextCacheLayer, { dependencyHash: string; hits: number; misses: number; invalidations: number }>();

  constructor() {
    for (const layer of layers) {
      this.entries.set(layer, new Map());
      this.stats.set(layer, { dependencyHash: '', hits: 0, misses: 0, invalidations: 0 });
    }
  }

  get<T>(layer: ContextCacheLayer, dependencies: unknown, compute: () => T, slot = 'default'): T {
    const hash = contextDependencyHash(dependencies);
    const entries = this.entries.get(layer)!;
    const stats = this.stats.get(layer)!;
    const cached = entries.get(slot);
    stats.dependencyHash = hash;
    if (cached?.hash === hash) {
      stats.hits++;
      // Return an independent view so request mutation cannot poison later cache hits.
      return structuredClone(cached.value) as T;
    }
    const value = compute();
    stats.misses++;
    if (cached) stats.invalidations++;
    entries.set(slot, { hash, value: structuredClone(value) });
    return value;
  }

  snapshot(): ContextCacheLayerSnapshot[] {
    return layers.map(layer => ({ layer, ...this.stats.get(layer)!, entries: this.entries.get(layer)!.size }));
  }
}
