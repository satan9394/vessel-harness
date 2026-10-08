import type { ConvergenceCheckResult, ToolErrorPayload } from '@vessel/shared';
import { NoProgressBreaker } from './NoProgressBreaker.js';
import { WorkspaceFingerprinter } from '../filesystem/workspaceFingerprint.js';

/** Composition adapter; callers supply persistence and their own loop interrupt. */
export class NoProgressGuard {
  private readonly breaker = new NoProgressBreaker();
  private step = 0;
  private stopped = false;
  private signal?: AbortSignal | null;
  private initialization?: Promise<void>;
  private observations: Promise<void> = Promise.resolve();
  private generation = 0;
  constructor(private readonly root: string, private readonly stop: (diagnostic: ConvergenceCheckResult & { stepIndex: number; toolName: string }, isCurrent: () => boolean) => Promise<void>) {}
  private current(generation: number): boolean { return generation === this.generation && !this.signal?.aborted; }
  private async unavailable(toolName: string, error: unknown, generation: number): Promise<void> {
    if (!this.current(generation) || this.stopped) return;
    this.stopped = true;
    await this.stop({ shouldBreak: true, stagnantStepCount: 0, consecutiveErrorCount: 0,
      stepIndex: this.step, toolName, reason: 'workspace_observation_failed', repeatedError: String(error),
      suggestion: 'Restore read access to the workspace before resuming; physical progress cannot be verified.' }, () => this.current(generation));
  }
  async start(): Promise<void> {
    const generation = ++this.generation;
    this.breaker.reset(); this.step = 0; this.stopped = false; this.observations = Promise.resolve();
    try {
      const fingerprint = await WorkspaceFingerprinter.compute(this.root);
      if (this.current(generation)) this.breaker.baseline(fingerprint);
    }
    catch (error) { await this.unavailable('workspace_baseline', error, generation); throw error; }
  }
  async observe(toolName: string, error?: ToolErrorPayload, generation = this.generation): Promise<void> {
    if (!this.current(generation) || this.stopped) return;
    let fingerprint;
    try { fingerprint = await WorkspaceFingerprinter.compute(this.root); }
    catch (error) { await this.unavailable(toolName, error, generation); throw error; }
    if (!this.current(generation) || this.stopped) return;
    const result = this.breaker.recordStep({ stepIndex: ++this.step, toolName, fingerprint, isError: !!error,
      errorCode: error ? String(error.detail?.code ?? (error as ToolErrorPayload & { code?: string }).code ?? error.errorClass) : undefined });
    if (result.shouldBreak) { this.stopped = true; await this.stop({ ...result, stepIndex: this.step, toolName }, () => this.current(generation)); }
  }
  async run<T extends { error?: ToolErrorPayload }>(toolName: string, signal: AbortSignal | null | undefined, execute: () => Promise<T>): Promise<T> {
    if (!this.initialization || this.signal !== signal) {
      this.signal = signal;
      this.initialization = this.start();
    }
    const generation = this.generation;
    await this.initialization;
    if (!this.current(generation)) throw new Error('Tool turn aborted or superseded');
    let result: T;
    try { result = await execute(); }
    catch (error) {
      const classified = { errorClass: 'UNKNOWN' as const, message: String(error), code: (error as { code?: string })?.code };
      if (this.current(generation)) {
        this.observations = this.observations.then(() => this.observe(toolName, classified, generation));
        await this.observations;
      }
      throw error;
    }
    // Policy rejection never executed the tool; the core denial breaker owns it.
    if (this.current(generation) && result.error?.errorClass !== 'DENIED') {
      this.observations = this.observations.then(() => this.observe(toolName, result.error, generation));
      await this.observations;
    }
    return result;
  }
}
