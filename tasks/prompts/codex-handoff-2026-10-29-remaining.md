# Codex 单：最后四件（2026-10-29）

前置全绿：HEAD `a974edd`，工作树干净；全量门禁 17 步 exit 0（根 335 / 3,706 passed + 8 skipped，web 59 / 528，conformance 25/25 $0）。**不要重跑全量门禁**，那是收口时我来做。

这一单只有四件，按 T1→T2→T3→T4 顺序做；后三件互不依赖，T1 也不要拖到别的改动里。每件都对应一张已写好的卡，**先读卡再动手**。

纪律（违反即整批不算）：
- **主线程执行，禁止 spawn_agent / 子代理**。
- 不 `git add` / `commit` / `push` / 建分支；不新建任务卡；不改卡首行状态（签收归协调者）。
- 不调用本机其它 Agent CLI，不跑 `--live`；不装依赖（真的有需要先说，不要自行 `npm i`）。
- 日志、夹具、截图原料只写 `%TEMP%`；删除一律进回收站。
- 允许改的仓库路径只有：各卡「Blast Radius」列出的源码/测试、对应卡的**末尾追加**、卡内指定的新证据目录。
- 路由 `gpt-6.1-sol` / `medium`，Fast 关闭，不用 Ultra；首轮不预升档。

---

## T1 · 沙箱拒绝信息可读（卡 360）

读 `tasks/360-sandbox-denial-message-readable.md`。

要点：越界写被拒时，`createShellTool` 返回的 `content` 现在是一串问号（本机 GBK 文本被按 UTF-8 解码）。要在**不把非零退出改判成功**的前提下，让「被拒绝」可读可判别：加 ASCII 提示、或按系统 OEM 代码页回退解码，二者择一并说明理由。

自验：`node node_modules/vitest/vitest.mjs run packages/tools`、`node node_modules/typescript/bin/tsc -b tsconfig.json`、`node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit`。

真实复现（隔离夹具，只写 `%TEMP%`）：
```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/provision-sandbox.ps1 -Path <TEMP>\ws
# 然后用 createShellTool（生产装配，nativeAudit 必传）在 ws 里跑：
#   echo hi                       → 期望 exit 0
#   echo x> in.txt                → 期望 exit 0，文件存在
#   echo x> %USERPROFILE%\escape.txt → 期望 exit 1，且 content 可读
# 结束：powershell.exe ... -Path <TEMP>\ws -Revoke
```

## T2 · 窄宽布局挤压（卡 362）

读 `tasks/362-narrow-width-layout-squeeze.md`。

要点：960×600 下「上下文占用 / 费用」被压成竖排单字；1440 下团队面板只有 482px 宽、DAG（约 724px）要横向拖。两处都只动 `apps/web` 的布局与样式。

自验：`node node_modules/vitest/vitest.mjs run --root apps/web`、`node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit`。

截图对比：改前图已有（`evidence/sessions/2026-10-29-zoom-render/zoom150.png`、`evidence/sessions/2026-10-28-final-sweep/t2-canvas.png`）；改后用同一批宽度重截，存到本单新证据目录。
若判断某项改动面大于收益，允许只做费用列那一项，另一项在卡里写「已知、按设计」并说明理由。

## T3 · 卡 175 三项残余可证伪（卡 361）

读 `tasks/361-card175-fixture-residuals.md`。

要点：300 字截断、产物链接、三色以上节点状态，这三项在离线 mock 下一直 UNVERIFIED。用脚本桩 provider 造长输出 / 产物文件 / 失败态，把三项各判成「通过 / 不通过 / 无法验证（附卡点）」。**不改产品代码**；造不出来就写清卡在哪。

阶段创建入口：`POST /api/sessions/<id>/team-stages`，body `{"task":"…"}`；批准 `POST /api/team/stages/<id>/approve`。

## T4 · `teamStageApi` 合跑偶发（卡 363，可选，20 分钟封顶）

读 `tasks/363-teamstage-flake-under-combined-run.md`。

要点：把 `apps/local-server` 与 `apps/cli` 放进**一次** vitest 调用时，`teamStageApi.test.ts > checks the opened descriptor identity…` 偶发失败过一次（`expected [Function] to throw`）；单跑 2/2 绿、合跑重跑一次 1,101 全绿。先判定是测试隔离还是产品偶发，给可重复的复现次数。**20 分钟内复现不出来就写「未复现 + 已试次数」收工**，不要耗整轮。

---

## 明确不做（不要顺手做，也不要"顺便修好"）

1. 全量门禁 `scripts/gate-batched.ps1`：协调者收口时跑。
2. 154 `release-report`（要配额且刷完仍 partial）、155 字面 3h soak、ARCH-04 `--live`（要逐次授权且 adapter 与真实 CLI 脱节）。
3. macOS Seatbelt 三件（`sandbox-exec` 探测、策略行为、逃逸后代约束）：本仓暂不正式支持 macOS，已记为文档边界。
4. 原生中文输入法：已撤出待办（守卫与 opencode 同款、单测覆盖）。
5. V5 卫生项：`.tmp/` 是 2026-10-07 锁文件验证时保留的 `node_modules` 备份；62 行绝对 TEMP 引用是历史记录。**都不许清理或改写。**

---

## 交付

- 新证据目录：`evidence/sessions/2026-10-29-remaining/`（`report.md` + 截图 + JSON + 收尾记录）。T3 若按卡走 `2026-10-30-card175-residual/` 也可以，二选一并在报告里写明。
- 卡末尾追加：`tasks/360-…`、`tasks/361-…`、`tasks/362-…`、`tasks/363-…`（只追加，不改已有行）。
- 报告骨架：① 每张卡 `通过 / 不通过（附现象）/ 无法验证（附原因）`，不要写整卡「已验收」；② 每条判据的实测值与文件名；③ 端口/进程/ACL 收尾（监听 0、ACL 已撤销）；④ 被拒或失败命令的原文；⑤ 改动文件清单。
- 收尾：停掉自建 serve、撤销 provision 的临时 ACL、确认无残留进程。

## 停止条件

- 任一任务连续两次失败即停该任务、写清实测值；不因一项卡住而放弃其余三项（T1/T3/T4 互不依赖）。
- 任何需要改超出卡内 Blast Radius 的文件时，先停下写理由，不要自行扩围。
