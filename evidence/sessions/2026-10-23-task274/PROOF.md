# Task 274 — ARCH-09 implementation evidence

Conclusion: offline implementation delivered; coordinator acceptance pending.
Baseline/final HEAD: `1f14f6428b9e29adac25b7a872ed241b8c9e9537`, branch `main`.
This verifies the dirty local worktree, not a clean committed SHA. No commit or push.

## Change and rationale

`benchmarks/runners/src/reliability.ts` binds 14 pre-existing test fixtures to exact
file/title pairs, runs only those cases through the existing Vitest configuration,
and creates a new evidence directory for each invocation. Existing assertions and
scenario criteria are unchanged. It reuses mock/scripted providers, real local
crash workers, injected production adapter seams and isolated HTTP tests.

`reliability.test.ts` checks the evidence gate, including missing categories despite
sufficient counts, absent/duplicate/wrong-source assertions, skipped/pending/failed
results, empty/duplicate catalogues, and argument refusal before dispatch.
`package.json` adds `bench:reliability`; `docs/BENCHMARK-SPEC.md` documents the
coverage mapping, YAML audit, reproduction and limits. Card/index track handoff.

Before: existing tests and 25 YAML scenarios had no unified ARCH-09 evidence loop.
After: one offline command records SHA, Node/npm, UTC timestamps, platform/arch,
dirty status, diff/source hashes, seven-category coverage and per-fixture evidence.
Missing successful category coverage prints `缺少类别 X`. Any skipped/missing/
ambiguous assertion, runner error, source drift or failed fixture returns 1.
All selected fixtures passing with seven categories returns 0.

## Verification

After the final source edit:

| Check | Result | Evidence |
|---|---|---|
| `npx tsc -b --pretty false` | exit 0 | [tsc.log](tsc.log) |
| `npm run typecheck:tests` | exit 0 | [typecheck-tests.log](typecheck-tests.log) |
| `npx vitest run benchmarks/runners/src/reliability.test.ts` | 8 passed, exit 0 | [runner-tests.log](runner-tests.log) |
| `npm run bench:reliability`, run A | 14/14, exit 0 | [manifest A](../task274-reliability-2026-10-23T15-33-27-480Z-a7c2d951/manifest.json) |
| `npm run bench:reliability`, run B | 14/14, exit 0 | [manifest B](../task274-reliability-2026-10-23T15-33-46-663Z-2f620842/manifest.json) |
| Repeat comparison | Same outcomes, coverage, HEAD and source hashes | [repeat-comparison.json](repeat-comparison.json) |
| `npm run bench:reliability -- --live` | rejected before dispatch, exit 1 | [live-refusal.log](live-refusal.log) |
| `git diff --check` | exit 0 | no whitespace errors |
| Protected diff | No changes in `packages/core`, existing scenarios or lockfile | `git diff --name-only -- packages/core benchmarks/scenarios package-lock.json` empty |

[gates.json](gates.json) records build/typecheck/unit exit codes. Each manifest links
R01–R14 assertion JSON; sibling `vitest.json` and `process.log` retain raw results.
The earlier `15-31-28` run predates the final runner edit and is historical only.
Node `v24.14.0`, npm `11.9.0`, Windows x64. No dependency installation.

## Limits, compatibility and rollback

No product behavior/API changes. No real providers or external agent CLI invoked.
`--live` is deliberately unsupported here, even when explicitly supplied; a future
live experiment needs separate authorization and a separately identified runner.
The unavailable adapter check exercises the production Codex adapter with injected
environment/command results, not live availability of the installed CLI. Soft-delete
tests use injected recycling, not an actual OS recycle-bin acceptance run. Replay
coverage is projection idempotence, not every SSE or persisted replay path.

`npm run test:all` was deliberately not run per the execution contract. Independent
review and full-suite acceptance belong to the coordinator; this report does not
claim `accepted_local` or close those gates. The coordinator can rerun the command
and follow the two manifests and source mapping without reconstructing chat.

Rollback is local: revert this task's benchmark script/docs/index/card edits and
recycle the two newly added runner files if desired; preserve evidence and unrelated
existing logs/prompts. No migration, config change, publication or state cleanup.
