# Claw Code 解剖

- 研究日期：2026-09-05（本地 shallow clone，`git clone --depth 1` 于 2026-09-05 执行）
- 锁定 URL：https://github.com/ultraworkers/claw-code
- 锁定 commit：`08106b0c3771ef5b4a5aa176acccd460e88b7325`（main，commit date 2026-08-16，「docs: add hierarchical AGENTS.md knowledge base」）
- 主要来源：`README.md`、`PARITY.md`、`ROADMAP.md`（8016 行）、`rust/README.md`、`USAGE.md`、`PHILOSOPHY.md`、`rust/crates/{runtime,tools,api,plugins,commands,rusty-claude-cli,mock-anthropic-service,compat-harness,telemetry}/` 源码、`docs/g00x-*-verification-map.md` 系列。
- 项目自述：Claw Code = `claw` CLI agent harness 的公开 Rust 重实现 + Parity（行为对齐）harness；仓库自称「agent-managed exhibit / museum artifact」，非生产主力（README 指引真干活去 LazyCodex / Gajae-Code）。Rust workspace 为权威实现（9+ crates，`claw` 二进制），另有 `src/`+`tests/` Python 伴生工作区。以下均基于 commit `08106b0` 的快照，README 中"当前功能表"与 PARITY 中"9 车道"合并为基线事实，个别注明「分支态/未落地」。

## H01 Agent Loop
- 实现位置：`rust/crates/runtime/src/conversation.rs` 的 `ConversationRuntime<C,T>::run_turn()`（L325-531）；CLI 侧组装在 `rust/crates/rusty-claude-cli/src/main.rs`（REPL 与 `prompt` 命令、`CliToolExecutor` L13857/L13942、`CliPermissionPrompter` L12479）。
- 核心流程：一次 `run_turn(user_input, prompter)` 内循环——push 用户消息 → `api_client.stream(ApiRequest{system_prompt, session.messages})` → 由流事件合成 assistant message → 无 ToolUse 则终止；否则对每个 tool_use 依次：PreToolUse hook → 权限授权（hook override / 规则 / 模式）→ `tool_executor.execute` → PostToolUse / PostToolUseFailure hook → 把 `tool_result` push 回 session，直到没有待执行工具或超出 `max_iterations`。循环每轮迭代上限（默认 `usize::MAX`，子代理用 `DEFAULT_AGENT_MAX_ITERATIONS`）；每轮 assistant 消息落盘后做 `maybe_auto_compact()`（含终止轮，防会话无限增长，#3106）；全程 `session_tracer` 记录 turn/iteration/tool 事件；`usage_tracker` 累计 token。
- 关键机制：运行时被抽象成 `ApiClient`（stream）与 `ToolExecutor`（execute）两个 trait，注入 hook runner、permission policy、compaction 阈值，可插拔测试（`ScriptedApiClient`/`StaticToolExecutor`/`PromptAllowOnce` 等单测桩）；compaction 后下一轮先做 session-health 探针（probe 失败则拒绝该轮并提示 `/session new`）。
- 优点：核心循环单文件、可测、与 UI/Provider 解耦；迭代上限与探针防死循环/防坏状态；tool 调用链（hook→权限→执行→hook）结构统一。
- 缺点：`run_turn` 只执行"单个用户轮"，REPL 的持续性（斜杠命令、后台任务、approve/deny）都在 CLI 层，不在 runtime 内；`execute_bash` 每次新建 current-thread tokio runtime（阻塞式），非共享执行器；后台任务仅交互 REPL 可用（help 明示）。

## H02 System Prompt
- 实现位置：`rust/crates/runtime/src/prompt.rs`：`SystemPromptBuilder`（L155-263，build/render）、`load_system_prompt(_with_context)`、`ProjectContext`、`ContextFile`、`ModelFamilyIdentity`、常量 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`、`FRONTIER_MODEL_NAME`；组装点：`tools/src/lib.rs` 的 `build_agent_system_prompt`（子代理）与 CLI 启动处。
- 核心流程：分节拼接 `Vec<String>`：intro → Output Style（可选）→ system 段 → doing-tasks 段 → actions 段 → 动态边界 → 环境上下文（cwd/日期/平台/模型家族）→ 项目上下文 → 记忆指令文件 → config 段 → 追加段（调用方/子代理补充）；`render()` join("\n\n")。
- 关键机制：指令文件发现有优先级 CLAUDE.md > CLAW.md > AGENTS.md，加 `.claude/<scope>/CLAUDE.md`、`.claw/instructions.md`、rules/import（外部框架规则可开关）；发现边界 = 最近的 git root（无 git 则仅 cwd）；内容去重（稳定哈希）、超预算截断；git 仓库时注入 status/diff/log 快照；记忆文件清单（path/source/origin/chars/contributes）可经 `claw status --output-format json` 机器读取。
- 优点：组合式 builder，注入点清晰；记忆文件去重+预算截断；日期/版本构建期固化（`BUILD_DATE`）保证可复现。
- 缺点：是"向 Claude Code 靠拢的简化版分节提示"，不是上游逐字 system prompt 的字节级对齐（PARITY 亦未宣称该层精确）；diff 快照截断策略粗略。

## H03 Context Engine
- 实现位置：无独立"context engine"模块；上下文 = prompt.rs 项目/记忆上下文 + git 快照 + session.rs 全量 transcript + `api/src/prompt_cache.rs`；另有一个独立 RAG 服务 crate `claw-rag-service`（chunk/embed/qdrant 索引+搜索，配 `docs/rag-web-ui.md`）与 `runtime/src/summary_compression.rs`（概要压缩预算）。
- 核心流程：每次请求重发 `system_prompt + session.messages` 全量 transcript（无裁剪中间层，token 增长靠 H04 compaction 收敛）；上下文「记忆」来自指令文件发现/渲染；工具输出在源头限流（bash 16 KiB 截断标记、文件读 10 MiB 上限、grep/read 带 offset/head_limit）；compaction 概要额外经 `compress_summary_text` 压入 1200 字符/24 行预算。
- 优点：确定性记忆发现与去重、git 状态注入、输出源头截断；PromptCache 侧为 Anthropic 路径做缓存命中/破裂统计（H03 与成本相关）。
- 缺点：无 token 感知的中间层裁剪/检索（除 compaction 外 transcript 全量重发）；RAG 服务与主 runtime 解耦（未见核心上下文接线证据），更像外挂知识库；"context 引擎"概念在 claw-code 内并不独立存在。

## H04 Compaction
- 实现位置：`rust/crates/runtime/src/compact.rs`（`should_compact`/`compact_session`/`estimate_session_tokens`/`format_compact_summary`/`get_compact_continuation_message`/`summarize_messages` 等）+ `conversation.rs` 的 `maybe_auto_compact()`（L571）+ `summary_compression.rs`。
- 关键机制：触发条件——累计 `usage.input_tokens ≥ auto_compaction_input_tokens_threshold`（默认 100_000，env `CLAUDE_CODE_AUTO_COMPACT_INPUT_TOKENS`）；`compact_session` 配置 `preserve_recent_messages=4`、`max_estimated_tokens=10_000`；保留最近消息逐字，旧消息由启发式 summarize（按角色归纳、抽 key files / current work / pending work、`<summary>`/`<analysis>` 标签块、跨次压缩合并旧概要）生成 System 续接消息：preamble（"continued from a previous conversation…"）+Summary + 保留尾部提示 + 直接继续指令（suppress follow-up questions 时）。
- 关键机制（边界）：压缩边界不拆散 tool_use/tool_result 对（若保留首条是 tool result 则回退边界，防 OpenAI-compat 400 orphaned tool message）；`preserve_recent_messages=0` 有越界守卫；`format_compact_summary` 去 analysis 块、`Summary:` 化。
- 优点：自动阈值可 env 调；保留尾部逐字；多轮压缩可合并；工具对完整性有专门回归测试；概要带 provenance/文件提取。
- 缺点：summarize 是纯启发式（非 LLM 压缩），长会话信息损失风险；token 估算 `estimate_message_tokens` 是粗略启发（非真实 tokenizer）；compaction 后 health probe 失败会直接拒绝该轮（激进）。

## H05 Tool System
- 实现位置：`rust/crates/tools/src/lib.rs`（~10.8k LOC 单体）：`ToolSpec{name,description,input_schema,required_permission}`、`mvp_tool_specs()`（40+ 个工具 spec）、`execute_tool(_with_enforcer)` 分派 + 每工具权限分类（`classify_bash_permission`/`classify_file_path_permission` 等）；文件工具实现在 `runtime/src/file_ops.rs`；工具注册/别名/插件工具/子代理执行器同文件；斜杠命令注册表在 `commands/src/lib.rs`；MCP 工具桥 `runtime/src/mcp_tool_bridge.rs`；插件工具 `plugins` crate。
- 核心流程：工具面按 Claude Code 命名暴露：`bash`、`read_file`、`write_file`、`edit_file`、`glob_search`、`grep_search`、`WebFetch`、`WebSearch`、`TodoWrite`、`Skill`、`Agent`、`ToolSearch`、`NotebookEdit`、`Sleep`、`SendUserMessage`/`Brief`、`Config`、`EnterPlanMode`/`ExitPlanMode`、`StructuredOutput`、`REPL`、`PowerShell`、`AskUserQuestion`、`Task*/Team*/Cron*`、`LSP`、MCP 资源/认证工具、`Git*`、`RemoteTrigger`、`TestingPermission` 等；输入输出 JSON 字符串契约，工具结果作为 `tool_result` 消息回灌。
- 关键机制：`GlobalToolRegistry`（builtin+plugin+runtime 工具）、每 spec 携带 `required_permission`；文件工具边界守卫——canonical 化拒绝 `../` 与 symlink 逃逸、`MAX_READ_SIZE`/`MAX_WRITE_SIZE`=10 MiB、NUL 二进制检测；bash 输出 16 KiB 截断。
- 优点：工具面广、spec 驱动、权限分类按路径/命令动态判定；文件读写边界防护成体系（PARITY lane 3）。
- 缺点：PARITY 自承多处仍是 registry-backed 近似或桩——`AskUserQuestion` 返回 pending 载荷（无真实交互 UI）、`RemoteTrigger` stub、`TestingPermission` 仅测试；`tools/src/lib.rs` 万行单体难维护；Bash 深度校验子模块（`bash_validation.rs`）已在 main 导出但 PARITY 指出执行侧 `bash.rs` 仍是 `sh -lc` 简单执行 + 权限只读门控。

## H06 Hooks/Events
- 实现位置：`rust/crates/runtime/src/hooks.rs`（`HookRunner`、`HookEvent`、`HookAbortSignal`、`HookProgressReporter`、`parse_hook_output`）+ `conversation.rs` 中 hook 调用点（`run_pre_tool_use_hook`/`run_post_tool_use_hook`/`run_post_tool_use_failure_hook`）+ `runtime/src/lane_events.rs`（机器可读 LaneEvent 编排事件）+ `telemetry` crate（SessionTracer 事件）。
- 核心流程：仅三个工具生命周期事件 `PreToolUse`/`PostToolUse`/`PostToolUseFailure`（hook 事件数比上游少，无 SessionStart/Stop/SubagentStop/UserPromptSubmit 等）；从 `RuntimeHookConfig` 取命令、以 shell 子进程执行，hook 输出为 JSON stdout，解析契约：`systemMessage`/`reason` 追加消息、`continue:false` 或 `decision:"block"` ⇒ deny、`hookSpecificOutput{additionalContext, permissionDecision:allow|deny|ask, permissionDecisionReason, updatedInput}` ⇒ 权限覆盖/改写工具输入/补充反馈（L542-634）。
- 关键机制：PreToolUse 结果决定权限路径（cancelled/failed/denied 直接产出 deny tool_result；`updatedInput` 改写执行入参；hook 消息合并进工具结果）；PostToolUse 失败/拒绝会把工具标记 error；`HookAbortSignal` 与进度事件支持取消/可见性；非法 JSON 输出给出结构化诊断并透传 raw stdout。
- 事件层：`lane_events.rs` 的 LaneEvent（started、ship.prepared、blocker 等 + provenance/dedupe/terminal-state 处理）面向 clawhip 编排而非用户 hook；`telemetry::SessionTracer` 记录 turn/iteration/tool 生命周期事件。
- 优点：hook 与权限/工具执行深度集成（可覆盖、可改写、可拦截）；JSON 契约解析带严格校验与友好报错；lane 事件有 schema/dedupe/终端态契约（g004）。
- 缺点：事件集远小于上游 Claude Code（缺会话级 hook 事件）；hook 靠外部 shell 命令（无进程内扩展 API）；`hook_validation` 仅校验配置合法（valid/invalid_hooks 分类），未知事件被剔除。

## H07 Permission/Safety
- 实现位置：`runtime/src/permissions.rs`（`PermissionPolicy`、`PermissionMode`、`PermissionRule` allow/deny/ask、`PermissionOverride`、`PermissionPrompter`）+ `runtime/src/permission_enforcer.rs`（`PermissionEnforcer::check`/`check_file_write`/`check_bash`）+ `bash_validation.rs` + CLI `CliPermissionPrompter` + `approval_tokens.rs`（审批委托台账）+ 编排侧 `policy_engine.rs`/`green_contract.rs`/`branch_lock.rs`/`stale_branch.rs`。
- 核心流程：模式 `ReadOnly`/`WorkspaceWrite`/`DangerFullAccess`/prompt；每工具 `required_permission`（spec 携带，未注册默认 Danger）；规则文件 allow/deny/ask（`Tool(描述)` 模式匹配 tool 名与输入）+ `denied_tools` 无条件拒绝（先于一切规则）；`authorize_with_context` 决策序：denied_tools → deny 规则 → hook override（deny/ask/allow）→ ask 规则 → allow 规则 → 模式比较；越权或 ask 时调用 `PermissionPrompter`（CLI 为 y/N 交互；无 prompter 则 deny）。`PermissionEnforcer::check_bash` 用只读命令启发式（git 子命令门控、重定向/就地改写标志/命令链/解释器与构建驱动拦截）；`check_file_write` 做 canonical workspace 边界。
- 优点：模式+规则+hook override 三通道；只读启发式较细（含 `sed -i`、`find -delete` 等）；`denied_tools` 短路过早放行；文件写入按路径分类权限；分支陈旧/锁定、green 契约等"可执行策略"在编排侧另有实现。
- 缺点：升级提示是终端 y/N（无 TUI/「记住允许」流，仅 REPL `/approve`/`/deny`）；只读启发式本质是字符串规则，可被绕或误伤；`trust_resolver` 仅 `#[cfg(test)]` 导出，未进生产；approval token/ledger 与正常交互流的关系不明。

## H08 Sandbox
- 实现位置：`runtime/src/sandbox.rs`（`SandboxConfig`/`SandboxRequest`/`SandboxStatus`/`FilesystemIsolationMode` off|workspace-only|allow-list、容器环境检测、`build_linux_sandbox_command`、unshare 能力探测）+ `runtime/src/bash.rs`（`sandbox_status_for_input`、`.sandbox-home`/`.sandbox-tmp` 目录、回退执行）。
- 核心流程：每次 bash 调用解析 sandbox 状态——`resolve_request` 合并 config 与工具入参（`dangerouslyDisableSandbox`/`isolateNetwork`/`filesystemMode`/`allowedMounts`）→ 容器检测（`/.dockerenv`、`/run/.containerenv`、env 标记、`/proc/1/cgroup`）→ Linux 上探测 unshare（user/network/mount ns 映射尝试，探测能力而非二进制存在，PARITY lane 2）→ 组装 `unshare` 启动命令；不支持/非 Linux 时回退 `sh -lc` + 把 `HOME=.sandbox-home`、`TMPDIR=.sandbox-tmp` 指到工作区子目录，stdin 接 `/dev/null`。
- 关键机制：`SandboxStatus`（enabled/supported/active/namespace/network/filesystem/in_container/fallback_reason）回填到 `BashCommandOutput.sandbox_status`；超时返回结构化 `command.timeout`/`test.hung` provenance；`run_in_background` 走 detach。
- 优点：能力探测取代存在性假设；配置/请求/状态分层清晰、降级路径明确（目录重定向）；容器感知（避免嵌套沙箱误判）；CI 修复已合并（PARITY lane 2）。
- 缺点：真实隔离仅在 Linux+unshare 可用；回退模式不隔离文件系统（仅环境变量重定向）；源码无 `cfg(windows)` 专属沙箱路径（README 强调 Windows/PowerShell 可用但 sandbox 深度未声明）；allow-list 挂载实现粒度粗（字符串列表）。

## H09 Session/Memory
- 实现位置：`runtime/src/session.rs`（`Session`、`ConversationMessage`、`ContentBlock`、`SessionCompaction`、`SessionFork`、heartbeat/liveness、JSON/JSONL 持久化）+ `runtime/src/session_control.rs`（`SessionStore`、managed sessions 目录、`--resume` 引用解析、fork、删除、workspace fingerprint）+ 记忆文件在 `prompt.rs`。
- 核心流程：Session 字段含 `session_id`、`created_at_ms`、`workspace_root`、`model`、有序 messages、可选 compaction 记录；磁盘布局 `<cwd>/.claw/sessions/<workspace_hash>/`（或 data_dir 变体），每条消息/提示条目追加持久化（JSONL snapshot 与 JSON 双格式读写）；`SessionStore::from_cwd`/`resolve_reference(latest|id)`/`list_sessions`/`fork_managed_session` 供 CLI `--resume`、`/session`、`/resume`、`/fork`；会话文件按 workspace hash 归类并做指纹；heartbeat/liveness 记录健康检查；fork 记录 `parent_session_id`。
- 记忆：`ProjectContext::discover(_with_git)` 装载 CLAUDE.md/CLAW.md/AGENTS.md 与 scoped 文件进 system prompt（见 H02/H03），无独立记忆库（RAG 服务除外）。
- 优点：JSON/JSONL 双格式 + 追加式持久化 + 管理目录按 workspace 分桶；resume/fork 支持完整；状态机输出 `workspace_dirty`/`abandoned` 等机器字段；与 `/session list|show|fork`、`--resume latest` 对齐。
- 缺点：持久化在 `Session`/`SessionStore`，`ConversationRuntime` 本身不拥有落盘生命周期（需外部在轮次边界保存）；并发/多进程写同会话的语义未见；记忆范围仅 git-root/cwd 内文件（无层级化全局记忆，除了 2026-08-16 新增的 AGENTS.md 知识库文档仍在演进）。

## H10 Skills
- 实现位置：`tools/src/lib.rs` 的 `Skill` tool spec（L657）+ `run_skill`/`execute_skill`（L2510/L3790，读本地 skill 文件并返回其说明）+ `resolve_skill_path(_from_compat_roots)`（L3826+，含 `.claude/skills`、`.claw` skills 目录、legacy `commands/` 兼容根、plugins 自带技能样例）；斜杠 `/skills [list|show|install|uninstall]` 在 `commands/src/lib.rs`（`Skills` 分派、`load_skills_from_roots`）；`claw skills` CLI 子命令 + `dump-manifests` 输出 skills 清单。
- 核心流程：模型调用 `Skill{skill:名称}` → 从多个根解析路径 → 读文件全文作为指令注入（`parse_skill_description` 提取简介）→ 返回 JSON（skill/path/…）；`/skills install <path>` 复制进技能目录；`status`/`doctor` 不含 skills 检查但 `claw skills list` 可机器输出。
- 优点：本地技能发现多根、含上游兼容路径（`.claude/skills` 与 legacy commands 混布）；安装/卸载/清单/帮助面齐全（README 标 ✅）；技能说明可被 `dump-manifests` 解析器盘点。
- 缺点：`execute_skill` 只是"把技能文件内容读回给模型"（无结构化的技能参数 schema 解析、无技能内 agent/子会话执行器）；与上游 Claude Code Skills（含子代理/更丰富的加载协议）的深度对齐未证实；技能名解析对多根重复名/嵌套技能目录的规则未深究。

## H11 Subagent
- 实现位置：`tools/src/lib.rs`：`Agent` tool（L671/L1434）→ `execute_agent_with_spawn`（L4095）→ `spawn_agent_job`（L4175，命名线程 `clawd-agent-<id>`）→ `run_agent_job`（L4202）→ `build_agent_runtime`（ConversationRuntime + `ProviderRuntimeClient` + `SubagentToolExecutor` + 独立 `PermissionPolicy`）；`allowed_tools_for_subagent` 按类型裁剪工具集（Explore：read/glob/grep/WebFetch/WebSearch/ToolSearch/Skill/StructuredOutput；Plan/General 类似分集）；持久化 output_file `*.md` + manifest `*.json`，状态机 running/completed/failed + lane_events.started；斜杠 `/subagent [list|steer|kill]`、`/agents` 清单（`claw-analog` 的 `AgentsCli` 可从 preset 派生 agent spec 并复用 base session）。
- 关联：`runtime/src/worker_boot.rs` `WorkerRegistry`（worker 状态机、trust 解析、startup 预检分类、observe/send_prompt/await_ready/restart/terminate/observe_completion）是"clawable worker"编排模型；`task_registry.rs`/`team_cron_registry.rs` 提供 Task/Team/Cron 的内存注册表（`RunTaskPacket`/`TaskCreate`…工具走它们）。
- 关键机制：每个子代理 = 同进程新线程 + 独立 ConversationRuntime/Session/工具白名单 + 独立的 max_iterations；结果写 agent store 文件供主线程轮询；线程 panic 被捕获转 failed。
- 优点：白名单式工具隔离 + 独立 runtime；结果/清单持久化便于编排；steer/kill 已有斜杠面；worker 事件模型（trust/ready/失败分类）为外部自动机设计。
- 缺点：同进程线程（非进程级隔离，无独立 cwd/环境沙箱）；子代理无独立 compaction/预算管理（复用默认阈值）；Task/Team/Cron 仍是内存注册表（PARITY：无真实后台调度器/worker 集群）；`AskUserQuestion` 在子代理路径不可用（pending stub）。

## H12 Evaluator
- 实现位置：无"agent 输出质量评测器"（无 LLM judge、无 gold answer 打分）。最接近的评测体系是 Parity/mock harness 与契约校验：
  - `mock-anthropic-service` crate：确定性 Anthropic 兼容 mock（`PARITY_SCENARIO:` 前缀识别 12+ 脚本场景：streaming_text、read_file_roundtrip、grep_chunk_assembly、write_file_allowed/denied、multi_tool_turn_roundtrip、bash_stdout_roundtrip、bash_permission_prompt_approved/denied、plugin_tool_roundtrip、auto_compact_triggered、token_cost_reporting）。
  - `rusty-claude-cli/tests/mock_parity_harness.rs` 干净环境 CLI harness；`rust/scripts/run_mock_parity_harness.sh` + `run_mock_parity_diff.py`（校验 scenario 名在 PARITY.md 中存在 + 跑 harness）+ `rust/mock_parity_scenarios.json`（scenario→PARITY 引用清单）。
  - `compat-harness` crate：从上游 Claude Code TypeScript 检出物提取命令/工具/bootstrap 清单以做表面 diff（`extract_commands`/`extract_tools`/`extract_bootstrap_plan`）。
  - `runtime/src/g004_conformance.rs` 机器可查的 g004 事件/报告契约校验；`docs/g00*.md` 十个 *verification-map*（g002/g003/g004/g005/g006/g007/g009/g010/g011/g013）：把"行为→代码→测试"人工+脚本对照表；`policy_engine.rs`/`green_contract.rs` 把策略作为可执行规则求值（编排侧"绿灯"评审，非输出质量评分）。
- 优点：以确定性 mock 做端到端行为回归（无网络/无真实模型）；scenario↔PARITY 引用可自动核对（diff 脚本）；验证地图把每个 g-lane 诉求映射到文件与测试，可审计；契约校验（g004）机器化。
- 缺点：评测对象是"行为对齐/回归"而非"任务完成质量"（无质量分、无轨迹分析、无参考答案）；scenario 覆盖限于 mock 流程（12 个）；多数 verification-map 是文档而非 CI 强制门槛（ROADMAP：CI 每 commit 全绿仍开放）；真实模型端到端评测依赖外部 Anthropic/OpenAI key，repo 内未内置。

## 行为要点提取（供 Behavior IR）
1. 单轮循环 = 模型流式响应 → 收集 ToolUse → 逐个「PreToolUse hook → 权限 → 执行 → PostToolUse(hook)」→ tool_result 回灌 → 无工具则结束；每轮后（含终止轮）做自动压缩检查。
2. PreToolUse hook 可 cancel/fail/deny（产出 denied tool_result）、override 权限为 allow/deny/ask、用 `updatedInput` 改写执行入参、把 `systemMessage`/`additionalContext` 合并进工具结果。
3. 权限决策序：`denied_tools` 无条件拒 → deny 规则 → hook override → ask 规则 → allow 规则 → 模式比较（ReadOnly/WorkspaceWrite/DangerFullAccess，工具 spec 声明 required_permission）；越权需 prompter（CLI y/N），无 prompter 即拒；只读工具不因 hook allow 而升级越权。
4. 自动压缩：累计 input_tokens ≥ 阈值（env `CLAUDE_CODE_AUTO_COMPACT_INPUT_TOKENS`，默认 100k）触发；旧消息启发式归纳成 System 续接消息，保留最近 4 条逐字；不拆散 tool_use/tool_result 对；压缩后下一轮先做 session-health 探针，失败拒绝该轮。
5. 会话持久化到 `<cwd>/.claw/sessions/<workspace_hash>/`，消息/提示条目追加写入（JSONL/JSON 双格式），支持 `--resume latest|id`、fork（记 parent_session_id）、heartbeat/liveness、`workspace_dirty/abandoned` 报告。
6. 指令记忆文件按 CLAUDE.md > CLAW.md > AGENTS.md 优先级装载（含 `.claude/<scope>/CLAUDE.md` 与 `.claw/instructions.md`），发现边界限 git root（无 git 仅 cwd），内容去重 + 预算截断 + 哈希；git 仓库注入 status/diff/log。
7. Bash 工具：`sh -lc` 执行，输出 16 KiB 截断加标记，超时返回 `interrupted` + 结构化 `command.timeout`/`test.hung`，stdin 接 /dev/null；`run_in_background` 分离子进程返回 `background_task_id`。
8. Linux 沙箱：unshare（user/network/filesystem ns）真实隔离，能力探测（非二进制存在）；不支持时回退 `HOME=.sandbox-home`/`TMPDIR=.sandbox-tmp` 环境重定向；容器环境标记检测防误判。
9. 文件工具：canonical 化拒绝 `../` 与 symlink 逃逸，读/写 10 MiB 上限，NUL 二进制检测；写路径权限分类。
10. Skill 工具把本地技能文件（`.claude/skills`、`.claw`、legacy `commands/` 兼容根解析）的说明内容作为指令返回模型；`/skills` 支持 list/show/install/uninstall。
11. Agent 工具：同进程命名线程 + 独立 ConversationRuntime/Session/工具白名单（按 Explore/Plan/… 子类型裁剪）执行委托任务，输出 *.md + manifest *.json 持久化，状态机 running/completed/failed；`/subagent` 可 list/steer/kill。
12. Hook 输出契约为 JSON stdout：`systemMessage`/`reason`/`continue:false`/`decision:block`/`hookSpecificOutput{additionalContext, permissionDecision, permissionDecisionReason, updatedInput}`；非法 JSON 产生结构化诊断并回退透传。
13. Provider 路由按模型别名与家族分发 Anthropic/xAI(grok)/OpenAI/DashScope(qwen)/Ollama(local)；仅 Anthropic 路径挂 prompt cache（按会话缓存 + cache-break 事件）；认证走 API key env 或 OAuth PKCE loopback / bearer token。
14. 大批能力仅交互 REPL 可用（后台任务、/approve /deny、/plugin、/skills、/tasks 等），非交互 `prompt`/JSON 面受限并有 `interactive_only` 错误分类。
15. 部分成功是一等公民：MCP 配置部分合法部分非法 → `servers[]`+`invalid_servers[]`；hooks 配置同理（valid/invalid_hooks、未知事件剔除），供自动化降级。

## 参考来源
- 仓库根：https://github.com/ultraworkers/claw-code （clone @ `08106b0c3771ef5b4a5aa176acccd460e88b7325`）
- `README.md`（自述/exhibit 定位、构建、文档地图、生态）、`rust/README.md`（crate 职责、功能表、命令面、workspace 布局、~20K LOC/9 crates）
- `PARITY.md`：9-lane 行为对照（Bash/File Tools/Task Registry/Team-Cron/MCP/LSP/Permission/Compaction），40 工具 spec，mock parity harness 里程碑
- `ROADMAP.md`（8016 行：worker boot、lane 事件、失败分类、恢复、分支策略与 227+ pinpoints）、`PHILOSOPHY.md`（OmX/clawhip/OmO 三层编排哲学）
- `USAGE.md`、`docs/g004-events-reports-contract.md` 与 `docs/g00*.md` verification-map 系列
- 源码：`rust/crates/runtime/src/{conversation,compact,prompt,session,session_control,hooks,permissions,permission_enforcer,bash,sandbox,file_ops,summary_compression,lane_events,worker_boot,task_registry,team_cron_registry,approval_tokens,policy_engine,green_contract}.rs`；`tools/src/lib.rs`；`api/src/{client,prompt_cache,providers/*}.rs`；`rusty-claude-cli/src/main.rs`；`commands/src/lib.rs`；`plugins/src/hooks.rs`；`mock-anthropic-service/src/lib.rs`；`compat-harness/src/lib.rs`；`rust/mock_parity_scenarios.json`；`rust/scripts/*`
- 资料充分性：H01-H11 均有直接源码/文档证据；H12 无 LLM 输出质量评测器，已如实标注"以 mock-parity + verification-map + 契约校验代替"，未编造独立 evaluator。
