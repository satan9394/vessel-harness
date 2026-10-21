# Task 250: Fix F1 (Session Completion Inference & Error Kind Alignment) and F2 (Stored Credential Destination Binding)

## Role & Objectives
You are a Senior Systems & Security Engineer executing Task 250 via Codex CLI (`gpt-6.1-sol`, reasoning: medium).
Your mission is to directly fix the two HIGH-severity vulnerabilities discovered and proven in Task 249:

### 1. Fix F1: False `completed` Projection and Turn Error Kind Alignment
**Files**: `apps/local-server/src/server.ts` and `apps/local-server/src/routes/activityRoutes.ts`
- **Cause 1**: In `apps/local-server/src/server.ts:402-408`:
  The server checked `lastTurnEnd?.kind === 'failure'`. However, core/application execution turns end with kind `'error'` (or `'budget'`), NOT `'failure'`.
  Change this to recognize `'error'` and `'budget'` as `'failed'`, alongside `'failure'`.
- **Cause 2**: In `apps/local-server/src/routes/activityRoutes.ts:157-162`:
  The route checked `typeof session.recordCount === 'number' && session.recordCount > 0` and defaulted `status` and `outcome` to `'completed'` with `statusSource = 'inferred'`. This turned incomplete, crashed, or errored historical sessions into false "completed" receipts!
  Fix: Remove the false completion inference. In the absence of a confirmed terminal success run or record, assign an accurate, non-completed state (e.g., `'unknown'` or `'interrupted'`). Ensure `errorDetail` is preserved and not silently dropped.

### 2. Fix F2: Bind Stored Credential to Saved Provider Destination
**File**: `apps/local-server/src/routes/providerRoutes.ts`
- **Cause**: In `test(value: unknown)` and `pullModels(value: unknown)`:
  When a client tests an existing provider with empty apiKey (`!input.apiKey || input.apiKey === ''`), the server fetched `previous?.apiKey` from the store, but called `connection(value, previous?.apiKey)`.
  If the caller supplied `{ name: 'saved', baseUrl: 'https://attacker.com/v1', apiKey: '' }`, the stored secret was dispatched to the caller's arbitrary `baseUrl`!
- **Fix**:
  When reusing an existing provider's stored credential (i.e., `apiKey` is empty or omitted, and a saved provider exists in store):
  The target `baseUrl` and `protocol` MUST be strictly locked to `previous.baseUrl` and `previous.protocol`. Disallow callers from redirecting saved credentials to arbitrary hosts.
  (Optional F3 hardening: In the response, if upstream returns model IDs containing the key, redact it).

### 3. Verification & Tests
- Add unit tests in `apps/local-server/src/server.test.ts` or `providerRoutes.test.ts`:
  1. Test that `turn/end` with kind `'error'` accurately projects `lastRunStatus: 'failed'` in activity/live status.
  2. Test that an indexed session with recordCount > 0 but no terminal success does NOT project as `completed`.
  3. Test that calling `test` or `pullModels` with a saved provider name, empty `apiKey`, and a spoofed `baseUrl` is forced to query the saved provider's real `baseUrl` (or rejected), and does NOT send credentials to the spoofed host.
- Ensure:
  1. `git diff origin/main --stat -- packages/core` remains 0 (Thin Core Discipline: NO modifications to `packages/core`).
  2. `npx tsc -b` exits 0.
  3. `npm run typecheck:tests` exits 0.
  4. Local server tests pass (`npx vitest run apps/local-server/src/server.test.ts`).
  5. Counterexample probes in `evidence/sessions/2026-10-20-codex-adversarial-review-249-probes.mjs` confirm F1 and F2 are resolved.

## Deliverables
1. Edit product code in `apps/local-server`.
2. Add comprehensive automated tests in `apps/local-server/src/server.test.ts`.
3. Run verification gates and record output.
