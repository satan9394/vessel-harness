Status: 已完成（本地验证，未提交）
- PDW task: none

## Goal
Resolve F1/F2/F5/F8 from incremental audit 20261026211042-ec65c8.

## Not Doing
No unrelated code, HTTP success DTO changes, commits, or external agent calls.

## Acceptance
- CLI totals/cache/recent and human totals use the existing local-day window semantics; unwindowed output stays identical.
- A real startServe HTTP test compares windowed byProvider with main usage JSON.
- Structured provider_in_use errors retain the message and support quoted IDs; legacy parsing remains supported.
- Section 11 documents forwarding the window.
- All four user-specified commands exit 0.

## Blast Radius
CLI usage store/command/tests, provider deletion error dispatch/tests, provider management section 11, task index.

## Expected Evidence
Targeted Vitest results, TypeScript build result, diff review.

## Result
F1/F2/F5/F8 implemented; unrelated pre-existing task edits preserved. No HTTP success DTO changes, commits or external agent calls.

- `node node_modules/vitest/vitest.mjs run apps/cli/src/usage`: exit 0, 8 files / 124 passed.
- `node node_modules/vitest/vitest.mjs run apps/cli/src/cli.test.ts`: exit 0, 137 passed.
- `node node_modules/vitest/vitest.mjs run apps/local-server/src/server.test.ts`: exit 0, 77 passed.
- `node node_modules/typescript/bin/tsc -b tsconfig.json`: exit 0.
- `npm run typecheck:tests`: exit 0.
- `git diff --check`: exit 0.

F2 compares real startServe HTTP output against filtered CLI output and separately requires the CLI to contain only the in-window provider. An unwindowed HTTP injection necessarily includes the second provider and fails equality. Unwindowed aggregation retains the same entry order, sums, property order, recent slicing and report formatting; existing exact-text regressions pass.

### Verified artifact SHA-256
- `apps/cli/src/cli.ts`: `6808175cf32de67b91673cfdadfccb6ed708dc132f32ddf6d7dc9444dfdb873f`
- `apps/cli/src/cli.test.ts`: `17dee46edee41ca1af55b1d6b886117d97f484b87470e664b73228859132d18a`
- `apps/cli/src/usage/UsageStore.ts`: `f1c0dc562716d431d40f98458eccc7faa839f9d774a2754890dc5d38daf8b088`
- `apps/cli/src/usage/window-cli.test.ts`: `76c183e63ee0921a9c9ec2a45657c73353177c4abe883a134cd6e165eae661b1`
- `apps/local-server/src/providers/ProviderStore.ts`: `ed12d3a2818ccca59fa923cb3b68db8df3eb1ebfc05e8c8cce2713e779781180`
- `apps/local-server/src/server.ts`: `76ca4199778ab61f69d34efc50c1021bec242a699af41944d46d6893adb32c82`
- `apps/local-server/src/server.test.ts`: `99d5462c8b2a2f8917d574fa5a831eac14f47d9acbf7f41fb9fad37bc53d79ef`
- `docs/PROVIDER-MANAGEMENT.md`: `8922d96ca77f8bd0a3c97282a577d0d39c8332eeb23006ee757377d0bd564316`
