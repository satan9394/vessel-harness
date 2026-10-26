# T311 — 多候选运行入口（API 层）

- Status: 已完成（2026-10-26；PDW 任务 `20261026094541-8a86d9` `accepted_local`，第一次尝试撞 Codex capacity 已归档；未提交、未推送）
- PDW task: none
- Mode: standard（只提供 API + 单测，不接 CLI、不跑真实模型）
- Source: HARNESS² 评估 P1-2 的前置「同一任务跑 N 份、产物不截断保留」
- Risk: low（新模块，无调用方；mock provider 单测）

## Goal

给「同一场景跑 N 份候选」提供**可测试的 API**，每份独立 run 目录、结果按序返回，为卡 307 的选优算法提供输入。本卡**不做选优接线**、不加 CLI 子命令、不在测试里发真实模型请求。

## Not Doing

- 不接 `selectCandidate`（307 保持纯算法，接线是后续卡）。
- 不加 `vessel bench:candidates` 之类 CLI 子命令。
- 不改 `runScenario` 的行为与签名。
- 不跑真实模型、不跑 `--live`；测试只用 mock provider。
- 不 commit / push / 删文件；不加依赖；不动 `packages/core`。

## 设计

新增 `benchmarks/runners/src/candidates.ts`：

```ts
import type { ScenarioReport } from './types.js';
import type { ChatProvider } from '@vessel/shared';
import type { ComposeOptions } from '@vessel/application';

export interface CandidateRun {
  /** 1-based 序号，与返回数组顺序一致 */
  index: number;
  report: ScenarioReport;
}

export interface RunCandidatesOptions {
  scenarioId: string;
  runs: number;               // 1..8，超出直接抛错
  repoRoot: string;
  reportsDir: string;
  policyPath: string;
  behaviorIRPath: string;
  provider?: ChatProvider | null;
  model?: string;
  nativeSandbox?: ComposeOptions['nativeSandbox'];
}

/** 顺序跑 N 份候选；每份走 runScenario（独立 runId + 独立工作区）。任何一份抛错就整体 reject。 */
export function runCandidates(opts: RunCandidatesOptions): Promise<CandidateRun[]>;
```

要求：

- `runs` 必须是 1..8 的整数（非整数、0、负、>8 → 立即抛 `RangeError`，不静默夹取）。
- 串行执行（不并行开 N 个 workspace），按 1..N 顺序返回。
- 每份调用 `runScenario` 时透传 `policyPath` / `behaviorIRPath` / `provider` / `model` / `nativeSandbox`（与 `apps/cli/src/cli.ts` 的 `--bench` 调用保持同一形状）。
- 不做去重、不做选优、不写额外索引文件；run 目录由 runner 自己创建。
- `benchmarks/runners/src/index.ts` 导出 `runCandidates` 与两个类型。

## Acceptance

- AC1：`runCandidates` 与 `RunCandidatesOptions` / `CandidateRun` 导出；`runs` 越界（0、9、1.5）抛 `RangeError`，错误信息含允许范围。
- AC2：用 mock provider 跑 2 份，返回 2 条、`index` 为 1 与 2、两份 `report.runId` 不同、`reportsDir/<scenarioId>/` 下恰好两个 run 目录。
- AC3：每份的 `workspace` 路径不同且都位于各自的 run 目录下（证明没有共享工作区）。
- AC4：某一份 `runScenario` 抛错（用会让 runScenario 抛错的 manifest，如 fixture 缺失）→ `runCandidates` 整体 reject，错误原样抛出（不吞、不返回部分结果）。
- AC5：定向 vitest、`tsc -b`、`typecheck:tests` exit 0。

## Blast Radius

`benchmarks/runners/src/candidates.ts`（新）、`benchmarks/runners/src/candidates.test.ts`（新）、`benchmarks/runners/src/index.ts`。回滚 `git checkout -- <index.ts>` 并回收两个新文件。

## Expected Evidence

定向 vitest 输出、`tsc -b` / `typecheck:tests` 退出码、PDW review 结论；协调者另跑全量。测试报告目录写 `os.tmpdir()`，不得写仓库内 `benchmarks/reports`。

## Result

已完成。`benchmarks/runners/src/candidates.ts` 导出 `runCandidates(opts): Promise<CandidateRun[]>` 与 `CandidateRun` / `RunCandidatesOptions`，`benchmarks/runners/src/index.ts` 一并导出。`runs` 必须是 **1..8 的整数**，越界**同步**抛 `RangeError('runs must be an integer in 1..8')`（0 / 9 / 1.5 / -1 / NaN / Infinity / 2.5 七种输入都测，且断言抛错前不产生任何 IO）；执行是串行的，每份透传 `policyPath` / `behaviorIRPath` / `provider` / `model` / `nativeSandbox` 走 `runScenario`，任一份 reject 时整体 reject、不会继续跑下一份。

验收：定向 **11 passed**；`tsc -b`、`typecheck:tests` exit 0；全量根 **318 文件 / 3399 passed + 6 skipped**、web **58 / 494**。

未做：不接 `selectCandidate`（307 仍是纯算法）、不加 CLI 子命令、测试只用 mock provider（不跑真实模型、不跑 `--live`）。
