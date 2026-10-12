# Card 206 work proof

Implemented StreamingReasoningBlock in apps/web/src/components/widgets and integrated the real ConversationView → MessageList SSE path. The disclosure ticks every 100ms while streaming, automatically collapses at first body-text chunk or stream/turn termination, allows manual expansion, and cleans up timers. Recalled-rule disclosures sit above the reasoning block and expose lesson/reflection as escaped React text with historical-guidance provenance. CSS uses theme variables, progressive native details animation, and reduced-motion overrides.

The local-server ReasoningStream observes existing before_model/model_stream_start/model_stream_delta/model_stream_end/after_model/after_turn events. It emits keyed call IDs, uniquely identifies retried attempts, closes interrupted/missing-end reasoning calls, and projects only historical rules actually included in memory-source model-envelope messages. It sends rule fields only, never raw messages or full prompt/prefix data. Browser-side thinking-frame validation rejects malformed token counts, times, and callouts. Session-switch guards prevent an earlier awaited turn from updating the new session's busy/error/reasoning state.

Token-rate provenance: actual positive normalized output counts divided by full model-call elapsed time are labeled `output tokens/s (model-call average)`. Actual reported reasoning counts can yield `reasoning tokens/s (provider reported)`; absent counts remain unavailable. Existing thin-core stream accumulation neither emits usage chunks nor preserves reasoning-token counts. No core/provider edits or invented text-based token estimates were made. The HTTP integration fixture pins unavailable reasoning count and actual output count; independent seam tests pin supplied reasoning counts including zero. A second offline fixture places a recalled rule in the actual provider envelope and verifies its SSE callout while excluding the raw historical header.

## Accepted checks after the final implementation edit

- Root focused server + seam: 2 files, 28 passed, exit 0 (`card206-server-accepted.log`, `card206-server-exit.json`).
- Web focused streaming interaction, conversation reconciliation, SSE validation and existing component regression: 4 files, 22 passed, exit 0 (`card206-web-accepted.log`, `card206-web-exit.json`).
- `npx tsc -b tsconfig.json`: exit 0 (`card206-tsc-accepted.log`, `card206-tsc-exit.json`).
- `npm run typecheck:tests`: exit 0 (`card206-test-types-accepted.log`, `card206-test-types-exit.json`).
- `npm run -w @vessel/web typecheck`: exit 0 (`card206-web-types-accepted.log`, `card206-web-types-exit.json`).
- `git diff --check`: exit 0 (`card206-diff-check.log`). `git diff --numstat -- packages/core` produced no lines.

Initial server failure is retained in `card206-initial-server.log`: test expected a reasoning usage event the thin core does not emit. The accepted integration test verifies the available output-count event and unavailable reasoning-count semantics. Initial web/type logs are retained; no evidence was deleted.

All implementation/test changes are in apps/web, apps/local-server, or packages/shared. No dependency/lock edits, external agent execution, filesystem deletion, commits, pushes, or publishing. Legacy ThinkingBlock remains for its existing standalone compatibility surface; the live MessageList now uses StreamingReasoningBlock. Full dual-root regression, production web build and rendered cross-device QA belong to final Epic 209 integration.
