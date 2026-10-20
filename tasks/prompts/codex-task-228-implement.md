# Task 228 Implementation Contract for Codex (gpt-6.1-sol)

## Role & Mission
You are Codex, executing in your isolated sandbox workspace.
Your mission: Implement the Claude Design System (CDS) optimizations for `apps/web` based on the research report (`evidence/sessions/2026-10-19-open-claude-ui-study.md`) and Task Card 228 (`tasks/228-vessel-web-ui-cds-elevation.md`).

## Hard Constraints
1. **Core Thinness**: `packages/core` modifications MUST BE EXACTLY 0 lines.
2. **Blast Radius**: Only modify files within `apps/web/`.
3. **No Breaking Tests**: All existing web tests (40 files, 345 tests) must pass, plus your new tests. Run `npm run -w @vessel/web test` and `npm run -w @vessel/web build` to verify.
4. **Delete Discipline**: Do not permanently delete files. Recycle bin only if deletion is needed.

## Detailed Implementation Requirements

### 1. P0: IME Chinese/Japanese Input Guard in `TaskComposer.tsx` + Unit Test
- **Problem**: When typing Chinese/Japanese pinyin, pressing Enter to pick a candidate word triggers form submission, submitting incomplete pinyin text.
- **Fix in `apps/web/src/components/TaskComposer.tsx`**:
  - Add `const isComposingRef = useRef(false);`
  - On the `<textarea>`:
    - Add `onCompositionStart={() => { isComposingRef.current = true; }}`
    - Add `onCompositionEnd={() => { isComposingRef.current = false; }}`
    - Add `onKeyDown={(e) => { ... }}`:
      - If `e.key === 'Enter' && !e.shiftKey`:
        - If `isComposingRef.current || e.nativeEvent.isComposing || e.keyCode === 229`:
          `return;` // Let IME handle candidate selection! Do NOT submit!
        - Otherwise, `e.preventDefault(); void submit(e);`
      - If `e.key === 'Enter' && e.shiftKey`: allow normal newline.
- **Add unit test file `apps/web/src/components/TaskComposer.test.tsx`**:
  - Test 1: Typing text and pressing Enter while `isComposing` is true does NOT call `onStarted`.
  - Test 2: Pressing Enter after `compositionEnd` successfully triggers `onStarted`.
  - Test 3: Pressing Shift+Enter inserts newline and does NOT submit.

### 2. P0/P1: Retina Hairline Ring (0.5px) & Precision Radius Matrix (`apps/web/src/styles.css`, `layout.css`)
- **Fix in `apps/web/src/styles.css`**:
  - In `.tokens`:
    ```css
    --r-0: 4px;
    --r-sm: 6px;
    --r-md: 8px;
    --r-panel: 10px;
    --r-composer: 20px;
    --ring-hairline: 1px;
    --focus-ring: 0 0 0 1px var(--panel), 0 0 0 2.5px var(--accent), 0 0 8px 1px var(--accent-soft);
    ```
  - In Retina media query:
    ```css
    @media (min-resolution: 2dppx), (-webkit-min-device-pixel-ratio: 2) {
      .tokens {
        --ring-hairline: 0.5px;
      }
    }
    ```
  - Replace thick hard borders where appropriate with hairline/inset shadows or `--ring-hairline solid var(--ring)`.
  - Update interactive elements focus outline with the refined 3-layer focus ring.

### 3. P1: Native Scroll Fade Mask (`apps/web/src/styles.css`, `apps/web/src/components/layout/layout.css`, `apps/web/src/components/ConversationView.tsx`)
- **Fix**:
  - In `styles.css`:
    ```css
    .scroll-fade-mask {
      -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 24px, black calc(100% - 24px), transparent 100%);
      mask-image: linear-gradient(to bottom, transparent 0%, black 24px, black calc(100% - 24px), transparent 100%);
    }
    ```
  - Apply `.scroll-fade-mask` to the scrolling areas:
    - Message scroll container in `ConversationView.tsx` (`.message-list-scroll`)
    - Inspector scroll container in `layout.css` (`.inspector-content`)

### 4. Precision Micro-interactions
- Ensure buttons (`.btn`), pills (`.starter-pill`, `.model-pill`), and rail items maintain crisp 70ms-120ms transitions with `:active { transform: scale(0.98); }`.

## Verification Steps to Run
After editing, you must run:
1. `npm run -w @vessel/web test`
2. `npm run -w @vessel/web build`
Report the exact test output and build outcome.
