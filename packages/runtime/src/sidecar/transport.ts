/**
 * runtime/sidecar — transport abstraction (task 070).
 *
 * A `SidecarTransport` is the injectable I/O seam between the SidecarClient and
 * whatever carries bytes to/from the sidecar process: a real spawned child
 * (`NodeChildProcessTransport`) in production, or an in-memory duplex pair
 * (`createTransportPair`) in unit tests. This is what keeps the client fully
 * testable without a real spawn (see环境备注/AGENTS: spawn capture may EPERM in
 * constrained sessions — we never depend on a live process in tests).
 *
 * The transport carries RAW strings (an OS line is preserved but the client
 * owns framing via SidecarFramer). Implementations must:
 *   - deliver `onData` chunks in order,
 *   - call `onClose` exactly once after close/exit,
 *   - call `onError` on I/O failure and then `onClose`,
 *   - be safe to close multiple times (idempotent).
 */
export interface SidecarTransport {
  /** OS pid when backed by a real child process; undefined for in-memory ends. */
  readonly pid: number | undefined;
  /** Push a raw string onto the wire. */
  write(data: string): void;
  /** Close this end of the wire. Idempotent. */
  close(): void;
  /** Register a raw-string data listener. */
  onData(handler: (data: string) => void): void;
  /** Register a close listener (fired once). */
  onClose(handler: () => void): void;
  /** Register an error listener. */
  onError(handler: (err: Error) => void): void;
}

export interface TransportEnd {
  write(data: string): void;
  close(): void;
  onData(handler: (data: string) => void): void;
  onClose(handler: () => void): void;
  onError(handler: (err: Error) => void): void;
}

/**
 * An in-memory duplex pipe: `createTransportPair()` returns two connected ends.
 * Whatever one end writes is delivered as onData on the other (synchronously).
 * Used to wire the SidecarClient to a MockSidecar entirely in-process.
 */
export function createTransportPair(): [SidecarTransport, SidecarTransport] {
  const a = new MemoryEnd();
  const b = new MemoryEnd();
  a.link(b);
  b.link(a);
  return [a, b];
}

class MemoryEnd implements SidecarTransport {
  readonly pid: number | undefined = undefined;
  private peer: MemoryEnd | null = null;
  private dataHandlers: Array<(d: string) => void> = [];
  private closeHandlers: Array<() => void> = [];
  private errorHandlers: Array<(e: Error) => void> = [];
  private closed = false;

  link(peer: MemoryEnd): void {
    this.peer = peer;
  }

  write(data: string): void {
    if (this.closed) return;
    this.peer?.receive(data);
  }

  private receive(data: string): void {
    if (this.closed) return;
    for (const h of this.dataHandlers) h(data);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // propagate EOF to the peer — when one end of a pipe closes (sidecar
    // exits), the other end observes a close, exactly like a real stdio pipe.
    const peer = this.peer;
    this.peer = null;
    peer?.peerClose();
    for (const h of this.closeHandlers) h();
  }

  /** called by our peer when IT closes. */
  private peerClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const h of this.closeHandlers) h();
  }

  onData(handler: (d: string) => void): void {
    this.dataHandlers.push(handler);
  }
  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }
  onError(handler: (e: Error) => void): void {
    this.errorHandlers.push(handler);
  }
}