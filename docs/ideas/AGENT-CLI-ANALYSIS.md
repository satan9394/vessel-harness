# Composable Agent Harness（cah）设计来源分析 —— 它参考了哪些 Coding Agent、对应谁的哲学、它的系统提示词是什么

- **定位**：只读分析报告（不改任何代码）。回答三个问题，供 HTML 可视化与后续产品叙事使用。
- **证据范围**（均为本仓库内一手文档/源码，引用即溯源）：
  - `docs/DESIGN-DECISIONS.md`（D3，16 决策点，"参考了谁"的权威来源，候选命名法 `cmp:H0X` / `anat:0.2-n` / `§n`）
  - `docs/ARCHITECTURE.md`（D8，模块边界与模块落点）、`docs/HARNESS-ANATOMY.md`（D1，范式分类）、`docs/research/harness-matrix/*.md` + `comparison.md`（D2，H01–H12 逐机制决策）
  - `docs/ideas/PROVIDER-UX-RESEARCH.md`、`docs/ideas/PROVIDER-TUI-RESEARCH.md`（产品引导 UX / TUI / 权限三档调研）
  - `任务书.md`（定位与三核心：Behavior IR + Behavior Compiler + Policy Runtime，以及 Conformance Suite）
  - 真实源码：`packages/context/src/builder/Builder.ts`、`packages/behavior/src/compiler/Compiler.ts`、`packages/policy/src/risk/Compiler.ts`、`apps/cli/src/compose.ts`、`configs/behavior.default.yaml`、`configs/policy.default.yaml`
- **方法声明**：本项目是 clean-room（任务书 §19）：研究对象 = 借鉴对象 ≠ 照抄对象；每一处借鉴都先在 D2/D3 里以"候选 A/B/C = 类 X 型"记录取舍，再落进 D4–D8 规范与实现。以下 Q1/Q2 全部基于这些文档的**结论原文**，不新增猜测。

---

## Q1. 它参考了哪些 Agent 的优点（逐条）

> 阅读提示：表内"落地位置"引用的是 ARCHITECTURE.md / 代码模块 / 任务卡（020–022）等真实落点；"文档依据"是 D3 决策点与 D2 机制编号，可交叉回查。

### 1.1 内核 / 会话 / 上下文层（来自 harness-matrix 横向解剖）

| 借鉴对象 | 借鉴的具体机制 / 优点 | 落地位置（模块 / 文档） | 文档依据 |
|---|---|---|---|
| **DeepSeek Harness（DSH）** | 事件溯源会话：append-only 类型化事件日志为唯一真源，模型历史由 surface 投影**派生**（模型可见 ⟺ 已记录），崩溃恢复 = 重放 + 合成 interrupted 关闭器 | `core/session`、`context/builder`（`assemble()` 对 `session.surface()` 投影）、`EVENT-SPEC` B01–B21 | D3 决策点 2/3/5/10；anat:0.3-1 |
| **DSH** | 薄核 + 单一权威 loop：Core 只做 Model Call→Tool Call→Tool Result→State Update→Continue/Stop；轮次预算不内建、交扩展点 | `core/agent-loop`（薄核）、`AGENTS.md` 硬约束 2 | D3 决策点 2；任务书 §2.2 |
| **DSH** | waterfall 中间件语义（不调 next() 即短路=决策）、guard 单调（只收窄不放行）、先持久后等待、fail loud | `core/events`（emit/waterfall/serial/parallel/bail）、`policy/engine` 裁决链 | D3 决策点 3/8；anat:0.3-2；DSH 15 条行为要点 |
| **DSH** | 注入即数据：指令/记忆/技能目录 = 带 source 的持久 `user/message`，可回放可压缩；工具输出 render 与执行值分离 | `context/builder` 指令注入（source='instruction'/'memory'）、`EVENT-SPEC` B01 | D3 决策点 5/10；cmp:H02/H03 |
| **DSH** | 沙箱 confine seam：逐调用解析、fail-closed（SANDBOX_UNAVAILABLE）、enforcement full/partial 透明、平台 runner 链（Windows 有真实 ACL 方案） | `runtime/sandbox`（语言中立 seam）+ `tools/shell` Operations 注入点 | D3 决策点 9；cmp:H08 |
| **DSH** | Compaction 事务化：三入口、平衡区域替换、tool call/result 配对不拆、尾部逐字、热前缀摘要、恰好一次 end | `context/compaction`、`EVENT-SPEC` B14–B16 | D3 决策点 6；cmp:H04 |
| **Claude Code** | 对外行为基准：终止判据"无未决 tool_call / 纯文本即停"；一次任务 gather→act→verify 三阶段语义；读并发/写串行 | `core/agent-loop` 终止判据（语义层）+ `tools` exclusive 屏障 | D3 决策点 2/7；anat:0.2-1 |
| **Claude Code** | CLAUDE.md/AGENTS.md 指令以 **user message** 注入而非 system（官方行为差异） | `context/builder`（`[指令文件 <path>]` 前缀 user 消息） | D3 决策点 5；cmp:H02 |
| **Claude Code** | 缓存纪律：动态内容往消息层放、保 prefix cache；compaction 保留清单（用户请求/改动文件/未完成任务/当前工作/关键代码） | `context/builder` stable 层每会话组装一次并缓存（Builder.ts `stableLayer`）；summarizer 保留清单 | D3 决策点 5/6；anat:0.3-4c |
| **Hermes Agent** | 三层 stable/context/volatile 拼接 + **每会话构建一次、跨轮复用**（prefix cache 神圣） | `context/builder` 的 stable（system）→ 指令 user → volatile（`[环境] …`）排序与缓存 | D3 决策点 5；cmp:H02；anat:0.3-4c |
| **Hermes Agent** | 文件式长期记忆：MEMORY.md/USER.md 冻结快照注入、中途写盘不改当前提示、单一 memory 工具 | `memory/`（V0.3-M1，`createMemoryTool` + `projectMemory` 快照注入 Builder） | D3 决策点 10；anat:0.3-1 |
| **Pi** | 最小内建工具集哲学：8 个最小工具 + TypeBox schema 贯穿（定义/校验/提示），工具"定义"与"可插拔 Operations"解耦 | `tools/registry` 最小内建集 + schema DSL（纯 TS 推导类型/JSON Schema/校验）；`tools/shell` Operations 注入点 | D3 决策点 7；anat:0.2-3 |
| **Claw Code** | 压缩后 session-health 探针；部分成功一等公民的诚实纪律；工具输出源头限流 | `context/compaction`（健康探针）、`tools` 输出限流 + spill | D3 决策点 2/6/7（cmp:H01/H04/H05） |
| **Codex** | 上下文保真：压缩**保留全部用户消息原文**（只总结 assistant/工具明细） | `context/compaction` 保留尾部/用户原文 | D3 决策点 6；cmp:H04 |
| **OpenCode** | 健壮性件：doom-loop 检测（同工具同输入 ≥3 次转权限）、参数错 INVALID_ARGS 让模型自修复 | `policy/risk` doom-loop 计数、`tools` 错误契约 | D3 决策点 2/7；cmp:H01/H05 |

### 1.2 策略 / 安全 / 沙箱层

| 借鉴对象 | 借鉴的具体机制 / 优点 | 落地位置 | 文档依据 |
|---|---|---|---|
| **Claude Code** | permission 四层叠加：modes → rules（allow/ask/deny，**deny→ask→allow 先匹配**、deny 不可被更细 allow 豁免）→ hooks → sandbox；Behavior Safety 与 Runtime Safety 分离 | `policy/engine` 裁决序（①denied_tools→②deny→③hook→④ask→⑤allow→⑥profile）；D6 四件套 | D3 决策点 8；cmp:H07；anat:0.3-4a |
| **Claude Code** | 危险操作任何模式不自批（circuit breaker） | `policy/risk` never_auto 危险集合（destructive-delete/disk-format/partition-write） | D3 决策点 8/9 |
| **DSH** | fail-closed + guard 单调 + approval 审计事件对（asked→decided 完整证据链）+ `never` 策略服务内强制 | `policy/engine`、`EVENT-SPEC` A16/A17+B17/B18 | D3 决策点 8 |
| **Codex** | 权限三档**命名来源**：read-only / workspace-write / danger-full-access（OS 级沙箱档位） | `configs/policy.default.yaml`（`profile: workspace-write`）、CLI `--permission` 运行时覆盖 | PROVIDER-TUI-RESEARCH §C1/C3（任务卡 022） |
| **Codex** | 沙箱文件边界模型：只读根 + 可写覆盖 + **受保护子路径强制只读** + 路径特异性排序 + violation→denial 判定驱动升级重试 | `runtime/sandbox` Linux 后端参照（v0.1 声明实现边界） | D3 决策点 9；cmp:H08 |
| **Codex** | execpolicy 规则引擎（allow/prompt/forbidden）+ 危险命令前缀黑名单 → 规则/黑名单/沙箱三层 | `policy/risk`（shell.deny + scoped_rules + 沙箱兜底） | D3 决策点 8；cmp:H07 |
| **Claw Code** | 权限决策序（denied_tools → deny → hook override → ask → allow → 模式比较）清晰化 | `policy/engine` 裁决序（D6 §4.2） | D3 决策点 8；cmp:H07 |
| **Pi / OpenCode / Hermes（对照组）** | 反例吸收：Pi"无工具级权限/无沙箱"、OpenCode"权限即边界无 OS 沙箱"均被**拒绝**——本仓默认读边界 = workspace + 显式 allow（比 Claude 全盘读更保守），凭据 denyRead | `configs/policy.default.yaml` filesystem.deny_read / protected | D3 决策点 8/9 Rejected 项 |

### 1.3 工具 / 扩展 / 委派 / 验证层

| 借鉴对象 | 借鉴的具体机制 / 优点 | 落地位置 | 文档依据 |
|---|---|---|---|
| **Claude Code** | 35+ hooks 事件面作为**覆盖度参考**（非照抄清单）；/goal 独立小模型只读评估三态；verification loop 完成语义（无人值守以可运行检查为前提） | D5 48 事件总表（两域事件）；`agents/evaluator`（verdict met/not_met/impossible/error） | D3 决策点 3/12；cmp:H06/H12 |
| **Codex** | `codex review` 受限评审子代理：独立模型 + rubric 结构化 findings + review-only 工具限制 | `agents/evaluator` 设计参照（只读工具面 + 独立模型 profile 的 preset） | D3 决策点 12；cmp:H12 |
| **Codex** | 子代理 = fork 线程：窗口可选 FullHistory/LastNTurns；角色只能收窄不能放大父权限 | `agents/subagent`（V0.2：fork 窗口 + 权限单向收窄） | D3 决策点 12；cmp:H11 |
| **DSH** | subagent seam + provider 注册表 + 统一结果契约 {output, structured?, stopReason}；非 completed = 错误；delegationDepth 持久 | `agents/subagent` + `SubagentManager`/`IsolatedRuntime` | D3 决策点 12；cmp:H11 |
| **Claude Code / Hermes** | 子代理只回摘要、父不见中间过程（信息隐藏）；Evaluate 复用 H11 机制 = preset 而非新原语 | `agents/evaluator`（evaluator 不是新原语） | D3 决策点 12；anat:0.3 |
| **Claw Code** | mock-parity 方法论：确定性 mock 端到端行为回归、scenario↔PARITY 引用自动核对、verification-map"行为→代码→测试" | `benchmarks/`（B001–B019、mock adapter、Conformance Suite） | D3 决策点 16；cmp:H12 |
| **Pi** | evals = vitest-evals 适配真实 AgentSession 的行为级模型回代测试（可 A/B prompts/tools/models） | `benchmarks/runners` live 车道（A/B 五组） | D3 决策点 16 |
| **DSH** | invariants 机械自检：回放校验轮次/步骤编号、tool call/result 配对、retry 记录 | `agents/` invariant 自检 + `benchmarks/` 断言 | D3 决策点 12/16；cmp:H12 |
| **OpenCode / Hermes** | 技能 = SKILL.md 开放标准 + 目录渐进披露（只注 name/description）、正文按需加载；跨 harness 兼容目录 | `skills/`（V0.3：正文注入 `<skill_content>` 契约；兼容 ~/.claude/skills、~/.codex/skills） | D3 决策点 11；cmp:H10 |
| **Hermes** | /learn + curator 生命周期（活体 agent 产出、只归档不删除） | `skills/` + `memory/persistent`（V0.3/V0.4 suggest-only、learned/ 专用区） | D3 决策点 11；cmp:H10 |
| **Claude Code（MCP）** | MCP 命名 `mcp__<server>__<tool>`、schema 延迟加载；"MCP 是唯一动态工具扩展通道" | `tools/mcp`（V0.2 装载，命名规则已立） | D3 决策点 7；cmp:H05 |
| **CL4R1T4S（行为语料）** | 输入侧行为模式矿藏（跨产品共识 15 条：只用显式工具+调前说明原因、代码可立即运行、完成=外部检查+诚实性等），**只作候选行为来源，绝不直进 system prompt** | `docs/ideas`、`configs/behavior.default.yaml` 4 条 IR 的措辞源头（经 §18 管道） | D3 决策点 14；anat:0.3-5；cl4r1t4s.md |

### 1.4 产品 UX 层（向导 / 模型管理 / TUI / 权限档位，来自 PROVIDER-UX / PROVIDER-TUI 调研）

| 借鉴对象 | 借鉴的具体机制 / 优点 | 落地位置（任务卡 / 模块） | 文档依据 |
|---|---|---|---|
| **opencode** | `/connect` 一条斜杠命令完成供应商引导（列表向导 + Popular/Other 分组 + "怎么登"备注 + 多 auth 二级选择）；`/connect`（接供应商）与 `/models`（选模型）两命令解耦 | `apps/cli/src/providers/setup.ts` `runSetupWizard`（升级方向：搜索化 + 分组 + 幂等跳步） | PROVIDER-UX-RESEARCH §4（任务 020） |
| **opencode** | 模型目录来自 **Models.dev** 预置 + `/v1/models` 实时拉取；provider/model 全限定 id | `docs/ideas/data/models.dev-api.json`（213 家快照）→ `presets.data.ts`（≥55 家） | PROVIDER-UX-RESEARCH §4.3；PROVIDER-TUI-RESEARCH §A2 |
| **cc-switch** | Fetch Models 按钮语义 = 用当前 key 调 `/v1/models` 枚举 + **错误分类引导**（401/403 查 key、404/405 回退手填、解析失败、超时）；失败 ≠ provider 不可用 | `apps/cli/src/providers/modelFetcher.ts` + setup 向导第 3 步降级路径 | PROVIDER-UX-RESEARCH §6.2/§9.3 |
| **cc-switch** | 供应商"厂商级实体 + category 分类"（official/cn_official/aggregator…），**不照抄分销长尾** | 020 目录的 category 体系（official/cn/aggregator/local/intl） | PROVIDER-TUI-RESEARCH §A1 |
| **Claude Code** | `/model` 双语义：Enter = 持久存默认 / `s` = 仅本会话；切换前给成本确认；写入前明示作用域（用户级会跨项目扩散） | `cah` 未来 `/model`（picker 内 Enter/s 双语义，任务卡 021 接口位） | PROVIDER-UX-RESEARCH §2 |
| **Pi** | 极简 + 30+ 第三方预置；`/login` 统一订阅/API-key 两轨认证；模型 picker Ctrl+S 存启动默认；凭证解析优先级成文 | setup 向导（`/login` 收敛两问）、key 解析优先级写入 | PROVIDER-UX-RESEARCH §5 |
| **Cursor** | BYOK 每 key 一个 Verify 按钮（写完即验绿勾） | setup 向导"拉模型即验证"位（clack spinner + 401/403 引导） | PROVIDER-UX-RESEARCH §7.2 |
| **Gemini CLI** | 首次启动认证三选一（Google OAuth / API key / Vertex） | 首次无 provider 的引导提示位（可选项） | PROVIDER-UX-RESEARCH §7.1 |
| **opencode（TUI）** | **无参 `opencode` = 直接进 TUI**（client/server 双进程形态），chat TUI 真相 = 回放区 + 底部输入/状态；slash 命令 prompt 状态机 | `cah` 无参进 chat（任务卡 021，raw TTY + @clack 轻量方案，**不做全屏 TUI**）；`apps/cli/src/tui/chat.ts` | PROVIDER-TUI-RESEARCH §B |
| **Codex** | 权限三档命名 read-only/workspace-write/danger-full-access | 022 三档 × 工具面矩阵 + `--permission` 覆盖（cli.test V0.7 已实现） | PROVIDER-TUI-RESEARCH §C |
| **Claude Code / opencode（对照）** | mode 体系 / per-tool allow-ask-deny 作为**语义参照**（不照抄词汇，取 Codex 命名 + Claude 的 protected/deny 铁律） | `configs/policy.default.yaml` | PROVIDER-TUI-RESEARCH §C1/C2 |

---

## Q2. 它对应哪些 Agent 的哲学或构造（分层对应）

> 依据：HARNESS-ANATOMY §0.2 七种范式分类（闭源行为基准 / Rust parity / 极简内核 / 插件树+事件溯源 / Rust 产品工程 / 产品级 TS client-server / 自学习单体）+ §0.3 三条差异主轴与四条跨家共识；D3 各决策点"最终选择 = 组合取各家可迁移点"。**没有哪一层是单家原样照搬**——每层都是"某家骨架 + 另一家纪律/语义"的合成。

| 层 | cah 的构成 | 对应谁的哲学（合成定位） | 依据 |
|---|---|---|---|
| **内核 / Loop** | 事件溯源 append-only 日志 = 唯一真源 + 单一权威薄 loop（开轮次→领输入→step→停） | **DSH 的事件溯源薄核哲学**（模型可见 ⟺ 已记录、崩溃恢复=重放）+ **Claude Code 的终止语义哲学**（纯文本即停）+ **Claw 的健康探针**；明确拒绝 Pi 双轨 loop、Claw"循环拆到 CLI 层"、Codex 2881 行单文件 | anat:0.3-1/0.3-2；D3 决策点 2/3/10；cmp:H01 |
| **上下文 / Context** | stable（system，每会话一次缓存）→ 指令（user 注入）→ volatile（`[环境]`），历史 = 事件投影派生 | **Hermes 的缓存纪律哲学**（三层拼接、每会话构建一次、prefix cache 神圣）+ **DSH 的注入即数据哲学**（带 source 持久 user 消息）+ **Claude Code 的按需加载与 user-message 指令哲学**；拒绝 Claw 全量重发 / OpenCode 每轮全量读库 / Pi 每轮重放 | cmp:H02/H03；D3 决策点 5 |
| **工具** | 最小内建集 + schema DSL + unified 流水线（pre/guard/execute/post）+ exclusive 屏障 + MCP 唯一动态扩展 | **Pi 的极简内核工具哲学**（最小集 + 定义/执行解耦）+ **DSH 的统一流水线与并行原语哲学**（guard 单调、独占屏障、滚动池）+ **OpenCode 的健壮性件哲学**（INVALID_ARGS 自修复）；拒绝 Claw 万行单体 tools、Claude 40+ 大工具面、Codex 无独立文件工具 | cmp:H05；D3 决策点 7 |
| **策略 / 安全** | Policy YAML 唯一事实源 → 四件套（Prompt Guidance/Tool Interceptor/Runtime Deny/Audit）；三档 profile；OS 级沙箱 seam | **Claude Code 的行为分层哲学**（Behavior Safety 与 Runtime Safety 分离、deny→ask→allow、protected 铁律）+ **DSH 的 fail-closed 哲学**（guard 单调、审计事件对、never 服务内强制）+ **Codex 的工程语义哲学**（三档命名 + 只读根/可写覆盖/受保护子路径沙箱模型）；拒绝 Pi"runs with user permissions"、OpenCode 无 OS 沙箱 | cmp:H07/H08；anat:0.3-3、0.3-4a/e；D3 决策点 8/9 |
| **验证 / 多智能体** | Evaluator = preset 子代理 + 独立模型 + 只读证据；subagent = 同构 Session；Conformance Suite | **Claude Code 的验证外部化哲学**（verification loop、/goal 独立小模型、干活模型不自证完成）+ **Codex 的受限评审哲学**（review 子代理 + rubric + 权限只收窄）+ **DSH 的机制非角色哲学**（seam+provider 先于角色、invariants 机械自检）+ **Claw 的 mock-parity 方法论哲学**（行为对齐写成可执行场景）；Evaluator 不是新原语 | cmp:H11/H12；D3 决策点 12/16 |
| **会话 / 记忆** | 事件日志 + 目录绑定可 resume/fork；长期记忆 = 文件式（冻结快照注入、单一 memory 工具） | **DSH 的事件日志哲学**（会话 = 发生过什么）+ **Hermes 的文件式记忆哲学**（MEMORY.md/USER.md、冻结快照、写盘不改当前提示、只归档不删除） | cmp:H09；anat:0.3-1；D3 决策点 10 |
| **产品 UX（CLI 引导 / TUI / 模型管理 / 权限档位）** | `cah setup` 向导、`cah` 无参进 chat、三档 `--permission`、供应商目录 ≥55 | **opencode 的第三方优先产品哲学**（/connect+/models 两条命令解耦、Models.dev 目录、TUI 无参进入）+ **cc-switch 的向导完整性哲学**（预设填充、Fetch Models、错误降级、档位默认模型）+ **Claude Code 的 /model 双语义与作用域提示哲学** + **Codex 的三档命名**（作为权限词汇来源）；工具选型 @clack（不引 ink/全屏 TUI = 轻量哲学，吸收 opencode 用 React-ink 后弃用的教训） | PROVIDER-UX-RESEARCH §2/§4/§5/§6/§9；PROVIDER-TUI-RESEARCH §0（A/B/C 三结论） |
| **总纲哲学（贯穿各层）** | Behavior IR 保存"该怎么行为"而非"某家 prompt 写了什么" | **无任何一家的现成哲学**——CL4R1T4S 语料证明行为可归纳（跨产品一致性极高）是 Behavior IR 成立前提；这是本项目与 7 家 harness 的**差异点**（anat:0.3-5："没有哪家把行为做成显式 IR"） | D3 决策点 14；任务书 §6/§7 |

**一句话合成定位（层叠写法）**：cah = **DSH 的事件溯源薄核 + Claude Code 的行为语义/分层哲学 + Pi 的极简内核工具纪律 + Hermes 的缓存纪律与文件式记忆 + Codex 的三档/沙箱工程语义 + Claw 的 mock-parity 验证方法论 + opencode/cc-switch 的第三方优先产品体验**——但所有这些都被"Behavior IR + Compiler + Policy Runtime"这条**自研管线**重新表达，这正是它区别于"某家 Agent 克隆"的地方。

---

## Q3. 这个 Agent 的系统提示词是什么（真实源码提取）

### 3.1 组装管线（谁把什么拼进 system）

真实链路（`apps/cli/src/compose.ts` → `packages/context/src/builder/Builder.ts`）：

```text
composeHarness()
 ├─ loadBehaviorIR(configs/behavior.default.yaml)                       → IR 条目
 │    └─ compileBehavior(ir, artifacts)（packages/behavior/src/compiler/Compiler.ts）
 │         channel=prompt_guidance            → 直接收进 promptSections
 │         channel=runtime_policy + 有执法规则 → 也收进 promptSections（软渲染文本）
 │         channel=runtime_policy + 无执法规则 → 只告警不进（双通道强制）
 │         → compiled.promptSections = BuilderDeps.stableSections
 ├─ loadPolicyArtifacts(configs/policy.default.yaml)                    → 四件套
 │    └─ artifacts.promptGuidance（packages/policy/src/risk/Compiler.ts 产出）= BuilderDeps.policyGuidance
 └─ ContextBuilder.assemble()（每会话第一次组装，之后缓存复用）:
      stable = [ '你是 Composable Agent Harness V0.1 的编码代理。'
                 , ...stableSections()      // behavior 编译段
                 , ...policyGuidance() ]    // policy 软引导段
               .join('\n\n')
      → messages = [{ role:'system', content: stable }, ...历史(user/assistant/tool 派生), 可选 volatile]
```

- system 层只有**这一条消息**，每会话组装一次、缓存复用（`Builder.ts` `stableLayer`，prefix-cache 友好，Hermes 纪律）。
- AGENTS.md 指令链**不**进 system：以 `[指令文件 <path>]\n…` 前缀的 user 消息注入（source='instruction'）；Project Memory 以 source='memory' 的 user 消息注入；技能目录索引等 volatile 以 `[环境] …` user 消息追加。
- `role:'system'` 固定句仅此一处（`Builder.ts` L93/L97）；另有非主会话的独立小 system：Evaluator 为一行 JSON 指令（`Evaluator.ts` L75）、Planner 为结构化计划 JSON 指令（`Planner.ts` L150–152）；subagent 复用同一套 stableSections + policyGuidance（`SubagentManager.ts`）。

### 3.2 固定句（代码原文，`Builder.ts` L93）

```text
你是 Composable Agent Harness V0.1 的编码代理。
```

### 3.3 Behavior 编译段（configs/behavior.default.yaml 4 条 render 原文，按 IR 顺序进 stableSections）

```text
纯文本回复即停止；不要在无需工具时强行调用工具。                    # loop.turn_ends_without_tool_call  (prompt_guidance)
不要改写受保护路径（.git/.env/.ssh 等）；该约束由策略引擎硬执法。      # safety.protected_paths            (runtime_policy→filesystem.protected)
删除/格式化等破坏性命令会被策略引擎拦截；先说明原因与范围。           # safety.dangerous_shell            (runtime_policy→shell.deny)
以检查结果（测试/命令输出）作为完成依据，不自证完成。                # verification.independent_evaluator (prompt_guidance)
```

注：`channel: runtime_policy` 的两条**同时**做软渲染进 system 与硬执法（policy_ref 在 policy.default.yaml 中确有对应规则，编译器校验通过才进）；即"同样的话既写进提示引导、又在运行时被引擎强制执行"，这正是双通道（IR 双通道原则 / D3 决策点 8、14）。

### 3.4 Policy Guidance 段（configs/policy.default.yaml → policy/risk Compiler 生成，按序进 promptGuidance）

进入 system 的实际文本（顶层 `guidance` 原文 + 编译器按 filesystem/shell/git 声明**自动生成**的软引导，`Compiler.ts` L105–118）：

```text
这是硬执法策略：受保护路径写入与危险命令会被引擎拒绝并记录审计事件。            # ← 顶层 guidance（YAML 原文）
不要改写受保护路径：.git, .git/**, .claude, .ssh, .harness/credentials, .env（硬执法，不可豁免）。   # ← filesystem.protected 自动生成
不要读取凭据/敏感文件：**/.aws/credentials, **/.ssh/**, **/.env（硬执法）。                         # ← filesystem.deny_read 自动生成
破坏性命令（destructive-delete, disk-format, partition-write）被硬拦截，先说明原因与范围再考虑受管替代。 # ← shell.deny 自动生成
不要 force push 重写共享分支历史。                                                                    # ← git.force_push 自动生成
```

> 实现细节备注：`configs/policy.default.yaml` 里 `shell.guidance` 下还有两条中文引导（"破坏性命令（删除/格式化/分区）先说明原因与范围…"、"不要 force push 重写共享分支历史。"），但 `shared/src/policy.ts` 的 `PolicyDeclaration.shell` 类型未声明该字段、policy 编译器也只消费**顶层** `guidance` + 上述自动生成段——故这两条目前**不会**进入实际 system 提示词（YAML 中属于未生效的冗余声明；若要生效需上移到顶层 `guidance`）。

### 3.5 完整拼接结果（默认配置下实际发给模型的 system 内容）

```text
你是 Composable Agent Harness V0.1 的编码代理。

纯文本回复即停止；不要在无需工具时强行调用工具。
不要改写受保护路径（.git/.env/.ssh 等）；该约束由策略引擎硬执法。
删除/格式化等破坏性命令会被策略引擎拦截；先说明原因与范围。
以检查结果（测试/命令输出）作为完成依据，不自证完成。

这是硬执法策略：受保护路径写入与危险命令会被引擎拒绝并记录审计事件。
不要改写受保护路径：.git, .git/**, .claude, .ssh, .harness/credentials, .env（硬执法，不可豁免）。
不要读取凭据/敏感文件：**/.aws/credentials, **/.ssh/**, **/.env（硬执法）。
破坏性命令（destructive-delete, disk-format, partition-write）被硬拦截，先说明原因与范围再考虑受管替代。
不要 force push 重写共享分支历史。
```

### 3.6 与 Claude Code / Codex"整段人设 prompt"的本质差异

- **cc/codex/claw/pi 等**：行为 = 手写整段人设长 prompt（身份一句 → 语气/人设 → 工具纪律 → 改动纪律 → 护栏 → 输出约束…），文本与运行时**无编译契约**，行为散落在 system 段落、指令文件、hook、权限、compaction 语义五处（anat:0.3-5；CL4R1T4S 语料证明的共现结构段）。
- **cah**：system 只含"一句身份 + 编译产物"。行为**不是手写人格**，而是 `configs/behavior.default.yaml` 里可版本化、可校验、带 `channel`/`conformance` 字段的**声明式 IR 条目**，经 Behavior Compiler（L0 IR → L1 生效快照 → L2 Model Profile → L3 Harness Profile → L4 Prompt Compiler）编译而来（D3 决策点 14：候选 A = "行为即显式 IR" 对候选 B = "行为散落各处、Pi/OpenCode/Claude 现状" 的明确胜出；拒绝候选 0 = 直接拼接各家 prompt）。
- 关键分界：
  1. **保存什么不同**：不保存"某家 prompt 写了什么"，而保存"这个 Agent 应该怎么行为"（任务书 §6）。同一条 `verification.independent_evaluator: true` 将来对 Claude/GPT/DeepSeek 渲染不同措辞，但 IR 只有一个（D3 决策点 13：一份 provider 中立模板 + Model Profile）。
  2. **软硬分离不同**：cc 里"不要删除 .git"只是 prompt 文字；cah 里同一主张同时走 `runtime_policy` 编译为 Policy Engine 硬执法（Task 书原则 3：软约束引导、硬约束执法，禁止只写 prompt）——IR 条目 `safety.protected_paths` 的 render 只是它进 system 的那一面，硬面是 `filesystem.protected` 规则 + 沙箱。
  3. **可验证性不同**：每条 IR 带 conformance 字段，供 Evaluator/Conformance Suite 断言（D3 决策点 16）；手写 prompt 无机器可断言的"行为承诺"。
  4. **来源管道不同**：CL4R1T4S 等 UNTRUSTED 语料只能经 Raw Prompt→Parser→Behavior Extraction→Review→Behavior IR 进入，禁止原文直进 system（任务书 §18；D3 决策点 14 Rejected）。

---

## 结尾：一句话定位

> **cah（Composable Agent Harness）= 以 DSH 的事件溯源薄核为骨架、Pi 的极简工具与 Hermes 的缓存纪律为约束、Claude Code 的行为语义与验证外部化 + Codex 的三档/沙箱为行为与安全基准、opencode/cc-switch 的第三方优先引导为产品面，最终把一切行为收敛为"Behavior IR + Behavior Compiler + Policy Runtime + Conformance Suite"的自研编码代理**——它的 system 提示词不是人设，而是从行为 IR 编译出来的可验证产物。

---

### 附：证据文件索引（按引用强度）

- `docs/DESIGN-DECISIONS.md`（决策点 1–16 总表见 L33–53）
- `docs/ARCHITECTURE.md`（模块边界 §4；数据流 §2；IR 管线 §3）
- `docs/HARNESS-ANATOMY.md`（§0.2 范式、§0.3 结论、各章共同抽象、各家范式小结 L474–507）
- `docs/research/harness-matrix/{comparison,claude-code,claw-code,pi,deepseek-harness,codex,opencode,hermes,cl4r1t4s}.md`
- `docs/ideas/PROVIDER-UX-RESEARCH.md`、`docs/ideas/PROVIDER-TUI-RESEARCH.md`
- `任务书.md`（§2 原则 L55–115；§6/§7 L568–660；最终定位 L1400–1431）
- 源码：`packages/context/src/builder/Builder.ts`、`packages/behavior/src/compiler/Compiler.ts`、`packages/policy/src/risk/Compiler.ts`、`packages/shared/src/policy.ts`、`apps/cli/src/compose.ts`、`configs/behavior.default.yaml`、`configs/policy.default.yaml`
