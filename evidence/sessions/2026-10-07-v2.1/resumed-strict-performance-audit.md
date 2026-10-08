# Resumed original strict performance work

The human revoked the prior stop and requested all original tasks complete before reporting success. This does not waive the <25ms requirement. The state controller resumed active work; the app goal tool still returned paused and provides no active/resume mutation. No completion claim or new goal was created.

One additional bounded research pass and repair attempt were counted: Mission repairs 9/13, Run repairs 4/4, research 2/2. Fresh resumed blocked-audit counting begins with this human turn; the earlier three-turn audit is historical.

## New evidence, not repetition of old tests

`resumed-launcher-and-sync-research.log` compares the PATH Git entry with direct real binaries serially. The normal launcher started in 52–61ms; the direct installed binary in 32–37ms and inventoried in 50–62ms. The bundled runtime binary's first launch was 698ms. This closes the possibility that the earlier failure was only an avoidable PATH launcher layer.

A bounded synchronous-read candidate for <=64 files was implemented and tested: `resumed-fingerprint-correctness.log`, two files / ten tests passed. Whole-call measurement in `resumed-fingerprint-benchmark.log` still failed: 50-file cold 49.92ms / warm median 34.44ms; repository 1723 files cold 584.97ms / warm median 487.24ms. No stable small-workload improvement was established. The extra branch was reverted completely; no production optimization from this attempt is retained. Whole-repository variance is not attributed to that branch, which was not selected for large workloads.

Earlier renewed mechanical gate logs remain passing evidence for their recorded source revision. After the experimental edit/revert, no new full gate run has been claimed. A final acceptance run is still required after an actual successful performance repair. No thresholds, exact Git semantics, fresh content checks, core sources, dependencies, commits, pushes or publication were changed.

## Tool safety events

Two experimental research commands were rejected before execution: first for inline temporary-directory Node cleanup, then for Add-Type. Neither created a fixture or deleted files. The actual research used existing repository files read-only and no cleanup. Existing task-directed test/benchmark commands completed successfully; their own fixtures follow the repository's documented system-temp test exception.

## Remaining requirement

No established compliant implementation path now meets the strict whole-call <25ms requirement on the requested workload. Native integration alternatives previously reviewed do not solve the cold bootstrap bound and have no existing dependency support. More budget alone does not change this evidence. The original objective remains unachieved; no relaxed acceptance proposal has been applied.
