/**
 * task 076 — Harness Adapter Contract module.
 *
 * Bundle exports for the cross-harness contract: types (HarnessAdapter +
 * RunResult + capability), validation, and the Vessel self-adapter that proves
 * the contract is usable & testable without an external harness.
 */
export * from './types.js';
export * from './validate.js';
export * from './vessel.js';