# V0.5 Implementation Notes — Composable Agent Harness 第五阶段交付说明

> 阶段：第五阶段（MISSION-V0.5.md）· 验收状态：见文末 · 日期：2026-09-05
> 总指挥签发任务：实现任务书第十四节 **V0.5 Loop Engine**（最后一个版本里程碑）——Trigger → Discovery → Task Selection → Worktree → Generator → Evaluator → Persist → Next Iteration，作为 Harness 外层循环（ARCHITECTURE §7：不建新内核，用 V0.1–V0.4 已建机制组合）。

---

## 1. 模块地图（V0.5 增量，相对 V0.4）

```text
packages/engine/（新包 @cah/engine，V0.5 编排层）
  src/LoopEngine.ts      V0.5-M1 外层循环状态机：select→generate→evaluate→persist→done/retry；
                         IterationResult{iteration,taskId,verdict,evidence,reason,outputPath?,retryCount,
                         metAfterRetries?}；verdict 权威=注入的 Evaluator（Generator 永不自证）；
                         not_met/impossible/error 重试至 maxRetries；maxIterations 上限；workspaceFactory/
                         disposeWorkspace 生命周期；fail-loud 校验（guardDeps/边界）
  src/taskQueue.ts       V0.5-M2 TaskQueue<T>（enqueue/next/peek/drain/isEmpty）+ ArrayTaskQueue +
                         createTaskQueue + queueSelectTask（对接 LoopEngine.selectTask 的 null-即-停契约）
  src/selection.ts       V0.5-M2 selectTaskFor(task)：goal→classifyTask(V0.4)→DEFAULT_PRESETS→preset/tier；
                         三 seam（classify/presets/router）可注入；classifyTaskFor 免 provider 包装
  src/workspace.ts       V0.5-M3 隔离工作区：TempDirWorkspaceFactory（os.tmpdir mkdtemp，非 git 默认）/
                         GitWorktreeWorkspaceFactory（复用 V0.2 tools/git Worktree，GitRunner 注入）/
                         createDefaultWorkspaceFactory（auto 检测 .git 或显式 mode）；dispose 只清隔离目录
benchmarks/
  scenarios/B023.yaml    V0.5 场景：Loop Engine 单次迭代闭环（verdict=met + ENGINE-GOLDEN-88）
  fixtures/B023/task.md
  runners/src/runner.ts  harness.engine lane（driveScenario 分支：真实 LoopEngine + 确定性 gen/eval +
                         隔离 temp workspace + persist 记录）
  runners/src/{types,manifest}.ts   HarnessSpec.engine 标志
docs/V05-PROGRESS.md     里程碑进度
```

## 2. 运行方式

```powershell
npx tsc -b tsconfig.json
npx vitest run                       # 全量 203 用例（offline，无网络）
npx vitest run packages/engine       # engine 包（32 用例：loop 12 + selection 13 + workspace 7）
npx vitest run benchmarks/runners    # runner 14 用例（B001–B005/B016–B023）
```

## 3. 测试与覆盖（验收 1）

`npx vitest run` → **28 文件 / 203 用例全绿**（V0.4 基线 170 + V0.5 新增 33）：

| 模块 | 覆盖 |
|---|---|
| engine/LoopEngine (12) | 闭环 met / not_met 重试至上限 / metAfterRetries / **Generator 不自证**（evaluator 拒 generator 自证 → stopped）/ 空队列停 / continue 判定 / 多迭代 / fail-loud（缺依赖抛错、maxIterations/maxRetries 边界）/ 需 id+goal / workspace 生命周期 |
| engine/taskQueue+selection (13) | FIFO 顺序 / peek 不消费 / drain / queueSelectTask 对接 LoopEngine / 分类映射（implementation/review/search）/ review→reviewer / search→fast / 注入覆盖（classify/presets/router）/ unknown 兜底 |
| engine/workspace (7) | tempdir 隔离 / dispose 清理 / **产物隔离**（LoopEngine 集成：主工作区零改动）/ 模式选择 / auto 检测 / git runner 注入 |
| benchmarks B023 (+1) | Loop Engine 单次迭代闭环机器断言（verdict=met + ENGINE-GOLDEN-88 + persist 1 条） |

## 4. 验收对照（MISSION-V0.5 第六节 6 条）

1. **可运行代码 + Vitest 通过**：✔ 203/203；`npx tsc -b` exit 0
2. **Loop Engine 端到端闭环**：✔ B023 实测（select→generate→evaluate met→persist）；单元测试实证 not_met 打回带证据、**Generator 不自证**（evaluator 拒 generator 自证 → stopped，非误判通过）
3. **隔离工作区**：✔ workspace 测试实证迭代写文件只落隔离目录、主工作区零改动；dispose 只清隔离目录（tempdir rmSync / git worktree remove）
4. **Task Selection 复用 TaskRouter 语义**：✔ selection.ts 直接复用 V0.4 classifyTask/DEFAULT_PRESETS/TaskRouter（不重造，task 011）
5. **B023 可跑 + 不回归**：✔ runner 14 用例全绿（B001–B022 无回归 + B023）
6. **交付说明 + 独立审查**：✔ 本文档 + docs/REVIEW-REPORT-V05.md

## 5. 实现要点（与任务书/ARCHITECTURE 的对应）

- **Loop Engine = 外层编排，不建新内核**（ARCHITECTURE §7 V0.5 行）：packages/engine 零 core 内部 import；Generator=注入的单会话运行（本 harness 里即 loop.runTurn 的包装）；Evaluator=agents/evaluator 注入；Worktree/Persist=复用 tools/git + memory/engine 自己。任务书 §14 的 Trigger（taskQueue）/Task Selection（selection.ts）/Worktree（workspace.ts）逐环落地，Next Iteration（shouldContinue）。
- **Gen/Eval 分离铁律**：LoopEngine 的 met/not_met 判定 100% 来自注入 Evaluator 的 verdict；Generator 产出只是"评审数据"。测试实证：generator 声称"完成、测试全过"但 evaluator 判 not_met（reason 含"自证不可信"）→ 迭代以 stopped 收尾，绝不误判通过。
- **显式 vs 注入**：全部协作方（selectTask/generate/evaluate/persist/shouldContinue/workspaceFactory/disposeWorkspace）依赖注入——LoopEngine 本身零 IO，纯状态机，确定性可测。
- **隔离纪律**：workspace 三工厂只创建/清理自己的隔离目录；git worktree 清理走 `git worktree remove`（git 管理）；tempdir 走 os.tmpdir()（仓库测试统一约定）。绝不删除主工作区。
- **复用而非重造**（任务书 §1"取各家长处→抽象公共机制"）：Task Selection 复用 V0.4 llm/router；Worktree 复用 V0.2 tools/git；TaskQueue 接口即 Discovery seam（未来 backlog/记忆发现实现同接口）。
- **依赖方向**：engine→{shared,core(类型),agents,llm,tools}；core 零新增 import；benchmarks/runners（组合根）import @cah/engine。npm workspaces 新包 @cah/engine 经 npm install 软链（package-lock 更新）。

## 6. 已知限制与后续

1. **Generator 的真实接线未在 Loop Engine 内固化**：B023 用确定性 mock generator/evaluator；真实"单任务→子代理/loop 执行"的 generator 适配（把 LoopTask 变成一次 loop.runTurn/子代理委派）是产品化接线，未默认装配（V0.5 范围克制：Loop Engine 状态机 + 隔离 + 选择就位，generator 由调用方注入）。
2. **Discovery 未做自动发现**：V0.5 TaskQueue 是显式队列；backlog/记忆自动发现（任务书 §14 Discovery）留 seam，未实现——与 V0.3/V0.4 的"显式优先、克制"一致。
3. **GitWorktree 模式在 B023 未跑真实 git**：workspace 测试用 fake runner；真实 git worktree lane 与 V0.2 同（defaultGitRunner 可用，live 场景验证）。
4. **后续建议**：可继续子代理（send_message/interrupt，EVENT-SPEC A25 预留）让 LoopEngine 的 generator 可接真实长任务；真实 generator 适配器 + 记忆发现 Discovery；learned 完整化（Snapshot/Rollback/Curator）。

## 7. 独立核验

docs/REVIEW-REPORT-V05.md（独立 Evaluator 按 MISSION-V0.5 第六节 6 条逐条核验，Gen/Eval 分离——实现方不自证）。
