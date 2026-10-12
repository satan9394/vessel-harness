# Card 211 work proof

Conclusion: PASS. Credential-backed provider APIs and real session provider selection are implemented locally.

## Changes

- Copied the existing ProviderStore/defaultStore implementations into apps/local-server/src/providers. CLI files now re-export the same public symbols through @vessel/local-server; existing methods and credential/backup behavior are preserved. The only implementation import adjustment points envRoot/vesselHome directly at @vessel/shared.
- Added GET/POST /api/providers, DELETE /api/providers/:name, POST /api/providers/test, GET /api/models. POST upserts configurations with correctly rotated credential references; DELETE responds {ok:true}. Built-in mock is available in the model catalog and cannot be changed or removed through provider CRUD.
- DTOs never expose apiKey/secretRef. Short keys are fully masked. Legacy credential-bearing URLs and corrupt stores fail with sanitized errors. Input validation rejects unsafe URLs, unsupported protocols, invalid names/models/keys; keyless loopback OpenAI-compatible endpoints support Ollama.
- Probe requests use authentication, redirect:error and an 8-second abort signal, validate model-list shape and return sanitized HTTP/transport/timeout error codes. Real upstream response bodies never appear in API errors.
- Default session creation resolves configured provider/model, instantiates the existing llm provider factory, records the provider id/model and preserves permission. Builder injection enables deterministic offline proof. Unknown selections fail explicitly. Credential routes and real-session creation reject foreign Origin headers.

## Verification

All requested gates after the final source/test edit passed:

- npx vitest run apps/local-server/src/routes/providerRoutes.test.ts: 1 file, 23 tests passed, exit 0. Log: card211-target.log.
- npx vitest run apps/local-server: 17 files, 136 tests passed, exit 0. Log: card211-local-server-final.log.
- npx tsc -b tsconfig.json: exit 0. Log: card211-tsc.log.
- npm run typecheck:tests: exit 0. Log: card211-tests-types.log.

Additional compatibility: apps/local-server plus apps/cli/src/providers passed 29 files / 268 tests, exit 0 before the final DTO hardening and project-open baseline restoration. Log: card211-local-server-and-store.log. Parent also separately verified CLI store compatibility.

Tests inject temporary stores beneath os.tmpdir(), memory credentials, fake fetch and a deterministic provider builder. Session proof checks actual turn output, chosen provider/model metadata and read-only permission. No real model calls or external agent processes were driven. Source scope is apps/local-server plus two CLI compatibility files; packages/core, llm, application, dependency files and package locks were not edited by this worker. Baseline V2.5 changes in server.ts/server.test.ts/widgetRoutes.ts were preserved.

Next: card212 may consume these DTOs and routes; card213 adds dynamic switching separately.
