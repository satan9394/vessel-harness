# 会话交接 · 2026-10-27（删除与保留 / 看板对账 / Codex 交接）

> 给下一个会话用。只写状态、指针和没做完的事；过程与聊天记录不复述。
> 新会话开场请按顺序读：`HANDOFF.md` §0 → 本文件 → `tasks/prompts/codex-handoff-2026-10-27-final.md`。

## 1. 位置与工作区

- 分支 `main`，HEAD `40cd6a9`（未提交任何新改动）。
- 工作树有 **73 项未提交**：本轮新增的卡与文档、以及 341/343/345a 三个已验收的代码改动。没有 commit、没有 push。
- 当前**没有**后台任务在跑：无 `pdw.mjs run`、无 vitest、无 `vessel serve`；Codex 应用里可能还有会话在跑 T1–T11，新会话动手前先 `git status` 确认没人正在写。

## 2. 今天完成并已验证

| 项 | 产物 | 验证 |
|---|---|---|
| 卡 340 看板收口 | 25 张卡落「已验收」+ README/HANDOFF 同步 | 全量门禁 17 步全绿（当次 3596 passed + 6 skipped，web 519） |
| 卡 341 构建命令 | `apps/web` 的 `build` 内置 `--emptyOutDir false`，新增 `build:clean`；七份规范性文档改写 | 我实测 `npm run -w @vessel/web build` exit 0、哨兵 `dist/.keep-probe` 前后都在；`tsc -b` / `typecheck:tests` 0 |
| 卡 343 回收原语 | `packages/shared/src/deletion/recycle.ts` + 四处调用点迁移 | 我复跑 shared/runtime/local-server/migrate 四组 + 全量门禁；**review 角色未跑成**（两次 blocked，原因是我契约与既有事实冲突） |
| 卡 345a 暂存区 | `packages/application/src/deletion/trash.ts` + 24 条单测 | 我复跑 application：35 文件 / 299 passed + 2 skipped；两条 tsc 0 |
| 卡 347–349 | Codex 项目级子 Agent、PDW 路由适配、失败归因规则 | 他人完成，已在 README/HANDOFF 登记 |

## 3. 正在等：Codex 应用执行终版交接单

`tasks/prompts/codex-handoff-2026-10-27-final.md` 有 11 项（T1–T11），每项写死了实现/复核子代理的模型与思考深度，分三波。当前已知进度：

- **T2（卡 344）** 中途问过一次类型冲突：`LoopEngine.ts:95` 要求 `Promise<void>`，与 `dispose` 返回结构化结果不兼容。已授权「只放宽这一行返回类型」，并把它补进了交接单的允许清单；同时建议在 `workspace.ts` 导出 `DisposeResult` 供引用。
- T1、T3–T11 的完成情况以 Codex 报告为准，收到后逐项复跑再落卡。

## 4. 门禁现状与已知 flake

- 2026-10-27 全量：17 步里 16 步绿，`local-server` 因 `profileParity.test.ts > delete returns the same ordered fields`（`expected 2 to be 0`）挂了一次；单跑 4/4 绿、整段重跑 26 文件 / 298 绿。判定为隔离/时序问题，已立 T5 去查，**不是**当次改动引入的回归。
- 数字口径：根 329 文件 / 3602（3596 passed + 6 skipped），web 58 / 519，离线 conformance 25/25。

## 5. 下一步顺序

1. 收 T1–T11 的报告 → 每项按卡复跑定向测试（只认自己跑出来的数字）→ 写进卡与 `tasks/README.md`。
2. 全部落地后跑一次 `pwsh -NoProfile -File scripts/gate-batched.ps1`。
3. 卡 346 收口（文档一致性、跨平台矩阵、三档回滚说明）——这项工作**没有**交给 Codex。
4. 是否 commit 由维护者决定；当前 73 项未提交。

## 6. 关键文件指针

- 交接单（执行指令）：`tasks/prompts/codex-handoff-2026-10-27-final.md`
- 删除与保留设计：`docs/DELETION-AND-RETENTION.md`；规则依据：`docs/DESIGN-DECISIONS.md` 决策点 24
- 规则文件：`AGENTS.md` 的「删除铁律」第二处书面例外
- 卡：`340`（看板收口）、`341`（构建命令）、`342`（状态栏）、`343`（回收原语）、`344`（F6 所有权）、`345`（暂存区，含 345a/b/c）、`346`（收口）
- PDW 口径：`docs/PDW-LOCAL.md`；看板：`tasks/README.md`

## 7. 今天踩过的坑（新会话别再踩）

- **别用 PowerShell 双引号包带反引号的 Node 正则去改文件**：反引号会被 PowerShell 当转义吃掉，把整份 Markdown 截断（本文件同目录的交接单就被我这样毁过一次，后来整份重写）。改文件用编辑工具或独立 `.mjs`。
- **PDW 契约要先自检再冻结**：今天三次 blocked 全是我写的契约与既有事实冲突（A2 要跑构建、A5 又不许改 dist；`grep` 范围漏掉已跟踪的旧产物；禁止真回收但既有 Windows 测试本来就真回收）。
- **实现者自述不算验收**：343 的「17 步全绿」是它自己写的，我复跑才确认，而且那次就撞上了 local-server 的偶发。
- **越界写**：341 的任务顺手把 343 的代码也写了，runner 判 out-of-scope。派活时允许清单要穷举，包括因类型不兼容可能牵连的文件。
- **Codex 报错归因**（近三天）：`Selected model is at capacity`（真失败，重试/换模型）、`codex_models_manager … request timed out`（启动噪音）、`collab spawn failed: no thread with id`（子线程过期）。都不是代码问题。
- **IAB 不能做真实页面缩放**：`Ctrl+=` 无效，CDP `deviceScaleFactor` 只改 DPR（918→1.5），150%/200% 只能真机。
- **`.dsh-mission/publish/`** 是被跟踪的旧发布快照，别拿它判断实现现状（T4 就是给它加声明）。

## 8. 第一波 T1–T4 已验收（2026-10-27，协调者独立复跑）

- Codex 应用的 rollout `01a17c53` 交了 T1–T4（14 文件，T1–T3 各起独立只读复核）；初始三次派单撞 `usage limit`、一次撞 `at capacity`，原配置重试后成功——都记在它的报告 §4。
- 我自己复跑 8 条定向命令全 exit 0：web 59/525、engine 17/180、session 3/24、application 35/301（299+2 skipped）、trash 1/7、三处 tsc 干净；合计 1,035 passed + 2 skipped。日志 `%TEMP%\opencode\wave1-verify\`。
- **我改了 3 个文件**：345b 原来从 `packages/application/dist/deletion/trash.js` 相对导入（绕开 `@vessel/application`、让 CLI 测试在测构建产物）。改成 `packages/application/src/index.ts` 的 `export * as trashStore` + 两处 `import { trashStore } from '@vessel/application'`。改后复跑 trash 7/7、tsc 干净，并用 `apps/cli/dist/cli.js` 真跑了一次 `trash list / purge --dry-run --json / trash bogus`。
- 保留的边界：T2 守卫只做词法判断（不做 realpath/junction、不记创建者）；342 的 `health` 非空但 `ok:false` 分支实际不可达，未补第四态；真实浏览器首帧采样与真缩放仍待 T10。
- 已落卡与索引：`tasks/342`（已验收）、`tasks/344`（已验收）、`tasks/345`（345a/345b 已验收，345c 待做）、`tasks/README.md`、`HANDOFF.md` §0、`docs/DELETION-AND-RETENTION.md` 状态行、交接单顶部进度。**未 commit。**
- 下一批：T5–T8（波次 2）。T6 依赖 T3，现在已具备。

## 9. 2026-10-27 晚间：PDW 执行中止与第二波交接

- 在 PDW 上起过的 5 个任务全部中止/失败（2 次 source drift、1 次宿主重启打断 implement、1 次 audit 判 fail、1 次被叫停），逐个的来源、影响与处置见 `evidence/sessions/2026-10-27-pdw-halt.md`。**没有留下半截源码**。
- 剩余未解决项已全部写成第二波交接单 `tasks/prompts/codex-handoff-2026-10-27-wave2.md`：每项都有「实现模型 + 思考档位 / 复核模型 + 档位 / 允许改的文件 / 自验命令 / 交付格式」，并给了四波顺序与冲突矩阵。
- 新增卡：`351`（Packaging gate）、`354`（看板对账 170–183）、`355`（陈旧卡对账，含 S002/S006）、`356`（价目值守卫文档诚实化）、`357`（`GET /api/trash`）、`358`（daemon 每日 tick）；既有 `350c`、`353`、`345c` 一并进本单。
- 口径：协调者只写文档与卡；执行交维护者给 Codex；执行完后协调者复跑定向测试与全量门禁再落卡。
- **波次 A 已交付并验收（同日）**：353（租约）、345c（服务端改道 + serve 清理）、357（`GET /api/trash`）、358（daemon tick）。我复跑 core/session 27、core 133、daemon 32、local-server 312，全量门禁 17 步全绿（根 332 文件 / 3,656 passed + 7 skipped，web 59 / 525，conformance 25/25、$0）。T6 首轮红在测试夹具（懒创建的 `session.jsonl`），经授权只改测试后转绿，`server.ts` 哈希未变。
- **波次 B/C/D 也已交付（同日）**：350c（exit 2 唯一可达路径）、356（价目值守卫文档改回事实）、354（13 卡对账 6/2/5）、355（8 卡对账 + S002/S006 可证伪）、351（packaging gate 未通过）、260/275 第二轮（未签收）。我复跑 parity 5/5、local-server 313、pricing 40/40、T11 的 9 文件 121、两处 tsc 0，并自己跑了 `check-append-only`（13 卡与 8 卡均 +n/−0），全量门禁 17 步全绿（根 3,657 passed + 7 skipped）。
- **仍未闭合**：卡 275 的两条（Stop 失败提示被视口裁切、`Write` 后无真实 Diff）、卡 346 收口、卡 351 的 npm 探针与 dist 新鲜度。四项已汇总成 `tasks/prompts/codex-handoff-2026-10-27-wave3.md`（W1–W4，含模型/档位、允许改的文件、验收判据与顺序），**等 Codex 额度恢复后交给它**；协调者只在执行后复跑门禁与浏览器复验。**不再新增任务卡**。
- **第三波已交付并验收（2026-10-27）**：W1 Stop 提示插入即滚入视口、W2 新建文件 `Write` 发只读 `/dev/null` Diff、W3 卡 346 收口（六条逃逸对抗 + 矩阵 + 回滚）。我复跑 application 320+3、local-server 316、engine 180、web 528、三条 tsc 0，全量门禁 17 步全绿（根 334 文件 / 3,681 passed + 8 skipped）；另用真实 `serve`+脚本桩验证 SSE 真出 `diff_inspector`（`evidence/sessions/2026-10-27-w2-e2e/PROOF.md`）。
- **第四波已完成（2026-10-28）**：T1（npm 探针在 Windows ENOENT、根入口走 `tsc -p tsconfig.release.json`）、T2（packaging gate 判据硬化，探针非零退出/输出空白 → pending，只收紧）、T3（`trash restore` 从 registry journal 重建索引，不信任 trash 元数据）、T5（`scripts/pricing-upgrade-diff.mjs` + 3 条单测）。T4 IAB 两次不可用，UNVERIFIED。我复跑 release-gates 61、runners 535、application 323+3、cli 782、trashCommand 10、pricing-diff 3/3、两处 tsc 0。**全量门禁在第四波后还没跑**（留给第五波 V4，我最后再独立抽查一次）。

## 10. 下一会话入口（2026-10-28）

现在等：**Codex 执行第五波（V1–V5）的报告**。任务书 `tasks/prompts/codex-handoff-2026-10-28-wave5.md`，prompt 已由维护者粘贴给 Codex 应用。

报告到达后照这个顺序做，别凭记忆：

1. **解析 rollout**：`last_agent_message` 里是汇总，但数字要以它引用的卡/证据为准。解析脚本思路（临时目录可能被清，直接重建）：
   ```js
   import fs from 'node:fs';
   const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
   for (const line of lines) {
     let o; try { o = JSON.parse(line); } catch { continue; }
     const pl = o.payload ?? {};
     if (pl.type === 'task_complete') console.log(pl.last_agent_message);
     if (pl.type === 'message' && pl.role === 'assistant') console.log((pl.content ?? []).map(c => c.text ?? '').join(''));
   }
   ```
2. **逐项对卡**：V1 → `tasks/351-packaging-gate-run.md`、V2 → `tasks/275-ui-final-acceptance.md`、V3 → `tasks/345-app-trash-and-retention.md`、V4 → `evidence/sessions/2026-10-28-final-gate.md`、V5 → `evidence/sessions/2026-10-28-precommit-audit.md`。
3. **自己复跑**（只认自己的数字）：`vitest run benchmarks/runners/src/release-gates`、`apps/local-server`、`packages/application`、`apps/cli`，两处 tsc。
4. **最后独立跑一次** `pwsh -NoProfile -File scripts/gate-batched.ps1`——V4 自己跑的 gate 不算我的抽查。
5. 落卡：状态 + 「协调者验收」段；同步 `tasks/README.md` 未闭合段、`HANDOFF.md` 门禁数字/最近交付/待执行。

口径与坑（今天踩过的）：

- **不接受自述**：`accepted_local`、子代理 PASS 都只是它的说法；数字以复跑为准。
- **PDW 跑前冻结工作树**：1.3.3 的指纹覆盖整棵树，`new` 之后写任何文件（包括回填卡）都会 `Source drift`（`calls_used: 0`）。
- **`bsk` 在本宿主起不了守护进程**（Job Object），视口截图只能靠 Codex 的 IAB，或在独立终端 `bsk daemon start`。
- **`check-append-only.mjs` 比的是 `git diff HEAD`**：对「本来就有未提交改动」的卡会误判成删除；要对被跟踪文件做追加校验，先按任务起点存一份基线。
- **`opencode` 会自动升级**：升完 `bin/opencode.exe` 可能是 229 字节的 postinstall 占位脚本，`spawn UNKNOWN` 就是它；跑包自带 `postinstall.mjs` 修复。
- **PDW 额度**：Codex 用完就 `scripts/pdw-route.ps1 -Kind deepseek -All` 整体回退；恢复后 `-Kind general -All` 切回。

未闭合清单（按谁能做分）：

- **Codex**：第五波 V1–V5（进行中）。
- **维护者真机/人眼**：175、176、179、180、183；卡 260/275 的视口截图；卡 277；沙箱 Windows ACL/Low Integrity 与 macOS 逃组（A1）。
- **需授权**：154 `release-report`、155 3h soak、156 门槛复核、ARCH-04 live / `--live` 基线。
- **对外**：U1–U5（GitHub Support 清 `refs/pull/*`、npm 元数据、规则集 bypass、游离提交、PR 页面旧身份）。
- **未提交**：140+ 文件（V5 会给建议分组），commit 由维护者决定。

## 11. 第五波验收收口（2026-10-28，协调者本会话实测）

- 报告来源：Codex 应用 rollout `01a1825d`（2026-10-28T04-55-18），解析出 3 条 `task_complete`、149 条记录。
- **V1（卡 351）已验收**：`createGateRunCommand` 只在 `win32` + `npm` 加 shell，判据没放宽；我自己跑默认 gate 得 `status=pass` / `npm pack exit=0` / stdout 1130 / stderr 0，与它一致；release-gates 67、benchmarks 541、两处 tsc 0。
- **V2（卡 275）仍不签收**：只有证据文件、无产品改动；两次 visible IAB 都被 `IAB visibility is not supported in a subagent thread` 拒绝。缺的仍是两张 917×567 截图。
- **V3（345e）已验收**：`refreshAddedSessions` 增量合并；我自建真实 serve（PID 23000 全程不变）+ 独立 CLI restore（PID 16352, exit 0），首次 GET 即见恢复会话一次、`recordCount=14`、重复 GET 不重复、journal/快照未被 GET 改写、无 `.lease`。
- **V4 探针**：我自己第三次跑 `scripts/gate-batched.ps1`，17 步全绿，根 334 / 3,704 passed + 8 skipped、web 59 / 528、conformance 25/25 $0（日志 `%TEMP%/vessel-gate-d161a08e`）；辅助项仍旧 `git diff --check` exit 2（卡 260 第 66 行）、`check-append-only` exit 1（卡 275 `+95 -2`，删行属历史）。
- **V5 审计**：只审计未清理，`.tmp` 目录与 62 行绝对 TEMP 引用保留；关键词扫描未识别真实凭据。
- 落卡与同步：`tasks/351`、`tasks/345`、`tasks/275`、`evidence/sessions/2026-10-28-final-gate.md`（追加第三次执行）、`tasks/README.md`（行与未闭合段）、`HANDOFF.md` §0（门禁/最近交付/待执行/未提交）。**未 commit**；未提交路径仍为 236。

