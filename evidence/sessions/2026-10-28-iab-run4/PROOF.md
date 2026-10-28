# Wave 5 V2 IAB viewport evidence — UNVERIFIED

2026-10-28. Scope: W1 controlled Stop failure and W2 read-only new-file Diff at 917 × 567. Both are **UNVERIFIED**: no IAB tab was created in this subagent thread.

## Calls and results

1. `mcp__cua_repl.js`: `let tab = await cua.createBrowserTab("iab", "about:blank", { visible: true });` — tool returned `IAB visibility is not supported in a subagent thread` (no process exit code).
2. `mcp__cua_repl.js_reset`: `{}` — returned `js kernel reset` (no process exit code).
3. `mcp__cua_repl.js`: `let tab = await cua.createBrowserTab("iab", "about:blank", { visible: true });` — again returned `IAB visibility is not supported in a subagent thread` (no process exit code).

The two identical startup calls were rejected by the tool as above. No other commands were rejected. Following V2's stop condition, no fixture, provider, server, screenshot, DOM substitute, or old screenshot was used. Zero services were started; listener counts were not measured and cannot be claimed as zero.

W1: screenshot, complete error text, and request disabled state are unverified. W2: screenshot, patch text, absence of action controls, fixture disk bytes, and write count are unverified. Retry in a thread where visible IAB is available.

## Files and checks

- New: `evidence/sessions/2026-10-28-iab-run4/PROOF.md`.
- Appended: `tasks/275-ui-final-acceptance.md`.
- Before editing, Node byte comparison of the specified baseline against the card: exit 0, baseline 23087 bytes, current 23087 bytes, prefix match true; evidence directory absent.

## Independent review

A separate read-only gpt-6.1-terra / medium reviewer confirmed the recorded reporting and stop procedure. W1/W2 UI acceptance remains UNVERIFIED. The two tool refusals establish a visible-IAB restriction in that subagent thread; they do not establish global IAB unavailability. The original 23,087-byte card is an exact prefix of the 23,501-byte implementation result (+414 bytes). No screenshot, DOM or old evidence was substituted; no fixture was launched, and listener counts were not measured. The reviewer did not retry the browser or modify files.
