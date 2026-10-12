# Card 213 — real session model selection and switching

Implementation scope: `apps/web` and `apps/local-server`; no dependencies, lockfiles, core/application/llm changes, commits, pushes, publication or external-agent invocation.

- New-session form loads configured real models, submits the exact provider/model pair, localizes failures, and offers configuration guidance even when the catalog only contains the built-in mock. Offline demonstration remains available when no real model is configured.
- Opening provider settings hides (preserves) the mounted form; closing returns to its workspace/permission values. Provider revisions refresh catalog choices.
- Conversation header now contains the actual session model dropdown. Busy turns disable switching. Successful switches refresh session metadata; failed switches retain the previous selection. Deferred responses are owned by the session generation; catalog refresh preserves an active switch and navigation/unmount releases its busy ownership.
- Removed the old Auto/Fast/Pro selector and its TeamModule caller. Team's independent roster routing APIs remain intact.
- `PATCH /api/sessions/:id/model` validates input/provider/model and rejects foreign origins and active turns/team stages/runs. It builds the replacement before updating metadata/transport; write failures restore metadata and preserve the old transport.
- The local `SessionModelHub` delegates all main/streaming/compaction/retry calls to the selected real provider/model while retaining the original controller, conversation, lease, permission policy and SSE subscriptions. Transport calls are audited in `<session-dir>/model-delegations.jsonl` with actual provider/model/request kind, without config, keys, prompts or upstream errors.
- Shared origin validation rejects matching foreign Host/Origin for unauthenticated requests (DNS rebinding). Authenticated remote bindings still require the daemon token and same-origin check.

## Deliberate limits

`ponytail:` Controller composition retains an explicit fixed `local-model-hub` identity and the existing context-window default/output reserve (4096). Internal request/header/cache observations refer to the hub invocation; the delegation audit is the authority for the actual endpoint/model. Endpoint-specific token limits are unknown and are not guaranteed by these defaults. Strict hub pricing remains unpriced/estimated (zero tariff); actual provider usage tokens are retained, and no inferred vendor/model tariff is presented as billing truth. Custom injected `sessionFactory` controllers that do not use the hub reject switching with `model_switch_unavailable`.

## Reproduction / accepted evidence

Current source/test gates are recorded in `card213-gates.json`; accepted logs use the `-accepted-2.log` suffix. Earlier logs are retained for diagnosis and are not the final evidence.

- Targeted backend: `npx vitest run apps/local-server/src/sessionModelHub.test.ts apps/local-server/src/routes/providerRoutes.test.ts` — 37 tests / 2 files.
- Targeted Web: `npx vitest run --root apps/web src/components/NewSessionForm.test.tsx src/components/ModelSelector.test.tsx src/components/palette/CommandPalette.test.tsx` — 18 tests / 3 files.
- Web: `npx vitest run --root apps/web` — 277 tests / 33 files.
- Local-server: `npx vitest run apps/local-server` — 150 tests / 18 files.
- Build/type gates: `npx tsc -b tsconfig.json`, `npm run typecheck:tests`, `npm run -w @vessel/web typecheck`, `npm run -w @vessel/web build -- --emptyOutDir false` — all exit 0 after the final source/test edit. Core diff is empty.

Runtime integration tests use only test-owned temporary stores and injected offline providers. They verify changed outgoing provider/model, preserved prior conversation and permission, a continuing open SSE reader, invalid/failed/busy/cross-origin rejection, metadata rollback, stream/cancellation/compaction delegation and secret-free audits. Component tests exercise form settings return, exact create payload, real model switching, failures, busy state, provider refresh and deferred-session ownership.

Browser integration and Epic 214's dual-root final battery are owned by the parent integration pass; this card proof does not substitute for them.

Parent integration acceptance: actual Chinese/English browser flow, form input preservation, keyless local probe/discovery/save, real model creation and fixture-a → fixture-b switching with retained history passed. Independent transport observed message counts 2 → 4. See browser-acceptance.md and browser-model-observations.jsonl. Preview stopped; final Epic gates are recorded separately in PROOF.md.
