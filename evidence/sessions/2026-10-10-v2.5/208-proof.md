# Card 208 — Attention delivery proof

Implemented locally in `apps/web`; no core edits, dependencies, assets, deletion,
commit, push, publishing, external agent process, or browser operation by this worker.
Task/state/handoff files are owned by the parent and were not edited by this worker.

## Behavior

- Global controls explicitly request desktop notification permission and persist
  sound mute at `vessel.attention.muted`. Mount and attention events never request
  permission. Unsupported/default/denied notification states retain title/audio
  fallback. Notification permission is the browser's own persisted state.
- Native notifications require granted permission and hidden **or unfocused** page.
  Notification click requests window focus and closes owned notices/restores title.
  Focus/visible focus, local approval, session switch and unmount restore title.
- Only actual pending `permission_action` widgets produce `decision_needed`;
  policy-denied tool rows do not represent approvals. Session+widget ids deduplicate
  SSE replay/reselection, including resolved-before-pending replay.
- Actual local `runTurn` success produces completion attention only when locally
  measured duration is at least **5,000 ms**. Interruption, error (including failed
  requests), and budget result kinds produce warning attention. Unknown result
  kinds do not become synthetic success or breaker observations.
- Pure WebAudio uses two sine notes (523.25/659.25 Hz) for success, two triangle
  notes (440/329.63 Hz) for warning, and quiet gain envelopes peaking at 0.035.
  Submit/unmute gestures arm the lazy AudioContext. Natural ending disconnects
  nodes; mute/unmount stops/disconnects owned nodes and closes the context.
- Session lifecycle generation protects stale results/responses after switching
  away and back. View-only commands do not invalidate an active turn.

## Review repair

Independent review found generation incorrectly incrementing in the view-command
effect. It now changes only with session SSE lifecycle. Real component callback
regressions prove successful pending turns finish and clear busy after clear,
collapse, expand, export, AST and cache commands; a pending local permission
response also survives a same-session view command.

## Fresh final gates

All commands below ran after the final source edit; exact times and exit codes are
saved in `208-command-exits.json`, with corresponding `208-*.log` outputs.

| Gate | Result |
| --- | --- |
| `npx vitest run --root apps/web` | 29 files / 251 passed; exit 0 |
| `npm run -w @vessel/web typecheck` | exit 0 |
| `npx tsc -b tsconfig.json` | exit 0 |
| `npm run typecheck:tests` | exit 0 |
| `npm run -w @vessel/web build -- --emptyOutDir false` | exit 0 |

Attention-specific tests: **29 passed** across manager/API mocks, WebAudio mocks,
and actual ConversationView callbacks exercised by a Node hook lifecycle harness.
Covered permission default/denied/granted/unsupported, hidden/focus, notification
click/cleanup, mute persistence, missing storage, native construction failure,
SSE replay, oscillator shapes/envelopes/resume/disconnect, disposed pending resume,
failed autoplay, actual success/error, stale turns/responses and view commands.

## Evidence limits / parent acceptance

This worker did not operate a browser or inspect native OS notification delivery.
Mock API assertions do not prove audible playback or OS desktop rendering; browser
and autoplay permissions can suppress those channels. The parent owns rendered
browser QA, full `npm run test:all`, independent acceptance and project bookkeeping.
The foreground title indicator is stable rather than flashing, avoiding motion.
No cache/token/rate values are synthesized by this attention implementation.
