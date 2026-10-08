// agents cannot depend on engine: the pure outer state machine lives in tools.
export { NoProgressBreaker } from '@vessel/tools';
export type { BreakerConfig, StepObservation, ConvergenceCheckResult, WorkspaceStateFingerprint } from '@vessel/shared';
