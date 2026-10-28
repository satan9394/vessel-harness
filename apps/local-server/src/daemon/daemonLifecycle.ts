import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import type { DaemonControlContract, DaemonInfo } from './types.js';
import { recyclePath } from '@vessel/shared';
import { trashStore } from '@vessel/application';

export interface DaemonLaunch {
  root: string;
  instanceId: string;
  parentPid: number;
  port: number;
  deadline: number;
}

export interface DaemonLifecycleOptions {
  root?: string;
  launch: (input: DaemonLaunch) => Promise<number>;
  alive?: (pid: number) => boolean;
  fetch?: typeof globalThis.fetch;
  protect?: (target: string, directory: boolean) => void;
  recycle?: (target: string) => Promise<void>;
  timeoutMs?: number;
  pollMs?: number;
  portAvailable?: (port: number) => Promise<boolean>;
}

export function daemonRoot(): string { return path.resolve(process.env.VESSEL_DAEMON_ROOT ?? path.join(os.homedir(), '.vessel')); }

export function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

export function daemonPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', error => (error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? resolve(false) : reject(error));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

function assertPlain(target: string): void {
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('daemon state cannot be a symlink');
}

/** Apply ACL before writing secret bytes. Inherited access is removed on Windows. */
export function protectDaemonPath(target: string, directory: boolean): void {
  assertPlain(target);
  if (process.platform === 'win32') {
    const sid = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], { encoding: 'utf8', windowsHide: true }).trim();
    if (!/^S-1-[0-9-]+$/.test(sid)) throw new Error('cannot resolve daemon owner SID');
    const script = `$p='${target.replace(/'/g, "''")}'; $acl=${directory ? 'New-Object System.Security.AccessControl.DirectorySecurity' : 'New-Object System.Security.AccessControl.FileSecurity'}; $sid=New-Object System.Security.Principal.SecurityIdentifier('${sid}'); $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl',${directory ? "'ContainerInherit, ObjectInherit','None'," : ''}'Allow')); Set-Acl -LiteralPath $p -AclObject $acl`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { stdio: 'ignore', windowsHide: true });
  } else fs.chmodSync(target, directory ? 0o700 : 0o600);
}

export function writeDaemonFile(target: string, content: string, protect = protectDaemonPath): void {
  assertPlain(target);
  const fd = fs.openSync(target, fs.existsSync(target) ? 'r+' : 'wx', 0o600);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error('daemon state must be a regular file');
    protect(target, false);
    fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

/** Runtime state follows the same recycle discipline as user files. */
export async function recycleDaemonPath(target: string): Promise<void> {
  assertPlain(target);
  const result = await recyclePath(target);
  if (!result.ok) throw new Error(`daemon state recycle failed: ${result.reason}: ${result.detail}`);
}

interface LockOwner { pid: number; instanceId: string }

export function readDaemonLock(root: string): LockOwner {
  const dir = path.join(root, 'daemon.lock'); assertPlain(dir);
  const file = path.join(dir, 'owner.json'); assertPlain(file);
  const owner = JSON.parse(fs.readFileSync(file, 'utf8')) as LockOwner;
  if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || typeof owner.instanceId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(owner.instanceId)) throw new Error('invalid daemon lock');
  const marker = path.join(dir, owner.instanceId + '.claim'); assertPlain(marker);
  if (!fs.existsSync(marker)) throw new Error('daemon lock is being initialized or retired');
  return owner;
}

export async function releaseDaemonLock(root: string, instanceId: string, recycle = recycleDaemonPath): Promise<void> {
  if (readDaemonLock(root).instanceId !== instanceId) throw new Error('daemon lock owner changed');
  // Claim an instance-specific marker atomically before touching the shared lock path.
  // Other stale releasers cannot retire a replacement instance after a new start.
  const retired = path.join(root, `daemon.lock.retired-${randomUUID()}`);
  fs.mkdirSync(retired, { mode: 0o700 });
  fs.renameSync(path.join(root, 'daemon.lock', instanceId + '.claim'), path.join(retired, 'claim'));
  fs.renameSync(path.join(root, 'daemon.lock'), path.join(retired, 'lock'));
  await recycle(retired);
}

export class DaemonLifecycle implements DaemonControlContract {
  readonly root: string;
  private readonly alive: (pid: number) => boolean;
  private readonly fetch: typeof globalThis.fetch;
  private readonly protect: (target: string, directory: boolean) => void;
  private readonly recycle: (target: string) => Promise<void>;
  private readonly timeout: number;
  constructor(private readonly options: DaemonLifecycleOptions) {
    this.root = path.resolve(options.root ?? daemonRoot());
    this.alive = options.alive ?? processAlive;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.protect = options.protect ?? protectDaemonPath;
    this.recycle = options.recycle ?? recycleDaemonPath;
    this.timeout = options.timeoutMs ?? 15000;
  }

  private state(): DaemonInfo | null {
    const file = path.join(this.root, 'daemon.json'); assertPlain(file);
    if (!fs.existsSync(file)) return null;
    const state = JSON.parse(fs.readFileSync(file, 'utf8')) as DaemonInfo;
    if (!Number.isSafeInteger(state.pid) || state.pid < 1 || !Number.isInteger(state.port) || state.port < 1 || state.port > 65535 || typeof state.instanceId !== 'string') throw new Error('invalid daemon state');
    return state;
  }

  private token(): string {
    const file = path.join(this.root, 'daemon.token'); assertPlain(file);
    const token = fs.readFileSync(file, 'utf8').trim();
    if (!/^[0-9a-f]{48}$/.test(token)) throw new Error('invalid daemon token');
    return token;
  }

  async status(): Promise<DaemonInfo | null> {
    const state = this.state();
    if (!state || !this.alive(state.pid)) return null;
    const response = await this.fetch(`http://127.0.0.1:${state.port}/api/daemon/status`, { headers: { Authorization: `Bearer ${this.token()}` }, signal: AbortSignal.timeout(1000) });
    if (!response.ok) throw new Error('daemon identity probe rejected');
    const actual = await response.json() as DaemonInfo;
    if (actual.pid !== state.pid || actual.instanceId !== state.instanceId) throw new Error('daemon identity mismatch');
    return actual;
  }

  async start(port = 5678): Promise<DaemonInfo> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('daemon port must be 1–65535');
    assertPlain(this.root); fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const lock = path.join(this.root, 'daemon.lock');
    if (fs.existsSync(lock)) {
      const owner = readDaemonLock(this.root);
      if (this.alive(owner.pid)) {
        const running = await this.status();
        if (running && running.instanceId === owner.instanceId) return running;
        throw new Error('daemon start is already in progress');
      }
      await releaseDaemonLock(this.root, owner.instanceId, this.recycle);
    }
    // mkdir is the cross-process atomic claim; concurrent callers cannot both launch.
    fs.mkdirSync(lock, { mode: 0o700 });
    const instanceId = randomUUID();
    let launched = false;
    let launchedPid: number | undefined;
    let ownerWritten = false;
    try {
      this.protect(lock, true);
      writeDaemonFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, instanceId }), this.protect);
      fs.writeFileSync(path.join(lock, instanceId + '.claim'), instanceId, { flag: 'wx', mode: 0o600 });
      ownerWritten = true;
      writeDaemonFile(path.join(this.root, 'daemon.token'), randomBytes(24).toString('hex'), this.protect);
      const available = this.options.portAvailable ?? daemonPortAvailable;
      if (!await available(port)) {
        let candidate = 30001;
        while (candidate < 30011 && !await available(candidate)) candidate++;
        if (candidate === 30011) throw new Error('no free daemon port; choose --port');
        port = candidate;
      }
      const deadline = Date.now() + this.timeout;
      const pid = await this.options.launch({ root: this.root, instanceId, parentPid: process.pid, port, deadline });
      launchedPid = pid;
      launched = true;
      while (Date.now() < deadline) {
        if (!this.alive(pid)) throw new Error('daemon exited before becoming ready');
        try {
          const ready = await this.status();
          if (ready?.pid === pid && ready.instanceId === instanceId) return ready;
        } catch { /* child has not published an authenticated ready endpoint yet */ }
        await new Promise(resolve => setTimeout(resolve, this.options.pollMs ?? 100));
      }
      throw new Error('daemon readiness timed out; lock retained until child exits');
    } catch (error) {
      if (!launched || launchedPid !== undefined && !this.alive(launchedPid)) {
        // This mkdir belongs to this caller even if ACL setup failed before owner publication.
        try {
          // A dead child's credential is inert. Only the child revokes it while still
          // owning a live lock; an old parent must never blank a newer start's token.
          if (ownerWritten) await releaseDaemonLock(this.root, instanceId, this.recycle);
          else {
            const retired = path.join(this.root, `daemon.lock.retired-${instanceId}`);
            fs.renameSync(lock, retired); await this.recycle(retired);
          }
        } catch { /* preserve the original launch/ACL error; retired state is safe to inspect */ }
      }
      throw error;
    }
  }

  async stop(): Promise<boolean> {
    const running = await this.status();
    if (!running) return false;
    const response = await this.fetch(`http://127.0.0.1:${running.port}/api/daemon/stop`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.token()}` }, signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) throw new Error('daemon shutdown request rejected');
    const deadline = Date.now() + this.timeout;
    while (this.alive(running.pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, this.options.pollMs ?? 100));
    if (this.alive(running.pid)) throw new Error('daemon shutdown timed out');
    return true;
  }
}

/** Force fallback runs inside the authenticated process, so PID reuse is harmless. */
export function gracefulDaemonStop(close: () => Promise<void>, exit: (code: number) => void, timeoutMs = 10000, workspace?: string): () => void {
  let stopping = false;
  // ponytail: this factory runs in the resident child; the launcher exits after readiness.
  const trashRoot = path.resolve(workspace ?? process.cwd(), '.harness', 'trash');
  const retention = setInterval(() => {
    if (process.env.VESSEL_TRASH_TTL_DAYS === '0') return;
    try {
      if (fs.existsSync(trashRoot)) trashStore.purge({ root: trashRoot });
    } catch (error) {
      console.warn('[vessel] daemon trash purge failed: ' + String(error));
    }
  }, 86_400_000);
  retention.unref();
  return () => {
    if (stopping) return;
    stopping = true;
    clearInterval(retention);
    const timer = setTimeout(() => exit(1), timeoutMs);
    void close().then(() => { clearTimeout(timer); exit(0); }, () => { clearTimeout(timer); exit(1); });
  };
}
