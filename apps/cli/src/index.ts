export { composeHarness } from '@vessel/application';
export type { ComposeOptions, ComposedHarness } from '@vessel/application';
export { main } from './cli.js';

// V1.1-C: reuse the built-in provider catalog (presets SSOT) + /v1/models fetcher as
// public API so the benchmark lane / release gates can build an opencode-go real
// provider from the same registry the CLI wizard uses (no duplicated constants).
// task 098: the SSOT itself now lives in @vessel/application (shared with
// benchmarks/runners); these re-exports keep the @vessel/cli public surface stable.
export { PROVIDER_CATALOG, findPreset, type ProviderPreset, type ProviderCategory } from '@vessel/application';
export { fetchOpenAIModels, type ModelSource } from '@vessel/application';
