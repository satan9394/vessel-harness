# 061 — RealGeneratorAdapter（真实 Generator 接入 LoopEngine）

- 状态：待验收
- 优先级：P0（Wave 3 / Milestone E 首发）
- 创建日期：2026-09-08
- 关联：062（RealEvaluatorAdapter，对称）；063（持久 TaskQueue）；058（Internal Reviewer 产出结论）——本卡做 Generator 真接线
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §11（L1184-1228）：LoopEngine 已完整，写真实 adapter 不重写；
  真实运行链 Task Selection → Worktree → Developer Agent → Tests → Reviewer → met/not_met → retry → persist

## 目标

RealGeneratorAdapter：把 054-058 建的 preset 化 Developer Agent（generator）+ 既有 AgentLoop/TeamRuntime
接到 LoopEngine 的 Generator seam 上——任务进来 → developer 产出改动 → 测试跑 → 结论可回读；
不重写 LoopEngine，只写 adapter。默认自治范围受限（maxIterations=1 / maxRetries=1，§11.1——放 Goal/Loop
模式才放宽）。

## 验收标准（执行器逐条勾选）

- [x] 摸清 LoopEngine 的 Generator seam（packages/engine 或 LoopEngine 现有接口/类型：generator 输入输出契约、
      Iteration/产出模型），确认既有 EngineLoop/RealGeneratorAdapter 现状（V0.2 曾有 Planner/Evaluator Agent；
      057 TeamRuntime 也有 gen→eval 骨架——复用不重写）
- [x] RealGeneratorAdapter：任务（含验收标准）→ 调 preset 化 Developer Agent（generator，可经 TeamRuntime 单成员
      或既有 AgentLoop）→ 产出（改动文件/测试结果/产出摘要，形状对齐既有 Task/产出契约）→ 结论可回读
- [x] 复用既有机制：不写 core、不新造 primitive（preset/TeamRuntime/AgentLoop/delegate 均已有）；默认
      maxIterations=1/maxRetries=1 生效（budget/迭代上限，§11.1）
- [x] 测试：adapter 输入→产出→结论回读/上限生效/异常路径，新增 ≥6 例；全量 vitest/tsc 绿
      （544+web54 无回归，root 套件）
- [x] 文档同步（Real Generator 接线说明）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 Generator 侧真 adapter。Evaluator 真 adapter（062）、持久 TaskQueue/IterationStore（063）、worktree
  生命周期（064）、Context Reset Handoff（067）各自成卡。

## 涉及文件（指针，执行器自行精化）

- LoopEngine/EngineLoop 的 seam（packages/engine 或 core——先 grep Generator/generator/Iteration/Adapter 定位现状）
- packages/agents（presets/team/developer generator；058 的 acceptance/review 结论）
- 任务对象模型（Task/acceptance 字段，058 用过）
- 测试照既有 engine/agents 测试风格

## 方法

- 读 §11 与 LoopEngine seam 现状；找 057 TeamRuntime 单成员路径或既有 Developer Agent 调用点
- adapter 包装：输入任务契约 → 内部跑 developer（TeamRuntime 或 AgentLoop）→ 产出转输出契约
- 上限通过 deps/配置注入（默认 1/1），便于测试放宽验证

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 待执行器回填

### 改动文件（diff 摘要）

| 文件 | 改动 |
|---|---|
| `packages/engine/src/real-generator-adapter.ts`（新增） | RealGeneratorAdapter（engine Generator seam 真实现）+ 证据扫描纯函数 `scanWorkspaceFiles` / `diffWorkspaceSnapshots` / `DEFAULT_EXCLUDE_DIRS`；类型 `RealGeneratorAdapterOptions` / `GeneratorRunRequest` / `GeneratorRunRecord`；构造期守卫（provider 绑定 / 非空 model / 非 generator preset fail loud）；`run()` 直接入口 + `generate(ctx)` seam 方法 + `runs`/`lastRun` 回读 |
| `packages/engine/src/real-generator-adapter.test.ts`（新增） | 10 例：①seam 输入→产出→记录回读 ②run() 直接入口同形状 ③acceptance 透传（进记录、不进 developer 自评）④异常：无隔离 workspace ⑤异常：provider 未绑定 / 非 generator preset ⑥异常：developer 会话失败（provider 中断 → 拒绝不留记录）⑦证据机制纯函数（磁盘改动/排除目录/无改动）⑧**默认上限生效 e2e**（真 developer 会话 + 确定性 evaluator：不传 maxIterations/maxRetries → 恰一次重试（attempt 1,2）、只消费队列第一个任务、persist 1 条 verdict met/metAfterRetries）⑨met 首attempt 即停无重试 ⑩多次调用无跨调用状态泄漏 |
| `packages/engine/src/index.ts` | 追加 `export * from './real-generator-adapter.js'`（@vessel/engine 公开 adapter） |
| `packages/engine/tsconfig.json` | references 追加 `../policy`（测试 import compilePolicyYaml 的构建顺序） |
| `docs/REAL-GENERATOR-ADAPTER.md`（新增） | 接线说明：接入点/复用理由/构造与接线/产出形状回读/证据纪律/默认 1/1/范围边界（062/063/064/066 分工） |
| `tasks/061-real-generator-adapter.md` | 本卡回填（状态 → 待验收） |

### 接入点与设计选择

1. **接入点 = engine 的 `LoopEngineDeps.generate` seam**（`GenerateContext{task,workspace,iteration,attempt}` → `GeneratorOutput{output,artifactPaths}`）。不重写 LoopEngine（Vessel §11 明令）；engine 已对 agents 有既有引用（LoopEngine type-import EvaluatorVerdict；selection.ts 值-import @vessel/llm），adapter 组合 agents/TeamRuntime 不新增包/依赖。
2. **复用什么**：057 TeamRuntime **单成员阵容**（developer，不配 orchestrator → 不走 delegate），成员跑在既有 AgentLoop/Session（source 'team'）；054/055 preset registry + 能力面收窄；每次 generate() = 一个全新 TeamRuntime 实例，会话收尾即关，无跨调用状态泄漏。
3. **产出形状对齐**：seam 返回 `GeneratorOutput`；adapter 内部维护 `GeneratorRunRecord`（taskId/goal/acceptance/output/artifactPaths/developer 成员摘要含 sessionId/teamRunId/iteration/attempt）经 `runs`/`lastRun` **结论可回读**。
4. **上限如何生效**：adapter 每次 generate 只跑 ONE 个有界 developer 运行（无内部 retry/iteration 循环）；§11.1 的 `maxIterations=1/maxRetries=1` 由 **LoopEngine 默认选项**实施（本卡不改 066 的放宽机制），e2e 测试用默认选项验证：恰一次重试、只跑一个任务。
5. **Generator/Evaluator 分离**：acceptance 只透传进记录（形状对齐 LoopTask.acceptance），不进 developer prompt（058 语义：验收留 evaluate 侧）；artifactPaths = 运行前后磁盘快照 diff（**只信盘上改动，不信自述**——developer 声称改 src/x.ts 而盘上没动 → 保持 []）。
6. **异常路径**：无隔离 workspace / provider 未绑定 / 非 generator preset → fail loud；developer 会话失败（TeamRuntime outcome 'failed'）→ 抛 `RealGeneratorAdapter: developer run failed: …`，不留"成功"记录。

### 命令输出（本环境可跑）

- `npx tsc -b tsconfig.json` → exit 0（tsc 0 错误）
- `npx vitest run packages/engine` → 4 文件 / 42 测试全绿（含新增 10 例，377ms）
- `npx vitest run`（root 全量）→ **65 文件 / 554 测试全绿**（基线 544 + 061 新增 10 = 554，无回归）
- web 独立套件 54 未触及（本卡零 web 改动）

### 踩坑记录

- `GeneratorOutput.artifactPaths` 是可变的 `string[]` 而 `GeneratorRunRecord.artifactPaths` 是 `readonly string[]` → generate() 返回时需 `[...rec.artifactPaths]` 拷贝（TS4104）。
- LoopEngine 重试时 attempt2 会新建 workspace（workspaceFactory 每次 attempt>1 重建）但 attempt1 的 workspace 不 dispose（既有 engine 行为，非本卡引入）——测试残留一个 os.tmpdir 临时目录，属 064 worktree 生命周期范畴，不在本卡修。
- engine tsconfig 原 references 无 ../policy（此前 engine 测试不 import policy）；本卡测试用 compilePolicyYaml → 需补 references 保证 tsc -b 构建顺序。

### 环境备注

- 无 EPERM/spawn/管道错误；vitest/tsc 均在本环境直跑成功，无受限说明。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
