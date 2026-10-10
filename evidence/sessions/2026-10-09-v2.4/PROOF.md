# Vessel V2.4 — Epic 204 delivery proof

Date: 2026-10-09 (America/Los_Angeles). Mode: bounded, local development.
Status: PASS — cards 200–204 completed locally on 2026-10-10.

## Scope and baseline

Cards execute in order 200 → 201 → 202 → 203 → 204. Source changes are limited to apps/web, apps/local-server, apps/cli and packages/shared. No commits, pushes, package publication, dependency installation, permanent deletion or real external-agent execution are authorized by this Mission.

Existing user changes are recorded in baseline-status.txt and baseline.diff. Protected file hashes are in protected-baseline.json. The original machine state is preserved in run-state-before.json; its invalid mission status `in_progress` was normalized to controller-supported `active` before the bounded gate passed.

## Card 200

Implemented four discriminated widget contracts, runtime validation and asynchronous SHA-256 transport checksum. The checksum detects altered content; it is not authentication.

WidgetRoutes owns session-scoped publication, replay, decision requests, expiry and shutdown cleanup. POST `/api/session/:id/widget/:widgetId/respond` accepts `{ selectedOptionId }` and returns `{ success: true }`; plural session paths remain compatible. SSE emits canonical `widget_block`, `action_request`, `action_response` with the existing `{ type, delta, ts }` envelope and legacy `widget` alias. Controller bus `ui/widget_block` and `server.widgets` provide publication seams. Responding records/resolves a selection without executing it or overriding Policy.

Independent review found mutable timeout IDs, observer failure interrupting settlement, and stale unsubscribe removing a replacement stream. All were fixed and covered by deterministic regression tests. Main inspected the final Set identity guard and replacement-subscriber regression.

Final card evidence after source edits: 19 files / 183 tests passed; scoped shared/server composite build exit 0; full test typecheck exit 0. Logs: card200-tests-repair2.log, card200-build-repair2.log, card200-types-repair2.log. Earlier logs are retained.

Runnable checks:

```powershell
npx vitest run packages/shared apps/local-server
npx tsc -b packages/shared/tsconfig.json apps/local-server/tsconfig.json
npm run typecheck:tests
```

## Card 201

Four accessible inline components and the dispatcher are connected to ConversationView/MessageList. Native named SSE and authenticated fetch SSE share widget validation. ID upserts prevent duplicate cards, terminal states resist stale replay, and permission requests support pending/error/retry/resolved states with session-switch guards. Existing theme CSS is reused instead of installing Tailwind (`ponytail:` note). A browser-safe shared widgets subpath avoids Node module bundling warnings.

Web: 21 files / 188 tests passed. Web typecheck, test typecheck and production build with `--emptyOutDir false`: exit 0. Logs: card201-web-tests.log, card201-web-typecheck.log, card201-test-typecheck.log, card201-web-build.log.

Real browser interaction on port 30824 using browser-smoke.ts: all four cards rendered; 27-line diff initially collapsed, expanded with old/new line numbers and +12/−12 statistics; full SHA-256 details expanded; approval sent to the actual HTTP response endpoint, resolved its waiting Promise and completed the turn; both option controls disabled. Page reload/session reselection replayed resolved state without re-enabling controls. Browser warning/error logs empty. Screenshots: card201-browser.jpg, card201-resolved.jpg. Synthetic fixture data is explicitly labelled and performs no write or real gate evaluation.

## Remaining verification

All final gates passed after the last source/test edit; detailed acceptance evidence follows.

## Card 202

ConversationView now uses DualSurfaceLayout with four Inspector tabs. Swarm and Cognition reuse their authenticated dashboards. Cache uses the last 40 observed model samples; AST uses observed impact widget target/caller relationships. Storage preserves open/tab state; Ctrl/Cmd+I excludes editable controls. Under 1024px, the Inspector is a modal drawer with focus containment, Escape and focus restoration.

Existing before_model events supply true stable/scoped/volatile UTF-8 byte lengths and prefix hash. SessionInspector sends metadata only, replays snapshots, discards stale asynchronous measurements and clears failed workspace observations. CLI injection of the existing WorkspaceFingerprinter is required with card 203. No core or new dependency changes.

Independent review found triple-sign hunk content incorrectly treated as diff headers. Main repaired parsing using hunk range counts, with a test for decrement/increment content and subsequent file headers. Final Web 22 files / 201 tests passed; Web typecheck, test typecheck and safe production build exit 0 (card202-*-final.log). Server observer/HTTP/SSE routes: 12 tests passed (card202-server-tests.log); composite build exit 0.

Browser: all four tabs mounted; two fixture calls displayed 75% hit rate and an observed waveform; workspace and prefix hashes differed; true prefix byte lengths displayed. Reload preserved open/tab state and replayed metadata/AST. At 800px, modal drawer retained focus, Escape closed it, and Ctrl+I inside the composer did nothing while the same shortcut on the toggle opened it. Warning/error console entries: zero. Screenshots: card202-desktop.jpg, card202-mobile.jpg. Cache call history is in-memory per mounted session; it honestly shows no observed samples after a page reload until new usage arrives.

## Card 203

TerminalStatusLine displays model/reasoning, observed native sandbox tier, workspace fingerprint, cache hit rate and turn duration. It clears before output/input, clips to terminal width, sanitizes terminal controls, and removes resize listeners on disposal. Unknown observations remain unknown. ANSI renders all four widgets using the shared range-aware unified diff parser; long patches collapse after 15 rows. Arrow/Enter selection returns a decision without executing an action. readline data listeners/raw mode are restored on completion/cancellation; Ctrl+C/EOF/resize cleanup is covered.

runChat subscribes to actual model/cache/sandbox/widget bus events, refreshes the existing WorkspaceFingerprinter per turn, and emits default decisions through ui/widget_response (optional response callback). Normal serve and daemon inject the same fingerprinter into server Inspector metadata; no core change.

CLI final scoped suite: 54 files / 631 tests passed (card203-cli-tests.log). Focused status/ANSI/stdio integration: 2 files / 10 tests passed; composite build, test types and help exit0. Main interactive offline MockProvider smoke selected Deny with Right/Enter, ran hello with model/hash/status displayed and a reply, then /quit exited0. Only the existing Node SQLite experimental warning appeared. Transcript: card203-terminal-smoke.log; runnable fixture: terminal-smoke.ts. No real external agent/provider invocation.

## Final integration review and repairs

Independent final review found frozen active-turn elapsed time and status loss after widget output. A scoped 250ms ticker now updates elapsed time and redraws, suspends during permission selection, and clears in finally. Deterministic regression covers all four behaviors: 11 focused tests passed; composite/test typechecks passed. Reviewer re-inspected the repair and returned PASS with no additional cross-surface blocker.

The first full integration run exposed the root Vitest package alias rejecting the browser-safe @vessel/shared/widgets subpath when importing Web SSE from the existing conformance runner. The SSE boundary now imports the same browser-safe source module directly (ponytail note), keeping root test configuration outside the allowed source scope unchanged. Failed evidence is retained in cross-surface-before.log and the initial final-test-all.log; fresh post-edit gates remain required.

## Requirement evidence map

| Requirement | Authoritative evidence |
| --- | --- |
| Four strongly typed widgets, validation/checksum | packages/shared/src/widgets.ts; widgets.test.ts; card200 logs |
| Bidirectional session-scoped HTTP/SSE/replay | routes/widgetRoutes.ts and routes tests; card200/card202-server logs |
| Four inline React components and interactions | apps/web/src/components/widgets; card201 browser screenshots/test logs |
| Dual-surface four tabs, persistent layout, responsive accessibility | components/layout tests; card202 desktop/mobile screenshots |
| Terminal model/sandbox/hash/cache/elapsed, ANSI and selection | ui tests, chatStatus.test.ts; card203 terminal-smoke/ticker logs |
| Shared observer connected to normal CLI serve/daemon | cli.ts/startServe and daemonCommands.ts observeWorkspace injection |
| Core0, unchanged root manifests/lock, allowed source scope | completion-audit.json; source-scope-audit.json |
| Final post-edit dual-root tests/types/safe Web build | accepted-* logs and accepted-gates.json (all exit0) |

Observed AST links are impact-report caller relationships, not a fabricated complete workspace graph. Cache samples are mounted-session memory, capped at40; reload waits for new samples. SHA-256 transport checksum detects corruption, not authentication. No external-agent live benchmark was run.


## Final acceptance — 2026-10-10

Fresh post-edit `npm run test:all`: root **263 files / 2808 passed + 6 skipped**, Web **22 files / 201 passed**; total **3009 passed + 6 skipped**. The existing AST performance assertion passed unchanged in this final run. Root duration596.24s; Web7.14s. Logs: accepted-test-all.log.

All six gates exit0 (accepted-gates.json): dual-root tests, `npx tsc -b tsconfig.json`, `npm run typecheck:tests`, `npm run -w @vessel/web typecheck`, `npm run -w @vessel/web build -- --emptyOutDir false`, and CLI `--help`. Web built67 modules without warnings. Latest source edit: 00:26:26 PDT; acceptance run started00:33:35 PDT, after every implementation/test change. Initial failed run and its measurements are preserved and superseded by this pass, not erased.

Final protected audit:33 protected hashes match; core diff0; root package.json/package-lock unchanged; no alternate lockfiles; source changes confined to the four allowed areas. `git diff --check` exit0 (only line-ending notices). No commit, push, publication, dependency installation, real external-agent execution or non-exempt permanent deletion performed. Browser fixtures and TTY smoke are offline and runnable.

HANDOFF, task cards/index and bounded state are updated. Mission completed with workers0; no automatic next milestone. Next step: human review of this local diff. Permission controls record decisions and do not bypass Policy; SHA-256 checksums are not authentication.
