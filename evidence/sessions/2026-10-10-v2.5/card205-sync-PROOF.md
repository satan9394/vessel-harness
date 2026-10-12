# Card 205 lifecycle reconciliation repair

The concern was real: optimistic local decisions permanently overrode authoritative hunk props, allowing the inline picker and Patch canvas to disagree after accept/revert actions. Local completion is now tied to the exact input hunk snapshot and its original status. A fresh server/SSE snapshot supersedes that completion, even when later status cycles back to a prior value. An older in-flight callback likewise cannot override a newer snapshot.

The regression drives two independent component instances through accept in A, revert in B, reapply in A, and authoritative prop updates for both. It verifies their statuses converge and each exact action callback fires. The first status-only repair failed the final cycle; the failed log remains `card205-sync-web.log`. Snapshot identity repair passes.

Accepted after the final source/test edit:

- `npx vitest run --root apps/web src/components/canvas/InteractivePatchPicker.test.tsx src/components/widgets/widgets.test.tsx src/components/layout/DualSurfaceLayout.test.tsx`: exit 0, 3 files / 31 tests passed (`card205-sync-accepted-web.log`).
- `npx tsc -p apps/web/tsconfig.json --noEmit`: exit 0 (`card205-sync-accepted-web-types.log`).
- Independent command exits: `card205-sync-accepted-exits.json`.

Only InteractivePatchPicker and its regression test changed; no route/state/core changes. Epic final gates must run after this repair.
