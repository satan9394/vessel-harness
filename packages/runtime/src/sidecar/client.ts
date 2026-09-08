/**
 * runtime/sidecar — SidecarClient (task 070).
 *
 * Protocol client for a Vessel sidecar over an injectable SidecarTransport. It
 * handles:
 *   - writing JSON-RPC requests/notifications (single-line framing via encodeFrame),
 *   - reading + framing inbound data (SidecarFramer + decodeFrame),
 *   - matching responses to requests by id,
 *   - out-of-band `notify` events (requests without id sent BY the sidecar),
 *   - per-request timeout,
 *   - transport error / close (exit) propagation.
 *
 * Concurrency semantics (spec §7): the client is fully asynchronous — you may
 * call `request()` many times concurrently; each is assigned a unique id and
 * resolves when the sidecar responds with that id. Responses may arrive in any
 * order. Requests resolve with `result` on success and throw `SidecarRpcError`
 * when the sidecar responds with an `error`.
 */
import {
  JSON_RPC_VERSION,
  JsonRpcErrorCode,
  SidecarErrorCode,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type RequestId,
} from './types.js';
import { decodeFrame, encodeFrame, SidecarFramer } from './framer.js';
import type { SidecarTransport } from './transport.js';

/** An RPC failure surfaced to the caller (sidecar returned an `error` object). */
export class SidecarRpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(`sidecar RPC error ${code}: ${message}`);
    this.name = 'SidecarRpcError';
    this.code = code;
    this.data = data;
  }
}

/** Thrown when the sidecar transport closes/errors before a pending response. */
export class SidecarClosedError extends Error {
  readonly pending: number;
  constructor(message: string, pending: number) {
    super(message);
    this.name = 'SidecarClosedError';
    this.pending = pending;
  }
}

/** Thrown when a request exceeds its timeout. */
export class SidecarTimeoutError extends Error {
  readonly id: RequestId;
  constructor(id: RequestId, timeoutMs: number) {
    super(`sidecar request ${String(id)} timed out after ${timeoutMs}ms`);
    this.name = 'SidecarTimeoutError';
    this.id = id;
  }
}

export interface SidecarClientOptions {
  /** per-request timeout for `request()` (ms). Default 30_000. */
  requestTimeoutMs?: number;
  /** optional handler for notifications pushed by the sidecar. */
  onNotification?: (notification: JsonRpcNotification) => void;
}

interface Pending {
  id: RequestId;
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class SidecarClient {
  readonly transport: SidecarTransport;
  private readonly requestTimeoutMs: number;
  private readonly onNotification?: (n: JsonRpcNotification) => void;
  private readonly framer = new SidecarFramer();
  private counter = 0;
  private readonly pending = new Map<string, Pending>();
  private closed = false;
  private closeHandlers: Array<() => void> = [];
  private closeReason: string | null = null;

  constructor(transport: SidecarTransport, options: SidecarClientOptions = {}) {
    this.transport = transport;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.onNotification = options.onNotification;
    this.transport.onData((chunk) => this.onChunk(chunk));
    this.transport.onError((err) => this.failActive(err));
    this.transport.onClose(() => this.handleClose());
  }

  /** Unique request id generator. */
  private nextId(): RequestId {
    this.counter += 1;
    return this.counter;
  }

  private onChunk(chunk: string): void {
    try {
      this.framer.push(chunk, (frame) => {
        let msg: unknown;
        try {
          msg = decodeFrame(frame);
        } catch (err) {
          // Fatal framing error in what the sidecar sent us.
          this.failActive(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        this.onMessage(msg as JsonRpcMessage);
      });
    } catch (err) {
      // framer pushed past MAX_FRAME_BYTES → stream is corrupt; fail everything.
      this.failActive(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private onMessage(msg: JsonRpcMessage): void {
    if ('id' in msg && ('result' in msg || 'error' in msg)) {
      const resp = msg as JsonRpcResponse;
      this.resolveResponse(resp);
      return;
    }
    if (!('id' in msg) && 'method' in msg) {
      const notif = msg as JsonRpcNotification;
      this.onNotification?.(notif);
      return;
    }
    // Invalid message shape from the sidecar — surface as an internal error.
    this.failActive(new Error('malformed message from sidecar'));
  }

  private resolveResponse(resp: JsonRpcResponse): void {
    const key = String(resp.id);
    const p = this.pending.get(key);
    if (!p) return; // late/unknown id — drop (sidecar bug or late reply)
    this.pending.delete(key);
    clearTimeout(p.timer);
    if (resp.error) {
      p.reject(new SidecarRpcError(resp.error.code, resp.error.message, resp.error.data));
    } else {
      p.resolve(resp.result);
    }
  }

  private failActive(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new SidecarClosedError(`sidecar transport failed: ${err.message}`, this.pending.size));
    }
    this.pending.clear();
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = 'sidecar exited';
    if (this.pending.size > 0) {
      const n = this.pending.size;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new SidecarClosedError('sidecar closed with pending requests', n));
      }
      this.pending.clear();
    }
    for (const h of this.closeHandlers) h();
  }

  /** True once the transport has closed/exited. */
  isClosed(): boolean {
    return this.closed;
  }

  /** Reason the client closed (null while still open). */
  closeReasonOf(): string | null {
    return this.closeReason;
  }

  /** Register a handler fired once the transport closes (after pendings reject). */
  onClose(handler: () => void): void {
    if (this.closed) {
      handler();
      return;
    }
    this.closeHandlers.push(handler);
  }

  /**
   * Send a JSON-RPC request and await its response. Rejects with
   * SidecarRpcError (sidecar error object), SidecarTimeoutError, or
   * SidecarClosedError.
   */
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    const id = this.nextId();
    const req: JsonRpcRequest = {
      jsonrpc: JSON_RPC_VERSION,
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new SidecarClosedError('sidecar already closed', 0));
        return;
      }
      const t = timeoutMs ?? this.requestTimeoutMs;
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new SidecarTimeoutError(id, t));
      }, t);
      this.pending.set(String(id), { id, resolve, reject, timer });
      try {
        this.transport.write(encodeFrame(req));
      } catch (err) {
        this.pending.delete(String(id));
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected; fire-and-forget).
   * Method/protocol notifications are out of band; see spec §6.
   */
  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    const n: JsonRpcNotification = {
      jsonrpc: JSON_RPC_VERSION,
      method,
      ...(params === undefined ? {} : { params }),
    };
    this.transport.write(encodeFrame(n));
  }

  /** Convenience: initialize handshake. */
  async initialize(params?: { protocolVersion?: string }): Promise<unknown> {
    return this.request('initialize', params ?? {});
  }

  /** Convenience: ping (heartbeat). */
  async ping(params?: unknown): Promise<unknown> {
    return this.request('ping', params ?? {});
  }

  /** Convenience: shutdown (sidecar replies then exits). */
  async shutdown(params?: unknown): Promise<unknown> {
    return this.request('shutdown', params ?? {});
  }

  /** Close the transport (e.g. drop the sidecar). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = 'client closed';
    const n = this.pending.size;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new SidecarClosedError('sidecar closed by client', n));
    }
    this.pending.clear();
    this.transport.close();
    for (const h of this.closeHandlers) h();
  }
}

/** Re-exported convenience constants for consumers. */
export { JsonRpcErrorCode, SidecarErrorCode };