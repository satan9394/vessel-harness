# Task 231 implementation evidence

Implementation scope: `apps/web/` only. Existing unrelated workspace edits were
preserved. No commits, pushes, dependency changes, file deletions, external agent
invocations, or live provider requests were performed.

## Delivered

- 70 configurable presets copied from the application catalog; parity test checks
  IDs and all catalog metadata. The built-in mock remains outside the gallery.
- Searchable category gallery, synchronized preset form, selected model chips,
  manual IDs, removal, and default selection. The existing API persists the first
  model as the provider default (`apps/local-server/src/routes/providerRoutes.ts`).
- Shared grouped/searchable keyboard model picker in TaskComposer and the session
  header. Session changes use the existing switch API and busy/generation guards.
- Four onboarding cards pass the chosen preset through App into provider settings.
- Existing modal exports, IDs, button text, errors, confirmation flow, capability
  evidence, and composer IME/submission guards are retained.
- Chinese/English labels and responsive light/dark token-based styles.

## Validation

All commands run from the repository root. Build uses `--emptyOutDir false` to
preserve existing output, as required by the repository deletion discipline.

| Check | Result | Log |
| --- | --- | --- |
| `npx vitest run --root apps/web` | PASS: 47 files, 389 tests | `web-tests-final.log` |
| `npm run -w @vessel/web build -- --emptyOutDir false` | PASS, no warnings | `build-final.log` |
| `npm run typecheck:tests` | PASS | `typecheck-tests.log` |
| `npx tsc -b tsconfig.json` | PASS | `tsc-build.log` |
| `npm run -w @vessel/web typecheck` | PASS | `web-typecheck.log` |
| `npm run test:all` | FAIL: root 3,061 passed / 2 failed / 6 skipped; 287 passed files / 2 failed files | `test-all.log` |
| Isolated Windows runtime recheck | FAIL: same 2 failures, 21 passed | `windows-runtime-recheck.log` |
| `git diff --numstat -- packages/core` | Empty: 0 changed lines | Direct inspection |
| `git diff --check -- <Task 231 files>` | PASS | Direct inspection |

Component coverage includes gallery filtering/prefill, chip/default persistence,
manual model validation and IME, grouped keyboard navigation, outside dismissal,
settings handoff, onboarding preset selection, and selected model submission.
Existing modal/composer/session tests retain their previous assertions.

### Full-suite blockers outside the implementation scope

The root suite ran to completion in 479.14 seconds. Its failing exit prevents the
second (web) command in `test:all` from starting; the independent final web run
above passed all 389 tests. Both failures reproduced without a competing test
process in an isolated two-file recheck (5.04 seconds):

1. `packages/runtime/src/proxy/virtualProxy.test.ts:187`: descendant cleanup's
   `taskkillTree` rejects the Windows `taskkill` result during the timeout test.
   Windows stderr is garbled in the captured UTF-8 console output; the failing
   call and stack are retained in both logs.
2. `packages/runtime/src/sandbox/backend/process-tree.test.ts:350`: the real
   Windows timing-window test does not find the pre-spawned grandchild PID in
   `session.tree().nodes` (expected true, received false).

`git diff --numstat -- packages/core packages/runtime` is empty. Neither runtime
test nor its implementation was edited. Historical runtime records in `docs/`
were checked; those records do not establish a pass for this checkout/session.
These failures are reproducible here, so they are not dismissed as flaky or
reported as a green full-suite gate. Runtime diagnosis/repair is outside the
authorized `apps/web/` boundary.

## Review boundaries

Browser verification could not run: computer-use inventory returned no browsers;
creating an in-app tab returned `Browser is not available: iab`. No screenshots
or visual acceptance are claimed. Live connectivity and credentials were not
exercised. The status dot indicates membership in the configured catalog, not a
live connectivity probe. OAuth/environment presets display an explicit notice;
the existing API-key form does not implement those authentication flows.

This is the assigned implementation role. Independent reviewer acceptance and
task-card/index updates are left to the coordinator; the strict `apps/web/`
boundary excludes writing `tasks/` or top-level handoff documents.
