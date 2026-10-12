# Card 212 proof — provider settings and connection tester

Result: PASS for implementation/component/API/type/build and parent browser gates.

Parent browser acceptance: rendered Chinese settings opened from the toolbar; keyless Ollama template pointed at an isolated local HTTP fixture, connection succeeded with 67 ms latency and discovered fixture-a/fixture-b; saved provider appeared in the list. Switched to English, opened settings via Ctrl+K and Enter, and verified Claude preset fills Anthropic protocol and endpoint. Screenshots: card212-settings-zh.png and card212-settings-en.png. No real credentials or paid model calls. The preview fixture now injects a temporary ProjectRegistry; an earlier preview used the default project index and its temporary project entry is preserved.

Responsive acceptance: at 800×800, document scrollWidth was 800 and modal scrollWidth equaled clientWidth (603), with its bounds inside the viewport. The form scrolls vertically and Close remains reachable. Screenshot card212-settings-800.png. Preview stopped after acceptance; viewport override reset.

## Scope and behavior

- Added typed provider/model DTOs and five API client methods using the existing authenticated JSON wrapper. Delete provider names use encodeURIComponent.
- Added ProviderSettingsModal with provider cards, masked key display, protocol labels, DeepSeek/OpenAI/Claude/Ollama/custom presets, name/protocol/URL/password/models inputs, model discovery, test latency and localized failure feedback.
- Validation rejects reserved/invalid/duplicate names, unsafe endpoint URLs, missing remote keys and empty/invalid models. Loopback OpenAI-compatible endpoints permit blank keys. Built-in mock is excluded from editable configuration.
- Failed initial provider listing locks form/test/save until retry succeeds, preventing an unseen configuration from being overwritten by the server's upsert endpoint. Deletion requires an explicit second confirmation.
- Modal has labeled fields, password autocomplete suppression, accessible live status/alerts, Escape handling, forward/reverse focus boundaries and focus restoration. Busy operations lock inputs and dismiss controls; operation results after unmount are ignored.
- Toolbar and Ctrl+K command open the modal. App providerRevision increments on saved/deleted config; card 213 will connect it to model consumers.
- All new prose and protocol labels use the strongly typed bilingual dictionary. Provider/model identifiers remain source data.

## Changed paths

- apps/web/src/api.ts
- apps/web/src/App.tsx
- apps/web/src/i18n.ts
- apps/web/src/styles.css
- apps/web/src/components/providers/ProviderSettingsModal.tsx
- apps/web/src/components/providers/ProviderSettingsModal.test.tsx
- tasks/212-provider-settings-modal-and-connection-tester.md

Earlier card changes in these shared files were preserved. No packages/core, dependencies, locks, external agents, commits, pushes or publication were touched by this worker.

## Accepted checks after final source/test edit

| Check | Evidence | Result |
| --- | --- | --- |
| Target provider tests | card212-target-accepted.log | 13 passed / 1 file |
| Full Web root | card212-web-accepted.log | 269 passed / 31 files |
| Web typecheck | card212-typecheck.log | exit 0 |
| Test typecheck | card212-tests-types.log | exit 0 |
| Safe Web build | card212-build.log | exit 0 |
| git diff --check | direct command | exit 0 |

Commands: npx vitest run --root apps/web src/components/providers/ProviderSettingsModal.test.tsx; npm run -w @vessel/web test; npm run -w @vessel/web typecheck; npm run typecheck:tests; npm run -w @vessel/web build -- --emptyOutDir false.

Tests use the existing repository dependency-free hook/element harness in the Node Web test environment. They exercise preset/form/test/save/delete/error/focus/unmount handlers plus validation and real API client wiring. Live DOM observation belongs to the parent browser integration proof.

Build includes the pre-existing shared node:fs/node:path/node:os browser externalization warnings; these same warning classes were verified in card210-web-build.log. No new warning class came from this card. Dist was retained with emptyOutDir false.
