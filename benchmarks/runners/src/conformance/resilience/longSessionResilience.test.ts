import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BoundedStdioTransport } from '@vessel/tools';
import { RESILIENCE_FACTS, runLongSessionResilience } from './LongSessionResilienceScenario.js';
import { scoreLongSessionResilience, type ResilienceEvidence } from './metrics.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), createJob: vi.fn(), enumerate: vi.fn(), terminate: vi.fn(), killTree: vi.fn() }));
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: mocks.spawn }));
vi.mock('@vessel/runtime', async importOriginal => {
  const actual = await importOriginal<typeof import('@vessel/runtime')>();
  return { ...actual, createJobObject: mocks.createJob, defaultKillWindowsTree: mocks.killTree,
    WindowsJobObject: { ...actual.WindowsJobObject, enumerateDescendants: mocks.enumerate, terminatePids: mocks.terminate } };
});

const expected = { rounds: 100, facts: RESILIENCE_FACTS };
let root: string;
let evidence: ResilienceEvidence;
let jobDisposeCalls = 0;

async function cleanupUnresponsiveMcp() {
  vi.useFakeTimers();
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  const alive = new Set([123, 124, 125]);
  const child = Object.assign(new EventEmitter(), { pid: 123, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn(() => { alive.delete(123); child.emit('exit', null, 'SIGKILL'); return true; }) });
  mocks.spawn.mockImplementation((command: string) => { if (command !== 'offline-mcp') throw new Error('Real subprocess forbidden'); return child; });
  mocks.enumerate.mockResolvedValue([124, 125]);
  const dispose = vi.fn(() => new Promise<void>(resolve => setTimeout(() => {
    alive.clear(); child.emit('exit'); resolve();
  }, 2000)));
  mocks.createJob.mockResolvedValue({ jobName: 'offline-job', attached: true, attachDescendants: async () => 2, dispose });
  try {
    const transport = new BoundedStdioTransport('offline-mcp');
    const pending = transport.request('tools/call', {}).then(() => 'unexpected response', (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(0);
    const start = Date.now();
    const closing = transport.close();
    await vi.advanceTimersByTimeAsync(2000); await closing;
    expect(await pending).toContain('closed');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(vi.getTimerCount()).toBe(0);
    jobDisposeCalls = dispose.mock.calls.length;
    return { cleanupMs: Date.now() - start, orphanProcessCount: alive.size };
  } finally { platform.mockRestore(); vi.useRealTimers(); }
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vessel-long-resilience-'));
  evidence = await runLongSessionResilience({ root, cleanupUnresponsiveMcp, retireArtifact: file => fs.rm(file) });
}, 30_000);
afterAll(async () => { vi.restoreAllMocks(); if (root) await fs.rm(root, { recursive: true, force: true }); });

describe('100-round offline blind resilience', () => {
  it('preserves facts, durable events and sequences through overflow, hung MCP and restart', () => {
    const metrics = scoreLongSessionResilience(evidence, expected);
    expect(evidence.rounds).toHaveLength(100);
    expect(evidence.injectedTokens).toBeGreaterThanOrEqual(500_000);
    expect(evidence.pressureCompactions).toBeGreaterThan(0);
    expect(evidence.overflowInterceptedCount).toBe(1);
    expect(evidence.overflowAttempts).toBe(2);
    expect(jobDisposeCalls).toBe(1);
    expect(evidence.reopenCount).toBe(1);
    expect(metrics.dataIntegrityRate).toBe(100);
    expect(metrics.overallPreservationScore).toBeGreaterThanOrEqual(90);
    expect(metrics.orphanProcessCount).toBe(0);
    expect(metrics.workspaceResidueCount).toBe(0);
    expect(metrics.passed).toBe(true);
    console.log('[resilience]', JSON.stringify(metrics));
  });
  it.each(['missing', 'corrupt', 'reordered'])('detects %s durable evidence instead of trusting producer completion', kind => {
    const modified = structuredClone(evidence);
    if (kind === 'missing') modified.replayedRecordHashes.pop();
    if (kind === 'corrupt') modified.replayedRecordHashes[0] = 'corrupt';
    if (kind === 'reordered') modified.replayedSequences[0] = 2;
    const metrics = scoreLongSessionResilience(modified, expected);
    expect(metrics.dataIntegrityRate).toBeLessThan(100); expect(metrics.passed).toBe(false);
  });
  it('rejects fact loss, fabricated duplicate rounds and cleanup residue', () => {
    const lost = structuredClone(evidence);
    for (const round of lost.rounds) round.facts = {};
    expect(scoreLongSessionResilience(lost, expected).overallPreservationScore).toBeLessThan(90);
    const duplicates = structuredClone(evidence);
    duplicates.rounds.push(...structuredClone(duplicates.rounds));
    expect(scoreLongSessionResilience(duplicates, expected).passed).toBe(false);
    for (const field of ['orphanProcessCount', 'workspaceResidueCount'] as const) {
      expect(scoreLongSessionResilience({ ...evidence, [field]: 1 }, expected).passed).toBe(false);
    }
  });
});
