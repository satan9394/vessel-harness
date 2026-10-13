# Card 219 real browser click walkthrough

Final fixture execution: `click-attempt-12.log` / `click-attempt-12.json`.
Result: **77 PASS receipts, 0 console errors, 0 uncaught exceptions, process exit 0**.
Chromium ran headless at 1440×900 and 800×900. Playwright drove actual mouse clicks,
keyboard shortcuts, text entry and native select choices. No request interception,
API replacement, external agent invocation or production credential access was used.

The test-owned Node HTTP model endpoint supplies deterministic model discovery,
reasoning and assistant text. Vessel Local Server serves the real built web app,
handles the actual APIs/SSE, and persists provider/session/project state in an
`os.tmpdir()` fixture root. A server-published diff widget exercises actual patch
HTTP handlers and reads back the test-owned file after accept and rejection.
Provider deletion checks both API absence and credential metadata absence; secret
values are neither printed nor included in request receipts.

| Area | Evidence |
| --- | --- |
| Four primary areas | Click, active navigation state, exact area heading or workbench visibility |
| Task composer | Project select, focus/type, disabled empty Start, both discovered models, both current permissions, real create and streamed response |
| Conversation | Thinking expand/collapse, click-send and Enter-send with completed assistant increments, historical session exact ID plus all three observed user/assistant turns restored once |
| Inspector and patch | Exactly five current tab content headings, real accept/pending Discard/revert API decisions, accepted/original file bytes |
| Provider | Four presets and corresponding URLs/protocols, form, busy testing and pulling controls, connected latency, discovered model values, save API/credential readback, model selector visibility, delete confirmation and credential cascade |
| Command palette | Ctrl+K focus, both arrow directions, Escape focus restoration, category collapse and real system/project/session action outcome |
| Layout | All 11 persisted toggles, actual visibility for eight current module/placeholder views, zero backend policy mutations |
| Narrow navigation | 800px collapse, open/inert, 60 forward + 60 backward focus loops, Escape focus restoration, backdrop close |

## Existing product limitations

- Permission presets are `read-only` and `workspace-write`; a full-access preset is absent.
- Empty Start is disabled; the current design does not render a validation alert.
- Current Inspector tabs are Swarm, Cognition, KV Cache, AST and Patch, replacing
  the four historical names in the original card.
- Customize has no reset-to-default button.
- ChangedFiles, ToolActivity and Cost preferences persist, but `ModuleSection`
  returns `null` for their separate modules. Context, Logs, MCP and Policy show
  existing declared placeholder panels. A successful checkbox receipt does not
  claim those features are fully implemented.

These control observations are reported rather than repaired.
The suite establishes the specified seven-area walkthrough with these observations;
it does not establish 100% coverage of every optional product feature.

## Authorized Web-only history repair

The root cause, authorized repair, red-to-green evidence and page-lifetime limits
are recorded once in [PROOF.md](PROOF.md#root-cause-and-authorized-fix).
The final full walkthrough includes actual historical message-tree readback;
see its session-switch receipts and the supplemental history/layout evidence.

## Earlier attempt evidence

Attempts 1–11 are retained as logs and JSON receipts. They exposed harness selector
ambiguity, exact text capitalization, mutated fixture reuse, a five-second DPAPI
save wait, a missing selected-session prerequisite for module visibility, and an
open Inspector blocking navigation after resizing. The final harness scopes
selectors, handles replayed patch decisions, uses 30-second assertions for secure
store work, selects a session before layout checks, and closes Inspector before
the independent narrow-navigation scenario. These harness corrections did not change production code. A subsequently authorized Web-only repair is described below.

## Reproduction

From the repository root, build with:

```powershell
npm run -w @vessel/web build -- --emptyOutDir false
npx tsx evidence/sessions/2026-10-13-card219/browser-fixture.ts
```

The fixture asks the OS for free ephemeral loopback ports (`port: 0`) and writes
`browser-fixture-meta.json`. In another terminal:

```powershell
& 'D:\Technology_application\Anconda_All\Anaconda3\envs\claude\python.exe' evidence/sessions/2026-10-13-card219/click-walkthrough.py
```

Start a fresh fixture for each full run so the second hunk begins pending. Use Ctrl+C to stop the test-owned fixture. No dependency installation is required.
The suite always saves structured receipts, including on failure. Archive the
current `click-results.json` and log before rerunning when preserving a named
attempt. Product gates and independent review are recorded separately in PROOF.md.


