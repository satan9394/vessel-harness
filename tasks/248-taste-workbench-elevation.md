# 248 — Taste workbench elevation

Status: 待验收（本地交付；指定门禁通过，全仓额外诊断有两项失败）

## Goal
Audit and refine the Web workbench using the local Taste-Skill: edge-to-edge surfaces, tangible controls, readable Markdown and stable light/dark themes.

## Not Doing
No core changes, dependency changes, real provider calls, user-session deletion, commits or publishing. Preserve pre-existing untracked task launcher files.

## Acceptance
- Full-screen shell retains zero outer gutters and square structural panels; operations have visible surfaces, hover, press and keyboard focus states.
- Both themes and narrow layouts remain usable; Markdown uses semantic hierarchy and bounded code/table overflow.
- Stored-credential testDirect and recycle-bin deletion behavior remain intact.
- Web Vitest, tsc -b, typecheck:tests and Web production build pass after final source edits. packages/core diff has zero lines.

## Blast Radius
apps/web presentation; apps/local-server/src/server.ts and server.test.ts for awaited recycle status; this task, tasks/README.md and evidence/sessions/2026-10-20-codex-taste-elevation-248*.

## Expected Evidence
Audit report at evidence/sessions/2026-10-20-codex-taste-elevation-248.md; command logs, before/after screenshots and independent read-only review.

## Plan and Verification
1. Inspect styles, components and existing closed records; capture baseline.
2. Refine shared controls and reading surfaces without changing service behavior; inspect both themes and widths.
3. Run required gates, inspect core diff and record review/results.

## Result
See [audit and evidence](../evidence/sessions/2026-10-20-codex-taste-elevation-248.md). Four requested gates passed after final edits; focused server tests 28 passed and Web tests 413 passed. Independent review has no remaining high/medium findings. Core diff is empty. Additional root suite diagnostic has two Windows runtime failures; no all-repository-green claim. No commit or publication.
