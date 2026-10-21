# Task 254 verification

Implemented locally; browser acceptance pending. No commit, push, external agent CLI invocation, dependency change or core edit.

## Behavior and API

- Historical sessions reopen through `SessionFactory.sessionId`, sharing an in-flight promise and the event/inspector wiring used by new sessions. Missing logs remain 404; restoration failures return 409. Deletion cannot race restoration. Registry title, creation time and archive state survive; the existing `put()` API advances `updatedAt`.
- `GET /api/sessions/:id/messages` returns `{ messages, usage, summary }`: user/steering text, assistant messages/attempts, tool lifecycle items, and durable `model/usage` accounting. Internal injected instructions are excluded.
- `GET /api/sessions/:id/events?hydrate=1` emits an initial `transcript` frame with the same payload. Snapshot construction and listener registration are synchronous. Web fetches HTTP history when memory is empty, reconciles the connection snapshot, and rejects late HTTP/stale-session results. Submission waits for the connection snapshot so hydration cannot erase an optimistic new message.
- Missing historical provider configuration does not block reading; execution fails explicitly instead of silently using a mock.
- Pending goals map to `unknown`; only `in-progress` maps to `running`. Non-session Activity rows expose native expandable details and wrapping text. Refresh uses dedicated Chinese/English copy.

## Final targeted gates

These completed after the last product/test edit:

| Command | Result | Log |
|---|---|---|
| `npx tsc -b` | exit 0 | [build](2026-10-21-task254-build.log) |
| `npm run typecheck:tests` | exit 0 | [test types](2026-10-21-task254-test-types.log) |
| `npx vitest run apps/local-server` | exit 0; 21 files, 190 tests passed | [server](2026-10-21-task254-server-final.log) |
| `npm run test:web` | exit 0; 51 files, 420 tests passed | [Web](2026-10-21-task254-web-final.log) |
| `npm run -w @vessel/web build -- --emptyOutDir false` | exit 0 | [Web build](2026-10-21-task254-web-build.log) |
| `git diff --check` | exit 0 | checked directly |
| `git diff HEAD --stat -- packages/core` | empty; zero working-tree changes | checked directly |

Regression tests cover concurrent detail/messages/SSE restoration, continuing a restored conversation, usage replay, assistant attempts/tool results, internal instruction exclusion, all six goal states, fresh-page hydration, stale-result guards, snapshot/live reconciliation, submission blocking during hydration, and bilingual Activity rendering.

## Retained reproducer

`node --import tsx scripts/verify-task254.mts` exits 0 against the original persisted session `sess_1792583751073_cc114a5b`. A fresh server with isolated registry/provider state opens the original log, requests detail/messages and reads the SSE connection snapshot without model calls. Both HTTP requests return 200; history contains one user message, one assistant response and one usage record. Original JSONL SHA-256 is unchanged: `5e3c62a66624fd309f3dbdda2c88564a62ed6331d7eef97a6ba79c259a22f95c`.

Evidence: [JSON](2026-10-21-task254-retained-session.json), [log](2026-10-21-task254-retained-session.log). The OS-assigned port is recorded in JSON; the verifier closes its server. Isolated registry evidence directories are retained.

## Limits and wider gates

- Browser F5 and visual acceptance were not performed: `cua.getState()` returned no browser surfaces; `createBrowserTab('iab', ...)` returned `Browser is not available: iab`. API replay, hook tests and static rendering do not replace browser evidence.
- `git diff origin/main --stat -- packages/core` is **not zero**: existing committed divergence is 8 files, 415 insertions and 6 deletions. This task did not modify or revert it; the HEAD working-tree comparison is empty.
- A supplementary `npm run test:all` probe reported **3076 passed, 6 skipped, 2 failed**, across 291 root files. Failures: Windows pre-spawned-grandchild enumeration and virtual-proxy descendant cleanup (`taskkill` access denied). Its Web leg was skipped by `&&`; Web ran separately above. This probe began before final refinements and is not final full-suite acceptance. Task 252 already records the process-tree limitation. [Log](2026-10-21-task254-all.log).
- Supplementary Web type checking reports existing errors in App/Rail/provider settings and older test fixtures. It is separate from the requested successful root/test-type checks and Vite build. [Log](2026-10-21-task254-web-types.log). No unrelated cleanup was attempted.

Next acceptance action: repeat Task 253's F5 reproducer and expand a Goal Activity row in a browser-capable session. Reconcile origin/main divergence separately from this task's unchanged-core working tree.
