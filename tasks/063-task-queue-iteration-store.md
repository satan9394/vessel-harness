# 063 — 持久 TaskQueue（ProjectTaskQueue + IterationStore）

- 状态：已合入
- 优先级：P0（Wave 3 / Milestone E）
- 创建日期：2026-09-08
- 关联：061/062（Real Gen/Eval adapter 跑的任务）；064（worktree）；066（budget）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §11（ProjectTaskQueue/IterationStore：真实运行链的
  任务选择与迭代持久化；Task Selection→…→persist）

## 目标

ProjectTaskQueue + IterationStore：任务的持久队列（项目级，任务选择来源）与迭代记录持久化（每次
gen→test→eval→met/not_met 迭代留痕），供 Goal/Loop 真实运行与 065 UI/067 handoff 消费。存储走既有
.vessel 约定（参照 059 review store 的目录/原子写/root 覆盖模式）。

## 验收标准（执行器逐条勾选）

- [x] ProjectTaskQueue：项目级任务队列（enqueue/dequeue/list/状态），任务含验收标准与状态机
      （pending/in-progress/met/not_met/cancelled），持久化到 ~/.vessel/taskqueue（env VESSEL_TASKQUEUE_ROOT
      覆盖；参照 059 的目录/id/原子写模式，每个任务 = <root>/<task-id>/meta.json）
- [x] IterationStore：一次任务的迭代记录（iteration n：generator 产出快照/测试结果/评审结论/状态转移），
      与 058 review / 061-062 adapter 产出接上（entry 整快照 GeneratorRunRecord/EvaluatorRunRecord；
      appendEngineResult 直连 LoopEngine persist seam 的 IterationResult 1:1）；可回放（replay 给 065 UI / 067 handoff）
- [x] 复用既有存储与 id 约定（task_/iter_ 同款 sess_/team_/review_ `<kind>_<ts>_<hex>`）；原子写；不引入新依赖
- [x] 测试：队列 CRUD/持久化 round-trip/状态机/迭代记录/并发安全，新增 26 例（queue 15 + iteration 11）；
      root vitest/tsc 绿（564+26=590 无回归）
- [x] 文档同步（docs/TASK-QUEUE-ITERATION-STORE.md）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做持久化存储 + API。worktree（064）、Goal UI（065）、budget（066）各自成卡。

## 涉及文件（指针，执行器自行精化）

- 参照 059 的 packages/application/src/review/ReviewHandoffStore（目录/id/原子写/root 覆盖模式）
- packages/engine 或 agents（061/062 adapter 所在的 loop 驱动侧；Iteration/产出模型）
- 任务对象模型（Task 字段，058 用过 acceptance）

## 方法

- 照 059 store 模式（目录 + meta.json + tmp/rename 原子写 + VESSEL_*_ROOT 覆盖）建 QueueStore/IterationStore
- 状态机与迭代模型对齐 061/062 adapter 输出

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 已回填（2026-09-08，executor 隔离子代理）

### 改动文件（diff 摘要）

| 文件 | 改动 |
|---|---|
| `packages/engine/src/project-task-queue.ts`（新增） | `ProjectTaskQueue` 持久队列 + 类型（`TaskStatus`/`QueueTask`/`TaskOutcome`/`EnqueueTaskInput`）+ 状态机转移表 `TASK_TRANSITIONS` + 纯函数 `canTransitionTaskStatus` / `queueSettleStatusFromVerdict`（evaluator 瞬时 verdict → 队列终态归一，met 之外一律 not_met）；`enqueue`（goal/projectRoot 校验，acceptance 对齐 LoopTask）/ `claimNext`（FIFO，领取前重读 meta 防并发重复）/ `claim` / `settle`（outcome 快照含原始 verdict/reason/iteration）/ `requeue`（开新轮）/ `cancel`（软移除不删文件）/ `get` / `list({projectRoot,status})`；id `task_<ts>_<hex>`；root `~/.vessel/taskqueue`（env `VESSEL_TASKQUEUE_ROOT`）+ tmp/rename 原子写 + 时钟注入（测试）；`projectQueueSelectTask` 把队列接到 LoopEngine selectTask seam（claim → LoopTask，空队列 null） |
| `packages/engine/src/iteration-store.ts`（新增） | `IterationStore` per-task 迭代日志：目录式 `<root>/<task-id>/meta.json`（taskId 目录名安全校验防路径逃逸）；`appendIteration`（首次以任务快照建基座、之后基座不可变；iteration ordinal = per-task 1..n；字段缺省归一）/ `appendEngineResult`（LoopEngine `IterationResult` 1:1 直连 persist seam，含 impossible/error 原样保留）/ `replay`（回放，无记录 → []）/ `get` / `list`；条目含 061 `GeneratorRunRecord` / 062 `EvaluatorRunRecord` 整快照 + `transition{from,to}` + `testResults` + `engineIteration`（参考号）；id `iter_<ts>_<hex>`；root `~/.vessel/iterations`（env `VESSEL_ITERATIONS_ROOT`） |
| `packages/engine/src/project-task-queue.test.ts`（新增） | 15 例：default root/id 约定（env 覆盖、`task_` 前缀）；状态机转移表纯函数；verdict 归一；enqueue 目录布局 `<root>/<task-id>/meta.json` 字段齐；FIFO claimNext（最早 pending 先出、空队列 null）；**跨实例不重复领取**；settle outcome 快照 + met/not_met/error 归一；requeue/cancel 完整生命周期（软移除文件保留、终态不再出队）；持久化 round-trip（跨实例读回终态）；list 按 projectRoot/status 过滤；非法操作 fail loud（未知 id/表外转移/空字段/重复 claim）；损坏条目容忍；**并发安全**（20 轮跨实例交替 claim→settle：零重复领取、met/not_met 各 10、无 .tmp 残留）；`projectQueueSelectTask` 接 selectTask seam |
| `packages/engine/src/iteration-store.test.ts`（新增） | 11 例：default root/id 约定；append 建记录（基座快照 + ordinal=1 + 字段归一）；多次 append ordinal 1..n、基座不可变；`appendEngineResult` 1:1（含 impossible/error 原样）；061/062 整快照 + transition + testResults 落库回放（JSON round-trip）；跨实例追加续号（ordinal 3）；replay 无记录 []/get 未知 undefined/list 最近更新在前；校验 fail loud（空/路径逃逸 taskId、空 goal、非法 verdict——目录逃逸守卫生效）；损坏条目容忍 + 无 .tmp 残留；队列 ↔ 迭代 key 贯通 |
| `packages/engine/src/index.ts` | 追加 `export * from './project-task-queue.js'` + `'./iteration-store.js'`（@vessel/engine 公开） |
| `docs/TASK-QUEUE-ITERATION-STORE.md`（新增） | 设计文档：一句话/为什么放 engine 复用 059/两 store 记录形状与状态机/API/与 061-062 接法（回放语义）/范围边界与并发说明/测试清单 |
| `tasks/063-task-queue-iteration-store.md` | 本卡回填（验收标准勾选 + 状态 → 待验收） |

### 设计选择与理由

1. **放 engine（061/062 adapter 所在包）**：队列/迭代的领域模型（`LoopTask`、`IterationResult`、061/062 run 记录）全在 engine，存储作为持久化面放同包最内聚——不新增包/依赖、不引入跨层引用（只 node 内建 + engine 自产类型；IterationStore 对 adapter 记录全部 `import type`，运行时零依赖）。
2. **存储模式逐条复用 059 不重造**：目录式（每记录一个目录 + meta.json）+ `<kind>_<ts>_<hex>` id 约定 + `tmp+rename` 原子写 + env root 覆盖（`VESSEL_TASKQUEUE_ROOT`/`VESSEL_ITERATIONS_ROOT`，缺省 `~/.vessel/taskqueue` / `~/.vessel/iterations`）+ 同步 IO + 读容忍损坏（跳过）、写 fail loud（未知 id/非法转移/空字段）。
3. **状态机 = 持久协调状态，evaluator verdict 是瞬时结论**：`pending → in-progress → met/not_met`（另 requeue 开新轮 / cancel 软移除承接"无永久删除"铁律）；settle 收 `met/not_met/impossible/error` 归一为 met（仅 met）/not_met（其余一律，绝不自证 met），原始 verdict 留 outcome 快照可回读。任务字段对齐 061 GeneratorRunRequest（goal+acceptance 只透传，不进 developer 自评）。
4. **迭代模型 = per-task 追加日志，iteration 序数 = store 1..n**（append 次序即回放顺序）：不采用 LoopEngine 实例内迭代号（引擎重启计数复位，per-task 序数才是跨引擎唯一的回放/展示索引）；engineIteration 仅作参考号。每条 = 一次运行：IterationResult 字段 1:1 + 061 generator / 062 evaluator **整记录快照**（evaluator.conclusion 即 058 review 五字段，unmet/suggestions 富反馈随快照落库不回 adapter 内存）；transition 记队列状态对（taskId 贯通队列 ↔ 迭代）。
5. **并发安全策略**：单进程同步 IO + 原子写（撕裂写不可能落盘）；claimNext 领取前重读 meta 校验仍 pending（同进程多实例顺序调用不重复领取，测试 20 轮跨实例交替验证）；跨进程多写者无文件锁（上层单写者，063 不引入锁——写进文档边界）。
6. **时钟注入（`now` 可选项）+ enqueue 确定性 id**：FIFO/排序测试确定性（059 测试用同一毫秒并列容忍，本卡用单调时钟彻底消除顺序歧义）。

### 命令输出（本环境可跑）

- `npx tsc -b tsconfig.json` → exit 0（tsc 0 错误）
- `npx vitest run packages/engine` → 7 文件 / **78 测试全绿**（基线 52 + 本卡新增 26，含 iteration 11 + queue 15）
- `npx vitest run`（root 全量）→ **68 文件 / 590 测试全绿**（基线 564 + 本卡新增 26 = 590，无回归；
  web 独立套件 54 未触及，本卡零 web 改动）

### 踩坑记录

- `settle`/`requeue`/`claim` 初版各自调私有 `move()`（读→校验→改→写）后在方法里再改字段二次写盘 → 重构为 `transition()` 只读+校验+改、不落盘，落盘由调用方统一一次（避免同操作双原子写）。
- claimNext 的 startedAt 初版 `fresh.startedAt ?? now`（requeue 后二次 claim 不刷新）→ 语义定为「进入 in-progress 的时间」：claim 一律置 now；requeue 清 startedAt（运行留痕归 IterationStore，队列只管状态视图）。
- list 过滤测试初版断言 `list({status:'pending'})` 为 []，忘了另一个项目的 C 任务仍 pending → 断言改为只查 ROOT_PROJECT 的 pending 为空、全局 pending = [C]（测试数据设计疏漏，非实现 bug）。
- IterationStore append 的条目 id 时间戳用 `Date.parse(now)`（时钟注入时与 createdAt 同源），rand 仍随机保证唯一。

### 环境备注

- 无 EPERM/spawn/管道错误；vitest/tsc 均在本环境直跑成功，无受限说明。

## 验收结论（指挥回填）

- [x] 合入（commit f2a520b）
- 备注：指挥独立复核——全量 vitest 68 文件 590 测试全绿（564+26，零回归）、npx tsc -b 0 错误，与执行器自报一致。
  设计认可：ProjectTaskQueue（持久队列：enqueue/claimNext/claim/settle/requeue/cancel + 状态机转移表，
  task_<ts>_<hex> id，~/.vessel/taskqueue + root 覆盖，原子写；projectQueueSelectTask 接 LoopEngine selectTask）；
  IterationStore（per-task 迭代日志 ordinal 1..n，appendEngineResult 直连 persist seam，061/062 run 快照整落库可
  回放给 065 UI/067 handoff）。严格复用 059 存储模式。并发安全测试（20 轮跨实例交替零重复零 .tmp 残留）。
  下一张：064（worktree 生命周期）——需先拆卡。
