# MISSION V0.2 — Composable Agent Harness V0.2 执行任务书

> 总指挥签发（前序窗口，2026-09-05）。V0.1 已完成并验收 PASS（docs/REVIEW-REPORT-V01.md，63 测试全绿）。
> 工作区：`C:\work\Vessel_Harness`（本任务在 headless 无人值守会话执行）。

---

## 一、V0.1 交接现状

V0.1（最小 Harness）已交付：TypeScript monorepo（packages/{core,llm,policy,tools,context,behavior,runtime,memory,skills,agents,telemetry,shared} + apps/cli + benchmarks），12 文件 63 用例全绿，Policy 硬执法 + Evaluator 契约 + B001–B005 benchmark 已落地。权威文档不变：`任务书.md`（第十一节 V0.2 范围）、`docs/DESIGN-DECISIONS.md`（16 决策点，**实现必须遵守**）、`docs/ARCHITECTURE.md`（模块边界）、`docs/EVENT-SPEC.md`（D5 事件词汇）、`docs/POLICY-SPEC.md`、`docs/BEHAVIOR-IR-SPEC.md`、`docs/BENCHMARK-SPEC.md`。新增代码风格请先读 `packages/core/src/agent-loop/AgentLoop.ts` 与 `packages/policy/src/risk/Compiler.ts` 摸清既有约定。

## 二、本阶段目标

在 V0.1 之上增量实现任务书第十一节 V0.2 范围，保持既有模块边界与架构决策，不得破坏 V0.1 已通过的测试与 benchmark。

## 三、V0.2 范围（任务书第十一节，克制增量）

1. **Subagent**（H11 落地）：主 Agent 可派生子代理执行隔离子任务——独立上下文、独立会话、结果回传主 Agent；限定默认并行 1–3、不追求数量；深度/并发有上限；对应 EVENT-SPEC 的委派事件（BeforeDelegate/AfterDelegate 词汇，若有定义按 D5 用）。
2. **Planner**：复杂任务先规划（plan 结构：目标/步骤/验收），Plan 作为一等对象进入上下文；与 Evaluator 衔接（计划步骤的验收标准驱动 Evaluator 判定）。
3. **Evaluator Agent**（Generator/Evaluator 分离的 agent 形态）：V0.1 已有 Evaluator 契约（deterministic + LLM requestKind），本阶段补独立 Evaluator Agent 形态——隔离上下文评审 Generator 产出，输出 met/not_met + 证据；不得让 Generator 自证完成。
4. **MCP 接入**：工具注册表支持 MCP server（stdio 传输至少 1 个示例），MCP 工具动态注册进 registry、走同一 policy 裁决链（BeforeTool → Policy → Execute → AfterTool）。
5. **Parallel Exploration**：只读探索类工具（Glob/Grep/Read 族）可并行探索（1–3 并发），写类串行；与 V0.1 已有并行语义对齐。
6. **Git Worktree**（如时间允许、排在最后）：为并行子代理提供隔离工作树。

明确不做（V0.3+ / 任务书排除）：Project/Persistent Memory、Skills 体系、自动学习、Web UI、20-Agent Team、复杂 RAG。

## 四、硬性约束（同 V0.1，逐条遵守）

1. clean-room：以本仓库 spec 为据，不复制研究项目源码。
2. Prompt 与 Runtime 分离：安全规则落在 Policy Engine 硬执法，禁止只写 prompt。
3. Generator/Evaluator 分离：Subagent/Evaluator Agent 的产出必须经独立评估，不得自宣布完成。
4. 模块化单体、依赖零环、Core 薄核（照 DESIGN-DECISIONS/ARCHITECTURE）。
5. 全局铁律：禁止任何永久删除（回收站）；禁止 force push；TypeScript；Windows/PowerShell。
6. 新功能必须有 Vitest 测试；V0.1 的 63 用例不得回归（跑全量确认）。

## 五、建议里程碑（顺序推进，每步可验证）

- **V0.2-M1** Subagent 核心：subagent 派生/执行/结果回传 + 并发上限（1–3）+ 独立 Session/上下文 + 事件接线 + 测试
- **V0.2-M2** Planner：Plan 结构 + 规划步骤进入上下文 + 计划驱动执行 + 测试
- **V0.2-M3** Evaluator Agent：独立评审 Agent 形态（读 Generator 产出 + 隔离上下文 + met/not_met 证据输出）+ 测试
- **V0.2-M4** MCP 工具接入：MCP client 抽象 + stdio server 示例（可用本地简单 server fixture）+ 动态工具注册 + policy 接线 + 测试
- **V0.2-M5** Parallel Exploration：并行探索调度（1–3 并发、读写分流）+ 测试
- **V0.2-M6**（可选，排最后）Git Worktree 支持 + 测试
- **V0.2-M7** 收尾：全量 vitest + tsc + V0.1 benchmark 回归 + 新增 benchmark scenario（如 B016 subagent 委派、B017 planner 规划、B018 evaluator 拒绝/通过、B019 MCP 调用——编号按需顺延）+ 更新 docs/V01-IMPLEMENTATION-NOTES.md 或新写 docs/V02-IMPLEMENTATION-NOTES.md

## 六、验收标准（全部满足才完成）

1. V0.2 范围内每项有可运行代码 + Vitest 测试通过；`npx vitest run` 全绿（≥ V0.1 的 63）+ `npx tsc -b` exit 0。
2. Subagent：端到端演示主 Agent 派生 1 个子代理完成独立任务并回传结果。
3. Planner + Evaluator Agent：演示"规划→执行→独立评估→PASS/FAIL 证据"闭环。
4. MCP：本地 stdio fixture server 工具可被注册并走 policy 裁决（deny 规则对 MCP 工具生效）。
5. V0.1 benchmark B001–B005 不回归；新增 ≥2 个 V0.2 benchmark scenario 可跑。
6. 交付说明更新（V02-IMPLEMENTATION-NOTES.md 或更新既有）：新增模块地图、运行方式、测试、已知限制。
7. 独立审查 PASS：由独立 Evaluator 视角核验 6 条验收 + 依赖方向 + Gen/Eval 分离 + 无 V0.1 回归。

## 七、执行纪律（本环境实测教训）

- headless/后台长时间任务优先自己串行多轮完成；不要大批量并行后台 subagent（会中途失败）。
- 长文件用 read 分段；每完成一个里程碑跑一次相关测试。
- 若单次会话跑不完：按里程碑把产出留存在工作区（代码+测试+进度说明写到 docs/V02-PROGRESS.md），下次继续时先读进度文件接力。
- 完成后按第八节格式汇报。

## 八、汇报格式（完成后 stdout 输出）

结论 / 交付物清单（路径）/ 验证证据（vitest 总数、tsc、benchmark 结果节选）/ 已知限制与 V0.3 建议。
