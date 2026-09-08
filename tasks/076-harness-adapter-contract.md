# 076 — Harness Adapter Contract（跨 Harness 统一契约）

- 状态：已合入
- 优先级：P0（Wave 5 / Milestone G 首发）
- 创建日期：2026-09-08
- 关联：077-081（DSH/OpenCode/Codex/Pi/Claude Code adapters 实现此契约）；075（safety benchmark 判据复用）；
      benchmarks 既有体系（B001-B023 / scenarios yaml / runner）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §15（L1411-1505）：五层 Benchmark；
  L3 Cross-Harness 统一采集 success/wall time/tool calls/invalid calls/retries/tokens/cost/context peak/
  compactions/human intervention/policy violations/resume success——同一 fixture 跑 Vessel/DSH/OpenCode/
  Codex/Pi/Claude Code

## 目标

Harness Adapter Contract：定义跨 harness 的统一执行/采集契约（TS 类型 + 接口 + 校验 + 文档），
使同一 benchmark fixture 可在不同 harness（Vessel + 外部 CLI）上跑并统一采集指标（§15 L3 列表）。
077-081 的 adapters 实现此契约；本卡只定义契约 + Vessel 自身实现（自适配）证明契约可用。

## 验收标准（执行器逐条勾选）

- [x] 契约定义（benchmarks/runners 或新 contracts 模块，TS 类型 + 接口）：
      HarnessAdapter { id/version/run(fixture): Promise<RunResult>/capabilities } +
      RunResult 含 §15 L3 采集字段（success/wallTime/toolCalls/invalidCalls/retries/inputOutputCacheTokens/cost/
      contextPeak/compactions/humanIntervention/policyViolations/resumeSuccess）+ 校验（字段齐全/类型/范围）
- [x] Vessel 自身 adapter（自适配：用现有 engine/loop 跑 fixture 产生 RunResult——证明契约可用且可测，
      不依赖外部 harness）
- [x] 与 benchmarks 既有体系对齐（scenarios yaml/fixtures/runner 契约不破坏；L1 B001-B023 复用）
- [x] 测试 ≥6 例：契约校验/字段/自适配 run/异常/与既有 runner 共存；全量 vitest/tsc 绿（730+ 无回归）
- [x] 文档同步（契约规范 + 自适配用法 + 077-081 实现指引）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只定义契约 + Vessel 自适配。077-081 外部 harness adapters（DSH/OpenCode/Codex/Pi/Claude Code）各自成卡，
  本卡文档给出实现指引即可。

## 涉及文件（指针，执行器自行精化）

- benchmarks/runners（既有 runner/契约；新增 contracts 或 adapter 模块）
- packages/engine（自适配 run：LoopEngine 或 061-068 链路产出 RunResult）
- 075 判据复用（安全场景 metrics）

## 方法

- 读 §15.1 L3 与 benchmarks 既有 runner/契约；定义 HarnessAdapter + RunResult（字段对齐 §15）
- Vessel 自适配：引擎跑 fixture → 采集指标 → 校验；测试证明契约可用

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 执行器回填（2026-09-08，DSH 隔离子代理）

**新增/改动文件（diff 摘要）**

- `benchmarks/runners/src/contracts/types.ts`（新增）— 契约类型：
  `HarnessAdapter { id / version / run(fixture): Promise<RunResult> / capabilities }`、
  `HarnessFixture { id / workspaceRoot / taskFile? / options? }`、
  `RunResult { adapterId / adapterVersion / fixtureId / metrics / startedAt / artifacts? / notes? }`、
  `RunResultMetrics`（§15 L3 全字段：success / wallTimeMs / toolCalls / invalidCalls / retries /
  inputTokens / outputTokens / cacheReadTokens / costUsd / contextPeak / compactions /
  humanIntervention / policyViolations / resumeSuccess）、`CapabilityKey`。
- `benchmarks/runners/src/contracts/validate.ts`（新增）— 校验：
  `validateRunResultMetrics / validateRunResult / validateHarnessAdapter / assertValidRunResult /
  assertValidHarnessAdapter`；字段齐全、类型正确、数值非负（含 contextPeak/costUsd）、resumeSuccess 允许 null。
- `benchmarks/runners/src/contracts/vessel.ts`（新增）— Vessel 自适配：隔离临时拷贝 fixture →
  `composeHarness` 组装本地 harness → 包裹 provider 累计 usage + 追踪 contextPeak → `loop.runTurn` →
  `telemetry.finalize` 汇总 §15 L3 → 按 `configs/pricing.json` 估算 costUsd → `assertValidRunResult`。
  `vesselAdapter`（id=vessel, version=0.1.0）默认清理临时 workspace；缺 provider 时自动用 OFFLINE_SCRIPTS mock 车道。
- `benchmarks/runners/src/contracts/index.ts`（新增）+ `benchmarks/runners/src/index.ts`（改，追加 export）—
  契约模块随 bench-runners 一起导出。
- `benchmarks/runners/src/contracts/contracts.test.ts`（新增）— 11 例测试。
- `docs/HARNESS-ADAPTER-CONTRACT.md`（新增）— 契约规范 + 自适配用法 + 077-081 实现指引。

**测试输出（全量 vitest + tsc 绿，无回归）**

- `npx vitest run benchmarks/runners/src/contracts/contracts.test.ts` → 11 passed。
- `npx vitest run`（root 全量）→ **Test Files 80 passed；Tests 741 passed | 1 skipped**。
  基线 730（+1 skipped）+ 11 新例 = 741，无回归、无掉测试。
- `npx tsc -b tsconfig.json --pretty false` → 无输出（clean）。

**11 例测试覆盖**

1) validateRunResultMetrics 接受完整字段；2) 拒绝缺字段/错类型/负数/NaN；3) validateRunResult 拒非法时间戳与 artifacts；
4) assertValidRunResult 非法时 throw、合法不 throw；5) validateHarnessAdapter 拒绝坏 adapter 表面；
6) runVesselFixture 产出全 §15 L3 字段的合法 RunResult；7) adapter.run 默认清理临时 workspace；
8) 运行期异常 → metrics.success=false 且 RunResult 仍合法（不 throw）；9) capabilities 声明引擎面；
10) 与既有 runner 共存（loadManifest(B001) 仍可用）；11) runScenario(B001) 无回归仍 pass。

**设计选择与理由**

- 契约放 `benchmarks/runners/src/contracts/`，随 `@vessel/bench-runners` 导出，供外部 adapter 复用同包校验；
  与 B001-B023 的 runner/assert/report 解耦（既有 runner 只做 prepare/assert/report，本契约只做"跑一个 fixture 返回 RunResult"）。
- `run()` 语义：硬故障（fixture 缺失/接错）throw；运行期失败返回 `metrics.success=false` 的合法 RunResult（不吞崩溃，可聚合）。
- `contextPeak` 用包裹 provider 捕获每请求 input+cacheRead 最大值；`policyViolations` = session audit/denial 计数
  （与 counters.denials 取较大）；`humanIntervention` ≈ approvalAsks（CI 全自动下为 0）；`resumeSuccess` 固定 false。
- cost 按 `configs/pricing.json`（model > protocol > default）fallback 链，与 apps/cli/providers/pricing 口径一致但本地实现（避免跨层依赖）。
- 自适配排版对齐 BENCHMARK-SPEC §6.1/§7.1 的 adapter 哲学（判据仍是 scenario manifest，adapter 只采集不判据）。

**踩坑记录**

- `configRoot` 语义易混：vessel.ts 内 `configRoot` 是**仓库根**（内部再拼 `/configs/`），测试一度把 `configs/` 目录当
  configRoot 传入 → policy loader 报 "no policy declaration found"。已改为传 `REPO_ROOT`。
- `MockProvider` 的 usage 是硬编码 100/20，不随 `vars` 变化，测试里不复用 vars 传数字（vars 是字符串占位符）。
- TS `asserts` 强类型下对 `RunResultMetrics` 做 delete/改类型要用 `as unknown as Record<string, unknown>` 透过一次擦除。

**文档**

- docs/HARNESS-ADAPTER-CONTRACT.md：契约规范 + vessel 自适配用法 + 077-081 实现指引（接入面/采集通道/归一化要点）。

## 验收结论（指挥回填）

- [x] 合入（commit bc24468）
- 备注：指挥独立复核——全量 vitest 80 文件 741 测试全绿 + 1 skipped（零失败）、tsc -b 0 错误，与执行器自报一致。
  认可：HarnessAdapter{id/version/run/capabilities} + RunResult 含 §15 L3 全字段 + validate 校验（字段/类型/范围）；
  Vessel 自适配用 composeHarness+loop.runTurn（临时隔离拷贝→provider 追踪 contextPeak→telemetry 汇总→pricing
  估成本）证明契约可用；硬故障 throw、运行期失败返回 success=false 合法 RunResult；077-081 实现指引入文档。
  下一张：077（DSH adapter）——同批 adapters（077-081）可连续推进。
