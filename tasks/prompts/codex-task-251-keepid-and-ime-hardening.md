# Task 251: Compaction keepID Conservation & IME Enter Submission Hardening (Fixes F4 & F7)

## Role & Mission
You are a Senior Systems & Web Engineer executing Task 251 via Codex CLI (`gpt-6.1-sol`, reasoning: medium).
Your mission is to directly fix vulnerabilities F4 and F7 discovered in Task 249:

### 1. Fix F4: Wire `keepID` Conservation into Production `Compaction.ts`
**Files**: `packages/context/src/compaction/Compaction.ts`, `packages/context/src/compaction/assertCompactionConservation.ts`, and test files.
- **Problem**:
  In `Compaction.ts:133-145`:
  When building `compactedMessages` from `records.slice(cut)`, it stripped message metadata, lost any `keepID` attached to user/assistant/tool messages, and passed NO `requiredKeepIds` to `assertCompactionConservation`.
  As proven by probe F4 in Task 249, production compaction committed a summary that dropped `keep-0`!
- **Fix**:
  1. In `Compaction.ts`, collect all `keepID` / `keepId` / `keepIds` present in the original `records` being compacted.
  2. For records inside the compacted range (i.e., those summarized into the summary block), ensure the summary metadata includes `{ keepIds: [...] }` containing the summarized keepIDs, and ensure anchor content from those keepID messages is preserved in the summary text.
  3. For records preserved in `records.slice(cut)`, carry their metadata (including `keepID`, `keepId`, `keepIds`, and message `id`) into the resulting `compactedMessages`.
  4. Pass the collected `requiredKeepIds` to `assertCompactionConservation({ ..., requiredKeepIds })` so that if any anchor keepID is dropped or orphaned during compaction, it throws `CompactionConservationError('keep_id_lost')`.
  5. Add unit tests in `Compaction.test.ts` verifying that records with `keepID` (such as `keep-0`) are conserved across compaction and pass `assertCompactionConservation`.

### 2. Fix F7: Prevent Implicit Form Submission on IME Enter
**Files**: `apps/web/src/components/ConversationView.tsx` and `apps/web/src/components/ConversationView.interaction.test.tsx`
- **Problem**:
  In `ConversationView.tsx:313-319`:
  ```typescript
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (isComposingRef.current || e.nativeEvent.isComposing || (e as unknown as { keyCode?: number }).keyCode === 229) {
        e.stopPropagation();
      }
    }
  }, []);
  ```
  Only `stopPropagation()` was called, NOT `preventDefault()`. When Enter is pressed during IME candidate selection, browsers can still trigger implicit `<form onSubmit>`, causing unfinished phonetic text to be submitted prematurely.
- **Fix**:
  Call BOTH `e.preventDefault()` AND `e.stopPropagation()` when Enter is pressed while composing or keyCode === 229.
  Add/update test cases in `ConversationView.interaction.test.tsx` ensuring `e.preventDefault()` is invoked and the form does NOT submit.

### 3. Verification & Gates
1. `git diff origin/main --stat -- packages/core` must show 0 changed lines for Task 251 (`git diff HEAD --stat -- packages/core` strictly 0).
2. `npx tsc -b` exits 0.
3. `npm run typecheck:tests` exits 0.
4. `npx vitest run packages/context` passes all tests.
5. `npm run test:web` passes all 413+ tests.
6. Counterexample probes in `evidence/sessions/2026-10-20-codex-adversarial-review-249-probes.mjs` confirm F4 is resolved.

## Deliverables
- Edit product code in `packages/context` and `apps/web`.
- Add comprehensive automated unit tests.
- Record verification logs and update `tasks/251-compaction-keepid-and-ime-hardening.md`.
