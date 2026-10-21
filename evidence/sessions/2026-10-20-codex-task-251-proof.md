# Task 251 verification

## Changes

- Compaction collects all metadata.keepID/keepId/keepIds aliases, preserves anchored content verbatim with summary IDs, retains tail metadata/id, and supplies requiredKeepIds to the conservation guard.
- Conservation rejects missing IDs and IDs detached from their original anchor content with keep_id_lost. Multiple original anchors sharing an ID must all survive.
- Summary metadata is stored in projectionCommit and restored on replay. This requires the small packages/shared/src/projection.ts change; packages/core is untouched.
- IME Enter calls preventDefault and stopPropagation for composition-ref, native composition, and keyCode 229 signals.
- Tests cover user/assistant/attempt/tool tails, aliases, duplicate/invalid ID values, disk reload, repeated compaction, detached/missing content, individual IME signals, normal Enter and non-Enter keys.

## Final requested gates

| Command | Result | Log |
| --- | --- | --- |
| `npx tsc -b` | exit 0 | [build](2026-10-20-task-251-build.log) |
| `npm run typecheck:tests` | exit 0 | [test types](2026-10-20-task-251-test-types.log) |
| `npx vitest run packages/context` | exit 0; 13 files, 113 tests | [context](2026-10-20-task-251-context.log) |
| `npm run test:web` | exit 0; 51 files, 418 tests | [web](2026-10-20-task-251-web.log) |
| `node evidence/sessions/2026-10-20-codex-adversarial-review-249-probes.mjs --verify-251` | exit 0; label-only anchor rejected and production keep-0 metadata/content preserved | [probes](2026-10-20-task-251-probes.log) |
| `git diff HEAD --stat -- packages/core` | stdout empty; Task 251 has zero core changes | [HEAD diff](2026-10-20-task-251-core-head.log); see baseline note below |
| `git diff --check` | exit 0 | no whitespace errors |

All requested build/type/context/web/probe gates above ran after the final product/test edit.

## Independent review

Host-native independent reviewer inspected the Task 251 diff read-only. No blocking bugs found. Its initial request for final repeated-compaction assertions and assistant/attempt tail coverage was addressed; final re-review returned no findings. No local OC/AGY/CC/DSH/Codex CLI agent was launched. This was direct implementation with native review, not a PDW CLI relay.

## Boundaries

- `git diff origin/main --stat -- packages/core` is nonempty from historical local-only development: 8 files, +415/-6. `git diff HEAD --stat -- packages/core` is empty. The origin/main zero-change requirement cannot describe the existing checkout; historical work was preserved.
- Anchor content is intentionally kept verbatim, so strongly anchored histories may compact less. No real provider calls or credentials used in probes.
- IME verification uses the existing React hook test harness and models the browser default action; no real browser/OS IME session was exercised.
- Broader `npm run test:all` exited 1: root 289 files passed / 2 failed; 3064 tests passed / 2 failed / 6 skipped. It began before the final test-coverage addition; it is not claimed as a final full green gate. The `&&` chain did not reach Web; the final independent Web gate above passed. See [full-suite log](2026-10-20-task-251-all.log).
- Both failures reproduced in an isolated rerun (21 passed / 2 failed): process-tree.test.ts:350 cannot enumerate the pre-spawned grandchild; virtualProxy.test.ts:187 fails with taskkill access denied. See [runtime recheck](2026-10-20-task-251-runtime-recheck.log). These files were not changed. Their full root-cause diagnosis is outside Task 251; docs/CC-SWITCH-IMPROVEMENTS-PROGRESS.md:49 also records historical process-tree timing instability, but the current isolated failures were not assumed to be the same cause.
