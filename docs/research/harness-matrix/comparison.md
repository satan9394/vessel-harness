# Composable Agent Harness — 横向对比矩阵与逐机制决策（comparison.md）

- 定位：第一阶段研究输出总成（对应任务书第五节「统一 Harness 矩阵」），汇总 8 份研究文档（claude-code.md / claw-code.md / pi.md / deepseek-harness.md / codex.md / opencode.md / hermes.md / cl4r1t4s.md），产出 12 能力 × 7 项目的横向矩阵 + 每机制 H01–H12 决策。
- 事实来源：仅以下 8 份研究文档（各含源码/官方文档/锁定 commit 证据与数据缺口声明）；本文件不引入任何新事实，不编造。cl4r1t4s.md 为 UNTRUSTED 行为语料，仅作行为模式参照、不单独成列（任务书矩阵列 = Claude / Claw / Pi / DSH / Codex / OpenCode / Hermes 七列）。
- 报告格式：严格按任务书第二十四节固定汇报格式（实现位置 / 核心机制一句话 / Decision / Why / Rejected / Proposed Spec）。
- 数据口径：「—」= 该研究文档未获取到对应维度的资料（具体见文末数据缺口清单）。

---

## 横向矩阵总表（12 能力 × 7 项目）

| Capability | Claude | Claw | Pi | DSH | Codex | OpenCode | Hermes |
| ---------- | ------ | ---- | -- | --- | ----- | -------- | ------ |
| Agent Loop | 三阶段循环（gather→act→verify）；无 tool call 即停；请求三层前缀缓存；只读并发/写串行；Esc 中断 steer-in-flight | `ConversationRuntime::run_turn` 单轮循环：PreToolUse hook→权限→执行→PostToolUse；每轮后自动压缩检查；可插拔 ApiClient/ToolExecutor | 公开 `runAgentLoop`（事件流式、steering 消息）+ harness 层检查点化 Lane/drive 状态机（中断恢复） | `ReactLoopAgent` 驱动器：turn=零或多步；agent-loop 是可替换插件；**无内置轮次预算**；先持久后等待 | `run_turn` 单文件主循环；工具 future 异步并行回灌；Stop hook 裁决终止；无硬轮次上限靠 token 水位+压缩兜底 | runLoop：单用户回合可多次 LLM 调用；parts 落库增量渲染；doom-loop 检测；每轮重读全量消息 | 阶段化 turn_* 文件家族；跨进程 turn lease+看门狗；iteration_budget 等健壮性件齐全 |
| Prompt | Base+输出风格+项目指令分层；CLAUDE.md 以 **user message** 注入；动态段按缓存友好移到消息层；subagent 只拿自己的 prompt | `SystemPromptBuilder` 分节拼接；CLAUDE.md>CLAW.md>AGENTS.md 优先级；git 快照注入；内容去重+预算截断 | 单一长字符串（角色→tools→按工具联动的 guidelines→自文档按需读→context 文件→技能 XML→cwd）；无结构化 message 数组 | `ctx.systemPrompt.section()` 插件化段落，order+name 排序、scope 遮蔽 global；`system-prompt/assemble` waterfall 可整体改写 | world_state 30+ section 各自文件；**基线+diff 增量注入**；base instructions 有 provenance | 按供应商选 prompt 模板（anthropic/gemini/codex…）；env+instructions+MCP+skills 分块；可经插件 transform | 三层拼接（stable/context/volatile）**每会话构建一次**、跨轮复用保 prefix cache；SOUL.md 身份 |
| Context | 启动注入常驻层、按需加载重内容（skill 正文/MCP schema/path 规则）；软上限+三层截断（清 tool 输出→summarize→thrashing 停）；分类器盲化防污染 | 无独立 context 引擎：指令文件+git 快照+**全量 transcript 重发**；工具输出源头限流（bash 16KiB 截断等）；claw-rag-service 独立外挂 | 会话 Entry 树（JSONL，id/parentId），每轮从 tip 重放可见消息；token 估算近似；输出有界截断+溢出落盘 | 事件日志单一真源，`deriveMessages()` 派生历史；注入=带来源 user/message（可回放可压缩）；budget/截断/去重/转义系统化 | StepContext 每步捕获（上下文+工具+权限+环境）；world state 基线+diff；模态过滤；记忆污染标记 | 消息+parts 双层 SQLite 落库；每轮 filterCompacted 重排；tool 输出默认 2k 截断 | ContextEngine ABC 可插拔（默认 ContextCompressor）；sanitize_memory_context 脱敏+6000 字符上限 |
| Tool | 40+ 内建工具 canonical name 一套规则通吃；Bash 权限解析深（wrapper/compound/redirect）；MCP 默认 ToolSearch 延迟加载 schema | `tools/src/lib.rs` 万行单体 40+ spec，每 spec 带 required_permission；文件 canonical 化防 `../`/symlink 逃逸；bash 输出 16KiB 截断 | 8 个最小工具（bash/pwsh/read/write/edit/grep/find/ls）+ TypeBox schema 驱动；tool 执行与 I/O 解耦（Operations 可注入 SSH/容器）；无 MCP 客户端抽象 | defineTool+ValueSchemaSpec 推导类型/校验；统一流水线 pre/guard/execute/post/finalize/result；MCP 动态注册进 ctx.tools；62 个工具条目 | 工具偏少（无独立文件工具，靠 exec_command/apply_patch）；registry 分 trusted/external+保留名；tool_search 运行时发现 | 内部工具 wrap 成 AI SDK tool()；无效工具名走 invalid 工具让模型自修复；per-tool 截断；plugin 可加自定义工具 | 统一 ToolRegistry（import 即注册）+ toolsets 组合；核心工具每轮全量随请求发送；也可把工具面以 MCP server 暴露 |
| Hooks | 35+ 事件、每会话/每轮/每 tool call 三节奏；handler 五形态（command/http/mcp_tool/prompt/agent）；async+rewake；JSON 契约 | 仅 PreToolUse/PostToolUse/PostToolUseFailure 三事件；hook 输出 JSON stdout 可覆盖权限/改写输入；LaneEvent 面向编排 | 扩展事件 30+（tool_call 输入可变可 block、message_end 可改结果）+ harness HookMap（transform_context 等）两套并行 | Cordis 五种分发（emit/waterfall/parallel/serial/bail）；三事件域（会话/agent/能力）；hook-protocol 桥接 Claude Code/Codex hooks.json | 12 事件（含 PermissionRequest/Interrupt）；matcher 分组；command+MCP 双执行后端；同步/异步；input/output 均可改写 | 插件 Hooks 接口（permission.ask、tool.execute.before/after、chat.*.transform 等）；EventV2 durable 事件总线 SSE 推送 | 核心枚举钩子 pre/post_tool_call、transform_*、pre_llm_call、on_session_start/end；verify pre_verify 轮末闸；热路径 hook 有超时上限 |
| Sandbox | macOS Seatbelt / Linux bwrap+socat 原生；**Windows 原生不支持**（须 WSL2）；credential mask+代理注入；默认全盘可读需主动加固 | Linux unshare（能力探测而非存在性假设）；非 Linux 回退 HOME/TMPDIR 环境重定向（**非真实隔离**）；容器感知 | **无内建沙箱**（security.md 明示）；官方给 4 套外部隔离（Gondolin 微 VM/Docker/OpenShell/sbx），靠 ExecutionEnv/Operations 注入点 | ctx.sandbox.confine 逐调用解析；Linux bwrap→Landlock / macOS Seatbelt / **Windows ACL 受限令牌**；fail-closed（SANDBOX_UNAVAILABLE）；enforcement full/partial 透明上报 | 三平台强隔离：Linux bwrap 只读根+可写覆盖+受保护子路径；Windows 受限令牌+WFP+ACL+私有桌面；网络 MITM 代理；violation 驱动升级重试 | **无 OS 级沙箱**；安全边界=权限系统+进程派生点；shell 直接派生本机；external_directory 白名单约束文件工具 | 无默认 OS 级 jail；本地=审批+env scrubbing+工具白名单；真隔离外置 docker/modal/ssh 远程后端；PTC 脚本只许调已授权工具 |
| Memory | 转录 JSONL + auto memory（MEMORY.md 索引+topic 文件按需读）+ CLAUDE.md 层次 + checkpoint（/rewind）；30 天 retention sweep | Session JSON/JSONL 双格式持久化到 `<cwd>/.claw/sessions/<hash>/`；resume/fork（记 parent_session_id）；无独立长期记忆库 | 会话=Entry 树（/tree /fork /clone /label + 分支摘要）；JSONL v3 或 SQLite 可插拔存储；无向量记忆 | 会话=仅追加事件日志（event-sourced）；resume=重放+合成 interrupted 关闭器；fork=seed 前缀+isSeeded；**无内置长程记忆**（第三方 MCP overlay） | thread=session（session_id==根线程 ID）；rollout JSONL+sqlite；双阶段记忆管道（抽取+consolidation）；污染标记防注入进记忆 | 消息/parts 全落 SQLite（可翻页/审计/import）；step 级 snapshot patch 支持 revert；compaction summary | MEMORY.md(agent)+USER.md(用户) 磁盘文件，会话开始冻结进提示、中途写盘不改进程内提示；SQLite FTS；单一 memory 工具+MemoryProvider(仅 1 个外部) |
| Skill | Agent Skills 开放标准+扩展（allowed-tools turn 级授权、context:fork、paths 触发）；正文按需加载；冲突 enterprise>personal>project>bundled；synced 能力降级 | Skill 工具把本地技能文件说明读回给模型；多根发现（.claude/skills/.claw/legacy commands）；/skills install/uninstall；无结构化参数解析 | Agent Skills 标准；启动只注入 name/description/location 的 `<available_skills>` XML（渐进披露）；兼容 ~/.claude/skills 与 ~/.codex/skills | skill-filesystem provider 分层 rank（project-dsh 100 … user 500 … bundled 600）+ scope 链；目录只含 name+转义 description；无市场/签名 | skills crate：显式 mention（@path/sigil）按需注入 + 隐式命令触发；SkillInterface/Policy/依赖声明；系统技能指纹安装 | 三路来源（配置目录/项目/远端 URL index.json 版本化下载）；`<available_skills>` 注入；skill 工具返回正文+base 目录+样例清单 | SKILL.md frontmatter（description≤60 字符等）；/learn 用活体 agent 一次产出技能；curator 空闲自动 pin/archive（只归档不删除、可恢复） |
| Subagent | 全新上下文窗口，只回 summary+元数据；嵌套默认 3 层/并发 20；worktree 隔离；Explore/Plan/general-purpose 预设 + dynamic workflows 脚本编排 | Agent 工具=同进程命名线程+独立 runtime/会话/工具白名单（按子类型裁剪）；结果 *.md+manifest *.json；/subagent list/steer/kill | **无内建 subagent 原语**；官方示例=spawn 独立 pi 进程+JSON 模式收结果（single/parallel/chain 需自实现）；内核只给多 lane/fork 原语 | 6 个 provider（in-process/fork/ACP/Codex/Claude Code/dsh-sdk）；可继续子 agent（childId+send_message/interrupt/list_agents）；delegationDepth 持久 | v1/v2 双套工具：子代理=独立 thread（fork 窗口可选 FullHistory/LastNTurns）；角色只能收窄不能放大父权限；整棵代理树可崩溃恢复 | 子代理=独立子 Session（parentID 链，深度默认 1）；前台阻塞/后台（flag）异步注入结果；结果以 XML `<task_result>` 文本回传 | delegate_task 派生全新 AIAgent（fresh conversation+父工具剔除 child-blocked）；batch/并行/异步齐全；SubagentLifecycle 插件 API 化 |
| Evaluator | verification loop 概念核心（给可运行检查迭代到通过）；/goal 用独立小模型只读 transcript 三态判定；code-review 多 agent+verifier 过滤误报；--restricted 供 eval harness | 无输出质量评测器；以 mock-parity harness（12+ 确定性场景）+ verification-map（g-lane 行为→代码→测试对照）+ 契约校验代替 | evals=vitest-evals 适配真实 AgentSession 的模型回代行为测试（可 A/B prompts/tools/models）；无 per-run LLM judge | 无独立 evaluator 模块；验证=仓库测试体系（unit/e2e/snapshot 重放）+ plan 评审门 + subagent outputSchema + invariants 回放校验 | `codex review`=受限评审子代理（独立模型+rubrik 结构化 findings+结果写回历史）；ModelVerifications 软事件；无确定性测试栅栏 | 无独立 eval 框架（缺失/外包外部测试）；agent 生成用 generateObject 结构化输出；失败分类较全 | 无单一裁判：background_review(每轮 fork 判定存什么)+/review 全权限后台评审+verify recipe 证据闸（build→test→readiness）+evals/ 离线自评 |
| MCP | 一等公民：claude mcp add / .mcp.json / 插件内嵌 server / claude.ai connectors；stdio/http/sse/ws；动态工具更新；ToolSearch 延迟加载 | MCP 工具桥 `mcp_tool_bridge.rs` + mcp 认证工具；config 部分合法部分非法 → servers[]+invalid_servers[]（部分成功一等公民）；深度对齐未证实 | **无 MCP 客户端抽象**（需借 pi-chat/扩展自接）；docs 未发现独立 MCP 章节 | dsh-mcp-client（stdio/streamable-http）把远端工具动态注册进 ctx.tools；另有子 agent 提供方 subagent-acp | codex-mcp crate + McpRuntime；**按用户输入 mention 按需启动**服务器（required servers），prewarm/refresh/connectors | mcp.tools() 每服务器工具转 AI SDK tool，执行前 ctx.ask；MCP resources 可选注入 list/read 工具 | MCP client 注册+**轮间刷新**（_refresh_mcp_tools_between_turns）；另有把 Hermes 工具面以 MCP server 暴露（hermes_tools_mcp_server） |
| Compaction | 上下文近上限自动压缩（压力/手动/恢复）；保留清单明确（用户请求/关键文件/5 个最近文件/调用过的 skill≤5000 token）；PreCompact/PostCompact hook；thrashing 保护 | 累计 input_tokens≥100k 自动触发；保留最近 4 条逐字，旧消息启发式归纳（非 LLM）成 System 续接；不拆散 tool_use/result 对；压缩后 session-health 探针 | contextTokens>window-reserveTokens(16k) 触发；keepRecentTokens(20k) 保留尾部；切点禁落 tool result 中段+split-turn 兜底；摘要由独立 LLM 生成（fresh session 禁缓存写入）；重复压缩不漏幸存消息 | 三入口（压力 0.8×window/溢出 CONTEXT_WINDOW_EXCEEDED 先压再试/手动）；最旧**平衡** surface 段替换为 `<compacted-summary>` user/message；摘要请求复用热前缀；先记账后执行事务化 | 采样前预压缩+采样后 roll-over；**保留全部用户消息原文**、总结 assistant 与工具明细；本地/远端 v2/免总结（token-budget 开新窗口）三后端；压缩超窗从头丢项 | step-finish 后 isOverflow 触发；保留 tail ≤15k token；旧 tool 输出 40k 保护/20k 门限 prune；压缩后自动注入 "Continue if you have next steps"（重放或 auto-continue） | 自动=aux 廉价模型摘要中间轮、头尾保护、先修剪 tool 输出、按比例缩放预算；摘要含持久化提醒（MEMORY.md/USER.md 权威勿重做）；micro_compaction 默认关（保 cache）；native_compaction 服务端压缩兜底 |

> 说明：矩阵格内容为「该家在该机制的方案/特色一句话」；H01–H12 各机制章节再按固定格式展开实现位置与决策。「MCP」不在任务书 12 行能力表内，但研究文档均覆盖，故单列一行，仍计入本文档的机制编号之外的附加行（编号正文仍为 H01–H12，MCP 拆散进入 H05/H06/H11 相关决策与 Proposed Spec）。

---

# 各机制决策（H01–H12）

## H01 Agent Loop

## Claude Code
实现位置：运行时闭源（bundled JS/原生二进制）；公开面 = 文档 how-claude-code-works、CLI（`claude -p`/`--max-turns`/`--max-budget-usd`）、hooks（agentic loop 内嵌事件）、Glossary（"agentic loop""turn"）。
核心机制一句话：一次任务 = gather context → take action → verify results 三阶段；模型产出**不含 tool call 的纯文本即停**（`Stop` hook / SDK `ResultMessage`），每轮请求按「system 层→project context 层→conversation 层」三层前缀缓存排序，只读工具并发、Edit/Write/Bash 串行，Esc 中断在飞工具并 steer-in-flight。

## Claw Code
实现位置：`rust/crates/runtime/src/conversation.rs` 的 `ConversationRuntime::run_turn()`（L325-531）；CLI 侧组装在 `rusty-claude-cli/src/main.rs`。
核心机制一句话：一次 `run_turn` = push 用户消息 → stream 合成 assistant → 无 ToolUse 则终止，否则逐工具走 PreToolUse hook → 权限 → 执行 → PostToolUse → tool_result 回灌；每轮（含终止轮）落盘后 `maybe_auto_compact()`；运行时抽象成可注入的 `ApiClient`/`ToolExecutor` trait，迭代上限与压缩后 session-health 探针防死循环。

## Pi
实现位置：公开层 `packages/agent/src/agent-loop.ts`（`runAgentLoop`/`runLoop`）+ `agent.ts`；新一代 harness 层 `packages/agent/src/harness/runtime/lane.ts`（主状态机）+ `drive.ts`。
核心机制一句话：双层 while（外层跟 queued follow-up/steering，内层逐 tool call 直到 stop/error/aborted），turn 间 `prepareNextTurn`（压缩挂这里）、`getSteeringMessages` 支持流式打字排队的 steering；harness 层把一次 run 做成检查点化的操作状态机（admission→checkpoint→generation→tools→boundary→reconcile），事件全量发布 `HarnessEvent`、drive 从 durable checkpoint 恢复崩溃 run。

## DSH
实现位置：`packages/core/agent-loop`（`src/agent.ts` 的 `ReactLoopAgent`、`tool-calls.ts` 调度、`constants.ts` `DEFAULT_MAX_PARALLEL_TOOL_CALLS=10`）；抽象面 `packages/core/agent`；重试 `packages/llm/llm-retry`。
核心机制一句话：turn=零或多个 step（一次模型请求+其调用的工具），驱动器在轮次边界先开持久轮次再原子领取 next-step 输入+一条排队消息（Inbox.claim）；`agent/pre-step` waterfall 决定消息是否进入；`agent/turn-stopping`（serial）收尾、可强制再执行一步；**无内置轮次预算**（README 明示由扩展点施加）；取消协作式（`agent.cancel()`），`llm-retry` 先持久 `llm/retry` 事件再等待。

## Codex
实现位置：`codex-rs/core/src/session/turn.rs`（`run_turn` 主循环、`run_sampling_request`）；`tools/parallel.rs`（`ToolCallRuntime`）；`agent/control/execution.rs`（多代理容量）。
核心机制一句话：采样循环内模型输出工具调用即持久化 item 并把执行 future 推入 `FuturesOrdered` 并行执行、结果以 `FunctionCallOutput` 回写历史由 `needs_follow_up` 驱动下一轮；`run_turn_stop_hooks`（Stop hook 可 stop 或 block+注入 continuation prompt）收尾；无显式 max turns，靠 token 水位+自动压缩滚动窗口兜底；单次采样内 tokio 取消令牌协作（AbortOnDropHandle）。

## OpenCode
实现位置：`packages/opencode/src/session/prompt.ts`（`runLoop` L1052 起）；`session/processor.ts`；`session/run-state.ts`。
核心机制一句话：一个用户回合内 `while(true)` 可多次调用 LLM（每次生成独立 assistant message 直到 finish 非 tool-calls/error/blocked）；每轮先处理 pending compaction/subtask 任务再取 agent（mode/steps/permission）→ `SessionProcessor` 把 LLM 事件流写成 parts 落库 → processor 返回 `"compact"|"stop"|"continue"` 决定 break 或带工具结果续跑；`SessionRunState` 保证每 session 同时只有一个 runner，doom-loop（同工具同输入 ≥3 次）转权限询问。

## Hermes
实现位置：`agent/conversation_loop.py`（`run_conversation`）+ `turn_facade.py` + `turn_*.py` 阶段文件家族（build_turn_context/api_call/api_error/finalizer/stop_gates/overflow…）。
核心机制一句话：单轮驱动 = build_turn_context（stdio 守卫、restore-or-build 系统提示、idle/preflight 压缩、pre_llm_call hook）→ model 调用（retry/fallback/rate-limit guard）→ tool dispatch → 迭代直到 finalize；跨进程会话有 durable turn lease + 刷新线程 + 看门狗防双写。

## Decision
最终采用：**「最小可替换 Loop + 事件驱动轮次语义」组合**——以 Claude Code 的"无 tool call 即停/纯文本即停"终止判据为对外语义，以 DSH 的"会话事件日志为单一真源、loop 保持唯一具体实现且可替换、轮次可持久重建"为内部结构，叠加 Codex/Claw 的"Stop 钩子裁决终止 + 压缩后健康探针 + 每轮迭代上限可配"。对外行为不采用 Pi/Claw 的"单个用户轮即一次 run_turn"窄接口，而是 OpenCode/DSH 的"一个用户回合=多次 LLM step（turn 内可多 step）"。

## Why
至少对比两个候选：
- 候选 A（Claude Code 型：交互无上限 + 模型自判停 + 三层缓存）——优点：终止语义极简且对外可观测（SDK 消息流/事件流），前缀缓存工程成熟；缺点：交互模式无默认轮次上限（开放任务可能无限循环），运行闭源无法复现内部。
- 候选 B（DSH 型：轮次=可重建事件、loop 可整体替换插件、无预算交扩展点）——优点：每轮模型可见输入⟺已记录、崩溃恢复=重放、所有旁路行为挂在文档化扩展点（agent/turn-stopping 等），符合本项目的"Composable"目标；缺点：抽象层重、无内置轮次预算需要自建。
- 对比结论：本项目要自研可组合 harness（禁止事项 3：不因某家功能最多就选为底座；禁止事项 7：不把所有上下文永久塞 system prompt），因此以 B 的事件溯源内核为骨架（保证可回放/可恢复/可压缩），吸收 A 的"纯文本即停"对外语义与「读并发/写串行」并行纪律、Claw 的压缩后健康探针、OpenCode 的 doom-loop 防护（每机制各取可迁移点）。轮次预算**不做进内核**而作为 Policy 层扩展（与 DSH 立场一致），但 v0.1 默认装配一个 `maxStepsPerTurn` 硬顶避免开发期失控。

## Rejected
没有采用：
- 不采用 Pi 双轨（公开 Agent loop + harness Lane/drive 并存）：迁移期语义双轨、同一产品两套循环，自研项目应只有一个权威 loop。
- 不采用 Claw Code 的"run_turn 只执行单个用户轮、REPL 持续性全在 CLI 层"：把循环语义拆散到 UI 层，事件/后台/steering 无法统一建模。
- 不采用 Codex 单文件 run_turn（2881 行多分支）：不可维护。
- 不采用"无任何轮次上限"作为默认：任务书禁止事项 6（Generator 默认自己判定完成）要求可验证收敛，交互/非交互都需要预算兜底。
原因：单一权威循环 + 事件日志真源是本项目可组合性的前提；轮次收敛必须同时有模型语义终止（纯文本即停）与机械上限（预算）两层保障。

## Proposed Spec
Behavior IR v0.1 草案（实现规范）：
```yaml
loop:
  turn_model: "user-turn = 1+ steps; step = one model request + its tool calls"
  stop_condition: assistant 消息无未决 tool_call（纯文本/终结）即结束本轮
  tools_parallelism: read 类并发（受 max_parallel_tool_calls 滚动池约束）、write/bash 串行、独占工具=排序屏障
  iteration_cap: max_steps_per_turn: 64        # 机械硬顶，超限强制终轮并标注 partial
  pre_turn_checks: [ 压缩后健康探针(借鉴 Claw), 前一回合 tool_use/result 配对校验(借鉴 DSH invariant) ]
  doom_loop_guard: 同工具同输入连续 >=3 次 -> 转权限询问/暂停（借鉴 OpenCode/Claw）
  retry: 指数退避+抖动，先持久 llm/retry 事件再等待；rate_limit/overloaded/server/timeout 可重试，auth/model 错误不重试
  cancellation: 协作式（cancel 以 interrupted 标记落盘，未分发工具给 ABORTED_BEFORE_DISPATCH 合成结果）
  observability: 每 step 发 typed event（step/start, assistant/*, tool/*, step/end, turn/end{kind: success|error|interrupted|budget}）
  resume: 同一会话事件日志追加 + 合成 interrupted 关闭器（不截断长轮次）
  budget: 默认装配 max_budget_usd 可选；policy 层可挂 turn 数/花费预算扩展
```

---

## H02 System Prompt

## Claude Code
实现位置：运行时闭源；公开可配置面 = `--system-prompt(/-file)`（整体替换）、`--append-system-prompt`（追加）、`output-styles/`、`--exclude-dynamic-system-prompt-sections`、subagent frontmatter body。
核心机制一句话：Base（核心指令+工具说明+响应格式，先载且用户不可见）→ auto memory → env → MCP 工具名（延迟）→ skill 描述索引 → 用户/项目 CLAUDE.md → 用户 prompt；CLAUDE.md 以 **user message 注入而非 system prompt**；动态段（cwd/git 状态）移进消息层以保 prompt cache。

## Claw Code
实现位置：`rust/crates/runtime/src/prompt.rs`（`SystemPromptBuilder` L155-263、`ProjectContext`、`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`）；`tools/src/lib.rs` 的 `build_agent_system_prompt`。
核心机制一句话：`Vec<String>` 分节拼接（intro→output style→system→doing-tasks→actions→动态边界→环境→项目上下文→记忆指令→config→追加段）；指令文件优先级 CLAUDE.md > CLAW.md > AGENTS.md，发现边界=git root；内容去重（稳定哈希）+预算截断；git 仓库注入 status/diff/log 快照。

## Pi
实现位置：`packages/coding-agent/src/core/system-prompt.ts`（`buildSystemPrompt`）；`core/resource-loader.ts`（`loadProjectContextFiles` 加载 AGENTS/CLAUDE 上下文文件）。
核心机制一句话：单一长字符串——角色一句 → `Available tools:` 按注册工具裁剪 → Guidelines 随工具集联动（有 grep/find/ls 就不鼓励 bash 探索）→ pi 自文档按需读 → context 文件（AGENTS.override.md/AGENTS.md/CLAUDE.md 祖先逐层拼接去重、worktree shadow 处理）→ 技能 XML 块 → cwd。

## DSH
实现位置：`packages/core/system-prompt`（`ctx.systemPrompt.section()/assemble()`、`system-prompt/assemble` waterfall）；`packages/context/agent-instructions`（AGENTS.md/CLAUDE.md 预算 baseline/refresh）；`packages/preset/agent-presets`。
核心机制一句话：插件注册片段（`section({name, order, text|fn})`），组装按 order+名称排序后跑 `system-prompt/assemble` waterfall（监听器可改写、`complete` 段强制唯一）；支持 `{{variable}}` 插值；scoped section 遮蔽 global；工作区指令 baseline 作为**持久 user 消息**注入（宽泛→具体），比 system prompt 更轻、可压缩。

## Codex
实现位置：`codex-rs/core/src/session/world_state.rs`（`build_world_state_for_step`）+ `context/world_state/*.rs`（每 section 一文件）；`agents_md.rs`。
核心机制一句话：Base（模型自带 base instructions，可被配置覆盖并记录 provenance）→ model-specific（personality/effort）→ 项目 AGENTS.md（根→cwd 逐级收集、AGENTS.override.md 本地覆盖、`--- project-doc ---` 分隔）→ 动态（时间/token 预算/环境清单/权限提示等 world_state section）；完整注入一次持久化为**基线**，之后每步只渲染 diff。

## OpenCode
实现位置：`packages/opencode/src/session/system.ts` + `session/prompt.ts`（组 system 数组）+ `session/prompt/*.txt`（anthropic/gemini/gpt/codex/kimi…按供应商模板）。
核心机制一句话：`[env, instructions(AGENTS.md), mcp_instructions, skills块]`，模板按 model.api.id 匹配（claude→anthropic.txt…缺省 default.txt）；指令注入 = global AGENTS.md(+~/.claude/CLAUDE.md) → 项目上溯**第一个** AGENTS.md/CLAUDE.md → config.instructions（文件+http URL）；plan→build 切换时注入 plan.txt 等 SessionReminders。

## Hermes
实现位置：`agent/system_prompt.py` + `agent/prompt_builder.py`（identity/guidance/hints/skills index/context files）+ `SOUL.md`（身份）。
核心机制一句话：**三层拼接**（`\n\n` join）：stable（identity/guidance/env hints/coding brief）→ context（workspace 快照/caller system_message/context files）→ volatile（skills index/memory/USER.md/时间戳）；**每会话构建一次、跨轮复用**，唯一重建触发是 context compression（保住上游 prefix cache）；写系统提示的斜杠命令默认延后（`--now` 立即）。

## Decision
最终采用：**「分层组合 + 注入即数据」**——以 Hermes 的"三层 stable/context/volatile 拼接 + 每会话构建一次、跨轮复用保缓存"为组装纪律，以 DSH 的"指令基线作为带来源的持久 user 消息（可压缩、宽泛→具体、去重+转义）"为注入语义（继承 Claude Code「CLAUDE.md 是 user message 不是 system」的官方行为差异），以 Codex 的"section 化 + 基线/diff"为工程结构。系统提示词与项目指令分离：系统提示只承载"稳定身份 + 轮询不变的引导"，一切可变知识（项目规则、记忆、技能目录、环境）都作为独立注入层，禁止把所有上下文永久塞进 system prompt（任务书禁止事项 7）。

## Why
- 候选 A（Claude Code/DSH：指令当 user message 注入）：优点——指令语义是"建议非硬约束"显式化、可被压缩覆盖、缓存破坏小；缺点——若注入时机与排序不严，用户消息与注入消息会互相污染历史。
- 候选 B（Pi/Hermes：全拼单一大字符串，含 context files 直接嵌入）：优点——整体替换容易、SDK/测试友好（evals 用 transformSystemPrompt）；缺点——无结构化边界、模型/厂商差异靠 XML 标签消化、长 prompt 缓存代价高。
- 对比结论：两者都需要"分层 + 按需 + 缓存敏感"，但 A 的"指令即持久 user 消息"与事件溯源（DSH：模型可见⟺已记录）天然契合，可作为注入事件的原子单位，比 B 的整串拼装更可审计、可压缩、可恢复。故取 A 语义 + B 的"身份段轻量、工具列表按注册裁剪、guidelines 与工具集联动"写法（Pi）与 Hermes 的三层稳定顺序（stable 身份→context 快照→volatile 索引）。

## Rejected
没有采用：
- 不采用 Codex/OpenCode 的"每步都注入 token 预算/时间提醒等动态 section 进 system"作为常驻（Codex 用基线+diff 缓解，我们 v0.1 不做 diff 注入，动态提醒走事件注入）。
- 不采用 OpenCode 的按供应商维护十余份模板（anthropic/gemini/gpt/codex/kimi…）：多模板并行维护成本高、匹配脆弱；本项目 v0.1 只维护一份 provider 中立模板。
- 不采用 Claw 的"向 Claude Code 靠拢的简化分节"（无字节级对齐价值且闭源上游不可考）。
原因：v0.1 目标不是复刻某厂商人格而是自研可组合行为；一份模板 + 分层注入 + 事件溯源即可满足，保留 section() 扩展点供后续 provider 差异挂载。

## Proposed Spec
```yaml
prompt:
  assembly: sections[] 按 order 升序（stable 身份 < project 指令 < volatile 索引）\n\n join；每会话组装一次并缓存，跨轮复用
  stable_layer: [ 身份一句, 输出风格(可选 UserStyle 三档), 工具调用纪律(只调显式工具/调前说明原因/能不加不加) ]
  context_layer: [ workspace 快照(cwd/平台/git 状态), caller 消息 ]
  volatile_layer: [ skills 目录(name+description, 无正文), memory 摘要, 环境/时间戳 ]
  injection_as_user_message: true   # AGENTS.md 层/记忆/技能目录 = 带 source 的持久 user 消息，可压缩可回放
  instruction_files: 发现顺序 AGENTS.md > CLAUDE.md > CLAW.md（可关），作用域=git root→cwd，去重+maxBytes 预算(默认 64KiB)+超预算"宽泛先丢、具体后截"并可见通知
  injection_order: 宽泛(用户全局) -> 具体(项目/目录)
  escaping: 注入文本内 </system-reminder> 转义；skill description XML 转义
  rewrite_hooks: system-prompt/assemble 级 waterfall（可整体替换/追加，支持 complete 段强制唯一）
  model_visible_iff_recorded: 任何进入请求的 prompt 段须能从会话日志重建（缺则运行时不变式失败）
```

---

## H03 Context Engine

## Claude Code
实现位置：运行时闭源；公开面 = 《Explore the context window》时间线、prompt-caching、`/context`、`/cost`、statusline。
核心机制一句话：System 每次请求都带（缓存）；User/对话历史每轮追加永不重置；CLAUDE.md 启动加载根到 cwd、子目录与 path 规则**首次接触匹配文件时按需加载**；MEMORY.md 前 200 行/25KB 启动注入、topic 文件按需读；skill 描述索引启动注入、正文按需注入后跨轮保留；MCP schema 默认延迟（ToolSearch）；bash/任务输出按 `bashOutputMaxChars` 截断存文件给预览+路径；**无 RAG 子系统**（近似物=auto memory 索引 + path-scoped rules）。

## Claw Code
实现位置：无独立 context engine；上下文 = prompt.rs 项目/记忆上下文 + git 快照 + session.rs 全量 transcript + `api/src/prompt_cache.rs`；外挂 `claw-rag-service` crate。
核心机制一句话：每次请求重发 `system_prompt + session.messages` 全量 transcript（无裁剪中间层），token 增长靠 compaction 收敛；工具输出源头限流（bash 16KiB、文件读 10MiB 上限）；RAG 服务与主 runtime 解耦（未见核心接线证据）。

## Pi
实现位置：coding-agent `agent-session.ts`（消息历史在 Agent context 内）+ `core/messages.ts`（AgentMessage 自定义类型扩展）；harness 层 `harness/runtime/transcript.ts`（`readBoundedContext` 按 compaction 边界裁剪）+ `session/jsonl`/SQLite backend。
核心机制一句话：公开层把 AgentMessage 数组每次 LLM 调用边界转换/过滤成厂商消息；会话以 Entry 树持久化、每次构建上下文从当前分支 tip 重放（含 compaction 摘要与 `firstKeptEntryId` 之后消息）；token 用估算或厂商 usage 换算；无 RAG/向量检索。

## DSH
实现位置：组装 `packages/core/system-prompt` + `packages/core/session`（`deriveMessages()`、`request/context`）；`packages/llm/token-meter`；`packages/spill/*`（工具输出 spill，`maxInlineBytes: 50000`）；注入方统一走 `agent.inject()`/pre-step。
核心机制一句话：会话日志单一真源，`deriveMessages()` 从三种 surface 事件（user/message、assistant/message、tool/result）按序投影出模型历史（缓存每个 surface 节点、compaction 替换时重建）；工具定义按允许列表投影为 ToolSchema[]（回调/超时等绝不上行）；指令/skill 目录/工具输出各有显式字节预算与截断；spill 把 >50KB 工具输出外置文件；注入上下文与普通提示词共用一条带 source 的 user/message 词汇。

## Codex
实现位置：`core/src/session/step_context.rs` + `context_window.rs`/`token_budget.rs`（token 水位）+ `context_manager/history.rs` + `context/contextual_user_message.rs`。
核心机制一句话：每步（step）捕获 StepContext：用户输入 hook 检查 → 按 mention 启动 MCP → 构建 world state section → `clone_history().for_prompt(modalities)` 按输入模态过滤图像 → 采样后更新 world state 基线持久化 diff；`context_window_token_status` 区分 active/auto_compact_scope/full limit；压缩再超窗则 `remove_first_item`（从头丢、保前缀缓存）。

## OpenCode
实现位置：`packages/opencode/src/session/message-v2.ts`（消息→ModelMessage 转换、`filterCompacted`）+ `session/session.ts`（SQLite CRUD）+ `overflow.ts`。
核心机制一句话：消息=user/assistant message + parts（text/reasoning/tool/step-*/patch/compaction…）双层落库；每轮 `filterCompacted` 读全消息按 compaction 关系重排（compaction-user→summary→retained tail→continue-user）再转 AI SDK ModelMessage；已完成 tool 结果默认 2k 字符级截断；不同模型切换丢弃 reasoning 元数据；token 估算近似。

## Hermes
实现位置：`agent/context_engine.py`（`ContextEngine` ABC，可插拔，默认 `agent/context_compressor.py` 的 ContextCompressor）。
核心机制一句话：ABC 生命周期 `on_session_start → 每响应 update_from_response → 每轮 should_compress/compress(带理由) → on_session_end`（仅在真实会话边界触发，绝不每轮调）；`sanitize_memory_context` 对跨 egress 记忆文本脱敏+头尾截断（6000 字符上限）；压缩决策可被宿主查询原因、preflight 与真 usage 分开评估。

## Decision
最终采用：**「事件日志派生 + 分层按需 + 源头截断」**——以 DSH 的"日志单一真源、surface 投影、注入=带来源持久消息、显式字节预算"为骨架（这是与自研 harness 的 event-sourced 会话最一致的上下文模型），以 Claude Code 的"启动注入常驻层 + 按需加载重内容（skill 正文/MCP schema/path 规则）+ 软上限截断优先于压缩"为加载策略，以 Claw/Pi/OpenCode 的"工具输出源头限流/截断+溢出落盘回读"为输出管理。不引入 RAG（四家研究均无内建 RAG，任务书 H03 亦无此要求），以 grep/glob/read + 会话检索为等价物。

## Why
- 候选 A（Claude Code 型：会话历史+文件读取即 tool result 入会话、按需加载 MCP/skill/path 规则、无 token 硬预算靠观察干预）：优点——加载规则直观、"接触匹配文件才加载"省 token；缺点——上下文构成不可机器校验、无预算控制。
- 候选 B（DSH 型：事件日志真源 + 派生 + 一切注入皆持久消息 + 预算/去重/转义系统化强制）：优点——无第二份"上下文状态"可漂移、可回放可压缩、污染防护类型级强制；缺点——request/header 全量快照+每步派生带来日志体积与实现复杂度。
- 对比结论：B 的"模型可见⟺已记录"不变式正是任务书三阶段（Behavior IR/Compiler）与 Evaluator 需要的可审计性；A 的"按需加载绑定首次接触事件"是其加载时机设计，可以在 B 之上作为注入策略实现。两者不冲突，B 为底、A 为加载策略。

## Rejected
没有采用：
- 不采用 Claw 的"全量 transcript 每轮重发、无中间层"：token 线性增长无预算，长会话必然劣化（claw 靠 compaction 硬收敛）。
- 不采用 OpenCode 的"每轮全量读库+序列化转换+重排"：长会话 CPU/估算成本线性增长（其 filterCompacted 顺序边界敏感）。
- 不采用 Pi 的"每轮从 JSONL 重放整条分支"（读放大）作为唯一路径：v0.1 至少做内存缓存 surface + 增量追加。
原因：全量重发/重读在开发期可接受但在长会话不可扩展；事件溯源 + 缓存投影是既保证正确性又控制成本的组合。

## Proposed Spec
```yaml
context:
  source_of_truth: 会话事件日志（append-only）；模型可见输入须能由日志重建
  projection: surface(user/message, assistant/message, tool/result) -> deriveMessages()，节点缓存、compaction replace 时重建
  startup_inject: [ 稳定 system 层, 指令基线(AGENTS.md 链), skills 目录索引(name+description) ]
  lazy_inject: [ skill 正文(调用时), 子目录 AGENTS.md/path 规则(首次 touch 匹配文件), MCP schema(首次调用) ]  # 绑定事件：成功 read/write/edit 的 touch 通知
  inject_channel: agent.inject() 队列化 -> 下一 pre-step 作为带 source 的 user/message 进入，不唤醒驱动器
  budget: 指令 maxBytes 65536；skill 目录/工具输出独立预算；工具输出源头截断(默认 16KiB inline，超限 spill 落盘并给预览+路径)
  token_usage: tokenMeter 按已消费日志 revision 定价；request/context 事件记录 contextWindow
  trimming_order: [ 清旧 tool output -> compaction -> thrashing 保护停止 ]
  pollution: lossless-JSON 校验拒绝非 JSON；注入框架转义 </system-reminder>；外部内容(子代理报告/网页)进入前模式扫描或隔离
  no_rag: 不做内建向量检索；等价物=grep/glob/read + 会话 SQLite 全文检索(opt-in)
```

---

## H04 Compaction

## Claude Code
实现位置：运行时闭源；公开面 = context-window "What survives compaction"、hooks `PreCompact`/`PostCompact`、checkpointing "Summarize"、SDK `compact_boundary`。
核心机制一句话：上下文接近窗口上限自动压缩（/compact 手动可带焦点指令）；压缩=先清旧 tool outputs 再整段 summarize，摘要请求=相同 system+tools+历史+末尾追加总结指令（复用前缀缓存，缓存冷时最贵）；**保留清单**：用户请求与意图、关键技术概念、检查/修改过的文件与代码片段、最多 5 个最近修改文件（重读）、调用过的 skill 正文（≤5000 token/个）；CLAUDE.md/auto memory/MCP 启动内容压缩后自动重载；不保留完整 tool 输出与中间推理；同一 session 原地替换（/clear 才是新会话）；auto-compact thrashing 连续无效即停报错。

## Claw Code
实现位置：`rust/crates/runtime/src/compact.rs`（`should_compact`/`compact_session`/`summarize_messages`）+ `conversation.rs` `maybe_auto_compact()`（L571）。
核心机制一句话：累计 `input_tokens ≥ auto_compaction_input_tokens_threshold`（默认 100_000，env 可调）触发；保留最近 4 条逐字（`preserve_recent_messages=4`、`max_estimated_tokens=10_000`），旧消息由**启发式 summarize（非 LLM）**归纳成 System 续接消息（preamble+Summary+保留尾部提示）；边界不拆散 tool_use/tool_result 对（防 OpenAI-compat 400 orphaned tool message）；压缩后下一轮先做 session-health 探针，失败拒绝该轮。

## Pi
实现位置：coding-agent `core/compaction/compaction.ts`（865 行）+ `agent-session.ts`（turn 结束后用量换算→`shouldCompact(contextTokens, contextWindow, settings)`）；harness 层 `harness/compaction/compaction.ts`。
核心机制一句话：触发 `contextTokens > contextWindow - reserveTokens(16_384)`、`keepRecentTokens(20_000)` 保留尾部；切点从最新消息倒走累计 token、只允许在 user/assistant/bashExecution/custom 边界切（**禁止切在 tool result 中段**、大 turn 走 split-turn 双摘要）；cut 点前消息序列化（附上次 summary+readFiles/modifiedFiles）交一次**独立 LLM 调用**生成结构化摘要（fresh routing session、禁 prompt-cache 写入）；追加 `CompactionEntry{summary, firstKeptEntryId}`，下次模型看到=system+summary+真实消息尾部；重复压缩从上次保留边界续算不漏幸存消息。

## DSH
实现位置：seam `packages/compaction/compaction`（`ctx.compaction` + `compaction/*` 事件）+ 后端 `compaction-basic`（`region.ts`/`summarizer.ts`）+ `compaction-tool-result-pruner`。
核心机制一句话：三入口——自动压力（`agent/pre-step` 监听器，默认 `thresholdRatio: 0.8 × contextWindow`）、溢出恢复（`agent/request-error` 响应 `CONTEXT_WINDOW_EXCEEDED` 先压再试 `maxOverflowRetries: 1`）、手动 `/compact`；压缩最旧**平衡** surface 范围（tool call/result 必须配对、可不整轮），保留尾部逐字（`retainRatio: 0.16`/`retainTokens`），旧段替换为一条 `<compacted-summary>` 框定的 user/message（`surfaceOp: replace`），原始摘要全文保留在仅日志的 `compaction/summary` 事件；摘要请求复用上次请求热前缀（KV Cache 友好）；`compaction/start`(锁)→摘要→`summary`+替换→恰好一次 `compaction/end` 事务化；压缩不新建会话。

## Codex
实现位置：`codex-rs/core/src/compact.rs`（本地）+ `compact_remote_v2.rs` + `compact_token_budget.rs`（免总结开新窗口）+ `state/auto_compact_window.rs`。
核心机制一句话：采样前预压缩（pending 输入会推高 token 时提前）+ 采样后 `should_roll_over` 触发（MidTurn）+ 手动 `/compact`；`collect_annotated_user_messages` **保留所有用户消息原文**（带身份）、压缩掉 assistant 消息与 tool call/result 明细；摘要+用户消息序列重建历史、重注入 world state、推进 auto-compact 窗口号；压缩请求复用 `stream_max_retries` 与退避，压缩中再超窗从历史头部删项重试（保前缀缓存）；同会话开新"上下文窗口"非新会话；PreCompact/PostCompact hooks 全程可介入。

## OpenCode
实现位置：`packages/opencode/src/session/compaction.ts` + `overflow.ts` + `agent/prompt/compaction.txt`（隐藏 compaction agent）+ `session/summary.ts`。
核心机制一句话：每 step-finish 后 `SessionSummary.summarize`（diff stats），`isOverflow` 为真→注入 compaction part→下一轮 `compaction.process`：选 head/tail（保留最近 N turn ≤ `preserve_recent_tokens`，默认 min(15k, max(2k, usable*25%))），旧历史序列化文本喂隐藏 compaction agent 产出结构化 summary；随后**重放**（overflow 场景从最后一个非 compaction user 消息重放）或 **auto-continue**（合成 "Continue if you have next steps…" 带 `compaction_continue` 元数据）；`prune`：旧完成 tool 输出在 PRUNE_PROTECT(40k) 保护后、超 PRUNE_MINIMUM(20k) 时清空标 `compacted`（保留 skill 类输出）；插件可替换 compaction prompt 与决定 auto-continue。

## Hermes
实现位置：`agent/context_compressor.py`（主压缩）+ `agent/micro_compaction.py` + `agent/native_compaction.py`（服务端）+ `compression_facade.py`。
核心机制一句话：默认自动压缩=**aux 廉价模型**把中间轮次摘要成 handoff summary、头尾受保护、迭代式摘要+token 预算 tail+**先修剪 tool 输出**+按比例缩放预算；摘要含一条持久化提醒（MEMORY.md/USER.md 永远权威、勿重做已述工作）；micro_compaction 把旧 exchange 折进滚动 summary marker 但**默认关**（每轮重写前缀破坏 cache）；native_compaction 对 gpt-5.6 直连后端启用 `context_management=compaction`，本地压缩器保持武装兜底；压缩在超时围栏+commit fence 下对快照运行。

## Decision
最终采用：**「事务化平衡区域替换 + 尾部逐字保留 + 摘要请求复用热前缀 + 多入口」**——以 DSH 的 compaction 语义为蓝本（最旧**平衡** surface 段替换为带 source 的 summary user/message、先记账后执行、恰好一次 end、崩溃表现为可检测锁、三入口统一），叠加 Claude Code 的"保留清单"（关键文件重读、调用过的 skill 限量重注入、启动层自动重载）、Codex 的"保留全部用户消息原文"与"压缩中再超窗从头部丢项保前缀"降级、Pi/Claw 的"切点不拆 tool_use/result 对 + 保留尾部 token"、OpenCode 的"auto-continue/重放"续作语义。摘要生成默认用独立 LLM（复用当前前缀），可配置 fallback 到启发式（Claw 型）以省成本。

## Why
- 候选 A（Claude Code/Codex：把 assistant 消息与工具明细交给摘要、保留用户消息/关键文件，属"摘要人话 + 重读文件"）：优点——用户指令不丢、重读最近文件恢复操作性上下文；缺点——工具执行细节必然丢、摘要信息损失不可控。
- 候选 B（DSH/Pi：事件日志内区域替换 + surface 节点遮蔽 + 工具配对边界 + 事务锁）：优点——压缩可回放可检测、不破坏工具配对完整性、KV Cache 前缀复用是显式目标、重复压缩不漏消息；缺点——实现复杂（锁/账目/区域计算）、摘要仍是一次额外模型请求。
- 对比结论：事件日志真源下 B 是唯一能保证"压缩后模型可见内容仍可由日志重建"的方案（与 H01/H03 一致）；A 的保留清单作为 B 的摘要内容指引（summarizer 提示里要求列出关键文件/未完成任务/当前工作）。

## Rejected
没有采用：
- 不采用 Claw 的纯启发式（非 LLM）归纳为主路径：长会话信息损失风险高（保留为可配 fallback）。
- 不采用 Hermes micro_compaction 默认开：每轮重写前缀破坏缓存，v0.1 默认关（与 Hermes 自己立场一致）。
- 不采用 OpenCode 的"旧 tool 输出字段直接清空标占位"作为主路径：`[Old tool result content cleared]` 使旧细节不可再查；改为 spill 落盘+可回读。
- 不采用"压缩=另起新会话/丢 session/end-seed"类语义：压缩必须原地、同一会话日志内（Claude/DSH/Codex/Pi 一致，除 OpenCode 的 token-budget 新窗口模式，v0.1 不做）。
原因：可重建性是本项目 evaluator/回放/审计的地基，任何让历史不可追溯的压缩策略都被排除。

## Proposed Spec
```yaml
compaction:
  entries: [ 压力自动(thresholdRatio 0.8 * contextWindow, agent/pre-step 检查), 溢出恢复(CONTEXT_WINDOW_EXCEEDED -> 先压再试, maxOverflowRetries 1), 手动 /compact(可带 focus 指令) ]
  region: 最旧"平衡"surface 范围（tool/result 配对、可不整轮）；保留尾部逐字（retainRatio 0.16 或 retainTokens 可配）
  summary: 独立 LLM 生成 -> user/message surfaceOp:replace(start,end) + sourceEventSeqs 覆盖被遮蔽节点；原文摘要存 compaction/summary 仅日志事件
  summarizer_hint: 必列=用户请求与意图/检查修改过的文件/未完成任务/当前工作/关键代码片段; 保留全部用户消息原文
  reload_after: [ 启动层(指令基线/技能目录索引/MCP 工具名) 重载, 最近 <=5 个修改文件重读, 调用过的 skill 正文限量(<=5000 token/个) 重注入 ]
  hot_prefix: 摘要请求逐字回放上次路由请求的 system/tools/被遮蔽段 -> 成为会话真前缀（KV Cache 友好）
  pairing: 区域边界 tool call/result 配对；tool-result-pruner 先修剪超长结果(thresholdChars 8192, head 4096/tail 1024, 无模型调用)
  tx: compaction/start(锁) -> summary -> compaction/summary + replace -> 恰好一次 compaction/end；崩溃=可检测锁(busy)/陈旧锁忽略
  degraded: 摘要失败拒绝"不缩小的摘要"；压缩后健康探针失败 -> 拒绝该轮并提示新会话(借鉴 Claw)
  continuation: 压缩后自动注入 continue 提示（auto-continue 可关）；重复压缩从上次保留边界续算
  not_new_session: true（同一会话日志原地替换；/clear 才是新会话）
```

---

## H05 Tool System

## Claude Code
实现位置：运行时闭源；公开面 = Tools reference、`mcp.md`、Agent SDK custom-tools、commands.md、settings（permissions/hooks）。
核心机制一句话：40+ 内建工具（Read/Edit/Write/Glob/Grep/Bash/PowerShell/WebSearch/WebFetch/Agent/Skill/Task*/TodoWrite/Workflow/AskUserQuestion/ToolSearch…）canonical name 一套规则通吃 permission/hook/subagent 三处；dispatch=模型 tool call → permission 评估（deny→ask→allow 先匹配）→ PreToolUse hook → 执行（读并发/写串行）→ PostToolUse/PostToolUseFailure → PostToolBatch → result 作 user message 回模型；MCP 命名 `mcp__<server>__<tool>`、动态更新、ToolSearch 延迟加载 schema。

## Claw Code
实现位置：`rust/crates/tools/src/lib.rs`（~10.8k LOC 单体：`ToolSpec`/`mvp_tool_specs()`/`execute_tool`）；文件工具 `runtime/src/file_ops.rs`；MCP 桥 `runtime/src/mcp_tool_bridge.rs`。
核心机制一句话：工具面按 Claude Code 命名暴露 40+ spec，每 spec 携带 `required_permission`；`GlobalToolRegistry`（builtin+plugin+runtime）；文件工具 canonical 化拒绝 `../`/symlink 逃逸、读写 10MiB 上限、NUL 二进制检测；bash 输出 16KiB 截断；多处 registry-backed 近似或桩（AskUserQuestion pending 载荷、RemoteTrigger stub）。

## Pi
实现位置：定义/契约 `packages/agent/src/types.ts`（AgentTool/AgentToolResult/before/after 钩子/ToolExecutionMode）+ harness 层 TypeBox schema；coding-agent 内置 `core/tools/{bash,powershell,read,write,edit,grep,find,ls}.ts` 共 8 个。
核心机制一句话：工具 schema 由 TypeBox 定义贯穿校验/提示/UI；执行按 ToolExecutionMode：sequential 逐个 / parallel 先全 preflight（before_tool 可 block）再并发执行允许者；工具上下文注入与文件变更互斥队列（file-mutation-queue）防并行编辑竞态；bash 输出有界截断+完整落盘路径返回；每个工具分"定义(schema+prompt)"与"pluggable operations"两层（BashOperations.exec 可被覆盖以重定向到 SSH/容器/Gondolin）；无 MCP 客户端抽象。

## DSH
实现位置：`packages/core/tools`（`ctx.tools` 注册表、`defineTool`、`ValueSchemaSpec` schema DSL、`tools/*` 事件）+ `packages/core/scope`；工具包 fs/shell/web/MCP/LSP/subagent/skill/session/jobs/goal/todo/schedule/workflow/ralph/ask-user/cordis 运行时/code-runtime 等 62 条目。
核心机制一句话：统一流水线 `tool/call → tools/pre-execute(waterfall, allow|deny|ask) → ToolGuard(单调否决) → tools/execute → 工具体执行 → output.render 投影 ContentBlock → tools/post-execute(accept|block+feedback) → tools/result(冻结权威结果) → tool/result 会话事件`；defineTool 用类型化 schema 同时推导 TS 类型/编译 JSON Schema/校验参数与输出；`ToolExecutionMode = parallel|exclusive`（独占屏障）+ `maxParallelToolCalls` 滚动池；工具结果 canonical value 仅执行期存在（value 不入日志）。

## Codex
实现位置：`codex-rs/core/src/tools/{registry,router,parallel,orchestrator,sandboxing}.rs` + `codex-tools`（ToolSpec/ToolExecutor trait）+ `tools/handlers/*`。
核心机制一句话：工具集偏小（无独立文件工具，文件读写靠 exec_command/apply_patch + view_image/update_plan/tool_search/request_permissions/multi-agent 等）；`ToolRegistry` 用 IndexMap、`register_trusted`（内置，重名 panic）vs `register_external`（插件，exec_command/shell_command 保留名拒绝覆盖、重复记录 first_collision）；dispatch 全走统一管线 pre_tool_use hooks → handler → post_tool_use hooks → 生命周期通知 → `ResponseItemEnvelope`；`ToolOutput` trait 统一结果；MCP 每步从 `mcp.tools()` 快照注入、按 mention 启动服务器。

## OpenCode
实现位置：`packages/opencode/src/tool/`（tool.ts 定义层、registry.ts、truncate.ts 及 read/glob/grep/edit/write/apply_patch/shell/task/todo/webfetch/websearch/skill/question/lsp/plan/code-mode/invalid 等）+ `session/tools.ts`（`SessionTools.resolve` 包成 AI SDK tool() 并注入 ctx）。
核心机制一句话：`Tool.define(id, Effect<Def>)`、Def={id,description,parameters,execute(args,ctx)→ExecuteResult{title,metadata,output,attachments}}；参数 schema 解码失败→`InvalidArgumentsError`（让模型改写）；输出经 `Truncate.output` 截断（超限落盘返回 outputPath+truncated 标记）；找不到工具名转 `invalid` 工具并传回错误（AI SDK repairToolCall 兜底）；registry.tools() 按模型/agent 过滤（websearch 限支持 provider、gpt 系列用 apply_patch）；Permission.visibleTools/disabled 隐藏被 deny 工具。

## Hermes
实现位置：`tools/registry.py`（`ToolRegistry`，文件 import 即 `registry.register()`）+ `model_tools.py` + `toolsets.py`（TOOLSETS/resolve_toolset）+ `agent/tool_executor.py`（顺序/并发 dispatch、observe→commit→project 管道）。
核心机制一句话：核心工具**每轮全量随请求发送**（故工具面受"窄腰"纪律约束，能力尽量放 CLI+skill/插件/MCP）；统一注册表=声明 schema/handler/toolset/check_fn（check_fn 缓存化避免每轮重算可用性）；服务可门控工具、插件工具经注册发现；`tools/transports/hermes_tools_mcp_server.py` 把 Hermes 工具面以 MCP server 暴露。

## Decision
最终采用：**「schema 驱动注册表 + 统一可插拔执行流水线 + 最小内建集（8-10 个）+ MCP 一等扩展」**——以 DSH 的流水线（pre/guard/execute/post/finalize/result，guard 单调、exclusive 屏障、canonical value+纯 render 投影）为执行骨架（它同时覆盖权限/超时/展示/附着上下文/终结标记且全可插拔），以 Pi 的"8 个最小工具 + 定义/执行解耦 Operations 注入点（可重定向 SSH/容器）"为工具集哲学（Hermes 窄腰同立场），以 OpenCode 的"参数错误让模型自修复（invalid 工具兜底）+ 输出截断落盘"为健壮性件。工具 schema 用单一 schema DSL 推导类型与 JSON Schema（Pi TypeBox / DSH ValueSchemaSpec 二选一，v0.1 选 DSH 风格 ValueSchemaSpec，纯 TS 无运行时依赖）。

## Why
- 候选 A（Claude Code/Claw 型：40+ 大工具面 + 复杂 Bash 权限解析）：优点——开箱能力强、canonical name 统一规则；缺点——工具数量膨胀带来上下文与认知负担、Bash 字符串解析深但永远补不完（Claw 自承 bash.rs 仍是 `sh -lc` 简单执行）。
- 候选 B（Pi/Hermes 型：最小内建 8 工具 + 扩展机制/重定向执行）：优点——schema/上下文成本低、执行与 I/O 解耦天然支持远程沙箱（本项目 H08 需要容器后端）；缺点——默认能力少、需扩展补。
- 对比结论：最小集 + 扩展点符合任务书"功能不做多、机制做对"的取向与禁止事项 8（不为通用性提前加几十个 provider）；MCP 作为唯一动态扩展通道（Pi 无 MCP 客户端是短板，我们要补上，参照 DSH/Codex 的 MCP 客户端）。

## Rejected
没有采用：
- 不采用 Claw 的万行单体 tools crate：不可维护。
- 不采用 Codex 的"无独立文件工具、全走 exec_command/apply_patch"：与自研"文件工具化+文件边界守卫"理念相反（Claw/OpenCode 的文件工具 canonical 化防线是参考）。
- 不采用 Pi 的"无 MCP 客户端抽象"：MCP 生态（H05 相关行）是三方工具事实标准，v0.1 必须内建。
- 不采用"给 bash 写深权限解析器"（Claude Code wrapper/compound/redirect 解析）作为 v0.1 主防：以沙箱（H08）+命令 allowlist 为主、字符串解析仅作只读命令识别。
原因：内建工具每多一个都是每轮 token 成本与安全面；扩展通道（MCP/Operations 注入）保证能力可加而不进核心。

## Proposed Spec
```yaml
tools:
  builtin_min: [ read, write, edit(带 diff), glob, grep, bash/pwsh, skill, subagent, todo, ask_user_question, exit_plan_mode ]  # ~11 个
  schema: ValueSchemaSpec(string/number/integer/boolean/null/array/object/json/oneOf) -> 推导 TS 类型 + JSON Schema + 参数/输出校验
  registry: 作用域化（global -> agent scope 合并）；ToolRestriction allow/deny 过滤继承工具；register() 返回 disposer
  pipeline: tool/call -> pre-execute(waterfall: allow|deny|ask+reason) -> guard(单调, 只能收窄) -> execute -> output.render(纯投影) -> post-execute(accept|block+feedback) -> result(冻结, 入会话事件)
  concurrency: mode=parallel|exclusive；exclusive=排序屏障；max_parallel_tool_calls 滚动池(默认 10)
  error_contract: 参数错 INVALID_ARGS 回模型自修复；工具错 ToolFailure{message,info}；错误作为文本回灌可继续 vs 终结 两类
  output: 源头限流(默认 16KiB inline + 溢出 spill 落盘给预览+路径)；canonical value 仅执行期存在，日志只存 content/error/meta
  mcp: 客户端 stdio + streamable-http；远端工具动态注册进 ctx.tools；命名 mcp__<server>__<tool>；schema 按需(首次调用)加载
  file_guards: canonical 化拒绝 ../ 与 symlink 逃逸；读写上限 10MiB；NUL 二进制检测（借鉴 Claw）
  exec_delegate: shell 工具 Operations 注入点（可重定向 SSH/容器，供 H08 沙箱后端复用）
```

---

## H06 Hooks / Middleware / Events

## Claude Code
实现位置：`hooks.md` + settings.json（user/project/local/managed）+ 插件 `hooks/hooks.json`；事件 schema、handler 五类。
核心机制一句话：35+ 事件三节奏（每会话 SessionStart/SessionEnd；每轮 UserPromptSubmit/Stop/StopFailure；每 tool call PreToolUse/PermissionRequest/PostToolUse/PostToolUseFailure/PostToolBatch；子代理/压缩/模型切换/工作区事件），matcher（精确名单或 JS 正则）+ handler（command/http/mcp_tool/prompt/agent）；JSON 输入输出契约（PreToolUse→permissionDecision allow|deny|ask|defer+updatedInput；PostToolUse→additionalContext/updatedToolOutput）；exit code 语义（0 无决策、2 阻止给 stderr）；async hook + asyncRewake 后台唤醒模型。

## Claw Code
实现位置：`rust/crates/runtime/src/hooks.rs`（HookRunner/HookEvent/parse_hook_output）+ conversation.rs 调用点 + `lane_events.rs`（编排 LaneEvent）+ telemetry SessionTracer。
核心机制一句话：仅 PreToolUse/PostToolUse/PostToolUseFailure 三个工具生命周期事件（无会话级事件）；hook 以 shell 子进程执行、输出 JSON stdout 契约：`systemMessage`/`reason`/`continue:false`/`decision:"block"` 追加消息或拒绝、`hookSpecificOutput{additionalContext, permissionDecision:allow|deny|ask, permissionDecisionReason, updatedInput}` 权限覆盖/改写输入；PreToolUse 结果决定权限路径（cancelled/failed/denied 产出 denied tool_result）；非法 JSON 给结构化诊断并透传 raw stdout。

## Pi
实现位置：coding-agent 扩展事件 `core/extensions/types.ts`（ExtensionEvent 联合 + `ExtensionHandlers.on(...)` 全清单）+ `core/event-bus.ts`；harness 层 `harness/hooks.ts`（HookRegistry）+ `agent-harness.ts`（`HookMap`：before_run/before_tool/after_tool/transform_context/before_request/before_payload/after_response/before_compaction/before_navigation）。
核心机制一句话：事件面 30+（tool_call 输入**可变**可 block、message_end/tool_result 可改写结果、before_provider_headers 可改厂商请求头）；harness HookMap 与公开 Agent before/after 钩子两套并存；event 全量可订阅（HarnessEvent 全联合 + LaneSnapshot 快照 + reducer 供前端增量）；错误隔离进 handler_error 不拖垮 run。

## DSH
实现位置：vendor `@deepseek-ai/cordis`（`ctx.on/emit/waterfall/parallel/serial/bail`）+ 产品事件词汇（agent/*、tools/*、system-prompt/*、session/*、approval/*、skills/change、compaction/*）+ 外部钩子桥接 `packages/hooks/hook-protocol` + `hooks-claude-code`/`hooks-codex`。
核心机制一句话：五种分发模式（emit 观察/waterfall 包装「不调 next() 即短路」/parallel/serial/bail），waterfall 委托是铁律；三事件域（会话事件=持久进日志、agent 事件=活跃 agent 实时扩展点、能力事件）；类型安全 derived-union + declaration merging；`dsh-hook-protocol` 统一 Claude Code（字面量/正则）与 Codex（未锚定正则）两方言 matcher，退出码 2 阻塞、其余非零非阻塞记录、`deny > ask > allow` 合并、hook 失败绝不崩轮次。

## Codex
实现位置：`codex-rs/hooks` crate（registry/engine/command_runner/mcp_runner/output_parser/discovery）+ `core/src/hook_runtime.rs` + `hooks/config_rules.rs`。
核心机制一句话：12 事件（PreToolUse/PermissionRequest/PostToolUse/PreCompact/PostCompact/SessionStart/SessionEnd/UserPromptSubmit/SubagentStart/SubagentStop/Stop/Interrupt），9 个带 matcher；执行=Command hooks（子进程 JSON 协议）+ MCP hooks；同步/异步两种模式（异步结果在安全边界 drain：turn 前/采样后）；PreToolUse 可 Blocked（错误回灌模型）或 Continue+updated_input 改写工具入参；PostToolUse 可 block（拒绝的是结果不是执行）或改模型可见输出/注入 additional context；Stop 可 block+continuation_fragments 注入历史继续（stop_hook_active 防重入）。

## OpenCode
实现位置：`packages/plugin/src/index.ts`（Hooks 接口）+ `packages/opencode/src/plugin/index.ts`（Plugin.Service 触发 transform）+ EventV2（`packages/core/event.ts`）。
核心机制一句话：插件= `async (ctx, options) => Hooks`，钩子以 (input,output)=>output 变换链贯穿多插件（permission.ask 可改 ask/deny/allow、tool.execute.before/after、chat.message/params/headers、shell.env、experimental.chat.messages/system.transform、experimental.session.compacting、compaction.autocontinue、tool.definition 等）；事件总线 EventV2 带 location 路由/durable 标记、EventV2Bridge 桥到 GlobalBus 经 SSE/WS 推送，TUI/App 订阅。

## Hermes
实现位置：`hermes_cli/plugins.py`（PluginDispatchMixin）+ `plugins/plugin_loader.py` + `agent/api_request_hooks.py` + `agent/plugin_stream_hooks.py` + `agent/verify_hooks.py`。
核心机制一句话：核心枚举钩子 pre_tool_call（可 `{"action":"block","message"}` 否决或改 args）/post_tool_call/transform_terminal_output/transform_tool_result/transform_llm_output/pre_llm_call/post_llm_call/on_session_start/on_session_end/pre_verify 轮末闸；内存回调按声明签名注入 payload；**流式输出钩子**每消费者独立有界队列+守护线程（插件永不 inline 跑在 token 路径上、队列满丢最旧）；热路径 hook 有超时上限。

## Decision
最终采用：**「两域事件（持久会话事件 + 实时 agent 扩展事件）+ waterfall 中间件 + 外部 hooks.json 兼容桥」**——以 DSH 的 Cordis 分发语义（emit/waterfall/parallel/serial/bail、waterfall 不调 next() 即短路、guard 单调）为内核（保证"先放行后否决"不可能），以 Hermes/OpenCode 的"插件永不 inline 跑在热路径 + 变换链"为执行纪律，以 DSH `dsh-hook-protocol` + `hooks-claude-code`/`hooks-codex` 的思路提供 Claude Code/Codex hooks.json 兼容层（存量钩子可迁移）。事件清单以 Claude Code 35+ 事件面为**覆盖度参考**，但 v0.1 只实现与自研 loop 决策点一一对应的事件（见 Proposed Spec），杜绝为覆盖而覆盖。

## Why
- 候选 A（Claude Code 35+ 事件 + 五形态 handler + async rewake）：优点——事件面覆盖循环每个决策点；缺点——PreToolUse 与 permission 职责重叠、prompt/agent 型 hook 是非确定性模型决策、事件太多心智负担重。
- 候选 B（DSH 五分发 + 持久会话事件 + 外部兼容桥）：优点——会话事件进日志使 hook 可审计可回放、waterfall 语义明确短路即决策、兼容层省迁移成本；缺点——事件种类多学习成本高、hook/* 仅日志无 surface 语义（外部钩子不能产生运行级效果是明示限制）。
- 对比结论：自研 harness 的事件系统应分两类——**持久型**（作为会话事实进日志，供回放/evaluator/审计）与**扩展型**（waterfall 决策点，供策略/插件/安全层注入）。这正好对应 B 的三事件域思想，且与 H01 事件溯源一致；A 的 async+rewake 值得借鉴为长 hook 不阻塞主循环。

## Rejected
没有采用：
- 不采用 Claw 只 3 个工具事件（缺会话/轮级事件）：覆盖面不足，无法表达 SessionStart/Stop/压缩前等决策点。
- 不采用 Pi/OpenCode 的"两套平行 hook API（公开 Agent before/after 与 harness HookMap；插件 Hooks 与内置触发点）"迁移期并存：v0.1 只保留一套内核事件面 + 薄适配。
- 不采用 prompt/agent 型 hook（Claude Code：调 LLM 或子代理做决策）作为 v0.1 主力：非确定性、成本不可控，保留为 evaluator 层的扩展而非 hook 语义。
原因：事件面必须与 loop 决策点一一对应且全部可观测（禁止事项 10：不只做功能列表、要深入调用链）；两套 API 并存违反单一权威循环原则。

## Proposed Spec
```yaml
events:
  persistent_session_events: [ user/message, assistant/message, assistant/attempt, tool/call, tool/result, step/start, step/end, turn/start, turn/end{kind}, compaction/start|summary|end, approval/asked|decided, session/created|end-seed, llm/retry ]  # 均进日志
  realtime_agent_events: [ agent/pre-step(reject|enter), agent/request, agent/assistant-stream, agent/request-error, agent/turn-stopping(serial), agent/session-start{startup|resume|clear|compact}, subagent/start|end, tools/pre-execute, tools/execute, tools/post-execute, skills/change ]
  dispatch: emit(观察) / waterfall(不调 next() 短路=决策) / serial / parallel；guard 单调只能收窄
  handler_forms_v01: [ command(shell JSON stdin/stdout), mcp_tool ]   # http 后续版本
  exit_code_semantics: 0=无决策；2=阻塞(stderr 为原因给模型)；其余非零=记录非阻塞；stdout 非 JSON 进 debug log
  async_hooks: async+rewake（完成后唤醒模型继续），热路径 hook 超时上限（借鉴 Hermes）
  compat_bridge: hooks.json 读取（claude-code 方言 matcher 字面量/正则 | codex 方言），deny>ask>allow 合并，hook 失败绝不崩轮次
  effect_ordering: 同一事件多 handler 并行跑、权限决策取最严格（任一 deny 即 deny）——与 permission 系统关系见 H07
  scope_safety: allow_managed_only 开关；subagent 内事件带 agent_id 可路由
```

---

## H07 Permission / Safety

## Claude Code
实现位置：`permissions.md`、`permission-modes.md`、`security.md`、`sandboxing.md`、managed settings/MDM（examples/mdm）。
核心机制一句话：四层叠加——Permission modes（default/acceptEdits/plan/auto/dontAsk/bypassPermissions）→ Permission rules（allow/ask/deny 数组，**deny→ask→allow 先匹配生效**、裸工具名 deny 移出上下文、scoped 规则 `Bash(rm *)`）→ hooks（PreToolUse 可 deny/ask/defer 不 bypass 规则）→ sandbox+外层隔离；危险操作任何模式（含 bypass）都不自批（rm -rf /、需人交互工具、显式 ask 项）；auto mode classifier（独立小模型、看不到 tool results 防注入操纵）审查动作；Behavior Safety 管"模型试图做什么"、Runtime Safety 管"命令能碰到什么"（官方明示 deny 规则拦不住任意子进程，要 OS 级强制开 sandbox）。

## Claw Code
实现位置：`runtime/src/permissions.rs`（PermissionPolicy/Mode/Rule/Override/Prompter）+ `permission_enforcer.rs`（check/check_bash/check_file_write）+ `bash_validation.rs` + CLI `CliPermissionPrompter`。
核心机制一句话：模式 ReadOnly/WorkspaceWrite/DangerFullAccess/prompt + 每工具 spec 的 `required_permission`（未注册默认 Danger）+ 规则 allow/deny/ask（`Tool(描述)` 匹配）+ `denied_tools` 无条件拒绝先于一切；决策序：denied_tools → deny 规则 → hook override → ask 规则 → allow 规则 → 模式比较；越权/ask 调 `PermissionPrompter`（CLI y/N，无 prompter 即 deny）；`check_bash` 只读命令启发式（git 子命令门控、重定向/就地改写标志/命令链拦截）。

## Pi
实现位置：`core/project-trust.ts` + `trust-manager.ts`（ProjectTrustStore：`~/.pi/agent/trust.json` 按 canonical 目录 true/false/null、最近祖先决策生效）+ `cli/project-trust.ts` + `resource-loader.ts`。
核心机制一句话：**无工具级权限/审批系统**（README/security.md 明示 "Pi does not include a built-in permission system… runs with the permissions of the user"）；唯一门=Project Trust：仅当项目有需信任资源（`.pi/settings.json`/extensions/skills/prompts/SYSTEM.md/祖先 .agents/skills）且无已存决策时按 `defaultProjectTrust`（默认 ask）询问；信任=允许加载项目本地扩展/技能/提示等，拒绝=跳过；AGENTS.md/CLAUDE.md 不受信任门限制；非交互模式 `"ask"/"never"` 忽略受保护资源、`"always"` 信任。

## DSH
实现位置：`packages/interaction/user-approval`（`ctx.approval`、`approval/request` waterfall、`approval/asked|decided` 审计对、`ApprovalPolicy = ask|never`）+ `permission-presets`（sandbox×approval 捆绑）+ `packages/fs/fs-sandbox` + `credentials`。
核心机制一句话：工具调用权限链 `tools/pre-execute(waterfall) → ToolGuard(单调否决) → (ask 时) ctx.approval.request()(waterfall→应答者: UI 人类/ACP 机器) → 仅 'allowed-once' 放行, rejected/cancelled/unavailable 一律拒绝(fail closed)`；`never` 策略确定性拒绝且在 waterfall 分发之前服务内强制（prepend 应答者也绕不过）；Behavior Safety=提示词段落（plan 引导/persona/指令预算）+ 原则"引导而非强制"；Runtime Safety=SandboxMode read-only|workspace-write|danger-full-access + 沙箱化 shell 执行器 + fs-sandbox 围栏（重复注册 fs 提供方即拒绝）；approval 审计事件对构成完整证据链。

## Codex
实现位置：`core/src/exec_policy.rs` + `codex-rs/execpolicy` crate（规则引擎 policy/rule/decision/parser）+ `tools/orchestrator.rs`（approval→sandbox→retry）+ `core/src/config/permissions.rs` + `permission_profile_catalog.rs` + `guardian/*` + `safety.rs`。
核心机制一句话：审批策略 AskForApproval=Always/OnRequest/Never/Granular；`ToolOrchestrator.run` 序列=算 ExecApprovalRequirement（Skip/NeedsApproval/Forbidden）→按策略审批（Guardian 模型审查或用户 UI）→选沙箱执行首 attempt→沙箱拒绝且允许升级时二次审批（带 retry_reason）以更宽松沙箱重试；审批缓存 ApprovedForSession（按 key 序列化）免重复问；规则引擎 execpolicy `.rules`（allow/prompt/forbidden、命令前缀+网络规则）→危险命令前缀黑名单（is_dangerous_command）→沙箱兜底；用户批准后可追加 allow 前缀规则（proposed_execpolicy_amendment）；PermissionProfile（filesystem+network+approvals+exec policy）内置 read_only/workspace_write/danger_full_access。

## OpenCode
实现位置：`packages/opencode/src/permission/`（index.ts/evaluate.ts/arity.ts）+ ruleset 定义 `@opencode-ai/core/v1/permission` + `agent/subagent-permissions.ts` + `question/`。
核心机制一句话：`Rule = {permission, pattern, action: allow|ask|deny}`、`evaluate` 对 permission+pattern 双通配取 `findLast`（后写覆盖先写）、多 ruleset flat 拼接顺序即优先级；ask 流程=全 allow 通过/任一 deny→DeniedError/否则生成 Request 发布 Event.Asked 阻塞等 UI reply；reply=once 放行一次 / always 写入会话 approved 列表并顺带放行同会话其余匹配；默认 .env ask、external_directory ask（白名单目录 allow）、doom_loop ask、question/plan 工具默认 deny 内建；`arity.ts` 约束部分命令参数组合用于权限校验精度。

## Hermes
实现位置：`tools/approval.py` 全家（approval_detection 危险模式/approval_floors 预检闸+allowlist/approval_prompt/approval_gateway_wait/approval_smart **guardian LLM**/approval_human_wait）+ `tools/write_approval.py` + `tools/threat_patterns.py` + `agent/redact.py` + `agent/estop.py`。
核心机制一句话：三守卫入口 check_all_command_guards/check_execute_code_guard/request_tool_approval（会话级审批、yolo、网关队列、denial breaker）；多级降级=自动放行→模式 allowlist→guardian LLM→人工（CLI/gateway/Desktop 可异步审批）；写入独立 write_approval+文件安全检查（_scan_for_threats 应用到系统提示注入内容）；拒绝计数熔断（denial breaker）防死循环追问。

## Decision
最终采用：**「模式(最小权限三档) × 规则(allow/ask/deny, deny 优先) × hook override × 运行时执法(沙箱)」四层 + 审批证据链 + fail-closed」**——以 Claude Code 的四层叠加与"deny→ask→allow 先匹配、deny 不可被更细 allow 豁免、危险集合任何模式不自批"为规则语义，以 DSH 的 fail-closed（无应答者=unavailable=拒绝；never 在服务内强制）+ 审计事件对（approval/asked→decided）+ guard 单调为执行保证，以 Codex 的"审批缓存按 key + 沙箱失败升级二次审批（带 retry_reason）+ 批准后可追加前缀规则"为 UX，以 Codex/Pi 的三档权限 profile（read-only/workspace-write/danger-full-access）为对外单一选择器（Claw 同三档）。行为安全（prompt/引导）与运行时安全（沙箱/审批）显式分离并文档化各自失效面（任务书禁止事项 5：安全规则不只写 Prompt）。

## Why
- 候选 A（Claude Code/Codex 型：细粒度规则语言+模式+guardian/classifier 模型审查）：优点——纵深防御、免打扰自动审批面大；缺点——配置爆炸、classifier/guardian 是黑盒不可本地审计。
- 候选 B（DSH 型：fail-closed + never 服务内强制 + 审计对 + 单调 guard，无内置命令黑名单）：优点——证据链完整、决策序无翻转可能、安全默认写进组合层；缺点——`ask` 无应答者即拒导致无人值守场景体验硬（需应答者链）。
- 候选 C（Pi 型：仅项目信任无工具审批）：诚实但零工具约束，不符合本项目对可组合安全的需求。
- 对比结论：取 A 的规则面与 B 的强制语义；Pi 的项目信任思想作为"项目级资源装载门"（H09/workspace trust）而非安全主体吸收。Guardian/classifier 型模型审查放 evaluator/验证层（H12），不进 v0.1 权限主链。

## Rejected
没有采用：
- 不采用 Pi 的"无权限系统、等同用户权限"：对自研 harness 的自动化/子代理场景不可接受。
- 不采用 Claw 的"只读命令启发式字符串规则"作为主防（可被绕或误伤）：只用于开发期便捷 allow，真防靠沙箱。
- 不采用 bypassPermissions/YOLO 类全放行模式作为一等模式：仅允许 danger-full-access 且文档警告仅限容器/VM（Claude Code 双刃剑立场）。
- 不采用黑名单驱动的危险命令清单（Codex is_dangerous_command / Hermes 危险模式）作为唯一防线：黑名单维护成本高且易漏（Claude Code 亦主张 deny 规则+沙箱）；v0.1 以 allowlist+deny 规则+沙箱兜底。
原因：安全必须是"默认拒绝、可审计、fail-closed"的组合，而非"默认放行 + 黑名单补漏"。

## Proposed Spec
```yaml
permission:
  profiles: [ read-only, workspace-write, danger-full-access ]   # 单一对外选择器；workspace-write 默认 + ask
  rules: { allow: [], ask: [], deny: [] }  # 匹配序 deny -> ask -> allow；先匹配生效；deny 不可被更细 allow 豁免；裸工具名 deny=工具整体移出上下文
  scoped_rules: Bash(rm *), Read(.env), Write(path=./x), WebFetch(domain:*), Agent(type)  # v0.1 支持工具名+命令前缀+路径 glob
  decision_order: denied_tools -> deny rules -> hook override(pre-execute) -> ask rules -> allow rules -> profile 比较
  ask_flow: ctx.approval.request() waterfall -> 应答者链(UI 人类 | 机器策略)；应答者缺席=unavailable=deny(fail closed)
  never_policy: 确定性拒绝且 pre-execute 分发前服务内强制（绕不过）
  audit: approval/asked + approval/decided 事件对入日志；谁问/谁答/理由 全可追溯
  cache: 会话级 allow 缓存按 permission+pattern key（Codex ApprovedForSession 语义），拒绝不缓存
  escalate: 沙箱拒绝且工具允许升级 -> 带 retry_reason 的二次审批 -> 更宽松 profile 重试（Codex escalate_on_failure）
  never_auto: [ 关键路径删除(rm -rf /, ~), 需人交互工具, 显式 ask 项 ] 任何 profile 不自动放行
  behavior_vs_runtime: 行为安全=prompt 段落+引导（明示非强制）；运行时安全=本表+沙箱(H08)；两者共享 permission-presets 单一意图
  workspace_trust: 首次进入项目加载项目级 settings/skills/agents 前询问（借鉴 Pi/Claude）；AGENTS.md 上下文文件不受信任门限制
```

---

## H08 Sandbox

## Claude Code
实现位置：`sandboxing.md`/`sandbox-environments.md`；设置 `sandbox.*`；平台 macOS **Seatbelt**（内置）/Linux/WSL2 **bubblewrap+socat**（+可选 seccomp）/原生 Windows 不支持（须 WSL2）。
核心机制一句话：默认写边界=cwd 及子目录+add-dir+会话临时目录；默认读边界=**全盘可读**（含 ~/.aws/credentials，需主动 denyRead/credentials 加固）；Protected paths（.claude 配置/凭据/.git hooks 等）写保护不可豁免（allowWrite 也不行）；网络=代理进程跑在沙箱外、默认无预允许域名（首次批准，auto 交 classifier）；credential 模式 deny/mask（sentinel 占位+代理出站注入、支持 extract 正则/JWT decode/AWS SigV4 重签名）；escape hatch=沙箱失败→常规权限流→显式批准。

## Claw Code
实现位置：`runtime/src/sandbox.rs`（SandboxConfig/Request/Status、FilesystemIsolationMode off|workspace-only|allow-list、`build_linux_sandbox_command`）+ `runtime/src/bash.rs`（sandbox_status_for_input、`.sandbox-home`/`.sandbox-tmp`）。
核心机制一句话：每次 bash 调用解析 sandbox 状态——merge config+工具入参（dangerouslyDisableSandbox/isolateNetwork/filesystemMode/allowedMounts）→ 容器检测（/.dockerenv 等）→ Linux 探测 unshare（探测能力而非二进制存在）→ 组装 unshare 启动命令；不支持/非 Linux 回退 `sh -lc` + HOME/TMPDIR 环境重定向到工作区子目录（**非真实文件隔离**）；SandboxStatus（enabled/supported/active/…/fallback_reason）回填到 BashCommandOutput。

## Pi
实现位置：**无内建沙箱**（docs/security.md "No Built-in Sandbox" 一节）；coding-agent `core/tools/bash.ts`/`core/exec.ts` 本机 spawn。
核心机制一句话：所有执行=本机子进程（模型输出可直接 rm -rf / 读 .env 联网）；官方 4 套外部隔离模式——Gondolin extension（工具路由进 QEMU 微 VM，cwd 写穿宿主，provider auth 留宿主）/ Plain Docker（整进程进容器 bind-mount）/ OpenShell（NVIDIA 策略沙箱）/ Docker Sandboxes sbx（密钥留宿主、sbx 代理出口注入）；架构钩子=pi-agent-core `ExecutionEnv`（FileSystem+Shell 能力接口）+ 工具 *Operations 注入点是重定向执行的官方扩展机制。

## DSH
实现位置：seam `packages/sandbox/sandbox`（`ctx.sandbox.confine(argv, policy)`）；提供方 `sandbox-local`（Linux bwrap→Landlock 原生插件、macOS Seatbelt、Windows ACL 受限令牌 runner `sandbox-windows-acl`）；消费方 `bash-sandbox`/`pwsh-sandbox`。
核心机制一句话：模式 read-only/workspace-write/danger-full-access（full 不经过 ctx.sandbox 直接 spawn 原始 argv，网络与进程可见性不在词汇内）；**逐调用解析策略**（workspaceRoot 从会话不可变 cwd 派生、先文件系统语义规范化再词法，防 symlink/.. 逃逸）；fail-closed（无后端 SANDBOX_UNAVAILABLE，静默无隔离透传非法）；enforcement full/partial 由后端报告（旧 Landlock/Windows Everyone=partial，绝对边界消费方必须拒绝或暴露差异）；失败分类=runnerFailureRules（runner 自身失败）vs denialSignatures（命令被拒），先判 runner 再判拒绝；Windows=每工作区确定性写 SID+常驻 ACE、随机私有临时目录+可撤销 ACE、崩溃残留不阻止也不授权恢复。

## Codex
实现位置：`codex-rs/sandboxing` crate + `linux-sandbox`（bubblewrap+seccomp）+ `windows-sandbox-rs`（受限令牌+WFP 网络过滤+ACL deny-read+私有桌面+服务端提升）+ `network-proxy`（ManagedNetworkProxy）+ `exec-server`。
核心机制一句话：SandboxType=None/MacosSeatbelt/WindowsRestrictedToken/Linux(bubblewrap 主路径, legacy Landlock 显式回退)；Linux=`--ro-bind / /` 默认只读文件系统、可写根 `--bind` 覆盖、可写根下受保护子路径（.git/gitdir/.codex）再 `--ro-bind` 强制只读、split-policy 按路径特异性排序（窄子路径可重开父级只读/拒绝、拒绝优先）、PR_SET_NO_NEW_PRIVS+seccomp 网络过滤；Windows 受限令牌+Job+WFP+ACL deny_read_resolver+no_reparse_dir 防逃逸+私有桌面；网络=managed network proxy（MITM CA 只读注入）+ 网络策略决策；violation 记录→denial 判定（is_likely_sandbox_denied）驱动升级重试。

## OpenCode
实现位置：无独立沙箱子系统；安全边界=`permission 系统 + 进程派生点`（`tool/shell.ts` 用 ChildProcessSpawner 直接本机执行 + `ShellID` 权限维度）。
核心机制一句话：shell 直接派生本机（bash/pwsh/cmd）、bash 默认超时 2 分钟、输出截断；read/glob/grep 受 external_directory 规则约束（工作区外 ask、白名单目录默认 allow）；**无容器/bwrap/sandbox-exec/seccomp**；workspace 概念（experimentalWorkspaces/Worktree）只做 git worktree"工作副本"隔离非执行隔离；代码模式/LSP 跑宿主进程。

## Hermes
实现位置：`tools/code_execution_tool.py`（PTC：LLM 写 Python 脚本经 RPC 调 Hermes 工具）+ `tools/code_kernel.py`（每会话持久 kernel）+ `code_execution_env.py`（env 清洗）+ `tools/environments/`（docker/modal/daytona/singularity/ssh 远程后端）+ `docs/security/network-egress-isolation.md`。
核心机制一句话：execute_code="程序化工具调用"——脚本内只允许调用已授权 Hermes 工具、stdout 回流；本机后端 per-conversation session kernel（Unix socket/loopback TCP）；**无默认 OS 级 jail**（本地=审批+env scrubbing+工具白名单，终端/文件工具信任度等同开发者自身）；远程后端（容器/云/SSH）提供真隔离。

## Decision
最终采用：**「confine 抽象（逐调用策略、fail-closed、enforcement 透明）+ 平台后端 runner 链 + 容器/远程作为同级 seam」**——以 DSH 的 `ctx.sandbox.confine(argv, policy)` seam 与平台 runner 链（Linux bwrap→Landlock、macOS Seatbelt、Windows ACL 受限令牌）+ fail-closed（SANDBOX_UNAVAILABLE）+ full/partial 上报为骨架（它是唯一同时给出 Windows 方案与完整性透明上报的一家），以 Codex 的"只读根 + 可写覆盖 + 受保护子路径强制只读 + 路径特异性排序 + violation→denial 判定驱动升级"为 Linux 文件边界实现参照，以 Claw 的"能力探测而非存在性假设 + 容器检测 + fallback 状态回填"为健壮性件，以 Pi/Hermes 的"ExecutionEnv/Operations 注入点 → 远程容器/microVM 同级提供方"为容器 seam。网络边界与凭据（mask+代理注入）参照 Claude Code/Codex 网络代理 + DSH 凭据边界，作为独立于文件沙箱的策略层。

## Why
- 候选 A（Claude Code/Codex 型：深度 OS 级沙箱，Seatbelt/bwrap/受限令牌+WFP+ACL，凭据 mask 注入）：优点——真强隔离、防任意子进程；缺点——实现与维护成本极高（Codex Windows 侧 token/ACL/WFP/服务四套叠加），原生 Windows 支持难（Claude Code 干脆不支持）。
- 候选 B（DSH 型：confine seam + 三平台 runner + fail-closed + full/partial 透明上报 + 容器作为同级能力 seam）：优点——平台解耦、明确不夸大隔离强度、Windows 有真实方案（ACL 受限令牌）；缺点——部分平台强制仅 partial（开发者预览、Landlock/Windows 边界）。
- 对比结论：A 的 Windows 缺口与维护面超出 v0.1 范围；B 的"enforcement 不夸大 + 消费方按需拒绝"正好匹配本项目"安全可审计"取向。执行隔离必须以 OS 级边界为最终防线（Behavior Safety 管不住任意子进程是各家共识），confine 抽象保证未来换更强后端（容器/微 VM）不动消费方。
- OpenCode/Pi（纯权限/纯信任、无 OS 沙箱）被明确排除为安全主体：对自研自动化 harness 不够。

## Rejected
没有采用：
- 不采用 Claw 的回退模式（HOME/TMPDIR 环境重定向）当作隔离：明确标注 fallback_reason、不宣称隔离（可作为无沙箱平台的降级+警告，但默认 fail-closed 拒绝危险调用）。
- 不采用 OpenCode"权限即沙箱"、Pi"无内建沙箱"立场作为 v0.1 默认。
- 不采用 Codex 的 Windows 全栈（WFP 网络过滤/私有桌面/服务端提升）进 v0.1：复杂度超限，留 roadmap；v0.1 Windows=ACL 受限令牌+只读工具降级。
- 不采用 Claude Code 默认读全盘：v0.1 默认读边界=workspace + 显式 allow 目录（比 Claude 更保守，防凭据默认暴露）。
原因：隔离是"能力"边界（拦得住任意子进程），与"行为"边界（H07）必须分开；v0.1 先保证 Linux/macOS 真实隔离 + Windows partial 透明，容器 seam 留给后续。

## Proposed Spec
```yaml
sandbox:
  seam: ctx.sandbox.confine(argv, policy) -> ConfinedArgv | SANDBOX_UNAVAILABLE(fail-closed)
  modes: [ read-only, workspace-write, danger-full-access(不经 confine, 仅显式) ]
  backends_v01: [ Linux bwrap(只读根+可写覆盖+受保护子路径强制只读, 路径特异性排序, seccomp 网络可选), macOS seatbelt, Windows ACL 受限令牌(报告 partial) ]
  detect: 能力探测(非二进制存在) + 容器环境标记(/.dockerenv 等, 防嵌套误判)（借鉴 Claw）
  per_call_policy: workspaceRoot 派生自会话不可变 cwd，先 fs 语义规范化再词法（防 symlink/.. 逃逸）；sandbox/mode 会话事件持久记录覆盖
  status: SandboxStatus{enabled/supported/active/namespace/filesystem/network/fallback_reason} 回填工具输出；enforcement full|partial 上报
  failure_class: runnerFailureRules(基础设施失败) vs denialSignatures(EROFS/EACCES/EPERM 命令被拒) 严格区分，先判 runner 再判拒绝
  reads: 默认读=workspace+显式 allow 目录（比 Claude 保守）；凭据文件 denyRead 默认
  network: 独立策略层（允许域名 allowlist/代理，不并入文件 sandbox 词汇）；凭据 mask+出站注入 = v0.2
  container_seam: ExecutionEnv/Operations 注入点 -> docker/ssh/microVM 提供方与本地后端同级可插拔（Pi/Hermes 模式）
  fallback_rule: 无后端平台 -> danger 调用拒绝；只读安全命令可降级（HOME/TMPDIR 重定向 + fallback_reason 标注）
```

---

## H09 Session / Memory

## Claude Code
实现位置：`sessions.md`/`memory.md`/`checkpointing.md`；转录 `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`。
核心机制一句话：四类记忆——Conversation（JSONL 转录、30 天 retention sweep）/ Session（session ID 绑项目目录，`--continue`/`--resume`/`/resume`，恢复=完整历史+模型+agent+权限模式+活动 goal）/ Project（CLAUDE.md 层次+.claude 配置+auto memory 按 git 仓库作用域）/ Long-term（auto memory：MEMORY.md 索引+topic 文件、200 行/25KB 注入、/memory 查看编辑；subagent memory user/project/local 三级）；resume 追加同 ID、fork 复制到新 ID（permission grants 不继承）、/clear 另起、checkpoint 每次用户 prompt 建（只跟踪文件编辑工具，保留最近 100）。

## Claw Code
实现位置：`runtime/src/session.rs`（Session/ConversationMessage/SessionCompaction/SessionFork/heartbeat）+ `session_control.rs`（SessionStore、managed sessions 目录、--resume/fork/删除、workspace fingerprint）。
核心机制一句话：磁盘 `<cwd>/.claw/sessions/<workspace_hash>/`，每条消息追加持久化（JSONL snapshot+JSON 双格式读写）；`SessionStore::from_cwd`/`resolve_reference(latest|id)`/`list_sessions`/`fork_managed_session` 供 CLI `--resume`、`/session`、`/fork`；fork 记录 parent_session_id；记忆=ProjectContext 装载 CLAUDE.md/CLAW.md/AGENTS.md 进 system prompt（无独立记忆库、RAG 服务除外）；持久化在 Session/SessionStore，ConversationRuntime 本身不拥有落盘生命周期（外部在轮次边界保存）。

## Pi
实现位置：coding-agent `core/session-manager.ts`（SessionEntry 树）+ `modes/interactive` 的 /tree//fork//clone//session；harness 层 `harness/session/{session,memory,commit,fork,values}.ts` + `packages/session-backends/sqlite-node`（可插拔 Storage 接口：in-memory/JSONL/SQLite）。
核心机制一句话：会话=分支树（每条 Entry 有 id/parentId，活动位置=当前 tip；换分支=换 tip 重建上下文不复制文件）；JSONL v3（~/.pi/agent/sessions/--<cwd>--/<ts>_<uuid>.jsonl）或 SQLite 后端；Entry 类型含 user/assistant/tool/bashExecution/custom/model_change/compaction/branch_summary/usage 等；跨会话无隐式记忆（无向量记忆）；harness 层把 commit 序列化/事务/usage ledger/fork 快照做成可插拔存储接口（带 conformance 测试）。

## DSH
实现位置：`packages/core/session`（Session 仅追加事件日志、surface、`deriveMessages()`、request/header 折叠、fork API）+ `packages/session/session-persistence-jsonl`（JSONL v2，`session.v2.jsonl[.zstd]` 每事件一行）+ `session-projection`/`session-query(-sqlite)`/`session-title`/`session-reference`。
核心机制一句话：会话日志=唯一真源（UI/轨迹/遥测/回放全由事件派生）；SessionHeader（format version/cwd/parentSession/isSeeded/delegationDepth/agentPreset/origin:'subagent'）存日志旁；resume=`ctx.agents.resume` → 持久层 `open(id,'write')`（单写者所有权，并发第二次拒绝）→ 读日志→追加 `interruptedTurnClosers`（合成 turn/end interrupted）；fork=取 boundary（含）已完成轮次前缀→深克隆 seed+parentSession+isSeeded+精确 inheritedEventCount；append best-effort（write-behind）、flush()=持久性屏障；崩溃保留被中断轮次只丢撕裂尾部；格式迁移只发布新 generation 绝不改写已提交；**无内置长期记忆**（官方第三方记忆 MCP overlay 示例）。

## Codex
实现位置：`codex-rs/thread-store`（ThreadStore trait：create/read/…/fork/revert/resume + local.rs rollout JSONL+sqlite 元数据）+ `core/src/session/session.rs`（session_id==root thread ID）+ `state` crate（state_db SQLite：graph/log/thread_metadata/memories）+ `codex-rs/memories`。
核心机制一句话：Conversation=rollout JSONL（~/.codex/sessions/threads/...，SessionMeta+ResponseItem+TurnContext+WorldState 行）+ sqlite 元数据；Session 非独立实体（session_id=根线程 ID，子代理是新 thread 共享 AgentControl）；Project=StoredProject+section+queue store；Long-term Memory=双阶段后台管道（Phase1 认领最近可归档 rollout→并行模型抽取 raw_memory+rollout_summary；Phase2 consolidation 合并巩固）写入持久存储，Read 路径=memory developer-instruction 注入+引用解析+使用遥测；污染防护：外部上下文触发 mark_thread_memory_mode_polluted。

## OpenCode
实现位置：`packages/opencode/src/session/session.ts`（Session 服务 SQLite 存储）+ `packages/core/session`（表与 SQL）+ `background/job.ts` + `snapshot/` + `git` + `session/revert.ts`。
核心机制一句话：Session={id(ULID)/slug/projectID/directory/parentID/title/agent/model/summary(additions/deletions/files/diffs)/cost/tokens/permission…}，消息持久化 MessageTable/PartTable（SQLite+drizzle）；create/fork（message 级，标题 fork #N）/children/list/setTitle/setArchived/setRevert/setShare/updateMessage（增量 text）/removeMessage/removePart/diff（VCS/snapshot diff）；每 step-finish 的 snapshot patch（基于 git 工作树 vs committed 文件级 diff）供 UI/revert；记忆三态=DB 历史（可翻页）+snapshot patch+compaction summary；跨会话知识靠 config/instructions 外部文件。

## Hermes
实现位置：`agent/session_persistence.py` + `hermes_state*.py`（SQLite state db、WAL、FTS `hermes_state_search.py`）+ 记忆 `tools/memory_tool.py`/`memory_tool_store.py`（MemoryStore）+ `agent/memory_manager.py`/`memory_provider.py`（MemoryProvider ABC）+ `turn_facade_lease.py`。
核心机制一句话：记忆=磁盘文件 `MEMORY.md`（agent 笔记）+`USER.md`（用户画像），会话开始以**冻结快照**进系统提示、中途写盘但**绝不改写当前提示**（保 prefix cache、下一会话生效）；单一 `memory` 工具 add/replace/remove/批量（文件锁+备份防漂移）；MemoryManager 把记忆 hooks 扇出给 provider（system_prompt_block/prefetch/sync_turn/on_pre_compress/on_delegation 等，**同时仅 1 个外部 provider**）；会话文本落 SQLite（FTS 检索/恢复/导出）；跨进程 durable turn lease 防双写。

## Decision
最终采用：**「事件日志（append-only）为会话真源 + 目录绑定的可恢复/可 fork 会话 + 文件式长期记忆（MEMORY.md 索引+topic 文件，冻结快照注入）」**——以 DSH 的 event-sourced Session（resume=重放+合成 interrupted 关闭器、fork=seed 前缀+isSeeded、单写者租约、格式迁移不可变发布）为会话内核（与 H01/H03 单一真源一致），以 Hermes 的"MEMORY.md/USER.md 磁盘文件 + 会话开始冻结进提示、中途写盘不改进程内提示（保缓存）+ 文件锁备份防漂移 + 单一 memory 工具"为长期记忆形态（简单、可 git、可审计），以 Claude Code 的"auto memory=索引+主题文件按需读、subagent memory user/project/local 三级作用域"为记忆作用域扩展。会话文本用 JSONL（并发写锁可接受，SQLite 后端留接口，参照 DSH JSONL v2 / Pi 可插拔 Storage）。

## Why
- 候选 A（Claude Code/Pi/OpenCode 型：转录/Entry 树/消息表 + 外部记忆文件）：优点——resume/fork/审计成熟；缺点——转录格式内部化不稳定、fork 继承语义各家不一、checkpoint 覆盖面有限（Bash 改动漏网）。
- 候选 B（DSH 型：事件日志单一真源 + fork=seed 谱系 + 单写者 + 崩溃修复合成）：优点——resume/fork/回放/遥测/UI 同构、崩溃不丢长轮次、跨进程写租约消除并发损坏；缺点——层数多、无内置长期记忆。
- 候选 C（Hermes 型：MEMORY.md/USER.md 冻结快照 + provider 抽象）：优点——记忆即文件可读可迁移、缓存纪律与压缩摘要重申权威；缺点——人工提示记忆非自动学习、仅 1 个外部 provider。
- 对比结论：B 的会话层 + C 的记忆层互为补充——会话是"发生过什么"（日志），记忆是"跨会话保留什么"（文件索引+按需读）；两者分离正好对应任务书 H09 的两种诉求。Codex 的双阶段自动记忆管道（模型抽取+consolidation）信息量大但依赖后端状态库且污染风险高，作为 v0.2 方向不做进 v0.1。

## Rejected
没有采用：
- 不采用 Codex 的 rollout（SessionMeta+ResponseItem+TurnContext 多行类型）+ 双阶段自动记忆管道进 v0.1：实现重、依赖后端、污染标记机制尚需成熟；留 roadmap。
- 不采用 Claw 的"ConversationRuntime 不拥有落盘生命周期（需外部轮次边界保存）"：落盘责任必须收进内核（append+flush 屏障）。
- 不采用 Pi 的"记忆=历史+压缩摘要"（无独立长期记忆层）：与 Hermes 文件记忆相比缺可检索/可写入口；Hermes 方案更接近"Agent 自己维护笔记"。
- 不采用 checkpoint/rewind 文件快照（Claude Code 只跟踪编辑工具、Bash 改动漏网）作为唯一回滚：与 git 互补、Bash 改动以 git 为准（见 H12 Proposed Spec 的 git discipline）。
原因：会话层要可重建（事件）、记忆层要可维护（文件）；把"跨会话学习"自动化（Codex/Hermes background_review）放后期验证。

## Proposed Spec
```yaml
session:
  source_of_truth: append-only 事件日志（JSONL v1, 每事件一行；SQLite 后端 = v0.2 可插拔 Storage 接口）
  header: { format_version, cwd, workspace_slug, parent_session, is_seeded, delegation_depth, agent_preset, created_at }  # 存日志旁不入事件
  layout: $SESSION_HOME/sessions/<workspace-slug>/<session-uuid>/
  resume: 重放日志 -> 追加合成 interrupted 关闭器(缺失工具错误/未闭合 step/turn/end interrupted) -> 单写者 open(id,'write')（并发第二写拒绝）
  fork: 取 boundary(含)前已完成轮次前缀 -> 深克隆 seed + parent_session + is_seeded + inherited_event_count；拒绝结束于开放轮次的前缀
  clear: 新会话(事件日志新文件)；旧会话可 resume
  flush: 每领取下一轮次前 flush() 为持久性屏障；append write-behind best-effort；崩溃保留被中断轮次只丢撕裂尾部
  migration: vN -> vN+1 只发布新 generation 文件，绝不改写/删除已提交 generation
memory:
  files: MEMORY.md(agent 笔记, 索引+topic 文件) + USER.md(用户画像) + CLAUDE.md/AGENTS.md(项目指令, 归 H02)
  inject: 会话开始冻结快照注入(前 N 行/字节预算)；中途写盘但不改当前提示（下一会话生效）
  tools: 单一 memory 工具 add/replace/remove/batch；文件锁+备份防漂移
  scopes: user/project/local 三级（subagent 可独立作用域，借鉴 Claude Code agent-memory）
  longterm_auto: false (v0.1)；external provider = 保留 MemoryProvider seam 但默认无（Hermes 同时仅 1 个约束）
  search: SQLite FTS（opt-in）会话/记忆检索
  checkpoint: 文件编辑工具操作快照(最近 100) 可 /rewind；Bash 改动的回滚以 git 为准（H12）
```

---

## H10 Skills

## Claude Code
实现位置：`skills.md` + `.claude/skills/`（enterprise>personal>project>plugin 四级发现，嵌套目录按需激活）+ Agent Skills 开放标准。
核心机制一句话：SKILL.md=YAML frontmatter+markdown；描述索引启动注入（截断 1,536 字符）、**正文按需加载**、注入后跨轮保留、compact 后按 ≤5000 token/个重注入；`disable-model-invocation: true` 不进索引只能用户调、`user-invocable:false` 隐藏菜单只能模型调、`paths:` glob 文件匹配自动触发、`context: fork` 在 fork 子代理上下文运行、`allowed-tools` turn 级免批准授权（下条消息即清）；`!`command`` 动态上下文注入、`@file` 引用捆绑文件；synced skill（claude.ai）能力降级（不执行 !/@）；冲突规则 enterprise>personal>project>bundled。

## Claw Code
实现位置：`tools/src/lib.rs` 的 Skill tool spec（L657）+ `run_skill`/`execute_skill`（L2510/L3790）+ `resolve_skill_path`（L3826，含 .claude/skills、.claw、legacy commands/ 兼容根）+ `/skills` 在 `commands/src/lib.rs`。
核心机制一句话：模型调 `Skill{skill:名称}` → 多根解析路径 → 读文件全文作为指令注入（parse_skill_description 提取简介）→ 返回 JSON（skill/path/…）；`/skills install <path>` 复制进技能目录、`claw skills list` 机器输出；`execute_skill` 只是"把技能文件内容读回给模型"——无结构化参数 schema、无技能内 agent/子会话执行器。

## Pi
实现位置：coding-agent `core/skills.ts`（509 行）+ docs/skills.md + `core/system-prompt.ts` 的 `formatSkillsForPrompt`；harness 层 `harness/skills.ts`（Skill 模型+显式调用 formatSkillInvocation/invokeSkill）。
核心机制一句话：Agent Skills 标准（agentskills.io）；位置=全局 `~/.pi/agent/skills/`、`~/.agents/skills/` + 项目 `.pi/skills/` 与祖先 `.agents/skills/`（需信任）+ pi 包 skills/ + settings `skills` 数组（可加 `~/.claude/skills`、`~/.codex/skills` 兼容目录）；发现规则=SKILL.md 目录递归、根 .md 直放仅当有合法 frontmatter；frontmatter name(≤64)/description(≤1024)/disable-model-invocation；启动只注入 name/description/location 的 `<available_skills>` XML（渐进披露），模型用 read 打开 SKILL.md 全文执行；`/skill:<name>` 强制加载；对多数违规只警告（跨 harness 共享友好）。

## DSH
实现位置：seam `packages/skill/skill`（`ctx.skills`：registerProvider/list/snapshot/get + `skills/change` 事件）+ 提供方 `skill-filesystem`（chokidar 监视）/`skill-badge` + 消费方 `tool-skill`（目录注入+skill 工具）。
核心机制一句话：provider 分层注册（scope 链合并、最近层赢重名），本地 rank 表 project-dsh `<root>/.dsh/skills`(100) < project-agents `.agents/skills`(200) < custom Config.customSkillDirs(300) < user-dsh `<dshHome>/skills`(400) < user-agents(500) < bundled(600)；`ctx.skills.get(name)` 每次重读正文（不缓存完整定义）；目录注入=首个非空完整视图 pre-step 持久 `<system-reminder>`（只含 name+转义 description，无正文/路径）；`skill({name})` 工具校验名称→查目录→`isModelInvocable` 门禁→按 agent cwd 重读→返回 `<skill_content>`/`<skill_resources>`/`<skill_instructions>`；无市场/签名，安装=放文件，更新=改文件+watcher 失效；`SkillSummary.source` 7 类来源桶是元数据不构成优先级。

## Codex
实现位置：`codex-rs/skills` crate（loading/parser/selection/invocation/model/mentions/name_counts）+ `core/src/skills.rs` + `plugins/skill_snapshot.rs`。
核心机制一句话：skill 根=用户 `~/.codex/skills`+项目+系统内嵌（`install_system_skills` 把 include_dir! 内容装到 CODEX_HOME/skills/.system、指纹 marker 跳过重复安装）；**显式选择**=用户输入 `@path`/sigil mention 触发按需注入（build_skills_and_plugins 只注入被提及的技能）、**隐式**=detect_implicit_skill_invocation_for_command 按命令识别（不强制）；SkillInterface（结构化接口）+SkillInterfaceAssetPolicy+SkillPolicy（执行边界）；SkillToolDependency 声明所需 MCP 服务器 turn 内按需启动；用户技能覆盖同名系统技能。

## OpenCode
实现位置：`packages/opencode/src/skill/`（index.ts 服务、discovery.ts URL 技能仓库）+ `tool/skill.ts` + 内置 customize-opencode。
核心机制一句话：三路来源——config/项目目录 SKILL.md 扫描（global ~/.claude/skills、~/.agents/skills、项目上溯第一个匹配层、config skills.paths）+ **远端 URL index.json**（Schema:{skills:[{name,files,version}]} 并发下载到缓存目录、version 变化 staging+rename 原子替换）；system prompt 给 `<available_skills>`（name/description/location）；模型调 `skill` 工具（params.name）→ 权限 `skill:<name>` ask → 返回 `<skill_content>`（body+base 目录+ripgrep 采样非 SKILL.md 文件清单）；Skill 权限 deny 时从 system prompt 隐藏；compaction/prune 保护 skill 工具输出不清除。

## Hermes
实现位置：`skills/`（内置）+ `optional-skills/` + 用户目录 + `agent/skill_utils.py`/`skill_commands.py`/`skill_preprocessing.py`（模板+`!`cmd`` shell 展开）+ `/learn`（`agent/learn_prompt.py`）+ curator（`agent/curator.py`）。
核心机制一句话：SKILL.md frontmatter（name/description≤60 字符/platforms OS 门控/metadata.hermes.tags/category/related_skills/config）；description index 进 prompt 命中才注入正文；`/learn`=活体 agent 用自身工具收集素材、按作者规范经 skill_manage 一次产出技能（大文档转 lean SKILL.md+references/）；curator 空闲期自动 pin/archive/consolidate/patch 技能（**只归档不删除、可恢复**、不碰主会话 cache）；删除技能=归档、`hermes curator restore` 救回。

## Decision
最终采用：**「SKILL.md 开放标准 + 分层 rank 发现 + 目录索引渐进披露 + 调用时按 cwd 重读注入 + skill 工具返回结构化正文/资源/指令」**——以 DSH 的 rank+scope 链与 `<skill_content>/<skill_resources>/<skill_instructions>` 返回契约为骨架（同时统一了 system/user/project 来源冲突裁决与内容-元数据分离），以 Claude Code/Pi 的"索引渐进披露（只给 name+description）、正文按需、模型 read 或 skill 工具加载"为使用流，以 OpenCode 的远端 URL index.json 版本化下载（v0.2）与 Pi 的"兼容 ~/.claude/skills、~/.codex/skills 目录、宽松校验跨 harness 共享"为生态面，以 Hermes 的 `/learn`+curator（只归档不删除）为技能生命周期管理方向。`allowed-tools` turn 级授权（Claude Code）纳入技能 frontmatter 能力面。

## Why
- 候选 A（Claude Code 型：描述索引常驻 + 正文按需注入后跨轮保留 + 复杂 frontmatter（allowed-tools/model/context:fork/paths/hooks））：优点——能力面最全；缺点——正文跨轮常驻每行都是成本、allowed-tools 只覆盖当前 turn、frontmatter 大而难。
- 候选 B（DSH/Pi 型：目录只含摘要（XML 转义）+ 每次调用重读正文 + rank 冲突裁决 + isModelInvocable/userInvocable 门禁）：优点——上下文成本近零、内容-元数据分离防泄露、无缓存一致性问题；缺点——每次重读有性能取舍、无市场/安装/签名。
- 对比结论：v0.1 选 B 的保守注入（成本与安全优先）；A 的"注入后跨轮保留"可作优化（同会话内按 skill 缓存正文上限 5000 token），A 的 allowed-tools turn 级授权保留为 frontmatter 字段。技能即目录+SKILL.md 的可分发单元与"正文是建议性知识、真正强制在权限/沙箱"的立场一致（security 明示技能可引导任意操作、需先审阅）。

## Rejected
没有采用：
- 不采用 Claw 的"技能=把文件全文读回给模型、无参数 schema/无执行器"的粗实现。
- 不采用 Hermes 的 description≤60 字符硬约束与 AST 扫描发现（build 缓存复杂、扫描 IO 高）。
- 不采用"技能正文常驻上下文跨轮无限保留"（无自动卸载）：有成本上限与按需失效。
- 不采用内置技能市场/签名链进 v0.1（Claude 插件市场/claude.ai 同步、OpenCode URL 仓库留 v0.2）；synced 来源的能力降级（不执行 !/@）作为安全原则先记录。
原因：技能是"知识即文件"的可组合单元，注入策略必须缓存友好、内容不泄漏正文/路径、来源可追溯（source/rank 是元数据不是信任链，明文标注）。

## Proposed Spec
```yaml
skills:
  format: SKILL.md = YAML frontmatter(name/description/when_to_use/disable_model_invocation/user_invocable/allowed_tools(可选,turn 级)/metadata) + markdown 正文 + 可选 references/ scripts/ 捆绑目录
  discovery_roots: project <root>/.dsh/skills(rank 100) < project .agents/skills(200) < config customSkillDirs(300) < user <dshHome>/skills(400) < user ~/.agents/skills(500) < bundled(600)
  compat_roots: ~/.claude/skills、~/.codex/skills 可加进 settings skills 数组（借鉴 Pi，宽松校验）
  conflict: rank 升序、近层赢；同层 first-wins；同层单层内 provider order
  index_inject: 首个完整视图 pre-step 持久注入目录（只含排序后 name+XML 转义 description；无正文/路径）；digest 变化 agent.inject() 替换
  load: skill 工具校验 name -> 查目录 -> is_model_invocable 门禁 -> 按 agent cwd 重读正文 -> 返回 <skill_content> + <skill_resources> + <skill_instructions>
  caching: 同会话内按 skill 正文缓存上限 5000 token（compact 后重注入）；跨会话不缓存正文
  watcher: chokidar 监视 + write/edit touch 同步失效（shell cd 不触发，借鉴 DSH 限制说明）
  lifecycle: /learn 活体 agent 产出（借鉴 Hermes，v0.2）；curator 只归档不删除可恢复（v0.2）
  remote: URL index.json 版本化原子替换（借鉴 OpenCode）= v0.2
  provenance: source(7 桶)/provider/rank 元数据进 prompt 但不构成信任；synced 来源能力降级原则(不执行 !/@ 命令)
```

---

## H11 Subagent / Multi-Agent

## Claude Code
实现位置：`sub-agents.md`/`agents.md`/`workflows.md`/`worktrees.md`；仓库示例 plugins/feature-dev/agents/。
核心机制一句话：内置类型 Explore/Plan/general-purpose/claude；定义=Markdown+YAML frontmatter（tools/disallowedTools/model/permissionMode/maxTurns/skills/mcpServers/hooks/memory/background/isolation:worktree/initialPrompt…）；**全新上下文窗口**不带主会话历史（fork 除外）、初始=自己 system prompt+环境+task message+CLAUDE.md（Explore/Plan 跳过省成本）、只回主一个 summary+元数据尾；后台子代理精简工具集；嵌套默认 3 层（CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH）、并发默认 20；worktree 隔离（.claude/worktrees/ 临时 git worktree、命令强制留 worktree 内、.worktreeinclude 复制 gitignored 文件）；dynamic workflows（agent()/pipeline()/parallel()/phase()/log() JS 脚本，16 并发/1000 agents/run、禁 Date.now/Math.random 保证可重放）。

## Claw Code
实现位置：`tools/src/lib.rs`：Agent tool（L671/L1434）→ `execute_agent_with_spawn`（L4095）→ `spawn_agent_job`（L4175）→ `run_agent_job`（L4202）→ `build_agent_runtime`；`allowed_tools_for_subagent` 按类型裁剪。
核心机制一句话：每个子代理=**同进程新线程**+独立 ConversationRuntime/Session/工具白名单+独立 max_iterations；Explore=read/glob/grep/WebFetch/WebSearch/ToolSearch/Skill/StructuredOutput，Plan/General 类似分集；输出持久化 output_file `*.md`+manifest `*.json`（状态机 running/completed/failed）；`/subagent [list|steer|kill]`、`/agents` 清单；worker_boot.rs WorkerRegistry（worker 状态机/trust/startup 预检/observe/await_ready）是"clawable worker"编排模型；Task/Team/Cron 仍是内存注册表。

## Pi
实现位置：**无内建 subagent 原语**（README 明示 skips sub agents and plan mode）；官方示例 `packages/coding-agent/examples/extensions/subagent/index.ts`（1038 行，属扩展）。
核心机制一句话：每次 subagent 调用 spawn **独立 pi 进程**（隔离上下文窗）、JSON 模式捕获结构化输出；三种模式 single/parallel(≤8 task,≤4 并发)/chain({previous} 占位符)；结果截断 PER_TASK_OUTPUT_CAP 50KB、临时目录 mkdtemp；内核只给多 lane/session 并行 run、runInBackground/steer、fork（harness/session/fork.ts 快照复制）等可组合原语，无"task 工具→子会话→结果回投"开箱链路。

## DSH
实现位置：seam `packages/subagent/subagent`（ctx.subagents、SubagentProvider、SubagentStartRequest/SubagentRun/SubagentResult、continuable 管理器 continuation.ts）+ 提供方 6 个（spawn-in-process/fork-in-process/acp/codex/claude-code/dsh-sdk）+ `tool-subagent`/`tool-subagent-control` + `packages/workflow`。
核心机制一句话：模型调 `subagent`/`subagent_fork` → 服务按**能力 flag 校验**（agentOptions/outputSchema/depthLimit/toolFilter/persona，缺能力即 UNSUPPORTED_CAPABILITY 拒绝，绝不接受后忽略）→ provider.start() → result={output, structured?, diagnostic?, stopReason}；`output`=子 agent 最后一条非空 assistant 消息；`structured` 仅当请求 outputSchema 且成功捕获；非 completed stopReason 一律映射 isError；可继续子 agent=startContinuable() 预留稳定 childId→send_message（按 Activation 状态 running→steer/waiting→唤醒/无→冷恢复再 steer）/interrupt_agent（keepInbox）/list_agents；maxDepth 绝对上限+持久 delegationDepth（冷恢复不降低）；无 worktree（隔离靠 scope+cwd 继承+沙箱）。

## Codex
实现位置：`core/src/agent/control.rs`（AgentControl 每根会话一个）+ `control/spawn.rs` + `agent/registry.rs`（spawn depth）+ `agent/role.rs` + `agent_communication.rs`（mailbox）+ `tools/handlers/multi_agents*.rs`（v1/v2 工具集）。
核心机制一句话：主代理调 spawn_agent → 校验 depth/容量 → reserve_spawn_slot → 按 SpawnAgentForkMode{FullHistory,LastNTurns} fork 出子 thread（独立 rollout/历史/world state）→ 子代理独立 Session 跑自己 turn 循环 → wait_agent/send_message/interrupt_agent 交互 → 完成 InterAgentCompletionMessage/SubagentNotification 回灌父上下文；角色只能**收窄**不能放大父权限（"never replace the parent session's authority"）；resume_agent_from_rollout 崩溃恢复整棵代理树（BFS）；agent_max_threads 默认 6、max_concurrent_threads_per_session 默认 4（V2）；深度（V1 max_depth）与并发（V2）分别生效。

## OpenCode
实现位置：`packages/opencode/src/tool/task.ts`（task 工具）+ `session/prompt.ts` handleSubtask + `agent/agent.ts`（mode: subagent|primary|all）+ `agent/subagent-permissions.ts` + `background/job.ts`。
核心机制一句话：子代理=**独立子 Session**（sessions.create({parentID})、agent 名=subagent_type），父会话深度限制 subagent_depth（默认 1）；task 流程=权限 task:<subagent_type> ask → 子会话权限=父 deny+external_directory 规则+自身 ruleset+默认禁 todowrite/task → 在子会话跑完整 runLoop（可并行/可中断）；内置 general（并行研究，禁 todowrite）/explore（只读，禁编辑）；前台=background.start 注册 job 后 wait；后台（flag）=立即返回 `<task state="running">`、完成注入合成 user 消息 renderOutput 继续；结果 `<task_result>`/`<task_error>` 文本 XML 标签。

## Hermes
实现位置：`tools/delegate_tool.py` 家族（delegate_tool_child_run/dispatch/progress/config/toolsets/registry）+ `agent/delegation_context.py` + `subagent_lifecycle.py`（插件不可变生命周期 API：SubagentLaunchRequest/Handle/State/Result/Cancel/Reconnect）+ `periodic_scheduler.py`。
核心机制一句话：delegate_task 派生**全新 AIAgent 子实例**——fresh conversation+自己的 task_id（终端会话/文件缓存隔离）+父工具集**剔除 child-blocked 工具**+由 goal+context 构建的聚焦系统提示；单任务与 batch（并行）两种模式；顶层 model 调用后台跑、orchestrator 子等待 worker；父只看到委托调用与摘要结果、**看不到子中间 tool 调用/推理**；有 max spawn depth、max concurrent children、子超时、心跳、worktree isolation 配置、子结果 schema 校验。

## Decision
最终采用：**「子代理=独立会话（新扁平 scope 或可选 fork seed）+ 统一结果契约（output/structured/stopReason）+ 可继续后台子代理（send_message/interrupt/list）+ 持久化委派深度 + 能力显式声明」**——以 DSH 的 subagent seam（provider 注册表、能力 flag 校验、ContinuableCreateSpec 管理器、result 契约、delegationDepth 持久）为内核（与事件溯源一致：子代理也是普通 Session，可 resume/可审计），以 Codex 的"角色只能收窄不能放大父权限 + fork 窗口可选 FullHistory/LastNTurns + 代理树可恢复"为权限/生命周期补充，以 Hermes 的"父只见摘要不见中间过程 + child-blocked 工具剔除 + schema 校验"为信息隐藏纪律，以 Claude Code 的"worktree 隔离（v0.2）+ Explore 只读预设 + 并发/深度默认上限"为能力面。workflow 编排脚本（Claude Code dynamic workflows / DSH workflow 工具 + 结构化 schema）作为多 agent fan-out 的独立机制纳入。

## Why
- 候选 A（Claude Code/Hermes 型：每子代理全新独立上下文 + 只回摘要 + 后台精简工具集 + worktree 隔离）：优点——上下文隔离是核心卖点（token 数字可证）、并行写冲突最小；缺点——summary 是信息瓶颈、worktree 机制复杂。
- 候选 B（Codex 型：子代理=fork 的独立 thread、可选历史窗口、agent 树整棵可恢复）：优点——fork 继承可平衡隔离与上下文、崩溃恢复整树；缺点——v1/v2 双实现并存维护面翻倍。
- 候选 C（DSH 型：seam+provider 注册表、可继续子代理、delegationDepth 持久冷恢复不降）：优点——"换 provider=换整个产品行为"、结果契约统一、非完成原因一律视为失败；缺点——无 Planner/Reviewer 预设角色（是机制不是角色）、无 worktree。
- 对比结论：三者的可迁移点互不冲突：C 的结构（seam+契约+持久深度）做骨架、B 的 fork 窗口与权限单向收窄进 fork 语义、A 的摘要回流与只读 Explore 预设进默认装配；worktree 隔离列为 v0.2（Claude Code 级 worktree 需完整 git 语义）。

## Rejected
没有采用：
- 不采用 Pi"无内建、靠 spawn 独立进程扩展自实现"作为默认：用户拿不到、进程开销大、无共享检查点（保留为一种 provider 实现选项）。
- 不采用 Claw 的"同进程线程、Task/Team/Cron 内存注册表"当作真编排：无进程/会话级故障隔离，内存注册表重启即失。
- 不采用 v1/v2 双套多代理工具并存（Codex）：v0.1 只一套。
- 不采用 agent-teams（DSH experimental）进 v0.1：实验性、需求不明确。
原因：子代理必须与主代理同构（同一 Session/loop/事件），才能享受 resume/fork/审计；机制（seam+provider）先于角色（Planner/Reviewer），角色只是预设配置。

## Proposed Spec
```yaml
subagent:
  seam: ctx.subagents + SubagentProvider 注册表；工具 subagent(一次性) / subagent_fork(带 fork seed) / send_message / interrupt_agent / list_agents
  capability_flags: { agentOptions, outputSchema, depthLimit, toolFilter, persona } 缺能力即 UNSUPPORTED_CAPABILITY 拒绝（不接受后忽略）
  result_contract: { output(最后非空 assistant 消息|累计流), structured?(object-rooted JSON Schema 捕获即校验), diagnostic?, stopReason }
  completion: stopReason=completed 才非错误；aborted/error/max_tokens/refusal -> isError 工具结果
  isolation: 新扁平 scope（不继承父注册；preset standing composition 或 fork 前缀除外）；toolFilter 可见性而非权限（权限=沙箱/审批）；fork 的 provider/model 与父一致(KV Cache 复用)
  depth: maxDepth 绝对上限 + 持久 delegationDepth(父+1, 冷恢复不降低)
  concurrency: 默认 max_concurrent 4 / 深度 3（Codex/Claude 收敛值内）
  continuable: startContinuable 预留稳定 childId；send_message 按 Activation(running->steer / waiting->唤醒 / 无->冷恢复)；interrupt keepInbox；list_agents running/idle/ready
  info_hiding: 父只见 result（子中间 tool/推理不上行）；后台完成以通知注入父
  presets_v01: [ explore(只读: read/glob/grep/web/ask), general(全工具多步) ]  # Planner/Reviewer 只是 preset 配置
  roles_shrink_only: 子代理配置只能收窄父能力（工具/模型/提示覆盖），永不放大父会话权限
  worktree: v0.2（临时 git worktree + 命令强制留 worktree 内）
  workflow: v0.1 提供 workflow 工具（agent({prompt,schema})/pipeline/parallel/phase 编排脚本，后台 fan-out、中间结果不进主上下文、返回综合结果）
```

---

## H12 Evaluator / Verification

## Claude Code
实现位置：`goal.md`（/goal evaluator）、`code-review.md`/`ultrareview.md`、`security-guidance` 插件、`github-actions.md`、Agent SDK structured-outputs。
核心机制一句话：verification loop 概念=官方定义"给 Claude 一个可运行检查（test/build/screenshot 对比）并迭代到通过"为**无人值守运行的前提**（没有 verification loop 时唯一判定完成的是模型自己）；`/goal`=每 turn 后独立小模型（默认 Haiku 级）对照条件评估 transcript（evaluator **不跑命令不读文件只读对话**），三态 met/impossible/error、条件 ≤4000 字符、是 session-scoped prompt-based Stop hook 的包装；`/code-review`（本地）=多 agent 并行分析 diff+全代码库→verification step 对照真实代码过滤 false positives→去重按严重度排序→内联评论+摘要，`--fix` 应用修复；`/verify`/`/run`（bundled skills）=跑真实 app 验证（不 fallback 到测试）；structured output（`claude -p --json-schema`）校验失败重试达上限报 error；--restricted 模式专为 eval harness（禁执行工具/限文件域/禁 bypass）。

## Claw Code
实现位置：**无 LLM 输出质量评测器**；最接近的评测体系 = `mock-anthropic-service` crate（确定性 Anthropic 兼容 mock，`PARITY_SCENARIO:` 前缀识别 12+ 脚本场景：streaming_text/read_file_roundtrip/bash_permission_prompt_approved_denied/auto_compact_triggered/token_cost_reporting 等）+ `rusty-claude-cli/tests/mock_parity_harness.rs` + `rust/mock_parity_scenarios.json`（scenario→PARITY 引用清单）+ `compat-harness` crate（从上游 Claude Code 检出物提取命令/工具/bootstrap 做表面 diff）+ `docs/g00*.md` verification-map 系列（把"行为→代码→测试"人工+脚本对照）+ `policy_engine.rs`/`green_contract.rs`（策略作为可执行规则求值的编排侧"绿灯"评审）。
核心机制一句话：评测对象是**行为对齐/回归**而非任务完成质量（无质量分/轨迹分析/参考答案）；确定性 mock 端到端回归（无网络无真实模型）、scenario↔PARITY 引用自动核对（diff 脚本）、g004 事件/报告契约机器校验；多数 verification-map 是文档而非 CI 强制门槛。

## Pi
实现位置：`packages/evals/`（`src/pi-harness.ts`、`src/smoke.eval.ts`、`src/extensions.eval.ts`、vitest-evals/{harness-table,setup,reporter,summary,artifacts}.ts）+ 根 `npm run eval`。
核心机制一句话：Pi evals=**行为级、模型回代、测试即 eval**——适配开源 vitest-evals（describeEval/it/断言/归一化 trace/judge）到真实 `AgentSession`（`createPiCodingAgentHarness`：临时 workspace+agent 目录、ModelRuntime.create 选 provider/model、每步 prompt→断言最终 assistant 文本与 usage、真实 JSONL 会话挂 artifact）；支持 baseline vs candidate 对照（改 prompts/tools/skills/models 的回归测量）；定位=用真实 dev 工作流衡量端到端行为而非 toy benchmark；运行时无 per-run 自动 LLM 裁判 API（judge 概念来自 vitest-evals 上游）。

## DSH
实现位置：**无独立 Evaluator 模块/agent**（grep docs 全库无 evaluator 子系统）；验证能力分布：仓库测试体系（unit vitest 每文件 100% 门禁→real-API e2e→expected→snapshot keyless 录制会话重放→web 浏览器快照）+ `packages/plan/plan`（plan 评审门：agent 以 exit_plan_mode 呈交、用户 Approve/Keep planning）+ `packages/goal`（create_goal/get_goal/update_goal 持久同会话目标续跑）+ `packages/todo` + subagent `outputSchema`（object-rooted JSON Schema 捕获即校验）+ workflow 工具（agent(prompt,{schema}) 坏 schema 必杀脚本）+ `packages/code-runtime`（run_code 执行 Python/JS）+ `runtime-diagnostics/invariants`（`dsh-invariants` 回放校验会话日志关系：轮次/步骤编号、工具调用/结果配对、retry 记录）+ `dsh-webhook-github`。
核心机制一句话：Tests/Lint/Typecheck/Build **无内建面向 agent 的验证工具**（靠 shell 工具跑项目自身命令+`{stdout,stderr,exitCode}` 契约回读）；Browser/Screenshot 未内建浏览器自动化；H12 呈现为"验证是外围测试体系+人工评审门+结构化返回契约"而非 agent 内建 evaluator；BENCHMARK.md 仅 3 行（**未获取到**成体系 benchmark 场景/指标定义）。

## Codex
实现位置：`codex-rs/exec`（`codex review` 子命令）+ `core/src/tasks/review.rs`（ReviewTask）+ `prompts/src/review_request.rs` + `prompts/templates/review/rubric.md` + `codex-protocol/review_format.rs` + `turn.rs` 的 `ResponseEvent::ModelVerifications` + `tools/handlers/test_sync.rs`。
核心机制一句话：`codex review`=以**受限子代理会话**运行（review-only 特性限制：禁 web search/collab/view_image），用 `review_model`（独立模型配置）按 rubric 生成**结构化 findings**（从最后一条消息解析 ReviewOutputEvent），退出时把 findings 块与渲染文本写回对话历史并持久化 rollout；目标三态 uncommitted changes/base branch（自动 merge-base）/commit；ModelVerifications=模型流可带 verification 事件（协议层软事件非强制）；**无独立 Tests/Lint/Typecheck/Build/Browser/Screenshot 工具**——"测试/构建由模型用 exec_command 自己跑"哲学；Guardian 审查=对审批请求的模型判断（行为安全验证器）。

## OpenCode
实现位置：无独立自动评估/评测框架内建在核心 loop；最接近机制：(1) `agent/agent.ts` 的 `Agent.generate`（generateObject/streamObject 按 schema 生成 agent 配置：identifier/whenToUse/systemPrompt，temperature 0.3，identifier 防撞）；(2) provider/model-status 与 config 校验（错误语义化）；(3) 工具/循环失败自愈评估（retry、invalid 工具反馈、doom_loop 询问、subagent 结果错误判定）。
核心机制一句话：会话结束判定在 runLoop（finish reason 非 tool-calls/error/blocked/maxSteps 注入等）；content-filter/StructuredOutput 缺输出显式转 error；compaction 失败转 ContextOverflowError；质量/正确性自动评估未在 packages/opencode/src 内发现集中实现——**判断为空缺/外包给外部测试流程**（文档明示未获取到独立 Evaluator 组件）。

## Hermes
实现位置：记忆/技能评审 `agent/background_review.py`（每轮后 fork 一个 AIAgent 重放快照自问"该保存/更新哪些 skill 或 memory"，写直达记忆+技能库、不碰主会话与 cache）+ 人工 `/review`（`agent/review_engine.py`：spawn 独立全权限后台子代理，同 async-delegation rail，结果异步委托完成态回母会话）+ 验证闸 `agent/verify/runner.py`（bootstrap→build→test→start→readiness→teardown，项目自带 recipe）+ `agent/verify_hooks.py`（pre_verify 轮末闸、CODING_VERIFY_GUIDANCE、默认 ≤3 次 nudge、证据驱动 verification-stop）+ 自评 harness `evals/`（runner+报告+SCORECARD）。
核心机制一句话：Hermes **无单一"裁判"模型模块**——评估职责分布为 ①后台自动 skill/memory 评审（learning loop 判定器）②/review/delegate 的全权限后台评审子代理 ③verify recipe 对编码产物的证据闸 ④evals/ 离线自评；评审 fork 继承父运行时（provider/model/凭据/缓存系统提示）故命中同一 prefix cache；"经验转技能"闭环=background_review(判定)→skill_manage/curator(落地)。

## Decision
最终采用：**「外部化验证三层 + Generator/Evaluator 分离」**——①确定性验证层（test/lint/typecheck/build 由 shell 工具执行 + `{stdout,stderr,exitCode}` 契约回读，参照各家共识：验证是独立于模型的外部检查）；②独立 Evaluator 层（参照 Claude Code `/goal`：**只读 transcript 的独立小模型评估器**三态 met/impossible/error——但放宽为"可读磁盘证据"，因任务书禁止事项 6 明确 Generator 不能默认自判完成；dsh 的 invariants 回放校验（轮次/步骤编号、tool call/result 配对、retry 记录）作为机械自检层叠加）；③评审子代理层（参照 Codex `codex review` 的受限评审子代理：独立模型+结构化 findings+review-only 工具限制、Hermes verify recipe 证据闸 pre_verify ≤3 次 nudge、Claude Code code-review 的 verification step 对照真实代码过滤误报）。subagent outputSchema + workflow 结构化 schema（DSH/Claude Code）作为机器可校验的结构化契约贯穿三层。Benchmark 场景集独立于运行时（见 Benchmark 章节要求 ≥15 场景，v0.1 建 `evals/` 仓库化 runner）。

## Why
- 候选 A（Claude Code/Codex 型：verification loop 哲学 + /goal 独立小模型只读 transcript + review 受限子代理）：优点——"无人值守以 verification loop 为前提"是正确完成语义、独立评估避免自证；缺点——/goal 只读 transcript 无法看磁盘、条件需对话自证（写不好误判）；Codex 无确定性测试栅栏（验证外包给模型自执行）。
- 候选 B（DSH/Hermes 型：不建内建 evaluator，验证=测试体系+评审门+invariants 回放自检）：优点——诚实（不假装有自动裁判）、invariants 让日志结构自检机器化、benchmark 外置；缺点——缺"任务完成质量"判定单元，goal/评审人工参与多。
- 对比结论：两者缺一不可——A 给出"谁判定完成"的模型侧 evaluator 形态（独立模型+结构化三态），B 给出"判定可机器验证"的机械侧（invariants+确定性命令+结构化 schema）。任务书要求 Generator/Evaluator 分离 + Benchmark ≥15 场景，故 v0.1 需**同时**建立：goal/evaluator 子代理（读 transcript+磁盘证据）、invariants 回放自检、evals/ 仓库化 benchmark。评审用子代理沿用 H11 机制（独立会话+schema 结果）零新增机制。

## Rejected
没有采用：
- 不采用"无 evaluator、全外包外部测试流程"（OpenCode 缺口状态）：任务书禁止事项 6 要求 Generator 不默认自判完成，必须内建 evaluator 语义。
- 不采用"模型自声明完成/ModelVerifications 软事件"（Codex）作为验收依据：无强制语义，仅作信息事件保留。
- 不采用 Claw 的"评测=行为对齐 mock-parity"替代质量评测：保留 mock 测试体系但不等同 evaluator。
- 不采用 Claude Code `/goal` 的"evaluator 只读 transcript 不看磁盘"硬限制：v0.1 evaluator 只读模式（transcript+磁盘证据只读访问、无写无执行）——比 /goal 更能验证"产物真实存在"，同时保持评估者与执行者分离。
- 不采用 Hermes 的 background_review（每轮 fork 判定该存什么记忆/技能）进 v0.1：学习闭环留 v0.2，防记忆污染。
原因：完成语义必须外部化（可运行命令/独立评估模型/多 agent 交叉核验），且评估者与执行者之间必须有信息隔离（Claude classifier 盲化立场：审查输入与执行输入分离）。

## Proposed Spec
```yaml
evaluator:
  deterministic: [ tests, lint, typecheck, build ]        # 经 shell 工具执行 + {stdout,stderr,exitCode} 契约回读
  agent: 独立小模型 evaluator（默认预算最低档模型）
    inputs: [ transcript(surface 投影), 磁盘只读证据(文件存在/内容/测试产物路径), 结构化 goal 条件 ]
    outputs: { verdict: met | not_met | impossible | error, evidence: [结构化引用] }
    isolation: 只读、无执行工具、独立会话(不污染主会话 cache)
    verdict_policy: met 且 evidence 满足才允许 generator 收尾；not_met -> 回 generator 续做(≤N 轮)
  invariant_selfcheck: 回放会话日志校验（轮次/步骤编号连续、tool call/result 配对、retry 记录、compaction 区域平衡）——任一失败=日志腐败故障
  review_subagent: 受限评审子代理（独立模型 review_model + rubric.md + 结构化 findings + 禁编辑/禁网络）；verification step 对照真实代码过滤误报（Claude Code 模式）
  structured_contract: subagent outputSchema + workflow agent({schema})：object-rooted JSON Schema 捕获即校验、失败转 error（不可静默吞）
  goal_tracking: create_goal/get_goal/update_goal 持久同会话目标；todo_write 任务清单全绿才允许收尾工具
  completion_gate: generator 默认不可自判完成；须 evaluator 层裁决或显式用户确认
  evals_repo: evals/ 目录化 benchmark（≥15 场景 v0.1）：行为级模型回代测试（vitest-evals 或等价 runner）+ baseline vs candidate A/B + 产物 artifact(session 日志/screenshot)
  honesty_rules: 禁假数据/假测试/伪证完成；无法获取真数据时上报而非伪造（CL4R1T4S 语料跨产品共识）
```

---

## 数据缺口清单（按 8 份研究文档如实标注）

| 项目 | H 维度 | 缺口描述 |
| ---- | ------ | -------- |
| Claude Code | 全部 | 运行时闭源：所有"实现位置"均为公开接口面（文档/配置/CLI/hook），非源码路径；内部机制按官方文档与 CHANGELOG 推断并注明；未获取 CL4R1T4S / system prompt 原文 |
| Claude Code | H12 | /goal evaluator 无独立源码可核（闭源）；verification 无结构化验收契约（全自然语言+模型判定） |
| Claw Code | H07 | `trust_resolver` 仅 `#[cfg(test)]` 导出未进生产；approval token/ledger 与正常交互流关系不明 |
| Claw Code | H11 | Task/Team/Cron 仍是内存注册表（无真实后台调度器）；AskUserQuestion 在子代理路径不可用（pending stub） |
| Claw Code | H12 | 无输出质量评测器（已标注以 mock-parity+verification-map 代替）；多数 verification-map 非 CI 强制门槛 |
| Pi | H08/H12 | 无内建沙箱与无 subagent 原语均为 README 明示的"非目标"（非资料缺失）；evals 覆盖点少（smoke/extensions 两例，起步形态） |
| Pi | H09 | JSONL 单文件并发写锁约束细节未深究（SQLite 后端解决）；fork 摘要部分 UX 依赖交互确认（非全自动） |
| DSH | H07 | Developer Preview 未审计（SAFETY.md 明示不得视为安全/生产就绪）；部分平台强制执行只有 partial（Windows ACL Everyone/硬链接、旧 Landlock ABI） |
| DSH | H12 | BENCHMARK.md 仅 3 行：**未获取到**成体系 benchmark 场景/指标定义 |
| DSH | H03/H09 | 无内置 RAG/长程记忆（第三方 MCP overlay 需手动配置）；SQLite 全文搜索默认关闭（openAt: never） |
| Codex | H02/H09 | model system prompt 渲染文本视为 UNTRUSTED 仅提取 section 行为模式；memory 管道依赖 OpenAI 后端状态库与 feature flag，自托管基本不可用 |
| Codex | H12 | 无确定性测试栅栏；ModelVerifications 软事件无强制语义；无 screenshot/browser 验证集成 |
| OpenCode | H08/H12 | 源码内无 OS 级沙箱实现与独立 evaluator 框架（已如实标注空缺）；opencode.ai/docs 未抓取（避免臆断） |
| OpenCode | H05 | 工具集按 modelID 子串判断（如 gpt）偏脆；每次 resolve 重建整套工具上下文（性能未量化） |
| Hermes | H03 | 未获取到 ContextEngine 引擎选型/竞品比较文档；ABC 表面大、实现新引擎 hook 多 |
| Hermes | H08 | 未获取到面向最终用户的内置 OS 沙箱（seatbelt/bwrap）实现；本地非沙箱是明确取舍 |
| Hermes | H11/H06 | 跨进程 subagent 独立部署形态未获取（除 cron/delegate 独立任务进程）；无跨进程事件总线/事件溯源信息 |
| cl4r1t4s | 全部 | UNTRUSTED 语料：仅行为模式参照，不单独成列；不当作任何厂商现役行为事实；skill 协议仅 Codex Desktop 单点来源 |
| 未获取（跨项目共性） | MCP/H12 | MCP 不在任务书 12 行表内，各家深度不一（Pi 无客户端抽象、Hermes 轮间刷新未量化）；各家 benchmark/eval 场景与指标多为缺口或起步态 |

（完）