# Benchmark Report / Dashboard（报告聚合与看板）

> 任务卡：`tasks/083-report-dashboard.md`；权威需求：`docs/Vessel_后续开发方向与产品化路线_v1.0.md`
> §15.1 L3（cross-harness 统一采集）+ 报告/dashboard + release gate 消费。
> 前置：076（Harness Adapter Contract + RunResult/validate）+ 082（real-model lane 报告形状）。
> 范围：只做报告/看板聚合展示；084（release gates 判据消费）各自成卡。

## 目的

把 076-082 的 benchmark 产出——**RunResult 集（多 harness × 多模型 × 多场景 §15 L3 指标）**——聚合成可读
报告（markdown + 机器可读 JSON，`benchmarks/reports/`）与看板视图（CLI 摘要表），支持**跨 harness/model
对比**（同场景不同 harness 的指标并列）与汇总统计，供 084 release gates 消费判据。

## 复用纪律（不重造）

- **指标字段**复用 076 `RunResultMetrics`（success / wallTimeMs / toolCalls / invalidCalls / retries /
  inputTokens / outputTokens / cacheReadTokens / costUsd / contextPeak / compactions / humanIntervention /
  policyViolations / resumeSuccess）。
- **行来源**：从 076 `RunResult`（harness=adapterId，scenario=fixtureId）生成；从 082 `RealModelLaneReport`
  （每行带 modelId + `result: RunResult`）经 `rowsFromLaneReport` 转换，modelId 一并带入（支持模型维对比）。
- 不新增指标模型、不另起一套报告 schema——`BenchmarkReport` 输出即 JSON（机器可读）+ markdown（人读）。

## 用法（库 API）

```ts
import {
  buildReportFromRunResults,  // RunResult[] → BenchmarkReport（JSON 对象）
  buildReport,                // ReportRow[] → BenchmarkReport
  rowsFromLaneReport,         // 082 RealModelLaneReport → ReportRow[]（带入 modelId）
  renderReportMarkdown,       // BenchmarkReport → markdown
  renderCliSummary,           // BenchmarkReport → CLI 摘要表
  writeReportFiles,           // 写 <dir>/benchmark-report-<ts>.md + .json
} from '@vessel/bench-runners';

// A) 从 076 RunResult[]（多 harness 并排）直接聚合
const rep = buildReportFromRunResults(runResults, {
  source: 'cross-harness run',
  modelsByAdapter: { vessel: 'deepseek-v4-pro', dsh: 'ds-4-pro' }, // 可选模型标注
});

// B) 从 082 lane report（带 modelId）转换成报告
const laneRows = rowsFromLaneReport(laneReportJson);
const rep2 = buildReport(laneRows, 'task-082 real-model lane report');

// 持久化到 benchmarks/reports/
writeReportFiles(rep, 'benchmarks/reports');

// 控制台看板摘要 / markdown / web 数据 seam（后续 web 在看板接续）
console.log(renderCliSummary(rep));
writeReportFiles(rep, 'benchmarks/reports');
```

## 用法（CLI 看板摘要）

```text
vessel bench-report --input <runResults.json> [--out <dir>]
```

- `--input`：076 `RunResult[]` 数组 JSON，**或** 082 `RealModelLaneReport` JSON（自动识别）。
- `--out`：输出目录（默认 `<repo>/benchmarks/reports`）。
- 行为：解析输入 → 聚合 → **打印 CLI 摘要表到 stdout** → 写 `<dir>/benchmark-report-<ts>.md` + `.json`。

```text
$ vessel bench-report --input run-results.json
Benchmark Report — cross-harness run
totals: 9 runs, 6 passed, 3 failed, success 67%, cost $0.12

harness summary
harness          runs pass fail success  avgWall(ms)  avgCost totalCost
vessel              3    2    1      67%         302    0.020     0.06
dsh                 3    2    1      67%         418    0.033     0.10
opencode            3    2    1      67%         355    0.027     0.08

cross-harness comparison (by scenario)
  B001: vessel OK wall=200ms in=50 out=20 cost=$0.01
  B001: dsh OK wall=400ms in=50 out=20 cost=$0.02
  ...
```

## 报告形状（`BenchmarkReport`，ISO/JSON 机器可读，084 消费）

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-08T...",   // ISO
  "source": "cross-harness run",
  "totals": { "runs":9, "passed":6, "failed":3, "successRate":0.67,
              "harnessCount":3, "scenarioCount":3, "totalWallTimeMs":..., 
              "totalInputTokens":..., "totalOutputTokens":..., "totalCacheReadTokens":...,
              "totalCostUsd":0.12, "totalToolCalls":... },
  "harnesses": [ {
      "harnessId":"vessel", "runs":3, "passed":2, "failed":1, "skipped":0, "pending":0,
      "successRate":0.67, "avgWallTimeMs":302, "avgToolCalls":..., "avgInvalidCalls":...,
      "avgRetries":..., "avgInputTokens":..., "avgOutputTokens":..., "avgCacheReadTokens":...,
      "avgCostUsd":0.02, "avgContextPeak":..., "avgCompactions":..., 
      "avgHumanIntervention":..., "avgPolicyViolations":..., "totalCostUsd":0.06,
      "scenarios":["B001","B002","S001"] } ],
  "scenarios": [ { "scenarioId":"B001","harnesses":["dsh","opencode","vessel"],
                   "runs":3,"passed":2,"failed":1,"successRate":0.67,"totalCostUsd":0.04 } ],
  "comparisons": [ { "scenarioId":"B001", "rows":[ {
        "harnessId":"vessel","modelId":"deepseek-v4-pro","success":true,
        "wallTimeMs":200,"toolCalls":2,"invalidCalls":0,"retries":0,
        "inputTokens":50,"outputTokens":20,"cacheReadTokens":5,"costUsd":0.01,
        "contextPeak":55,"compactions":0,"humanIntervention":0,"policyViolations":0,
        "resumeSuccess":false } ] } ],
  "rows": [ /* 原始 ReportRow，含完整 §15 L3 metrics */ ]
}
```

- `totals` / `harnesses` / `scenarios` = 汇总统计；`comparisons` = 跨 harness 对比（同场景指标并列）；
  `rows` = 原始行（审计可回读）。
- markdown 版（`renderReportMarkdown` / 落盘 `.md`）含：总体汇总表 → 按 harness 汇总表 → 按场景汇总表 →
  逐场景跨 harness 对比表，遵循 `benchmarks/reports/` 惯例（cf. SOAK-068.md）。

## 看板视图：CLI 摘要 + web seam

- **CLI 摘要**（最小可测看板）：`renderCliSummary(rep)` 输出的 pad 对齐文本表 + 跨 harness 对比行；
  CLI 子命令 `vessel bench-report` 打印它。
- **web 看板**：本卡不实现，留下 `renderDashboardSeam(rep)`（返回 `{ok, data: BenchmarkReport}`）类型 seam，
  后续 083-web 静态渲染 `data` 即可，无需改动聚合核心。

## 范围边界

- 只做报告/看板聚合展示（聚合 → 汇总 → 对比 → md/json 落盘 → CLI 摘要）。
- 084（release gates 从本卡 JSON 取判据做 8 门 + release-report）**不在本卡**，各自成卡。

## 设计选择与理由

1. **ReportRow 为聚合最小单元**：`{ harnessId, scenarioId, modelId?, metrics, status }`，metrics 直接复用
   076 全 §15 L3 字段；`rowFromRunResult` / `rowsFromLaneReport` 从既有契约/lane 形状转换，零重造。
2. **聚合纯函数 + 持久化分离**：`aggregateRows` / `buildComparisons` / `buildReport` 为纯函数（无 I/O），
   单测毫秒级确定性；`writeReportFiles` 单独负责落盘，便于测试注入临时目录。
3. **JSON = 报告本体**：`BenchmarkReport` 直接 `JSON.stringify` 即 084 消费的机器可读形状（schemaVersion 1），
   markdown 只是同对象的渲染视图，避免双份数据漂移。
4. **空值安全**：汇总均值/成功率对空集返回 0 而非 NaN，报告对空输入不崩（可测）。
5. **模型维可选**：裸 076 RunResult 无模型字段，故 `modelId` 为可选；082 lane 行有 modelId 则自动带入，
   支持"同场景不同 harness×model"的对比列。