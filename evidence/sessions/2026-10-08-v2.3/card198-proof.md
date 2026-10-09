# Card 198 checkpoint — implementation present, type gate failed

No completion claim. No state/card completion changes made by executor.

## Changes

- Added `packages/context/src/pruning/types.ts` and `adaptivePruning.ts`.
- Collects real Git unstaged, staged and untracked NUL-separated filenames with read-only subprocesses (`shell` not used).
- Shared guarded explicit-file graph refresh via `createSymbolGraphAccess`; existing AST tool wrapper retained.
- Exact first-hop incoming/outgoing symbol graph links protect changed files and direct dependencies. Explicit active files, recently used files and pending reads are retained.
- Clones only older completed tool results; all other messages and metadata retain order and contents. Recent three assistant groups, error groups and incomplete call groups remain intact.
- Unrelated Read source text produces AST exported declarations with implementations removed. Archived outputs carry SHA-256 and factual size/line counts, without generated conclusions. Full evidence remains in original session records.
- ContextBuilder opt-in runs before prefixLayout construction; stable/scoped layers and task/user messages remain unchanged and volatileSuffix reflects transformed messages.
- Composition requires opt-in symbolGraph, shares the guarded service, and does not introduce core edits or context-to-tools dependencies.

## Actual verification

1. `card198-scoped.log`: exit 1, 11 passed / 1 failed. Integration fixture omitted required execution context for protected Read; parent reserved repair before correction.
2. `card198-scoped-repair.log`: exit 0, **17/17 passed** across pruning, real composition, existing graph composition/tool and prefix tests. 20-file fixture asserts **>=40% token reduction**, exact dependency set, immutable prefix/task bytes and recent three groups. Real Git staged/unstaged/untracked collection and graph filesystem denial also pass.
3. `card198-build.log`: **exit 2**, TS2322 at `adaptivePruning.ts:33`. Inferred exported statement union is narrower than transformer's `ts.Statement` result.
4. `card198-typecheck.log`: **exit 1**, same TS2322, no other diagnostic.

Proposed narrowly scoped repair for subsequent authorization: give `ts.transform` the explicit `<ts.Statement>` type argument. No repair performed after build failure because bounded repair budget was exhausted.

No commits, pushes, deletions, services, external harnesses or graph benchmarks executed by this worker. New fixture cleanup is limited to test-owned `os.tmpdir()` directories.
