# T306 — 迭代层预算快照（HARNESS² P1-1 的保守版）

- Status: 已完成（2026-10-25；Codex 手动执行；未提交、未推送）

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 目标：让 `LoopEngine` 的每轮迭代记进 `ExecutionRun`，并把快照落进 iteration 记录。**只记录、不熔断、不改默认迭代上限**。

## 0. 先读这些（只读）

1. `packages/engine/src/execution-run.ts` — `ExecutionRun` 的 `budget` / `counters` / `transition` 与合法状态。
2. `packages/engine/src/LoopEngine.ts` — `LoopEngineOptions`、iteration 循环的边界（每轮 generate/evaluate 各在哪）、`IterationResult` 的形状。
3. `packages/engine/src/iteration-store.ts` — `IterationEntry` 与唯一的写入口（`appendIteration`）。
4. `packages/engine/src/index.ts` — 导出面。
5. `packages/core/src/run-control.ts` — 现有 `RunControl` 的预算语义（**本卡不碰它**，只是确认不要造第二套熔断）。

## 1. LoopEngine 接入（可选、不改变默认行为）

- `LoopEngineOptions` 新增可选 `executionRun?: ExecutionRun`。
- **不传时行为逐字不变**（现有 1/1 默认、无预算记录）。
- 传入时，每完成一轮迭代（generate+evaluate 都结束）：
  - `executionRun.counters.modelSteps += 1`（**一轮算 1 个 model step**，不按 generate/evaluate 拆两次）。
  - 若该轮以错误收尾，`consecutiveErrors += 1`；正常则重置为 0。
  - **不要**修改 `inputTokens` / `outputTokens` / `estimatedCost`：`LoopEngine` 看不到 provider usage，写 0 会制造假数据。在代码注释里写明「token/cost 由上层养，本层不伪造」。
- 不调用 `executionRun.transition(...)`，不因预算耗尽而中断循环（`maxIterations` 是唯一停止条件，语义不变）。

## 2. 落库

- `IterationEntry` 新增**可选** `budgetSnapshot?: { modelSteps: number; consecutiveErrors: number }`（字段名写死，只这两个，别把 token/cost 塞进来当 0）。
- 只在传入了 `executionRun` 时写；不传则键缺席（与既有可选字段纪律一致）。
- 写入口仍然是 `appendIteration` 唯一那处，不要新增第二处写 meta。

## 3. 测试

`packages/engine/src/loop-engine.budget.test.ts`（新增，或扩展现有 LoopEngine 测试）：

1. 注入 `new ExecutionRun({ maxModelSteps: 10 })` 跑 2 轮迭代 → `counters.modelSteps === 2`，两次 `IterationEntry` 都带 `budgetSnapshot`（值分别为 1、2）。
2. 不注入 → 行为与改动前一致（`budgetSnapshot` 缺席），且 `maxIterations` 默认仍是 1。
3. 一轮以错误收尾 → `consecutiveErrors === 1`；下一轮正常 → 归零。
4. 断言 `inputTokens`/`outputTokens`/`estimatedCost` 始终是 0（证明没有伪造 token）。

`packages/engine/src/iteration-store.test.ts` 追加一条：带 `budgetSnapshot` 的条目可写入、可回放；旧记录（无该字段）仍可读。

## 4. 不许做

- 不加硬熔断、不改 `RunControl`、不改 `maxIterations`/`maxRetries` 的默认值。
- 不把 token/cost 写成 0 以外的任何猜测值。
- 不改 UI/CLI（本卡只到 engine 与 store）。
- 不 commit / push / 删文件；不加依赖；不动 `packages/core`。

## 5. 允许修改

```
packages/engine/src/LoopEngine.ts
packages/engine/src/loop-engine.budget.test.ts   (新增或修改)
packages/engine/src/iteration-store.ts
packages/engine/src/iteration-store.test.ts
```

## 6. 验收（逐条真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run packages/engine/src/loop-engine.budget.test.ts packages/engine/src/iteration-store.test.ts packages/engine/src/execution-run.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

## 7. 回报

```
接入点：<每轮结束的位置 + 计数规则>
不伪造：<token/cost 为何恒为 0>
落库：<字段名 + 只在注入时出现>
测试：<四条 + store 一条>
检查：<三条命令退出码>
未做：<如实写>
```

## Result

已完成。`LoopEngineOptions` 新增可选 `executionRun?: ExecutionRun`；注入时每完成一轮迭代 `counters.modelSteps += 1`，该轮以 `error` 收尾则 `consecutiveErrors += 1`、否则归零，并把 `budgetSnapshot: { modelSteps, consecutiveErrors }` 挂到 `IterationResult`；不注入则行为逐字不变。`iteration-store` 的 `IterationEntry` / `IterationEntryInput` 加可选同名快照，只在有值时落库，`appendEngineResult` 透传。

**token/cost 一个字段都没写**：`LoopEngine` 的 generator 抽象只返回 `output` + `artifactPaths`，provider usage 不经过这一层，写 0 就是伪造；注释已写明「token/cost 由上层养」。27 个定向用例 + 19 个 loop/control 回归通过，两项类型检查 exit 0。没有加熔断，没有改 `maxIterations`/`maxRetries` 默认值。
