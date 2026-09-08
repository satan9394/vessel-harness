# 062 — RealEvaluatorAdapter（真实 Evaluator 接入 LoopEngine）

- 状态：待验收
- 优先级：P0（Wave 3 / Milestone E）
- 创建日期：2026-09-08
- 关联：061（RealGeneratorAdapter，对称前置）；058（Internal Reviewer/review 结论已结构化）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §11（L1184-1228）

## 目标

RealEvaluatorAdapter：把 055/058 建的 preset 化 Reviewer（evaluator）+ 内部评审结论接到 LoopEngine 的
Evaluator seam——generator 产出（061）→ 测试结果 + reviewer 评估 → met/not_met + 反馈 → 驱动 retry 决策。
不重写 LoopEngine，只写 adapter。复用 058（InternalReviewer + TeamReviewConclusion）不重复造。

## 验收标准（执行器逐条勾选）

- [x] 摸清 LoopEngine 的 Evaluator seam（与 061 同源：engine/loop 的 generator/evaluator 对称接口），确认接入点
      —— `LoopEngineDeps.evaluate: (ctx: EvaluateContext) => Promise<EvaluatorVerdict>`，EvaluateContext =
      task(goal/acceptance) + iteration/attempt + workspace + generatorOutput(output/artifactPaths)；不重写 LoopEngine
- [x] RealEvaluatorAdapter：产出（改动+测试结果+验收标准）→ reviewer（evaluator preset，只读面）→
      met/not_met + 理由 + 建议（复用 058 TeamReviewConclusion 形状）→ 回读给 loop 决策 retry/met
- [x] 复用 058 InternalReviewer/conclusion（不新造解析/结论）；met/not_met 语义与 058 一致
- [x] 测试：adapter 输入→结论→retry 决策/异常/与 058 复用，新增 10 例（≥6）；root vitest/tsc 绿（554 基线 + 10 = 564 无回归）
- [x] 文档同步（docs/REAL-EVALUATOR-ADAPTER.md）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 Evaluator 侧真 adapter。TaskQueue/IterationStore（063）、retry 自动循环（如并入 066 budget）各自成卡。
- 默认上限（maxRetries=1）沿用 061 的 §11.1 机制。

## 涉及文件（指针，执行器自行精化）

- LoopEngine/EngineLoop 的 Evaluator seam（与 061 同一引擎侧）
- packages/agents/src/reviewer/（058：InternalReviewer/conclusion TeamReviewConclusion）+ presets（reviewer）
- 061 RealGeneratorAdapter 产出形状（若已合入）
- 任务/验收标准/测试结果来源

## 方法

- 与 061 对称：adapter 包装 058 reviewer 调用；结论转 loop evaluator 输出契约
- met/not_met 语义、上限机制与 061 对齐

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 待执行器回填

### 改动文件（diff 摘要）

| 文件 | 改动 |
|---|---|
| `packages/engine/src/real-evaluator-adapter.ts`（新增） | RealEvaluatorAdapter（engine Evaluator seam 真实现，对称 061）：类型 `RealEvaluatorAdapterOptions` / `EvaluatorRunRequest` / `EvaluatorRunRecord`；构造期守卫（reviewerProviderId 绑定 / 非空 reviewerModel / policyArtifacts / preset 须 role=evaluator 且 write:false fail loud）；`evaluate(ctx)` seam 方法（EvaluatorVerdict 1:1 映射 058 conclusion）+ `evaluateRun()` 直接入口 + `runs`/`lastRun` 回读；每次评审新建 InternalReviewer（workspaceRoot 绑定本次 workspace），无跨调用状态泄漏 |
| `packages/engine/src/real-evaluator-adapter.test.ts`（新增） | 10 例：①seam 输入→met 结论→记录回读（conclusion 五字段恒有值 + reviewer 只读面 Read 在列/无 Write）②not_met 反馈形状 + 与 `parseReviewConclusion` 逐字段一致（复用 058 不新造解析）③acceptance 是唯一判据来源（缺判据 → 判不达标）④061 artifactPaths → 绝对只读证据路径进评审 prompt（磁盘证据面）⑤独立测试结果摘要进评审 prompt ⑥异常：reviewer provider 中断 → verdict error（评审失败是结论不是异常，不误判 met、留 trace）⑦构造/运行期守卫 fail loud ⑧**默认上限 e2e**（真实 generator + 真实 evaluator adapter：not_met → 恰一次重试 → met，评审恰 2 次零多余、只消费一个任务）⑨met 首 attempt 即停 ⑩061↔062 记录形状对称（GeneratorRunRecord → evaluateRun 字段直喂）+ 无跨调用状态泄漏 |
| `packages/engine/src/index.ts` | 追加 `export * from './real-evaluator-adapter.js'`（@vessel/engine 公开 adapter） |
| `docs/REAL-EVALUATOR-ADAPTER.md`（新增） | 接线说明：一句话/为什么放 engine 复用 058/构造与接线/产出形状与结论回读/证据纪律/默认 1/1/范围边界 |
| `tasks/062-real-evaluator-adapter.md` | 本卡回填（状态 → 待验收） |

### 接入点与设计选择

1. **接入点 = engine 的 `LoopEngineDeps.evaluate` seam**（`EvaluateContext{task,workspace,iteration,attempt,generatorOutput}` → `EvaluatorVerdict`）。不重写 LoopEngine（Vessel §11 明令）；对称 061：engine 已对 agents 有既有引用（LoopEngine type-import EvaluatorVerdict；061 值-import TeamRuntime），adapter 组合 agents/InternalReviewer 不新增包/依赖。
2. **复用 058 不重造**：评审 = `InternalReviewer.review`（内部复用 EvaluatorAgent review 模式 + AgentLoop/Session + `parseVerdict` 单一解析实现）；结论形状 = 058 `TeamReviewConclusion`（verdict/reason/unmet/suggestions/evidence 恒有值），adapter **零解析逻辑**；met/not_met 语义与 058 一致（error 如实暴露、绝不误判 met，Generator 不得自证完成）。
3. **evaluator preset 只读面**：adapter 从 preset registry 解析 reviewerPresetId（默认 `reviewer`）并校验 `role==='evaluator' && write===false`（构造期 fail loud，对称 061 的 generator 守卫）；工具面 = InternalReviewer 缺省只读探索面（Read/Glob/Grep 绑定每次 evaluate 的 workspace）经 preset `write:false` shrink-only 收窄，记录 `visibleTools` 供审计。
4. **产出消费 061**：seam 处 `ctx.generatorOutput.output/artifactPaths` → review；直接入口 `evaluateRun` 与 061 `GeneratorRunRecord` 字段 1:1（taskId/goal/acceptance/output/artifactPaths/iteration/attempt 直喂，测试⑩覆盖）；`artifactPaths`（相对路径）解析为 `evidencePaths`（绝对只读路径）交 reviewer 核验；独立 `testResults` 可选注入（真实链 Tests 步产出，无则只靠产出自述 + 磁盘，按 058 语义不自证）。
5. **上限如何生效（沿用 061）**：adapter 每次 evaluate 只跑 ONE 次有界 Internal Review；§11.1 的 `maxIterations=1/maxRetries=1` 由 LoopEngine 默认选项实施；e2e（测试⑧）默认选项 + 真实 generator + 真实 evaluator adapter：attempt1 not_met → 恰一次重试 → attempt2 met（评审调用恰 2 次），与 061 上限测试同构。放宽留 066。
6. **异常语义**：评审基础设施失败（provider 中断/会话异常）由 058 InternalReviewer catch → `verdict:'error'` 结论（**不抛**，评审失败是结论不是异常；loop 按 error 在 maxRetries 内重试）；无隔离 workspace / 空 generatorOutput / 空 id+goal → fail loud（无产出就没有评审对象，不静默判 met）。

### 命令输出（本环境可跑）

- `npx tsc -b tsconfig.json --pretty false` → exit 0（tsc 0 错误）
- `npx vitest run packages/engine/src/real-evaluator-adapter.test.ts` → 1 文件 / 10 测试全绿（277ms）
- `npx vitest run packages/engine` → 5 文件 / 52 测试全绿（含新增 10 例，700ms）
- `npx vitest run`（root 全量）→ **66 文件 / 564 测试全绿**（基线 554 + 062 新增 10 = 564，无回归）
- web 独立套件 54 未触及（本卡零 web 改动）

### 踩坑记录

- 评审 provider 中断时 AgentLoop 会把错误包一层重试前缀（`Model call failed after 1 attempt(s): …`），adapter reason 是 058 的 `internal review call failed: …` —— 测试断言须匹配原始错误尾部（`simulated provider outage`）而非笼统前缀。
- 评审 prompt 由多节拼接（验收标准/改动文件/diff/测试结果/产出自述/可用只读证据），content-gate 用的判据串必须与 generator 产出措辞刻意区分（如验收标准 `AC-062: src/out.ts 导出 run` vs 产出满足标记 `AC-062 满足`），否则 gate 无法证明「判据/证据确实到达 reviewer」。
- vitest ESM 下 `require()` 不可用 —— 守卫测试里动态建 `PresetRegistry` 改顶层静态 import。
- 初稿误加 `export { DEFAULT_EXCLUDE_DIRS } from './real-generator-adapter.js'` 再导出（evaluator 不扫盘、无必要耦合）→ 删除。
- LoopEngine attempt1 的 workspace 不 dispose（既有 engine 行为，061 已记录，归 064）——e2e 后 os.tmpdir 残留一个临时目录，非本卡引入。

### 环境备注

- 无 EPERM/spawn/管道错误；vitest/tsc 均在本环境直跑成功，无受限说明。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
