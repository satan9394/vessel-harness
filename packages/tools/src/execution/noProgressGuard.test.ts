import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NoProgressGuard } from './noProgressGuard.js';
import { WorkspaceFingerprinter } from '../filesystem/workspaceFingerprint.js';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-progress-guard-')); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
it('classifies concrete error codes despite physical writes and resets between turns', async () => {
  const stop = vi.fn(async () => {}); const guard = new NoProgressGuard(root, stop);
  const signal = new AbortController().signal;
  const execute = async () => {
    fs.writeFileSync(path.join(root, 'change'), String(Math.random()));
    return { error: { errorClass: 'TOOL_FAILURE' as const, message: 'failed', detail: { code: 'ENOENT' } } };
  };
  for (let i = 0; i < 3; i++) await guard.run('Read', signal, execute);
  expect(stop).toHaveBeenCalledWith(expect.objectContaining({ reason: 'repeated_tool_error', repeatedError: 'ENOENT', consecutiveErrorCount: 3, stagnantStepCount: 0 }), expect.any(Function));
  stop.mockClear();
  await guard.run('Read', new AbortController().signal, execute);
  expect(stop).not.toHaveBeenCalled();
});
it('stops before execution when the workspace cannot be observed, with an explicit diagnostic', async () => {
  vi.spyOn(WorkspaceFingerprinter, 'compute').mockRejectedValue(new Error('EACCES'));
  const stop = vi.fn(async () => {}); const execute = vi.fn(async () => ({}));
  const guard = new NoProgressGuard(root, stop);
  await expect(guard.run('Read', undefined, execute)).rejects.toThrow('EACCES');
  expect(execute).not.toHaveBeenCalled();
  expect(stop).toHaveBeenCalledWith(expect.objectContaining({ reason: 'workspace_observation_failed', repeatedError: 'Error: EACCES' }), expect.any(Function));
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type Diagnostic = Parameters<ConstructorParameters<typeof NoProgressGuard>[1]>[0];

it.each(['success', 'rejection', 'superseded'])('ignores late old execution %s after a new turn starts', async outcome => {
  const stop = vi.fn(async (_diagnostic: Diagnostic) => {}); const guard = new NoProgressGuard(root, stop);
  const old = new AbortController(); const next = new AbortController();
  const pending = deferred<{}>(); const entered = deferred<void>();
  const run = guard.run('Old', old.signal, () => { entered.resolve(); return pending.promise; });
  const settled = run.catch(error => error);
  await entered.promise; if (outcome !== 'superseded') old.abort();
  for (let i = 0; i < 2; i++) await guard.run('New', next.signal, async () => ({}));
  if (outcome !== 'rejection') pending.resolve({}); else pending.reject(new Error('late'));
  await settled;
  expect(stop).not.toHaveBeenCalled();
  await guard.run('New', next.signal, async () => ({}));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(stop.mock.calls[0]![0]).toMatchObject({ toolName: 'New', stepIndex: 3, stagnantStepCount: 3 });
});

it.each(['baseline', 'baseline_failure', 'observation', 'failure'])('fences delayed old %s and queued observations', async phase => {
  const snapshot = await WorkspaceFingerprinter.compute(root);
  const delayed = deferred<typeof snapshot>(); const entered = deferred<void>();
  const compute = vi.spyOn(WorkspaceFingerprinter, 'compute').mockResolvedValue(snapshot);
  const baseline = phase.startsWith('baseline');
  if (baseline) compute.mockImplementationOnce(() => { entered.resolve(); return delayed.promise; });
  else compute.mockResolvedValueOnce(snapshot).mockImplementationOnce(() => { entered.resolve(); return delayed.promise; });
  const stop = vi.fn(async (_diagnostic: Diagnostic) => {}); const guard = new NoProgressGuard(root, stop);
  const old = new AbortController(); const next = new AbortController(); const execute = vi.fn(async () => ({}));
  const run = guard.run('Old', old.signal, execute).catch(error => error);
  await entered.promise;
  const queuedEntered = deferred<void>();
  const queued = !baseline ? guard.run('QueuedOld', old.signal, async () => { queuedEntered.resolve(); return {}; }).catch(error => error) : Promise.resolve();
  if (!baseline) await queuedEntered.promise;
  await Promise.resolve(); old.abort();
  for (let i = 0; i < 2; i++) await guard.run('New', next.signal, async () => ({}));
  if (phase.includes('failure')) delayed.reject(new Error('old fingerprint failure')); else delayed.resolve(snapshot);
  await Promise.all([run, queued]);
  if (baseline) expect(execute).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
  await guard.run('New', next.signal, async () => ({}));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(stop.mock.calls[0]![0]).toMatchObject({ toolName: 'New', stepIndex: 3 });
});

it('exposes a generation fence across a delayed durable stop callback', async () => {
  const entered = deferred<void>(); const durable = deferred<void>(); const interrupt = vi.fn();
  const guard = new NoProgressGuard(root, async (_diagnostic, isCurrent) => {
    entered.resolve(); await durable.promise;
    if (isCurrent()) interrupt();
  });
  const old = new AbortController(); const next = new AbortController();
  for (let i = 0; i < 2; i++) await guard.run('Old', old.signal, async () => ({}));
  const stopping = guard.run('Old', old.signal, async () => ({}));
  await entered.promise;
  await guard.run('New', next.signal, async () => ({}));
  durable.resolve(); await stopping;
  expect(interrupt).not.toHaveBeenCalled();
});

it.each(['success', 'error'])('policy denials do not consume executed %s observations', async outcome => {
  const stop = vi.fn(async (_diagnostic: Diagnostic) => {}); const guard = new NoProgressGuard(root, stop);
  const signal = new AbortController().signal;
  for (let i = 0; i < 3; i++) await guard.run('Denied', signal, async () => ({ error: { errorClass: 'DENIED' as const, message: 'policy' } }));
  expect(stop).not.toHaveBeenCalled();
  const execute = async () => {
    if (outcome === 'success') return {};
    fs.writeFileSync(path.join(root, 'error-write'), String(Math.random()));
    return { error: { errorClass: 'TOOL_FAILURE' as const, message: 'failed', detail: { code: 'ENOENT' } } };
  };
  for (let i = 0; i < 2; i++) await guard.run('Executed', signal, execute);
  expect(stop).not.toHaveBeenCalled();
  await guard.run('Executed', signal, execute);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(stop.mock.calls[0]![0]).toMatchObject({ toolName: 'Executed', stepIndex: 3,
    reason: outcome === 'success' ? 'workspace_stagnation' : 'repeated_tool_error' });
});
