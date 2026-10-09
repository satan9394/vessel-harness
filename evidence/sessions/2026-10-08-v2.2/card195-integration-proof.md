# Card 195 integration proof — 2026-10-08

Explicit opt-in composition is available through `ComposeOptions.mods` and `vessel run --mod <directory>`. Discovery and `mod list/audit` remain static diagnostics. Composed sessions expose `loadedMods` names and Worker isolation status. No Mod entrypoint is imported or executed in the host process.

The runtime Executor accepts a structural pipeline contract, without importing policy. Ordering is original host policy → before-tool observers → input rewrite → host policy recheck → interception or actual execution → host result audit → reverse result observers. Both original and rewritten denies precede interception. Handled results must be structured `ToolExecutionResult` data; malformed results and callback failures return DENIED and latch the execution circuit. Runtime denials use existing `audit/denial` records; turn-start failures explicitly veto before model invocation. A post-tool observer failure cannot undo an already authorized action, but the host audit runs first and survives that failure.

Unsigned callbacks run only through ClaudeModAdapter's restricted Worker proxy. File RPC uses separate plain policy-checking Executor and dedicated workspace-confined Read/Write/Edit tools, so an RPC cannot recursively call Mods. Manifest filesystem grants are relative to the Mod directory; the host additionally confines resolved targets to the composed workspace. Loading source from an external directory never grants file access there. Host filesystem protected/deny-read rules are retained; external allow grants are excluded. Worker cancellation is forwarded to delegated tools.

Compatibility boundary: dependency-free precompiled JavaScript callback exports only; module imports, native process execution and network permissions are denied. Each hook invocation uses a fresh Worker. Cross-hook module state is intentionally absent. No credential store, real host environment or policy object is exposed to the Worker context. Static audit detects known patterns and is not an independent security audit.

Prompt contribution formatting runs once during session composition. Each formatter receives only its own incremental contribution. The labelled `[Mod: <name>]` output is captured as immutable session data and passed through ContextBuilder's generic `scopedAppendix` seam. It occupies the scoped-prefix tail and the identical position in actual request messages. Stable prefix bytes, instruction provenance, tool adjacency, changing volatile text and compaction/recovery assembly remain intact. No Mod callback runs during later context assembly.

Verification after the last source edit:

- `card195-focused-tests.log`: 14 files / 100 tests passed, `EXIT_CODE=0`. Includes all Mod unit tests, runtime sequencing/circuit tests, real MockProvider loop integration, scoped prefix/compaction tests and CLI `run --mod`.
- `card195-tsc-build.log`: `npx tsc -b tsconfig.json`, `EXIT_CODE=0`.
- `card195-test-types.log`: `npm run typecheck:tests`, `EXIT_CODE=0`.
- Four integration-focused files add 17 tests. They cover original denial, rewritten credential denial, actual write shortcircuit, guarded RPC without recursion, external-directory RPC denial, host permission denial despite manifest grants, one-shot prompt formatting, malformed result circuit, host audit survival and turn-start denial with zero model calls.

Only test-owned `os.tmpdir()` fixtures are cleaned by Node deletion APIs. No dependency or lockfile modifications, external harness processes, core modifications, commits, pushes or publishing were performed by this integration executor. Final whole-repository gates and final run-state/HANDOFF reconciliation are owned by the controller and recorded separately.
