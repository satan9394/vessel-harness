# 任务卡 277: 修复浏览器验收的两个 P2 缺陷

**状态**: 待验收（实现与定向门禁通过；浏览器几何与方向口径待复验）
**创建时间**: 2026-10-23
**执行者**: Codex (`gpt-6.1-sol`, medium)
**协调者**: OpenCode

---

## 1. 来源

`evidence/sessions/2026-10-23-ui-final-report.md`（卡 275 的浏览器验收）给出两条 P2，均未修：

**B-F1 删除确认框忽略 Escape 且焦点丢失**
- 复现：打开可丢弃会话 → Tab 到删除图标 → Return → 按 Escape。
- 期望：取消确认并把焦点还给触发按钮。
- 实际：确认框仍然打开；`document.activeElement` 是 `BODY`。
- DOM 观测：`{"confirmationVisible":true,"focus":"BODY"}`；截图 `B5-delete-keyboard-escape.png`。

**C-F1 360px 英文视图 footer 压住 Goals**
- 复现：有内容的会话、Inspector 关闭、英文、视口 360×900。
- 期望：KEY HINTS 占据自己的布局空间，位于 Goals 之上。
- 实际：hints 父容器 y=810.02–842.92，Goals 容器从 y=774.03 开始（Goals 标签 790.03–808.62），重叠。
- 截图 `C-360-light-en.png`。

## 2. Goal

两条都修掉，且不回归既有交互。

## 3. Acceptance Criteria

1. Escape 关闭删除确认并把焦点还原到打开它的按钮；再按 Tab 仍能正常移动（不被困）。
2. 360×900 英文下，KEY HINTS 与 Goals **不重叠**。用 `getBoundingClientRect()` 断言二者矩形不相交：
   `hints.bottom <= goals.top || hints.top >= goals.bottom`（允许 1px 误差）。
   > 更正（2026-10-23）：本卡初版把不变量写成 `hints.top >= goals.bottom`，那只对应「hints 在 Goals 下方」一种顺序，
   > 与「hints 应占据 Goals 上方空间」的原始描述矛盾。执行者指出了这处冲突且没有硬凑，现改为方向无关的「不相交」判据。
3. 新增/修改组件测试覆盖两条（jsdom 下能测的部分：Escape 处理、焦点还原；布局用可测的类名/结构或
   CSS 变量断言，若 jsdom 无法测几何则在测试里注明并给出浏览器复验步骤）。
4. 门禁：`npx tsc -b`、`npm run typecheck:tests`、`npm run -w @vessel/web typecheck`、`npm run test:web`、
   `npm run -w @vessel/web build`。
5. 不引入新的全局键盘监听；若必须，卸载时清理干净。

## 4. Not Doing

- 不改产品范围、不加新面板、不动 `packages/*`。
- 不为了让测试过而放宽断言；jsdom 测不了几何就如实说明。

## 5. Blast Radius

`apps/web/src/components/Sidebar.tsx`（或删除确认所在组件）、`apps/web/src/components/TaskComposer.tsx`
与相关 CSS、i18n（若文案需要）。

## 6. Result

Implemented locally; no commit/push, `packages/*` edits, or `test:all` run.

- B-F1: confirmation receives focus on Cancel; its local bubbling handler consumes only Escape. Cancel/Escape remounts and focuses the exact opening delete button. No global listener or Tab interception added.
- C-F1: `.composer-shell` no longer shrinks below its content height; `.meter-keys` wraps within its available width. No content hidden and no font sizes reduced. The populated conversation uses `ComposerMeters`, not `TaskComposer`, so `TaskComposer.tsx` required no edit.
- Added jsdom as a web dev dependency (previously no DOM environment installed), with npm lockfile. `npm ci --cache .tmp/npm-cache --ignore-scripts --no-audit --no-fund` exit 0 (118 packages); lifecycle scripts intentionally skipped. The first install attempt hit a read-only external npm cache; workspace-local cache succeeded.

### Tests and evidence boundary

New tests:

1. `Escape closes deletion confirmation and restores focus to the opening button`
2. `leaves Tab unhandled in confirmation and after restoring focus`
3. `keeps mouse cancel and confirm paths and does not intercept Escape elsewhere`
4. `keeps English key hints visible with wrapping classes and non-shrinking composer CSS`

Tests 1–3 run real React DOM in jsdom: they verify activeElement, cancellation, exact trigger selection across two sessions, confirmation callbacks, and Escape propagation outside the confirmation. Test 2 proves Tab is not prevented; jsdom does not perform native Tab traversal. Enter activation is represented by its resulting native click, not claimed as a jsdom keyboard-default simulation. Test 4 checks rendered English content/classes and the exact CSS declarations; it does **not** measure 360px geometry.

### Requested gates

Logs: `evidence/sessions/2026-10-23-card277/`.

| Gate | Exit | Count |
|---|---|---|
| `npx tsc -b` | 0 | no diagnostics |
| `npm run typecheck:tests` | 0 | no diagnostics |
| `npm run -w @vessel/web typecheck` | 0 | no diagnostics |
| `npm run test:web` | 0 | 57 files, 488 passed |
| `npm run -w @vessel/web build -- --emptyOutDir false` | 0 | 98 modules transformed; >500 kB chunk warning |

### Browser recheck (not executed in this delivery)

1. Open the rebuilt local UI with a populated disposable Mock session, Inspector closed, English, light theme; set viewport to exactly 360×900. Refresh after the build, wait for model/capsule content to settle, and scroll the conversation wrapper to the footer and Goals.
2. Measure the **hints parent**, not just its text, and the entire Goals card:

   ```js
   const hints = document.querySelector('.meter-keys').parentElement.getBoundingClientRect();
   const goals = document.querySelector('.module-card-goal').getBoundingClientRect();
   ({ hintsTop: hints.top, hintsBottom: hints.bottom,
      goalsTop: goals.top, goalsBottom: goals.bottom,
      requestedGate: hints.top >= goals.bottom,
      aboveGoalsGate: hints.bottom <= goals.top });
   ```

   **Acceptance-direction conflict:** source prose says hints are above Goals, while criterion 2 and the execution prompt require `hints.top >= goals.bottom`, which places hints below Goals. An asynchronous clarification was requested. This patch preserves the existing order (hints above Goals); it does not claim the requested inequality passes. Resolve that direction before browser acceptance; do not replace one inequality with the other and report it as the original gate.
3. Keyboard: Tab to the second session's Delete button → Enter → check Cancel focused → Escape → check confirmation absent and the same session's Delete focused → Tab and Shift+Tab traverse normally. Repeat Escape from Confirm. Reopen and mouse-cancel, then reopen and mouse-confirm a disposable session; confirm exactly one delete/recycle action.
4. Open Inspector, command palette, and model switcher independently and check their existing Escape behavior. The component test verifies local propagation only; it does not certify these browser overlays.
