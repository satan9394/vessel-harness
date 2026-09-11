# CAPABILITY-MATRIX — Vessel 竞品能力矩阵（独立竞品研究）

> 产出：COMPETITOR_RESEARCHER 独立审计（只读 PROJECT-BRIEF.md + 代码库，不读其它审计报告）。
> 日期：2026-09 中旬。方法：官方 docs / GitHub README / Release Notes 为主（web_fetch 直连 HTTP 200
> 抓取，见文末来源表）；内置 web_search 因 DeepSeek API key 失效（HTTP 401）不可用，未尝试代理 7897
> （直连成功即无需代理）。个别细节未现场取证的条目标注「公开知识」。
> 用途：给 Vessel（本地优先、克制、开发者自用的可组合 Agent Harness）做能力定位与差距取舍，不是"抄功能清单"。

---

## 0. 产品类别判断

Vessel 属于：**开发者向的 CLI Agent Harness / Agent 运行时**（可组合框架），而非"AI 编码助手产品"。
它同时具备三类产品的部分特征：像 OpenCode/Claude Code 一样有 CLI+TUI 执行面；像 Cline SDK / Codex
（OXOS）一样暴露程序化组合面（monorepo packages + compose 组合根）；像 Aider 一样重视"评估与验证"
（L1 确定性场景 + 真实模型 lane + release gates）。但与所有竞品的关键区别是：**行为层与边界层被抽象成
一等制品（Behavior IR + Policy 编译四伪物），并被一套独立于竞品实现的 conformance 思路证明**。

因此竞品选取以"CLI Agent（运行时）"为主轴：OpenCode（最接近的形态参照）、Claude Code（生态与扩展参照）、
OpenAI Codex CLI（本地优先 + 安全沙箱参照）、Gemini CLI（免费模型 + 多模态参照）、Aider（评估/编排风格参照）、
Cline（SDK/多表面收敛参照）、OpenHands（控制中心/多 agent 编排参照）、Continue（停维护样本参照）。
IDE 扩展型（Roo Code 已停服、Cursor CLI 闭源）不入主矩阵，仅在市场信号章节提及。

## 1. 竞品清单

| 产品 | 定位一句话 | 开放度 | 形态 | 最新状态（2026-09） |
|---|---|---|---|---|
| **OpenCode**（Anomaly 运维，原 SST） | 开源 AI 编码 agent，终端优先，多表面 | 开源 Apache-2.0 | TUI/CLI/Web/IDE/桌面 | 活跃迭代；v2 重写后 providers/plugins/SDK 全齐 |
| **Claude Code**（Anthropic） | 终端/IDE/GitHub 全场景 agentic 编码工具 | 闭源核心（仓库为分发+插件） | CLI + IDE + Web + mobile + 云 | 活跃；Agent SDK、Remote Control、插件市场 |
| **OpenAI Codex CLI** | OpenAI 的本地运行编码 agent | 开源 Apache-2.0 | CLI/TUI + App + IDE 扩展 | 活跃；并入 OXOS 运行时方向 |
| **Gemini CLI**（Google） | 终端直连 Gemini 的轻量 agent | 开源 Apache-2.0 | CLI（+VS Code 伴生） | 活跃；每周预览/稳定双轨发布 |
| **Aider**（Paul Gauthier） | 终端结对编程（pair programming） | 开源 Apache-2.0 | CLI（无 TUI）+ watch | 活跃；6.8M 安装，自身 benchmark 传统 |
| **Cline** | IDE + 终端 + 桌面 + SDK 的编码 agent 家族 | 开源 Apache-2.0 | VS Code/JetBrains/CLI/桌面/SDK | 活跃；收敛到共享 agent core + @cline/sdk |
| **OpenHands（Agent Canvas）** | 自托管"多编码 agent 控制中心"（ACP 客户端） | 开源（多仓） | Web 控制台 + Agent Server REST | 转型后主推 Agent Canvas / automation |
| **Continue** | 早期开源编码 agent（CLI/IDE） | 开源 Apache-2.0 | CLI + VS Code + JetBrains | **已停维护**（仓库 read-only，终版 2.0.0） |

## 2. 能力矩阵主表

符号：● 有（证据完整）｜◐ 部分/有缺口｜○ 无/明确不做。「公开知识」= 未现场取证。逐维证据见 §3。

| # | 能力维度 | Vessel | OpenCode | Claude Code | Codex CLI | Gemini CLI | Aider | Cline | OpenHands | Continue¹ |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 安装/分发（一键装、多平台） | ◐ | ● | ● | ● | ● | ● | ● | ● | ● |
| 2 | 入门引导（init/quickstart） | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| 3 | 配置供应商（多供应商/自定义端点） | ● | ● | ◐ | ◐ | ○ | ● | ● | ◐ | ● |
| 4 | 模型切换（会话内选择/过滤） | ● | ● | ◐ | ● | ◐ | ● | ● | ● | ● |
| 5 | 定价成本管理（价格库/覆盖/重算） | ● | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ○ | ◐ |
| 6 | 用量统计（持久化/分日/来源） | ● | ◐ | ● | ◐ | ◐ | ○ | ◐ | ◐ | ○ |
| 7 | 引导帮助（内建术语/解释/向导） | ● | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |
| 8 | 多语言（locale） | ● | ◐ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| 9 | 主题 | ● | ● | ◐ | ○ | ○ | ○ | ○ | ○ | ○ |
| 10 | 策略安全（硬执法/权限/沙箱） | ● | ◐ | ● | ● | ◐ | ○ | ◐ | ◐ | ◐ |
| 11 | 会话续跑（resume/checkpoint） | ○ | ● | ● | ● | ● | ● | ● | ● | ● |
| 12 | Git 工作流（commit/undo/隔离） | ◐ | ● | ● | ● | ◐ | ● | ◐ | ◐ | ● |
| 13 | Headless 脚本输出（JSON/CI） | ◐ | ● | ● | ● | ● | ● | ● | ● | ● |
| 14 | MCP 扩展 | ◐ | ● | ● | ● | ● | ○² | ● | ◐ | ◐ |
| 15 | 插件/扩展 API（SDK/hooks/市场） | ◐ | ● | ● | ◐ | ◐ | ○ | ● | ● | ◐ |
| 16 | 子代理/团队编排 | ● | ◐ | ● | ● | ○ | ◐ | ● | ● | ◐ |
| 17 | 评估基准（自研判据/harness） | ● | ○ | ○ | ○ | ○ | ● | ○ | ◐ | ○ |
| 18 | 可观察性（遥测/审计/面板） | ◐ | ◐ | ◐ | ◐ | ◐ | ○ | ◐ | ● | ◐ |
| 19 | 协作多人（分享/团队/消息平台） | ○ | ◐ | ◐ | ◐ | ◐ | ○ | ● | ● | ○ |
| 20 | 云/远程/托管 | ○ | ◐ | ● | ● | ◐ | ○ | ○ | ● | ○ |
| 21 | IDE/Web 辅表面 | ◐ | ● | ● | ● | ◐ | ◐ | ● | ● | ◐ |
| 22 | 数据隐私（本地优先/无强制遥测） | ● | ◐ | ◐ | ◐ | ◐ | ● | ● | ● | ◐ |

¹ Continue 已停维护，其行仅作"停摆产品的能力快照"，不作为追赶依据。
² Aider 的 MCP 支持状态未现场核实（公开知识存疑），按 ○ 计并注明。

## 3. 能力维度证据（逐维：Vessel 证据 / 竞品代表证据 / 来源）

### 1 安装/分发
- Vessel：◐。仓库内 `npx tsx apps/cli/src/cli.ts` / `npm run vessel` 运行；无对外发布渠道（无 npm 包发行、无安装脚本）。这是"自用工具"的正当形态，但确实不是产品级分发。
- 竞品：全部提供 `curl | sh` / npm / brew / scoop / winget / Docker 之一（OpenCode 全平台 + 桌面 App；Codex 有 npm/cask/独立二进制；Gemini npx/npm/brew/conda；Aider pip/pipx）。
- 来源：OpenCode README；Codex README；Gemini README；Aider README。

### 2 入门引导
- Vessel：●。`vessel guide`（分步新手引导，输出语言跟随 locale）、`vessel explain|list-terms`（中英双语术语库）、`vessel settings` 引导、`run --help` 全命令中文说明；TUI 内 `/help`、`/explain`、`? <term>`。同类竞品没有"内建术语解释+双语向导"。
- 竞品：文档外置为主（OpenCode `/init` 生成 AGENTS.md + docs；Claude Code quickstart + `/help`；Codex/Gemini 靠 docs）。OpenCode 的 `/init`（让 agent 分析项目生成 AGENTS.md）是 Vessel 没有的 **agent 驱动的项目初始化**，归入 §4 缺项。
- 来源：PROJECT-BRIEF §核心任务 6；`apps/cli/src/guide/`；app 帮助文本 `apps/cli/src/cli.ts`。

### 3 配置供应商
- Vessel：●。71 个预填供应商 + 自定义端点（`provider add --base-url`）+ 多候选端点与管理（`provider endpoint list/add/remove/test`，最小探测 + 自动建议默认）+ 凭据 DPAPI 加密存储 + 导出/导入（脱敏、合并策略、备份轮换）+ 多协议（openai-compatible/anthropic/mock）。`provider setup` 交互向导（搜索供应商→输 key→拉模型→勾选提交）。
- 竞品：OpenCode 靠 models.dev + AI SDK 支持 75+ 供应商（`/connect` 存 `~/.local/share/opencode/auth.json`，明文 key，无本地加密、无端点测速、无导出导入）；Codex 靠 config.toml `model_provider`（baseURL/wire_api/env_key），无向导无测速；Claude Code 绑定 Anthropic（企业可 Bedrock/Vertex），自定义端点能力弱；Gemini 只支持 Gemini 系。
- 结论：**供应商管理纵深（加密、测速、迁移、多端点）Vessel 领先全部竞品**；但"广度"（71 vs OpenCode 75+）无意义差距。
- 来源：`apps/cli/src/providers/`（ProviderStore/defaultStore/endpointProbe/providerTransfer/setup）；OpenCode providers 页；Codex README + docs（config 跳转链接）。

### 4 模型切换
- Vessel：●。`vessel models [--provider]`（OpenAI 兼容实时拉取 / Anthropic 内置清单）、`vessel run --model`、`pricing override` 支持 `provider::model` 粒度覆盖；provider 级默认模型。
- 竞品：均有会话内/命令行选模型（OpenCode `/models` + blacklist/whitelist；Codex `--model` + profiles；Aider `--model` 别名；Claude Code `/model` 限生态内；Gemini `-m` 限 Gemini 系）。
- 证据与结论同 §3.3：Vessel 宽度略小、管理粒度更强。来源：`apps/cli/src/providers/modelCatalog.ts`；OpenCode providers 页。

### 5 定价成本管理
- Vessel：●。`vessel pricing`（models.dev 同步，带超时/重试/失败保旧表）→ `pricing override`（用户覆盖/墓碑/值守卫 repair）→ `usage recompute`（按当前价目幂等重算历史成本）→ `costMultiplier`（token 价×倍率）。**持久化的本地价格库 + 覆盖 + 历史重算，7 个竞品均无**（它们只有会话级成本显示）。
- 竞品：OpenCode 无价格管理（Zen/Go 是自营计费网关）；Claude Code `/cost` + 用量后台（会话级 + 官方 dashboard）；Codex 会话 usage 摘要；Gemini 免费额度+计费页；Aider/Cline 会话成本估算；OpenHands 无。
- 结论：这是 Vessel 实实在在领先的维度（对"开发者自用、看住成本"定位正中）。
- 来源：`apps/cli/src/providers/pricing*.ts`、`apps/cli/src/usage/recompute*`；PROJECT-BRIEF §已知约束（deepseek-flash 单轮 $0.94 波动即此功能要解决的问题）。

### 6 用量统计
- Vessel：●。`vessel usage [--recent/--since/--until/--by-day/--strict]`，分日分桶、来源分布、cache 计价（cache-read/write 分项）、`--strict` 按不用兜底价重算；UsageStore 持久化。
- 竞品：Claude Code 有官方用量后台（含团队管理页）；Codex/Gemini 会话级展示，无本地持久统计；OpenCode 无；Aider 无（首页 banner 的每周 token 是聚合营销数字）；Cline 会话成本视图。
- 来源：`apps/cli/src/usage/UsageStore.ts`；Claude Code docs（公开知识：/usage 与用量 dashboard）。

### 7 引导帮助
- Vessel：●（见 §3.2）。竞品全部是"docs 外置 + 社区问答"，无内建双语术语/解释体系。
- 来源：`apps/cli/src/guide/glossary.ts`、`guide.ts`、`settings.ts`。

### 8 多语言
- Vessel：●。locale zh/en，影响 guide/explain/settings 输出；TUI 中文交互；帮助文本中文为主。
- 竞品：OpenCode 文档 21+ 语言翻译但产品 UI 无 locale 切换；其余产品无 UI 多语言。
- 结论：Vessel 的 zh/en 双语定位服务中文开发者自用，已超出竞品；**扩到更多语言不值得**（见 §6-6）。

### 9 主题
- Vessel：●。`settings set theme dark|light`。
- 竞品：OpenCode 有主题系统（内置+自定义）；Claude Code 有输出样式/状态栏定制（公开知识）；其余无。
- 结论：不是差异化点，够用即可。来源：`apps/cli/src/guide/settings.ts`。

### 10 策略安全
- **Vessel：● 且机制独有**。`configs/policy.default.yaml` 单源编译出四伪物：Prompt Guidance（软引导）+ Tool Interceptor（工具层拦截）+ Runtime Deny（运行时拒绝）+ Audit Event（审计事件）；filesystem 保护/deny_read、shell deny + scoped_rules、git force_push deny、network deny_domains、tools deny/rules；三档权限 profile（read-only/workspace-write/danger-full-access）；audit 事件落地。**竞品没有"编译型策略 IR"概念**。
- 竞品侧重点不同：Codex 用 OS 沙箱（macOS Seatbelt / Linux Landlock）+ approve 模式（auto-edit / full-auto / on-failure-tool-call）+ execpolicy（公开知识）；Claude Code 用权限模式（plan/acceptEdits/bypassPermissions）+ bash 沙箱（Seatbelt/Landlock）+ 企业托管 hook（requirements.toml）；OpenCode 用 permissions（工具级 allow/deny）+ experimental policies（`provider.use` 资源级）；Gemini 用 trusted folders + bubblewrap；Aider 无（靠 git 回滚）。
- 结论：方向不同——Vessel 是"声明式策略硬执法"，竞品是"审批 + OS 沙箱"。**OS 沙箱是 Vessel 缺的（见 §6-5），审批 UI 是路线明示未来项**（policy.default.yaml 注释 `approval: never`）。
- 来源：`configs/policy.default.yaml`；POLICY-SPEC（仓库文档）；OpenCode policies 页；Codex docs/sandbox.md 与 docs/config.md；Claude Code docs（settings 导航）+ 公开知识。

### 11 会话续跑
- Vessel：○。`--session-dir` 只落单次 run 的会话日志（`<workspace>/.harness/sessions/<id>`），无"列举历史会话、恢复续跑"的交互路径。
- 竞品：全有。OpenCode `--continue/--resume`（公开知识 + session 管理）；Claude Code `--resume/--continue` + sessions 管理；Codex `codex resume`；Gemini checkpointing（README 明确）；Aider `--restore-chat-history`；Cline team state 跨会话持久；OpenHands conversations 持久。
- 这是 §6-1 分析的最大缺口。

### 12 Git 工作流
- Vessel：◐。引擎层有 `git worktree add/remove` 隔离（`packages/engine/src/workspace.ts`、`packages/tools/src/git/Worktree.ts`，用于子代理/重试的隔离执行面，dispose 平衡、防泄漏）——但这是**隔离机制**，不是用户可感知的"AI 改完自动 commit / /undo 回滚"。
- 竞品：Aider 自动 commit（每次修改即提交、可 diff/undo，cwd 上它就是产品核心）；OpenCode `/undo` `/redo` + git 工具；Claude Code 内建 git 操作与 checkout；Codex apply_patch + undo/rewind；Cline checkpoints。
- 结论：Vessel 的 worktree 隔离其实比竞品的"当场改当场 commit"更干净（真隔离），但缺少**会话级快照/回滚的面向用户出口**（见 §6-4）。

### 13 Headless 脚本输出
- Vessel：◐。有确定性输出通道：`run --bench <id>` 产 JSONL 报告、`bench-report` 聚合输出 md/json、`serve`/`web` 有 usage SSE；**但通用 `vessel run` 没有 `--json|--output-format` 结构化契约**，无法直接进 CI/管道消费。
- 竞品：Claude Code `-p` + `--output-format json/stream-json`；Codex `exec --json`；Gemini `-p --output-format json|stream-json`（README 明确）；Aider `-m`；Cline CLI `--json`（README 明确）；OpenHands Agent Server REST。
- 见 §6-3。

### 14 MCP 扩展
- Vessel：◐。**库级完整**：`packages/tools/src/mcp/`（McpClient stdio 传输、tools/list + tools/call、动态注册 `mcp__<server>__<tool>`、policy deny 可按工具名精确拦截）、compose 组合根可注入 MCP 连接；**但 CLI 面没有 `vessel mcp` 配置命令**（grep apps/cli 无 mcp 引用），用户只能编程接入。
- 竞品：OpenCode/Claude Code/Codex/Gemini/Cline 均有一等 MCP 配置入口（`cline mcp`、config 声明等）。
- 结论：管道已通、缺 CLI 出口。见 §6-2 的"值得做（低成本）"判断。

### 15 插件/扩展 API
- Vessel：◐。组合面强：monorepo packages（core/llm/behavior/context/tools/policy/runtime/memory/skills/agents/telemetry/engine/application）+ `compose.ts` 组合根（MCP/子代理/workspace 等全可注入），等于"框架即库"；但**无对外 SDK 文档、无插件 API、无市场**。
- 竞品：OpenCode SDK + server + plugins（TS API）；Claude Code plugins + marketplace + hooks + Agent SDK + skills；Cline `@cline/sdk`（createTool/Agent/生命周期 hook，README 示例）；Codex skills/slash/hooks（无市场）；Gemini extensions/custom commands。
- 见 §6-7（不适合对外做，但可以补组合文档）。

### 16 子代理/团队编排
- Vessel：●。SubagentManager（并发上限 1–3、深度限制、`Subagent` 工具）+ git worktree 隔离 + ParallelScheduler（只读并行探索，读写分族）+ TeamRuntime（orchestrator/generator/evaluator 阵容、team_phase/subagent_start/stop 事件）+ 角色预置（lead=orchestrator / developer=generator / reviewer=evaluator，写/只读面分离）。**"编排即评估"是竞品没有的（generator 不得自证完成）。**
- 竞品：Claude Code subagents + Task；Codex workflows（research→implement→review，公开知识）；Cline multi-agent teams（coordinator 拆解 + 持久 team state）；OpenCode general subagent + build/plan；Gemini 无；Aider architect/editor 双模型。
- 来源：`packages/agents/src/`、`packages/engine/src/loop-engine.ts`、`packages/tools/src/registry/parallel.ts`。

### 17 评估基准
- Vessel：●。L1 确定性场景（判据 yaml 单一事实源 + mock provider）+ 真实模型 lane（deepseek-flash 已跑通）+ 8 release gates + Generator/Evaluator 独立 + bench-report 看板。**这是把"评测"当作产品一等公民**。
- 竞品：Aider 有自身 benchmark/leaderboards（polyglot 等，评测对象是模型/工具，不是 harness）；OpenHands 曾有评估集；OpenCode/Claude Code/Codex/Gemini/Cline/Continue 均无官方 harness。
- 结论：Vessel 的差异化核心之一，且与其"可验证"定位强绑定（见 §4-3、§6-8）。

### 18 可观察性
- Vessel：◐。Telemetry 包（metrics 报告：M 系列计数器、evaluatorRejects、compactions、cache tokens 等）+ policy audit 事件（decision/denial/approval）+ usage 库 + web UsageBar（SSE）+ bench-report 摘要表。**缺：会话级 trace/时间线视图、无面板**（web 只是 UsageBar）。
- 竞品：OpenHands 有 run history/控制中心 UI；Claude Code transcripts + /status；Codex transcripts + debug；OpenCode session 日志 + /doctor（公开知识）；Aider 无。
- 见 §6-9。

### 19 协作多人
- Vessel：○。`vessel review` 是**评审交接单**（`.vessel/reviews/<id>/handoff.md` 生成、外部结果导入落库）——这是"人与外部评审者协作"的单向交接，不是实时多人/分享。路线明确排除多用户。
- 竞品：OpenCode `/share` 生成会话链接（只读分享）；Claude Code GitHub `@claude` + Slack + Remote Control（企业）= 团队入口 + 云；Codex Codex Cloud（远程 agent，公开知识）；Gemini GitHub Action（`@gemini-cli` in issues/PR）；Cline 消息平台接入（Telegram/Slack/Discord/WhatsApp）+ 权限控制；OpenHands 本身就是团队控制中心。
- 结论：Vessel 不做是设计决定（§6-10），`review handoff` 是"在单人约束下获得第二双眼睛"的克制解，值得保留。

### 20 云/远程/托管
- Vessel：○（路线明确排除）。竞品：Claude Code（Remote Control、云沙箱、手机/浏览器）、Codex（Codex Web/Cloud + OXOS）、OpenHands（Cloud/Enterprise 商业版）、Gemini（Vertex 企业）、OpenCode（Zen/Go 仅模型网关）。
- 结论：见 §6-10（不做，理由充分）。

### 21 IDE/Web 辅表面
- Vessel：◐。`serve`/`web` 本地服务 + UsageBar（用量可视化），无 IDE 插件、无桌面。竞品：Claude Code/Codex/Cline/OpenCode 都有 IDE 集成；OpenHands 是 Web 控制台。
- 结论：对"CLI 为主、Web 为次要表面"的定位，当前覆盖合理；IDE 插件不值得（§6-11）。

### 22 数据隐私
- Vessel：●。本地优先（`~/.vessel/`），无遥测外发（telemetry 为本地 metrics），凭据 DPAPI 加密，导出脱敏（secretRef 占位）。竞品：Claude Code 反馈数据收集默认开启（有文档与隐私条款）；Codex telemetry 可关（公开知识）；Gemini telemetry 默认匿名（公开知识）；OpenCode 本地存 key（明文 auth.json，但无强制遥测）；Aider/Cline/OpenHands 开源本地、无强制遥测。
- 结论：Vessel 与 Aider/Cline/OpenHands 同属"本地优先"阵营，且凭据加密这一项更强（不是明文 token 文件）。

---

## 4. 能力分类

### 4.1 行业基础能力（没有就不算"CLI agent harness"）
安装/分发（有缺口：无发行渠道）、入门引导、配置供应商、模型切换、会话日志、基础权限控制、帮助/文档、run/chat 双模式、核心工具面（文件/搜索/shell）。
**Vessel 覆盖情况**：除"对外发行渠道"外全绿；"安装"一项是自用形态的合法取舍（见 §6-1）。

### 4.2 行业常见能力（多数竞品有，Vessel 部分有或全有）
主题、多语言（zh/en）、headless 结构化输出（部分）、MCP（库级有/CLI 无）、子代理/团队、Git 相关能力（隔离有/用户工作流缺）、会话续跑（缺）、沙箱（策略硬执法有/OS 沙箱缺）、IDE/Web 辅表面（部分）、可观察性（部分）、成本与用量（**Vessel 全有且更强**）。
→ 这一类是本次审计的主要差距来源，逐条在 §6 论证取舍。

### 4.3 差异化能力（Vessel 独有或领先）
| 能力 | 证据（仓库内） | 竞品对照 |
|---|---|---|
| **Behavior IR + Behavior Compiler**：behavior.default.yaml 编译进每个 agent 的 stable system，双通道（prompt_guidance + runtime_policy），未收录策略引用会告警 | `configs/behavior.default.yaml`、packages/behavior | 竞品是"隐含 prompt + AGENTS.md/CLAUDE.md 规则文件"，无编译型行为层 |
| **Policy 硬执法四伪物**：单源 YAML → Prompt Guidance + Tool Interceptor + Runtime Deny + Audit Event；MCP 工具也受同一策略流约束（按 `mcp__<server>__<tool>` 精确 deny） | `configs/policy.default.yaml`、packages/policy、packages/tools/src/mcp/mcp.test.ts | 竞品分别是审批 UI（Claude Code/Cline）、OS 沙箱（Codex）、permissions+policies（OpenCode 的 policies 仍标 experimental）；无"编译+审计"策略引擎 |
| **Generator/Evaluator 分离 + 独立评审交接**：evaluator 只读评审面（write:false 守卫）、generator 不得自证完成、`vessel review handoff/import` 交接单 | packages/engine（real-evaluator-adapter、loop-engine）、apps/cli/src/review | 竞品无评估器抽象（OpenCode/Codex 有 reviewer 角色子代理但无判据驱动循环；无交接单机制） |
| **确定性 + 真实双 lane 基准与 release gates**：L1 确定性场景（mock）+ 真实模型 lane + 8 门禁 | benchmarks/（scenarios 判据 yaml、runners） | 只有 Aider 重视评测，但评测对象不同（模型/工具 vs harness 行为）；无 release-gate 式门禁 |
| **供应商管理纵深**：71 预填 + 端点最小探测测速 + 自动建议 + DPAPI 凭据加密 + 脱敏导出/合并导入/备份轮换 | apps/cli/src/providers/ | 竞品均无此组合（OpenCode 明文 auth.json、Codex 手改 config.toml） |
| **本地价格库 + 覆盖 + 历史重算**：models.dev 同步 + override（含值守卫 repair）+ usage recompute 幂等 | apps/cli/src/providers/pricing*.ts、usage/pricingOverride.ts、recompute | 7 个竞品均无持久成本库（只有会话级估算） |
| **中英双语引导体系**：术语词库 + explain/guide/settings | apps/cli/src/guide/ | 竞品无（docs 翻译 ≠ 产品内引导） |
| **跨 harness conformance 思路**（仓库文档：OPENCODE-ADAPTER / CODEX-ADAPTER / CLAUDE-CODE-ADAPTER / DSH-ADAPTER / PI-ADAPTER） | docs/*-ADAPTER.md | 竞品没有"证明行为层可替换"的测试思路（OpenHands 的 ACP 是互操作协议，不是 conformance 套件） |

### 4.4 当前项目缺失能力（缺口清单，逐条论证见 §6）
1. 会话续跑（resume/continue）
2. CLI 面 MCP 配置入口（库优于 CLI）
3. 通用 Headless JSON 输出契约
4. 会话级 Git 快照/回滚出口（undo/checkpoint）
5. OS 级沙箱（Seatbelt/Landlock/bubblewrap 类）
6. 价格/成本在 TUI 会话内的实时可见性（数据已有，缺展示）
7. 对外 SDK/插件 API 文档化
8. 外部基准生态（SWE-bench 类大众评测）
9. 可观测面板（trace/时间线）
10. 协作多人/分享/云（设计排除）

### 4.5 不适合当前项目的能力（路线排除清单，§6 有交叉）
云托管 agent 运行时、Remote Control、插件市场、后台调度器（cron agents）、消息平台接入（Slack/Telegram…）、多用户权限/坐席、OS 沙箱（Windows 主环境）、多语言扩展（>zh/en）、大众基准榜单、IDE 深度集成、桌面 App。

---

## 5. 「竞品有所以我们也必须有」陷阱检查（被否决的跟随性功能）

以下各点**明确不做**，理由不是"竞品有"，而是"与定位冲突或收益为负"：
- **插件市场 / 生态：** Vessel 的对外产品化被路线排除；插件市场要求版本兼容契约、打包分发、三方审计，成本极高，收益只在"吸引第三方开发者"时存在——这不是单用户自用场景。被否决。
- **消息平台接入：** 把 agent 暴露给即时通讯意味着外部攻击面 + 常驻进程 + 权限模型复杂化；自用场景收益≈0。被否决。
- **OS 沙箱：** Windows 是主环境，Seatbelt/Landlock 不可用；bubblewrap/容器化在 Windows 上成本畸高；现有 policy 硬执法 + worktree 隔离已覆盖主要风险面（秘密读取、破坏性命令、仓库污染）。被否决（见 §6-5）。
- **/undo 式 git 自动 commit：** Aider 形态的"每次修改自动 commit"与"行为受控的 Harness"哲学不完全契合——自动 commit 会把 agent 行为直接写进用户历史；Vessel 已有更干净的隔离机制（worktree）。被否决（见 §6-4 的替代方案）。
- **AGENTS.md 项目规则自动生成（OpenCode /init 式）：** Vessel 已有 behavior 引导（rules_in_files 条目）+ 规则进策略双通道；再做一个"AI 生成 AGENTS.md"会稀释"策略是硬边界"的定位。可在后续评估中作为小功能评估，不作为差距。保留观望。
- **多语言扩展：** 竞品也几乎全英文 UI；zh/en 已覆盖目标用户。被否决。
- **协作多人：** 路线排除 + 自用单用户。被否决。

---

## 6. 缺失能力逐条论证（值不值得做）

> 判断标准：收益 ×（用户是谁、痛点是否真实）vs 成本 ×（实现复杂度、维护面、与克制定位的冲突）。
> 定位锚点：本地优先、克制、开发者自用、可交接可验证；不追求大众产品化。

### 6-1 对外分发/安装（npm 发布、一键脚本）——◐ 现状
- 现状：仓库内 `npx tsx apps/cli/src/cli.ts`；无发行渠道。
- 收益：若用户想在别的机器/仓库复用 Vessel，需要 git clone + node_modules 全量引导；发布 npm 包（`@vessel/cli`）可让「可交接」落地为「一条命令装起来」。与"代码追求可交接"的自评一致。
- 成本：npm 打包配置（workspaces→单包、dist 产物、bin 入口）、CI 发布流水线、版本策略；一次性的，维护面小。
- 建议：**值得做（中收益中低成本）**，但只做 npm 包 + `npx @vessel/cli`，不做多平台二进制/安装脚本（那是大众产品的事）。这是全盘差距里"投入产出比最佳"的一项。

### 6-2 CLI 面 MCP 配置入口（`vessel mcp`）——◐ 现状
- 现状：库级 MCP（McpClient + 动态注册 + 按工具 policy deny）已完整且经测试；CLI 无配置命令。
- 收益：MCP 已是行业事实标准（7 个竞品全部有一等入口）；Vessel 的差异化"策略约束 MCP 工具"已经写好，只差暴露；用户在自用时想接一个 MCP server（如本地检索/数据库工具）现在只能写代码调 compose——对"自用"也是摩擦。
- 成本：一个子命令 + 配置存储（~/.vessel 内）+ 复用现有 policy deny 语法；管道已通，成本低。
- 建议：**值得做（中收益低成本）**，排在 6-1 之后；可顺带补一个 `mcp test` 探活（复用 endpointProbe 思路）。

### 6-3 通用 Headless JSON 输出（`vessel run --format json|stream-json`）——◐ 现状
- 现状：只有 bench 通道输出 JSONL；通用 run 无结构化契约。
- 收益：把 Vessel 接进脚本/CI（自用常见：非交互跑一轮、管道消费）；Gemini/Claude/Codex 全都有，证明这是 CLI agent 的"基础礼仪"而非锦上添花。
- 成本：一个输出序列化层（事件流 → JSON 行），复用已有 EventBus/telemetry 事件；低成本。
- 建议：**值得做（中低收益低成本）**；若 event 规范（EVENT-SPEC，D5）本就是事件词汇，则直接映射即可，属于"已有资产的白捡出口"。

### 6-4 会话级快照/回滚出口（undo/checkpoint）——◐ 现状
- 现状：worktree 隔离用于引擎执行面；用户没有"这次 run 改了什么、怎么回滚"的入口（session 日志有，但无 diff/恢复动作）。
- 收益：自用场景改坏代码后想找回现场；会话日志在 `.harness/sessions/` 已含工具调用记录，**对比改动 = 读 session 日志 + git diff 即可**，无需自动 commit。
- 成本：若做自动 commit 形态，成本高且污染历史（见 §5）；若做"run 结束时生成 `.harness/sessions/<id>/changes.diff` + `vessel revert <session-id>`（按 diff 逆操作）"，成本中，且完全沿用现有 session-dir/事件结构。
- 建议：**值得做（中等收益中成本）但克制形态**：生成 diff 报告 + 单命令回滚，不做免确认自动 commit，不碰用户 git 历史。

### 6-5 OS 级沙箱——○ 现状（保持不做）
- 现状：策略硬执法 + 只读/工作区写/全权限三档 + worktree 隔离。
- 收益：OS 沙箱（Codex/Claude 的 Seatbelt/Landlock）能拦住"策略漏网 + 恶意模型"两件事；但 Windows 主环境无等价物，且 Vessel 是自用（模型为 deepseek-flash 等已知端点，非对抗环境），策略兜底已覆盖 secrets/破坏性命令/仓库污染。
- 成本：Windows 上引入容器（WSL2/Docker）破坏"本地优先零依赖"；bubblewrap 不可用；成本高危。
- 建议：**不值得做（收益低成本高）**，维持 policy 硬执法 + 记录"OS 沙箱为未来可选加固"。

### 6-5b TUI 会话内成本提示（/cost）——实为"数据已有、缺展示"
- 现状：UsageStore + pricing 全链路都在，TUI 无成本显示；brief 明记痛点（deepseek-flash 单轮最高 $0.94、长链 run 1.31M token）。
- 收益：直接命中自用痛点（看住成本）；竞品（Claude Code /cost、Codex usage）证明这是常见期待。
- 成本：`chat.ts` 里在会话结束时读 UsageStore 输出摘要即可，复用现有库；低成本。
- 建议：**值得做（中高收益极低成本），应排第一优先级**——这不是新能力，是把已有资产接到用户面前。

### 6-6 多语言扩展（>zh/en）——保持不做
- 收益：竞品多无产品级多语言，"别人有"不构成理由；目标用户已覆盖。
- 成本：维护 N 套词库与文档。
- 建议：**不值得做**。

### 6-7 对外 SDK/插件 API 文档化——◐ 现状
- 现状：组合面（packages + compose）本身可编程，但无面向"库使用者"的契约文档、无版本语义公开承诺。
- 收益：对内是"可交接"的直接证据（新接手者读 compose API 而非翻实现）；对外产品化仍不做。
- 成本：为 compose 组合根与关键 seam（policy/behavior/tools/mcp/subagent）写契约文档 + 类型导出审计；中成本但一次性。
- 建议：**值得做（中收益中成本，一次性）**，但定位是"内部交接的公开契约"，不是"第三方生态"（生态仍不做）。

### 6-8 外部基准生态（SWE-bench 类大众评测）——保持不做，维持自研判据
- 收益：大众榜单给"可比较性"，但 Vessel 的卖点不是"模型得分"，而是"行为层可验证可替换"；SWE-bench 类评测测的是模型/工具链，不是 harness 结构。
- 成本：接入 benchmark 生态是持续维护（判据适配）+ 与自研 L1 判据双轨成本。
- 建议：**不值得追外部榜单**；已有 Cross-Harness Conformance（同一判据跑多个 harness）是更贴合定位的验证方向，值得继续投入（这是"评估"维度的正确打开方式，§4.3）。

### 6-9 可观测面板（trace/时间线）——◐ 现状
- 现状：telemetry metrics + audit + usage + bench-report md；web 仅 UsageBar。
- 收益：自用调 bug 时，会话级 trace（何时调了哪个工具、policy 拦了谁、token 花在哪）能省大量查日志时间。
- 成本：若做"仪表盘 App"，成本高（新表面）；若做"单会话 markdown 报告（`vessel report <session-id>`）"，复用 bench-report 的聚合逻辑，成本中低。
- 建议：**值得做（中收益中成本）但克制形态**：先做单会话可读报告（含 policy 拦截图、token/成本、工具序列），不做常驻面板。与 6-3 的 JSON 输出共享事件序列化层。

### 6-10 协作多人 / 云(Remote Control) / 后台调度器——○ 保持不做
- 理由：路线明确排除；单用户自用收益≈0；消息平台/云暴露带来攻击面与运维面，与"本地优先、克制"直接冲突。`vessel review` 交接单已提供"单人约束下的外部评审"解，方向正确，可继续打磨格式与导入校验。

### 6-11 IDE/桌面表面——保持不做
- 理由：Windows 自用主面是终端；Web 已有次要表面定位。IDE 插件是大众产品的获客渠道，非自用需求；桌面 App 是分发与常驻形态，均与定位冲突。

---

## 7. 市场信号（对 Vessel 定位的独立观察）

- **独立开源 agent 的高波动**：Continue 停维护（read-only，终版 2.0.0）；Roo Code 2026-05 停服（README 明示，社区 fork ZooCode 续命）；OpenHands 从"自主 agent 平台"转型为**控制中心**（Agent Canvas，统一驱动 Claude Code/Codex/Gemini 等 ACP agent）；Cline 收敛到**共享 agent core + SDK**（CLI/桌面/IDE 同一引擎）。
- 解读：市场正在向两个方向收敛——**协议化互操作**（ACP 控制中心）与**程序化嵌入**（SDK）。这正是 Vessel 已选的方向（可组合框架 + conformance 思路），竞品趋势反向印证了 Vessel 架构路线的合理性，无需追逐"又一个独立 agent 产品"。
- 对 Vessel 的启示：与其加"更多表面"，不如把**组合契约、策略、评估**三件事做深——这正是 §4.3 差异化列的所在。

## 8. 结论摘要

- 最重要差距（值得做，按优先级）：① TUI 会话内成本可见（6-5b，白捡资产）；② 会话续跑 + 快照回滚（6-1/6-4 组合：装得起来、续得上、回得去）；③ CLI 面 MCP 配置 + 通用 JSON 输出（6-2/6-3，管道已通只差出口）。
- 最重要差异化（守住的）：Behavior IR/Policy 编译硬执法、Generator/Evaluator 分离评估、供应商/成本管理纵深、中英双语引导。
- 明确不做的：插件市场、消息平台、OS 沙箱、多语言扩展、多人协作/云、大众基准榜单、IDE/桌面表面。

## 9. 来源与可信度标注

| 来源 | 类型 | 抓取方式 | 时间 |
|---|---|---|---|
| PROJECT-BRIEF.md + 代码库（apps/cli、packages/*、configs/*） | 一手 | read/grep（本仓库） | 2026-09 |
| https://raw.githubusercontent.com/sst/opencode/dev/README.md （现 anomalyco/opencode） | 官方 README | web_fetch HTTP 200 | 2026-09 |
| https://opencode.ai/docs/ 、/docs/providers/ 、/docs/policies/ | 官方文档 | web_fetch HTTP 200 | 2026-09 |
| https://raw.githubusercontent.com/anthropics/claude-code/main/README.md ；https://code.claude.com/docs/en/overview（+settings/features-overview 导航） | 官方 README/文档 | web_fetch HTTP 200 | 2026-09 |
| https://raw.githubusercontent.com/openai/codex/main/README.md；docs/ 目录及 getting-started/exec/config/sandbox/skills（多为跳转链接） | 官方 README/文档 | web_fetch HTTP 200 | 2026-09 |
| https://raw.githubusercontent.com/google-gemini/gemini-cli/main/README.md | 官方 README | web_fetch HTTP 200 | 2026-09 |
| https://raw.githubusercontent.com/Aider-AI/aider/main/README.md；aider.chat/docs（链接引用） | 官方 README | web_fetch HTTP 200 | 2026-09 |
| https://raw.githubusercontent.com/cline/cline/main/README.md | 官方 README | web_fetch HTTP 200 | 2026-09 |
| https://raw.githubusercontent.com/All-Hands-AI/OpenHands/main/README.md | 官方 README | web_fetch HTTP 200 | 2026-09 |
| https://raw.githubusercontent.com/continuedev/continue/main/README.md | 官方 README（停维护声明） | web_fetch HTTP 200 | 2026-09 |
| https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/README.md | 官方 README（停服声明） | web_fetch HTTP 200 | 2026-09 |
| 标注「公开知识」处 | 二手 | 未现场取证（模型知识 + 公开渠道共识），矩阵中已逐处标注 | — |

> 网络说明：内置 web_search 不可用（DeepSeek API key HTTP 401，配置层问题，非本任务可修）；web_fetch 直连全程 HTTP 200，无需代理 7897。