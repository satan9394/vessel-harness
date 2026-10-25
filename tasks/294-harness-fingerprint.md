# T294 — harness 指纹：改过 harness 就不复用旧结果

- Status: 已完成（2026-10-25；PDW 任务 `20261025145255-332fb0` `accepted_local` + 协调者修复一处口径；未提交、未推送）

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 来源：`docs/HARNESS2-ABSORPTION-ASSESSMENT.md` §3 P0-3。目标：给一次 benchmark run 留一个"配置身份"，让"改完 harness 又读到旧结果"这件事能被机器发现。

## 0. 先读这些（只读）

1. `packages/engine/src/iteration-store.ts`（294 行）— 目录式记录 `meta.json` 的追加式写法、`envRoot` 覆盖（`VESSEL_ITERATIONS_ROOT`）、tmp+rename 原子写。
2. `packages/engine/src/index.ts` — 导出面（新模块要从这里 export）。
3. `benchmarks/runners/src/runner.ts` — `runScenario()` 的 `runDir` 结构与落盘时机（`reports/<sid>/run_<ms>_<hex>/`，已有 `summary.json` / session 日志）。
4. `packages/shared/src/index.ts` 或 `packages/shared/src/env*.ts` — 看 `envRoot` / `vesselHome` 这类既有根解析，别自己发明第二套。
5. `benchmarks/runners/src/runner.test.ts` — 现有 runScenario 用例的写法（构造临时 repoRoot、mock provider）。

## 1. 指纹模块（新增 `packages/engine/src/fingerprint.ts`）

```ts
export interface HarnessFingerprintInput {
  /** project root；只在这些前缀下取文件 */
  repoRoot: string;
}
export interface HarnessFingerprint {
  /** sha256 前 16 位 hex */
  value: string;
  /** 参与计算的文件数（可观测性，不参与判定） */
  fileCount: number;
  /** 参与计算的路径集合（相对 repoRoot，排序后；便于人工比对，不要求写进 meta） */
  files: string[];
}
export function computeHarnessFingerprint(repoRoot: string): HarnessFingerprint;
```

输入集合**只取这些**（写死，不要扩大）：

- `packages/*/src/**` 下的 `.ts`（不含 `.test.ts`？**要含**——测试也是 harness 的一部分，但为了减少噪声，只含 `src` 内的 `.test.ts` 也计入）
- `configs/*.yaml` 与 `configs/*.json`
- `package-lock.json`

排除规则（必须显式实现，不许靠调用方保证）：`dist`、`node_modules`、`.harness`、`.git`、`.tmp*`、任何 `*.tsbuildinfo`。

实现要求：

- 用 `node:crypto` 的 sha256，喂入"相对路径 + `\0` + 文件字节"的稳定顺序（按相对路径字典序排序），不要拼 JSON 后哈希（键序/空白会让指纹抖动）。
- 读不到的文件直接跳过并在 `files` 里不出现（不要抛错——构建中途换文件不算致命）。
- 不引入依赖，不读环境变量（同一仓库同一内容必须得到同一值）。

## 2. iteration 记录（`packages/engine/src/iteration-store.ts`）

- `meta.json` 的每个 `iterations[]` 条目**新增可选** `harnessFingerprint?: string`。既有字段一个不改、不删。
- 写入路径：在 store 落盘的唯一入口（找到那个 `appendXxx` / `writeMeta` 的实现，通常只有一处）计算并填入；**不要**在多个调用点各算一次。
- 回放兼容：旧 `meta.json` 没有该字段时必须照常读取（`undefined` 合法）。
- 允许把计算失败降级为 `undefined` 并记一条 note，但不得让落盘整体失败。

## 3. benchmark run 目录标记（`benchmarks/runners/src/runner.ts`）

- run 结束时（`summary.json` 写完之后、函数返回之前）写 `<runDir>/.run-complete.json`：
  ```json
  { "version": 1, "fingerprint": "<value>", "fileCount": 12, "finishedAt": "<ISO>" }
  ```
- **只写、不做 resume 校验**：本卡不声称已有 resume 语义（当前 runner 没有可靠的 resume 入口）。在文件注释与 `docs/BENCHMARK-SPEC.md` §2.4 都写明"本卡只落身份，不做复用判定；读取方将来可据此拒绝复用旧 run"。
- 不要在 run 失败时写这个文件（失败 run 不该被当成可复用产物）。

## 4. 文档

`docs/BENCHMARK-SPEC.md` §2.4 补 4–6 行：指纹的输入范围、`<runDir>/.run-complete.json` 的字段、以及"只落身份、不判定"的边界。不要写成"已支持 resume 复用"。

## 5. 测试

新增 `packages/engine/src/fingerprint.test.ts`：

1. 同一棵树算两次 → `value` 相同。
2. 改 `packages/<某包>/src` 里任一文件内容 → `value` 变。
3. 改 `configs/behavior.default.yaml`（在临时 repoRoot 里造一个）→ `value` 变。
4. 在 `dist/` 下加文件 → `value` 不变（排除生效）。
5. `fileCount` 与实际参与文件数一致；`files` 有序且无重复。

`packages/engine/src/iteration-store.test.ts`（若不存在则新建）补一条：落盘后 `meta.json` 的条目带 `harnessFingerprint`，且旧格式（无该字段）能被读取。

`benchmarks/runners/src/runner.test.ts` 补一条：成功 run 的 `runDir` 下存在 `.run-complete.json` 且 `fingerprint` 为 16 位 hex；失败 run（mock provider 抛错）不存在该文件。

## 6. 不许做

- 不 commit / push / 删文件；不加依赖。
- 不改 `LoopEngine` 的循环语义、不改 gate 判定、不改 adapters。
- 不把指纹扩展到 `~/.vessel` 或 session 根（评估报告明确说第一步只作用于 benchmark run 目录）。
- 不动 `packages/core`。
- 不跑 `--live`。

## 7. 允许修改

```
packages/engine/src/fingerprint.ts          (新增)
packages/engine/src/fingerprint.test.ts     (新增)
packages/engine/src/iteration-store.ts
packages/engine/src/iteration-store.test.ts (新增或修改)
packages/engine/src/index.ts
benchmarks/runners/src/runner.ts
benchmarks/runners/src/runner.test.ts
docs/BENCHMARK-SPEC.md
```

## 8. 验收（逐条真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run packages/engine/src/fingerprint.test.ts packages/engine/src/iteration-store.test.ts benchmarks/runners/src/runner.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
node node_modules/tsx/dist/cli.mjs benchmarks/runners/src/conformance/run-conformance.ts --all
```

最后一条应输出 `cells: 25 run / 0 skipped / 0 error`。

## 9. 回报

```
指纹输入：<实际取的文件前缀与排除规则>
落地位置：<iteration-store 的唯一写入点 + runner 的写文件位置>
测试：<五条用例 + 三条补充用例的实际结果>
检查：<四条命令退出码 + conformance 汇总行>
风险/未做：<如实写，特别是"只落身份不判定"的边界>
```

## Result

已完成（含一处协调者修复）。

Codex 交付：`packages/engine/src/fingerprint.ts`（`computeHarnessFingerprint`：按相对路径排序后把「路径 + NUL + 字节」喂 sha256，取前 16 位 hex；只取 `packages/*/src` 的 `.ts`、`configs/*.yaml|*.json`、`package-lock.json`；显式排除 `dist`/`node_modules`/`.harness`/`.git`/`.tmp*`/`*.tsbuildinfo`；读不到的文件跳过不改判）；`iteration-store.ts` 的 `iterations[]` 条目新增可选 `harnessFingerprint`（`appendIteration` 每 append 算一次，可注入 `harnessRoot`，计算失败 warn + 降级 undefined）；`runner.ts` 在 `summary.json` 写完、return 之前写 `<runDir>/.run-complete.json`（`version`/`fingerprint`/`fileCount`/`finishedAt`）；`docs/BENCHMARK-SPEC.md` §2.4 补六行。

**协调者修复**：`.run-complete.json` 原条件只有 `success`（断言归约），而报告侧判 passed 用 `success && !turnEndedAbnormally`。两边口径不一致会让「turn 没正常收尾」的 run 也被当成可复用基线。已改为 `success && turnEndedAbnormally !== true` 并写明理由；改后定向 61 passed、`tsc -b` exit 0。

PDW 任务 `20261025145255-332fb0`：`accepted_local`，4 次调用、0 修复。前三次尝试失败均与环境有关，如实记录：① scan 改了 `tasks/295` 被只读纪律拦下（**我的操作失误**：任务运行期间改了工作区文件）；② provider `ECONNRESET`；③ opencode 的 `bin/opencode.exe` 是 229 字节 postinstall 占位脚本，四个 opencode 角色不可用，跑完 postinstall 后恢复，最终指向 `nvm_a\v24.22.1` 下同版本可执行文件；④ 模型输出 JSON 非法（`summary` 里的未转义双引号），给四个 opencode 角色加 `prompt_guidance` 限制输出体积与转义后通过。

门禁（最后编辑之后，协调者执行）：`tsc -b` exit 0、`typecheck:tests` exit 0、离线 conformance **25/25** exit 0、`npm run test:all` 根 **308 文件 / 3280 passed + 6 skipped**、web **58 / 494**。实现者自报的全量 5 failed 已单独复跑四个文件：**4 passed / 27 passed / exit 0**，确认为并行负载下的环境性抖动。

遗留（已记录，未在本卡处理）：
- F1 的修复缺专项测试：构造「turn 异常但 asserts 全过」的 run 需要新 fixture，本卡只改了条件与注释。
- `iteration-store` 的字段文档仍只列旧 `IterationEntry` 字段，新 `harnessFingerprint` 未写进去。
- `no-fingerprint-in-vessel-home` 这条 check 只 grep 四个排除 token，证明力弱（单测覆盖了 `.git`/`.tsbuildinfo`/输入范围）。
- `baseline_dirty` 为空但当时工作区已有大量未提交改动，越界归属只能靠 mtime 与快照判断。
