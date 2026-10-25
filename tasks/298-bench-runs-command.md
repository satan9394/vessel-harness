# T298 — `vessel bench:runs`：把「哪些 run 可复用」摆到命令行

- Status: 已完成（2026-10-25；Codex 手动执行；未提交、未推送）

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 前置：**必须先完成卡 297**（`benchmarks/runners/src/runCache.ts` 的 `listCompletedRuns` / `findReusableRun`）。本卡只做展示，不做自动复用。

## 0. 先读这些（只读）

1. `benchmarks/runners/src/runCache.ts`（卡 297 产出）。
2. `apps/cli/src/cli.ts` — 命令分发表（`switch`/`case` 或命令表）、`USAGE` 文本、`--json` 输出惯例（找一两个既有只读命令照抄形状）。
3. `apps/cli/src/cli.test.ts` — 命令测试的写法（`captureStreams`、`main([...])`）。
4. `benchmarks/runners/src/report/report.ts` — 若已有 `reports` 目录解析 helper，复用，不要新造。

## 1. 新命令

```
vessel bench:runs <scenarioId> [--out <dir>] [--json]
```

- 默认 `--out` = `<workspace>/benchmarks/reports`（与 `run --bench` 的默认一致，读 `cli.ts` 里同类逻辑）。
- 文本输出：一行一个 run，形如
  `run_1789..._43a65b  finished=2026-10-25T15:00:00.000Z  files=418  reusable=yes|no`
  末尾再一行汇总：`3 run(s); 1 reusable for the current harness`。
- `--json` 输出：
  ```json
  { "scenarioId": "B001", "currentFingerprint": "…", "runs": [ { "runId": "...", "finishedAt": "...", "fileCount": 418, "fingerprint": "...", "reusable": true } ] }
  ```
  `reusable` 由 `fingerprint === currentFingerprint` 计算。
- 没有任何 run → 文本 `no completed runs found`，`--json` 里 `runs: []`，**exit 0**（空不是错误）。
- 参数缺失（没有 scenarioId）→ 打印用法，exit 2。
- 目录不存在 → 当空处理，exit 0。

## 2. 边界

- **只读**：不写任何文件、不删 run、不触发重跑。
- 不要在输出里打印绝对路径以外的敏感信息；不要读 `~/.vessel`。
- 不新增命令别名，不改既有 `run --bench` 行为。

## 3. 测试（`apps/cli/src/cli.test.ts` 追加）

1. 造 2 个 run（一个与当前指纹一致、一个不一致）+ 1 个损坏 → 文本输出含 `reusable=yes` 与 `reusable=no` 各一行、汇总数字正确。
2. `--json` 的字段与 `runs[]` 顺序（倒序）正确。
3. 空目录 → `no completed runs found`、exit 0。
4. 缺 scenarioId → exit 2。

用 `mkdtemp` 自建 reports 目录；不要用真实 `benchmarks/reports`（可能被别的运行占用）。

## 4. 不许做

- 不 commit / push / 删文件；不加依赖。
- 不接自动复用、不改 `USAGE` 之外的门面、不动 `packages/core`、不跑 `--live`。

## 5. 允许修改

```
apps/cli/src/cli.ts
apps/cli/src/cli.test.ts
```

## 6. 验收（逐条真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/cli.test.ts benchmarks/runners/src/runCache.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
node apps/cli/dist/cli.js bench:runs B001 --json
```

最后一条在仓库根跑：因 `benchmarks/reports` 里可能有历史 run，退出码应为 0 且输出是合法 JSON（内容不作断言）。

## 7. 回报

```
命令：<USAGE 行 + 分发位置>
输出：<文本样例 + JSON 样例>
测试：<四条用例结果>
检查：<四条命令退出码 + 最后一条的 JSON 是否合法>
```

## Result

已完成。新增 `vessel bench:runs <scenarioId> [--out <dir>] [--json]`：文本逐行 `runId finished=… files=… reusable=yes|no` 再跟一行汇总；`--json` 输出 `scenarioId` / `currentFingerprint` / `runs[]`（`reusable` 由指纹相等得出）。空目录打印 `no completed runs found` 并 exit 0，缺 scenarioId exit 2。**只读**：不写文件、不删 run、不触发重跑。

实现取舍：297 的 API 没有从包入口导出（那张卡不允许改入口），所以该命令用延迟加载，源码与编译后的 CLI 都能取到；刻意不为一个只读命令扩大包的导出面。

验收：`cli.test.ts` 117 个用例通过（含新增 4 条）；`tsc -b`、`typecheck:tests` exit 0；`node apps/cli/dist/cli.js bench:runs B001 --json` 输出可解析 JSON、exit 0。
