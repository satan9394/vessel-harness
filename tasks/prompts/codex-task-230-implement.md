# Task 230 Implementation Contract for Codex (gpt-6.1-sol)

## Role & Mission
You are Codex (`gpt-6.1-sol`, reasoning_effort: medium), executing in your isolated sandbox workspace.
Your mission: Implement the Claude Design System (CDS) elevations for the Sidebar and TaskComposer based on OpenCode's audit report (`evidence/sessions/2026-10-19-opencode-audit-230.md`) and Task Card 230 (`tasks/230-vessel-web-ui-sidebar-and-task-composer.md`).

## Hard Constraints
1. **Core Thinness**: `packages/core` modifications MUST BE EXACTLY 0 lines.
2. **Blast Radius**: Only modify files within `apps/web/`.
3. **No Breaking Tests**: All existing web tests (42 files, 365 tests) must pass.
4. **Delete Discipline**: Do not permanently delete files. Recycle bin only if deletion is needed.
5. **IME & Logic Integrity**: Retain all existing IME guard logic (`isComposingRef`, `nativeEvent.isComposing`, `keyCode === 229`) and form submission flows in `TaskComposer.tsx`.

---

## Detailed Implementation Requirements

### 1. `apps/web/src/i18n.ts`
- Add `topicYesterday: MessageTemplate;` to `WorkspaceMessages` interface.
- Add `topicYesterday: '昨天',` to zh dictionary (`zhWorkspace`).
- Add `topicYesterday: 'Yesterday',` to en dictionary (`enWorkspace`).

### 2. `apps/web/src/components/Sidebar.tsx`
- **TopicPeriodKey**:
  ```ts
  type TopicPeriodKey = 'topicToday' | 'topicYesterday' | 'topicLastSevenDays' | 'topicEarlier';
  ```
- **groupSessionsByDateAndTopic**:
  - Add yesterday boundary:
    ```ts
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();
    const day = 24 * 60 * 60 * 1000;
    const yesterdayStart = todayStart - day;
    const lastWeekStart = todayStart - 7 * day;
    ```
  - Map period:
    ```ts
    const periodKey: TopicPeriodKey =
      !Number.isFinite(timestamp) || timestamp < lastWeekStart
        ? 'topicEarlier'
        : timestamp < yesterdayStart
          ? 'topicLastSevenDays'
          : timestamp < todayStart
            ? 'topicYesterday'
            : 'topicToday';
    ```
  - Keep period order: `topicToday`, `topicYesterday`, `topicLastSevenDays`, `topicEarlier`.
- **Preserve date grouping in rendering**:
  - Instead of flatMapping out the periods, group by workspace root and keep each period group visible:
    ```tsx
    const workspaceGroups = useMemo(() => {
      const roots = [...new Set([...projects.map(p => p.root), ...sessions.map(s => s.workspaceRoot)])];
      return roots.map(root => ({
        root,
        periods: groupSessionsByDateAndTopic(
          filterSessionsByTopic(sessions.filter(s => s.workspaceRoot === root), query, showArchived)
        ),
      })).filter(g => g.periods.length > 0 || projects.some(p => p.root === g.root));
    }, [projects, sessions, query, showArchived]);
    ```
- **Active Rail & Inline Actions**:
  - Session items get an active rail on `.side-item.topic-session.side-item-active` via CSS.
  - Replace `<details className="topic-actions"><summary>···</summary>...</details>` with inline action buttons in `.topic-heading` (`.topic-actions-inline`) with rename (pencil) and archive/restore icons, which appear smoothly on hover/focus-within (`opacity: 0` -> `opacity: 1`, `--dur-snap: 120ms`).
  - Add search icon inside search container `.side-search` for `.topic-search`.

### 3. `apps/web/src/components/TaskComposer.tsx`
- Redesign layout structure while preserving all behavior, refs, and submission logic:
  - Form container `.task-composer` has concentric padding and background `var(--panel-2)`.
  - Inner surface `.composer-surface` with `--r-composer: 20px`, hairline border, and 3-state shadows.
  - Capsule Selects: Wrap `<select>` in a `.capsule-select` container with a clean custom chevron SVG, `--r-pill` radius, and hover/focus styles.
  - Model and Permission selects styled as pills inside `.composer-pills`.
  - Send button styled with clean rounded pill/capsule shape and active press feedback `:active { transform: scale(0.98); }`.
  - Keep `<textarea ref={taskInput} ...>` and its `onCompositionStart`, `onCompositionEnd`, `onKeyDown` unchanged.

### 4. `apps/web/src/styles.css`
- **Cleanup legacy variables**:
  - Replace occurrences of `--panel2` with `--panel-2`.
  - Remove `--row-line` from `.topic-group` (eliminate Border Prison).
- **Sidebar CSS**:
  - `.sidebar`: padding `14px 12px 12px`, clean background and hairline border.
  - `.side-search`: container with relative positioning and SVG search icon.
  - `.topic-search`: pill radius `--r-pill`, padding `7px 10px 7px 28px`, focus-ring.
  - `.topic-group`: eliminate `border-bottom: 1px solid var(--row-line)`, use spacing `margin: 2px 0 4px`.
  - `.topic-heading`: flex row with hover background `var(--panel-2)`, border-radius `var(--r-sm)`.
  - `.topic-actions-inline`: inline-flex with `opacity: 0`, transitions to `opacity: 1` on hover/focus-within.
  - `.side-item.topic-session`: active rail using `::before` (2px width, vertical center, height stretches from 0 to 14px with `--dur-base: 200ms` and `--ease-swift`).
  - `.topic-archived-toggle`: styled as a compact pill.
- **TaskComposer CSS**:
  - `.task-composer`: clean container layout.
  - `.composer-surface`:
    ```css
    border-radius: var(--r-composer);
    border: var(--ring-hairline) solid var(--ring);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
    transition: box-shadow var(--dur-base) var(--ease-swift), border-color var(--dur-base) var(--ease-swift);
    ```
    - `:hover`: `border-color: var(--ring-2); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.07);`
    - `:focus-within`: `border-color: var(--ring-2); box-shadow: 0 6px 28px rgba(0, 0, 0, 0.1), var(--focus-ring);`
  - `.capsule-select`: compact pill styling, `--r-pill`, `var(--panel-2)` bg, custom chevron.
  - `.composer-send` / submit button: cohesive pill styling with active micro-spring `transform: scale(0.98)`.

### 5. Unit Tests
- Add `apps/web/src/components/Sidebar.test.tsx` verifying:
  - `groupSessionsByDateAndTopic` splits sessions into `topicToday`, `topicYesterday`, `topicLastSevenDays`, `topicEarlier`.
  - `filterSessionsByTopic` handles queries and archived flags.
- Run `npm run -w @vessel/web test` and ensure all tests pass.

---

## Verification Steps
1. Run `npx tsc -b` (must be 0 errors).
2. Run `npm run typecheck:tests` (must be 0 errors).
3. Run `npm run -w @vessel/web test` (all web tests must pass).
4. Run `npm run -w @vessel/web build` (build must succeed with 0 warnings).
