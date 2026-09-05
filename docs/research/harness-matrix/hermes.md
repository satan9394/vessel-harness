# Hermes Agent 解剖

- 研究日期：2026-09-05
- 锁定 URL：https://github.com/NousResearch/hermes-agent
- commit SHA：`d20a8e44755a8e999a2e816ef9f458c438d3e17c`（2026-09-05 02:31 -0700，git clone --depth 1 至 `%TEMP%\hermes-agent` 后读取）
- 主要来源：仓库根 `AGENTS.md`、`plugins/AGENTS.md`、`skills/AGENTS.md`、`README.md` 与 `agent/`、`tools/`、`cron/`、`evals/`、`hermes_cli/` 源码 docstring 及关键函数签名

> 注：Hermes 是**单体大 agent**（CLI/gateway/TUI/Desktop 共用同一 core），核心 Python 仓库约 1.2 万文件。核心设计两条铁律（根 AGENTS.md）：①**per-conversation prompt cache 神圣不可侵犯**——会话中途任何会改写历史/工具集/记忆/系统提示的操作默认延后到下一会话生效；②**core 是窄腰**，能力尽量放边缘（CLI+skill / 插件 / MCP），核心模型工具每轮都发给 API，增核心工具是最后手段。

## H01 Agent Loop

- 实现位置：`agent/conversation_loop.py`（`run_conversation`，从 `run_agent.AIAgent` 抽出）+ 门面 `agent/turn_facade.py` + 一整套 `turn_*.py` 阶段文件（turn_context / api_call / api_error / api_request / finalizer / stop_gates / overflow / truncation…）。
- 核心流程：单轮驱动 = build_turn_context（一次/轮准备：stdio 守卫、消毒、restore-or-build 系统提示、session 行、idle/preflight 压缩、pre_llm_call hook、预取、持久化）→ model 调用（retry/fallback/rate-limit guard）→ tool dispatch → 重复迭代直到 finalize；收尾有 finalizer、liveness、持久化 flush。跨进程会话有 durable turn lease + 刷新线程 + 看门狗（`turn_facade_lease`、`periodic_scheduler.py` 单进程堆调度合并 ~130 个子代理的心跳/租约线程）。
- 优点：按阶段拆成几十个可单测模块；跨进程会话租约防双写；运行时钩子齐全；`iteration_budget`、`interrupt_control`、`empty_response_guard` 等健壮性件齐全。
- 缺点：**核心相当庞大**（turn_* 家族数十文件），"窄腰"只是相对其产品面而言；单仓库单体导致认知/上车成本高。

## H02 System Prompt

- 实现位置：`agent/system_prompt.py`（组装）+ `agent/prompt_builder.py`（无状态构件：identity/guidance/hints/skills index/context files）+ `SOUL.md`（身份，`~/.hermes/SOUL.md`）。
- 核心机制：**三层拼接**（`\n\n` join）：`stable`（identity、guidance、env hints、coding brief、platform hints）→ `context`（workspace 快照、caller system_message、context files）→ `volatile`（skills index、memory、USER.md、外部 memory provider、时间戳行）。**每会话构建一次、跨轮复用**，唯一触发重建的是 context compression（保住上游 prefix cache）；写系统提示的斜杠命令默认延后（`--now` 才立即失效）。
- 优点：把"缓存敏感"当作一等设计约束；plugin 可注入带注释计数框的 `## Plugin Context:` 段落并可整体冻结/恢复。
- 缺点：`volatile` 层把 skills index/memory/时间戳塞进前缀，任何一处变化都牺牲缓存；分层复杂度高，调试 prompt 内容成本不低。

## H03 Context Engine

- 实现位置：`agent/context_engine.py`（`ContextEngine` ABC，可插拔，`context.engine` 配置选一，默认实现即 `agent/context_compressor.py` 的 ContextCompressor；插件在 `plugins/context_engine/<name>/`）。
- 核心机制：ABC 生命周期 `on_session_start → 每 API 响应 update_from_response → 每轮 should_compress/compress（含 should_compress_info 给宿主理由）→ on_session_end`（仅在真实会话边界 CLI 退出//reset/gateway 过期触发，绝不每轮调）；可暴露自有工具 schema/handle_tool_call（如手动压缩反馈）；`sanitize_memory_context` 对跨 egress 的记忆文本做脱敏 + 头尾截断（6000 字符上限）。
- 优点：context 策略与宿主解耦成插件点；压缩决策可被宿主查询原因；预检（preflight）与真 usage 分开评估，降低误压缩。
- 缺点：同一时间仅一个引擎激活；ABC 表面大，写一个新引擎要实现的 hook 不少（未获取到引擎选型/竞品的比较文档）。

## H04 Compaction

- 实现位置：主压缩 `agent/context_compressor.py`；滚动微压缩 `agent/micro_compaction.py`；原生服务端压缩 `agent/native_compaction.py`；宿主包装 `agent/compression_facade.py`、`turn_context_compaction.py`；文档 `docs/micro-compaction.md`、`docs/session-lifecycle.md`。
- 核心流程：默认自动压缩=**辅助（aux）廉价模型把中间轮次摘要成 handoff summary，头尾受保护**（迭代式摘要、token 预算 tail、**先修剪 tool 输出**、按比例缩放预算）；压缩摘要含一条持久化提醒（MEMORY.md/USER.md 永远权威、以摘要+当前状态为准，勿重做）。`micro_compaction` 为轮间把旧 exchange 折进滚动 summary marker，**默认关**（每轮重写前缀会破坏 cache）。`native_compaction` 对 gpt-5.6 直连 OpenAI/Codex 后端启用 `context_management=compaction`，阈值低于本地触发、本地压缩器保持武装兜底。压缩在超时围栏 + commit fence 下对快照运行，硬中断可读。
- 优点：多级策略（tool 输出修剪→本地摘要→服务端原生）叠加冗余；摘要 prompt 明确防"丢记忆权威"；对压缩超时做冷却阶梯与用户可见状态。
- 缺点：微压缩默认关闭说明 cache 约束压制了更激进压缩；evals/compaction 目录显示其在持续自评，未见公开的"无损保证"承诺。

## H05 Tool System

- 实现位置：`tools/registry.py`（`ToolRegistry`，工具文件 import 即 `registry.register()` 声明 schema/handler/toolset/可用性 check_fn）+ `model_tools.py`（向模型查询 registry）+ `toolsets.py`（工具集组合：`_core_without`、TOOLSETS、resolve_toolset、自定义 toolset）+ `agent/tool_executor.py`（顺序/并发 dispatch、observe→commit→project 管道）+ `agent/inline_tool_executors.py`、`tool_guardrails.py`、`tools/` 下数百工具。
- 核心机制：核心工具**每轮全量随请求发送**，故工具面受窄腰纪律约束；服务可门控工具（check_fn）与插件工具通过注册发现；`tools/transports/` 含 `hermes_tools_mcp_server.py`——把 Hermes 工具面以 MCP server 形式暴露；MCP client 侧集成另有注册与轮间刷新（`_refresh_mcp_tools_between_turns`）。
- 优点：统一注册表 + 工具集分发（编码集、自定义集）清晰；check_fn 缓存化避免每轮重算可用性；并发工具批处理有 worker 上限与超时。
- 缺点：registry 用 AST 扫描+import 发现，构建缓存复杂；工具数以百计时 schema 本身是 token 大头（他们用窄腰+工具集缓解，未完全解决）。

## H06 Hooks/Events

- 实现位置：插件钩子在 `hermes_cli/plugins.py`（PluginDispatchMixin）、`plugins/plugin_loader.py`、`agent/api_request_hooks.py`、`agent/plugin_stream_hooks.py`；核心枚举钩子：`pre_tool_call`（可返回 `{"action":"block","message"}` 否决或改 args）、`post_tool_call`、`transform_terminal_output`/`transform_tool_result`/`transform_llm_output`、`pre_llm_call`、`post_llm_call`、`transform_api_error_classification`、`on_session_start`、`on_session_end`、`verify_hooks.py` 的 `pre_verify` 轮末闸。
- 核心机制：内存 hook 回调按声明签名注入 payload（signature-inspect，兼容旧窄签名）；热路径 hook 有超时上限（避免 #6622 悬挂）；**流式输出钩子**（`plugin_stream_hooks`）每消费者独立有界队列 + 守护线程，插件永不 inline 跑在 token 路径上，队列满丢最旧。
- 优点：对"什么能进核心"设了否决权（无真实消费者的 hook 属投机基建被拒）；钩子即插件的扩展主面，plugins 永不改 core 文件。
- 缺点：钩子面全在进程内、单机（未获取到跨进程事件总线/事件溯源信息——除非 count gateway 的 relay 观测指标）。

## H07 Permission/Safety

- 实现位置：`tools/approval.py` 全家（`approval_detection` 危险模式、`approval_floors` 预检闸+allowlist、`approval_prompt` CLI/网关/MCP 提示、`approval_gateway_wait` 阻塞网关往返、`approval_smart` **guardian LLM**、`approval_human_wait`）+ `tools/write_approval.py`、`tools/threat_patterns.py`、`agent/redact.py`、`agent/secret_scope.py`、`agent/estop.py`。
- 核心机制：三个守卫入口 `check_all_command_guards` / `check_execute_code_guard` / `request_tool_approval`（会话级审批、yolo、网关队列、denial breaker）；危险命令模式检测、预检 floor + allowlist、必要时转 guardian LLM 或人工（CLI/gateway/Desktop 可异步审批）；写入有独立 write_approval 与文件安全检查（`file_tools_write_guards`、威胁扫描 `_scan_for_threats` 应用于系统提示注入内容）；拒绝计数熔断（denial breaker）防止死循环追问。
- 优点：多级降级（自动放行 → 模式允许 → guardian LLM → 人工）非常务实；跨界面（CLI/gateway/TUI/Desktop）审批收敛到同一 gate。
- 缺点：核心是**信任本地用户 + 审批制**而非强制最小权限沙箱（见 H08）。

## H08 Sandbox

- 实现位置：`tools/code_execution_tool.py`（PTC：LLM 写 Python 脚本经 RPC 调 Hermes 工具）+ `tools/code_kernel.py`/`code_kernel_remote.py`（每会话持久 kernel，Unix socket/loopback TCP）+ `tools/code_execution_env.py`（子进程 env 清洗：secret 子串阻断、PYTHONPATH 卫生、UTF-8）+ `tools/environments/`（docker、modal、daytona、singularity、ssh 等**远程执行后端** + `local_env_policy.py`）+ `docs/security/network-egress-isolation.md`。
- 核心机制：execute_code 即"程序化工具调用"——脚本内只允许调用已授权 Hermes 工具、stdout 回流；本机后端走 per-conversation session kernel；远程后端（容器/云/SSH）可做真隔离。**无默认 OS 级 jail**：本地以审批 + env scrubbing + 工具白名单兜底；终端/文件工具信任度等同开发者自身（verify runner 同样 `shell=True` 自证）。sandbox 相关文件（`nix/sandbox.nix`、`scripts/sandbox/`、`scripts/dev-sandbox.sh`）属 dev/CI 环境构建，非运行时执行沙箱。
- 优点：PTC 把多步链折叠成一轮并只回传 stdout；远程后端把隔离选项外置（docker/modal/ssh）。
- 缺点：本地非沙箱是安全边界上的明确取舍（威胁模型=用户即信任方）；未获取到面向最终用户的内置 OS 沙箱（如 seatbelt/bwrap）实现。

## H09 Session/Memory

- 实现位置：会话持久化 `agent/session_persistence.py` + 根级 `hermes_state*.py` 家族（SQLite state db、WAL、FTS 搜索 `hermes_state_search.py`、sessions/titles/usage 分表、`hermes_state_registry.py`）；记忆 `tools/memory_tool.py`+`memory_tool_store.py`（`MemoryStore`）、`agent/memory_manager.py`、`agent/memory_provider.py`（`MemoryProvider` ABC）；外部 provider `plugins/memory/`（honcho/mem0/supermemory 等，已关闭新增）；跨进程 turn lease `agent/turn_facade_lease.py`。
- 核心机制：记忆=**磁盘文件 `MEMORY.md`（agent 笔记）+ `USER.md`（用户画像）**，会话开始以冻结快照进系统提示；**中途写盘但绝不改写当前提示**（保 prefix cache），下一会话生效；单一 `memory` 工具 add/replace/remove/批量，文件锁 + 备份防漂移。MemoryManager 把记忆 hooks 扇出给 provider：`system_prompt_block/prefetch/sync_turn/tool dispatch/shutdown` + 可选 `on_turn_start/on_session_end/on_pre_compress/on_delegation`；**同时只允许 1 个外部 provider**（工具 schema 膨胀 + 后端冲突）。会话文本落 SQLite（FTS 可检索、恢复、导出）。
- 优点：文件即记忆（可 git/可读/可迁移）、快照语义与缓存纪律一致、provider 抽象干净、按 profile 隔离 cron/记忆/技能存储。
- 缺点：内置记忆是**人工提示记忆**（非向量 RAG，外部 provider 才做 embedding，且仅一个）；跨会话检索主要靠压缩摘要重申 + FTS，深度 RAG 需外挂。

## H10 Skills

- 实现位置：`skills/`（内置）+ `optional-skills/`（官方但默认不激活）+ 用户目录（`get_skills_dir`/HERMES_HOME）；索引与加载 `agent/skill_utils.py`、`agent/prompt_builder.py`（skills index/manifest 进 prompt）、`agent/skill_commands.py`（斜杠调用）、`agent/skill_preprocessing.py`（`${HERMES_*}` 模板 + 内联 `!`cmd`` shell 展开）；学习入口 `agent/learn_prompt.py`（`/learn`）、后台维护 `agent/curator.py`、可视化 `agent/learning_graph.py`/`learning_mutations.py`；CLI `hermes skills`。
- 核心机制：SKILL.md frontmatter（`name/description(≤60 字符)/platforms OS 门控/metadata.hermes.tags/category/related_skills/config`）；加载器把 description index 进系统提示，命中才注入正文；`/learn` 用"一个 prompt"把用户描述/代码目录/刚才做的事交给活体 agent 用现有工具收集素材、按 HARDLINE 作者规范经 `skill_manage` 产出技能（大文档转 lean SKILL.md + references/ 知识库布局）；`curator` 空闲期自动 pin/archive/consolidate/patch 技能（**只归档不删除、可恢复**，fork 辅助客户端不碰主会话 cache）；删除技能=归档，`hermes curator restore` 可救回。
- 优点：技能即 markdown+脚本、社区化目录、authoring 规范有自动化测试强制、curator 使技能库自维护。
- 缺点：SKILL.md 描述 ≤60 字符等硬规约束表达力；无蒸馏引擎（刻意），"经验转技能"由背景审查+`/learn` 提示工程实现而非自动模型（见 H12）。

## H11 Subagent

- 实现位置：`tools/delegate_tool.py` + 兄弟文件（`delegate_tool_child_run/dispatch/progress/config/toolsets/registry`…）、`tools/async_delegation.py`、`agent/delegation_context.py`、`agent/subagent_lifecycle.py`（对插件的不可变生命周期 API：SubagentLaunchRequest/Handle/State/Result/Cancel/Reconnect）、`agent/periodic_scheduler.py`、`tools/delegate_tool_registry.py`。
- 核心机制：`delegate_task` 派生**全新 AIAgent 子实例**：fresh conversation、自己的 task_id（终端会话/文件缓存隔离）、父工具集**剔除 child-blocked 工具**、由 goal+context 构建的聚焦系统提示、单任务与 batch(并行) 两种模式；顶层 model 调用后台跑、orchestrator 子等待 worker；父只看到委托调用与摘要结果，**看不到子中间 tool 调用/推理**；有 max spawn depth、max concurrent children、子超时、心跳、worktree isolation 配置、子结果 schema 校验；`subagent_lifecycle` 给插件与 core 解耦的可续/取消句柄（非裸 AIAgent）。
- 优点：隔离清晰（会话/任务/工具/提示 4 层）；父-子信息隐藏设计佳；batch/并行/异步委托一应俱全；插件 API 化后不泄漏内部对象。
- 缺点：同进程线程模型（~130 子进程内委托依赖统一调度与租约），进程级故障隔离有限（未获取到跨进程 subagent 独立部署形态，除 cron/delegate 的独立任务进程）。

## H12 Evaluator

- 实现位置：记忆/技能评审 `agent/background_review.py`（每轮后 fork 一个 AIAgent 重放快照自问"该保存/更新哪些 skill 或 memory"，写直达记忆+技能库，**不碰主会话与 cache**，dispatch 侧工具白名单）；人工 `/review` `agent/review_engine.py`（spawn 独立全权限后台子代理，同 async-delegation rail，结果以异步委托完成态回到母会话）；验证闸 `agent/verify\runner.py`（bootstrap→build→test→start→readiness→teardown，项目自带 recipe）+ `agent/verify_hooks.py`（`pre_verify` 轮末闸、`CODING_VERIFY_GUIDANCE`、默认 ≤3 次 nudge、证据驱动 verification-stop）；自评 harness `evals/`（compaction/readtool/core_tool_deferral/session_search_schema/browser_use 等 runner+报告+SCORECARD）。
- 核心机制：Hermes 无单一"裁判"模型模块——评估职责分布为 ①后台自动 skill/memory 评审（learning loop 的判定器）、②`/review`/delegate 的全权限后台评审子代理、③verify 配方对编码产物的证据闸、④`evals/` 离线自评。评审 fork 继承父运行时（provider/model/凭据/缓存系统提示）故命中同一 prefix cache。
- 优点：评审异步且不污染主对话；"经验转技能"闭环 = background_review(判定) → skill_manage/curator(落地)，天然无感；evals 仓库化有可复现分数。
- 缺点：评审是"LLM 自我判定"（无独立强化/真值信号）；`/review` 子代理全权限意味着依赖其提示隔离；未获取到对评审质量本身的度量/校准。

## 行为要点提取（供 Behavior IR）

1. 系统提示每会话构建一次、三层（stable/context/volatile）拼接，仅压缩触发重建，跨轮复用保 prefix cache。
2. 会话内改系统提示状态（skills/tools/memory）默认**延后到下一会话**生效，`--now` 才立即。
3. 自动压缩=aux 模型摘要中间轮、头尾保护、先修剪 tool 输出，摘要里重申 MEMORY.md/USER.md 权威并禁止重做已述工作。
4. 记忆 = 磁盘 MEMORY.md(agent)+USER.md(用户) 文件，会话开始冻结进提示，中途写盘不改当前提示。
5. 会话文本落 SQLite（FTS 可搜索/恢复），跨进程有 durable turn lease + 看门狗防双写。
6. 单 `memory` 工具 + 可插拔 MemoryProvider（同时仅一个外部 provider），记忆 hook 含 on_pre_compress/on_delegation。
7. 每轮后后台 fork 评审"该存什么"，写直达记忆/技能库，主会话与 cache 零扰动。
8. `/learn` = 活体 agent 用自身工具收集素材、按作者规范经 skill_manage 一次产出可复用技能。
9. curator 空闲自动 pin/archive/consolidate 技能，只归档不删除、可恢复，且不碰主会话 cache。
10. delegate_task 派生全新子 AIAgent：fresh conversation + 自有 task_id + 父工具集剔除 child-blocked + 聚焦提示，父只见摘要不见中间过程。
11. 工具经统一 registry 注册，核心工具每轮全量随请求发送，能力默认放 CLI+skill/插件/MCP 而非核心工具。
12. 危险命令三级降级审批（floor allowlist → guardian LLM → 人工），会话 yolo、denial breaker、跨界面统一 gate。
13. execute_code = 程序化工具调用（PTC），LLM 写脚本调已授权工具、仅 stdout 回流；远程 docker/modal/ssh 后端提供真隔离，本地靠审批+env 清洗。
14. 核心工具窄腰 + prompt cache 纪律两条铁律支配多数设计取舍（新增核心工具为最后手段）。

## 参考来源

- https://github.com/NousResearch/hermes-agent（根 README / AGENTS.md）
- 仓库内（commit `d20a8e4`）：`AGENTS.md`；`plugins/AGENTS.md`；`skills/AGENTS.md`；`agent/{conversation_loop,system_prompt,prompt_builder,context_engine,context_compressor,micro_compaction,native_compaction,compression_facade,memory_manager,memory_provider,curator,learn_prompt,learning_graph,learning_mutations,background_review,review_engine,subagent_lifecycle,delegation_context,session_persistence,tool_executor,verify_hooks}.py`；`agent/verify/runner.py`；`tools/{registry,toolsets,delegate_tool,memory_tool,memory_tool_store,code_execution_tool,code_execution_env,approval}.py`（及 approval_* 家族）；`cron/{jobs,scheduler}.py`；`plugins/plugin_loader.py`；`hermes_cli/plugins.py`；`tools/environments/*`；`docs/security/network-egress-isolation.md`；`evals/`。
