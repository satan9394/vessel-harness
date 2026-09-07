# 010 — V0.5-M1 Loop Engine 核心状态机

- 状态：待执行
- 优先级：P0
- 创建日期：2026-09-05
- 关联卡片：011（Task Selection）依赖本卡接口；MISSION-V0.5

## 目标

实现 Loop Engine 外层循环状态机：一次"迭代"= 选任务 → 隔离工作区 → Generator 执行 → Evaluator 独立评审 → Persist → 继续/停止判定。**不建新内核**——Generator/Evaluator 复用既有机制（agents/evaluator + core loop）。

## 验收标准

- [ ] `apps/cli/src/loop-engine/` 或新包 `packages/engine/`：LoopEngine 类/函数，迭代状态机（idle→selecting→generating→evaluating→persisting→done/retry）
- [ ] 迭代结果类型：{ iteration, taskId, verdict, evidence, outputPath?, retryCount }；verdict 来自 Evaluator 不是 Generator 自证
- [ ] not_met 打回重试（至 maxIterations 上限）；met 通过进入 Persist
- [ ] 依赖注入：generator/evaluator/workspaceFactory/persist 可注入（确定性测试用 mock）
- [ ] Vitest：迭代闭环（met 通过）、not_met 打回重试、上限停止、Generator 不自证（mock evaluator 拒）
- [ ] `npx vitest run` 全绿不回归 170 基线；`npx tsc -b` exit 0
- [ ] 卡状态置"待验收"，回填工作证明

## 涉及文件（按需扩展）

- `packages/engine/src/LoopEngine.ts`（新建）或 `apps/cli/src/loop-engine/`
- `packages/engine/src/loop-engine.test.ts`（新建）
- 包接线：packages/engine/package.json + tsconfig + workspace 注册
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

- [ ] diff / 测试结果 / tsc exit 0

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回 / 调整方向
- 备注：
