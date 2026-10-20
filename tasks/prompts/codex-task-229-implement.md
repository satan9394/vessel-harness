# Task 229 Implementation Contract for Codex (gpt-6.1-sol)

## Role & Mission
You are Codex, executing in your isolated sandbox workspace.
Your mission: Implement the Claude Design System (CDS) elevations for Message Stream & Tool Cards based on OpenCode's audit report (`evidence/sessions/2026-10-19-opencode-audit-229.md`) and Task Card 229 (`tasks/229-vessel-web-ui-message-stream-and-tool-cards.md`).

## Hard Constraints
1. **Core Thinness**: `packages/core` modifications MUST BE EXACTLY 0 lines.
2. **Blast Radius**: Only modify files within `apps/web/`.
3. **No Breaking Tests**: All existing web tests (41 files, 351 tests) must pass. Add unit tests for `ToolActivityRow.tsx` (`apps/web/src/components/ToolActivityRow.test.tsx`). Run `npm run -w @vessel/web test` and `npm run -w @vessel/web build` to verify.
4. **Delete Discipline**: Do not permanently delete files. Recycle bin only if deletion is needed.

## Detailed Implementation Requirements

### 1. Motion Tokens & Typography in `apps/web/src/styles.css`
In `.tokens` layer:
- Add CDS motion duration tokens:
  ```css
  --dur-fast: 60ms;
  --dur-snap: 120ms;
  --dur-base: 200ms;
  --dur-sheet: 300ms;
  --dur-slow: 450ms;
  --ease-swift: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-enter: cubic-bezier(0.22, 1, 0.36, 1);
  ```
- Add `tabular-nums` rule for all counters and timestamps:
  ```css
  .counter, .token-count, .timer, time, .tool-dur, .reasoning-rate {
    font-variant-numeric: tabular-nums;
  }
  ```
- In message styles:
  ```css
  .msg-assistant .msg-body {
    text-wrap: pretty;
  }
  .msg-body code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.9em;
    padding: 2px 5px;
    border-radius: var(--r-0);
    background: var(--panel-2);
    border: var(--ring-hairline) solid var(--ring);
  }
  ```

### 2. CDS Tool Use Card: `apps/web/src/components/ToolActivityRow.tsx` & CSS
- Refactor `ToolActivityRow.tsx`:
  - Map status to tones:
    - `'started'`: `'running'`
    - `'done'`: `'ok'`
    - `'denied'` / `'error'`: `'danger'`
  - Structure:
    ```tsx
    <div
      className={`tool-row tool-row--${tone}`}
      data-status={delta.status}
      data-tone={tone}
      role="group"
      aria-label={`${name} · ${status}`}
    >
      <span className="tool-rail" aria-hidden="true">
        <span className="tool-dot" />
      </span>
      <div className="tool-main">
        <div className="tool-head">
          <span className="tool-name">{name}</span>
          <span className="tool-status">{status}</span>
          {typeof delta.durationMs === 'number' && (
            <span className="tool-dur">{delta.durationMs >= 1000 ? t('timeSeconds', { value: (delta.durationMs / 1000).toFixed(1) }) : t('timeMilliseconds', { value: String(delta.durationMs) })}</span>
          )}
        </div>
        {delta.argsSummary && (
          <div className="tool-args" title={delta.argsSummary}>{delta.argsSummary}</div>
        )}
      </div>
      {delta.sandbox && (
        <div className="tool-badge"><SandboxAuditBadge audit={delta.sandbox} /></div>
      )}
    </div>
    ```
- Add CSS in `apps/web/src/styles.css`:
  - `.tool-row` with `background: var(--panel-2)`, `border: var(--ring-hairline) solid var(--ring)`, `border-radius: var(--r-sm)` (6px), padding `8px 12px`, subtle hover effect `border-color: var(--ring-2)`.
  - `.tool-rail` and `.tool-dot` (7px radius 50%).
  - `.tool-row--running .tool-dot` with subtle pulse animation:
    ```css
    @keyframes tool-pulse {
      0%, 100% { transform: scale(0.86); opacity: 0.8; }
      50% { transform: scale(1.1); opacity: 1; box-shadow: 0 0 6px var(--warn); }
    }
    ```
  - Color tones:
    - `.tool-row--running { --tool-tone: var(--warn); }`
    - `.tool-row--ok { --tool-tone: var(--ok); }`
    - `.tool-row--danger { --tool-tone: var(--danger); }`
  - `.tool-head`, `.tool-name`, `.tool-status` (pill badge with soft bg), `.tool-dur`, `.tool-args` (monospace, 2 lines max with ellipsis).
  - Handle `prefers-reduced-motion: reduce`.

### 3. CDS Thinking Accordion in `apps/web/src/styles.css`
- Update `.thinking-block`:
  - Border: `var(--ring-hairline) solid var(--ring)`
  - Border-left: `3px solid var(--think)`
  - Background: `var(--panel-2)`
  - Radius: `var(--r-sm)` (6px)
  - `interpolate-size: allow-keywords;`
  - Summary hover: `color: var(--think);`
  - Active pulse dot: uses `var(--think)`.

### 4. Unit Tests in `apps/web/src/components/ToolActivityRow.test.tsx`
- Create `apps/web/src/components/ToolActivityRow.test.tsx` with comprehensive tests:
  - Renders tool name, status, duration, argsSummary.
  - Correctly maps tones (`tool-row--running`, `tool-row--ok`, `tool-row--danger`).
  - Formats duration in ms (< 1000) and s (>= 1000).
  - Renders SandboxAuditBadge when `delta.sandbox` is present.
  - Has accessible role="group" and aria-label.

## Verification Steps to Run
After editing, you must run:
1. `npm run -w @vessel/web test`
2. `npm run -w @vessel/web build`
Report the exact test output and build outcome.
