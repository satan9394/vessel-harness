# Card 205 accepted work proof

InteractivePatchPicker renders exact unified hunks, line numbers, side-by-side view, selected Accept/Discard and Revert/Reapply controls. The fifth Patch inspector tab receives session diff widgets from ConversationView and calls its injected API client. Inline diff widgets retain the same controls. Server decisions replay through the existing SSE widget seam.

POST `/api/session/:id/patch/apply` accepts only server-published widget/hunk identity and accept/reject. It recognizes exact original or already-applied text, retains the full-file snapshot, and independently tracks applied hunks. Accept keeps/applies a hunk; reject discards/reverts it; reversing and reapplying out of order use only deltas from earlier physically applied hunks. Any intervening full-file edit conflicts before a write. Decision replay is idempotent and does not claim to rewrite externally changed content.

Security gates reject read-only sessions, arbitrary client patches/paths, traversal, `.git`, Windows path aliases/device names, symlinks/junctions, hardlinks and oversized/binary files. Descriptor device/inode, real workspace root and path checks protect application. No files are deleted or recreated. Existing regular text files are supported; create/delete/rename/binary patches and ambiguous source states fail closed. Exact context-free insertion/deletion proposals can be ambiguous when both sides match and are rejected rather than guessed. No external Agent processes were used.

## Accepted verification after last source/test edits

- `npx vitest run packages/shared/src/patch.test.ts apps/local-server/src/routes/patchRoutes.test.ts apps/local-server/src/routes/widgetRoutes.test.ts`: exit 0; 3 files, 25 tests passed. Log `card205-revert-accepted-root.log`.
- `npx vitest run --root apps/web src/components/canvas/InteractivePatchPicker.test.tsx src/components/widgets/widgets.test.tsx src/components/layout/DualSurfaceLayout.test.tsx src/api.test.ts`: exit 0; 4 files, 69 tests passed. Log `card205-revert-accepted-web.log`.
- `npx tsc -b tsconfig.json`: exit 0. Log `card205-revert-accepted-tsc.log`.
- `npm run typecheck:tests`: exit 0. Log `card205-revert-accepted-test-types.log`.
- `npx tsc -p apps/web/tsconfig.json --noEmit`: exit 0. Log `card205-revert-accepted-web-types.log`.

Independent command exits are recorded in `card205-revert-tests-exits.json`, `card205-revert-types-exits.json` and `card205-results.json`. Earlier logs remain historical; the first test-type run failed on test-only optional-server narrowing and was repaired. Full dual-root regression, production build and browser verification belong to the Epic 209 integration gate and are not claimed here. No commits/push/publication performed.
