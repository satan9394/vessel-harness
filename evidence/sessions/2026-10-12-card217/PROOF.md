# Card 217 — verified local delivery

Authority: VESSEL-ARCH-2026-01, P0 ARC-01–05. Baseline HEAD `520492d`; standard mode. Final code/test edits preceded every accepted gate. No commit, push, package publication, dependency change, external harness invocation, or Card 218 execution.

## Accepted evidence

Run with PowerShell 7: `& ./evidence/sessions/2026-10-12-card217/verify.ps1`.

| Ordered gate | Result | Evidence |
| --- | --- | --- |
| Directed positive/negative tests | 30 files, 330 passed | `01-directed.log` |
| Affected CLI regressions | 6 passed, 100 intentionally filtered | `01b-cli-regressions.log` |
| `npx tsc -b tsconfig.json` | exit 0 | `gates.json` |
| `npm run typecheck:tests` | exit 0 | `03-test-types.log` |
| `npm run test:all`, root | 276 files, 2937 passed, 6 skipped | `04-test-all.log` |
| `npm run test:all`, Web | 33 files, 282 passed | `04-test-all.log` |
| Core and npm scope audit | pass | `scope-audit.json`, `core-test-diff-stat.txt` |
| Independent source review | PASS including final repairs | `REVIEW.md` |

All five command stages have exit 0 and timestamps in `gates.json`; final full gate finished at `2026-10-13T02:40:50Z` (2026-10-12 local). The AST performance fixture, its 12 real edits, warmups and mean ≤15ms / peak ≤25ms thresholds were retained unchanged and passed in the final full suite. Earlier failed full-run evidence is preserved under `failed-full-run/`; interrupted earlier wrappers are not accepted evidence.

## Change summary and acceptance mapping

- ARC-01: shared SessionProjection/RequestEnvelope contracts, append-only compaction commits, projection replay/provenance, lease/revision checks, publication-failure containment, goal/constraint/denial/tool-pair conservation tests.
- ARC-02: unavailable or invalid mandatory policy references throw BehaviorCompileError; candidate compilation precedes session ownership and Mod activation. Invalid-policy fixtures explicitly prove compile rejection.
- ARC-03: application-owned Run/Turn lifecycle around unchanged core; cumulative model/tool/time/token/cost/error budgets, precommit gate, deterministic cancellation, checkpoints and incomplete-run recovery. Denied attempts consume the tool cap. Provider errors retain their original identity after a unique FAILED terminal, preserving CLI diagnostics and honest benchmark failures.
- ARC-04/05: host-issued immutable single-use permits bind canonical tool ID, arguments, subject, scopes, policy revision and expiry; validation precedes Mod callbacks and dispatch. Fsynced effect intents/outcomes prevent blind replay and block later writes after uncertain effects. Primary, isolated and Mod RPC paths use the journal; retry classification is restricted by effect safety.

Core implementation diff is **0 lines**. The user's explicit exception permits only minimal policy stubs in these tests:

```text
packages/core/src/agent-loop/AgentLoop.before-tool-gate.test.ts | 2 +-
packages/core/src/agent-loop/AgentLoop.denial-breaker.test.ts   | 2 +-
packages/core/src/agent-loop/AgentLoop.test.ts                  | 2 +-
3 files changed, 3 insertions(+), 3 deletions(-)
```

`package-lock.json` is unchanged; no foreign package-manager locks were added. Pre-existing HANDOFF/plans/other task-card edits were preserved.

## Material boundaries

Request hashes provide provenance, not plaintext exact-request replay. Permits are in-process capabilities; serialized JSON does not authorize execution. Unknown writes require explicit reconciliation. Recovery safely closes incomplete Runs rather than automatically resuming them. The S008 inert-sandbox counterexample proves policy discrimination, not real OS isolation; genuine sandbox tests remain in the full suite. P1/P2 and Card 218 are outside this delivery.

Task status and its index are updated; work stops here for maintainer acceptance.
