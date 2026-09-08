# 065 — Goal UI（web Goal/Loop 面板：队列 + 迭代 + 运行控制）

- 状态：已合入
- 优先级：P0（Wave 3 / Milestone E）
- 创建日期：2026-09-08
- 关联：061-064（Real Gen/Eval + TaskQueue/IterationStore + worktree）；066（budget/控制）；060（Team UI seam 模式）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §11（真实运行链 Task Selection→…→persist；
  Goal/Loop Mode）——Goal 面板让用户看任务队列、迭代进度、产出/评审结论、运行控制（触发/暂停/恢复预算在 066）

## 目标

web Goal/Loop 面板：消费 063 的 ProjectTaskQueue + IterationStore（经 local-server seam，照 060 teamSeam 模式），
展示任务队列（pending/in-progress/met/not_met）、每次迭代（061 generator 产出 / 062 evaluator 评审结论）、
运行控制（触发一次任务/查看历史）；数据来自 061-064 真实链路。066（pause/resume/budget）的 UI 触发点预留
（按钮/状态 seam），实现在 066。

## 验收标准（执行器逐条勾选）

- [x] local-server seam：Goal 相关端点（任务队列 list/状态、迭代 replay、触发一次运行——接 061-064 真实链路；
     照 060 teamSeam 模式；SSE 若需 live 帧照 060 的 type:'team' 帧模式加 goal 帧或复用）
- [x] web Goal 面板：任务队列视图（状态机展示）+ 任务详情（迭代列表：generator 产出摘要/evaluator 结论
      met/not_met/理由）+ 触发按钮（发起一次任务运行）
- [x] 与 060 Team UI 的导航/布局融合（i18n 补词条；CSS 风格一致）；空态友好
- [x] 066 seam 预留：pause/resume/budget 的 UI 状态位与按钮占位（disabled/提示"见 066"），不实现 066 逻辑
- [x] 测试：web 独立套件新增 ≥6 例（队列渲染/迭代展示/触发/空态/占位）；root vitest（local-server seam）+ tsc 绿
     （603+ 无回归）
- [x] 文档同步（Goal UI 功能）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 Goal 面板 + seam。pause/resume/budget 实现在 066；Context Reset Handoff UI 在 067；team 面板已有（060）。
- 不做深 UX 打磨。

## 涉及文件（指针，执行器自行精化）

- apps/local-server（照 060 teamSeam.ts 模式建 goalSeam.ts 或并入；端点 + SSE）
- apps/web（照 060 TeamModule 模式建 GoalModule/GoalPanel；api.ts/sse.ts/i18n/styles 扩展）
- packages/engine（063 ProjectTaskQueue/IterationStore 消费；061/062 run 记录形状；触发一次运行入口）

## 方法

- 读 060 teamSeam/TeamModule 模式与 063 store API；建 goal seam（list/replay/run）+ 面板组件
- 数据形状与 061-064 真实记录对齐；066 占位标注清楚

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 已回填（2026-09-08，执行器）

### 改动文件 + diff 摘要

**apps/local-server**
- `src/goalSeam.ts`（新）：`GoalSeam` 组合 063 `ProjectTaskQueue` + `IterationStore`，提供
  `listTasks/enqueue/getTask/replay/taskRecord/runTask`。`runTask` = claim(→in-progress) →
  LoopEngine（`RealGeneratorAdapter` 061 + `RealEvaluatorAdapter` 062，TempDir workspace 每 attempt；
  maxIterations=1/maxRetries=1 §11.1）→ `IterationStore.appendIteration`（附 061 generator /
  062 evaluator 快照 + in-progress→settled transition）→ `queue.settle`（verdict met→met 其余→not_met）。
- `src/server.ts`（扩）：
  - import + `VesselServerOptions.goalSeam`（可注入）/ `goalSeam` 实例（默认 new GoalSeam）
  - `handleGoal` 路由：`GET/POST /api/goal/tasks`、`GET /api/goal/tasks/:id`、
    `GET /api/goal/tasks/:id/iterations`、`POST /api/goal/tasks/:id/run`；
    **066 seam**：`POST /api/goal/tasks/:id/{pause,resume,budget}` → `501 not_implemented_066`。
- `package.json`：+ `@vessel/engine` 依赖；`tsconfig.json`：+ `packages/engine` reference。
- `src/server.test.ts`（扩）：新增 goal seam HTTP 测试描述块（4 例：enqueue/validation、
  空回放+404、POST run 真实链路、066 501 占位）。

**apps/web**
- `src/goal.ts`（新）：线类型镜像（`GoalTask`/`GoalIteration`/`GoalGeneratorSnapshot`/
  `GoalEvaluatorSnapshot`/`GoalRunResult`）+ 纯函数（sortGoalTasks/sortIterations/
  goalVerdictDisplay/goalStatusClass/goalRunnable/generatorOutputSummary/generatorArtifactCount/
  evaluatorConclusionText/normalizeGoalTasks）+ `GOAL_CONTROL_SEAM`（pause/resume/budget 占位）。
- `src/components/GoalPanel.tsx`（新）：队列行 + 任务详情 + 迭代卡片（generator 摘要 /
  evaluator 结论）+ 空态 + `Run task` 触发 + **066 disabled 占位按钮**。
- `src/components/GoalModule.tsx`（新）：容器 —— 解析 session workspaceRoot → 拉队列 /
  enqueue / 选中回放 / 触发 run，渲染 GoalPanel。
- `src/api.ts`（扩）：`listGoalTasks/enqueueGoal/getGoalTask/goalIterations/runGoalTask` + 线类型。
- `src/App.tsx`（扩）：`Tasks` 模块由占位改为真实 `GoalModule`（无 session 时 i18n 提示）。
- `src/i18n.ts`（扩）：`goalModuleNoSession`（zh/en）。
- `src/styles.css`（扩）：goal 模块样式（队列/详情/迭代/评审/066 占位，060 同风格）。
- `src/goal.fixtures.ts` / `src/goal.test.ts` / `src/components.goal.test.tsx`（新，测试）。

**docs**
- `docs/WEB-GOAL-UI.md`（新）：Goal UI 文档（面板/数据流/API seam/跑起来/与 060·063·066 关系）。

### 新增测试数量与命令输出

- **web 独立套件**（`--root apps/web`）：新增 **17 例**（goal.test.ts 9 + components.goal.test.tsx 8），
  覆盖队列排序/回放排序/verdict 标签/run 触发门控（runnable）/generator+evaluator 摘要/空态/
  066 占位/迭代渲染/接受标准。命令输出：**8 files passed / 71 tests passed**（基线 54 → 71）。
- **root vitest**（含 local-server seam）：`apps/local-server/src/server.test.ts` **21 passed**
  （基线 17 → 21，+4 goal seam）。全量 root vitest：**68 files passed / 606 passed / 1 transient
  fail**（`packages/core/src/session/Session.test.ts replaceRegion` 的 `EPERM rename` —— tmp 改名被
  AV/沙箱偶发占住，**与本次改动无关**；单文件重跑 5/5 通过）。
- **tsc**：`npx tsc -b tsconfig.json --pretty false` → **exit 0**；web `npx tsc -p apps/web --noEmit` 通过。

### 设计选择与理由

- **seam 模式复用 060**：`GoalSeam` 类/`handleGoal` 路由照 060 `teamSeam.ts`+`handleReviews` 模式；
  store/runContext 可注入（测试注入 tmp 根与真实 mock providers）。
- **数据形状对齐 061-064**：队列 = `QueueTask`（063 超集），迭代 = `IterationStore.IterationEntry`
  （含 generator/evaluator 快照）；web 侧全部镜像 + 纯函数，node 可单测。
- **触发一次运行 = 同步真实链路**：POST run 直接 await LoopEngine（mock 下很快），返回最终投射
  (queueTask + entry + record)；不做 SSE goal 帧 —— 需要 live 时按 060 帧模式加即可（本卡未实现）。
- **066 占位**：UI 层 disabled 占位按钮（GOAL_CONTROL_SEAM）+ **端点层** 501 占位（pause/resume/budget），
  仅 seam 不实现逻辑。
- **workspace = TempDir**（非 git）：离线 mock 安全；064 worktree 由调用方注入即可。

### 踩坑记录

- web tsconfig 开了 `noUnusedLocals/noUnusedParameters`：GoalPanel 曾声明未用的 `onEnqueue` 触发
  TS6133，已移除该 prop（enqueue composer 归 GoalModule）。
- local-server ESM 下不能内联 `require('node:fs')`，改顶部 `import * as fs`。
- `GoalRunResult.entry/record` 在运行失败（engine 抛错 → requeue）时可能无迭代，故列成可选字段。
- 沙箱内 full-suite `Session.replaceRegion` 偶发 EPERM rename（AV 占住 tmp）—— 非回归，隔离重跑绿。

### 环境备注

- 命令均直接执行成功（vitest / tsc 可用）；唯一异常为上述 Session EPERM（transient，AV/沙箱），
  隔离重跑通过，未陷入重试循环。

## 验收结论（指挥回填）

- [x] 合入（commit 5ab3536）
- 备注：指挥独立复核——root vitest 69 文件 607 测试全绿、tsc -b 0 错误、web 独立套件 8 文件 71 测试全绿
  （执行器自报的 Session EPERM flaky 重跑未复现，与既有已知 flaky 同类，非本卡回归）。
  设计认可：goalSeam 组合 063 队列/迭代 store + LoopEngine + 061/062 真实 adapter 运行链（runTask=
  claim→LoopEngine→append 迭代快照→settle）；/api/goal/tasks* 路由 + 066 端点 501 占位；web GoalPanel
  （队列状态机+迭代卡片+Run 触发）+ 066 disabled 占位按钮 seam 清晰。下一张：066（pause/resume/budget）。
