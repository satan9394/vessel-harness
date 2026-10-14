# Card 220 evidence

Acceptance source: architecture plan sections 8–9; UI plan sections 5.3 and 6.4. Scope and final verdict live in `tasks/220-provider-capability-contract-and-layered-cache.md`.

## Reproduce

- `npx vitest run apps/local-server/src/routes/providerRoutes.test.ts apps/local-server/src/routes/sessionInspector.test.ts packages/llm/src/capabilities.test.ts packages/context/src/cache packages/context/src/compaction/assertCompactionConservation.test.ts packages/context/src/compaction/projectionCommit.test.ts`: 59 passed, exit 0 (`targeted-backend-accepted.log`).
- `npx vitest run --root apps/web src/components/providers/CapabilityStatus.test.tsx src/components/providers/ProviderSettingsModal.test.tsx src/components/ModelSelector.test.tsx src/components/layout/DualSurfaceLayout.test.tsx src/i18n.test.ts`: 61 passed, exit 0 (`targeted-web.log`).
- Required final order after the last source edit: `npx tsc -b`, `npm run typecheck:tests`, `npm run -w @vessel/web build -- --emptyOutDir false`, `npm run test:all`; current final run logs `accepted-final-01-tsc.log` through `accepted-final-04-test-all.log`; machine exit codes and timestamps are in `accepted-final-gates.json`. All four commands completed sequentially with exit 0 after the last source/test edit (00:54:21 UTC). Root: 279 files / 2970 passed / 6 skipped; Web: 35 files / 301 passed; total 3271 passed / 6 skipped. The unchanged AST mean <=15ms / peak <=25ms gate passed in this full run. Final scope audit: core diff and untracked core files empty; manifests/npm lock unchanged; no non-npm locks; git diff --check exit 0. See completion-audit.json.
- Initial full gate failed in the 100-round resilience scenario because accumulated tool previews exceeded a 128 KiB archive record budget (`04-test-all.log`, exit 1; Web root did not run). The repair bounds bulky excerpts by UTF-8 bytes and retains exact pair identities/source references. Actual unchanged 100-round scenario plus projection regressions: 12 passed, exit 0 (`repair-resilience.log`); independent compaction/conservation/resilience review: 20 passed. Core and benchmark budgets/assertions unchanged.
- The subsequent full run (`accepted-04-test-all.log`) was intentionally interrupted, exit -1, before a terminal product verdict to repair explicit negative capability requirements being overwritten by inferred positive requirements. Its preceding accepted build gates are retained as historical evidence, not final acceptance. Final negotiation validates explicit and inferred requirements independently.
- Explicit constraint regression: `repair-explicit-capabilities-red.log` records 3 failing tests before repair; `repair-explicit-capabilities-green.log` records 28 passed / exit 0 afterward. Six conflict cases cover tools/reasoning/streaming against both supported and unsupported snapshots, asserting `CapabilityMismatchError` and zero transport calls. Independent final review: 13 capability tests passed.
- `final-04-test-all.log` failed the unchanged AST timing gate (mean 18.1104 ms >15 ms; peak 22.0265 ms <25 ms). All other root tests passed; Web did not run. No AST source or test threshold was modified. Isolated unchanged AST suite: 12 passed (`ast-timing-isolated.log`); direct fixture measurement: mean 4.0599 ms / peak 8.9045 ms, exit 0 (`ast-timing-measurement.log`). A new ordered gate sequence follows with no other Vitest run active at its start.
- `verified-04-test-all.log` also failed AST timing (mean 18.5605 ms / peak 31.9091 ms). A scoped gate blocker was added to the card before repairing AST caching. The repair reuses lexical compiler host/options/canonical paths/module resolutions, invalidates on file-set/path-mapping changes, and retains fresh Program/type-checker and complete reverse dependency refresh. Scoped AST/tool regressions: 17 passed (`ast-repair-scoped.log`). Controlled identical two-worker SHA-256 load: baseline mean 3.636 ms / peak 7.079 ms, candidate 3.392 ms / 5.491 ms, precision 100% (`ast-performance-repair.log`); this modest result does not substitute for the full gate. Helpers stopped. Original fixture, warmup/samples, 15/25ms thresholds and benchmark budgets unchanged. Initial measurement-helper ESM error retained in `ast-performance-harness-error.log`.

## Independent review

PASS after repairing oversized tool payload summaries, repeated summary source ranges, durable instruction refresh, variant adapter/API capability parity, and stale model metadata pruning. Independent focused review: 47 tests; provider API regression: 30 tests. Final gates owned by parent.

## Browser

`npx tsx evidence/sessions/2026-10-13-card220/browser-fixture.ts` starts an isolated offline fixture at port 32820 (availability checked before start). State is test-owned under `os.tmpdir()`, with isolated provider/usage/session/project roots and a local HTTP model endpoint. No real credentials or external models.

Verified provider per-model declared/unknown states, selected-model evidence, two actual model requests, Context revision and four layer hashes/counters. Freshly compiled application: switching fixture-a → fixture-b invalidates provider prefix once and token estimates twice; prior messages remain visible. English/Chinese evidence and 800px Inspector screenshot saved. At 800px document scrollWidth=800; browser warning/error log empty. Viewport restored; tab and fixture stopped.

Screenshots: `provider-zh.png`, `context-zh.png`, `context-en.png`, `context-en-800.png`. Structured observations: `browser-observations.json`; outbound model observations: `browser-model-observations.jsonl`.

## Evidence boundaries

- Endpoint metadata is declared, never labelled detected. The contract accepts evidence-bearing detected snapshots; this delivery did not probe real upstream feature execution. Unknown remains distinct. Unsupported mandatory constraints fail before dispatch; unsupported adapter serialization cannot be enabled by metadata.
- Four cache layers are process-local derived caches. Provider prefix caching is local prefix assembly/reuse, not proof of upstream cache acceptance or billing savings.
- Tool pair identities and immutable event references are preserved exactly; large tool payloads have bounded previews and remain complete in the physical event log. Goals, constraints, latest instructions, and denial records remain verbatim. Regression fixtures cover repeated compression and >80% reduction of a 100KB tool history.
- No commit, push, publication, external harness invocation, dependency installation, lock migration, or permanent deletion.

## Final gate blocker repair

`delivery-04-test-all.log` failed the unchanged AST timing gate: mean 18.1397 ms / peak 26.9879 ms, root 2963 passed / 6 skipped / 1 failed; Web root did not run. I/O diagnostics isolated repeated opens as the dominant latency (`ast-io-stages.log`, `ast-fd-identity-diagnostic.log`). Descriptor reuse improved timing but broke atomic file replacement on Windows; candidate rejected and fully reverted. Failure log and candidate snapshots remain in `ast-fd-repair-scoped.log`, `ast-fd-rejected-source.txt`, and `ast-fd-rejected-tests.txt`.

Accepted implementation uses awaited UTF-8 reads and serialized per-instance indexing. Every request reads fresh bytes; failed staging does not publish partial sources, and rejection does not poison the queue. Injected policy readers remain authoritative, with no disk fallback. No retained handles, threshold changes, fixture changes, or core edits. Scoped AST/tool tests: 20 passed / exit 0 (`ast-async-repair-scoped.log`); independent AST/pruning review: 25 passed. Atomic replacement, same-size rewrites, removal/recreation, concurrent additions, and failed-read queue recovery are covered.

CLI/TUI's shared provider factory now forwards stored model snapshots while discarding endpoint-mismatched metadata. Genuine red: 3 failed (`repair-cli-capabilities-red.log`); green: 12 passed (`repair-cli-capabilities-green.log`). Independent review: 12 passed; required false/unknown capabilities block chat and streaming with zero fetches.
