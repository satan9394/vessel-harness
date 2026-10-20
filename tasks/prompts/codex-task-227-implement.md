# Task 227 Implementation Contract for Codex (gpt-6.1-sol)

## Role & Mission
You are Codex, executing in your isolated sandbox workspace.
Your mission: Implement the UI structural refinement for `apps/web` according to the design audit report (`evidence/sessions/2026-10-18-ui-structural-audit.md`) and Task Card 227 (`tasks/227-web-ui-structural-refinement-and-design-system.md`).

## Hard Constraints
1. **Core Thinness**: `packages/core` modifications MUST BE EXACTLY 0 lines.
2. **Blast Radius**: Only modify files within `apps/web/`.
3. **No Breaking Tests**: All existing web tests (40 files, ~340 tests) must pass. Run `npm run -w @vessel/web test` and `npm run -w @vessel/web build` to verify.
4. **Delete Discipline**: Do not permanently delete files. Recycle bin only if deletion is needed.

## Detailed Implementation Requirements

### 1. Fix Breakpoint Deadzone & Inspector Docking (`apps/web/src/components/layout/layout.css`)
- **Problem**: In 1024px–1180px, `.docked-inspector` is neither fixed nor docked column, falling underneath `.chat-surface` in the normal flow.
- **Fix**:
  - Align breakpoint: Unify breakpoint at 1180px (or 1200px) so when screen is `<= 1180px`, `.docked-inspector` behaves as an overlay/drawer with backdrop (`position: fixed; inset: 0 0 0 auto; z-index: 61; width: min(90vw, 520px);`), NOT normal document flow.
  - Ensure `.inspector-backdrop` has proper base styling and transition.
  - Keep `flex: 1` and clean scroll on `.inspector-content`.

### 2. Layout Grid & Collapsible Sidebar (`apps/web/src/styles.css`, `apps/web/src/App.tsx`, `apps/web/src/components/Sidebar.tsx`)
- **Problem**: `.app` has rigid `grid-template-columns: 58px 232px minmax(0, 1fr)`. On 1280px–1440px with inspector open, main content is severely squeezed.
- **Fix**:
  - Support a collapsed sidebar state or responsive compact mode:
    In `.app`: add support for `.sidebar-collapsed` class (e.g. `grid-template-columns: 58px 0px minmax(0, 1fr)` or hiding sidebar gracefully) or responsive collapse on `<= 1180px`.
  - Add a collapse toggle button in the topbar or sidebar header so users can easily toggle sidebar visibility with keyboard/click.
  - Ensure smooth CSS transitions (`transition: grid-template-columns 200ms var(--ease), width 200ms var(--ease)` or similar) without using `transition: all`.

### 3. Workbench Home Elevation (`apps/web/src/App.tsx`, `apps/web/src/styles.css`, `apps/web/src/i18n.ts`)
- **Problem**: When no session is selected (`nothingSelected`), `workbench-home` only renders a lonely centered `TaskComposer`, feeling like an empty wasteland.
- **Fix**:
  - Enrich `workbench-home` with contextual cards:
    1. Quick Start / Starter Prompts capsules (e.g., "Review Code", "Run Benchmarks", "Explore System") that click to prefill/start tasks.
    2. Recent Sessions shortcut grid / card list (showing the top 3-4 active non-archived sessions with titles, workspace name, and last updated time).
    3. Workspace indicator card (active project root, server health badge).
  - Add corresponding i18n keys to `apps/web/src/i18n.ts` for English and Chinese.

### 4. Visual Tokens & Border Prison Elimination (`apps/web/src/styles.css`)
- **Follow Skills**: `minimalist-ui`, `emil-design-eng`, `make-interfaces-feel-better`.
- **Fix**:
  - Eliminate nested double borders: within cards (`.card`, `.btn`, `.workbench-home`), use subtle background steps (`var(--panel-2)`) instead of cascading `1px solid var(--ring)` everywhere.
  - Interactive micro-feedback: Add `:active { transform: scale(0.98); }` to `.btn` and interactive pill buttons. Add clean `:focus-visible` ring.
  - Frequency principle: Keep rail and tab transition durations snappy (100ms–150ms).

## Verification Steps to Run
After editing, you must run:
1. `npm run -w @vessel/web test`
2. `npm run -w @vessel/web build`
Report the exact test output and build outcome.
