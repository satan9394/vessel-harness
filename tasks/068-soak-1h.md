# 068 — 1h Soak（长跑稳定性验证）

- 状态：待验收
- 优先级：P1（Wave 3 / Milestone E 收官）
- 创建日期：2026-09-08
- 关联：061-067 全部（真实运行链 + 运行控制 + handoff）；V0.2 曾有 long-run 经验
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md（长任务：Goal Loop 真实运行、3h soak 提及于
  V1.5 release gates 背景；本卡为 1h soak 起点）+ 路线「立即做什么」第五步之后

## 目标

1h soak：用 061-067 的真实链路（ProjectTaskQueue + Real Gen/Eval + IterationStore + RunControl + Handoff）
跑一个长会话/多迭代目标（约 1 小时或足以暴露泄漏/漂移的量级），验证：无 workspace 泄漏（064）、
迭代/预算行为稳定（066）、队列/迭代持久化 round-trip 稳定（063）、handoff 触发可用（067）、内存/临时
目录不增长。产出 soak 报告（覆盖场景/观测/问题/结论）。

## 验收标准（执行器逐条勾选）

- [x] soak 场景脚本/夹具：多任务队列 → 真实 gen→eval 循环（mock provider 可控）→ 多迭代 → 触发 handoff
      续跑；运行时长或迭代量级足以暴露问题（1h 或等价迭代数，注明量级换算）
- [x] 观测项：workspace/temp 目录残留（064 保证）、迭代/预算计数与配置一致（066）、队列+迭代持久化
      round-trip（063）、handoff 生成+续跑（067）、内存增长（如有明显泄漏点）
- [x] soak 运行（后台 job 或可重复脚本）并采集数据；报告落盘（docs/SOAK-068.md 或 benchmarks/reports/）：
      场景/时长/迭代数/观测值/发现的问题与修复/结论
- [x] 发现的问题修复或明确转卡（不无限修；明确"转入后续"即可）；修复须带测试
- [x] 全量 vitest/tsc 在 soak 前后绿（634+ 无回归）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 soak 验证 + 报告。若暴露的问题超出本卡范围（如新安全问题→069+），记录并转卡即可。

## 涉及文件（指针，执行器自行精化）

- benchmarks/ 或 scripts/（soak 运行脚本；benchmarks/runners 既有模式）
- 061-067 各模块（被测链路）
- 报告输出（benchmarks/reports/ 或 docs/）

## 方法

- 用 mock provider（确定性）驱动真实链路：queue 多任务 → LoopEngine（gen→eval）→ IterationStore → RunControl
  （budget/pause/resume 穿插）→ Handoff 触发续跑
- 后台 job 跑 soak；期间观测 temp/worktree 目录与内存；结束后出报告

## 工作证明（执行器回填：改了什么/测试输出/soak 报告摘要，全部写进本文件，勿留对话里）

### 改动文件（新增，未改任何既有模块）

- `benchmarks/runners/src/soak/soak-driver.ts` —— soak 驱动库（`runSoak(cfg)`）：多任务队列 →
  LoopEngine（select=projectQueueSelectTask / generate=RealGeneratorAdapter / evaluate=RealEvaluatorAdapter /
  persist=IterationStore.appendEngineResult + queue.settle / TempDirWorkspaceFactory per-attempt 064）→
  逐轮整队 drain（roundCounter 驱动 reviewer gate，rounds-to-met=idx%maxAccepted+1，not_met requeue 开新轮）→
  RunControl 每轮 setBudget 放宽/收紧 + 每 pauseEvery 轮 arm-pause→mid-run-resume 门（066）→
  每 handoffEvery 轮 collectHandoffMaterial→HandoffStore.create（continuationOf 链，067）→
  结束从最新 handoff handoffToTaskSeed 起新引擎续跑并断言新增迭代（067）。观测：per-run 唯一
  workspace 前缀残留计数（hermetic 064）/ attempts & iterationsPerTask / countConsistent（IterationStore
  replay==tracked）/ heapUsed 时间序列（内存）/ 全新 store 实例 round-trip（063/067）。
- `benchmarks/runners/src/soak/run-soak.ts` —— CLI 入口（env：SOAK_TASKS/ROUNDS/HANDOFF_EVERY/PAUSE_EVERY/
  MAX_ACCEPTED/BASE），写 `benchmarks/reports/SOAK-068/<runId>/soak-report.json` + soak-summary.txt。
- `benchmarks/runners/src/soak/soak-driver.test.ts` —— 2 例确定性回归（毫秒级）：全链路不变量
  （064 残留 0 / 063 round-trip / 066 pause+budget / 067 handoff+续跑 / countConsistent）+ 逐边界残留压力。
- `benchmarks/reports/SOAK-068.md` —— soak 报告主文档。

### soak 观测数据摘要（全量：300 任务 / maxAcceptedRounds=6 / handoffEvery=1 / pauseEvery=1）

- run1（soak_2026-09-08T17-12-52-075Z）：wall 154.3s；**attempts=1801**（=50×Σ(1,3,5,7,9,11)+1 续跑，
  与确定性模型逐位一致）；**iterations=1051**；终态 300/300 met；**handoffs=750**、chain=5；
  pauseResumeCycles=6、budgetChanges=12；**tempResidue=0**（全程采样+结束）；storeDirBytes≈3.2MB；
  heap 13.5→24.3MB（Δ+10.8MB/1801 attempts ≈6KB/attempt 单调上升）；roundTrip queue=300/300、
  iterations=300、handoffs=750/750、countConsistent=true；resumeProducedIteration=true（+1 迭代）；
  exhausted={iterations, atIteration:51}（末轮预算用尽哨兵）。
- run2（稳定性复跑，soak_2026-09-08T17-16-10-411Z）：确定性计数**逐位一致**（1801/1051/750/chain 5/
  met 300/residue 0）；wall 186s（并发负载）、heap Δ+17.5MB 波动。
- 1h 等价换算：真实 LLM 一次 gen→eval 约 5-30s → 1h ≈ 120-600 迭代；本 soak 1051 迭代 / 1801 真实
  adapter 调用（每次含 TeamRuntime developer + InternalReviewer reviewer 会话 + 隔离 workspace
  create/dispose + 队列/迭代原子写）≈ 1h 真实量级的 10-50 倍；另 O(N) 队列扫描使 wall 也达分钟级。

### 发现的问题与处理

1. adapter `history` 无界增长（内存单调上升）→ **转后续卡**（建议有界环/retention，不改本卡行为）。
2. ProjectTaskQueue `claimNext/list` O(N) 全目录扫描（吞吐随队列规模线性下降，实证 200 vs 3000 任务
   ≈69ms vs ≈1.5s per attempt）→ **转后续卡**（建议游标/索引/缓存）。两者均为文档声明的设计内取舍。
3. soak 自身并发污染（共享 tmp 前缀被并行 vitest/后台 soak 污染残留计数）→ **已修**（per-run 唯一
   workspace 前缀，hermetic 064），修复带测试。

### 全量 vitest/tsc 结果

- soak 前基线：root vitest 72 文件 / 634 测试 = 633 passed + 1 failed（失败为既有 Windows
  `EPERM: rename …meta.json.tmp→meta.json` 瞬时 flake，重跑该文件通过——非本卡引入）；`tsc -b` exit 0。
- soak 后最终：root vitest **73 文件 / 636 测试全绿（exit 0）**；`tsc -b` exit 0。新增 soak 2 例。
  EPERM flake 最终复跑未再现（见下"环境备注"）。

### 踩坑记录

- Windows `EPERM rename`（059 ReviewHandoffStore.writeMeta tmp+rename 原子写与并发/杀软瞬时竞态）
  是既有环境 flake；本卡 soak 数千次原子写未复现。
- soak 初版 round 模型（每轮 1 任务）在大队列下爬行 —— 改「每轮整队 drain」后吞吐恢复；爬行本身
  暴露了 O(N) 队列扫描特征（§问题 2）。
- 共享 os.tmpdir 前缀的并行污染（见问题 3）——修复后测试可并行安全运行。

### 环境备注

- 本会话为非受限环境，`npx vitest run` / `npx tsx` 均可直跑；长 soak 全程后台 job（run_in_background）
  执行，期间完成报告/验证准备。无 EPERM/spawn/管道阻断需留待指挥验证的事项。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
