# T323 — 值守卫价目修复（P2-1）：核实为已具备

- Status: 已完成（2026-10-26；核实，无需改代码）
- PDW task: none

> 依据：`docs/MAGPIE-ABSORPTION.md` §3 P2-1「值守卫式价目修复」。
> 结论：**该能力已经存在**，与卡 317（CLI 按供应商用量）同属「核实即收口」，不重复实现。

## 1. 证据

| 诉求 | 已有实现 |
|---|---|
| 内置价改了，用户没改过的进用户价 → 跟着更新 | `PricingOverrideStore.repair()`（`apps/cli/src/usage/pricingOverride.ts:500`）按 `{key, from, to}` 比对：当前值 == 旧内置值才应用，返回 `applied` |
| 用户手改过的值不能被覆盖 | 同函数：值不匹配 → `skipped-user-modified`（`providers.json`/override 里用户的手改保留） |
| 用户没有该条 → 不凭空造 | → `skipped-absent` |
| 可被脚本调用 | `vessel pricing override repair --file <repairs.json>`（`apps/cli/src/cli.ts:2436-2478`） |
| 有回归保护 | `apps/cli/src/usage/pricing-override.test.ts:135-154` 覆盖 `applied` 与 `skipped-user-modified` 两条分支 |

## 2. 结论与边界

- 不需要新增代码：三条语义（applied / skipped-user-modified / skipped-absent）与命令入口都在。
- 已知边界（写明，不掩盖）：`repair` 需要调用方提供 `from`（旧内置价）与 `to`（新内置价）；
  没有「自动 diff 两版内置价目并生成 repairs」的命令。若将来要「升级包内价目后一键修复」，
  那是一个新卡，与本卡的「不覆盖用户手改」无关。
- 未跑 `--live`、未改用户 `~/.vessel/pricing.override.json`。

## Result

核实完成，未改代码。证据见上表；`vessel pricing override repair` 与
`skipped-user-modified` 分支均已被既有测试覆盖（`pricing-override.test.ts`）。

- 2026-10-27 补充：真实缺口是没有对比两版内置价目并自动生成 repairs.json 的命令；值守卫已具备。
