# Card 218 delivery proof

Source of truth: `docs/plans/Vessel_Web_UI_UX_Improvement_Plan.md` (VESSEL-UI-2026-01). Mode: standard. Baseline: local main `644217170fd689861e3a3625930607bdee7b4fa1`.

## Changes and evidence

- Workbench / Activity / Agent Studio / Settings navigation, project-grouped readable sessions, optional advanced creation and an inline Project → Task → Start composer. Existing session/turn APIs remain the execution source.
- Task startup carries model and permission to the backend; deterministic task-summary titles avoid an extra model call. Empty input is blocked, missing model selections do not silently fall back, creation failure retains the draft, and first-turn failure remains editable without automatic retry.
- Palette groups system operations, recent projects and active sessions. Search retains technical IDs as internal keywords while labels omit IDs and absolute paths. Collapsed groups are excluded from keyboard targets.
- Layout remains browser-local visibility preferences. Pending creation owns navigation; changing primary areas preserves the mounted conversation. Sample tool/file/cost rows were removed. Existing global subagent monitor/detail/cancel controls moved from Sidebar into Activity.
- At ≤800px the navigation becomes a drawer, main content becomes inert while open, focus cycles through visible controls, and Escape restores its origin. Header settings are consolidated into Preferences/Settings.

Browser evidence: `browser-checks.json` / `browser-checks.log`, against the final production build `index-qf0QG-gs`. Checks cover exactly one created session and turn, read-only permission at the backend, navigation preservation and Activity subagent entry, no backend mutations from Layout, palette search/keyboard, pending creation/failure, failed first turn, 100 forward and 100 reverse drawer Tab cycles, focus restore, and no runtime errors. Independent review: `independent-review.md` (PASS; reproduced findings and repair history retained).

Screenshot evidence: `screenshots.log`, `screenshot-checks.json`, and `docs/screenshots/{zh,en}/01..06*.png`. All 12 Retina captures refreshed from a clean isolated fixture. Both languages pass homepage horizontal-overflow assertions at 375×812, 390×844, 768×1024, 800×900, 1024×768, 1280×800 and 1440×900. Rendered desktop/composer, palette, Layout and 800px images inspected. This is local fixture evidence, not live provider delivery or native OS notification evidence.

## Final gates

| Command | Evidence | Result |
|---|---|---|
| `npm run -w @vessel/web test` | executor-web-tests.log | exit 0; 34 files / 291 passed |
| `npm run -w @vessel/web typecheck` | executor-typecheck.log | exit 0 |
| `npm run -w @vessel/web build -- --emptyOutDir false` | web-build.log | exit 0 |
| `npx tsc -b tsconfig.json` | tsc-build.log | exit 0 |
| `npm run typecheck:tests` | typecheck-tests.log | exit 0 |
| `npm run test:all` | test-all.log | exit 0; root 276 files / 2937 passed + 6 skipped; Web 34 files / 291 passed; total 3228 passed + 6 skipped |
| Python screenshot generator | screenshots.log | exit 0; 12 refreshed images / 14 viewport checks |
| Browser interactions | browser-checks.log | exit 0 |
| `git diff --check` | diff-check.log | exit 0 |

`test-all-before-final-focus.log` records an earlier complete green run, and `test-all-interrupted-before-activity.log` records the superseded interrupted run. Neither is used as the final gate. `browser-checks-before-text-fix.log` is a test-wrapper text-normalization failure, not a product gate; retained for provenance.

## Scope and reproduction

`scope-audit.json` records source hashes, baseline and changed paths. `packages/core` has zero changed lines. Root package-lock SHA-256 remains `659c785c9c276761f9d88271bc2fd2365a9fe218ab4aca4c989d73790d82e24d`; no dependency or package-manager changes. No commit, push, publication, permanent deletion or external harness execution.

To reproduce browser evidence, first confirm port 31828 is free, run `npx tsx evidence/sessions/2026-10-12-card218/browser-fixture.ts`, then run the same directory's `browser-checks.py`. Use the Anaconda `claude` Python environment with Playwright already installed. For captures set `VESSEL_SCREENSHOT_URL=http://127.0.0.1:31828` and run `python scripts/generate-screenshots.py`. Fixture state is isolated under a test-created system temporary root; real Vessel provider/session/usage/project state is not used. The script records the chosen port and fresh metadata.

Agent Studio exposes existing read-only cognition data, with editing/compile verification explicitly gated on future backend contracts. Activity uses actual session metadata and global subagent data; the existing subagent API does not provide parent Run IDs, so no parent association or unified cross-project Run state is fabricated. Full Studio Composer, unified Run aggregation and native system scaling are outside this P0 delivery.
