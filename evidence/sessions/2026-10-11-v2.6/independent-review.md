# Independent V2.6 review

Reviewer: isolated-context evaluator `v26_review`. Read-only review of card contracts, source, tests and proof. No real provider calls, credentials or external agents.

## Completed-card findings

- P1 confirmed: unauthenticated provider same-origin protection trusted request Host. An isolated Node HTTP request to loopback with matching foreign Host and Origin returned 200. Repair: centralized origin predicate rejects non-loopback hosts when unauthenticated; preserve authenticated remote binding. Regression requests cover provider routes, session creation and model switching.
- P2 confirmed: committed save/delete could skip `onChanged` when provider/model readback failed. Repair: success notification, key clearing and consumer invalidation occur immediately after committed mutation; readback failures show a separate localized refresh error. Tests cover discovery failure after save/delete, provider-list readback failure and rejected write.
- Retry implicit-submit suggestion withdrawn after source refresh: current button already has `type="button"`; no unsupported defect claim remains.

The evaluator positively reviewed credential masking, sanitized errors, bounded probes, redirect rejection and failed-initial-list save protection. Final card 213 and repaired-source review is pending.

## Build integration repair

The Web runtime import of parsePatchHunks used the shared root barrel, pulling Node-only exports into Vite's resolver and producing browser externalization warnings. It now imports the browser-safe shared patch leaf, following the existing source-leaf convention in sse.ts. Final safe build must confirm warnings are gone.

## Final source review — PASS

Independent evaluator reviewed current cards 210–213 after repairs: provider/model delegation, history/SSE/controller ownership, busy rejection, rollback, secret-free metadata/audit, UI response races and regression contracts. No additional actionable defects found. Protected source and dependency files have no diff. Evaluator did not run tests/builds; final parent gates and browser acceptance supply execution evidence.
