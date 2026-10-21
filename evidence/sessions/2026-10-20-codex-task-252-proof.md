# Task 252 verification evidence

Executed locally on 2026-10-21. No commit, push, publication, dependency changes, or external harness invocation.

## Implementation and safety boundary

- EffectJournal scans JSONL at byte offsets. A malformed unterminated final record is truncated at its start, with the preceding bytes unchanged and the repair fsynced. Valid unterminated records receive a newline before appending.
- Malformed newline-terminated records still throw without altering the file. This deliberately distinguishes torn append recovery from corruption of completed history. Schema validation is unchanged.
- Pending durable effects retain their replay prohibition. Recovery tests exercise a multibyte valid prefix, an entirely torn file, subsequent writes/reloads, missing terminal newline, and completed-line corruption.
- The composition try/catch encloses all assembly after Session.open(), awaits best-effort session.close(), then rethrows the original error. Tests cover synchronous invalid pruning options and asynchronous missing-Mod failures, followed by Session.open() and successful composition of the same session.
- The large textual compose.ts diff is indentation of the protected assembly block; `git diff --ignore-space-change -- packages/application/src/compose.ts` shows only the try/catch addition.
- No public API or configuration behavior changes beyond recovery; no README or architecture update required.

## Gates

| Command | Result | Log |
|---|---|---|
| `git diff HEAD --stat -- packages/core` | Empty: zero Task 252 core changes | Rechecked after implementation |
| `git diff origin/main --stat -- packages/core` | Existing baseline: 8 files, +415/-6; not changed by this task | See scope qualification below |
| `git diff --check` | exit 0 | Rechecked after implementation |
| `npx tsc -b` | exit 0 | [tsc](2026-10-21-task252-tsc.log) |
| `npm run typecheck:tests` | exit 0 | [final test types](2026-10-21-task252-test-types-final.log) |
| `npx vitest run packages/runtime` | exit 1: 140 passed, 1 skipped, 2 failed | [runtime](2026-10-21-task252-runtime.log) |
| Isolated retry of the two failing runtime files | exit 1: 21 passed, same 2 failed | [isolated retry](2026-10-21-task252-runtime-isolated.log) |
| `npx vitest run packages/application` | exit 0: 242 passed, 2 skipped | [application](2026-10-21-task252-application.log) |
| `npm run test:web` | exit 0: 418 passed | [web](2026-10-21-task252-web.log) |
| `node evidence/sessions/2026-10-20-codex-adversarial-review-249-probes.mjs --verify-252` | exit 0: F5 controls PASS using built packages | [probes](2026-10-21-task252-probes.log) |
| `npm run test:all` | exit 1: root 3068 passed, 6 skipped, same 2 runtime failures; web leg not reached because of `&&` (418-test web run above passed separately) | [full suite](2026-10-21-task252-all.log) |

Focused regression run: EffectJournal.test.ts plus composeActivation.test.ts, 8/8 passed. Initial test typecheck caught an incomplete pruning-options fixture; the fixture was corrected and both build and test typecheck rerun successfully. The failed initial log is retained as [test types initial](2026-10-21-task252-test-types.log).

## Runtime gate failures and scope qualification

The runtime command and its isolated retry both fail in unchanged Windows process-tree tests:

1. `virtualProxy.test.ts`: taskkill descendant cleanup returns access denied.
2. `sandbox/backend/process-tree.test.ts`: the real Windows pre-spawned grandchild is absent from the enumerated tree.

These failures are outside the changed journal/composition code. `docs/CC-SWITCH-IMPROVEMENTS-PROGRESS.md` already records process-tree timing instability; that historical record does not prove this run's enumeration failure has the same cause. This restricted session cannot elevate its permissions. No assertions were weakened and no tests were skipped to manufacture green gates. Runtime/full acceptance remains incomplete.

The origin/main core diff predates this task (the initial working tree had no product modifications); the authoritative Task 252 comparison against HEAD is empty. Existing task launcher/prompt/log files were preserved.

## Independent review

A separate read-only reviewer inspected the diff and acceptance criteria and reported PASS with no blocking defect. It confirmed the byte-prefix preservation, fsync repair, append separation, fail-closed completed-line corruption, and full post-open lease rollback coverage. It did not rerun tests. Existing JSON schema validation and cleanup of resources other than the session lease remain outside this fix.
