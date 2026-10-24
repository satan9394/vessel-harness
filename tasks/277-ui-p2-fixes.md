# 任务卡 277: 修复浏览器验收的两个 P2 缺陷

**状态**: C-F1 已重做并在真实 Chrome 中复测通过（待用户在自己的英文/浅色/两会话条件下确认）；B-F1 已由用户复验通过
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

### 2026-10-24 浏览器复验结果 → C-F1 判为不通过，已重做

独立复验（Chrome，360×900，英文、浅色、Inspector 关闭，两个可删除分组）给出：

| 项 | 判定 | 实测 |
|---|---|---|
| C-F1 KEY HINTS 与 Goals 不重叠 | **不通过** | `overlap=true`，重叠 36.34px；hints 635.1–700.1，Goals 663.8–900.2，`docScrollW=360` |
| B-F1 删除确认键盘 | 通过 | Enter 后 Cancel 获焦；两条 Escape 路径都关闭确认并把焦点还给同一个删除按钮（index=1，不是第一个）；Tab/Shift+Tab 正常；鼠标 Cancel/Confirm 正确；Inspector / 命令面板 / 模型选择器的既有 Escape 未被影响 |

报告与截图：`evidence/sessions/2026-10-23-card277-recheck.md`、`277-F1-360-en.png`、`277-B1-focus.png`。

**C-F1 的真实根因不是 hints 换行**（上一版只改了 `.composer-shell` 的伸缩与 `.meter-keys` 的换行，
那两处是必要的但不充分）。用自建 CDP 探针（无 Playwright）在真实 Chrome 里复现后定位到布局链条：

```
.conversation-wrap (flex column, overflow auto)
└── .dual-surface   (grid, flex: 1 0 720px, min-height: 720px @<=800px)
    └── .chat-surface (flex column)
        ├── .inspector-toolbar (43px)
        └── .conversation (flex 1 1 0%, 原 min-height: 0)
```

`min-height: 720px` 把 `.dual-surface` 钉死在 720，而 `.conversation` 的 `min-height: 0` 又允许它缩到内容以下；
两者叠加后，composer 一旦变高（多行草稿）就把 footer 顶出 `.conversation` 的盒子，
溢出部分画在 `.module-sections` 上——即用户看到的「hints 压住 Goals」。实测 8 行草稿复现出 28.45px 溢出
（与复验的 36.34px 同源）。

修法（三处，缺一不可）：

1. `.conversation` 的 `min-height: 0` → `min-content`：不再允许缩到「工具栏 + 计量 + composer」以下；
2. `.message-list-scroll` 加 `contain: size`：把对话记录从父级的内在高度里摘出去，否则 `min-content`
   会把整段记录也算进去（实测会变成 924px 的虚假高度）；滚动容器本来就该由 flex 决定高度；
3. `≤800px` 的 `.dual-surface`：`min-height: 720px` → `auto`，保留 `flex-basis: 720px` 作为下限，
   由 flex item 的内容下限决定是否长高（`max(720px, min-content)` 在 Chromium 里非法、会被整条丢弃，
   `min-height: auto` 才是正确写法）。

真实 Chrome 复测（同一探针，两种视口 × 1 行 / 8 行草稿）：

| 场景 | `.dual-surface` 高 | footer 溢出 | `.module-sections` 间距 | 重叠 |
|---|---|---|---|---|
| 360×900，1 行 | 720 | 0 | 0 | 否 |
| 360×900，8 行 | 748.45 | 0 | 0 | 否 |
| 1440×900，1 行 | 614.39 | 0 | 0 | 否 |
| 1440×900，8 行 | 614.39 | 0 | 0 | 否 |

截图：`evidence/sessions/geom-mobile-8lines.png`（360，8 行，「目标任务」标题与输入完整可见）、
`evidence/sessions/geom-desktop-8lines.png`。

回归测试：`apps/web/src/layout.mobile.test.ts` 固化上面三条不变量（记录不参与内在高度、
对话列不得 `min-height: 0`、窄屏 `.dual-surface` 不得钉死 `min-height: <px>`）。

- B-F1: confirmation receives focus on Cancel; its local bubbling handler consumes only Escape. Cancel/Escape remounts and focuses the exact opening delete button. No global listener or Tab interception added.
- C-F1（首版）: `.composer-shell` no longer shrinks below its content height; `.meter-keys` wraps within its available width. No content hidden and no font sizes reduced. The populated conversation uses `ComposerMeters`, not `TaskComposer`, so `TaskComposer.tsx` required no edit.
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

### Browser recheck（更新：C-F1 判据为「不相交」，已按此修正）

1. 用一次性 Mock 会话，360×900、英文、浅色、Inspector 关闭，把 `conversation-wrap` 滚到底。
2. 量 `.meter-keys` 的父元素与整个 Goals 卡：

   ```js
   const hints = document.querySelector('.meter-keys').parentElement.getBoundingClientRect();
   const goals = document.querySelector('.module-card-goal').getBoundingClientRect();
   ({ hints: { top: hints.top, bottom: hints.bottom }, goals: { top: goals.top, bottom: goals.bottom },
      overlap: !(hints.bottom <= goals.top || hints.top >= goals.bottom),
      overlapPx: Math.max(0, Math.min(hints.bottom, goals.bottom) - Math.max(hints.top, goals.top)) })
   ```

   判据：`overlap === false`（≤1px 容差）。**方向无关**——初版写的 `hints.top >= goals.bottom`
   只描述「hints 在 Goals 下方」一种顺序，与本意矛盾，已作废。
3. 再加压一次：在 composer 里敲到 8 行（Shift+Enter），重复第 2 步。这是复验时触发 36px 重叠的真实条件。
4. 附加结构判据（与滚动位置无关，最能说明问题）：

   ```js
   const conv = document.querySelector('.conversation').getBoundingClientRect();
   const shell = document.querySelector('.composer-shell').getBoundingClientRect();
   const sect = document.querySelector('.module-sections').getBoundingClientRect();
   ({ footerOverflowPx: shell.bottom - conv.bottom, sectionsGapPx: sect.top - conv.bottom })
   ```

   两者都应为 0（或 ≥0）。`footerOverflowPx > 0` 就是本缺陷本身。
5. 键盘：Tab 到第二个会话的删除按钮 → Enter → Cancel 获焦 → Esc → 确认条消失且焦点回到同一个删除按钮 →
   Tab/Shift+Tab 正常；Confirm 上再按 Esc 同样还原；鼠标 Cancel/Confirm 各一次。
6. 回归看一遍 1440×900：composer 仍在底部、对话记录自己滚动、模块卡不被压。
3. Keyboard: Tab to the second session's Delete button → Enter → check Cancel focused → Escape → check confirmation absent and the same session's Delete focused → Tab and Shift+Tab traverse normally. Repeat Escape from Confirm. Reopen and mouse-cancel, then reopen and mouse-confirm a disposable session; confirm exactly one delete/recycle action.
4. Open Inspector, command palette, and model switcher independently and check their existing Escape behavior. The component test verifies local propagation only; it does not certify these browser overlays.
