import type { WorkspaceStateFingerprint, BreakerConfig, StepObservation, ConvergenceCheckResult } from '@vessel/shared';

/** Pure state machine shared by the outer engine and isolated agent runtimes. */
export class NoProgressBreaker {
  private previous?: WorkspaceStateFingerprint;
  private stagnant = 0;
  private errors = 0;
  private errorCode?: string;
  private lastChange?: ConvergenceCheckResult['lastMeaningfulChange'];
  private readonly maxStagnant: number;
  private readonly maxErrors: number;

  constructor(config: BreakerConfig = {}) {
    this.maxStagnant = config.maxStagnantSteps ?? 3;
    this.maxErrors = config.maxConsecutiveErrors ?? 3;
    for (const limit of [this.maxStagnant, this.maxErrors]) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('NoProgressBreaker: limits must be positive integers');
    }
  }

  /** A baseline does not consume a tool step or claim a meaningful change. */
  baseline(fingerprint: WorkspaceStateFingerprint): void { this.previous = fingerprint; }

  recordStep(o: StepObservation): ConvergenceCheckResult {
    const changed = !this.previous || o.fingerprint.trackedFilesHash !== this.previous.trackedFilesHash ||
      o.fingerprint.uncommittedDiffBytes !== this.previous.uncommittedDiffBytes || o.fingerprint.fileCount !== this.previous.fileCount;
    this.stagnant = changed ? 0 : this.stagnant + 1;
    if (changed) this.lastChange = { stepIndex: o.stepIndex, toolName: o.toolName, timestamp: o.fingerprint.timestamp, trackedFilesHash: o.fingerprint.trackedFilesHash };
    this.previous = o.fingerprint;
    const code = o.isError ? o.errorCode : undefined;
    this.errors = code ? (code === this.errorCode ? this.errors + 1 : 1) : 0;
    this.errorCode = code;
    const reason = this.errors >= this.maxErrors ? 'repeated_tool_error' : this.stagnant >= this.maxStagnant ? 'workspace_stagnation' : undefined;
    return { shouldBreak: !!reason, stagnantStepCount: this.stagnant, consecutiveErrorCount: this.errors,
      reason, repeatedError: this.errorCode, lastMeaningfulChange: this.lastChange,
      suggestion: reason ? 'Inspect the repeated failure and last physical change; adjust the strategy before resuming.' : undefined };
  }

  reset(): void { this.previous = undefined; this.stagnant = 0; this.errors = 0; this.errorCode = undefined; this.lastChange = undefined; }
}

