# Codex 单：收尾三件（2026-10-29）

现状：HEAD `af0bb33`，工作树干净；全量门禁 **17 步 exit 0**（根 335 文件 / 3,712 passed + 8 skipped，web 60 / 530，conformance 25/25 $0）。**不要重跑全量门禁**。

这一单只有三件：一件是上一轮没验完的观感复核，一件是夹具暴露的小缺陷，一件是没覆盖到的断言。都有卡，**先读卡再动手**。

纪律：主线程执行、禁止子代理；不 commit/push、不新建卡、不改卡首行；不调其它 Agent CLI；浏览器下载一律落 `%TEMP%`（上一轮有一次落到 TEMP 外再手工移回，别再来一次）；只允许改各卡 Blast Radius 里的文件 + 卡末尾追加 + 新证据目录。路由 `gpt-6.1-sol` / `medium`，Fast 关，不用 Ultra。

---

## T1 · 卡 362 的头部观感复核（唯一真正的未闭合项）

读 `tasks/362-narrow-width-layout-squeeze.md` 的「Result」段。

背景：上一轮把费用列改成了底部 `.meters`，但 960 下真正被压成竖排的是头部 `.usage-bar`（`次/调/用/元` 那四个 span 被压到一两个字宽后逐字换行）。协调者已补 CSS：

```
.usage-bar { flex-wrap: wrap; }
.usage-bar > span { flex: 0 0 auto; white-space: nowrap; }
```

但**没有拿到改后的会话页截图**——无头浏览器没有会话深链（应用用 React state 选会话），CDP 点侧边栏也没命中。所以这一条要你用可见 IAB 补：

1. 隔离夹具起 `vessel serve`（`apps/web/dist` 已是最新构建），造一个会话并让它有一条助手回复，会话标题尽量长（用长标题挤压头部）。
2. 视口 **960×600**，点开会话，量并截图：
   - 每个 `.usage-bar > span` 的 `clientWidth / scrollWidth / whiteSpace / flexShrink`，以及 `getBoundingClientRect().height`；
   - `document.documentElement.scrollWidth` 与 `innerWidth`（判有没有横向溢出）。
3. 判据：**每个 span 的 `scrollWidth ≤ clientWidth + 1`**（不再逐字换行，高度接近单行），且页面无横向溢出。
4. 再补 720×450、1440×900、1920×900 各一张，确认没把宽屏布局改坏。
5. 若 960 下仍然竖排：改 `.usage-bar` 或 `.conversation-head` 的收缩策略（例如给头部子项 `min-width: 0` 与整体 `flex-wrap: wrap`），改完重拍，并说明改了哪条规则、为什么。

产出：`t1-header-960.png`、`t1-header-720.png`、`t1-header-1440.png`、`t1-header-1920.png` + `t1-header.json`。

## T2 · 卡 364：300 字摘要要有省略号与展开（产品改动）

读 `tasks/364-team-drawer-truncation-affordance.md`。

要点：570 字符的输出进抽屉后正好显示 300 字符，但**既没有 `…` 也没有展开入口**——运行时先补省略号、抽屉再按 300 切，把标记切掉了。

要求：≤300 字符原样显示且无控件；>300 字符显示 300 + `…` + 「展开全文 / 收起」，展开显示完整输出、可往返；省略号不计入 300。同时说明省略号原本是运行时在哪补的（`packages/agents` 还是 `apps/local-server`），避免两处各自切片。

自验：`node node_modules/vitest/vitest.mjs run --root apps/web`、`node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit`。

## T3 · 卡 361 的遗留断言：内联 widget 只发一次

读 `tasks/361-card175-fixture-residuals.md` 的「Result」——「内联 widget 去重」这一项上一轮没有 populated widget 流，等于没测。

做法：用脚本桩 provider 跑一轮真实 `Write`（参照 `evidence/sessions/2026-10-27-w2-e2e/PROOF.md` 的桩行为：先返回 `tool_calls: Write`，收到工具结果再返回文本），然后在同一会话里：
1. 断言 SSE/会话日志里 `widget_block` / `widget` **只出现一次**；
2. 刷新页面后重开该会话，断言不会因为重放再冒出一个 widget；
3. 同一工作区再写一次**已存在**的文件，断言零新 widget（这条 2026-10-27 已在真实进程验过，这里只是回归）。

产出：`t3-widget.json`（计数与事件原文）+ 一张截图。若造不出 populated 流，写清卡在哪一步。

---

## 不做

- 全量门禁（协调者收口时跑）。
- 154/155/`--live`、macOS Seatbelt、原生输入法、V5 的 `.tmp/` 与 62 行 TEMP 引用（都已判定不做）。
- 不要顺手改队列/团队/会话的其它逻辑；T1 只碰布局 CSS，T2 只碰抽屉，T3 只读。

## 交付

- 新目录 `evidence/sessions/2026-10-30-closeout/`（`report.md` + 截图 + JSON + 收尾记录）。
- 末尾追加：`tasks/362-…`、`tasks/364-…`、`tasks/361-…`（只追加，不改已有行与首行状态）。
- 报告：① 每项 `通过 / 不通过（附现象）/ 无法验证（附原因）`；② 实测值与文件名；③ 端口/进程收尾（监听 0）；④ 被拒或失败命令原文；⑤ 改动文件清单。
- 收尾停掉自建 serve，确认无残留进程与端口。

## 停止条件

任一任务连续两次失败即停该项、写清实测值；不要为一项卡住而放弃其余两项（三者互不依赖）。改动超出 Blast Radius 时先停下写理由。
