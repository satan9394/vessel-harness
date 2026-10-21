# Task 254: Fix BV-01 (Session History Hydration on Reload), BV-02 (Goal Status Truth), and BV-03/04 (Activity Polish)

## Role & Objectives
You are a Senior Full-Stack Systems Engineer executing Task 254 via Codex CLI (`gpt-6.1-sol`, reasoning: medium).
Your mission is to directly fix the four product defects discovered and proven during the 25-minute built-in browser audit in Task 253:

### 1. Fix BV-01: Session Transcript Hydration on Reload & Historical Session Controller Restoration
**Files**: `apps/local-server/src/server.ts`, `apps/web/src/components/ConversationView.tsx`, and `apps/web/src/api.ts`
- **Cause 1 (Backend Controller Restoration)**:
  In `apps/local-server/src/server.ts`:
  When a client requests `GET /api/sessions/:id` (or `/events`), if `ctl = controllers.get(id)` is undefined, the server currently returns `404` even if `sessionRegistry.get(id)` exists on disk.
  Fix: If `controllers.get(id)` is undefined but `sessionRegistry.get(id)` exists, restore/open the session via `sessionFactory` (or `SessionController.open`) so historical sessions don't 404!
- **Cause 2 (Backend Transcript / Messages API)**:
  Expose an endpoint `GET /api/sessions/:id/messages` (or `GET /api/sessions/:id/transcript`) that replays `ctl.session.replay()` and returns structured chat items (e.g. `{ messages: [...] }` containing `user/message` content, `assistant/attempt` / text, and tool calls).
- **Cause 3 (Frontend Hydration)**:
  In `apps/web/src/components/ConversationView.tsx`:
  Currently it only loads from memory `snapshotsByClient`. When a user reloads the page (F5), memory is empty, rendering an empty conversation even though disk has records!
  Fix: In `ConversationView.tsx`, when mounted, if `saved?.items` is empty, fetch the persisted transcript from `api.sessionMessages(sessionId)` (or equivalent) and populate `items` (and usage/metrics) so that all previous user messages and assistant responses render correctly!

### 2. Fix BV-02: Map Pending Goals to Queued / Unknown, NOT Running
**File**: `apps/local-server/src/routes/activityRoutes.ts:192-195`
- **Cause**:
  ```typescript
  const status: ActivityStatus = task.status === 'paused' ? 'needs_attention' : task.status === 'met' ? 'completed' : task.status === 'not_met' || task.status === 'cancelled' ? 'failed' : 'running';
  ```
  When `task.status === 'pending'`, it fell through to `'running'`!
- **Fix**:
  Explicitly check `task.status === 'in-progress'` before mapping to `'running'`.
  If `task.status === 'pending'`, map it to `'unknown'` (or queued representation), NEVER `'running'`.

### 3. Fix BV-03 & BV-04: Activity Queue Polish
**File**: `apps/web/src/components/activity/ActivityQueue.tsx`
- **Fix BV-03**:
  For non-session cards (like `kind === 'goal'`), ensure the card title and details are clearly readable, and if no session navigation exists, provide an expandable details or clear badge instead of an unclickable dead experience.
- **Fix BV-04**:
  Change the refresh button label in `ActivityQueue.tsx:60` from `{t('modelRetry')}` (which translates to "重新加载模型") to a proper refresh label like `{t('activityRefresh') || '刷新活动'}`.

### 4. Verification & Gates
1. `git diff origin/main --stat -- packages/core` must show 0 changed lines (`git diff HEAD --stat -- packages/core` strictly 0).
2. `npx tsc -b` exits 0.
3. `npm run typecheck:tests` exits 0.
4. `apps/local-server` tests pass (including new tests for session rehydration and messages replay).
5. `npm run test:web` passes all tests (including conversation transcript hydration test).
6. Verify that reload reproduction session (`sess_1792583751073_cc114a5b`) now successfully hydrates its messages!

## Deliverables
- Edit product code in `apps/local-server` and `apps/web`.
- Add automated unit tests in `apps/local-server/src/server.test.ts` and web tests.
- Record verification logs and update `tasks/254-browser-audit-remediation.md`.
