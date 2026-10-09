# Epic 199 — V2.3 final local delivery: PASS

Accepted 2026-10-08 (America/Los_Angeles). Cards 196–199 are completed under the user's latest approved Card 197 DoD: **meanMs <=15ms, peak <=25ms**, retaining full recursive references and type-driven refresh. No production graph changes accompany this final approval.

## Final gates after the last source/test edit

| Gate | Actual result | Evidence |
|---|---|---|
| Scoped graph/tool tests | **16/16 passed**: all 12 graph tests plus 4 tool tests | `accepted15-scoped.log` |
| Standalone graph proof | **12/12 real edits**, precision **100%**, mean **10.767ms**, peak **21.405ms**, exit 0 | `accepted15-performance.log` |
| `npm run test:all` | **exit 0**, root 258 files / **2780 passed + 6 skipped**; Web 20 files / **177 passed** | `accepted15-test-all.log` |
| `npx tsc -b tsconfig.json` | **exit 0** | `accepted15-build.log` |
| `npm run typecheck:tests` | **exit 0** | `accepted15-test-types.log` |
| `npm run test:web` | **177/177 passed**, exit 0 | `accepted15-web-tests.log` |
| `npm run -w @vessel/web build -- --emptyOutDir false` | **exit 0** | `accepted15-web-build.log` |
| Boundary audit | **core changes 0; baseline files missing 0**, exit 0 | `accepted15-boundaries.log` |

Both roots total **2957 passed / 6 skipped**. Gates ran sequentially with the repository's existing configuration; no retries, forced GC, outlier filtering or fixture simplification. The SQLite page performance assertions remain unchanged and pass in the final full root. `accepted15-final-gates.json` records commands, real exit codes and UTC timestamps; its timestamps fall on October 9 UTC / October 8 local time.

## Delivered behavior and integrated evidence

- **196:** Policy-enforced completion deny until trusted subprocess Red, independent Green and regression. The captured composed fixture has actual **Red exit1**, `TARGET_ADDITION_BUG` (-1 !==5), **Green0 / regression0** and two audited completion denies. SHA-256 independently validates. Evidence: `card199-evaluator-proof.json`, `card199-e2e.md`, `card199-e2e.log`.
- **197:** Exact symbol graph and guarded tool preserve recursion, import/reexport identity, type-driven refresh, shadowing and reverse dependency traversal. Cached unchanged reference descriptors avoid full downstream AST rescans. All 12 graph tests and four tool tests pass. All 12 standalone timing samples remain in the raw log.
- **198:** Actual ContextBuilder assembly reduces **60019 ->10468 estimated tokens (82.56%)**, preserving static/scoped prefix bytes, task, active source and recent three groups. Diff/error/pending interactions and required order remain protected.
- **199:** The actual composed deterministic Generator queries the graph and repairs a subtraction defect through the registered Edit tool, while an independent evaluator controls completion. The final full root includes this integration test.

`completion-audit.json` records **epicComplete:true**, final source hashes, signed-proof validation, raw performance samples and all successful gates. Reproduce with `accepted15-final-gates.ps1`, then `check-boundaries.mjs` and `accepted15-audit.mjs`. Independent findings and repair dispositions remain in `review196197.md`, `review198*.md`, `review199.md`, `review-final-repairs.md`.

## History, boundaries and limits

`PROOF-before15.md` and `completion-audit-before15.json` preserve the preceding blocked checkpoint. All old failed logs and rejected host/cache candidate measurements remain unchanged. Those logs concern previous criteria or rejected source; they do not replace this final-source full regression. `APPROVED-DOD.md` records both approvals and the latest decision. The user-provided14.24/19.39ms decision input is distinct from this run's actual measurements.

Local only: no commit, push, publication, external harness execution, resident LSP or repository deletion. `packages/core` has zero changed files relative to the V2.2 baseline. Dependency backups remain preserved; prior npm ci passed. Existing source-map-js advisory remains deferred.

Scope limits: evaluator Red admission supports one complete uncaught Node assertion and fails closed for ambiguous/mixed reports; graph uses an explicit TS/JS file set and path mappings, without external-library discovery or dynamic-import inference. The deterministic end-to-end fixture proves composed mechanisms, not real-model coding capability. This is local mechanical acceptance, not a platform-matrix or broad security-audit claim.
