# CC-SWITCH 改进批次进度（CC-SWITCH-IMPROVEMENTS-PROGRESS.md）

> 依据：docs/ideas/CC-SWITCH-MODULE-STUDY.md（cc-switch v3.20.2 三模块源码对比报告，提交 f90a6b4）
> 目的：把报告 §6 的 12 张候选卡（085-096）逐张落地，进度落盘可续跑。

## 已完成（验收合入）

| 卡 | 内容 | 提交 | 复核基线 |
|---|---|---|---|
| 085 | 计价正确性 P0：模型名归一（命中 25%→81%）+ 缺价显式化（source/estimated + --strict）+ 统一计价（UsageProjection 复用 resolvePrice + parity 测试）+ ProviderStore 文案纠偏 | 8d57521 | 960 测试 + tsc 17/17 |
| 098 | 修复 `tsc -b` TS5055 类型环：provider SSOT 下沉 packages/application，runners 改依赖 application，cli 补单向 reference | ea67f38 | `tsc -b` 与 `--force` 双 exit 0 |
| 097 | 移除本机 CC Switch 应用数据依赖：删 ccSwitchCredential，新增 opencodeGoCredential（env + CredentialStore），含源码树守卫测试 | 6be5527 | 957 测试 + grep 0 命中 |
| 089 | 统计增强：daily 本地日分桶（complete=date<今日）+ `--by-day/--since/--until` + cache_creation 计价（explicit/derived/absent 三档） | cdf1374 | 980 测试 + tsc 0 |
| 099 | cache_creation 端到端采集：AnthropicProvider 非流式 + parseAnthropic 流式 message_start → ChatUsage.cacheCreationTokens → AgentLoop 折叠 → 统计分项（core 仅 1 行） | 69502c5 | 994 测试 + tsc 0 |
| 100 | 定价管理：`vessel usage recompute`（幂等 + dry-run）+ `~/.vessel/pricing.override.json`（覆盖 + 墓碑 + 值守卫 repair）；优先级 override>内置>catalog>protocol>default | ecf422a | 1038 测试 + tsc 0 |
| 101 | P2：models.dev 价目同步（离线语义硬：不改文件 + exit 1）+ provider 成本倍率（只乘总额 + fail loud） | f276724 | 针对性 193 + tsc 0 |
| 102 | **真实模型跑通**：opencode-go 协议修正（x-opencode-session + 具名 UA + 错误分类 + 路径分流）+ mimo-v2.5 真实跑 082 lane/084 gate | 5af2dfc | 1082 测试 + tsc 0 |
| 103 | CLI/TUI 侧协议适配（方案 A：协议上提 packages/llm 作 SSOT，lane 485 行重复删除；providerFactory 唯一构造路径；顺带修 `--provider <id>` 缺陷） | afac81a | 1102 测试 + tsc 0 |
| 104 | P2：供应商导出**默认脱敏+自检** / 导入合并 / 备份轮转零删除 / 多端点测速（建议不改默认） | 812a382 | 1148 测试 + tsc 0 |
| 105 | 用户 key 入库（DPAPI 密文，`same=true`）+ **`vessel run` 真实成功**（ping→pong，无 400/401，usage 3265/37） | e064209 | 1147 测试 + tsc 0 |
| 106 | chat 凭据（defaultStore 唯一工厂 + resolveChatStore）+ 测试隔离（临时 root + 3 新用例）+ process-tree 超时 120s | 0c6175a | **1152 测试 + 0 failed** + web 74 |
| 107 | cache_creation 展示层：local-server SSE usage 帧 + web UsageBar 渲染 `cache 读 X / 写 Y`（derived 提示） | d5fba0a | **1153 测试** + web 82 |

## 进行中 / 待做

| 卡 | 内容 | 优先级 | 备注 |
| — | mimo-v2.5 长工具链收敛不稳定（finalText 空 + 工具到 64 步）→ 调整场景集/判据或接受为模型特性 | P1 | 102 记录；**需用户决策** |

## 暂不做（P3，报告结论）

- 明细/汇总双层 + 剪枝、双数据源去重账本、`pricing_model ≠ model` 双列——规模未到，事件溯源可重算。

## 我们优于 cc-switch 的（保持，勿退回）

DPAPI 加密 + secretRef（它明文落库）、providers.json SSOT 可 diff、厂商级预设不收长尾、热生效无需重启、事件溯源可重算。

## 纪律

- 一卡一执行器（串行，并发≤2）；每卡验收需指挥独立复核（全量 vitest + `tsc -b`）。
- 删除走回收站；不读用户本机应用数据（097 守卫测试会拦）；密钥不落盘。
- 已知 flaky（非回归）：process-tree 时序（全量并发偶发 30s 超时，隔离绿）、rename EPERM（Windows 杀软锁，已有界重试）。
