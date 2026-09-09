/**
 * packages/application/providers — provider catalog + model enumeration SSOT
 * (task 098). Lives in the application layer so BOTH consumers (apps/cli wizard
 * and benchmarks/runners real-model lane) depend downward on @vessel/application
 * instead of the runners reaching up into @vessel/cli (that edge made the
 * `tsc -b` project graph cyclic → TS5055).
 */
export {
  PROVIDER_CATALOG,
  PROVIDER_CATEGORY_LABELS,
  findPreset,
  type ProviderPreset,
  type ProviderCategory,
} from './presets.data.js';

export {
  ANTHROPIC_BUILTIN_MODELS,
  fetchOpenAIModels,
  modelsForProtocol,
  type ModelSource,
} from './modelFetcher.js';
