# Task 252: EffectJournal Torn-Tail Fault Recovery & Session Lease Rollback Hardening (Fixes F5)

## Role & Objectives
You are a Senior Systems Architect & Reliability Engineer executing Task 252 via Codex CLI (`gpt-6.1-sol`, reasoning: medium).
Your mission is to directly fix vulnerability F5 discovered in Task 249:

### 1. Fix `EffectJournal` Torn-Tail Fault Recovery
**Files**: `packages/runtime/src/executor/EffectJournal.ts` and `packages/runtime/src/executor/EffectJournal.test.ts`
- **Problem**:
  In `EffectJournal.ts:14-16`:
  ```typescript
  this.entries = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Entry) : [];
  ```
  If a process crashes or loses power during a write, the file may end with a partial / torn JSON line (e.g. `{"kind":"intent","key":"c`).
  The constructor throws an uncaught `SyntaxError`, completely breaking session restart/recovery.
- **Fix**:
  1. Parse the JSONL lines resiliently. If the trailing line is malformed/incomplete JSON, do not throw `SyntaxError`.
  2. Safely quarantine or discard the torn tail, preserving all previously valid, complete fsynced lines.
  3. Optionally, rewrite/truncate the file to remove the trailing corrupted bytes so subsequent appends remain valid JSONL.
  4. Add unit test in `EffectJournal.test.ts` verifying that when a file has a valid entry followed by a torn tail (`{"kind":"intent","key":"call-partial`), constructing `new EffectJournal(file)` succeeds, parses the valid entry, and permits subsequent operations without throwing `SyntaxError`.

### 2. Fix Session Lease Rollback on Composition Failure
**Files**: `packages/application/src/compose.ts` and relevant composition tests
- **Problem**:
  In `packages/application/src/compose.ts:280-363`:
  `const session = await Session.open({ workspaceRoot, sessionId: opts.sessionId });`
  acquires the process-exclusive `.lease` lock on the session.
  If any error occurs during the remainder of the composition pipeline (e.g., in `EffectJournal` construction, policy setup, mod loading, etc.), the error bubbles up without closing the session.
  The live PID lease lock is left dangling in the directory until process exit, and any attempt to reopen that session within the same process fails with a lease acquisition error!
- **Fix**:
  Wrap the post-`Session.open()` initialization in a `try ... catch` block:
  ```typescript
  const session = await Session.open({ workspaceRoot, sessionId: opts.sessionId });
  try {
    // ... all remaining assembly (bus, policyEngine, tools, effectJournal, rpcExecutor, mods, etc.) ...
    return harness;
  } catch (error) {
    await session.close().catch(() => {});
    throw error;
  }
  ```
  This guarantees that if assembly fails at any point after `Session.open()`, the session is cleanly closed and its `.lease` lock released immediately.
  Add a test verifying that when composition fails (e.g., due to an invalid option or synthetic assembly failure), the session lease is cleanly released, and the same session can be reopened immediately.

### 3. Verification & Gates
1. `git diff origin/main --stat -- packages/core` must show 0 changed lines for Task 252 (`git diff HEAD --stat -- packages/core` strictly 0).
2. `npx tsc -b` exits 0.
3. `npm run typecheck:tests` exits 0.
4. `npx vitest run packages/runtime` passes all tests.
5. `npx vitest run packages/application` passes all tests.
6. `npm run test:web` passes all 418 tests.
7. Counterexample probes in `evidence/sessions/2026-10-20-codex-adversarial-review-249-probes.mjs` confirm F5 is resolved.

## Deliverables
- Edit product code in `packages/runtime` and `packages/application`.
- Add automated unit tests.
- Record verification logs and update `tasks/252-effect-journal-torn-tail-and-lease-rollback.md`.
