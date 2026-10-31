# Card 371 — CodeQL seven remediation

Date: 2026-10-31. Baseline: `07c43d3f` (`git status --porcelain` empty before work); Node `v26.13.0`.
Execution: main thread only, no subagents or external agents, no commit/push or GitHub alert changes.

## Outcome

All seven requested source-level fixes are implemented. Both ordered focused batches passed before advancing. After one test-typing repair, the final full gate passed **17/17, exit 0**.

No CodeQL CLI is available on PATH (`codeql version` cannot spawn: `ENOENT`), and these local changes have not been pushed. Consequently, disappearance of existing GitHub alerts and any new alert at the intentional shell boundary are **UNVERIFIED**. This report does not claim a clean CodeQL rescan.

## Alert-by-alert behavior and semantics

| Alert | Before → after | Semantics and local disposition |
|---|---|---|
| #15 | Worktree argv reached a shared spawn with a potentially enabled shell → argv spawn has no `shell` option | Source fix complete. `Worktree.ts` unchanged; git arguments remain separate strings, including paths with spaces. No escaping or input whitelist added. Remote rescan pending. |
| #16 | Same shared argv/shell ambiguity → same dedicated argv spawn | Source fix complete. Same location and structural repair as #15; no Worktree edit. Remote rescan pending. |
| #14 | Environment-derived executable paths could share a shell-enabled spawn → `runCommand` rejects shell mode and `runShellCommand` owns the only explicit `shell: true` spawn | Source fix complete. The executable stays one argv word. Shell execution remains available for whole command lines. Remote rescan pending; intentional boundary may be reported. |
| #18 | `/\/+$/` retried long slash runs → backwards index scan | Source fix complete. Exact trailing-slash equivalence, including `https://` → `https:`, empty input → empty input, and `https://a/v1//` → `https://a/v1`. First endpoint spelling and failover order stay unchanged. Worst case O(n); a non-slash final character takes O(1). |
| #19 | OSC body class could consume ESC, backtrack quadratically, and eat hyperlink text → body excludes both BEL and ESC | Source fix complete. The first valid BEL or ESC-backslash ends OSC; `link` now survives between OSC controls. CSI/control removal is unchanged; existing `bad` expectation remains. Repeated incomplete OSC starts now scan linearly. |
| #20 | `core.*import` scanned an unbounded suffix for each `core` → same line-terminator exclusions with a 200-code-unit window | Source fix complete. Case-insensitive matching and all four JS line terminators are preserved. The agreed 200-unit window intentionally narrows the heuristic beyond ordinary review sentences; this is not global equivalence to the old unbounded expression. Tests cover 200/201 and LF/CR/U+2028/U+2029. Work is bounded per starting position, hence O(n). |
| #21 | Unbounded numeric components retried at each digit → three `{1,9}` components | Source fix complete. Normal tool banners and first-match behavior remain; no new anchors/boundary changes. The agreed nine-digit component limit intentionally narrows pathological input, and unanchored matching can still select a suffix of an oversized major component. Long numeric noise followed by a genuine version still finds the first version. Worst case O(n). |

`Sandbox.run` rejects shell mode with nonempty argv **before** creating isolation resources. Its existing option fields are retained in the dispatch base. Benchmark `run_check` uses `runShellCommand` for its existing whole command line.

The `supervise` body from `opts.onSpawn` through promise completion is exactly preserved against HEAD, including stdin, timeout, cancellation, confinement, process-group cleanup, output collection, error/close handling, and their order. The synchronous Promise executor still invokes spawn before `onSpawn`.

## Changed-file allowlist comparison

Seven named production files:

- `packages/runtime/src/process/Process.ts`
- `packages/runtime/src/sandbox/Sandbox.ts`
- `benchmarks/runners/src/asserts.ts`
- `apps/cli/src/providers/providerFactory.ts`
- `apps/cli/src/ui/TerminalStatusLine.ts`
- `packages/memory/src/reflection/autonomousReflection.ts`
- `packages/shared/src/toolPins.ts`

Six corresponding test files:

- `packages/runtime/src/process/Process.test.ts`
- `packages/runtime/src/sandbox/Sandbox.test.ts`
- `apps/cli/src/providers/providerFactory.failover.test.ts`
- `apps/cli/src/ui/statusLine.test.ts`
- `packages/memory/src/reflection/autonomousReflection.test.ts`
- `packages/shared/src/toolPins.test.ts`

Only the existing card's end is appended; its original bytes/status and `tasks/README.md` are preserved. Evidence is contained in this directory. The scope audit compares 217 protected tracked files via Git's repository line-ending rules, including Worktree, McpClient, Core, Web, CI, dependency manifests/lock and the gate script. An initial raw-blob comparison was corrected because a clean checkout can contain mixed/CRLF line endings; no protected file was edited to satisfy the audit. See `scope-audit.json` for current artifact SHA-256 values and `changes.patch` for the diff.

## Focused verification

Every command below exited **0**, in the specified order. Batch 1 completed before any batch-2 source/test edits.

| Command (Vitest prefix: `node node_modules/vitest/vitest.mjs run`) | Files | Passed | Existing skipped | Log |
|---|---:|---:|---:|---|
| `packages/runtime/src/process` | 2 | 10 | 0 | `batch1-1.log` |
| `packages/runtime/src/sandbox` | 3 | 49 | 1 | `batch1-2.log` |
| `packages/tools/src/git/worktree.test.ts` | 1 | 6 | 0 | `batch1-3.log` |
| `packages/tools/src/tools.test.ts` | 1 | 14 | 0 | `batch1-4.log` |
| `npx tsc -b tsconfig.json` | — | — | — | `batch1-5.log` |
| `apps/cli/src/providers/providerFactory.failover.test.ts` | 1 | 23 | 0 | `batch2-1.log` |
| `apps/cli/src/ui` | 1 | 9 | 0 | `batch2-2.log` |
| `packages/memory` | 8 | 66 | 0 | `batch2-3.log` |
| `packages/shared/src/toolPins.test.ts` | 1 | 24 | 0 | `batch2-4.log` |
| `apps/cli/src/commands/toolPins.test.ts` | 1 | 17 | 0 | `batch2-5.log` |
| `npx tsc -b tsconfig.json` | — | — | — | `batch2-6.log` |

Totals: batch 1 **79 passed / 1 pre-existing skipped**; batch 2 **139 passed**. Added **20 tests**; no existing assertions weakened and no skip declarations added. Command/exit/timing records: `batch1-results.json`, `batch2-results.json`.

## ReDoS reproduction

`node evidence/sessions/2026-10-31-codeql-seven/benchmark-redos.mjs` exited **0**. It extracts the exact trusted HEAD and working-tree functions/expressions, asserts matching results for the hostile inputs, and records seven per-call timings after three warmups. Numbers below are median milliseconds, not performance gates. Full series, source hashes, and measurement timestamp: `redos-measurements.json`.

| Alert / hostile input | Size | Before ms | After ms |
|---|---:|---:|---:|
| #18: slash run followed by `x` | 1,000 slashes | 0.6962 | 0.0006 |
| #18: slash run followed by `x` | 8,000 slashes | 29.9176 | 0.0002 |
| #19: repeated `ESC ]` | 1,000 starts | 1.1919 | 0.0114 |
| #19: repeated `ESC ]` | 8,000 starts | 92.9108 | 0.0955 |
| #20: repeated `core`, no import | 1,000 repeats | 2.9438 | 0.4911 |
| #20: repeated `core`, no import | 8,000 repeats | 172.5832 | 4.6804 |
| #21: numeric banner, no dots | 1,024 digits | 0.5355 | 0.0433 |
| #21: numeric banner, no dots | 8,192 digits | 30.8692 | 0.3405 |

The OSC hyperlink input separately reproduces the old output `''` and the fixed output `'link'`. Sub-microsecond provider measurements are timer-scale observations; the structural complexity argument is the backwards loop, not those small numbers.

## Full gate

`pwsh -NoProfile -File scripts/gate-batched.ps1`: **17/17 steps exit 0; overall exit 0**, after the last source/test edit. The unchanged required runner writes transient logs under `%TEMP%`; the complete final output is `gate-batched.log`, and all 17 step logs are copied into `gate-logs/`. Structured command, exit, counts, and timing evidence: `gate-results.json`.

| Final gate group | Steps | Exit | Results |
|---|---:|---:|---|
| Root batches | 12 | 0 each | 335 file executions; 3,746 passed, 8 existing skipped |
| Web root | 1 | 0 | 61 files; 543 passed |
| Build / test / Web TypeScript checks | 3 | 0 each | No diagnostics |
| Offline conformance | 1 | 0 | 25/25 passed, 0 failed, cost $0 |

Root figures sum the required runner's invocation summaries: its `root-index` substring filter also reruns `packages/memory/src/sqlite/sessionIndex.test.ts` (10 tests), already selected in runtime+memory. These are invocation totals, not a claim of distinct tests. No runner or selection rule was altered.

The first full attempt exited **1** with **16/17** steps green: `tsc-tests` found TS2345/TS2322 in the new reflection parameter table. Vitest execution had passed, but mixing inferred arrays with readonly spread tuples did not provide a stable callback tuple type. The repair explicitly types the table and mapped rows as `[string, boolean]`; no case, assertion, runtime implementation, timeout, or skip changed. Direct `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` then exited **0** (`repair-tsc-tests.log`), and the entire second focused batch was rerun successfully. The full final gate was restarted after that last test edit. First-attempt output and every step log are retained in `gate-attempt1.log` and `gate-attempt1-logs/`; original focused batch-2 evidence uses the `before-repair-` prefix.

Final source/test manifest SHA-256: `f710c6aace6796c00947c3904d57a70d0fc1286513fa1a32cd71efa81abcc953` (sorted path + NUL + per-file SHA-256 + LF entries; see `audit-scope.mjs`). Final scope audit and `git diff --check` passed. The card was appended without changing any original bytes or its status; the task index remains unchanged.

## Conditional dismiss comment draft

No new CodeQL finding has been observed because no fresh analysis has run. If a rescan flags `runShellCommand`'s new spawn, review that specific finding with this draft; do not dismiss other paths automatically:

> This is the single intentional shell execution boundary. `runShellCommand` accepts a complete command line and passes an empty argv array to spawn with literal `shell: true`. Argv callers use the separate `runCommand` spawn, which has no shell option and rejects shell mode. Sandbox shell mode rejects nonempty argv; benchmark run_check also explicitly supplies a complete command line. Shell interpretation is the documented behavior at this boundary, so removing it would change command semantics. This dismissal applies only to this deliberate shell sink, not to arbitrary caller input flows.

Self-check: the original gate thresholds and existing assertions are preserved; existing platform skips are reported, with no new skips introduced. **未放宽任何判据、未跳过任何用例**。
