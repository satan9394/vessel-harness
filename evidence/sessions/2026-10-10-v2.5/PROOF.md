# Vessel V2.5 Epic 209 — accepted local delivery

Cards205–209 completed in dependency order under bounded mode. HEAD remains `dd8e72c`; work is local and uncommitted. No push, publication, dependency installation, external agent invocation, or filesystem deletion occurred. Implementation changes are confined to Web, local-server and shared; core diff is exactly zero.

## Changes and acceptance

- **205:** Unified/side-by-side per-hunk accept/discard/revert/reapply in chat and the fifth Patch Inspector tab. The server accepts only owned widget/hunk/action identifiers, checks exact snapshots and anchored changes, rejects unsafe paths/links/stale writes, and preserves UTF-8 bytes and uniform LF/CRLF endings. Unsupported encodings, mixed endings, create/delete/rename and ambiguous states fail closed. SSE decisions reconcile both rendered surfaces.
- **206:** Streaming timer, automatic collapse at answer start, manual expansion and actual recalled-memory rule disclosures. Retry call IDs, late usage and switched-session continuations are isolated. Missing reasoning counts remain unknown; available output-rate fallback is explicitly a model-call average.
- **207:** Ctrl/Cmd+K fuzzy session and command search, all Inspector tabs, local clear/export/folding, J/K/Space/Esc navigation and focus guards. Sandbox selection creates a new session with actual read-only/workspace-write permission; existing permissions remain immutable. Unavailable doctor/provider/manual-theme actions were not fabricated.
- **208:** Explicit Notification permission action, hidden/blurred native notices, title cues, persisted mute and native oscillator sounds. Successful local turns require measured duration≥5s; pending permission widgets and interruptions/errors/budgets have distinct attention behavior. Replay, resource cleanup and stale-session guards are tested.
- **209:** Fresh independent adversarial review, real browser desktop/800px interaction checks, dual-root regression and synchronized closure records.

## Final gates

All seven final gates exited0 after the last source/test edit at `2026-10-11T04:51:02.440Z`. Exact timestamps/exits are in `final-gates.json`; source hashes/freshness and protected scope are in `completion-audit.json`.

| Gate | Accepted result |
| --- | --- |
| `npm run test:all` | Root266 files /2832 passed +6 skipped; Web29 files /251 passed; total3083 passed |
| `npx tsc -b tsconfig.json` | exit0 |
| `npm run typecheck:tests` | exit0 |
| `npm run -w @vessel/web typecheck` | exit0 |
| `npm run -w @vessel/web build -- --emptyOutDir false` | exit0 |
| `npx tsx apps/cli/src/cli.ts --help` | exit0 |
| `node evidence/sessions/2026-10-10-v2.5/check-boundaries.cjs` | core0, protected hashes unchanged, no alternative lockfiles or out-of-scope added implementation |

Reproduce final checks with `& evidence/sessions/2026-10-10-v2.5/run-gates.ps1`, then `node evidence/sessions/2026-10-10-v2.5/completion-audit.cjs`. Logs retain existing SQLite/deprecation/shared browser-externalization warnings; none caused gate failure.

## Independent review and rendered proof

`independent-review.md` records PASS after fixing independently reproduced unrelated-byte corruption and busy-state loss during palette commands. It independently reran33 focused tests and the byte-preservation reproducer. The additional two-surface picker synchronization regression passed31 focused Web tests. Earlier failed logs/screenshots remain as historical evidence.

`browser-final.md`, `browser-card205-207.md` and `browser-final-observations.json` record real browser commands, stream collapse/rules, selected apply/discard, rollback/reapply, file readback, keyboard focus, mute persistence, permission preset and responsive modal behavior. No browser console warnings/errors or horizontal page overflow at1280px/800px. Final selective application read back exactly `new first\ncontext\nold last\n`. Screenshots are retained, including `browser-workbench-final-header.jpg` and `browser-attention-800.jpg`. The owned fixture server/tab were stopped; isolated workspace/stores remain as evidence.

Notification permission/delivery and WebAudio synthesis are accepted through29 offline mock/callback tests. OS notification rendering and audible playback were not observed and are subject to browser permission/autoplay/device behavior. No token counts, actual policy hits, or native delivery evidence were invented.

Next: human review of the local diff. No automatic commit or next Epic is authorized.
