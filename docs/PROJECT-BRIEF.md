# PROJECT BRIEF — Vessel (Composable Agent Harness)

> Product Evolution Orchestrator — Phase 1 产物。审计 Subagent 只读本文件 + 代码库，无需其它上下文。

## 产品是什么

Vessel（器）— 一个**本地优先、模型无关、可组合、可观察、带硬策略边界**的 Agent Harness（开发框架/运行时）。
不是"开箱即用的聊天应用"，而是**承载 Agent 运行的可组合框架**：Model/Behavior/Context/Tools/Policy/Memory/
Evaluator/Orchestration/Runtime/Surfaces 构成产物公式，其中 **Behavior**（configs/behavior.default.yaml 经
Behavior Compiler 编译进每个 Agent 的 stable system）与 **Policy**（硬边界执法：Prompt Guidance + Tool
Interceptor + Runtime Deny + Audit）是核心抽象。口号：Carry intelligence. Shape behavior. Guard execution.

## 用户是谁

- 主要：开发者/工程师——构建、运行、评估自己的 Agent 流程与 Harness（CLI 为主，Web 为次要表面）。
- 项目由个人维护（"人在两件事：提需求、拍板验收"），单用户使用，但代码追求可交接、可验证。
- 使用真实模型（opencode-go 网关的 deepseek-flash 已设为 lane 默认）跑 benchmarks，也支持 mock 确定性验证。

## 核心任务（用户用 Vessel 做什么）

1. **运行 Agent**：`vessel run --prompt "..."` / 无参 `vessel`（TUI）——带行为 IR + 策略边界的对话/任务执行。
2. **配置供应商**：`vessel provider`（71 个预填供应商 / 自定义端点 / 凭据分级存储：Windows DPAPI 密文、其它平台显式降级明文 / 导出导入 / 多端点测速）。
3. **管理模型与定价**：`vessel pricing`（models.dev 同步 / 用户覆盖 / recompute / costMultiplier）。
4. **统计用量**：`vessel usage`（分日分桶 / 来源分布 / cache 计价）。
5. **测试与基准**：`benchmarks`（L1 确定性场景 + 真实模型 lane + release gates 8 门禁 READY）。
6. **引导与帮助**：`vessel explain|list-terms|guide|settings`（中英双语术语解释 + 设置引导 + 新手引导）。

## 当前成熟阶段

- **高内部成熟度**：1200+ 测试（root 1220 passed + 1 skipped / web 82）、8 release gates READY、RL 协议修复后
  deepseek-flash 真实模型跑通、Windows 锁 flaky 全套治理、克制的分层架构（依赖零环）。
- **低对外成熟度**：CLI 为主、Web 为次要表面（local-server + web 基础 UsageBar）；文档丰富但偏开发者导向；
  面向"开发者构建自用 Harness"为主，非大众产品。用户刚提出**引导/解释体系需求**（即已实现的 117：
  术语中英双语词库 + explain/guide/settings）——对新手是重要改善，但仍可审计覆盖面与体验。

## 已知约束

- **本地优先**：状态/配置/会话在 `~/.vessel/`，不上云；无 Remote Control/Cloud/插件市场/技能注册表/后台调度器
  （路线明确排除）。
- **克制**：不追求 Agent 数量（并行 1-3）；不加几十个 Provider；不做无关重构；不照抄竞品功能（clean-room）。
- **技术栈**：TypeScript + Node ≥20，npm workspaces monorepo（apps/cli, apps/local-server, apps/web, packages/*,
  benchmarks/runners）；Vitest；`tsc -b`；Windows/PowerShell 为主环境。
- **纪律**：删除走回收站；凭据存储**按平台如实分级**——Windows 且 PowerShell/DPAPI 可用 → **DPAPI 密文**
  （`~/.vessel/secrets.json`，绑定当前 Windows 用户）；**其它平台 / DPAPI 不可用 → 显式降级明文**
  （写入时 console.warn；风险等同明文存储，建议改用 `VESSEL_API_KEY` 环境变量或收紧 `~/.vessel` 权限）；
  `providers.json` 自 034 起只存 `secretRef`、不落明文；不读用户本机应用数据；每卡全量 vitest+tsc
  验证后验收；测试隔离（VESSEL_PROVIDER_ROOT/VESSEL_USAGE_ROOT 临时目录）。
- **生产纪律**：CLI/TUI 均为 `apps/cli`；ProviderStore SSOT；行为 IR 双通道（prompt_guidance + runtime_policy）。
- 已知观察：deepseek-flash 成本波动（单轮最高 $0.94）与上下文膨胀（长工具链 run in 1.31M token）；secret
  写入侧弱项（116 记录需 policy 卡）。

## 主要入口

- CLI：`npx tsx apps/cli/src/cli.ts`（run / setup / provider / models / pricing / usage / sessions / resume /
  migrate / review / explain（别名 term）/ list-terms / guide / settings / policy / bench-report / serve / web；
  **没有 `chat` 子命令**——`vessel chat` 返回「未知命令」exit 2）
- TUI：无参 `vessel`（apps/cli/src/tui/chat.ts，支持 /explain、/help、? <term>）
- Web：apps/web（UsageBar）+ apps/local-server（usage SSE）
- 基准：benchmarks/runners（run-release-gates.ts / run-opencode-lane.ts）
- 配置：configs/{behavior.default,policy.default}.yaml、model-catalog.json、pricing.json