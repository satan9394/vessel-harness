# Card 198 acceptance defects — focused repair proof

Owned source files: packages/context/src/pruning/adaptivePruning.ts and packages/context/tests/pruning/adaptivePruning.test.ts.

Changes:
- Explicit exported arrow/function return types become AST FunctionTypeNode declarations, preserving generic parameters and parameter types, stripping bodies/default initializers. Existing declared variable types take precedence.
- Syntax-only inference does not invent an untyped callable return type. When sourceSkeleton cannot form a faithful source skeleton, the original source Read output stays intact (also covers malformed/decorated source).
- Diff tool output and Shell commands containing the diff word are retained verbatim, conservatively including Git --no-pager and -C arguments.
- Regression tests exercise long explicit/untyped exported callables, old Shell Git diffs for modified f0.ts, Diff tool output, and exact recent-three-group retention.

Final verification after last source/test edit, sequential:
- card198-acceptance-repair-final-scoped.log: 5 files / 19 tests passed; EXIT_CODE=0.
- card198-acceptance-repair-final-build.log: npx tsc -b tsconfig.json; EXIT_CODE=0.
- card198-acceptance-repair-final-test-typecheck.log: npm run typecheck:tests; EXIT_CODE=0.

All final logs record the command and actual process exit code. Earlier intermediate logs are preserved.

Limits: no Card 197 performance attempts, full-suite tests, Web build, state/task completion edits, commits/pushes/deletions, external agents, or Epic completion claim.
