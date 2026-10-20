# Task 230 implementation evidence

Implementation is ready for independent review; full task acceptance is not claimed.
All task edits and evidence stay within apps/web/. No commits, publication, external agent calls, or permanent deletion.
The existing task card and index outside apps/web/ were left to the coordinator.

## Changes
- Sidebar: workspace/date/topic hierarchy, Yesterday localization, inline accessible rename/archive/restore icons, search capsule, active rail, spacing in place of group borders.
- TaskComposer: concentric surface with three elevation states, capsule selects and send press feedback. Existing pre-render logic and textarea handlers match the saved baseline after newline normalization.
- CSS: replaced legacy panel2 references, including the remaining dashboard.css caller so removing the alias does not change dashboard backgrounds. Existing reduced-motion handling remains in effect.
- Six new Sidebar tests cover boundaries, topic continuity/latest activity, invalid dates, rendered workspace/period hierarchy, and query/archive filtering. Existing IME/submission tests pass.

## Final requested gates
All were run after the final source edit (dashboard token replacement):
- npx tsc -b: exit 0 (tsc-build.log; no diagnostics).
- npm run typecheck:tests: exit 0 (typecheck-tests.log).
- npm run -w @vessel/web typecheck: exit 0 (web-typecheck.log; additional check).
- npm run -w @vessel/web test: exit 0, 43 files / 371 tests (web-test.log).
- npm run -w @vessel/web build -- --emptyOutDir false: exit 0, no warnings (web-build.log). The extra flag preserves existing output files under the deletion discipline.
- packages/core: zero-line Git diff; git diff --check: no whitespace errors. See scope-check.txt.

## Additional full-suite result
npm run test:all exited 1 after 447.34s: root 287 files passed / 2 failed; 3061 tests passed / 2 failed / 6 skipped. The chained web leg did not run because root failed; the separate final web gate passed above.
This additional suite started before the final dashboard-only token edit. See test-all.log for exact output.
- packages/runtime/src/sandbox/backend/process-tree.test.ts:350: pre-spawned grandchild was absent from tree.nodes.
- packages/runtime/src/proxy/virtualProxy.test.ts:187: taskkill cleanup rejected with an access-denied error.
These files were not changed. Their root cause was not established or repaired under the apps/web-only contract. Existing docs were checked; historical records were not treated as proof that current failures are harmless.

## Review limits
The browser inventory exposed no browser; built-in browser selection returned unavailable. No live screenshots, hover/focus layout checks, or browser interaction acceptance are claimed. Independent reviewer acceptance remains pending.

## Files
implementation.diff compares these task edits against pre-edit snapshots, including the new test file. source-sha256.json records final source hashes. before-* files retain recoverable snapshots of existing content.

The first web run caught a missing Chinese Yesterday entry and a mismatched accessible-label expectation in the new test. Both were corrected before the final successful gates.
