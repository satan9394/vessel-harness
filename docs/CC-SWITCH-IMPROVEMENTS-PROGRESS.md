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

## 待做（按报告优先级）

| 卡 | 内容 | 优先级 | 备注 |
|---|---|---|---|
| — | cache_creation 展示层（apps/web UsageBar + local-server usage SSE 仍只 cacheRead） | P2 | 099 记录的后续 |
| 093 | models.dev 同步 `vessel pricing sync`（拉取生成/更新 model-catalog，离线回退） | P2 | |
| 094 | provider 成本倍率 `costMultiplier`（只乘总额） | P2 | |
| 095 | 供应商导入导出 + 备份轮转（导出默认脱敏，key 走 secretRef 占位） | P2 | |
| 096 | 多端点 + 测速 `ProviderConfig.endpoints[]` | P2 | |

## 暂不做（P3，报告结论）

- 明细/汇总双层 + 剪枝、双数据源去重账本、`pricing_model ≠ model` 双列——规模未到，事件溯源可重算。

## 我们优于 cc-switch 的（保持，勿退回）

DPAPI 加密 + secretRef（它明文落库）、providers.json SSOT 可 diff、厂商级预设不收长尾、热生效无需重启、事件溯源可重算。

## 纪律

- 一卡一执行器（串行，并发≤2）；每卡验收需指挥独立复核（全量 vitest + `tsc -b`）。
- 删除走回收站；不读用户本机应用数据（097 守卫测试会拦）；密钥不落盘。
- 已知 flaky（非回归）：process-tree 时序（全量并发偶发 30s 超时，隔离绿）、rename EPERM（Windows 杀软锁，已有界重试）。
