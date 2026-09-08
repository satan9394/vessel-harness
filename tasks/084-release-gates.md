# 084 — Release Gates（8 道发布门禁 + release-report）

- 状态：待验收
- 优先级：P0（Wave 5 / Milestone G 收官——V1.0 路线收官卡）
- 创建日期：2026-09-08
- 关联：全部前卡（各 gate 消费对应能力）；083（report 形状；082 lane）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §21（L1946-1974）：每次版本收尾固定跑 8 gate
  （Build/Unit/Deterministic Bench/Real Model Bench/Safety/Resume/UX Smoke/Packaging），最终输出
  release-report.json + release-report.md；"不以自证为证"

## 目标

Release Gates：可重复执行的 8 道发布门禁（每 gate：判据 + 命令/脚本 + pass/fail 证据采集）+ 聚合输出
release-report.json/md（每 gate 结果 + 证据 + 总判定）。设计成可注入可测（每 gate 独立函数），CI/本地可跑；
部分 gate 需要外部环境（real model/UX smoke/packaging）——无环境时明确标 pending 不静默通过。

## 验收标准（执行器逐条勾选）

- [x] 8 gate 定义（每 gate：id/名称/判据/执行函数返回 {pass|fail|pending, evidence, durationMs}）：
      Build（tsc -b）/Unit（vitest root）/Deterministic Bench（L1 B001-B023 + safety，可跑集）/Real Model Bench
      （082 lane——无凭据 pending）/Safety（075 判据）/Resume（063/064 相关可跑集）/UX Smoke（web 套件或最小
      smoke——环境标注）/Packaging（build 产物检查——npm pack/或等价，标注）
- [x] Gate runner：顺序执行 8 gate → 聚合 release-report.json（schemaVersion + 每 gate 结果/证据/duration +
      总判定：全 pass=ready，有 fail=blocked，有 pending=partial）+ release-report.md（人读版）
- [x] 可注入可测：每 gate 执行函数可注入（单测 mock）；真实命令路径在非受限环境跑
- [x] 测试 ≥6 例：gate 判据函数/runner 顺序/聚合 JSON/MD/总判定（ready/blocked/partial）/异常；全量
      vitest/tsc 绿（822+ 无回归）
- [x] 文档同步（release gates 用法 + 判据清单）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 gate 框架 + 判据接线 + 报告。不做 CI 平台集成（本地/CI 可跑即可）；真实模型/UX/包装环境标注。

## 涉及文件（指针，执行器自行精化）

- benchmarks/runners/src/ 或 scripts（gate 模块 + runner + 测试）
- 各 gate 消费：tsc/vitest/082 lane/075 safety/083 report 形状/063-064 resume
- release-report 输出路径（仓库根或 reports/——以 083 惯例）

## 方法

- 每 gate 独立函数（可注入），判据对齐 §21 清单；runner 顺序执行 + 聚合 + 总判定
- 环境敏感 gate 用 probe/pending 标注（082 lane 模式），不静默通过

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 待执行器回填

### 改动文件（diff 摘要）

新增 `benchmarks/runners/src/release-gates/`（4 源文件 + 1 测试）：
- `types.ts`：共享类型（`GateVerdictStatus` pass|fail|pending、`GateDefinition`、`GateVerdict`、
  `ReleaseContext`、`RunCommand`、`GateExecutor`、`RealModelDeps`、`ProviderFactoryResult`）。
- `gates.ts`：8 个 `GATE_DEFINITIONS`（id/名称/判据/§21 position）+ `GATE_ORDER`；纯判据函数
  `judgeBuild` `judgeUnit` `judgeRealModelLane` `judgeScenarioRuns` `judgeSoakResume`
  `judgeUxSmoke` `judgePackagingProbe`（不跑命令、单测直接 mock 输入）；可注入执行器工厂
  `buildReleaseGateExecutors`（Build/Unit 走 `ctx.exec`；Deterministic Bench/Safety 复用 076 `runScenario`
  离线 lane；Real Model Bench 复用 082 `probeModelApi`+`runRealModelLane`（无凭据→pending）；Resume 复用
  068 `runSoak` 小规模判定不变式；UX/Packaging 用 probe→pending）；`gateDefaultRunCommand`（真实 exec
  边界，非受限环境用；备注：适配器已导出同名 `defaultRunCommand`（签名不同），故本模块命名避让）。
- `runner.ts`：`runReleaseGates`（§21 顺序 1→8 顺序执行，executor 抛异常→该 gate fail 不被吞）、
  `releaseStatus`（全 pass=ready / 有 fail=blocked / 有 pending 无 fail=partial）、`ReleaseReport`
  （schemaVersion 1 + gates + totals）、`renderReleaseMarkdown`（人读版 + 环境注解）、
  `writeReleaseReportFiles`（写 `<dir>/release-report.md` + `.json`，083 惯例）。
- `release-gates/index.ts`：模块出口。
- `release-gates.test.ts`：14 例（见下）。
- 接线：`index.ts` 增 `export * from './release-gates/index.js'`。

文档：新增 `docs/RELEASE-GATES.md`（用法 + 8 判据清单表 + JSON 形状 + 设计选择，对齐 REPORT-DASHBOARD.md）。

### 新增测试数与命令输出

`release-gates.test.ts` **14 例**：gate 判据（judgeBuild/judgeUnit/judgeRealModelLane/judgeScenarioRuns/
judgeSoakResume/judgeUxSmoke/judgePackagingProbe）、8 gate 定义顺序、runner 顺序、聚合 JSON（schemaVersion/
gates/totals）、总分 ready/blocked/partial（含"blocked 优先于 pending"）、executor 抛异常→fail、MD 渲染、
文件落盘 JSON 回读、真实 executors 组装 + 环境敏感 gate pending。

命令输出：
- `npx vitest run`（root，最终全量）：**Test Files 88 passed；Tests 836 passed | 1 skipped**（基线 822+，无回归；新增 14 例并入）。
- `npx tsc -b tsconfig.json --pretty false`：**退出码 0，无类型错误**。
- 说明：本会话 vitest/tsc 可直接跑（沙箱未拦截 esbuild spawn），故真实命令路径已在本机非受限环境验证；real-model/
  UX/packaging gate 需凭据/构建产物，测试用 mock/probe 验证其 `pending` 语义（不烧真实配额）。

### 设计选择与理由

- **判据函数=纯函数**：judge* 把预采集数据→三态判定，单测直接 mock 输入，毫秒级确定性；真实 executor 只做
  "采集→喂判据"。
- **可注入边界**：所有副作用（tsc/vitest/npm pack 命令）统一收敛到注入的 `ctx.exec: RunCommand`；单测全部 mock；
  真实命令路径由 `gateDefaultRunCommand`（child_process.execFile）在非受限环境跑。
- **环境敏感 gate=probe→pending，不静默通过**：real-model（无凭据）、UX（无 web dist）、packaging（npm pack/
  dist 缺失）显式返回 pending+note，继承 082 lane 诚实降级语义（§21「不以自证为证」）。
- **总判定三态**：ready/blocked/partial 明确区分全过/硬性失败/环境未备齐，指挥据此拍板；blocked 优先于 pending。
- **report 对齐 083**：`schemaVersion: 1`，JSON 直接 serialize 即机器可读本体，markdown 是同一对象视图；
  落盘 `benchmarks/reports/release-report.md/.json`。

### 范围边界（遵卡）

- 只做 gate 框架 + 判据接线 + 报告，未做 CI 平台集成；real-model/UX/packaging 环境标注（pending）。

### 踩坑记录

- 适配器层已导出 `defaultRunCommand`（不同签名），barrel `export *` 冲突 → 本模块命名 `gateDefaultRunCommand` 避让。
- vitest chain 聚合 `totals` 含 `durationMs`，`toEqual` 严格相等会多出该键 → 断言改用 `toMatchObject`。
- release-gates.test 首版用 `require('./gates.js')`，在 `"type":"module"` 下失败 → 改 `await import()`。
- 沙箱限制仅限于 spawn 捕获输出命令；本会话 vitest/tsc 直跑成功（日志确认），无需测试待验证标注。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
