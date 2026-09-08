# TeamRuntime —— 多 Agent 协作运行时 + TeamProjection（task 057）

> 实现卡：`tasks/057-team-runtime-projection.md`；权威需求：`docs/Vessel_后续开发方向与产品化路线_v1.0.md`
> §8（L992-1080：默认团队 lead/developer/reviewer；路由 §8.2 决定启动几个；不新造 Agent 机制）。
> 前置：054/055（AgentPreset 体系 + 三角色实例 + SubagentManager.delegate presetLookup）、
> 056（AutoTaskRouter：`roles/roleModels` 输出，本卡输入）。
> 代码位置：
> - `packages/agents/src/team/`（types.ts / roster.ts / TeamRuntime.ts）—— 运行时组合器；
> - `packages/application/src/projections/TeamProjection.ts` —— 团队过程事件投影（060 UI 数据源）；
> - 词汇：`@vessel/shared` events.ts（team_start / team_phase / team_end + B10 source 'team'）。

## 1. 一句话

TeamRuntime 按 056 路由结果（或显式阵容）把 preset 化的 Agent 组合成一次团队运行
（小→1 developer / 中→2 developer+reviewer / 复杂→3 lead+developer+reviewer），
顺序驱动：**orchestrator 编排 → generator 产出 → evaluator 检查**；每个成员都跑在既有
AgentLoop/Session 机制上（隔离会话 / delegate 子代理），不新造 primitive；TeamProjection
把整场协作投影成事件（team/start、agent turn、delegate 关系、阶段切换、工具活动），供 060 消费。

## 2. 运行时组合

```ts
const runtime = new TeamRuntime({
  workspaceRoot,                     // 会话日志落盘根（.harness/sessions/<id>）
  providers: { pro, fast, review },  // providerId → ChatProvider（成员 providerId 查表）
  policyArtifacts,                   // 编译后的策略产物（与既有会话一致）
  tools,                             // 成员基座工具面（按 preset 能力面 shrink-only 收窄）
  presetRegistry?,                   // 缺省 = 默认三角色 registry（createDefaultPresetRegistry）
  bus?,                              // team EventBus（TeamProjection 挂接点）；缺省自建
});

// 输入：任务 + 路由决定（056 AutoRoute 结构子集 TeamRouteLike）或显式阵容（TeamRoster），二选一
const summary = await runtime.runTeam({
  task: '做一个登录功能',
  route: {                           // = AutoTaskRouter.resolve() 的输出（结构兼容，agents 不 import llm）
    complexity: 'complex',
    roles: ['lead', 'developer', 'reviewer'],
    roleModels: [                    // 每角色已解析 { role, tier, model, providerId }
      { role: 'lead', tier: 'pro', model: 'pro-model', providerId: 'pro' },
      // …
    ],
  },
  // roster: [{ presetId, memberId?, model, providerId, tier? }, …]   // 或显式阵容
});
```

- **route 路径**：`composeRosterFromRoute` 只消费 `route.roles`（§8.2 复杂度→角色计划已由 056
  产出，本层不重复复杂度表）+ `roleModels`（模型解析），把角色 preset id 翻译成带
  model/providerId 的成员计划；未知 preset / roleModels 与 roles 不对齐 → fail loud。
- **显式阵容路径**：`roster` 直接给成员行（memberId 缺省 = presetId）；空阵容 / 重复
  memberId / 空字段 / 未知 preset / provider 未绑定 → 在 `team_start` 之前抛错（调用方 bug，
  不产生任何事件）。
- 运行返回 `TeamRunSummary`（与 `team_end` 载荷同形：teamRunId/task/complexity/members/
  outcome/durationMs/error）。

## 3. 顺序驱动骨架（gen→eval）

每张 roster 行 = 一个阶段（role → phase 映射在 roster.ts `phaseForRole`）：

| preset role | phase | 语义 |
|---|---|---|
| `orchestrator`（lead） | `orchestrate` | 编排：产出实现计划/分工/验收要点 |
| `generator`（developer） | `generate` | 产出：直接实现任务 |
| `evaluator`（reviewer） | `evaluate` | 检查：按任务独立评估 generator 产出（只读面） |

- 执行顺序 = roster 顺序；**交接 = 前序成员产出进入后序 prompt**：lead 计划 → developer
  prompt；developer 产出 → reviewer prompt（"Generator 产出"节 + 明确要求独立核验、不信任自证）。
- **成员失败即中止后续阶段**（骨架 fail-fast），以 `outcome:'failed'` + `error` 收尾
  （不抛异常——运行失败是返回态）。
- **058 已接线 Internal Reviewer 真流程**：`TeamRunRequest.acceptance`（验收标准）进 evaluate
  阶段 prompt；evaluate 成员按 review JSON schema（`agents/src/reviewer/conclusion.ts`，与
  EvaluatorAgent review 模式同源）回复，运行体解析出**结构化评审结论**附到
  `TeamMemberSummary.review`（verdict met/not_met/impossible/error + reason + unmet +
  suggestions + evidence）→ 经 team_end 上投影阶段行。解析失败 = verdict 'error'（如实暴露、
  不误判 met）；not_met 的 unmet/suggestions 即回读反馈（Wave 3 rework 输入）。
  评审流程细节见 docs/INTERNAL-REVIEW.md。

## 4. 成员跑在既有机制上（复用，不新造）

| 成员形态 | 机制 | 会话/记录区分 |
|---|---|---|
| top-level 成员（小阵容 developer；中阵容 developer/reviewer；复杂阵容 lead） | `createIsolatedRuntime`（source `'team'`，回合 = 既有 `runTurn`） | B10 `session/created{source:'team', agentPreset: memberId}` |
| 复杂阵容中 lead 之后的 developer/reviewer | **真实 delegate**：`SubagentManager.delegate` + `presetLookup`（055 接线），父 = lead 的会话 | 子会话 B10 `session/created{source:'subagent', agentPreset, parentSession: <lead session>, delegationDepth:1}` |

- delegate 语义：只要 roster 含 orchestrator（§8.2 默认 lead@0），其后所有成员均以 lead 的
  子代理执行（子代理工具面先按 preset 能力面收窄——reviewer write:false → 只读面）。
- 本骨架由 TeamRuntime 作为运行宿主代 lead 发起 delegate（复用 055 的 delegate/presetLookup
  机制，子代理记录以 lead 会话为父）；模型驱动的"lead 经 Subagent 工具委派"路径是同一条
  SubagentManager 通道（`createSubagentTool` 注册进 lead 会话即可），留 058/060 场景接线。
- 分层：agents 源码不 import @vessel/llm —— `TeamRouteLike` 是 AutoRoute 的结构子集，
  AutoRoute 实例可直接传入（结构兼容由测试实证）。

## 5. 可观测性：团队事件词汇（TeamProjection 消费）

所有成员共享一个 team EventBus（`IsolatedRuntime.bus` 注入，见 `IsolatedRuntimeOptions.bus`）。
运行事实表达 = **复用既有词汇优先 + 057 按 EVENT-SPEC 规矩新增三个 emit 事件**（详见 EVENT-SPEC §5.H）：

| 事实 | 事件/记录表达 |
|---|---|
| team/start（阵容快照） | **`team_start`**（新增） |
| 阶段切换 / 成员激活 | **`team_phase`**（新增；`delegateOf` 标注 delegate 阶段的父成员） |
| team/end（逐成员摘要） | **`team_end`**（新增） |
| agent turn | 复用 `before_turn` / `after_turn`（team_phase 之后的事件归属当前成员窗口） |
| agent 工具 | 复用 `after_tool`（按当前成员归属） |
| delegate 关系 | 复用 `subagent_start` / `subagent_stop`（父成员 = 当前窗口的 `delegateOf`） |
| 成员会话出处 | 各会话 B10 `session/created`（source team/subagent + agentPreset + parentSession） |

> 为什么阶段切换需要新增 `team_phase`：既有事件没有"成员归属/阶段激活"锚点（turn 事件载荷
> 只有 turnId 不带会话/成员身份），投影无法把并发/顺序事件归到成员。TeamRuntime 严格串行
> 执行成员阶段，`team_phase` 即归属窗口标记，无需改 core 事件载荷。058/060 沿用同一词汇。

## 6. TeamProjection（040/052 投影模式）

```ts
const projection = new TeamProjection();
const detach = projection.attach(teamBus);   // 挂到 TeamRuntime.bus（共享）
const state = projection.state();            // TeamRunState | null
```

`TeamRunState`：run 元数据（runId/task/complexity/roster/status/outcome/error/时间）+
四类明细行：`phases`（阶段/成员/status/delegateOf/promptPreview/outputPreview）、
`turns`（成员回合归属）、`delegates`（父子关系/产出）、`toolActivities`（按成员工具活动）。
与其它投影一致：监听器只观察不短路决策点；`detach()` 注销；新 `team_start` 自动重置旧 run。
060 team 面板按本投影渲染（Lead/Developer/Reviewer 的活动、turn、阶段、产出摘要）。

> 058 扩展：evaluate 阶段行的 `review` 字段带**结构化评审结论**
> （`TeamReviewConclusion`：verdict/reason/unmet/suggestions/evidence）——评审判定与反馈
> 不靠解析文本，投影直接可断言；原始评审回复仍在 `outputPreview` 可回读。来源 =
> `TeamMemberSummary.review`（team_end 载荷）。

## 7. 范围边界（057 不做）

058 Internal Reviewer 真流程（结构化 met/not_met 与反馈回路）、059 External Handoff、
060 UI 各自成卡。本卡交付：阵容组合 + 顺序驱动骨架 + delegate 复用 + 团队投影 + 文档/测试。

## 8. 运行示例（完整）

```ts
import { TeamRuntime } from '@vessel/agents';
import { TeamProjection } from '@vessel/application';
import { AutoTaskRouter } from '@vessel/llm';
// providers/policy/tools 组装后：
const bus = runtime.bus;                 // 或构造时传入共享 bus
const projection = new TeamProjection();
projection.attach(bus);
const summary = await runtime.runTeam({ task, route });
console.log(summary.outcome, summary.members.map((m) => `${m.memberId}:${m.status}`));
```

## 9. Web / Local Server seam（task 060）

060 把本投影消费进 web Team 面板：`apps/local-server` 的 `createVesselServer` 现在持有
每个会话的团队 seam（`apps/local-server/src/teamSeam.ts`），对 web 暴露 REST + SSE：

- `GET/POST /api/sessions/:id/route*` —— 056 路由 seam（Auto/Fast/Pro 模式、resolve、
  pin/unpin），由 RouteSeam 复用 `@vessel/llm` 的 classify/complexity/roles/tiers/bindings
  纯函数链解析（与 AutoTaskRouter 同一来源）。
- `POST /api/sessions/:id/team-runs` —— 起一次真实 `TeamRuntime` 运行（mock 成员默认，
  `tierBindings/teamProviders` 可注入真实 provider 绑定）；每会话单运行互斥（409）。
- `GET /api/sessions/:id/team-runs/current` —— TeamProjection.state() 快照。
- SSE `/events` 新增 `type:'team'` 帧：每次 team_start/team_phase/before_turn/after_turn/
  after_tool/subagent_start/subagent_stop/team_end 事件推送**全量快照**（`{kind, state}`），
  web 无需增量协议。
- 050/051 的会话事件（conversation/tool/usage/policy）与 team 帧互不干扰（team 跑在独立
  EventBus，SSE 只做转发）。

详见 `docs/WEB-TEAM-UI.md`（web 消费端组件 + API 形状）。
