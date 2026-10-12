# Vessel V2.6 — Epic 214 work proof

Status: PASS, local acceptance completed 2026-10-11. Cards 210 → 211 → 212 → 213 → 214 closed in dependency order under the bounded Mission. Existing uncommitted V2.5 work was preserved; HEAD remains dd8e72c. No commit, push or publication.

## Delivered behavior

- Strongly typed, aligned Chinese/English dictionaries and translated Web consumers, including new-session, patch/diff, reasoning, palette, attention, Inspector, team, goal, subagent and usage interfaces. Protocol values, provider/model identifiers, product names and user/model content remain exact. Dictionary/interpolation and real-context rerender tests cover both languages.
- ProviderStore reused in local-server with CLI compatibility re-exports. GET/POST/DELETE /api/providers, POST /api/providers/test and GET /api/models expose safe DTOs and bounded authenticated probes; session creation binds the selected real endpoint/model. No keys/secret references in responses or upstream error bodies. URL validation, no-redirect credential forwarding and unauthenticated loopback Host/Origin checks protect the routes.
- Accessible bilingual provider settings with DeepSeek/OpenAI/Claude/Ollama presets, endpoint/key/model inputs, connection latency/discovery, save/delete, toolbar and Ctrl+K entry. Committed mutations invalidate consumers even if subsequent readback fails; failed initial load blocks unseen overwrite.
- Real model pickers replace Auto/Fast/Pro. New-session inputs survive settings; in-session switching changes actual outgoing model while preserving conversation, policy, controller and SSE ownership. Active turns/team activity reject switching; validation/write failures retain the previous transport. Generation ownership ignores stale UI responses.

Card evidence: [210](card210-proof.md), [211](card211-proof.md), [212](card212-proof.md), [213](card213-proof.md).

## Final gates after the last source/test edit

All seven exit 0. Exact commands, start/end timestamps and log paths: [accepted-gates.json](accepted-gates.json). Log prefix: accepted-20261011-153119.

| Gate | Accepted result |
|---|---|
| npm run test:all | root 268 files / 2869 passed + 6 skipped; Web 33 files / 277 passed; total 3146 passed |
| npx tsc -b tsconfig.json | exit 0 |
| npm run typecheck:tests | exit 0 |
| npm run -w @vessel/web typecheck | exit 0 |
| npm run -w @vessel/web build -- --emptyOutDir false | exit 0; no Node browser-externalization warnings |
| npx tsx apps/cli/src/cli.ts --help | exit 0 |
| Thin core/protected hashes | core 0 changed lines; 125 baseline hashes unchanged |

[completion-audit.json](completion-audit.json): zero tracked deletions, zero alternate package-manager files, zero active workers, unchanged HEAD. Root dependency/lock and core/application/llm sources are protected by baseline hashes. Source scope remains Web/local-server/CLI/shared. No external Agent process or live cross-harness lane invoked. Test-created temporary paths follow the written tmpdir exception; no repository/user data was permanently deleted. All Web builds retained existing output with emptyOutDir false. git diff --check passes.

Runnable final verification: run-final-gates.ps1, then completion-audit.ps1. Earlier failed/intermediate logs are preserved and are not acceptance evidence. Test output retains Node experimental/deprecation warnings; the final Web build has no browser-externalization warnings.

## Independent review and actual browser acceptance

[Independent review](independent-review.md): PASS after origin and committed-mutation repairs; no additional actionable source defects. Reviewer did not self-certify test execution; parent gates above supply execution proof.

[Browser acceptance](browser-acceptance.md): actual built Chinese/English UI; empty-model configuration guidance; keyless loopback probe (26 ms), discovery and save; workspace/read-only values preserved; fixture-a session creation, first turn, fixture-b switch and second turn in the same conversation. Independent outgoing transport observations record model/messageCount fixture-a/2 → fixture-b/4. Desktop and 800px layouts observed; 800px document scrollWidth equals clientWidth. Snapshots and integrated screenshots retained. Preview stopped and viewport override reset.

## Deliberate limits and preserved state

The browser fixture and tests prove local contracts/transport selection, not live vendor compatibility, OS notifications or paid billing. Internal controller composition uses the stable local-model-hub identity with existing defaults; endpoint-specific token limits are unknown. Actual provider/model request kinds are recorded in the secret-free model-delegations.jsonl audit. Strict pricing remains unpriced/estimated at zero tariff and must not be treated as vendor billing truth. See card213-proof.md for the contract.

The earlier preview registered a temporary project in the default project index before isolation was corrected. That record is preserved, not silently deleted; card212 proof documents it. The final fixture explicitly isolates ProjectRegistry alongside provider/usage/session/workspace roots.

HANDOFF.md, task cards/index and machine bounded state are synchronized. Mission completed; no next card/route automatically started. New work requires a new user instruction.
