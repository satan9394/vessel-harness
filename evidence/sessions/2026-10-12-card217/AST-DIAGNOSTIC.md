# AST real-edit performance diagnostic

The existing `card197-check.ts` fixture and its mean <= 15 ms / peak <= 25 ms thresholds were retained unchanged. No AST source or test edits were made.

Three fresh standalone processes each retained all 12 measured source edits and passed:

| Run | Mean ms | Peak ms | Evidence |
| --- | ---: | ---: | --- |
| 1 | 2.4611 | 4.1526 | `ast-standalone-1.json` |
| 2 | 2.8277 | 5.0564 | `ast-standalone-2.json` |
| 3 | 2.9058 | 4.6984 | `ast-standalone-3.json` |

Command: `node --import tsx evidence/sessions/2026-10-08-v2.3/card197-check.ts`.

One diagnostic CPU-profiled run passed with mean 12.6117 ms / peak 14.4427 ms. Rebuild samples concentrated in TypeScript checker creation and binding; path normalization was secondary. Profiling overhead makes that run unsuitable as the normal performance baseline.

The prior full-suite timing spike was not reproduced in the fresh standalone processes. The evidence establishes timing variability; it does not prove its exact cause. No thresholds, warmup counts, measured edit counts, or measured work were weakened. Final full-suite verification remains the authority for this gate.
