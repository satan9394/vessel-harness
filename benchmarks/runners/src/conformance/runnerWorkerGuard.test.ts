import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { spawnWithVirtualProxy } from '@vessel/runtime';
import config, { runnerWorkerGuard } from '../../../../vitest.config.js';

describe('runner worker guard', () => {
  it('uses the production Windows CI guard and retries CI assertions once', () => {
    expect(runnerWorkerGuard('win32', 'true')).toEqual({ maxWorkers: 1, retry: 1 });
    expect(runnerWorkerGuard('linux', 'true')).toEqual({ retry: 1 });
    expect(runnerWorkerGuard('win32', undefined)).toEqual({ retry: 0 });
    expect(config.test?.maxWorkers).toBe(1);
    expect(config.test?.retry).toBe(process.env.CI ? 1 : 0);
  });

  it.each(['attached', 'late-attachment', 'attachment-failure'] as const)(
    'reaps simulated descendants under frequent cancellation: %s', async (mode) => {
      const alive = new Set<number>();
      const disposed = vi.fn();
      const fallback = vi.fn();
      const runs = Array.from({ length: 64 }, (_, index) => {
        const pid = 1_000_000 + index * 3;
        const tree = [pid, pid + 1, pid + 2];
        tree.forEach((id) => alive.add(id));
        const child = new EventEmitter() as ChildProcess;
        Object.assign(child, { pid, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          queueMicrotask(() => child.emit('close', null));
        };
        const reap = () => { tree.forEach((id) => alive.delete(id)); close(); };
        const controller = new AbortController();
        const result = spawnWithVirtualProxy({ command: 'memory-worker', args: [], cwd: process.cwd(), signal: controller.signal }, {
          platform: 'win32',
          spawnProcess: (() => child) as typeof spawn,
          enumerateDescendants: async () => tree.slice(1).filter((id) => alive.has(id)),
          killWindowsTree: async () => { fallback(); reap(); },
          createJob: async () => {
            if (mode === 'late-attachment') await new Promise<void>((resolve) => setImmediate(resolve));
            return {
              jobName: `mock-job-${pid}`, rootPid: pid, attached: mode !== 'attachment-failure',
              async attachDescendants(pids) { return pids.length; },
              async terminate() { reap(); },
              async dispose() { disposed(); tree.forEach((id) => alive.delete(id)); },
            };
          },
        });
        const checked = mode === 'attachment-failure'
          ? expect(result).rejects.toThrow('did not attach')
          : result.then((value) => expect(value.exitCode).toBeNull());
        if (mode === 'attached') setImmediate(() => controller.abort());
        else if (mode === 'late-attachment') controller.abort();
        return checked;
      });
      await Promise.all(runs);
      expect(alive.size).toBe(0);
      if (mode === 'attached') expect(disposed).toHaveBeenCalledTimes(64);
      else expect(fallback).toHaveBeenCalledTimes(64);
    },
  );
});
