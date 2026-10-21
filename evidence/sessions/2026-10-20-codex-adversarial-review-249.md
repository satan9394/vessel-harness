# Task 249 — Independent adversarial audit of Tasks 236–248

Audit Verdict: **FAIL**

The recent task range preserves the thin core, but the requested controls do not all hold. Reproducible counterexamples demonstrate false completion status, a stored-credential destination-binding failure, reflected credential output, and ineffective production keepID conservation. Crash recovery has a torn-journal/lease-cleanup gap. Existing tests and delivery receipts are insufficient to certify all five dimensions.

## Scope, provenance and method

- Workspace: `E:/Code_file/Projects/Vessel_Harness`.
- Pre-236 baseline: `3a1bf2f257ad3d56a2fa343796bc5629354be2f8`.
- Audited HEAD: `f2a438b5a6732043203cf8de522ab4fca57aeece`.
- Local `origin/main`: `b147ae4e1f630618350158f4c2bf5f097a88b4d5`; no fetch or remote mutation.
- Initial tracked working-tree change: `evidence/sessions/2026-10-20-codex-task-249.log` (the launcher/session log). Product source had no initial working-tree changes. This audit adds evidence and updates its card/index only.
- Read `HANDOFF.md`, project instructions, task cards, current source, recent diffs, and relevant closed records. Historical receipts are context, not proof of current gates. In particular, Task 248 explicitly records two root-suite failures and mocked recycling.
- Independent reviewer session; no external agent invocation, commit, push, real provider call, real secret inspection, or user-data recycling. Product code, dependencies and `packages/core` are unchanged by the audit.
- Source paths/line numbers below refer to audited HEAD. Offline counterexamples use compiled current code after the successful TypeScript build. The in-memory compaction fixture intentionally models metadata extensions; it does not claim a complete OpenCode import adapter exists.
- Runnable counterexamples: `node evidence/sessions/2026-10-20-codex-adversarial-review-249-probes.mjs`. Final log: `2026-10-20-codex-adversarial-review-249-probes-rerun.log`, exit **0**. Exit 0 means all six counterexamples reproduced, **not** that controls passed. The initial probe invocation had a relative-import error (exit 1); its separate original log is retained.

## Findings, ordered by impact

| ID | Severity / attribution | Finding |
|---|---|---|
| F1 | High; Task 236 | Historical records and real error outcomes can still become false `completed` receipts. |
| F2 | High; pre-existing backend used by Task 241 | Stored credentials are attached to caller-selected URLs/protocols without binding to the saved provider. |
| F3 | Medium; pre-existing backend | Upstream model IDs can reflect a secret into test responses; universal zero-leakage claim fails. |
| F4 | High; Task 247 | keepID checking is optional and unwired in production; identifier presence does not conserve anchor content. |
| F5 | Medium; pre-existing recovery boundary | A torn effect-journal tail aborts construction after the session lease is acquired, without construction rollback. |
| F6 | Medium; pre-existing deletion boundary | Non-test production deletion outside the recycle seam remains; broad deletion-compliance claim is false. |
| F7 | Medium; Task 246 validation/control gap | IME fallback only stops propagation; it does not cancel implicit form submission. |
| F8 | Medium; Task 246 incomplete recovery | SSE reconnect refreshes metadata, not missed conversation/tool deltas. |

### 1. Thin core discipline

**Task-range result: PASS. Requested origin/main zero-diff predicate: FAIL.**

`git diff 3a1bf2f --numstat -- packages/core` and `git diff --numstat -- packages/core` both produce empty output: zero changed lines in Tasks 236–248 and the initial working tree. Separate `*-task-range-core.log` and `*-working-core.log` preserve this evidence.

The exact requested `git diff origin/main --stat -- packages/core` exits **0**, but reports **8 files changed, 415 insertions(+), 6 deletions(-)**. A Git diff exit code of zero is not a zero-diff assertion. The changes predate Task 236: `git log origin/main..3a1bf2f -- packages/core` identifies `6442171` (Task 217) and `812c451` (older Epic work). They include AgentLoop changes and ChunkedSession additions. Do not attribute these to Tasks 236–248 or claim this requested comparison is empty.

`packages/core/src/agent-loop/AgentLoop.ts:1–30` imports shared contracts, Node crypto and core-local event/state/session/interrupt/steering primitives; it does not import memory, policy or subagent implementations. Existing interception/event vocabulary is not an implementation dependency leak. Application composition continues to own mechanisms (`packages/application/src/compose.ts:358–363`, `:663–688`). No new core leakage was found in the recent range. Core was inspected read-only, including the deletion issue below.

### 2. Lifecycle, state persistence and crash recovery

**Result: FAIL.** The requested literal `idle → planning → executing → awaiting_input → completed/failed/interrupted` machine is not implemented in SessionController/SessionRegistry. The actual authoritative lifecycle is application `ExecutionLoop` plus engine `ExecutionRun`:

- `packages/engine/src/execution-run.ts:3–9,23–25`: guarded revision-based transitions `CREATED → PREPARING → RUNNING`, optional `WAITING_APPROVAL`/`SUSPENDED`, `FINALIZING → COMPLETED`; terminal `DENIED/FAILED/CANCELLED/EXHAUSTED`.
- `packages/application/src/ExecutionLoop.ts:32–45`: incomplete persisted runs receive terminal recovery records, with `OUTCOME_UNKNOWN` for pending tool results; no automatic invocation replay.
- `ExecutionLoop.ts:207–259`: one run owns the session; startup/attempt/terminal state is persisted; `finally` clears timer and ownership. `SessionController.ts:203–216` delegates execution and indexes successful returns; `SessionController.ts:224–225,248–251` delegates interrupt/close. Registry metadata is not a persisted phase machine (`SessionRegistry.ts:13–31`).
- `SessionRegistry.ts:130–153,441–463`: metadata JSONL replay/tombstones and fsynced journal writes survive compatibility-JSON failure. `listIndexed()` returns record/token counts, not terminal run evidence (`:178–189`).

`WAITING_APPROVAL` is permitted by the engine transition table, but ExecutionLoop itself does not publish a transition to it; Activity derives waiting state from the separate widget approval queue. This is not proof of the literal persisted phase sequence requested in the mission.

**F1 — false completion remains reachable.** `apps/local-server/src/routes/activityRoutes.ts:160–164` treats any positive historical `recordCount` with no outcome as completed. `server.ts:397` supplies indexed sessions; no historical last-run projection is added. After daemon restart, a crashed, failed or partially written nonempty session can therefore appear completed. Offline probe returns `completed / source=inferred` for three records with no terminal evidence.

Additionally `server.ts:402–407` checks `lastTurnEnd.kind === 'failure'`; actual core/application turn failure is **`error`**, and exhaustion is `budget` (`ExecutionLoop.ts:194–195`; server `turnStatusCode()` also recognizes `error`). This branch never recognizes ordinary model/tool failures. Even the last success is selected without checking for a later unfinished turn. The route drops `errorDetail` rather than emitting a failure summary (`activityRoutes.ts:171–184`). Task 236 tests inject already-correct `lastRunStatus` values and do not challenge these production mappings. Fix the shared outcome projection from the latest run/turn evidence; remove positive-record-count success inference.

**Journal control that does work:** the implementation is `packages/runtime/src/executor/EffectJournal.ts`, **not** the requested `packages/application/src/journal/` path. `:17–20` fsync intent/outcome; `:26–38` blocks unknown writes, changed invocation identities and already observed calls, allowing read-only new attempts. `Executor.ts:144–147,182` calls journal-before-dispatch, consumes the permit, executes, then records outcome. `compose.ts:358–363` wires the shared hooks. `fault-injection-gate.test.ts:55–135` has seven deterministic boundary cases, and `EffectJournal.test.ts:16–45` has three more. These simulate restart by constructing a fresh journal, rather than killing a real process during a partial write.

**F5 — crash recovery is not universally clean.** `EffectJournal.ts:14` parses every nonempty JSONL line without torn-tail handling. The offline probe writes only a partial intent to a new temporary file and observes `SyntaxError`. `compose.ts:280` opens Session (acquiring its lease); `:358` constructs EffectJournal, before a composed harness/close method is returned. There is no enclosing rollback closing that session on this construction failure. `SessionController.create()` only catches registry registration failures after successful composition (`:130–151`). A malformed/torn journal can thus leave an inaccessible live-pid lease until process exit; subsequent same-process opens are rejected (`packages/core/src/session/Session.ts:90–115`). This is fail-closed against replay, but fails clean recovery/no-dangling-lock acceptance. Preserve/quarantine the tail and add composition rollback outside core; test a torn tail after an fsynced valid intent and same-process reopen.

The ordinary abort race and persisted terminal handling support cooperative cancellation (`packages/core/src/agent-loop/InterruptController.ts:22–84` and AgentLoop's interrupt race); they do not prove every asynchronous journal, observer or close operation is bounded. `compose.ts:724–731` awaits reflection/storage before Session.close without a finalizer around the whole teardown. No blanket no-hang/no-lock guarantee is awarded.

### 3. Physical deletion and recycle receipts

**Session HTTP seam: source-level control substantially improved; universal deletion/real-OS proof: FAIL.**

`server.ts:795–824` enforces same-origin deletion, rejects busy/team-owned sessions, marks deletion in progress, interrupts/awaits the tracked writer, **awaits** `recycleDaemonPath`, then closes/removes controller and registry. Failures return HTTP 500 `session_recycle_failed`; the deletion marker clears in `finally`. Competing mutations are blocked (`:775–776,865–866`). `apps/web/src/App.tsx:107–134` removes only API-confirmed successful IDs and preserves failed entries. This fixes the previous fire-and-forget false-success path.

`apps/local-server/src/daemon/daemonLifecycle.ts:73–84` builds Windows `Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory/DeleteFile(..., 'SendToRecycleBin')`, spawns hidden PowerShell and awaits exit 0; child error/nonzero exit rejects. No permanent-delete fallback exists in that seam. The session DELETE response is `{ok:true,id}`, **not** a `recycled:true` or `recycleBin:true` receipt. No such boolean is manufactured in this reviewed handler.

`server.test.ts:12–15,209–256,625–647` mocks the recycler and tests delayed acknowledgement, failure/retry, writer settlement and mutation exclusion. These are valid control-flow tests, **not evidence of an actual Windows Shell recycle operation**. Task 248's report explicitly makes the same distinction. This audit does not recycle user data or infer OS success from those mocks. A disposable-fixture OS recycle/readback test remains necessary for actual Windows proof.

`SessionRegistry.remove():414–420` removes metadata and persists a tombstone, not physical session files. ProjectRegistry has no physical project-removal API; it maintains a project index and quarantines corrupt config by rename (`packages/application/src/project/ProjectRegistry.ts:93–128`). Provider deletion rewrites its config and removes a credential entry; it does not physically delete a config file. These metadata edits must not be mislabeled recycle operations.

**F6 — broad exception compliance fails in unchanged production code.** `packages/core/src/session/Session.ts:113,278` permanently removes user-session `.lease` files with `fs.rmSync`; these are user workspace session-state files, not test-created tmp fixtures. `packages/engine/src/workspace.ts:42–46` permanently deletes runtime workspaces and accepts an arbitrary supplied `ws.root`; the written exception is for **test-process-created** directories, not production directories merely located in `os.tmpdir()`. Git-worktree disposal also delegates physical removal to git (`workspace.ts:84–91`), not the Shell bin. These are older boundary violations, not Task 237/248 changes. Core is protected and was not edited.

Changed/relevant server and journal tests allocate their fixture roots with `mkdtemp(os.tmpdir())`; their teardown is within the documented exception (`server.test.ts` fixture setup; `fault-injection-gate.test.ts:31–38`; `EffectJournal.test.ts:10–12`). `*-deletion-inventory.log` retains the repository-wide direct-deletion call-site inventory; it is not a certification that all historical test cleanup sites satisfy ownership/concurrency constraints. No newly introduced non-temporary cleanup was found in the reviewed changes.

Residual transaction edge: recycling succeeds before registry removal. A registry persistence failure can return 500 after physical recycling, with controller removal already performed (`server.ts:811–821`; `SessionRegistry.ts:414–420`). Report partial-phase state explicitly; do not promise cross-filesystem/bin/metadata atomicity.

### 4. Stored credential retest and leakage

**Normal frontend flow: PASS. Stored-secret control / absolute zero-leakage: FAIL.**

`ProviderHub.tsx:1–10` delegates to ProviderSettingsModal. `ProviderSettingsModal.tsx:117–128` sends the saved provider's name/protocol/base URL/models plus **`apiKey:''`**. It does not reuse `apiKeyMasked`. The separate replacement-key path uses deliberate user input (`:130–145`). The HTTP endpoint calls ProviderRoutes under same-origin enforcement (`server.ts` provider route group).

`apps/local-server/src/routes/providerRoutes.ts:161–169` resolves the saved provider via Store.get and supplies its API key as fallback. `apps/local-server/src/providers/ProviderStore.ts:262–265,618–636` resolves `secretRef` through `credentialStore.getSync`. DefaultStore constructs CredentialStore; DPAPI Protect/Unprotect pass payload via stdin, not command arguments (`packages/application/src/credential/CredentialStore.ts:338–379`). However factory `:640–669` deliberately falls back to plaintext when OS crypto is unavailable; `credentialsEnabled` only proves a backend exists, not that encryption is active. Current user's actual backend/secret files were not inspected. Unconditional “encrypted” claims are not supported.

**F2 — destination not bound to secret.** `providerRoutes.ts:161–169` retrieves a secret by name, while `connection():103–113` and the test endpoint build the destination/protocol from caller input. An authenticated/same-origin API client can submit `{name:'saved',baseUrl:'https://different.invalid/v1',protocol:'openai-compatible',apiKey:''}` and get the saved secret attached as Authorization to the different host. The offline fetch stub confirms exactly that, without sending traffic or logging a real/synthetic key value. Same-origin/auth controls prevent arbitrary cross-origin callers; they do **not** bind an authorized retest operation to its saved destination. This backend weakness predates Task 241 but directly affects its keyless retest contract. Resolve URL/protocol server-side whenever a stored secret is used; require an explicit supplied key for a new destination/protocol. Apply to test, pullModels and save/update fallback paths.

Normal test responses return scalar codes/latency/model metadata, omit the request key and avoid upstream error bodies (`providerRoutes.ts:171–184`); arbitrary caught network exceptions become generic codes. Provider list intentionally returns a masked suffix (`:120–122`) per UI contract, so a literal ban on *all masked values in any response* is incompatible with that existing DTO; it is not a plaintext disclosure.

**F3 — upstream reflection defeats the absolute claim.** `providerRoutes.ts:173–181` accepts arbitrary model IDs and echoes them in `availableModels` and capability map keys. A fake upstream returning the synthetic credential as an ID causes it to appear verbatim in the response. Probe confirms the leak but suppresses the value in logs. No real key leaked during this audit. Filter/redact secret-bearing upstream strings before DTO construction and storage. Source inspection found no new logging/telemetry of the normal retest request key, but that is not proof against malicious upstream reflection or all historical telemetry paths.

### 5. Streaming integrity, scroll/IME and compaction

**Scroll guard: source/unit coverage PASS. Full stream/IME/keepID contract: FAIL.**

`ConversationView.tsx:287–303,321–333` follows the stream only while within 120px of the bottom, exposes manual return-to-bottom and resets on session switch. It does not intentionally pull a scrolled-up reader down on each new item. `ConversationView.interaction.test.tsx` covers this handler logic with synthetic hook/element fixtures; no native browser scroll/IME certification is inferred.

`ConversationView.tsx:305–317,367–381` tracks composition and refuses submit while the ref is true. Send guards busy/modelBusy (`:226–240`), and Stop is a separate non-submit button. **F7:** the native `isComposing`/229 fallback calls only `stopPropagation()`, not `preventDefault()`. If compositionend clears the ref before the committing Enter causes implicit form submit, the form sees false and sends. The test only checks stopPropagation and submits while the ref is true (`interaction.test.tsx:104–131`), missing that ordering. This is a source-level control gap; browser-specific incidence was not measured. Cancel default submission for composition Enter and test compositionend/229/native-only orderings in a real browser.

SSE (`apps/web/src/sse.ts:131–143,232–240,246–290`) reconnects both native and bearer transports, bounds bearer parsing, stops on auth failure and releases the reader/timer on close. Session-generation guards prevent stale stream callbacks on switch (`ConversationView.tsx:175–224`). **F8:** onOpen only clears warnings and calls `onSessionUpdated()` (`:194–200`), which App passes as `connect()` (`App.tsx:235`). `connect():137–149` reloads health/projects/session metadata. It does not replay missed messages/tools. The server stream is live-only for conversation/tool events (`server.ts:1262–1278,1318–1385`), without event IDs/replay cursor; widget/team/inspector snapshots are separate. Future frames resume, but frames lost during disconnection are not reconciled. Add a revision/cursor-backed conversation snapshot/delta replay with deduplication before claiming stream self-healing.

**F4 — keepID conservation is not integrated.** `assertCompactionConservation.ts:49–64` only checks if callers supply `requiredKeepIds`. Repository call-site inventory (`*-keepid-inventory.log`) shows no production producer of that argument. `Compaction.ts:134–145` strips metadata while constructing messages and never supplies the required IDs. An in-memory production Compaction probe commits a summary that drops `keep-0`. Physical immutable source records remain; the failure is conservation in active compacted context, not deletion of source evidence. The helper also accepts a copied keepID label on unrelated content while dropping the anchor itself (second probe). This validates identifiers, not semantic/content conservation. Derive required IDs from the source contract, carry their anchored messages/immutable references through summary projection, and assert at the actual request boundary.

Existing goal, user constraint, tool-pair and denial guards are wired (`Compaction.ts:111–145`), and compaction locks release in `finally` (`:163–165`). Critical stable system content is assembled afresh from behavior/policy in `packages/context/src/builder/Builder.ts:144–149` and inserted as a system message in `:271`; it is not entrusted to the historical summarizer. Instruction-file user messages are preserved among goals. Thus the evidence supports stable system-prompt retention in the current builder, **not** a complete verified OpenCode 2.1 transformation. Task 247 helper tests cover supplied-ID positive/negative cases but cannot certify unwired production behavior.

## Verification gates and exact results

Gate execution is recorded in `2026-10-20-codex-adversarial-review-249-current-exits.log` and corresponding `*-current-*.log` files. The commands execute sequentially, with no competing audit Vitest job. PowerShell redirection retains native stderr warnings (including SQLite experimental warnings and Git ignore-file access warnings); warnings alone are not treated as failed assertions.

| Command | Exit | Result |
|---|---:|---|
| `git diff origin/main --stat -- packages/core` | 0 | **Nonempty:** 8 files, +415/-6; historical, not recent-task changes. |
| `npx tsc -b` | 0 | No TypeScript build diagnostics. |
| `npm run typecheck:tests` | 0 | No test type diagnostics. |
| `npm run test:all` | 1 | Root: **290 files, 288 passed / 2 failed; 3047 tests passed / 2 failed / 6 skipped**. Duration 525.78s. `&&` skips Web. |
| `npm run -w @vessel/web build -- --emptyOutDir false` | 0 | Vite 8.3.0; 97 modules; built in 1.30s. |
| `npm run test:web` (explicit follow-up because root failed) | 0 | **51 files / 413 tests passed**, duration 23.54s. |
| Focused control suite (exact command below) | 0 | **6 files / 102 tests passed**, duration 30.01s. |

Focused command: `npx vitest run packages/runtime/src/executor/fault-injection-gate.test.ts packages/runtime/src/executor/EffectJournal.test.ts packages/application/src/ExecutionLoop.test.ts apps/local-server/src/server.test.ts apps/local-server/src/routes/providerRoutes.test.ts packages/context/src/compaction/assertCompactionConservation.test.ts --reporter verbose`. Its `*-current-focused-controls.log` records individual assertions, including all ten journal/fault-injection tests and HTTP interrupted-writer settlement. These passing cases establish the narrower controls described above, not immunity to the counterexamples.

Fresh root failures (full stacks in `*-current-all-tests.log`):

- `packages/runtime/src/sandbox/backend/process-tree.test.ts:350`: pre-spawned grandchild missing from `tree.nodes` (`expected false to be true`).
- `packages/runtime/src/proxy/virtualProxy.test.ts:187`: descendant timeout cleanup rejects on `taskkill` access denied, through `virtualProxy.ts:115,132,219`.

Both also appear in the earlier Task 248 receipt. Their source files are unchanged in the audited range; this establishes historical recurrence, not a root cause or harmlessness. In particular, process containment/cleanup failures matter to this security audit. Full gate is **not green**, and no skipped-Web result is presented as passed by `test:all`.

Supplementary checks: the offline probe script passes `node --check` (exit 0). An unrestricted `git diff --check` finds whitespace in the continuously written pre-existing launcher transcript `2026-10-20-codex-task-249.log`; it is retained untouched. Scoped audit-card/index whitespace check passes. The final working-tree core diff remains empty.

Build command disclosure: the requested npm build script is run with `-- --emptyOutDir false`, as required by current HANDOFF/recycle discipline; an unflagged Vite build would permanently clean the existing generated output. This safety-preserving variant must not be reported as execution of the byte-for-byte unflagged command.

Task 248's historical record is **3044 passed / 6 skipped / 2 failed** across 290 root files, with its `&&` chain skipping Web. That receipt is not substituted for this audit's fresh results. Current failures, if any, remain failures; unchanged source and a previous similar failure do not establish flakiness or prove causality.

## Disposition and next actions

1. Block clean acceptance on F1/F2/F4. Repair the shared outcome projection and secret/destination binding, then wire conservation to production request construction.
2. Add torn-journal construction rollback/reopen proof, missed-SSE replay proof, and native IME default-action tests. Keep all core changes out of those fixes; separately escalate protected historical core deletion violations.
3. Retain the successful deletion control-flow changes, but obtain disposable-fixture Windows recycle/readback evidence before claiming real Shell recycling. Model post-recycle metadata failure explicitly.
4. Resolve current root-suite failures without weakening sandbox/process-tree assertions; rerun all requested gates after final product changes.

Audit completion is separate from product acceptance: this report delivers findings and evidence, not fixes or authorization to commit/publish. No universal security, lifecycle or regression-free guarantee is made.
