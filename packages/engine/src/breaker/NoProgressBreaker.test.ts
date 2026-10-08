import { describe, expect, it } from 'vitest';
import { NoProgressBreaker, type WorkspaceStateFingerprint } from './NoProgressBreaker.js';
const fp = (hash = 'same', timestamp = 1): WorkspaceStateFingerprint => ({ timestamp, trackedFilesHash: hash, uncommittedDiffBytes: 0, fileCount: 1 });
describe('NoProgressBreaker', () => {
  it('breaks after exactly three unchanged tool executions and ignores snapshot time', () => {
    const breaker = new NoProgressBreaker(); breaker.baseline(fp());
    for (let step = 1; step <= 3; step++) expect(breaker.recordStep({ stepIndex: step, toolName: 'Read', isError: false, fingerprint: fp('same', step) }).shouldBreak).toBe(step === 3);
  });
  it('resets stagnation on physical change and retains the last meaningful change', () => {
    const breaker = new NoProgressBreaker(); breaker.baseline(fp());
    breaker.recordStep({ stepIndex: 1, toolName: 'Write', isError: false, fingerprint: fp('new', 2) });
    let result;
    for (let step = 2; step <= 4; step++) result = breaker.recordStep({ stepIndex: step, toolName: 'Read', isError: false, fingerprint: fp('new', step) });
    expect(result).toMatchObject({ shouldBreak: true, reason: 'workspace_stagnation', lastMeaningfulChange: { stepIndex: 1, toolName: 'Write', timestamp: 2 } });
    breaker.reset(); expect(breaker.recordStep({ stepIndex: 1, toolName: 'Read', isError: false, fingerprint: fp() }).shouldBreak).toBe(false);
  });
  it('breaks identical errors even with writes, resets on success or different errors', () => {
    const breaker = new NoProgressBreaker({ maxStagnantSteps: 10 });
    const step = (n: number, code?: string) => breaker.recordStep({ stepIndex: n, toolName: 'Shell', isError: !!code, errorCode: code, fingerprint: fp(String(n)) });
    step(1, 'ENOENT'); step(2, 'EACCES'); expect(step(3).consecutiveErrorCount).toBe(0);
    step(4, 'ENOENT'); step(5, 'ENOENT'); expect(step(6, 'ENOENT')).toMatchObject({ shouldBreak: true, reason: 'repeated_tool_error', consecutiveErrorCount: 3 });
  });
  it('rejects invalid thresholds', () => { expect(() => new NoProgressBreaker({ maxStagnantSteps: 0 })).toThrow(); });
});
