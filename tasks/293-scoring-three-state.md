# T293 — 判分三态（graded / ungraded / pending）

- Status: 已完成（2026-10-25；Codex 手动执行；未提交、未推送）

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 来源：`docs/HARNESS2-ABSORPTION-ASSESSMENT.md` §3 P0-1。目标：让「判分器崩了」不再被算成「没通过」。

## 0. 先读这些（只读，别先改）

1. `benchmarks/runners/src/contracts/types.ts` — `RunResult` / `RunResultMetrics` 的完整形状。**只加可选字段，不动任何既有必填字段**。
2. `benchmarks/runners/src/contracts/validate.ts` — 现有的 fail-loud 校验风格（必填缺失、类型不符、枚举越界分别是哪种报错）。
3. `benchmarks/runners/src/report/report.ts` — 重点读 `ReportRow`、`HarnessSummary`、`ScenarioSummary`、`deriveSummary()`、`aggregateRows()`，以及注释里关于「按精确枚举值相加」的那段理由。
4. `benchmarks/runners/src/report/report.test.ts` — 现有 successRate 与计数断言，确认哪些数字会因分母变化而变。
5. `benchmarks/runners/src/release-gates/gates.ts`（约 890–930 行）— 确认 gate 按 `'passed'` / `'failed'` / `'pending-environment'` 精确计数，**不读 successRate**（所以本卡不动 gate）。
6. `docs/BENCHMARK-SPEC.md` §2.4 与 §3 — 现有字段叙述的位置。

## 1. 三个状态的定义（写死，不许自创第四个）

- `graded`：判分器跑完并给出结论。**唯一**进入成功率分母的状态。
- `ungraded`：判分器失败 / 未运行 / 结果不可解析。**不进分母**，单独计数。
- `pending`：环境未就绪（既有语义，不动）。

`RunResultMetrics.success` 的语义不变（runner 侧「断言行全过」）。本卡不重定义 success，只新增一个**并列**的判分描述。

## 2. 契约（`contracts/types.ts`）

给 `RunResult` 加一个**可选**字段：

```ts
export interface RunScore {
  /** how many criteria actually passed */
  n_passed: number;
  /** how many criteria the grader was supposed to evaluate */
  n_criteria: number;
  /** n_passed === n_criteria */
  all_pass: boolean;
  /** false = the grader itself failed / never ran / produced unparsable output */
  graded: boolean;
  /** why it is ungraded (required when graded === false) */
  reason?: string;
}

export interface RunResult {
  // ...既有字段不动
  /** Optional grading outcome; absent means "graded, see metrics" (backward compatible). */
  score?: RunScore;
}
```

写死三条兼容规则：**缺省 = 视为 graded=true**；既有 14 个必填指标字段一个不删不改；`metrics.success` 不接受 `undefined`。

## 3. 校验（`contracts/validate.ts`）

`validateRunResult()`（按现有函数名，找实际名）新增：

- `score` 存在时必须是对象，四个字段类型正确。
- `graded === true` ⇒ `n_criteria >= 1` 且 `0 <= n_passed <= n_criteria`，且 `all_pass === (n_passed === n_criteria)`。
- `graded === false` ⇒ 允许 `n_passed = 0`、`n_criteria = 0`；`reason` 必须是非空字符串。
- 错误信息沿用现有风格（点名场景/字段），不要只 throw `new Error('invalid')`。

## 4. 聚合（`report/report.ts`）

- `ReportRow` 加可选 `graded?: boolean`（缺省 true）与可选 `score?: RunScore`（用于把 `ungraded` 行标记出来）。
- `HarnessSummary` 加 `ungraded: number`（与 `passed` / `failed` / `skipped` / `pending` 并列）。`runs` 仍是**全部行数**（含 ungraded）。
- `ScenarioSummary` 也加 `ungraded: number`（per-scenario 卷起来时同样要能看见）。
- `successRate` 分母改为 `passed + failed`：
  - `passed + failed === 0` ⇒ `0`（保持既有「0 when no runs」语义，不返回 NaN）。
  - `skipped` / `pending` / `ungraded` 都不进分母。
- `ReportRowStatus` 枚举**不变**（仍是 `'passed' | 'failed' | 'skipped' | 'pending'`）。ungraded 不是第 5 种状态，它是**并列计数**——这点必须与报告注释里「新增枚举值会造空洞」的既有裁决一致。
- 如果 `deriveSummary` 与 `aggregateRows` 各自算过一次 successRate，两处必须用同一个 helper，禁止出现两套分母。

## 5. 既有断言如何处置

`report.test.ts` / `contracts.test.ts` 里凡是断言具体 successRate 数字的用例，可能因分母变化而变。规则：

- 允许**改期望值**，但必须在回报里逐条写明「改前 / 改后 / 为什么」。
- **禁止**为了让它过而放宽断言（不许把 `toBe(0.5)` 换成 `toBeGreaterThan(0)`、不许删用例、不许 `expect.any(Number)`）。
- 若某个用例的数字**不该**变（没有 ungraded/skipped/pending 行），那就是实现错了，回去查分母。

## 6. 文档

`docs/BENCHMARK-SPEC.md` 在 §2.4（或紧接 metrics 说明的合适小节）加 6–10 行：

- 三态定义（graded / ungraded / pending 互斥）。
- `RunResult.score` 是可选字段，缺省视为 graded。
- `successRate = passed / (passed + failed)`；`ungraded`、`skipped`、`pending` 不进分母，单独计数。
- 一句话说明兼容性：既有报告在全是 graded 行时数字与以前一致。

## 7. 测试（必须新增）

`benchmarks/runners/src/report/report.test.ts` 至少加两条：

1. **分母不变性**：两行数据（一行 graded passed，一行 graded=false/ungraded）的 `successRate` 必须与「只保留第一行」时**完全相同**；同时 `ungraded === 1`、`runs === 2`。
2. **skipped/pending 也不进分母**：构造 passed=1、failed=1、skipped=1、pending=1，`successRate` 必须等于 `0.5`，`runs === 4`。

`benchmarks/runners/src/contracts/contracts.test.ts` 加：

3. `score` 缺省 → 校验通过（向后兼容）。
4. `graded=false` 且 `reason` 缺失 → 抛错；`graded=true` 且 `n_passed > n_criteria` → 抛错；`all_pass` 与 `n_passed===n_criteria` 不一致 → 抛错。

## 8. 不许做

- 不 commit / push / 删文件；不加依赖。
- 不改 `runner.ts` / `adapters/*.ts` / `gates.ts` 的判定逻辑（本卡只动契约、校验、聚合、文档、对应测试）。
- 不改 `ReportRowStatus` 枚举；不新增「ungraded」状态值。
- 不动 `packages/core`。
- 不跑 `--live`。

## 9. 允许修改

```
benchmarks/runners/src/contracts/types.ts
benchmarks/runners/src/contracts/validate.ts
benchmarks/runners/src/report/report.ts
benchmarks/runners/src/contracts/contracts.test.ts
benchmarks/runners/src/report/report.test.ts
docs/BENCHMARK-SPEC.md
```

## 10. 验收（逐条真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run benchmarks/runners/src/contracts/contracts.test.ts benchmarks/runners/src/report/report.test.ts benchmarks/runners/src/run-release-gates.note.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

另加一条自证（不必改代码，跑完贴输出即可）：用 `node -e` 构造一份含一条 ungraded 行的报告 JSON，打印其 `ungraded` 与 `successRate`，证明分母不含 ungraded。

## 11. 回报

```
契约：<RunScore 最终字段 + 兼容规则>
校验：<四条规则的错误信息样例>
聚合：<successRate 公式 + 是否有第二处重复实现>
断言变更：<改前/改后/为什么，逐条>
新增用例：<编号 + 断言>
检查：<三条命令退出码 + 自证输出>
风险/未做：<如实写>
```

## Result

已完成。`RunResult.score?: RunScore`（`n_passed` / `n_criteria` / `all_pass` / `graded` / `reason?`），缺省视为 graded，14 个必填指标字段未动；`validateRunResult` 覆盖对象类型、整数非负、`graded=true` 时 `n_criteria >= 1` 与 `all_pass === (n_passed === n_criteria)`、`graded=false` 时必填非空 `reason`。

聚合侧新增 `gradingCounts()` 单一 helper，harness / scenario / totals 三处共用：`successRate = passed / (passed + failed)`，`passed + failed === 0` 时为 0；`ungraded`、`skipped`、`pending` 都不进分母，`ReportRowStatus` 枚举未变。`ReportRow` 用两个可选字段 `graded` / `score` 携带判分信息。

验收：定向 3 文件 / 71 passed；`tsc -b`、`typecheck:tests` exit 0；自证输出 `{"runs":2,"passed":1,"failed":0,"ungraded":1,"successRate":1}`；全量根 307 文件 / 3268 passed + 6 skipped、web 58 / 494。既有成功率断言无需改值。

口径变化（已记入文档）：`passed` / `failed` 现在只统计 graded 的行，ungraded 的「通过行」进 `ungraded` 而不再计入 `passed`。全是 graded 的旧报告数字与以前一致。
