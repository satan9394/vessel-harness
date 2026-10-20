# Task 249: Adversarial Audit & Control Verification for Tasks 236–248

## Role & Mission
You are an independent, highly critical Senior Security & Systems Architect auditor running in an isolated session via Codex CLI (`gpt-6.1-sol`, reasoning: medium).
Your sole purpose is to ruthlessly verify that recent commits and working-tree changes across Tasks 236 through 248 are fully controllable, strictly compliant with project architecture and security boundaries, and free of regressions, leaks, or false receipts.

## Working Tree & Scope
- Workspace root: `E:/Code_file/Projects/Vessel_Harness`
- Reference commits: from pre-Task 236 baseline to HEAD and working tree.
- Core constraint: You must NOT introduce regressions. Do NOT modify `packages/core` (Thin Core Discipline: strictly zero lines changed).
- Review Output Target: `evidence/sessions/2026-10-20-codex-adversarial-review-249.md`

## Audit Dimensions (All 5 Must Be Verified With Hard Evidence)

### 1. Thin Core Discipline (`packages/core`)
- Verify that `packages/core` has ZERO modified lines across all recent changes and working-tree diff.
- Run `git diff origin/main --stat -- packages/core` and confirm `0 files changed`.
- Check if any subagent, memory, or policy leaks back into the thin core loop.

### 2. State Machine & Lifecycle Persistence (Tasks 236 & 244)
- Audit `packages/application/src/session/SessionController.ts` and `SessionRegistry.ts`.
- Verify the real session state machine transitions (`idle` -> `planning` -> `executing` -> `awaiting_input` -> `completed` / `failed` / `interrupted`).
- Audit `EffectJournal` crash-recovery & fault injection (`packages/application/src/journal/`).
- Prove that an interrupted or crashed session recovers cleanly without hanging unfulfilled promises or leaving dangling locks.

### 3. Physical Deletion & Recycle Bin Seam (Task 237)
- Review the deletion handlers in `apps/local-server/src/server.ts` and session/project registries.
- Verify that EVERY physical file/directory deletion of user sessions, projects, or config files strictly routes through the Windows Shell Recycle Bin (`[Microsoft.VisualBasic.FileIO.FileSystem]::Delete*`).
- Verify that tests respect the sole documented exception: only temporary test directories created inside `os.tmpdir()` during the test process itself may be cleaned via `fs.rmSync`.
- Verify that `recycled: true` / `recycleBin: true` returned by APIs is backed by real execution rather than a mocked-up false receipt.

### 4. Stored Credential Direct Retest & Zero-Leakage (Task 241)
- Audit `apps/web/src/components/providers/ProviderHub.tsx` and `apps/local-server/src/server.ts`.
- Verify that when a user triggers a connection test on an existing provider with saved credentials, the frontend transmits `{ name: providerName, apiKey: '' }` (or omits it), and the backend securely resolves the secret via `secretRef` against `CredentialStore` (DPAPI / encrypted).
- Verify that the masked key or plaintext secret is NEVER echoed back in responses, logs, or telemetry payloads.

### 5. Streaming UI Integrity & Compaction Conservation (Tasks 246 & 247)
- Audit SSE event stream consumption in `apps/web/src/hooks/useSessionStream.ts` or related controllers.
- Check user scroll locking (scroll-to-bottom guard) and IME composition state protection (no premature submission or stream interruption during Chinese/Japanese IME input).
- Audit OpenCode 2.1 Compaction contract transformation (`keepID` metadata conservation, ensuring compaction summaries retain essential anchors and never drop critical system prompts).

## Gate & Verification Execution
You MUST run the following gates via powershell / cmd and record their exact exit codes and output summaries in your report:
1. `git diff origin/main --stat -- packages/core`
2. `npx tsc -b`
3. `npm run typecheck:tests`
4. `npm run test:all` (Web 51 files + Root 290 files)
5. `npm run -w @vessel/web build`

## Deliverable
Write your complete, structured adversarial audit findings into:
`evidence/sessions/2026-10-20-codex-adversarial-review-249.md`
Including:
- Audit Verdict: PASS / CONDITIONAL PASS / FAIL
- Detailed analysis for each of the 5 dimensions with file paths and line numbers
- Verification command exit codes and test pass counts
- Potential edge cases or residual recommendations
