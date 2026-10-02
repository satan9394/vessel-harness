import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DaemonLifecycle, gracefulDaemonStop, readDaemonLock, releaseDaemonLock, writeDaemonFile, type DaemonLaunch } from './daemonLifecycle.js';
import type { DaemonInfo } from './types.js';

let root: string;
let running: boolean;
let info: DaemonInfo;
const protect = vi.fn();
const recycle = vi.fn(async (target: string) => { fs.rmSync(target, { recursive: true, force: true }); });
const alive = (pid: number) => pid === process.pid || (pid === 900001 && running);
const launch = vi.fn(async (input: DaemonLaunch) => {
  running = true;
  info = { pid: 900001, port: input.port, startedAt: new Date().toISOString(), uptimeSeconds: 17, memoryBytes: 1024, tokenPath: path.join(root, 'daemon.token'), version: '0.10.0', instanceId: input.instanceId };
  writeDaemonFile(path.join(root, 'daemon.lock', 'owner.json'), JSON.stringify({ pid: info.pid, instanceId: info.instanceId }), protect);
  writeDaemonFile(path.join(root, 'daemon.json'), JSON.stringify(info), protect); return info.pid;
});
const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
  if (init?.method === 'POST') { running = false; return new Response('{}', { status: 202 }); }
  return new Response(JSON.stringify(info));
});
const make = () => new DaemonLifecycle({ root, launch, alive, fetch: fetchMock as typeof fetch, protect, recycle, timeoutMs: 1000, pollMs: 1, portAvailable: async () => true });
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-daemon-life-')); running = false; vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); fs.rmSync(root, { recursive: true, force: true }); });

describe('daemon lifecycle with mocked child and native operations', () => {
  it('generates 24 random bytes, protects files, waits for authenticated ready identity and starts idempotently', async () => {
    const control = make(); const ready = await control.start(5678);
    const token = fs.readFileSync(path.join(root, 'daemon.token'), 'utf8'); expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(protect).toHaveBeenCalledWith(path.join(root, 'daemon.token'), false);
    expect(ready).toEqual(info); expect(await control.start()).toEqual(info); expect(launch).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]?.headers).toEqual({ Authorization: `Bearer ${token}` });
  });
  it('does not mistake an unrelated/reused PID for its daemon', async () => {
    const control = make(); await control.start();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...info, instanceId: 'wrong-process' })));
    await expect(control.status()).rejects.toThrow('identity mismatch');
    expect(await control.stop()).toBe(true);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('/api/daemon/stop');
  });
  it('reports a dead PID as stopped without querying another service', async () => {
    const control = make(); await control.start(); running = false; fetchMock.mockClear();
    expect(await control.status()).toBeNull(); expect(await control.stop()).toBe(false); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('serializes concurrent startup and never releases the winning owner', async () => {
    let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const control = new DaemonLifecycle({ root, launch: async input => { await gate; return launch(input); }, alive, fetch: fetchMock as typeof fetch, protect, recycle, portAvailable: async () => true });
    const first = control.start(); await vi.waitFor(() => expect(fs.existsSync(path.join(root, 'daemon.lock', 'owner.json'))).toBe(true));
    await expect(make().start()).rejects.toThrow('in progress'); resume(); await first;
    expect(readDaemonLock(root).pid).toBe(info.pid); expect(recycle).not.toHaveBeenCalled();
  });
  it('recovers dead-owner state through the recycle seam and rotates launch tokens', async () => {
    const control = make(); await control.start(); const previous = fs.readFileSync(path.join(root, 'daemon.token'), 'utf8'); running = false;
    await control.start(); expect(recycle).toHaveBeenCalledTimes(1); expect(fs.readFileSync(path.join(root, 'daemon.token'), 'utf8')).not.toBe(previous);
  });
  it('cannot release a replacement owner while an old lock is still being recycled', async () => {
    const control = make(); const old = await control.start(); running = false;
    let finish!: () => void; const recycling = new Promise<void>(resolve => { finish = resolve; });
    const retired = releaseDaemonLock(root, old.instanceId, async target => { await recycling; await recycle(target); });
    await control.start(); const token = fs.readFileSync(path.join(root, 'daemon.token'), 'utf8');
    await expect(releaseDaemonLock(root, old.instanceId, recycle)).rejects.toThrow('owner changed');
    expect(readDaemonLock(root).instanceId).toBe(info.instanceId); expect(fs.readFileSync(path.join(root, 'daemon.token'), 'utf8')).toBe(token);
    finish(); await retired;
  });
  it('fails closed on a lock whose ownership claim is being retired', async () => {
    const control = make(); await control.start();
    fs.renameSync(path.join(root, 'daemon.lock', info.instanceId + '.claim'), path.join(root, 'retiring-claim'));
    await expect(control.start()).rejects.toThrow('retired'); expect(launch).toHaveBeenCalledTimes(1);
  });
  it('cleans an owned unpublished lock on ACL failure and preserves the original error', async () => {
    const control = new DaemonLifecycle({ root, launch, protect: () => { throw new Error('ACL failed'); }, recycle });
    await expect(control.start()).rejects.toThrow('ACL failed'); expect(fs.existsSync(path.join(root, 'daemon.lock'))).toBe(false); expect(launch).not.toHaveBeenCalled();
  });
  it('probes occupied port and publishes the selected free fallback', async () => {
    const available = vi.fn(async (port: number) => port === 30002);
    const control = new DaemonLifecycle({ root, launch, alive, fetch: fetchMock as typeof fetch, protect, recycle, portAvailable: available });
    expect((await control.start()).port).toBe(30002); expect(available.mock.calls.map(call => call[0])).toEqual([5678, 30001, 30002]);
  });
  it('retains child-owned lock when authenticated readiness never arrives', async () => {
    const control = new DaemonLifecycle({ root, launch: async () => { running = true; return 900001; }, alive, protect, recycle, timeoutMs: 5, pollMs: 1, portAvailable: async () => true });
    await expect(control.start()).rejects.toThrow('readiness timed out'); expect(fs.existsSync(path.join(root, 'daemon.lock'))).toBe(true);
  });
  it('releases its lock if the child dies before adopting, retaining only an inert protected token', async () => {
    const control = new DaemonLifecycle({ root, launch: async () => 900001, alive, protect, recycle, timeoutMs: 5, portAvailable: async () => true });
    await expect(control.start()).rejects.toThrow('exited before');
    expect(fs.existsSync(path.join(root, 'daemon.lock'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'daemon.token'), 'utf8')).toMatch(/^[0-9a-f]{48}$/);
  });
  it('reports shutdown timeout without signaling an unrelated PID', async () => {
    const control = make(); await control.start(); fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(info))).mockImplementationOnce(async () => new Response('{}', { status: 202 }));
    await expect(control.stop()).rejects.toThrow('shutdown timed out');
  });
  it('gracefully closes once and force-exits itself on a hung close', async () => {
    vi.useFakeTimers(); const exit = vi.fn(); const close = vi.fn(async () => {}); const stop = gracefulDaemonStop(close, exit, 20);
    stop(); stop(); await Promise.resolve(); expect(close).toHaveBeenCalledTimes(1); expect(exit).toHaveBeenCalledWith(0);
    const forced = vi.fn(); gracefulDaemonStop(() => new Promise(() => {}), forced, 20)();
    await vi.advanceTimersByTimeAsync(20); expect(forced).toHaveBeenCalledWith(1);
  });
});
