# Independent source review — specification completion (2026-10-23)

Verdict: changes need repair before source sign-off. Two P2 defects found. This is a source/targeted-test review, not full product or UI acceptance.

Baseline: `46b7291188db6f95303683a8016d5434b252d142`. Read HANDOFF, project PDW skill (independent review role only), completion report, both 2026-10-20 Architecture/UI review specifications, current diff, and the four named untracked test/source areas. Relevant historical memory was used only to preserve the boundary between browser evidence and source acceptance; findings below use current source.

## Findings

### F1 — P2 — Test-before-save loses expiry and verification receipts (reproduced)

Locations: `apps/local-server/src/routes/providerRoutes.ts:193-203` (new receipt path), `:138-141` (save); related existing normalizer `:77-87`; actual UI caller `apps/web/src/components/providers/ProviderSettingsModal.tsx:153-160,185-187`.

The normal Add Provider workflow tests/pulls models before the provider exists. `test()` stamps capabilities but persists catalog/capability receipts only when a saved provider already exists. The UI keeps the returned `modelCapabilities` in its draft and POSTs them to `save()`. `normalizeProviderInput()` intentionally turns client data into declarations, discarding `evidence`, and save creates a configuration with neither catalog receipt nor capability expiry. As a result, metadata fetched from `/models` becomes a permanent declaration and passes the new expiry guard indefinitely. Even supplying an unchanged returned snapshot while updating an existing provider can erase its capability evidence while leaving catalog evidence intact.

Read-only reproducer executed with `node --import tsx --input-type=module`: import ProviderRoutes and negotiateCapabilities; use an in-memory fake store and injected Response `{data:[{id:'model',tools:true}]}`; set clock 1000/TTL100; call `routes.test(input)` with unsaved fixture provider; call `routes.save({...input, modelCapabilities:tested.modelCapabilities})`; negotiate tools:true at the real current clock. Actual output:

```json
{"returnedEvidence":{"observedAt":1000,"expiresAt":1100,"origin":"provider_metadata"},"savedEvidence":null,"savedCatalogEvidence":null,"expiredPositiveAccepted":true}
```

No network/credentials/user state used. Preserve the rule against trusting client-supplied evidence; bind a server-owned probe receipt to destination/protocol/model identity and carry it through save, or explicitly require/persist an authoritative post-save verification. Add a regression covering the real UI test/pull-before-save sequence, not only verification of already-saved providers.

### F2 — P2 — Hidden Add pane breaks modal keyboard focus containment (confirmed in code)

Locations: `apps/web/src/components/providers/ProviderSettingsModal.tsx:222,248` (new hidden panes), related focus trap `:207-212`; production modal caller `apps/web/src/App.tsx:258`.

Both panes remain mounted. The trap collects every enabled button/input/select with `querySelectorAll`, including descendants of `[hidden]` panes and collapsed details. In the default Configured view, the final queried control is the hidden Add form's submit button. Shift+Tab on the initial Close button prevents default and tries to focus that hidden button, which cannot receive focus, so focus stays stuck. Tab from the actual last visible Configured control is not recognized as the end and can escape into the page behind the modal. This is a regression introduced by retaining the hidden pane; the embedded Settings page does not use the trap, but the actual modal remains reachable from App.

Filter the trap to rendered, focusable controls outside hidden/collapsed subtrees (or use an existing proven focus utility). Add a DOM/browser keyboard regression for default Configured view and Add view, including first/last visible controls and focus return. The new ProviderHub test mocks React and checks only the hidden attributes; it does not exercise DOM focus.

## Reviewed behavior and limits

- UI04: backend uses actual team/subagent/goal DTO fields, guarded session-only navigation, team approve/reject transports, duplicate-decision ref, and post-decision refresh. No additional concrete correctness defect established.
- UI06: configured/add split and draft retention are present; F2 prevents keyboard sign-off for the modal.
- UI10: task-ready mark is an application-specific mark, not standardized TTI. The completion report explicitly retains real 150%/200% zoom and broader contrast/execution-state visual coverage as incomplete. Source review does not convert screenshot counts into acceptance.
- ARCH03: production compose still owns policy -> journal intent -> permit consumption -> tool -> journal outcome. Reconcile is idle-only, identity-bound, fsynced, idempotent for the same receipt, and does not permit redispatch of that key. HTTP route uses origin check; restoration comes through existing SessionFactory. Receipt is operator attestation, not exactly-once proof. Read full new process recovery test: child Node uses actual PolicyEngine/Executor/EffectJournal; it is not an external agent CLI.
- ARCH04: facade reuses existing runtime; unsupported methods absent; arbitrary allowedTools/options refused; cancel awaits result/cleanup. Probe fixtures are synthetic. No external runtime version is certified by this review; installed CLI/Windows command-shim compatibility and actual process cancellation remain outside new facade fixture evidence.
- ARCH05: saved-provider freshness/stale/error retention paths covered, but F1 means ordinary creation does not satisfy the expiry contract.
- ARCH08: source/summary receipt generation, replay hash checks, nested source recovery, current policy/pending effect/pending approval references, and authority-change rejection examined. Golden tests use injected facts; composition/server wiring separately traced. Legacy receiptless commits intentionally remain accepted. No additional concrete regression established.
- No changes to packages/core were present at the review check. Parent was updating documentation during review; hashes below identify the observed snapshot. Any subsequent edit invalidates sign-off for that file and its affected callers.

## Independently executed checks

Command:

```powershell
npx vitest run packages/runtime/src/executor/EffectJournal.test.ts packages/application/src/session/effect-recovery.test.ts packages/agents/src/external/InteractiveAdapter.test.ts packages/context/src/compaction/recovery-golden.test.ts apps/local-server/src/routes/providerRoutes.test.ts
```

Result: exit 0; 5 files / 54 passed; duration 12.00s. These passing tests do not cover F1/F2. The in-memory source-import reproducer above independently demonstrates F1. F2 is a source-confirmed DOM focusability defect; no new browser interaction performed by this source reviewer.

Only this review report was written. No product/test/config/task/HANDOFF/core edits, external agent CLIs, full test:all, commit, push, publish, or deletion.

## Scope SHA-256 snapshot

Files are absolute to repository root `E:/Code_file/Projects/Vessel_Harness`. SHA-256 values identify source/test/doc bytes visible at snapshot time; new evidence images/logs are excluded.

```text
89f688ce84121a0461231e9d2b7eecc3b2f85bdfaffab54d529df6819b5f1add  apps/local-server/src/providers/ProviderStore.ts
626ad5f61d6361c1f59af5d822b7d28e3a9422a3e1b6e0db8b1a97822a287da8  apps/local-server/src/routes/activityRoutes.test.ts
4f7fa69ef5171cad1d14714680c7123473d122c2e3faa5a0e929a131ed6fb69b  apps/local-server/src/routes/activityRoutes.ts
707a6df32ce2261d0cc629420fbde3a9e402d81c9056a01f9b1b63603aa216e4  apps/local-server/src/routes/providerRoutes.test.ts
f0347f9a95cd9f5c2d556398efc0ad54b276a86d8fe3260b2cf967381ff3d5bf  apps/local-server/src/routes/providerRoutes.ts
7d4aad45939751029b69dcbc2506b03af4f092c7063b38d4a42fe75a08719fb2  apps/local-server/src/server.test.ts
7df8f36a76e92f40bf62dadadee399109b6a8b8ac7e62c3890f2562d15fa2fef  apps/local-server/src/server.ts
f397b48ad36c0f2e82c2594c2323efdf13629e8966def19e3bbf484c551692ea  apps/web/src/api.ts
e03c1729a1f4a4f151329f6f8256411a10435a8da6a2e7c0fe6e130030eb6975  apps/web/src/components/activity/ActivityQueue.interaction.test.tsx
37747b82a604ca97941d23d79e2524109f873711ef05aae8d21b649d18b47dcf  apps/web/src/components/activity/ActivityQueue.tsx
671e4d111b8a3efde2f2436820a69cac6f4ae0b0d1de96abb4aca49b2d934b6c  apps/web/src/components/card222.test.tsx
691758ee55de8e8d7bc6b2db9a098303080b28cda04a91b4ff709e27181ce91f  apps/web/src/components/providers/CapabilityStatus.test.tsx
3237fe6f442ced5b293e0e013bad97f8b1ed2f74cc80c8ecc8eee65cf80e6425  apps/web/src/components/providers/CapabilityStatus.tsx
a10f727627c683c9d1bf4890f9a9cb82c4b4e3aad16d861b34f100b3a7c204c7  apps/web/src/components/providers/ProviderHub.test.tsx
76348ec8e177db7a38844c7e170819b62ed93ac63a7f768ecd721e31eb520c32  apps/web/src/components/providers/ProviderSettingsModal.tsx
caf4d83d3ef0432c589a6e4eee442369321206f3d61dc8408920c393d2033357  apps/web/src/components/TaskComposer.tsx
d0ea874a02ab03fec7cdb712e7a102aa2f69147216ab0aa75d2933dc9f8525e1  apps/web/src/i18n.ts
87ec5e2a5d419e3ae2e124bcfd9c195e8a35a8f61a0b56ab5e1f88918f48504d  apps/web/src/styles.css
18016e5898f35d1202b1dcb212a48b19935499456b7cf2b3a037d70ed1f95de4  apps/web/src/workbench.ts
245aa31d1895107bc65a05499249c228ce58c5646359e13e827bba7465306e43  docs/EVENT-SPEC.md
49aa33e5a710c665780cc0517e6634902e8b063f5af18bef0e3793c45ff519fd  docs/HARNESS-ADAPTER-CONTRACT.md
4829f8991372255c309f7eac79f3e22ef60d005c5ca86f892ff64199b3aae731  docs/POLICY-SPEC.md
ca464effc302f1d1bff6e228ae1dafdd4d0e83f6065658e7c1a6c73932737e99  docs/PROVIDER-MANAGEMENT.md
0abc999bfb29db92b9987be43d38c03bc1415140c1b6c34c63642f98bc456c92  packages/agents/src/external/ExternalAgentRuntime.ts
c766b9d542f957e0ff49d2427c6c6f6ba8b8a4fc442e21b5c2eac3c303f134e9  packages/agents/src/external/InteractiveAdapter.test.ts
303c880bdd3e563969a09e5de63697f81faceb2136571fe601d4464149fccf45  packages/agents/src/external/InteractiveAdapter.ts
08caaffcfb2b7d47418b182b85c1e1974814f5a7a96bcbd7b568d166f5f488c1  packages/agents/src/index.ts
ca8f0b6ce6454c9bb415582626f4e58224f3acfbac665a34f5d1c11429189787  packages/application/src/compose.ts
87aa0a0b4aceefecd00084e645fdfe5bd43b8e173b06d526857b56427b075e12  packages/application/src/session/effect-recovery.test.ts
235ba3f03891f84584d19f5407c6e7c4067ffdd3e0d8ce05da8a581b5a7b0b45  packages/application/src/session/SessionController.ts
5f730723684e6067210e70711c23020a9aa743394a0f2d4f8afaf5897cd6f70a  packages/context/src/compaction/Compaction.ts
81ea44df3d7a0f1d89a40064ebf21b1b3cb554dbf409a1a3caad5ad62d97cc52  packages/context/src/compaction/recovery-golden.test.ts
47d9629a538ff29f3071350758e35d8c697cc789d5699fb69ab20221018f7c40  packages/llm/src/capabilities.test.ts
ae4ac06fa89363b2ef60f5e3152e057ef9cbb3029f1a9171a57c13e843fb165d  packages/llm/src/capabilities.ts
025a2be41bf019a1be90b8e6f0fb27ec7103a037390a19010e627d3245b22086  packages/runtime/src/executor/EffectJournal.test.ts
e9e8bb7a0b2638ccaddd69946cd80ff57dfc8f6f4d0b0be17e84b39600fbe8c3  packages/runtime/src/executor/EffectJournal.ts
cdda950e35f6e4c90a4e1a8dd605237e26f75d4c1f61f4e0061a1732c1ac0fee  packages/shared/src/capabilities.ts
96bf3c2607e2944e52d716581f9719e124456225b3940fd8f79ef1f92d9cda95  packages/shared/src/projection.ts
21f6745043a96f48b8d6d0f18f09a918eaa61e0688a061364e8911780af484b8  packages/shared/src/runtimeAdapter.ts
```


## Re-review 1 — repaired snapshot

Verdict: F2 fixed; F1's test-before-save path fixed while its server cache survives, but source sign-off remains withheld for the two P2 edge cases below. No product changes made by reviewer.

### R1 — P2 — unchanged saved metadata renews expiry after cache loss (reproduced)

`apps/local-server/src/routes/providerRoutes.ts:140-150` checks only the process-local discovery cache when reconstructing server evidence. After restart (or eviction of the connection from the 32-entry cache), saving the same returned snapshot finds no discovery and labels every matching metadata value a newly observed `user_override`. The previous persisted server receipt is available through `previous.modelCapabilities` but is not consulted when the request includes capabilities. Thus an expired probe is renewed by ordinary re-save without an explicit capability edit or revalidation. Client timestamps remain correctly untrusted; the issue is treating unchanged persisted server metadata as a new user override.

Executed source-import reproducer using only an injected in-memory store and injected Response: clock1000/TTL100 -> test unsaved provider -> save returned snapshot -> clock1200 -> construct new ProviderRoutes with same store -> save unchanged snapshot. Actual result:

```json
{"restartResave":{"status":"declared","value":true,"source":"user override","evidence":{"origin":"user_override","observedAt":1200,"expiresAt":1300}}}
```

Expected: matching previous authoritative evidence retains observedAt1000/expiresAt1100; only deliberately changed declared values become new overrides. Preserve same-identity/same-value persisted evidence before applying override classification; add restart/eviction regression.

### R2 — P2 — saved-provider discovery update is not credential-bound (reproduced)

`apps/local-server/src/routes/providerRoutes.ts:194-198,222-226` still binds `bound` and the successful persistence update to URL/protocol only. TestProvider accepts an explicitly supplied alternate API key for the named provider, so a successful test with keyB replaces capabilities/catalog receipts on a saved configuration that still contains keyA. Key-dependent model visibility/support is then attributed to the wrong actual dispatch identity. The new discovery cache and save path correctly hash/compare the full connection, but this direct test persistence path bypasses that protection. Failure with keyB similarly marks keyA's receipt stale.

Executed injected fake-store reproducer after a saved fixture with keyA: call `routes.test({...input,apiKey:keyB})` at clock1200, same URL/protocol/name. Actual output (no key values emitted):

```json
{"keyUnchanged":true,"evidenceNowFromOtherKey":true,"capability":{"observedAt":1200,"expiresAt":1300,"origin":"provider_metadata"}}
```

Require matching saved credential identity as well as URL/protocol for both successful and failed test persistence. Alternate-key probe may remain cached privately under its own connection identity until that identity is saved; it must not certify the old one. Add success/failure alternate-key regressions.

### Fixed items and independent checks

- F2: focus trap now filters `[hidden]` ancestors. The introduced hidden-pane regression is fixed in source; new bidirectional focus test passes. This is source/mocked-DOM evidence, not a fresh browser keyboard acceptance.
- Readiness: selectedModel is required and included in dependencies; empty catalog cannot publish the mark. Targeted positive/empty tests pass.
- Receipt cache is bounded to 32 identities, uses canonical full connection hash privately, clones capability evidence, retains original expiry on same-process resave, and does not copy arbitrary client timestamps. Those repairs pass current new test.
- Independently reran `npx vitest run apps/local-server/src/routes/providerRoutes.test.ts`: exit0, 34 passed.
- Independently reran `npx vitest run --root apps/web src/components/providers/ProviderSettingsModal.test.tsx src/components/TaskComposer.test.tsx`: exit0, 2 files / 40 passed.
- All original browser/full-suite/platform limits remain. Passing targeted tests do not cover R1/R2.

### Re-review 1 file hashes

```text
480543158093b96fe47d02b3f8d8eea5d52219fcc91a064602a459b01fa06532  apps/local-server/src/routes/providerRoutes.ts
09ea4b1aa9bcb626f037f504f8659c52638dcad651672bf0cc867d120a2c3c7c  apps/local-server/src/routes/providerRoutes.test.ts
9f9d4223301ae1ad4da94eb26cd2b3dc2a1e72e7041586aa678879439080e27d  apps/web/src/components/providers/ProviderSettingsModal.tsx
94873028592a5afc2c8c06f92e1676075a5bdfc4fd4e16f5d67bf3548a5f669d  apps/web/src/components/providers/ProviderSettingsModal.test.tsx
78e268c3a71948f48406921d415fd5ce65ec707ffa61a0a63315c1cfb291dcd0  apps/web/src/components/TaskComposer.tsx
f61b258e1f9b9b3c0f08ce9759fa375d2cc3b4758b3e05f9d42f6abccc5e5939  apps/web/src/components/TaskComposer.test.tsx
```


## Re-review 2 — final scoped source verdict

Verdict: **source review PASS for the reviewed completion delta**, subject to the explicit product/platform/full-suite limits recorded above. F1, F2, R1 and R2 are closed in the current source snapshot; no remaining actionable source defect established. This supersedes earlier source-withheld verdicts, preserving their evidence and history. It is not a claim of full UI-10, external CLI compatibility, Windows sandbox, or test:all acceptance.

- R1: `save()` now compares incoming normalized values with same-credential persisted server snapshots when its discovery cache is absent. Matching positives keep their original `provider_metadata` origin, observation and expiry. Arbitrary incoming timestamps remain ignored; genuinely different client declarations are labeled expiring user overrides. Recreated ProviderRoutes after expiry and unchanged re-save independently reproduced retention of original expiry.
- R2: both failed-test binding and successful-test persistence require URL, protocol **and saved credential equality**. Alternate-key discovery stays in its own private cache identity; neither success nor failure changes receipts or capabilities for the saved key. Independently reproduced both outcomes.
- F2 remains fixed by filtering hidden ancestors. TaskComposer still requires the selected loaded model before publishing task-ready.
- Snapshot comparison detected additional Activity read-only explanation/i18n strings and narrow-layout CSS adjustments since initial review. Read current diffs; they do not change decision authority and introduce no identified source correctness defect. Visual/keyboard acceptance of those styles belongs to the independent UX review.

Independently executed final provider gate: `npx vitest run apps/local-server/src/routes/providerRoutes.test.ts` -> exit0, **34 passed**, duration5.66s. Source-import negative reproducer uses injected in-memory store/Response only, no network or actual credentials:

```json
{"restartResave":{"status":"declared","value":true,"source":"model metadata","evidence":{"observedAt":1000,"expiresAt":1100,"origin":"provider_metadata"}},"alternateKeySuccessUnchanged":true,"alternateKeyFailureUnchanged":true}
```

Previously independently verified unchanged Web repair files: 2 files / 40 passed (re-review1). Earlier journal/recovery/facade/golden/provider gate: 5 files /54 passed. No broader gate implied. Only this report was written by reviewer.

### Final reviewed source SHA-256 snapshot

All changed tracked source/tests/styles against baseline plus the explicitly named untracked source/tests. This snapshot replaces previous hash sets for source review. Any subsequent source edit requires affected-file re-review.

```text
89f688ce84121a0461231e9d2b7eecc3b2f85bdfaffab54d529df6819b5f1add  apps/local-server/src/providers/ProviderStore.ts
626ad5f61d6361c1f59af5d822b7d28e3a9422a3e1b6e0db8b1a97822a287da8  apps/local-server/src/routes/activityRoutes.test.ts
4f7fa69ef5171cad1d14714680c7123473d122c2e3faa5a0e929a131ed6fb69b  apps/local-server/src/routes/activityRoutes.ts
30f343143d6694a855d4e7909d439a58b271710970dacf7991d57f03e0af4578  apps/local-server/src/routes/providerRoutes.test.ts
487c61207fb90ec47faac497f4a7693e892d98868e7a0cf72e0f2ac2eecaf2ec  apps/local-server/src/routes/providerRoutes.ts
7d4aad45939751029b69dcbc2506b03af4f092c7063b38d4a42fe75a08719fb2  apps/local-server/src/server.test.ts
7df8f36a76e92f40bf62dadadee399109b6a8b8ac7e62c3890f2562d15fa2fef  apps/local-server/src/server.ts
f397b48ad36c0f2e82c2594c2323efdf13629e8966def19e3bbf484c551692ea  apps/web/src/api.ts
e03c1729a1f4a4f151329f6f8256411a10435a8da6a2e7c0fe6e130030eb6975  apps/web/src/components/activity/ActivityQueue.interaction.test.tsx
e29d03b8ddf155380681c7f914a6ce1992c63eafc2e587b56a10d636b42e8854  apps/web/src/components/activity/ActivityQueue.tsx
671e4d111b8a3efde2f2436820a69cac6f4ae0b0d1de96abb4aca49b2d934b6c  apps/web/src/components/card222.test.tsx
691758ee55de8e8d7bc6b2db9a098303080b28cda04a91b4ff709e27181ce91f  apps/web/src/components/providers/CapabilityStatus.test.tsx
3237fe6f442ced5b293e0e013bad97f8b1ed2f74cc80c8ecc8eee65cf80e6425  apps/web/src/components/providers/CapabilityStatus.tsx
a10f727627c683c9d1bf4890f9a9cb82c4b4e3aad16d861b34f100b3a7c204c7  apps/web/src/components/providers/ProviderHub.test.tsx
94873028592a5afc2c8c06f92e1676075a5bdfc4fd4e16f5d67bf3548a5f669d  apps/web/src/components/providers/ProviderSettingsModal.test.tsx
9f9d4223301ae1ad4da94eb26cd2b3dc2a1e72e7041586aa678879439080e27d  apps/web/src/components/providers/ProviderSettingsModal.tsx
f61b258e1f9b9b3c0f08ce9759fa375d2cc3b4758b3e05f9d42f6abccc5e5939  apps/web/src/components/TaskComposer.test.tsx
78e268c3a71948f48406921d415fd5ce65ec707ffa61a0a63315c1cfb291dcd0  apps/web/src/components/TaskComposer.tsx
2e20478e17cfab66a732840bd8f9e21d64b7eda937f6e9933e6d61c13c68ea77  apps/web/src/i18n.ts
8b8cbf842582c0447e616c5ec3bdd163184dbed183c885f993692d2347fe71ac  apps/web/src/styles.css
18016e5898f35d1202b1dcb212a48b19935499456b7cf2b3a037d70ed1f95de4  apps/web/src/workbench.ts
0abc999bfb29db92b9987be43d38c03bc1415140c1b6c34c63642f98bc456c92  packages/agents/src/external/ExternalAgentRuntime.ts
c766b9d542f957e0ff49d2427c6c6f6ba8b8a4fc442e21b5c2eac3c303f134e9  packages/agents/src/external/InteractiveAdapter.test.ts
303c880bdd3e563969a09e5de63697f81faceb2136571fe601d4464149fccf45  packages/agents/src/external/InteractiveAdapter.ts
08caaffcfb2b7d47418b182b85c1e1974814f5a7a96bcbd7b568d166f5f488c1  packages/agents/src/index.ts
ca8f0b6ce6454c9bb415582626f4e58224f3acfbac665a34f5d1c11429189787  packages/application/src/compose.ts
87aa0a0b4aceefecd00084e645fdfe5bd43b8e173b06d526857b56427b075e12  packages/application/src/session/effect-recovery.test.ts
235ba3f03891f84584d19f5407c6e7c4067ffdd3e0d8ce05da8a581b5a7b0b45  packages/application/src/session/SessionController.ts
5f730723684e6067210e70711c23020a9aa743394a0f2d4f8afaf5897cd6f70a  packages/context/src/compaction/Compaction.ts
81ea44df3d7a0f1d89a40064ebf21b1b3cb554dbf409a1a3caad5ad62d97cc52  packages/context/src/compaction/recovery-golden.test.ts
47d9629a538ff29f3071350758e35d8c697cc789d5699fb69ab20221018f7c40  packages/llm/src/capabilities.test.ts
ae4ac06fa89363b2ef60f5e3152e057ef9cbb3029f1a9171a57c13e843fb165d  packages/llm/src/capabilities.ts
025a2be41bf019a1be90b8e6f0fb27ec7103a037390a19010e627d3245b22086  packages/runtime/src/executor/EffectJournal.test.ts
e9e8bb7a0b2638ccaddd69946cd80ff57dfc8f6f4d0b0be17e84b39600fbe8c3  packages/runtime/src/executor/EffectJournal.ts
cdda950e35f6e4c90a4e1a8dd605237e26f75d4c1f61f4e0061a1732c1ac0fee  packages/shared/src/capabilities.ts
96bf3c2607e2944e52d716581f9719e124456225b3940fd8f79ef1f92d9cda95  packages/shared/src/projection.ts
21f6745043a96f48b8d6d0f18f09a918eaa61e0688a061364e8911780af484b8  packages/shared/src/runtimeAdapter.ts
```


## Re-review 3 — final frozen-source follow-up

Verdict: **PASS for this final bounded source delta**. Previous source verdict and closed findings remain valid; no new actionable defect found. Scope excludes unrelated HANDOFF/HARNESS2 planning edits. Full DoD limits remain: source review does not certify full UI-10/real zoom, OS sandbox coverage, installed external CLI compatibility, or a full test:all run.

Inspected current callers and changes:

- Sidebar confirmation states the whole Topic group's actual `group.sessions.length` and Recycle Bin destination; confirm still passes the same complete ID set to the existing deletion handler. New wrapping styles give the confirmation and text full row width without changing deletion behavior. Both languages provide the count-bearing message.
- Team Stage source now resolves projectRoot using stage.sessionId against SessionRegistry. TeamStageRoutes retains that owning session ID; ActivityRoutes prefers the supplied owning project before the legacy fallback. New attribution assertion matches this DTO path. No session navigation or team decision authority changes.
- Both saved-provider test callers refresh configured provider data after successful HTTP responses with `ok:false`, so server-stale receipts become visible immediately. Success-only onChanged notification remains unchanged. Error/readback failures retain the existing error surface; the added mocked React test checks stale text and second list request. Catalog-unverified copy is distinct from connection untested copy.
- CSS contains bounded one-column composer/input geometry, nonshrinking goal enqueue action, inline completed heading, stronger selected/success text, themed subagent background, and wrapped confirmation scope. No hiding of errors/actions or permission/state changes identified in source. Actual rendering/contrast acceptance belongs to the independent UX evidence.
- TaskComposer change since last verdict is a truthful comment: state-ready animation frame, with paint measured separately; readiness runtime guard remains unchanged.
- Read `2026-10-23-completion-browser-fixture.mjs` for isolation only, without running it. Fixture asserts a system-temp root, sets state roots before importing runtime modules, explicitly supplies temp registries/review/provider roots and memory credential backend, and writes acceptance artifacts under evidence. It reads only the configured endpoint from local OpenCode configuration and obtains the authorized provider token from environment without logging it. Injected subagent/goal/widget/plan entities are labeled fixtures; no external agent executable is launched. Team plan is staged for reject, no execution. This does not turn source fixtures into real subagent execution evidence.

Independent final-delta checks:

```powershell
npx vitest run apps/local-server/src/routes/activityRoutes.test.ts
# exit0; 1 file /44 passed
npx vitest run --root apps/web src/components/Sidebar.test.tsx src/components/providers/ProviderHub.test.tsx src/components/providers/ProviderSettingsModal.test.tsx
# exit0; 3 files /43 passed
```

Coordinator reports aggregate20261023-122432:448 targeted root +483 Web/all7checks exit0. This reviewer independently executed only the targeted checks listed here and earlier, not that aggregate script or test:all. Only this review report was modified.

### Frozen final-delta SHA-256

These are the final rechecked files, replacing prior hashes for matching paths. Unlisted source retains re-review2 hashes. The fixture hash identifies inspected evidence code, not a new execution.

```text
090fffcf6c3c33435e61366c08756d6f48df0d15b9e95be133a580c432600249  apps/web/src/components/Sidebar.tsx
1ffc46f217d24396d4f6eb6361fb0664cf97ebd07a38cad1835a7feaabf9e0de  apps/local-server/src/routes/activityRoutes.ts
bb8b4f861ebeb4e2c2fc2a72a73dee079205222a5efead6e9be31604b9f6c7f5  apps/local-server/src/routes/activityRoutes.test.ts
be7705902e52cd22b1c5016715e6a72c1dd2af86961c3d4269dbda98bc10fbda  apps/local-server/src/server.ts
ba6879a3e23dd2427ac92c12776518061cb68250e147f9e236fcfc25fdd3d1f4  apps/web/src/components/providers/ProviderSettingsModal.tsx
ecde7d1255d8a6d368258e5bc7639b6e1556275e927af170c41450485752930a  apps/web/src/components/providers/ProviderHub.test.tsx
e37ff1c56272fdaf8bd32324477cb33093f51f96165f7742f0d6bd0e37cec523  apps/web/src/styles.css
c133e451ca63368796b268ecac8afb3605b94e95b955b7890fe156ca4e91e5a0  apps/web/src/i18n.ts
d9641a734721801acc050d32f6e158e5a130efd33bd55454bec580bac070a412  apps/web/src/components/TaskComposer.tsx
b00556bd169ecd433ef6dd64f01c10b93d6620476b68176f1676b9dd5ce565cb  evidence/sessions/2026-10-23-completion-browser-fixture.mjs
```

