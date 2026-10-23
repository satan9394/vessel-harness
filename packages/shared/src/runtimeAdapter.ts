/**
 * @vessel/shared — Interactive Runtime Adapter contract (task 245 / ARCH-04).
 *
 * Separates benchmark execution (BenchmarkHarnessAdapter running static fixtures)
 * from ongoing, interactive task execution (InteractiveRuntimeAdapter).
 */

export type FeatureSupport = 'supported' | 'unsupported' | 'unknown';

export type RuntimeCapabilityName =
  | 'start'
  | 'events'
  | 'steer'
  | 'cancel'
  | 'resume'
  | 'approvals'
  | 'artifacts';

export type RuntimeCapabilities = Record<RuntimeCapabilityName, FeatureSupport>;

export interface SafeRunInput {
  sessionId: string;
  workspaceRoot: string;
  task: string;
  allowedTools?: string[];
  options?: Record<string, unknown>;
}

export interface ArtifactReceipt {
  id: string;
  type: string;
  path?: string;
  sha256?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeProbeResult {
  platform?: string;
  transformVersion?: number;
  evidenceSource?: string;
  installedVersion?: string;
  adapterVersion: string;
  capabilities: RuntimeCapabilities;
  probedAt: number;
  degradedReasons?: Partial<Record<RuntimeCapabilityName, string>>;
}

export interface InteractiveRuntimeAdapter {
  readonly id: string;
  readonly version: string;
  probe(): Promise<RuntimeProbeResult>;
  startRun(input: SafeRunInput): Promise<{ runId: string }>;
  subscribeEvents?(runId: string, cursor?: string): AsyncIterable<unknown>;
  steerRun?(runId: string, text: string): Promise<void>;
  cancelRun?(runId: string): Promise<void>;
  resumeRun?(runId: string): Promise<void>;
  getArtifacts?(runId: string): Promise<ArtifactReceipt[]>;
}
