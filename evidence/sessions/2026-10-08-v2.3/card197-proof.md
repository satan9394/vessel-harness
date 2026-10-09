# Card 197 proof and retained checkpoint history

Implementation: `context/src/ast/{types,symbolGraph}.ts`, `tools/src/ast/symbolGraphTool.ts`, public exports and explicit `composeHarness.symbolGraph` registration. Core has no edits from this card. Runtime compiler parser is the pinned alias `typescript-parser` → TypeScript 5.9.3; project build remains TypeScript 7.

Lexical checker identity covers aliases, star/reexports, namespace access, same-name methods and shadowed parameters. Incoming references distinguish actual callers from unrelated functions, strings and comments. Explicit path mappings resolve workspace aliases. The compiler host never reads imported files from disk; the tool canonicalizes and checks every explicit file before indexing and each cached query. Source reads stage atomically before mutating the index. Changed files refresh the reverse dependency closure, and additions/removals refresh all files to account for newly resolved imports.

Latest independent-review repair checkpoint:

- True recursive self-reference edges are retained; `code_symbol_graph.get_references` includes both references and implements and traverses mixed relation paths to the requested depth. New recursion and implementer/service-parity regressions pass.
- Latest graph/tool suite: **14 passed / 1 failed**, exit 1 (`card197-review-repair-tests.log`). The existing real-edit latency gate observed max **21.365ms**, so current-source latency acceptance is not closed. Full stdout/stderr and every sample are retained. No additional timing repair or weakened assertion was performed; parent was notified before further repair.
- The passing descriptor-repair measurements below are retained historical evidence from before these small independent-review source fixes. They do not override this newer failing gate.

Earlier authorized descriptor repair result:

- Unchanged callers retain cached reference descriptors and local edges; no AST traversal. Direct imported aliases remap through one refreshed ImportClause binding per alias. Namespace member paths share a lexical binding lookup. Type-driven/narrowed member references use cached individual sites for checker precision, without an AST rescan.
- Regression fixture contains 1000 repeated imported calls and namespace accesses plus local calls. Changing the reexport retargets the exact caller, preserves its local edges, traverses only the changed barrel, and uses fewer than 30 checker symbol lookups. Additional tests verify inferred factory return-type member retargeting and moved duplicate method IDs.
- Scoped graph/tool/application suite: **16 passed**, exit 0 (`authorized197-isolated-tests.log`), including the unchanged 15ms gate. No source edits after this passing suite.
- Ordinary isolated performance script: **12 / 12 real edited-file updates ≤15ms**, maximum **6.404ms**, mean **3.143ms**, expected and actual caller sets equal, precision **100%**, exit 0 (`authorized197-isolated-performance.log`). All samples retained; no forced GC, outlier removal, median substitution or weakened gate.
- `npx tsc -b tsconfig.json` and `npm run typecheck:tests`: exit 0 after the final source edit (`authorized197-build.log`, `authorized197-typecheck.log`).
- Earlier authorized-repair test and standalone runs accidentally overlapped after the first command yielded a live process. Those failed measurements remain in `authorized197-tests.log` / `authorized197-performance.log`; the subsequent accepted commands ran sequentially after the yielded process was confirmed terminal. The old pre-authorization latency failure remains in `card197-failure-details.log` with actual stdout/stderr and all samples.

The following checkpoint observations describe the earlier implementation, before the explicitly authorized descriptor repair:

Verification at this checkpoint:

- `npx tsc -b tsconfig.json`: parent checkpoint exit 0 (`checkpoint-build.log`).
- `npm run typecheck:tests`: parent checkpoint exit 0 (`checkpoint-test-types.log`); executor log also retained as `card197-typecheck.log`.
- Scoped graph/tool/application tests: 12 semantics/integration tests pass; 1 latency test fails (`card197-tests.log`). Actual loop registration and query, schema hiding and policy denial/audit are covered.
- Standalone same implementation: exact expected 2 callers / actual 2 callers, precision 100%; 12 actual changed-file updates after 8 warmups, max 5.643ms, mean 3.061ms (`card197-performance.json`). Timing includes UTF-8 read, changed AST parse, compiler/checker and dependency edge refresh. No forced GC or filtered/median latency samples.
- Scoped suite isolated benchmark child observed max 21.407ms and several >15ms samples, despite standalone passing. The 15ms acceptance criterion is **not closed**; the failing log is retained and no goal/card completion is claimed. The first targeted latency repair introduced actual per-file/closure caching and old-program reuse; parent is informed of the second performance failure and owns bounded-state repair-budget handling.

Limits: explicit TS/JS file set and path mappings only; no automatic workspace traversal or external library indexing; dynamic imports/requires, anonymous declarations and destructured bindings are not inferred. Fixture timing is not a repository-scale bound. No LSP/daemon, commits, push, external agents or repository deletion.

## Historical first approved closure (2026-10-08)

The user replaced the old performance DoD with meanMs ≤10ms and peak ≤25ms. Historical failed records above remain unchanged. Current Card197 is completed: fresh scoped18/18; precision100%; 12realupdates mean2.554ms, peak4.675ms, exit0. See APPROVED-DOD.md and approved197-*.log. Final Epic199 checks remain pending.

## Final accepted closure (2026-10-08)

The subsequent full regression failed the former10ms mean gate and reopened the card; the failed host/cache repair candidate was reverted. The user subsequently approved **meanMs <=15ms / peak <=25ms** with complete recursive references and type-driven refresh. Current scoped coverage passes all **12 graph tests +4 tool tests**; standalone12realupdates have mean **10.767ms**, peak **21.405ms**, precision100%. Final full regression passes root **2780 tests +6 skipped**, Web **177 tests**, with build/test-types/Web-build exit0. Card197 and Epic199 are now completed. Current acceptance: PROOF.md, completion-audit.json and accepted15-*.log. The preceding blocked checkpoint is retained in PROOF-before15.md.
