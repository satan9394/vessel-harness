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

Remaining（已由卡 338 解决）：HTTP 与 CLI 的窗口口径已统一为「按条目 lastTs 过滤后聚合」；window-cli.test 覆盖同一供应商含窗口内外模型的完全相等。本文件保留为执行证据。
