export * from './ir/BehaviorIR.js';
export * from './compiler/Compiler.js';
export { SELF_HOSTED_SURFACE, validateSurfaceSpec } from './surface/SurfaceSpec.js';
export type { InstallMode, SurfaceCaps, SurfaceSpec } from './surface/SurfaceSpec.js';
export { behaviorSnapshotHash } from './compiler/SemanticSnapshot.js';
export { BEHAVIOR_CATEGORIES, BEHAVIOR_COMPATIBILITY_LEVELS } from '@vessel/shared';
export type { BehaviorCategory, BehaviorCompatibility, BehaviorInspection, BehaviorLayerInspection, BehaviorEntryInspection, BehaviorDiagnostic, BehaviorAssertionResult, BehaviorPermissions } from '@vessel/shared';
