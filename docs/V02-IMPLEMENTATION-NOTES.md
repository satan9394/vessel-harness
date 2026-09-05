# Composable Agent Harness V0.2 实现说明（V02-IMPLEMENTATION-NOTES.md）

> 版本：V0.2（在 V0.1 之上增量，任务书第十一节范围）
> 依据：docs/MISSION-V0.2.md、DESIGN-DECISIONS.md（16 决策点）、ARCHITECTURE.md（模块边界）、EVENT-SPEC.md（D5 事件词汇）、POLICY-SPEC.md
> 日期：2026-09-05

---

## 1. 本阶段目标回顾

在 V0.1（12 文件 63 用例）之上增量实现：**Subagent / Planner / Evaluator Agent / MCP / Parallel Exploration / Git Worktree（可选）**，保持模块化单体与依赖零环，不破坏 V0.1 测试与 benchmark；Generator/Evaluator 分离；TypeScript；无任何永久删除（回收站纪律）。

## 2. 新增模块地图（相对 V0.1）

```text
packages/shared/src/events.ts        委派扩展事件 A22–A25（before_delegate/subagent_start/subagent_stop/after_delegate）
                                     B10 session/created 记录；user/message.source 增补 'plan'
packages/agents/src/subagent/
  IsolatedRuntime.ts                 隔离会话工厂（Session+EventBus+PolicyEngine+ToolRegistry+Executor+
                                     ContextBuilder+Compaction+AgentLoop），Subagent/Planner/Evaluator 共用
  SubagentManager.ts                 委派核心：服务端上限（并发 clamp [1,3]、深度上限）→ A22 waterfall →
                                     子会话运行 → A23/A24 emit → A25 serial；结果契约 {output, structured?,
                                     diagnostic?, stopReason}；stopReason≠completed ⇒ isError；info hiding
  createSubagentTool.ts              `Subagent` 工具（workspace-write，走同一条 BeforeTool→Policy→Execute 链）
packages/agents/src/planner/
  Planner.ts                         Plan 一等对象：createPlan 校验（fail loud）/formatPlan/injectPlan(source=plan)/
                                     executePlan（步骤验收驱动 Evaluator，可重试）/generatePlan（LLM JSON，失败 fail loud）
packages/agents/src/evaluator/
  EvaluatorAgent.ts                  独立评审 Agent 形态：隔离会话(source=evaluator)+只读工具面(Read/Glob/Grep)+
                                     met/not_met/impossible/error + evidence；createReadOnlyExplorationTools
packages/tools/src/mcp/
  McpClient.ts                       McpTransport 抽象：StdioTransport（node <server> spawn，行分隔 JSON-RPC）
                                     + createInProcessTransport（fixture/测试）；initialize/tools/list/tools/call
  mcpTools.ts                        registerMcpTools 动态注册 `mcp__<server>__<tool>`（ToolRegistry.register）
  fixtures/echoServerCore.ts         本地 stdio MCP fixture server 核心（echo/add 两工具，纯协议逻辑）
  fixtures/echo-server.ts            可运行 stdio server 入口（tsx 或 build 后 node dist 直跑）
packages/tools/src/registry/
  Registry.ts                        新增 register()/unregister()（MCP 动态注册通道）
  parallel.ts                        ParallelScheduler：读并发（file_read/search，滚动池 clamp [1,3]）/
                                     写串行屏障；结果按输入序稳定
packages/tools/src/git/
  Worktree.ts                        createWorktree/removeWorktree/listWorktrees/sanitizeBranch；GitRunner 可注入
apps/cli/src/compose.ts              composeHarness 增 subagent/mcp 选项（composition root 接线）
benchmarks/
  scenarios/B016.yaml  B017  B018  B019     V0.2 场景（subagent/planner/evaluator/MCP）
  fixtures/B016..B019/task.md               场景 fixture
  runners/src/offline.ts                    B016–B019 offline mock 脚本（+B018-eval）
  runners/src/{types,manifest,asserts,runner}.ts  harness 配置解析、event_seen/record_seen 断言、planner/evaluator 驱动
scripts/dev-test/                 沙箱内 vitest 兼容验证通道（见 §5）
```

## 3. 架构/规范对齐

- **Core 薄核不变**：所有 V0.2 机制挂在 core 之外的 seam 上；core/ 未新增 import。委派事件词汇只在 `@cah/shared` 扩展（EVENT-SPEC 表 A A22–A25 的 snake_case 落地 + B10 记录），EventBus 原语复用（waterfall/emit/serial）。
- **Subagent = 普通 Session 同构复用**（D3 决策点 12）：独立上下文/独立会话日志/自建薄 loop；父只见结果契约（info hiding，EVENT-SPEC A24）；并发 1–3、深度上限服务端强制（fail-closed，EVENT-SPEC A22）。
- **Evaluator 不是新原语**：Evaluator Agent = 隔离会话 + 只读工具面 + 独立模型/判定的 preset（H12）；Generator 产出只是其评审数据，`impossible/error` 不产生误判通过。
- **MCP 唯一动态扩展通道**（D3 决策点 7）：`mcp__<server>__<tool>` 注册进同一 ToolRegistry → 同一 BeforeTool→Policy→Execute→AfterTool 管线；deny 规则/denied_tools 对 MCP 工具同名生效。
- **Parallel Exploration**（H01 读并发/写串行）：`ParallelScheduler` 与 V0.1 `exclusive` 屏障/滚动池语义一致，显式读写分流。
- **依赖方向零环**：agents→{core,context,policy,runtime,tools,llm}；tools→{shared,core,runtime,policy}；apps/cli 与 benchmarks/runners 为组合根；无反向依赖。

## 4. 运行方式

```powershell
# 类型检查（沙箱内可用）
npx tsc -b tsconfig.json

# 全量测试（规范通道；沙箱内被 esbuild spawn EPERM 阻塞，见 §5）
npx vitest run

# 沙箱内验证通道（同一批 *.test.ts，node:test in-process）
node --experimental-transform-types --import ./scripts/dev-test/test-alias.mjs ./scripts/dev-test/run.mjs

# benchmark 离线车道（经 runner 直跑；CLI seam 需 tsx，沙箱内不可用）
node --experimental-transform-types --import ./scripts/dev-test/test-alias.mjs -e "import('./benchmarks/runners/src/runner.ts').then(m=>m.runScenario({scenarioId:'B016',repoRoot:process.cwd(),reportsDir:'benchmarks/reports',provider:null,model:'mock-model',policyPath:'configs/policy.default.yaml',behaviorIRPath:'configs/behavior.default.yaml'})).then(r=>console.log(r.scenarioId,r.success))"

# MCP fixture server（非沙箱环境）
npx tsx packages/tools/src/mcp/fixtures/echo-server.ts
```

## 5. 沙箱内验证通道（scripts/dev-test/）

- `vitest-shim.mjs`：vitest API 子集（describe/it/test/expect/vi/beforeEach/afterEach/beforeAll/afterAll、常用 matcher、expect.any/objectContaining、rejects/resolves、vi.fn/spyOn/waitFor）基于 node:test + node:assert。
- `test-alias.mjs`：module resolve hook —— `vitest`→shim、`@cah/*`→src/index.ts、相对 `.js`→`.ts`。
- `run.mjs`：与 vitest.config.ts include 一致的 `*.test.ts` 发现 + 顺序 import（node:test 内联执行）。
- 用途：本会话沙箱内验证；**规范仍以 `npx vitest run` 为准**（非沙箱环境）。

## 6. 已知限制与建议

1. **沙箱环境限制（实现会话）**：`npx vitest run` 无法启动（esbuild 服务进程 spawn 被 OS 级拦截）；Shell/run_check 类真实子进程测试（4 项）在沙箱内 EPERM 失败。**非沙箱环境跑 `npx vitest run` 即可恢复 104 全绿**——该项已由独立核验在非沙箱环境复核通过（104 全绿 + MCP StdioTransport 真实 spawn + 真实 git worktree round-trip 冒烟均过，见 docs/REVIEW-REPORT-V02.md §〇）。
2. **MCP StdioTransport 未在沙箱内运行时验证**：真实 `node <server>` spawn 被沙箱拦截；协议逻辑经 in-process transport 全量测试（initialize/tools/list/tools/call/错误路径）。非沙箱环境建议补一条 `StdioTransport` 冒烟（起 `echo-server.ts`）。
3. **Git Worktree 默认 GitRunner 未在沙箱内运行时验证**：真实 git spawn 被拦截；模块逻辑（branch 清洗、路径解析、参数构造、porcelain 解析）经 fake runner 全量测试。非沙箱环境建议补真实 `git worktree add/remove/list` 冒烟。
4. **Planner 步骤评估**：离线车道用确定性验收评估（golden 子串）；LLM 深度评审走 Evaluator Agent（M3）。`generatePlan` 依赖模型输出合法 JSON，失败 fail loud。
5. **Subagent 可继续形态（continuable/send_message/interrupt）未实现**（EVENT-SPEC A23 `isContinuable:false`）：V0.2 只做一次性委派；可继续子代理属后续版本。
6. **MCP streamable-http 传输未实现**：V0.2 只做 stdio（任务书要求至少 1 个示例）；HTTP 传输列 V0.2+。
7. **V0.3 建议**：Project/Persistent Memory、Skills 正文注入与作用域、可继续子代理（send_message/interrupt）、MCP streamable-http、真实 git worktree 冒烟纳入 CI 车道。
