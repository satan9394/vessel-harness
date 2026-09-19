/**
 * runtime/sidecar — mock sidecar (task 070).
 *
 * An in-process JSON-RPC 2.0 sidecar responder used to verify the protocol
 * round-trip / errors / notifications / concurrency without a real process.
 * Wire it to a SidecarClient through `createTransportPair()`:
 *
 *   const [hostEnd, sidecarEnd] = createTransportPair();
 *   const sidecar = new MockSidecar(sidecarEnd, opts);
 *   const client = new SidecarClient(hostEnd);
 *
 * It reads newline-delimited frames from its transport end, dispatches known
 * protocol methods (initialize / ping / shutdown / placeholders), and writes
 * JSON-RPC responses. Real sidecars (Rust) must behave identically per the
 * docs/SIDECAR-PROTOCOL.md spec.
 *
 * **已声明未实现**：真实 Rust sidecar 未做（V1.4 的 "Rust execution sidecar PoC"）——
 * 本文件只是**协议回环的 mock**。触发条件 = 需要真进程 / 语言隔离执行时；届时按
 * `docs/SIDECAR-PROTOCOL.md` 实现 Rust 端，行为须与本 mock 一致。
 */
import {
  JSON_RPC_VERSION,
  JsonRpcErrorCode,
  SidecarErrorCode,
  SidecarMethod,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './types.js';
import { decodeFrame, encodeFrame, SidecarFramer } from './framer.js';
import type { SidecarTransport } from './transport.js';

export interface MockSidecarOptions {
  /** name reported by initialize (default 'mock-sidecar'). */
  name?: string;
  /** serverVersion reported by initialize (default '0.0.0'). */
  version?: string;
  /** force a non-standard protocol version (default '1.0'). */
  protocolVersion?: string;
  /** declared capability methods (default = all SidecarMethod values). */
  capabilities?: string[];
  /** if true, `initialize` is rejected with NotInitialized semantics on purpose. */
  rejectInitialize?: boolean;
  /** if true, every request is answered with InternalError (fault injection). */
  failAll?: boolean;
}

/**
 * MockSidecar is a protocol-conformant in-process sidecar responder. It drives
 * its own transport end directly and is fully synchronous-or-microtask for
 * deterministic tests.
 */
export class MockSidecar {
  private readonly framer = new SidecarFramer();
  private readonly transport: SidecarTransport;
  private readonly opts: MockSidecarOptions;
  private initialized = false;
  readonly initializeCalls: JsonRpcRequest[] = [];
  readonly pingCalls: JsonRpcRequest[] = [];

  constructor(transport: SidecarTransport, opts: MockSidecarOptions = {}) {
    this.transport = transport;
    this.opts = opts;
    this.transport.onData((chunk) => this.onChunk(chunk));
  }

  /** Push an inbound string chunk (for tests/simulated peers). */
  private onChunk(chunk: string): void {
    this.framer.push(chunk, (frame) => {
      let msg: unknown;
      try {
        msg = decodeFrame(frame);
      } catch {
        this.respondError(-1, JsonRpcErrorCode.ParseError, 'parse error');
        return;
      }
      this.onMessage(msg as JsonRpcMessage);
    });
  }

  private onMessage(msg: JsonRpcMessage): void {
    // notification without id — no response expected
    if (!('id' in msg) || !('method' in msg)) {
      return;
    }
    const req = msg as JsonRpcRequest;
    if (this.opts.rejectInitialize) {
      this.respondError(req.id, SidecarErrorCode.NotInitialized, 'not initialized');
      return;
    }
    if (this.opts.failAll) {
      this.respondError(req.id, JsonRpcErrorCode.InternalError, 'fault injected');
      return;
    }
    this.dispatch(req);
  }

  private dispatch(req: JsonRpcRequest): void {
    switch (req.method) {
      case SidecarMethod.Initialize: {
        this.initializeCalls.push(req);
        this.initialized = true;
        this.respondSuccess(req.id, {
          protocolVersion: this.opts.protocolVersion ?? '1.0',
          serverName: this.opts.name ?? 'mock-sidecar',
          serverVersion: this.opts.version ?? '0.0.0',
          capabilities: {
            methods: this.opts.capabilities ?? Object.values(SidecarMethod),
            implementation: 'ts-mock',
            enforcement: {
              filesystem: 'none',
              process: 'none',
              network: 'none',
            },
          },
        });
        return;
      }
      case SidecarMethod.Ping: {
        this.pingCalls.push(req);
        this.respondSuccess(req.id, {
          pong: true,
          protocolVersion: this.opts.protocolVersion ?? '1.0',
          receivedAt: Date.now(),
        });
        return;
      }
      case SidecarMethod.Shutdown: {
        this.respondSuccess(req.id, { ok: true, graceMs: 10 });
        return;
      }
      default: {
        if (this.opts.capabilities && !this.opts.capabilities.includes(req.method)) {
          this.respondError(
            req.id,
            SidecarErrorCode.CapabilityUnavailable,
            `capability '${req.method}' is not declared`,
          );
          return;
        }
        // concrete backend work lands in 071-073; a conformant sidecar answers
        // unhandled-but-declared methods with method-not-found today.
        this.respondError(
          req.id,
          JsonRpcErrorCode.MethodNotFound,
          `method not implemented: ${req.method}`,
        );
      }
    }
  }

  /** Collect a single inbound notification (out-of-band) for assertions. */
  notifications: JsonRpcNotification[] = [];
  notify(method: string, params?: unknown): void {
    const n: JsonRpcNotification = {
      jsonrpc: JSON_RPC_VERSION,
      method,
      params,
    };
    this.notifications.push(n);
    this.transport.write(encodeFrame(n));
  }

  private respondSuccess(id: JsonRpcRequest['id'], result: unknown): void {
    const resp: JsonRpcResponse = {
      jsonrpc: JSON_RPC_VERSION,
      id,
      result,
    };
    this.transport.write(encodeFrame(resp));
  }

  private respondError(
    id: JsonRpcRequest['id'],
    code: number,
    message: string,
    data?: unknown,
  ): void {
    const resp: JsonRpcResponse = {
      jsonrpc: JSON_RPC_VERSION,
      id,
      error: { code, message, data },
    };
    this.transport.write(encodeFrame(resp));
  }

  /** Close this end of the wire (simulates sidecar exit). */
  close(): void {
    this.transport.close();
  }
}