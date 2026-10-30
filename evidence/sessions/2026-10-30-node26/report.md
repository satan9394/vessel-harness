# Card 367 — Node 26.13.0 compatibility

Execution: Codex desktop main thread, no subagents, no external agents, no commit/push.
Environment verified: `node --version` = `v26.13.0`; initial worktree clean.
Scope: assertion diagnostic format, explicit subagent resource cleanup, deletion-test fixture identity. No runtime/dependency/configuration migration.

## Before edits: real Red subprocess

`node evidence/sessions/2026-10-30-node26/probe.cjs` spawns the exact `repro.cjs` / `value.cjs` fixture used by `packages/policy/tests/redGreenGate.test.ts`. Exit 1, empty stdout. Raw bytes: `red-stderr.raw.log`, `red-stdout.raw.log`; measured results: `probe.json`.

| Existing predicate | Node 26 observation | Result |
| --- | --- | --- |
| `^node:assert[:/]` | First line `node:internal/assert/utils:146` | FAIL: internal assertion implementation moved |
| terminal `Node.js vX.Y.Z` | Last line `Node.js v26.13.0` | PASS |
| one AssertionError header | exactly one `AssertionError [ERR_ASSERTION]: TARGET_BUG` | PASS |
| no other Error header | none | PASS |
| every configured baseline reason | `TARGET_BUG` present | PASS |

Planned change: add only the observed `node:internal/assert/utils:<line>` diagnostic header, leaving all other checks intact. No arbitrary `node:internal` prefix, warning stripping, exit-only acceptance or runner-output fallback.

## Before edits: FileHandle

`node node_modules/vitest/vitest.mjs run packages/skills packages/agents` reproduced 23 files / 194 passed, one unhandled `ERR_INVALID_STATE` FileHandle GC closure (`before-skills-agents.log`). `SubagentManager.delegate()` owns a runtime but closes it only at the successful return. The ThrowingProvider case in `team-runtime.test.ts` makes `AgentLoop.runTurn()` throw; the catch returns an error result without closing the child's `session.jsonl`. The subsequently reported last test is GC timing, not the origin.

This is a pre-existing product resource-lifecycle defect exposed by Node 26's stricter GC behavior. The user's explicit requirement to close exceptional paths covers resource cleanup; no product result, event vocabulary, retry or error policy will be changed. Any additional semantic defect will be registered rather than repaired under this patch.

## Before edits: deletion fixture

Native probe (`probe.json`): directory symlink creation returns EPERM on this Windows account; junction creation succeeds, lstat says symbolic link=true / directory=false, realpath resolves to outside. Thus the real junction guard still rejects the link.

The Windows mocked directory-symlink test instead replaces `Stats.prototype.isSymbolicLink()` using only a Number inode match. Native inode values exceed Number.MAX_SAFE_INTEGER (the probe's trash inode rounds 16888498603445287 to 16888498603445288). The initial focused run happened to pass that fixture; the previous full-run failure reports the root as linked, consistent with a fixture identity collision. Further deterministic measurement will precede its edit. Production link guards will remain untouched.

Follow-up real ancestor probe confirmed the collision before editing the fixture (`inode-ancestors.json`): root bigint inode `29554872555433107`, entry bigint inode `29554872555433108`, both Number `29554872555433108` (iteration 43). An earlier 50-pair sample did not collide (`inode-collisions.json`). Only the fixture's lstat return for the exact entry path now gets a synthetic link predicate. Exact `Linked path refused: <entry>` and all disk/listing immutability assertions remain. The real junction test remains unchanged. No production deletion code changed.

The new deterministic FileHandle test intercepted real `fs.promises.open()` handles and observed fd=4 after the exceptional delegation had returned (`before-handle-regression.log`), instead of fd=-1. That first regression run also exposed a malformed success-provider test double (missing ChatResponse fields); `type-probe.log` records TS2322. Corrected the test double to use the existing MockProvider rather than weakening types. Production cleanup is an inner try/finally around the owned runtime, within the existing result/error catch; outer active-child accounting and error-result semantics stay intact.

## Verification

Initial focused policy/trash run: exit 1, 3 failed / 14 passed / 1 skipped (`before-policy-trash.log`).

| Finding | Root cause | Changed locations | Local result |
| --- | --- | --- | --- |
| Red phase | Node 26 emits `node:internal/assert/utils:<line>` instead of the old assertion throw-site prefix | `packages/policy/src/gates/redGreenGate.ts:40`, `packages/policy/tests/redGreenGate.test.ts:33` | Exact new header supported; all other attribution predicates unchanged |
| FileHandle GC exception | SubagentManager success-only close leaked the session handle when runTurn threw | `packages/agents/src/subagent/SubagentManager.ts:299`, `packages/agents/src/subagent/subagent.test.ts:66` | Owned runtime closes in finally, before existing error-result catch; real handles fd=-1 and leases absent after both paths |
| Windows mocked link fixture | Number inode collision caused the global Stats prototype mock to label an ancestor as linked | `packages/application/src/deletion/trash.escape.test.ts:67` | Mock only the exact entry path; exact rejection reason and no-mutation checks preserved; production guard untouched |

Commands after final source edit:

- `node node_modules/vitest/vitest.mjs run packages/policy packages/application packages/skills packages/agents`: **exit 0; 71 files, 691 passed + 3 skipped**, no unhandled error (`focused.log`).
- Earlier targeted three-file check: **exit 0; 3 files, 43 passed + 1 skipped** (`targeted.log`); test typecheck exit 0 (`type-targeted.log`). Final full script reruns all typechecks after the final source formatting edit.
- `pwsh -NoProfile -File scripts/gate-batched.ps1`: **17/17 exit 0**; root **335 files / 3,725 passed + 8 skipped**, web **61 files / 543 passed**. All three tsc steps exit 0. Offline conformance **25/25, $0**. Root adds 12 tests (10 diagnostic-format cases + 2 handle-lifecycle cases); baseline counts did not fall. Summary: `full-gate.log`; all 17 original per-step logs copied byte-for-byte to `full-gate-logs/`; machine-readable totals: `verification.json`. Original logs: `%TEMP%/vessel-gate-f4f6e2f3`.
- `git diff --check`: exit 0.

`source-hashes.json` identifies the five changed code/test files. `scope-audit.json` confirms their bytes stayed fixed during final verification, no diff to protected manifests/configuration/CI/Web/gate script, no `.nvmrc`, and no NODE_OPTIONS override. Card status and board are left for the coordinator. Independent review was not run: the execution handoff explicitly requires main thread / no subagents. This report is execution evidence, not independent acceptance.

Built-in browser: opened this local report at `http://127.0.0.1:59873/report.md` and read it through the browser accessibility surface. This checks the delivered report only; it is not substituted for Node subprocess or filesystem evidence. The temporary localhost preview listener is closed after review.

## Counterexamples and defense checks

- Existing `rejects false positives and missing full regression configuration`: target assertion does not fail (exit 0) → Red refused.
- Existing `rejects mixed real test failures and ambiguous reports even when a target assertion is present`: mixed target/setup failures and incomplete fake AssertionError text → refused.
- Added `keeps uncaught assertion classification strict: ...`: old and measured Node 26 headers accepted; unknown internal header, missing line number, two assertions, unrelated TypeError, missing target reason, absent version tail, trailing diagnostic, and stdout contamination → refused.
- Existing tests reject changed Red baseline, missing source repair, edited evaluator tests, command identity changes, forged public signatures, failed full suite, unrelated nonzero exit, spawn error, shell syntax, timeout, and cross-evaluator proofs.
- Deletion: unchanged real junction-to-outside case and exact mocked-directory-link rejection; traversal, linked restore parent, missing metadata, expired/forged metadata and no outside-disk mutation remain tested. Native directory symlink creation was EPERM, explicitly recorded rather than presented as a successful native-dir test.
- Resource lifetime: success and provider failure close the real FileHandle and release lease without deleting the log. Existing abort, depth/concurrency denial and provider failure/team fail-fast cases remain in the focused run.

No new product-result or deletion-policy semantics were introduced. The FileHandle item is a real pre-existing product resource leak (the cleanup is explicitly requested in this card), not merely a diagnostic-format change. No additional confirmed product defect was repaired.

未放宽任何门禁判据。
