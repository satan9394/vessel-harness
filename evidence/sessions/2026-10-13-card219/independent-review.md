# Card 219 independent evaluation

Review scope: task 219, user clarifications, browser fixture, click walkthrough, available JSON receipts, and supplemental live model script. Evaluator did not execute live endpoint requests or modify product code.

## Current disposition

**PASS for the fully clarified card.** The user authorized a targeted apps/web-only history replay repair. Final `click-attempt-12.log` / `click-results.json` contains 77 passing receipts, including restored user messages and exactly three completed assistant messages after switching away/back, with zero captured browser errors. Supplementary `history-readback-green.json` also passes the same previously failing user/assistant readback criterion. The original supplementary failure remains red evidence. Repair source review finds no concrete blocker; the evaluator independently ran `npx vitest run --root apps/web src/components/ConversationView.attention.test.tsx`: 17/17 passed. Final post-edit gates and scope receipts were inspected and pass as recorded below. This PASS retains the documented missing controls, page-lifetime history limit, and failed supplemental live conversation; it does not claim those limitations were repaired.

## Findings sent to executor

1. Initial navigation assertions only checked `aria-current`; strengthened script now checks the destination heading or visible workbench.
2. Initial Inspector assertions only checked selection and any visible panel; final script checks each tab's corresponding heading and explicitly asserts exactly five current tabs. Attempt 11 passes all six related receipts.
3. Initial command category assertions only checked palette closure; strengthened script now checks provider modal, selected composer project, or exact session identity.
4. Initial Customize assertions only checked checkbox values. Strengthened script checks persisted preferences and available module visibility. ChangedFiles, Cost, and ToolActivity deliberately return no separate module in the current App; their display gap must remain an observation, not a claimed visibility pass.
5. Attempt 10 reused rejected second-hunk state and proved Reapply/Revert rather than Discard. Resolved in fresh attempt 11: script requires `pending`, clicks exact `Discard hunk`, and requires `rejected`. The final mutation sequence is hunk-0 accept, hunk-1 reject, hunk-0 reject, without hunk-1 reapply. Exact pending Discard is now proven.
6. The seven matrix areas do not enumerate literally every interactive control in apps/web. Do not claim an exhaustive application-wide inventory unless additional controls are enumerated and exercised. Examples outside the present walkthrough include language/attention preferences and sidebar rename/archive. An earlier provider Edit/Use example was incorrect and removed after checking the actual modal source.
7. **Original acceptance failure: historical messages did not reload.** The supplementary fresh-fixture test first verified a real completed turn with both user sentinel and fixture assistant response present. It then clicked a different historical session and returned by the created session's title, requiring the original exact session ID. A bounded 5-second assertion found neither message; visible text was the empty-conversation prompt. The failure receipt and screenshot establish message absence rather than conflating session selection with message restoration. Keep this red evidence visible and require the same criterion to turn green after repair.

## Authorized targeted repair review

- Changes reviewed are ConversationView and its existing callback/lifecycle tests in apps/web. No backend/core product changes are involved in the reviewed diff.
- A WeakMap keyed by the page's ApiClient owns per-session observations, drafts, usage, cache and Inspector data. This prevents cross-client/session cache reuse. Replay is explicitly page-lifetime only; reloads, unseen server turns and historical sessions never observed in this page cannot be hydrated without a server transcript API.
- Snapshots preserve immutable state references; existing item/usage/thinking reducers create new values. Pending-tool tracking is copied when saving/restoring, avoiding shared mutable record state. Widget replay uses the existing upsert path, with duplicate-widget and tool-completion assertions.
- Closed stream callbacks now require both a live connection and matching session generation, including A-to-B-to-A returns. Existing in-flight runTurn and widget-response completion guards remain in place.
- Lazy state initialization from saved observations also initializes the latest-state ref before effect cleanup. An initial draft that initialized empty state before effect restoration had a StrictMode remount risk; the current source resolves that issue. The node lifecycle harness is useful callback proof, while real browser verification is still required for React effect behavior.
- The 17 passing targeted tests include message/reasoning/tool/widget/usage replay, stale callbacks, unmount remount, client isolation, draft isolation and cleared-screen preservation. This is targeted validation, not the complete repository gate result.
- Final browser attempt 12 adds the previously missing history assertion: original task, click-send and Enter-send user text all return, and exactly three fixture assistant messages replay once. The separate history readback also turns green with empty console/pageerror collections. The layout supplement observes document width equal to viewport at 1440px and 800px, including the open narrow drawer.

## Positive checks

- Chromium listeners attach before initial navigation. Every `console.error` and `pageerror` is captured without filtering, and a final hard assertion rejects any collected error.
- Browser clicks operate a real local-server serving the built web app. No Playwright route interception fabricates API success.
- Provider, usage, session, project registry, and patch workspace state belong to a generated system-temp fixture. Provider persistence/deletion uses API readback and credential metadata checks; no credential value is written to receipts.
- Fixture request logging redacts `apiKey`; supplemental live script takes its key from an environment variable and redacts it from errors and results.
- Missing reset/full-access controls and historical Inspector wording are documented as observations; no product implementation was changed for them.
- Supplemental live evidence currently reports successful connection probe, model discovery, and isolated save, followed by `turnKind=budget`, `assistantText=maxConsecutiveErrors`, `passed=false`. This must not be represented as a successful real model conversation.

## Acceptance rule

Only completed browser coverage of the explicit clarified card criteria with zero failed assertions and zero captured errors, the requested post-edit gates, core-zero and lock checks, and an honestly bounded PROOF can support verified delivery. Retained red attempts are useful diagnostic evidence and must not be substituted for final passes. The historical-message failure has now been repaired and retested for observations captured during this page lifetime.

## Final gate and scope audit

- `final-gates.json` contains exit 0 for separate Web tests, `npx tsc -b`, `npm run typecheck:tests`, Web typecheck, Web build with `--emptyOutDir false`, and full `npm run test:all`.
- Inspected full-test log: root 276 files, 2,937 passed plus 6 skipped; Web 34 files, 295 passed. Separate final Web test log also reports 295 passed. Final gates start after both modified Web files' last-write timestamps.
- Current git diff confirms only ConversationView and its existing test file changed in product source; core, local-server and application diffs are empty. `scope-audit.json` records zero core changed lines/untracked files and no unauthorized source diff.
- Inspected npm lock SHA256 matches baseline `659C785C9C276761F9D88271BC2FD2365A9FE218AB4ACA4C989D73790D82E24D`; audit reports no foreign lock introduced and unchanged HEAD. Test fixture port listeners are zero after termination.
- Supplemental workbuddy conversation remains failed (`budget` / `maxConsecutiveErrors`), while probe/discovery/save passed. No successful live model conversation is inferred from the deterministic fixture or final repository gates.
