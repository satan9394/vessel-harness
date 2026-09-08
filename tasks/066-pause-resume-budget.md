# 066 — Pause / Resume / Budget（运行控制 + 默认自治限制）

- 状态：待验收
- 优先级：P0（Wave 3 / Milestone E）
- 创建日期：2026-09-08
- 关联：061/062（LoopEngine 运行链）；063（队列/迭代）；065（Goal UI 已留 501 占位端点 + disabled 按钮 seam）；050（interrupt 语义）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §11.1（L1210-1227）：默认 maxIterations=1 / maxRetries=1；
  用户进入 Goal / Loop Mode 才放宽；不要普通聊天默认无限循环

## 目标

实现运行控制与预算：任务运行可 pause / resume；iteration 与 retry 预算（maxIterations/maxRetries）
可查询/设置（默认 1/1，§11.1），Goal/Loop 模式放宽时生效；接 065 已留的 UI/端点 seam（501 占位→真实现）。
与 050 interrupt（停）互补：pause=暂挂可恢复、resume=恢复、budget=上限控制。

## 验收标准（执行器逐条勾选）

- [x] pause/resume：任务运行中可暂停（暂挂当前/下一个迭代边界），恢复继续；与 050 interrupt（终止）语义区分
      （pause 不 abort 信号，只挂起；resume 继续）；状态持久可见（队列/运行状态机扩展，接 063）
- [x] budget：maxIterations/maxRetries 查询与设置（默认 1/1，§11.1）；Goal/Loop 模式放宽机制（入口/模式标志）；
      budget 用尽行为明确（停 + 可查原因）；061/062 e2e 的 1/1 上限语义不回归
- [x] 接 065 seam：goalSeam 的 pause/resume/budget 端点（501）→ 真实现；web GoalPanel 的 disabled 按钮 → 启用
      （调 API；UI 打磨从简）
- [x] 测试 ≥6 例：pause 挂起/恢复/与 interrupt 区分/budget 默认 1/1/设置生效/用尽行为；root vitest/tsc 绿
      （607+ 无回归）+ web 相关套件绿
- [x] 文档同步（运行控制语义：pause/resume/budget + Goal/Loop 模式）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做运行控制与预算。Context Reset Handoff（067）、soak（068）各自成卡。
- 不重写 LoopEngine 循环，扩展其控制 seam（参照 064 的 per-attempt 结构与 050 interrupt 接线）。

## 涉及文件（指针，执行器自行精化）

- packages/engine/src/LoopEngine.ts（iteration/retry 预算参数、运行状态机——扩展 pause/resume/budget seam）
- packages/engine/src/project-task-queue.ts（063：任务状态机扩展 pause/resumed 等状态）
- apps/local-server/src/goalSeam.ts + server.ts（065：501 端点→真实现）
- apps/web（GoalPanel 066 占位按钮启用；goal.ts 类型）
- 050 InterruptController（packages/core：interrupt 语义复用/区分——engine 侧挂起机制）

## 方法

- 读 §11.1 与 LoopEngine 现状（maxIterations/maxRetries 现有参数、iteration 循环）
- pause：运行状态机加 paused（在迭代/attempt 边界检查挂起，await resume gate）；不 abort 信号
- budget：参数注入 + Goal/Loop 模式放宽入口；用尽→停 + 可查原因

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 已回填（2026-09-08，执行器 session-fc88ff78）

### 改动文件 + diff 摘要

**engine（新增机制，core 零依赖）**
- `packages/engine/src/run-control.ts`（新增）：`RunControl` 运行控制门 —— `pause()/resume()`（挂起
  Promise gate，幂等，绝不 abort，无 abort()/signal 面）+ `getBudget()/setBudget()`（maxIterations/
  maxRetries，默认 1/1 §11.1，越界 fail loud）+ `exhausted` 哨兵（iterations/retries 用尽原因可查）+
  `awaitIterationBoundary()/awaitAttemptBoundary()`（LoopEngine 边界咨询）。与 050 InterruptController
  （abort 终止）语义硬区分：本类从类型层就没有 abort 面。
- `packages/engine/src/LoopEngine.ts`：`LoopEngineOptions.control?: RunControl` seam；`run()` 迭代循环
  改为无限循环 + 每迭代边界 `awaitIterationBoundary`（挂起/预算用尽即停，用尽返回 lastReport 不抛）；
  无 control 时走原静态 1/1 兜底（061/062 语义零变化）；`runTask()` attempt 循环前
  `awaitAttemptBoundary`（挂起继续同一 attempt）；`retryCap()` 活读 control budget（运行中上调即时生效）；
  末次 attempt admit 前 `noteRetryExhausted`（retries 用尽原因落哨兵）。
- `packages/engine/src/project-task-queue.ts`：`TaskStatus` 加 `paused`；转移表
  `in-progress ⇄ paused`（+paused→cancelled）；新增 `pause(id)/resume(id)`（仅运行中可挂起/挂起可恢复，
  表外 fail loud）；paused 持久可见、不出队（claimNext 只挑 pending）。
- `packages/engine/src/index.ts`：导出 run-control。

**local-server（065 seam → 真实现）**
- `apps/local-server/src/goalSeam.ts`：`GoalSeam` 挂 `runControls`（taskId → 活 RunControl）与 `budgets`
  （持久预算，跨 run 生效）；新增 `isRunning/pauseTask/resumeTask/getTaskBudget/setTaskBudget`；
  `runTask` 注入 control（预算取 persisted，paused 开局 control 预挂起、queue 不 claim 保持 paused 可见；
  settle 前 paused 自动恢复 in-progress）。
- `apps/local-server/src/server.ts`：501 占位 → 真实现：`POST /tasks/:id/pause`、`POST /tasks/:id/resume`、
  `GET|POST /tasks/:id/budget`（含 404/400 错误面）。

**web（按钮启用）**
- `apps/web/src/goal.ts`：`GoalTaskStatus` 加 paused；`GoalBudget` 类型；`GOAL_CONTROL_SEAM` 启用
  （enabled + hint）；新增 `goalControlEnabled`（按 queue 状态门控使能：pause=运行中 in-progress、
  resume=paused、budget 恒可用）与 `budgetDisplay`。
- `apps/web/src/api.ts`：新增 `pauseGoalTask/resumeGoalTask/getGoalBudget/setGoalBudget`。
- `apps/web/src/components/GoalPanel.tsx`：控制按钮启用 + 接 onPause/onResume/onBudget + 显示当前预算；
- `apps/web/src/components/GoalModule.tsx`：实现 pause/resume/budget 处理（budget 按钮 = 当前值 +1 放宽）。

**文档**
- `docs/RUN-CONTROL.md`（新增）：运行控制语义权威文档（pause/resume/budget 三角、§11.1 默认自治与
  Goal/Loop 放宽、队列 paused 状态、seam 接线、实现要点）。
- `docs/WEB-GOAL-UI.md`：066 占位说明 → 真实现（新端点表、组件职责、与 050/066 关系）。

### 新增测试（共 11 例，全部绿）

| 文件 | 例数 | 覆盖 |
| --- | --- | --- |
| `packages/engine/src/run-control.test.ts` | 7 | pause 迭代边界挂起/恢复（不丢迭代）；attempt 边界挂起（下一次 generate 不启动）；与 050 interrupt 区分（无 abort 面 + 幂等）；budget 默认 1/1（§11.1）；setBudget 生效 + 非法 fail loud；maxIterations 用尽停 + exhausted 可查；maxRetries 用尽哨兵 |
| `packages/engine/src/project-task-queue.test.ts` | +1 | pause/resume 状态机：in-progress ⇄ paused 持久可见、跨实例读回、paused 不出队、非法转移 fail loud |
| `apps/local-server/src/goal-seam-control.test.ts` | 3 | 运行中 pause → queue paused 持久可见 + release 后自动恢复 settle（不 abort）；paused 开局 run 悬停边界、resume 后完整 settle；setTaskBudget/getTaskBudget 默认 1/1、设置持久跨 run、非法 fail loud |
| `apps/local-server/src/server.test.ts` | 改 1 | 501 占位 → 真实现：pause/resume/budget 端点 200/400/404 |
| `apps/web/src/goal.test.ts` | +3 | 066 控制 seam 启用；goalControlEnabled 门控；budgetDisplay |
| `apps/web/src/components.goal.test.tsx` | +1 | pause/resume 按钮按 queue 状态门控渲染 |

### 命令输出（全量验证）

- `npx tsc -b tsconfig.json` → exit 0（root 全 workspace 类型绿）
- `npx tsc -p apps/web/tsconfig.json` → exit 0（web 独立 vite 项目类型绿）
- `npx vitest run`（root）→ **71 files / 618 tests passed**（基线 607，+11 无回归）
- `npx vitest run`（apps/web --root 独立）→ **8 files / 74 tests passed**（基线 71，+3 无回归）
- 备注：一次全量跑出现 iteration-store 测试 Windows `rename EPERM`（并发 root+web 双 vitest 进程的
  瞬时文件锁，非本卡改动导致；单独重跑该文件 11/11 通过，再次全量跑 618/618 全绿）。

### 设计选择与理由

1. **pause 挂起机制 = 边界 await resume gate（非 abort）**：RunControl 持一个 pending Promise gate；
   `pause()` 建 gate，`resume()` 解析；LoopEngine 在每次迭代/attempt 边界 await。pause 只作用于
   「下一跳」，已越界的 in-flight generate/evaluate 跑完 —— 与 050 interrupt（abort 信号、turn 以
   interrupted 结束）语义硬区分，且从 API 层面（无 abort()/signal）杜绝误用。恢复采用「读完当前 gate
   闭包的释放函数」而非布尔翻转，避免 pause→resume 快速来回把旧 gate 泄漏给新边界。
2. **budget = 活值注入**：RunControl 注入后 LoopEngine 每边界读当前 budget（`iterationCap/retryCap`），
   运行中 `setBudget` 上调即时生效（Goal/Loop 模式放宽入口 = seam `setTaskBudget` / `POST budget` 端点），
   无需重建引擎；无 control 时静态 1/1 兜底，061/062 e2e 语义零回归（有专门测试断言）。
3. **用尽行为**：maxIterations 用尽 → 外层循环停（返回最后 report 不抛异常）+ `exhausted` 哨兵
   （kind:'iterations'）；maxRetries 用尽 → 末次 attempt 以 evaluator verdict admit + `exhausted`
   （kind:'retries'）。「为什么停」两层可查：report（retryCount/verdict）+ control.exhausted。
4. **队列状态持久可见**：`paused` 进 063 状态机（in-progress ⇄ paused，paused 不出队、跨实例读回），
   与 interrupt 区分 —— 队列没有「已中断」终态，只有挂起/恢复两个方向。
5. **goalSeam 接线**：每 in-flight run 挂共享 RunControl（runControls map，settle 即清）+ budgets map
   （预算跨 run 持久）；paused 开局（queue 已 paused 再触发 run）control 预挂起、queue 不 claim 保持
   paused 可见，resume 后原样继续。

### 踩坑记录

- **pause 竞态**：测试第一版在 `engine.run()` 刚启动（尚未越过边界 1）就 pause，pause 落在边界 1 上把
  run 挂死（无 resume 方）→ 改为 generate 内暴露 `started` 信号，确认 in-flight 后再 pause。
- **GateFirstCallProvider 死锁**：paused-start 测试里 resume 后首次 chat 又撞上未释放的 gate →
  paused-start 用非 gating provider，gating provider 只用于「运行中 pause」场景。
- **Windows rename EPERM**：并发跑 root+web 两套 vitest 时 iteration-store 测试瞬时 EPERM（文件锁），
  单跑 + 顺序全量均绿 —— 环境瞬态，非本卡回归。
- **partial budget 更新**：`{...current, ...update}` 会把 undefined 字段重置为 1/1 → 改为显式判
  `!== undefined` 保留现值；server 侧 unknown body 先 `asInt` 归一。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
