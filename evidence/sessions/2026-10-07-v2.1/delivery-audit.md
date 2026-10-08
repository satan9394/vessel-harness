# V2.1 Epic 191 delivery audit — functional acceptance closed 2026-10-08

Current result: **PASS for the human-approved functional DoD**. The human explicitly replaced original <25ms with fixture50 warm <=50ms and exact-semantics repository <=2000 files cold <=1500ms / warm p95 <=1000ms. Final benchmark passes (fixture warm max42.5767ms;1739 files cold905.8525ms / p95673.4129ms); all five accepted gates exit0,2811 passed/6 skipped. Final source/closure review confirms earlier concrete findings resolved. `final-delivery-proof.md` is the current proof; open/blocked statements below are historical. Historical generated-dist deletion deviation remains disclosed, not waived or erased. No commit/push/publish.

Scope: attachment `32d4187a-2be9-4265-8378-6e38fa6e993e/pasted-text-1.txt`, cards 188–191, local main. This report records the whole requested scope; it does not redefine completion around passing subsets. The frozen run below is historical; subsequent authorized repairs stopped before the renewed gate run. No commit, push, publish, or real host-agent execution occurred in this mission.

## Implementation and requirement evidence

| Requirement | Current evidence | Result |
|---|---|---|
| canonicalJson / stableStringify; deterministic request and tool serialization | llm canonical implementation, provider request boundaries; phase188 architecture repair tests, independent review and frozen regression | Implemented; its regression tests passed |
| TripartitePrefixBuilder; stable SHA-256, scoped snapshots, volatile suffix | context builder and main/isolated runtime wiring; phase188 regression and independent review | Implemented |
| Compaction only at intent boundary, no active pending tool calls | context boundary guard; occurrence/turn accounting shared by wire projection and balanced compaction cut | 72 targeted tests passed; independent lifecycle revalidation cleared |
| CacheUsageMetrics extraction for Anthropic/OpenAI/DeepSeek | shared pure extractor, llm stream metadata preservation/decorator, actual provider/model identities | 172 repair root tests and 16 Web tests passed; reviewed |
| CacheDriftDetector and durable usage projection | llm detector; application records model/usage and audit/cache_drift with prefix hashes | Implemented and covered by repair tests |
| CLI cache view and Web usage/message badges | usage --cache, persisted measured denominator, server-priced per-call SSE and Web renderers | Implemented; prior cost/resumed-session/identity findings repaired |
| Unknown cache tariffs preserve conservative cost and estimated status | shared helpers, projection, UsageStore/recompute; explicit zero remains exact | Repair tests passed; reviewed |
| Workspace fingerprint content/mtime and diff bytes, ignore rules | tools filesystem implementation and production guard; binary Git patch plus raw untracked bytes, symlink confinement | Correctness tests passed |
| Fingerprint compute strictly <25ms | phase190-benchmark-final.log measures the whole call | FAILED: 50-file fixture warm median 38.6ms; repository warm median 1285.1ms |
| Default three stagnant executed steps / repeated errors; durable stop without retry | tools breaker, engine facade and result handling, parent/isolated guard | Targeted and production integration tests passed |
| Interrupt safety, late signal-blind tools, interrupted batches and reused IDs | generation fences and matched-turn/attempt-scoped reconciliation; DENIED results retain existing security-breaker precedence | 72 targeted tests passed; independent revalidation cleared |
| Zero packages/core modifications | git diff restricted to core produces no paths | Preserved |
| Local only; npm lockfile only; no third-party dependency added | package-lock workspace dependency synchronization; fresh npm ci exit 0 | Preserved; previous node_modules retained in ignored .tmp backup |
| No permanent repository deletion | task189 executor ran three default Vite builds that cleared generated dist | VIOLATED and disclosed; subsequent builds disable emptyOutDir |

## Earlier frozen mechanical gates (historical)

| Command | Evidence | Result |
|---|---|---|
| npx tsc -b tsconfig.json | frozen-tsc.log | exit 0 |
| npm run typecheck:tests | frozen-test-types.log | exit 0 |
| npm run -w @vessel/web build -- --emptyOutDir false | frozen-web-build.log | exit 0; preserves output directory |
| npm run test:all | frozen-test-all.log | exit 1: 236 files, 2627 passed / 1 failed / 6 skipped; only failure is SQLite <5ms |
| Web root if root failure prevents && continuation | frozen-web-tests-after-root-failure.log | exit 0: 20 files / 177 passed |
| bash scripts/identity-guard.sh (Git Bash executable) | frozen-identity.log | exit 0: no denylisted identities in scanned history |

The first `final-test-all.log` overlapped source repairs and is retained as diagnostic history, not final-source acceptance evidence. The frozen run had no concurrent test suites or source edits. The then-unmodified SQLite 1000-row page test independently failed its existing 5ms criterion (`sqlite-latency-recheck.log`: 5.677ms), and the frozen suite reproduced 7.972ms. Subsequent authorized memory source repairs are recorded below; its threshold remains unchanged.

## Changed files and review trail

`worktree-inventory.txt` lists tracked changes and new files; `tracked-diff-summary.txt` summarizes tracked diff. These inventories include preserved initial human modifications to AGENTS.md, DEV_LOG.md, HANDOFF.md, tasks/README.md and the preexisting V2.0 review/task cards. They must not be attributed entirely to this mission. Implementation changes are in llm, context, shared types/helpers, tools, engine, agents, application and CLI/server/Web, with associated tests; pricing/event contracts and task/handoff records were synchronized.

Reviews: `review188189.md`, `final-independent-review.md`, and `lifecycle-independent-revalidation.md` retain earlier findings and append final resolution evidence. Latest lifecycle review confirms no remaining concrete blocking lifecycle defect in its inspected scope; it does not waive fingerprint latency, the deletion deviation, or final regression failures.

## Earlier acceptance and autonomy limit (historical)

Epic 191 remains unaccepted. Strict fingerprint latency is unmet, full regression exited 1, and deletion discipline was violated historically. Combined root/Web results are 2804 passed, 1 failed, 6 skipped. All final gate processes are terminal; session 58469 finished exit 1 because of the root test, while identity scanning independently passed exit 0. The bounded mission has used 5/5 repair slots; no further source repair may start without a human budget change. The next proposed scope is two more bounded repair attempts for fingerprint and SQLite performance with both existing thresholds unchanged. Historical deletion noncompliance is not waived by that proposal. Do not mark the goal complete, commit, or push.

Final collection: 2026-10-07 21:06 America/Los_Angeles. Composite build, test typecheck, Web build and identity guard passed; the mandatory all-green regression and fingerprint timing requirements are contradicted by their logs. No blanket acceptance claim is justified.

## Renewed authorized repairs and current acceptance

Human authorization raised the finite Mission to 13 repairs / 8 runs; current repair consumption is 8, including SQLite numeric review repair. Budget is not the current blocker.

- Fingerprint fresh bounded reads improved repository warm median from about 1279ms to 638.24ms, with cold 773.05ms and maximum 804.86ms. Exact Git patch and all fresh content semantics remain; an outside-parent-junction defect was repaired in both reads and Git diff. Six correctness tests passed before the final helper cleanup. Strict <25ms still fails; alternatives and the pending human contract decision are in `fingerprint-design-decision.md`.
- SQLite listing transfers the freshly selected page through a JSON aggregate; exceptional REAL or unsafe INTEGER pages retain native retrieval and its precision/error behavior. Ten targeted tests and 22 broad tests passed: 1000-row medians 2.575ms / 4.256ms; hybrid 12.940ms. Earlier hybrid 16.361ms failure remains in `sqlite-perf-final-targeted.log`. Independent numeric review cleared the repair in `sqlite-page-independent-review.md`.
- Final-source composite build, test typecheck and Web build passed (`renewed-tsc.log`, `renewed-test-types.log`, `renewed-web-build.log`). Dual-root regression passed (`renewed-test-all.log`): root 236 files / 2634 passed / 6 skipped; Web 20 files / 177 passed; combined 2811 passed / 6 skipped, exit 0. Identity guard passed (`renewed-identity.log`), exit 0. Serial gate script session 67375 is terminal, exit 0. No other test/build/benchmark ran concurrently.

Epic remains unaccepted while the unchanged fingerprint criterion is unmet; neither budget authorization nor passing correctness tests waive it. Historical deletion noncompliance remains disclosed above.

Renewed final collection: 2026-10-07 21:52 America/Los_Angeles. All five mandatory mechanical gates passed after the last source edit. No live worker or verification process remains. The human performance-contract question is pending; goal stays active and no completion or commit is claimed. Inventory: `renewed-worktree-inventory.txt` / `renewed-tracked-diff-summary.txt`; preserved initial human edits are not wholly attributable to the mission.

Subsequent three-turn blocked audit: the pending fingerprint contract decision is unchanged; all verification processes are terminal. The goal status is now **blocked**, not complete. Budget remains authorized and available. Human decision resumes the original scope; no proposed relaxed criterion has been applied.
