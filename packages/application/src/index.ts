export { composeHarness } from './compose.js';
export type { ComposeOptions, ComposedHarness, ComposeMcpConnection, UsageStoreLike } from './compose.js';

export { ProjectRegistry } from './project/ProjectRegistry.js';
export type { Project, ProjectRegistryOptions } from './project/ProjectRegistry.js';

export { SessionRegistry } from './session/SessionRegistry.js';
export type { SessionMeta, SessionInput, SessionRegistryOptions } from './session/SessionRegistry.js';

export { SessionController } from './session/SessionController.js';
export type { SessionControllerOptions, SessionState, SessionPermission } from './session/SessionController.js';