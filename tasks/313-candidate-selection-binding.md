# T313 — 把 `runCandidates` 接进 `selectCandidate`

- Status: 已完成（2026-10-26；PDW 任务 `20261026103119-3714af` `accepted_local`；未提交、未推送）
- PDW task: none
- Mode: standard（纯函数接线 + 测试，不跑额外评审）
- Source: 卡 307（选优算法）与卡 311（多候选 API）之间缺的那一段
- Risk: low（新模块，无生产调用方）

## Goal

让 307 的算法真正有输入：把 N 份 `ScenarioReport` 映射成 `CandidateReview`，喂给 `selectCandidate`。**不额外跑 evaluator、不额外调 provider**——`ScenarioReport.asserts` 已经是一次运行的判定结果，直接用它。

## Not Doing

- 不加 CLI 子命令、不改 `runCandidates` / `runScenario` / `selectCandidate` 的签名与行为。
- 不引入第二套评审（不再跑一次 evaluator 或模型）。
- 不把选优结果写回 run 目录、不改报告格式。
- 不 commit / push / 删文件；不加依赖；不动 `packages/core`；不跑真实模型。

## 设计

新增 `benchmarks/runners/src/candidateSelectionBinding.ts`：

```ts
import type { CandidateReview, SelectionResult } from '@vessel/engine';
import type { CandidateRun } from './candidates.js';

/** 把一次 run 的断言结果映射成评审票；不引入第二套判定。 */
export function reviewFromReport(run: CandidateRun): CandidateReview;

/** 把 N 份候选映射成 selectCandidate 的输入并选优；纯函数。 */
export function selectFromCandidates(runs: CandidateRun[], seed: string): SelectionResult;
```

映射规则（写死）：

- `report.asserts` 为空 → `{ verdict: 'not_met', reason: 'no assertions recorded' }`（没有判据不算 met）。
- 有任一 `result === 'fail'` → `not_met`，reason 形如 `failed: a1, a3`（按 assert id 列，最多 5 个，超出加 `…`）。
- 其余（全部 `pass` 或 `skip`）→ `met`，reason 形如 `n/n asserts passed`（`pass` 数与总数，`skip` 计为通过但不计 pass 数——reason 里注明 `k skipped`）。
- `CandidateInput`：`{ id: report.runId, output: report.finalText, artifactPaths: [report.workspace, report.reportPath] }`。
- `seed` 原样传给 `selectCandidate`；不做默认值（调用方必须显式给，保证可复现）。
- 不打印、不读文件、不写文件。

`benchmarks/runners/src/index.ts` 导出两个函数。

## Acceptance

- AC1：`reviewFromReport` 三条规则按上表实现（用构造的 `ScenarioReport` 直接测，不需要真跑场景）。
- AC2：`selectFromCandidates` 在「2 份 pass + 1 份 fail」时 `chosen` 是某一份 pass 的 runId（且同一 seed 两次调用结果一致）；「全部 fail」时 `chosen === null` 且 `why` 含 `0 met`。
- AC3：纯函数：全程不调用 provider / evaluator / 文件系统（用 spy 或断言输入未被修改）。
- AC4：`benchmarks/runners/src/index.ts` 导出两个函数；`tsc -b`、`typecheck:tests` 干净。
- AC5：定向 vitest 通过。

## Blast Radius

`benchmarks/runners/src/candidateSelectionBinding.ts`（新）、`candidateSelectionBinding.test.ts`（新）、`benchmarks/runners/src/index.ts`。回滚 `git checkout -- <index.ts>` 并回收两个新文件。

## Expected Evidence

定向 vitest 输出、`tsc -b` / `typecheck:tests` 退出码、PDW review 结论；协调者另跑全量。

## Result

已完成。`candidateSelectionBinding.ts` 导出 `reviewFromReport(run)` 与 `selectFromCandidates(runs, seed)`，`benchmarks/runners/src/index.ts` 一并导出。

`reviewFromReport` 用 `ScenarioReport.asserts` 直接映射成评审票：`asserts` 为空 → `not_met` + `no assertions recorded`；任一 `fail` → `not_met` 并列出最多 5 个 assert id（超出加 `…`）；其余 → `met`，reason 形如 `n/m asserts passed`，有 skip 时注明 `(k skipped)`。`selectFromCandidates` 把每份报告映射成 `{ id: runId, output: finalText, artifactPaths: [workspace, reportPath] }`，连同 review 与调用方显式给的 seed 一起交给 `selectCandidate`；全程纯函数，不读写文件、不调 provider/evaluator、不打印，测试用 `Object.freeze` 验证输入对象未被修改。

验收：定向 **10 passed**；`tsc -b`、`typecheck:tests` exit 0；全量根 **319 文件 / 3409 passed + 6 skipped**、web **58 / 494**。

未做：不接 CLI 子命令、不写回 run 目录、不引入第二套评审（成本模型保持「零额外模型调用」）。
