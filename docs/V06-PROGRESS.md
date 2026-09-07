# V0.6 执行进度（V06-PROGRESS.md）— 多供应商配置管理 + 模型拉取

> 接力文档：personal-dev-workflow 拆卡（tasks/ 看板 014-018）。
> 目标：docs/PROVIDER-MANAGEMENT.md 待产出；SSOT 在 ~/.dsh/providers.json（沿用项目用户目录约定）。
> 最后更新：2026-09-05（拆卡完成，014 执行中）。

## 0. 基线

- 全量 211 测试绿（provider 层刚加 Anthropic，8 新用例）；`npx tsc -b` exit 0。

## 1. 里程碑状态

| 里程碑 | 任务卡 | 状态 |
|---|---|---|
| SSOT 存储 | tasks/014-provider-ssot.md | 待执行 → 派子代理 |
| models 命令 | tasks/015-models-command.md | 待执行（依赖 014） |
| provider 命令组 | tasks/016-provider-commands.md | 待执行（依赖 014） |
| run 默认 + TaskRouter/pricing | tasks/017-run-default-wiring.md | 待执行（依赖 014-016） |
| 收尾（文档 + 验证） | tasks/018-provider-mgmt-closeout.md | 待执行（依赖 014-017） |

## 2. 决策/教训

- SSOT 用 `~/.dsh/providers.json`（项目 memory/skills 已用 ~/.dsh，不另造 ~/.cah）。
- apiKey 本地明文（与 cc-switch 同），文档注明风险，不做加密（YAGNI）。
