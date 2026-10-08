export interface WorkspaceStateFingerprint {
  timestamp: number;
  trackedFilesHash: string;
  uncommittedDiffBytes: number;
  fileCount: number;
}

export interface BreakerConfig {
  maxStagnantSteps?: number;
  maxConsecutiveErrors?: number;
}

export interface StepObservation {
  stepIndex: number;
  toolName: string;
  isError: boolean;
  errorCode?: string;
  fingerprint: WorkspaceStateFingerprint;
}

export interface ConvergenceCheckResult {
  shouldBreak: boolean;
  stagnantStepCount: number;
  consecutiveErrorCount: number;
  reason?: string;
  repeatedError?: string;
  lastMeaningfulChange?: { stepIndex: number; toolName: string; timestamp: number; trackedFilesHash: string };
  suggestion?: string;
}


