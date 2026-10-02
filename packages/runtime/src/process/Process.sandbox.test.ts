import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { runCommand } from './Process.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
afterEach(() => { Object.defineProperty(process, 'platform', platform); vi.restoreAllMocks(); vi.useRealTimers(); });

function child() {
  const proc = Object.assign(new EventEmitter(), { pid: 12345, stdout: Object.assign(new EventEmitter(), { destroy: vi.fn() }), stderr: Object.assign(new EventEmitter(), { destroy: vi.fn() }), stdin: Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() }), kill: vi.fn() });
  vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);
  return proc;
}

describe('native helper process transport', () => {
  it('feeds a large script through stdin without growing argv', async () => {
    const proc = child();
    const script = 'mock helper'.repeat(10000);
    const pending = runCommand('/trusted/helper', ['fixed-argument'], { cwd: process.cwd(), stdin: script });
    expect(proc.stdin.end).toHaveBeenCalledWith(script, 'utf8');
    expect(vi.mocked(spawn).mock.calls.at(-1)?.[1]).toEqual(['fixed-argument']);
    proc.emit('close', 0);
    expect((await pending).exitCode).toBe(0);
  });

  it.each(['timeout', 'abort'])('kills the entire POSIX group on %s', async mode => {
    vi.useFakeTimers(); Object.defineProperty(process, 'platform', { value: 'darwin' });
    const proc = child(); const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    const controller = new AbortController();
    const pending = runCommand('/usr/bin/sandbox-exec', ['mock'], { cwd: process.cwd(), processGroup: true, signal: controller.signal, timeoutMs: 100 });
    expect(vi.mocked(spawn).mock.calls.at(-1)?.[2]).toMatchObject({ detached: true });
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(100); else controller.abort();
    expect(kill).toHaveBeenCalledWith(-12345, 'SIGKILL'); expect(proc.kill).not.toHaveBeenCalled();
    expect(proc.stdout.destroy).toHaveBeenCalledOnce(); expect(proc.stderr.destroy).toHaveBeenCalledOnce();
    proc.emit('close', null);
    expect(await pending).toMatchObject({ killed: true, timedOut: mode === 'timeout' });
  });

  it('ends background children in the owned group when the root exits normally', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const proc = child(); const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    const pending = runCommand('/usr/bin/sandbox-exec', ['mock'], { cwd: process.cwd(), processGroup: true });
    proc.stdout.emit('data', Buffer.from('finished'));
    proc.emit('exit', 0);
    expect(kill).toHaveBeenCalledWith(-12345, 'SIGKILL');
    expect(proc.stdout.destroy).not.toHaveBeenCalled();
    proc.emit('close', 0);
    expect(await pending).toMatchObject({ stdout: 'finished', killed: false, exitCode: 0 });
  });
});
