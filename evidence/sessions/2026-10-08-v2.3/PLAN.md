# Epic 199 bounded mission

Authorized by the user on 2026-10-08. Baseline is the existing uncommitted V2.2 delivery; `baseline.json` records file hashes and `run-state-before.json` preserves its completed mission.

1. Card 196: independent evaluator runs genuine assertion failures, then the unchanged reproduction and regression suite. Verify negative proofs and both tool and normal completion enforcement.
2. Card 197: lightweight in-process AST graph and read-only tool. Verify aliases, reexports, shadowing, reverse references and user-approved mean<=10ms / peak<=25ms warm single-file updates (2026-10-08; original <=15ms failures retained).
3. Card 198: Git/graph impact pruning injected into context assembly. Verify >=40% estimated token reduction, unchanged task/static prefix, recent turns and tool adjacency.
4. Card 199: independent review, end-to-end repair fixture, dual-root full tests, composite build, test types and web production build. Record exit codes and logs; update handoff and cards.

No core edits, external agent invocation, resident LSP, commits, pushes, publication or permanent deletion. Web build uses `--emptyOutDir false`.

Dependency discovery: TypeScript 7.0.2 exposes compiler APIs through a native server. Its default export is version-only; the legacy `createSourceFile`/`createProgram` API is absent. Card 197 must use an in-process JS parser, without starting that server.
