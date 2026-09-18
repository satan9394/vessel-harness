# 126 — 修复 soak 默认参数不自洽：长跑此前根本没覆盖 handoff / resume

- 编号：126
- 状态：已合入（2026-09-18）
- 优先级：P1（V1.6 / 1.0 Stable 门槛清单的「Long-run soak」项；且是"宣称覆盖了实际没覆盖"的诚实性缺陷）
- 创建日期：2026-09-18
- 关联：`tasks/068`（soak 驱动）、`docs/V1.1-ROADMAP.md`（V1.1-B 性能迭代 / 长跑）、`docs/product-evolution/PRODUCT-STATE.md`（现状快照）
- 执行器：指挥侧

## 1. 缺陷：默认参数让长跑静默地不覆盖它声称覆盖的东西

`run-soak.ts` 的默认值是 `maxAcceptedRounds=3`、`handoffEveryRounds=8`、`pauseEveryRounds=7`、`totalRounds=30`。而驱动里：

- 每个任务需要 `(index % maxAcceptedRounds) + 1` 轮才 met，最大 3 轮；
- 轮循环在 `pending === 0` 时**直接 break**（`soak-driver.ts:361`）；
- handoff 在 `round % handoffEvery === 0` 且**存在未 met 任务**时才生成（`:401-417`）。

于是默认跑：第 3 轮所有任务 met → 第 4 轮 pending=0 → 循环退出，**永远到不了第 8 轮**。实测（2026-09-18）：

```
handoffCount=0  handoffChainLength=0  pauseResumeCycles=0  resumeProducedIteration=false
```

即：**默认长跑既没有 handoff，也没有 resume，连 pause/resume 都没触发**——而文件头与报告都声称覆盖 067 handoff + 066 pause/resume。这是本仓头号病史「宣称与实际不一致」在长跑上的一个实例。

历史报告也印证：只有用非默认参数（如 `maxAccepted=6/handoffEvery=1` 或 `maxAccepted=14`）的几次才有 `handoffCount=750`；用默认 3/8 的两次都是 0。

## 2. 修复

- `soak-driver.ts` 新增 **`SOAK_DEFAULTS`**（`maxAcceptedRounds: 12`、`handoffEveryRounds: 8`、`pauseEveryRounds: 7`、`totalRounds: 30`、`taskCount: 120`）与 **`checkSoakCoherence()`**：
  - 要求 `maxAcceptedRounds > handoffEveryRounds`（否则没有任务能活到 handoff 轮）；
  - 要求 `totalRounds >= pauseEveryRounds`（否则 pause/resume 不触发）；
  - `handoffEveryRounds`/`pauseEveryRounds` 为 0 视为显式禁用，放行。
- `run-soak.ts` 改用 `SOAK_DEFAULTS`，并在参数不自洽时 **fail loud（exit 2）** 而不是静默少跑。
- 回归锁（`soak-driver.test.ts`，4 例）：`SOAK_DEFAULTS` 必须自洽；历史的不自洽组合（3/8）必须被标红；`totalRounds < pauseEveryRounds` 必须被标红；0 视为禁用放行。
- `run-soak.test.ts` 的"逐字透传"负对照改用自洽取值（原用 `maxAccepted=1 < handoffEvery=2`，会被新守卫正确地挡下）。

## 3. 验收与实测

- 单元测试：`npx vitest run benchmarks/runners/src/soak/` ⇒ **12 passed**（含新增 4 例自洽性锁）。
- 默认长跑实跑：`npx tsx benchmarks/runners/src/soak/run-soak.ts` ⇒
  **`attempts=1441 iterations=781 residue=0 handoffs=40 chain=1 resume=true pauseResumeCycles=1 countConsistent=true`**，wall≈93s，exit 0。
  报告落 `benchmarks/reports/SOAK-068/soak_2026-09-18T17-21-15-082Z/`（按仓库惯例跟踪，作为修复后基线）。
- 门禁：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` 根 + web 全绿、CI 两腿绿。

## 4. 未闭合

- **字面 3 小时墙钟**未跑：本仓的 soak 是"确定性 1h-equivalent"（mock 下 ~10^5–10^6 attempts 的等价压力），文件头已论证墙钟强等 1h 的边际信号低。若 1.0 门槛要求**真实 3h 墙钟**，那是独立决定（且会占用 3 小时机器时间），未在本卡。
- 其余 1.0 项仍受外部阻塞：`--live` 跨 harness（配额）、real-model gate（配额）、`release-report` 刷新（门禁会经 CredentialStore 打真实模型）。
