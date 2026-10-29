# Three-item closeout

Executed 2026-10-29, America/Los_Angeles. The evidence directory date follows the requested name. Baseline was clean **4ffce9a**, a documentation commit immediately after the supplied **af0bb33**. No commit/push, external Agent CLI, subagent, full gate, live conformance or browser download.

| Item | Verdict | Measured evidence |
| --- | --- | --- |
| T1 / 362 header | **通过 / PASS** | Actual session with assistant output and a long title. 960×600 and 720×450: all three direct spans have client/scroll widths **50/50, 77/77, 52/52px**, height **18.591px**, `white-space: nowrap`, `flex-shrink: 0`. At 1440×900 and 1920×900, recaptured after the Write regressions, widths are **50/50, 83/83, 52/52px** and the same single-line height. Document widths **960, 720, 1440, 1920**, equal to innerWidth. |
| T2 / 364 summary | **通过 / PASS** | 298 and 300 characters remain exact, without controls/added ellipsis. 570-character fixture: collapsed **300 + … = 301**, expanded **570**, collapsed **301**, cached re-expansion **570**. Exactly **one GET** across both expansions. Browser console **[]**. |
| T3 / 361 populated widget | **通过 / PASS** | New-file Write: **1 widget_block + 1 compatibility widget**, same event and widget ID, representing **one** populated diff. Transcript widget count **1 live / 1 after reload-reopen / 1 after overwrite**. Existing-file Write: **0 new widget events**, one additional Write call/result; file bytes remain `before\nsecond\n`. |

T1's initial run exposed a stale `apps/web/dist`: its CSS lacked the already committed `.usage-bar` rules, and the first label was 12px wide / 74.364px tall. No source CSS edit was necessary. Built current source into TEMP and served it through a TEMP-only static proxy to the actual CLI `vessel serve` API. Initial and final TEMP build CSS hashes match (`scope-audit.json`), so T2 did not invalidate T1. This version has **three**, not four, direct `.usage-bar > span` elements; all were measured. A light-theme 960px capture also passed. The repository's existing web dist was preserved; rebuilding it before normal use remains a coordinator action.

T2 initially stopped at the original Blast Radius: `packages/agents/src/team/TeamRuntime.ts:119` uses `trim(..., 300)`, whose helper at lines 493–496 appends `…`. `apps/local-server/src/teamRoutes.ts:get()` passes that 301-character projection to the browser. The original drawer then sliced it again. The user approved the extension recorded **before coding** in card 364.

Exactly one new read-only route was added: `GET /api/sessions/:sessionId/team-stages/:stageId/tasks/:taskId/result`. It uses the existing `getTaskResult()`, returns stored status/output/artifact references, checks stage/task/session membership, and reuses the server's origin and daemon-token handling. It reads no artifact file bytes and creates no alternative path-based content access; artifact content remains behind the existing `artifact()` guard. Output is capped to **65,536 UTF-8 bytes**, with a `truncated` flag; multibyte boundaries are preserved (test: **65,535 bytes** of Chinese text). `getStage()` trimming is unchanged. The drawer caches the result until unmount/identity change, shows a separate cap notice when necessary, and uses one short inline error instead of raw failure bodies.

T3 counts use the populated SSE stream, not a vacuous log assertion: the session JSONL has no standalone widget records. It contains one Write call/result per turn. Re-subscription bootstraps the existing widget with its original ID and original turn; those frames are explicitly separated from new publications in `t3-widget.json`.

## Evidence

- T1: `t1-header.json`, `t1-header-960.png`, `t1-header-720.png`, `t1-header-1440.png`, `t1-header-1920.png`; light theme and stale-build before capture also retained.
- T2: `t2-runtime.json` (original 570 → 301 boundary), `t2-final-fixture.json` (stored full results), `t2-drawer.json` (DOM text and network request), `t2-drawer-298.png`, `t2-drawer-300.png`, `t2-drawer-570.png`, `t2-drawer-expanded.png`.
- T3: `t3-widget.json` (counts and event originals), `t3-create.json`, `t3-overwrite.json` (raw SSE), `t3-browser.json`, `t3-widget.png`.
- `screenshots.json` records image sizes and provenance. IAB JPEGs were written directly in TEMP and encoded to PNG without resizing/content changes. Incomplete IAB resize frames were replaced after checking the actual images; all four final T1 PNG dimensions equal their requested viewports.
- `comparison.html` presents the before/after evidence. Fixture scripts, startup records, source hashes, gate stdout/stderr and cleanup records are in this directory. Raw workspace/provider requests remain under the TEMP root in `startup.json`; no credentials or paid model calls were used.

## Verification

| Command | Result | Record |
| --- | --- | --- |
| `node node_modules/vitest/vitest.mjs run packages/agents/src/team/teamApproveAndRun.test.ts apps/local-server/src/teamStageApi.test.ts` | **exit 0**, 2 files / **19 passed** | `t2-focused-final.json` |
| `node node_modules/vitest/vitest.mjs run --root apps/web` | **exit 0**, 61 files / **535 passed** | `web-tests-final.json` |
| `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit` | **exit 0** | `web-types-final.json` |
| `node node_modules/typescript/bin/tsc -b tsconfig.json --pretty false` | **exit 0**, refresh runtime dist before real-process test | `runtime-build.json` |
| TEMP-output Vite production build, `--emptyOutDir false` | **exit 0**; existing large-chunk warning retained | `web-build-final.json` |
| `git diff --check` | **exit 0**; Git CRLF normalization warning retained | `scope-audit.json` / `failures.json` |

Runtime tests cover full stored output and unknown/mismatched stage-task pairs. HTTP tests cover full text, recorded artifact references, 404 for unknown/cross-stage/cross-session IDs, origin 403, read-only 405, no file-content reads and the UTF-8 byte cap. Web tests cover short/exact/long inputs, ellipsis, round trip/cache, safe failed fetch and the cap notice. React review checked hooks, request deduplication, stale async results, accessible control state and reuse of existing UI conventions.

Full 17-step gate was **not run**. No root-wide test run, test-typecheck gate, conformance or unrelated fixes.

## Cleanup and failures

Owned processes: CLI serve **21216** (5694), stub/initial team server **20208** (5695/5696), TEMP frontend **10656** (5697), final team fixture **28356** (5698). All stopped; the independent `cleanup.json` audit reports **0 listeners / 0 owned processes / 0 children**. Browser tabs closed and viewport override reset. TEMP fixture files are retained as evidence; no permanent cleanup was performed.

There were **no policy-denied commands and no failing tests**. `failures.json` preserves the exact failed searches, the CDP screenshot timeout, and the combined cleanup command that returned exit 1 without additional failure text. A later independent cleanup audit passed. The failed screenshot command was replaced by the supported IAB screenshot API, and final images were inspected.

## Changed files

- `apps/local-server/src/server.ts`
- `apps/local-server/src/teamRoutes.ts`
- `apps/local-server/src/teamStageApi.test.ts`
- `apps/web/src/api.ts`
- `apps/web/src/components/team/TeamNodeDrawer.tsx`
- `apps/web/src/components/team/TeamNodeDrawer.test.tsx` (new)
- `apps/web/src/components/team/TeamStagesPanel.tsx`
- `packages/agents/src/team/teamApproveAndRun.test.ts`
- Append-only results in cards **362, 364, 361**; no existing line or status changed.
- New evidence directory `evidence/sessions/2026-10-30-closeout/`.

`scope-audit.json` records exact paths and product hashes; no out-of-scope change. Requested host route was gpt-6.1-sol / medium, Fast service tier off; no route switch or nested agent was invoked. The fixture's internal `RouteMode: fast` selects its single stub-backed team member and is unrelated to service tier.

Next: coordinator review, refresh the normal web dist, then run the coordinator's final gate. No remaining implementation item within this closeout scope.
