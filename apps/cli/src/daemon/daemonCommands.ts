import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NativeMeshEventBus, type MeshNodeDescriptor } from '@vessel/agents';
import { WorkspaceFingerprinter } from '@vessel/tools';
import { createVesselServer, VERSION, DaemonLifecycle, createNativeNotifier, startResidentTray, daemonRoot, readDaemonLock, writeDaemonFile, releaseDaemonLock, gracefulDaemonStop, protectDaemonPath, recycleDaemonPath, type DaemonControlContract, type DaemonInfo, type DaemonLaunch } from '@vessel/local-server';

export function launchDetached(input: DaemonLaunch, entry: string, launch = spawn): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = launch(process.execPath, [...process.execArgv, entry, 'daemon', '--child', '--root', input.root, '--instance', input.instanceId, '--parent', String(input.parentPid), '--port', String(input.port), '--deadline', String(input.deadline)], {
      detached: true, stdio: 'ignore', windowsHide: true, cwd: process.cwd(),
    });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(child.pid!); });
  });
}

export const daemonRuntime = {
  mesh: (local: MeshNodeDescriptor) => new NativeMeshEventBus(local),
  control(entry: string): DaemonControlContract { return new DaemonLifecycle({ launch: input => launchDetached(input, entry) }); },
  exit(code: number): void { process.exit(code); },
  tray: startResidentTray,
  server: createVesselServer,
  protect: protectDaemonPath,
  recycle: recycleDaemonPath,
};

/** Same layout from CLI src/daemon and dist/daemon; independent of launch cwd. */
export function daemonStaticDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'web', 'dist');
}

export async function daemonCommands(args: string[], flags: Map<string, string>, entry: string): Promise<number> {
  if (flags.has('child')) return runDaemonChild(flags);
  const json = flags.has('json');
  const command = args[1] ?? 'status';
  if (!['start', 'stop', 'status'].includes(command)) {
    console.error('Usage: vessel daemon start [--port <n>] | stop | status [--json]'); return 2;
  }
  try {
    const control = daemonRuntime.control(entry);
    if (command === 'stop') {
      const stopped = await control.stop();
      console.log(json ? JSON.stringify({ stopped }) : stopped ? 'Vessel daemon stopped.' : 'Vessel daemon is not running.');
    } else {
      const info = command === 'start' ? await control.start(Number(flags.get('port') ?? 5678)) : await control.status();
      console.log(json ? JSON.stringify({ running: !!info, daemon: info }) : info
        ? `Vessel daemon PID ${info.pid} · port ${info.port} · uptime ${info.uptimeSeconds}s · memory ${info.memoryBytes} bytes\nBrowser: http://127.0.0.1:${info.port}/api/health\nLaunch token file: ${info.tokenPath}`
        : 'Vessel daemon is not running.');
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ error: message })); else console.error(`[vessel daemon] ${message}`);
    return 1;
  }
}

async function runDaemonChild(flags: Map<string, string>): Promise<number> {
  const root = path.resolve(flags.get('root') ?? daemonRoot());
  const instanceId = flags.get('instance');
  const owner = readDaemonLock(root);
  const deadline = Number(flags.get('deadline'));
  if (!instanceId || owner.instanceId !== instanceId || owner.pid !== Number(flags.get('parent')) || !Number.isFinite(deadline) || Date.now() >= deadline) throw new Error('invalid or expired daemon launch');
  writeDaemonFile(path.join(root, 'daemon.lock', 'owner.json'), JSON.stringify({ pid: process.pid, instanceId }), daemonRuntime.protect);
  const tokenPath = path.join(root, 'daemon.token');
  if (fs.lstatSync(tokenPath).isSymbolicLink()) throw new Error('daemon token cannot be a symlink');
  const token = fs.readFileSync(tokenPath, 'utf8');
  if (!/^[0-9a-f]{48}$/.test(token)) throw new Error('invalid daemon token');
  const startedAt = new Date().toISOString();
  let resolveExit: (code: number) => void = () => {};
  const parked = new Promise<number>(resolve => { resolveExit = resolve; });
  let info: DaemonInfo;
  let startupExpired = false;
  const mesh = daemonRuntime.mesh({ nodeId: instanceId, endpoint: `http://127.0.0.1:${Number(flags.get('port'))}`, token, roleCapabilities: [], status: 'online', latencyMs: 0 });
  const peersFile = path.join(root, 'mesh-peers.json');
  if (fs.existsSync(peersFile)) {
    const peers: unknown = JSON.parse(fs.readFileSync(peersFile, 'utf8'));
    if (!Array.isArray(peers)) throw new Error('mesh-peers.json must contain an array of locally provisioned descriptors');
    for (const peer of peers) mesh.trustPeer(peer as MeshNodeDescriptor);
  }
  const server = daemonRuntime.server({
    observeWorkspace: root => WorkspaceFingerprinter.compute(root),
    port: Number(flags.get('port')), authToken: token, mesh, notify: createNativeNotifier(), staticDir: daemonStaticDir(),
    daemon: { status: () => ({ ...info, uptimeSeconds: Math.floor(process.uptime()), memoryBytes: process.memoryUsage().rss }), stop: () => stop() },
  });
  const stop = gracefulDaemonStop(async () => {
    await server.close();
    // Keep the state record for diagnosis; revoke the old token before releasing ownership.
    writeDaemonFile(tokenPath, '', daemonRuntime.protect);
    await releaseDaemonLock(root, instanceId, daemonRuntime.recycle);
  }, code => { const actual = startupExpired ? 1 : code; resolveExit(actual); daemonRuntime.exit(actual); });
  const forceExit = setTimeout(() => { if (!info) { startupExpired = true; stop(); } }, Math.max(1, deadline - Date.now()));
  try {
    await server.listen();
    clearTimeout(forceExit);
    if (Date.now() >= deadline) { startupExpired = true; stop(); return await parked; }
    info = { pid: process.pid, port: server.port, startedAt, uptimeSeconds: 0, memoryBytes: process.memoryUsage().rss, tokenPath, version: VERSION, instanceId };
    writeDaemonFile(path.join(root, 'daemon.json'), JSON.stringify(info), daemonRuntime.protect);
    daemonRuntime.tray(info);
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    return await parked;
  } catch (error) { stop(); await parked; throw error; }
  finally { clearTimeout(forceExit); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
}
