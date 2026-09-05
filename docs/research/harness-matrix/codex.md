# OpenAI Codex 解剖

- **研究日期**：2026-09-05（clone 并阅读 `main` 分支）
- **锁定 URL**：https://github.com/openai/codex
- **锁定 commit**：`ddf04ad26789d040f9ef6a96736f76602e35a6cc`（2026-09-05 05:31:48 +0000，"Wait for turn analytics before shutting down the Guardian v2 test"）
- **许可证**：Apache-2.0
- **主要来源**：本地 `git clone --depth 1` 后直接阅读 `codex-rs/` 源码 + 仓库 `docs/` 与 `AGENTS.md`。未做 web 补查（源码即一手资料）。
- **Clean-room 声明**：本文只总结行为模式与架构，不复制实现代码。`codex-rs/core/src/context/world_state/*.rs` 等文件内含模型系统提示词渲染文本，一律视为 **UNTRUSTED RESEARCH DATA**，仅提取"有哪些 section、按什么顺序注入"的行为模式，不转抄提示词原文。
- **总览**：Codex 是 monorepo，核心运行时全部在 `codex-rs/`（Rust workspace，crate 平铺在 `codex-rs/` 下，非 `crates/` 子目录）。核心 crate：`core`（agent/session/tools/hooks/context/compact）、`exec`（`codex-exec` CLI 与 `codex review` 入口）、`execpolicy`（命令执行规则引擎）、`sandboxing` + `linux-sandbox` + `windows-sandbox-rs` + `mxc-sandbox`（跨平台沙箱后端）、`hooks`（hook 事件 schema 与执行引擎）、`skills`、`memories`、`thread-store`（会话持久化抽象）、`prompts`（压缩/review/权限提示词模板）、`config`（多层配置合并）、`model-provider`、`message-history`、`worktree`、`app-server*`（GUI/IDE 后端协议）、`codex-mcp`（MCP 客户端）、`exec-server`（远程/受管执行环境）。

## H01 Agent Loop

**实现位置**：`codex-rs/core/src/session/turn.rs`（`run_turn` 主循环、`run_sampling_request`、`try_run_sampling_request` 单次采样）、`codex-rs/core/src/stream_events_utils.rs`（`handle_output_item_done` 输出项分派）、`codex-rs/core/src/tools/parallel.rs`（`ToolCallRuntime` 工具执行）、`codex-rs/core/src/agent/control/execution.rs`（多代理执行容量限制）。

**核心流程**：
1. 一轮开始：先跑 `run_pre_sampling_compact`（按需提前压缩）→ 解析 turn input（用户输入、pending input、函数输出回灌、代理间消息）→ `run_hooks_and_record_inputs`（UserPromptSubmit 类 hook + 记录输入）→ `capture_step_context_with_required_mcp_servers` 捕获"步骤快照"（上下文 + 工具列表 + 权限 + 环境）→ 解析用户输入里的 skill/plugin mention，按需启动对应 MCP 服务器 → `build_skills_and_plugins` 注入 → 跑 SessionStart hooks。
2. 采样循环：`loop` 内每次迭代取 `clone_history().for_prompt(modalities)` 构建模型输入 → `run_sampling_request` 发起流式请求 → 事件循环处理 `OutputItemAdded/OutputItemDone`：模型输出工具调用时 `ToolRouter::build_tool_call` 解析成 `ToolCall`，立即持久化该 item 并把执行 future 推入 `FuturesOrdered`（并行执行）；输出纯 assistant 消息时记为 turn item 完成。
3. 工具结果回灌：每个工具 future 产出 `ResponseItemEnvelope`（FunctionCallOutput），写入会话历史，使下一轮采样自动携带结果；`needs_follow_up = true` 继续循环。
4. Stop 条件：无 pending input、模型无 follow-up 需求时跑 `run_turn_stop_hooks`（Stop hook 可 block 并注入 continuation prompt 继续、可 stop 终止），随后跑 legacy AfterAgent hook 并 `break`。错误分支：`TurnAborted` 直接返回；`InvalidImageRequest` 给用户提示后终止；其余错误发 ErrorEvent 后 break 让用户继续。
5. 最大轮次：**没有显式 max turns 计数器**；通过 token 水位（`context_window_token_status`）+ 自动压缩形成"滚动窗口"防止无限循环（代码注释明确"只要压缩能把 token 压下去就不担心死循环"）。另有 rollout budget（预算提醒注入）与 turn timing 记录。
6. Retry/Error Recovery：`run_sampling_request` 内循环按 `provider.info().stream_max_retries()` 重试流错误（`handle_retryable_response_stream_error`，指数退避 `backoff(retries)`，连接级重试单独计数并翻倍延迟）；`ContextWindowExceeded` 置满标志转压缩路径；`UsageLimitReached` 记录 rate limits；压缩请求自身也有重试与"压缩中再超窗则从开头丢历史项"的降级。

**关键机制**：响应流事件模型（`ResponseEvent` 与 `codex_protocol`）；单次采样内工具 future 通过 `tokio::select!` 与取消令牌协作（`AbortOnDropHandle`，取消时若未到终态产出"aborted"输出）；`ToolCallRuntime` 内并行门：支持并行的工具取 `RwLock` 读锁并发执行，不支持的取写锁串行化。

**优点**：单线程模型简单（一个采样请求 = 一个响应流），工具执行与文本流统一处理；取消/中止语义贯穿全程（CancellationToken 子令牌链）；错误路径都有明确出口且不中断会话；重试状态机清晰。
**缺点**：无硬性轮次上限，极端场景依赖压缩与预算兜底；`run_turn` 单文件 2881 行，分支极多（hook、压缩、MCP 启动、realtime、guardian 交错）可读性差；并行工具仅靠一把 `RwLock` 全局门控，细粒度并行策略有限。

## H02 System Prompt

**实现位置**：`codex-rs/core/src/session/world_state.rs`（`build_world_state_for_step` 组装各 section）、`codex-rs/core/src/context/base_instructions.rs`、`context/developer_instructions.rs`、`context/user_instructions.rs`、`context/world_state/*.rs`（每个 section 一个文件：ModelInstructions、Personality、TokenBudgetContext、ContextWindowGuidance、Realtime、AgentsMd、Permissions、CompactPermissions、CollaborationMode、PersistentMode、Environments、AppsInstructions、PluginsInstructions、Tools、MultiAgentUsageHint、MultiAgentMode、ManagedDeveloperInstructions 等）、`codex-rs/core/src/agents_md.rs`（AGENTS.md 发现与合并）、`prompts` crate（压缩/审查/权限提示词模板）。

**核心流程 / 注入顺序**（Base → Model-specific → 项目 → 动态）：
1. Base：模型目录中的 base instructions（`model_info().get_model_instructions(personality)`），可被配置 `base_instructions` 覆盖（记录 provenance，模型切换时注入 ModelSwitchInstructions）；`Prompt { input: history, base_instructions }` 作为独立 developer 消息置于最前。
2. Model-specific：personality（若模型支持）、reasoning effort、model mismatch 警告、服务层（service tier）。
3. Project：AGENTS.md 从项目根（`project_root_markers`，默认 `.git`）到 cwd 逐级收集并拼接（`AGENTS.override.md` 作为本地覆盖），多文档用 `--- project-doc ---` 分隔；以 `AgentsMdState` section 注入。
4. 动态：当前时间提醒（`current_time_reminder`）、token 预算提醒、rollout 预算提醒、环境清单（Environments）、已批准命令前缀提示、网络规则已保存提示、hook additional context、压缩摘要、guardian 审查证据等，均以 world_state section 或 contextual fragment 形式插入。
5. 注入顺序：world_state 渲染成完整 section 列表追加/合并进上下文（`build_initial_context_with_world_state`），作为 reference context item 持久化；后续步骤只渲染 diff（`render_diff`）。

**关键机制**：world_state 快照 + 基线（baseline）机制——完整注入一次后持久化为基线，每步只注入增量 diff，减少重复 token；BaseInstructionsProvenance 区分"模型自带 vs 用户自定义"。

**优点**：模块化 section 化，每个上下文片段独立文件、独立测试；provenance 追踪避免配置污染模型默认提示；diff 注入省 token。
**缺点**：section 数量膨胀（30+），相互间交互复杂；部分提示注入逻辑与 feature flag 纠缠（`without_update_plan_instructions` 等条件改写）；人格/实时模式等多套提示共存时顺序语义较隐晦。

## H03 Context Engine

**实现位置**：`codex-rs/core/src/session/session.rs`（`record_context_updates_and_set_reference_context_item`、`record_step_world_state_if_changed`）、`session/world_state.rs`、`session/step_context.rs`、`session/context_window.rs` + `session/token_budget.rs`（token 水位）、`context_manager/history.rs`（`codex-history` 的 core 侧适配）、`context/contextual_user_message.rs`（用户消息预处理）、`context/hook_additional_context.rs`（hook 附加上下文）、`context/image_resize_notice.rs` + `context/unsupported_media.rs`（图片预算）、`agents_md.rs`（项目文档）。

**核心流程 / 加载顺序**：每步（step）捕获 `StepContext`：①用户输入经 hook 检查与预处理 → ②按输入中的 mention 解析所需 MCP 服务器并启动 → ③构建世界状态（模型指令/权限/工具列表/AGENTS.md/环境等 section）→ ④组装模型输入 `clone_history().for_prompt(input_modalities)`（按输入模态过滤图像等）→ ⑤采样后更新 world state 基线并持久化 diff。

**关键机制**：
- Token Budget：`context_window_token_status` 区分 active_context_tokens / auto_compact_scope_tokens / full_context_window_limit；`TokenBudgetContext` section 告知模型预算；达到限值触发 auto-compact 或 roll over 新窗口。
- Trimming：模型 `truncation_policy` 应用于记录 history；压缩时若再超窗则 `remove_first_item`（从头删，保住前缀缓存）。
- 污染防护：工具输出含外部上下文（`contains_external_context`）且配置 `memories.disable_on_external_context` 时，`state_db::mark_thread_memory_mode_polluted` 禁掉该线程的记忆模式；图片超限降级/重缩放并注入 notice；不支持的媒体类型注入提示。
- Skills/Plugins 动态注入由用户输入 mention 决定（`build_skills_and_plugins`），非全量加载。

**优点**：world state 基线 + diff 是高效的 token 管理手段；模态过滤（images 按模型能力）；MCP 按需启动不浪费资源；污染标记机制防止记忆被外部内容毒化。
**缺点**：token 估算依赖模型元数据（`resolved_context_window`），对第三方模型可能不准确；无显式 RAG（检索靠 tool_search/exec 工具，无内建向量库）；Files 进上下文没有"读取即注入"的统一抽象，主要靠用户 mention 与工具输出。

## H04 Compaction

**实现位置**：`codex-rs/core/src/compact.rs`（本地总结压缩）、`compact_remote.rs` / `compact_remote_v2.rs` / `compact_remote_v2_images.rs`（服务端压缩 v1/v2 + 图像预算）、`compact_token_budget.rs`（token-budget 模式：不总结直接开新窗口）、`compact_model_fallback.rs`、`compact_remote_request.rs`、`context/compaction_summary.rs`、`state/auto_compact_window.rs`、`tasks/compact.rs`、`prompts/src/compact.rs`（总结提示词）。

**触发时机**：采样前预压缩（`run_pre_sampling_compact`，考虑 pending 输入会推高 token 时提前触发）；采样后 `should_roll_over`（有 follow-up 且 token 达限/显式新窗口请求）→ `run_auto_compact`（MidTurn）；手动 `/compact`；token-budget 配置下走"免总结开新窗口"路径。

**核心流程 / 压缩什么 / 保留什么**：把当前 history 交给模型（本地或远端）生成摘要（`SUMMARY_PREFIX` + 最后一条 assistant 消息后缀）；`collect_annotated_user_messages` 保留**所有用户消息**（带身份信息），压缩掉 assistant 消息与 tool call/result 明细；`build_compacted_history` 重建为"摘要 + 用户消息序列"；`build_compaction_initial_context` 重注入世界状态；推进 auto-compact 窗口号（`advance_auto_compact_window`，用于 token 预算记账与缓存定位）。
- Tool Call/Result 完整性：**不保留**完整调用链，只由摘要概括；用户消息原文保留。
- 是否新 Session：**不是**；同一会话内开新"上下文窗口"，thread 不变。
- 状态恢复：world state baseline 在压缩后重建（`Compacted` rollout item 会清掉旧基线再重放）；reference context item 指向新基线。
- Hooks：PreCompact / PostCompact 全程可拦截/追加上下文；token-budget 压缩也走同一 hook 生命周期（`run_compact_task_inner` 统一）。

**关键机制**：压缩请求自身复用 `stream_max_retries` 与退避；压缩中若上下文仍超窗，从历史头部删项重试（保住前缀缓存）；`CompactedMessageIdentity::Preserve/Regenerate` 控制用户消息身份保留策略（guardian 线程上下文 feature 切换）。

**优点**：保留用户消息保证指令不丢；多后端（本地/远端 v2）+ 免总结模式分层降级；与窗口号/缓存机制联动。
**缺点**：工具执行细节必然丢失（长链路行为靠摘要维持，可能失真）；压缩是额外模型调用（成本+延迟）；远端 v2 依赖 OpenAI 后端能力，自托管 provider 只能走本地路径。

## H05 Tool System

**实现位置**：`codex-rs/core/src/tools/registry.rs`（ToolRegistry）、`tools/router.rs`（ToolRouter、build_tool_call）、`tools/parallel.rs`（ToolCallRuntime）、`tools/orchestrator.rs`（approval+sandbox 编排）、`tools/sandboxing.rs`（Approvable/Sandboxable trait）、`tools/handlers/*`（各工具 handler）、`tools/lifecycle.rs`（扩展生命周期通知）、`tools/context.rs`（ToolInvocation/ToolOutput）、`codex-rs/codex-tools`（ToolSpec/ToolExecutor/ToolExposure trait 定义）。

**工具清单**（按 handler 文件）：`apply_patch`（统一补丁应用）、`exec_command` + `write_stdin`（unified_exec 进程工具）、`shell_command`（遗留 shell 工具）、`view_image`、`update_plan`（计划模式）、`tool_search`（动态工具发现）、`request_user_input`（向用户提问）、`wait_for_environment`、`send_message_to_user_async`、`get_context_remaining`、`request_permissions`、`request_plugin_install` / `list_available_plugins_to_install`、`list_mcp_resources` / `read_mcp_resource` / `list_mcp_resource_templates`、`test_sync_tool`（扩展测试同步）、multi-agent v1（spawn_agent/resume_agent/send_input/wait/close_agent）与 v2（spawn_agent/list_agents/send_message/wait_agent/interrupt_agent/followup_task）、`extension_echo` 等扩展工具（codex-extension-api 动态注册）、web_search（服务端 WebSearch 动作，`core/src/web_search.rs`）、MCP 工具（`session/mcp.rs`、`mcp_tool_call.rs`、`codex-rs/codex-mcp` crate）。

**Schema / Registry / Dispatch**：
- Schema：`ToolSpec`（name/schema JSON/description）、MCP 工具 schema 来自服务器、`ToolName`（namespace+name，默认命名空间）；`ToolExposure`（Normal/Confidential/Hidden）控制可见性。
- Registry：`ToolRegistry` 用 `IndexMap<ToolName, RegisteredTool>`；`register_trusted`（内置，重名直接 panic 提示）vs `register_external`（插件/扩展注册，`exec_command`/`shell_command` 为保留名拒绝外部覆盖，重复注册记录 `first_collision` 不 panic）；`prepend_trusted` 控制优先级。
- Dispatch：`ToolRouter::build_tool_call(ResponseItem)` 把 FunctionCall/ToolSearchCall/CustomToolCall 解析为 `ToolCall` → `ToolCallRuntime.handle_tool_call` → 并行门 → `router.dispatch_tool_call_*` → `registry.dispatch_any_with_terminal_outcome`：pre_tool_use hooks → handler 执行（`handle_any_tool`）→ post_tool_use hooks → 生命周期通知（扩展）→ 结果转 `ResponseItemEnvelope`。
- Result/Error：`ToolOutput` trait 统一 `to_response_item/log_output/success_for_logging`；`FunctionCallError` 分 `RespondToModel`（错误作为文本回灌模型，继续对话）与 `Fatal`（终止）。
- 动态注册：插件（plugin/extension）经 `register_external` 动态加工具；MCP 工具每步从 `mcp.tools()` 快照注入；`tool_search` 运行时发现可安装工具。
- MCP：`McpBinding`/`McpRuntime`（session/mcp_runtime.rs）管理服务器生命周期，按 turn mention 需求启动（`required_mcp_servers_for_input`），支持 prewarm/refresh/连接器；工具调用经 `McpToolCall` 转发并做参数加密（encrypted_function_args）/审批模板（mcp_tool_approval_templates.rs）。

**优点**：registry 分层（trusted vs external）与保留名机制稳健；统一 dispatch 管线让 hooks/审批/沙箱/遥测对所有工具一致生效；并行执行门控简单有效；tool_search 提供运行时发现。
**缺点**：内置工具偏少（无独立 glob/grep/read/write 文件工具——文件读写靠 exec_command/apply_patch），与"文件工具化"的 Harness 理念不同；`dispatch_any_with_terminal_outcome` 全走统一管线，性能敏感的读工具也被钩子/遥测包裹；扩展工具与内置工具能力不对等（部分 lifecycle 通知只对扩展生效）。

## H06 Hooks / Middleware / Events

**实现位置**：`codex-rs/hooks` crate（schema/事件类型/执行引擎：`registry.rs`、`engine/*`、`command_runner.rs`、`mcp_runner.rs`、`output_parser.rs`、`discovery.rs`）、`codex-rs/core/src/hook_runtime.rs`（core 侧接线）、`core/src/hook_mcp_executor.rs`、`core/src/tools/hook_names.rs`、`config/src/hook_config.rs`（hooks 配置 schema）、`hooks/config_rules.rs`。

**事件清单（12 个）**：`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PreCompact`、`PostCompact`、`SessionStart`、`SessionEnd`、`UserPromptSubmit`、`SubagentStart`、`SubagentStop`、`Stop`、`Interrupt`；其中 9 个带 matcher（PreToolUse/PermissionRequest/PostToolUse/PreCompact/PostCompact/SessionStart/SessionEnd/SubagentStart/SubagentStop）；另有 legacy `AfterAgent`。
- 与 Claude Code 概念映射：PreToolUse/PostToolUse 同构；BeforeModel ≈ `UserPromptSubmit`（近似，发生在采样前）；AfterModel ≈ legacy `AfterAgent`；Stop/SubagentStop 同名；BeforeCompact/AfterCompact ≈ PreCompact/PostCompact；无 SubagentStart 之外的 Task 生命周期事件。

**核心流程 / 语义**：
- PreToolUse：匹配工具名/命令前缀，可 Blocked（错误文本回灌模型）、Continue 携带 updated_input（改写工具入参，`with_updated_hook_input` 重建 invocation）。
- PermissionRequest：在审批弹窗前决策（Allow/Deny 等），可让第三方策略直接放行/拦截。
- PostToolUse：可 block（拒绝结果，但工具已执行——"PostToolUse 拒绝的是结果不是执行"）、可改模型可见输出（feedback message 替换）、可注入 additional context。
- Stop：should_stop 终止 turn；should_block + continuation_fragments 生成提示注入历史并继续循环（stop_hook_active 防重入）。
- SessionStart：source 匹配（新会话/恢复/子代理），可阻止 turn 启动；SessionEnd 按结束原因触发。
- Pre/PostCompact：压缩前后介入；PostCompact 可追加上下文。
- 执行机制：Command hooks（子进程，JSON 协议 stdin/stdout）+ MCP hooks（经 MCP 服务器调用）；同步/异步两种执行模式（`HookExecutionMode`），异步结果在安全边界 drain（`drain_async_hook_results`：turn 前/采样后）；matcher 组 + hook state（enabled/trusted_hash，hooks 文件可声明状态）。
- 配置：hooks.json / config.toml 中 hooks 表；`HookEventName` 持久化键；schema 有 fixture 测试。

**优点**：事件面完整（含 PermissionRequest、Interrupt 这些安全关键点）；同步/异步、command/MCP 双执行后端；matcher 体系支持工具别名；input 改写与 output 改写能力是 Claude Code 没有的增强。
**缺点**：无 BeforeModel/AfterModel 精确等价物（模型请求构造阶段不可钩）；异步 hook 的时序边界复杂（只能在 turn 边界 drain）；事件数量多导致配置心智负担。

## H07 Permission / Safety

**实现位置**：`codex-rs/core/src/exec_policy.rs`（审批要求判定 + 危险命令清单）、`codex-rs/execpolicy` crate（规则引擎：`policy.rs`、`rule.rs`、`decision.rs`、`parser.rs`、`execpolicycheck` CLI）、`tools/orchestrator.rs`（approval→sandbox→retry 编排）、`tools/sandboxing.rs`（ApprovalStore、ExecApprovalRequirement、with_cached_approval）、`tools/network_approval.rs`、`core/src/config/permissions.rs` + `permission_profile_catalog.rs` + `resolved_permission_profile.rs`、`core/src/guardian/*`（Guardian 审查）、`core/src/safety.rs`、`config/src/requirements_exec_policy.rs`。

**核心流程**：
1. 审批策略 `AskForApproval`：Always / OnRequest / Never / Granular（细粒度开关，如 sandbox_approval、rules）。
2. `ToolOrchestrator.run` 序列：①算 `ExecApprovalRequirement`（Skip / NeedsApproval / Forbidden）→ ②按策略请求审批（`session.request_approval`，经 Guardian 审查或用户 UI）→ ③选择沙箱并执行首attempt → ④若沙箱拒绝且工具允许升级（`escalate_on_failure`），在满足条件时二次审批（带 retry_reason）后以更宽松沙箱重试；审批缓存（ApprovalStore，ApprovedForSession 按 key 序列化缓存）避免重复询问。
3. 规则引擎 execpolicy：`.rules` 文件（`allow`/`prompt`/`forbidden` 规则，命令前缀匹配 + 网络规则 `NetworkRuleProtocol`），`Decision::Allow/Prompt/Forbidden`；命令先过规则 → 再查危险命令清单（`codex-shell-command::is_dangerous_command`，覆盖 bash/python/pwsh/git 等大量危险前缀，含 `BANNED_PREFIX_SUGGESTIONS`）→ 最后沙箱兜底。用户批准后可追加 `allow` 前缀规则（proposed_execpolicy_amendment）。
4. 权限配置文件：PermissionProfile（filesystem sandbox + network sandbox + approvals + exec policy 指针），内置 read_only / workspace_write / danger_full_access 三个 profile + 自定义 profile 目录；按 workspace root 展开（`permission_profile_with_workspace_roots`）。
5. Guardian：对 on-request 审批做模型审查（判断该操作是否应放行，`guardian/review.rs`），strict_auto_review 模式下即使策略 Skip 也强制走审查。

**Behavior Safety vs Runtime Safety 区分**：
- Behavior Safety（模型行为约束）：tool spec 中的指令文本（如 shell_spec.rs 里的操作守则）、权限提示词（`prompts/src/permissions_instructions.rs`）、Guardian 策略提示——这些只约束模型"应当怎么做"，无强制力，属提示层。
- Runtime Safety（强制机制）：execpolicy 规则引擎（决策在 Rust 侧强制执行）、沙箱（见 H08）、审批门（模型无法绕过）、危险命令前缀拦截（硬编码列表）、网络策略决策——这些在运行时强制。
- Hook 属于策略扩展点：PermissionRequest 等 hook 可在两层之间插入外部策略。

**优点**：多层纵深（规则→清单→审批→沙箱）；审批可缓存、可带 retry 理由二次询问；Guardian 让"自动审批"也有模型审查兜底；跨平台同一抽象。
**缺点**：审批流状态多（策略×权限×沙箱×网络×guardian 排列组合），测试量大、行为难预测；危险命令清单维护成本高且易漏（本质是黑名单）；`AskForApproval::Never` 下 Forbidden 与 NeedsApproval 冲突时直接拒绝，体验偏硬。

## H08 Sandbox

**实现位置**：
- 策略层：`codex-rs/sandboxing` crate（`manager.rs` SandboxManager/SandboxType、`policy_transforms.rs`、`violation.rs`、`spawn.rs`、`bwrap.rs`、`landlock.rs`（legacy）、`seatbelt.rs`、`windows.rs`）、`codex-rs/core/src/sandboxing/mod.rs`（ExecRequest 适配）、`core/src/tools/sandboxing.rs`。
- Linux 后端：`codex-rs/linux-sandbox`（bubblewrap + seccomp 可执行文件，支持 `--argv0` 内重执行，可嵌入 `codex-exec` 多工具二进制）。
- Windows 后端：`codex-rs/windows-sandbox-rs`（受限令牌 + WFP 网络过滤 + ACL/deny-read + 私有桌面 + 服务端提升后端）、`windows-sandbox-service`、`mxc-sandbox`（AppContainer/MXC 原生进程安全环境）、`core/src/windows_sandbox.rs` + `windows_sandbox_read_grants.rs`。
- 网络：`codex-rs/network-proxy`（ManagedNetworkProxy）、`core/src/network_policy_decision.rs`。
- 执行环境：`codex-rs/exec-server`（受管/远程 executor，`fs_sandbox.rs`、`process_sandbox.rs`、`environment.rs`）。

**SandboxType**：`None` / `MacosSeatbelt` / `WindowsRestrictedToken` / Linux（bubblewrap 主路径，legacy Landlock 显式回退）。`SandboxablePreference`（Always/Prefer/None）与 `should_sandbox`/`select_initial` 决定是否启用及初选后端。

**各平台机制**：
- Linux（bubblewrap）：优先系统 `bwrap`，缺失用捆绑二进制；`--ro-bind / /` 默认只读文件系统，可写根用 `--bind` 覆盖，可写根下的受保护子路径（`.git`、解析后的 `gitdir:`、`.codex`）再以 `--ro-bind` 强制只读；split-policy 按路径特异性排序应用（窄子路径可重开父级只读/拒绝，拒绝优先）；进程内 `PR_SET_NO_NEW_PRIVS` + seccomp 网络过滤；user namespace 失败时启动告警；WSL1 拒绝（无法建 user namespace），WSL2 走正常路径。legacy Landlock fallback 仅在 split policy 与旧模型沙箱等价时才启用。
- macOS：Seatbelt（sandbox-exec）profile（`seatbelt_base_policy.sbpl` / 网络策略 / 只读平台默认），`CODEX_SANDBOX_ENV_VAR=seatbelt` 注入。
- Windows：受限令牌 + Job 对象；WFP（Windows Filtering Platform）做网络过滤；ACL 拒绝读（deny_read_resolver/walker 防路径遍历泄密）；`no_reparse_dir` 防止 reparse point 逃逸；私有桌面隔离 UI；`windows_sandbox_level` 分级（含 elevated backend 服务，经 framed_io 协议与特权服务通信）；MXC 原生进程安全环境作为更新后端探测。
- 网络沙箱：managed network proxy（MITM CA 只读注入）+ 网络策略决策（`network_policy_decision.rs`）；`CODEX_SANDBOX_NETWORK_DISABLED_ENV_VAR` 标记禁用；approval 期间网络拒绝令牌（`network_denial_cancellation_token`）。
- Executor 管理沙箱：远程/受管环境（exec-server）里 `FileSystemSandboxContext` 实现文件系统边界，本地进程走本地沙箱后端。

**path/symlink escape 防护**：workspace roots 显式建模（`workspace_roots()`）；macOS 允许的 codex home symlink 白名单；Windows 路径规范化 + reparse 拒绝 + deny-read 遍历器；violation 记录（`FileSystemSandboxViolation`/`NetworkSandboxViolation`）并做 denial 判定（`is_likely_sandbox_denied`）供升级重试决策。

**优点**：三平台都有真实强隔离（不只是 chdir+环境变量）；bubblewrap 只读根 + 受保护子路径模式是文件沙箱的典范实现；violation 识别驱动自动升级重试闭环；Windows 侧投入深（ACL/WFP/私有桌面/服务端提升）。
**缺点**：Windows 沙箱复杂度极高（token/ACL/WFP/服务三套叠加，还有 elevated 服务依赖）；Linux 依赖 bubblewrap 与 user namespace（受限 CI 环境会退化）；legacy Landlock 与 bubblewrap 双路径维护成本；沙箱选择逻辑与审批/网络策略耦合深，难单独复用。

## H09 Session / Memory

**实现位置**：`codex-rs/thread-store`（ThreadStore trait：create/read/update/archive/delete/search/fork/revert/resume + projects/sections/queue；`local.rs` LocalThreadStore 落地 rollout JSONL + sqlite 元数据；`in_memory.rs` 测试实现）、`codex-rs/core/src/session/session.rs`（Session 结构，session_id == root thread ID）、`session/thread_settings.rs`、`state` crate（`state_db` SQLite：graph/log/thread_metadata/memories）、`codex-rs/memories`（read/write 两个子 crate）+ `core/src/memories/*`（Phase1 rollout 抽取、Phase2 consolidation/workspace）、`state_db_bridge.rs`、`history` crate（rollout 格式）。

**四类记忆的对应**：
- Conversation/Thread：rollout JSONL（`~/.codex/sessions/threads/...`，SessionMeta + ResponseItem + TurnContext + WorldState 等行）+ sqlite 元数据（thread_metadata、项目、section、搜索索引）。`ThreadHistoryMode::Legacy/Paginated` 两种读取模式。
- Session：Codex 中 session 不是独立实体——**session_id 等于根线程 ID**；子代理是新的 thread（`SessionSource::SubAgent`），共享根 session 的 AgentControl/registry。
- Project：`StoredProject`（多项目组织线程）、section（线程分区）、queue store（`~/.codex/queue.jsonl` 待处理输入）。
- Long-term Memory：memories 管道（见下）。

**核心流程**：启动时 `resume_thread_with_history` / `InitialHistory::{New,Resumed,Forked}`；`Session::new` 初始化 thread 持久化（thread_persistence 与 state_db、auth 并行 join）；每轮 `PersistContext::{Standard,TurnStart}` 落盘。Fork：`PrepareForkParams`/`PreparedFork`，支持 FullHistory / LastNTurns 两种继承模式；RevertThread 回滚；rollout 迁移（Legacy→Paginated）；rollout lineage 追踪（`rollout_lineage.rs`）。

**Memory 管道**（core/src/memories + memories crate）：根会话启动且满足（非 ephemeral、feature 开启、非子代理、state DB 可用）时后台异步执行：Phase1 从 state DB 认领最近可归档 rollout（会话来源/年龄窗口/空闲时间/认领上限），过滤出 memory-relevant item，并行送模型抽取 `raw_memory` + `rollout_summary`；Phase2 做合并巩固（consolidation）与 workspace 差异整合，写入持久存储。Read 路径：memory developer-instruction 注入 + 引用（citation）解析 + 使用遥测。污染防护：外部上下文输出触发 `mark_thread_memory_mode_polluted`（见 H03）。

**优点**：thread 即 session 的模型简单一致；rollout JSONL + sqlite 双写可审计可迁移；记忆管道双阶段（抽取+巩固）且有明确的认领/并发/预算机制；fork/revert/lineage 齐全。
**缺点**：无跨 session 的"对话续传"实体（续传靠 resume thread，跨项目无全局记忆检索）；memory 依赖 OpenAI 后端状态库与 feature flag，自托管场景基本不可用；Windows/无 state DB 环境记忆完全退化。

## H10 Skills

**实现位置**：`codex-rs/skills` crate（`loading.rs` SkillRootLoader/LoadedSkills、`parser.rs` frontmatter 解析、`selection.rs` 显式 mention 查找、`invocation.rs` 隐式命令触发、`model.rs` SkillMetadata/SkillPolicy/SkillInterface/SkillDependencies、`mentions.rs` ToolMentionKind、`name_counts.rs`）、`codex-rs/core/src/skills.rs`、`core/src/plugins/skill_snapshot.rs`、`core/src/mcp_skill_dependencies.rs`、`core/src/context/world_state/`（skills 相关 section）、`core/src/session/turn.rs` 的 `build_skills_and_plugins`。

**发现/加载**：skill 根 = 目录（用户 `~/.codex/skills`、项目技能、系统内嵌技能）；`SkillRootLoader` 快照缓存；frontmatter 元数据解析（name/description/依赖/接口）；系统技能由 `install_system_skills` 把内嵌目录（`include_dir!`）安装到 `CODEX_HOME/skills/.system`，用指纹 marker 文件（`.codex-system-skills.marker`）跳过重复安装。
**作用域**：system（内嵌，随版本更新）/ user（CODEX_HOME）/ project（仓库内 skills 目录）；插件（plugin）可携带技能（`skill_snapshot`、`mcp_skill_dependencies` 处理 MCP 工具依赖）。
**选择/执行**：显式选择——用户输入 `@path` 或 sigil mention 触发技能注入（`collect_explicit_skill_mentions`），turn 开始 `build_skills_and_plugins` 只注入被提及的技能；隐式——`detect_implicit_skill_invocation_for_command` 按命令识别（如 `npm test` 可能触发测试技能），`ImplicitSkillAccess/Lookup` 提供候选但不强制；技能名计数（`build_skill_name_counts`）避免重名歧义。
**Interface/Policy**：`SkillInterface`（暴露给模型的结构化接口）+ `SkillInterfaceAssetPolicy`（资产策略）+ `SkillPolicy`（执行边界）；`SkillToolDependency` 声明技能需要的工具（如 MCP 服务器），turn 内按需启动。
**更新/冲突/provenance**：系统技能随版本重装（marker 指纹）；用户技能覆盖同名系统技能（发现优先级）；显式 mention 与插件技能冲突时按名称计数/命名空间消歧。

**优点**：mention 驱动的按需注入省 token；系统技能带指纹安装可升级；frontmatter + interface + 依赖声明结构完整；隐式触发提供"无感知技能"路径。
**缺点**：无技能市场/远程分发机制（与 Claude Code 的 skills 类似，靠文件分发）；隐式触发是启发式，命中率依赖命令解析质量；技能与插件体系绑定较深，独立复用需要额外抽象。

## H11 Subagent / Multi-Agent

**实现位置**：`codex-rs/core/src/agent/control.rs`（AgentControl：每根会话一个，注册表按根线程作用域）、`agent/control/spawn.rs`（spawn/resume/fork）、`agent/control/residency.rs`（V2Residency）、`agent/control/service_tier.rs`、`agent/control/user_authorization.rs`、`agent/registry.rs`（AgentRegistry、spawn depth）、`agent/role.rs`（角色：default + 自定义 role 配置）、`agent_communication.rs`（代理间通信/mailbox）、`session/multi_agents.rs`、`tools/handlers/multi_agents*.rs`（v1 与 v2 工具集）、`context/inter_agent_message.rs`、`context/subagent_notification.rs`、`thread_rollout_truncation.rs`。

**核心流程**：主代理调用 `spawn_agent` 工具 → `spawn_agent_internal` 校验 depth/容量 → `reserve_spawn_slot` → 按 `SpawnAgentForkMode::{FullHistory, LastNTurns}` 从父 rollout fork 出子 thread（v1 fork 模式 / v2 新会话模式）→ 子代理作为独立 Session 跑自己的 turn 循环 → 通过 `wait_agent` / `send_message` / `interrupt_agent` 交互 → 子代理完成后 `InterAgentCompletionMessage`/`SubagentNotification` 回灌父上下文 → 父代理继续。
- Context 隔离：子代理是独立 thread（独立 rollout/历史/世界状态），只继承 fork 的历史窗口；v2 用 `load_agent_model_context` 按需加载，不共享父上下文对象。
- 权限隔离：角色（role）只能**收窄**子代理能力（developer instructions、模型、reasoning、features、skills 覆盖），不可放大父会话权限（"Roles may customize the child or reduce its capabilities, but never replace the parent session's authority"）；远程 executor 上做权限交集（intersection）。
- 结果回主：wait 工具阻塞 + 完成消息注入；`SubagentStop` hook 拦截。
- 再生成/生命周期：`resume_agent_from_rollout` 崩溃/重启后恢复整棵代理树（BFS 队列）；AgentRegistry 按根线程作用域管理存活状态。
- 最大深度/并发：`exceeds_thread_spawn_depth_limit`（V1 `max_depth` 配置；V2 忽略深度限制改由并发/资源限制）；`agent_max_threads`（默认 6）、`max_concurrent_threads_per_session`（默认 4，V2）；`AgentExecutionLimiter` 原子计数限流 + `AgentLimitReached` 错误；spawn slot 预留。
- 通信：mailbox（input_queue 支持 InterAgentCommunication）、AgentCommunicationKind、消息可中止（interrupt 传播）。

**优点**：代理树有完整生命周期（spawn/fork/resume/reap）；v1/v2 两套语义并存便于迁移；角色权限单向收窄是安全设计要点；fork 历史窗口可选（FullHistory/LastNTurns）平衡上下文与隔离。
**缺点**：v1 与 v2 双实现并存导致维护面翻倍；无独立 Planner/Researcher 等预设角色分工（角色只是配置覆盖，无内置编排图）；并发上限偏保守（4-6 线程）限制大规模 fan-out；无 worktree 级并行隔离（任务共享同一文件系统，靠沙箱兜底）。

## H12 Evaluator / Verification

**实现位置**：`codex-rs/exec`（`codex review` 子命令入口，`cli.rs` ReviewArgs）、`codex-rs/core/src/tasks/review.rs`（ReviewTask：启动审查对话、处理审查事件、解析结构化 findings、退出审查模式写回历史）、`prompts/src/review_request.rs` + `prompts/templates/review/rubric.md`（审查 rubrik 提示词）、`codex-protocol/review_format.rs`（findings 渲染）、`codex-rs/core/src/session/turn.rs` 的 `ResponseEvent::ModelVerifications`（模型验证事件）、`tools/handlers/test_sync.rs`（`test_sync_tool`，扩展侧测试同步）。

**核心机制**：
- `codex review`：目标三态——uncommitted changes / base branch（自动找 merge-base，含备份提示词）/ commit（含标题）；以受限子代理会话运行（review-only feature 限制：禁用 web search、collab 工具、view_image），用 `review_model`（独立模型配置）按 rubrik 生成**结构化** findings（从最后一条消息解析 `ReviewOutputEvent`）；退出时把 findings 块与渲染文本写回对话历史，并持久化 rollout。
- ModelVerifications：模型流可带 verification 事件（`ResponseEvent::ModelVerifications` → `emit_model_verification` → 协议事件），即模型自声明完成验证（验证内容在协议层，非强制）。
- 无内置 evaluator 工具链：**没有**独立的 Tests/Lint/Typecheck/Build/Browser/Screenshot/Requirement 检查工具——Codex 的哲学是"测试/构建由模型用 exec_command 自己跑"，harness 不提供封装好的验证工具；`test_sync_tool` 是扩展插件的测试同步辅助，不是模型验证器。
- 安全类验证：Guardian 审查（对审批请求的模型判断，可视为行为安全验证器）；沙箱 violation 记录（运行时验证结果）。

**优点**：review 是完整的"评审子代理"模式（独立模型、受限工具、结构化输出、结果写回历史）值得借鉴；review-only 特性限制是安全隔离的好例子。
**缺点**：验证能力基本外包给模型自执行（无确定性测试栅栏，无法像 CI 一样断言"必须通过"）；ModelVerifications 是软事件无强制语义；无 screenshot/browser 验证集成（有 computer-use/browser 相关 crate 但非内置验证工具）。

## 行为要点提取（供 Behavior IR）

1. 每步（step）先捕获完整快照（上下文+工具列表+权限+环境），再构造模型请求，保证"广告的工具"与"执行的工具"来自同一视图。
2. 模型输出流中工具调用与文本统一处理：工具调用立即持久化并异步执行（FuturesOrdered），执行结果以 FunctionCallOutput 回写历史，由 needs_follow_up 驱动下一轮采样。
3. 并行工具执行用读写锁门控：支持并行的工具共享读锁并发跑，不支持的取写锁串行化，保证无副作用的读类调用可并行。
4. 一轮的终止由 Stop hook 裁决：可 stop 结束、可 block 并注入 continuation prompt 继续（防重入）；无硬性轮次上限，靠 token 水位 + 自动压缩滚动窗口兜底。
5. 工具执行管线统一为：pre_tool_use hooks（可改写入参）→ 审批判定（Skip/NeedsApproval/Forbidden）→ 沙箱选择 → 执行 → post_tool_use hooks（可拒绝结果或替换模型可见输出）。
6. 审批决策按可序列化 key 做会话级缓存（ApprovedForSession），沙箱失败升级重试不重复弹审批。
7. 命令执行三层安全：规则文件（allow/prompt/forbidden）→ 危险命令前缀黑名单 → 沙箱兜底；批准后可追加规则自动放行同类命令（proposed amendment）。
8. 沙箱采用"只读根 + 可写覆盖 + 受保护子路径强制只读"模型（bubblewrap `--ro-bind / /` + `.git/.codex` 再锁定），路径特异性排序处理嵌套读写冲突。
9. 上下文用 world state 基线 + diff 增量维护：完整注入一次持久化为基线，后续只注入变化，压缩后重建基线。
10. 压缩保留全部用户消息原文、总结 assistant 消息与工具执行明细，在同一会话内开新"上下文窗口"而非新建会话；PreCompact/PostCompact hooks 全程可介入。
11. 会话模型 = 线程模型：session_id 等于根线程 ID，子代理是 fork 出的独立线程（可选 FullHistory / LastNTurns 继承），整棵代理树可崩溃恢复。
12. 子代理角色只能收窄权限、不能放大父会话权限；并发受 agent_max_threads / 每会话并发上限约束；深度限制（V1）与并发限制（V2）分别生效。
13. MCP 服务器按用户输入中的 mention 按需启动（required servers 集合），而非全量预启动；插件/技能 mention 同理决定注入内容。
14. 外部工具/插件注册有保留名保护（exec_command/shell_command 不可被外部覆盖）与冲突记录（不 panic，记录 first_collision）。
15. 记忆管道对含外部上下文的工具输出做"污染标记"并禁用该线程记忆模式，防止 prompt injection 通过工具结果进入长期记忆。
16. 长会话/多次压缩会向模型注入"建议开新线程"的提醒，主动引导用户分流以控制上下文膨胀。

## 参考来源

- 仓库：https://github.com/openai/codex（commit `ddf04ad26789d040f9ef6a96736f76602e35a6cc`，2026-09-05，clone 研究日期 2026-09-08）
- 本地 clone 路径（研究用，不属于项目目录）：`%TEMP%\codex-research`
- 主要阅读文件（相对仓库根）：
  - `codex-rs/core/src/session/turn.rs`、`session/session.rs`、`session/world_state.rs`、`session/context_window.rs`、`session/token_budget.rs`
  - `codex-rs/core/src/compact.rs`、`compact_remote*.rs`、`compact_token_budget.rs`、`tasks/compact.rs`
  - `codex-rs/core/src/tools/registry.rs`、`tools/router.rs`、`tools/parallel.rs`、`tools/orchestrator.rs`、`tools/sandboxing.rs`、`tools/handlers/*`
  - `codex-rs/core/src/exec_policy.rs`、`codex-rs/execpolicy/src/*`
  - `codex-rs/core/src/hook_runtime.rs`、`codex-rs/hooks/src/*`、`config/src/hook_config.rs`
  - `codex-rs/core/src/sandboxing/mod.rs`、`codex-rs/sandboxing/src/*`、`codex-rs/linux-sandbox/README.md`、`codex-rs/windows-sandbox-rs/src/*`、`codex-rs/mxc-sandbox/src/lib.rs`
  - `codex-rs/core/src/agent/control*.rs`、`agent/role.rs`、`agent/registry.rs`、`tools/handlers/multi_agents*.rs`
  - `codex-rs/skills/src/*`、`codex-rs/memories/README.md`、`codex-rs/thread-store/src/*`、`codex-rs/prompts/src/*`
  - `codex-rs/core/src/agents_md.rs`、`codex-rs/core/src/context/*`、`codex-rs/core/src/tasks/review.rs`
- 仓库内文档：`docs/agents_md.md`、`docs/execpolicy.md`、`docs/sandbox.md`、`docs/skills.md`、`docs/exec.md`、`docs/config.md`
