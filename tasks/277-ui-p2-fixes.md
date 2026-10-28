# 任务卡 277: 修复浏览器验收的两个 P2 缺陷

**状态**: 已收口（2026-10-24）：B-F1 用户浏览器复验通过；C-F1 首版被判不通过后重做，PDW 任务 `20261024095132-1bac7e` 达 `accepted_local`，几何检查 5 视口全绿。**2026-10-28**：几何项由协调者复跑 `node scripts/ui-geom-check.mjs` exit 0（5 cases）再确认；键盘/焦点与 1440×900 人眼确认已写成 Codex 主线程任务（Part B1），仍待签收
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

### 最终状态（2026-10-24，PDW 任务 `20261024095132-1bac7e` = `accepted_local`）

C-F1 已修复并通过**机器验收**，不再是「看起来对」：`scripts/ui-geom-check.mjs` 会自己构建、
起服务、驱动本机 Chrome（CDP，无 Playwright 依赖），在 5 个视口断言四条不变量，
PDW 在 checks 阶段实跑 exit 0（`checks-0-1fa1a2/1.stdout.log`：`geometry check passed (5 cases)`），
同时 `web-tests` 58 文件 / 494 通过、`web-typecheck` exit 0。

最终修法（Codex 实现，PDW 契约约束）：

1. `layout.css` 基础 `.dual-surface` 的 `min-height: 420px` → `auto`——原来的固定地板在
   **>800px 分支**同样会造成越界，960×600 与 1440×480 实测 `sectionsGapPx=-112.7`、重叠 17.81px；
2. `styles.css` 的 `.message-list-scroll` 由 `min-height: 0` 改为 `60px`——把「正文不被挤没」
   从口号变成可测下限（改前 360×900 八行草稿只剩 48px）；
3. 删除 `dashboard.css` 里 `> .conversation { min-height: 420px }` 这条同类死规则；
4. `layout.mobile.test.ts` 重写，覆盖 base / 800px / 700px 三个分支并读 `dashboard.css`。

验收判据（写进检查脚本，不是散文）：footer 不超出 `.conversation`、`.module-sections` 不早于它、
`KEY HINTS` 矩形与 Goals 矩形不相交（1px）、正文布局高度 ≥60px；若某视口下正文被滚出视口上方，
则容器必须可滚动（可达性），这条来自复核意见 R1。

剩余 intentionally 接受的行为：1440×480 这类极短视口 + 8 行草稿时，正文会落在视口上方，
需要向上滚动查看——这是「整列比窗口高就滚动」的既定口径，已在检查里表述为「可滚动即可达」。
用户可见的确认仍建议做一次（判据见下），但不再是唯一证据。

### 历史：2026-10-24 浏览器复验 → C-F1 判为不通过（已由上面收口）

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

### Bounded viewport follow-up (2026-10-24)

Implementation rechecked under contract 20261024091657-a14eca: cover the base column and both 800px/700px breakpoints, preserve a usable transcript, and remove the obsolete dashboard conversation minimum. No usage, configuration, or component interface changes; CSS comments and this task record document the layout behavior. The 420px desktop minimum and obsolete dashboard override are removed; the transcript retains a 60px minimum. Static checks traverse every rule and media branch, explicitly covering 800px and 700px.

Fresh contract checks (2026-10-24): `node node_modules/vitest/vitest.mjs run --root apps/web` exited 0 (58 files / 494 passed); `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit` exited 0; prerequisite `node node_modules/typescript/bin/tsc -b tsconfig.json` exited 0. `git diff --check` passed.

Broader regression: `npm run test:all` exited 1 after 558.73s: root 301 files passed / 4 failed; 3193 tests passed / 5 failed / 6 skipped. Failures were `process-tree.test.ts` (pre-spawned grandchild missing from enumeration), `virtualProxy.test.ts` (taskkill access denied), `provisionScript.test.ts` (two provisioning access-denied failures), and `daemonRecycle.windows.test.ts` (expected recycling rejection resolved). These files are outside scope and were not edited; no baseline comparison was run to classify them as pre-existing. The command's chained web leg did not run; the separate contract web run above passed.

Historical browser attempts under that earlier contract were interrupted without measurements: the first after more than two minutes, the retry at 90 seconds; port 9341 never exposed a reachable CDP endpoint. Only the two disposable server processes from those attempts were stopped. The earlier statement that `evidence/sessions/ui-geom-check.json` recorded this failure was incorrect: the artifact currently contains a later five-case successful run generated at 2026-10-24T09:38:50.025Z. That artifact is prior evidence, not a fresh check for the current contract.

Current bounded implementation (contract 20261024093917-cbfcb8): preserved the existing content-based CSS fix and strengthened `layout.mobile.test.ts` to reject fixed minimums on the intermediate `.chat-surface`/`.conversation-wrap` boxes as well as the conversation/dual surface, and reject later transcript overrides that remove its 60px minimum, size containment, or own scrolling. Base rules, both 800px/700px branches, and dashboard CSS remain covered. No usage/configuration/interface changes are required; this maintenance record and existing CSS comments describe the behavior. No acceptance criteria or checking instrument were edited.

Implementation self-checks after the regression-guard edit: `node node_modules/vitest/vitest.mjs run --root apps/web` exit 0 (58 files / 494 tests passed, 26.63s); `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit` exit 0. These are scoped web checks, not a full repository regression claim.

Geometry is intentionally delegated to the runner's checks stage; this implementation role did not launch a browser or run `scripts/ui-geom-check.mjs`. AC1-AC3 require fresh runner evidence. The instrument measures the position/height clauses but does not populate messages or measure outer/inner scroll extents, so AC3's content-filled transcript/outer-wrapper scroll clause still needs an independent browser probe. The broader card's keyboard checks remain outside this bounded contract.

Contract 20261024095132-1bac7e: retained the existing content-based column minimums in both width branches and the 60px transcript reservation. Added transcript `overscroll-behavior-y: contain` so reaching its scroll boundary does not chain the same gesture into the module wrapper; the regression guard also rejects later overrides of this behavior. The outer wrapper remains available for reaching modules on short/narrow viewports. No usage, configuration, or component interface changed; documentation belongs here and in the CSS comments. Browser geometry and content-filled scrolling remain runner/reviewer checks, not implementation self-test claims.

Self-checks for this contract after the CSS/test edit: `node node_modules/vitest/vitest.mjs run --root apps/web` exit 0 (58 files / 494 tests passed, 27.68s); `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit` exit 0; `git diff --check` exit 0. AC4's six static layout tests passed within that suite. The pre-existing edits to the out-of-scope geometry instrument and its historical evidence were left untouched; no browser or geometry check was launched by this role.

---

## 2026-10-28 · 几何项复跑 + 剩余项的明确入口

- `node scripts/ui-geom-check.mjs` → **exit 0**，stdout 末行 `geometry check passed (5 cases)`；报告写 `%TEMP%\vessel-ui-geom-check.json`（脚本按设计只写 %TEMP%，不落仓库，避免 PDW checks 判 source drift）。这一项只覆盖几何/重叠，不含键盘焦点，也不含「看起来对」。
- 键盘/焦点与 1440×900 人眼确认已写成 Codex 主线程任务：`tasks/prompts/codex-handoff-2026-10-28-daemon-and-ui.md` 的 **Part B1**（7 步剧本 + `document.activeElement` 记录 + 整屏截图），执行前置是主线程可见 IAB（2026-10-28 run 5 已验证可用）。
- 因此本卡的人眼/键盘确认**仍未签收**，但不再是「没人能做」：已有明确执行入口与判据。
