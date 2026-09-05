# Harness 解剖总纲（D1）—— 8 个 Coding Agent Harness 完整解剖

- **定位**：第一阶段交付物 D1（任务书第二十一节），"各家完整解剖"总纲。面向第二阶段 Behavior IR / Event Spec / Policy Spec 与最终自研 Harness 的决策者。
- **事实范围**：本文件不引入任何新事实，是对 `docs/research/harness-matrix/` 下 8 份项目研究文档 + 1 份 `comparison.md`（横向矩阵与 H01–H12 逐机制决策）的**综合与结构重组**。正文引用的实现位置、模块/文件名、机制细节均可在对应研究文档中溯源；凡研究文档标注"未获取到/空缺/UNTRUSTED"之处，本文件照实标注（见第 14 章），不编造。
- **研究日期**：2026-09-04/05（各项目文档详注）；本文件撰写于第一阶段研究完成后。

> 阅读建议：`comparison.md` 提供 12 机制 × 7 项目的"决策级"横向矩阵（含 Decision/Why/Rejected/Proposed Spec）；本文件按 H01–H12 每章做"逐家实现位置与流程对比 + 共同抽象"，并新增各家范式小结与资料缺口章节，两者互补、不重复总表。需要某一机制的自研规范草案时，以 comparison.md 对应章的 Proposed Spec 为准。

---

## 0 执行摘要

### 0.1 研究范围与 commit 锁定情况

研究对象 8 个（7 个可运行/可读源码或文档的 Harness + 1 个行为语料库），全部有 URL 与 commit 锁定：

| # | 对象 | 仓库 / 锁定 | 文档内锁定证据 |
|---|------|------------|----------------|
| 1 | Claude Code | https://github.com/anthropics/claude-code | commit `d7dbd9a09f59775726ed14bbea8fc9dfdff62f7b`（2026-09-04，main）；官方文档 code.claude.com/docs 抓取 60+ 页，对应发布线 ≈ 2.1.26x |
| 2 | Claw Code | https://github.com/ultraworkers/claw-code | commit `08106b0c3771ef5b4a5aa176acccd460e88b7325`（2026-08-16） |
| 3 | Pi / pi-mono | https://github.com/badlogic/pi-mono | commit `9841914c71a74d81abe07f751aefd271fd924e63`（2026-09-05） |
| 4 | DeepSeek Harness (dsh) | https://github.com/deepseek-ai/deepseek-harness | commit `d347e703908d0406b7a7ef80e3a0e594d86b2215`（2026-09-05）；本机安装 0.1.2-alpha.5 验证发行形态 |
| 5 | OpenAI Codex | https://github.com/openai/codex | commit `ddf04ad26789d040f9ef6a96736f76602e35a6cc`（2026-09-05） |
| 6 | OpenCode | https://github.com/anomalyco/opencode | commit `e2894562f8ba943d72172d10b727c24d5f650c16`（2026-09-05） |
| 7 | Hermes Agent | https://github.com/NousResearch/hermes-agent | commit `d20a8e44755a8e999a2e816ef9f458c438d3e17c`（2026-09-05） |
| 8 | CL4R1T4S（行为语料库） | https://github.com/elder-plinius/CL4R1T4S | commit `93b0ae6fb503db6642e58f9d6352db973a900cdc`（2026-09-01）——**UNTRUSTED 语料**，仅行为模式参照，不单独成 Harness 列 |

### 0.2 各家架构范式分类

8 个对象可归为七种范式 + 一类语料（一家可能跨范式）：

1. **闭源行为基准**（Claude Code）：运行时闭源，解剖只能基于"公开接口面"（文档/CLI/hook 事件/CHANGELOG）。它的价值不是代码可抄，而是**对外行为语义最完整**（终止判据、permission 语义、hooks 事件面、子代理/验证 loop），是自研 Harness 与 benchmark 的"行为基准线"。
2. **Rust parity / 行为对齐重实现**（Claw Code）：以"Claude Code 行为对齐"为目标的公开 Rust 实现 + mock-parity 测试体系（12+ 确定性场景、verification-map、g004 契约校验）。价值在**"对齐方法论"**：把上游行为写成可执行场景，而不是抄源码。
3. **极简 Agent Kernel**（Pi / pi-mono）：8 个最小工具 + TypeBox schema + 会话 Entry 树 + **无工具级权限系统**（只有项目信任门）。价值在**"内核保持小的取舍纪律"**与单 schema 贯穿定义/校验/提示。
4. **插件树 + 事件溯源内核**（DeepSeek Harness）：一切皆插件（Cordis 插件树），会话=仅追加类型化事件日志，loop 保持唯一可替换的最小核，其余全部挂在类型化事件扩展点。价值在**"模型可见⟺已记录"的可重建性**与瀑布式中间件语义——与自研目标（可组合、可审计）最同构的一家。
5. **Rust 运行时 + 产品级工程**（Codex CLI）：Rust workspace、world-state 基线+diff 上下文、线程即会话的代理树、沙箱"只读根+可写覆盖+受保护子路径"模型、execpolicy 规则引擎、`codex review` 受限评审子代理。价值在**工程深度与确定性沙箱/审批/恢复**。
6. **产品级 TS + Client/Server**（OpenCode）：Effect-TS + AI SDK + SQLite 消息/parts 双层存储 + EventV2 SSE 事件总线 + 插件 (input,output)=>output 变换链。价值在**消息即数据的产品化形态**（UI/回放/审计同一存储）与 doom-loop 防护、invalid-tool 自修复等健壮性件。
7. **自学习单体 Agent**（Hermes）：Python 单体大 agent；两条铁律——per-conversation prefix cache 神圣 + core 窄腰；记忆=MEMORY.md/USER.md 冻结快照；`/learn`+curator 技能生命周期；每轮 background_review 判定该学什么。价值在**学习闭环与缓存纪律**。
8. **行为语料库**（CL4R1T4S）：无代码，26 个产品目录的 prompt 快照，是"输入侧行为模式"的矿藏（提取出 15 条跨产品共识，已进各研究文档的行为要点），但不可信、不可执行，只允许经 Parser→Behavior Extraction→Review→Behavior IR 管道进入自研（任务书第十八节）。

### 0.3 总体结论：对自研 Harness 的启示

综合三家以上结论（详见各章与 comparison.md 决策）：

1. **差异主轴一：会话真源形态**。Claude（JSONL 转录）→ Pi（Entry 树，每轮重放）→ Claw（全量 transcript 重发）→ OpenCode（消息+parts SQLite，每轮全量读库重排）→ Codex（rollout JSONL + 基线/diff）→ **DSH（仅追加事件日志，历史=派生）**。自研选择：事件日志为单一真源 + surface 投影派生模型历史（与 H01/H03/H09 决策一致），这是 Evaluator/回放/审计的地基。
2. **差异主轴二：组合方式与扩展语义**。Claude（闭源 + hook 事件外露）vs DSH（插件树，连 loop 都可替换）vs OpenCode/Hermes（插件/钩子在进程内）vs Pi（内核最小、能力靠扩展包）。自研选择：内核薄、单一权威 loop、扩展=类型化事件扩展点 + waterfall 中间件（"不调 next() 即短路"），不并存两套 hook API。
3. **差异主轴三：安全边界落在哪**。Claude/Codex/DSH（OS 级沙箱 + 权限/审批分层，Behavior Safety 与 Runtime Safety 分离）vs Pi/OpenCode（无 OS 沙箱，权限/信任即边界）vs Hermes（本地审批 + env 清洗，真隔离外置远程后端）。自研选择：默认拒绝 + 可审计 + fail-closed 的组合；执行隔离必须是 OS 级边界（各家共识：Behavior Safety 管不住任意子进程）；容器/远程作为同级提供方 seam 而不是后期补丁。
4. **四条跨家共识，可直接进 Policy/Event 设计**：(a) deny 规则不可被更细 allow 豁免、deny→ask→allow 先匹配、危险集合任何模式不自动放行（Claude/Claw/DSH 收敛）；(b) 完成语义必须外部化（verification loop / 独立 evaluator / 机械自检），干活模型不能自证完成；(c) prefix cache 是默认工程约束，动态内容往"追加到会话层"方向放；(d) 工具输出源头限流/截断/溢出落盘，比压缩更优先。
5. **对 Behavior IR 的最大启示**：没有哪家把"行为"做成显式 IR——行为散落在 system prompt 段落（闭源各家）、指令文件层级、hook 契约、权限规则、compaction 语义中。CL4R1T4S 证明 prompt 侧行为高度可归纳（跨产品一致性极高：工具调用纪律、代码改动纪律、完成门禁、诚实性条款）。这正是 Behavior IR（保存"该怎么行为"而非"某家 prompt 写了什么"）成立的前提。

---

## H01 Agent Loop

### 逐家实现位置与核心流程

**Claude Code**（闭源，公开面=how-claude-code-works/SDK Agent loop/Glossary）
一次任务 = gather context → take action → verify results 三阶段融合循环；turn = 一次模型往返，模型产出**不含 tool call 的纯文本即停**（SDK `ResultMessage` / `Stop` hook）。每轮请求按"system 层 → project context 层 → conversation 层"三层前缀缓存排序；只读工具并发、Edit/Write/Bash 串行；Esc 中断在飞工具并 steer-in-flight。交互模式无默认轮次上限（靠模型收尾），非交互 `claude -p --max-turns`、Agent SDK `maxTurns`（只计 tool-use 轮）、`--max-budget-usd` 按花费封顶。Retry：rate limit/overloaded 退避、fallback model chain、thrashing 保护（连续压缩无效即停）。

**Claw Code**（`rust/crates/runtime/src/conversation.rs` 的 `ConversationRuntime::run_turn()` L325-531）
一次 `run_turn` = push 用户消息 → stream 合成 assistant → 无 ToolUse 即终止；否则逐工具走 PreToolUse hook → 权限 → 执行 → PostToolUse → tool_result 回灌 session，直到无待执行工具或超出 `max_iterations`。运行时抽象成可注入 `ApiClient`（stream）/`ToolExecutor`（execute）两个 trait，测试可插桩；每轮（含终止轮）落盘后 `maybe_auto_compact()`；compaction 后下一轮先做 session-health 探针，失败拒绝该轮。缺点：`run_turn` 只执行单个用户轮，REPL 持续性（斜杠命令/后台/approve）全在 CLI 层。

**Pi**（公开层 `packages/agent/src/agent-loop.ts` 的 `runAgentLoop`/`runLoop`；新一代 harness 层 `harness/runtime/lane.ts` 2012 行主状态机 + `drive.ts` 家族）
双层 while：外层跟 queued follow-up/steering，内层逐 tool call 直到 stop/error/aborted；turn 间 `prepareNextTurn`（压缩挂这里）、`getSteeringMessages` 支持流式期间打字排队。harness 层把一次 run 做成**检查点化操作状态机**：admission → checkpoint → generation（可中断/重试/deferred 续生成）→ tools → boundary 提交 → reconcile；事件全量发 `HarnessEvent`，drive 从 durable checkpoint 恢复崩溃 run。缺点：同一产品并存两套 loop（公开 Agent 与 Lane/drive），迁移期语义双轨。

**DSH**（`packages/core/agent-loop`：`src/agent.ts` 的 `ReactLoopAgent`、`src/tool-calls.ts`、`constants.ts` `DEFAULT_MAX_PARALLEL_TOOL_CALLS=10`）
"步骤" = 一次模型请求 + 它调用的工具；"轮次" = 零或多个步骤。驱动器在轮次边界**先开持久轮次、再原子领取 next-step 输入 + 一条排队消息（Inbox.claim）**；`agent/pre-step`（waterfall）reject/enter 决定消息是否进入；`agent/turn-stopping`（serial）收尾、可强制再执行一步。**无内置轮次预算**（README 明示由扩展点施加）；取消协作式（`agent.cancel()`，未分发工具给 ABORTED_BEFORE_DISPATCH 合成结果）；`llm-retry` 先持久 `llm/retry` 事件再等待（先持久后等待铁律）。

**Codex**（`codex-rs/core/src/session/turn.rs` 的 `run_turn` 2881 行、`tools/parallel.rs` `ToolCallRuntime`）
采样循环内：模型输出工具调用→立即持久化 item→执行 future 推入 `FuturesOrdered` 并行执行→结果 `FunctionCallOutput` 回写历史→`needs_follow_up` 驱动下一轮。终止由 `run_turn_stop_hooks`（Stop hook 可 stop / block+注入 continuation prompt 继续，`stop_hook_active` 防重入）裁决。**无显式 max turns**：靠 token 水位（`context_window_token_status`）+自动压缩滚动窗口兜底（注释明示"压缩能把 token 压下去就不怕死循环"）。单次采样内 tokio 取消令牌（AbortOnDropHandle）；重试指数退避、连接级重试计数翻倍。

**OpenCode**（`packages/opencode/src/session/prompt.ts` 的 `runLoop` L1052 起；`session/processor.ts`；`session/run-state.ts`）
一个用户回合内 `while(true)` 可多次 LLM 调用（每次生成独立 assistant message 直到 finish 非 tool-calls/error/blocked）；每轮先处理 pending compaction/subtask 任务 → 取 agent（mode/steps/permission）→ `SessionProcessor` 把 LLM 事件流写成 parts 落库 → 返回 `"compact"|"stop"|"continue"` 决定 break 或带工具结果续跑。`SessionRunState` 保证每 session 同时一个 runner（busy 再 prompt 报 BusyError）；**doom-loop 检测**（同工具同输入 ≥3 次→转权限询问）；retry 指数退避+抖动+尊重 Retry-After（默认 5 次）。

**Hermes**（`agent/conversation_loop.py` 的 `run_conversation` + `turn_facade.py` + `turn_*.py` 阶段文件家族）
单轮驱动 = build_turn_context（stdio 守卫、restore-or-build 系统提示、idle/preflight 压缩、pre_llm_call hook）→ model 调用（retry/fallback/rate-limit guard）→ tool dispatch → 迭代直到 finalize；`iteration_budget`/`interrupt_control`/`empty_response_guard` 等健壮性件齐全；跨进程会话有 durable turn lease + 刷新线程 + 看门狗（`turn_facade_lease`、`periodic_scheduler.py` 合并 ~130 子代理心跳）防双写。

### 共同抽象（最小公共核）

- **Loop 形状**：step = 一次模型请求 + 其工具调用；user turn = 零或多个 step（除 Claw/Pi 的"单个用户轮即一次 run_turn"窄接口外，各家实际都支持 turn 内多 step，DSH/OpenCode 显式建模）。
- **终止语义两层**：语义层 = "无未决 tool_call 即停/纯文本即停"（Claude/Claw/DSH/OpenCode 收敛）；机械层 = 轮次/花费预算（Claude max-turns/budget、Hermes iteration_budget、DSH 交扩展点、Codex 靠压缩兜底）。**两层都要有**。
- **工具并行纪律**：只读并发 + 写/独占串行（Claude/Codex 读写锁/DSH exclusive 屏障一致）；并行度受滚动池约束。
- **重试/恢复共性**：rate_limit/overloaded/server/timeout 可重试（指数退避+抖动），auth/model 错误不重试；先持久后等待；压缩后健康探针；崩溃恢复 = 从持久化重建（Pi checkpoint / Codex rollout / DSH 重放+合成 interrupted 关闭器）。
- **对 Event Spec 的输入**：自研事件词汇应与 loop 决策点一一对应——`turn/start`、`step/start`、`assistant/attempt|message`、`tool/call|result`、`step/end`、`turn/end{kind:success|error|interrupted|budget}`、`agent/pre-step`（reject|enter）、`agent/turn-stopping`（serial 决策点）、`llm/retry`（先持久）、`agent/request-error`（溢出转压缩）。

---

## H02 System Prompt

### 逐家实现位置与核心流程

**Claude Code**（闭源；公开可配置面=`--system-prompt/-file` 整体替换、`--append-system-prompt`、output-styles/、`--exclude-dynamic-system-prompt-sections`、subagent frontmatter）
注入顺序：Base（核心指令+工具说明+响应格式，~4.2K token，先载且用户不可见，含动态 git/环境段）→ auto memory（前 200 行/25KB）→ 环境 → MCP 工具名（默认延迟）→ skill 描述索引 → 用户/项目 CLAUDE.md → 用户 prompt。**CLAUDE.md 以 user message 注入而非 system prompt**（官方明确行为差异）；动态段移进消息层保 prompt cache；output style 会话启动时固定（中途改不生效）。

**Claw Code**（`rust/crates/runtime/src/prompt.rs` 的 `SystemPromptBuilder` L155-263、`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`；`tools/src/lib.rs` `build_agent_system_prompt`）
`Vec<String>` 分节拼接：intro → Output Style → system → doing-tasks → actions → 动态边界 → 环境 → 项目上下文 → 记忆指令 → config → 追加段；`render()` join。指令文件优先级 CLAUDE.md > CLAW.md > AGENTS.md，发现边界 = git root（无 git 仅 cwd）；内容去重（稳定哈希）+ 预算截断；git 仓库注入 status/diff/log 快照。是"向 Claude Code 靠拢的简化分节"，非字节级对齐。

**Pi**（`packages/coding-agent/src/core/system-prompt.ts` 的 `buildSystemPrompt`，168 行；`core/resource-loader.ts`）
单一长字符串：角色一句 → `Available tools:`（按注册工具裁剪）→ Guidelines **随工具集联动**（有 grep/find/ls 就不鼓励 bash 探索）→ pi 自文档按需读 → context 文件（AGENTS.override.md/AGENTS.md/CLAUDE.md 祖先逐层拼接去重、git worktree shadow 处理）→ 技能 XML 块 → `Current working directory: <cwd>`。整个 prompt 是普通字符串，SDK/测试可整体替换（evals `transformSystemPrompt`）。

**DSH**（`packages/core/system-prompt`：`ctx.systemPrompt.section()/assemble()` + `system-prompt/assemble` waterfall；`packages/context/agent-instructions`；`packages/preset/agent-presets`）
插件注册片段（`section({name, order, text|fn})`），组装按 order+名称排序后跑 `system-prompt/assemble` waterfall（监听器可改写、`complete` 段强制唯一）；`{{variable}}` 插值；scoped section 遮蔽 global；**工作区指令基线作为持久 user 消息注入**（带来源、宽泛→具体、比 system prompt 更轻、可压缩可回放）。

**Codex**（`codex-rs/core/src/session/world_state.rs` 组装 + `context/world_state/*.rs` 每 section 一文件：ModelInstructions/Personality/TokenBudget/Realtime/AgentsMd/Permissions/…）
Base（模型自带 base instructions，可配置覆盖并记录 provenance）→ model-specific → 项目 AGENTS.md（根→cwd 逐级收集、AGENTS.override.md 本地覆盖）→ 动态 world_state section。完整注入一次持久化为**基线**，每步只渲染 diff；model system prompt 渲染文本视为 UNTRUSTED，只提取 section 行为模式。

**OpenCode**（`session/system.ts` + `session/prompt/*.txt` 按供应商模板：anthropic/gemini/gpt/codex/kimi…）
`[env, instructions(AGENTS.md), mcp_instructions, skills块]`；模板按 model.api.id 匹配（claude→anthropic.txt…缺省 default.txt）。指令注入 = global AGENTS.md（+~/.claude/CLAUDE.md）→ 项目上溯**第一个** AGENTS.md/CLAUDE.md → config.instructions（文件+http URL 5s 超时）。plan→build 切换注入 SessionReminders（plan.txt 等）。

**Hermes**（`agent/system_prompt.py` + `prompt_builder.py` + `SOUL.md` 身份）
**三层拼接**（`\n\n` join）：stable（identity/guidance/env hints/coding brief）→ context（workspace 快照/caller system_message/context files）→ volatile（skills index/memory/USER.md/时间戳）；**每会话构建一次、跨轮复用**，唯一重建触发是 context compression（保住上游 prefix cache）；写系统提示的斜杠命令默认延后（`--now` 才立即）。

### 共同抽象

- **组装纪律 = 分层 + 按需 + 缓存敏感**：稳定身份段（少变）在前、项目指令中、volatile 索引（技能目录/记忆/时间戳）在后且尽量外移；变的东西进消息层不进前缀（Claude/DSH/Hermes 收敛，Hermes 最极端：每会话一次）。
- **注入即数据**（DSH 语义 + Claude 行为）：CLAUDE.md/AGENTS.md/记忆/技能目录 = 带来源的持久 user/message，可压缩、可回放、可审计，且把"指令是建议非硬约束"显式化；强制力交给权限/沙箱（H07）。
- **指令文件发现与优先级**：作用域 = git root → cwd；发现优先级各家略异（Claw CLAUDE.md>CLAW.md>AGENTS.md；Codex/OpenCode 项目层只取一个/逐级；Pi 祖先逐层去重），共性 = 越靠近 cwd 越具体、宽泛先丢具体后截、去重 + 字节预算。
- **对 Behavior IR 的输入**：组装 = `sections[] 按 order 升序 join`；stable/context/volatile 三层分层；注入顺序、转义规则（`</system-reminder>`、XML description）、`inject_as_user_message: true`、指令发现顺序可配。行为（身份/语气/纪律）与内容（项目规则/记忆/技能）分离存储。

---

## H03 Context Engine

### 逐家实现位置与核心流程

**Claude Code**（闭源；公开面=《Explore the context window》《prompt-caching》`/context` `/cost`）
System 每次请求带（缓存）；User/历史每轮追加；启动注入常驻层（CLAUDE.md 链、MEMORY.md 前 200 行/25KB、skill 描述索引、工具名）；重内容**按需加载**（skill 正文、子目录 CLAUDE.md 与 `paths:` 规则在首次接触匹配文件时、MCP schema 首次调用、topic 文件用文件工具读）；bash/任务输出源头截断（`bashOutputMaxChars`）存文件给预览+路径。上下文压力处理 = 软上限 + 三层截断（清 tool 输出 → summarize → thrashing 保护停止）。无 RAG 子系统。

**Claw Code**（无独立 context engine；= prompt.rs 项目/记忆上下文 + git 快照 + session.rs 全量 transcript + `api/src/prompt_cache.rs`；外挂 `claw-rag-service` crate）
每次请求重发 `system_prompt + session.messages` 全量 transcript（无裁剪中间层，token 增长靠 compaction 收敛）；工具输出源头限流（bash 16KiB、文件读 10MiB 上限）；PromptCache 侧做缓存命中/破裂统计（仅 Anthropic 路径）。RAG 服务与主 runtime 解耦（未见核心接线证据）。

**Pi**（coding-agent `core/agent-session.ts` + `core/messages.ts` AgentMessage 扩展；harness 层 `harness/runtime/transcript.ts` `readBoundedContext` + JSONL/SQLite backend）
消息在 Agent context 内累积，每次 LLM 调用边界经 `convertToLlm` 过滤/转成厂商消息；会话以 Entry 树持久化，每轮从当前分支 tip 重放（含 compaction 摘要与 `firstKeptEntryId` 之后消息）；token 估算近似（`estimateContextTokens`/`calculateContextTokens`）；工具输出有界截断 + 溢出落盘回读。无 RAG/向量检索。

**DSH**（`packages/core/session` `deriveMessages()` + `request/context`；`packages/llm/token-meter`；`packages/spill/*` `maxInlineBytes: 50000`）
会话日志单一真源，`deriveMessages()` 从三种 surface 事件（user/message、assistant/message、tool/result）按序投影出模型历史（surface 节点缓存、compaction replace 时重建）；工具定义按允许列表投影成 ToolSchema[]（回调/超时绝不上行）；指令/skill 目录/工具输出各有显式字节预算与截断；spill 把 >50KB 工具输出外置文件。注入上下文与普通提示共用一条**带 source 的 user/message** 词汇。

**Codex**（`core/src/session/step_context.rs` + `context_window.rs`/`token_budget.rs` + `context_manager/history.rs`）
每步（step）先捕获 StepContext（上下文+工具+权限+环境）再构造请求（保证"广告的工具"与"执行的工具"同视图）；`clone_history().for_prompt(modalities)` 按输入模态过滤图像；world state 基线持久化 + 每步 diff；`context_window_token_status` 区分 active/auto_compact_scope/full limit；压缩后再超窗则 `remove_first_item`（从头丢、保前缀缓存）。

**OpenCode**（`session/message-v2.ts` 消息→ModelMessage 转换 + `filterCompacted`；`session/session.ts` SQLite CRUD）
消息 = user/assistant message + parts（text/reasoning/tool/step-*/patch/compaction…）**双层落库**；每轮 `filterCompacted` 读全消息按 compaction 关系重排（compaction-user → summary → retained tail → continue-user）再转 AI SDK ModelMessage；已完成 tool 结果默认 2k 字符级截断；不同模型切换丢弃 reasoning 元数据；token 估算近似（`Token.estimate`）；预算 = usable = input 上限 - reserved（默认 20k 或 maxOutputTokens）。

**Hermes**（`agent/context_engine.py` `ContextEngine` ABC，默认 `agent/context_compressor.py` 的 ContextCompressor）
ABC 生命周期 `on_session_start → 每响应 update_from_response → 每轮 should_compress/compress（带理由）→ on_session_end`（仅在真实会话边界触发，绝不每轮调）；压缩决策可被宿主查询原因，preflight 与真 usage 分开评估；`sanitize_memory_context` 对跨 egress 记忆文本脱敏 + 头尾截断（6000 字符上限）。

### 共同抽象

- **真源唯一**：模型可见输入必须能由持久记录重建（DSH 最强：违反即运行时不变式失败；其余各家会话/转录都声称可重放）。这是 Event Spec / Evaluator 的审计地基。
- **加载策略两层**：启动注入常驻层（身份/指令链/技能目录/工具名）+ 按需加载重内容，按需点绑定"首次接触事件"（读/写命中文件、首次调用 MCP）。
- **输出管理三级**：源头限流（bash/read 截断）→ 溢出落盘给预览+路径 → compaction 兜底；**截断先于压缩**。
- **污染防护**：lossless-JSON 校验、外部内容转义/模式扫描、注入内容声明"非用户消息"（Cline/Windsurf 语料同款）。
- **无内建 RAG**：四家研究均无内建向量检索；等价物 = grep/glob/read + 会话全文检索（opt-in）。
- **对 Event Spec 的输入**：注入通道 = `agent.inject()` 队列化 → 下个 pre-step 作为带 source 的 user/message 进入，不唤醒驱动器；surface 投影与 compaction replace 的关系（compaction/summary + surfaceOp:replace）。

---

## H04 Compaction

### 逐家实现位置与核心流程

**Claude Code**（闭源；公开面=context-window "What survives compaction"、hooks PreCompact/PostCompact、SDK `compact_boundary`）
上下文接近窗口上限自动压缩（/compact 可带焦点指令）；压缩 = 先清旧 tool outputs 再整段 summarize；摘要请求复用相同 system+tools+历史（缓存冷时最贵）。**保留清单**：用户请求与意图、关键技术概念、检查/修改过的文件与代码片段、最多 5 个最近修改文件（重读）、调用过的 skill 正文（≤5000 token/个）；CLAUDE.md/auto memory/MCP 启动内容压缩后自动重载。同一 session 原地替换（/clear 才是新会话）；auto-compact thrashing 连续无效即停报错。

**Claw Code**（`rust/crates/runtime/src/compact.rs` + `conversation.rs` `maybe_auto_compact()` L571）
触发 = 累计 `input_tokens ≥ auto_compaction_input_tokens_threshold`（默认 100_000，env 可调）；保留最近 4 条逐字（`preserve_recent_messages=4`、`max_estimated_tokens=10_000`），旧消息**启发式 summarize（非 LLM）**归纳成 System 续接消息（preamble+Summary+保留尾部提示）；边界**不拆散 tool_use/tool_result 对**（防 OpenAI-compat 400 orphaned tool message）；压缩后 session-health 探针失败拒绝该轮。token 估算 `estimate_message_tokens` 是粗略启发。

**Pi**（coding-agent `core/compaction/compaction.ts`（865 行）+ harness 层 `harness/compaction/compaction.ts`）
触发 `contextTokens > contextWindow - reserveTokens(16_384)`、`keepRecentTokens(20_000)` 保留尾部；切点从最新消息倒走累计 token，只允许在 user/assistant/bashExecution/custom 边界切（**禁止切在 tool result 中段**、大 turn 走 split-turn 双摘要）；cut 点前消息序列化（附上次 summary+readFiles/modifiedFiles）交一次**独立 LLM 调用**生成结构化摘要（fresh routing session、禁 prompt-cache 写入）；追加 `CompactionEntry{summary, firstKeptEntryId}`；重复压缩从上次保留边界续算不漏幸存消息。

**DSH**（seam `packages/compaction/compaction` + 后端 `compaction-basic`（`region.ts`/`summarizer.ts`）+ `compaction-tool-result-pruner`）
三入口：自动压力（`agent/pre-step` 监听器，默认 `thresholdRatio: 0.8 × contextWindow`）、溢出恢复（`CONTEXT_WINDOW_EXCEEDED` 先压再试 `maxOverflowRetries: 1`）、手动 /compact。压缩**最旧"平衡"surface 段**（tool call/result 必须配对、可不整轮），保留尾部逐字（`retainRatio: 0.16`/`retainTokens`），旧段替换为 `<compacted-summary>` 框定的 user/message（surfaceOp: replace），原始摘要全文保留在仅日志的 `compaction/summary` 事件；摘要请求复用上次请求热前缀（KV Cache 友好）；`compaction/start`(锁) → 摘要 → summary+replace → **恰好一次 `compaction/end` 事务化**；压缩不新建会话。

**Codex**（`codex-rs/core/src/compact.rs` + `compact_remote_v2.rs` + `compact_token_budget.rs`）
采样前预压缩 + 采样后 `should_roll_over`（MidTurn）+ 手动 /compact；**保留全部用户消息原文**（带身份）、压缩掉 assistant 与工具明细；摘要+用户消息重建历史、重注入 world state、推进 auto-compact 窗口号；压缩中再超窗从历史头部删项重试（保前缀缓存）；同会话开新"上下文窗口"非新会话；PreCompact/PostCompact hooks 全程可介入。

**OpenCode**（`session/compaction.ts` + `overflow.ts` + `agent/prompt/compaction.txt` 隐藏 compaction agent）
每 step-finish 后 `SessionSummary.summarize`（diff stats），`isOverflow` 为真 → 注入 compaction part → 下一轮 `compaction.process`：选 head/tail（保留最近 N turn ≤ `preserve_recent_tokens`，默认 min(15k, max(2k, usable*25%))），旧历史序列化文本喂隐藏 compaction agent 产出结构化 summary；随后**重放**（overflow 场景从最后一个非 compaction user 消息重放）或 **auto-continue**（合成 "Continue if you have next steps…" 带 `compaction_continue` 元数据）；`prune`：旧完成 tool 输出在 PRUNE_PROTECT(40k) 保护后、超 PRUNE_MINIMUM(20k) 时清空标 `compacted`（保留 skill 类输出）。

**Hermes**（`agent/context_compressor.py` 主压缩 + `micro_compaction.py` + `native_compaction.py` + `compression_facade.py`）
默认自动压缩 = **aux 廉价模型**把中间轮次摘要成 handoff summary、头尾受保护、迭代式摘要 + token 预算 tail + **先修剪 tool 输出** + 按比例缩放预算；摘要含一条持久化提醒（MEMORY.md/USER.md 永远权威、勿重做已述工作）；`micro_compaction` 默认关（每轮重写前缀破坏 cache）；`native_compaction` 对 gpt-5.6 直连后端启用服务端 `context_management=compaction`，本地压缩器保持武装兜底；压缩在超时围栏 + commit fence 下对快照运行。

### 共同抽象

- **触发三入口**：压力阈值（0.8×window 或 input_tokens≥100k 或 token 水位）、溢出恢复（先压再试）、手动（可带焦点）。
- **区域语义**：最旧段平衡替换 + 尾部逐字保留 + **tool call/result 配对不拆** + 用户消息原文尽量保留（Codex 全保留、Claude 保留清单）——"摘要人话 + 重读文件 + 用户意图不丢"。
- **事务与缓存**：先记账后执行、恰好一次 end、崩溃可检测（DSH 锁 / Claw health 探针）；摘要请求复用热前缀（缓存冷时最贵）。
- **续作语义**：压缩后 auto-continue/重放提示（OpenCode），摘要里声明"记忆文件权威勿重做"（Hermes）。
- **对 Event Spec 的输入**：持久事件 `compaction/start|summary|end`、`surfaceOp: replace(start,end)+sourceEventSeqs`、tool-result-pruner 修剪事件；行为 IR 侧 = summarizer 必列清单（用户意图/改动文件/未完成任务/当前工作/关键代码）。

---

## H05 Tool System

### 逐家实现位置与核心流程

**Claude Code**（闭源；公开面=Tools reference + Agent SDK custom-tools）
40+ 内建工具（Read/Edit/Write/Glob/Grep/Bash/WebSearch/WebFetch/Agent/Skill/Task*/TodoWrite/Workflow/AskUserQuestion/ToolSearch…），canonical name 一套规则通吃 permission/hook/subagent；dispatch = model tool call → permission（deny→ask→allow 先匹配）→ PreToolUse hook → 执行（读并发/写串行）→ PostToolUse/PostToolUseFailure → PostToolBatch → result 作 user message 回模型。MCP 命名 `mcp__<server>__<tool>`、动态更新、ToolSearch 延迟加载 schema。

**Claw Code**（`rust/crates/tools/src/lib.rs` ~10.8k LOC 单体 + `runtime/src/file_ops.rs` + `runtime/src/mcp_tool_bridge.rs`）
工具面按 Claude Code 命名暴露 40+ spec，每 spec 携带 `required_permission`；`GlobalToolRegistry`（builtin+plugin+runtime）；文件工具 canonical 化拒绝 `../`/symlink 逃逸、读写 10MiB 上限、NUL 二进制检测；bash 输出 16KiB 截断。多处 registry-backed 近似或桩（AskUserQuestion pending、RemoteTrigger stub）。

**Pi**（定义/契约 `packages/agent/src/types.ts` + TypeBox schema；coding-agent 内置 `core/tools/{bash,powershell,read,write,edit,grep,find,ls}.ts` **共 8 个**）
工具 schema 由 TypeBox 定义贯穿校验/提示/UI；执行按 ToolExecutionMode：sequential 逐个 / parallel 先全 preflight（before_tool 可 block）再并发执行允许者；文件变更互斥队列防并行编辑竞态；bash 输出有界截断 + 完整落盘路径；工具分"定义(schema+prompt)"与"pluggable operations"两层（BashOperations.exec 可覆盖以重定向 SSH/容器/Gondolin）。无 MCP 客户端抽象。

**DSH**（`packages/core/tools`：`ctx.tools`、`defineTool`、`ValueSchemaSpec`、`tools/*` 事件；`packages/core/scope`；工具包 fs/shell/web/MCP/LSP/subagent/skill/session/jobs/goal/todo/workflow… 62 条目）
统一流水线 `tool/call → tools/pre-execute(waterfall, allow|deny|ask) → ToolGuard(单调否决) → tools/execute → 工具体执行 → output.render 投影 ContentBlock → tools/post-execute(accept|block+feedback) → tools/result(冻结权威结果) → tool/result 会话事件`；defineTool 用类型化 schema 同时推导 TS 类型/JSON Schema/校验参数与输出；`ToolExecutionMode = parallel|exclusive`（独占屏障）+ `maxParallelToolCalls` 滚动池；canonical value 仅执行期存在（value 不入日志）。

**Codex**（`codex-rs/core/src/tools/{registry,router,parallel,orchestrator,sandboxing}.rs` + `codex-tools` + `tools/handlers/*`）
工具集偏小（无独立文件工具，文件读写靠 exec_command/apply_patch + view_image/update_plan/tool_search/request_permissions 等）；`ToolRegistry` 用 IndexMap、`register_trusted`（内置，重名 panic）vs `register_external`（插件，exec_command/shell_command 保留名拒绝覆盖、冲突记录 first_collision）；dispatch 全走 pre_tool_use hooks → handler → post_tool_use hooks → 生命周期通知 → `ResponseItemEnvelope`；MCP 每步从 `mcp.tools()` 快照注入、按 mention 启动服务器。

**OpenCode**（`packages/opencode/src/tool/`：tool.ts/registry.ts/truncate.ts + 各工具；`session/tools.ts` 包成 AI SDK tool()）
`Tool.define(id, Effect<Def>)`，Def={id,description,parameters,execute(args,ctx)→ExecuteResult{title,metadata,output,attachments}}；参数 schema 解码失败 → `InvalidArgumentsError`（让模型改写）；输出经 `Truncate.output` 截断（超限落盘返回 outputPath+truncated）；**找不到工具名转 `invalid` 工具**并传回错误（AI SDK repairToolCall 兜底）；registry.tools() 按模型/agent 过滤（websearch 限支持 provider、gpt 系列用 apply_patch）；Permission.visibleTools/disabled 隐藏被 deny 工具。

**Hermes**（`tools/registry.py` `ToolRegistry` 文件 import 即注册 + `model_tools.py` + `toolsets.py` + `agent/tool_executor.py`）
核心工具**每轮全量随请求发送**（故工具面受"窄腰"纪律约束，能力尽量放 CLI+skill/插件/MCP）；统一注册表声明 schema/handler/toolset/可用性 check_fn（缓存化避免每轮重算）；服务可门控工具、插件工具经注册发现；`tools/transports/hermes_tools_mcp_server.py` 把 Hermes 工具面以 MCP server 暴露。

### 共同抽象

- **最小内建集哲学**（Pi/Hermes/Codex 收敛，Claude/Claw 是大工具面反例）：内建每多一个 = 每轮 token 成本 + 安全面；扩展通道（MCP/Operations 注入/插件工具）保证能力可加不进核心。
- **schema 驱动**：单一 schema 源推导类型 + JSON Schema + 校验（Pi TypeBox / DSH ValueSchemaSpec / OpenCode effect Schema+zod 桥）；参数错回模型自修复（OpenCode invalid 工具是显式设计）。
- **统一可插拔执行管线**：pre/guard/execute/post/result，guard 单调只能收窄、exclusive 排序屏障、结果 render 与执行值分离（DSH 最完整）。
- **文件边界守卫**：canonical 化防 `../`/symlink 逃逸、读写上限、NUL 二进制检测（Claw 成体系）。
- **对 Policy Spec 的输入**：工具执行链 = `tool/call → pre-execute(waterfall allow|deny|ask) → guard → execute → post-execute(accept|block) → result`；并发模式 parallel/exclusive；`mcp__<server>__<tool>` 命名；错误契约两类（参数错回模型 vs 工具失败终结）。

---

## H06 Hooks / Middleware / Events

### 逐家实现位置与核心流程

**Claude Code**（`hooks.md` + settings.json user/project/local/managed + 插件 hooks.json）
35+ 事件三节奏（每会话 SessionStart/SessionEnd；每轮 UserPromptSubmit/Stop/StopFailure；每 tool call PreToolUse/PermissionRequest/PostToolUse/PostToolUseFailure/PostToolBatch；子代理/压缩/模型切换/工作区），matcher（精确名单或 JS 正则）+ handler **五形态**（command/http/mcp_tool/prompt/agent）。JSON 输入输出契约（PreToolUse→permissionDecision allow|deny|ask|defer + updatedInput；PostToolUse→additionalContext/updatedToolOutput）；exit code 语义（0 无决策、2 阻止给 stderr）；async hook + asyncRewake 后台唤醒模型。

**Claw Code**（`rust/crates/runtime/src/hooks.rs` + conversation.rs 调用点 + `lane_events.rs` + telemetry SessionTracer）
仅 PreToolUse/PostToolUse/PostToolUseFailure 三个工具生命周期事件（无会话级事件）；hook 以 shell 子进程执行、输出 JSON stdout 契约：`systemMessage`/`reason`/`continue:false`/`decision:"block"` 追加消息或拒绝、`hookSpecificOutput{additionalContext, permissionDecision:allow|deny|ask, permissionDecisionReason, updatedInput}` 权限覆盖/改写输入；PreToolUse 结果决定权限路径；非法 JSON 结构化诊断并透传 raw stdout。`lane_events.rs` LaneEvent（started/blocker 等）面向编排。

**Pi**（coding-agent 扩展事件 `core/extensions/types.ts` 30+ + `core/event-bus.ts`；harness 层 `harness/hooks.ts` HookRegistry + `agent-harness.ts` HookMap）
事件面 30+：tool_call 输入**可变**可 block、message_end/tool_result 可改写结果、before_provider_headers 可改厂商请求头；harness HookMap 与公开 Agent before/after 钩子**两套并存**；HarnessEvent 全联合 + LaneSnapshot 快照 + reducer 供前端增量；错误隔离进 handler_error。

**DSH**（vendor Cordis `ctx.on/emit/waterfall/parallel/serial/bail` + 产品事件词汇 agent/*、tools/*、system-prompt/*、session/*、approval/*、skills/change、compaction/* + 外部钩子桥 `packages/hooks/hook-protocol` + `hooks-claude-code`/`hooks-codex`）
五种分发模式（emit 观察/waterfall 包装「不调 next() 即短路」/parallel/serial/bail）；**三事件域**：会话事件（持久进日志）、agent 事件（活跃 agent 实时扩展点）、能力事件；类型安全 derived-union + declaration merging；`dsh-hook-protocol` 统一 Claude Code（字面量/正则）与 Codex（未锚定正则）两方言 matcher，退出码 2 阻塞、`deny > ask > allow` 合并、hook 失败绝不崩轮次。

**Codex**（`codex-rs/hooks` crate + `core/src/hook_runtime.rs` + `hooks/config_rules.rs`）
12 事件（PreToolUse/PermissionRequest/PostToolUse/PreCompact/PostCompact/SessionStart/SessionEnd/UserPromptSubmit/SubagentStart/SubagentStop/Stop/Interrupt），9 个带 matcher；执行 = Command hooks（子进程 JSON）+ MCP hooks；同步/异步两种模式（异步结果在安全边界 drain：turn 前/采样后）；PreToolUse 可 Blocked（错误回灌）或 Continue+updated_input 改写；PostToolUse 可 block（拒绝的是结果不是执行）或改模型可见输出/注入上下文；Stop 可 block+continuation_fragments（stop_hook_active 防重入）。

**OpenCode**（`packages/plugin/src/index.ts` Hooks 接口 + `opencode/src/plugin/index.ts` Plugin.Service + EventV2 `packages/core/event.ts`）
插件 = `async (ctx, options) => Hooks`，钩子以 (input,output)=>output 变换链贯穿多插件（permission.ask、tool.execute.before/after、chat.message/params/headers、shell.env、experimental.chat.messages/system.transform、session.compacting、compaction.autocontinue、tool.definition 等）；EventV2 durable/versioned 事件带 location 路由 → GlobalBus（SSE/WS）→ TUI/App 订阅。

**Hermes**（`hermes_cli/plugins.py` PluginDispatchMixin + `plugins/plugin_loader.py` + `api_request_hooks.py` + `plugin_stream_hooks.py` + `verify_hooks.py`）
核心枚举钩子：pre_tool_call（可 `{"action":"block","message"}` 否决或改 args）/post_tool_call/transform_terminal_output/transform_tool_result/transform_llm_output/pre_llm_call/post_llm_call/on_session_start/on_session_end/pre_verify 轮末闸；内存回调按声明签名注入 payload（signature-inspect）；**流式输出钩子**每消费者独立有界队列 + 守护线程（插件永不 inline 跑在 token 路径上、队列满丢最旧）；热路径 hook 有超时上限。

### 共同抽象

- **事件分两类**：**持久会话事件**（作为会话事实进日志，供回放/evaluator/审计）与**实时扩展事件**（waterfall 决策点，供策略/插件/安全注入）——Claude 事件面全覆盖 + DSH 三事件域 + 各家 transform/block 钩子的合流。
- **分发语义**：emit（观察）/ waterfall（不调 next 即短路=决策）/ serial / parallel；guard 单调（只能收窄，防止"先放行后否决"）——这是 Policy Engine 的执行语义。
- **外部兼容桥**：hooks.json 方言（Claude 字面量/正则 vs Codex 未锚定正则）统一 matcher、退出码 0/2/其余语义、hook 失败绝不崩轮次。
- **执行纪律**：插件/钩子不 inline 跑热路径、超时上限、异步+rewake。
- **对 Event Spec 的输入**：事件词汇 = H01 的 loop 事件 + H04 的 compaction 事件 + approval/asked|decided 审计对 + skills/change + subagent/start|end + tools/pre-execute|execute|post-execute；handler 形态 v0.1 = command + mcp_tool。

---

## H07 Permission / Safety

### 逐家实现位置与核心流程

**Claude Code**（`permissions.md`/`permission-modes.md`/`security.md`/sandboxing + managed settings）
四层叠加：Permission modes（default/acceptEdits/plan/auto/dontAsk/bypassPermissions）→ Permission rules（allow/ask/deny 数组，**deny→ask→allow 先匹配生效**、裸工具名 deny 移出上下文、scoped `Bash(rm *)`）→ hooks（PreToolUse 可 deny/ask/defer 不 bypass 规则）→ sandbox + 外层隔离；危险操作任何模式（含 bypass）不自批（rm -rf /、需人交互工具、显式 ask 项）；auto mode classifier（独立小模型、**看不到 tool results** 防注入操纵）审查动作。官方明示：Behavior Safety（模型试图做什么）与 Runtime Safety（命令能碰到什么）分离，deny 规则拦不住任意子进程，要 OS 级强制开 sandbox。

**Claw Code**（`runtime/src/permissions.rs` + `permission_enforcer.rs` + `bash_validation.rs` + CLI `CliPermissionPrompter`）
模式 ReadOnly/WorkspaceWrite/DangerFullAccess/prompt + 每工具 spec `required_permission`（未注册默认 Danger）+ 规则 allow/deny/ask（`Tool(描述)` 匹配）+ `denied_tools` 无条件拒绝先于一切；决策序：denied_tools → deny 规则 → hook override → ask 规则 → allow 规则 → 模式比较；越权/ask 调 `PermissionPrompter`（CLI y/N，无 prompter 即 deny）；`check_bash` 只读命令启发式（git 子命令门控、重定向/就地改写标志/命令链拦截）。

**Pi**（`core/project-trust.ts` + `trust-manager.ts`：`~/.pi/agent/trust.json` 按 canonical 目录 true/false/null、最近祖先决策生效）
**无工具级权限/审批系统**（README/security.md 明示 "runs with the permissions of the user"）；唯一门 = Project Trust：仅当项目有需信任资源（`.pi/settings.json`/extensions/skills/prompts/SYSTEM.md/祖先 .agents/skills）且无已存决策时按 `defaultProjectTrust`（默认 ask）询问；信任=允许加载项目本地扩展/技能/提示，拒绝=跳过；AGENTS.md/CLAUDE.md 不受信任门限制；非交互模式 `"ask"/"never"` 忽略受保护资源、`"always"` 信任。

**DSH**（`packages/interaction/user-approval`：`ctx.approval`、`approval/request` waterfall、`approval/asked|decided` 审计对、`ApprovalPolicy = ask|never` + `permission-presets` + `packages/fs/fs-sandbox`）
工具调用权限链 `tools/pre-execute(waterfall) → ToolGuard(单调否决) → (ask 时) ctx.approval.request()(waterfall→应答者: UI 人类/ACP 机器) → 仅 'allowed-once' 放行，rejected/cancelled/unavailable 一律拒绝(**fail closed**)`；`never` 策略确定性拒绝且在 waterfall 分发之前服务内强制（prepend 应答者也绕不过）；Behavior Safety = 提示词段落（plan 引导/persona/指令预算，明示"引导而非强制"）；Runtime Safety = SandboxMode read-only|workspace-write|danger-full-access + 沙箱化 shell 执行器 + fs-sandbox 围栏；approval 审计事件对构成完整证据链。

**Codex**（`core/src/exec_policy.rs` + `execpolicy` crate + `tools/orchestrator.rs` + `config/permissions.rs` + `permission_profile_catalog.rs` + `guardian/*`）
审批策略 AskForApproval=Always/OnRequest/Never/Granular；`ToolOrchestrator.run` 序列 = 算 ExecApprovalRequirement（Skip/NeedsApproval/Forbidden）→ 按策略审批（Guardian 模型审查或用户 UI）→ 选沙箱执行首 attempt → 沙箱拒绝且允许升级时**二次审批（带 retry_reason）以更宽松沙箱重试**；审批缓存 ApprovedForSession（按可序列化 key）免重复问；execpolicy `.rules`（allow/prompt/forbidden、命令前缀+网络规则）→ is_dangerous_command 危险命令前缀黑名单 → 沙箱兜底；用户批准后可追加 allow 前缀规则（proposed_execpolicy_amendment）；PermissionProfile（filesystem+network+approvals+exec policy）内置 read_only/workspace_write/danger_full_access。

**OpenCode**（`packages/opencode/src/permission/`（index/evaluate/arity）+ ruleset `@opencode-ai/core/v1/permission` + `agent/subagent-permissions.ts`）
`Rule = {permission, pattern, action: allow|ask|deny}`，`evaluate` 对 permission+pattern 双通配取 `findLast`（**后写覆盖先写**）、多 ruleset flat 拼接顺序即优先级；ask 流程 = 全 allow 通过 / 任一 deny→DeniedError / 否则生成 Request 发布 Event.Asked 阻塞等 UI reply；reply = once 放行一次 / always 写入会话 approved 列表并顺带放行同会话其余匹配；默认 .env ask、external_directory ask（白名单目录 allow）、doom_loop ask、question/plan 默认 deny 内建；`arity.ts` 约束命令参数组合精度。

**Hermes**（`tools/approval.py` 全家 + `tools/write_approval.py` + `threat_patterns.py` + `agent/redact.py` + `estop.py`）
三守卫入口 check_all_command_guards / check_execute_code_guard / request_tool_approval（会话级审批、yolo、网关队列、denial breaker）；多级降级 = 自动放行 → 模式 allowlist → **guardian LLM** → 人工（CLI/gateway/Desktop 可异步审批）；写入独立 write_approval + 文件安全检查（威胁扫描应用于系统提示注入内容）；拒绝计数熔断（denial breaker）防死循环追问。

### 共同抽象

- **规则语义收敛**：allow/ask/deny 三态规则 + 匹配序 deny→ask→allow 先匹配生效（Claude/Claw）或后写优先（OpenCode）——**自研取 deny 优先且 deny 不可被更细 allow 豁免**；裸工具名 deny = 工具整体移出上下文。
- **审批 UX 收敛**：once/always 记忆（会话级按 key 缓存，Codex ApprovedForSession/OpenCode always 列表）、reject 带反馈让模型改写、沙箱失败升级二次审批（带 retry_reason）、批准后可追加规则。
- **fail-closed 与审计**：无应答者=unavailable=拒绝；`never` 策略服务内强制；approval/asked→decided 事件对构成证据链。
- **行为安全 vs 运行时安全分离**：prompt 段落/guardian/classifier 只管"引导与审查"，真正边界 = 规则 + 沙箱（H08）；classifier/guardian 盲化（不看 tool results）防注入操纵审查。
- **对 Policy Spec 的输入**：profiles 三档（read-only/workspace-write/danger-full-access）+ rules {allow,ask,deny} + decision_order（denied_tools → deny → hook override → ask → allow → profile）+ never_auto 危险集合 + workspace_trust 项目级装载门。

---

## H08 Sandbox

### 逐家实现位置与核心流程

**Claude Code**（`sandboxing.md`；macOS **Seatbelt** / Linux **bubblewrap+socat** / **Windows 原生不支持**须 WSL2）
默认写边界 = cwd 及子目录 + add-dir + 会话临时目录；默认读边界 = **全盘可读**（含 ~/.aws/credentials，需主动 denyRead/credentials 加固）；Protected paths（.claude 配置/凭据/.git hooks 等）写保护不可豁免；网络 = 代理进程跑在沙箱外、默认无预允许域名（auto 交 classifier）；credential 模式 deny/mask（sentinel 占位 + 代理出站注入、支持 extract 正则/JWT decode/AWS SigV4 重签名）；escape hatch = 沙箱失败 → 常规权限流 → 显式批准。

**Claw Code**（`runtime/src/sandbox.rs` + `runtime/src/bash.rs` `.sandbox-home`/`.sandbox-tmp`）
每次 bash 调用解析 sandbox 状态：merge config+工具入参（dangerouslyDisableSandbox/isolateNetwork/filesystemMode/allowedMounts）→ 容器检测（/.dockerenv 等）→ Linux 探测 unshare（**能力探测而非二进制存在**）→ 组装 unshare 启动命令；不支持/非 Linux 回退 `sh -lc` + HOME/TMPDIR 环境重定向（**非真实隔离**）；`SandboxStatus`（enabled/supported/active/…/fallback_reason）回填到 BashCommandOutput。

**Pi**（**无内建沙箱**；coding-agent `core/tools/bash.ts`/`core/exec.ts` 本机 spawn；docs/security.md "No Built-in Sandbox"）
所有执行 = 本机子进程（模型输出可直接 rm -rf / 读 .env 联网）；官方 4 套外部隔离：Gondolin（工具路由进 QEMU 微 VM，cwd 写穿宿主）/ Plain Docker（整进程进容器 bind-mount）/ OpenShell（NVIDIA 策略沙箱）/ Docker Sandboxes sbx（密钥留宿主、出口注入）；架构钩子 = `ExecutionEnv`（FileSystem+Shell 能力接口）+ 工具 *Operations 注入点是重定向执行（SSH/容器）的官方扩展位。

**DSH**（seam `packages/sandbox/sandbox`：`ctx.sandbox.confine(argv, policy)`；提供方 sandbox-local（Linux bwrap→Landlock 原生插件、macOS Seatbelt、Windows ACL 受限令牌 runner `sandbox-windows-acl`）；消费方 bash-sandbox/pwsh-sandbox）
模式 read-only/workspace-write/danger-full-access（full 不经 confine 直接 spawn 原始 argv）；**逐调用解析策略**（workspaceRoot 从会话不可变 cwd 派生、先 fs 语义规范化再词法，防 symlink/.. 逃逸）；**fail-closed**（无后端 SANDBOX_UNAVAILABLE，静默无隔离透传非法）；enforcement full/partial 由后端报告（旧 Landlock/Windows Everyone = partial，绝对边界消费方必须拒绝或暴露差异）；失败分类 = runnerFailureRules（基础设施）vs denialSignatures（命令被拒），先判 runner 再判拒绝。

**Codex**（`sandboxing` crate + `linux-sandbox`（bubblewrap+seccomp）+ `windows-sandbox-rs`（受限令牌+WFP 网络过滤+ACL deny-read+私有桌面+服务端提升）+ `network-proxy` + `exec-server`）
Linux = `--ro-bind / /` 默认只读文件系统、可写根 `--bind` 覆盖、可写根下**受保护子路径**（.git/gitdir/.codex）再 `--ro-bind` 强制只读、split-policy 按路径特异性排序（窄子路径可重开父级只读/拒绝、拒绝优先）、PR_SET_NO_NEW_PRIVS + seccomp 网络过滤；Windows 受限令牌 + Job + WFP + ACL deny_read_resolver + no_reparse_dir 防逃逸 + 私有桌面；网络 = managed network proxy（MITM CA 只读注入）+ 网络策略决策；violation 记录 → denial 判定（is_likely_sandbox_denied）驱动升级重试。

**OpenCode**（**无 OS 级沙箱**；安全边界 = permission 系统 + 进程派生点：`tool/shell.ts` ChildProcessSpawner 本机执行 + `ShellID` 权限维度）
shell 直接派生本机（bash/pwsh/cmd）、bash 默认超时 2 分钟、输出截断；read/glob/grep 受 external_directory 规则约束（工作区外 ask、白名单目录默认 allow）；无容器/bwrap/sandbox-exec/seccomp；workspace 概念（experimentalWorkspaces/Worktree）只做 git worktree "工作副本"隔离非执行隔离。

**Hermes**（`tools/code_execution_tool.py`（PTC）+ `code_kernel.py` 每会话持久 kernel + `code_execution_env.py` env 清洗 + `tools/environments/` docker/modal/daytona/singularity/ssh 远程后端）
execute_code = "程序化工具调用"（PTC）：脚本内只允许调用已授权 Hermes 工具、stdout 回流；本机后端 per-conversation session kernel（Unix socket/loopback TCP）；**无默认 OS 级 jail**（本地 = 审批 + env scrubbing + 工具白名单，终端/文件工具信任度等同开发者自身）；远程后端（容器/云/SSH）提供真隔离。

### 共同抽象

- **能力边界与行为边界分开**：执行隔离必须以 OS 级边界为最终防线（各家共识：Behavior Safety/权限规则管不住任意子进程）。
- **confine 抽象**：逐调用策略（workspaceRoot 派生 + fs 语义规范化防逃逸）+ fail-closed + enforcement full/partial 透明上报 + 失败分类（runner 失败 vs 命令被拒）。
- **Linux 文件边界模型**（Codex 最细）：只读根 + 可写覆盖 + 受保护子路径强制只读 + 路径特异性排序；网络独立策略层（代理/MITM + allowlist），凭据 mask + 出站注入。
- **健壮性件**（Claw）：能力探测（非二进制存在）、容器环境检测防嵌套、fallback_reason 回填、非真实隔离明确标注不冒充。
- **容器/远程 = 同级 seam**（Pi ExecutionEnv/Hermes 远程后端）：换更强后端（容器/微 VM）不动消费方。
- **对 Policy Spec 的输入**：seam = `ctx.sandbox.confine(argv, policy) → ConfinedArgv | SANDBOX_UNAVAILABLE`；modes 三档；backends_v01（bwrap 只读根模型 / seatbelt / Windows ACL partial）；默认读边界 = workspace + 显式 allow（比 Claude 保守，凭据 denyRead 默认）。

---

## H09 Session / Memory

### 逐家实现位置与核心流程

**Claude Code**（`sessions.md`/`memory.md`/`checkpointing.md`；转录 `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`）
四类记忆：Conversation（JSONL 转录、30 天 retention sweep）/ Session（session ID 绑项目目录，`--continue`/`--resume` 恢复=完整历史+模型+权限模式+活动 goal）/ Project（CLAUDE.md 层次 + .claude 配置 + auto memory 按 git 仓库作用域）/ Long-term（auto memory：MEMORY.md 索引 + topic 文件、200 行/25KB 注入、/memory 查看编辑；subagent memory user/project/local 三级）。resume 追加同 ID、fork 复制到新 ID（permission grants 不继承）、/clear 另起、checkpoint 每次用户 prompt 建（只跟踪文件编辑工具，保留最近 100）。

**Claw Code**（`runtime/src/session.rs` + `session_control.rs` SessionStore）
磁盘 `<cwd>/.claw/sessions/<workspace_hash>/`，每条消息追加持久化（JSONL snapshot + JSON 双格式读写）；`SessionStore::from_cwd`/`resolve_reference(latest|id)`/`fork_managed_session` 供 CLI `--resume`、`/session`、`/fork`；fork 记录 parent_session_id；heartbeat/liveness 健康检查、workspace fingerprint；记忆 = ProjectContext 装载 CLAUDE.md/CLAW.md/AGENTS.md 进 system prompt（无独立记忆库）。持久化在 Session/SessionStore，ConversationRuntime 本身不拥有落盘生命周期（外部在轮次边界保存）。

**Pi**（coding-agent `core/session-manager.ts` SessionEntry 树 + /tree//fork//clone//session；harness 层 `harness/session/*` + `packages/session-backends/sqlite-node` 可插拔 Storage）
会话 = **分支树**（每条 Entry 有 id/parentId，活动位置 = 当前 tip；换分支 = 换 tip 重建上下文不复制文件）；JSONL v3（`~/.pi/agent/sessions/--<cwd>--/<ts>_<uuid>.jsonl`，v1→v2→v3 自动迁移）或 SQLite 后端；Entry 类型含 user/assistant/tool/bashExecution/custom/model_change/compaction/branch_summary/usage 等；跨会话无隐式记忆（无向量记忆）；harness 层把 commit 序列化/事务/usage ledger/fork 快照做成可插拔存储接口（带 conformance 测试）。

**DSH**（`packages/core/session` 仅追加事件日志 + surface + `deriveMessages()` + fork API；持久化 `packages/session/session-persistence-jsonl` JSONL v2 `session.v2.jsonl[.zstd]`）
会话日志 = **唯一真源**（UI/轨迹/遥测/回放全由事件派生）；SessionHeader（format version/cwd/parentSession/isSeeded/delegationDepth/agentPreset/origin:'subagent'）存日志旁不入事件；resume = `ctx.agents.resume` → 持久层 `open(id,'write')`（**单写者所有权，并发第二次拒绝**）→ 读日志 → 追加合成 `interruptedTurnClosers`（turn/end interrupted）；fork = 取 boundary（含）已完成轮次前缀 → 深克隆 seed + parentSession + isSeeded + 精确 inheritedEventCount；append best-effort（write-behind）、flush() = 持久性屏障；崩溃保留被中断轮次只丢撕裂尾部；格式迁移只发布新 generation 绝不改写已提交；**无内置长期记忆**（第三方记忆 MCP overlay 示例）。

**Codex**（`thread-store` ThreadStore trait + `state` crate SQLite（graph/log/thread_metadata/memories）+ `codex-rs/memories`）
Conversation = rollout JSONL（SessionMeta+ResponseItem+TurnContext+WorldState 行）+ sqlite 元数据；Session 非独立实体（session_id == 根线程 ID，子代理是新 thread 共享 AgentControl）；Long-term Memory = **双阶段后台管道**（Phase1 认领最近可归档 rollout → 并行模型抽取 raw_memory+rollout_summary；Phase2 consolidation 合并巩固）写入持久存储；污染防护：外部上下文触发 mark_thread_memory_mode_polluted。

**OpenCode**（`opencode/src/session/session.ts` Session 服务 SQLite + `packages/core/session` 表与 SQL + `background/job.ts` + `snapshot/` + `git`）
Session = {id(ULID)/slug/projectID/directory/parentID/title/agent/model/summary/cost/tokens/permission…}，消息持久化 MessageTable/PartTable（SQLite+drizzle）；create/fork（message 级，标题 fork #N）/children/list/setTitle/setArchived/setRevert/updateMessage（增量 text）/removeMessage/removePart/diff；每 step-finish 的 **snapshot patch**（基于 git 工作树 vs committed 文件级 diff）供 UI/revert；记忆三态 = DB 历史（可翻页）+ snapshot patch + compaction summary；跨会话知识靠 config/instructions 外部文件。

**Hermes**（`agent/session_persistence.py` + `hermes_state*.py` SQLite state db（WAL、FTS）+ `tools/memory_tool.py`/`memory_tool_store.py` + `agent/memory_manager.py`/`memory_provider.py` + `turn_facade_lease.py`）
记忆 = 磁盘文件 `MEMORY.md`（agent 笔记）+ `USER.md`（用户画像），会话开始以**冻结快照**进系统提示、**中途写盘但绝不改写当前提示**（保 prefix cache、下一会话生效）；单一 `memory` 工具 add/replace/remove/批量（文件锁 + 备份防漂移）；MemoryManager 把记忆 hooks 扇出给 provider（system_prompt_block/prefetch/sync_turn/on_pre_compress/on_delegation 等，**同时仅 1 个外部 provider**）；会话文本落 SQLite（FTS 检索/恢复/导出）；跨进程 durable turn lease 防双写。

### 共同抽象

- **会话层与记忆层分离**：会话 = "发生过什么"（转录/事件/消息库，可 resume/fork/审计）；记忆 = "跨会话保留什么"（MEMORY.md 文件索引 + topic 文件按需读 / auto memory / 状态库后台管道）。自研取：事件日志 + 目录绑定可恢复可 fork 会话（DSH 结构） + 文件式长期记忆冻结快照注入（Hermes 形态）。
- **resume/fork 语义收敛**：resume = 追加/重放 + 崩溃修复（合成关闭器）；fork = 谱系记录（parent_session_id / seed + isSeeded / parentID 链）+ 权限不继承（Claude）或继承收窄（OpenCode）；/clear 才是新会话，compaction 不是新会话。
- **持久性纪律**：单写者租约/open(id,'write') 拒绝并发第二写、append + flush 屏障、崩溃只丢撕裂尾部、格式迁移发布新 generation 不改写旧文件。
- **对 Event Spec / Behavior IR 的输入**：session 事件词汇（session/created、agent/created、agent/session-start{startup|resume|clear|compact}、session/end-seed、turn/end interrupted 合成）；记忆文件 = MEMORY.md(agent)/USER.md(user)/CLAUDE.md/AGENTS.md(项目指令归 H02)，注入=会话开始冻结快照，工具 = 单一 memory 工具，作用域 user/project/local 三级。

---

## H10 Skills

### 逐家实现位置与核心流程

**Claude Code**（`skills.md` + `.claude/skills/`（enterprise>personal>project>plugin 四级发现）+ Agent Skills 开放标准）
SKILL.md = YAML frontmatter + markdown；描述索引启动注入（截断 1,536 字符）、**正文按需加载**、注入后跨轮保留、compact 后按 ≤5000 token/个重注入；`disable-model-invocation`/`user-invocable`/`paths:` glob 自动触发/`context: fork`（在 fork 子代理上下文运行）/`allowed-tools`（turn 级免批准授权，下条消息即清）/`!`command`` 动态注入/`@file` 捆绑文件；synced skill（claude.ai）能力降级（不执行 !/@）；冲突 enterprise>personal>project>bundled。

**Claw Code**（`tools/src/lib.rs` Skill spec + `run_skill`/`execute_skill` + `resolve_skill_path`（.claude/skills、.claw、legacy commands/ 兼容根）+ `/skills`）
模型调 `Skill{skill:名称}` → 多根解析路径 → 读文件全文作为指令注入（parse_skill_description 提取简介）→ 返回 JSON；`/skills install <path>` 复制进技能目录；`claw skills list` 机器输出。execute_skill 只是"把技能文件内容读回给模型"——**无结构化参数 schema、无技能内 agent/子会话执行器**。

**Pi**（coding-agent `core/skills.ts`（509 行）+ docs/skills.md + `formatSkillsForPrompt`；harness `harness/skills.ts`）
Agent Skills 标准（agentskills.io）；位置 = 全局 `~/.pi/agent/skills/`、`~/.agents/skills/` + 项目 `.pi/skills/` 与祖先 `.agents/skills/`（需信任）+ pi 包 skills/ + settings `skills` 数组（可加 `~/.claude/skills`、`~/.codex/skills` **兼容目录**）；frontmatter name(≤64)/description(≤1024)/disable-model-invocation；启动只注入 name/description/location 的 `<available_skills>` XML（**渐进披露**），模型用 read 打开 SKILL.md 全文执行；`/skill:<name>` 强制加载；多数违规只警告（跨 harness 共享友好）。

**DSH**（seam `packages/skill/skill`：`ctx.skills` registerProvider/list/snapshot/get + `skills/change` 事件 + 提供方 skill-filesystem（chokidar 监视）/skill-badge + 消费方 tool-skill）
provider 分层注册（scope 链合并、最近层赢重名），本地 rank 表：project-dsh `.dsh/skills`(100) < project-agents `.agents/skills`(200) < custom Config.customSkillDirs(300) < user-dsh `<dshHome>/skills`(400) < user-agents(500) < bundled(600)；`ctx.skills.get(name)` 每次重读正文（不缓存完整定义）；目录注入 = 首个完整视图 pre-step 持久 `<system-reminder>`（**只含 name + 转义 description，无正文/路径**）；`skill({name})` 工具校验名称 → 查目录 → isModelInvocable 门禁 → 按 agent cwd 重读 → 返回 `<skill_content>`/`<skill_resources>`/`<skill_instructions>`；无市场/签名，安装 = 放文件、更新 = 改文件 + watcher 失效。

**Codex**（`codex-rs/skills` crate + `core/src/skills.rs` + `plugins/skill_snapshot.rs`）
skill 根 = 用户 `~/.codex/skills` + 项目 + 系统内嵌（`install_system_skills` 装到 CODEX_HOME/skills/.system、指纹 marker 跳过重复安装）；**显式选择** = 用户输入 `@path`/sigil mention 触发按需注入（build_skills_and_plugins 只注入被提及技能）、**隐式** = detect_implicit_skill_invocation_for_command 按命令识别（不强制）；SkillInterface（结构化接口）+ SkillInterfaceAssetPolicy + SkillPolicy（执行边界）；SkillToolDependency 声明所需 MCP 服务器 turn 内按需启动；用户技能覆盖同名系统技能。

**OpenCode**（`opencode/src/skill/` 服务 + `skill/discovery.ts` URL 技能仓库 + `tool/skill.ts`）
三路来源：config/项目目录 SKILL.md 扫描（global ~/.claude/skills、~/.agents/skills、项目上溯第一个匹配层、config skills.paths）+ **远端 URL index.json**（Schema:{skills:[{name,files,version}]} 并发下载到缓存目录、version 变化 staging+rename **原子替换**）；system prompt 给 `<available_skills>`（name/description/location）；模型调 `skill` 工具 → 权限 `skill:<name>` ask → 返回 `<skill_content>`（body + base 目录 + ripgrep 采样非 SKILL.md 文件清单）；Skill 权限 deny 时从 system prompt 隐藏；compaction/prune 保护 skill 工具输出不清除。

**Hermes**（`skills/` 内置 + `optional-skills/` + 用户目录 + `agent/skill_utils.py`/`skill_commands.py`/`skill_preprocessing.py` + `/learn` + curator）
SKILL.md frontmatter（name/description≤60 字符/platforms OS 门控/metadata.hermes.tags/category/related_skills/config）；description index 进 prompt 命中才注入正文；`/learn` = **活体 agent 用自身工具收集素材**、按作者规范经 skill_manage 一次产出技能（大文档转 lean SKILL.md + references/）；curator 空闲期自动 pin/archive/consolidate/patch 技能（**只归档不删除、可恢复**、不碰主会话 cache）；删除技能 = 归档、`hermes curator restore` 救回。

### 共同抽象

- **技能 = 目录 + SKILL.md 的可分发单元**（Agent Skills 开放标准是事实格式）；frontmatter 元数据与正文分离。
- **渐进披露 + 按需加载**：目录索引只给 name+description（XML 转义、无正文/路径），正文在调用时加载（模型 read 或 skill 工具）；索引常驻的 token 成本 vs 正文按需的成本权衡各家一致收敛于"索引轻、正文迟"。
- **来源冲突裁决**：分层 rank / 优先级（enterprise>personal>project>bundled；DSH rank 表），最近层赢；跨 harness 兼容目录（~/.claude/skills、~/.codex/skills）是生态事实。
- **生命周期**：安装 = 放文件；更新 = 改文件；删除 = 归档可恢复（Hermes curator）；远端版本化原子替换（OpenCode，v0.2 方向）。
- **对 Behavior IR / Policy Spec 的输入**：frontmatter 字段（name/description/disable_model_invocation/user_invocable/allowed_tools turn 级/context:fork/paths）；注入 = 目录索引渐进披露；加载 = 按 agent cwd 重读 + `<skill_content>/<skill_resources>/<skill_instructions>` 返回契约；技能是"知识即文件"，正文是建议性知识，强制在权限/沙箱。

---

## H11 Subagent / Multi-Agent

### 逐家实现位置与核心流程

**Claude Code**（`sub-agents.md`/`agents.md`/`workflows.md`/`worktrees.md`）
内置类型 Explore/Plan/general-purpose/claude；定义 = Markdown+YAML frontmatter（tools/disallowedTools/model/permissionMode/maxTurns/skills/mcpServers/hooks/memory/background/isolation:worktree/initialPrompt…）；**全新上下文窗口**不带主会话历史（fork 除外）、只回主一个 summary+元数据尾；后台子代理精简工具集；嵌套默认 **3 层**、并发默认 **20**；worktree 隔离（.claude/worktrees/ 临时 git worktree、命令强制留 worktree 内、.worktreeinclude 复制 gitignored 文件）；dynamic workflows（agent()/pipeline()/parallel()/phase()/log() JS 脚本，16 并发/1000 agents/run、禁 Date.now/Math.random 保证可重放，中间结果留脚本变量不进主上下文）。

**Claw Code**（`tools/src/lib.rs` Agent tool → `execute_agent_with_spawn` → `spawn_agent_job` → `run_agent_job` → `build_agent_runtime`；`allowed_tools_for_subagent` 按类型裁剪）
每个子代理 = **同进程新线程** + 独立 ConversationRuntime/Session/工具白名单（Explore：read/glob/grep/WebFetch/WebSearch/ToolSearch/Skill/StructuredOutput；Plan/General 类似分集）+ 独立 max_iterations；输出持久化 output_file `*.md` + manifest `*.json`（状态机 running/completed/failed）；`/subagent [list|steer|kill]`；worker_boot.rs WorkerRegistry（worker 状态机/trust/startup 预检）是"clawable worker"编排模型；Task/Team/Cron 仍是内存注册表。

**Pi**（**无内建 subagent 原语**；官方示例 `packages/coding-agent/examples/extensions/subagent/index.ts` 1038 行属扩展）
每次 subagent 调用 spawn **独立 pi 进程**（隔离上下文窗）、JSON 模式捕获结构化输出；三种模式 single/parallel(≤8 task,≤4 并发)/chain({previous} 占位符)；结果截断 PER_TASK_OUTPUT_CAP 50KB、临时目录 mkdtemp；内核只给多 lane/session 并行 run、runInBackground/steer、fork（快照复制）等可组合原语，无"task 工具→子会话→结果回投"开箱链路。

**DSH**（seam `packages/subagent/subagent`：`ctx.subagents`、SubagentProvider、continuation 管理器 + 提供方 6 个（spawn-in-process/fork-in-process/acp/codex/claude-code/dsh-sdk）+ tool-subagent/tool-subagent-control + packages/workflow）
模型调 `subagent`/`subagent_fork` → 服务按**能力 flag 校验**（agentOptions/outputSchema/depthLimit/toolFilter/persona，缺能力即 UNSUPPORTED_CAPABILITY 拒绝，绝不接受后忽略）→ provider.start() → result = {output, structured?, diagnostic?, stopReason}；output = 子 agent 最后一条非空 assistant 消息；非 completed stopReason 一律映射 isError；**可继续子 agent** = startContinuable() 预留稳定 childId → send_message（按 Activation：running→steer / waiting→唤醒 / 无→冷恢复）/ interrupt_agent（keepInbox）/ list_agents；maxDepth 绝对上限 + 持久 delegationDepth（冷恢复不降低）；**无 worktree**（隔离靠 scope + cwd 继承 + 沙箱）。

**Codex**（`core/src/agent/control.rs` AgentControl + `control/spawn.rs` + `agent/registry.rs` + `agent/role.rs` + `agent_communication.rs` mailbox + `tools/handlers/multi_agents*.rs`）
主代理调 spawn_agent → 校验 depth/容量 → reserve_spawn_slot → 按 SpawnAgentForkMode{FullHistory,LastNTurns} fork 出子 thread（独立 rollout/历史/world state）→ 子代理独立 Session 跑自己 turn 循环 → wait_agent/send_message/interrupt_agent → 完成 InterAgentCompletionMessage/SubagentNotification 回灌父上下文；角色只能**收窄**不能放大父权限（"never replace the parent session's authority"）；resume_agent_from_rollout **崩溃恢复整棵代理树**（BFS）；agent_max_threads 默认 6、max_concurrent_threads_per_session 默认 4（V2）。

**OpenCode**（`tool/task.ts` task 工具 + `session/prompt.ts` handleSubtask + `agent/agent.ts` mode: subagent|primary|all + `background/job.ts`）
子代理 = **独立子 Session**（sessions.create({parentID})，agent 名 = subagent_type），父会话深度限制 subagent_depth（默认 1）；task 流程 = 权限 task:<subagent_type> ask → 子会话权限 = 父 deny + external_directory 规则 + 自身 ruleset + 默认禁 todowrite/task → 在子会话跑完整 runLoop；内置 general（并行研究，禁 todowrite）/explore（只读，禁编辑）；前台 = background.start 注册 job 后 wait；后台（flag）= 立即返回 `<task state="running">`、完成注入合成 user 消息继续；结果 `<task_result>`/`<task_error>` XML 标签。

**Hermes**（`tools/delegate_tool.py` 家族 + `agent/delegation_context.py` + `subagent_lifecycle.py` 插件不可变生命周期 API + `periodic_scheduler.py`）
delegate_task 派生**全新 AIAgent 子实例**：fresh conversation + 自有 task_id（终端会话/文件缓存隔离）+ 父工具集**剔除 child-blocked 工具** + 由 goal+context 构建聚焦系统提示；单任务与 batch（并行）两种模式；父只看到委托调用与摘要结果、**看不到子中间 tool 调用/推理**；有 max spawn depth、max concurrent children、子超时、心跳、worktree isolation 配置、子结果 schema 校验。

### 共同抽象

- **子代理 = 与主代理同构的独立会话/上下文**（Codex thread / OpenCode 子 Session / DSH 同构 Session），才能共享 resume/fork/审计；隔离 = 新上下文 + 独立工具面 + 权限只能收窄。
- **信息隐藏纪律**：父只见结果（summary/output/结构化），不见中间 tool/推理（Claude summary 回流、Hermes 明示、CL4R1T4S 语料"子代理=上下文工程手段"）。
- **统一结果契约**：output + structured(schema 捕获即校验) + stopReason；非 completed = 错误（DSH isError 语义，防"假装完成"）。
- **生命周期**：可继续/steer/kill/list（DSH send_message/interrupt、Claw steer/kill）；深度与并发默认上限（3/20 或 4/6 或 1）；崩溃恢复（Codex 代理树 / DSH 冷恢复不降 delegationDepth）。
- **worktree 隔离**：Claude Code 独有完整实现，其余多数无或外置；并行写隔离 v0.2。
- **对 Event Spec 的输入**：subagent/start|end 事件、委派深度持久化字段（delegationDepth 进 SessionHeader）、result 契约事件；工具面 = subagent / subagent_fork / send_message / interrupt_agent / list_agents。

---

## H12 Evaluator / Verification

### 逐家实现位置与核心流程

**Claude Code**（`goal.md`/`code-review.md`/`ultrareview.md` + Agent SDK structured-outputs + bundled /verify /run skills）
**verification loop 概念** = 官方定义"给 Claude 一个可运行检查（test/build/screenshot 对比）并迭代到通过"为**无人值守运行的前提**（无 verification loop 时唯一判定完成的是模型自己）。`/goal` = 每 turn 后**独立小模型**（默认 Haiku 级）对照条件评估 transcript（evaluator **不跑命令不读文件只读对话**），三态 met/impossible/error、条件 ≤4000 字符、是 session-scoped prompt-based Stop hook 的包装。`/code-review`（本地）= 多 agent 并行分析 diff → verification step 对照真实代码过滤 false positives → 去重按严重度排序 → 内联评论 + 摘要。`/verify`/`/run` = 跑真实 app 验证（不 fallback 到测试）。structured output（`claude -p --json-schema`）校验失败重试达上限报 error。`--restricted` 模式专为 eval harness（禁执行工具/限文件域/禁 bypass）。

**Claw Code**（**无输出质量评测器**；以 mock-anthropic-service crate + rusty-claude-cli/tests/mock_parity_harness.rs + `rust/mock_parity_scenarios.json` + compat-harness + docs/g00*.md verification-map 系列代替）
评测对象是**行为对齐/回归**而非任务完成质量：确定性 Anthropic 兼容 mock（`PARITY_SCENARIO:` 前缀识别 12+ 脚本场景：streaming_text/read_file_roundtrip/bash_permission_prompt_approved_denied/auto_compact_triggered/token_cost_reporting 等）；scenario↔PARITY 引用自动核对（diff 脚本）；g004 事件/报告契约机器校验；verification-map 把"行为→代码→测试"对照。多数 verification-map 是文档而非 CI 强制门槛。

**Pi**（`packages/evals/` + 根 `npm run eval`）
Pi evals = **行为级、模型回代、测试即 eval**：适配开源 vitest-evals（describeEval/it/断言/归一化 trace/judge）到真实 `AgentSession`（createPiCodingAgentHarness：临时 workspace + agent 目录、ModelRuntime.create 选 provider/model、每步 prompt → 断言最终 assistant 文本与 usage、真实 JSONL 会话挂 artifact）；支持 baseline vs candidate 对照（改 prompts/tools/skills/models 的回归测量）；用真实 dev 工作流衡量端到端行为。运行时无 per-run 自动 LLM 裁判 API（judge 概念来自 vitest-evals 上游）；覆盖点少（smoke/extensions 两例）。

**DSH**（**无独立 Evaluator 模块/agent**；验证能力分布：仓库测试体系（unit 每文件 100% 门禁 → real-API e2e → snapshot keyless 录制会话重放 → web 浏览器快照）+ `packages/plan/plan` 评审门 + `packages/goal`（create_goal/get_goal/update_goal 持久同会话目标续跑）+ subagent outputSchema（捕获即校验）+ workflow 工具（agent(prompt,{schema}) 坏 schema 必杀脚本）+ `code-runtime` run_code + `runtime-diagnostics/invariants`（回放校验会话日志关系：轮次/步骤编号、工具调用/结果配对、retry 记录））
Tests/Lint/Typecheck/Build **无内建面向 agent 的验证工具**（靠 shell 工具跑项目自身命令 + `{stdout,stderr,exitCode}` 契约回读）；H12 呈现为"验证是外围测试体系 + 人工评审门 + 结构化返回契约"而非 agent 内建 evaluator；BENCHMARK.md 仅 3 行（未获取到成体系 benchmark 场景/指标定义）。

**Codex**（`codex-rs/exec` `codex review` + `core/src/tasks/review.rs` + `prompts/templates/review/rubric.md` + `codex-protocol/review_format.rs` + `ResponseEvent::ModelVerifications`）
`codex review` = 以**受限子代理会话**运行（review-only 限制：禁 web search/collab/view_image），用 `review_model`（独立模型配置）按 rubric 生成**结构化 findings**（从最后一条消息解析 ReviewOutputEvent），退出时把 findings 块与渲染文本写回对话历史并持久化 rollout；目标三态 uncommitted changes/base branch（自动 merge-base）/commit；ModelVerifications = 模型流可带 verification 事件（协议层**软事件非强制**）；**无独立 Tests/Lint/Typecheck/Build 工具**——"测试/构建由模型用 exec_command 自己跑"哲学。

**OpenCode**（**无独立自动评估框架内建核心 loop**；最接近：agent/agent.ts 的 Agent.generate（generateObject/streamObject 按 schema 生成 agent 配置）+ provider/model-status 评估 + 工具/循环失败自愈评估）
会话结束判定在 runLoop（finish reason 非 tool-calls/error/blocked/maxSteps 注入等）；content-filter/StructuredOutput 缺输出显式转 error；compaction 失败转 ContextOverflowError；质量/正确性自动评估未发现集中实现——**判断为空缺/外包给外部测试流程**。

**Hermes**（`agent/background_review.py` + `/review`（`agent/review_engine.py`）+ `agent/verify/runner.py` + `verify_hooks.py`（pre_verify 轮末闸、默认 ≤3 次 nudge）+ `evals/`）
**无单一"裁判"模块**——评估职责分布为：①后台自动 skill/memory 评审（每轮后 fork 一个 AIAgent 重放快照自问"该保存/更新哪些 skill 或 memory"，写直达记忆+技能库、不碰主会话与 cache = learning loop 判定器）；②`/review`/delegate 的全权限后台评审子代理（同 async-delegation rail）；③verify recipe 证据闸（bootstrap→build→test→start→readiness→teardown，项目自带 recipe、pre_verify 轮末闸、≤3 次 nudge、证据驱动 verification-stop）；④evals/ 离线自评。评审 fork 继承父运行时故命中同一 prefix cache。

### 共同抽象

- **验证外部化三层**：①确定性层（test/lint/typecheck/build 由 shell 执行 + `{stdout,stderr,exitCode}` 契约回读——Claude/Codex/DSH 共识，无内建 test-runner 抽象）；②独立 Evaluator 层（Claude /goal 独立小模型只读评估 + Codex review 独立模型受限子代理 + DSH invariants 机械自检 + Hermes verify recipe 证据闸）；③结构化契约贯穿（subagent outputSchema / workflow schema / structured findings）。
- **完成语义必须外部化**：干活模型不能默认自证完成（Claude verification loop 前提、Manus todo 全绿门禁 + idle 三条件、Devin 真实透明条款——语料跨产品共识）；evidence（测试输出/文件引用）是回答义务。
- **诚实性**：禁假数据/假测试/伪证完成（Devin Truthful / CL4R1T4S 共识）。
- **对 Behavior IR 的输入**：evaluator 配置 = deterministic[tests/lint/typecheck/build] + agent{独立小模型、只读（transcript + 磁盘证据）、verdict 三/四态} + invariant_selfcheck（回放配对校验）+ review_subagent（受限工具 + rubric + 结构化 findings）+ completion_gate（generator 默认不可自判完成）。
- **benchmark 现状缺口**：除 Claw mock-parity、Pi evals（起步态）外各家均无成体系 benchmark 场景/指标（DSH BENCHMARK.md 3 行、OpenCode 空缺、Hermes evals 有 runner）——这正是任务书第十五节要求自建 ≥15 场景 parity suite 的原因。

---

## 各家范式小结

### Claude Code —— 闭源行为基准（Behavior Baseline）

架构本质：闭源运行时的**完整产品行为面**是行业事实标准——它不做开源内核，而是把机制外露为文档、CLI、35+ hook 事件、SDK 消息流、permission/hook/compaction 的公开契约。研究它只能得到"该怎样行为"，得不到"代码怎么写"，恰与任务书"Source→Specification→Clean Implementation"及 clean-room 取向匹配。最值得借鉴：①三层前缀缓存排序与"动态内容往消息层放"的缓存工程纪律；②verification loop 完成语义（无人值守以可运行检查为前提）+ /goal 独立小模型只读评估三态；③permission 四层叠加与 Behavior/Runtime Safety 分离的官方失效面声明（deny 规则拦不住任意子进程）。行为要点 16 条已在研究文档末供 Behavior IR 抽取。

### Claw Code —— Rust Parity / 行为对齐重实现

架构本质：Claude Code 的**公开 Rust 重实现 + Parity（行为对齐）**仓库，自称 "agent-managed exhibit / museum artifact"，非生产主力。其价值不在"复制上游"而在**对齐方法论**：PARITY 9-lane 行为对照（Bash/File Tools/Task/Team-Cron/MCP/LSP/Permission/Compaction）、mock-parity 12+ 确定性场景（无网络无真实模型）、verification-map 把"行为→代码→测试"写进文档、契约校验（g004）机器化。实现侧最干净的是权限决策序（denied_tools → deny → hook override → ask → allow → 模式比较）、compaction（启发式归纳 + 工具对不拆 + 压缩后 health 探针）、sandbox 能力探测。最值得借鉴：①Parity/benchmark 的方法论（直接映射任务书第十五节 cross-harness conformance suite）；②run_turn 的 ApiClient/ToolExecutor trait 注入可测性；③部分成功一等公民（MCP servers[]+invalid_servers[]）与"未落地如实标注"的诚实纪律。

### Pi / pi-mono —— 极简 Agent Kernel

架构本质：TypeScript 全栈 + 30+ provider 的 pi-ai 中立 LLM 层 + **8 个最小工具** + TypeBox schema 贯穿 + 会话 Entry 树 + **无工具级权限/无内建沙箱/无内建 subagent** 的明确"非目标"清单。取舍哲学是"内核小、能力靠扩展包/插件、安全靠外部隔离"（Gondolin/Docker/sbx/OpenShell + ExecutionEnv/Operations 注入点）。最值得借鉴：①最小内建工具集哲学（schema 成本与安全面最小化，扩展通道补能力）；②工具"定义"与"pluggable operations"解耦 → 执行可重定向 SSH/容器（是沙箱 seam 的原型）；③evals=vitest-evals 适配真实 AgentSession 的行为级模型回代测试（测试即 eval、可 A/B），且内置真实会话 artifact。其余：项目信任门（而非工具审批）、渐进披露技能、会话树导航，按需吸收。

### DeepSeek Harness —— 插件树 + 事件溯源内核（Composable Core）

架构本质："一切皆插件"（Cordis 插件树）：模型适配器、工具注册表、会话日志、**agent loop 本身**都是可替换插件；会话 = 仅追加类型化事件日志（event-sourced），模型历史从日志派生（**模型可见⟺已记录**的不变式，违反即运行时错误）；loop 保持唯一最小可替换核，其余全挂类型化事件扩展点（agent/*、tools/*、session/* 的 waterfall/serial/bail/parallel）。这是与自研目标（可组合、可验证、可替换行为层）最同构的一家，其 15 条行为要点（先持久后等待、guard 单调、fail loud、沙箱逐调用 fail-closed、注入即持久消息、compaction 事务、能力显式声明、KV Cache 一等约束、loop 最小可替换）几乎逐条可平移为自研内核的设计约束。最值得借鉴：①事件溯源会话 + deriveMessages 派生 + 崩溃合成关闭器；②waterfall 中间件语义（不调 next 即短路）+ guard 单调；③`ctx.sandbox.confine` seam + fail-closed + enforcement 透明（三平台 runner 链，Windows 有真实方案）。注意：Developer Preview、无内置长程记忆/benchmark 场景、抽象层较重。

### OpenAI Codex —— Rust 运行时 + 产品级工程

架构本质：Rust monorepo，核心在 codex-rs（core/exec/execpolicy/sandboxing/hooks/skills/memories/thread-store/prompts…），会话 = 线程模型（session_id == 根 thread ID，子代理是 fork 的独立 thread，整棵代理树可崩溃恢复）。上下文 = world_state 30+ section **基线 + 每步 diff** 增量注入；工具执行 = 统一管线 pre-hook → 审批（Guardian 模型或 UI）→ 沙箱 → post-hook，审批缓存 + 沙箱失败升级重试；沙箱 = "只读根 + 可写覆盖 + 受保护子路径强制只读"（bwrap/seccomp/Windows 受限令牌+WFP+ACL+私有桌面）。最值得借鉴：①world_state 基线/diff 与"每步先捕获 StepContext 再构造请求"（广告与执行工具同视图）；②沙箱 split-policy 路径特异性排序与 violation→denial 判定驱动升级；③`codex review` 受限评审子代理模式（独立模型 + rubric + 结构化 findings + review-only 工具限制）与"角色只能收窄不能放大父权限"。注意：model prompt 文本 UNTRUSTED、记忆管道依赖后端状态库（自托管基本不可用）、run_turn 单文件 2881 行不可维护（反例）。

### OpenCode —— 产品级 TypeScript + Client/Server

架构本质：Effect-TS + AI SDK v6 + Drizzle/SQLite；**消息 = user/assistant message + parts 双层落库**（text/reasoning/tool/step/patch/compaction），每轮 filterCompacted 重排转 ModelMessage；EventV2 durable 事件总线 → SSE/WS → 多 UI；插件 = (input,output)=>output 变换链（permission.ask / tool.execute.before-after / chat.*.transform / session.compacting）；权限 = permission+pattern 双通配多 ruleset **后写优先**；sandbox = 无 OS 级（权限即边界）。最值得借鉴：①消息/parts 双层持久化 + step 级 snapshot patch（UI/回放/审计/import 同存储）；②健壮性件（doom-loop 检测、invalid 工具让模型自修复、SessionRunState 单 runner、interrupt 清理补 snapshot）；③一个用户回合 = 多 step、compaction 后 auto-continue/重放的续作语义。注意：每轮全量读库重排线性成本、多供应商 prompt 模板维护成本、双 schema（effect+zod）桥接。

### Hermes Agent —— 自学习单体 Agent（Learning-loop + 缓存纪律）

架构本质：Python 单体大 agent（CLI/gateway/TUI/Desktop 共用 core），两条铁律支配设计：**per-conversation prompt cache 神圣**（会话中途改写历史/工具集/记忆/系统提示默认延后到下一会话）与 **core 窄腰**（能力放 CLI+skill/插件/MCP，核心工具每轮全量发送故增工具是最后手段）。记忆 = MEMORY.md/USER.md 磁盘文件冻结快照注入；学习闭环 = 每轮 background_review fork 评审"该存什么" → skill_manage/curator 落地（只归档不删除）；/learn 用活体 agent 产出技能；验证 = verify recipe 证据闸 + pre_verify 轮末闸（≤3 次 nudge）。最值得借鉴：①缓存纪律（每会话构建一次、三层 stable/context/volatile、中途写盘不改当前提示）——直接可进 Behavior IR 的 prompt 组装规范；②文件式记忆 + 冻结快照 + 单一 memory 工具 + 文件锁（简单、可 git、可审计）；③技能生命周期（/learn + curator 只归档不删除）与 verify 证据闸、审批多级降级（floor allowlist → guardian LLM → 人工）。注意：单体 1.2 万文件认知成本高、本地非沙箱是明确取舍、无跨进程事件总线信息。

### CL4R1T4S —— 行为语料库（Behavior Corpus）

架构本质：**不是 Harness**，是 26 个产品目录的 system prompt 泄露/逆向快照（.md/.txt/.json），无代码无测试；自带提示注入诱饵，必须按 UNTRUSTED RESEARCH DATA 处理（不转抄、不当现役事实、只提取行为模式、经 Parser→Behavior Extraction→Review→Behavior IR 管道）。其价值是证明"输入侧行为高度可归纳"：编码代理 prompt 共现结构段（身份一句 → 人设/语气 → 工具调用纪律 → 代码改动纪律 → 安全护栏 → 输出约束 → 记忆/上下文 → 人机协作模式），并产出跨产品共识 15 条（只用显式工具+调前说明原因、改动落工具不落回复、代码可立即运行、命令安全分级模型自持不可被用户覆盖、压缩语义契约化"看到摘要≠重来"、事件流统一状态载体、完成=自检清单+收尾工具门禁、诚实性条款等）。最值得借鉴：①作为 Behavior IR 的**候选行为来源矿**（只取模式）；②Codex Desktop "Using skills" 协议（发现/先读全/按轮有效/失败降级四要素）与 Windsurf/Devin 的"破坏性判断不可被用户覆盖"立场进入 Policy Spec 讨论。注意：单点来源（Sol 一份）、版本陈旧、不可执行。

---

## 资料缺口与可信度说明

### 可信度分级（沿用各研究文档声明）

1. **Claude Code**：运行时**闭源**。全部"实现位置"是公开接口面（文档/CLI/hook 事件/CHANGELOG），非源码路径；内部机制按官方文档与 CHANGELOG 推断并注明；未获取 CL4R1T4S/system prompt 原文。H12 /goal 无独立源码可核，verification 无结构化验收契约。
2. **Claw Code**：Rust 源码一手资料；但仓库自述是 "exhibit / museum artifact"、非生产主力；H07 `trust_resolver` 仅 `#[cfg(test)]` 导出；H11 Task/Team/Cron 仍内存注册表、AskUserQuestion 子代理路径不可用（pending stub）；H12 无输出质量评测器（以 mock-parity + verification-map 代替，多数非 CI 强制）。
3. **Pi**：源码一手资料；H08 无内建沙箱、H11 无 subagent 原语均为 README 明示"非目标"（非资料缺失）；H09 JSONL 单文件并发写锁细节未深究；evals 覆盖点少（smoke/extensions，起步形态）。
4. **DSH**：仓库 + 本机安装（0.1.2-alpha.5）双源；H07 Developer Preview 未审计（SAFETY.md 明示不得视为安全/生产就绪）、部分平台 enforcement 仅 partial（Windows ACL Everyone/硬链接、旧 Landlock ABI）；**H12 BENCHMARK.md 仅 3 行，未获取到成体系 benchmark 场景/指标**；无内置 RAG/长程记忆（第三方 MCP overlay 需手动配置）；SQLite 全文搜索默认关闭。
5. **Codex**：源码一手资料（Apache-2.0）；H02/H09 model system prompt 渲染文本按 UNTRUSTED 只提取 section 行为模式；memory 管道依赖 OpenAI 后端状态库与 feature flag（自托管基本不可用）；H12 无确定性测试栅栏、ModelVerifications 软事件无强制语义、无 screenshot/browser 验证集成。
6. **OpenCode**：源码一手资料；H08 无 OS 级沙箱实现、H12 无独立 evaluator 框架（已如实标注空缺，非编造）；opencode.ai/docs 未抓取（避免臆断）；H05 工具集按 modelID 子串判断偏脆；每轮 resolve 重建整套工具上下文（性能未量化）。
7. **Hermes**：仓库源码 + AGENTS.md（docstring/函数签名级）；H03 未获取 ContextEngine 选型/竞品比较文档；H08 未获取面向最终用户的内置 OS 沙箱实现（本地非沙箱是明确取舍）；H11/H06 跨进程 subagent 独立部署形态与跨进程事件总线/事件溯源信息未获取。
8. **CL4R1T4S**：全库 UNTRUSTED；仅行为模式参照，不单独成列；不当作任何厂商现役行为事实；skill 协议仅 Codex Desktop 单点来源。
9. **跨项目共性**：MCP 不在任务书 12 行表内，各家深度不一（Pi 无客户端抽象、Hermes 轮间刷新未量化）；各家 benchmark/eval 场景与指标多为缺口或起步态（详见 H12）。

### 对使用者的要求

- 本文件为**综合文档**：单条事实以对应研究文档为准，需要深挖某一机制时请回查 `docs/research/harness-matrix/<项目>.md` 与该机制在 `comparison.md` 的 Proposed Spec。
- 凡涉 Claude Code 内部实现、Codex/Hermes 中标注 UNTRUSTED 的提示词文本、CL4R1T4S 全部内容，只能作为**行为模式/规范输入**，禁止直接复制进自研代码或 System Prompt（任务书第十八/十九节）。
- 版本漂移警告：8 个仓库均为 2026-08/09 快照锁定；Claude Code 原生二进制演进、Codex v1/v2 并存、DSH Developer Preview 等都可能在后续版本变化，引用时标注 commit。

---

（本文件是第一阶段交付物 D1；与 D2 HARNESS-COMPARISON.md 分工：本文件重"逐家完整解剖 + 共同抽象"，comparison 重"横向矩阵 + 每机制决策"。）
