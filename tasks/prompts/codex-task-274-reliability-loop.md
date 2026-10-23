# Codex 执行契约：卡 274 ARCH-09 可靠性 fixture 闭环

仓库 `E:\Code_file\Projects\Vessel_Harness`，分支 `main`，工作树干净。

## 先读

1. `tasks/274-arch09-reliability-fixture-loop.md`（范围内权威）
2. `docs/VESSEL_Architecture_Review_and_Execution_2026-10-20.md` §3 ARCH-09
3. `docs/BENCHMARK-SPEC.md`、`benchmarks/scenarios/`（已 25 个）、`benchmarks/runners/src/`、
   `package.json` 的 `bench` / `bench:conformance` 脚本

## 判断

现有场景数量已够，缺口是三件事：**没有显式覆盖映射、没有统一证据产物、没有 SHA/版本记录与 live 边界**。
所以本卡是「把已有的收敛成可复核闭环」，不是「再造一堆 fixture」。

先做一次清点：七类（失败后重试成功 / 崩溃 / 软删 / 真实 adapter 不可用 / 未知工具调用 /
事件重放 / 能力协商）各自对应哪些现有 scenario；缺的才补，并把映射写进清单。

## 交付

1. 一条离线命令（建议 `npm run bench:reliability`）跑 10–20 个 fixture。
2. 机器可读清单 JSON：`{ head, node, npm, startedAt, categories: {…}, fixtures: [{ id, category, outcome, evidence, reason? }] }`。
3. 缺类别 → 非 0 退出并报「缺少类别 X」，不要静默通过。
4. live 默认排除；`--live` 才跑，且清单标注。
5. `docs/BENCHMARK-SPEC.md` 补一节（覆盖/不覆盖/复现/证据位置）。

## 硬约束

- 不改 `packages/core`；不改既有 scenario 的判据；不新增产品行为。
- 不运行 live（真实供应商、真实外部 CLI）。
- 不 commit/push；证据只写 `evidence/sessions/` 与基准产物目录。
- 不跑 `npm run test:all`（协调者跑）。

## 完成判据

卡 274 七条验收全部成立；新增命令连续跑两遍结果一致（避免时序抖动）。做不到就说清缺哪类、为什么。
