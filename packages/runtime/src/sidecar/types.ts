/**
 * runtime/sidecar — JSON-RPC 2.0 over stdio wire types (task 070).
 *
 * This module is protocol-only: the exact shapes a sidecar (future Rust binary)
 * and the TS host exchange. Consumers (071 sandbox backend, 072 process-tree,
 * 069 credential candidate) depend on these types and on the constants here.
 *
 * Canonical spec: docs/SIDECAR-PROTOCOL.md. Keep these types in sync with it.
 */

/** JSON-RPC 2.0 standard reserved error codes (spec §5.1). */
export const JsonRpcErrorCode = {
  /** invalid JSON / too-deep / not-a-well-formed-request */
  ParseError: -32700,
  /** valid JSON but not a valid Request/Notification object */
  InvalidRequest: -32600,
  /** method does not exist / is not exposed */
  MethodNotFound: -32601,
  /** method arguments are invalid */
  InvalidParams: -32602,
  /** generic internal error */
  InternalError: -32603,
  /** implementation-defined server error range starts here (-32000) */
  ServerErrorStart: -32000,
  ServerErrorEnd: -32099,
} as const;

/**
 * Vessel sidecar — custom application-domain error codes.
 * Allocated inside the JSON-RPC reserved server-error range (-32000..-32099).
 */
export const SidecarErrorCode = {
  /** sidecar not in a state that can serve the request (e.g. before initialize) */
  NotInitialized: -32000,
  /** requested capability is not declared in the capabilities set */
  CapabilityUnavailable: -32001,
  /** request exceeded its timeout on the sidecar side */
  SidecarTimeout: -32002,
  /** sidecar is shutting down and rejects new work */
  ShuttingDown: -32003,
  /** domain-specific operation failed (carrier in message/data) */
  OperationFailed: -32004,
} as const;

/** Protocol identifier constants. */
export const SIDECAR_PROTOCOL_VERSION = '1.0';
export const JSON_RPC_VERSION = '2.0';

/** Error object shape per JSON-RPC 2.0 §5.1. */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** Base JSON-RPC message (any of request / notification / response). */
export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

/** A request expects a response; carries an id. */
export interface JsonRpcRequest {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: RequestId;
  method: string;
  params?: unknown;
}

/** A notification fires without a response; carries no id. */
export interface JsonRpcNotification {
  jsonrpc: typeof JSON_RPC_VERSION;
  method: string;
  params?: unknown;
}

/** A response matches a request id; either `result` or `error`, never both. */
export interface JsonRpcResponse {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: RequestId;
  result?: unknown;
  error?: JsonRpcError;
}

/** id may be a string or a number (JSON wire type); null id denotes invalid. */
export type RequestId = string | number;

/** Discriminate a decoded frame. */
export function isNotification(
  msg: JsonRpcMessage,
): msg is JsonRpcNotification {
  return !('id' in msg) && 'method' in msg;
}

export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return 'id' in msg && ('result' in msg || 'error' in msg);
}

export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return 'id' in msg && 'method' in msg;
}

/**
 * Methods exposed by a Vessel sidecar (v1.0).
 * Protocol/lifecycle methods are mandatory; capability placeholder methods are
 * declared via `capabilities` and stubbed until 071-073 consume them.
 */
export const SidecarMethod = {
  /** handshake: exchange version + capability declaration */
  Initialize: 'initialize',
  /** heartbeat / liveness */
  Ping: 'ping',
  /** graceful shutdown (sidecar replies then exits) */
  Shutdown: 'shutdown',
  /** capability placeholders (concrete backend work lands in 071-073) */
  ExecProcess: 'process.exec',
  SandboxConfine: 'sandbox.confine',
  ReadFile: 'fs.readFile',
  WriteFile: 'fs.writeFile',
  ListDir: 'fs.readDir',
} as const;
export type SidecarMethod = (typeof SidecarMethod)[keyof typeof SidecarMethod];

/** Result of `initialize` — the capability declaration. */
export interface InitializeResult {
  protocolVersion: string;
  serverName: string;
  serverVersion: string;
  /** feature capabilities the sidecar actually provides (subset of the method set). */
  capabilities: SidecarCapabilities;
}

export interface SidecarCapabilities {
  /** executable capability methods supported (from SidecarMethod set). */
  methods: string[];
  /** implementation / backend descriptive info. */
  implementation: string;
  /** enforcement levels mirror (roadmap §13.3): filesystem/process/network. */
  enforcement: {
    filesystem: 'enforced' | 'partial' | 'none';
    process: 'enforced' | 'partial' | 'none';
    network: 'enforced' | 'partial' | 'none';
  };
}

/** Result of `ping` — heartbeat echo with host↔sidecar round-trip marker. */
export interface PingResult {
  pong: true;
  protocolVersion: string;
  /** server monotonic timestamp (ms) at receipt, for latency measurement. */
  receivedAt: number;
}

/** Result of `shutdown` — sidecar confirms it will exit after flushing. */
export interface ShutdownResult {
  ok: true;
  /** milliseconds the sidecar gives the host to flush before exit. */
  graceMs: number;
}