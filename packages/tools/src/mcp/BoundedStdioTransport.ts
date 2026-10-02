import { createJobObject, WindowsJobObject, defaultKillWindowsTree, type JobObjectConfinement } from '@vessel/runtime';
import { StdioTransport, type McpRequestOptions } from './McpClient.js';

export interface BoundedStdioTransportOptions {
  env?: Record<string, string>;
  cwd?: string;
  shell?: boolean;
  useJobObject?: boolean;
  killTimeoutMs?: number;
}

/** Reuses the stdio RPC implementation; Windows requests wait for confinement. */
export class BoundedStdioTransport extends StdioTransport {
  private readonly ready: Promise<void>;
  private job?: JobObjectConfinement;
  private stopping = false;
  private disposal?: Promise<void>;
  private closePromise?: Promise<void>;
  private readonly boundedWindows: boolean;
  private readonly observedDescendants = new Set<number>();

  constructor(command: string, args: string[] = [], opts: BoundedStdioTransportOptions = {}) {
    super(command, args, opts);
    this.boundedWindows = process.platform === 'win32' && (opts.useJobObject ?? true);
    this.ready = this.boundedWindows && this.child.pid
      ? createJobObject(this.child.pid).then(async (job) => {
          this.job = job;
          if (this.child.pid) {
            const descendants = await WindowsJobObject.enumerateDescendants(this.child.pid);
            for (const pid of descendants) this.observedDescendants.add(pid);
            if (job.attached === false) throw new Error('MCP server exited before confinement');
            const attached = descendants.length ? await job.attachDescendants?.(descendants) ?? 0 : 0;
            if (attached < descendants.length) throw new Error('MCP Job Object failed to attach descendants');
          }
          if (this.stopping) await this.disposeJob();
        })
      : Promise.resolve();
    // Observe attach failure even when nobody requested a tool yet.
    void this.ready.catch(() => { void this.close().catch(() => {}); });
    const stop = (): void => { void this.close().catch(() => {}); };
    this.child.once('exit', stop);
    this.child.once('error', stop);
  }

  override async request<T = unknown>(method: string, params?: unknown, timeoutMs?: number, opts?: McpRequestOptions): Promise<T> {
    await this.ready;
    if (this.stopping) throw new Error('MCP transport closed');
    return super.request<T>(method, params, timeoutMs, opts);
  }

  private disposeJob(): Promise<void> {
    if (!this.job) return Promise.resolve();
    return this.disposal ??= this.job.dispose();
  }

  /** Parent PIDs may vanish during job disposal; keep escaped PIDs independently. */
  private async terminateObservedDescendants(): Promise<void> {
    const isAlive = (pid: number): boolean => {
      try { process.kill(pid, 0); return true; } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ESRCH') return false;
        if ((err as NodeJS.ErrnoException).code === 'EPERM') return true;
        throw err;
      }
    };
    const alive = [...this.observedDescendants].filter(isAlive);
    await WindowsJobObject.terminatePids(alive);
    // TerminateProcess is asynchronous; verify disappearance, including already-dead PIDs.
    const deadline = Date.now() + 2000;
    while (alive.some(isAlive)) {
      if (Date.now() >= deadline) throw new Error('MCP escaped descendant cleanup failed');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  override close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.stopping = true;
    this.closePromise = (async () => {
      const close = super.close();
      let attachFailed = false;
      await this.ready.catch(() => { attachFailed = true; });
      let disposeError: unknown;
      try { await this.disposeJob(); } catch (err) { disposeError = err; } finally {
        if (this.boundedWindows && this.child.pid && (attachFailed || disposeError || this.job?.attached === false)) {
          const outcomes = await Promise.allSettled([
            defaultKillWindowsTree(this.child.pid),
            this.terminateObservedDescendants(),
          ]);
          for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
        }
      }
      await close;
      if (disposeError) throw disposeError;
    })();
    return this.closePromise;
  }
}
