# Epic 199 delivery checkpoint — BLOCKED, not final acceptance

2026-10-08. The user approved Card197 performance DoD **meanMs <=10ms and peak <=25ms**, replacing the former <=15ms criterion. `APPROVED-DOD.md` and `approved-dod-evaluation.json` retain the decision and the original samples. Limits are unchanged thereafter.

## Actual gate results

| Command / check | Result | Evidence |
|---|---|---|
| `npm run test:all` | **exit 1**; root 256 files pass / 2 fail; **2777 passed, 6 skipped, 2 failed**; Web not reached by this command | `final-test-all.log`, `final-test-all-result.json` |
| `npx tsc -b tsconfig.json` | **exit 0**, after final repair rollback | `final-build.log` |
| `npm run typecheck:tests` | **exit 0**, after final repair rollback | `final-test-types.log` |
| `npm run test:web` | **177/177 passed**, 20 files, exit 0 | `final-web-tests.log` |
| `npm run -w @vessel/web build -- --emptyOutDir false` | **exit 0** | `final-web-build.log` |
| Boundary check | **core changes 0; baseline files missing 0**, exit 0 | `final-boundaries.log` |

The failed full root run recorded Card197 mean **11.543ms >10ms**, peak **21.083ms <=25ms**, and SQLite 1000-row median **7.048ms >5ms**. These are genuine failures; earlier isolated passes do not replace them.

## Integrated functional evidence

`v23Integration.test.ts` scoped final-source run passes. Trusted evaluator obtains actual **Red exit 1**, target assertion `TARGET_ADDITION_BUG`, then the Generator's registered composed `Edit` tool repairs subtraction to addition. Two completion attempts are denied and audited before independent Green. Reproduction and separate regression subprocesses then exit **0**, and ordinary loop completion succeeds. Captured SHA-256 proof validates independently.

The same composed fixture verifies the sole exact alias caller edge and actual context assembly. Pruning reduces **60,019 ->10,468 estimated tokens (82.56%)**, preserving static/scoped prefix bytes, task text, active source and recent three groups. See `card199-e2e.md`, `card199-e2e.log`, `card199-evaluator-proof.json`, and `completion-audit.json`. The provider is deterministic; this proves the composed mechanism, not real-model coding ability.

## Bounded repair disposition

- SQLite compact positional JSON transfer preserves page bounds/order, fresh reads, nested metadata independence, REAL precision and native unsafe INTEGER rejection. Existing session/FTS tests **13/13 pass** with unchanged <5ms/<10ms assertions (`repair-sqlite-session-index.log`). This blocker repair remains in source; whole-root acceptance after it is not proven.
- The graph compiler-host/cache candidate passes 18 semantic assertions but fails the new timing gate: mean **59.570ms**, peak **106.043ms** (`gate197-repair-scoped.log`, all samples retained). It was **reverted**, without a benchmark retry or criterion change. The earlier precise descriptor/import mapping cache remains; one add/remove/re-add semantic regression remains.
- Independent reviews: `review199.md` covers integrated evaluator separation, references and pruning; `review-final-repairs.md` confirms SQLite semantics and absence of the failed graph candidate. Earlier original findings and repaired-pruning probes remain in `review196197.md`, `review198*.md`. No blanket security-audit PASS is claimed.

## State and next action

Cards196/198 are delivered; Card197 and Epic199 are blocked by the latest root performance prerequisite. All workers and gate processes are terminal. HANDOFF and `.agent-state/run-state.json` point here. Completion audit explicitly records `epicComplete: false`.

Further performance repair needs renewed explicit authorization under personal-dev-workflow's repeated-failure rule. Keep mean <=10ms / peak <=25ms and SQLite <5ms unchanged. After a successful repair, rerun full dual-root tests and all requested final gates after the last source edit before closing Epic199.

Local only: no commits, push, publication, external harness execution, resident LSP, or repository deletion. Test fixture cleanup stays in owned `os.tmpdir()` roots. Prior failures and dependency backups remain intact; final npm ci was already verified in `final-npm-ci.log`. The existing source-map-js advisory remains deferred.
