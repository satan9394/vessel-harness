# V0.6 执行进度（V06-PROGRESS.md）— 多供应商配置管理 + 模型拉取

> 接力文档：personal-dev-workflow 拆卡（tasks/ 看板 014-018）。
> 目标：docs/PROVIDER-MANAGEMENT.md（已完成）；SSOT 在 ~/.dsh/providers.json。
> 最后更新：2026-09-05（**V0.6 全部完成**）。

## 0. 基线

- 全量 250 测试绿；`npx tsc -b` exit 0。
- git：3544f0f（SSOT+modelFetcher）/ 1314e41（provider/models 命令 + run 默认）/ d759f3a（pricing）。

## 1. 里程碑状态

| 里程碑 | 任务卡 | 状态 |
|---|---|---|
| SSOT 存储 | tasks/014-provider-ssot.md | 已合入 3544f0f（子代理 fc45d942，21 测试，抓到 remove-current 复位 bug） |
| models 命令 | tasks/015-models-command.md | 已合入 3544f0f + 1314e41 |
| provider 命令组 | tasks/016-provider-commands.md | 已合入 1314e41（cli +6 测试） |
| run 默认 + TaskRouter/pricing | tasks/017-run-default-wiring.md | 已合入 1314e41 + d759f3a（pricing v0.2 +6 测试） |
| 收尾（文档 + 验证） | tasks/018-provider-mgmt-closeout.md | 完成（PROVIDER-MANAGEMENT.md + 真实冒烟通过） |

## 2. 决策/教训

- SSOT 用 `~/.dsh/providers.json`（沿用项目约定）；apiKey 明文 + 文档标注风险（YAGNI 不加密）。
- 测试隔离：`CAH_PROVIDER_ROOT` 环境变量改存储根（CLI 测试不碰真实 ~/.dsh）。
- run 的供应商解析：显式 flags > 环境变量 > current 默认 > mock 兜底（显式永远优先）。
- 真实冒烟验证：provider add/switch/list + models（401 清晰报错 + anthropic 内置清单）全通。
