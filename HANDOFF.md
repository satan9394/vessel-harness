# HANDOFF — 项目交接

> **用途**：新会话 / 新 Agent / 换人接手时，**先读本文件**：现状、未完成清单、验证命令、已知约束都在这里。
> 规则本身仍在 [`AGENTS.md`](AGENTS.md)；会约束未来的决策在 [`docs/DESIGN-DECISIONS.md`](docs/DESIGN-DECISIONS.md)。
> **最后更新**：2026-10-29（§0 顶部快照由协调者按实测刷新；其下 2026-10-22 及更早段落保留为历史）。维护者：单人。

## 0. 快速接管协议（当用户直接说「继续未完成的」或「继续」时）

**当前快照（2026-10-29，协调者实测）。下一会话先读 `evidence/sessions/2026-10-29-acceptance-handoff.md`（现状、待收报告、逐项验收顺序、已知坑）；更早的过程与入口见 `evidence/sessions/2026-10-27-session-handoff.md`（§9 为 27–28 流水，§10 是拿报告后的步骤）。**

| 项 | 实况 |
|---|---|
| HEAD / 分支 | 本地 `main`（HEAD 见 `git log -1`；8 门注册表与 `test:all` 口径未变）。**工作树干净（2026-10-29 closeout 提交后实测）**；下方 10-26～10-28 那几行「未提交改动」是历史记录，实际状态一律以 `git status --porcelain` 为准 |
| 未提交改动（2026-10-26） | 卡 343 代码：新增 `packages/shared/src/deletion/`（`recycle.ts` + 单测），改 `packages/shared/src/index.ts`、`apps/local-server/src/daemon/daemonLifecycle.ts`、`apps/cli/src/migrate.ts`、`packages/runtime/src/sandbox/backend/isolated-directory.ts`、`packages/agents/src/external/ExternalAgentRuntime.ts`；文档：`AGENTS.md`、`.gitignore`（加 `.codex/`）、`tasks/343`、`tasks/README.md`。卡 340–346 与 `README`/`HANDOFF`/`DESIGN-DECISIONS` 等更早一批也未提交 |
| 未提交改动（2026-10-27 第一波 T1–T4） | 卡 342：`apps/web/src/components/StatusBar.tsx`、`StatusBar.test.tsx`（新）、`apps/web/src/i18n.ts`；卡 344：`packages/engine/src/workspace.ts`、`workspace.test.ts`、`packages/engine/src/LoopEngine.ts`（仅一行类型，经授权）、`packages/core/src/session/Session.ts`（仅两行注释）；卡 345b：`apps/cli/src/commands/trashCommand.ts`（新）、`trashCommand.test.ts`（新）、`apps/cli/src/cli.ts`、`packages/application/src/index.ts`（`trashStore` 命名空间导出，协调者纠正 dist 相对导入时加）、`apps/cli/src/i18n.ts` 与 `apps/cli/src/cli.test.ts`（协调者把三条 `vessel trash` 帮助行移进 `usage.commands` 并同步金标）；T4：`.dsh-mission/publish/README.md`。**`git status --porcelain` 实况为准** |
| 未提交改动（2026-10-27 波次 A） | 卡 353：`packages/core/src/session/Session.ts`、`Session.test.ts`、`SessionLease.test.ts`；卡 345c：`apps/local-server/src/server.ts`、`server.test.ts`、`docs/DELETION-AND-RETENTION.md`；卡 357：同前两个 server 文件 + 同一份文档；卡 358：`apps/local-server/src/daemon/daemonLifecycle.ts`、`daemonLifecycle.test.ts`、同一份文档。四张卡的 Result 段与 `tasks/README.md` 同步。**未 commit** |
| 未提交改动（2026-10-28 第四/五波） | 卡 351：`benchmarks/runners/src/release-gates/gates.ts`、`release-gates.test.ts`；卡 345e：`packages/application/src/session/SessionRegistry.ts`（+test）、`apps/local-server/src/server.ts`（+test）、`docs/DELETION-AND-RETENTION.md`；卡 275：`evidence/sessions/2026-10-28-iab-run4/PROOF.md`（新）+ 卡内追加；第三波 W2 另在 `packages/application/src/compose.ts`（+test）与 `apps/web/src/components/layout/DualSurfaceLayout.test.tsx`。新证据三份：`evidence/sessions/2026-10-28-final-gate.md`、`2026-10-28-precommit-audit.md`、`2026-10-28-iab-run4/`。**`git status --porcelain=v1 -uall` 实测 236 路径**（V5 冻结时为 235，另加 V4 报告）。**已按 8 条提交入库（HEAD `324cc7d`）**，工作树当时干净 |
| 未提交改动（2026-10-28 收尾） | 卡 359 的修复：`apps/cli/src/daemon/daemonCommands.ts`（`status()` 回落 `instanceId`）、`apps/local-server/src/daemon/daemonLifecycle.ts`（`protectDaemonPath` 改 `whoami` + `icacls`）、`apps/cli/src/daemon/daemonCommands.test.ts`、`apps/local-server/src/daemon/daemonProtection.test.ts`（新）；卡 359/176 追加与状态行、`tasks/prompts/codex-handoff-2026-10-28-iab-run7.md`（新，只做浏览器）、`evidence/sessions/2026-10-28-iab-run6/`（Codex 的停止报告）、`tasks/README.md`。**实况以 `git status` 为准** |
| 未提交改动（2026-10-29 closeout） | 无。closeout 三件按组入库：产品 `b9cc0da`（8 文件，含新增 `apps/web/src/components/team/TeamNodeDrawer.test.tsx`）、证据 `d97b5e5`（52 文件）、卡与看板 + 本文件随收口提交。`apps/web/dist` 被 gitignore，已按当前源码本地重建 |
| 未提交改动（2026-10-29 卡 365） | 无。三组入库：产品 `07f7a27`（drawer + 其测试 + `i18n.ts`，97 insertions / 19 deletions）、证据 `efd2443`（22 文件）、卡 365 与看板/本文件随收口提交。`apps/web/dist` 由执行方在最后一次源码编辑后重建，入口资产哈希记在 `evidence/sessions/2026-10-30-drawer-polish/scope-audit.json` |
| 远端 | `origin/feat/v2.8-taste-ui` 与本地同 commit；**与本节下方 2026-10-06「不再向 GitHub 提交」的旧口径冲突，待维护者确认以哪个为准** |
| 全量门禁 | **当前状态：Node 26.13.0 上 17 步里 3 步红**（`tools+policy`、`skills+agents`、`application`），见卡 367 —— 2026-10-30 01:00 本机 nvm v1→v2 迁移把 Node 从 24.14.0 升到 26.13.0，之后首次复跑暴露；**同一份代码在 Node 24 下 17/17 exit 0**（根 335 文件 / 3,713 passed + 8 skipped、web 61 / 543、三处 tsc exit 0、conformance 25/25 $0，日志 `%TEMP%/vessel-gate-f9f7716f`）。26 上的那次：根多数步全绿（cli 783、local-server 320、benchmarks 541、web 543、tsc 三处 0、conformance 25/25），红的只集中在红绿门禁、FileHandle GC、目录联接三处，日志 `%TEMP%/vessel-gate-d5e9ae11`。再往前 2026-10-29 closeout 与卡 365 验收同一脚本 **17/17 exit 0**（日志 `vessel-gate-384557f6`）；2026-10-28 另连跑四次同一脚本，每次 17 步 exit 0（daemon 修复后那次：根 335 / 3,706 + 8，web 59 / 528，日志 `vessel-gate-b569dca3`；前三次根 334 / 3,704 + 8）。辅助检查：`git diff --check` 现为 **exit 0**（run 5 在卡 260 末尾追加后，那个历史 EOF 空行变成段内空行）；`check-append-only.mjs` 仍 exit 1（卡 275 相对 HEAD 的 `+95 -2`，两条删行在第五波开始前就不存在）。证据 `evidence/sessions/2026-10-28-final-gate.md`（含三次执行与独立复核）。本机全量使用分批脚本 |
| PDW | 1.3.3-local。**2026-10-28 起五角色全部 Codex**：`scan`/`test-plan` = `gpt-6.1-terra`，`implement` = `gpt-6.1-sol`/medium，`review`/`planner` = `gpt-6.1-sol`/high（`pwsh pdw.ps1 doctor` 五角色 ready，备份 `.pdw/skill-upgrade-20261028/`）。按任务切换写者用 `scripts/pdw-route.ps1 -Kind code-heavy|general|small|deepseek`，`-All` 连只读角色一起切；额度用尽时 `-Kind deepseek -All` 回 DeepSeek。**跑前必须冻结工作树**：1.3.3 的 `snapshot()` 覆盖整个工作树，`new` 之后任何写入（含回填任务卡）都在模型调用前判 `Source drift`。`.pdw/` 不入库；`pdw view` 只读看板默认 8891（前台起的，会话结束会被回收）。 |
| 工作流口径（2026-10-27 起） | **Codex 先用满，再转 PDW/DeepSeek**：能交 Codex 的一律先交，档位偏上取；额度用尽后 `scripts/pdw-route.ps1 -Kind deepseek` 切换（口径见 `docs/PDW-LOCAL.md` §3.1）。**2026-10-30 起 Codex 应用已装「浏览器操作 + Computer Use」两个插件**：浏览器与**桌面**类验收（任务栏、托盘、系统窗口、真实点击）一律派给 Codex 应用执行，不要把这些活丢回给维护者；CLI 形态调不到这两个插件，所以这类单写明「在应用里跑」。**2026-10-27 那轮不新增任务卡**（已收口）；卡 365/366 是用户明示授权的另立批次，走同一套流程。执行由维护者手动把 `tasks/prompts/…` 交给 Codex，协调者不代跑
| 最近交付 | **卡 365 已签收（2026-10-29，协调者独立复跑）**：抽屉的 5 条文案搬进 `apps/web/src/i18n.ts` 的 `uiTeamOutput*` 类型化键（zh/en 各 5 个，既有键值 0 改动，10 条字符串逐字断言）；展开/收起控件移到正文之上的控制行，570 与 4800 字展开后仍停在视口内（top 458.13 / bottom 490.12，innerHeight 900），无内层滚动、每样本 1 次 GET、Console 空。**顺带修掉一个真缺陷**：首次展开时按钮 `disabled` 会让原生焦点掉到 `body`，现在只在焦点仍在 body 时抢回，用户主动移焦不打扰（第一版把 hook 塞进无状态展示组件，撞坏 `TeamDagCanvas` 两条直调测试，失败记录保留、没有改测试凑绿）。产品提交 `07f7a27`、证据提交 `efd2443`。**以下为更早的交付记录**：**closeout 三件已签收（2026-10-29，协调者独立复跑；不采信 `accepted_local` 与执行方自证）**：卡 362 的头部观感在可见 IAB 的 960/720/1440/1920 四档实测三枚 span 单行（18.591px、scrollWidth=clientWidth、`nowrap`、`flex-shrink:0`，无横向溢出；首轮「复现竖排」是仓库 `apps/web/dist` 过期，源码 CSS 当时就对）；卡 364 抽屉 298/300 原样、570 走 300+`…`→展开 570→收起→再展开走缓存，全文由**一个**新增只读端点取回（同源 + daemon token、404 边界、64 KiB UTF-8 安全截断、零文件内容读取）；卡 361 的内联 widget 用真实写入流验到 1 → 1 → 1、覆盖写零新增。产品提交 `b9cc0da`、证据提交 `d97b5e5`，`apps/web/dist` 已按当前源码重建（`npm run -w @vessel/web build`，exit 0）。**下面是从 2026-10-29 往前累积的旧交付记录**：**最后四件已收口（2026-10-29）**：沙箱拒绝信息可读（`[hint]`，非零退出不改判）、artifact 路径交换守卫改 bigint（修前 10/10 可越权读、修后 10/10 拒绝）、DAG 溢出提示、卡 175 三项夹具残余（300 字截断/产物下载/四态颜色）。全量门禁 17/17 绿。 **deep sweep 收口（2026-10-29）**：`provision-sandbox.ps1` 修成两个 shell 都能跑（pwsh 7 自动转调 5.1，5.1 的 ACL 代码未动），**Windows 沙箱真机执法首次拿到证据**——我用生产 `createShellTool` 在 provisioned 工作区里跑出「echo 通过 / 白名单内写成功并读回 / 越界写 exit 1 且文件不存在 / 审计 `enforced`」，执行方那两次 `0xC0000142` 属 HANDOFF §4 记过的已知抖动；150%/200% 用布局等价（960×600、720×450）验到无横向溢出；toast 在 Windows 通知历史里有真实记录，tray 图标仍未见。**final sweep 已收口（2026-10-28）**：在一张单里把剩下的都做了——卡 277 键盘/焦点子集签收（Cancel 默认聚焦、Esc 回**同一**删除按钮、Shift+Tab 正常、Console 0 错误）；卡 175 的预审横幅 + 批准执行 + 三节点完成 + 抽屉依赖主链通过（三色状态/300 字截断/产物链接因离线 mock 不可达，保持 UNVERIFIED）；卡 180/183 的五条离线命令 32 passed、离线 conformance 25/25 由我复跑确认；卡 176 的 tray/toast 我用 ffmpeg 绕开被拦的 `Add-Type` 截了整桌面，可见通知区无图标（应在溢出面板），仍 UNVERIFIED。**这批单里 T1 第 5 步是我写错的**（写成「Shift+Tab 到取消」又要求「Enter 确认」），执行方照原文跑并如实记录，没有改判据凑绿——已在单里加了事后更正。**`vessel daemon start` 已能真起来（2026-10-28，协调者修复 + 真机验证）**：Codex 按卡 359 修掉两处（`daemon.status()` 在 `info` 就绪前回落 `{ instanceId }`，身份守卫未放宽；以及 pwsh 7 的 `PSModulePath` 污染），但真机仍两次失败；我复现后查出第三个缺陷——**同一对象上二次 `Set-Acl` 必报 `SeSecurityPrivilege`**，而 `writeDaemonFile` 对已存在文件是先 `protect` 再写、`daemon stop` 还会重写 token，于是「第二次用同一个根启动」永远失败。改成幂等的 `whoami` + `icacls`（不再经过 PowerShell）后真机五步全过：launcher 退出后同一 pid 4068 仍存活、uptime 4→6、`/api/health` 200、无 token 401 / 带 token 200、stop 后监听 0。**卡 176 的 detached 存活随之验收**。**卡 260/275 的视口缺口已闭合（2026-10-28 run 5）**：Codex 应用**主线程**开成可见 IAB（子代理线程两次被拒的根因绕开了），917×567 下 Stop 失败提示整句不裁切、新建文件 Diff 的 `+2 −0`/hunk/两行可读且只有「收起差异」，覆盖写零 widget；两张最终图我从磁盘逐字看过才签收。它还自查出 raw CDP 的 PNG 尺寸对但画面被放大裁切，改用 `tab.screenshot()` 重拍、废图保留——这点我认。**第五波已验收（2026-10-28，协调者独立复跑；不采信其 `accepted_local` 与子代理 PASS）**：V1（卡 351）修好 Windows npm 执行层且判据未放宽，默认 packaging gate status=pass、npm exit 0 / stdout 1130 字节 / stderr 0，我自己又跑一次 gate 复现同一份 detail，边界仍只是「探针可用 + 路径存在」；V3（345e）经独立 sol/high 复核，我又自建真实 `serve`+独立 CLI `restore` 复现：serve 全程同一 PID（23000），restore 后第一次 GET 即返回恢复会话一次、journal/快照未被改写、无 lease（仅新增合并）；V2 两次 visible IAB 启动被子代理可见性限制拒绝，视口仍 UNVERIFIED，非全局不可用结论；V5 冻结 235 路径/11 组，发现 .tmp 目录与 62 行历史绝对 TEMP 引用，关键词扫描未识别真实凭据，不能称全净。V4 执行证据 `evidence/sessions/2026-10-28-final-gate.md` 已完成独立 sol/high 只读复核，**我又独立执行了同一脚本，17 步全绿、计数逐字一致**（见该报告末尾）。  **第四波（2026-10-28，Codex + 独立复核）**：T1 查明 packaging 探针在 Windows 因 `execFile('npm')` 拿不到 `npm.cmd` 而 ENOENT（直接 `npm pack` 三处均 exit 0，根入口真实构建入口是 `tsc -p tsconfig.release.json`）；T2 gate 判据硬化（探针非零退出/输出空白 → `pending`，只收紧，四态各有用例）；T3 `vessel trash restore` 从 registry journal 重建索引（不信任 trash 元数据），恢复后 `sessions list` 可见、重复 restore exit 1；T5 补 `scripts/pricing-upgrade-diff.mjs`（两版内置价目 → `repairs.json`）+ 3 条单测 + 真实 CLI 消费验证；T4 IAB 不可用，**UNVERIFIED**。我复跑 release-gates 61、runners 535、application 323+3、cli 782、trashCommand 10、pricing-diff 3/3、两处 tsc 0。第三波（2026-10-27，Codex + 独立复核）**：W1 Stop 失败提示改为插入后立即滚入视口（不抢回后续手动上滑）；W2 新建文件 `Write` 成功后由 compose 发只读 `/dev/null` 全新增 Diff（覆盖写与 Edit 不发）；W3 卡 346 收口（六条逃逸对抗 + 跨平台矩阵 + 文档一致性 + 三档回滚，`restore` 在 `mkdir` 前校验根外目标与链接父链）。协调者复跑 application 320+3 / local-server 316 / engine 180 / web 528、全量门禁 17 步全绿，并用真实 `serve`+脚本桩验证 SSE 真出 `diff_inspector`、覆盖写 0 widget。**卡 275/260 仍差一次真实视口截图**（bsk 守护进程在本宿主起不来）。第二波 B/C/D（2026-10-27，Codex 应用 + 独立复核）**：卡 350c（exit 2 唯一可达路径，parity 5/5、local-server 313）、卡 356（价目值守卫文档改回事实，40/40）、卡 354（13 卡对账：6 已验收 / 2 无法确认 / 5 待用户，append-only +2/−0）、卡 355（8 卡对账 + S002/S006 判为可证伪，9 文件 / 121）、卡 351（packaging gate 实跑：门 `pass` 但只探存在性、`npm pack` exit 1，判**未通过**）、卡 260/275 第二轮（80 格矩阵 / 57 张截图，E 的 Stop 提示被裁切、I 的 Diff 未产生 → **未签收**）。第二波 A（2026-10-27，Codex 应用 + 独立复核子代理）**：卡 353 `Session.append` 重开重取租约（core）、卡 345c 服务端删除改道 + serve 启动清理、卡 357 `GET /api/trash` 只读、卡 358 daemon 每日 tick；四段均实现 + 独立复核 PASS，协调者复跑 core/session 27、core 133、daemon 32、local-server 312，全量门禁 17 步全绿。T6 首轮因测试夹具懒创建日志而红、经授权只改测试后转绿（`server.ts` 哈希未变）。第一波 T1–T4（2026-10-27，Codex 应用 + 独立复核子代理）：卡 342 状态栏三态、卡 344 engine 所有权守卫、卡 345b `vessel trash`、T4 陈旧发布产物声明；协调者独立复跑 8 条定向命令全 exit 0（合计 1,035 passed + 2 skipped），并纠正 345b 的一处 `packages/application/dist` 相对导入（见卡 345「协调者验收」）。卡 343（2026-10-26：回收原语统一，四份 `SendToRecycleBin` 收成 `packages/shared/src/deletion/recycle.ts`，四处调用点收口，门禁 17 步全绿；**由「PDW 迭代」会话越界代做，代码未提交**）、卡 347–349（PDW 侧 2026-10-26：项目级 Codex 子 Agent 落地并实测按自身模型跑、路由按失败代价适配、失败归因固化两条规则）、卡 340（2026-10-26 看板积压对账收口：248–279 共 25 张卡落「已验收」、README/HANDOFF 同步、260/275 保持未执行、F6 残留待拍板，见 `tasks/340-board-backlog-closeout.md`）、卡 336–339（审计与增量审计修复，PDW 20261026202307-0d050e / 20261026211042-ec65c8 两轮 accepted_local）、卡 325–330/335（provider 第二批，Codex CLI 四道并行）：profile 快照（独立 `provider-profiles.json` + store/HTTP/CLI/Web）、用法可见度（`byProvider.lastTs`/`models` Top3/`inputTokenSemantics`、`/usage?since=&until=`、`usage --csv`、Web 相对时间与口径与搜索）、删除保护（`provider_in_use` + `--force` 级联 + 失败回滚）、`provider profile rename`、export↔import 往返保真（修掉丢 `modelCapabilities`/`catalogEvidence`）、CLI/HTTP 一致性测试 |、卡 313（`runCandidates` → `selectCandidate` 接线：`asserts` 直接映射评审票，零额外模型调用）、卡 311（多候选运行 API：`runCandidates` 1..8 份串行、独立 runId 与工作区、越界同步抛 `RangeError`）、卡 310（CLI i18n 骨架：`--lang` 预扫描位置无关 + `t()` 三级回退，`--help` 可切语言，只做三个键）、卡 312（provenance 清单的 `--write`/`--check` 入口，111 条一致，不新增第 9 道 gate）、卡 308（反思 evidence 来源改用规则自带 `evidenceSource`，修掉 `events[index]` 配对隐患）、卡 301–307（HARNESS² P1/P2 一批：SurfaceSpec 值化、三轴分离文档、产物完整性清单 111 条、经验库 suggest-only、reuse 就绪判据、迭代层预算快照、候选匿名选优纯算法）、卡 300（补齐三处遗留测试 + 修 doctor 的 `secretRef` 误判：有 secretRef 即算已配置）、卡 299（文档诚实化第二轮 6 处修正）、卡 298（`vessel bench:runs` 只读展示）、卡 297（run 复用判定原语 `runCache.ts`，不接自动复用）、卡 296（工具链 pin 接线：offline gate 与 `vessel run --bench` 默认传 `probeToolVersion`）、卡 295（工具链 pin 升成 opt-in 硬门禁：`runScenario.toolPinsProbe` + `ToolchainPinError` → gate pending；模块搬到 `packages/shared`）、卡 294（harness 指纹：`computeHarnessFingerprint` + iteration `harnessFingerprint` + `.run-complete.json`，只落身份不判定复用，PDW `20261025145255-332fb0`）、卡 293（判分三态：`RunScore` 可选字段、成功率分母改为 `passed + failed`、`ungraded` 单列）、卡 292（conformance manifest 降级 + gate 3 泄漏断言 + 六处失败路径清 tmp）、卡 291（工具链 pin：`configs/tool-pins.json` + doctor `toolchain` 项，只 warn；协调者修掉跨包 import 导致的 dist `ERR_MODULE_NOT_FOUND`）、卡 290（fixture 读边界守卫收成共享 `fixtureCopy.ts`，5 adapter + vessel 车道复用并透传 `leakGlobs`，PDW `20261025115350-c92efe`）、卡 289（判据泄漏改硬失败：gate 先判 `FixtureLeakError` → fail，其余 setup 失败仍 `pending-environment`，PDW `20261025110345-d1d9cd`）、卡 288（HARNESS² P0-2 fixture 读边界防泄漏：manifest `leak_globs` + 复制期过滤 + 复制后复查 + 内置红线 `RUBRICS.json`/`RUBRIC.json`，PDW `20261025091835-8ee8aa` `accepted_local`）、卡 287（ARCH-07 POSIX 默认拒绝 + `VESSEL_ALLOW_UNSANDBOXED=1` 显式放行，PDW `20261025083644-85ac5b` + WSL 证据）、286（全局 OpenCode 配置迁到 v2 `providers`，恢复 `commandcode` 路由，冒烟任务 `20261025074418-69269b` `accepted_local`）、283–285（PDW 角色路由/交接/配置三卡收口；决策点 22 由 PDW 任务 `20261024155859-108eea` 交付）、276（完全访问下 Shell 可用）、277（两个 UI P2；C-F1 由 5 视口几何检查收口）、278（工具失败不再锁死会话）、279（`vessel effects list\|resolve`）、280（ARCH-09 可追溯性）、282（阻断消息给出解除命令） |
| 待执行 | **卡 366 已收口**（B/C 签收；A 补测到「图标已创建、宿主进程存活、未提升到常驻区」，只差溢出面板内那一枚的像素，边界写在卡里）。**现在挡路的是运行时**：本机 Node 已从 24.14.0 升到 **26.13.0**，全量门禁 3 步红，见卡 367。两条走法都写在卡 367 §6——**要走「留在 26」就把它交给 Codex**（改的是红绿门禁与删除逃逸守卫，属安全相关，必须独立复核）；**要走「装回 24」只需 `nvm install 24.14.0` + `nvm use 24.14.0`**（需联网下载，装完我复跑门禁确认）。**只有你自己能定的两件仍在下行「待用户执行」**。**已判不做**：154、155 字面 3h、ARCH-04 `--live`、V5 卫生项、macOS Seatbelt、原生输入法。 |
| 验收辅助 | 全量门禁：`pwsh -NoProfile -File scripts/gate-batched.ps1`（仓库内，12 段测试 + web root + 三处 tsc + conformance，日志写 `%TEMP%`）。`-SkipConformance` 跳过离线对比，`-Only <名>` 只跑某一批 |
| 待用户执行 | **只有两件决定 + 一件可选操作**：① **决策点 24 的三处口径**——默认 7 天、`VESSEL_TRASH_TTL_DAYS=0` 关闭 serve/daemon 自动清理、运行时临时文件不进回收站，是否照此定稿；② **卡 343 实现是否保留**——它由「PDW 迭代」会话越界代做，**代码已随 2026-10-28 的 8 条提交入库（`324cc7d`）**，要撤只能 `git revert`（含 5 个源文件与 `packages/shared/src/deletion/`），不再是 `git checkout --` 能撤的；③ **沙箱真机（可选）**——管理员跑 `scripts/provision-sandbox.ps1 -Path <一次性目录>`（自校验 `granted` / Low 标签）→ 在同一目录做「区外写必须被拒」对照 → `-Revoke` 恢复，三步都可回滚。要整批回撤用 `git reset --hard 40cd6a9`，单层退回用 `git revert <sha>`（退 02 要连 03 一起退） |
| 已知外部阻塞 | ARCH-04 跨 harness live 证据需逐次授权调用本机其他 CLI；UI-10 的 150%/200% 缩放与原生输入法只能在真实浏览器验证 |

下面这段是 2026-10-22 的历史快照，保留原文以便追溯，不要当作现状。

**当前续接覆盖以下历史快照（2026-10-22）**：浏览器验收两波修复12项已本地实现、验证并交证，唯一当前事实源为[evidence/sessions/2026-10-23-fix-wave-report.md](evidence/sessions/2026-10-23-fix-wave-report.md)。卡272已交证，无遗留半截实现；等待协调者验收/test:all，不自动开启新任务。指定真实模型不变，累计17个修复真实执行回合；独立的150%缩放等未验证边界仍在报告中。用户明确禁止本执行者改packages/core、commit/push、test:all；不重置现有夹具与状态。以下旧卡234/235状态只作历史背景。

**以下 2026-10-22 段落是历史快照，其中"根据 `.agent-state/run-state.json` 汇报"的旧指令已作废（该文件自 2026-10-14 起只作历史）；接手一律以 §0 顶部快照为准。**

1. **当前交付与阶段状态**：**Card 235（基于 Taste-Skill 的 Web 工作台审美审查与全屏通栏 UI 重构）已于 2026-10-20 本地交付（Web 50 文件 / 404 passed 全绿，Core 0 变动）**。根据 [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) 规范彻底清除了弧形孤岛卡片、四周 12px 留白缝隙与多余毛玻璃材质，落地顶天立地、以 1px 细线划分的工业级 Edge-to-Edge 全屏工作台。前序 **Card 234（OpenUI 生成式排版体系融入与 Web 体验痛点全景整改）已于 2026-10-19 本地闭环通过（双 Root 3445 passed / 6 skipped 全绿，Core 0 变动）**。凭据免输复用、会话安全回收站删除、深浅主题常驻切换、实体按钮交互教育、GFM Markdown 解析与 OpenUI 生成式卡片已全面交付。前序 Card 233（供应商能力继承与协商拦截修复）亦已本地合入。前序 Card 225–232 模型供应商全屏独立中枢、高级模型搜索筛选器与 CC-Switch 权威预设已全部落地。**V2.5 Epic 209（205–209）已于 2026-10-10 本地验收完成（双 Root 3083 passed / 6 skipped 全绿）**。**V2.6 Epic 214（210–214）已于 2026-10-11 本地验收完成（双 Root 3146 passed / 6 skipped）**。**Card 217（ARC-01..05 架构整改）与 Card 218（Web 工作台整改）已于 2026-10-12/13 本地全部验收完成（双 Root 3228 passed / 6 skipped，Web build exit 0，12 张中英双语截图全部刷新，core 源码严格 0 变动）**。前序 V2.4 已提交至本地 `main`（commit `dd8e72c`），V2.6+215+216 合入 `520492d`，Card 217 合入 `6442171`。
2. **已完成与已验证基线**：
   - 192–195 (V2.2)：三态洋葱 Mod 中间件流水线、Worker 线程沙箱（防御 CVE-2026-82533）、清单权限审计与 CLI `vessel mod/doctor`；
   - 196–199 (V2.3)：真实 Red→Green 缺陷复现硬门禁与 SHA-256 防伪凭据、增量 AST 符号依赖图谱（均值 10.7ms）、自适应上下文剪枝（剪枝率 82.56%）；
   - 200–204 (V2.4)：Chat 内嵌组件 IR 与双向 SSE/HTTP 端点、React 就地微组件群、四 Tab 常驻 Docked Inspector、CLI 终端动态 StatusLine 与彩色折叠 Diff；
   - 205–209 (V2.5)：画布单 Hunk 补丁选择器、流式思考折叠与规则标注、全局命令面板 Ctrl+K、桌面注意力通知与音频合成提示（3083 passed / 6 skipped）；
   - 210–216 (V2.6+)：全域纯正 i18n 字典、可视化多模型接入中枢、自动拉取与 Schema 归一化、Archify 架构可视化与中英双语 Retina 截图（3155 passed / 6 skipped）；
   - 217 (V2.7)：ARC-01..05 契约与执行可靠性中枢（SessionProjection 契约、Compaction 守恒断言、Fail-to-compile 策略门禁、Run 预算熔断、ExecutionPermit 凭证与副作用审计，3219 passed / 6 skipped）；
   - 218 (V2.8)：VESSEL-UI-2026-01 可组合 Agent 工作台（Workbench / Activity / Agent Studio / Settings 四大一级区域、就地任务启动流、分组命令面板、800px 自适应抽屉，3228 passed / 6 skipped）；
   - 全量终态门禁基线：`tsc -b`、`typecheck:tests` 均 exit 0；Web 生产打包 exit 0；全历史 `identity-guard.sh` 0 命中。
3. **当前路线与目标**：
   - **两份整改实施规范（VESSEL-ARCH-2026-01 与 VESSEL-UI-2026-01）落地状态**：
     - Card 217（架构整改落地 ARC-01..05）已验收合入 `6442171`；
     - Card 218（Web UI/UX 工作台整改落地）已验收闭环；
   - **开发模式与约束**：纯本地开发（严禁 git push，遵循 2026-10-06 规约；薄核零侵入 packages/core 源码；删除必进回收站；Web 构建使用 `npm run -w @vessel/web build`（默认保留 dist；要清空时用 `npm run -w @vessel/web build:clean`））；
   - **架构职责分工（历史，2026-10-14；分工与模型已被 2026-10-24 的 `AGENTS.md` 角色表取代）**：Antigravity (主会话) 严格定位为**规划与指挥者 (Planner/Commander)**，负责需求拆解、契约设计、任务卡编制、验收与对账；**严禁自行进行代码开发**。因 Codex 出现算力与内置浏览器环境瓶颈，代码实现与全量验证门禁全面移交给隔离执行器 **OpenCode（搭载 DeepSeek-v4.1-Flash，思考深度设为 high 最高思考深度）** 以 **goal 目标模式** 执行攻坚闭环；
   - **模型锁定规约（历史，已于 2026-10-24 被 `AGENTS.md` 角色表取代）**：当时接盘执行模型为 **DeepSeek-v4.1-Flash**（思考深度：`high`），以 `goal` 模式直达目标。

| 项 | 当前实况 |
|---|---|
| 仓库 / 分支 | `satan9394/vessel-harness` / `main`（纯本地开发，不推送） |
| 工作区状态 | HEAD `c7cb0ca`（未提交）；未提交改动 = 卡 223/224/225/226/227/228/229/230/231 与**卡 232（模型供应商全屏独立中枢、高级模型搜索筛选器与 CC-Switch 权威预设补齐）** |
| 机器状态真源 | `.pdw/`（1.3.3-local，配置就绪，doctor exit 0） |
| 当前任务卡 | **Task 234（OpenUI 生成式排版体系融入与 Web 体验痛点全景整改，已本地验证合入）**；前序卡 225–233 全部本地验收闭环 |
| 前序已合入任务 | `tasks/234-openui-generative-ui-and-ux-polish-plan.md`（双 Root 3445 passed / 6 skipped 全绿，Thin Core 严格 0 变动，凭据复用 + 回收站删除 + 主题常驻 + 实体按钮 + OpenUI 引擎） |

Card 223 本地交付与走查闭合（2026-10-15/16，OpenCode goal 模式）：按 `docs/design-prototypes/IMPLEMENTATION-PLAN.md`（VESSEL-UI-2026-02）把「玻璃视觉 + 四栏工作台/审阅台」的 **P1–P8 全量落地到 `apps/web`**（`.tokens` 玻璃令牌层 → 玻璃外壳 → `Rail.tsx` 58px 图标轨 + `58px 232px 1fr` 网格 + 300px 审阅栏（真实 8 Tab 检视器）→ `PlanChecklist.tsx` 常驻计划清单 → `ComposerMeters.tsx` 四胶囊 + 常驻计量 → 修丑点 → `FEATURE-COVERAGE.md` 的 B1–B18 逐条核对 → 全矩阵 64 张截图）。随后用 `browser-skill`（独立 Agent Window，未借用用户标签页）做真实浏览器功能走查，修复 5 处缺陷，含阻断级一处：**Vite 8 代理默认 `changeOrigin: true` 改写 Host，令后端 `trustedOrigin()` 判为跨域、拦掉所有带 Origin 的写请求（403）** → `vite.config.ts` 改 `changeOrigin: false`。门禁四门顺序 exit 0，双 Root **3,037 passed + 6 skipped / web 340 passed**，`packages/core` **零改动**。证据 `evidence/sessions/2026-10-15-ui-landing/`（`PROOF.md`、`gallery.html`、`bsk-functional/FINDINGS.md`）；未验证项：真实 provider 联网走查、移动端真机。

Card 224 本地交付（2026-10-16 → 已升级至 **1.3.2-local**）：PDW `personal-dev-workflow` 由 1.0.0（`.agent-state` 控制器）适配为 1.3.1-local，随后升级到 **1.3.2-local**（完整 Skill 目录 + Node 运行器 + 项目级 `.pdw/` + 零安装入口 `pdw.ps1`）；`doctor` 实测 1.3.2-local，5 个角色全部 `ready`（scan/test-plan/review = OC + `workbuddy/deepseek-v4.1-flash`；implement = Codex `host-default`；planner = AGY `host-default`），包哈希逐项一致、`install` 防覆盖保护保持、夹具编排隔离 20/20；旧状态零改动并归档为 `evidence/pdw-migration-1.3.1/LEGACY-STATE.md`。迁移与回滚见 `evidence/pdw-migration-1.3.1/MIGRATION.md`（文件名仍带 1.3.1，内容对 1.3.x 同样适用）。**模型口径已于 2026-10-24 定案、2026-10-25 改指 doctor**：角色与写权限以 `AGENTS.md`「执行角色与模型路由」为准，当前模型与档位以 `pwsh pdw.ps1 doctor` 的 `effective_model` 为准（实现 = Codex `gpt-6.1-sol`/medium，只读三角 = OC `commandcode/deepseek/deepseek-v4.1-flash` `#high`/`#max`，planner = OC 同款 `#high`）；本段 1.3.2 的 `workbuddy` / `agy` 细节只作历史对照。

Card 222 本地交付与验收（2026-10-14，OpenCode goal 模式交付）：依据架构整改规范 ARC-10/ARC-11 与 UI 规范 UI-013/UI-015/UI-016/UI-017 一次性收官。契约层新增 `AgentInstanceSpec` / `TaskLease` / `TaskTreeNode` / `PermissionScope` 与单调收窄原语（`packages/shared/src/team.ts`）；`packages/application` 落地 `TaskTreeScheduler` 与 `TaskTreeRegistry`（依赖 DAG 就绪判定、租约 TTL 超时、父子取消级联、阻塞依赖取消、审批门禁、子结果归并、按**有效父作用域**逐级收窄），执行一律委托注入的 executor，**不存在第二套循环**；local-server 新增 `/api/tasks/tree`、`/api/activity/runs`、`/api/behavior/library`、`/api/behavior/compose`、`/api/sessions/:id/trace`；Web 新增团队任务树、跨项目活动与集中审批队列、交互式 Agent Studio Composer、结构化脱敏 Trace，全部中英双语 + 800px 响应式。ARC-11 交付故障注入四断点套件（对不可逆副作用计数永不复跑）、Behavior Golden Conformance（L0→L4 稳定性 / fail-to-compile / Verified 仅在有运行时证据时授予）、Compaction 100% 守恒断言。门禁：四门顺序 exit 0，双 Root **3,356 passed / 6 skipped** 全绿，`packages/core` 行修改 **0**，锁文件与 `package.json` 未变；离线 Chromium + CDP 实拍 8 张（中/英 × 桌面/800px）并存 `browser-capture-meta.json`。证据 `evidence/sessions/2026-10-14-card222/PROOF.md`（含 `REVIEW.md` 对抗评审与「不宣称」清单）。

Card 221 本地交付与验收（2026-10-14，OpenCode 交付 + Antigravity 验收）：依据架构整改规范（ARC-07）与 UI 规范（UI-014）落地 Behavior 语义 IR、五级兼容性阶梯与 Agent Studio 只读检查器。定义七大语义分类与五级兼容阶梯（`Importable → Renderable → Mappable → Enforceable → Verified`），增强编译期字段不可变、单调收窄、数组去重与来源溯源；未映射强制策略硬性抛出 `BehaviorCompileError`；落地 `/api/behavior/inspect` 端点并在 Web 端 Agent Studio 区域集成只读检查面板（中英双语 + 800px 自适应）。攻坚收口：按授权在 `HybridMemoryStore` 落地内存向量索引（热中位 18–24ms → 6.288ms）彻底消除并发环境性红，三大毫秒门禁稳健化为有界重测，离线 Chromium 实拍 6 张全量截图。门禁：定向测试 53+60 全绿，四大终态门禁顺序 exit 0，双 Root **3,296 passed / 6 skipped** 全绿，`packages/core` 行修改严格为 **0**。证据 `evidence/sessions/2026-10-13-card221/PROOF.md`。

Card 220 本地交付与验收（2026-10-13，Codex 交付 + Antigravity 验收）：依据架构整改规范（ARC-06/08/09）与 UI 规范（UI-011/UI-009）落地 Provider 能力协商契约与 Context 分层版本化缓存。定义三态 `detected | declared | unknown` 能力模型，调度前硬拦截不支持的强制约束（抛出 `CapabilityMismatchError`，零网络调用）；落地 Assembly / Provider Prefix / Projection / Token Estimation 四层缓存及依赖 Hash 失效；强化 Compaction 压缩中的任务目标、约束、最新指令、工具对偶与拒绝记录 100% 守恒；Web/Local-Server 透传能力与缓存状态并完成中英双语展示。门禁：定向单测 120 passed，最终全量四大门禁顺序 exit 0，双 Root **3,271 passed / 6 skipped** 全绿，`packages/core` 行修改严格为 **0**。证据 `evidence/sessions/2026-10-13-card220/PROOF.md`。

Card 219 本地交付与验收（2026-10-13，Codex 交付 + Antigravity 验收）：全量前端交互与真实无头浏览器（Playwright Chromium）走查测试。走查 77 项点击断言全绿，0 console errors，0 uncaught exceptions；发现并靶向修复会话切换历史消息丢失缺陷（WeakMap 投影与代际连接守卫）。门禁：全量双 Root **3,232 passed / 6 skipped** 全绿，`npx tsc -b` / `npm run typecheck:tests` exit 0，packages/core **0 变动**。证据 `evidence/sessions/2026-10-13-card219/PROOF.md`。

Card 218 本地交付与验收（2026-10-12，Codex 交付 + Antigravity 验收）：依据 `docs/plans/Vessel_Web_UI_UX_Improvement_Plan.md` (VESSEL-UI-2026-01) 落地 UI-P0 级 Agent 工作台体验。重构信息架构为 Workbench / Activity / Agent Studio / Settings 四大一级导航；首页集成 Project → Task → Start 就地任务启动器（带模型与权限直选 Pill，空输入校验与失败可重编草稿）；Ctrl+K 全局命令面板按系统操作/最近项目/活跃会话语义折叠分组，隐藏调试裸 ID 与长路径；视图定制与系统权限解耦；≤800px 移动端自适应为无障碍抽屉，焦点循环与 Escape 回位。门禁：Web 单测 34 文件 / 291 passed、Web typecheck exit 0、Web 打包（`-- --emptyOutDir false`）exit 0、全量双 Root **3,228 passed / 6 skipped** 全绿、12 张中英双语 Retina 截图全部刷新、packages/core **0 变动**、依赖锁无变化。证据 `evidence/sessions/2026-10-12-card218/PROOF.md`。

Card 217 本地交付与验收（2026-10-12，Codex 交付 + Antigravity 验收）：依据 `docs/plans/Vessel_Harness_Architecture_Improvement_Plan.md` (VESSEL-ARCH-2026-01) 落地 P0 级 ARC-01 至 ARC-05。定义不可变 Event Log 与 SessionProjection/RequestEnvelope 契约，Compaction 落地目标/安全拒绝/工具成对守恒断言；Behavior 编译期缺少强制策略引用时硬性抛出 `BehaviorCompileError`（Fail-to-compile）；Application/Engine 层强化 Run/Turn 预算限制（Token/Step/时间硬预算与 Cancel 确定性终态）；Runtime/Policy 落地参数绑定型单次 `ExecutionPermit` 凭证，审计 EffectJournal 防重放。门禁：定向测试 330 passed，affected CLI 6 passed，`tsc -b` / `typecheck:tests` / 全量 `npm run test:all` 双 Root **3,219 passed / 6 skipped** 全绿。`packages/core/src` 源码 **0 行修改**，经人类授权仅修改 3 个 core 测试 fixture 注入最小 policy stub（+3/-3 lines）。证据 `evidence/sessions/2026-10-12-card217/PROOF.md`。

Card 215 本地交付与验收（2026-10-11，OpenCode 交付 + Antigravity 验收）：后端新增 `normalizeProviderInput` 归一化兼容器（字典型 `models` / `options.baseURL|apiKey` 嵌套 / `npm` 协议声明），新增 `POST /api/providers/pull-models` 端点与 Web「Pull models」按钮，供应商删除时清理 `secretRef` 凭据，后端**具体错误码透传**（不再一律 `provider_request_failed`）并由前端按码本地化展示，术语规范化为 `OpenAI 兼容 (OpenAI Compatible)` / `Anthropic (Claude)` / `API Key`。门禁：定向测试 27（后端）+ 35（前端含 i18n）全绿、双 Root **3155 passed / 6 skipped**、`tsc -b` / `typecheck:tests` / web typecheck / web build（`-- --emptyOutDir false`）全 exit 0、`packages/core` **0 变动**。纯本地、未提交/推送、无删除、未驱动外部 Agent。证据 `evidence/sessions/2026-10-11-card215/PROOF.md`。

Card 215 待办登记（2026-10-11）：解决用户提出的模型自动拉取缺失、协议/密钥术语不符合开发者习惯、带有 secretRef 的既有供应商无法删除、以及用户真实生态 Schema（workbuddy 嵌套 options 与字典型 models）被后端强行拦截报错等重大问题。任务卡已落盘。

V2.6 启动背景（2026-10-11）：解决 Web 界面中英文混杂、翻译生硬机翻，以及后端未暴露 ProviderStore 导致用户无法在前端添加或切换真实模型的重大可用性痛点。五张任务卡 210–214 已规划并落盘。后台历史 5678/5173 服务已安全停止，端口已释放。

V2.6 最终验收（2026-10-11）：210–214 按序闭环；全域强类型中英字典、供应商安全 API/探测、可视化设置、真实模型创建与动态切换交证。最后源码/测试编辑后的 root 268 文件 / 2869 passed + 6 skipped，Web 33 文件 / 277 passed，合计 3146 passed；七项终态门禁全部 exit 0。独立评审 PASS，实际浏览器中英/800px、配置引导/发现/保存/创建/切换、历史与输入保全通过；出站 fixture-a/2 → fixture-b/4。core 0、125 保护哈希及根锁未变；无删除、外部 Agent、提交/推送/发布。证据 evidence/sessions/2026-10-11-v2.6/PROOF.md、accepted-gates.json、completion-audit.json。Mission completed，workers 0；预览已停止。不自动续新路线。内部 hub 身份/未知端点限制/未定价估算见 card213-proof.md；不声称实时供应商或账单验证。早期预览临时项目索引记录保留，最终预览已明确隔离 ProjectRegistry。

V2.5 最终验收（2026-10-10）：205–209按序闭环。单Hunk采纳/丢弃/回退与双视图SSE同步、真实记忆规则命中与流式折叠、命令面板/键盘导航、新会话权限预设、离焦注意力/原生合成音/持久静音均交证。最终root266文件/2832passed+6skipped，Web29文件/251passed，合计3083passed；七项最终门禁全部exit0，均在最后源码/测试编辑后执行。独立评审发现的字节损坏与命令导致busy不退出已修复并复验。真实浏览器桌面/800px通过；原生通知与音频按离线Mock验收，不声称OS实际送达或可听。core0、保护哈希与根锁不变；无删除、外部Agent、提交/推送/发布。证据 `evidence/sessions/2026-10-10-v2.5/PROOF.md`、`final-gates.json`、`completion-audit.json`。历史服务已停止。

V2.4 最终验收与合入（2026-10-10）：200–204本地完成并提交 `dd8e72c`。四类Widget IR+双向SSE/HTTP、React就地组件、四Tab Docked Inspector、CLI状态栏/ANSI与方向键审批全部交证。最终双Root root263文件/2808passed+6skipped、Web22文件/201passed，合计3009passed；tsc、测试类型、Web类型、安全Web构建、help全部exit0，均在最后源码/测试编辑后运行。Web桌面/800px与离线TTY冒烟通过，独立评审PASS；core0、33保护哈希不变、根依赖锁不变。未推送/发布，无外部Agent。证据 `evidence/sessions/2026-10-09-v2.4/PROOF.md`。本地服务 `task-557` 于 `http://127.0.0.1:5678` 正常守护运行中。

V2.1 执行偏差：189 执行器三次默认 Vite 构建清空生成 `apps/web/dist`，违反任务删除纪律，已记录，不能声明红线全部遵守。后续 Web 构建必须加 `-- --emptyOutDir false`。为验证锁文件，本轮将旧 `node_modules` 完整移动到 `.tmp/2026-10-07/node_modules-before-epic191-npm-ci` 后执行 `npm ci`（exit 0）；备份保留，不清理。阶段性能实测本仓 1673 文件 warm 中位约 1285ms，见 `phase190-benchmark-final.log`，不得擅自降低验收标准。

V2.2 恢复点：四卡已闭环，所有门禁与 CLI 冒烟完成；packages/core 0 改动，依赖锁不变，未驱动外部 Agent，未提交/推送/发布。只支持无依赖预编译 JS Mod 子集。V2.3 已获新授权；既有未提交改动保留，独立基线哈希见 `evidence/sessions/2026-10-08-v2.3/baseline.json`。

V2.3 最终验收（2026-10-08）：196–199已completed，blocked解除。用户再次批准197完整递归引用/类型驱动刷新指标mean≤15ms、peak≤25ms；scoped12项图+4项工具全绿，独立12次真实更新mean10.767ms/peak21.405ms、精确率100%。最终test:all root258文件/2780passed+6skipped、Web20文件/177passed，合计2957passed/6skipped；tsc构建、测试类型、独立Web测试、带emptyOutDir=false的生产构建全部exit0，均在最后源码/测试编辑后运行。199真实组合Red1→Green0/Regression0、两次完成拒绝、SHA-256证明有效；198剪枝82.56%，静态前缀/任务/最近三轮保护。SQLite修复已通过最终全root，原5ms断言不变；core0、基线缺失0。机器Mission completed、workers0。证据 `evidence/sessions/2026-10-08-v2.3/PROOF.md`、completion-audit.json与accepted15-*.log；先前blocked检查点见PROOF-before15.md，失败日志/依赖备份全保留。纯本地未提交/推送，无外部Agent。下一步等待新任务授权，不自动推进新路线。

V2.1 历史恢复点：PowerShell session **47315 已完成 exit 0**，最后 source 编辑后的五项 accepted 门禁全部通过；根 236 文件 / 2634 passed / 6 skipped，Web 20 文件 / 177 passed。交付文件收齐后的最终性能日志 `accepted-final-fingerprint-benchmark.log` 通过 2026-10-08 人类批准的新指标。所有工作器、测试与门禁进程均结束；旧 failed/frozen/renewed/resumed 记录只作历史，未删改。SQLite <5ms 保持原标准；指纹原 <25ms 被人类明确替代，不再是阻断。

## 1. 治理与门禁（改动前必读）

- **本仓只做三件事**：提交 → PR 审核 → CI 测试。**不创建 GitHub Release、不向 npm 发布新版本**（决策点 21）。
- `main` 受规则集 `protect-default-branch`（id **23645929**）保护，必需检查 3 条：
  `build (ubuntu-latest, 22)`、`build (windows-latest, 22)`、`identity-guard`；另开启 strict（分支须与 `main` 同步）。
- **CI 触发**：`push` 只对 `main`；PR 走 `pull_request`；**tag 推送不触发 CI**（tag 只是提交标记）。
- 维护者本人仍在 `bypass_actors`（`bypass_mode: always`）里——**这是刻意保留的**：这样合并可以用"本地中性身份合并 + 普通推送"（main 的作者名保持统一），并保留一条应急直推通道。要改成硬墙的命令见审计文档 §F。
- **合并路径（推荐 A）**：建分支 → 推送 → `gh pr create` → 等三条必需检查绿 → 本地 `git merge --no-ff` → `git push origin main`。GitHub 会正确标记 PR 为 MERGED，且合并提交署名中性身份。
  - 网页端一键合并也可用，但合并提交会以账号提交身份 `xuanchen` 署名（网页端用 noreply 地址，**不会**带回被移除的邮箱）。

### 本机安全门禁会拦掉这些命令（不是权限问题，别再试）

`git push --force` / `--force-with-lease`（**含分支**的 force push）、`git update-ref -d`、`git gc --prune`、`git reflog expire`、`git restore --staged`、PowerShell `Remove-Item -Recurse -Force`。
门禁**预先扫描整条命令**：命令里出现被禁模式，整条（含前面的 `git add` / `commit --amend`）都不执行。
⇒ 需要 force push / 删 ref / 清对象的动作，**只能由维护者在自己终端执行**。

## 2. 最近做了什么（日志索引）

| 时间 | 内容 | 权威记录 |
|---|---|---|
| 2026-09-27 | 仓库转 Public；**全面脱敏**（工作树 142 文件 + **两次**全历史改写）；GitHub 治理定型（决策点 21）；身份守卫上线 | `evidence/sessions/2026-09-27-desensitization-and-governance.md` |
| 2026-09-27 | 残留暴露面逐项实测；三项依赖升级；规则集 bypass 重新判断后保留 | `evidence/sessions/2026-09-27-residual-exposure-audit.md` |
| 2026-09-28 | 文档与代码对齐：4 处死链、163–167 陈旧状态行、2 处作废的发布待办 | `DEV_LOG.md`（续 6/续 7）、上述审计文档 §H/§I |
| 2026-09-27 | 决策点 19（包管理器锁定 npm）、20（个人信息边界与一次性历史改写）、21（不发布版本） | `docs/DESIGN-DECISIONS.md` |
| 2026-09-25 | V1.3 双向子 Agent 网关体系交付合入（卡 163–167） | `CHANGELOG.md` `[Unreleased]`、`tasks/167-*.md` |
| 2026-10-12 | Archify 架构可视化落地（5 张分层可交互图 → `docs/diagrams/`）；修复 `ARCHITECTURE.md` §6.1 等文档包清单漂移（13→14，补 `engine`/`application`） | `tasks/216-archify-architecture-visualization-and-doc-drift-repair.md`、`DEV_LOG.md`（2026-10-12） |
| 2026-10-16 | **PDW 工作流适配：personal-dev-workflow 1.0.0 → 1.3.1-local**（Skill 整体替换 + 根 `pdw.ps1` + 项目级 `.pdw/`；`doctor` exit 0；防覆盖保护保持；旧 `.agent-state/` 状态与预算**零改动**并归档） | `tasks/224-pdw-1.3.1-local-adoption.md`、`evidence/pdw-migration-1.3.1/MIGRATION.md`、`evidence/pdw-migration-1.3.1/LEGACY-STATE.md` |

**过程日志**逐条在 `DEV_LOG.md`（2026-09-27 有续 1–续 7；最新一条 2026-10-12）。

## 3. 未完成清单

### 3.1 需要维护者本人做（Agent 做不了或不该代做）

| # | 事项 | 为什么要你做 | 状态/材料 |
|---|---|---|---|
| U1 | 发 **GitHub Support 工单**：清理 `refs/pull/*`（22 条）指向的旧对象 | Agent 无法以你名义对外提交 | 英文草稿已写好：审计文档 **§A-1**，可直接粘贴 |
| U2 | 决定 npm 元数据残留是否也开工单 | 同上；且 `_npmUser`/`maintainers` 仍是旧邮箱、已过 unpublish 72 小时窗口 | 审计文档 **§B**；倾向"接受单点残留"（本仓已不发布新版本，不会新增暴露） |
| U3 | 规则集 `bypass_actors` 是否收权 | 会改变你的合并习惯（见 §1 的取舍） | 命令在审计文档 **§F** |
| U4 | 清游离提交 `5092ed4`（可选） | 需要 `git gc --prune`，被门禁拦；内容仅为一次提交信息文本，无个人标识 | — |
| U5 | **真实 `--live` 跨 harness 基线**（若要跑） | 会驱动本机 `dsh` / `opencode` / `codex` / `claude` / `pi`，消耗你的配额 | `tasks/149`/`153`；**必须逐次显式授权**，`npm run bench:conformance -- --live` 永不自动跑 |

### 3.2 Agent 可以推进的（下次自主工作的建议清单）

| # | 事项 | 入口 |
|---|---|---|
| A1 | **产品边界**：Epic 183 已本地实现原生沙箱；Windows ACL 预配置/真机验收、macOS 逃组生命周期仍需按交付记录判断；POSIX helper 缺失已改为默认拒绝（卡 287，显式放行 `VESSEL_ALLOW_UNSANDBOXED=1`）；`--live` 外部基线未做 | `README.md` 状态段、`docs/SANDBOX-WINDOWS.md` |
| A2 | 环境补齐项：`release-report` 刷新（需配额确认）、Packaging gate 重跑（需 dist）、字面 3h 墙钟 soak | `tasks/README.md` 未闭合段、`docs/V1.6-STABLE-CHECKLIST.md` |
| A3 | Windows runner worker 启动抖动：**若再出现第二次**就立卡（可选缓解：给 CI 设 `maxWorkers`） | 审计文档 **§C**（已定义触发条件） |
| A4 | 文档诚实化（同类清扫已完成一轮，若有新发现同法处理） | 审计文档 §H/§I 的做法：区分「历史快照」与「面向行动的清单」 |

#### 待研究（未立项，需先拍板，不要自动开工）

- **Harness² 吸收评估**（2026-10-20 完成分析，未立项）。对象是 Google Research 的递归式 agent harness 框架；已完成五维只读分析与 P0/P1/P2 吸收清单，结论是只吸收方法论（判分三态不计 0、读边界防泄漏、harness 指纹、工具链门禁、预算合流），不搬其 Python 代码与提示词原文。开工前需用户确认从哪一项开始；P0-1 涉及契约字段变更，会连带五个外部 adapter 与 release gate 口径，不宜顺手做。材料：`docs/HARNESS2-ABSORPTION-ASSESSMENT.md`（结论与落点）、`docs/HARNESS2-AGENT-BRIEF.md`（接手 Agent 的对齐提示词）。

### 3.3 已知边界（不可能清掉的，别再尝试）

- **GitHub PR 页面**仍有旧身份：#12–#16、#17–#20 共 **9 个 PR** 的提交列表显示被移除的邮箱。PR 不能删除（只能关闭），其提交列表由 PR 自身持有，**不依赖 git 对象**——即使 Support 清了对象，页面大概率仍显示。
- **npm registry 元数据**里的 `_npmUser` / `maintainers` 是发布当时的快照，改文件改不到。
- **服务端旧对象**在 GitHub GC 之前可能仍可按 SHA 取到（客户端无能为力）。

## 4. 验证命令（接手先跑一遍）

```powershell
npm ci                          # 可复现安装；锁文件与 package.json 不一致会直接失败
npx tsc -b tsconfig.json        # 类型 + 编译
npm run typecheck:tests         # 测试文件类型检查（非 composite）
npm run test:all                # 全量 = 根 + apps/web 两个 root
npm run -w @vessel/web build # web 生产构建（peer 不一致只有构建会暴露）
bash scripts/identity-guard.sh  # 身份守卫（Git Bash / WSL / Linux / macOS 可跑）
gh pr checks                    # 某个 PR 的必需检查
```

预期：以上全部 exit 0；`identity-guard` 打印 `no denylisted commit identities in this history`。

> 已知抖动：Windows runner 上偶发 `Worker exited unexpectedly with exit code 3221225794`（`0xC0000142`）。**与代码无关**——同提交重跑即绿（已有实例，见审计文档 §C）。处置：`gh run rerun <id> --failed`。**再出现第二次就立卡。**

## 5. 严格纪律（越界会被机器拦下或造成不可逆后果）

- **删除**：Agent 在仓库内删除仍走系统回收站；例外一仅限测试自建、位于 `os.tmpdir()` 下的临时目录。产品运行时例外二见 `docs/DELETION-AND-RETENTION.md`：用户数据先进应用 trash，临时运行文件按所有权条件直接删；默认 7 天，`VESSEL_TRASH_TTL_DAYS=0` 关闭 serve/daemon 自动 purge（含已有过期条目），不禁用手工 `vessel trash purge`。CLI 为 `vessel trash list`、`restore <id>`、`purge [--dry-run] [--older-than <days>]`（均支持 `--root`）；暂存失败仍为 `session_recycle_failed`。卡 346 按用户修订验证伪造元数据不影响根外内容；purge 删除目标仅为根内 `root/id`，restore 在 mkdir 前校验根外绝对路径、无链接父链与 session 的 `.harness/sessions/<id>` 布局。定向门禁为 `node node_modules/vitest/vitest.mjs run packages/application` 与 `node node_modules/vitest/vitest.mjs run apps/local-server`；类型/全量门禁由协调者统一跑。
- **不改写已推送历史**：禁止 force push。唯一书面例外是 2026-09-27 的一次性全历史脱敏（决策点 20），已用完。
- **不自动驱动本机其它 agent**（`dsh`/`opencode`/`codex`/`claude`/`pi`）：需逐次显式同意。
- **提交身份**：本仓 `user.name`/`user.email` 已设为中性（`Vessel Contributors <vessel@users.noreply.github.com>`）。**换机器或换 Agent 后先确认这两项**——历史上正是因为改写后新提交从本机配置取回真实身份，才把它重新带进了公开历史（决策点 20 的事故记录）。
- **暂存文件**：需要先落文件再入库的中间产物放**当天日期目录**并用点号前缀（`.tmp-*`），不要用系统临时目录。

## 6. 从哪里接手（阅读顺序）

### 冷启动三步（新会话先跑，自证环境）

```powershell
git log --oneline -3   # 确认在 main、认准最新提交
git status -sb         # 应为干净（出现未提交改动 → 先问维护者）
npm ci                 # 依赖与锁文件一致；随后可跑 §4 的完整门禁
```

> **执行模型约定**：角色与写权限见 `AGENTS.md`「执行角色与模型路由」；当前模型与档位以 `pwsh pdw.ps1 doctor` 的 `effective_model`（Codex 角色的档位看并列的 `reasoning_effort`）为唯一事实源，协调者用哪个模型不锁定。截至 2026-10-25 实测：实现角色为 Codex `gpt-6.1-sol` / `medium`，只读角色为 OC `commandcode/deepseek/deepseek-v4.1-flash`（`#high` / `#max`）。
> 若你要替换维护者的角色继续用 CLI 之外的 provider，注意**本仓不发布版本**，也不要顺手引入 pnpm/bun/yarn 锁文件（决策点 19）。

1. 本文件（现状 + 未完成清单）。
2. `AGENTS.md`（规则、硬性约束 10 条、禁做清单）。
3. `docs/DESIGN-DECISIONS.md` 决策点 **19 / 20 / 21**（包管理器、个人信息边界、不发布版本）。
4. `tasks/168-desensitize-and-public-hygiene.md`（脱敏与治理的完整范围与证据）。
5. `evidence/sessions/2026-09-27-desensitization-and-governance.md`（会话记录：§7 八个自省错、§8 未决、§10 接手入口）。
6. `evidence/sessions/2026-09-27-residual-exposure-audit.md`（残留暴露实测、依赖判断、Support 工单草稿）。
7. `DEV_LOG.md`（过程日志）、`CHANGELOG.md`（版本故事）。

- 2026-10-01：Epic 174（V1.5 / 170–173）本地实现及全部门禁通过，未提交。交付入口：docs/V1.5-IMPLEMENTATION-NOTES.md、tasks/174-epic-industrial-resilience-and-teams-mesh.md；根 2398 passed + 6 skipped / Web 141 passed，既有 task 169 改动保留。
- 2026-10-01（续）：Epic 179（V1.6 工业级团队工作台与常驻守护网格）立项启动：
  - 规划文档：`docs/V1.6-ROADMAP.md`，拆解任务卡 175–179；
  - 阶段一（任务 175：Web 交互式 DAG 画布与方案预审）已由 Codex 交付并测试全绿（`TeamDagCanvas.test.tsx` 5/5, `teamStageApi.test.ts` 5/5，`tsc -b` / `typecheck:tests` / `vite build` 均 exit 0）；
  - 因上游模型额度与算力限制，推进在阶段二（任务 176：后台常驻 Daemon 与系统通知）前挂起暂停；
  - 机器状态保存在 `.agent-state/run-state.json`，新会话开启后可通过 `/resume` 或直接执行阶段二无缝接管。
