# Independent closure review — Epic 191

Date: 2026-10-08. **Scoped verdict: PASS for the approved fingerprint performance contract and earlier finding closure. Final Epic mechanical acceptance remains pending completed final gate evidence.**

Scope: updated tasks 190/191, `scripts/bench-workspace-fingerprint.ts`, `accepted-fingerprint-benchmark.log`, and the existing independent review closure records. This is a read-only closure review, not a repeated implementation audit. No benchmarks, tests, builds, installs, source edits, commits, deletion, or external agents were run by this reviewer. Only this review artifact was written.

## Approved performance contract

The human explicitly replaced the original <25ms requirement with: 50-file fixture warm ≤50ms; current repository at ≤2000 files cold ≤1500ms and warm p95 ≤1000ms; exact existing fingerprint semantics preserved. The updated current DoD sections in both cards record that replacement and retain historical strict-threshold failures.

The benchmark acceptance code correctly implements this contract:

- It times the entire awaited `WorkspaceFingerprinter.compute(root)` call, including inventory, reads, hashing and Git.
- It makes 11 serial calls per workspace. The first measured call is cold; the remaining 10 calls are warm. There is no excluded within-call work or preliminary compute warm-up in the script.
- Fixture acceptance requires exactly 50 observed files and the maximum of all 10 warm samples ≤50ms. This is a conservative, explicit interpretation of the approved warm bound.
- Repository acceptance requires observed file count ≤2000, first-call duration ≤1500ms, and warm nearest-rank p95 ≤1000ms. For 10 samples, rank `ceil(10×0.95)=10` makes this p95 the maximum warm sample.
- Either failed workspace sets a nonzero process exit code. Optional component measurements do not replace the whole-call acceptance calculation. `within25ms` remains a historical diagnostic and does not control the approved acceptance result.

Existing accepted benchmark evidence:

| Workspace | Size | Approved metric | Recorded result |
|---|---:|---|---:|
| Fixture | 50 files | warm maximum ≤50ms | 42.9798ms — PASS |
| Repository | 1726 files, ≤2000 | cold ≤1500ms | 644.2333ms — PASS |
| Repository | 1726 files, ≤2000 | warm nearest-rank p95 ≤1000ms | 651.2598ms — PASS |

Both log rows explicitly report `accepted:true`. The log still reports `within25ms:false`, correctly preserving the fact that the former requirement was not achieved. This review did not independently execute the benchmark or certify an unreported shell exit code.

The benchmark does not change fingerprint semantics. Current compute retains fresh content/mtime reads on every invocation, deterministic ordered hashing despite bounded read concurrency, staged/unstaged binary Git patch bytes, untracked raw bytes, ignore rules, and directory confinement for both content reads and Git diff. There is no cross-call stale-result cache. The approved result is bounded to the recorded machine/workspace scale, not a universal timing guarantee for larger repositories. “Cold” here means the first compute invocation in the process, as explicitly defined in the updated cards; it does not claim an operating-system cache flush.

## Earlier concrete findings

No unresolved concrete earlier review finding prevents functional acceptance in this closure scope:

- `final-independent-review.md` already statically validated the missing-tariff uncertainty repair, server-priced per-call resumed-session cost, actual provider/request model identity, and llm canonical implementation placement.
- The final frozen-source append in `lifecycle-independent-revalidation.md` explicitly closes stale-generation lifecycle contamination, abandoned-call occurrence/id reuse, unmatched turn/end accounting, and compaction scope preservation. It records the inspected generation/callback fences and attempt-scoped, matching-turn reconciliation, plus 72 targeted passes and typecheck evidence. That review states no remaining blocking lifecycle finding; its former latency blocker is superseded only by the explicit human contract approval above.
- The final follow-up in `sqlite-page-independent-review.md` closes numeric transport parity through native fallback for REAL and unsafe INTEGER pages, including precision and exception behavior. No remaining concrete finding is recorded there.

Those prior independent source reviews remain the implementation evidence; this closure review does not pretend to rerun them or regenerate their tests.

## Final gates and historical deviation

The root reports the five final mechanical gates running serially in session 47315. This reviewer has not received completed terminal logs for that run and **does not certify their completion**. Earlier renewed green logs are historical evidence, not a substitute for the requested current final run. Final Epic acceptance needs completed post-edit composite build, test typecheck, Web build with `--emptyOutDir false`, full dual-root regression, and identity guard evidence from the root.

Task 189's three default Vite builds permanently cleared/rebuilt generated `apps/web/dist`. That historical deletion-discipline deviation remains explicitly disclosed; subsequent safe builds and the new performance approval do not waive or erase it. Functional acceptance must not be described as perfect historical red-line compliance.

Conclusion: approved performance acceptance and earlier concrete finding closure pass this scoped review; final mechanical acceptance is pending. Changes: this evidence file only; source work stopped. Verification: static contract/script review and supplied benchmark/prior review evidence, with no executed verification. Next steps: root attaches completed final gate evidence, records the final scoped acceptance and historical deviation, and supplies the final work proof.

## Final supplied-evidence acceptance closure — 2026-10-08

**Final verdict: PASS for all approved functional acceptance gates.** The pending mechanical status above is now closed by the completed evidence below. The root confirms serial gate session **47315 is terminal and closed, exit 0**, with each of the five commands exit 0. This reviewer read their current logs without executing any verification commands. The log text does not uniformly embed exit-code trailers; terminal status and individual command exit codes are supplied by the root, while the concrete outputs below were inspected directly.

| Final gate | Evidence | Inspected result |
|---|---|---|
| Composite build | `accepted-tsc.log` | No diagnostics; root confirms exit 0 |
| Test typecheck | `accepted-test-types.log` | `tsc -p tsconfig.test.json --pretty false`, no diagnostics; root confirms exit 0 |
| Web build | `accepted-web-build.log` | `vite build --emptyOutDir false`, built successfully in 280ms; root confirms exit 0 |
| Full dual-root regression | `accepted-test-all.log` | Root 236 files / 2634 passed / 6 skipped; Web 20 files / 177 passed; combined **2811 passed / 6 skipped**, no failed tests; root confirms exit 0 |
| Identity guard | `accepted-identity.log` | `no denylisted commit identities in this history`; root confirms exit 0 |

The final assembled-worktree benchmark in `accepted-final-fingerprint-benchmark.log` also passes the approved contract:

- 50-file fixture: warm maximum **42.5767ms ≤50ms**.
- Repository: **1739 files ≤2000**, cold **905.8525ms ≤1500ms**, warm nearest-rank p95 **673.4129ms ≤1000ms**.
- Both rows report `accepted:true`; root confirms benchmark exit 0 and serial execution. The first accepted benchmark remains retained. Both final rows still report `within25ms:false`; the explicit human replacement, rather than an assertion that the old bound was met, closes that historical performance blocker.

Together with the earlier independent finding closures recorded above, the completed gates establish the approved functional acceptance. No unresolved concrete earlier finding remains in this review scope. There are no ongoing gate processes reported by the root; source work remains stopped, and this reviewer changed only this evidence artifact.

**Historical compliance deviation remains distinct:** three earlier default Vite builds cleared/rebuilt generated `apps/web/dist`, violating the deletion discipline. The final safe build, green gates, and approved performance replacement do not erase that fact. Functional PASS is not a claim of perfect historical red-line compliance, and no waiver of that deviation is inferred.

Conclusion: Epic 191's approved functional gates PASS with the historical deletion deviation disclosed. Changes: appended this acceptance closure only; no source edits. Verification: inspected supplied final logs and benchmark results, with root-confirmed terminal exit status; no independent reruns. Next steps: root records the completed acceptance and provides the final work proof, retaining all historical evidence and the deletion deviation.
