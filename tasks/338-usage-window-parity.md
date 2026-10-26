# 已完成：HTTP / CLI usage 窗口口径统一
- PDW task: none (direct scoped fix)

## Goal
Pass validated HTTP usage windows to the injected entry-filtering aggregator, matching CLI results for providers containing models inside and outside the window.

## Not Doing
No ProviderStore, packages/core, unrelated dirty changes, external agents, commits or pushes.

## Acceptance
- Optional since/until window reaches usageByProvider unchanged; no server-side row filtering. No window passes {}; missing injection returns 200 and []; invalid dates remain 400 invalid_date.
- startServe and daemon inject window-aware UsageStore.byProvider.
- HTTP and CLI byProvider deep equality covers shared-provider mixed-window models; preserve exact human/CSV assertions.
- Update PROVIDER-MANAGEMENT §11.
- Both specified Vitest commands exit 0: server.test.ts and apps/cli/src/usage.

## Blast Radius
apps/local-server/src/server.ts, server.test.ts; apps/cli/src/cli.ts, usage/window-cli.test.ts; docs/PROVIDER-MANAGEMENT.md; this card and tasks/README.md.

## Expected Evidence
Focused test counts and exit codes, diff check; preserve pre-existing edits.

## Result
HTTP delegates validated windows to the injected aggregator; both CLI composition paths forward them to UsageStore. Tests record exact windows, preserve all injected rows, reject invalid dates before invoking the callback, and require full HTTP/CLI row equality for mixed-window models with both bounds and each individual bound. Documentation §11 matches.

After final product/test/doc edits:
- `node node_modules/vitest/vitest.mjs run apps/local-server/src/server.test.ts`: exit 0, 1 file / 76 passed.
- `node node_modules/vitest/vitest.mjs run apps/cli/src/usage`: exit 0, 8 files / 123 passed.
- `git diff --check`: exit 0.

No ProviderStore or packages/core edits, assertion weakening, external agents, commit or push. Existing dirty work preserved. Full repository gates were not run; acceptance is the two requested suites. This resolves the HTTP aggregation-window limitation recorded in historical card 337.
