# Web Goal/Loop UI（task 065 + 066）—— 任务队列 + 迭代回放 + 运行控制

> Milestone E（V1.3 Real Loop）web 面板卡。数据源：063 ProjectTaskQueue（持久任务队列）
> + IterationStore（per-task 迭代日志）+ 061 RealGeneratorAdapter / 062 RealEvaluatorAdapter /
> LoopEngine 真实运行链（docs/Vessel_后续开发方向与产品化路线_v1.0.md §11）。
> 消费端 = `apps/web`（独立 Vite 项目，经 `apps/local-server` 的 REST seam 取数，不 import
> 任何 workspace 包 —— 线类型镜像在 `apps/web/src/goal.ts`）。

## 1. 一句话

web 的 **Goals** 模块（Customize → Tasks 打开，卡片标题 Goals）是一个真实模块：

- **任务队列**：展示持久队列的每条任务（goal/acceptance）与状态机
  `pending → in-progress → met/not_met`（另有 paused/cancelled 中间/终态），新任务在前。
- **任务详情**：选中任务后显示迭代回放（IterationStore per-task 序数 1..n）——每次迭代展示
  **Generator 产出摘要**（首行文本 + 盘上 artifact 数）与 **Evaluator 结论**
  （met/not_met/理由/unmet/suggestions，058 形状结构化）。
- **触发运行**：`Run task` 按钮对 pending/in-progress 任务发起**一次有界真实运行**
  （`POST /tasks/:id/run`，接 061-064 真实链路；maxIterations=1 / maxRetries=1，§11.1 默认自治）。
- **空态友好**：无任务 / 无迭代 / 未选中均给提示；接受标准可读。
- **066 运行控制**（已启用，非占位）：`Pause` 挂起运行中任务（`POST /tasks/:id/pause`，
  只挂起不 abort）、`Resume` 继续挂起的任务（`POST /tasks/:id/resume`，同一边界原样继续）、
  `Budget` 查询/上调 maxIterations/maxRetries（`GET|POST /tasks/:id/budget`，§11.1 默认 1/1，
  Goal/Loop 模式放宽）。暂停/恢复的使能按 queue 状态门控（running in-progress → pause 可用；
  paused → resume 可用）。

## 2. Web 组件与数据流

| 组件 | 职责 | 状态来源 |
| --- | --- | --- |
| `components/GoalModule.tsx` | 容器：解析 session 的 workspaceRoot → 拉队列 / enqueue / 选中拉回放 / 触发 run / 066 pause·resume·budget | `api.listGoalTasks / enqueueGoal / goalIterations / runGoalTask / pauseGoalTask / resumeGoalTask / getGoalBudget / setGoalBudget` |
| `components/GoalPanel.tsx` | 队列行 + 任务详情 + 迭代卡片 + 066 控制按钮（纯展示，enabled 按 queue 状态门控） | props（tasks/selectedId/iterations/callbacks/budget） |
| `goal.ts` | 线类型镜像 + 纯函数（sortGoalTasks/sortIterations/goalVerdictDisplay/generatorOutputSummary/evaluatorConclusionText/goalRunnable/goalControlEnabled/GOAL_CONTROL_SEAM/budgetDisplay 等） | —— |
| `api.ts`（扩） | `/api/goal/tasks*` 客户端方法 + 线类型 | —— |

数据消费（排序/归一/标签/摘要/066 控制门控）全部是纯函数，node 下可单测；组件用
`react-dom/server` 静态渲染断言（无需 jsdom，web vitest 环境为 node）。Goal 面板不做 SSE
live 帧（一次 run 是同步的：POST 返回即最终投射 + 刷新回放即可），与 060 Team 的 SSE 直播
不同 —— 需要 live 时按 060 `type:'team'` 帧模式加 `type:'goal'` 帧即可（本卡未实现）。

## 3. Local Server seam（新增 API）

前缀 `/api/goal`。栈 = `apps/local-server/src/goalSeam.ts`（`GoalSeam` 组合 063 两个 store +
LoopEngine + 061/062 adapter 真实运行链 + 066 RunControl；`queue`/`iterations` 可注入临时根做测试）。

- `GET  /api/goal/tasks[?projectRoot=&status=]` → `{ tasks: QueueTask[] }`（新在前）
- `POST /api/goal/tasks` `{ projectRoot, goal, acceptance? }` → `201 { task }`（enqueue，validate 400）
- `GET  /api/goal/tasks/:id` → `{ task }` / 404
- `GET  /api/goal/tasks/:id/iterations` → `{ taskId, iterations, record }`（回放，空 → `[]`）
- `POST /api/goal/tasks/:id/run` → `200 { result: GoalRunResult }`（claim → LoopEngine
  [RealGeneratorAdapter + RealEvaluatorAdapter + TempDir workspace] → IterationStore
  （含 061 generator / 062 evaluator 快照 + transition）→ queue.settle）
- `POST /api/goal/tasks/:id/pause` → `200 { task, paused: true }`（066：挂起 live run，
  queue → paused；无 live run → 400）
- `POST /api/goal/tasks/:id/resume` → `200 { task, paused: false }`（066：继续挂起 run，
  queue → in-progress；无 live run → 400）
- `GET  /api/goal/tasks/:id/budget` → `200 { taskId, budget: {maxIterations, maxRetries}, paused }`
  （066：查询 §11.1 预算，默认 1/1；404 未知任务）
- `POST /api/goal/tasks/:id/budget` `{ maxIterations?, maxRetries? }` → `200 { taskId, budget }`
  （066：设置预算 —— Goal/Loop 模式放宽入口；非法值 400）

服务端模型：`GoalRunResult { queueTask, entry?, record?, outcome: met|not_met|stopped|error, error? }`。

## 4. 跑起来

```bash
npm run -w @vessel/web dev      # vite dev（/api 代理到 5678）
# 或 vessel serve 后打开静态产物；Customize → 勾选 Tasks（默认开）
```

## 5. 与 060/063/050/066 的关系

- seam 端点/§1 状态机复用 063 `ProjectTaskQueue` + `IterationStore`（目录式原子写、无永久删除）。
- 运行触发复用 061/062 adapter + LoopEngine（§11.1 边界）；队列 `settle` 把 evaluator 瞬时
  verdict met → met、其余 → not_met（绝不自证 met）。
- 066 `RunControl`（engine/run-control.ts）：pause/resume 是**挂起门**（迭代/attempt 边界
  await resume gate，绝不 abort）——与 050 InterruptController（中止）语义区分；budget
  默认 1/1（§11.1），Goal/Loop 模式放宽（`setBudget` 上调 maxIterations/maxRetries），
  用尽 → 停 + exhausted 可查原因。
- 067（Context Reset Handoff UI）本卡**不做**，留待 067 拆卡。