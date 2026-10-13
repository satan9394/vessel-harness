# Card 218 independent adversarial review

Review scope: task card 218; UI plan sections 0, 2–6 and 10; current Web source diff, TaskComposer and its tests, palette, responsive styles, screenshot script and available browser evidence. No source edits, services, external agents or commits were performed. Browser probes reused the already running isolated fixture at http://127.0.0.1:31828. Pending-creation probes intercepted all mutation requests locally, so no task was executed by the fixture.

## Findings requiring repair

1. **[P1] Keep pending creation owned above the disposable composer.** `apps/web/src/components/TaskComposer.tsx:49–54` stores the only submission lock locally and invokes `onStarted` even after unmount. `apps/web/src/App.tsx:160` permits selecting a historical session while creation is pending, which unmounts that composer; New Task mounts a fresh, unlocked composer. Reproduction: hold the first POST `/api/sessions`, select an existing session, choose New Task, enter the same task and submit again. The independent Playwright probe observed held creates increase from **1 to 2** while the first request was still pending. The old completion also retains the callback at App.tsx:186, which can override the user's subsequent navigation and begin its initial turn. Retain pending ownership in App or prevent the navigation that discards it; completion must not silently hijack a newer selection. Add a delayed-response interaction regression, including switching to another session and returning to New Task.

2. **[P2] Move and contain keyboard focus in the narrow navigation drawer.** `apps/web/src/App.tsx:147–167` opens an overlay drawer but leaves focus on the hamburger, does not trap focus, and leaves main interactive. Reproduction at 800×900: focus hamburger, press Enter, then Tab. Actual probe: drawer visible=True; active class after opening=`btn navigation-toggle`; after Tab, Commands receives focus with `inNavigation=false`, `inMain=true`. Keyboard users therefore continue through controls behind the overlay instead of reaching the navigation they opened. Focus the first drawer control, contain Tab navigation while modal, and restore trigger focus on close; cover Enter/Tab/Shift+Tab/Escape in an interaction regression. Existing browser evidence only checks click and Escape visibility.

## Evidence assessment

- Task-first happy path, selected permission, semantic palette and local-only visibility changes have existing browser interaction evidence. The new static/function tests verify helper ordering and markup, but cannot catch pending creation lifecycle or focus defects.
- Model catalog refresh preserves a missing selection and disables submission rather than silently choosing another model; no actionable fallback defect was found in this review.
- The inspected English 800px Retina screenshot has a readable task hierarchy and avoids fixed sidebar compression.
- Screenshot generation fails closed on missing expected views and records seven viewport widths for each language. Its overflow assertions concern the home composer only; they do not prove narrow session/drawer interaction or 200% text scaling. This is an evidence limit, not a claim of an additional product defect.

Conclusion: request changes for the two reproduced defects. Changes: review report only. Verification: independent browser reproduction plus source/test review. Next steps: repair both findings and rerun their interaction checks before final source-dependent gates.

## Independent follow-up after first repairs

- **P1 resolved.** Reviewed parent-owned `taskStarting`, inert session navigation and guarded Sidebar/palette/Activity actions. Rebuilt fixture probe held POST `/api/sessions`, attempted Sidebar selection programmatically and palette selection, and verified the composer remained present/disabled with exactly one held create. Fulfilling creation with 500 restored navigation and preserved the task draft plus visible error. No fixture mutations were forwarded.
- **P2 remains open at the actual focus boundary.** Initial drawer focus and Escape restore now pass, and main is inert. However, the reused `trapFocus` in `apps/web/src/components/common/CommandPalette.tsx:16` collects all matching buttons, including buttons inside closed topic-action details, and omits their focusable `summary` elements. Its calculated last control is therefore hidden rather than the last tabbable element. On the rebuilt 800px fixture, independent forward Tab traversal escaped the drawer on **cycle 27**, with `document.activeElement` becoming `body`; the next Shift+Tab also remained outside. The supplied 16-cycle check stops before this boundary. Use actually tabbable visible controls (including summary) and test the real forward/backward boundary rather than a fixed short cycle count.

Follow-up verdict: request changes remains for P2 only. P1 independently verified fixed; no additional pending-creation defect identified.

## Final independent verification after focus repair

Reviewed the shared focus helper's inclusion of summaries and exclusion of hidden/inert/closed-details/zero-rectangle controls, with explicit forward/backward cycling. Verified the rebuilt fixture serves `/assets/index-jwdRHo9Z.js`.

- 800×900 drawer: keyboard Enter moves focus inside; **100 forward Tab + 100 reverse Shift+Tab** cycles all remain inside; Escape closes and restores hamburger focus. PASS.
- Shared helper regression: Command Palette **30 forward + 30 reverse** cycles remain inside; Escape restores originating focus. PASS.
- P1's prior independent held-request/failure-draft verification remains valid; the final repair changes only the shared focus helper.

**Final scoped review verdict: PASS. Both actionable findings are resolved and independently verified.** This review does not substitute for the parent session's final full test/build gates. Changes: review report only. Verification: source review and independent built-browser regressions. Next steps: finish final source-dependent gates and card closeout.

## Final delta applicability

Reviewed the subsequent App-only import/render restoring `<SubagentWorkspace api={api} />` under Activity. It reuses the existing API-backed global subagent list/detail/cancel controller; its watcher closes on unmount. This relocation preserves the existing entry point without claiming unsupported Project/Session/Run parent association. No actionable defect found in this delta. Prior creation and focus findings remain resolved; **scoped PASS applies to the final source/build `index-qf0QG-gs`** by inspection of this limited subsequent delta. The independent browser regressions above ran on `index-jwdRHo9Z`; final-build full gates and browser runs belong to the parent session.
