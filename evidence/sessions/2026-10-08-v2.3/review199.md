# Independent final integration review — Card 199

Date: 2026-10-08. Scope: current `packages/application/src/v23Integration.test.ts`, approved Card197 performance assertions, and their composition boundaries. Read-only source review; this report is the sole file written. No tests or performance runs were started, to avoid competing with the parent's final gates.

## Findings

No concrete blocking finding in this narrow final integration scope.

## Acceptance reviewed

- The real fixture contains an addition defect, an alias-import caller, a failing uncaught Node assertion marked `TARGET_ADDITION_BUG`, and a three-case regression suite. Red/Green executions originate from `RedGreenGate` subprocess capture, not provider-authored output. Evaluator-owned reproduction and regression files are listed separately from both repaired source dependencies.
- The generator is a deterministic MockProvider driving the composed `code_symbol_graph` and `Edit` tools. It cannot invoke the evaluator verification methods through a registered tool. The evaluator verifies Red before composition and independently runs reproduction and regression after the tool repair. This proves the composed mechanism, not real-model coding skill or an OS-isolated evaluator process.
- Two loop calls must reject with Policy Deny: attempted completion before repair, and terminal completion following the successful Edit before evaluator Green. The fixture then checks the repaired disk bytes, successful Edit result, both Green exit codes, regression output, evaluator proof signature, successful completion after Green, and at least two recorded gate denials. The SHA-256 assertion checks proof serialization; private evaluator state remains the authority.
- The graph tool must return exactly the alias caller edge `caller.mjs#calculate -> arithmetic.mjs#add` with relation `references`. Actual composed Read outputs form adjacent assistant/tool pairs. Old unrelated source becomes an AST skeleton; the relevant defective source and the latest three Read results retain their implementation text. Measured dynamic-tail token reduction must be at least 40%.
- Before/after builder checks compare stable prefix, scoped prefix and prefix-byte hash; task text is retained, including after evaluator completion. Pruning is injected into the real builder and shared guarded graph access, rather than a stand-alone synthetic pruning result.
- `card197-check.ts` measures 12 actual source changes following 8 warmup changes. It retains all samples and separately asserts mean <=10ms and maximum <=25ms. `symbolGraph.test.ts` checks subprocess success, sample count and both limits independently. These match `APPROVED-DOD.md`; the timing excludes writes and subsequent assertions, as explicitly recorded. No production graph change or timing-boundary change is bundled with the DoD replacement.
- All newly-created fixtures are under `os.tmpdir()`. Card199 closes its harness before removing its own temporary root; the performance proof cleans its owned fixture in `finally`. Source file access uses explicit graph file paths and shared canonical/read/confinement guards. The reproduction and regression executables are trusted Node argv with no shell. Memory is disabled, provider is injected, and compose does not create a default ProviderStore/UsageStore. The test's `git init` is confined to its fresh fixture; the reviewer performed no Git mutations.

## Prior evidence and limits

`review196197.md` remains the historical findings record. Current source/tests retain recursion, expose implements edges in get_references, and reject ambiguous/mixed runner Red output. Card196's trusted-runner and explicit-file freshness limitations remain documented in `card196.md`. `review198-resolution.md` remains the independent repaired-pruning evidence; this review does not repeat its entire production review.

Inspected worker records: `approved197-scoped.log` reports 18/18 passed, exit 0; `approved197-performance.log` reports all 12 edits, mean 2.553583ms / maximum 4.675300ms, exit 0. The earlier `card199-e2e.log` reports one passing test, exit 0, but predates the current console evidence addition and contains no printed evaluator proof. It is not used to claim final-source verification. Final fresh integration/full dual-root tests, build, test types and Web build are owned by the parent; no full regression or Epic PASS is asserted here.

Conclusion: no blocking finding in the reviewed integration and approved-performance scope. Changes: this report only. Verification: source assertions and existing scoped evidence inspected; no concurrent test/performance execution. Next steps: parent runs final post-edit gates and records actual evaluator evidence before Card199 acceptance.
