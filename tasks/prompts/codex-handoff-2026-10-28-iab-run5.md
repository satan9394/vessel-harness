# Codex 单：卡 260/275 真实视口补拍（run 5，2026-10-28）

**唯一目标**：在**可见 IAB** 里用 917×567 视口拍到两张能读出关键文本的截图——W1 的 Stop 失败提示完整可读、W2 的新建文件 Diff ——并把证据写进仓库。产品代码零改动。

**为什么必须由主线程做**：前两次（run 3、run 4）都死在子代理线程——`cua.createBrowserTab('iab', …, {visible:true})` 在子代理里直接返回 `IAB visibility is not supported in a subagent thread`。本单**禁止 spawn_agent / 派子代理 / 并行子线程**，浏览器操作全部由你（主线程）自己做；需要等待就用主线程 sleep 或轮询，不要委派。

## 0. 路由

- 模型 `gpt-6.1-sol`，档位 `medium`；Fast 关闭；不用 Ultra（本单不允许并行子代理）。
- 依据：`AGENTS.md` 选型表「多文件、需要协调、预期会返工的复杂技术工作 → `gpt-6.1-sol` / `medium`（默认主力）」。本单要起 serve + 桩 provider、走 CDP 拦截、再从截图和 DOM 数字判定「有没有被裁切」，属于会返工的一类，但判据是机械可测的（bbox 数字 + 文案），不需要为「证据冲突拍板」预留 `xhigh`。
- **不预升档**：只有本轮真的红了（具体哪条命令/哪个判据失败）才在同一会话升 `gpt-6.1-sol` / `xhigh`；再红才考虑换 `gpt-6-astra` / `medium`。没有失败证据就升档，按项目规则算越界。
- 若在主线程也拿不到可见 IAB，**换模型/升档都无用**——那是环境阻塞，直接记 UNVERIFIED 并停。
- 不用 `gpt-6-luna`（多步浏览器 + 排障超出「边界清晰的小修」），不用 `gpt-6.1-terra`（run4 的 terra 只走到「被拒就停」，从未真正操作过页面；本单需要有人把浏览器调通并判读截图）。

## 1. 前置：先把 dist 建到最新（否则拍的是旧 UI）

实测工作树里 `apps/web/dist/index.html` 是 **2026-10-27 07:58**，而 W1 的修复在 `apps/web/src/components/ConversationView.tsx`（**19:12**）——现在 `vessel serve` 托管的是**旧 bundle**，直接拍必然是旧行为。开工第一步：

```
node node_modules/typescript/bin/tsc -b tsconfig.json
npm run -w @vessel/web build
```

- 两条都要 exit 0。第二条**只能**用这个命令（它内置 `--emptyOutDir false`）；**不要**用 `build:clean`（会清空 dist，违反删除纪律）。
- 建完记下 `apps/web/dist/index.html` 的新 mtime 与它引用的 `assets/index-*.js` 文件名到报告里，作为「拍的是新 UI」的凭据；`dist/` 被 gitignore，不算改动源码。

## 2. 夹具（全部在系统 TEMP，不碰真实用户数据）

- 工作区 `<TEMP>\vessel-iab-run5-<random>\workspace`（空目录，**确认没有 `fixture.txt`**）。
- 隔离环境变量：`HOME`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、`VESSEL_SESSION_ROOT`、`VESSEL_PROVIDER_ROOT`、`VESSEL_USAGE_ROOT`、`VESSEL_MCP_ROOT`、`VESSEL_SETTINGS_ROOT`、`VESSEL_DAEMON_ROOT` 全部指向该夹具根；`VESSEL_TRASH_TTL_DAYS=0`（免启动清理干扰）。
- 端口：先 `Get-NetTCPConnection -LocalPort 5678 -State Listen`，无监听就用 5678，否则换 5700–5799 内空闲端口；桩 provider 用系统临时分配端口。**不要**用 7897 / 3111 / 3080 / 8899 / 3001。
- 启动：`node apps/cli/dist/cli.js serve --port <port> --workspace <夹具>\workspace`。
- 桩 provider：本地 OpenAI 兼容 HTTP 服务，**通过正常 UI 配置**（keyless，baseUrl 指向桩的 `/v1`，模型名随意如 `fixture-model`），不要写任何凭据。若 `%TEMP%\vessel-iab-run2-1b21431d\providers` 还在，可复用其中 `fixture` 供应商配置（baseUrl 指向 `127.0.0.1:58948/v1`），但桩要自己起。
- 桩行为（与第三波已验证的一致）：第一轮返回 `tool_calls: Write({path:'fixture.txt', content:'before\nsecond\n'})`，收到工具结果后返回文本 `Fixture complete`。
- 会话权限用 `workspace-write`（`read-only` 下 Write 会被拒）。
- 会话通过 UI 新建并发送 prompt（这样 Stop 与 Inspector 走的都是真实 UI 路径）；若 UI 输入不稳，可改用 UI 同源的 HTTP 建会话、再用 UI 打开，但报告里要写明实际走的是哪条。

## 3. W1 · Stop 失败提示在 917×567 里完整可读

1. 视口设成 **917×567**（用 run2 用过的 viewport override；结束时还原）。
2. 让桩保持在「已发请求、未回包」状态（held 响应），点 Stop。
3. 用 CDP 拦截**只这一条**：`Fetch.enable` 的 pattern 用 `resourceType:'Fetch'`（实测 `urlPattern:'*/api/sessions/*/interrupt'` + `requestStage:'Request'` 会被拒：`This method is not supported through raw CDP…`；`Fetch.disable` 也会被拒，收尾要用 `Fetch.enable` 传**空 patterns 数组**清拦截）。
4. 对 `/api/sessions/<id>/interrupt` 返回 **503**，body `{"error":"fixture_stop_failed","message":"Controlled fixture Stop failure"}`。
5. 判据（缺一条就写「不通过」）：
   - UI 出现完整文案：`停止请求失败，尚未确认中断。请重试；运行状态与未发送草稿已保留。`（来源 `apps/web/src/i18n.ts` 的 `stopFailed`），且**整段都在可视区内、不被底边裁切**；
   - 记录证据：该提示元素与消息滚动容器的 `getBoundingClientRect()`、容器 `clientHeight`/`scrollHeight`/`scrollTop`，以及提示最后一行 bottom ≤ 容器可视 bottom（把数组写进 JSON，不要只留截图）；
   - 请求中态文案 `正在请求停止…`（`stopPending`）出现过、Stop 按钮 `disabled=true`；失败后恢复 `disabled=false`；`思考推演中…` 仍在（运行状态保留）。
   - 失败后**手动上滑不被抢回**：滚轮向上，记录 `scrollTop` 变化，再等 1–2 秒重读，数值不得回弹到之前位置。
   - 截图 `w1-stop-failed-917x567.png`，能读出上述整句。

## 4. W2 · 新建文件 Diff 在 917×567 里看得见

1. 同一视口，新建会话 → 发 prompt 让桩请求 `Write` 到**不存在的** `fixture.txt` → 等工具完成。
2. 打开 Inspector → Changes → Patch，判据（缺一条就写「不通过」）：
   - 能看到 `fixture.txt`、`+2/−0`、`@@ -0,0 +1,2 @@`、`+before`、`+second`；
   - 控件只有「折叠」一个，**没有** apply / accept / discard / reject / revert；
   - 截图 `w2-new-file-diff-917x567.png`；把 Inspector 里读到的文本行、按钮清单（accessible name 列表）写进 JSON；
   - 磁盘 `<夹具>\workspace\fixture.txt` 字节必须正好是 `before\nsecond\n`；会话日志里 `Write` 的 `tool/call` 与 `tool/result` 各 1 条（只写一次）。
3. 负对照：同一工作区再发一轮（此时 `fixture.txt` 已存在）→ **不应新增** diff widget，文件字节不变；把「新增 widget 数 = 0」记进 JSON。

## 5. 允许改的文件

- 新建：`evidence/sessions/2026-10-28-iab-run5/**`（`report.md` + 截图 + 测量 JSON）。
- 末尾追加：`tasks/275-ui-final-acceptance.md`、`tasks/260-browser-runtime-acceptance.md`。
- 构建产物：`apps/web/dist/**`、`packages/*/dist/**`（gitignore，允许重建）。

## 6. 禁止

- 不改任何产品源码、测试、脚本、配置、`.pdw/`；不改卡内**已有**行（只许在末尾追加）。
- 追加 `tasks/260-browser-runtime-acceptance.md` 时**不要在文件末尾再加空行**——它第 66 行已经是历史 EOF 空行，`git diff --check` 正在报它，别让它变成两行。
- 不 `git add` / `commit` / `push` / 建分支；不新建任务卡；不调用本机其它 Agent CLI（`dsh`/`opencode`/`claude`/`pi`）。
- 不用 DOM 观测、旧截图、组件测试顶替视口证据；打不开可见 IAB 就照实记 UNVERIFIED。
- **不做 150%/200% 缩放与原生输入法**：已验证 `Ctrl+=` 无效、CDP `deviceScaleFactor` 只改 DPR，这两项只能真机，不要在这上面耗回合。
- 不做全量门禁（`scripts/gate-batched.ps1` 已由协调者跑过，本轮不需要）。

## 7. 停止条件

- `createBrowserTab('iab', url, {visible:true})` 被拒 → `js_reset` 后重试**一次**；仍被拒就停，把两次原文报错写进报告，结论记 **UNVERIFIED**（这不算失败，但不许用替代证据）。
- 任一步连续两次失败（工具、选择器、拦截），停下来把实测值、尝试过的手段写清楚，不要无限重试。

## 8. 交付格式

报告 `evidence/sessions/2026-10-28-iab-run5/report.md` 按这个骨架写：

1. 结论：W1 / W2 各自 `通过` / `不通过（附现象）` / `无法验证（附原因）`——**不要写整卡「已验收」**，签收由协调者做。
2. 每条判据的实测值（数字/阈值/文本），以及对应文件名。截图存盘后**核对魔数再命名**（run2 的 `.png` 其实是 JPEG，别重复）。
3. dist 新鲜度凭据：两条构建命令 exit、`index.html` 新 mtime、引用的 `assets/index-*.js` 名。
4. 端口与服务：启动命令、PID、结束时 `Get-NetTCPConnection` 监听数为 0 的实测输出。
5. 逐条列出被拒/失败命令的原文；未做项与原因。
6. 改动文件清单（只应有：`apps/web/dist/**`、`packages/*/dist/**`、新的 evidence 目录、两张卡的末尾追加）。
7. 最后一行给出所有截图与 JSON 的路径清单。

结束时：停掉自建 `serve` 与桩，确认端口监听数 0；夹具留在 TEMP 供核对，不做永久删除。
