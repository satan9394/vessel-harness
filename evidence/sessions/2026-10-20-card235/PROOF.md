# Task 235 — local delivery evidence

Implementation: full-viewport 58px / 232px / remaining-width shell, square shell boundaries, 1px column dividers, opaque light/dark surfaces, 48px minimum topbar, attached inspector, full-width home/task form, and 4–6px component corners. Functional React code, dependencies, and backend/core source were not edited.

## Requested gates

- `npx tsc -b tsconfig.json`: exit 0 (`tsc.log`).
- `npm run typecheck:tests`: exit 0 (`typecheck-tests.log`).
- `npm run -w @vessel/web build -- --emptyOutDir false`: exit 0 (`web-build.log`).
- `npx vitest run --root apps/web`: 50 files / 404 tests passed; standalone rerun after the final CSS edit (`web-tests.log`).
- `git diff --numstat -- packages/core`: empty (`core-diff.txt`).
- Whitespace check: `git diff --check` for changed tracked source returned exit 0.

`styles.diff` and `layout.diff` compare this task against its starting checkout, avoiding attribution of earlier uncommitted work. `REVIEW.md` records independent source review with no high/medium findings.

## Limits

Additional `npm run test:all`: exit 1; root 286 files passed / 3 failed, 3038 tests passed / 3 failed / 6 skipped. The `&&` script therefore did not reach Web; Web was run separately. Failures are in unchanged files: `sessionModelHub.test.ts` (hostile Host/Origin expected 403, received 200), `virtualProxy.test.ts` (Windows descendant cleanup reports access denied), and `process-tree.test.ts` (grandchild enumeration expected true, received false). These are not attributed to CSS; no backend/runtime changes were made to hide or repair them. Full details are retained in `test-all.log`. Historical docs were searched before recording this current-run result; old acceptance does not override the new failures.

No browser surface was available: `iab` creation failed, and inventory returned no browsers/apps. No screenshots, measured browser geometry, or new interaction acceptance are claimed. Existing Web tests cover behavior; prior-session screenshots are not reused as proof of this redesign.

No commit, push, dependency installation, or deletion command was performed. Production build used `--emptyOutDir false`.
