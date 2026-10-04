# Task 185 delivery proof

Date: 2026-10-03 (America/Los_Angeles). Scope: task 185 only. No commit or push.

## Delivered behavior

- Enable **Swarm** and **CognitiveRules** in Customize. Both panels are usable with no session selected. Topology uses SVG and adjacent full node details: local/peer IDs, endpoints, roles, online/busy/offline status, RTT and a bounded 20-observation waveform. Polls run every 5 seconds, serialize slow requests and discard late results after teardown. An optional DAG ID exposes cached remote task status and active counts; absent snapshots are explicitly unavailable.
- Cognitive rules show category, trigger, lesson, recommended action, frequency, update time and optional confidence. Category and live keyword search combine on the client. Polling, loading, errors, retry and empty states are covered. The view explicitly identifies the existing store's latest-1,000-rule limit.
- Tool rows in the Talking message stream carry actual execution badges: green `windows-job-restricted` / `bwrap-ns`, yellow `lowIntegrity`, gray fallback/denied. Clicking opens a constraints drawer; Close and Escape return focus to the disclosure. The Talking audit history reads durable execution records, including after server restart.
- The native result producers now record read-only roots, acknowledged memory limits and privilege reduction in the existing sandbox audit. Windows reports the configured Job cap (default 512 MiB) after acknowledgement. POSIX explicitly reports no native memory cap. Older records without constraints remain unknown rather than inheriting host capability. This required small supporting additions to `packages/shared` and `packages/tools`; enforcement settings were not changed.
- Authentication is reused on `GET /api/mesh/peers`, `GET /api/memory/rules` and `GET /api/system/sandbox-tier`. The routes reject write methods. Peer DTOs exclude tokens; task summaries exclude prompts and artifacts. Reads use cached Mesh observations and persisted application/session projections.
- An application-level execution observation follows the policy waterfall, which can short-circuit later `before_tool` listeners. The projection and SSE use this observation and tool-call IDs to preserve the actual Shell audit despite Core's `after_tool` omitting metadata. Core source is unchanged.

## Acceptance gates

All final commands ran sequentially after the last implementation/test edit. All gates passed; task status is **本地全门禁通过；待验收**.

| Command | Evidence | Result |
|---|---|---|
| `npx vitest run --root apps/web apps/web/src/components/__tests__/SwarmTopologyView.test.tsx apps/web/src/components/__tests__/CognitiveRulesDashboard.test.tsx` | [directed.log](directed.log) | 2 files / 12 passed, exit 0 |
| `npx tsc -b tsconfig.json` | [tsc-build.log](tsc-build.log) | exit 0 |
| `npm run typecheck:tests` | [typecheck-tests.log](typecheck-tests.log) | exit 0 |
| `npm run -w @vessel/web build` | [web-build.log](web-build.log) | exit 0, no warnings |
| `npm run test:all` | [test-all.log](test-all.log) | root: 226 files / 2558 passed + 6 skipped; Web: 19 files / 172 passed; exit 0 |

Supplemental native/application/API tests: [backend-native.log](backend-native.log), **4 files / 19 passed**, offline Mock launch acknowledgements. The final full suite also covers the sandbox badge and projection tests.

Production browser check: [browser.log](browser.log). It exercises the real authenticated server, built Web assets, category changes, live search, Mock Shell loop → SSE → actual badge, recorded read-only/memory/privilege fields, Escape close, durable Talking audits, desktop/mobile layout and absence of page errors. No force-clicks, real peer probes, external agents or dependency installations. Port **31885** was checked free before launch and closed after the check.

Screenshots: [topology](desktop.png), [rules](rules.png), [sandbox drawer](sandbox-drawer.png), [mobile](mobile.png). User-local constraint paths are masked in the drawer screenshot; user-home prefixes in diagnostic logs are anonymized as `<USER_HOME>` without changing results.

The earlier [provisional full run](test-all-provisional.log) overlapped the final metadata edits and is not acceptance evidence: its transform snapshot predates four new constraints assertions. It also retained a 5.509 ms SQLite median against the unchanged <5 ms criterion. The final run uses unchanged sources with no browser/build/test jobs running alongside it; no benchmark threshold was weakened.

## Changed implementation and test files

Web:

```text
apps/web/src/App.tsx
apps/web/src/api.ts
apps/web/src/sse.ts
apps/web/src/uiModules.ts
apps/web/src/uiModules.test.ts
apps/web/src/dashboard.ts
apps/web/src/sandboxAudit.ts
apps/web/src/components/CustomizePanel.tsx
apps/web/src/components/ConversationView.tsx
apps/web/src/components/ToolActivityRow.tsx
apps/web/src/components/SwarmTopologyView.tsx
apps/web/src/components/CognitiveRulesDashboard.tsx
apps/web/src/components/SandboxAuditBadge.tsx
apps/web/src/components/SandboxAuditHistory.tsx
apps/web/src/components/dashboard.css
apps/web/src/components/sandboxAudit.css
apps/web/src/components/__tests__/SwarmTopologyView.test.tsx
apps/web/src/components/__tests__/CognitiveRulesDashboard.test.tsx
apps/web/src/components/__tests__/SandboxAuditBadge.test.tsx
```

Server/application and supporting audit contract:

```text
apps/local-server/src/server.ts
apps/local-server/src/dashboardApi.test.ts
packages/application/src/compose.ts
packages/application/src/nativeSandboxIntegration.test.ts
packages/application/src/projections/ToolActivityProjection.ts
packages/application/src/projections/projections.test.ts
packages/application/src/projections/types.ts
packages/application/src/session/SessionRegistry.ts
packages/shared/src/events.ts
packages/tools/src/execution/sandbox/types.ts
packages/tools/src/execution/sandbox/platformSandbox.ts
packages/tools/src/execution/sandbox/platformSandbox.test.ts
packages/tools/src/execution/sandbox/windowsRestricted.ts
packages/tools/src/execution/sandbox/windowsRestricted.test.ts
packages/tools/src/shell/shellTool.ts
```

Handoff: `tasks/185-web-swarm-topology-and-cognitive-dashboard.md`, this proof and the logs/screenshots/[browser-check.ts](browser-check.ts) in this directory.

## Reproduce the browser check

Use the installed/bundled Playwright package path returned by `load_workspace_dependencies` as `VESSEL_PLAYWRIGHT_PACKAGE`; no package installation is needed.

```powershell
netstat -ano | findstr :31885 # if occupied, change the fixture port before running
npx tsc -b tsconfig.json
npm run -w @vessel/web build
# Set $env:VESSEL_PLAYWRIGHT_PACKAGE to the absolute installed package directory.
npx tsx evidence/2026-10-03/task185/browser-check.ts
```

The check creates and cleans only its own `os.tmpdir()` directory after the browser and server close. Default provider/usage roots are isolated there. All launchers are Mock; Mesh heartbeats are disabled only in this fixture.

## Review boundary

No `packages/core` source changes, new dependencies, package/lockfile changes, alternative package-manager files, permission/ACL changes, actual external Agent calls, commits or pushes. Native launcher values are verified with deterministic offline mocks, as requested. Missing historical audit fields and absent remote observations are shown explicitly. Next step: maintainer acceptance of the uncommitted diff.
