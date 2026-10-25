# T297 — 复用判定原语：读得出「这次 run 用的是不是当前 harness」

- Status: 已完成（2026-10-25；Codex 手动执行；未提交、未推送）

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 前置：卡 294 已落 `.run-complete.json`（**只写不读**）。本卡补读取侧，**不做自动复用**。

## 0. 先读这些（只读）

1. `packages/engine/src/fingerprint.ts` — `computeHarnessFingerprint(repoRoot)` 的返回形状与开销（约 175 ms / 400+ 文件）。
2. `benchmarks/runners/src/runner.ts` 约 1040–1060 行 — `.run-complete.json` 的字段（`version` / `fingerprint` / `fileCount` / `finishedAt`）与写入条件（`success && turnEndedAbnormally !== true`）。
3. `benchmarks/runners/src/report/report.ts` — run 目录的读取方式（`loadRunResults` 之类），别再造第二套扫描。
4. `benchmarks/runners/src/runner.test.ts` 里 `.run-complete.json` 的用例 — 造临时 run 目录的现成写法。

## 1. 新增 `benchmarks/runners/src/runCache.ts`

```ts
export interface CompletedRun {
  scenarioId: string;
  runId: string;
  dir: string;          // 绝对路径
  fingerprint: string;
  fileCount: number;
  finishedAt: string;   // ISO
}

/** 列出某 scenario 下所有带合法 .run-complete.json 的 run，按 finishedAt 倒序。 */
export function listCompletedRuns(reportsDir: string, scenarioId: string): CompletedRun[];

/** 当前 harness 指纹下最新的一条可复用 run；没有则 null。 */
export function findReusableRun(reportsDir: string, scenarioId: string, repoRoot: string): CompletedRun | null;
```

要求：

- 只读目录、只认 `.run-complete.json`；文件缺失、JSON 损坏、字段类型不对、`version !== 1` 一律**跳过**（不抛错，不删除）。
- `runId` 取目录名（`run_<ms>_<hex>`），`dir` 用 `path.resolve`。
- `findReusableRun` 只调**一次** `computeHarnessFingerprint(repoRoot)`，与列表里的 `fingerprint` 严格相等才算命中；多个命中取 `finishedAt` 最新的。
- 目录不存在 → 返回 `[]` / `null`，不抛。
- **不实现自动复用**：没有任何调用方会因此跳过重跑。文件头注释写明「本卡只提供判定原语，复用策略属后续卡」。

## 2. 不接线

- 不要改 `runScenario`、`run-release-gates`、report 聚合或 CLI。
- 不要在 `runner.ts` 之外暴露新的写入路径。

## 3. 测试（新增 `benchmarks/runners/src/runCache.test.ts`）

1. 三个 run：指纹 A（最新）、指纹 B、损坏文件 → `listCompletedRuns` 返回 2 条且按时间倒序，损坏的被跳过。
2. `findReusableRun` 在临时 repoRoot 上命中指纹一致的最新一条；把某文件改一行后返回 `null`。
3. 目录不存在、空目录、`.run-complete.json` 是 `{}` → `[]` / `null`，不抛。
4. `runId` 与 `dir` 正确（目录名 + 绝对路径）。

用 `mkdtemp` 在 `os.tmpdir()` 下自建（允许测试清理自己的临时目录）。

## 4. 不许做

- 不 commit / push / 删文件；不加依赖。
- 不接自动复用、不改 run 目录命名、不动 `packages/core`、不跑 `--live`。

## 5. 允许修改

```
benchmarks/runners/src/runCache.ts        (新增)
benchmarks/runners/src/runCache.test.ts   (新增)
```

## 6. 验收（逐条真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run benchmarks/runners/src/runCache.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

## 7. 回报

```
API：<最终签名>
丢弃规则：<哪些情况跳过 + 是否抛错>
指纹调用次数：<证明只算一次>
测试：<四条用例结果>
检查：<三条命令退出码>
```

## Result

已完成。`benchmarks/runners/src/runCache.ts` 导出 `listCompletedRuns(reportsDir, scenarioId)` 与 `findReusableRun(reportsDir, scenarioId, repoRoot)`：只扫 `run_<ms>_<hex>` 目录、只认 `.run-complete.json`，对 `version !== 1`、字段类型不符、`finishedAt` 非法、JSON 损坏一律静默跳过（不抛错、不删除）；`findReusableRun` 只算一次指纹，取 `finishedAt` 最新且指纹严格相等的一条。**不接自动复用**，`runScenario` 与 release gate 仍重跑。

验收：`runCache.test.ts` 5 个用例通过；`tsc -b` 与 `typecheck:tests` exit 0。
