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
export * from '../adapters/dsh.js';
// opencode-specific symbols only — ResultStub / defaultRunCommand are shared with
// dsh.js and already re-exported above (identical definitions), so re-exporting
// them here would be an ambiguous duplicate in the `export *` surface.
export {
  OPENCODE_ADAPTER_ID,
  OPENCODE_ADAPTER_VERSION,
  OPENCODE_RUN_SUBCOMMAND,
  type OpencodeAdapterOptions,
  type OpencodeRawRun,
  probeOpencodeEnv,
  opencodeCapabilities,
  normalizeOpencodeRun,
  runOpencodeFixture,
  opencodeAdapter,
} from '../adapters/opencode.js';
// codex-specific symbols only — ResultStub / defaultRunCommand are shared with
// dsh.js and already re-exported above (identical definitions), so re-exporting
// them here would be an ambiguous duplicate in the `export *` surface.
export {
  CODEX_ADAPTER_ID,
  CODEX_ADAPTER_VERSION,
  CODEX_RUN_SUBCOMMAND,
  type CodexAdapterOptions,
  type CodexRawRun,
  probeCodexEnv,
  codexCapabilities,
  normalizeCodexRun,
  runCodexFixture,
  codexAdapter,
} from '../adapters/codex.js';