# tasks/ — 任务卡看板

> 个人开发工作流（personal-dev-workflow）在本仓库的进度载体。一张卡一个文件，状态写在卡内首行。
> 生命周期：拆卡 → 派活 → 交证 → 验证 → 验收 → 复盘。详见 skills/personal-dev-workflow 与根 AGENTS.md。

## 卡命名

`NNN-短横线描述.md`，如 `001-project-memory.md`；V1.1 路线卡用 `V1.1-<字母>-<短横线描述>.md`。
状态取值：待执行 / 执行中 / 待验收 / 已合入 / 打回。
PDW 关联：首行状态行下加 `- PDW task: <id>`（未启动写 `none`）；卡写目标/验收/范围，契约从卡派生（规则见 `AGENTS.md` 记录纪律 6）。

最近本地交付：[卡 315–319](BATCH-2026-10-26-provider-refactor.md) provider 模块改造一批——magpie 对照调研（315）、Web 预设改生成物（316）、CLI 用量视图核实已具备（317）、Web/API 按供应商显示 token 与成本（318）、文档收口（319）；[卡 314](314-usage-bilingual.md) 把 USAGE 的 60 多行命令说明双语化（`--lang en --help` 零 CJK、`--lang zh --help` 逐字不变）；[卡 313](313-candidate-selection-binding.md) 把 N 份 `runCandidates` 结果接进 `selectCandidate`（review 由 `asserts` 映射，零额外模型调用）；[卡 311](311-candidate-runs-api.md) 加多候选运行 API（`runCandidates`，1..8 份串行、独立 runId 与工作区、越界同步抛错）；[卡 310](310-cli-i18n-skeleton.md) 落 CLI i18n 骨架（`--lang` 预扫描 + `t()` 三级回退，只做三个键）；[卡 312](312-provenance-cli.md) 给产物完整性清单加可复用入口（`provenance.ts --write|--check`，不新增第 9 道 gate）；[卡 308](308-reflection-evidence-source.md) 修掉 evidence 与反思规则靠 `events[index]` 配对的隐患（改由规则自带 `evidenceSource`，并补 `minSeverity` 过滤下的回归用例）；[卡 301–307](307-candidate-selection.md) 一批 HARNESS² P1/P2 落地——SurfaceSpec 值化（301）、三轴分离文档（302）、benchmark 产物完整性清单（303）、经验库 suggest-only 接线（304）、reuse 就绪判据（305）、迭代层预算快照（306）、候选匿名选优算法（307）；[卡 300](300-missing-tests.md) 补三处遗留测试并修掉 doctor 对 `secretRef` 的误判（有 secretRef 即算已配置）；[卡 299](299-docs-honesty-pass.md) 文档诚实化第二轮 6 处事实修正；[卡 298](298-bench-runs-command.md) 新增只读 `vessel bench:runs`；[卡 297](297-runcache-primitives.md) 新增 run 复用判定原语（`runCache.ts`，不接自动复用）；[卡 296](296-toolchain-pin-wiring.md) 把工具链 pin 接到两条真实车道（offline gate 与 `vessel run --bench` 默认传 `probeToolVersion`；未安装仍放行、版本漂移走 pending）；[卡 295](295-toolchain-hard-gate.md) 把工具链 pin 升成 opt-in 硬门禁（`toolPins` 搬到 `packages/shared`、`runScenario` 新增 `toolPinsProbe`、版本不符抛 `ToolchainPinError` → gate pending）；[卡 294](294-harness-fingerprint.md) 落地 harness 指纹（`packages/engine/src/fingerprint.ts` + iteration 记录 `harnessFingerprint` + run 目录 `.run-complete.json`，只落身份不判定复用）；[卡 293](293-scoring-three-state.md) 落地判分三态（`RunScore` 可选字段、`successRate` 分母改为 `passed + failed`、`ungraded` 单列）；[卡 292](292-fixture-followups.md) 收尾三项（conformance 读 manifest 改降级、gate 3 补泄漏断言、六处失败路径清理 tmp 工作区）；[卡 291](291-toolchain-preflight-gate.md) 加跑前工具链 pin（`configs/tool-pins.json` + doctor 的 `toolchain` 项，只 warn 不 fail，dist 冒烟通过）；[卡 290](290-cross-harness-fixture-guard.md) 把 fixture 读边界守卫收成共享 `fixtureCopy.ts`，5 个 adapter 与 vessel 车道全部复用并从 manifest 透传 `leakGlobs`，PDW 任务 `20261025115350-c92efe` 验收通过；[卡 289](289-leak-gate-hard-fail.md) 把判据泄漏在 release gate 上从 `pending-environment` 改成 `fail`（其余 fixture setup 失败仍 pending），PDW 任务 `20261025110345-d1d9cd` 验收通过；[卡 288](288-fixture-leak-guard.md) 给 benchmark runner 加 fixture 读边界防泄漏（manifest `leak_globs` + 复制期过滤 + 复制后复查 + 内置红线 `RUBRICS.json`/`RUBRIC.json`），PDW 任务 `20261025091835-8ee8aa` 验收通过；[卡 287](287-arch07-posix-fail-closed.md) 把 ARCH-07 的 POSIX helper 缺失行为改成默认拒绝、仅 `VESSEL_ALLOW_UNSANDBOXED=1` 显式放行，PDW 任务 `20261025083644-85ac5b` 验收通过并附 WSL 真进程证据；[卡 286](286-pdw-provider-v2-migration.md) 把全局 OpenCode 配置从失效的 `provider`（单数）迁到 v2 `providers`（复数），恢复 `commandcode` 路由并由任务 `20261025074418-69269b` 完成一次真实四段冒烟；[卡 283](283-pdw-role-routing-single-source.md) 把 PDW 角色/模型/档位收成 `AGENTS.md` 唯一源，并修掉"DSH 默认执行器"与"run-state 是真相源"两处冲突；[卡 284](284-pdw-handover-and-index-slimming.md) 收口交接文档与索引；[卡 285](285-pdw-config-routing-and-smoke.md) 生效档位/限额并由任务 `20261024155859-108eea` 交付决策点 22。前序 [任务卡 277](277-ui-p2-fixes.md) 两个 UI P2 已收口（C-F1 由 PDW 任务 `20261024095132-1bac7e` 修复并 5 视口全绿），[任务卡 259](259-delete-stage-consistency.md) 删除跨阶段一致性已实现。

## 怎么读这个目录

最近补充交付：[卡 342](342-status-bar-cold-load-flash.md) 把状态栏冷启动误报断连改成三态（灰「正在连接」/绿带版本/红断连，`statusDown` 只在真失败出现）；[卡 344](344-f6-runtime-delete-ownership.md) 给 engine 临时工作区的 `dispose` 加所有权守卫（越界只 warn + 返回 `not-owned`，`.lease` 仍直接删）；[卡 345](345-app-trash-and-retention.md) 的 345b 落 `vessel trash list/restore/purge`（`--root`/`VESSEL_TRASH_ROOT`/工作区默认根三级，JSON 只出元数据）；[卡 340](340-board-backlog-closeout.md) 把 248–279 的「待验收」积压逐张对账收口（260/275 明确保持未执行，F6 残留待拍板）；[卡 339](339-incremental-audit-fixes.md) 增量审计 F1/F2/F5/F8 定向修复；[卡 338](338-usage-window-parity.md) HTTP / CLI usage 窗口口径统一。

逐卡状态见各卡首行与下表；近期交付见上一段，不在这里重复。

| 本地交付 | 状态 | 任务卡 |
|---|---|---|
| PDW 路由按能力适配 (卡 348) | 已完成（2026-10-26）：scan/test-plan `high`、review/planner `max`、implement `medium`；移除 `pdw_explorer` 引用（方案 A） | [348](348-pdw-model-fit-routing.md) |
| Codex 项目级子 Agent (卡 347) | 已完成（2026-10-26）：`.codex/agents/pdw-explorer.toml`（Luna high）与 `pdw-ui-verifier.toml`，实测子 Agent 按自身模型跑；已 gitignore，PDW 不引用 | [347](347-codex-project-subagents.md) |
| 删除与保留·收口 (卡 346) | 已验收（2026-10-27）：六条逃逸对抗 + 跨平台矩阵（Windows 实测、Linux/macOS 标未实测）+ 文档一致性 + 三档回滚；真机边界明示 | [346](346-deletion-retention-closeout.md) |
| daemon 清理 tick (卡 358) | 已验收（2026-10-27）：`gracefulDaemonStop` 注册 24h `unref` interval + `stop()` 清除；根＝启动 cwd（daemon 无 `--workspace`，已写入文档）；daemon 32 项、local-server 312 | [358](358-daemon-trash-tick.md) |
| 只读 `GET /api/trash` (卡 357) | 已验收（2026-10-27）：7 字段白名单 DTO、`skipped` 只给 `invalid_entry`、同源 403、POST/DELETE 404；local-server 312 | [357](357-trash-http-readonly.md) |
| 价目值守卫文档诚实化 (卡 356) | 已验收（2026-10-28）：P2-1 改回「已具备」，另补 `scripts/pricing-upgrade-diff.mjs`（两版内置价目 → `repairs.json`，原子写、跳过新增/删除模型），3 条单测 + 真实 CLI 消费验证（保留用户改价） | [356](356-pricing-value-guard-docs.md) |
| 陈旧状态卡对账 (卡 355) | 已核对 8 卡（2026-10-27）：071→255/256/287；281→287；196→199；同号旧217→architecture 217/236/244/247；149行动口径→153（live仍未做）；mission-02两卡→121最终交付；119的S002/S006现可证伪。9文件/121测试通过；append-only原门禁与字节前缀结果见Result | [355](355-stale-cards-reconcile.md) |
| 看板对账 170–183 (卡 354) | 对账完成：13 卡 EOF 追加；6 项本地契约已验收、2 项无法确认、5 项仍待用户；原始韧性门禁失败保留 | [354](354-board-reconcile-170-183.md) |
| Packaging gate 实跑 (卡 351) | 已验收（2026-10-28）：判据按 T2 收紧为「探针正常 + 两路径存在」，第五波 V1 修好 Windows npm 执行层（仅 `win32` + `npm` 加 shell，判据未放宽），默认 gate 实跑 status=pass、npm exit 0 / stdout 1130 字节 / stderr 0；协调者独立复跑 release-gates 67、benchmarks 541 并自跑一次真 gate 复现同样 detail。仍只证明探针与路径存在，非完整打包/安装证明 | [351](351-packaging-gate-run.md) |
| 沙箱拒绝信息不可读 (卡 360) | 已验收（2026-10-29）：越界写仍 exit 1，但 content 追加可读 `[hint]`（「可能非 UTF-8 代码页、若写盘请检查沙箱写根」），成功输出逐字不变；tools 329 | [360](360-sandbox-denial-message-readable.md) |
| 卡 175 三项残余可证伪 (卡 361) | 已验收（2026-10-29，closeout T3 补齐）：570 字符经抽屉可展开（省略号遗留转卡 364）；产物按钮可真实下载；四态颜色齐；内联 widget 去重以真实写入流验到 1 → 1 → 1（覆盖写零新增） | [361](361-card175-fixture-residuals.md) |
| 窄宽布局挤压 (卡 362) | 已完成（2026-10-29，closeout T1）：DAG 溢出提示已验；头部 `.usage-bar` 在可见 IAB 的 960/720/1440/1920 四档实测三枚 span 单行（18.591px、scrollWidth=clientWidth、nowrap、flex-shrink 0），无横向溢出 | [362](362-narrow-width-layout-squeeze.md) |
| teamStageApi 合跑偶发 (卡 363) | 已验收（2026-10-29，产品缺陷）：file id 超 `MAX_SAFE_INTEGER` 时 path-swap 守卫失效（修复前 10/10 读到私有文件），改 bigint + 真实碰撞回归；local-server 319 | [363](363-teamstage-flake-under-combined-run.md) |
| 团队抽屉截断无省略号 (卡 364) | 已验收（2026-10-29，closeout T2，含批准扩围）：抽屉 300 + `…` 与展开/收起；全文由新增只读端点 `GET /api/sessions/:id/team-stages/:stage/tasks/:task/result` 取回并缓存（同源 + token、404 边界、64 KiB UTF-8 安全截断、零文件读取）；local-server 28/320、agents 9/49、web 61/535 | [364](364-team-drawer-truncation-affordance.md) |
| 团队抽屉第二轮打磨 (卡 365) | 已验收（2026-10-29）：5 条文案进 `i18n.ts` 类型化字典（zh/en 各 5 键，既有值 0 改动，10 条字符串逐字断言）；展开/收起控件移到正文之上，570 与 4800 字展开后仍停在视口内（top 458.13 / bottom 490.12，innerHeight 900），无内层滚动、每样本 1 GET；顺带修掉「加载中禁用按钮把焦点丢给 body」。web 61/543 | [365](365-team-drawer-copy-and-toggle-polish.md) |
| 剩余视觉项：tray + 175/277 原图 (卡 366) | 已完成（2026-10-30，留一条边界）：**B/C 签收**——四态颜色/标签一眼可分、`t3-artifact.jpg` 里 `artifact.txt`/`查看差异` 是按钮且面板已打开（点击路径已证、下载未证）、277 最终态焦点轮廓罩住输入卡片且 JSON 的 `#taskInput` 矩形在框内；**B2 判据失效**（旧图早于 364/365，现状由 `t2-drawer-570.png` 覆盖）。**A**：tray 宿主进程存活、脚本含 `NotifyIcon`/`Vessel daemon`，常驻通知区里没有它（=进了溢出面板），**溢出面板内未目视** | [366](366-visual-recheck-tray-and-original-captures.md) |
| Node 26 适配 (卡 367) | 已验收（2026-10-30）：Node 26.13.0 上全量 **17/17 exit 0**（根 335 / 3,725 + 8、web 61 / 543、tsc ×3、conformance 25/25 $0）。三处：红相首行跟 26 的 `node:internal/assert/utils:<n>`（其余四判据未动，10 变体只有 2 条 accepted）；`SubagentManager` 的 `close()` 进 `finally`（真实句柄泄漏）；trash 链接用例改按路径匹配（产品守卫零改动） | [367](367-node26-compat.md) |
| Node 26 全面适配 (卡 368) | 已完成（2026-10-30，协调者执行并自验）：`.nvmrc`=26.13.0、`engines` `>=26`/npm `>=12`、npm 12 的 `allowScripts` 批准 `esbuild@0.28.2`（升 esbuild 需重新 approve）、CI matrix 22→`[22,26]`、`AGENTS`/`README`/`PROJECT-BRIEF` 契约改 ≥26、doctor 门槛 20→26（+24 必须 fail 的边界用例）。**干净 `npm ci` 实测通过**；全量 17/17（根 3,726 / 8 skipped、web 61 / 543） | [368](368-node26-full-adoption.md) |
| 项目健康：依赖漏洞 + GitHub (卡 369) | 已完成（2026-10-30）：**漏洞 4 → 0**（vite 8.3.5 / vitest 5.0.5 / source-map-js 1.2.2，仅 lockfile 变，`npm ci` 0、web build 0、全量 17/17）；GitHub 实测 CodeQL/Dependabot/secret 开放告警全 0、0 开放 issue、6 条 Dependabot PR（4 绿 2 红）、**本地领先 169 提交**；描述改 Node ≥26；AGENTS 的「Actions 已停用 / CodeQL 未配置」按实测证伪重写 | [369](369-project-health-deps-and-github.md) |
| CodeQL 首次全量扫描 9 条 (卡 370) | 部分（2026-10-31）：2 条已定性 dismiss（`execution.ts:33` 是参数指纹不是密码哈希、`server.ts:213` 与已 dismiss 的 #10 同族）；剩余 7 条由卡 371 承接 | [370](370-codeql-first-scan-triage.md) |
| CodeQL 剩余 7 条修复 (卡 371) | 已决策、待执行（2026-10-31）：**拆 spawn 出口**（`runCommand` 去 `shell` 键 + 新增 `runShellCommand`，一次关掉 #14/#15/#16）+ 四条 ReDoS 改线性（#18 索引回退、#19 OSC 排除 ESC、#20 200 字符窗口、#21 有界量词）。子代理已实测原复杂度（8.56ms / 19.95ms / 126.6ms / 32ms）并给出逐条代码；派单 `tasks/prompts/codex-handoff-2026-10-31-codeql-seven.md` | [371](371-codeql-seven-remediation.md) |
| `vessel daemon start` 构造期必崩 (卡 359) | 已验收（2026-10-28）：`daemon.status()` 在 `info` 就绪前回落到 `{ instanceId }`（身份守卫未放宽）；另查出「二次 `Set-Acl` 必报 SeSecurityPrivilege」，把 `protectDaemonPath` 改成幂等的 `whoami` + `icacls`。真机五步全过：launcher 退出后同一 pid 存活、uptime 4→6、health 200、401/200、stop 后监听 0 | [359](359-daemon-start-mesh-identity-crash.md) |
| 单写者绕过租约 (卡 353) | 已验收（2026-10-27）：`append()` 重开前重取 `.lease`（`leaseHeld` 标志），`close()` 后重开可写、被存活进程持有时 fail-closed；core/session 27 项、core 133 | [353](353-session-append-lease-bypass.md) |
| profileParity 退出码歧义 (卡 350c) | 已验收（2026-10-27）：损坏 `provider-profiles.json` 下 CLI 断言 exit 2 + 映射文案、HTTP 同根断言 `provider_profiles_corrupted`；parity 5/5、local-server 313 | [350c](350c-profile-parity-exit2.md) |
| profileParity 偶发 (卡 350) | 已加固、根因未定位（2026-10-27）：`providerStateRoot`/`profilesOnDisk` 两条守卫 + stderr 取证已落地并复跑绿；PDW audit 判 fail（未覆盖 exit 2），结论见卡内 §7 | [350](350-profile-parity-isolation.md) |
| 删除与保留·暂存区 (卡 345) | 已验收（2026-10-28）：345a–345e 全部通过，前置收口卡 346 亦验收。345e 让运行中 serve 的 GET 按 journal 增量合并新增会话；协调者另起真实 serve（PID 全程不变）+ 独立 CLI restore（exit 0）复现「首次 GET 即可见、重复 GET 不重复、journal/快照/日志未被 GET 改写、无 lease」。仅新增同步，不双向同步其它进程的修改/删除 | [345](345-app-trash-and-retention.md) |
| 删除与保留·F6 接线 (卡 344) | 已验收（2026-10-27）：engine `dispose` 加 `os.tmpdir()` 包含 + 工厂前缀守卫（越界 warn + `not-owned`），`.lease` 保持直接删并写注释 | [344](344-f6-runtime-delete-ownership.md) |
| 删除与保留·回收原语 (卡 343) | 已完成（2026-10-26 复跑门禁；2026-10-27 三次全量门禁 17 步全绿再确认）：四份回收实现收成 `packages/shared/src/deletion/recycle.ts`，四处调用点收口 | [343](343-unify-recycle-primitive.md) |
| web 构建命令失效 (卡 341) | 已验收（2026-10-27 复验）：`npm run -w @vessel/web build` exit 0，`dist` 内哨兵文件存活（无参 build 不再清空），另有 `build:clean`；七份规范文档已更新 | [341](341-web-build-command-npm12.md) |
| 状态栏冷启动误报断连 (卡 342) | 已验收（2026-10-27）：三态（连接中/绿/红），`statusDown` 只在真失败出现，中英各测一遍；首帧真实浏览器采样待 T10 | [342](342-status-bar-cold-load-flash.md) |
| 看板积压收口 (卡 340) | 已完成：248–279 共 25 张卡对账落「已验收」，17 步门禁全绿；260/275 保持未执行，见卡内 §6–§8 | [340](340-board-backlog-closeout.md) |
| 增量审计四项修复 (卡 339) | 已完成：四条指定命令 exit 0，未提交 | [339](339-incremental-audit-fixes.md) |
| usage 窗口统一 (卡 338) | 已完成：指定两组测试 exit 0，详见卡内证据 | [338](338-usage-window-parity.md) |
| usage 窗口与删除错误码 (卡 337) | 已并入卡 336；其记录的 HTTP 聚合窗口差异已由卡 338 消除 | [337](337-usage-window-delete-http.md) |
| PDW 项目级迭代 (卡 333) | 已完成：`gate-batched.ps1`、`docs/PDW-LOCAL.md`、技能两处本地节、`.pdw/skill-local-changes.md`、三条 `prompt_guidance` | [333](333-pdw-local-iteration.md) |
| 执行编排 (卡 334) | 第 1–4 步完成（PDW 迭代 → 基线 → 六道 Codex → 17 步门禁 → 提交）；第 5 步 PDW 只读复核待跑 | [334](334-execution-order.md) |
| Codex 六道计划 (卡 332) | 已完成：L1/L2 Sol medium、L3/L4 Terra low、L5 Terra medium，另加 L4b/L4c 两条修复道 | [332](332-codex-lanes-plan.md) |
| 模型选型表 (卡 331) | 已完成：AGENTS.md 六行映射 + 四条细则 + 官方来源 | [331](331-model-routing-playbook.md) |
| profile 快照 (卡 325) | 已完成：独立 `provider-profiles.json` + store/HTTP/CLI/Web，四条 API 与 400/404 分支有测试 | [325](325-provider-profiles.md) |
| CLI profile 命令 (卡 327) | 已完成：list/save/use/delete/rename；delete 回执对齐 HTTP `{ok:true}` | [327](327-cli-profile-commands.md) |
| Web profile 区块 (卡 328) | 已完成：Profiles 列表 + 一键启用 + 空态与失败隔离 | [328](328-web-profile-ui.md) |
| 文档收口 (卡 326) | 已完成：§3.4 导入 / §3.5 profile / §3.6 删除保护 / §3.7 CSV + ARCHITECTURE + MAGPIE 表 | [326](326-provider-docs-final.md) |
| 用量最近调用 (卡 329) | 已完成：`byProvider.lastTs/models/inputTokenSemantics` + Web 相对时间与 Top3 与口径 | [329](329-usage-last-called.md) |
| 并行道产物 (卡 335) | 已收口：L3 修掉导入丢字段；L4 一致性缺陷由 L4b 修复；L4c 修 server.test 悬空夹具 | [335](335-lane-followups.md) |
| 批次入口 (卡 330) | 已完成：13 段全部落地，门禁 17 步全绿 | [330](330-codex-round2-batch.md) |
| 补审修复 (卡 322) | 已完成（PDW `20261026160547-bc5263`）：daemon 注入 usageByProvider、MAGPIE 文档三处失真、`check:web-presets` | [322](322-audit-fixes.md) |
| 值守卫价目 (卡 323) | 核实为已具备：`vessel pricing override repair` 的 applied / skipped-user-modified / skipped-absent 三态，未改代码 | [323](323-pricing-value-guard.md) |
| cc-switch 导入 (卡 324) | 已完成（PDW `20261026163022-458501`）：`provider import --from`，默认 dry-run、key 只进 secretRef、已存在跳过、`--prefix` 并存 | [324](324-ccswitch-import.md) |
| 运行时端点失败转移 (卡 321) | 已完成（PDW `20261026145001-6ef0f7`）：同供应商候选端点按序切换、记住成功端点、流式已输出不重放；显式 base-url 不出候选 | [321](321-endpoint-failover.md) |
| input token 口径 (卡 320) | 已完成：usage 记录区分 `cache-inclusive` / `cache-exclusive`（同一条目混用记 `mixed`），旧记录不补值 | [320](320-input-token-semantics.md) |
| 320 回归修复 (卡 320b) | 已完成（PDW `20261026153155-a85d70`）：三处 `cacheMetrics` 深比较补字面量字段，生产代码零改动 | [320b](320b-cachemetrics-fixtures.md) |
| provider 文档收口 (卡 319) | 已完成：PROVIDER-MANAGEMENT 补 §10 预设单一真源 / §11 按供应商看用量 / §12 与 magpie、cc-switch 边界 | [319](319-provider-docs.md) |
| Web/API 按供应商用量 (卡 318) | 已完成：`GET /api/providers/usage` + Provider Hub 卡片显示 tokens/成本，无记录显示 `—` | [318](318-web-provider-usage.md) |
| CLI 按供应商用量 (卡 317) | 核实为已具备：`vessel usage` 默认段 + `--json` 的 `byProvider`（未改代码） | [317](317-usage-by-provider.md) |
| Web 预设改生成物 (卡 316) | 已完成：`scripts/sync-web-presets.mjs` + `presets.generated.ts`，presetsData 退化为薄壳 | [316](316-web-presets-generated.md) |
| magpie 对照调研 (卡 315) | 已完成：`docs/MAGPIE-ABSORPTION.md`（三方对照 + 吸收清单 + 不吸收理由） | [315](315-magpie-absorption.md) |
| USAGE 双语化 (卡 314) | 已完成：60 多行命令说明进字典；en 零 CJK、zh 逐字一致、占位符替换、行数 103/103 | [314](314-usage-bilingual.md) |
| 候选选优接线 (卡 313) | 已完成：`reviewFromReport` 用 asserts 映射票，`selectFromCandidates` 纯函数选优；零额外模型调用 | [313](313-candidate-selection-binding.md) |
| 多候选运行 API (卡 311) | 已完成：`runCandidates` 1..8 份串行、独立工作区、越界同步抛 `RangeError`；未接选优 | [311](311-candidate-runs-api.md) |
| CLI i18n 骨架 (卡 310) | 已完成：`--lang` 预扫描（位置无关）+ `t()` 三级回退，`--help` 可切语言；只三个键 | [310](310-cli-i18n-skeleton.md) |
| provenance CLI (卡 312) | 已完成：`--write` / `--check` 入口，111 条一致；不新增第 9 道 gate | [312](312-provenance-cli.md) |
| 反思 evidence 来源 (卡 308) | 已完成：规则自带 `evidenceSource`，compose 不再用 index 猜；`minSeverity` 过滤下仍指向正确事件 | [308](308-reflection-evidence-source.md) |
| 候选匿名选优 (卡 307) | 已完成：`candidate-selection.ts` 纯算法（稳定别名、丢弃无产物、平票确定），未接运行入口 | [307](307-candidate-selection.md) |
| 迭代层预算快照 (卡 306) | 已完成：`LoopEngine` 可选注入 `ExecutionRun`，只记 `modelSteps`/`consecutiveErrors`，token/cost 不伪造 | [306](306-loop-budget-snapshot.md) |
| reuse 就绪判据 (卡 305) | 已完成：`assessRunReusability` 六项检查，`bench:runs` 输出 `reuse=ok/no(原因)` | [305](305-reuse-readiness.md) |
| 经验库 suggest-only (卡 304) | 已完成：反思结论过 cue/lesson/evidence 三要素门后 `suggest`，不 approve、不注入 prompt | [304](304-learned-suggest-only.md) |
| 产物完整性清单 (卡 303) | 已完成：`provenance.ts` + `configs/benchmark-provenance.json`（111 条），不改既有 8 门 | [303](303-provenance-manifest.md) |
| 三轴分离文档 (卡 302) | 已完成：method / substrate / benchmark 互不引用写成约束 | [302](302-three-axis-doc.md) |
| SurfaceSpec 值化 (卡 301) | 已完成：`{name, alwaysOn, installMode, caps}` + 校验，只有 `self-hosted` | [301](301-surfacespec-value.md) |
| 遗留测试补齐 (卡 300) | 已完成：turn 异常不写 marker、doctor `secretRef` 口径（顺带修产品逻辑）、`probeToolVersion` 边界 | [300](300-missing-tests.md) |
| 文档诚实化第二轮 (卡 299) | 已完成：6 处事实修正，均附代码证据 | [299](299-docs-honesty-pass.md) |
| bench:runs 命令 (卡 298) | 已完成：只读展示已完成 run 与是否命中当前指纹 | [298](298-bench-runs-command.md) |
| run 复用判定原语 (卡 297) | 已完成：`runCache.ts`，只读、不接自动复用 | [297](297-runcache-primitives.md) |
| 工具链 pin 接线 (卡 296) | 已完成：offline gate 与 `--bench` 默认传 `probeToolVersion`；协调者复核（无 PDW review） | [296](296-toolchain-pin-wiring.md) |
| 工具链 pin 硬门禁 (卡 295) | 已完成：opt-in `toolPinsProbe` + `ToolchainPinError` → gate pending；模块搬到 `packages/shared`；协调者复核（无 PDW review） | [295](295-toolchain-hard-gate.md) |
| harness 指纹 (卡 294) | 已完成：`computeHarnessFingerprint` + iteration `harnessFingerprint` + `.run-complete.json`；只落身份不判定复用 | [294](294-harness-fingerprint.md) |
| 判分三态 (卡 293) | 已完成：`RunScore` 可选字段，`successRate = passed/(passed+failed)`，`ungraded` 单列 | [293](293-scoring-three-state.md) |
| fixture 三项收尾 (卡 292) | 已完成：conformance manifest 降级、gate 3 泄漏断言、六处失败路径清 tmp | [292](292-fixture-followups.md) |
| 跑前工具链 pin (卡 291) | 已完成：`configs/tool-pins.json` + doctor `toolchain` 项（只 warn）；协调者修掉跨包 import 的 dist 崩溃 | [291](291-toolchain-preflight-gate.md) |
| 跨 harness 复用复制守卫 (卡 290) | 已完成：共享 `fixtureCopy.ts`，5 adapter + vessel 车道接 `leakGlobs`；PDW `20261025115350-c92efe` `accepted_local` | [290](290-cross-harness-fixture-guard.md) |
| 判据泄漏改为硬失败 (卡 289) | 已完成：gate 先判 `FixtureLeakError` → fail，其余 setup 失败仍 pending；PDW `20261025110345-d1d9cd` `accepted_local` | [289](289-leak-gate-hard-fail.md) |
| Fixture 读边界防泄漏 (卡 288) | 已完成：`leak_globs` + 复制期过滤 + 复制后复查；内置红线 `RUBRICS.json`/`RUBRIC.json`；PDW `20261025091835-8ee8aa` `accepted_local` | [288](288-fixture-leak-guard.md) |
| ARCH-07 POSIX 默认拒绝 (卡 287) | 已完成：默认 fail-closed + `VESSEL_ALLOW_UNSANDBOXED=1` 显式放行；PDW `20261025083644-85ac5b` + WSL 真进程证据 | [287](287-arch07-posix-fail-closed.md) |
| PDW 角色路由与口径收口 (卡 283) | 已完成：`AGENTS.md` 成为唯一源；DSH 默认执行器与 run-state 真相源两处冲突修掉 | [283](283-pdw-role-routing-single-source.md) |
| PDW 交接与索引减重 (卡 284) | 已完成：HANDOFF / 卡 224 / README 收口；孤儿契约归档 | [284](284-pdw-handover-and-index-slimming.md) |
| PDW 供应商迁移 v2 (卡 286) | 已完成：`provider`（单数）在 OC 2.1.4 已失效，迁到 `providers` 复数；任务 `20261025074418-69269b` `accepted_local` | [286](286-pdw-provider-v2-migration.md) |
| PDW 配置收口与冒烟 (卡 285) | 已完成：档位/限额生效，任务 `20261024155859-108eea` `accepted_local` | [285](285-pdw-config-routing-and-smoke.md) |
| 阻断消息给出解除命令 (卡 282) | 已实现，定向测试通过 | [282](282-effect-block-message.md) |
| ARCH-07 POSIX 降级口径 (卡 281) | 已被 287 取代（2026-10-27 对账）：方案 2 默认拒绝 + 显式放行已实现；WSL既有证据，macOS实机未验证 | [281](281-arch07-posix-fallback-decision.md) |
| ARCH-09 可追溯 fixture 收口 (卡 280) | 已完成：14 fixture/7 类别复核 + conformance 25/25 + 全量两 root 绿 | [280](280-arch09-traceable-fixtures.md) |
| 未知副作用的 CLI 出路 (卡 279) | 已验收（2026-10-26 对账，见卡 340） | [279](279-cli-effects-reconcile.md) |
| 工具失败锁死会话 (卡 278) | 已验收（2026-10-26 对账，见卡 340） | [278](278-effect-outcome-classification.md) |
| Compaction provenance 性能回归 (卡 273) | 已验收（2026-10-26 对账：实现已提交 6df04ab，卡面漏回填） | [273](273-compaction-provenance-performance.md) |
| ARCH-09 可靠性 fixture 闭环 (卡 274) | 已验收（2026-10-26 对账：`bench:reliability` 14/14 exit 0，见卡 340） | [274](274-arch09-reliability-fixture-loop.md) |
| ARCH-01运行结果证据 (卡 272) | 已验收（2026-10-26 对账，见卡 340） | [272](272-arch01-run-outcome-evidence.md) |
| ARCH-06断线恢复 (卡 271) | 已验收（2026-10-26 对账，见卡 340） | [271](271-arch06-session-stream-recovery.md) |
| UI-09工具细节与Stop (卡 270) | 已验收（2026-10-26 对账，见卡 340） | [270](270-ui09-tool-details-stop.md) |
| UI-07生效Policy汇总 (卡 269) | 已验收（2026-10-26 对账，见卡 340） | [269](269-ui07-effective-policy.md) |
| UI-03工作区草稿隔离 (卡 268) | 已验收（2026-10-26 对账，见卡 340） | [268](268-ui03-workspace-drafts.md) |
| 英文残留国际化 (卡 267) | 已验收（2026-10-26 对账，见卡 340） | [267](267-browser-fix-english-residuals.md) |
| Mock预设可见可用 (卡 266) | 已验收（2026-10-26 对账，见卡 340） | [266](266-browser-fix-mock-preset.md) |
| 首屏输入焦点 (卡 265) | 已验收（2026-10-26 对账，见卡 340） | [265](265-browser-fix-initial-focus.md) |
| Activity取消语义 (卡 264) | 已验收（2026-10-26 对账，见卡 340） | [264](264-browser-fix-activity-cancellation.md) |
| 终止原因刷新恢复 (卡 263) | 已验收（2026-10-26 对账，见卡 340） | [263](263-browser-fix-terminal-history.md) |
| 会话多行输入 (卡 262) | 已验收（2026-10-26 对账，见卡 340） | [262](262-browser-fix-multiline.md) |
| 真实会话回收失败修复 (卡 261) | 已验收（2026-10-26 对账，见卡 340） | [261](261-browser-fix-delete-recycle.md) |
| 长输出截断 500 根治与沙箱 Token 权限 (卡 255) | 已实现并通过定向门禁（沙箱启动缺口转卡 256） | [255](255-fix-length-truncation-500-and-sandbox-fallback.md) |
| Windows 受限沙箱启动链路 (卡 256) | 已完成，原生验收通过 | [256](256-windows-sandbox-launch-console.md) |
| Shell 权限与联网边界 (卡 276) | 原方案否决（沙箱不限网络）；改为 UI 显式开关 + 工作区准备脚本，已实现 | [276](276-shell-under-workspace-write.md) |
| UI 两个 P2 缺陷 (卡 277) | 已收口：B-F1 用户复验通过；C-F1 经 PDW 任务 `20261024095132-1bac7e`（accepted_local）修复，几何检查 5 视口全绿 | [277](277-ui-p2-fixes.md) |
| apps/web typecheck 门禁修复 (卡 257) | 已实现，门禁全绿 | [257](257-web-typecheck-gate.md) |
| 消除虚假完成信号 (卡 258) | 已验收（2026-10-26 对账，见卡 340） | [258](258-false-completion-signal.md) |
| 删除的跨阶段一致性 (卡 259) | 已验收（2026-10-26 对账，见卡 340） | [259](259-delete-stage-consistency.md) |
| 浏览器运行时验收 (卡 260) | W1/W2 视口已签收（2026-10-28 run 5，917×567：Stop 失败提示整句可读、新建文件 Diff 只读可见）；整卡仍差 150%/200% 真实缩放与原生输入法（只能真机） | [260](260-browser-runtime-acceptance.md) |
| UI 最终验收（缩放/无障碍/E2E 签收）(卡 275) | W1/W2 视口已签收（2026-10-28 协调者逐字看两张 917×567 图）：Stop 失败提示完整不裁切、新建文件 Diff 的 `+2 −0`/hunk/两行可读且只有「收起差异」；整卡仍差 150%/200% 真实缩放与原生输入法（IAB 做不了，只能真机） | [275](275-ui-final-acceptance.md) |
| 浏览器实测缺陷整改 (BV-01~04) | 已验收（2026-10-26 对账；BV-01 由 263/272 真机补证，见卡 340） | [254](254-browser-audit-remediation.md) |
| 内置浏览器六场景审查 | 已验收（2026-10-26 对账：审计交付收口，发现项转 254 与 261–272） | [253](253-browser-verification.md) |
| EffectJournal 破损容错与租约回滚 (F5) | 已验收（2026-10-26 对账；进程树抖动按环境性记录，见卡 340） | [252](252-effect-journal-torn-tail-and-lease-rollback.md) |
| keepID 压缩守卫接入与输入法回车加固 (F4/F7) | 已验收（2026-10-26 对账，见卡 340） | [251](251-compaction-keepid-and-ime-hardening.md) |
| 会话完成真实性与凭据目标强绑定 (F1/F2) | 已验收（2026-10-26 对账，见卡 340） | [250](250-session-completion-and-credential-binding.md) |
| Tasks 236–248 独立对抗审计 | 已验收（2026-10-26 对账；F6 已定案为决策点 24，实现见卡 343–346） | [249](249-adversarial-audit.md) |
| Taste 工作台审查与优化 | 已验收（2026-10-26 对账，见卡 340） | [248](248-taste-workbench-elevation.md) |

本目录是**进度事实源**，不在此维护一份会腐烂的汇总表。查进度请：

1. 看下表「路线层」——每个里程碑/版本收官时更新一次（现状：V0.1–V0.10 + V1.0 + V1.1 全部收官）。
2. 具体某卡的状态 → 直接读卡首行；卡面由执行者与指挥侧回填，含门禁实测数字与验收结论。

> 历史说明：本文件此前维护过一张止于 018 的硬编码表，早已与目录实况脱节，
> 且与 `docs/V1.1-ROADMAP.md`、`docs/V1.0-CHECKPOINT.md` 重复。现改为"路线索引 + 指向卡面"，
> 停止复制易腐的逐卡状态。
>
> **2026-09-18 对账**：014–122 的卡状态行此前多为「待执行/执行中/待验收」而实际已合入；
> 已批量改准为「已合入（2026-09-18 对账）」并在下一行保留**原状态文本**作历史层。
> 例外：`118`（已合入）、`119`（**部分完成**——S002/S006 恒真判据仍待加锁）。

## 路线层（里程碑级）

| 版本 / 路线 | 卡区间 | 状态 | 权威记录 |
|---|---|---|---|
| V0.1–V0.5（任务书主线） | 001-013 | 已合入（独立验收 PASS） | `docs/REVIEW-REPORT-V0{1..5}.md`、`docs/V0x-IMPLEMENTATION-NOTES.md` |
| V0.6–V0.10（产品化） | 014-031 | 已合入 | `CHANGELOG.md`（V0.1→V0.10 中英双语） |
| V1.0（Milestone A–G） | 032-084 | 已合入（收官） | `docs/V1.0-CHECKPOINT.md`、`docs/V1.0-ROADMAP-PROGRESS.md` |
| V1.1（A–F 六卡） | `V1.1-*.md` | 已合入（收官；余环境补齐项非阻塞） | `docs/V1.1-ROADMAP.md` |
| 产品演进 / 独立评审 | 085-122 | 已合入 | `docs/product-evolution/EVALUATION-REPORT-*.md`、`tasks/1xx` |
| CI 修复与安全加固 | 123 | 已合入 | `tasks/123-ci-tsc-build-repair.md` |
| `Session.loadExisting` 补 `await`（fd 泄漏） | 124 | 已合入（评审 PASS + 其发现的租约清理） | `tasks/124-session-load-existing-await.md` |
| Cross-Harness Conformance 驱动 + soak 默认参数修复 + 1.0 门槛核对 | 125-126 | 已合入 | `tasks/125-*.md`、`tasks/126-*.md`、`docs/V1.6-STABLE-CHECKLIST.md` |
| CLI/TUI 能力补齐（`vessel mcp` / `vessel diff` / TUI `/mcp` `/diff`） | 127-129 | 已合入 | `tasks/127-*.md`、`tasks/128-*.md`、`tasks/129-*.md` |
| 「两份实现」收敛（MCP 装配 / mock 文案 / guide locale） | 130-132 | 已合入 | `tasks/130-*.md`、`tasks/131-*.md`、`tasks/132-*.md` |
| 记忆同步 #1 + mock 冒烟脚本收敛 + B19 口径 + G-08 `vesselHome` + 文档补齐 | 133-138 | 已合入 | `tasks/133-*.md`…`tasks/138-*.md` |
| 记忆同步 #2 | 139 | 已合入 | `tasks/139-memory-sync-2.md` |
| 文档诚实化收尾（残余扫描 #2 / 已声明未实现标注 / by-design / `stream-json` 登记） | 140-143 | 已合入 | `tasks/140-*.md`…`tasks/143-*.md` |
| 记忆同步 #3 | 144 | 已合入 | `tasks/144-memory-sync-3.md` |
| 残留清算 B1：真实模型 lane 接场景 policy | 145 | 已合入 | `tasks/145-real-model-lane-scenario-policy.md` |
| 残留清算 B2–B5：已核实闭合 | 146 | 已合入 | `tasks/146-residual-b2-b5-verified-closed.md` |
| 记忆同步 #4 | 147 | 已合入 | `tasks/147-memory-sync-4.md` |
| 全量偶发红：`cli.test.ts` real-IO 用例补显式超时 | 148 | 已合入 | `tasks/148-cli-test-real-io-timeouts.md` |
| `--live` 基线尝试 → 发现外部 adapter 与真实 CLI 不匹配（历史 blocked） | 149 | 行动建议已被153取代；live仍未做，不自动修复/实跑，需逐次授权（2026-10-27对账） | `tasks/149-live-baseline-blocked.md` |
| 回退 `--live` adapter 工作 + 立"不自动驱动本机其他 agent"口径 | 153 | 已合入 | `tasks/153-live-revert-and-external-agent-policy.md` |
| 第三方模型供应商动态自省与探测引擎 (Dynamic Model Discovery) | 157 | 已合入 | `tasks/157-dynamic-model-discovery.md` |
| OpenAI 协议 Reasoning 思考流解析标准化 (Stream Reasoning Ingestion) | 158 | 已合入 | `tasks/158-openai-reasoning-stream.md` |
| Claude Code 社区插件与 Hook 生态全兼容层 (Claude Plugin Compatibility) | 159 | 已合入 | `tasks/159-claude-plugin-compatibility.md` |
| Session 架构升级 Topic 实体支持与持久化索引 (Topic Entities & Registry) | 160 | 已合入 | `tasks/160-session-topic-entities.md` |
| Web 侧边栏 Topic 列表重构与 Thinking/Talking 详情抽屉 (Web Topic & Observability) | 161 | 已合入 | `tasks/161-web-topic-and-observability.md` |
| [Epic] 开放生态深度兼容与极度透明可观察性体系 (融合 157–161) | 162 | 已合入 | `tasks/162-epic-open-ecosystem-and-observability.md` |
| Vessel 转换为子 Agent：MCP 子代理服务器模式 (Inbound Subagent as MCP Server) | 163 | 已合入（2026-09-25） | `tasks/163-inbound-mcp-subagent.md` |
| 外部 CLI 交互桥接与虚拟人类代理 (Virtual Human Proxy & Interactive Gating) | 164 | 已合入（2026-09-25） | `tasks/164-virtual-human-proxy.md` |
| 外部异构子代理运行时与 Worktree 隔离 (Outbound Heterogeneous Subagent Runtime) | 165 | 已合入（2026-09-25） | `tasks/165-outbound-subagent-runtime.md` |
| 跨 Agent 全量功能保全与双盲评测套件 (Subagent Capability Conformance Suite) | 166 | 已合入（2026-09-25） | `tasks/166-subagent-capability-conformance.md` |
| [Epic] 双向子 Agent 网关体系与保全度评测套件 (融合 163–166) | 167 | 已合入（2026-09-25） | `tasks/167-epic-universal-subagent-mesh.md` |
| 公开化脱敏与 GitHub 治理（转 Public / 身份与本机路径脱敏 / 不发布版本 / 必须走 PR + CI） | 168 | 已合入（2026-09-27） | `tasks/168-desensitize-and-public-hygiene.md`、`evidence/sessions/2026-09-27-desensitization-and-governance.md`、决策点 20/21 |
| [Epic] 工业级多 Agent 协作工作台与分布式可观察性控制面 | 169 | 已合入（本地验收；Git 未提交） | `tasks/169-epic-universal-subagent-workspace.md` |
| 动态自适应上下文压实与 400 溢出自愈防线 | 170 | 已验收（2026-10-27 本地定向对账；非全门禁） | `tasks/170-adaptive-compaction-and-overflow-recovery.md` |
| MCP 进程树 Job Object 绑定、disabled 规范化与延迟代理 | 171 | 已验收（2026-10-27 mock/CLI 契约；原生时延边界保留） | `tasks/171-mcp-process-tree-job-object-and-lazy-proxy.md` |
| Agent-Teams 反应式 DAG 编排与队员模型快照隔离 | 172 | 已验收（2026-10-27 DAG/快照/审批定向；同批韧性失败另计） | `tasks/172-agent-teams-dag-orchestration-and-route-snapshots.md` |
| 多帧增量会话持久化与极限长会话韧性评测套件 | 173 | 无法确认（2026-10-27 原始韧性门禁 timeout / exit 1） | `tasks/173-session-streaming-and-multiframe-zstd-eval.md` |
| [Epic] V1.5 工业级韧性、高密持久化与多 Agent 协同网格体系 | 174 | 无法确认（2026-10-27 子卡 173 原始门禁失败） | `tasks/174-epic-industrial-resilience-and-teams-mesh.md` |
| Web 交互式 DAG 拓扑画布与方案预审控制台 | 175 | 仍待用户验收（本次组件/API 通过；当前浏览器未复验） | `tasks/175-visual-team-dag-canvas-and-staged-approval.md` |
| 后台常驻 Daemon 守护进程与系统通知驻留 | 176 | 仍待用户验收（本次 mock/鉴权通过；真机 daemon/tray/toast 未复验） | `tasks/176-headless-daemon-and-tray-resilience.md` |
| 工具级自愈退避与大载荷动态截断管道 | 177 | 已验收（2026-10-27 输出边界/重试安全定向） | `tasks/177-tool-self-healing-and-bounded-output.md` |
| SQLite WAL 模式高性能会话元数据与全文检索 | 178 | 已验收（2026-10-27 SQLite/FTS/本机 warm 延迟定向） | `tasks/178-sqlite-wal-session-index-and-fts5-search.md` |
| [Epic] V1.6 工业级团队协同工作台、常驻守护进程与高性能会话中枢 | 179 | 仍待用户验收（本次四阶段定向通过；175/176 真机边界保留） | `tasks/179-epic-universal-team-workspace-and-daemon-mesh.md` |
| 原生级操作系统沙箱与低完整性安全隔离 | 180 | 仍待用户验收（mock 契约通过；原生 ACL/平台真机边界保留） | `tasks/180-os-native-sandboxing-and-restricted-tokens.md` |
| 自主演进经验图谱与轻量混合记忆检索 | 181 | 已验收（2026-10-27 混合检索/规则/有界上下文定向） | `tasks/181-evolving-knowledge-graph-and-hybrid-memory.md` |
| 跨实例异构 Swarm 网格与分布式事件总线 | 182 | 已合入（2026-10-03 本地验收） | `tasks/182-cross-instance-swarm-mesh-and-event-bus.md` |
| [Epic] V1.7 原生级安全沙箱与认知记忆体系 (180+181) | 183 | 已合入（2026-10-03 本地验收） | `tasks/183-epic-hardened-runtime-and-cognitive-memory.md` |
| Mesh/Memory CLI 控制面与 `vessel doctor` 系统健康自检引擎 | 184 | 已合入（2026-10-03 本地验收） | `tasks/184-mesh-memory-cli-and-doctor-diagnostic.md` |
| Web 控制台 Swarm 节点拓扑面板、沙箱安全审计与经验规则看板 | 185 | 已合入（2026-10-04 本地验收） | `tasks/185-web-swarm-topology-and-cognitive-dashboard.md` |
| 会话后自主反思与经验提炼引擎 (Autonomous Reflection Engine) | 186 | 已合入（2026-10-03 本地验收） | `tasks/186-post-session-autonomous-reflection-engine.md` |
| [Epic] V2.0 Swarm 集群控制面、自检诊断与认知自愈飞轮 (184+186) | 187 | 已合入（2026-10-03 本地验收） | `tasks/187-epic-v2-swarm-workbench-and-cognitive-flywheel.md` |
| 请求负载确定性序列化与前缀三段式分层 (Prefix Layout) | 188 | 已验收（2026-10-08，Epic 191 最终门禁与独立复核） | `tasks/188-deterministic-serialization-and-prefix-layout.md` |
| 多供应商真实缓存计费命中率与多维透视 (Cache Hit Telemetry) | 189 | 已验收（2026-10-08）；历史清理偏差保留 | `tasks/189-cache-hit-rate-telemetry-and-multi-provider.md` |
| 工作区状态指纹与无进展死循环熔断器 (No-Progress Breaker) | 190 | 已验收；新指标 fixture warm 42.58ms / 全仓 p95 673.41ms | `tasks/190-workspace-fingerprint-and-no-progress-breaker.md` |
| [Epic] V2.1 前缀缓存经济学、无进展熔断与高韧性运行中枢 | 191 | PASS（2026-10-08）：2811 passed / 6 skipped，五项门禁 exit 0 | `tasks/191-epic-v2-1-prefix-cache-and-convergence.md` |
| 洋葱式 Mod 中间件核心流水线 (Onion Mod Middleware Pipeline) | 192 | 已本地验证（28 定向测试） | `tasks/192-onion-mod-middleware-and-pipeline.md` |
| Claude Code Mods 沙箱化兼容适配器与防提权网关 | 193 | 已本地验证（33 定向测试；独立评审受阻） | `tasks/193-sandboxed-claude-mods-adapter.md` |
| Mod 权限清单静态审计、CLI 控制面与 Doctor 诊断 | 194 | 已本地验证（26 定向测试） | `tasks/194-mod-manifest-permissions-and-cli-doctor.md` |
| [Epic] V2.2 沙箱化 Mod 中间件网络与插件生态兼容 | 195 | 已合入（2026-10-09，commit `3e6a56f`，双Root 2957 passed） | `tasks/195-epic-v2-2-sandboxed-mods-and-middleware-mesh.md` |
| 评估器 Red→Green 缺陷复现前置硬门禁 | 196 | 已合入（2026-10-09，commit `3e6a56f`）；“Epic199门禁待执行”已由199最终交证取代（2026-10-27对账） | `tasks/196-evaluator-red-green-reproduction-gate.md` |
| 轻量 AST 符号索引与依赖图谱 | 197 | 已合入（2026-10-09，批准mean≤15ms/peak≤25ms，commit `3e6a56f`） | `tasks/197-ast-code-awareness-and-dependency-graph.md` |
| 变更影响面自适应上下文剪枝 | 198 | 已合入（2026-10-09，commit `3e6a56f`，剪枝率 82.56%） | `tasks/198-impact-driven-context-pruning.md` |
| [Epic] V2.3 结构化代码感知与 Red→Green 复现前置硬门禁 | 199 | 已合入（2026-10-09，commit `3e6a56f`，双Root 2957 passed） | `tasks/199-epic-v2-3-ast-code-awareness-and-red-green-gates.md` |
| Chat 流内嵌富交互组件 IR 与双向 SSE 协议 | 200 | 已合入（2026-10-10，commit `dd8e72c`） | `tasks/200-chat-inline-component-ir-and-sse-protocol.md` |
| Web 对话流内嵌交互微组件与可折叠 Diff 检查器 | 201 | 已合入（2026-10-10，commit `dd8e72c`） | `tasks/201-inline-interactive-widgets-and-diff-inspector.md` |
| 双模态双轴工作台布局与常驻 Docked Inspector | 202 | 已合入（2026-10-10，commit `dd8e72c`） | `tasks/202-dual-surface-layout-and-docked-inspector.md` |
| CLI 终端 StatusLine 与富 ANSI 组件同步适配 | 203 | 已合入（2026-10-10，commit `dd8e72c`） | `tasks/203-terminal-statusline-and-rich-ansi-reporter.md` |
| [Epic] V2.4 混合 Chat-Canvas 交互工作台与双端视觉中枢 | 204 | 已合入（2026-10-10，commit `dd8e72c`，双Root 3009 passed） | `tasks/204-epic-v2-4-hybrid-chat-canvas-and-interactive-workbench.md` |
| 画布区交互式补丁选择器与单 Hunk 采纳/回退 (Interactive Patch Picker) | 205 | 已验证（V2.5 本地完成） | `tasks/205-interactive-patch-picker-and-canvas-cherrypick.md` |
| 流式思考链可视化折叠器与认知规则标注 (Streaming Reasoning & Rules) | 206 | 已验证（V2.5 本地完成） | `tasks/206-streaming-reasoning-flow-and-rule-callout.md` |
| 全局快捷命令面板与全键盘无障碍导航 (Command Palette & Shortcuts) | 207 | 已验证（V2.5 本地完成） | `tasks/207-command-palette-and-keyboard-navigation.md` |
| 桌面级注意力焦点系统与任务完成声音提示 (Desktop Attention & Audio) | 208 | 已验证（V2.5 本地完成） | `tasks/208-desktop-attention-notification-and-audio-cues.md` |
| [Epic] V2.5 画布级交互协同与极客工作台 (Interactive Canvas & Workbench) | 209 | 已验证（3083 passed / 6 skipped） | `tasks/209-epic-v2-5-interactive-collaboration-and-canvas-workbench.md` |
| 全域纯正国际化字典体系扩充与组件硬编码英文彻底解耦 (Comprehensive i18n) | 210 | 已验证（V2.6 本地完成） | `tasks/210-comprehensive-i18n-dictionary-and-component-decoupling.md` |
| Local Server 供应商存储集成、/api/providers 端点与动态模型路由 (Provider Store & Models API) | 211 | 已验证（V2.6 本地完成） | `tasks/211-local-server-provider-store-and-models-api.md` |
| Web 端模型与供应商可视化管理弹窗及一键连通性探测 (Provider Settings Modal) | 212 | 已验证（V2.6 本地完成） | `tasks/212-provider-settings-modal-and-connection-tester.md` |
| 新建会话模型选择器升级与会话级多模型动态切换 (Session Model Picker & Dynamic Switching) | 213 | 已验证（V2.6 本地完成） | `tasks/213-session-model-picker-and-dynamic-switching.md` |
| [Epic] V2.6 全域纯正国际化与可视化多模型接入中枢 (Epic Pure i18n & Visual Model Hub) | 214 | 已验证（3146 passed / 6 skipped） | `tasks/214-epic-v2-6-pure-i18n-and-visual-model-hub.md` |
| 模型端点自动拉取、灵活配置 Schema 兼容与供应商管理自愈 (Provider Hub Model Pull & Schema Repair) | 215 | 已验证（2026-10-11 本地完成，双 Root 3155 passed / 6 skipped） | `tasks/215-provider-hub-model-pull-and-schema-repair.md` |
| 项目整体逻辑架构可视化与文档包清单漂移修复 (Archify Architecture Visualization & Doc-Drift Repair) | 216 | 已验证（2026-10-12 本地完成，双 Root 2873 passed / 6 skipped） | `tasks/216-archify-architecture-visualization-and-doc-drift-repair.md`、`docs/diagrams/README.md` |
| Vessel 架构整改与实施规范落地 (Architecture Improvement Plan Implementation) | 217 | 已验证（本地提交 `6442171`；双 Root 3219 passed / 6 skipped）；同号event-projection旧草稿已被本卡及236/244/247取代，见355对账 | `tasks/217-architecture-improvement-plan-implementation.md` |
| Vessel Web UI/UX 工作台整改规范落地 (Web UI/UX Workbench Improvement) | 218 | 已验证（已合入本地提交 `26ba6fe`；双 Root 3228 passed / 6 skipped） | `tasks/218-web-ui-ux-workbench-improvement-implementation.md` |
| 全量功能端到端交互与真实点击测试套件 (Full Surface Click-Testing Suite) | 219 | 已验证（2026-10-13；交证即停） | `tasks/219-full-surface-interactive-click-testing-suite.md` |
| Provider 能力协商契约与 Context 分层版本化缓存落地 (Provider Capability Contract & Context Layered Cache) | 220 | 已验证（已合入本地提交 `030fc0f`；双 Root 3271 passed / 6 skipped） | `tasks/220-provider-capability-contract-and-layered-cache.md` |
| Behavior 语义 IR、五级兼容性等级与 Agent Studio L0-L4 检查器 (Behavior Semantic IR & Studio Inspector) | 221 | 已验证（已合入本地提交 `bd4a0b8`；双 Root 3296 passed / 6 skipped） | `tasks/221-behavior-semantic-ir-and-agent-studio-inspector.md` |
| [Epic] 架构与UI优化方案全量收官：任务树、故障注入、Studio Composer与审批队列 (Full Architecture & UI Plan Completion) | 222 | 已验证（已合入本地提交 `c7cb0ca`；双 Root 3,356 passed / 6 skipped；`packages/core` 0 变动） | `tasks/222-subagent-team-task-tree-and-instance-spec.md` |
| Web UI 视觉重塑与设计技能引入：三套候选方向原型 + 设计语言令牌 (Web UI Visual Overhaul & Design Skill Intake) | 223 | **已落地 + 走查闭合（2026-10-15/16）**：原型阶段完成 → P1–P8 已实施到 `apps/web` → browser-skill 真实走查修复 5 处（含 Vite 代理 403）；门禁四项 exit 0、双 root 全绿、core 零改动 | `tasks/223-web-ui-visual-overhaul-and-design-skills.md`、`docs/design-prototypes/`、`docs/DESIGN.md`、`evidence/sessions/2026-10-15-ui-landing/PROOF.md`、`evidence/sessions/2026-10-15-ui-landing/bsk-functional/FINDINGS.md` |
| PDW 工作流适配：personal-dev-workflow 1.0.0 → 1.3.1-local (PDW Workflow Adaptation) | 224 | **已完成（2026-10-16）**：Skill 替换 + `pdw.ps1` + `.pdw/` 配置；`doctor` exit 0；包哈希字节一致；防覆盖保护保持；夹具编排 20/20；旧状态零改动并归档 | `tasks/224-pdw-1.3.1-local-adoption.md`、`evidence/pdw-migration-1.3.1/MIGRATION.md`、`evidence/pdw-migration-1.3.1/LEGACY-STATE.md` |
| Local Server 静态托管与 Web UI 生产直连（SPA 路由回退与 dist 优先探测） | 225 | **已完成（2026-10-18）**：PDW 契约多角色闭环（Codex 实现 + OpenCode 复核 pass）；dist 优先探测 + SPA 客户端路由回退 + 穿越安全防护 + 19 项定向测试 | `tasks/225-local-server-web-ui-hosting-and-spa-fallback.md` |
| CLI Serve 工作区自动注册与服务自省增强（VesselServerOptions.workspace、/api/health 增强与 USAGE 衔接） | 226 | **已完成（2026-10-18）**：PDW 契约多角色闭环（Codex 实现 + OpenCode 复核 pass）；工作区启动自动入库 ProjectRegistry + /api/health 增强 (webUi/workspace) + USAGE 更新 + 156 项定向测试 | `tasks/226-cli-serve-workspace-auto-registration-and-server-info.md` |
| 基于 Open Claude UI (CDS) 的 Web UI 深度优化 (Web UI CDS Elevation & Physics) | 228 | **已完成（2026-10-19）**：OpenCode 完成 CDS 逆向规范拆解与对标调研 + 对抗性独立审查；Codex 独立沙箱编码实施 IME 守卫与单测、0.5px 发丝细边、精密圆角拓扑与双滚动羽化消隐遮罩；双 Root 3,414 passed | `tasks/228-vessel-web-ui-cds-elevation.md`、`evidence/sessions/2026-10-19-open-claude-ui-study.md`、`evidence/sessions/2026-10-19-opencode-review-228.md` |
| 基于 CDS 的 Web UI 消息流与工具调用卡片质感升级 (Web UI Message Stream & Tool Cards) | 229 | **已完成（2026-10-19）**：OpenCode 审计与独立对抗审查；Codex 独立沙箱编码实施工具调用折叠卡片（CDS 3.5 规范、状态呼吸灯、时间与参数排版）、思考流强调线与平滑折叠、Markdown/气泡排版美化与动效时长令牌；14 个单测全绿；双 Root 3,428 passed | `tasks/229-vessel-web-ui-message-stream-and-tool-cards.md`、`evidence/sessions/2026-10-19-opencode-audit-229.md`、`evidence/sessions/2026-10-19-opencode-review-229.md` |
| 基于 CDS 的侧边栏会话管理与任务输入器质感升级 (Web UI Sidebar & Task Composer) | 230 | **已完成（2026-10-19）**：OpenCode 审计与独立对抗审查；Codex 独立沙箱编码实施侧边栏打破线框牢笼、真实日期分组（今天/昨天/最近7天/更早）、active rail 发丝高亮与内联操作悬停浮现；输入器同心圆角（--r-composer: 20px）与三态投影、流线型胶囊选择器与发送按钮微回弹；6 个新单测全绿；双 Root 3,434 passed | `tasks/230-vessel-web-ui-sidebar-and-task-composer.md`、`evidence/sessions/2026-10-19-opencode-audit-230.md`、`evidence/sessions/2026-10-19-opencode-review-230.md` |
| 基于 CC-Switch 理念的模型供应商中枢与快捷切换器全量重构 (Provider Hub & Quick Switcher) | 231 | **已完成（2026-10-19）**：OpenCode 审计与独立对抗审查；Codex 独立沙箱编码实施 70 款权威预设分类展台（国内直连/国际官方/聚合/本地/其他国际）、流线型模型胶囊多选器（Chips）、就地快捷秒切浮层菜单（ModelQuickSwitcher）与零配置新手引导卡片；18 个新单测全绿；Web 389 项单测全绿；Chromium E2E 5/5 全绿 | `tasks/231-provider-hub-and-cc-switch-reconstruction.md`、`evidence/sessions/2026-10-19-opencode-audit-231.md`、`evidence/sessions/2026-10-19-opencode-review-231.md`、`evidence/sessions/2026-10-19-agent-walkthrough-231/` |
| 模型供应商全屏独立中枢、高级模型搜索筛选器与 CC-Switch 权威预设补齐 (Provider Hub Full-Surface & Advanced Model Picker) | 232 | **已完成（2026-10-19）**：彻底解决设置页仅有按钮弹窗的痛点，落地 Settings 全屏独立平铺大视图（ProviderHub）；重构 ModelChips 支持海量模型实时搜索、全选/全不选/反选与羽化遮罩；补齐飞书 Lark 预设（72 款预设齐备）；Web 单测 396 项全绿；Chromium E2E 4/4 全绿 | `tasks/232-provider-hub-full-surface-and-advanced-model-picker.md`、`evidence/sessions/2026-10-19-opencode-audit-232.md`、`evidence/sessions/2026-10-19-opencode-review-232.md`、`evidence/sessions/2026-10-19-agent-walkthrough-232/` |
| 供应商能力继承与协商拦截修复 (Provider Capability Inheritance & Negotiation Repair) | 233 | **已完成（2026-10-19）**：协议感知能力推断 + 工具能力协商自愈；双 Root 3,461 passed | `tasks/233-provider-capability-inheritance-and-negotiation-repair.md` |
| OpenUI 生成式排版体系融入与 Web 体验痛点全景整改 (OpenUI Generative UI & UX Polish) | 234 | **已完成（2026-10-19）**：凭据免输复用 + 回收站物理删除会话 + 深浅主题切换常驻 + 实体按钮交互教育 + GFM/OpenUI 生成式卡片；双 Root 3,445 passed | `tasks/234-openui-generative-ui-and-ux-polish-plan.md` |
| Taste-Skill 全屏通栏 UI 重构 | 235 | **已完成（2026-10-20）**：独立审查出 5 项审美缺陷，彻底消除浮动孤岛弧形，重塑 Edge-to-Edge 全屏工整工作台；Web 404 测试全绿 | `tasks/235-taste-skill-full-surface-ui-refactoring.md`、`evidence/sessions/2026-10-20-taste-skill-audit-235.md` |
| 会话与 Run 真实状态机建立 (ARCH-01 + UI-02) | 236 | **已完成（2026-10-20）**：彻底消除无 Turn 即 completed 的欺骗逻辑，支持 RunOutcomeStatus 8态，最后权威事件与 recordCount 提取；定向测试全绿 | `tasks/236-arch-01-session-run-truthful-status.md` |
| 会话物理删除端到端回执与前端数据一致性 (ARCH-02 + UI-01) | 237 | **已完成（2026-10-20）**：消除删除 Promise.all 吞错假成功，精准按服务端 ok 回执过滤前端 state，失败留存并报警；Web api 单测 40 项全绿 | `tasks/237-arch-02-session-deletion-truthful-receipts.md` |
| Workbench 导航收敛与单一主工作台 (UI-03) | 238 | **已完成（2026-10-20）**：移除常驻 58px Rail，整合为单一 260px 侧栏与底部直观区域导航 + Ctrl+K 直达 + 窄屏 left: 0 抽屉；双 Root 3044+406 passed 全绿 | `tasks/238-ui-03-workbench-navigation-convergence.md` |
| Inspector 8 合 3 职责化重组 (UI-05) | 239 | **已完成（2026-10-20）**：将 8 个平级标签重组为变更/执行/诊断 3 大职责组，两级无障碍导航，默认 patch，旧状态与 tabRequest 平滑迁移；双 Root 3044+407 passed 全绿 | `tasks/239-ui-05-inspector-8-to-3-groups.md` |
| 清理未实现模块占位符与无面板死逻辑 (UI-08) | 240 | **已完成（2026-10-20）**：收敛 UI 模块为 Tasks/Team/Swarm/CognitiveRules 四大真实面板，剔除未实现灰色卡片与死逻辑，旧配置安全平滑过滤；双 Root 3044+407 passed 全绿 | `tasks/240-ui-08-clean-unimplemented-placeholders.md` |
| ProviderHub 管理与添加分离 + 凭据免输直测 (ARCH-05 + UI-06) | 241 | **已完成（2026-10-20）**：支持已配凭据免输一键直测，结构化分离已配供应商管理与 72+ 预设展台，兼顾新旧凭据安全；双 Root 3044+408 passed 全绿 | `tasks/241-arch-05-ui-06-provider-hub-management-separation.md` |
| Agent Studio 行为配置与有效安全策略分层 (ARCH-07 + UI-07) | 242 | **已完成（2026-10-20）**：明确候选配置编译验证与离线草稿未激活状态，防止误解为作用于运行态，强化安全策略不可覆盖性；双 Root 3044+409 passed 全绿 | `tasks/242-arch-07-ui-07-agent-studio-advisory-separation.md` |
| Activity 专职行动中心与路由归位 (UI-04) | 243 | **已完成（2026-10-20）**：消除普通会话列表重复展示，严格限制仅真实 session 类型可触发会话导航杜绝伪跳转，已完成项优雅折叠；双 Root 3044+410 passed 全绿 | `tasks/243-ui-04-activity-focused-action-center.md` |
| EffectJournal 故障注入与未知副作用恢复证明 (ARCH-03) | 244 | **已完成（2026-10-20）**：核验四类崩溃边界与非幂等工具单次执行硬约束，未决写操作阻断盲目重放，10 项定向测试全部通过 | `tasks/244-arch-03-effect-journal-fault-injection-proof.md` |
| 区分 BenchmarkAdapter 与 InteractiveRuntimeAdapter (ARCH-04) | 245 | **已完成（2026-10-20）**：明确解耦离线 Benchmark 评估与持续交互式运行时契约，建立真实版本与能力探针矩阵；定向测试全绿 | `tasks/245-arch-04-distinguish-benchmark-and-interactive-runtime-adapter.md` |
| Event/SSE 断线重连与高信噪比执行体验 (ARCH-06 + UI-09) | 246 | **已完成（2026-10-20）**：视区保护与智能滚动守卫（<=120px 贴底、悬浮回到底部药丸）、中文 IME 组合防护杜绝回车误发、SSE 重连自愈与会话同步；双 Root 3045+413 passed 全绿 | `tasks/246-arch-06-ui-09-sse-reconnect-and-high-snr-stream.md` |
| Compaction 守恒断言与全景真实走查 (ARCH-08 + ARCH-09 + UI-10) | 247 | **已完成（2026-10-20）**：强化 Compaction 守恒断言对齐 OpenCode 2.1 metadata.keepID 引用、真实 Chromium 走查 7/7 PASSED 零报错存证；双 Root 3045+413 passed 全绿 | `tasks/247-arch-08-09-ui-10-compaction-conservation-and-walkthrough.md` |

## 未闭合 / 下一目标

- **当前未闭合（2026-10-28 复核）**：
  1. **第五波已收口（2026-10-28 协调者验收）**：V1（card 351）已验收——Windows npm 执行层修好、判据未放宽，真 gate `status=pass`（npm exit 0 / stdout 1130 / stderr 0）；V3（345e）已验收——运行中 serve 首次 GET 即可见恢复会话，协调者另起真实 serve + 独立 CLI restore 复现（PID 全程不变、journal/快照未被 GET 改写）；V4 全量门禁由协调者在最后源码状态下又跑一次，17 步全绿（根 334 / 3,704 passed + 8 skipped；web 59 / 528；conformance 25/25、$0），证据 `evidence/sessions/2026-10-28-final-gate.md` 末尾；V5 只审计不清理，冻结 235 路径 / 11 组，发现 `.tmp` 目录与 62 行历史绝对 TEMP 引用，关键词扫描未识别真实凭据，**不能称全净**。**V2 的视口缺口已由 run 5 补上**（Codex 应用主线程可见 IAB，见第 2 项）。
  2. **本轮清扫已交付（2026-10-28 final sweep）**：卡 277 的**键盘/焦点子集已签收**（Cancel 默认聚焦、Esc 回同一删除按钮、Shift+Tab 正常、Console 0 错误）；卡 175 的**预审 → 批准 → 三节点完成 → 抽屉依赖**主链已通过，三色状态 / 300 字截断 / 产物链接因离线 mock 不可达保持 UNVERIFIED；卡 179 继承以上结论；卡 176 的 tray/toast 用 ffmpeg 整桌面截图尝试过，**UNVERIFIED**（图标应在溢出面板、toast 无事件可触发）；卡 180/183 的五条离线命令 32 passed、离线 conformance 25/25 已由协调者复跑确认。证据 `evidence/sessions/2026-10-28-final-sweep/`。
  3. **没有必做项了（2026-10-29 收口）**：缩放补了真实栅格渲染（DSF 1.5/2.0 → 1440×900，`evidence/sessions/2026-10-29-zoom-render/`）；tray 功能已验证（真 daemon 下子进程存活、假 pid 时自杀），图标可见性属 Windows 溢出策略、代理侧不可观测，不再占验收位；175/277 的签收口径改为「协调者按证据签字，原图可复核」；原生输入法撤出待办（守卫与 opencode 同款、单测覆盖）。**剩下只有可选复核**：想看就打开 `evidence/sessions/` 下的原图，或点开通知区溢出面板确认 tray 图标——不做也不影响任何结论。**macOS 逃组已重新定性（2026-10-29）**：POSIX 逃组那半在 WSL2 里真跑完了（写内成功、写 `/tmp` 与 `/usr` 被拒、`setsid` 逃逸后代没存活也没写出东西，证据 `evidence/sessions/2026-10-29-linux-sandbox/`），只剩 Seatbelt 三件仍属 macOS 分支；按「本仓暂不正式支持 macOS」处理，挂成文档边界而不是待办。
  4. **需授权或配额——本轮我判不做**：154 `release-report` 刷新（要 opencode-go 配额，且刷完仍是 partial）；155 字面 3h 墙钟 soak（占机 3 小时、边际信号低，`benchmarks/reports/SOAK-068.md` 已论证等价压力）；ARCH-04 的 `--live`（会驱动本机 dsh/opencode/codex/claude，须你逐次同意，且 adapter 已与真实 CLI 脱节，跑了也只是 fail 基线）——三项都保留为已知阻塞，不花配额；U1–U5 对外工单/规则集/privacy 窗口只能你以自己名义办。
  5. **已闭合**：341、346、345d、345e、350c、351、353–359、第四波 T1/T2/T3/T5、第五波 V1/V2/V3/V4/V5（含 run 5 视口）、156（`docs/V1.6-STABLE-CHECKLIST.md` 已按 2026-10-28 事实复核）、final sweep（277 键盘、175 主链、180/183 离线）、deep sweep 的 S1/S2/S4、**2026-10-29 closeout 三件（362 头部观感、364 抽屉展开、361 widget 去重）**、**卡 365（抽屉文案进字典 + 控件移到正文之上 + 焦点修复）**。
  6. **closeout 三件已收口（2026-10-29，协调者独立复跑）**：`tasks/prompts/codex-handoff-2026-10-29-closeout.md` 的 T1/T2/T3 全部通过。我自己抽查的是**图与数字是否互相印证**，不是执行方的 `accepted_local`：960/720/1440/1920 四张头部图对应 `t1-header.json` 的 scrollWidth=clientWidth 与 18.591px 行高；抽屉四态 298/300/301→570→301→570 对应 `t2-drawer.json` 的 DOM 长度与**恰好一条** GET；widget 1/1/1 对应 `t3-widget.json` 的 uniqueWidgetIds 与 bootstrap 分离。全量门禁 17/17 exit 0（根 335 / 3,713 + 8，web 61 / 535，conformance 25/25 $0，日志 `%TEMP%/vessel-gate-384557f6`）。**这条线上再没有未闭合项**；卡 364 留了两处非阻塞小偏离（抽屉文案内联双语未进 i18n 字典、展开后「收起」需滚动），已写进卡内，属下一轮 UI 批次。

- **最近已交付（2026-10-19，本地验收通过）：任务 232 模型供应商全屏独立中枢、高级模型搜索筛选器与 CC-Switch 权威预设补齐 (Provider Hub Full-Surface & Advanced Model Picker)**：
  - 交付内容：
    1. `Settings 独立全屏大视图 (ProviderHub)`：彻底解决用户切到设置区域时只有“模型设置”四个字加孤零零按钮的糟糕体验；在 Settings 区域直接完整平铺展开专业、大气的模型中枢大厅，包含已配供应商状态卡片、CC-Switch 级权威预设展台与极简表单，告别二级弹窗断层；同时保留快捷弹窗唤起兼容性。
    2. `高级模型筛选器与批量操作栏 (ModelChips)`：针对飞书 Lark、OpenRouter 等海量模型，新增实时模糊搜索框（支持清除/Esc）；新增全部/已选/未选分段过滤；新增「全选」、「全不选」、「反选」批量操作；展示「已选 X / 共 Y 个模型」计数徽章；配置 `max-height: 240px` 与上下发丝羽化消隐遮罩（Fade Mask），自适应承载数百候选模型。
    3. `飞书 Lark 权威预设对齐`：在 `packages/application/src/providers/presets.data.ts` 与 `apps/web/src/components/providers/presetsData.ts` 中双向对齐加入飞书 Lark（火山方舟，默认 `doubao-1-5-pro-32k-250115`），展台收录权威预设达 72 款。
  - 多角色协同与执行证明：
    - `前期架构审计 (scan/audit)`：OpenCode（`deepseek/deepseek-v4.1-flash`）产出深度审计报告 `evidence/sessions/2026-10-19-opencode-audit-232.md`；
    - `代码实施 (implement)`：Codex（`gpt-6.1-sol`，思考深度 `medium`）在独立沙箱中实施，消耗 220,344 tokens，日志位于 `evidence/sessions/2026-10-19-codex-task-232.log`；
    - `独立对抗审查 (review)`：OpenCode（`deepseek/deepseek-v4.1-flash#max`）顶格审查产出 `evidence/sessions/2026-10-19-opencode-review-232.md`；
    - `真实浏览器端到端走查 (walkthrough)`：Playwright 驱动 Chromium 走查 4/4 全绿，Console Errors = 0, Page Errors = 0，截图 4 张存盘于 `evidence/sessions/2026-10-19-agent-walkthrough-232/`。
  - 门禁：`tsc -b` exit 0，`npm run typecheck:tests` exit 0，Web 生产打包 184ms exit 0，Web 单测 48 文件 / 396 passed (100%)，`packages/core` 严格 0 改动。
  - 验收入口：`tasks/232-provider-hub-full-surface-and-advanced-model-picker.md`。

- **前序已交付（2026-10-19，本地验收通过）：任务 231 基于 CC-Switch 理念的模型供应商中枢与快捷切换器全量重构 (Provider Hub & Quick Switcher)**：
  - 交付内容：
    1. `70 款权威预设分类展台 (Presets Gallery)`：彻底解决此前硬编码 4 个简陋预设的问题，完整引入并分类 70 款权威预设（国内直连：DeepSeek、Kimi Coding、豆包 Seed、通义千问、智谱 GLM、MiniMax 等；国际官方：Claude、OpenAI、Gemini、Grok、Mistral 等；聚合平台：SiliconFlow、OpenRouter、NewAPI 等；本地模型：Ollama、vLLM、LM Studio 等）；支持分类 Tab 与实时搜索过滤；点击卡片一键自动预填 Base URL、线协议与推荐模型，**用户仅需粘贴 API Key**。
    2. `可视化模型胶囊标签多选器 (Model Chips)`：彻底废除逗号分隔的纯文本手敲输入框；支持一键探测 `/v1/models`，模型呈现为流线型交互式胶囊标签（Pills/Chips），支持点选启用/禁用、标记默认星标（★）、删除与回车自定义模型 ID。
    3. `就地快捷秒切浮层菜单 (Model Quick Switcher)`：终结主界面与设置弹窗的割裂；在 `TaskComposer` 和会话顶部集成当前模型状态胶囊（显示供应商/模型与在线绿点）；点击直接弹出极简 Popover，按供应商分组展示模型、支持搜索、上下键键盘导航与一键秒切，热生效无跳转。
    4. `零配置新手开箱向导卡片 (Zero-Config Guide)`：当没有配置任何模型时，工作台主区域直观展示 4 张快捷接入卡片（DeepSeek、Claude、OpenRouter、自定义），点击直接唤起弹窗并预选对应预设。
  - 多角色协同与执行证明：
    - `前期架构审计 (scan/audit)`：OpenCode（`deepseek/deepseek-v4.1-flash`）对组件架构进行深度审计，产出报告 `evidence/sessions/2026-10-19-opencode-audit-231.md`；
    - `代码实施 (implement)`：Codex（`gpt-6.1-sol`，思考深度 `medium`）在独立隔离沙箱中实施，消耗 210,965 tokens，日志位于 `evidence/sessions/2026-10-19-codex-task-231.log`；
    - `独立对抗审查 (review)`：OpenCode（`deepseek/deepseek-v4.1-flash#max`）顶格对抗审查产出 `evidence/sessions/2026-10-19-opencode-review-231.md`；
    - `真实浏览器端到端走查 (walkthrough)`：Playwright 驱动 Chromium 走查 5/5 全绿，Console Errors = 0, Page Errors = 0，截图 6 张存盘于 `evidence/sessions/2026-10-19-agent-walkthrough-231/`。
  - 门禁：`tsc -b` exit 0，`npm run typecheck:tests` exit 0，Web 生产打包 242ms exit 0，Web 单测 47 文件 / 389 passed (100%)，`packages/core` 与 `packages/runtime` 严格 0 改动。
  - 验收入口：`tasks/231-provider-hub-and-cc-switch-reconstruction.md`。

- **前序已交付（2026-10-19，本地验收通过）：任务 230 基于 Open Claude UI (CDS) 的侧边栏会话管理与任务输入器质感升级 (Web UI Sidebar & Task Composer)**：
  - 交付内容：
    1. `侧边栏打破线框牢笼与真实日期分段`：彻底清除 `.topic-group` 间生硬的横向切线，改用物理间距与悬停面板底色区分；修复日期分组展示，真实呈现「今天 (Today) / 昨天 (Yesterday) / 最近 7 天 (Previous 7 Days) / 更早 (Earlier)」规范日期分段（补充 `topicYesterday` 词条）。
    2. `发丝高亮指示条与内联微动效操作栏`：当前选中的会话左侧挂载 2px 宽度的柔和指示轨（`border-radius: var(--r-pill); background: var(--accent);`），带有平滑伸展过渡；将原生粗糙的 `<details><summary>` 替换为悬停/聚焦时通过 `--dur-snap: 120ms` 平滑浮现的内联图标按钮（重命名/归档）。
    3. `任务输入器 CDS 同心圆角容器与三态柔和投影`：重构 `TaskComposer.tsx`，输入区域升级为拥有 `--r-composer: 20px` 同心圆角 Surface 容器，挂载 Normal、Hover、Focus-within 三态柔和投影与发丝双环；原生 `<select>` 升级为流线型胶囊选择器（`capsule-select`）；发送按钮（Send Button）挂载 `:active { transform: scale(0.98); }` 微回弹；100% 完整保留 IME 中文拼音守卫与表单提交流程。
    4. `变量清理与单测覆盖`：彻底清理 `--panel2` 与 `--row-line`；新增 `Sidebar.test.tsx` 涵盖日期分段边界、会话归档/过滤与最新活跃连续性等 6 个测试用例。
  - 多角色协同与执行证明：
    - `前期组件审计 (scan/audit)`：OpenCode（`deepseek/deepseek-v4.1-flash`）对组件架构进行逐行审计，产出报告 `evidence/sessions/2026-10-19-opencode-audit-230.md`；
    - `代码实施 (implement)`：Codex（`gpt-6.1-sol`，思考深度 `medium`）在独立隔离沙箱中实施，消耗 215,636 tokens，日志位于 `evidence/sessions/2026-10-19-codex-task-230.log`；
    - `独立对抗审查 (review)`：OpenCode（`deepseek/deepseek-v4.1-flash#max`）顶格审查产出 `evidence/sessions/2026-10-19-opencode-review-230.md`，结论 VERIFIED / 零阻断缺陷。
  - 门禁：`tsc -b` exit 0，`npm run typecheck:tests` exit 0，Web 生产打包 200ms exit 0，Web 单测 43 文件 / 371 passed (100%)，双 Root 全量测试 **332 测试文件 / 3,434 passed | 6 skipped** 全绿，`packages/core` 0 改动。
  - 验收入口：`tasks/230-vessel-web-ui-sidebar-and-task-composer.md`。

- **前序已交付（2026-10-19，本地验收通过）：任务 229 基于 Open Claude UI (CDS) 的 Web UI 消息流与工具调用卡片质感升级 (Web UI Message Stream & Tool Cards)**：
  - 交付内容：
    1. `交互式工具调用决策卡片（CDS 3.5 规范）`：将单调文本行重构为折叠卡片/胶囊 `ToolActivityRow.tsx`，具备 `var(--panel-2)` 色阶垫底、发丝细边与 `--r-sm` 精密圆角；状态指示灯（`.tool-dot`）在运行态显式微呼吸脉冲（`pulse-glow`），成功呈现凝练翠绿，失败/拦截呈现柔红；参数摘要截断与双行省略；自动毫秒/秒格式化；补齐完善的 `role="group"` 与 `aria-label` 语义。
    2. `思考流折叠卡片（Thinking Accordion）发丝强调线`：挂载左侧 `--think: #7c5ce0` 思考主题色发丝强调线与动态状态指示点（`thinking-dot`），支持平滑折叠展开微动画。
    3. `消息流排版与 Markdown 渲染美化`：助手消息正文挂载 `text-wrap: pretty;` 消除孤字掉行；计数器、时间、Token 计量等动态数字启用 `font-variant-numeric: tabular-nums`，消除数字跳动重排。
    4. `补齐 CDS 动效令牌与物理学缓动`：补充 `--dur-fast: 60ms` 到 `--dur-slow: 450ms` 5 阶时长令牌与 `--ease-swift`, `--ease-enter` 缓动曲线。
  - 多角色协同与执行证明：
    - `前期组件审计 (scan/audit)`：OpenCode（`deepseek/deepseek-v4.1-flash`）对既有组件架构进行逐行审计，产出报告 `evidence/sessions/2026-10-19-opencode-audit-229.md`；
    - `代码实施 (implement)`：Codex（`gpt-6.1-sol`，思考深度 `medium`）在独立沙箱中实施，消耗 126,878 tokens，日志位于 `evidence/sessions/2026-10-19-codex-task-229.log`；
    - `独立对抗审查 (review)`：OpenCode（`deepseek/deepseek-v4.1-flash#max`）顶格审查产出 `evidence/sessions/2026-10-19-opencode-review-229.md`，结论 VERIFIED / 零阻塞缺陷。
  - 门禁：`tsc -b` exit 0，`npm run typecheck:tests` exit 0，Web 生产打包 289ms exit 0，Web 单测 42 文件 / 365 passed (100%)，双 Root 全量测试 **331 测试文件 / 3,428 passed | 6 skipped** 全绿，`packages/core` 0 改动。
  - 验收入口：`tasks/229-vessel-web-ui-message-stream-and-tool-cards.md`。

- **前序已交付（2026-10-19，本地验收通过）：任务 228 基于 Open Claude UI (CDS) 的 Web UI 深度优化 (Web UI CDS Elevation & Physics)**：
  - 交付内容：
    1. `IME 中文/日文输入法合成守卫`：`TaskComposer.tsx` 建立 `isComposingRef` + `nativeEvent.isComposing` + `keyCode === 229` 三重守卫，拦截拼音选词阶段按 Enter 误触提交，并新增独立单测 `TaskComposer.test.tsx`（6 个用例全绿）。
    2. `视网膜高分屏发丝细边与表面色阶`：引入 `--ring-hairline: 1px`，在 `@2x/@3x` 高分屏自适应补偿为 `0.5px`，消除边框粗重感；补齐 4/6/8/10/20px 精密圆角矩阵（`--r-0` 到 `--r-composer`）；优化三层立体焦点环（`--focus-ring`）。
    3. `原生滚动消隐非线性遮罩`：消息流容器（`ConversationView.tsx`）与检视器面板（`layout.css` `.inspector-content`）挂载 CSS `mask-image` 24px 上下羽化渐隐，消除生硬硬裁切感。
    4. `交互时间常数与微反馈`：对齐 CDS 几何咬合物理常数（120ms 切换，70ms 触觉按压反馈 `:active { transform: scale(0.98); }`）。
  - 多角色协同与执行证明：
    - `调研走查 (scan/audit)`：OpenCode（`commandgota/deepseek/deepseek-v4.1-flash`）逆向研究 CDS（17.7 万字），产出 1.6 万字对标报告 `evidence/sessions/2026-10-19-open-claude-ui-study.md`；
    - `代码实施 (implement)`：Codex（`gpt-6.1-sol`，思考深度 `medium`）在独立隔离沙箱推进，消耗 118,951 tokens，日志位于 `evidence/sessions/2026-10-19-codex-task-228.log`；
    - `独立对抗审查 (review)`：OpenCode（`commandgota/deepseek/deepseek-v4.1-flash#max`）顶格审查产出 `evidence/sessions/2026-10-19-opencode-review-228.md`。
  - 门禁：`tsc -b` exit 0，`npm run typecheck:tests` exit 0，Web 生产打包 321ms exit 0，Web 单测 41 文件 / 351 passed (100%)，全量测试 **330 测试文件 / 3,414 passed | 6 skipped** 全绿，`packages/core` 0 改动。
  - 验收入口：`tasks/228-vessel-web-ui-cds-elevation.md`。

- **前序已交付（2026-10-18，本地验收通过）：任务 227 Web UI 结构重塑与设计系统规范落地 (Web UI Structural Refinement & Design System)**：
  - 交付内容：
    1. `统一 1180px 抽屉断点`：消除 1024px–1180px 检视器在主流式内容下方错位堆叠的断点死区，在中窄屏下优雅回退为 Drawer Overlay（含遮罩与平滑过渡）。
    2. `桌面侧栏折叠支持`：新增 `.sidebar-collapsed` 状态与 `.desktop-sidebar-toggle` 按钮，用户可一键收拢左侧 Session 列表，为聊天流释放充沛呼吸宽度。
    3. `空白工作台（workbench-home）体验重塑`：终结单输入框孤岛感，新增常用启动胶囊 (`starter-pill`，点击自动草稿)、最近会话网格 (`home-session-grid`) 与工作区状态卡片 (`home-workspace`)。
    4. `视觉减负与微交互落地`：消除多层嵌套线框牢笼（Border Prison），采用 `var(--panel-2)` 色阶区隔，全局按钮与 Tab 补齐 `:active { transform: scale(0.98); }` 按压微反馈与清晰的 `:focus-visible` 焦点环。
  - 多角色协同与执行证明：
    - `调研走查 (scan/audit)`：OpenCode（`commandgota/deepseek/deepseek-v4.1-flash`）深度研读 `impeccable`、`emil-design-eng`、`make-interfaces-feel-better` 等技能，产出 5000+ 字审查报告 `evidence/sessions/2026-10-18-ui-structural-audit.md`；
    - `代码实施 (implement)`：Codex（`gpt-6.1-sol`，思考深度 `medium`）在独立隔离沙箱中推进，消耗 128,895 tokens，日志位于 `evidence/sessions/2026-10-18-codex-task-227.log`；
    - `独立对抗审查 (review)`：OpenCode（`commandgota/deepseek/deepseek-v4.1-flash#max`）顶格审查产出 `evidence/sessions/2026-10-18-opencode-review-227.md`。
  - 门禁：`tsc -b` exit 0，`npm run typecheck:tests` exit 0，Web 生产打包 257ms exit 0，Web 单测 40 文件 / 345 passed (100%)，双 Root 全量测试 **329 测试文件 / 3,408 passed | 6 skipped** 全绿，`packages/core` 0 改动。
  - 验收入口：`tasks/227-web-ui-structural-refinement-and-design-system.md`。

- **前序已交付（2026-10-18，本地验收通过）：任务 226 CLI Serve 工作区自动注册与服务自省增强（VesselServerOptions.workspace、/api/health 增强与 USAGE 衔接）**：
  - 交付内容：
    1. `VesselServerOptions.workspace`：`createVesselServer` 增加可选工作区路径参数，启动时以最佳努力调用 `projectRegistry.open(workspace)` 自动入库，消除 Web UI 启动后项目下拉列表为空的断点。
    2. `startServe` 传参贯通：`apps/cli/src/cli.ts` 将已解析的工作区绝对路径传递给 `createVesselServer({ workspace, ... })`，`vessel serve` 与 `vessel web` 默认以当前目录自动注册进索引。
    3. `GET /api/health` 扩充：响应新增 `webUi: boolean`（指示是否由 `apps/web/dist` 提供生产 Web 界面）与 `workspace?: string`，保持原有 `{ ok: true, version: string }` 完全兼容。
    4. `USAGE` 文案同步：更新 CLI 帮助中 `vessel serve` 与 `vessel web` 命令，标明可选的 `[--workspace <dir>]` 参数及工作区默认行为。
  - PDW 流程与多角色分工：
    - `scan` / `test-plan`：OpenCode（`commandgota/deepseek/deepseek-v4.1-flash`）定位实现与制定测试矩阵；
    - `implement`：Codex（`gpt-6.1-sol`，思考深度 `medium`）独立在隔离沙箱中编写实现与单测；
    - `review`：OpenCode（`commandgota/deepseek/deepseek-v4.1-flash#max`）顶格思考独立复核通过（verdict: pass）。
  - 门禁：`tsc -b` exit 0，`npm run typecheck:tests` exit 0，定向单测 `server.test.ts` (49/49) + `cli.test.ts` (107/107) 全绿，`apps/local-server` 全包 189 passed，Web 打包 exit 0 (930ms)，全量 `npm run test:all` 双 Root **329 文件 / 3,403 passed | 6 skipped** 全绿，`packages/core` 0 改动。
  - 验收入口：`tasks/226-cli-serve-workspace-auto-registration-and-server-info.md`，PDW 产物 `.pdw/tasks/20261018102744-05f80d/`。

- **前序已交付（2026-10-18，本地验收通过）：任务 225 Local Server 静态托管与 Web UI 生产直连（SPA 路由回退与 dist 优先探测）**：
  - 交付内容：
    1. `resolveStaticDir`：优先探测 `apps/web/dist`（含 `index.html`），缺失/无效时回退 `apps/local-server/public`；保持显式 `staticDir` 优先级最高。
    2. `serveStatic` SPA 路由回退：非 `/api/` 且无文件扩展名的页面导航 GET 请求（或 Accept 含 text/html）在无物理文件时回退返回 `index.html`（200 text/html），扩展名资源精确 404，无 index.html 优雅回落 404（非 500）。
    3. 路径穿越防护：在 WHATWG URL 规范化前直接解码 rawPath 检查 `..`，硬拦截 403 `{ error: "forbidden" }`。
    4. 单元与集成测试：`apps/local-server/src/server.test.ts` 新增 19 项覆盖，全文件 43 项测试全部通过。
  - PDW 流程与多角色分工：
    - `scan` / `test-plan`：OpenCode（`commandgota/deepseek/deepseek-v4.1-flash`）定位实现与建立测试矩阵；
    - `implement`：Codex（`gpt-6.1-sol`，思考深度 `medium`）独立在沙箱会话中编写实现与单测；
    - `review`：OpenCode（`commandgota/deepseek/deepseek-v4.1-flash#max`）顶格思考独立审查通过（verdict: pass）。
  - 门禁：`npx vitest run apps/local-server/src/server.test.ts` 43/43 exit 0，`tsc -b` exit 0，`npm run typecheck:tests` exit 0，`npm run test:all` 双 Root 3,396 passed / 6 skipped 全绿，`apps/web` `vite build` 1.04s exit 0，`packages/core` 0 改动。
  - 验收入口：`tasks/225-local-server-web-ui-hosting-and-spa-fallback.md`，PDW 证据产物 `.pdw/tasks/20261018084924-70fefd/`。

- **前序已交付（2026-10-16，未提交）：任务 224 PDW 工作流适配至 1.3.1-local**：
  - 生效版本 **1.3.1-local**（`.agents/skills/personal-dev-workflow/` 完整目录 + 根 `pdw.ps1` + `.pdw/config.json`）；
    `doctor` exit 0（OC / Codex / AGY 三后端实测可用，模型全部显式）；包 7 文件哈希与清单逐项一致；`install` 防覆盖保护未被绕过。
  - 旧状态零改动：`.agent-state/run-state.json`（rev 253）、`RUN_STATE.md`、`tasks/` 与旧预算**不**冒充新版 `.pdw/tasks`，
    整理为 `evidence/pdw-migration-1.3.1/LEGACY-STATE.md`（含「无自动转换」与续接方式）；迁移时无活动协调者/Worker。
  - 验证：隔离安装 + 原规则保留；夹具套件隔离 20/20（仓库内 5 项失败已定位为 `.pdw/` 被 gitignore 的夹具环境限制，附对照实验）；
    `.gitignore` 旧规则经 `git check-ignore -v` 全数复核未变。
  - 未验证：真实模型调用（`demo`/`run`）与全量门禁未跑（改动不在其图内）；模型口径冲突（AGENTS=GPT-6.1 Sol/medium vs HANDOFF=OC+DeepSeek/ high）留给用户拍板。
  - 证据：`evidence/pdw-migration-1.3.1/`（`MIGRATION.md`、`LEGACY-STATE.md`、`backup/`、`validation/`、`REVIEW.md`）；纯本地未提交/未推送。

- **已交付闭环（2026-10-19）：任务 234 OpenUI 生成式排版体系融入与 Web 体验痛点全景整改**：
  - 核心痛点与交付内容：
    1. 凭据复用：`providerRoutes.ts` 与 `ProviderSettingsModal.tsx` 支持在测试连接与拉取模型时安全复用已有存储凭据，免除重复输入 API Key；
    2. 会话删除：`DELETE /api/sessions/:id` 端点接入 Windows 回收站安全删除，侧边栏新增实体垃圾桶按钮与行内防误触二次确认；
    3. 主题切换：三态 Theme 管理器（`getStoredTheme`/`applyTheme`/`toggleTheme`），在 Rail 底部常驻实体 ThemeToggle 按钮并解绑媒体查询硬限制，localStorage 持久化；
    4. 按钮实体化：重构 `.btn`、`.topic-action` 等交互元素，赋予明确微边框、底色填充、按压动效与 Tooltip 交互教育，消除纯文本伪按钮；
    5. OpenUI 与富排版：新增 `ConversationRenderer`（轻量 GFM 解析器，支持标题、列表、表格、任务复选框、一键复制代码块）并支持 OpenUI Generative UI 规范卡片。
  - 门禁：`tsc -b`、`typecheck:tests`、Web build 均 exit 0，双 Root 全量测试 **3445 passed / 6 skipped**（根 3041，Web 404），`packages/core` 严格 0 行变更。
  - 任务书：`tasks/234-openui-generative-ui-and-ux-polish-plan.md`。

- **已交付闭环（2026-10-19）：任务 233 供应商能力继承与协商拦截修复 (Provider Capability Inheritance & Negotiation Repair)**：
  - 交付对象：修复使用标准三方 OpenAI-compatible / Anthropic 供应商（如 Command GOTA、DeepSeek 等）时，因端点未返回 tools 导致模型能力降级为 `tools=unknown` 并触发 Turn 运行时硬拦截（`CapabilityMismatchError: required tools=true, available unknown`）的问题。
  - 核心改动：
    1. `packages/llm/src/capabilities.ts`: `discoverProviderCapabilities(metadata, protocol?: string)` 协议感知能力发现；
    2. `apps/local-server/src/routes/providerRoutes.ts`: 在端点测试与输入归一化中传递供应商线协议；
    3. `apps/local-server/src/providers/ProviderStore.ts`: `healModelCapabilities` 自动自愈持久化配置。
  - 门禁：`tsc -b`、`typecheck:tests`、Web build、`test:all` 全通过，双 Root **3461 passed / 6 skipped**（根 3065，Web 396），`packages/core` 严格 0 行变更。
  - 任务书：`tasks/233-provider-capability-inheritance-and-negotiation-repair.md`。

- **已落地 + 走查闭合（2026-10-15/16）：任务 223 Web UI 视觉重塑 —— 按 IMPLEMENTATION-PLAN 的 P1–P8 实施到 `apps/web`**：
  - 视觉 = **玻璃（Glass）**；骨架 = **四栏工作台/审阅台**（58 图标轨 + 232 会话栏 + 中央过程流 + 300 审阅栏）。
  - 落地内容：P1 `.tokens` 玻璃令牌（旧名别名）；P2 玻璃外壳（rail/顶栏毛玻璃、面板浮动）；
    P3 `Rail.tsx` 图标轨 + `58px 232px 1fr` 网格 + 300px 审阅栏（真实 8 Tab 检视器，≤1023px 模态）；
    P4 `PlanChecklist.tsx` 常驻计划清单（`计划 · n/m`，数据源真实 Goal 队列）；
    P5 `ComposerMeters.tsx` 四胶囊（项目/模型/审批档位/模式，含 B1 解析+锁定）+ 常驻计量；
    P6 `utils/timeFormat.ts`（`HH:mm`/`MM-DD`）+ 硬编码色清零 + 空/加载/错误态 + Studio 去边。
  - 功能回归：`docs/design-prototypes/FEATURE-COVERAGE.md` 的 **B1–B18 逐条有可达入口**，C 项四模块保持 `t('unimplemented')` 占位语义。
  - **真实浏览器走查（`browser-skill` / 独立 Agent Window）**：修复 5 处缺陷，含阻断级一处 —— Vite 8 代理默认
    `changeOrigin: true` 改写 Host，使后端 `trustedOrigin` 判为跨域、拦掉所有带 Origin 的写请求 → `vite.config.ts` 改 `changeOrigin: false`。
    另核实：`vessel serve` / `vessel web` 只给着陆页，查看 Web UI 的实际入口是 Vite dev（须 `--host 127.0.0.1`）。
  - 门禁：`npx tsc -b` / `npm run typecheck:tests` / `npm run -w @vessel/web build -- --emptyOutDir false` / `npm run test:all`
    （根 289 文件 3037 passed + 6 skipped，web 40 文件 340 passed）全 exit 0；`packages/core` 零改动。
  - 证据：`evidence/sessions/2026-10-15-ui-landing/`（门禁日志 `PROOF.md`、截图矩阵 64 张 + 画廊 `gallery.html`、
    走查 `bsk-functional/FINDINGS.md` + 12 张截图）。
  - 纯本地：未 commit / 未 push / 无永久删除。

- **两份整改实施规范（VESSEL-ARCH-2026-01 / VESSEL-UI-2026-01）已随任务 217–222 全量落地**：ARC-01..11 与 UI-001..017 的剩余 P2/P3 项在本轮收官。
- **最近已交付（已合入本地提交 `c7cb0ca`，2026-10-14）：任务 222 [Epic] 架构与UI优化方案全量收官**：
  - 验收入口：`tasks/222-subagent-team-task-tree-and-instance-spec.md`；证据与限制：`evidence/sessions/2026-10-14-card222/PROOF.md`（含对抗评审 `REVIEW.md`）。
  - 交付：ARC-10 `AgentInstanceSpec` / `TaskLease` / `TaskTreeNode` 契约与 `TaskTreeScheduler`（依赖 DAG、租约超时、父子取消级联、结果归并、权限单调收窄）、`/api/tasks/tree` 与 Web 团队任务树；ARC-11 故障注入四断点套件（`EffectJournal` 防重放不可逆副作用）、Behavior Golden Conformance（L0→L4 稳定性与 fail-to-compile）、Compaction 100% 守恒；UI-013 跨项目活动与集中审批队列、UI-015 交互式 Agent Studio Composer、UI-017 结构化脱敏 Trace。全部中英双语 + 800px 响应式。
  - 门禁：`tsc -b` / `typecheck:tests` / Web build（`-- --emptyOutDir false`）/ `test:all` 顺序 exit 0；双 Root **3,356 passed / 6 skipped** 全绿；`packages/core` 行修改 **0**；离线 Chromium + CDP 实拍 8 张（中/英 × 桌面/800px）与 `browser-capture-meta.json`。
- **前序已交付（已合入本地提交 `bd4a0b8`）：任务 221 Behavior 语义 IR、五级兼容性等级与 Agent Studio L0-L4 检查器**：
  - 验收入口：`tasks/221-behavior-semantic-ir-and-agent-studio-inspector.md`；证据与限制：`evidence/sessions/2026-10-13-card221/PROOF.md`。
  - 交付：ARC-07 语义 IR 与五级兼容阶梯、L0→L4 生效快照与编译溯源、`/api/behavior/inspect`、Web Agent Studio 只读检查器（中英双语 + 800px 响应式）；`packages/core` 0 变动。
  - 攻坚收口：`HybridMemoryStore` 内存向量索引（热中位 18–24ms → 6.288ms）消除 `hybridSearch` 门禁的环境性红；三个绝对毫秒门禁统一为「预热 + 仅计时超线的有界重测」（阈值/统计量/断言未改）；离线 Chromium + CDP 实拍 6 张截图。
  - 门禁：`tsc -b`、`typecheck:tests`、Web build、`test:all` 全部 exit 0；根 282 文件 / 2,988 passed + 6 skipped，web 36 文件 / 308 passed，合计 3,296 passed / 6 skipped。
- **前序已交付（已合入本地提交 `030fc0f`）：任务 220 Provider 能力协商契约与 Context 分层版本化缓存落地**：
  - 验收入口：`tasks/220-provider-capability-contract-and-layered-cache.md`；证据与限制：`evidence/sessions/2026-10-13-card220/PROOF.md`。双 Root 3,271 passed / 6 skipped 全绿，Thin Core 0 变动。
- **前序已交付（已合入本地提交 `1276d39`）：任务 219 全量功能端到端交互与真实点击测试套件**：
  - 验收入口：`tasks/219-full-surface-interactive-click-testing-suite.md`；证据与限制：`evidence/sessions/2026-10-13-card219/PROOF.md`。standard 闭环，交证即停。
- **最近已交付（已合入本地提交 `26ba6fe`）：任务 218 Web UI/UX 工作台整改规范落地**：
  - 交付内容：四大一级导航重构、就地任务启动流、分组命令面板、800px 自适应抽屉、12 张中英双语 Retina 截图全部刷新；
- **前序已交付（已合入本地提交 `6442171`）：任务 217 架构整改落地 ARC-01..05**：
  - 交付内容：SessionProjection 契约、Compaction 守恒断言、Fail-to-compile 策略门禁、Run 预算熔断、ExecutionPermit 凭证与副作用审计；
- **最近已交付（已合入本地提交 `520492d`）：任务 216 项目整体逻辑架构可视化与文档包清单漂移修复**：
  - 交付对象：OpenCode 搭载 DeepSeek-v4.1-Flash；
  - 交付内容：archify 产出的 5 类分层可交互图（`docs/diagrams/`，四门全绿、SRC 证据钉 `9c764b8`）+ `docs/ARCHITECTURE.md` §6.1 等文档包清单漂移（13→14，补 `engine`/`application`）修复；
  - 门禁：`tsc -b` exit 0、双 Root **2873 passed / 6 skipped**（Web 282）、telemetry 文档锚点守卫 43 passed；
  - 证据：`tasks/216-archify-architecture-visualization-and-doc-drift-repair.md`、`docs/diagrams/README.md`。
- **最近已交付（待维护者验收）：任务 215 模型端点自动拉取、灵活配置 Schema 兼容与供应商管理自愈**：
  - 交付对象：OpenCode 搭载 DeepSeek-v4.1-Flash；
  - 交付内容：
    1. `normalizeProviderInput` 归一化兼容器（字典型 `models` / `options` 嵌套 / `npm` 协议声明）；
    2. 新增 `POST /api/providers/pull-models` 端点与 Web「拉取模型」按钮，真实探测 `/v1/models` 并回填；
    3. 供应商删除自愈（清理 `secretRef` 凭据）+ 后端**具体错误码透传**（不再一律 `provider_request_failed`）+ 前端按码本地化展示；
    4. 术语规范化：`OpenAI 兼容 (OpenAI Compatible)` / `Anthropic (Claude)` / `API Key`；
    5. 损坏/非法条目归类为 `provider_store_corrupted`（可操作但仍不泄露路径或密钥）；
  - 门禁：定向测试 **27**（后端）+ **35**（前端含 i18n）全绿、双 Root **3155 passed / 6 skipped**、`tsc -b` / `typecheck:tests` / web typecheck / web build 全 exit 0、`packages/core` 0 变动；
  - 证据：`evidence/sessions/2026-10-11-card215/PROOF.md`；任务书：`tasks/215-provider-hub-model-pull-and-schema-repair.md`。
- **最近已验收路线：V2.6 全域纯正国际化与可视化多模型接入中枢 (Epic 214)**：
  - 任务 210–214：全域纯正 i18n 字典、后端 ProviderStore 集成与安全 API、前端可视化设置弹窗与会话真实模型动态切换。双 Root 3,146 passed / 6 skipped 全绿。证据 `evidence/sessions/2026-10-11-v2.6/PROOF.md`。
- **最近已验收路线：V2.5 画布级交互协同与极客工作台 (Epic 209)**：
  - 任务 205–209：画布单 Hunk 补丁选择器、流式思考折叠与规则标注、全局命令面板 Ctrl+K、桌面注意力通知与音频合成提示。双 Root 3,083 passed / 6 skipped 全绿。
- **最近已合入里程碑：V2.4 混合 Chat-Canvas 交互工作台与双端视觉中枢 (Epic 204，commit `dd8e72c`)**：
  - 任务 200–204：Chat 内嵌组件 IR 与双向 SSE/HTTP 端点、React 就地微组件群、四 Tab 常驻 Docked Inspector、CLI 终端动态 StatusLine 与彩色折叠 Diff。双 Root 3,009 passed / 6 skipped 全绿。
- **前序已合入里程碑：V2.2 (Epic 195) 与 V2.3 (Epic 199) 已全量验收合入主干（commit `3e6a56f`）**：
  - 任务 192–195：洋葱式 Mod 中间件流水线、Worker 线程沙箱（防御 CVE-2026-82533）、清单审计与 `vessel mod/doctor`；
  - 任务 196–199：真实 Red→Green 缺陷复现硬门禁、增量 AST 符号依赖图、自适应上下文剪枝（82.56% 压缩率）。
  - 任务 188：确定性序列化、三段式前缀与 turn===0 压缩守卫；
  - 任务 189：多供应商真实缓存计费命中率与击穿告警；
  - 任务 190：工作区状态指纹与无进展死循环主动熔断器。
- **前序已合入里程碑**：
  - **V2.0 阶段完整收官（已独立核验 PASS，见 `docs/REVIEW-REPORT-V2.0.md`）**：
    - **Web 拓扑看板与沙箱审计（任务 185）**：SVG 拓扑连接图、波形指标、CognitiveRules 看板与 Talking 抽屉原生沙箱安全等级徽章（commit 本轮合入）；
    - **Swarm 集群控制面、自检诊断与认知自愈飞轮（Epic 187，含 184 + 186）**：CLI `vessel mesh` / `vessel memory` / `vessel doctor` 自检引擎，与会话后自主反思提炼引擎（commit `20f1f1f`）；
    - **跨实例异构 Swarm 网格与分布式事件总线（任务 182）**：commit `b6c05b2`；
    - **原生级安全沙箱与认知记忆体系（Epic 183）**：commit `7ecd828`。

- **前序收官里程碑**：**V1.3 已收官**（Epic 卡 167，2026-09-25 合入，见 `CHANGELOG.md` 的 `[Unreleased]` 段与 `docs/V1.3-PROGRESS.md`）。
  - 入站 MCP 子代理服务器（163）、虚拟人类代理与交互拦截（164）、出站异构子代理运行时与 Worktree 隔离（165）、跨 Agent 全量保全度双盲评测套件（166）均已通过全量门禁并合入。
- **已完成里程碑（V1.2 / 开放生态与极致透视，Epic 卡 162 已全量合入）**：
  - 动态模型探测、Reasoning 思考流、Claude 插件生态兼容、Topic 实体架构、Web 树状侧边栏与 Talking 详情抽屉全部通过验收并合入。
- **环境补齐项（非阻塞）**：opencode-go 余额 → 重跑 real-model lane；Packaging gate 需 dist。
  见 `docs/V1.1-ROADMAP.md` §5。

- **Cross-Harness Conformance**：驱动与入口已交付，离线 `--all` **25/25 exit 0**。
  **`--live` 真实基线未做且不再自动尝试**：事实登记在 `tasks/149`。未经用户逐次显式同意，不得运行 `--live`。
- **发布准备**：**已按决策点 21 作废**（2026-09-28 追注）——本仓不再发布版本（不建 GitHub Release、不向 npm 发布新版本），`tasks/152` 的 release notes 与 1.0 门槛核对保留为**历史记录**，不再作为待办。
- **外部阻塞（登记不空等）**：154 `release-report` 刷新；155 3h 墙钟 soak；156 1.0 门槛最终核验（停在 tag 前）。
