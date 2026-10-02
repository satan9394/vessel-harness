import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoundedStdioTransport } from './BoundedStdioTransport.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), createJobObject: vi.fn(), enumerateDescendants: vi.fn(), killTree: vi.fn(), terminatePids: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('@vessel/runtime', () => ({ createJobObject: mocks.createJobObject, defaultKillWindowsTree: mocks.killTree, WindowsJobObject: { enumerateDescendants: mocks.enumerateDescendants, terminatePids: mocks.terminatePids } }));

describe('bounded stdio lifecycle (fake process tree)', () => {
  let child: EventEmitter & { pid: number; stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
  let job: { jobName: string; dispose: ReturnType<typeof vi.fn>; attachDescendants: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    child = Object.assign(new EventEmitter(), { pid: 123, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    job = { jobName: 'fake', dispose: vi.fn().mockResolvedValue(undefined), attachDescendants: vi.fn().mockResolvedValue(2) };
    mocks.spawn.mockReturnValue(child);
    mocks.createJobObject.mockResolvedValue(job);
    mocks.enumerateDescendants.mockResolvedValue([124, 125]);
    mocks.killTree.mockResolvedValue(undefined);
    mocks.terminatePids.mockResolvedValue([]);
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

  it('waits for attach before writing RPC and disposes the whole job once', async () => {
    const alive = new Set([123, 124, 125]);
    job.dispose.mockImplementation(async () => { alive.clear(); });
    const transport = new BoundedStdioTransport('fake');
    const writes = vi.spyOn(child.stdin, 'write');
    const request = transport.request('tools/call');
    expect(writes).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.createJobObject).toHaveBeenCalledWith(123);
    expect(job.attachDescendants).toHaveBeenCalledWith([124, 125]);
    child.stdout.write('{"id":1,"result":"ok"}\n');
    expect(await request).toBe('ok');
    const close = transport.close();
    await vi.advanceTimersByTimeAsync(50);
    await close;
    expect(alive.size).toBe(0);
    await transport.close();
    expect(job.dispose).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1950);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it.each(['exit', 'error'])('releases job and pending timers on %s', async (event) => {
    const transport = new BoundedStdioTransport('fake');
    const result = transport.request('tools/call').catch((err: Error) => err.message);
    await vi.advanceTimersByTimeAsync(0);
    child.emit(event, new Error('failed'));
    if (event === 'error') child.emit('exit');
    expect(await result).toMatch(/failed|exited/);
    await transport.close();
    expect(job.dispose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('close during attach disposes a late handle and never writes a request', async () => {
    let attach!: (value: typeof job) => void;
    mocks.createJobObject.mockReturnValue(new Promise((resolve) => { attach = resolve; }));
    const transport = new BoundedStdioTransport('fake');
    const writes = vi.spyOn(child.stdin, 'write');
    const request = transport.request('tools/call').catch((err: Error) => err.message);
    const close = transport.close();
    attach(job);
    await vi.advanceTimersByTimeAsync(50);
    await close;
    expect(await request).toContain('closed');
    expect(writes).not.toHaveBeenCalled();
    expect(job.dispose).toHaveBeenCalledTimes(1);
    child.emit('exit');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('attach failure fails closed and kills the root fallback', async () => {
    mocks.createJobObject.mockRejectedValue(new Error('attach failed'));
    const transport = new BoundedStdioTransport('fake');
    await expect(transport.request('initialize')).rejects.toThrow('attach failed');
    await vi.advanceTimersByTimeAsync(2000);
    await transport.close();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(mocks.killTree).toHaveBeenCalledWith(123);
  });

  it('disposal failure invokes tree fallback and explicit close reports the failure', async () => {
    const alive = new Set([123, 124, 125]);
    job.dispose.mockRejectedValue(new Error('dispose failed'));
    mocks.killTree.mockImplementation(async () => { alive.clear(); });
    const transport = new BoundedStdioTransport('fake');
    await vi.advanceTimersByTimeAsync(0);
    const result = transport.close().catch((err: Error) => err.message);
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBe('dispose failed');
    expect(alive.size).toBe(0);
    child.emit('exit');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('partial descendant attachment fails closed and removes escaped descendants', async () => {
    const alive = new Map([[123, 0], [124, 123], [125, 124]]);
    const descendants = (root: number): number[] => {
      const found: number[] = [];
      for (const [pid, parent] of alive) {
        if (parent === root) { found.push(pid, ...descendants(pid)); }
      }
      return found;
    };
    mocks.enumerateDescendants.mockImplementation(async (root: number) => descendants(root));
    vi.mocked(process.kill).mockImplementation((pid) => {
      if (!alive.has(pid)) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      return true;
    });
    job.attachDescendants.mockResolvedValue(1);
    job.dispose.mockImplementation(async () => { alive.delete(123); alive.delete(124); });
    mocks.killTree.mockImplementation(async (root: number) => {
      for (const pid of descendants(root)) alive.delete(pid);
      alive.delete(root);
    });
    mocks.terminatePids.mockImplementation(async (pids: number[]) => {
      const killed = pids.filter((pid) => alive.delete(pid));
      return killed;
    });
    const transport = new BoundedStdioTransport('fake');
    await expect(transport.request('initialize')).rejects.toThrow('failed to attach descendants');
    const close = transport.close();
    await vi.advanceTimersByTimeAsync(50);
    await close;
    expect(alive.size).toBe(0);
    expect(mocks.terminatePids).toHaveBeenCalledWith([125]);
    child.emit('exit');
  });

  it('reports cleanup failure when a retained escaped PID remains alive despite termination results', async () => {
    job.attachDescendants.mockResolvedValue(1);
    let disposed = false;
    job.dispose.mockImplementation(async () => { disposed = true; });
    vi.mocked(process.kill).mockImplementation((pid) => {
      if (pid === 125 || !disposed) return true;
      throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    });
    mocks.killTree.mockResolvedValue(undefined);
    // A returned PID list must not substitute for a live-process check.
    mocks.terminatePids.mockResolvedValue([125]);
    const transport = new BoundedStdioTransport('fake');
    await expect(transport.request('initialize')).rejects.toThrow('failed to attach descendants');
    const result = transport.close().catch((err: Error) => err.message);
    await vi.advanceTimersByTimeAsync(2050);
    expect(await result).toContain('escaped descendant cleanup failed');
    child.emit('exit');
  });
});
