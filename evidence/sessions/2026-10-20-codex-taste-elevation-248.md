# Task 248 — Taste workbench audit and implementation

Result: requested gates passed; local changes await user acceptance. No commit, push or publication.

## Design basis and scope

Read the local Taste-Skill and its app-screens, layout, tells and critique references. This is an application screen, so the app-screen rules apply: functional hairlines, dense controls and flat repeated sections are appropriate; marketing-page picture/motion requirements do not apply. The user's explicit requirements govern edge-to-edge geometry and subtle button shadows. Existing React/Vite/plain-CSS stack and loaded Geist font are retained; no dependencies added.

Question: which project/session needs work, what happened, and what action can I take next? Vessel's identity is its project → session → run hierarchy, plan and execution inspector. Keep those objects visible rather than adding decorative dashboard content. Card 235 had already removed the outer floating shell; task 248 refines the remaining inner surfaces and interaction defects.

## Audit findings and changes

1. **Control hierarchy broke on hover.** The shared `.btn:hover:not(:disabled)` selector outranked primary/danger rules, replacing semantic fills with a neutral surface. Explicit variant selectors now preserve contrast. Buttons have a visible border/background, subtle control-only shadow, pressed state and keyboard focus. Ghost operations, project switching, command disclosure and code-copy controls have real surfaces. Topic actions no longer fade at rest. Coarse-pointer controls grow to 44px. Light primary blue is `#0969da`; dark is `#79b8ff`, with theme-specific foregrounds. Active model mode also uses the theme foreground.
2. **Inner modules still read as isolated cards.** Plan and module sections now use square, flush sections and functional 1px dividers. Provider registry entries become flat rows. The existing full-viewport outer shell remains zero-gap/zero-padding, with square structural panels. Compact input/object controls retain modest radii; popovers retain overlay shadows. Scroll-edge masks and residual backdrop blur are removed so content is not faded away.
3. **Markdown had nested code chrome and weak hierarchy.** Generic `.msg-body code` styling added another border/padding layer inside fenced blocks. Fenced code now inherits its containing preformatted frame, with bounded horizontal overflow and 16px padding. Assistant answers use a continuous reading surface, 14px text/1.75 leading, 22/18/15px headings, underlined links, quotation color bands, and readable code headers/copy buttons. Summary metric labels use sentence case. Existing safe renderer/parser and OpenUI behavior are retained.
4. **Approval operations lacked semantic distinction.** Activity denial buttons use the danger variant; other decisions use secondary controls. No approval workflow changes.
5. **Stored credentials.** `ProviderSettingsModal.testDirect` still sends the saved provider's name and an empty API key; it never submits the masked placeholder. Existing ProviderHub tests verify this path. No real credentials were read or sent and no real provider call was made.
6. **Deletion acknowledgment was untruthful despite card 234's closure record.** The server previously removed the index and returned success while recycling ran in the background with errors discarded. It now waits for recycling, preserves controller/index on failure, and returns `session_recycle_failed`. A per-session guard prevents competing mutations/deletions; tracked REST turns are interrupted and settled before recycling. Busy non-REST/team runs are rejected. Successful deletion releases controller handles. The existing Windows recycler still uses Microsoft.VisualBasic FileSystem with SendToRecycleBin. No real user session was deleted.

## Visual evidence and measurements

Browser: isolated Chrome Agent Windows via browser-skill. Built-in browser inventory was empty. Initial baseline is `2026-10-20-codex-taste-elevation-248-before.png` (906px, disconnected state); it is not a matched-data screenshot comparison. Final screenshots use the production Web bundle served by the isolated offline fixture at port 5678. Vite port 35148 was used during implementation. Both ports were checked free before startup. The fixture uses temporary session/project/provider/usage/review roots and a deterministic MockProvider; its source is retained beside this report.

- Desktop 1440px: `*-final-home.png`, `*-markdown-light.png`, `*-markdown-dark.png`, `*-final-settings-light.png`, `*-final-settings-dark.png`, `*-final-activity-dark.png`.
- Narrow 390px: `*-mobile-light.png`, `*-mobile-dark.png`, `*-mobile-drawer-dark.png`; 768px: `*-tablet-light.png`, `*-tablet-dark.png`.
- Actual desktop and mobile drawer theme buttons were clicked in both directions; labels and rendered theme changed. Mobile navigation opened as a dialog and closed back to the workbench.
- At 1440px the app starts at (0,0), with no outer gutter; document width is 1440px. At 768px document width is 768px.
- Long-code stress: replace the fixture's code text with a 500-character line. At 390px, document width remains 390px, code frame client width is 364px, internal scroll width is 3414px, and copy-button height is approximately 44px. This is a deliberately mutated browser fixture, not user content or a source change.
- Screenshot review: shared work surfaces and aligned dividers replace the remaining module islands; answers have a stronger heading/paragraph hierarchy; buttons remain recognizable in both themes. Inspector and long answers retain their intentional scrolling regions.

Taste source lint: **0 FAIL / 38 WARN** (`*-taste-lint.log`). Warnings remain for shadows (controls explicitly requested by the user, focus rings and real overlays) and monospace contexts (code, tool payloads, identifiers and existing diagnostic metrics). This is a source heuristic, not a measured contrast/accessibility certification. The bundled inspector was not run: its browser helper sweeps/deletes temporary profiles, including profiles it did not create this run, which conflicts with this workspace's cleanup boundary. Chrome screenshots and explicit browser measurements were used instead. No invented aggregate design score or all-routes certification.

## Verification

After the final source/test edit:

- `npx vitest run apps/local-server/src/server.test.ts`: **28 passed** (`*-recycle-final.log`). New cases cover delayed acknowledgment/index removal, competing mutation/deletion rejection, failure preservation/retry, and settling an interrupted writer before recycling. Recycler completion/failure is mocked; tests do not invoke the OS recycle bin.
- `npx vitest run --root apps/web`: **51 files / 413 passed** (`*-web-tests.log`). Includes provider, sidebar, conversation, composer and theme coverage.
- `npx tsc -b`: **exit 0** (`*-tsc.log`).
- `npm run typecheck:tests`: **exit 0** (`*-test-types.log`).
- `npm run -w @vessel/web build -- --emptyOutDir false`: **exit 0** (`*-build.log`). Extra flag preserves old generated assets under the no-permanent-delete rule.
- `git diff --check`: exit 0. `git diff --numstat -- packages/core`: empty, **0 changed lines**.

An additional whole-repository run (`*-all-tests.log`, before the final deletion corrections) finished with **3044 passed / 6 skipped / 2 failed** across 290 root test files; its `&&` chain did not reach Web. Failures: `process-tree.test.ts` pre-spawned grandchild enumeration assertion, and `virtualProxy.test.ts` descendant timeout cleanup with access denied. Existing docs describe historical Windows process-tree issues, but those records do not prove this run is flaky. These runtime failures are outside this task's changed files; this report does **not** claim the full repository suite is green. The requested four gates and focused deletion tests were rerun after final edits.

## Independent review

Read-only GPT-6.1 Sol review identified missing command disclosure states, potential code-width expansion, coarse-pointer target sizing, and the recycling concurrency window. These were addressed. Final review reported no remaining high/medium findings in the CSS or revised deletion diff. Review did not substitute for the deterministic gates or OS recycling proof.

## Boundaries and next step

No core changes, dependency/lockfile changes, PDW config edits, external agent CLI calls, commits or publication. Pre-existing launcher/prompt/log files and concurrently appearing task 249 files were left intact. Temporary fixture data is retained, not deleted. Real provider connectivity and an actual Windows recycle-bin operation were not exercised. User acceptance can review the screenshots and the four source-file diffs; the two root runtime failures remain separately visible.
