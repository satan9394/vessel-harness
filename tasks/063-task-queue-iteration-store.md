# 063 — 持久 TaskQueue（ProjectTaskQueue + IterationStore）

- 状态：待执行
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

- [ ] ProjectTaskQueue：项目级任务队列（enqueue/dequeue/list/状态），任务含验收标准与状态机
      （pending/in-progress/met/not_met/…），持久化到项目 .vessel 或既有约定（参照 059 的目录/id/原子写模式）
- [ ] IterationStore：一次任务的迭代记录（iteration n：generator 产出快照/测试结果/评审结论/状态转移），
      与 058 review / 061-062 adapter 产出接上；可回放（给 065 UI / 067 handoff）
- [ ] 复用既有存储与 id 约定（sess_/team_/review_ 同款）；原子写；不引入新依赖
- [ ] 测试：队列 CRUD/持久化 round-trip/状态机/迭代记录/并发安全，新增 ≥6 例；root vitest/tsc 绿
      （544+061+062 新增数 无回归）
- [ ] 文档同步
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

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

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
