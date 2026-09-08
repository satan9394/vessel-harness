/**
 * runtime/sidecar — child-process transport (task 070).
 *
 * Wraps a spawned sidecar process and exposes it as a SidecarTransport. This is
 * the production adapter the SidecarClient uses to talk to a real (future Rust)
 * sidecar binary over stdin/stdout.
 *
 * NOTE: tests must NOT depend on a live spawn (constrained session may EPERM on
 * spawn+pipe capture). Unit tests use the in-memory `createTransportPair`
 * instead. This adapter is exercised only when a real sidecar binary exists
 * (071+ once a toolchain is ready).
 */
import { spawn, type ChildProcess } from 'node:child_process';

import type { SidecarTransport } from './transport.js';

export interface SpawnSidecarOptions {
  /** executable path of the sidecar binary. */
  command: string;
  args?: string[];
  /** pass-through env merge (defaults to process.env). */
  env?: Record<string, string>;
  cwd?: string;
}

export class NodeChildProcessTransport implements SidecarTransport {
  readonly pid: number | undefined;
  private child: ChildProcess;
  private closed = false;
  private dataHandlers: Array<(d: string) => void> = [];
  private closeHandlers: Array<() => void> = [];
  private errorHandlers: Array<(e: Error) => void> = [];
  private pendingError: Error | null = null;

  constructor(private opts: SpawnSidecarOptions) {
    this.child = spawn(opts.command, opts.args ?? [], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, ...(opts.env ?? {}) },
      cwd: opts.cwd,
      windowsHide: true,
    });
    this.pid = this.child.pid;
    // stderr is 'inherit' so diagnostics surface in the host console; the
    // protocol is bound to stdout only.

    this.child.stdout?.setEncoding('utf8');
    this.child.stdout?.on('data', (d: string) => {
      for (const h of this.dataHandlers) h(d);
    });

    this.child.on('error', (err) => {
      this.pendingError = err;
      this.settleClose();
    });
    this.child.on('close', () => this.settleClose());
  }

  write(data: string): void {
    if (this.closed) return;
    this.child.stdin?.write(data);
  }

  close(): void {
    // ask the sidecar to close stdin; the process usually exits on its own.
    if (this.closed) return;
    try {
      this.closed = true;
      this.child.stdin?.end();
      this.settleClose();
    } catch {
      // already gone — close handlers below still fire
      this.settleClose();
    }
  }

  onData(handler: (d: string) => void): void {
    this.dataHandlers.push(handler);
  }
  onClose(handler: () => void): void {
    if (this.closed) {
      handler();
      return;
    }
    this.closeHandlers.push(handler);
  }
  onError(handler: (e: Error) => void): void {
    if (this.pendingError) {
      handler(this.pendingError);
      return;
    }
    this.errorHandlers.push(handler);
  }

  private settleClose(): void {
    if (this.settled) return;
    this.settled = true;
    this.closed = true;
    if (this.pendingError) {
      for (const h of this.errorHandlers) h(this.pendingError);
    }
    for (const h of this.closeHandlers) h();
  }
  private settled = false;
}