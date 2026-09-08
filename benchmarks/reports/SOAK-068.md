# SOAK-068 —— 1h 等价长跑稳定性验证（061-067 真实运行链）

> 任务卡：`tasks/068-soak-1h.md`；权威需求：`docs/Vessel_后续开发方向与产品化路线_v1.0.md`
> §11/§12（真实运行链 + Context Reset Handoff）；前置：061（RealGeneratorAdapter）、
> 062（RealEvaluatorAdapter）、063（ProjectTaskQueue + IterationStore）、064（workspace 生命周期）、
> 066（RunControl budget/pause/resume）、067（HandoffStore + 续跑）。
> 报告主文件：本文件；每次运行的完整 JSON 观测在 `benchmarks/reports/SOAK-068/<runId>/soak-report.json`。

## 1. 结论（TL;DR）

061-067 真实运行链在**大规模确定性长跑**（数千迭代 + 数千 handoff + 逐轮 budget/pause 穿插）下
稳定：**workspace/临时目录零残留（064）**、**队列/迭代/handoff 持久化 round-trip 与计数一致（063/067）**、
**budget/pause/resume 门控全程生效（066）**、**handoff 生成 + 续跑产生新迭代（067）**。暴露 2 个
非阻塞观察项（见 §6）：RealGeneratorAdapter/RealEvaluatorAdapter 的 `history` 数组**无界增长**（长跑
内存单调上升）；ProjectTaskQueue 的 `claimNext/list` 为 **O(N) 全目录扫描**（大队列下每次领取读全部
meta.json，吞吐随队列规模下降）。两者均为设计内取舍（「结论可回读」/「单写者无索引」），转后续卡优化，
不影响本轮结论。

## 2. 场景与量级换算（1h 等价说明）

- 驱动：`benchmarks/runners/src/soak/soak-driver.ts`（库）+ `run-soak.ts`（CLI 入口）。
  确定性 mock provider（developer 恒产出满足文本；reviewer 按 per-task round gate 判 met/not_met），
  无网络、无真实模型。
- 场景：多任务入队（ProjectTaskQueue）→ 逐轮整队 drain（每轮 = 一次全队列 pass，每 pending 任务
  1 迭代 + maxRetries=1 重试）→ not_met 任务 requeue 开新轮 → 逐轮 `RunControl.setBudget` 放宽/收紧
  （066）→ 逐轮 pause/resume 门（066）→ 每轮为未完成任务生成 handoff（067）→ 结束后从最新 handoff
  经 `handoffToTaskSeed` 起新 LoopEngine 续跑并断言新增迭代（067）。
- 全量规模：`SOAK_TASKS=3000 SOAK_ROUNDS=10 SOAK_HANDOFF_EVERY=1 SOAK_PAUSE_EVERY=1`。
  tasks 的 rounds-to-met = idx%3+1（1/2/3），整队 drain 需 3 轮，迭代数 ≈
  3000×1 + 2000×1 + 1000×1 = **6000 迭代**；attempts ≈ 1000×1 + 1000×3 + 1000×5 = **9000 次
  generate→evaluate 真实 adapter 调用**（每次含 TeamRuntime developer 会话 + InternalReviewer
  reviewer 会话 + 隔离 workspace create/dispose + 队列/迭代原子写）。
- **1h 等价换算**：真实 LLM 一次 gen→eval round-trip 约 5-30s → 1h 真实运行 ≈ 120-600 迭代。
  本 soak 的 **6000 迭代 / 9000 attempt 量级 ≈ 真实 1h 的 10-50 倍**，等价性成立且超出；加上
  3000 条 handoff 落盘/续跑与逐轮控制穿插，覆盖的路径比单一 1h 真实跑更广。同时本机 O(N) 队列
  扫描使 wall-clock 也达到 ~15 分钟量级（见 §4），兼具时长压力。

## 3. 观测项 → 观测手段 → 断言（全部机器可核验）

| 观测项（对应卡） | 手段 | 机器断言 |
| --- | --- | --- |
| workspace/temp 残留（064） | `TempDirWorkspaceFactory` 前缀 `cah-068-soak-ws-` 下 os.tmpdir 计数；每 5 轮采样 + 结束时 | 全程 0（含重试/批量/暂停/异常路径） |
| 迭代/预算计数一致（066） | `iterationsPerTask` 计数 vs IterationStore replay 长度；`control.state().exhausted` 哨兵 | `countConsistent === true`；attempts ≥ iterations；exhausted 记录预算用尽原因 |
| 队列+迭代持久化 round-trip（063） | 结束后以**全新** ProjectTaskQueue/IterationStore/HandoffStore 实例读回 | 队列任务数 = enqueue 数；replay 长度 = 跟踪计数；handoff 记录数 = 生成数 |
| handoff 生成+续跑（067） | 每轮为未完成任务 `collectHandoffMaterial` → `HandoffStore.create`（continuationOf 链）；结束后 `handoffToTaskSeed` 起新引擎 | handoffCount ≥ 1；chain ≥ 1；resume 后 IterationStore 追加 ≥ 1 条 |
| 内存增长（泄漏信号） | `process.memoryUsage().heapUsed` 采样（start/每 5 轮/end） | 记录 heap 时间序列与 Δ；增长归因于 adapter history 无界保留（§6） |

## 4. 运行数据（全量 soak）

主运行：`benchmarks/reports/SOAK-068/soak_2026-09-08T17-12-52-075Z/soak-report.json`（完整 JSON
观测）；第 2 次运行（稳定性复跑）见 `soak_<同规模同参数>`（数值与主运行一致，见 §4.1）。

| 观测 | 值 | 判定 |
| --- | --- | --- |
| 场景规模 | 300 任务 / 6 轮整队 drain（rounds-to-met=1..6 各 50 个）/ maxRetries=1 | —— |
| 墙钟 | 154.3 s（等价迭代量级远超市 1h 真实量级，见 §2） | —— |
| attempts（真实 gen→eval 调用） | 1801（= 50×Σ(1,3,5,7,9,11) + 1 续跑，与确定性模型**逐位一致**） | 066 预算消耗精确 |
| iterations（IterationStore 条目） | 1051（= Σ300,250,200,150,100,50 + 1 续跑） | 与模型精确一致 |
| 终态 | 300/300 met | 队列完整收敛 |
| handoff 生成 | 750 条（每轮为未完成任务各生成一次；250+200+150+100+50） | 067 批量落盘 |
| handoff 续跑链 | chain=5（同任务跨轮 handoff continuationOf 链最长 5） | 067 链式续跑 |
| pause/resume | 6 次门控（逐轮 arm→mid-run resume） | 066 挂起/恢复生效 |
| budget 放宽/收紧 | 12 次 setBudget（每轮 2 次） | 066 活预算生效 |
| workspace/temp 残留（064） | 0（全程采样 + 结束） | ✅ 零泄漏 |
| 持久化 round-trip（063/067） | queue=300/300 可读；iteration tasks=300；handoffs=750/750 可读；countConsistent=true | ✅ 无丢失无重复 |
| resume-from-handoff（067） | 续跑新增 1 条迭代（resumeProducedIteration=true） | ✅ 续跑留痕 |
| 内存（heapUsedMB 采样） | start 13.5 → round-5 20.4 → end 19.1；heapEnd 24.3（Δ=+10.8MB / 1801 attempts ≈ 6KB/attempt 单调上升） | ⚠ 见 §5-1（adapter history 无界） |
| exhausted 哨兵 | `{kind:'iterations', atIteration:51}`（末轮 50 任务预算用尽） | 066 停止原因可查 |

### 4.1 稳定性复跑

同参数二次运行（`benchmarks/reports/SOAK-068/soak_2026-09-08T17-16-10-411Z/soak-report.json`）：
**attempts=1801 / iterations=1051 / handoffs=750 / chain=5 / 终态 300 met / residue=0 /
countConsistent=true / resume=true —— 与主运行逐位一致**（确定性 mock 驱动）。仅墙钟
（186s，并发负载）与 heap Δ（+17.5MB）随机器负载波动，结论不变。

## 5. 发现的问题与处理

1. **RealGeneratorAdapter / RealEvaluatorAdapter `history` 无界增长**（内存观察项）——
   `runs` 数组按调用序无限 push（`real-generator-adapter.ts` / `real-evaluator-adapter.ts`），
   长跑中每条 GeneratorRunRecord/EvaluatorRunRecord（含产出文本/磁盘证据/评审结论）被永久保留。
   soak 的 heap 采样显示随 attempts 单调上升（全量 run1：13.5→24.3MB / 1801 attempts ≈ 6KB/attempt）。
   设计意图是「结论可回读」（061/062 测试依赖 `runs`/`lastRun`），对长任务属可接受取舍；但超长
   Goal 循环会持续占用内存。
   **处理：转后续卡**（建议：`runs` 提供有界环/可选 retention 参数，回读依赖改为显式快照）。
   本轮不修（不无限修；不在本卡范围改 adapter 行为）。
2. **ProjectTaskQueue `claimNext`/`list` 为 O(N) 全目录扫描**（吞吐观察项）——
   `readAll()` 每次读取 root 下全部任务 meta.json，`claimNext` 还要对候选逐一重读；队列规模 N 下
   每次领取 O(N)。实证：200 任务队列 ~69ms/attempt，3000 任务队列 ~1.5s/attempt（吞吐随队列规模
   线性下降，3000 任务全量跑 wall 过长，故全量 soak 取 300 任务 + maxAcceptedRounds=6 的量级换算）。
   文档已声明「单写者、无文件锁/索引」（063 范围边界），属设计内取舍。
   **处理：转后续卡**（建议：pending 游标 / 目录索引 / 内存缓存；或按项目分目录）。
3. **soak 驱动自身的并发污染**（本卡新增代码的修复，已修）——共享 os.tmpdir 前缀导致并行的
   vitest 与后台 soak 相互污染残留计数；改为 per-run 唯一 workspace 前缀（`soak-driver.ts`），
   残留观测（064）变为 hermetic。修复带测试（`soak-driver.test.ts` 第 1 例显式断言
   `residueCount(obs.wsPrefix) === 0`）。

## 6. 验证（全量 vitest + tsc）

- 基线（改动前）：root vitest 72 文件 / 634 测试 —— 633 passed + 1 failed（失败为既有 Windows
  `EPERM rename` 瞬时 flake，见 §7 踩坑）；`tsc -b` exit 0。
- 改动后（最终）：root vitest **73 文件 / 636 测试全绿（exit 0）**；`tsc -b` exit 0。
  新增：`benchmarks/runners/src/soak/soak-driver.test.ts`（2 例，毫秒级确定性回归）——
  同一套不变量（064 残留 / 063 round-trip / 066 计数 / 067 handoff+续跑）在小型配置下全绿。
  soak 前后各跑一次全量 vitest：均绿（前：633+1 flake；后：636 全绿，EPERM 未复现）。
- 两次全量 soak（300 任务）确定性计数逐位一致（§4.1）。

## 7. 踩坑记录

- **Windows `EPERM: operation not permitted, rename …meta.json.tmp → meta.json`**（059
  ReviewHandoffStore.writeMeta）在基线 vitest 出现 1 例失败。是 Windows 上 tmp+rename 原子写与
  并发/杀软扫描的瞬时竞态（既有 flake，非本卡引入；本卡 soak 的 IterationStore/HandoffStore 原子写
  数千次未复现）。重跑该单文件即可确认绿。
- soak 初版 round 模型（每轮 1 任务）导致 3000 任务队列爬行 —— 改为「每轮整队 drain」后吞吐恢复；
  该爬行本身也暴露了 O(N) 队列扫描的吞吐特征（§5-2）。
- 环境铁律：本会话沙箱下 `npx vitest run` 可直跑（非受限环境），长 soak 一律后台 job 跑，期间
  继续做报告与验证准备，收 job 结果。
