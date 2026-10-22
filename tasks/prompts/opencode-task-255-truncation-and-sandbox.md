# Task 255: Fix Length Truncation HTTP 500 Web Crash & Windows Sandbox Token Integrity Level Access Denied

## Role & Objectives
You are a Senior Full-Stack Systems Engineer executing Task 255 via OpenCode CLI (`opencode`).
Your mission is to eliminate two real production defects identified from the latest session logs (`sess_1792586818011_52e1c32d`) when running in the Web workbench:

---

### 1. Fix Truncation (finishReason === 'length') causing HTTP 500 Web Crash
**Target Files**: `apps/local-server/src/server.ts`, `apps/local-server/src/server.test.ts`, `apps/web/src/components/ConversationView.tsx`, `apps/web/src/api.ts`

- **Root Cause**:
  When a model outputs extensive code (e.g. user asks to write a 2048 game), the provider hits `outputTokens: 4096` / `max_tokens` and responds with `finishReason: 'length'`.
  `AgentLoop.ts` accurately flags `truncated = true` and `terminalFinishReason === 'length'`.
  However, in `apps/local-server/src/server.ts`:
  ```typescript
  function turnStatusFor(kind: TurnResult['kind']): 200 | 500 {
    return kind === 'error' ? 500 : 200;
  }
  ```
  `POST /api/sessions/:id/turns` maps all `kind === 'error'` blindly to **HTTP 500**.
  This treats normal LLM token truncation as an unhandled internal server crash!
  In the browser (`apps/web`):
  1. `api.runTurn()` receives HTTP 500 and throws `ApiError(500)`.
  2. `ConversationView.tsx` catches the error, calls `setInput(prompt)` (re-populating the input box), and renders a red "500 Server Error" banner.
  3. The streamed message stops and appears frozen to the user, breaking the workflow.

- **Solution**:
  1. In `apps/local-server/src/server.ts`:
     Refine `turnStatusFor`:
     If `result.kind === 'error'` BUT `result.finishReason === 'length'` (the turn stopped because of model token budget, not an infrastructure exception or crash), the HTTP status code MUST be **200**.
     (The body still accurately contains `{ finalText, kind: 'error', finishReason: 'length', steps, turnId }` so machine consumers can see the error kind, but HTTP transports do not blow up with 500).
  2. In `apps/web/src/components/ConversationView.tsx`:
     Handle `result.finishReason === 'length'` gracefully:
     - Keep the generated `finalText` rendered in the conversation.
     - Provide a subtle, elegant indicator (e.g. "Response reached model length limit / 内容达到长度上限，可继续生成") instead of a hard crash banner.
     - Do not clear the assistant's generated output or re-stuff `prompt` back into `input` if `finishReason === 'length'`.
  3. In `apps/local-server/src/server.test.ts`:
     Add unit tests verifying that a turn with `finishReason === 'length'` returns HTTP 200 with the full body, rather than HTTP 500.

---

### 2. Fix Windows Sandbox `SetTokenIntegrityLevel` Access Denied
**Target Files**: `packages/tools/src/execution/sandbox/windowsRestrictedSource.ts`, `packages/tools/src/execution/sandbox/windowsRestricted.ts`, `packages/tools/src/execution/sandbox/windowsRestricted.test.ts`

- **Root Cause**:
  In `packages/tools/src/execution/sandbox/windowsRestrictedSource.ts:80`:
  ```csharp
  Check(OpenProcessToken(GetCurrentProcess(),0xB,out original),"OpenProcessToken");
  ```
  `0xB` is `TOKEN_ASSIGN_PRIMARY (0x1) | TOKEN_DUPLICATE (0x2) | TOKEN_QUERY (0x8)`.
  Later at line 87:
  ```csharp
  Check(SetTokenInformation(token,25,ref label,Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES))+GetLengthSid(low)),"SetTokenIntegrityLevel");
  ```
  According to Win32 security specs, modifying the Token Integrity Level (`TokenIntegrityLevel` = 25) via `SetTokenInformation` **strictly requires** `TOKEN_ADJUST_DEFAULT` (`0x0020`) access right on the token handle!
  Because `OpenProcessToken` did not include `0x0020`, the handle returned by `CreateRestrictedToken` lacks `TOKEN_ADJUST_DEFAULT`, causing `SetTokenInformation` to fail with Win32 error code 5 (Access Denied).
  This caused tool execution (like `ls -la`) in the Windows restricted sandbox to be denied with `restricted sandbox denied: SetTokenIntegrityLevel`.

- **Solution**:
  1. In `windowsRestrictedSource.ts`:
     Include `TOKEN_ADJUST_DEFAULT (0x0020)` in `OpenProcessToken`, e.g. `0x2B` (`0x1 | 0x2 | 0x8 | 0x20`).
  2. In `windowsRestrictedSource.ts`:
     Ensure `TokenIntegrityLevel` adjustment handles edge cases where the current environment already runs with lower integrity or cannot relabel without throwing an unrecoverable failure.
  3. In `windowsRestricted.test.ts`:
     Update/add unit tests asserting `OpenProcessToken` incorporates `TOKEN_ADJUST_DEFAULT` (0x20 / 0x2B) and that the script compiles and runs properly.

---

### 3. Verification & Guardrails
1. **Thin Core Discipline**:
   `git diff HEAD --stat -- packages/core` MUST BE 0 (do NOT touch `packages/core`).
2. **Build & Typecheck**:
   - `npx tsc -b` exits 0.
   - `npm run typecheck:tests` exits 0.
3. **Tests**:
   - `npx vitest run apps/local-server/src/server.test.ts` passes.
   - `npx vitest run packages/tools/src/execution/sandbox/` passes.
   - `npm run test:web` passes.
4. **Recycle Bin Discipline**:
   No permanent deletions (`rm`, `rmSync` on non-tmp, etc.).

---

## Deliverables
- Modify `apps/local-server/src/server.ts` & test in `server.test.ts`.
- Modify `apps/web/src/components/ConversationView.tsx` (and `api.ts` if needed).
- Modify `packages/tools/src/execution/sandbox/windowsRestrictedSource.ts` & test in `windowsRestricted.test.ts`.
- Record test logs and write a summary.
