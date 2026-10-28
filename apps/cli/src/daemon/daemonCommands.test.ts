import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { daemonCommands, daemonRuntime, launchDetached, daemonStaticDir } from './daemonCommands.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { main } from '../cli.js';
import { createVesselServer, type DaemonInfo } from '@vessel/local-server';
const info: DaemonInfo = { pid: 12345, port: 30001, startedAt: '2026-10-01T00:00:00Z', uptimeSeconds: 42, memoryBytes: 123456, tokenPath: '/fake/daemon.token', version: '0.10.0', instanceId: 'mock' };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('daemon commands (no child process or real store)', () => {
  it('serves the Web build instead of the legacy placeholder independently of cwd', () => {
    expect(daemonStaticDir()).toBe(path.resolve(import.meta.dirname, '..', '..', '..', 'web', 'dist'));
  });
  it('dispatches start/status/stop through CLI and emits accurate JSON without token bytes', async () => {
    const control = { start: vi.fn(async () => info), status: vi.fn(async () => info), stop: vi.fn(async () => true) };
    vi.spyOn(daemonRuntime, 'control').mockReturnValue(control); const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await main(['daemon', 'start', '--port', '30001', '--json'])).toBe(0); expect(control.start).toHaveBeenCalledWith(30001);
    expect(JSON.parse(log.mock.calls[0]![0])).toEqual({ running: true, daemon: info });
    expect(await main(['daemon', 'status', '--json'])).toBe(0); expect(await main(['daemon', 'stop', '--json'])).toBe(0);
    expect(JSON.parse(log.mock.calls.at(-1)![0])).toEqual({ stopped: true });
  });
  it('reports stopped state and actionable errors', async () => {
    vi.spyOn(daemonRuntime, 'control').mockReturnValue({ start: vi.fn(async () => { throw new Error('invalid port'); }), status: vi.fn(async () => null), stop: vi.fn(async () => false) });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await daemonCommands(['daemon', 'status'], new Map([['json', 'true']]), '/fake/cli.js')).toBe(0);
    expect(JSON.parse(log.mock.calls[0]![0])).toEqual({ running: false, daemon: null });
    expect(await main(['daemon', 'start', '--port', 'bad', '--json'])).toBe(1);
    expect(await main(['daemon', 'invalid'])).toBe(2);
  });
  it('launches detached hidden child with ignored stdio and no secret command argument', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 12345, unref: vi.fn() });
    const launch = vi.fn((_command: string, _args: string[], _options: object) => child); const ready = launchDetached({ root: '/fake', instanceId: 'id', parentPid: 4, port: 30001, deadline: 10 }, '/fake/cli.js', launch as never);
    child.emit('spawn'); expect(await ready).toBe(12345); expect(child.unref).toHaveBeenCalled();
    expect(launch.mock.calls[0]![2]).toMatchObject({ detached: true, stdio: 'ignore', windowsHide: true });
    expect(launch.mock.calls[0]![1]).not.toContain('--token');
  });
  it('constructs the real server with matching daemon and mesh identity before listen', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-child-real-'));
    const instanceId = '00000000-0000-4000-8000-000000000003';
    for (const name of ['VESSEL_SESSION_ROOT', 'VESSEL_PROVIDER_ROOT', 'VESSEL_USAGE_ROOT', 'VESSEL_REVIEWS_ROOT', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
      const isolated = path.join(root, name);
      fs.mkdirSync(isolated);
      vi.stubEnv(name, isolated);
    }
    fs.mkdirSync(path.join(root, 'daemon.lock'));
    fs.writeFileSync(path.join(root, 'daemon.lock', 'owner.json'), JSON.stringify({ pid: process.pid, instanceId }));
    fs.writeFileSync(path.join(root, 'daemon.lock', instanceId + '.claim'), instanceId);
    fs.writeFileSync(path.join(root, 'daemon.token'), 'ab'.repeat(24));
    let options: Parameters<typeof createVesselServer>[0];
    let beforeListen: DaemonInfo | undefined;
    let realServer: ReturnType<typeof createVesselServer> | undefined;
    vi.spyOn(daemonRuntime, 'server').mockImplementation(input => {
      options = input;
      beforeListen = input!.daemon!.status();
      // Exercise the actual constructor and its identity guard, without a fake server.
      return realServer = createVesselServer(input);
    });
    vi.spyOn(daemonRuntime, 'protect').mockImplementation(() => {});
    vi.spyOn(daemonRuntime, 'recycle').mockImplementation(async target => { fs.rmSync(target, { recursive: true, force: true }); });
    const tray = vi.spyOn(daemonRuntime, 'tray').mockImplementation(() => {});
    vi.spyOn(daemonRuntime, 'exit').mockImplementation(() => {});
    const run = daemonCommands(['daemon'], new Map([['child', 'true'], ['root', root], ['instance', instanceId], ['parent', String(process.pid)], ['port', '0'], ['deadline', String(Date.now() + 10000)]]), '/fake/cli.js');
    try {
      await Promise.race([run, vi.waitFor(() => expect(tray).toHaveBeenCalledOnce())]);
      expect(beforeListen?.instanceId).toBe(instanceId);
      expect(beforeListen?.instanceId).toBe(options!.mesh!.local.nodeId);
      const saved = JSON.parse(fs.readFileSync(path.join(root, 'daemon.json'), 'utf8')) as DaemonInfo;
      expect(saved.port).toBeGreaterThan(0);
      expect(saved.instanceId).toBe(instanceId);
      options!.daemon!.stop();
      expect(await run).toBe(0);
    } finally {
      if (realServer) options?.daemon?.stop();
      await run.catch(() => {});
      vi.unstubAllEnvs();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it.each(['omitted', 'empty', 'provided', 'cli'] as const)('publishes ready state and forwards only supplied usage hooks (%s)', async mode => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-child-mock-'));
    fs.mkdirSync(path.join(root, 'daemon.lock')); fs.writeFileSync(path.join(root, 'daemon.lock', 'owner.json'), JSON.stringify({ pid: process.pid, instanceId: '00000000-0000-4000-8000-000000000001' }));
    fs.writeFileSync(path.join(root, 'daemon.lock', '00000000-0000-4000-8000-000000000001.claim'), '00000000-0000-4000-8000-000000000001');
    fs.writeFileSync(path.join(root, 'daemon.token'), 'ab'.repeat(24));
    let options!: Parameters<typeof daemonRuntime.server>[0]; const close = vi.fn(async () => {});
    const server = { port: 30001, listen: vi.fn(async () => server), close };
    vi.spyOn(daemonRuntime, 'server').mockImplementation(input => { options = input; return server; });
    vi.spyOn(daemonRuntime, 'protect').mockImplementation(() => {});
    vi.spyOn(daemonRuntime, 'recycle').mockImplementation(async target => { fs.rmSync(target, { recursive: true, force: true }); });
    const tray = vi.spyOn(daemonRuntime, 'tray').mockImplementation(() => {}); const exit = vi.spyOn(daemonRuntime, 'exit').mockImplementation(() => {});
    const usageByProvider = vi.fn(() => []);
    try {
      const flags = new Map([['child', 'true'], ['root', root], ['instance', '00000000-0000-4000-8000-000000000001'], ['parent', String(process.pid)], ['port', '30001'], ['deadline', String(Date.now() + 3000)]]);
      const run = mode === 'cli'
        ? main(['daemon', ...Array.from(flags).flatMap(([key, value]) => [`--${key}`, value])])
        : mode === 'omitted'
          ? daemonCommands(['daemon'], flags, '/fake/cli.js')
          : daemonCommands(['daemon'], flags, '/fake/cli.js', mode === 'provided' ? { usageByProvider } : {});
      await vi.waitFor(() => expect(tray).toHaveBeenCalledTimes(1));
      const saved = JSON.parse(fs.readFileSync(path.join(root, 'daemon.json'), 'utf8'));
      expect(saved.pid).toBe(process.pid); expect(saved.port).toBe(30001); expect(saved.instanceId).toBe('00000000-0000-4000-8000-000000000001');
      expect(options!.staticDir).toBe(daemonStaticDir()); expect(options!.authToken).toHaveLength(48);
      expect(options!.mesh!.local.nodeId).toBe(saved.instanceId);
      expect(options!.mesh!.local.token).toBe(options!.authToken);
      if (mode === 'provided') expect(options!.usageByProvider).toBe(usageByProvider);
      else if (mode === 'cli') expect(options!.usageByProvider).toBeTypeOf('function');
      else expect(Object.hasOwn(options!, 'usageByProvider')).toBe(false);
      expect(usageByProvider).not.toHaveBeenCalled();
      options!.daemon!.stop(); expect(await run).toBe(0); expect(close).toHaveBeenCalledOnce(); expect(exit).toHaveBeenCalledWith(0);
      expect(fs.readFileSync(path.join(root, 'daemon.token'), 'utf8')).toBe(''); expect(fs.existsSync(path.join(root, 'daemon.lock'))).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('self-terminates a stalled child listen/close after its startup deadline and force timeout', async () => {
    vi.useFakeTimers(); const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-stalled-child-'));
    fs.mkdirSync(path.join(root, 'daemon.lock')); fs.writeFileSync(path.join(root, 'daemon.lock', 'owner.json'), JSON.stringify({ pid: process.pid, instanceId: '00000000-0000-4000-8000-000000000002' }));
    fs.writeFileSync(path.join(root, 'daemon.lock', '00000000-0000-4000-8000-000000000002.claim'), '00000000-0000-4000-8000-000000000002'); fs.writeFileSync(path.join(root, 'daemon.token'), 'ab'.repeat(24));
    let rejectListen!: (error: Error) => void;
    vi.spyOn(daemonRuntime, 'server').mockReturnValue({ port: 30001, listen: () => new Promise((_resolve, reject) => { rejectListen = reject; }), close: () => new Promise(() => {}) });
    vi.spyOn(daemonRuntime, 'protect').mockImplementation(() => {});
    const tray = vi.spyOn(daemonRuntime, 'tray').mockImplementation(() => {}); const exit = vi.spyOn(daemonRuntime, 'exit').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const run = daemonCommands(['daemon'], new Map([['child', 'true'], ['root', root], ['instance', '00000000-0000-4000-8000-000000000002'], ['parent', String(process.pid)], ['port', '30001'], ['deadline', String(Date.now() + 50)]]), '/fake/cli.js');
      await vi.advanceTimersByTimeAsync(10051); expect(exit).toHaveBeenCalledWith(1); expect(tray).not.toHaveBeenCalled();
      // The mocked self-exit returns; release the fake listen so the test can settle.
      rejectListen(new Error('stalled listen')); await expect(run).rejects.toThrow('stalled listen');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
