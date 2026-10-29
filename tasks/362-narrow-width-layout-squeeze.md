# 任务卡 362: 窄宽下的两处布局挤压（960px 费用列竖排 / 团队面板横向裁切）

- Status: 已完成（2026-10-29，closeout T1 补上观感复核）：DAG 溢出提示已验收（截图 + jsdom 测试）；头部 `.usage-bar` 在可见 IAB 的 960/720/1440/1920 四档实测三枚 span 均单行（18.59px 高、scrollWidth=clientWidth、`nowrap`、`flex-shrink:0`），页面无横向溢出
- PDW task: none
- 来源：`evidence/sessions/2026-10-29-zoom-render/`（缩放）与 `evidence/sessions/2026-10-28-final-sweep/`（团队面板）两组截图。

## 1. 现象

1. **960 宽（约等于 150% 缩放）时**，会话头部右侧「上下文占用 / 费用」那一列被压成竖排，每行一两个字（截图 `zoom150.png`）。
2. **1440 宽下团队面板只占 482px**，DAG 的 SVG 约 724px，需横向滚动才能看全，抽屉文字也在同一窄列里被裁（`t2-canvas.png`、`t2-drawer.png`）。

## 2. Goal

两种宽度下信息不被压成不可读、也不需要横向拖动才能读：

- 费用/占用列在窄宽时改为换行或折叠成一行摘要，不要竖排单字。
- 团队面板在窄列下给出明确的「可横向滚动」提示，或让 DAG 自适应缩放（节点形状不变形）。

## 3. Acceptance

- A1 960×600 与 720×450 下，费用/占用区不再出现「一行一两个字」；用截图加该元素 `clientWidth/scrollWidth` 断言。
- A2 团队面板在 1440 下的 DAG 要么完整可见，要么有可见的滚动提示（截图证明），节点文字不截断。
- A3 1440×900 与 1920 宽的既有布局不回归（与 run2 的 80 格矩阵结论不冲突）。
- A4 相关组件测试更新，`apps/web` 单测与 `tsc -p apps/web/tsconfig.json --noEmit` exit 0。

## 4. Blast Radius

`apps/web/src/components/**`（仅布局与样式及其测试）。不改 API、不改数据契约。

## 5. 备注

这是**外观修正**，不是缺陷阻断。若判断改动面大于收益，允许只做 A1，把 A2 记成「已知、按设计」并说明理由。

## 6. Result

待执行。

## 2026-10-29 remaining run — measured results; sign-off reserved

A1–A4: 通过 / PASS for the measured fixture. Original vertical stacking did not reproduce at 960×600 or 720×450 in the fresh session; supplied zoom150.png shows the task start screen, not these meters. Added whole-metric wrapping protection. Dark/light matrix at 960×600, 720×450, 1440×900 and 1920×900: context clientWidth/scrollWidth 72/72px, cost 67/67px, one-line labels; no document horizontal overflow. DAG at 1440: scroller 242px / content 724px; visible Chinese scroll hint, keyboard-focusable scroller; each node title 180/180px, full text reachable with horizontal navigation. Node size preserved. No claim to revalidate the historical 80-case matrix. Web tests 60 files / 530 passed; web typecheck and TEMP-output production build exit 0. Evidence: `evidence/sessions/2026-10-29-remaining/t2-matrix.json`, `t2-dag.json`, screenshots and `t2-comparison.html`. No API/data contract change; requested route as recorded in environment.json.

## 7. Result（协调者验收，2026-10-29 —— 一半合格，另一半改错了元素）

**DAG 那一半通过。** 1440 下滚器 242px、内容 724px，现在有可见提示 `↔ 横向滚动查看完整任务图`（浅/深两主题各一张截图），容器在溢出时 `tabIndex=0`、不溢出时移除；jsdom 测试覆盖「溢出才提示、不溢出无提示、节点宽度不变（200）、点击选中精确节点、卸载时 disconnect」。这条我认。

**费用列那一半没打中。** 执行方量的是页面底部 `.meters > .meter`（那里本来就正常），加的 `composerMeters.css` 只作用于它；而 960 下真正被压成竖排的是**头部** `.usage-bar` 里的四个 span（截图 `t2-before-960.jpg` 右侧那列「次/调/用/元」）。根因是 `.conversation-head` 是 `justify-content: space-between` 的 flex，窄宽时子项默认可收缩，span 被压到一两个字宽后逐字换行。

**我补的修法**（`apps/web/src/styles.css`）：`.usage-bar` 加 `flex-wrap: wrap`，`.usage-bar > span` 加 `flex: 0 0 auto; white-space: nowrap`。效果是整条指标会换行，而不是把每个指标压成竖排。改后 `apps/web` 单测 **60 文件 / 530 passed**、`tsc -p apps/web/tsconfig.json --noEmit` exit 0。

**仍未完成**：这一处的**真实观感复核**。无头浏览器没有会话深链（应用用 React state 选会话），我用 CDP 点侧边栏也没命中会话项，所以只验证了「CSS 规则正确、测试不回归」，没拿到改后的会话页截图。下次有可见 IAB 时补一张 960 宽的头部件即可收口；在那之前不要把这条当已验。

## 2026-10-29 closeout — final measured result

通过 / PASS. Visible IAB verified the actual .usage-bar at 960×600, 720×450, 1440×900 and 1920×900 with a long session title and real assistant output. All three rendered spans are nowrap, flex-shrink 0, 18.591px high, scrollWidth = clientWidth; document scrollWidth equals innerWidth at every size. No source CSS edit needed: the initial web dist was stale; the current-source TEMP build passes, and its CSS is identical to the final T2 build. Screenshots t1-header-960/720/1440/1920.png and measurements t1-header.json are in evidence/sessions/2026-10-30-closeout/. Normal web dist still needs coordinator refresh. Full gate not run.

Cleanup: owned ports 5694–5698, processes and children all 0; cleanup.json. No downloads, subagents, external Agent CLI or commit/push. Existing card status and lines preserved.

## 协调者验收（2026-10-29）

采信，但要纠正一处叙述：本卡最后一项不是「再补一张截图」，而是**改后观感从未在真实 UI 里看过**。这轮用的是可见 IAB + 当前源码构建（不是仓库里过期的 `apps/web/dist`），四个宽度都拿到了实测数字与图。

我自己看图的结论：960 与 720 两张里头部三枚指标各占一行、字横向可读（不是逐字竖排），与 1440/1920 两张一致；`t1-header.json` 里 `scrollWidth == clientWidth`、`height 18.591px`、`nowrap`、`flexShrink 0` 与图对得上，`documentWidth == innerWidth` 也没有横向滚动。发现 dist 过期这件事本身是对的：仓库里的 `apps/web/dist` 确实缺 `.usage-bar` 规则，我已按 `npm run -w @vessel/web build`（`--emptyOutDir false`）重建，exit 0。

独立复跑（不采信执行方的 `accepted_local`）：`--root apps/web` **61 文件 / 535 passed**、`apps/local-server` **28 / 320**、`packages/agents/src/team` **9 / 49**、`tsc -b` + `tsconfig.test.json` + `apps/web/tsconfig.json` 三处 **exit 0**；全量门禁 `scripts/gate-batched.ps1` **17/17 exit 0**（根 335 文件 / 3,713 passed + 8 skipped，web 61 / 535，离线 conformance 25/25、$0，日志 `%TEMP%/vessel-gate-384557f6`）。

边界：本条只覆盖 `.usage-bar` 头部与 DAG 溢出提示；没有重测 150%/200% 缩放下的同一处（那批栅格证据在 `evidence/sessions/2026-10-29-zoom-render/`）。
