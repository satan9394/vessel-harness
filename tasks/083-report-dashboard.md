# 083 — Report / Dashboard（Benchmark 报告与看板）

- 状态：已合入
- 优先级：P0（Wave 5 / Milestone G）
- 创建日期：2026-09-08
- 关联：076-082（RunResult/adapters/lane 产出）；084（release gates 消费报告）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §15（统一采集 + 报告/dashboard；
  cross-harness 对比展示）

## 目标

Report / Dashboard：把 076-082 的 benchmark 产出（RunResult 集：多 harness × 多模型 × 多场景指标）聚合成
可读报告（markdown/json，benchmarks/reports/）与看板视图（CLI 摘要或 web 页——CLI 最小可测优先），
支持跨 harness/模型对比（§15 L3 字段）、趋势/汇总统计；供 084 release gates 消费判据。

## 验收标准（执行器逐条勾选）

- [x] 报告聚合：RunResult 集 → 汇总报告（markdown 表格：harness/model × 场景 × §15 L3 指标 + 汇总统计：
      success 率/平均 wall time/tokens/cost/等）+ JSON（机器可读，084 消费）
- [x] 看板视图：CLI 摘要（最小可测：命令或函数出汇总表）——web 看板可选（若有精力做最简，否则 seam 标注
      留后续）；跨 harness/模型对比（同场景不同 harness 的指标并列）
- [x] 复用 076 契约类型与 082 lane 报告形状（不重造）；报告路径与既有惯例对齐（benchmarks/reports/）
- [x] 测试 ≥6 例：聚合/汇总统计/对比/JSON 形状/CLI 摘要/异常；全量 vitest/tsc 绿（810+ 无回归）
- [x] 文档同步（报告格式 + 看板用法）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做报告/看板聚合展示。084（release gates 判据消费）各自成卡。

## 涉及文件（指针，执行器自行精化）

- benchmarks/runners/src/（076 contracts RunResult + 082 lane 产出——新增 report 模块）
- benchmarks/reports/（输出惯例）
- CLI（apps/cli 或 runner CLI——最小摘要命令）

## 方法

- 读 076 RunResult + 082 lane 报告形状；聚合函数（输入 RunResult[] → 汇总 + 对比表）
- CLI 摘要输出（可测函数）；JSON 形状对齐 084 判据需求

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 已回填（2026-09-08，执行器 session-fc88ff78）

### 改动文件与 diff 摘要

| 文件 | 改动 |
| --- | --- |
| `benchmarks/runners/src/report/report.ts`（新增） | 报告聚合模块：`ReportRow`（聚合最小单元，metrics 复用 076 全 §15 L3 字段）+ `rowFromRunResult`/`rowsFromLaneReport`（从 076 RunResult / 082 lane 转换，不重造）+ `aggregateRows`（按 harness/scenario 汇总 + totals）+ `buildComparisons`（同场景跨 harness 对比）+ `buildReport`/`buildReportFromRunResults`（生成 `BenchmarkReport`）+ `renderReportMarkdown`（md 表：总体→按 harness→按场景→跨 harness 对比）+ `renderCliSummary`（CLI 看板摘要）+ `renderDashboardSeam`（web 看板 seam，本卡不实现）+ `writeReportFiles`（写 `<reportsDir>/benchmark-report-<ts>.md + .json`） |
| `benchmarks/runners/src/report/index.ts`（新增） | barrel re-export |
| `benchmarks/runners/src/index.ts` | 加 `export * from './report/index.js'` |
| `apps/cli/src/cli.ts` | 新增 `cmdBenchReport` + `vessel bench-report --input <json> [--out <dir>]` 子命令（读 076 RunResult[] 或 082 lane report JSON → 打印 CLI 摘要表 → 落盘 md/json）+ help 文案 |
| `benchmarks/runners/src/report/report.test.ts`（新增） | 9 个单测（见下） |
| `apps/cli/src/cli.test.ts` | 新增 `vessel bench-report` describe：3 个 CLI 测试（缺 input exit 2 / RunResult[] 聚合落盘 / 非法 JSON 对象 exit 2），加 `captureBoth` helper |
| `docs/REPORT-DASHBOARD.md`（新增） | 报告格式 + 看板用法（对齐 `docs/REAL-MODEL-LANE.md` 惯例） |
| `tasks/083-report-dashboard.md` | 工作证明回填 + 状态改"待验收" |

### 新增测试数

- `report.test.ts` **9 例**：聚合汇总统计（success 率/平均 wall/cost/场景维度）/ 空集 NaN 安全 / 跨 harness 对比（同场景并列 + 排序）/ JSON 形状（schemaVersion 1、可序列化 round-trip、§15 L3 全字段）/ CLI 摘要表内容 / markdown 表结构 / 落盘 md+json / 082 lane report → ReportRow（modelId 带入）/ rowFromRunResult 状态推导。
- `cli.test.ts` 新增 **3 例**：`bench-report` 缺 input exit 2、RunResult[] 聚合打印摘要+落盘、非法 JSON 对象（非数组非 lane）exit 2。
- 合计新增 **12 例**。

### 验证结果（全量 vitest / tsc）

- **全量 vitest（root）**：`npx vitest run` → **87 文件 / 822 passed + 1 skipped（823 total），exit 0**。
  较基线 root 810（+1 skipped）净增 12 例（810+12=822）✓ 无回归。
- **全量 tsc**：`npx tsc -b tsconfig.json` → exit 0。
- **定向**：`report.test.ts` 9/9 绿；`cli.test.ts`（-t bench-report）3/3 绿。
- **CLI 端到端演示**（`vessel bench-report`，demo 3 harness × B001）exit 0，输出摘要表 + 写 md/json（演示产物已进回收站，未提交）。

### 设计选择与理由

1. **`ReportRow` 为聚合最小单元 + 复用契约**：`{ harnessId, scenarioId, modelId?, metrics: RunResultMetrics, status }`；
   metrics 直接复用 076 全 §15 L3 字段；`rowFromRunResult` / `rowsFromLaneReport` 从既有契约行/lane 行转换，
   不另起指标模型。模型维是可选 label（裸 076 RunResult 无 model 字段；082 行带 modelId 则带入，支持
   harness×model 并列对比）。
2. **聚合纯函数 + 落盘分离**：`aggregateRows` / `buildComparisons` / `buildReport` 纯函数（无 I/O）→ 单测
   毫秒级确定性；`writeReportFiles` 单独负责写盘，测试可注入临时目录。
3. **JSON = 报告本体，markdown 只是渲染**：`BenchmarkReport` 直接 `JSON.stringify` 即 084 消费的机器可读
   形状（`schemaVersion: 1`），md 是对同一对象的表渲染，避免双份数据漂移。
4. **空值安全**：均值/成功率对空集返回 0 而非 NaN；报告对空输入不崩（专门测试覆盖）。
5. **看板**：CLI 摘要为最小可测看板（`renderCliSummary` + `bench-report` 子命令）；web 看板留 `renderDashboardSeam`
   类型 seam，后续 083-web 静态渲染 `data` 即可，不改聚合核心。

### 踩坑记录

- **CLI 测试捕获 console.error**：报错路径（缺 --input / 非法输入）走 `console.error` 而非 `console.log`；
   `capture()` 只 spy log → 断言空日志。加 `captureBoth()` 同时 spy log 与 error 通过。
- **cli.test.ts 插入 describe 块时误覆盖 serve describe 开行**：插入 bench-report describe 时把原
   `describe('vessel serve...')` 开行替换掉，导致尾部 `});` 语法错（`error TS1128`）。修复：补回 serve
   describe 开行（工作区仍可编辑/已修）。
- **082 lane report 必须有 reportMdPath/reportJsonPath 字段**：单测里手工构造 lane 对象缺这两个必填字段
   → tsc `TS2739`。补上通过。
- **演示产物污染 reports/**：生成的 demo `benchmark-report-*.md/json` + `_083-demo-runs.json` 是临时产物，
   按删除铁律用 `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(..., 'SendToRecycleBin')` 送回收站，
   未提交，保持 reports/ 只留既有 SOAK-068.md 惯例。

## 验收结论（指挥回填）

- [x] 合入（commit 3e73d33）
- 备注：指挥独立复核——全量 vitest 87 文件 822 测试全绿 + 1 skipped（零失败）、tsc -b 0 错误，与执行器自报一致。
  认可：report.ts 聚合核心（ReportRow 复用 076 §15 L3 字段；aggregateRows 汇总/空集安全；buildComparisons 同场景
  跨 harness 对比；BenchmarkReport JSON schemaVersion 1 供 084 消费；renderReportMarkdown/CliSummary/DashboardSeam；
  writeReportFiles）+ vessel bench-report CLI 摘要 + docs/REPORT-DASHBOARD.md。演示产物走回收站清理（删除铁律）。
  下一张：084（release gates——V1.0 收官卡）。
