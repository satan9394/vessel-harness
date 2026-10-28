# 任务卡 354: 看板对账（170–181、183 的「待验收」）

- Status: 已完成对账（2026-10-27）：13 张卡中 6 已验收、2 无法确认、5 待用户验收；append-only 与 README 行替换已由协调者复验
- PDW task: none（交接单 `tasks/prompts/codex-handoff-2026-10-27-wave2.md` 的 T8，`gpt-6.1-terra`/medium，复核 low）
- 来源：交接单终版 T8；卡 340 只清了 248–279，这批 V1.5/V1.6 从没对过账

## 1. Goal

`tasks/README.md` 路线层表里 170–181 仍写「本地全门禁通过；待验收」，183 同批，卡面停在「待用户验收」。
它们都是 2026-10-02/03 的交付，后续 epic 已经覆盖过一部分。逐张核一次：**在当前 HEAD 上**还能不能复验，
不能就写清缺什么。目标不是把它们都标成已验收，而是让看板说真话。

## 2. 要做的事

1. 逐张读卡（170–181、183），列出每张卡的交付主张。
2. 对每条主张在当前 HEAD 找证据：源码还在吗？测试还在吗？只跑**定向**测试（不跑全量门禁）。
3. 每张卡**末尾追加一行**结论，不改正文：
   - `已验收（2026-10-27 对账，依据 <测试命令 exit 0 / 文件:行>）`
   - `仍待用户验收（缺 <具体项>）`
   - `无法确认（查过：<列出的文件与命令>）`
4. 更新 `tasks/README.md` 路线层对应行；182/183 的既有结论不动。
5. 报告给「卡 → 结论 → 依据」对照表。

## 3. Not Doing

- 不改卡正文、不删卡、不合并卡。
- 没有本次证据不写「已验收」；宁可写「无法确认」并列出查过什么。
- 不跑全量门禁、不 commit。
- 不动 182（本卡不覆盖 182 的结论）。

## 4. Acceptance

1. 12 张卡（170–181、183）各有结论，且每条结论都有可复验的依据（命令 exit 或 `文件:行`）。
2. 全部是**末尾追加**：`node scripts/check-append-only.mjs <这些卡>` exit 0（无删除行）。
3. `tasks/README.md` 的路线层对应行与卡内结论一致。
4. 没把「无法确认」写成「已验收」。

## 5. Blast Radius

`tasks/170…181`、`tasks/183` 的末尾、`tasks/README.md`。源码零改动。

## 6. Expected Evidence

`check-append-only` 的 exit、`git diff --stat -- tasks`、对照表（卡 → 结论 → 依据）。

## 7. Result

2026-10-27 T8 对账完成；原始韧性门禁失败保留，未把它改写成已验收。范围实际为 **13 张**（170–181 共 12 张，加 183），正文「12 张」保留原貌。实现路线：`gpt-6.1-sol` / `medium`，Fast 关闭；依据交接单 §1「跨卡核证据/证据冲突判断」及协调者本轮指定。额度中断后恢复原路线继续；未调用其它 agent CLI、未嵌套派生。只追加历史卡 EOF、替换 README 对应行、填写本 Result；无产品/测试源码改动，无全门禁、commit/push。

原始日志根：`C:/work/AppData/Local/Temp/vessel-wave2-x0Tnhs/`。每份测试日志含完整命令、原始 stdout/stderr、退出码。以下均从仓库根执行；本次定向只建立所列本地契约证据，不代表重跑历史全门禁或撤销历史验收。

| 标识 / 日志 | 实际命令 | 本次结果 |
|---|---|---|
| A / `t8-v15-a.log` | `node node_modules/vitest/vitest.mjs run packages/context/src/compaction/adaptiveCompaction.test.ts packages/tools/src/mcp/boundedStdio.test.ts packages/tools/src/mcp/lazyProxy.test.ts apps/cli/src/mcp/mcpCommands.test.ts packages/application/src/mcp/connections.test.ts` | exit 0；5 文件 / 58 passed + 2 skipped |
| B / `t8-v15-b.log` | `node node_modules/vitest/vitest.mjs run packages/agents/src/team/dag/dagScheduler.test.ts packages/agents/src/team/teamRouteSnapshot.test.ts packages/agents/src/team/teamApproveAndRun.test.ts packages/core/src/session/streaming/chunkedSession.test.ts benchmarks/runners/src/conformance/resilience/longSessionResilience.test.ts` | **exit 1**；4 文件通过 / 24 passed；韧性 5 skipped；`longSessionResilience.test.ts:51` beforeAll `Hook timed out in 30000ms`，清理 `ENOTEMPTY .../archive` |
| C / `t8-v16-storage-tools.log` | `node node_modules/vitest/vitest.mjs run packages/tools/src/execution/boundedOutput.test.ts packages/tools/src/execution/selfHealing.test.ts packages/tools/src/execution/pipeline.test.ts packages/memory/src/sqlite/sessionIndex.test.ts packages/memory/src/sqlite/ftsSearch.test.ts` | exit 0；5 文件 / 44 passed |
| D / `t8-v17.log` | `node node_modules/vitest/vitest.mjs run packages/tools/src/execution/sandbox/windowsRestricted.test.ts packages/tools/src/execution/sandbox/platformSandbox.test.ts packages/memory/src/sqlite/hybridSearch.test.ts packages/memory/src/sqlite/reflectiveRules.test.ts packages/context/src/builder/reflectiveContext.test.ts` | exit 0；5 文件 / 34 passed |
| E / `t8-web.log` | `node node_modules/vitest/vitest.mjs run --root apps/web src/components/team/TeamDagCanvas.test.tsx` | exit 0；1 文件 / 8 passed；明确使用 Web 独立 root |
| F / `t8-v16-ui-daemon.log` | `node node_modules/vitest/vitest.mjs run apps/local-server/src/teamStageApi.test.ts apps/local-server/src/daemon/authMiddleware.test.ts apps/local-server/src/daemon/daemonLifecycle.test.ts apps/local-server/src/daemon/tray.test.ts apps/cli/src/daemon/daemonCommands.test.ts` | exit 0；5 文件 / 50 passed |
| 额外诊断，非验收 / `t8-resilience-isolated.log` | `node node_modules/vitest/vitest.mjs run benchmarks/runners/src/conformance/resilience/longSessionResilience.test.ts --hookTimeout 120000` | exit 0；5 passed，26.17s。此探针在协调者要求不重试消息到达前已派发；提高 CLI timeout 不替代 B 的原始失败，不据此提升 173/174，不再重试 |

| 卡 | 本次结论 | 当前源码及本次测试依据 |
|---|---|---|
| 170 | 已验收（本地契约） | `packages/context/src/compaction/adaptiveThreshold.ts:8`、`overflowRecovery.ts:15`；A：公式/CJK/分类/一次恢复/超限终止 |
| 171 | 已验收（mock/CLI 契约） | `packages/tools/src/mcp/BoundedStdioTransport.ts:13`、`LazyMcpClientProxy.ts:4`；A：进程图回收、lazy/静态清单、disable/enable/装配；不冒充真实 Windows 时延 |
| 172 | 已验收（本地契约） | `packages/agents/src/team/dag/DagScheduler.ts:9`、`TeamRuntime.ts:104`、`:139`；B 中 DAG/route/approve 文件通过；整批 exit 1 明确保留 |
| 173 | 无法确认 | `packages/core/src/session/streaming/ChunkedSession.ts:24`；B 中 archive 通过，但韧性 `beforeAll:51` 默认 30 秒 timeout 与 ENOTEMPTY；不得用额外放宽 timeout 探针覆写 |
| 174 | 无法确认 | 对应 170–173 实现/测试均在；A 通过、B 韧性失败，缺原始韧性门禁通过证据；历史可选 archive/mock 原生限制沿用 |
| 175 | 仍待用户验收 | `apps/web/src/components/team/TeamDagCanvas.tsx:5`、`TeamStagedBanner.tsx:5`、`TeamNodeDrawer.tsx:29`；`apps/local-server/src/teamRoutes.ts:74`；E 8 + F 50（包含 API）通过；本次无真实浏览器复验，历史浏览器记录 `docs/V1.6-IMPLEMENTATION-NOTES.md:58` 保留 |
| 176 | 仍待用户验收 | `apps/cli/src/daemon/daemonCommands.ts:9`、`apps/local-server/src/daemon/daemonLifecycle.ts:169`、`authMiddleware.ts:5`、`notifications.ts:7`；F 通过；缺真实终端关闭后的 daemon 存活及原生 tray/toast，本次仅 mock/HTTP 契约 |
| 177 | 已验收（本地契约） | `packages/tools/src/execution/boundedOutput.ts:33`、`selfHealing.ts:51`；C 通过，包含实际 Registry/Executor 路径、UTF-8、磁盘完整性、取消/策略/副作用不重放 |
| 178 | 已验收（本地契约） | `packages/memory/src/sqlite/SessionIndexStore.ts:77`、`:90`；C 通过：WAL/NORMAL、分页/增量、JSONL 重建、FTS 与本机 warm 延迟门槛 |
| 179 | 仍待用户验收 | 175–178 均有当前源码和 C/E/F 通过证据；继承 175/176 本次真实浏览器/桌面缺证边界，不把历史 browser checkpoint 改成未验证 |
| 180 | 仍待用户验收 | `packages/tools/src/execution/sandbox/windowsRestricted.ts:28`、`platformSandbox.ts:40`；D 通过；`docs/V1.7-IMPLEMENTATION-NOTES.md:21` 的 Windows ACL/Low Integrity 真机及 macOS 逃组边界仍在；缺失 helper 已演进为默认拒绝 |
| 181 | 已验收（本地契约） | `packages/memory/src/sqlite/HybridMemoryStore.ts:42`、`:214`、`:261`；`packages/context/src/builder/Builder.ts:231`；D 通过：RRF/向量/规则重建与有界不可信 user-level memory 注入，warm <15ms 本机断言 |
| 183 | 仍待用户验收（仅当前真机边界） | D 通过；继承 180 真机边界。README 已有「已合入（2026-10-03 本地验收）」逐字保留，182 同样未动；本追加不撤销历史本地验收 |

核证据结论：6 卡本地契约已验收（170/171/172/177/178/181），2 卡无法确认（173/174），5 卡仍待用户验收（175/176/179/180/183）。历史全门禁记录已查 V1.5/V1.6/V1.7 implementation notes；本轮只运行定向，不生成新的全门禁声明。

文档完整性：`node scripts/check-append-only.mjs` 后明确传入 13 个历史卡完整路径（170–181、183，README 排除），**exit 0** / 每卡 +2 -0，见 `t8-append-only.log`（含原始完整命令）。以 `baseline.json.originals` base64 解码逐卡对比 task-start 原字节前缀，**13/13 PASS / exit 0**，见 `t8-prefix-preservation.log`；README 只替换相关行，182/183 行与 task-start 相同。`git diff --stat -- tasks` 原始工作树统计另存 `t8-tasks-diff-stat.log`，包含其它任务既有脏改动，不把它算作本卡产物。T8 结束后允许 T11 串行接手 README；本卡不修复产品或失败门禁。

独立复核：`gpt-6.1-terra` / `medium`，AC1–4 PASS；独立核对 13 卡原字节前缀、354 Result 前正文、README 的 13 处表格行替换与 182/183 原有结论。原始失败及额外诊断均已披露，无阻塞性夸大。复核通过后才启动 T11 并移交 README 写权。

#### 协调者验收（2026-10-27，独立复跑）

- 我自己跑了 `node scripts/check-append-only.mjs`（13 张卡完整路径）：**每卡 +2 / −0，exit 0**，与自述一致；`tasks/README.md` 的 13 处是表格行替换，不在 append-only 检查范围内，这一点卡里写明了。
- 抽查两张卡的实际追加内容（170、183）：170 的结论带源码 `path:line` 与定向测试口径；183 明确「继承 180 的真机边界、不撤销历史本地验收」，没有把「无法确认」写成「已验收」。
- **本卡不是「13 张全部已验收」**：6 已验收（本地契约）、2 无法确认（173/174）、5 仍待用户验收（175/176/179/180/183）。看板状态按这个记，别被标题误导。
- 全量门禁 17 步全绿（本轮不因对账改动产品代码）。
