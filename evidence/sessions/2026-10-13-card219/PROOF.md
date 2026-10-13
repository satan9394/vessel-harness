# Card 219 — interactive click-testing evidence

Status: **VERIFIED — 2026-10-13**, standard card delivered; stop after evidence.
Mode: standard. Baseline: local `main`, HEAD `26ba6fe`; preexisting changes recorded in `baseline.json`.

## Browser evidence

`click-attempt-12.json` and `click-attempt-12.log`: **77 PASS, zero console errors, zero uncaught exceptions**, Chromium headless at 1440×900 and 800×900. This final run includes real switch-away/back replay of three user messages and exactly three completed assistant responses. The real built Web app and real Local Server APIs/SSE use isolated test-owned provider, credential, usage, session, project and workspace roots. No browser API interception or replacement is used.

See [CLICK-REPORT.md](CLICK-REPORT.md) for matrix mapping and reproduction. Five screenshots show patch review, provider persistence, desktop, narrow drawer and narrow final state. Both server/model ports were closed after the final run (`fixture-termination.json`). Test-owned temporary roots remain preserved.

The independent evaluator reviewed the strengthened assertions, five-tab count, exact pending Discard click, request mutations, isolation, credential metadata and listeners, plus the repaired replay lifecycle and adversarial tests (`independent-review.md`). Repair and scoped browser review PASS; repository gates are independently recorded below. `layout-readback.json` records three passing checks: desktop scroll width 1440, narrow width 800 with drawer closed and open.

### Explicit history readback failure

The original main suite's history receipt proved selected session identity, not message-tree replay. A stricter supplemental real-browser test (`history-readback.py`, preserved red `history-readback-red.json` and `.log`) created and completed a turn, clicked another session, then clicked the original session. Its exact session ID returned correctly, but both prior user and assistant messages were absent. The visible message area read “Send a message to start a conversation. Live responses appear here.” This was a **failed explicit card acceptance criterion**, not a missing-control observation. Console/page errors were both zero; `history-readback-failure.png` records the failure. Its fixture was stopped (`history-fixture-termination.json`). The user then authorized a targeted repair strictly within `apps/web/`.

### Root cause and authorized fix

`ConversationView` cleared items, usage, metrics, cache and Inspector observations on every session selection. Its existing API provides metadata and live SSE but no transcript hydration. Previously, conversation/tool/usage/Inspector callbacks also lacked the stale-connection guard already used for widgets/thinking.

The two-file Web repair retains a projection snapshot per API client and session in a WeakMap, saves the latest observed state when the stream closes, and restores it on selection/remount. It preserves drafts, tool pairing and the cleared-screen state; lazy initialization protects remount/StrictMode replay. A connection-generation check rejects stale callbacks even across A→B→A; widget replay keeps existing upsert semantics.

`replay-unit-red.log` preserves three newly added tests failing on the old implementation. `replay-unit-green.log`: 17/17 targeted tests pass, covering roundtrip/remount, StrictMode repeated cleanup/setup with retained refs, client ownership, tool/usage/Inspector state, draft isolation, widget deduplication, clear-screen and stale callbacks. `history-readback-green.json`/`.log`: the same browser reproduction now passes 4/4, zero browser errors. The final full walkthrough includes that regression assertion.

**Limit:** replay covers conversations observed during the current page visit. It does not reconstruct history after a full page reload or turns completed while that session's stream was disconnected. No server transcript persistence or hydration is claimed. No backend or core implementation was changed.

## Acceptance observations — no product changes

The user explicitly required this card to remain test-only and authorized testing the existing five Inspector tabs rather than adding the four historical tabs named in the card.

- Existing Inspector tabs: Swarm, Cognition, KV Cache, AST, Patch; all five were clicked and their corresponding content asserted.
- Existing permissions: read-only and workspace-write; full-access is absent.
- Empty task submission is disabled, rather than producing a validation alert.
- Reset default layout is absent.
- ChangedFiles, ToolActivity and Cost preferences persist, but have no separate module visibility in the current implementation. Eight other module/placeholder views have actual visibility assertions. Existing Context/Logs/MCP/Policy placeholders are not represented as implemented features.
- Coverage claims apply to the seven-area task matrix. This report does not claim an exhaustive inventory of every optional application feature.

## Supplemental authorized workbuddy test

`live-workbuddy.json`: connection probe, real model discovery and isolated provider save passed, with zero console/page errors. Discovery advertises `cn:` wire IDs. Both the user-supplied unprefixed model and discovered `cn:deepseek-v4.1-flash` conversation attempts ended with `kind=budget`, `finalText=maxConsecutiveErrors`; **a successful live model conversation was not proven**. Earlier results remain in `live-workbuddy-attempt1/2.json` and logs.

The supplemental script accepts the key only through `VESSEL_CARD219_KEY`. The provided key is absent from repository evidence. The live provider was removed through the isolated server API after each saved attempt; production provider state was not changed. No more live calls are scheduled.

## Repository gates

All final gates ran serially after the last source/test edit (latest edit 11:27:41 UTC; gates began 11:30:00 UTC). Authoritative command/exit receipts are in `final-gates.json` and `final-*.log`.

| Gate | Result |
| --- | --- |
| `npx vitest run --root apps/web` | exit 0; 34 files / 295 passed |
| `npx tsc -b` | exit 0 |
| `npm run typecheck:tests` | exit 0 |
| `npm run -w @vessel/web typecheck` | exit 0 |
| `npm run -w @vessel/web build -- --emptyOutDir false` | exit 0 |
| `npm run test:all` | exit 0; root 276 files / 2937 passed + 6 skipped; Web 34 files / 295 passed; total **3232 passed / 6 skipped** |

Earlier full-root run: **2936 passed, 6 skipped, one AST timing failure** (mean 25.461ms against ≤15ms); Web root was not reached because `test:all` uses `&&`. A targeted check also failed (mean 19.349ms, peak 39.497ms). These failures are preserved in `test-all-before-serial.log`, `gates-before-serial.json` and `ast-targeted.log`; no threshold or product code was changed.

The later pre-repair full run was interrupted when the user authorized the history fix; its partial logs/receipts remain in `test-all-interrupted-before-history-fix.log` and `gates-interrupted-before-history-fix.json`. It is not counted as a passed gate. The final unmodified AST criterion passed as part of the complete final root run.

## Scope and safety

The final `scope-audit.json` confirms zero changed lines/untracked files under `packages/core`, no backend diff, only the two authorized Web source/test files plus evidence/card/index/handoff changes, unchanged npm lock hash, no foreign lock introduced and unchanged HEAD. No dependency installation, commit, push, npm publication, external harness execution or repository deletion occurred. Existing HANDOFF/index changes were preserved; their current-card pointers were synchronized. All test-owned fixtures and browsers are stopped; temporary roots are retained. No next card was started.
