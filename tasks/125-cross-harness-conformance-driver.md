# 125 — Cross-Harness Conformance 驱动与报告（V1.5 实跑入口）

- 编号：125
- 状态：已合入（2026-09-18）
- 优先级：P1（V1.6 / 1.0 Stable 门槛清单的「Cross-Harness Benchmark」项）
- 创建日期：2026-09-18
- 关联：`docs/V1.1-ROADMAP.md` §6（下一目标）、`docs/Vessel_后续开发方向与产品化路线_v1.0.md` §15/§16（V1.5 Cross-Harness Proof）、`tasks/076-084`（契约/适配器/报告）、`docs/BENCHMARK-SPEC.md`
- 执行器：指挥侧

## 1. 背景：缺的不是契约也不是适配器，是「驱动」

V1.5 的三块里，前两块早已交付：

- **契约**（task 076）：`HarnessAdapter.run(fixture) → RunResult`，15 项 L3 指标，`benchmarks/runners/src/contracts/`。
- **适配器**（task 077–081）：`benchmarks/runners/src/adapters/{dsh,opencode,codex,claude,pi}.ts`，各带 CLI 探针与 mock seam；`contracts/vessel.ts` 是自适配器。
- **报告**（task 083）：`report/report.ts` 已能把 `RunResult[]` 聚合成跨 harness 对比（md + JSON）。

**缺的是中间那一步**：一个把同一批 fixture 跑过多个 adapter、收集 `RunResult[]` 的驱动。此前适配器**只在测试里被调用**，没有任何可运行入口能把它们串起来产出 conformance 报告——即「Cross-Harness Proof 实跑」没有落点。

## 2. 交付

- `benchmarks/runners/src/conformance/driver.ts`（纯模块，仅依赖契约类型）
  - `runConformance({adapters, fixtures, gate?, onCell?}) → ConformanceCell[]`：逐 fixture × adapter 跑；**能力不匹配 → `skipped`（带原因）而非失败**；**单格 adapter 抛错 → `error`，不中断其余格**。
  - `capabilitySkipReason(adapter, fixture)`：fixture 声明 `options.requires: CapabilityKey` 时，adapter 未声明该能力为 `true` 即跳过（`false` 与 `'tbd'` 都算，措辞区分）。
  - `resultsFromCells` / `summarizeCells`：供报告与摘要。
  - `checkThresholds(cells, thresholds)`：per-adapter 回归阈值（`maxInvalidCalls` / `maxPolicyViolations` / `minSuccessRate`，支持 `'*'` 默认），返回违规清单。
- `benchmarks/runners/src/conformance/run-conformance.ts`（可运行入口）
  - 默认**离线**：只跑 Vessel 自适配器（确定性 mock），不消耗第三方配额；`--all` / `--scenarios <ids>` / `--out <dir>`。
  - `--live` 才纳入外部 harness，且**每个都先过 CLI 探针**，探针不通过就跳过并打印原因。
  - 产出交 083 报告模块写 md + JSON 到 `benchmarks/reports/conformance/`（生成物，已 gitignore）。
  - 默认阈值只查 `maxInvalidCalls`（非法调用应恒 0）；**不**查 `maxPolicyViolations`——安全场景（S00x）本应触发 deny，>0 才是正确结果，由场景判据负责。
- `benchmarks/runners/src/conformance/driver.test.ts`：7 例（全格运行、能力跳过非失败、抛错隔离、caller gate、阈值三规则、`'*'` 默认、跳过/错误不计入成功率）。
- `benchmarks/runners/src/index.ts` 导出 `conformance/index.js`。
- `package.json` 加脚本 `bench:conformance`。
- `README.md` 增「Benchmark 与 Cross-Harness Conformance」章节。
- `.gitignore` 忽略 `benchmarks/reports/conformance/`。

## 3. 验收与实测

- 驱动单测：`npx vitest run benchmarks/runners/src/conformance/driver.test.ts` ⇒ **7 passed**。
- 离线实跑（全量场景）：`npx tsx benchmarks/runners/src/conformance/run-conformance.ts --all` ⇒
  **`25 run / 0 skipped / 0 error`，25 passed，exit 0**；报告落 `benchmarks/reports/conformance/`。
- 门禁：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` 根 + web 全绿、CI 两腿绿。

## 4. 未闭合 / 外部依赖

- **`--live` 真实跨 harness 跑**尚未执行：它会驱动本机 dsh/opencode/codex/claude-code（pi 未安装）并可能消耗其配额。按全局规则「第三方服务消耗配额先确认」与执行程序的外部阻塞约定，**待用户确认后**再跑，不擅自执行。
- **跨 harness 回归基线**：当前默认阈值只兜非法调用；真正的跨 harness 阈值（各 adapter 的成功率/成本/上下文峰值上下限）要在**至少一次 `--live` 基线**之后才能定。
- 场景数 25（roadmap 的 V1.5 文字提到 "30+"）——是否扩到 30+ 属独立决定，未在本卡。
