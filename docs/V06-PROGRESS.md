# V0.6 执行进度（V06-PROGRESS.md）— 多供应商配置管理 + 模型拉取 + 交互向导

> 接力文档：personal-dev-workflow 拆卡（tasks/ 看板 014-019）。

> ⚠ 历史快照（V0.9 改名后）：文内 cah / CAH_* / @cah 为当时名称，现已迁移为 vessel / VESSEL_* / @vessel（见 docs/VESSEL.md）。
> 目标：docs/PROVIDER-MANAGEMENT.md + docs/ideas/PROVIDER-UX-RESEARCH.md；SSOT 在 ~/.dsh/providers.json。

> ⚠ 历史快照（V0.9 改名后）：文内 cah / CAH_* / @cah 为当时名称，现已迁移为 vessel / VESSEL_* / @vessel（见 docs/VESSEL.md）。
> 最后更新：2026-09-05（**V0.6 + cah setup 全部完成**）。

> ⚠ 历史快照（V0.9 改名后）：文内 cah / CAH_* / @cah 为当时名称，现已迁移为 vessel / VESSEL_* / @vessel（见 docs/VESSEL.md）。

## 0. 基线

- 全量 258 测试绿；`npx tsc -b` exit 0。
- git：3544f0f（SSOT+modelFetcher）/ 1314e41（provider/models 命令 + run 默认）/ d759f3a（pricing）/ faf909e（UX 调研报告）/ e92d5a0（setup 骨架 WIP）/ dc8ba68（setup 按规格升级）。

## 1. 里程碑状态

| 里程碑 | 任务卡 | 状态 |
|---|---|---|
| SSOT 存储 | tasks/014-provider-ssot.md | 已合入 3544f0f（子代理 fc45d942，21 测试） |
| models 命令 | tasks/015-models-command.md | 已合入 3544f0f + 1314e41 |
| provider 命令组 | tasks/016-provider-commands.md | 已合入 1314e41 |
| run 默认 + TaskRouter/pricing | tasks/017-run-default-wiring.md | 已合入 1314e41 + d759f3a |
| 收尾（文档） | tasks/018-provider-mgmt-closeout.md | 已合入（PROVIDER-MANAGEMENT.md） |
| cah setup 交互向导 | tasks/019-setup-wizard.md | 已合入 dc8ba68（调研规格五处升级，8 测试） |

## 2. 决策/教训

- SSOT `~/.dsh/providers.json`；apiKey 明文标注风险；CAH_PROVIDER_ROOT 隔离。
- 交互向导按 docs/ideas/PROVIDER-UX-RESEARCH.md 规格（调研 opencode/Pi/cc-switch）：autocomplete 搜索选供应商、key 幂等跳步、模型拉取错误阶梯（401 重试≤3 / 404 转手动）、终屏汇总、~/.dsh 作用域明示。
- 教训：实现子代理（baae4cf5）8 分钟零产出被中断 → 指挥按规格直接实现（延续教训 1/7）；调研子代理（6f2ac0d4）成功交付 13 章报告。

