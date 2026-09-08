# 057 — TeamRuntime / TeamProjection（多 Agent 协作运行时 + 事件投影）

- 状态：待验收
- 优先级：P0（Wave 2 / Milestone D）
- 创建日期：2026-09-08
- 关联：054-056（preset/路由，前置）；058（Internal Reviewer）；060（team UI 消费投影）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §8（默认团队 lead/developer/reviewer；
  路由 §8.2 决定启动几个；不新造 Agent 机制——复用 049-051 已建的单 AgentLoop 能力）

## 目标

TeamRuntime：按 056 路由结果组合多个 preset 化的 Agent 协作用于一次任务（小→1 个 / 中→2 个 /
复杂→3 个），复用既有单 Agent loop 与 delegate 机制（不新造 primitive）；TeamProjection：把团队
协作过程投影为事件（给 060 UI），每个 agent 的 turn/工具/产出可观测。

## 验收标准（执行器逐条勾选）

- [x] TeamRuntime：输入任务 + 路由决定（或显式阵容）→ 组合 preset 化的 Agent；Lead 可 delegate 给
      Developer（复用既有 delegate/subagent 机制），Reviewer 可被调用评估（或留给 058 接真流程——
      本卡先保证"阵容可组合、可顺序驱动：generator 产出 → evaluator 检查"的骨架）
      —— roster 含 orchestrator（lead）时，其后 developer/reviewer 成员均以真实 delegate 机制
      （SubagentManager.delegate + presetLookup，055 接线）作为 lead 会话的子代理执行（骨架由
      TeamRuntime 作为运行宿主代 lead 发起；模型驱动路径 = 同一 manager 的 createSubagentTool，
      留 058/组装方）；reviewer/evaluator 成员以只读面运行，顺序骨架 gen→eval 交接 = developer
      产出进入 reviewer prompt
- [x] 每个团队成员跑在既有 AgentLoop/Session 机制上（复用，不新造）；会话/记录可区分团队成员
      —— top-level 成员 = createIsolatedRuntime（source 'team' + session/created.agentPreset）；
      delegate 子代理 = B10{source:'subagent', agentPreset, parentSession: <lead session>,
      delegationDepth:1}；测试读会话日志实证
- [x] TeamProjection：按既有 projections 模式（040/052 的 event projection 框架）投影团队过程：
      team/start、agent turn、delegate 关系、阶段切换等（命名/表达遵循 EVENT-SPEC 与 049/050 的
      "尽量不新增词汇、用既有记录/事件表达"惯例；确需新增按 EVENT-SPEC 规矩加并注明理由）
      —— 成员回合/工具复用 before_turn/after_turn/after_tool，delegate 关系复用
      subagent_start/subagent_stop；仅按 EVENT-SPEC §5.H 新增 3 个 emit 事件
      team_start/team_phase/team_end（阶段-成员激活锚点，理由见 EVENT-SPEC §5.H + TEAM-RUNTIME.md）
- [x] 测试：阵容组合/顺序驱动（gen→eval 骨架）/投影事件/异常路径，新增 ≥6 例；全量 vitest/tsc 绿
      （426+前卡新增数 无回归）—— 新增 21 例（roster 纯函数 6 + runtime 7 + 投影单测 6 + e2e 2）；
      全量 61 文件 496 测试全绿（基线 475 + 21），tsc 0 错误
- [x] 文档同步（TeamRuntime 用法）—— 新建 docs/TEAM-RUNTIME.md；EVENT-SPEC §5.H 实现注记；
      AGENT-PRESETS.md §5/§6 接线状态与决策同步
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 骨架 + 投影。058（Internal Reviewer 真流程）、059（External Handoff）、060（UI）各自成卡。
- 不新造 Agent primitive；不加新依赖。

## 涉及文件（指针，执行器自行精化）

- packages/agents/src/ 或新 team 模块（运行时组合）
- 既有 AgentLoop/Session/delegate（packages/core/agents）
- projections 框架（packages/application/src/projections/）
- 054/055 preset 体系

## 方法

- 读 §8 与既有 delegate/subagent 实现；TeamRuntime 作为组合器驱动 preset agents
- TeamProjection 照 040/052 投影模式；复用事件与记录词汇优先

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 执行器回填（2026-09-09，隔离子代理完成；全量 vitest 61 文件 / 496 测试全绿，tsc 0 错误）

### 改动文件 + diff 摘要

| 文件 | 改动 |
|---|---|
| `packages/shared/src/events.ts` | 词汇新增（EVENT-SPEC §5.H 规矩）：EventType 增加 `team_start`/`team_phase`/`team_end` + 载荷类型（TeamRoleName/TeamPhaseName/TeamMemberBrief/TeamStartPayload/TeamPhasePayload/TeamMemberSummary/TeamEndPayload）；B10 `SessionCreatedRecord.source` 扩展判别值 `'team'` |
| `packages/agents/src/subagent/IsolatedRuntime.ts` | `IsolatedRuntimeOptions` 新增可选 `bus?: EventBus`（成员会话加入团队总线，缺省自建=旧行为不变）+ `IsolatedSessionSource` 增加 `'team'` |
| `packages/agents/src/team/types.ts`（新建） | TeamRuntime 域类型：TeamMemberSpec/TeamRoster/TeamRouteLike（AutoRoute 结构子集，agents 不 import llm）/TeamRunRequest/ResolvedTeamMember/TeamRunSummary |
| `packages/agents/src/team/roster.ts`（新建） | 纯函数：phaseForRole（role→orchestrate/generate/evaluate）、phaseForPresetId、composeRosterFromRoute（route.roles+roleModels→roster，未知 preset/长度不对齐 fail loud）、normalizeRoster/resolveRoster（补默认 memberId、重复/空字段校验、preset/role/phase 解析） |
| `packages/agents/src/team/TeamRuntime.ts`（新建） | 组合器：runTeam = team_start → 逐阶段（team_phase）→ team_end；无 lead 阵容成员为 top-level 隔离会话（source 'team'），含 lead 阵容其后成员以 SubagentManager.delegate+presetLookup 作为 lead 子代理执行；gen→eval 交接（lead 计划→developer prompt、dev 产出→reviewer prompt）；成员失败中止后续阶段（outcome failed + error）；结构性错误在任何事件前抛 |
| `packages/agents/src/team/team-roster.test.ts`（新建） | 6 例（phase 映射/route 三档组合/未知 preset/对齐校验/normalize/resolve） |
| `packages/agents/src/team/team-runtime.test.ts`（新建） | 7 例（小阵容事件序+会话记录可区分/中阵容 gen→eval 交接/复杂阵容 delegate 关系+子会话记录/056 AutoTaskRouter 真实产物直喂/成员失败中止/BeforeDelegate deny/结构性错误 fail loud） |
| `packages/agents/src/index.ts` | `export *` team 模块 |
| `packages/application/src/projections/types.ts` | TeamRunState + TeamPhaseRow/TeamTurnRow/TeamDelegateRow/TeamToolRow 查询类型 |
| `packages/application/src/projections/TeamProjection.ts`（新建） | 040/052 投影模式：attach(bus)→detach；订阅 team_start/team_phase/team_end + before_turn/after_turn/after_tool + subagent_start/subagent_stop，state() 暴露 run/阶段/回合/delegate/工具行（输出预览限长） |
| `packages/application/src/projections/teamProjection.test.ts`（新建） | 6 例（空态/中阵容事件流/复杂 delegate 关系/失败闭合/工具归属/detach+多 run 重置） |
| `packages/application/src/team/team-runtime.e2e.test.ts`（新建） | 2 例（TeamRuntime×TeamProjection 同 bus e2e：中/复杂阵容投影态） |
| `packages/application/src/projections/index.ts` | 导出 TeamProjection |
| `docs/TEAM-RUNTIME.md`（新建） | TeamRuntime/TeamProjection 用法（组合/骨架/复用表/词汇表/投影 API/范围边界/示例） |
| `docs/EVENT-SPEC.md` | §5.H 实现注记：team_start/team_phase/team_end 三事件卡 + 理由（既有 turn 事件不带成员身份 → 需阶段激活锚点；成员回合/工具/delegate 复用既有词汇）+ B10 source 'team' 说明 |
| `docs/AGENT-PRESETS.md` | §5 映射表接线状态：tools/write/canDelegate/modelTier 标注 057 TeamRuntime 接线点；§6 类别 agentPreset 标签解析决策更新（route 路径 057 已消费；compose 主会话标签路径留组装方） |
| `tasks/057-team-runtime-projection.md` | 本卡（状态/验收勾选/工作证明） |

### 新增测试数与命令输出

- 新增 21 例：team-roster.test.ts 6 + team-runtime.test.ts 7 + teamProjection.test.ts 6 +
  team-runtime.e2e.test.ts 2。
- 定向验证（本机 vitest v2.1.9 可直跑，非受限环境）：
  `npx vitest run packages/agents/src/team/team-roster.test.ts packages/agents/src/team/team-runtime.test.ts`
  → 13 passed；`npx vitest run packages/application/src/projections/teamProjection.test.ts
  packages/application/src/team/team-runtime.e2e.test.ts` → 8 passed。
- 全量验证：`npx vitest run` → **61 files / 496 tests all passed**（基线 475 + 本卡新增 21；
  VITEST_EXIT:0，零失败零回归）；`npx tsc -b tsconfig.json --pretty false` → **TSC_EXIT:0**。

### 设计选择与理由

1. **TeamRuntime 放 agents/team 新模块，agents 源码零 @vessel/llm 依赖**：056 AutoRoute 以结构类型
   TeamRouteLike 消费（roles+roleModels），AutoRoute 实例直接传入（e2e 用真 AutoTaskRouter 实证）；
   分层铁律保持（llm 只透传 preset id，agents 只消费数据）。
2. **成员复用 IsolatedRuntime 而非新 primitive**：只给 IsolatedRuntimeOptions 加一个可选
   `bus`（成员会话加入团队总线），回合仍是既有 runTurn；B10 source 扩展 'team' 判别成员出处。
3. **delegate 语义 = roster 含 orchestrator（lead@0）时其后成员均以真实 SubagentManager.delegate +
   presetLookup（055 接线）执行**，父会话 = lead 的 session（子代理 B10 parentSession/delegationDepth
   表达 delegate 关系，复用 A23/A24 事件上团队总线）；无 lead 的阵容（小/中）由运行体顺序驱动
   top-level 成员会话。骨架由 TeamRuntime 代 lead 发起委派（确定性、可测）；模型驱动的
   "lead 经 Subagent 工具委派"是同一条 manager 通道（createSubagentTool 注册进 lead 会话即可），
   明确留给 058/组装方——不为此在骨架里引入模型调度不确定性。
4. **gen→eval 顺序骨架 = roster 序阶段机**，交接用 prompt 中继（lead 计划→developer；
   developer 产出→reviewer 独立评估 prompt，明示"不信任自证"）；058 在此骨架把 reviewer 阶段换成
   结构化 met/not_met 真流程。
5. **词汇只新增 3 个 team emit 事件**：成员回合/工具（before_turn/after_turn/after_tool）与
   delegate 关系（subagent_start/stop）全部复用既有事件——049/050"不新增词汇"惯例；team_phase
   的必要性：既有 turn 事件载荷不带成员/会话身份，投影无法归属 → team_phase 即"阶段-成员激活
   锚点"（TeamRuntime 严格串行，事件窗口归属确定）。持久记录不新增：成员出处走既有 B10
   （source 'team'/'subagent' + agentPreset + parentSession）。
6. **运行失败是返回态不是异常**：成员失败中止后续阶段（骨架 fail-fast），team_end 仍发出
   （outcome failed + error + 已完成员摘要），投影闭合不悬空；结构性错误（空任务/空阵容/未知
   preset/provider 缺失/roster 与 route 同给）在任何事件前抛出（调用方 bug，fail loud）。
7. **TeamProjection 照 040/052 投影模式**（attach/query、只观察不短路决策点、detach 注销、新 run
   重置）；state() 面向 060 渲染（run 元数据 + phases/turns/delegates/toolActivities 四类明细）。

### 踩坑记录

- TeamProjection 阶段行状态语义反复：初版用中间态 'done'，与运行体摘要的终态
  'completed'/'failed' 冲突（测试暴露：期望 'done' 实得 'completed'）。定稿：行状态 =
  'running' →（下一 team_phase 到达，说明前一成员成功推进）'completed' → team_end 摘要逐行落定
  （failed 成员 'failed'）；类型与测试同步改正。
- IsolatedRuntime 共享总线事件归属问题：成员回合事件载荷（turnId）无成员身份，曾设想改 core
  载荷——超出薄核纪律；改为运行时按串行阶段发 team_phase 锚点，投影按窗口归属（零 core 改动）。
- TeamRuntime 初稿把 delegate 写成"lead loop 内由模型调 Subagent 工具"的形态，引入模型调度
  不确定性且需在 lead 会话里预注册 manager（parentSession 先有 lead session 才能建 manager，
  鸡生蛋）；重构为运行体代 lead 逐阶段 delegate（manager 每阶段按该成员 provider/model 现建，
  parentSession 恒为 lead session），骨架确定性成立，机制仍是 055 的 delegate+presetLookup。
- 056 集成测试的 MockProvider 脚本误配：lead 与 developer 共用同一 provider 实例时
  /Lead|编排/ 会先命中 developer 的 prompt（含 "Lead 计划" 字样）→ 改为 /编排/ 独配 lead、
  developer 用兜底条目，脚本匹配唯一化。
- vitest 本会话可直跑（无 EPERM），全程本地验证，无受限环境降级记录。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
