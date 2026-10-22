# 文档一致性审计 — 2026-10-22

| ID | 结论 | 一句话依据 |
|---|---|---|
| ARCH-01 | 部分实现 | Session 已取消静止即成功；team/subagent 仍存在可复现的虚假完成。 |
| ARCH-02 | 部分实现 | 回收后才确认，前端仅移除成功 ID；索引持久化失败后的跨阶段一致性与逐项错误反馈仍缺。 |
| ARCH-03 | 部分实现 | Journal/Permit 与生产执行链已接线，故障单测通过；完整崩溃恢复、乱序投影及 reconcile 闭环未证实。 |
| ARCH-04 | 部分实现 | 两类接口已分开；未找到消费交互契约的实际版本探针/适配器能力矩阵。 |
| ARCH-05 | 部分实现 | 两份目录有自动一致性测试，凭据绑定及协商有实现；证据过期与旧模型陈旧状态缺失。 |
| ARCH-06 | 部分实现 | 首次持久化 hydration、会话代际保护已实现；已有缓存会话的断线补帧与事件幂等仍缺。 |
| ARCH-07 | 部分实现 | 子权限收窄及沙箱审计存在；POSIX helper 缺失可直通，Windows 成功启动仍有已记录阻塞。 |
| ARCH-08 | 部分实现 | 压缩保全用户约束、keepID、工具/拒绝引用；专用摘要 hash 与全部要求的黄金链路证据不足。 |
| ARCH-09 | 部分实现 | 有离线基准、负向测试和历史门禁；未找到要求的专项 10–20 fixture 闭环，当前 Web 类型检查失败。 |
| UI-01 | 部分实现 | 不再全删本地列表；失败仍只显示全局连接错误，没有逐项失败原因及部分批次浏览器回归。 |
| UI-02 | 部分实现 | Session/goal 状态修复有效；team/subagent 虚假完成，取消/中断未独立呈现。 |
| UI-03 | 部分实现 | Rail 已合并，四区可达；首屏自动聚焦、跨工作区草稿隔离缺少实现。 |
| UI-04 | 部分实现 | 无幽灵 Session 跳转，非会话新增通用详情；未提供三类实体的实际详情与完整审批浏览器收敛证据。 |
| UI-05 | 已实现 | 三组八子项、旧 tab 映射、默认关闭、命令别名与抽屉均有实现及定向断言。 |
| UI-06 | 部分实现 | 已存凭据直测及错误处理有覆盖；设置仍无条件同时渲染配置列表与预设/添加表单。 |
| UI-07 | 部分实现 | 候选未激活/拒绝文案准确；未形成规范要求的独立只读有效系统 Policy 区域。 |
| UI-08 | 已实现 | 只暴露四个真实模块；旧无效配置过滤有断言，浏览器预览确认四个选项。 |
| UI-09 | 部分实现 | IME/滚动/hydration 已补；Stop 吞错、会话输入为单行、工具细节未默认折叠。 |
| UI-10 | 需运行时验证 | 有响应式及 ARIA 实现和历史截图；缺当前产物全尺寸/主题/语言/缩放及执行态验收。 |
| DOD-GATES | 部分实现 | 历史双 root 全绿日志存在；当前 Web tsc exit 1，不能关闭总门禁。 |
| DOD-REVIEW | 部分实现 | 独立源码评审记录存在；未找到覆盖最终产品全部整改的源码与 UX 双签收。 |
| DOD-E2E | 需运行时验证 | E2E-01–14 有局部历史证据和新单测，未形成当前版本全套实际浏览器验收。 |
| DOD-SAFETY | 部分实现 | 本次遵守只读边界；历史生产永久清理路径仍违反文档硬要求。 |
| DOD-HANDOFF | 部分实现 | 部分卡有回滚/证据；当前 HANDOFF/README 仍混用旧状态，无法全局签收迁移交付纪律。 |

## 审计对象、方法与本次执行证据

- 审计契约：`tasks/prompts/codex-doc-conformance-audit.md`。仅写本文件，不改产品、测试、配置或任务卡；不提交、推送、删除，不启动外部 Agent，不调用真实模型。测试自身创建/清理的系统临时夹具遵循仓库书面例外。
- 权威要求：`docs/VESSEL_Architecture_Review_and_Execution_2026-10-20.md` 全文，尤其 §3/§9；`docs/VESSEL_UI_UX_Review_and_Execution_2026-10-20.md` 全文，尤其 §3/§6/§11。已读 HANDOFF、README、项目 PDW skill、236–256 卡及索引，并追踪其相关证据。卡面勾选仅用作定位。
- 当前分支 `main`，HEAD `5cae2d9c4e59d22cc391b7b1d05a59302bd5f819`，Node `v24.14.0`。与规范审查 SHA `3a1bf2f` 不同，审计的是当前源码，未重置仓库。
- 初始未跟踪文件：`evidence/sessions/2026-10-22-codex-doc-conformance.log`、任务 prompt。它们不是本次创建的报告附件；未修改或借其内容自证。
- 下面命令均从仓库根执行。定向 Vitest 使用 `--no-cache`；没有运行 `test:all`、npm ci 或构建。历史日志不算本次新门禁。

| 本次命令 | 实际结果与断言范围 |
|---|---|
| `node node_modules/vitest/vitest.mjs run --no-cache apps/local-server/src/routes/activityRoutes.test.ts packages/runtime/src/executor/EffectJournal.test.ts packages/runtime/src/executor/fault-injection-gate.test.ts packages/context/src/compaction/assertCompactionConservation.test.ts packages/context/src/compaction/conservation-golden.test.ts packages/application/src/providers/presets.data.test.ts packages/llm/src/capabilities.test.ts` | exit 0；7 文件 / 64 passed。状态映射、Journal 恢复/未知写防重、保全负例、目录及能力协商。 |
| `node node_modules/vitest/vitest.mjs run --no-cache --root apps/web src/components/ConversationView.interaction.test.tsx src/components/card222.test.tsx src/components/layout/DualSurfaceLayout.test.tsx src/components/Sidebar.test.tsx src/components/TaskComposer.test.tsx src/components/providers/presetsData.test.ts src/components/providers/ProviderHub.test.tsx src/components/ProviderSettingsModal.test.tsx src/uiModules.test.ts src/sse.test.ts src/App.test.tsx` | exit 0；实际匹配 9 文件 / 88 passed。两个不存在的过滤路径 `src/components/ProviderSettingsModal.test.tsx`、`src/App.test.tsx` 没有执行；前者由下一命令正确路径补跑，不能声称执行了 App 删除集成测试。 |
| `node node_modules/vitest/vitest.mjs run --no-cache apps/local-server/src/server.test.ts apps/local-server/src/routes/providerRoutes.test.ts packages/context/src/compaction/Compaction.test.ts benchmarks/runners/src/contracts/contracts.test.ts` | exit 0；4 文件 / 94 passed。HTTP 回收等待/失败重试、历史恢复、供应商绑定、生产 compaction 与 benchmark 契约。 |
| `node node_modules/vitest/vitest.mjs run --no-cache --root apps/web src/components/providers/ProviderSettingsModal.test.tsx src/components/providers/ProviderHub.test.tsx src/components/ToolActivityRow.test.tsx src/components.workbench.test.tsx` | exit 0；4 文件 / 50 passed。ProviderHub 为前次重复覆盖；不把两次相加成独立测试数。 |
| `node node_modules/vitest/vitest.mjs run --no-cache packages/runtime/src/executor/ExecutionPermit.test.ts packages/policy/src/engine/permit.test.ts` | exit 0；2 文件 / 11 passed。伪造/重放、参数/主体/作用域变化、过期及 dispatch 前取消均拒绝。 |
| `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --pretty false` | exit 1；10 条诊断：App 三项 unused、Conversation interaction 两项类型错误、card222 三项缺 needsApproval、Rail unused、ProviderSettingsModal testProvider 入参 name 类型不匹配。Vitest 通过不消除此门禁失败。 |

### 本次浏览器观察（仅现有构建壳）

`Get-NetTCPConnection -State Listen` 确认 5678/5173/3001 无监听。本次为遵守单文件写入边界，没有启动会初始化持久化状态的产品服务或重建前端。使用一个无写文件的 Node HTTP 进程，仅将现有 `apps/web/dist` 托管到空闲的 `127.0.0.1:3001`；所有 `/api/` 返回明确的 503 `audit_static_preview_no_product_api`，未提供任何假业务成功响应。

IAB 实际观察：标题 `Vessel — Local UI`；显示服务未连接，任务发送禁用；导航抽屉包含 Workbench/Activity/Studio/Settings 四区，Escape 关闭并回到打开按钮；偏好设置 → 工作台视图仅有目标任务、协作团队、代理网络、认知规则四项。没有改选项、创建/删除会话、发送输入、测试 Provider 或修改用户偏好。

该浏览器默认视口为 **522×567**，DOM scrollWidth 522；不是 UI-10 指定矩阵。所看 index SHA-256 为 `55fc927725926ca621423b91f6c2c1af9df6153356d2edfe6eb5c1e91482d8e9`；构建时间来自文件元数据，**无法据此证明构建与 HEAD 对应**。本次不保存额外截图文件；浏览器工具观察及文字记录仅支持上述壳层事实。

## 逐项核对

### [ARCH-01] 会话/Run 状态真实性
- 结论：部分实现。
- 实现位置：`apps/local-server/src/routes/activityRoutes.ts:139` 起按审批/live/已知事件/unknown 分支；`apps/local-server/src/server.ts:380` 起读取最后一个 turn/start/end；`packages/application/src/ExecutionLoop.ts:43` 恢复不完整运行。
- 证据：本次 activityRoutes、server 测试通过；`server.test.ts:215` 断言新 unfinished turn 不复用旧成功，`:226` 断言无终态历史 unknown；`:433` 覆盖 mock turn。另以直接构造 ActivityRoutes 的内存探针，exit 0，得到 `idle-probe/approved-probe/rejected-probe/cancelled-probe` **全部 completed**。
- 缺什么：`activityRoutes.ts:183` 的 team 映射把 approved/rejected 及没有 failed 但含 cancelled 的 finished 团队判完成；`:188` 把 idle subagent 判完成。这两条还不带 outcome/statusSource。Session 的 cancelled/interrupted 虽保留 outcome，展示 status 均被并为 failed。不能以 Session 修复推断所有 Run 正确。
- 可复制反例：`node --import tsx -e 'import {ActivityRoutes} from "./apps/local-server/src/routes/activityRoutes.ts"; const r=new ActivityRoutes({sessions:async()=>[],live:()=>undefined,approvals:()=>[],subagents:async()=>[{id:"idle",name:"idle",status:"idle",startedAt:"2026-10-22T00:00:00Z"}],teamStages:()=>[{id:"approved",status:"approved",createdAt:1},{id:"rejected",status:"rejected",createdAt:2},{id:"cancelled",status:"finished",createdAt:3,tasks:[{status:"cancelled"}]}],goalTasks:()=>[]}); console.log(JSON.stringify((await r.list()).runs));'`。无落盘、网络或 Agent 调用。

### [ARCH-02] 会话安全删除的端到端一致性
- 结论：部分实现。
- 实现位置：`apps/web/src/App.tsx:107` 分项收集 successfulIds；`apps/web/src/api.ts:425`；`apps/local-server/src/server.ts:785` 起 busy/origin/回收/索引处理；`packages/application/src/session/SessionRegistry.ts:414`。
- 证据：本次 server 测试 `waits for recycling before acknowledging deletion or removing the session index`、`reports recycling failure and retains the session for a successful retry`、`settles the interrupted writer before recycling a session` 通过，分别断言回收未完成不确认/不移索引、回收失败保留并可重试、等待写者停止。历史真实回收站证据在 `evidence/sessions/2026-10-21-codex-browser-verification-report.md` 场景 3。
- 缺什么：回收成功后 `server.ts:809–814` 先关闭/移除 controller，再调用可抛错的 registry.remove；后者 `SessionRegistry.ts:417–418` 先删内存再 persist。持久化失败不能回滚已经回收的目录，响应仍统一说 recycle_failed。未见该阶段故障一致性断言。前端未逐项展示错误码、失败 ID/重试提示；不存在 App 删除两成功一失败的已匹配测试。历史成功回收不能代替部分失败验收。

### [ARCH-03] EffectJournal、ExecutionPermit 与未知副作用恢复证明
- 结论：部分实现。
- 实现位置：实际链为 application `compose.ts:359–362` 的 session/execution.jsonl → policy permit → runtime `Executor.ts:89–107,141–182` → beforeDispatch Journal.begin/fsync → consume permit → tool.execute → Journal.finish/fsync → 既有事件投影。子代理 `IsolatedRuntime.ts:105–106` 同样接 Journal，均在 core 外。
- 证据：本次 Journal/fault-injection/Permit 测试通过。`EffectJournal.test.ts:47` 包含 intent 前可重试、intent 后及执行后未知写阻断；`:56` outcome 后禁止重复。`fault-injection-gate.test.ts:58–119` 用磁盘计数器断言非幂等操作不执行两次、篡改拒绝、只读 attempt 递增；ExecutionPermit 拒绝过期、伪造与撤销，且断言 execute 未被调用。torn tail 修复及拒绝中段损坏也已测试。
- 缺什么：fault-injection 的 dispatchOnce 明确是直接镜像 Journal 调用（文件 `:49`），不是完整 policy→executor→进程崩溃→SessionController→UI 的端到端演练；其“boundary 4”是参数篡改，不能取代 outcome 后/UI replay 前的全链路断点。未找到明确消费 pending intents、执行人工/确定性 reconcile 并恢复运行的产品闭环及乱序重进测试。当前已证明保守阻断，不能宣称端到端 exactly-once。

### [ARCH-04] 外部 Harness 能力契约与版本适配
- 结论：部分实现。
- 实现位置：`packages/shared/src/runtimeAdapter.ts:8–62` 定义三态能力、版本/时间/降级原因及可选交互方法；`benchmarks/runners/src/contracts/types.ts` 保留 BenchmarkHarnessAdapter/HarnessAdapter 别名；既有 `packages/agents/src/external/ExternalAgentRuntime.ts` 管理 worktree/进程。
- 证据：本次 contracts 测试通过；`contracts.test.ts:388` 使用合成对象区分接口。`rg -n 'InteractiveRuntimeAdapter|RuntimeProbeResult|adapterVersion|externalVersion|capabilities' packages/agents/src/external` 未匹配实际交互契约消费方。
- 缺什么：实际 runtime 的 probe/installed version/平台证据、版本不支持降级、resume 禁用及 cancel 无残留的逐 runtime 验证矩阵。接口声明不是已经运行的交互适配层。未运行任何外部 CLI 或 live conformance。

### [ARCH-05] Provider/Model 目录与能力协商
- 结论：部分实现。
- 实现位置：application `providers/presets.data.ts`；CLI `apps/cli/src/providers/presets.ts` 复用；Web `components/providers/presetsData.ts:16` 是快照；`packages/llm/src/capabilities.ts:6,53`；`apps/local-server/src/routes/providerRoutes.ts:78` 起限制客户端自证能力。
- 证据：本次目录与能力、providerRoutes、ProviderSettingsModal 测试通过。`presetsData.test.ts:7` 把 application 非 mock 每条元数据解析后与 Web 整体深比较，覆盖 endpoint/model/category，不仅条数。Provider 测试覆盖已存目的地址绑定、掩码不发送、错误码及模型能力保存。允许 DoD 所说的“受自动一致性测试约束”，故不把保留两文件本身算缺陷。
- 缺什么：`packages/shared/src/capabilities.ts:2–4` 只有 detected/declared/unknown 与可选 source；未找到 last verified/过期字段和失败拉取后旧配置的 stale 呈现。现有服务端元数据归类 declared 合理，但不能充当探针已验证。当前 Web 类型检查还拒绝直测 name 入参（ProviderSettingsModal:121）。

### [ARCH-06] Event/SSE/Session Projection 一致性
- 结论：部分实现。
- 实现位置：`ConversationView.tsx:177–248` 会话代际、HTTP hydration、transcript 对齐；`server.ts:1310–1315` 连接时发送可选 transcript；`sse.ts:22` 只有 type/delta/ts，`:149` 按类型分发。
- 证据：本次 server 与 Conversation interaction 测试通过，`:136,161` 断言首次磁盘恢复、SSE snapshot 收敛、迟到 HTTP/旧会话不覆盖当前。Task 254 的持久化修复因此不再当作“未实现”。
- 缺什么：`ConversationView.tsx:211–215` 仅在没有 saved.items 时带 hydrate=1；已有内存缓存重连的 onOpen（`:217`）只刷新会话元数据，没有补丢失正文/工具帧。当前 frame 无 event identity/run identity/cursor/version；conversation/usage 按到达直接追加/累计，未见去重/乱序重排。未找到丢一帧、重复两帧、乱序、断线 30 秒和三会话切换的完整同态验收。刷新首次恢复已修，不代表以上路径已闭合。

### [ARCH-07] 安全授权边界与子代理单调收窄
- 结论：部分实现。
- 实现位置：`SubagentManager.ts:259–289` 子工具取父工具交集并复用父 policy；`packages/shared/src/team.ts:38`、`packages/application/src/team/TaskTreeScheduler.ts` 权限交集；`ExternalAgentRuntime.ts:370,640,661` 拒绝 symlink/reparse；`packages/tools/src/execution/sandbox/platformSandbox.ts:41–73` 平台执行和审计；Web SandboxAuditBadge 呈现观测层级。
- 证据：`TaskTreeScheduler.test.ts:168` 明确断言 child scope 为 parent∩preset∩global；`platformSandbox.test.ts:35` 的实际断言刻意允许 helper 不可用时 `/bin/sh` passthrough 并记录 fallback。已读 `evidence/task255/native-runtime-and-full-suite.md` 的真实 native probe：restricted+Low hidden/new console 返回 `0xC0000142`，Task 256 尚待执行；不能用 mock 单测替代此失败。
- 缺什么：规范要求“禁用/故障 sandbox 不默许写入”，而 POSIX helper 不可用仍运行原命令，与该要求存在实质冲突；降级审计不是拒绝。Windows 可用启动及根内/根外写入、PowerShell 子树/网络、各平台逆向验证矩阵未闭合。没有证据证明进程树控制等价于完整 FS/网络隔离。

### [ARCH-08] Context/Compaction 守恒与能力归因
- 结论：部分实现。
- 实现位置：`packages/context/src/compaction/Compaction.ts:88–173` 从不可变来源重建，携带用户约束、denial、keepIDs、工具来源并事务化提交；`assertCompactionConservation.ts:19–77`；`CompactionBoundaryGuard.ts`；`Builder.ts:278–279` 请求/依赖 hash。
- 证据：本次 golden/keepID/生产 Compaction 测试通过。golden 负例分别删 goal/constraint/latest instruction/denial/tool pair 必须抛错；keepID 不仅检查 ID，还检查锚点内容；Compaction 真实路径现已调用断言。因此 Task 249 F4 的旧“未接线”描述不再适用。
- 缺什么：已有 schemaVersion=1 与 session:seq provenance，不应说完全没有来源；但 Builder 的请求 hash 不是专用压缩结果 hash。未找到汇总所有 policy/source refs、待审批、未决 effect、重要文件引用、跨模型切换恢复与计费对账的完整黄金链路验收。工具未完成边界 guard 不能代替上述全部对象的显式守恒证据。

### [ARCH-09] 可复现实验与工程门禁
- 结论：部分实现。
- 实现位置：`benchmarks/scenarios/B001.yaml` 等既有场景、runners contracts/conformance 与 package.json 双 root 命令；本报告执行表及 DOD-GATES。
- 证据：本次 contracts 定向测试通过；历史 `evidence/task255/test-all-rerun.log:113–128` 有根 3082 passed+6 skipped、Web 424 passed，不能继续只引用此前失败尝试。现有负向测试确实验证错误/未知写/能力拒绝，不以数量自证质量。
- 缺什么：未找到将本规范六类回归（错误成功、部分删除、adapter 降级、未知写、重放、协商）统一成 10–20 个可追溯黄金 fixture 的当前产物；既有 B/S 场景不能仅因数量足够就抵扣。当前 Web 类型检查 exit 1；全量历史绿不覆盖新的本次 HEAD 门禁。CI/mock/live 的旧能力不等于本轮 live 已授权或已执行。

### [UI-01] 会话删除反馈
- 结论：部分实现。
- 实现位置：`App.tsx:107–137`、`api.ts:425`、Sidebar 原确认流程，服务端见 ARCH-02。
- 证据：成功 ID 才过滤的代码可直接复核；本次 server 的回收等待/失败重试断言通过，历史浏览器 cancel/成功/刷新证据存在。
- 缺什么：catch 丢弃各项具体失败，只 setServerError(true)，导致用户得到“服务未连接”的泛化提示；没有失败条目清单和逐项原因/重试 UI。搜索 Web 测试仅找到 API DELETE 成功断言，不能当作 App 三条两成功一失败的状态回归。浏览器 E2E-04/05 未关闭。

### [UI-02] Activity 完成状态
- 结论：部分实现。
- 实现位置：`activityRoutes.ts:139–202`、`ActivityQueue.tsx:64–107`、`workbench.ts` 状态标签。
- 证据：本次状态/HTTP 测试及 ARCH-01 内存反例。Task 254 已把 pending goal 改 unknown，`activityRoutes.ts:193` 的代码证实；不重复报告旧 pending→running 缺陷。
- 缺什么：上述 team/subagent 虚假完成；session cancelled/interrupted 只显示 failed，UI 没有据 outcome 分别标识。刷新后的完整运行态浏览器一致性未验收。

### [UI-03] 单一 Workbench 导航
- 结论：部分实现。
- 实现位置：`App.tsx:72–88,169–174,193–231`；Sidebar 底部四区；`TaskComposer.tsx:14–22,33–86`。
- 证据：本次 Sidebar/TaskComposer/workbench 测试通过，断言四区及创建全程 busy、IME 不误建；IAB 实际看到单抽屉四区，Escape 恢复 opener。不存在“还需再移除 Rail”的结论。
- 缺什么：TaskComposer 首屏 textarea 无 autoFocus，唯一 focus 调用在 draftRequest effect；App 未传 draftRequest。task state 也不按 selectedRoot 保存/隔离或在切项目时提示，原草稿可跟随新项目提交。高级权限仍在，不应建议删功能；跨项目误发送与窄屏完整交互需浏览器实测。

### [UI-04] Activity 行动中心与实体去向
- 结论：部分实现。
- 实现位置：`App.tsx:220` 仅行动组件，不重复完整普通历史；`ActivityQueue.tsx:78–99` 非 session 通用 details、session 专有跳转；`:37–48` 后端审批后刷新。
- 证据：本次 card222 测试 `guards session navigation strictly to session kinds and folds completed items` 通过。Task 254 的 native details 已补，不再声称 goal 卡毫无可展开入口。
- 缺什么：details 仅呈现 detail/title/projectRoot，不是 team/subagent/goal 各自任务状态、结果、恢复等实体详情；四类实际去向的严格 AC 尚不成立。审批按钮只以 busy 禁用，若只给 initial fixture 且无 api 仍可点击后直接返回，未表达只读；生产 App 有 api，此点不能描述为生产已假批准。真实审批回执→队列刷新未在浏览器验收。

### [UI-05] Inspector 三组与兼容迁移
- 结论：已实现。
- 实现位置：`DualSurfaceLayout.tsx:18–29` 三组八项；`:66–87` 保留旧 tab 并派生组；`:155,165–168` 默认关闭/旧 tabRequest；`:214–282` inert、modal、两级 ARIA；`App.tsx` 保留旧 Inspector 命令。
- 证据：本次 DualSurfaceLayout 测试通过。`:29` 逐个映射八项，`:60` 断言旧存储和默认 visibility/tab，`:104` 断言窄屏 dialog/background inert，`:126` 检查快捷键；patch proposal 测试验证选中 hunk 经注入 API 处理，非纯标签测试。历史浏览器场景 6 观察三组与 Cache 命令。
- 缺什么：此项源码/定向行为满足；当前完整产品的焦点/尺寸视觉签收统一留给 UI-10/DOD-E2E，不把历史浏览器结果冒充本次新结果。

### [UI-06] Provider 管理与发现分离
- 结论：部分实现。
- 实现位置：`components/providers/ProviderSettingsModal.tsx:117–144,209–235`；ProviderHub 为 embedded wrapper。
- 证据：本次 ProviderHub/Modal 测试通过，覆盖已存 key 直测、更换 key、掩码拒绝、模型候选重选、具体拉取错误及失败重试。测试 `ProviderHub.test.tsx:48` 反而明确要求 registry/editor 立即同时渲染。
- 缺什么：`:233–235` 无条件渲染添加 form 与 PresetsGallery，不存在“点击添加才发现”的视图开关。已配置列表缺规范的上次检查时间；测试/发现证据持久化与 stale 语义也缺（ARCH-05）。`:225` 有硬编码“直接测试”，不满足新增文案全部 i18n。不能把直测完成等同于管理/发现已经分离。

### [UI-07] Studio 草稿、可用与激活
- 结论：部分实现。
- 实现位置：`AgentStudioComposer.tsx:35–39,83–99` 明确 advisory；`packages/application/src/behavior/composeDraft.ts:26` 起只编译候选并返回 report；`AgentStudioInspector.tsx:27–33` 显示来源、映射与兼容等级；`i18n.ts:889,1660` 明示 L4 未经运行验证。
- 证据：本次 card222 `clearly marks advisory verification without claiming live activation` 断言 banner、按钮和未激活；编译失败返回 rejected，无 activation endpoint 调用。既有 golden compiler 测试检查 runtime evidence 才能 Verified（本次未另跑该文件）。
- 缺什么：`App.tsx:222` 只是并排呈现 Composer/Inspector/CognitiveRulesDashboard；Inspector 显示行为项的 policyRef，未形成规范要求独立的、只读列出当前有效系统 Policy/来源/强制程度/失败原因的区域。核心“验证不等于激活”已完成，不能把更大 UI-07 整包据此全部关闭。

### [UI-08] 隐藏未实现模块
- 结论：已实现。
- 实现位置：`uiModules.ts:12–17,76` ACTIVE 四项、旧配置只恢复有效项；`CustomizePanel.tsx:78` 起只枚举 UI_MODULES；`App.tsx:39,257` 只渲染真实模块。
- 证据：本次 uiModules 五个测试检查有效模块、持久化和 corrupt/partial/旧 Context/Logs 等过滤；浏览器“工作台视图”实际只有目标任务/团队/代理网络/认知规则。底层 ChangedFiles/Cost/ToolActivity 的 Conversation/Inspector 渲染保留。
- 缺什么：该范围未发现缺口；不把未接产品 API 的预览当作所有模块运行数据验收。

### [UI-09] 对话与输入高信噪比体验
- 结论：部分实现。
- 实现位置：`ConversationView.tsx:177–248,325–352,410–447` hydration/滚动/IME/发送停止；`MessageList.tsx` collapsed 集合及每条渲染；`ToolActivityRow.tsx:22`。
- 证据：本次 Conversation interaction 测试保护组合输入、手动历史滚动、onOpen、首次恢复及迟到响应；TaskComposer 测试覆盖 IME。Task 251 对组合事件的修复已存在，不重复原 F7。
- 缺什么：`:327` Stop 捕获错误后直接丢弃；不声称本地停成功，但失败无反馈，未满足停止失败可解释。会话输入仍是单行 input，缺按内容增高及 Shift+Enter 多行；MessageList 初始 collapsed 为空，工具参数直接铺开，还允许所有卡片隐藏，未落实工具细节默认折叠/错误不隐藏。>20 工具、审批、Diff 的真实任务可读性需运行验收；ARCH-06 还限制重连一致性。

### [UI-10] 响应式、可访问性与视觉终验
- 结论：需运行时验证。
- 实现位置：`App.tsx:72–88` focus trap；`DualSurfaceLayout.tsx:214–282` modal/inert/ARIA；styles/layout.css 响应式；既有 247 walkthrough 与 253 浏览器证据。
- 证据：`evidence/walkthrough-247/walkthrough-report.json` 是 7 个导航/主题步骤全通过，不能扩写为 E2E-01–14；`evidence/sessions/2026-10-21-codex-browser-verification-report.md` 有 37 张历史截图及明确缺失矩阵。本次 IAB 仅522×567预览抽屉与四选项；定向 DOM 单测不能证明 WCAG 对比度。
- 缺什么：当前构建对应 SHA、1440×900/1920×1080/2560×1440/1180/800/390×844，双主题双语言、200% 缩放、AA 4.5:1/3:1测量、真实执行/审批/失败/恢复/Diff 图证与 UX 签收。
- 复验步骤：在获准写隔离状态的产品服务中构建并记录 SHA/资产 hash；逐尺寸×主题×语言实跑首页、真实对话、Provider、命令面板、双抽屉；记录 Tab/Shift+Tab/方向键/Escape/焦点归还、scrollWidth 与对比度测量；200% 缩放重跑；提供执行态截图/录屏及同次脱敏事件。真实模型和外部 Agent 消费另行取得授权。**静态审计不能替代。**

## DoD 附加项

以下覆盖两规范最终 DoD 中不被单个实现包独立证明的横向要求；其余 DoD 分别映射 ARCH-01/02/03/04/05/06/07、UI-03/04/05/06/07/08/10，未遗漏。

### [DOD-GATES] 最终编辑后的 root/Web 类型、构建、双 root 全测
- 结论：部分实现。
- 证据：架构规范 `:256`；本次 Web tsc exit 1，10 条诊断见执行表；历史 `evidence/task255/test-all-rerun.log:113–128` 确有双 root 全绿。Task 254 较早 full-suite 失败不能被重复描述为最新全库结果。
- 缺什么：Web 类型门禁当前明确失败；历史构建/全测日志未以当前 HEAD/全部源码指纹组成同一次最终凭据。本契约禁止全测、仅授权报告写入，因此没有修复或生成新构建来凑绿。

### [DOD-REVIEW] 独立源码与 UX Reviewer 双签收
- 结论：部分实现。
- 证据：`evidence/sessions/2026-10-20-codex-adversarial-review-249.md:3,15–30` 为独立 FAIL 及反例；250/251/252/254 的修复证据、`evidence/task255/review.md` 为后续有限范围评审。本次为新的独立审计，结论保留缺口。
- 缺什么：没有找到最终全部 ARCH/UI 整改的无阻塞源码与 UX 双签收；已有评审不能扩充为全产品 UX 接受。规范 UI §11 的签收条款仍开放。

### [DOD-E2E] UI §6 的 14 个强制浏览器场景
- 结论：需运行时验证。
- 证据：规范 UI §6、§8.3、§11；253 报告明确只做六场景，254/255 报告明确修复后浏览器复验缺失。本次 API 不可用预览不能关闭业务 E2E。

| 场景 | 已有可核对支持 | 尚需本次版本实际验证 |
|---|---|---|
| E2E-01 无 Provider | TaskComposer onboarding 源码/单测 | 空配置真实启动与 mock 限制引导 |
| E2E-02 建任务只发一次 | createTaskSession/initialTask guard 测试，253 历史真实 turn | 当前构建首条发送计数与唯一 session |
| E2E-03 输出时切会话 | 代际/迟到响应单测 | 三会话流中切换与草稿隔离 |
| E2E-04 单删 500 | server 回收失败断言 | 故障响应下失败条目/重试 UI |
| E2E-05 topic 部分删失败 | App 成功过滤源码 | 三条两成功一失败及刷新 |
| E2E-06 工具失败/断网 | 后端错误状态、Journal、流测试 | Activity/恢复入口与用户错误反馈 |
| E2E-07 三类非会话跳转 | session kind guard 与通用 details | 实体详情及正确操作入口 |
| E2E-08 自定义 Provider | 后端绑定和模型/凭据单测、253 直测 | 当前新增→测试→重选闭环；真实联网需授权 |
| E2E-09 compile rejected | rejected/inactive 文案及编译路径 | 浏览器拒绝候选且不激活 |
| E2E-10 旧 cache tab | readInspectorState 与映射断言 | 实际旧存储→Diagnostics/Cache |
| E2E-11 800/390 抽屉 | 响应式/ARIA 单测，253 历史图 | 当前三面板、焦点/Escape/横向裁切 |
| E2E-12 审批/Diff/>20工具 | 各渲染器及接口存在 | 同一真实执行录屏、审批回执与 Diff 保全 |
| E2E-13 原生中文 IME | modeled composition 单测，253 明确原生未测 | Windows 候选确认 Enter/Shift+Enter |
| E2E-14 运行页刷新 | 254 持久化 HTTP/SSE 修复测试 | 当前浏览器 F5 运行态收敛 |

- 复验步骤：为每个场景准备独立隔离夹具与预期断言，记录当前 SHA；使用真实 Vessel API，删除只作用于明确授权的可丢弃夹具，故障通过受控注入；逐项保留操作、响应、最终投影、脱敏磁盘证据及截图。无真实模型授权先验证 mock 能覆盖的业务，不得把 mock 结果记成真实模型通过。**静态审计不能替代。**

### [DOD-SAFETY] 不永久删除、薄核与授权边界
- 结论：部分实现。
- 证据：本次 `rg -n 'rmSync|fs\.rm|unlinkSync|unlink\(' packages apps -g '*.ts' -g '!*.test.ts' -g '!*.d.ts' -g '!**/dist/**'` 仍定位 `packages/core/src/session/Session.ts:113,278` 永久移除用户 session lease；`packages/engine/src/workspace.ts:46` 永久清理传入 ws.root，`:84` 起委托 git worktree remove。249 报告 F6 已登记，未发现授权扩大书面例外的闭合记录。
- 缺什么：系统临时目录例外仅限“测试自己创建”，不包括生产 WorkspaceFactory 的临时目录；不能把这些旧路径认证为全仓回收站合规。它们不等于本次执行了删除，也不等于新 session DELETE 回收路径有永久删除。core 外的应用层机制位置符合薄核原则；本次零产品写入，未运行上述清理路径或外部 Agent。

### [DOD-HANDOFF] 当前/历史说明、回滚和交付凭据
- 结论：部分实现。
- 证据：架构 §5/§6、UI §8.4/§11；`README.md:19–35` 仍以2026-09-18的“当前 HEAD/CI 已绿”描述旧测试统计；HANDOFF 仍有235/234为当前、旧 HEAD/未提交范围，和最新236–256索引不一致。255 卡旧 Result/更新后的 native 复验并存，后者明确更正了早先根因。
- 缺什么：每卡最终 ChangedFiles/兼容/回滚/残留风险与当前事实指针尚不能一致核对；不应直接删除历史记录，而应明确历史标识及当前段落。此审计无权修改这些文档。

## 必须修的 P0

1. **虚假完成仍可达（已复现）**：ARCH-01/UI-02 的 team/subagent 四例。要求仅凭权威成功终态显示 completed；补全部 kind 的状态表与源信息，再复验刷新。不将 idle、approved、rejected、cancelled 当成功。
2. **删除事务阶段缺口（源码确认，未注入实跑）**：ARCH-02 的“回收成功→registry persist 失败”会留下目录/内存/持久索引不同阶段，并返回误导性的 recycle_failed。需要故障注入与可重试/对账的真实回执；同时补 UI-01 的逐项失败提示与两成功一失败回归。

ARCH-03 保守阻止未知写重放的控制已通过本次定向测试，不能为了把 P0 列表写满而说它完全没有实现；缺的是所述完整恢复证明。安全/构建/体验的其它缺口按各条记录，未在本次擅自修复。

## 文档要求与现状冲突处

- 卡236/244–247等“完成”并不等于原规范全部 AC：接口分离≠实际交互适配器；7步 walkthrough≠14场景；keepID/IME 修复≠整个压缩与流一致性完成。
- 卡241声称管理/添加已分离，与当前无条件 PresetsGallery 及其测试断言相反；缺口是视图分离，不是凭据直测不存在。
- 规范要求 sandbox 不可用不得默许写入；POSIX fallback 测试明确保留 passthrough，这是产品策略与规范的实质冲突。Windows Task256 的启动失败已有实测，不应标为泛泛“待测”。
- “目录单一”在架构最终 DoD 明确允许自动一致性测试；现有快照有这种测试，不能仅因两文件存在就判目录未实现。
- 249的 F1/F2/F3/F4/F5/F7 与253的历史恢复/pending-goal发现，须结合250–255的修复和本次源码重新判断。本报告没有重复把已经修复的路径当作当前未实现。F8 的有缓存断线补帧与F6的生产清理仍有当前源码支持。
- 旧 README/HANDOFF、255早期根因/失败门禁与后续修正并存：本报告采用较新的 native 复验及双 root rerun，同时保留本次 Web tsc 的实际失败。测试绿与类型失败可同时成立。

## 本次静态审计的边界

审计交付完成不代表架构或 UI 整改验收完成。19项均已逐条判定，另列5项横向DoD；按整包严格口径为 **2项已实现、16项部分实现、1项需运行时验证**。没有因为缺一个验收步骤就声称整个模块不存在。

本次只运行列出的定向测试、无写入探针、noEmit 类型检查，以及现有 dist 的有限浏览器壳层观察。未运行全量测试或构建；未测真实模型、外部 Harness、原生 OS IME、真实审批/写入/Diff、多工具长任务、实际断网30秒、F5运行态恢复、删除故障批次、完整尺寸主题语言缩放与对比度矩阵。UI-10与DOD-E2E必须在真实浏览器定；ARCH-01/02/03/06/07/08、UI-01/02/03/04/06/07/09中列明的运行态验收也不能由这次静态审计替代。没有把历史截图/测试数当作当前HEAD的产品绿灯。
