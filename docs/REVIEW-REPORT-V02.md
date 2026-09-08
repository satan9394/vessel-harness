# V0.2 独立核验报告（Evaluator Review Report）

> 核验对象：Composable Agent Harness V0.2 实现（docs/MISSION-V0.2.md 第六节 7 条验收标准）

> ⚠ 历史快照（V0.9 改名后）：文内 cah / CAH_* / @cah 为当时名称，现已迁移为 vessel / VESSEL_* / @vessel（见 docs/VESSEL.md）。
> 核验角色：独立 Evaluator（Generator/Evaluator 分离——本报告作者不参与实现，只做取证核验）

> ⚠ 历史快照（V0.9 改名后）：文内 cah / CAH_* / @cah 为当时名称，现已迁移为 vessel / VESSEL_* / @vessel（见 docs/VESSEL.md）。
> 核验日期：2026-09-05（后补独立核验）

> ⚠ 历史快照（V0.9 改名后）：文内 cah / CAH_* / @cah 为当时名称，现已迁移为 vessel / VESSEL_* / @vessel（见 docs/VESSEL.md）。
> 工作区：`C:\work\Vessel_Harness`（Windows / PowerShell / Node v24.14.0 / git 2.53.0 / vitest 2.1.9）

> ⚠ 历史快照（V0.9 改名后）：文内 cah / CAH_* / @cah 为当时名称，现已迁移为 vessel / VESSEL_* / @vessel（见 docs/VESSEL.md）。
> 权威依据（已通读）：docs/MISSION-V0.2.md（§3 范围 / §4 硬性约束 / §6 验收）、docs/V02-PROGRESS.md、docs/V02-IMPLEMENTATION-NOTES.md（实现方自述——以下每条独立实测，不采信自述）、回查 docs/EVENT-SPEC.md（A/B 事件词汇）、docs/ARCHITECTURE.md、docs/DESIGN-DECISIONS.md、docs/REVIEW-REPORT-V01.md（V0.1 基线）。

> ⚠ 历史快照（V0.9 改名后）：文内 cah / CAH_* / @cah 为当时名称，现已迁移为 vessel / VESSEL_* / @vessel（见 docs/VESSEL.md）。

---

## 〇、总体结论

**VERDICT: PASS**（无阻断、无未解决 MAJOR）

V0.2 六项范围（Subagent / Planner / Evaluator Agent / MCP / Parallel Exploration / Git Worktree）全部为**真实实现而非空壳**，且有实质性的机器断言测试。本环境为非沙箱环境（真实子进程可用），实现方自述中的「沙箱 EPERM」环境限制在本核验中不存在：`npx vitest run` 104 全绿（含真实子进程用例）、`npx tsc -b` exit 0。额外补做了实现方标注为「沙箱内未运行时验证」的两项冒烟——MCP `StdioTransport` 真实 spawn 与真实 git worktree round-trip——**均通过**。仅记录 1 条 MINOR（`plan` source 在 EVENT-SPEC 词汇中为代码先行、规范后补）与若干观察项。

**核验方法清单（全部独立执行）：**

| # | 命令/动作 | 结果 |
|---|---|---|
| 1 | `npx vitest run` | **18 files / 104 tests 全绿**（exit 0，含真实子进程的 Shell 用例） |
| 2 | `npx tsc -b tsconfig.json` | **exit 0** |
| 3 | 核心文件精读（15 个 V0.2 文件，每个逐行读） | 无空壳，逻辑完整 |
| 4 | `@vessel/*` import 图谱全仓 grep | 依赖方向正确、无反向/环依赖 |
| 5 | EVENT-SPEC A22–A25/B10 词汇比对 | 代码落地与规范一致（1 条 MINOR，见 §二-6） |
| 6 | runner.test.ts B001–B005 + B016–B019（vitest 内） | 全过 |
| 7 | 独立跑 `runScenario` B016–B019（offline lane，临时目录） | success=true 全过，断言逐条 pass |
| 8 | **StdioTransport 真实 spawn 冒烟**（dist fixture echo-server，node 直跑） | initialize/tools/list/tools/call(add 40+2=42) 全通过 |
| 9 | **真实 git worktree 冒烟**（git 2.53，临时仓库 add/list/remove round-trip） | 通过，remove 后 worktree 数归 1 |

全程 PowerShell；未修改任何实现代码（只读审查）；唯一写入的仓库文件是本报告 + 审查期间产生的临时输出已按回收站纪律清理；本仓库根目录无 `.git`（非 git 工作区），未做任何 git 写操作。

---

## 一、逐条验收结果

### 验收 1 — V0.2 范围内每项可运行代码 + Vitest 测试通过；`npx vitest run` 全绿 + `npx tsc -b` exit 0　**PASS**

**证据（实际命令输出节选）：**

```
$ npx vitest run
 RUN  v2.1.9
 ✓ packages/agents/src/planner/planner.test.ts (8 tests)
 ✓ packages/tools/src/registry/parallel.test.ts (5 tests)
 ✓ packages/context/src/context.test.ts (5 tests)
 ✓ packages/tools/src/mcp/mcp.test.ts (6 tests)
 ✓ packages/agents/src/evaluator/evaluator-agent.test.ts (6 tests)
 ✓ packages/agents/src/subagent/subagent.test.ts (7 tests)
 ✓ packages/tools/src/git/worktree.test.ts (5 tests)
 ✓ packages/policy/src/policy.test.ts (11 tests)
 ✓ packages/llm/src/provider.test.ts (4 tests)
 ✓ packages/tools/src/tools.test.ts (10 tests)   [含真实子进程 Shell 用例]
 ✓ packages/core/src/session/Session.test.ts (5 tests)
 ✓ packages/core/src/agent-loop/AgentLoop.test.ts (5 tests)
 ✓ packages/behavior/src/compiler/Compiler.test.ts (3 tests)
 ✓ packages/core/src/events/EventBus.test.ts (5 tests)
 ✓ packages/telemetry/src/telemetry.test.ts (1 test)
 ✓ packages/agents/src/evaluator.test.ts (4 tests)
 ✓ apps/cli/src/cli.test.ts (4 tests)
 ✓ benchmarks/runners/src/runner.test.ts (10 tests)

 Test Files  18 passed (18)
      Tests  104 passed (104)
   Duration  5.04s
```

104 tests = V0.1 的 63 + V0.2 新增 41（planner 8 + subagent 7 + evaluator-agent 6 + parallel 5 + mcp 6 + worktree 5 + runner B016–B019 4 组）。实现方自述中「4 项环境 EPERM 失败」在本环境**不存在**：`tools.test.ts` 的 Shell 真实子进程用例与 runner 的 run_check 用例（B003–B005 相关路径）均实测通过。104 全绿为**真实结果，非回归**。

```
$ npx tsc -b tsconfig.json
tsc exit code: 0
```

V0.2 六个模块的可运行代码与对应测试文件：

| 里程碑 | 源码 | 测试（vitest 实测全过） |
|---|---|---|
| Subagent | packages/agents/src/subagent/{SubagentManager,IsolatedRuntime,createSubagentTool}.ts | subagent.test.ts (7) |
| Planner | packages/agents/src/planner/Planner.ts | planner.test.ts (8) |
| Evaluator Agent | packages/agents/src/evaluator/{Evaluator,EvaluatorAgent}.ts | evaluator-agent.test.ts (6) |
| MCP | packages/tools/src/mcp/{McpClient,mcpTools}.ts + fixtures | mcp.test.ts (6) |
| Parallel | packages/tools/src/registry/parallel.ts | parallel.test.ts (5) |
| Worktree | packages/tools/src/git/Worktree.ts | worktree.test.ts (5) |

### 验收 2 — Subagent 端到端：主 Agent 派生 1 个子代理完成独立任务并回传结果　**PASS**

**证据：**
- 端到端场景 `benchmarks/scenarios/B016.yaml`（fixtures/B016/task.md）经 runner 实测 success=true，断言逐条：`file_content:pass`（final_text 含 `CHILD-ANSWER-77`）、`event_seen:pass`（tool/call toolName 匹配 `^Subagent$`）、`tool_family_seen:pass`。offline lane（OFFLINE_SCRIPTS.B016）驱动父代理发一次 `Subagent` 工具调用、子会话独立回 `CHILD-ANSWER-77`、父上下文收到结果摘要。
- 单元测试 `subagent.test.ts` 实证（非口头）：委派后 childSessionId ≠ 父会话；childSessionId 长度 >0；子会话日志 `session.jsonl` 含 `session/created` + `source:subagent` + `delegationDepth:1` + `parentSession:parent-sess-1`（隔离上下文真实落盘）；并发上限（maxConcurrent:1 时第二委派 stopReason=denied、diagnostic 含 concurrency）；深度上限（maxDepth:1 时 depth≥1 委派 denied）；info hiding（父会话 replay 无子代理中间 tool/call 与内部消息）。
- compose 接线（apps/cli/src/compose.ts）：`subagent.enabled` 时创建 SubagentManager + `Subagent` 工具（requiredPermission: workspace-write），注册进同一 ToolRegistry → 走同一条 BeforeTool→Policy→Execute→AfterTool 链。registry deny（deniedTools:['Subagent']）→ DENIED 实测通过。

**实现审读（SubagentManager.ts）**：服务端 fail-closed 上限先于事件检查（depth/concurrency 各自 deny 路径返回 stopReason='denied'、isError=true）；A22 `before_delegate` waterfall（gate deny/ask → denied）；子工具集 shrink-only（child ⊆ parent，Subagent 默认剔除防递归，再叠加 maxDepth 双保险）；A23 `subagent_start` emit → 子会话 runTurn → A24 `subagent_stop` emit（结果契约冻结：output/structured/diagnostic/stopReason）→ A25 `after_delegate` serial（槽释放 finally active-=1）。isError = stopReason≠completed。真实逻辑，非空壳。

### 验收 3 — Planner + Evaluator Agent：规划→执行→独立评估→PASS/FAIL 证据闭环　**PASS**

**证据：**
- **Planner**：`Planner.ts` 提供 createPlan（fail-loud 校验：goal 必填/≥1 step/每 step ≥1 acceptance/id 唯一）、formatPlan、injectPlan（作为 `user/message` + `source:'plan'` 一等对象注入上下文、可回放）、executePlan（每步 run→独立 StepEvaluator 判定，not_met 重试至 maxAttemptsPerStep，整体 verdict = 每步 met + plan 级 acceptance 复合判定，evidence/reason 全量记录）、generatePlan（LLM JSON 解析、失败 fail-loud throw）。planner.test.ts (8) 全过：plan 级 acceptance 覆盖 step 级输出的复合判定、重试耗尽转 not_met 带证据、非 JSON fail-loud 均实证。
- **Evaluator Agent**：`EvaluatorAgent.ts` 用 createIsolatedRuntime(source='evaluator') 开**独立隔离会话**，工具面 = createReadOnlyExplorationTools（Read/Glob/Grep，evaluator-agent.test.ts 实证无 file_write 族、visibleTools 恰为 ['Glob','Grep','Read']）；评审 brief 明确「不信任任何自证」；输出解析为 met/not_met/impossible/error + evidence[] + reason；非 JSON 输出 → verdict:'error'（fail loud，不误判通过）。**Generator 不可自证**：evaluator-agent.test.ts 端到端实证——Generator 子代理产出（自证「实现了 computeFee」）→ 独立 EvaluatorAgent 判 not_met + evidence（"没有测试通过证据"），由 evaluator 的判定管辖。
- **闭环场景**：B017（规划→注入 source=plan 记录→步骤验收驱动 Evaluator→"计划执行通过"）+ B018（Generator 产出→独立 Evaluator Agent 判 not_met + 证据→回投父上下文 source=inject），runner 实测均 success=true（B017: file_content:pass + record_seen source=plan:pass；B018: file_content 含 not_met/缺少证据 + record_seen source=inject:pass）。
- runner.ts `driveScenario` 的 planner/evaluator 驱动为真实接线：planner 分支调 generatePlan→injectPlan→executePlan（acceptance 子串确定性评估）→汇总文案；evaluator 分支跑 Generator 后 new EvaluatorAgent + 独立 mock provider + 只读工具，verdict 回写父会话。

### 验收 4 — MCP：本地 stdio fixture server 工具注册 + policy 裁决（deny 生效）　**PASS**

**证据：**
- **真实 stdio 实现**：`McpClient.ts` StdioTransport 用 `node:child_process.spawn(process.execPath, [serverPath])` 派生真实子进程，行分隔 JSON-RPC 2.0 over stdin/stdout（pending Map 按 id 配对、超时 kill 清理）；fixture `echo-server.ts` 是**可独立运行**的 stdio server 入口（readline 逐行读 stdin → handleMcpRequest → stdout 写回），`echoServerCore.ts` 提供 initialize/tools/list/tools/call 协议核心（echo/add 两工具）。in-process transport 供测试/离线车道复用同一协议核心。
- **动态注册**：`registerMcpTools` 将远端工具以 `mcp__<server>__<tool>` 注册进同一 ToolRegistry（Registry.ts 新增 register/unregister），走同一 BeforeTool→Policy→Execute→AfterTool 管线。mcp.test.ts (6) 实证：tools/list 列 add/echo、registry 可见 `mcp__demo__add/echo`、callTool 回显、schema 映射、**deny 规则对 MCP 工具生效**（denied_tools deny `mcp__demo__add`；Executor pre-execute 再查 → DENIED；scoped rule `match:'mcp__demo__add'` → deny + ruleRef，同名 echo 放行）。
- **补充运行时验证（超出单测）**：本环境真实 spawn 可用，直跑 dist fixture server 冒烟：
  ```
  initialize: {"name":"echo-server","version":"1.0.0"}
  tools: echo,add
  add(40,2) = 42
  STDIO-SMOKE-OK
  ```
  即实现方自述「StdioTransport 未在沙箱内运行时验证」的缺口在本核验中**已补上并通过**。
- B019 场景（mcp__demo__add 注册并执行 40+2=42）offline 实测 success=true：file_content:pass（含 42）、event_seen:pass（`^mcp__demo__add$`）、tool_family_seen:pass。

### 验收 5 — V0.1 benchmark B001–B005 不回归；新增 ≥2 个 V0.2 scenario 可跑　**PASS**

**证据：**
- `benchmarks/runners/src/runner.test.ts` vitest 实测 10 tests 全过：B001–B005 五组（每组 60s 超时上限）+ B001 no_mutation/no_tool_family 专项 + **B016–B019 四组**（新增 4 个 ≥ 任务书要求 ≥2）。B001–B005 断言全 pass ⇒ V0.1 benchmark 无回归。
- **offline 判定机器化确认**（任务书要求非口头通过）：pass 判定完全来自 `manifest.pass` 的 AssertionSpec，由 `asserts.ts runAssert` 机器执行——file_content（读 final_text/磁盘文件，缺 golden 即 fail，B005 含独立重算 golden_expr 的 JSON 字段比较）、event_seen（正则匹配会话 tool/call 记录）、record_seen（会话记录类型 + source 匹配）、no_mutation（sha256 全文件快照前后比对）、tool_family_seen / no_tool_family（扫描 tool/call 记录家族）。runner.ts 末尾 `success = assertResults.every(pass)` 并写 JSONL + summary.json。mock provider（offline.ts）只决定「走哪条剧本路径」，**判定不信任 mock 自报**——判据是磁盘证据与会话记录。B016/B019 补充独立 runScenario 实测 success=true 与 vitest 一致。
- B016–B019 scenario yaml 齐全（benchmarks/scenarios/B016.yaml…B019.yaml）+ fixture task.md 齐全。

### 验收 6 — 交付说明更新（V02-IMPLEMENTATION-NOTES.md）　**PASS**

**证据：** docs/V02-IMPLEMENTATION-NOTES.md 完整：新增模块地图（相对 V0.1 逐文件列出）、架构/规范对齐（Core 薄核不变、Subagent=Session 同构复用、Evaluator 非新原语、MCP 唯一动态扩展通道、依赖零环方向）、运行方式（tsc / vitest / 沙箱验证通道 / MCP fixture 启动命令）、测试清单、已知限制 7 条与 V0.3 建议。与实测一致（除 §5/§6 中沙箱 EPERM 相关描述——本非沙箱环境不存在该限制，属实现会话环境记录而非代码缺陷，V02-PROGRESS.md §0/§1 已如实标注其会话背景）。README 级交付说明在既有 docs 体系内更新充分。

### 验收 7 — 独立审查 PASS（7 条核验 + 依赖方向 + Gen/Eval 分离 + 无 V0.1 回归）　**PASS**

本报告即验收 7 的交付物。依赖方向、Gen/Eval 分离、事件词汇三项专项核验见 §二。

---

## 二、专项核验

### 1. 抽查代码真实性（非空壳）

15 个 V0.2 核心文件全部逐行精读（60–284 行，含 doc 注释与完整逻辑），非空壳。代表性确认：
- **SubagentManager.ts**：fail-closed 上限→A22 waterfall→A23/A24 emit→A25 serial 全接线；isError/stopReason 契约、info hiding、clamp [1,3]。
- **IsolatedRuntime.ts**：真实组装 Session+EventBus+PolicyEngine+ToolRegistry+Executor+ContextBuilder+Compaction+AgentLoop 的隔离会话工厂，子会话 `session/created` 落盘带 source/depth/parentSession。
- **Planner.ts**：Plan 一等对象四操作 + executePlan 步骤验收驱动 Evaluator。
- **EvaluatorAgent.ts**：隔离会话 + 只读工具面 + met/not_met/impossible/error + evidence；Generator 自证被明示「仅供参考需证据核验」。
- **McpClient.ts/mcpTools.ts + fixtures**：真实 spawn stdio 传输 + JSON-RPC 协议 + `mcp__<server>__<tool>` 动态注册（上冒烟通过）。
- **parallel.ts**：ParallelScheduler 读写分流（file_read/search 读并发滚动池 clamp [1,3]，写/独占串行屏障，结果按输入序稳定）；timing-gate 测试实证并发真并行（deferred gate 验证 C 在 A/B 释放前不启动、写不越过在飞读、后续读等写完成）。
- **Worktree.ts**：GitRunner 可注入 + defaultGitRunner（runCommand 真实 git）+ sanitizeBranch + porcelain 解析；上真实 git round-trip 通过。

### 2. 依赖方向 / 环依赖

全仓 `@vessel/*` import 扫描（含 grep `from '@vessel/agents'`）结论：
- **无反向/环依赖**。core/ 不 import 任何机制包（仅 AgentLoop.test.ts 测试文件 import llm/tools/runtime——测试装配，非模块依赖，且与 V0.1 相同形态）。tools/ 无 agents import。context/policy/runtime/shared 均无 agents import。
- 唯一 `@vessel/agents` 消费方为组合根：apps/cli/src/compose.ts 与 benchmarks/runners/src/runner.ts（设计允许的组合根）。agents→{core,context,policy,runtime,tools,llm,shared}；tools→{shared,core,runtime,policy}。包级 package.json 均声明 deps=[]（workspace 别名经 tsconfig paths），tsc -b exit 0 佐证无编译环。
- 新代码未给 core 加 import（Core 薄核保持，V0.2 机制全部挂在 core 之外 seam 上，符合 DESIGN-DECISIONS/ARCHITECTURE）。

### 3. Generator/Evaluator 分离

- Subagent 子代理产出 stopReason≠completed ⇒ isError，且结果不构成完成证明（注释与测试双重确认）；Planner 步骤验收与 Evaluator Agent 均为独立判定方。
- Evaluator Agent 在隔离会话中运行，工具面只读（Read/Glob/Grep），Generator 产出只是其评审数据；`error`/非 JSON 输出 fail loud 不产生误判通过（evaluator-agent.test.ts 实证 verdict:'error' 当输出非 JSON）。
- 端到端实证（evaluator-agent.test.ts「Generator/Evaluator separation end-to-end」）：Generator 自证「实现了 computeFee」被独立 Evaluator Agent 判 not_met——**Generator 不可自证**成立。

### 4. 事件词汇一致性（A22–A25 / B10）

`packages/shared/src/events.ts` 新增 EventType：`before_delegate`/`subagent_start`/`subagent_stop`/`after_delegate`，对应 EVENT-SPEC 表 A A22 BeforeDelegate（waterfall）/ A23 SubagentStart（emit）/ A24 SubagentStop（emit）/ A25 AfterDelegate（serial）。与规范比对：
- flow 一致：A22 代码走 bus.waterfall ✓（草案规定 waterfall）；A23/A24 走 emit ✓（新增规定 emit）；A25 走 serial ✓（草案规定 serial）。
- 载荷字段对齐：A22 载荷含 delegateId/toolName/request{prompt,preset,options}/delegationDepth/concurrencyState{activeChildren,maxConcurrent}（与 EVENT-SPEC A22 载荷字段一致）；A24 result 契约 {output,structured?,diagnostic?,stopReason} + isError(stopReason≠completed) + durationMs + delegationDepth ✓；A25 followUp{continuable:false,canSendMessage:false} ✓（EVENT-SPEC A25 预留字段，V02 一次性委派如实置 false）。
- B10 `session/created`：IsolatedRuntime 落盘 source='subagent'/'evaluator'（EVENT-SPEC B10 source 枚举含 'subagent'）+ parentSession + delegationDepth ✓（子代理派生按来源记 session/created，符合 B10「子代理派生」触发口径）。事件命名体系：A/B 事件在共享层落地为 snake_case 事件串（V0.1 既有约定，非 V0.2 引入的不一致——EVENT-SPEC 命名约定是 CamelCase 钩子名，但既有 V0.1 core EventBus 事件即用 snake_case 字符串如 before_tool/policy_decision，V0.2 沿用同一 codebase 约定，跨版本一致）。
- **MINOR-1**：B01 `user/message` 的 `source` 在 EVENT-SPEC（行 367）词汇为 `user/steering/inject/skill-instructions/compacted-summary`（无 'plan'），代码新增 `'plan'`（shared/events.ts）用于 Planner 注入——属于「规范先行、代码后补」的倒挂（新增事件/字段须走声明合并 + 本文件修订，EVENT-SPEC 行 525 纪律），建议 EVENT-SPEC 补 'plan' source 条目。属 MINOR，不影响功能正确性（injectPlan 的 source=plan 在 B017 被 record_seen 断言机器验证通过）。
- 同理 B10 source 枚举代码为 `'startup'|'resume'|'fork'|'clear'|'compact'|'subagent'|'evaluator'|'plan'`，比 EVENT-SPEC 行 161 的 `'startup'|'resume'|'fork'|'clear'|'compact'|'subagent'` 多 evaluator/plan 两个来源——扩展方向与 spec 兼容（超集），EVENT-SPEC 未同步列出，并入 MINOR-1。

---

## 三、问题分级

### 阻断（BLOCKER）
无。

### 主要（MAJOR）
无（无未解决 MAJOR）。

### 次要（MINOR）

| # | 位置 | 说明 |
|---|---|---|
| MINOR-1 | packages/shared/src/events.ts L26/L138 vs docs/EVENT-SPEC.md L161/L367 | B01 `source:'plan'` 与 B10 `source:'evaluator'|'plan'` 为代码先行、规范后补（EVENT-SPEC 未列出）；按 EVENT-SPEC L525「新增事件须走声明合并 + 本文件修订」纪律应回补 EVENT-SPEC。功能正确（record_seen 断言实证），纯文档同步缺口。 |
| MINOR-2 | docs/V02-IMPLEMENTATION-NOTES.md §5/§6、docs/V02-PROGRESS.md §0/§1 | 自述中的「4 项环境 EPERM 失败」「StdioTransport/真实 git 未运行时验证」在本非沙箱环境全部不存在（104 全绿 + 两项冒烟通过）。属实现会话的环境记录，已如实标注背景，但可能误导接收方以为存在未验证项——建议在 notes 中补一行「非沙箱复核结论」消除歧义。 |

### 观察（OBSERVATION）

| # | 位置 | 说明 |
|---|---|---|
| OBS-1 | SubagentManager.ts `denied()` 的 `_ref` 参数未使用 | denied 原因已入 diagnostic/stopReason，ref 参数冗余（无功能影响）。 |
| OBS-2 | Planner.ts 离线车道 | executePlan 的 StepEvaluator 由调用方注入；runner 用 acceptance 子串确定性评估，LLM 深度评审走 Evaluator Agent——两层职责边界清晰但依赖调用方正确接线，建议后续在 Planner API 上提供默认确定性 evaluator 绑定，减少误用面。 |
| OBS-3 | 事件名大小写 | EVENT-SPEC 名义上是 CamelCase 钩子（BeforeDelegate/SubagentStart），codebase 落地为 snake_case 字符串（before_delegate/…）——沿用 V0.1 既有 EventBus 约定（before_tool/policy_decision 亦 snake_case），V0.2 内部一致、跨版本一致，仅与 spec 文字大小写不同，不构成不一致问题，仅提示规范表头文字可更新为「落地形态 snake_case」以免未来误读。 |
| OBS-4 | depthLimit 字段 | DelegateRequest/createSubagentTool 声明 depthLimit 选项但 SubagentManager.delegate 未消费（深度由服务端 maxDepth 强制）——dead API surface，建议删掉或实现，避免暗示可突破服务端上限（实际不能，fail-closed 正确，仅文档/类型清洁问题）。 |
| OBS-5 | V0.2 交付内**无真实 spawn 的 MCP/Worktree 集成测试**进入 vitest 常驻套件 | StdioTransport 与 defaultGitRunner 仅经 smoke 冒烟验证（本报告补跑通过）；测试用 in-process transport / fake runner。建议 V0.3 引入真实 stdio/git 冒烟入 CI 车道（实现方 notes §6.7 已列此建议，一致）。 |
| OBS-6 | repo 根无 .git | 本仓库目录非 git 工作区（核验期间无法用 git status 佐证工作树干净，改用文件清单核对：审查仅新增/修改 docs/REVIEW-REPORT-V02.md；临时输出已回收站清理）。与 V0.2 代码质量无关，仅记录核验环境事实。 |

---

## 四、核验环境与约束遵守声明

- 环境：非沙箱（真实子进程可用），Node v24.14.0 / npm 11 / vitest 2.1.9 / git 2.53.0.windows.2 / PowerShell。
- 全程只读审查：未修改任何实现代码（packages/、apps/、benchmarks/ 源码零改动）。
- 临时产物（vitest 输出捕获、MCP/git/benchmark 冒烟临时目录）均用 `[Microsoft.VisualBasic.FileIO.FileSystem]::Delete*` 回收站清理，无永久删除。
- 仓库唯一新增文件：docs/REVIEW-REPORT-V02.md（本报告）。

---

## 五、结论

V0.2 实现真实、测试扎实、架构纪律（依赖零环 / Gen-Eval 分离 / Core 薄核 / 事件词汇）得到遵守，7 条验收全部满足，104 测试全绿 + tsc exit 0，B001–B005 无回归，B016–B019 机器判定可跑可过，MCP stdio 与 git worktree 的真实运行时行为经本核验补跑确认可用。无阻断、无 MAJOR，2 条 MINOR（文档同步 + 自述环境记录），5 条观察。

**VERDICT: PASS**
