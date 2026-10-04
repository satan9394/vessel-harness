import type { SandboxConstraints } from '@vessel/shared';

export interface SandboxExecutionOptions {
  cwd: string;
  allowedWritePaths?: string[];
  maxMemoryBytes?: number;
  cpuTimeoutMs?: number;
  lowIntegrity?: boolean;
  signal?: AbortSignal;
}

export interface SandboxExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  sandboxed: boolean;
  isolationTier: 'windows-job-restricted' | 'bwrap-ns' | 'macos-seatbelt' | 'passthrough-fallback';
  constraints?: SandboxConstraints;
}

export interface NativeSandboxRunner {
  isAvailable(): Promise<boolean>;
  execute(command: string, args: string[], options: SandboxExecutionOptions): Promise<SandboxExecutionResult>;
}

export interface SandboxAuditEvent {
  isolationTier: SandboxExecutionResult['isolationTier'];
  sandboxed: boolean;
  outcome: 'enforced' | 'fallback' | 'denied';
  allowedWritePaths: string[];
  constraints?: SandboxConstraints;
  reason?: string;
}
