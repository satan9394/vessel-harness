# Run Control —— pause / resume / budget（task 066）

> 运行控制与预算的语义权威文档。实现：`packages/engine/src/run-control.ts`（RunControl 挂起门 +
> 预算）+ `LoopEngine` 控制 seam（`options.control`）+ `ProjectTaskQueue` paused 状态（063 状态机
> 扩展）+ `GoalSeam`/server 端点接线（065 seam → 真实现）。权威来源：
> docs/Vessel_后续开发方向与产品化路线_v1.0.md §11.1 —— 默认自治受限（maxIterations=1 /
> maxRetries=1），用户进入 Goal / Loop Mode 才放宽；不要普通聊天默认无限循环。

## 1. 语义三角：pause / resume / budget

| 控制 | 语义 | 与 050 interrupt 的区分 |
| --- | --- | --- |
| **pause** | 挂起：任务运行中把下一次迭代/attempt 边界「暂挂」（await resume gate），当前 in-flight 的 generate/evaluate 继续跑完，下一跳不执行 | 050 interrupt = **中止**（abort 信号，turn 以 kind='interrupted' 结束，不可恢复）；pause **绝不 abort**，无 abort()/signal 面 |
| **resume** | 恢复：释放挂起 gate，被挂起的边界原样继续（同一个 iteration/attempt 接着跑，不丢半步） | —— |
| **budget** | 上限：maxIterations（外层迭代轮数）/ maxRetries（每迭代内 generate→evaluate 重试数），默认 1/1（§11.1）；可查询/设置 | —— |

暂停只在**边界**生效（下一次迭代 select / 下一次 attempt generate 之前）；已经越过边界的
in-flight 步骤不受影响。这是刻意设计：pause 是「下一跳不执行」的门控，不是抢占式中断。

## 2. 默认自治（§11.1）与 Goal/Loop 模式放宽

- 默认：`maxIterations = 1`、`maxRetries = 1` —— 普通聊天/任务绝不默认无限循环。
  无 `control` 时 LoopEngine 走静态选项缺省（1/1），061/062 e2e 语义不变。
- 放宽：用户进入 **Goal / Loop Mode** 时，通过 `RunControl.setBudget`（或 seam
  `GoalSeam.setTaskBudget` / `POST /api/goal/tasks/:id/budget`）上调 maxIterations/maxRetries。
  budget 是**活值**：注入 `control` 后 LoopEngine 在每个边界读取当前 budget（`iterationCap()/
  retryCap()`），运行中上调即时生效，无需重建引擎。
- 用尽行为：maxIterations 用尽 → 外层循环停止（返回最后一次迭代 report，不抛异常）；
  maxRetries 用尽 → 该迭代以最后一次 evaluator verdict admit（met/not_met/…）。停止原因
  可查：`RunControl.exhausted` 哨兵（`{kind:'iterations', atIteration}` / `{kind:'retries', …}`）。

## 3. 状态持久可见（队列状态机，063 扩展）

`ProjectTaskQueue.TaskStatus` 新增 `paused`：

```text
pending ──claim──▶ in-progress ──settle──▶ met / not_met（终态）
                       │
                       ├──pause──▶ paused ──resume──▶ in-progress（原样继续）
                       └──cancel──▶ cancelled（终态：软移除）
```

- `pause(id)`：仅 `in-progress → paused`；`resume(id)`：仅 `paused → in-progress`；
  表外转移 fail loud（调用方 bug）。
- paused 任务不出队（claimNext 只挑 pending）；paused 持久可见（跨实例读回）。
- 与 050 interrupt 区分：队列状态机只有「挂起/恢复」两个方向，没有「已中断」终态；
  interrupt 是会话层的 abort，不进队列状态机。

## 4. seam 接线（065 501 占位 → 真实现）

- `GoalSeam`：每个 in-flight runTask 挂一个共享 `RunControl`（`runControls` map）；
  `pauseTask`/`resumeTask`/`getTaskBudget`/`setTaskBudget` 操作它 + 队列状态；
  预算持久在 `budgets` map（跨 run 生效）。
- server 端点：`POST /api/goal/tasks/:id/pause|resume`、`GET|POST /api/goal/tasks/:id/budget`
  （原先 501 not_implemented_066）。
- web：`GoalPanel` 的 Pause/Resume/Budget 按钮启用（按 queue 状态门控使能），
  `GoalModule` 调 `api.pauseGoalTask / resumeGoalTask / getGoalBudget / setGoalBudget`。

## 5. 实现要点（run-control.ts）

- 挂起门：`pause()` 建一个 pending Promise（gate），`resume()` 解析之；幂等（重复 pause/
  resume 是 no-op）。边界上 `awaitIterationBoundary`/`awaitAttemptBoundary` 读当前 gate 闭包，
  避免「pause→resume 快速来回」把旧 gate 泄漏给新边界。
- 预算：`getBudget()/setBudget()` 归一校验（maxIterations ≥ 1 整数、maxRetries ≥ 0 整数，
  越界 fail loud 不静默 clamp）；`exhausted` 哨兵记录最近一次用尽。
- 分层：engine 只依赖 shared 类型契约；RunControl 不 import core/llm；interrupt 语义留在
  core/InterruptController（050），本文件不复制。
