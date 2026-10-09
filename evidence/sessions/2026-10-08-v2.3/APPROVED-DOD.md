# Card 197 approved performance DoD — 2026-10-08

## Current approval: complete semantic refresh, mean <=15ms / peak <=25ms

The user subsequently approved **meanMs <=15ms and maximumMs <=25ms** with complete recursive references and type-driven refresh. `card197-check.ts` and the graph Vitest assertion implement both limits. All real samples, fixture complexity, measurement boundaries and semantic coverage remain intact; no production graph code changes accompany this approval.

The user-provided mean14.24ms/peak19.39ms supports the decision; current acceptance relies on newly executed scoped and final gates (`accepted15-*.log`). Prior failures and rejected implementation evidence are retained below and in their original files. Final status is recorded in PROOF.md.

Final accepted results: scoped **12 graph +4 tool tests pass**, standalone **12 real edits** with mean **10.767ms**, peak **21.405ms**, precision100%; full dual-root **2957 passed /6 skipped**, all requested gates exit0. Card197 and Epic199 completed. No production source/test edits after the final gates.

## Previous approval and historical results

The user explicitly replaced the original <=15ms single-update limit and requested max <10ms target with **meanMs <=10ms and maximumMs <=25ms**, using all measured real edits. Semantic precision remains 100%. No production graph changes accompany this approval.

The preserved latest old-criterion failure has 12 samples: mean 7.137ms, maximum 21.365ms. `approved-dod-evaluation.json` recalculates these raw samples and proves they satisfy the approved limits. Its original subprocess exit 1 and old failure record remain intact.

At that checkpoint the runnable `card197-check.ts` and corresponding Vitest test asserted both previous limits independently. No outlier removal, forced GC, fixture simplification, or measurement-boundary change.

Fresh sequential verification:

- `approved197-scoped.log`: graph/tool/real composition, **18/18 tests pass**, exit 0.
- `approved197-performance.log`: 12 real edits, precision **100%**, mean **2.554ms**, peak **4.675ms**, exit 0. All samples retained.

Card 197 is completed and its blocker cleared. Earlier CHECKPOINT/REVIEW-CHECKPOINT/repair logs remain historical. Card 199 final gates and delivery proof are the remaining work.

Later final integration failed that previous mean limit; initial completion was superseded by PROOF.md. The failed host/cache candidate was reverted. The current explicit user approval above supersedes the old 10ms mean limit.
