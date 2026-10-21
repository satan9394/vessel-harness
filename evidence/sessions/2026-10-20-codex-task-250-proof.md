# Task 250 verification

## Scope and result

F1/F2 product fixes and F3 response hardening are implemented locally. No dependency, core, UI, credential-store configuration, external-agent, commit, push or publish changes.

- Live activity maps `error`, `budget`, and legacy `failure` to failed outcomes; a newer unfinished turn overrides an older success. Existing terminal success, cancellation and interruption mappings remain covered.
- Indexed records without terminal evidence remain unknown. Supplied live/index error details reach the existing activity `detail` field.
- `test()` binds fallback credentials to the saved URL and protocol; `pullModels()` uses that same path. Explicit replacement keys can probe a new destination. Redirects remain rejected.
- Credential-bearing model IDs cause `invalid_models_response` before response projection or capability persistence.
- Task 249's original reproduction mode remains available. `--verify-250` asserts repaired F1/F2/F3 controls and exits before the unrelated F4/F5 probes; it does not claim those findings are fixed.

## Fresh gates after final product edits

| Command | Exit | Evidence |
|---|---|---|
| `npx tsc -b` | 0 | [build](2026-10-20-codex-task-250-build.log) |
| `npm run typecheck:tests` | 0 | [test types](2026-10-20-codex-task-250-types.log) |
| `npx vitest run apps/local-server/src/server.test.ts` | 0; 38 passed | [server](2026-10-20-codex-task-250-server.log) |
| `npx vitest run apps/local-server` | 0; 21 files, 182 passed | [local-server](2026-10-20-codex-task-250-local-server.log) |
| `npm run test:web` | 0; 51 files, 413 passed | [web](2026-10-20-codex-task-250-web.log) |
| `node evidence/sessions/2026-10-20-codex-adversarial-review-249-probes.mjs --verify-250` | 0; F1/F2/F3 PASS | [probes](2026-10-20-codex-task-250-probes.log) |
| `npm run test:all` | 1; root 288 files passed / 2 failed; 3057 passed / 2 failed / 6 skipped; 468.10s; chained web skipped | [root suite](2026-10-20-codex-task-250-test.log) |
| `git diff --check` | 0 | No whitespace errors |

Regression cases cover all six terminal kinds, stale success followed by unfinished work, unknown indexed/live sessions with error details, both provider protocols, both probe methods, name/id lookup, empty/omitted keys, spoofed URL/protocol, explicit replacement keys, and reflected secret substrings.

## Thin-core baseline discrepancy

`git diff HEAD --stat -- packages/core` is empty ([output](2026-10-20-codex-task-250-core-head.log)): Task 250 has zero core changes.

The requested `git diff origin/main --stat -- packages/core` is **not empty** ([output](2026-10-20-codex-task-250-core-origin.log)): eight previously committed files, 415 insertions / 6 deletions. The working tree was core-clean before implementation. Restoring those historical commits is outside this task and would violate its no-core-edit boundary; no attempt was made to erase that evidence.

## Remaining gate limitations

The root run reports the same process-tree enumeration (`process-tree.test.ts:350`, missing grandchild) and proxy timeout descendant-cleanup (`virtualProxy.test.ts:187`, taskkill access denied) failures recorded by [Task 249](2026-10-20-codex-adversarial-review-249.md). Those tests and production paths are unchanged. This is a known recurrence, not a claim that containment failures are harmless. The full repository gate is not green. Web was run separately and passed. Compared with Task 249, the root pass count increased by the ten new Task 250 tests, with the same two failures and six skips.

Probes use synthetic credentials and stubbed fetch; no real secret or upstream provider was used. Deterministic tests provide the evaluator evidence for these controls; no independent agent review or CLI relay was invoked.
