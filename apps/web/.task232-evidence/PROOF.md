# Task 232 implementation evidence

Scope: `apps/web/` and the Lark entry in `packages/application/src/providers/presets.data.ts`. Existing unrelated worktree changes were preserved. No commits, pushes, publishing, external agent calls, or file deletions.

## Delivered

- Settings renders `ProviderHub` directly across the available work area. Page and shortcut dialog share the existing provider workflow through embedded rendering; only the dialog traps/restores focus. Legacy exports, field IDs, and existing action text remain available.
- Configured cards show masked keys, model counts, capability details, explicit untested/test-result status, deletion confirmation, and retesting. Retesting requires a re-entered key because the API does not expose saved credentials; it does not overwrite the saved key.
- Model picker supports case-insensitive substring search, clear/Escape, All/Selected/Unselected filters with counts, atomic filtered select/deselect/invert, a bounded feathered scroll region, default stars, manual IDs, and busy states. Bulk operations preserve selections outside the filter and retain their order.
- Lark entry matches the supplied definition in both catalogs. Existing catalog parity tests pass; the gallery contains 72 presets.
- Added regression coverage for filtered bulk operations, manual selections, 400 candidates, page semantics, live preset changes, Lark save/default ordering, and saved-provider retesting.

## Checks after final source edit

- `npm run test:all`: exit 1; root **287 files passed / 2 failed; 3061 tests passed / 2 failed / 6 skipped** (`test-all.log`). The command short-circuited before its web leg.
- Separate final `npx vitest run --root apps/web`: exit 0, **48 files / 396 tests passed** (`web-tests-final.log`).
- `npm run -w @vessel/web build -- --emptyOutDir false`: exit 0, no build warnings (`web-build.log`).
- `npm run typecheck:tests`: exit 0 (`typecheck-tests.log`).
- `npx tsc -b tsconfig.json`: exit 0 (`tsc-build.log`).
- `npm run -w @vessel/web typecheck`: exit 0 (`web-typecheck.log`).
- `git diff --numstat -- packages/core`: empty; core changes exactly 0 lines.
- `git diff --check -- apps/web/src packages/application/src/providers/presets.data.ts`: exit 0.

### Blocking root gate

Both failures reproduced in an isolated run of the two runtime test files: **21 passed / 2 failed**, exit 1 (`windows-isolated.log`).

1. `packages/runtime/src/sandbox/backend/process-tree.test.ts:350`: the real Windows pre-spawned grandchild was absent from the enumerated tree.
2. `packages/runtime/src/proxy/virtualProxy.test.ts:187`: the Windows `taskkill` cleanup helper returned an error (legacy-encoded stderr).

`git diff --numstat` is empty for both runtime test files, `virtualProxy.ts`, and `packages/core`. These failures are outside this contract's source scope and were not bypassed or patched. Prior records in `docs/product-evolution/EVALUATION-REPORT-18.md` caution against assuming this test is merely flaky; the isolated reproduction is therefore recorded as a real unresolved gate. The exact environmental/runtime cause is not proven. Full acceptance requires these two Windows tests to pass in the acceptance environment.

## Browser evidence

Browser-skill Chrome session `mabs`, own Agent Window; Vite `127.0.0.1:5173`, existing backend `127.0.0.1:5678`. Session stopped after verification.

- Settings click directly exposed a region headed Model settings, registry, searchable preset gallery, and editor, without a dialog.
- Selecting Lark filled `lark`, the requested Ark endpoint, and the requested Doubao model.
- On the 390px mobile viewport, searching `DOUBAO`, deselecting, and inverting produced counts `0 / 1` then `1 / 1` while retaining the model candidate.
- TaskComposer's configure-models shortcut still opened the provider dialog (`modal-browser.log`).
- Inspected final desktop and mobile screenshots: `hub-wide-final.png` (1440x960 CSS viewport), `hub-mobile-final.png` (390x844 CSS viewport). Additional picker capture: `picker-mobile.png`.

## Implementation choices and limits

- `MessageTemplate` is not generic in this repository; the new count message uses its existing string interpolation convention.
- Batch controls use the optional atomic `onSelectionChange` callback. Existing toggle-only consumers remain compatible; the provider editor supplies the callback.
- The existing API's 256 selected-model save limit remains enforced. Discovery and search can display hundreds of candidates.
- Browser checks did not submit credentials, save/delete providers, or contact Lark. Provider mutations and connection outcomes were verified with mocked APIs in unit tests.
- This is implementation evidence for the separately designated reviewer, not a claim that independent review has completed. The task card/index were not edited because they are outside the implementation contract's allowed paths.
