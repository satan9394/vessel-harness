# 已并入卡 336（本文件保留为执行证据）
- PDW task: none (host auxiliary mode)

## Goal
Fix usage window consistency, CSV filtering, provider deletion HTTP errors, and the corresponding provider documentation.

## Not Doing
No unrelated changes, HTTP success-path changes, external agent CLI calls, commits, or pushes.

## Acceptance
- byProvider/byModel filter entries inclusively by lastTs local calendar day when since/until are supplied; preserve unwindowed behavior.
- CSV, human provider output, JSON byProvider and HTTP provider usage agree for the same window; unwindowed output remains byte-identical.
- Referenced provider DELETE returns 409 { error: 'provider_in_use', profiles: string[] }; malformed reference detail returns 400 provider_in_use; other mappings remain unchanged.
- Sync PROVIDER-MANAGEMENT sections 3.6, 3.7 and 11.
- Run the three user-specified Vitest commands (routes directory fallback if profileRoutes.test.ts is absent), all exit 0.

## Blast Radius
apps/cli/src/usage/UsageStore.ts, apps/cli/src/cli.ts, apps/local-server/src/server.ts, necessary tests under usage/server/routes, docs/PROVIDER-MANAGEMENT.md, this card and tasks/README.md.

## Expected Evidence
Actual test results and independent diff review; no generated evidence files in source directories.

## Execution
One host implementation subagent, one writer at a time; coordinator reviews and runs acceptance. Routing: gpt-6.1-sol / medium, multi-file coordinated work row; Fast off (no service-tier override). No local CLI model probe because no local agent CLI is invoked.

## Result
Implemented entry-local-day windows for UsageStore and CLI CSV/human/JSON, DELETE reference errors, and the three requested documentation sections. Independent coordinator diff review completed; no HTTP success-path changes.

Required commands run after final product/test/doc edits, all exit 0:
- `node node_modules/vitest/vitest.mjs run apps/cli/src/usage`: 8 files / 123 passed.
- `node node_modules/vitest/vitest.mjs run apps/local-server/src/server.test.ts`: 1 file / 76 passed.
- `node node_modules/vitest/vitest.mjs run apps/local-server/src/routes`: 10 files / 113 passed (`profileRoutes.test.ts` absent).
- `git diff --check`: exit 0.

Remaining: existing HTTP windows filter provider aggregates by their maximum lastTs, while requested CLI/store windows select individual model entries before aggregation. These differ for a provider with models inside/outside the window. An asynchronous scope question asks whether HTTP usage window data sourcing may change despite the explicit prohibition on HTTP success-path changes; no answer received at this checkpoint. Do not claim full HTTP/CLI parity. Tests verify compatible one-entry providers and separately verify mixed-entry CLI selection. No assertions weakened.

Concurrent external edits appeared in cli.test.ts and tasks/325–330,335,336; preserved, not attributed to this task. No commit/push/local agent CLI calls.

Reviewed product/test/doc SHA-256:
```
dca50de0b1ca24b03384dd64e5356d68b92ae16612015860f09d9b8f462ce691 apps/cli/src/usage/UsageStore.ts
b9be4cfd7fe7ee32a827e1906beee7e0b9b03fce0eaf65fe525e832e116b251c apps/cli/src/cli.ts
c5bc2e70a492b8a79b870a08b28b72296469fce18625d87934d17707a740ea5a apps/cli/src/usage/usage-store.test.ts
38b85c043c48abb5c4588fb14fac5ca857be3b6cb87289ba8b695b933b975f39 apps/cli/src/usage/window-cli.test.ts
6cea5757ecf086701b2b6f2605919a60c1ea2bec535cc1f8a053f339ba5706ac apps/local-server/src/server.ts
03cb9fc9ad3688dac7d1d4d184c2d471aed3d6ef64efd0c5c385ec710b77364b apps/local-server/src/server.test.ts
eb97eea99bf6922d947edd2d7a5358b73f75dfd6bb0539c2741eaa2276fe9dbf docs/PROVIDER-MANAGEMENT.md
```
