# Independent scoped UX review — 2026-10-23

Verdict: **changes required; UI-10 and the complete UI DoD are not signed off.** UI-06 visibly separates configured/add surfaces, and UI-04 source has distinct entity details and authoritative refresh after decisions. The reviewed evidence does not establish complete browser acceptance of those flows.

## Scope and method

Read the UI specification `docs/VESSEL_UI_UX_Review_and_Execution_2026-10-20.md`, completion report, current ActivityQueue, ProviderSettingsModal, ProviderHub, TaskComposer, GoalModule and related CSS. Applied `.agents/skills/visual-acceptance/SKILL.md` as an acceptance workflow. HEAD is `46b7291188db6f95303683a8016d5434b252d142`; source is the current uncommitted completion work, not that commit alone.

No browser state was changed, product code edited, tests executed, external agent CLI invoked, or tasks/HANDOFF changed. The sole authored file is this review.

Acceptance source: `evidence/sessions/2026-10-23-doc-completion/matrix-exact.json`. Read PNG IHDR dimensions directly for all **120** listed files: every PNG equals its declared width/height. All 120 recorded body/scroll widths equal viewport width. Earlier `matrix.json` and host-scaled captures are not acceptance evidence. The image viewer resized the 2560 images for display; findings below use original file dimensions and do not infer defects from that display resize.

## Findings requiring correction

1. **P1 — Provider modal focus trap includes hidden-view controls.** `apps/web/src/components/providers/ProviderSettingsModal.tsx:208` queries all enabled descendant buttons/inputs/selects, including the hidden add form at line 248. In configured mode, its calculated last control is the hidden Save button. Shift+Tab from Close attempts to focus that non-rendered element; forward Tab from the last visible configured control is not recognized as the boundary. The hidden attribute/CSS correctly removes the inactive view from normal layout/accessibility, but the custom trap bypasses that distinction. This is a source-proven trap defect, not a claimed live-browser reproduction. The modal remains reachable from TaskComposer, Conversation and Ctrl+K (`App.tsx:186`, 247, 251, 258). Filter to rendered/non-inert controls and verify both directions in configured/add modes, Escape and focus return.

2. **P2 — Mobile launcher controls escape their composer.** In `launcher-390-light-en.png`, `launcher-390-dark-en.png`, and `launcher-390-light-zh.png`, the composer ends near x374 while model, permission and Start task extend to x388. Right padding is lost and controls appear to cross the focus outline. This is present in exact 390×844 pixels in both themes/languages sampled; absence of document horizontal overflow does not establish containment. Relevant rules: `styles.css:1727` grid composer, `1738` flex options, `1778` mobile options, `1967` model trigger. Bound intrinsic flex/grid child widths and ellipsize model text; verify control bounding boxes against composer content box, not only body.scrollWidth.

3. **P2 — Goal enqueue control overflows or becomes vertical.** `conversation-1180-light-en.png` and `conversation-2560-light-en.png` show Enqueue protruding beyond the goal panel's right border. In `conversation-1920-dark-zh.png`, 加入队列 wraps one character per line despite ample page width. `GoalModule.tsx:215` and `.goal-composer` (`styles.css:1446`) provide a flex input/button without a reliable shrink budget. Give the input min-width:0 and preserve a nonshrinking readable button or stack at the actual panel width. This is a visible existing surface defect; it is not attributed to the new UI-04/06 logic.

4. **P2 — Readiness metric can claim model readiness without a selected model.** `TaskComposer.tsx:73–81` excludes failed/loading/unavailable states but does not require `selectedModel`. For an empty successful catalog, selection is empty, unavailable=false, and a project/health-ready surface emits `vessel:task-ready`. The report/JSON definition says model ready. Require an actual valid selected model, or explicitly define and separately label a fallback-ready path. A requestAnimationFrame callback also runs before the next paint; call this a state-ready/rAF mark, not proof the ready controls have already painted. Existing five warm samples (153.0–187.1ms) remain observations of that mark, not standardized TTI or a universal <500ms guarantee.

5. **P2 — Current provider source is newer than the screenshot proof.** Current `ProviderSettingsModal.tsx:227` always renders a catalog-state paragraph, and line 230 additionally renders the connection-status badge. The sampled configured screenshots show a single Not tested/尚未测试 badge and no catalog paragraph. Thus their visual acceptance cannot cover the subsequent ARCH-05 catalog state changes. Rebuild/reload and refresh affected provider captures after the final UI edit; retain the original generation as historical evidence or identify the replacement generation explicitly.

6. **P3 — Completed disclosure indicator is visually detached.** All four inspected Activity cells put the disclosure triangle on its own line and Completed count on a separate line with substantial space. `ActivityQueue.tsx:135` nests a block h4 in summary. Keep marker and heading/count on the same row and preserve native keyboard disclosure behavior. This weakens discoverability of folded completed entries.

7. **P2 — Disabled approval transport has no user-facing reason.** `ActivityQueue.tsx:116`, 124–125 correctly disable actions if transport is absent, but show only Approve/Reject labels with no read-only explanation or linked disabled reason. UI-04 permits disabling to prevent fake approval; UI-10 additionally requires an understandable reason. Add localized read-only/unavailable feedback when this state can be shown. This is source review; the supplied matrix contains no pending approval to inspect visually.

## Positive evidence and boundaries

- The 19 visually inspected cells collectively cover all six widths, both themes/languages and all five surfaces. Wide conversation content keeps a readable column. Sampled provider configured/add views are distinct; API key is masked, and add key input is password type. No secret is reproduced in this review.
- Provider view selectors use `role="group"` and `aria-pressed`; inactive sections use native hidden plus an explicit CSS display:none override. Do not require tab semantics for these ordinary toggle buttons. Form fields have associated labels; key hint uses aria-describedby. Shared errors are outside hidden sections with role=alert. These checks do not resolve the separate custom focus-trap defect.
- Activity session navigation is restricted to session kind. Team/subagent/goal details use native details/summary with entity-specific fields. Error feedback is role=alert, decision receipts role=status, duplicate decisions are guarded synchronously, and refresh is awaited. Source does not justify claiming browser approval convergence has passed.
- The real conversation screenshots show Read/Write and a denied Shell with text status/error, which is useful execution/error evidence. A policy-denied tool is not an actual pending approval/decision flow, and is not a Diff review screenshot.
- `keyboard-zoom.json` records drawer/palette Escape/focus return but only compact before/after states; this reviewer did not operate them independently. It supplies no provider modal trap evidence.

## Inspected screenshot paths

All paths below are relative to `evidence/sessions/2026-10-23-doc-completion/` and were opened using view_image:

```text
launcher-390-light-en.png
launcher-390-dark-en.png
launcher-390-light-zh.png
launcher-800-dark-zh.png
launcher-1440-dark-en.png
conversation-390-dark-zh.png
conversation-1180-light-en.png
conversation-1920-dark-zh.png
conversation-2560-light-en.png
activity-390-light-en.png
activity-800-light-zh.png
activity-1440-dark-zh.png
activity-2560-light-en.png
providers-configured-390-dark-zh.png
providers-configured-1180-dark-en.png
providers-configured-1920-light-en.png
providers-add-390-light-en.png
providers-add-800-light-en.png
providers-add-2560-dark-zh.png
```

The **other 101 matrix cells were dimension/metadata checked only**, not visually inspected. A screenshot below the fold does not prove scroll reachability or keyboard access to content below its captured viewport.

## Acceptance limits and next verification

Do not close UI-10 or UI §11 U-DOD-10/11/12 from this review. Correct the findings, then provide final-build affected screenshot/keyboard evidence. UI-04 additionally needs actual expanded team/subagent/goal details plus pending approval → decision → refreshed authoritative result, rejection/error retention and unavailable-transport explanation. The matrix's Activity state is completed-only. Actual Diff, failure/recovery and full E2E-01..14 coverage are not established by these 120 static cells. This is an evidence limit, not a claim those features are absent; no fresh implementation TODO is inferred for them.

True 150%/200% browser zoom remains **unverified**: recorded shortcuts did not change innerWidth/DPR/visualViewport scale. Viewport narrowing and image scaling are not substitutes. Full WCAG AA contrast measurement, screen-reader announcement behavior, all keyboard paths and 20+ live tool-call readability are outside this scoped review. No full dual-root test/build gate is signed here.

Independent UX reviewer signature: **scoped review completed; approval withheld pending the findings and missing acceptance evidence above.**

## Final independent scoped re-review — 2026-10-23

**Final verdict: the seven findings above are addressed within the reviewed scope; scoped UX acceptance granted for these repairs. Full UI-10 / complete UI DoD remains partial.** This final section supersedes the initial withheld verdict for the enumerated repairs, while retaining the initial observations as historical evidence.

### Repair verification

1. Provider modal trap now filters descendants of `[hidden]`. `final-modal-focus.json` records backward wrap to visible Delete, forward wrap to visible Close, and return to Configure new model. This closes the concrete hidden-add-view trap. These are supplied interaction records, not independent browser operation by this reviewer; the JSON does not document every add-mode focus path.
2. The final `launcher-390-light-en.png` visibly contains model, permission and Start within the composer padding, with a truncated long model label. Source constrains flex children and the model-switcher width. Mobile overflow finding closed in this sample, supported by final matrix containment records.
3. The final `conversation-1920-dark-zh.png` shows a horizontal readable 加入队列 button within the panel; `final-diff-accepted-1440-light-en.png` shows a contained English Enqueue button. Source gives the input min-width:0 and button nonshrinking/no-wrap behavior. Goal-control finding closed in these samples.
4. Readiness mark now requires `selectedModel`; its source comment accurately calls it a state-ready animation frame and separates paint measurement. `performance-accepted.json` has 24 samples, raw mark range **130.9–280.5ms**. `performance-visible-summary.json` computes max(mark,FCP), **148.0–280.5ms**. This is a useful conservative combination of the two observed timestamps; FCP does not prove these particular ready controls painted, so it remains an observed lower bound rather than an interactive/painted-ready SLA. The original metric overclaim is closed with that qualification.
5. Final configured screenshots now show catalog freshness/verification time separately from connection status. `final-provider-real-verification.png` shows verified catalog plus Connected latency; `final-provider-injected-stale.png` shows retained saved configuration, stale catalog and HTTP503 connection failure. `provider-stale-proof.json` explicitly identifies real initial discovery versus intentionally injected second `/models` failure. Final source and these captures agree; prior screenshot-generation mismatch closed.
6. Final `activity-2560-light-en.png` keeps Completed disclosure marker and count on one row; source adds inline h4 styling scoped to that summary. Disclosure finding closed.
7. Activity now renders localized `activityDecisionUnavailable` explanation for an approval with no available transport. Source verification closes the missing-explanation finding; no independent screenshot of that unavailable state was supplied in this final sample.

### Final evidence checks and sampled paths

Rechecked all 120 PNG IHDR dimensions against **`matrix-accepted.json`**: 120 match, no missing/mismatched dimensions. Final JSON records zero containment-issue cells and zero contrast-failure cells. The recorded text-contrast checks are limited computed-style checks; they are not full WCAG certification or an independent pixel/background-compositing contrast audit. This re-review did not visually re-audit all 120 cells.

Opened these final matrix cells with view_image (same filenames have been refreshed since initial review):

```text
launcher-390-light-en.png
activity-2560-light-en.png
providers-configured-390-dark-zh.png
providers-add-390-light-en.png
conversation-1920-dark-zh.png
```

Opened these additional files under `evidence/sessions/2026-10-23-doc-completion/`:

```text
final-ui04-current-entity-details.png
final-ui04-current-approvals-converged.png
final-ui04-entity-details-1440-light-en.png
final-provider-real-verification.png
final-provider-injected-stale.png
final-topic-partial-failure-1440-light-en.png
final-topic-partial-persists-after-reload.png
final-topic-recycle-scope-confirmation.png
final-topic-confirmation-readable.png
final-diff-accepted-1440-light-en.png
```

The initially supplied `final-topic-recycle-scope-confirmation.png` still clipped scope text/controls. The follow-up **`final-topic-confirmation-readable.png`** corrects that: full group/session count and Recycle Bin intent wrap inside the sidebar, Confirm/Cancel are visible, and source makes the confirmation group wrap. This later image is acceptance evidence for the confirmation; the earlier clipped image is historical only.

`final-topic-partial-failure-1440-light-en.png` displays a specific failure and Retry while preserving the failed topic; the post-reload screenshot retains that topic. `final-runtime-proof.json` records a/c absent from index/directory and b retained in both. This supports the bounded disposable-fixture partial-failure scenario; screenshots alone are not proof of OS Recycle Bin contents. `final-disk-recheck.json` records a later-generation disk recheck and expressly distinguishes fixture generations.

Final UI-04 screenshots show expanded subagent error/provider/timestamps and goal acceptance, then a decision-submitted receipt with pending work removed. Runtime proof records the team as rejected/cancelled and session with needsApproval=false. This improves the earlier completed-only evidence substantially. The subagent failure is explicitly injected and no external agent ran; fixture approval is explicitly labeled as not dispatching a write. Team rejection/approved widget evidence therefore validates the bounded real-endpoint fixture flow, not live heterogeneous child-agent execution or every real approval lifecycle. An expanded team-detail screenshot was not independently inspected in this sample.

`final-diff-accepted-1440-light-en.png` now shows actual Changes/Patch content, before/after lines, accepted status and Revert hunk affordance. Runtime proof records `after\n` on disk. This establishes the supplied fixture Diff state rather than a concept screenshot; it does not independently exercise every accept/revert/reapply failure path. `final-inspector-keyboard.json` records inspector closed with focus returned to Open Inspector at 800 and 390; it is a supplied endpoint snapshot, not a full keyboard trace.

### Remaining acceptance limits

True browser 150%/200% zoom remains **unverified**. Native OS IME, screen-reader behavior, all keyboard/overlay paths, exhaustive AA contrast, 20+ live tool-call readability and the complete E2E-01..14 set are not newly certified here. External agent CLI/version compatibility and platform sandbox behavior are outside this UX signoff. This reviewer ran no tests/full test:all and does not sign the aggregate build/test gates.

The final matrix and sampled repairs support scoped responsiveness, Provider separation, Activity detail/decision presentation, fixture partial deletion and fixture Diff review. They do not justify changing the completion report's UI-10 partial status to full completion.

Independent UX reviewer signature: **scoped repairs accepted; full UI-10 / complete E2E and native-platform acceptance explicitly remain open at their documented boundaries.** No product edits were made by this reviewer.
