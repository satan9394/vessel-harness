/**
 * runtime/sidecar — JSON-RPC 2.0 over stdio sidecar protocol client + mocks.
 * Canonical spec: docs/SIDECAR-PROTOCOL.md. Task 070.
 */
export * from './types.js';
export * from './framer.js';
export * from './transport.js';
export * from './child-transport.js';
export * from './client.js';
export * from './mock-sidecar.js';