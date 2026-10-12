# V2.5 independent adversarial review

Result: PASS after two independently identified defects were repaired by the parent/executor. No remaining actionable blocker found in the reviewed current diff. This is a focused review, not a substitute for the parent final full gates and browser QA.

## Scope and method

Read current AGENTS.md, HANDOFF.md, task acceptance for 205–209, tracked git diff, and untracked implementation from `git ls-files --others --exclude-standard apps packages`. Reviewed patch parser/application, server publication/ownership/path validation, reasoning stream correlation and SSE validation, canvas controls, palette/focus behavior, message navigation, and attention/audio lifecycle. No source/test/task/state edits made by reviewer; only this evidence document and standalone reproducer were added. No external agents, real provider calls, commits, push, publication, dependency installation, or deletion.

## Findings and resolution

1. **P2: View commands invalidated an active turn and left the composer busy.** Original `apps/web/src/components/ConversationView.tsx` viewRequest effect incremented sessionGeneration on every palette action, including inspector/collapse/export/clear. An active runTurn captured the prior generation, so its completion and finally guards returned without setBusy(false). Trigger: submit a deferred/long turn; execute a same-session palette view command; let the request complete. Completion attention and cleanup were also skipped. Reported early to parent. Current viewRequest effect no longer increments sessionGeneration; actual session switch/stream cleanup owns generation changes. Executor-added tests exercise clear/collapse/expand/export/ast/cache while the request is pending, and a pending permission response across a view command. Independent focused run: 13 passed, exit 0.

2. **P1: Single-hunk application silently changed unrelated bytes.** Original `apps/local-server/src/routes/patchRoutes.ts` decoded complete files as UTF-8 without validating roundtrip; `packages/shared/src/patch.ts` normalized the whole file to one line-ending style. The server then rewrote the whole decoded file. Independently reproduced using `independent-byte-repro.ts`: a first-line a→A hunk changed an unrelated byte ff to UTF-8 replacement efbfbd, HTTP-equivalent status200; a mixed CRLF/LF file changed untouched line b LF to b CRLF. Parent repair adds readPatchText at publication and descriptor verification; invalid UTF-8, mixed line endings, and bare CR fail closed. Re-running the same standalone source-backed reproducer returns400 unsupported_patch_encoding / unsupported_patch_line_endings, with exact before/after bytes equal. Independent focused patch tests: 20 passed, exit0.

## Independent verification

- `npx tsx evidence/sessions/2026-10-10-v2.5/independent-byte-repro.ts`: exit0; both unsafe-byte cases reject400 and preserve bytes exactly.
- `npx vitest run --root apps/web src/components/ConversationView.attention.test.tsx`: 1 file / 13 passed, exit0.
- `npx vitest run apps/local-server/src/routes/patchRoutes.test.ts packages/shared/src/patch.test.ts`: 2 files / 20 passed, exit0.
- `git diff --numstat -- packages/core package.json package-lock.json`: empty, confirming no tracked changes to these protected paths at review time.

## Limits and handoff

Native notification delivery, audible cue output, actual browser rendering/focus, full root+Web regression, build/type gates, and final evidence synchronization are the parent's acceptance responsibilities. Reviewed encoding subset deliberately rejects unsupported byte layouts; this protects single-hunk boundaries. The standalone reproducer leaves its own newly created temporary directory intact (printed by the command), with no cleanup/deletion. Current implementation files were changing concurrently during repairs; the verification above ran after those repairs were observed. Re-run full final gates after any subsequent source/test edit.
