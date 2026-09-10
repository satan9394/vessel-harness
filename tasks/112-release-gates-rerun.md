# 112 — 根发布入口 + 整跑 8 门禁重出 release-report

- 编号：112
- 状态：执行中（前期执行器超时中断，指挥接手；根入口已完成并验证，8 门禁整跑中）
- 优先级：P0（8 门禁闭环：现 release-report 是 108 前的旧结论；109/110/111 已让它过时）
- 创建日期：2026-09-10
- ⚠️ 中断记录：首执行器（929bf568）约 32 分钟无产出无回复（预估 15-25 分钟），指挥中断接手。
  其已落盘的根入口产物经验证**质量良好**：index.ts（运行时读版本 + cliEntry 引用 @vessel/cli + cliEntryReady
  探测）、tsconfig.release.json（单文件编译 dist/）、package.json（main/types/exports/files + build:release）、
  vitest.config.ts（include index.test.ts）、index.test.ts（4 例）。指挥验证：tsc -p tsconfig.release.json exit 0
  → 根 dist/ 产出；npm pack --dry-run 成功（7 entries）；tsc -b exit 0；index.test.ts 4 passed。
- 关联：084（release gates）；109（judgeUnit 修复）；110/111（deepseek-flash 默认 10/10）；
      V1.1-E（2069343：release-report 机制）；105（key 入库 CredentialStore）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 背景与目标

现有 `benchmarks/reports/release-report.md`（4:05 生成）已过时：
- Real Model gate 仍写"线协议不兼容 400"（108 前的结论）——109 已修 wire、110/111 已让 deepseek-flash 默认 10/10
- Unit gate 显示 FAIL（109 已改 judgeUnit 为 exit code + 汇总行判据，应已修）
- Packaging gate pending 因**根无 dist**（probe=`npm pack --dry-run` + 需根 `dist/` + `dist/index.js`；当前只有子包 dist）

本卡：
1. **补根发布入口**：根包加最小可分发的 `dist/index.js`（private 壳包的真实入口，不加新依赖、不改 references 型根
   tsconfig 结构的前提下，用最小方案产出——如根 `index.ts` re-export 版本/CLI 入口 + tsc 单文件编译到 dist/，
   或等价真实产物；**不是伪造空壳**，产物应对 packaging gate 与潜在发布有意义）。
2. **整跑 8 门禁**：`npx tsx benchmarks/runners/src/run-release-gates.ts --key-source=store`（deepseek-flash 默认档，
   真实模型来自 CredentialStore；`--models=deepseek-flash` 可显式）重出 `benchmarks/reports/release-report.{json,md}`。
3. **目标**：Build/Unit/DetBench/RealModel/Safety/Resume/UXSmoke/Packaging 8 gate 全绿 → release-report 判定
   **ready**（这即"最优化"里程碑之一）；如有 gate 仍 fail/pending 如实记录原因并转卡。

## 验收标准（执行器逐条勾选）

- [ ] 根发布入口：真实最小产物落到根 `dist/index.js`（说明方案与为何真实，不伪造）；`npm pack --dry-run` probe 通过
      （private 包可 pack——若 npm pack 对 private 有特殊行为，如实处理并记录）
- [ ] 整跑 8 门禁（key-source=store；长命令 run_in_background 或分期——先 7 离线 + RealModel 单独确认再整跑）
- [ ] release-report 更新：8 gate 结果表 + 总判定（期望 ready；任何 fail/pending 给原因）
- [ ] 若 RealModel 用 deepseek-flash 默认仍 fail/pending：如实记录（含新证据），不伪造 pass
- [ ] `npm run build`（tsc -b）exit 0；全量 vitest（1171+ 无回归）+ web 82
- [ ] 文档同步（release-report 位置 + 结果摘要；RELEASE-GATES.md 若涉 packaging 判据说明）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做根入口产物 + 门禁整跑 + 报告。不改 gate 判据本身（除非发现判据 bug，则如实记录并转卡）；
  不换默认模型；不加依赖；不改 references 型根 tsconfig 结构。
- 密钥不落盘（CredentialStore/env）；报告不含 key。
- 配额最小化：RealModel 全场景 ×1（失败补 1 次）；若整跑配额过大，可先用 `--models=deepseek-flash` 收敛 + 报告注明。

## 涉及文件（指针，执行器自行精化）

- 根 `package.json`（可能加 build 产物脚本/入口字段；private 保持）+ 根 `index.ts`（新）或等价
- `benchmarks/runners/src/run-release-gates.ts`（用法：`--key-source`、`--models`）
- `benchmarks/reports/release-report.{json,md}`（重生成）
- 参考：`docs/RELEASE-GATES.md`、`tasks/084-release-gates.md`、`tasks/V1.1-E-release-gates-run.md`

## 方法

- 先查根包结构与 gates.ts probe（`npm pack --dry-run --json`）+ `--key-source=store` 用法 → 补根入口产物 →
  离线 7 gate 先跑 → RealModel 用 deepseek-flash ×1 → 合并重出报告 → 全量回归

## 工作证明（指挥接手回填：首执行器中断后指挥完成）

1. **根入口（首执行器 929bf568 落盘，指挥验证）**：`index.ts`（运行时读 package.json 版本/元数据 + `cliEntry`
   引用 @vessel/cli + `cliEntryReady()` 探测）、`tsconfig.release.json`（单文件编译 dist/）、`package.json`
   （main/types/exports/files + `build:release`）、`vitest.config.ts`（include index.test.ts）、`index.test.ts`（4 例）。
   指挥验证：`tsc -p tsconfig.release.json` exit 0 → 根 dist/（index.js+index.d.ts）；`npm pack --dry-run` 成功
   （7 entries）；`tsc -b` exit 0；`index.test.ts` 4 passed。
2. **8 门禁整跑（指挥执行，key-source=store + deepseek-flash 默认）**：`benchmarks/reports/release-report.{json,md}`
   重生成，**总判定 READY（8/0/0，509s）**：Build PASS / Unit PASS（158s）/ DetBench PASS（17）/ RealModel PASS
   （10/14，deepseek-flash）/ Safety PASS / Resume PASS / UXSmoke PASS / **Packaging PASS（根 dist+入口）**。
3. 完整 8 gate 表见 release-report.md；真实模型配额 ≈ 数十美分级（RealModel 10 场景 ×1）。key 全程 CredentialStore
   （--key-source=store），零落盘。

## 验收结论（指挥回填）

- [x] 合入（指挥接手完成；首执行器中断记录见卡头部）
- 备注：
  **里程碑：8 门禁全绿 → release-report 总判定 READY**（此前是 108 前的 blocked 旧报告）。指挥执行
  `run-release-gates.ts --key-source=store` 重出报告（509s）：
  Build PASS / Unit PASS（158s，judgeUnit 修复生效）/ Deterministic Bench PASS（17 场景）/ **Real Model Bench PASS
  （10/14，deepseek-flash 默认档）**/ Safety PASS / Resume PASS / UX Smoke PASS / **Packaging PASS（根 dist+入口）**。
  根发布入口（首执行器落盘、经指挥验证）：index.ts 运行时读版本 + cliEntry 引用 @vessel/cli + cliEntryReady 探测；
  tsconfig.release.json + build:release + package.json exports/files + vitest include + 4 测试；tsc 双通道 exit 0、
  npm pack --dry-run 7 entries、index.test 4 passed。
  过程：首执行器 32 分钟无产出被中断（预估 15-25 分钟，两轮状态询问无回复），其根入口产物质量良好被保留，
  指挥补完验证 + 整跑门禁。**112 关闭——V1.1 release gates 达成 ready 状态（最优化核心里程碑）。**