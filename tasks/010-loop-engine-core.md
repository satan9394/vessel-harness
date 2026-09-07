# 010 — V0.5-M1 Loop Engine 核心状态机

- 状态：已合入（2026-09-05，子代理核心 + 指挥补测试兜底）
- 优先级：P0
- 创建日期：2026-09-05
- 关联卡片：011（Task Selection）依赖本卡接口；MISSION-V0.5

## 目标

实现 Loop Engine 外层循环状态机：一次"迭代"= 选任务 → 隔离工作区 → Generator 执行 → Evaluator 独立评审 → Persist → 继续/停止判定。**不建新内核**——Generator/Evaluator 复用既有机制（agents/evaluator + core loop）。

## 验收标准

- [x] `packages/engine/`：LoopEngine 迭代状态机（select→generate→evaluate→persist→done/retry）
- [x] 迭代结果类型：IterationResult{ iteration, taskId, verdict, evidence, reason, outputPath?, retryCount, metAfterRetries? }；verdict 来自 Evaluator
- [x] not_met/impossible/error 打回重试（至 maxRetries）；met 通过进 Persist；上限 maxIterations
- [x] 依赖注入：selectTask/generate/evaluate/persist/shouldContinue/workspaceFactory/disposeWorkspace 全可注入
- [x] Vitest 12 用例：闭环 met/not_met 重试/metAfterRetries/Generator 不自证/空队列停止/继续判定/fail-loud/边界校验/workspace 生命周期
- [x] `npx vitest run` 全绿不回归（182 全绿）；`npx tsc -b` exit 0
- [x] 卡状态置"待验收"，回填工作证明

## 涉及文件（按需扩展）

- `packages/engine/package.json`、`tsconfig.json`（新建，@cah/engine，子代理建）
- `packages/engine/src/LoopEngine.ts`（新建，子代理实现，质量高：状态机/DI/Gen-Eval 分离/重试/persist/workspace 生命周期/fail-loud）
- `packages/engine/src/index.ts`（新建）
- `packages/engine/src/loop-engine.test.ts`（新建，指挥补 12 用例）
- 根 `tsconfig.json`/`vitest.config.ts`（子代理注册包）
- `docs/V05-PROGRESS.md`

## 依赖

- 依赖任务卡：无（V0.5 首发卡）
- 阻塞于：—

## 设计锚点

- ARCHITECTURE §7 V0.5 定位：Loop Engine = 外层编排，不建新内核；Generator=单会话 loop；Evaluator=agents/evaluator
- 任务书 §14 流程：Trigger→Discovery→Task Selection→Worktree→Generator→Evaluator→Persist→Next Iteration
- Generator/Evaluator 分离铁律：通过判定只信 evaluator
- 若新建 packages/engine，参照既有包结构（package.json/tsconfig/references），依赖 shared/core/agents 类型

## 工作证明（执行器回填）

- [x] diff / 测试结果 / tsc exit 0：LoopEngine.ts（子代理）+ loop-engine.test.ts 12 用例（指挥补）+ 包注册；全量 182 用例全绿、tsc exit 0

## 验收结论（指挥会话回填）

- [x] 合入 / 打回 / 调整方向：合入（2026-09-05 指挥验收）
- 备注：7 条验收标准全 PASS。执行记录：子代理完成核心实现（tsc 通过）但测试编写停滞 ~15 分钟 → 指挥保留其核心、补测试兜底（教训 5：子代理写测试易停滞，可拆"实现卡/测试卡"或兜底）。
