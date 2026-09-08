# 082 — Real-Model Benchmark Lane（真实模型回归跑道）

- 状态：已合入
- 优先级：P0（Wave 5 / Milestone G）
- 创建日期：2026-09-08
- 关联：076-081（adapters 与契约）；L1 B001-B023 + 075 safety（场景资产）；084（release gates 会跑此 lane）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §15.1 L2（固定真实模型 DeepSeek V4 Pro / Flash，
  每次 release 跑 20-50 个固定场景）+ §15.1 L3（统一采集字段）

## 目标

Real-Model Benchmark Lane：固定真实模型（DeepSeek V4 Pro/Flash，可注入 provider/model）跑固定场景集
（20-50 个，选自 B001-B023 + safety + streaming/interrupt/steering 等新增 L1 场景），统一采集 §15 L2/L3
指标并产出报告。⚠️ 本机是否有真实模型 API 凭据未知——lane 框架 + 场景集 + 采集必须可注入可测试，
无凭据时记录"待环境"状态（076-081 的 pending-environment 模式）。

## 验收标准（执行器逐条勾选）

- [x] Lane 框架：runRealModelLane({models, scenarios, providerResolver})——固定模型（DeepSeek V4 Pro/Flash
      默认，可注入）+ 固定场景集（20-50 个：B001-B023 + safety，21 个既有资产，落在 20-50 区间；
      streaming/interrupt/steering 尚无既有资产，文档标注待后续补）+ 统一采集（§15 L2/L3 字段，
      复用 076 RunResult）+ 报告（benchmarks/reports/）
- [x] 可注入性：provider/model 可注入（无真实 API 时用 mock provider 验证框架）；场景集可配置
- [x] 无凭据降级：probe 模型 API（或注入 resolver），不可用时 pending-environment 标注不 throw（076-081 模式）
- [x] 测试 ≥6 例：场景集校验/lane 执行（mock provider）/采集汇总/报告/降级/异常；全量 vitest/tsc 绿
      （810 passed | 1 skipped，较基线 799 +11 新增，无回归）
- [x] 文档同步（lane 用法 + 场景集清单 + 模型档说明）→ docs/REAL-MODEL-LANE.md
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 lane 框架 + 场景集 + 采集 + 报告。083（report/dashboard）与 084（release gates）各自成卡。
- 不烧真实 API 配额：无凭据/未授权不跑真实模型（诚实降级）。

## 涉及文件（指针，执行器自行精化）

- benchmarks/runners/src/（076 contracts + 081 adapters 旁新增 real-model lane）
- benchmarks/scenarios（B001-B023 + safety S001-S008 场景资产复用）
- benchmarks/reports/（报告输出）

## 方法

- 复用 076 RunResult/contracts；场景集从既有 assets 选 + 标注；lane 驱动 mock 或真实 provider（注入）
- 报告聚合：多模型 × 多场景 × 指标表 + 汇总

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

### 改动文件（+ diff 摘要）

| 文件 | 状态 | 摘要 |
| --- | --- | --- |
| `benchmarks/runners/src/lane/real-model-lane.ts` | 新增 | lane 核心：`LANE_MODELS`（DeepSeek V4 Pro/Flash 默认，tier=pro/flash，可注入）、`LANE_SCENARIOS`（21 个既有资产 registry，每项 id/tier/runnable/note）、`LaneModel/LaneScenarioEntry/LaneRunRow/LaneModelSummary/RealModelLaneReport` 类型、`probeModelApi`、`scenarioAppliesToModel`、`runRealModelLane({models,scenarios,providerResolver,repoRoot,reportsDir,keepWorkspace})`、`renderLaneMarkdown`。执行：每个模型解析一次 provider（null/throw → 降级），按 tier 过滤场景，runnable 场景经 076 `vesselAdapter.run` 驱动出 RunResult（validate 通过），非 runnable feature-lane 标 skipped 不烧配额，fixture 缺失标 failed。报告写 `benchmarks/reports/<runId>.md + .json`（model×scenario 矩阵 + 每模型 §15 L3 累计）。 |
| `benchmarks/runners/src/lane/index.ts` | 新增 | re-export lane 模块。 |
| `benchmarks/runners/src/index.ts` | 修改 | 增加 `export * from './lane/index.js'`（+1 行）。 |
| `benchmarks/runners/src/lane/real-model-lane.test.ts` | 新增 | 11 个测试（场景集校验 4 / lane 执行-mock provider 3 / 降级与异常 4）。 |
| `docs/REAL-MODEL-LANE.md` | 新增 | lane 用法 + 场景集清单 + 模型档说明 + 设计选择（复用 076 RunResult / vesselAdapter.run 驱动 / 可注入=契约友好 / 既有资产不新造）。 |

### 测试数与命令输出

- 新增测试数：**11 个**（`benchmarks/runners/src/lane/real-model-lane.test.ts`）。
- 定向 lane 测试：`npx vitest run benchmarks/runners/src/lane/real-model-lane.test.ts` →
  `Test Files 1 passed, Tests 11 passed (11)`, exit 0。
- 全量 vitest：`npx vitest run` → `Test Files 86 passed (86), Tests 810 passed | 1 skipped (811)`,
  exit 0（基线 799+1 skip → **+11 新增，810+1 skip，无回归**）。
- 类型构建：`npx tsc -b tsconfig.json --pretty false` → exit 0（TSC_EXIT=0）。
- 环境备注：vitest/tsc 均可直跑（非沙箱受限）；tsx 独立 smoke 因 `@vessel/*` 走 vitest alias 映射、
  tsx 裸模块解析不适用而失败（非实现问题），端到端以 vitest lane 测试为准。

### 设计选择与理由

1. **复用 076 RunResult**：每个（模型 × 场景）产出 `validateRunResult` 通过的 RunResult，§15 L3 采集字段
   与 cross-harness（L3）完全一致，不另起指标模型。
2. **vesselAdapter.run 驱动**：走 076 self-adapter 统一入口（含 temp workspace 隔离与回收），不重复
   compose/telemetry，报告行均为契约合法 RunResult。
3. **可注入 = 契约友好**：`models`/`scenarios`/`providerResolver` 均可注入；无凭据时 mock provider 验证
   全框架，退化 `pending-environment` 不 throw，天然满足「不烧真实配额」。
4. **场景集从既有资产选**：只用现存 21 个 yaml/fixture（B001-B005 + B016-B023 + S001-S008），落在
   20-50 区间；feature-lane（B016-B023）是确定性 mock 车道，枚举为 `skipped` 而非虚跑。streaming/
   interrupt/steering 无既有资产（§15.1 L1「继续增加」项），文档标注待补，不新造场景避免膨胀。

### 踩坑记录

- tsx `-e` 不支持顶层 await 直接 `-e` 执行打包代码；改走临时脚本后因 `@vessel/*` 仅 vitest alias 映射、
  tsx 裸解析失败（ERR_PACKAGE_PATH_NOT_EXPORTED）——判定为非实现缺陷，端到端佐证以 vitest lane 测试为准，
  临时脚本已走回收站删除。
- 环境铁律遵守：每条命令只跑一次，vitest/tsc 均一次成功；无 EPERM/管道故障；无永久删除（一律未用 rm）。

### 验收标准勾选

全部勾选（见上方）。

## 验收结论（指挥回填）

- [x] 合入（commit 54ba52e）
- 备注：指挥独立复核——全量 vitest 809 passed（唯一失败为已知并发 flaky：sandbox process-tree/usage-store
  隔离单跑 28+1 skipped 全绿，非本卡回归）+ 1 skipped、tsc -b 0 错误、lane 11 例全绿。
  认可：runRealModelLane 固定 DeepSeek V4 Pro/Flash（可注入）+ 21 场景集（B001-B005 + S001-S008 可跑，
  B016-B023 feature-lane 枚举 skipped 不烧配额）+ 复用 076 RunResult/validate + probeModelApi 无凭据
  pending-environment 降级不 throw + 报告 .md+.json。streaming/interrupt/steering 无资产已文档标注待补。
  下一张：083（report/dashboard）。
