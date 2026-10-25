# T305 — reuse 就绪判据（HARNESS² P1-5 的 Vessel 版）

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 前置：卡 297（`runCache.ts`）、卡 298（`vessel bench:runs`）已完成。本卡把「指纹相同」升级为「指纹相同 **且** 产物完好」，并把理由暴露到命令输出。

## 0. 先读这些（只读）

1. `benchmarks/runners/src/runCache.ts` — `CompletedRun` 与两个既有函数。
2. `benchmarks/runners/src/runner.ts` 约 1030–1065 行 — `summary.json` 与 `.run-complete.json` 的落盘形状。
3. `apps/cli/src/cli.ts` 的 `bench:runs` 分支（卡 298 加的）与 `apps/cli/src/cli.test.ts` 对应用例。
4. `docs/BENCHMARK-SPEC.md` §2.4 中卡 294 那段（marker 的写入条件），新逻辑要与之一致。

## 1. 新增 `benchmarks/runners/src/reuse.ts`

```ts
export interface ReuseAssessment {
  ok: boolean;
  /** 不满足的项目，人类可读；ok 时为 [] */
  reasons: string[];
}

/** 判定一次已完成的 run 是否可作为当前 harness 的复用基线。只读。 */
export function assessRunReusability(runDir: string, repoRoot: string): ReuseAssessment;
```

逐项检查（**全部通过才 ok**，任一项失败就把原因写进 `reasons`）：

1. `runDir` 存在且是目录。
2. `summary.json` 存在、可解析、是对象，且 `success === true`。
3. `.run-complete.json` 存在、可解析、`version === 1`、`fingerprint` 是非空字符串。
4. 指纹与 `computeHarnessFingerprint(repoRoot).value` **严格相等**（只算一次）。
5. `summary.json` 里若声明了 `reportPath` / `sessionLog`，对应文件必须存在且非空；字段缺席不视为失败（旧报告）。
6. `workspace/` 目录存在（不检查内容是否被改动——那是另一件事，不要在这里猜）。

不抛错：任何异常都转成 `reasons` 里的一条（`read: <error.message>` 形式）。

## 2. 接到 `bench:runs`

- `runCache.ts` 不动；在 `cli.ts` 的 `bench:runs` 分支里对每个 run 调 `assessRunReusability`。
- 文本输出把 `reusable=yes|no` 换成：
  - `reuse=ok`
  - `reuse=no(missing summary.json; fingerprint mismatch)`（多条用 `; ` 连接）
- `--json` 每条 run 增加 `reuse: { ok: boolean, reasons: string[] }`；**保留** 既有 `fingerprint`/`fileCount`/`finishedAt`/`runId` 字段（不破坏卡 298 的输出契约）。
- 汇总行改成 `n run(s); m reuse-ready for the current harness`。

## 3. 测试

`benchmarks/runners/src/reuse.test.ts`（新增）：

1. 完整且指纹一致 → `ok: true`、`reasons: []`。
2. 改仓库一个文件 → 指纹不符 → `ok: false`、`reasons` 含 `fingerprint`。
3. `summary.json` 缺失 → 该原因出现；`success: false` → 该原因出现。
4. `reportPath` 指向不存在的文件 → 该原因出现；字段缺席 → 不报错。
5. 损坏的 `.run-complete.json` → `reasons` 含解析失败，且函数不抛。

`apps/cli/src/cli.test.ts` 追加一条：`--json` 的每条 run 含 `reuse.ok`，且旧的四个字段仍在。

## 4. 不许做

- 不实现"自动复用/自动跳过重跑"（本卡只判定与展示）。
- 不改 `runCache.ts` 的既有函数签名。
- 不 commit / push / 删文件；不加依赖；不动 `packages/core`。

## 5. 允许修改

```
benchmarks/runners/src/reuse.ts         (新增)
benchmarks/runners/src/reuse.test.ts    (新增)
apps/cli/src/cli.ts
apps/cli/src/cli.test.ts
docs/BENCHMARK-SPEC.md                  (§2.4 marker 段补一句"reuse 判定还要求产物完好")
```

## 6. 验收（逐条真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run benchmarks/runners/src/reuse.test.ts benchmarks/runners/src/runCache.test.ts apps/cli/src/cli.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
node apps/cli/dist/cli.js bench:runs B001 --json
```

## 7. 回报

```
判据：<六项检查逐条>
输出：<文本样例 + JSON 片段>
测试：<reuse 五条 + cli 一条>
检查：<四条命令退出码 + JSON 是否含 reuse>
未做：<如实写>
```
