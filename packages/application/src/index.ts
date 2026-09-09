export { composeHarness } from './compose.js';
export type { ComposeOptions, ComposedHarness, ComposeMcpConnection, UsageStoreLike } from './compose.js';

export { ProjectRegistry } from './project/ProjectRegistry.js';
export type { Project, ProjectRegistryOptions } from './project/ProjectRegistry.js';

export { SessionRegistry } from './session/SessionRegistry.js';
export type { SessionMeta, SessionInput, SessionRegistryOptions } from './session/SessionRegistry.js';

export { SessionController } from './session/SessionController.js';
export type { SessionControllerOptions, SessionState, SessionPermission, SessionProjections } from './session/SessionController.js';

export * from './projections/index.js';

export * from './review/index.js';

export * from './credential/index.js';

// task 098: provider catalog + /v1/models fetcher (moved down from apps/cli) —
// shared SSOT for the CLI wizard and the benchmark real-model lane.
export {
  PROVIDER_CATALOG,
  PROVIDER_CATEGORY_LABELS,
  findPreset,
  type ProviderPreset,
  type ProviderCategory,
  ANTHROPIC_BUILTIN_MODELS,
  fetchOpenAIModels,
  modelsForProtocol,
  type ModelSource,
} from './providers/index.js';
