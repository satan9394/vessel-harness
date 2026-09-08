# ProjectTaskQueue + IterationStore —— 持久 TaskQueue 与迭代留痕（task 063）

> 实现卡：`tasks/063-task-queue-iteration-store.md`；权威需求：`docs/Vessel_后续开发方向与产品化路线_v1.0.md`
> §11（L1184-1228：真实链 Task Selection → Worktree → Developer Agent → Tests → Reviewer →
> met/not_met → retry → **persist**——本卡补上任务选择来源的持久队列与每次运行的迭代留痕）。
> 前置：061（`RealGeneratorAdapter` + `GeneratorRunRecord`）、062（`RealEvaluatorAdapter` +
> `EvaluatorRunRecord`）、059（`ReviewHandoffStore`：目录 / id / 原子写 / env root 覆盖的存储模式范本）。
> 代码位置：`packages/engine/src/project-task-queue.ts`、`packages/engine/src/iteration-store.ts`
> （engine = 061/062 adapter 所在的 loop 驱动侧，任务/迭代模型同在）；seam 契约在
> `packages/engine/src/LoopEngine.ts`（`LoopTask` / `IterationResult` / `LoopEngineDeps.persist`）。

## 1. 一句话

两个持久存储（059 store 模式，同步 IO + 原子写，不新增依赖），供 Goal/Loop 真实运行与 065 UI /
067 handoff 消费：

- **ProjectTaskQueue**：项目级任务队列（每任务一个目录记录，状态机
  `pending → in-progress → met/not_met`，另 `requeue` 开新轮 / `cancel` 软移除），是真实链
  「Task Selection」的**持久任务选择来源**；
- **IterationStore**：per-task 迭代日志（每次运行 append 一条：verdict/evidence/reason +
  061 generator 产出快照 + 062 evaluator 评审快照 + 状态转移），**可回放**。

```text
enqueue(task{goal+acceptance, projectRoot})      appendEngineResult / appendIteration
   │  ProjectTaskQueue（.vessel/taskqueue/…）            │  IterationStore（.vessel/iterations/…）
   ▼                                                    ▼
claimNext ──▶ LoopEngine.selectTask              taskId ──▶ iterations[1..n]（ordinal 序数）
   │                gen（061）→ eval（062）→ persist          每运行一条：verdict/evidence/
settle(met|not_met) ◀── 结果回写队列                      generator 快照 / evaluator 快照
```

## 2. 为什么放 engine / 复用 059 模式

- 队列/迭代的领域模型（`LoopTask`、`IterationResult`、061/062 run 记录）全在 engine——存储作为
  它们的持久化面放同包，不新增包、不新增 npm 依赖、不引入跨层引用（全部 node 内建 + engine 自产类型）。
- **存储模式照抄 059 不重造**：每条记录一个目录 + `meta.json`；写走 `tmp+rename` 原子替换
  （`meta.json.<pid>.<ts>.tmp` → rename，崩溃不撕裂）；缺省 `~/.vessel/<kind>`、env 可覆盖
  （`VESSEL_TASKQUEUE_ROOT` / `VESSEL_ITERATIONS_ROOT`），测试注入 tmp 根；id 沿用既有
  `<kind>_<ts>_<hex>` 约定（sess_/team_/review_ 同款）——队列 `task_…`、迭代条目 `iter_…`。
- IO 同步（与 SessionRegistry / ReviewHandoffStore / ProjectRegistry 同风格）；读取容忍损坏条目
  （跳过不炸）；写操作对未知 id / 非法状态转移 / 空字段 **fail loud**（调用方 bug 如实暴露）。

## 3. ProjectTaskQueue —— 项目级持久任务队列

### 记录形状（`<root>/<task-id>/meta.json`，LoopTask 超集）

| `QueueTask` 字段 | 含义 |
|---|---|
| `id` | `task_<ts>_<hex>`（enqueue 自动；测试可注入确定性 id/now） |
| `goal` / `acceptance` | 任务目标 + 验收标准（对齐 061/062 run 请求输入与 LoopTask；acceptance 只透传，不进 developer 自评） |
| `projectRoot` | 所属项目工作区根（绝对路径；"项目级"归属与过滤键） |
| `status` | `pending / in-progress / met / not_met / cancelled` |
| `createdAt/updatedAt/startedAt/settledAt` | 生命周期时间戳（ISO） |
| `outcome` | settle 结论快照：`status/verdict(原始 evaluator 瞬时结论)/reason/iteration/settledAt` |

### 状态机与 API

```text
pending ──claimNext/claim──▶ in-progress ──settle(met)────▶ met（终态）
    ▲                            │                          
    │                            ├──settle(not_met)──────▶ not_met（终态；可 requeue）
    │                            ├──cancel────────────────▶ cancelled（终态：软移除，不删文件）
    │                            └──requeue────────────────┘
    └──────────── requeue ◀─────────（not_met → pending）
```

- `enqueue({goal, acceptance?, projectRoot})` —— 校验非空 → 落盘 pending；
- `claimNext({projectRoot?})` —— **FIFO**（createdAt 升序）取最早 pending → in-progress；
  空队列 → `null`（对齐 LoopEngine `selectTask` 的 null=stop 契约）；领取前**重读 meta** 校验
  仍为 pending（并发领取不重复）；
- `claim(id)` / `settle(id, verdict, {reason?, iteration?})` / `requeue(id)` / `cancel(id)` ——
  只允许状态机表内转移，表外（未 claim 就 settle、终态再动、重复 claim）fail loud；
- `get/list({projectRoot?, status?})` —— list 最新在前；损坏条目跳过。

**verdict 归一**：settle 收 evaluator 瞬时结论 `met/not_met/impossible/error` → 队列终态
`met`（仅 met）/ `not_met`（其余一律——绝不自证 met）；原始 verdict 留 outcome 可回读。

**接线**：`projectQueueSelectTask(queue, {projectRoot?})` 把队列接到 `LoopEngineDeps.selectTask`
（claim 后返回 `{id, goal, acceptance}`）；运行结果回写 `settle`（met/not_met）或中断时
`requeue`。retry/预算自动循环主体不在本卡（066）。

## 4. IterationStore —— per-task 迭代日志

### 记录形状（`<root>/<task-id>/meta.json`：任务基座 + `iterations[]` 追加式）

| 字段 | 含义 |
|---|---|
| `taskId` | 记录键 = 任务 id（目录名安全校验，防路径逃逸） |
| `goal` / `acceptance` / `projectRoot` | 任务基座快照（首次 append 落库后**不可变**） |
| `iterations[]` | 追加式日志；每条 = 一次运行（iteration n） |

| `IterationEntry` 字段 | 含义 |
|---|---|
| `iteration` | **per-task 序数 1..n**（append 次序即回放顺序；不采用 LoopEngine 实例内迭代号——引擎重启计数会复位，per-task 序数才是跨引擎唯一的回放/展示索引） |
| `id` / `createdAt` | `iter_<ts>_<hex>` / 落库时间 |
| `verdict/evidence/reason/outputPath/retryCount/metAfterRetries` | **LoopEngine `IterationResult` 1:1**（`appendEngineResult` 直连 persist seam） |
| `engineIteration` | LoopEngine 实例内顶层迭代号（参考字段，跨引擎不恒唯一） |
| `transition` | 队列状态转移（如 `{from:'in-progress', to:'met'}`）——队列/迭代 key 贯通点 |
| `testResults` | 真实链「Tests」步独立产出摘要（若有） |
| `generator` / `evaluator` | **061 `GeneratorRunRecord` / 062 `EvaluatorRunRecord` 整记录快照**（JSON 可序列化；evaluator.conclusion 即 058 review 结论五字段，含 unmet/suggestions 富反馈） |

### API

- `appendIteration(task, entry)` —— 首次以 task 快照建记录；之后仅校验 taskId 一致、基座不变；
  ordinal = 现有条数 + 1；返回写后完整记录；
- `appendEngineResult(task, result: IterationResult)` —— persist seam 直连（1:1 落库）；
- `replay(taskId)` —— 该任务全部迭代（回放给 065 UI / 067 handoff）；无记录 → `[]`；
- `get(taskId)` / `list()` —— 最近更新在前；损坏条目跳过。

## 5. 与既有产出的接法（回放语义）

- **062 → 063**：`IterationResult`（LoopEngine admit 时 persist 的 verdict/evidence/reason…）由
  `appendEngineResult` 落库；每次运行 1 条，对应 065 UI 的任务迭代时间线；
- **061/062 run 记录 → 063**：把 final attempt 的 `GeneratorRunRecord` / `EvaluatorRunRecord`
  （adapter `lastRun`）随 entry 整快照入库——回放时 output/artifactPaths/evidencePaths/
  conclusion(unmet/suggestions) 全部可读，067 handoff 的改动证据与评审理由不必回 adapter 内存；
- **058 review 结论**：即 `entry.evaluator.conclusion`（TeamReviewConclusion 形状，不另存一份）；
- **队列 ↔ 迭代**：同 `taskId` 贯通；队列 `settle(…, {iteration})` 的 outcome.iteration 可与
  IterationStore ordinal 对应（展示「第 n 轮 → met」）。

## 6. 范围边界与并发说明

- 只做持久化存储 + API（含 LoopTask/IterationResult 适配接线函数）。worktree（064）、Goal UI
  （065）、budget/自动 retry 循环（066）、Context Reset Handoff（067）各自成卡。
- **并发安全**：单进程同步 IO + 原子 tmp+rename（撕裂写不可能落盘）；claim 前重读 meta、
  同进程多实例顺序调用不重复领取（测试覆盖 20 轮跨实例交替 claim→settle，零重复零 .tmp 残留）。
  跨进程多写者**无文件锁**——上层当前单写者，063 不引入锁（如需并发写队列属后续卡）。

## 7. 测试

`packages/engine/src/project-task-queue.test.ts`（13 例）+ `packages/engine/src/iteration-store.test.ts`
（10 例）：root/id/状态机转移表纯函数；enqueue 目录布局与字段；**FIFO claimNext** 与空队列 null；
跨实例不重复领取；settle outcome 快照与 verdict 归一；requeue/cancel 完整生命周期与软移除（不删文件）；
**持久化 round-trip**（跨实例读回终态）；list 过滤；非法操作 fail loud（未知 id/表外转移/空字段）；
损坏条目容忍；**并发安全**（多轮跨实例交替 + 无 .tmp 残留）；IterationStore ordinal 续号/跨实例追加；
`appendEngineResult` 1:1（含 impossible/error 原样保留）；061/062 整快照 + transition 落库回放；
目录逃逸守卫；队列 ↔ 迭代 key 贯通。全量 vitest/tsc 绿（root 基线 + 本卡新增无回归）。
