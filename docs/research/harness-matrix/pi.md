# Pi / pi-mono 解剖

- 研究日期：2026-09-05（本地 `git clone --depth 1` 读取源码，当日 HEAD；未做网络实况复核）
- 锁定仓库与 commit：https://github.com/badlogic/pi-mono @ `9841914c71a74d81abe07f751aefd271fd924e63`（2026-09-05 00:46:34 +0200，`fix(tui): keep list selection unchanged on mouse hover`；仓库亦镜像于 https://github.com/earendil-works/pi-mono）
- 主要来源：`packages/agent`（pi-agent-core：公开 Agent 运行时 + 新一代 `harness/` 内核）、`packages/ai`（pi-ai 统一多 Provider LLM API）、`packages/coding-agent`（pi-coding-agent CLI 与扩展体系）、`packages/session-backends/sqlite-node`、`packages/evals`；`packages/coding-agent/docs/`（security / containerization / sessions / compaction / skills / settings 等）。
- 技术底座摘要：TypeScript 全栈；pi-ai 为 provider 中立 LLM 层（OpenAI / Anthropic / Google / Mistral / DeepSeek / OpenRouter / Bedrock / Copilot 等 30+ provider，TypeBox 校验工具参数，JSON 事件流 `streamSimple`，Auth 解析 + OAuth）；pi-agent-core 分**两层**——(1) 面向 SDK/生产路径的公开 `Agent`/`agentLoop`（`agent.ts`/`agent-loop.ts`，事件流式、工具循环、steering 消息）与 (2) 新一代存储后端 harness 内核（`harness/`：Session/Lane/Drive/操作状态机、JSONL 或 SQLite 持久化、检查点恢复、hooks 聚合），coding-agent 生产路径目前跑在 (1) 上，(2) 处于 experimental worker / mini 分支；tui/交互、session 树（JSONL v3）、扩展/技能/提示模板/主题体系均在 coding-agent 侧实现。
- 说明：本解剖覆盖 `packages/agent`（含 `harness/`）、`packages/ai`、`packages/coding-agent`，并旁及 evals/session-backends/chord 相关接口。

## H01 Agent Loop

- 实现位置：
  - 公开层：`packages/agent/src/agent-loop.ts`（`runAgentLoop` / `runAgentLoopContinue` / `runLoop`）、`packages/agent/src/agent.ts`（`Agent` 类封装，事件订阅 `agent.subscribe`）、`packages/agent/src/types.ts`（AgentLoopConfig / prepareNextTurn / steering）。
  - 新一代 harness 层：`packages/agent/src/harness/runtime/lane.ts`（2012 行，主状态机）、`harness/runtime/drive.ts` + `drive/*.ts`（checkpoint/generation/tools/reconcile/recovery/structural/boundary/deferred/retry/response/terminal）、`harness/runtime/harness.ts`（AgentHarness.create）、`harness/agent-harness.ts`（公开 API、HarnessEvent、OperationRequest、LaneSnapshot）。
  - coding-agent 生产路径：`packages/coding-agent/src/core/agent-session.ts`（把公开 Agent 接到会话/资源/压缩/扩展）、`core/agent-session-runtime.ts`、`core/sdk.ts`（SDK 装配）。
- 核心流程（公开层）：`prompt()` 把用户消息加入 context → `runLoop` 双层 while：外层在有 queued follow-up/steering 消息时继续；内层 处理 tool calls——`streamAssistantResponse`（调 streamFn 逐帧发 assistant 事件）→ 检查 stopReason → 若为 tool_calls 则逐一 `executeToolCall`（before/after 钩子、block 语义、terminate 提示）→ 工具结果 append 回 context → 继续下一内层回合，直至 stop/error/aborted 或 `shouldStopAfterTurn`。turn 间可调 `prepareNextTurn`（返回新 context/model/thinkingLevel——压缩就挂在这里）；`getSteeringMessages` 允许用户在流式期间打字排入队列（`steeringMode: all | one-at-a-time`）。
- 核心流程（harness 层）：AgentHarness 以存储会话（Session）为事实源，一次 run 是检查点化的操作状态机：admission → checkpoint → assistant generation（可中断/重试/deferred 异步续生成）→ tools（并行或顺序，工具结果落库，中断恢复）→ boundary 提交 → reconcile；事件全量发布 `HarnessEvent`（run/turn/message/tool/compaction/navigation/usage/config）；Lane 支持 steer/followUp/nextRun 队列与 watch（快照 + 增量事件），drive 从 durable checkpoint 恢复中途崩溃的 run。
- 优点：事件流贯穿（message_update 逐帧可渲染、tool_update 增量），多 provider 可换模型续跑；公开层简单（几百行）；harness 层把并发/重试/中断/恢复做成确定性状态机，前端只消费快照，鲁棒性设计强（测试含 conformance/benchmark 存储测试）；压缩与 steering 都是 loop 的普通输入而非特殊分支。
- 缺点：同一产品同时存在两套 loop（公开 Agent 与 harness Lane/drive），迁移期语义双轨；harness 层文件多、抽象深（lane/drive/procedure/boundary/structural）学习成本高；coding-agent 生产路径尚未完全搬到 harness 层，实际并发（interrupt 等）由 AgentSession 包一层完成。

## H02 System Prompt

- 实现位置：
  - coding-agent：`packages/coding-agent/src/core/system-prompt.ts`（`buildSystemPrompt`，168 行）、`core/resource-loader.ts`（`loadProjectContextFiles` 加载 AGENTS/CLAUDE 上下文文件、SYSTEM.md / APPEND_SYSTEM.md）、`core/agent-session.ts`（L1081 起把 loader 的 systemPrompt/appendSystemPrompt/skills/contextFiles 拼进 prompt）。
  - agent 包：`packages/agent/src/harness/system-prompt.ts`（`formatSkillsForSystemPrompt`，仅技能 XML 块）、`harness/agent-harness.ts`（AgentHarnessOptions.systemPrompt 可为函数：按 toolContext 生成）。
  - pi-ai：模型/路由相关的环境注入在下游 providers（headers/auth）。
- 组成（默认 coding-agent prompt）：一句角色定义（“expert coding assistant operating inside pi”）→ `Available tools:` 一行式工具摘要（按实际注册工具裁剪，toolSnippets）→ `Guidelines`（随可用工具生成：有 grep/find/ls 则建议直接文件工具而非 bash；无则给 bash 探索指引；恒加 “Be concise”、“Show file paths clearly”）→ pi 自文档路径块（只在被问及 pi 自身时读，避免浪费上下文）→ 可选 append（APPEND_SYSTEM.md/自定义）→ `<project_context>`（AGENTS.override.md / AGENTS.md / CLAUDE.md 逐层祖先拼接、去重、git worktree shadow 处理）→ 技能 XML 块（见 H10）→ `Current working directory: <cwd>`。
- 定制：自定义 systemPrompt 替换默认（仍附 context 文件/技能/append）；settings 与 `.pi/SYSTEM.md`、`.pi/APPEND_SYSTEM.md`（后者需项目信任才加载）；extension 事件 `context` 与 `before_agent_start` 可再改写。
- 优点：tools 与 guidelines 联动裁剪（不给 ls/grep/find 就不会鼓励 bash 探索）；自文档按需读（减少固定 token）；context 文件叠加祖先并做 worktree shadow 去重；整个 prompt 是普通字符串，SDK/测试可整体替换（evals 的 `transformSystemPrompt` 就用它）。
- 缺点：无结构化 message 数组（全拼成一个长字符串，模型/厂商差异靠 XML 风格标签消化）；技能“渐进披露”依赖模型自觉先 read 再执行（文档明示模型不总是照做）；默认 prompt 面向“coding agent”，非 coding 场景需整体换掉。

## H03 Context Engine

- 实现位置：
  - coding-agent：`packages/coding-agent/src/core/agent-session.ts`（消息历史持有在 `Agent` context 内；`session-manager.ts` 存 Entry 树；`core/tools/truncate.ts` 输出截断）、`core/messages.ts`（AgentMessage 扩展：BashExecutionMessage/CustomMessage/CompactionEntry 等自定义类型，经 `declare module` 并入 pi-agent-core）。
  - agent 包公开层：`packages/agent/src/types.ts` + `agent.ts`：context 就是 `{ messages, model, reasoning, systemPrompt, ... }` 对象，跨轮累积。
  - harness 层：`harness/runtime/transcript.ts`（`readBoundedContext` 读会话分支、按 compaction 边界裁剪）、`session/jsonl/` 与 SQLite backend（按 Entry id 读子集）、`harness/utils/truncate.ts` / `output-capture.ts`（shell 输出有界捕获：maxBytes/maxLines/head|tail/spill 落盘）。
- 核心机制：公开层只把 AgentMessage 数组在每次 LLM 调用边界经 `convertToLlm` 过滤/转换成厂商消息（自定义类型被剥离）；消息本身在 coding-agent 里以 **会话 Entry 树**（JSONL，id/parentId）持久化，每次构建上下文从当前活动分支 tip 读回该分支消息并重放（含 compaction 摘要与 `firstKeptEntryId` 之后的消息）。上下文 token 数靠估算（`estimateContextTokens`，usage 缺失时字符/JSON 近似）或厂商 usage 换算（`calculateContextTokens`）。
- 上下文文件注入走 H02 的 contextFiles；无 RAG/向量检索、无引用库抽象（AGENTS.md 全文注入就是“项目知识”）。
- 优点：会话树让“跳到历史某点继续”等价于换 tip 重建上下文（无复制）；分支/压缩后只发送可见消息给厂商；输出侧有界截断 + 溢出落盘可回读；AgentMessage 自定义类型把工具执行/压缩等富事件也纳入统一历史，回放/导出 HTML/分享都从同一数据结构来。
- 缺点：每轮从 JSONL 重读并序列化整条分支，长会话读放大（虽有压缩）；token 估算是近似（编码差异、多模态图片不计）；系统/工具输出之外的“世界状态”没有增量 diff 层（编码 agent 场景靠 read 工具重新拿）。

## H04 Compaction

- 实现位置：
  - coding-agent 生产路径：`packages/coding-agent/src/core/compaction/compaction.ts`（`shouldCompact`/`prepareCompaction`/`compact`/`generateSummary`/`findCutPoint`/`findTurnStartIndex`，865 行）、`core/compaction/branch-summarization.ts`、`core/compaction/utils.ts`（文件操作追踪 readFiles/modifiedFiles）、触发点 `core/agent-session.ts`（L2208 附近：turn 结束后用量换算 → `shouldCompact(contextTokens, contextWindow, settings)` → 自动压缩；亦在每次新 prompt 前与 run 结束后检查；`session_before_compact`/`session_compact` 扩展事件可拦/观察）。
  - harness 层对应：`packages/agent/src/harness/compaction/compaction.ts`（prepare/CompactResult、分支摘要 `branch-summarization.ts`），hook `before_compaction`/`before_navigation` 可 decline/替换。
- 触发与参数：`contextTokens > contextWindow - reserveTokens`；`DEFAULT_COMPACTION_SETTINGS = { reserveTokens: 16384, keepRecentTokens: 20000 }`（settings 可配）。厂商模型 contextWindow 来自模型目录。
- 流程：① 从最新消息倒走累计 token 到 `keepRecentTokens` 找 cut point（只允许在 user/assistant/bashExecution/custom 边界切，禁止切在 tool result 中段；turn 太大则 split-turn：对 turn 前缀单独再生成一段摘要合并）；② 把 cut 点以前消息序列化（附此前 summary 作迭代上下文、文件操作汇总 readFiles/modifiedFiles）交给一次独立 LLM 调用生成结构化摘要（概要/文件变更/要点；fresh routing session，disable prompt-cache 写入）；③ 在会话追加 `CompactionEntry { summary, firstKeptEntryId }`；④ 会话重建：下次 LLM 看到 = system + summary + `firstKeptEntryId` 起的真实消息。重复压缩从上次保留边界继续，避免漏掉上次幸存的消息。手动 `/compact [指令]` 同路径。
- 分支摘要：`/tree` 切走某分支时可把被遗弃分支摘要附到新位置（可 decline / 自定聚焦指令）。
- 优点：自动/手动双触发，阈值+保留预算可配；切点规则严格（不截 tool result）；split-turn 兜底；多轮压缩不漏历史；压缩摘要由真实 LLM 生成（跨厂商同一函数）。
- 缺点：压缩本身消耗一次 LLM 调用与 token（文档明示走 fresh session 禁缓存写入）；摘要取代原始消息后细节不可回查（需靠会话树导航到旧分支重放）；token 阈值基于估算/厂商 usage 的换算可能抖动；不做重放式压缩（紧凑对话没有“继续执行”的自动重放语义，openCode 有但 pi 未做）。

## H05 Tool System

- 实现位置：
  - 定义/契约：`packages/agent/src/types.ts`（AgentTool/AgentToolResult/before/after 钩子/ToolExecutionMode/`AgentTool` 工厂）、`packages/agent/src/harness/types.ts`（AgentHarnessTool 用 TypeBox schema + onUpdate 进度 + 调用级 memo，`FileSystem`/`Shell`/`ExecutionEnv` 能力接口）。
  - 公开层执行：`packages/agent/src/agent-loop.ts`（executeToolCall）、`agent.ts`（tools 注册、类型事件 tool_start/tool_update/tool_end）。
  - harness 层执行：`harness/execution/tools.ts`、`execution/assistant.ts`、`runtime/drive/tools.ts`（并行执行、中断恢复、memo）、`runtime/drive/tool-placement.ts`、`harness/tools/`（read/write/edit/edit-diff/bash/image + tool-context）。
  - coding-agent 内置工具：`packages/coding-agent/src/core/tools/{bash,powershell,read,write,edit,grep,find,ls}.ts` 共 8 个（`ToolName`），每个工具分“定义(schema+prompt contribution)”与“pluggable operations”两层（`BashOperations.exec` 等可被覆盖以重定向到 SSH/容器/Gondolin）；`core/tools/tool-definition-wrapper.ts` 把 AgentTool 包成扩展系统工具；`core/extensions/types.ts` 提供 ToolDefinition/自定义工具注册与渲染。
  - pi-ai 侧：`packages/ai/src` 工具参数 TypeBox 校验 `validateToolArguments`、流式 partial JSON tool call、deferred 工具（厂商侧异步续跑）。
- 核心机制：schema 由 typebox 定义（编辑器/校验共用）；执行按 `ToolExecutionMode`：sequential 逐个，parallel 则先全部 preflight（before_tool 可 block：`{block, reason, terminate}`）再并发执行允许者；结果 `AgentToolResult`（content 文本/图像、details、usage、isError），`after_tool` 可逐字段替换。工具上下文注入（cwd、session 信息、PI_* env）与文件变更互斥队列（file-mutation-queue，防并行编辑竞态）。bash 输出经 truncate（默认 maxBytes/maxLines + 完整落盘路径返回），超时可选。
- 优点：schema 驱动（typebox）贯穿校验/提示/UI；执行与 I/O 解耦（Operation 可注入，天然支持远程执行扩展）；parallel 前先 preflight 的 block 语义安全；工具调用级 memo 让重试/恢复可幂等续跑；8 个最小工具集合 + 扩展可加任意工具。
- 缺点：无 MCP 客户端抽象（第三方便携工具生态需借 pi-chat/扩展自接；比 Claude Code/OpenCode 的 MCP 内建弱）；文件工具集合较小（ls/grep/find 独立成工具而非 bash 内）；coding-agent 的工具把 truncate/render 逻辑与执行耦合在 renderers，扩展自定义渲染需另写。

## H06 Hooks/Events

- 实现位置：
  - coding-agent 扩展事件：`packages/coding-agent/src/core/extensions/types.ts`（1797 行：ExtensionEvent 联合与 `ExtensionHandlers.on(...)` 全清单）、`core/extensions/loader.ts`/`runner.ts`/`wrapper.ts`、`core/event-bus.ts`、`core/agent-session.ts` 触发点。
  - harness 层 hooks：`packages/agent/src/harness/hooks.ts`（HookRegistry：按名字注册、聚合运行、fail-closed/first-wins 语义、effect gate 准入）、`harness/agent-harness.ts`（`HookMap`：before_run / before_drive / before_run_end / transform_context / before_request / before_payload / after_response / before_tool / after_tool / before_compaction / before_navigation）。
  - harness 事件：`harness/agent-harness.ts`（`HarnessEvent` 全联合：run/turn/message/tool/compaction/navigation/usage/config_update/queue/fault/handler_error…；`WatchHandle` + `LaneSnapshot` 快照；`reduceLaneSnapshot` reducer 供前端增量）；`harness/telemetry.ts` 事件跨度（openTelemetry 风格 typed spans）。
- 事件清单（coding-agent，节选）：project_trust、resources_discover、session_start / before_switch / before_fork / before_compact / session_compact(_failed) / before_tree / session_tree / session_shutdown、context（可返回 context 文件改写）、before_provider_request / before_provider_headers / after_provider_response、before_agent_start / agent_start / agent_end / agent_settled、ui_prompt_start/end、turn_start/end、message_start/update/end（message_end 可改结果）、model_select、thinking_level_select、tool_execution_start/update/end、tool_call（输入可变、可 block）、tool_result（可改写结果）、user_bash、input（可 transform/handled）、message_end 等。
- 语义要点：tool_call 事件输入**可变**（就地改参数，后续 handler 可见，改后不再 re-validate）；扩展可用返回值 block/改写；UI 上下文（confirm/select/input/widget/footer）由 ExtensionUIContext 提供；错误由 session 层隔离进 handler_error，不拖垮 run。
- 优点：事件面全且类型严格（联合类型逐事件编译期保证）；hooks 同时落在公开 Agent（beforeToolCall/afterToolCall）与 harness 内核（transform_context 等内核级注入点），扩展性内建；event 全量可订阅（审计/UI/遥测）；watch+snapshot 适合远程转录（chord 协议）。
- 缺点：coding-agent 扩展事件与 harness HookMap 是两套平行 API（迁移期需适配）；扩展是进程内 TypeScript，坏扩展可影响宿主（依赖项目信任缓解）；事件数量大、无优先级文档（按注册序聚合）。

## H07 Permission/Safety

- 实现位置：`packages/coding-agent/src/core/project-trust.ts`、`core/trust-manager.ts`（`ProjectTrustStore`：`~/.pi/agent/trust.json`，按 canonical 目录记 true/false/null，最近祖先决策生效，proper-lockfile 同步锁）、`cli/project-trust.ts`（启动 trust 选择器）、`core/resource-loader.ts`（reload 时按 trust 决定是否加载 project 资源）。
- 模型与范围：**没有工具级权限/审批系统**——README 与 docs/security.md 明说：“Pi does not include a built-in permission system… runs with the permissions of the user”。唯一的门是 **Project Trust**：仅当项目目录存在“需信任资源”（`.pi/settings.json`、`.pi/extensions|skills|prompts|themes`、`.pi/SYSTEM.md|APPEND_SYSTEM.md`、cwd 或其祖先 `.agents/skills`）且无已存决策时，按 `defaultProjectTrust`（默认 `"ask"`）询问“信任该项目吗”（Trust / Trust parent / Trust this session only / Do not trust）。信任=允许加载项目本地 settings/扩展/技能/提示/主题/SYSTEM.md；拒绝=跳过这些资源。AGENTS.md/CLAUDE.md 上下文文件**不受信任门限制**（总是加载，除非 `--no-context-files`）。
- 非交互模式（print/json/rpc）不弹窗：`"ask"/"never"` 忽略受保护资源，`"always"` 信任；`--approve/-a` / `--no-approve/-na` 单次覆盖。扩展事件 `project_trust` 可代答（首个返回 yes/no 的扩展拥有决定权）。
- 其它边界：工具 denylist `--exclude-tools`/`noTools`；bash 命令无审批、默认无超时上限（可传 timeout）；无 deny 列表、无 YOLO 模式概念。
- 优点：理念清晰务实——trust 只防“仓库静默改你的 agent”，不假装能防提示注入/恶意输出；明确文档化（security.md 整页解释边界与 prompt-injection 是预期本地 agent 风险）；trust 决策落盘且支持祖先继承 + session-only 临时信任。
- 缺点：对模型行为零约束（可读写任意该用户可写的文件、跑任意命令、网络全通——都需外部容器解决，见 H08）；无权限规则语言（相比 Claude Code/OpenCode 的 permission rules 与 Codex 的 allow/ask/deny 弱）；`-a/-na` 仅针对项目信任不针对工具；SDK 嵌入者只能自己包 ExecutionEnv/扩展做门。

## H08 Sandbox

- 实现位置：**无内建沙箱**（docs/security.md “No Built-in Sandbox”一节明确）。所有执行 = 本机子进程（coding-agent `core/tools/bash.ts` spawn、`core/exec.ts`、`core/bash-executor.ts`）；扩展 TypeScript 与宿主同权限。
- 官方给出的隔离模式（docs/containerization.md）：
  1. **Gondolin extension**（`examples/extensions/gondolin`）：宿主跑 pi、把 read/write/edit/bash/grep/find/ls 与用户 `!` 命令路由进本地 Linux 微 VM（QEMU），cwd 挂载为 /workspace 写穿宿主，provider auth 留在宿主；
  2. **Plain Docker**：整进程进容器，bind-mount 工作区（写穿），密钥进容器；
  3. **OpenShell**（NVIDIA 策略沙箱，可远程 gateway）：整进程进策略边界，可配置 inference.local 代理密钥；
  4. **Docker Sandboxes (sbx)**：整进程进托管沙箱，密钥留在宿主（sbx 代理在出口注入）。
- 对应架构钩子：pi-agent-core 的 `ExecutionEnv`（FileSystem+Shell 能力接口）与 coding-agent 工具的 *Operations 注入点是“把执行重定向到别处”的官方扩展机制（docs 明示 override to delegate to remote systems）。
- 优点：诚实且有章法——不提供“看起来像隔离其实不是”的半吊子内建沙箱；把真实隔离交给 OS/容器/微 VM 并给四套现成模式；ExecutionEnv/Operations 抽象让自研 sandbox 后端可行（WriteTools 等已有 SSH 重定向注释）。
- 缺点：默认安装 = 零隔离（模型输出可直接 rm -rf / 读 .env / 联网），需要用户自行选容器方案才安全；每套模式都要额外运维（QEMU/Docker/OpenShell/sbx）；文件系统隔离不由 harness 本身施加，测试/自动化时容易忘。

## H09 Session/Memory

- 实现位置：
  - coding-agent：`packages/coding-agent/src/core/session-manager.ts`（SessionEntry 树、create/resume/fork/clone、label）、`modes/interactive` 的 `/tree`、`/fork`、`/clone`、`/session`；会话文件 JSONL：`~/.pi/agent/sessions/--<cwd>--/<ts>_<uuid>.jsonl`（docs/session-format.md：v1 线性 → v2 树 → v3 角色更名，加载自动迁移）。
  - harness 层（新一代持久化）：`packages/agent/src/harness/session/{session,memory,commit,fork,values,types}.ts` + `session/jsonl/`（codec/repo/storage/legacy-v3：事务提交、usage ledger、值存储 values、fork 快照）+ `packages/session-backends/sqlite-node/src/sqlite/`（SQLite Storage/Repo、migrations、branch-entries、usage-ledger、benchmark/conformance 测试）——后端经 Storage 接口可插拔（in-memory / JSONL / SQLite）。
  - 会话=分支树记忆：每条 Entry 有 id/parentId，活动位置=当前 tip；跨会话无隐式记忆（无 embedding/向量记忆），上下文知识来自 AGENTS.md/技能/用户提示。
- 核心机制：Entry 类型：user/assistant/tool(结果)/bashExecution/custom(message)/model_change/thinking_level_change/label/compaction/branch_summary/usage 等（session-manager.ts + messages.ts 声明合并）。交互命令：`/tree`（原文件内切换叶子，可 label、可摘要被弃分支）、`/fork`（从旧 user 消息建新会话文件）、`/clone`（复制当前活跃分支）、`/resume`、`/compact`、`/export`(HTML)、`/share`（私有 gist HTML）；`pi -c/-r/--session/--fork/--no-session`。删除会话用 `trash` CLI 进回收站。
- 记忆形态：历史（JSONL/SQLite 树）+ compaction 摘要 + 分支摘要（被弃分支要点）作为“压缩记忆”；无独立 memory 子系统（pi-agent-core harness 里 `session/values.ts` 的 typed values 是会话元数据存储——session name/labels/usage，非 LLM 记忆）。
- 优点：会话树在**单文件内**支持任意分支（不复制文件），导航/标签/摘要 UX 完整；JSONL v3 格式可审计、自动迁移、导出 HTML/分享易做；harness 层把 commit 序列化/事务/usage ledger/fork 快照做成可插拔存储接口，带 conformance 测试（不同后端语义一致）。
- 缺点：JSONL 单文件并发写受锁约束（SQLite 后端解决）；长会话每轮整树重放（H03）；“记忆”实际只是历史+压缩，跨会话/长期项目记忆需靠 AGENTS.md/外部文件；fork 摘要等部分 UX 依赖交互确认（非全自动）。

## H10 Skills

- 实现位置：
  - coding-agent：`packages/coding-agent/src/core/skills.ts`（发现/校验/ignore 处理、509 行）、docs/skills.md；格式化为 system prompt 的 XML 块在 `core/system-prompt.ts` 调 `formatSkillsForPrompt`，harness 侧同构函数 `harness/system-prompt.ts::formatSkillsForSystemPrompt`。
  - agent 包：`harness/skills.ts`（396 行：Skill 模型 + 显式调用 `formatSkillInvocation`/`invokeSkill`，Skill 是 name/description/content/filePath/disableModelInvocation；供 AgentHarness 的 skill 操作）。
- 位置/发现：全局 `~/.pi/agent/skills/` 与 `~/.agents/skills/`；项目（需信任）`.pi/skills/`、cwd 至仓库根各祖先 `.agents/skills/`；pi 包 `skills/` 或 package.json `pi.skills`；settings `skills` 数组（可加 `~/.claude/skills`、`~/.codex/skills` 兼容 Claude/Codex 技能）；CLI `--skill`。发现规则：`SKILL.md` 目录递归；根 `.md` 直放仅当有合法 frontmatter(description 非空) 才当技能；`.agents/skills` 忽略根 md 但要分组目录内嵌。frontmatter: name（a-z0-9-，≤64）、description（≤1024）、disable-model-invocation。实现 Agent Skills 标准（agentskills.io），对多数违规只警告（允许技能名≠目录名，跨 harness 共享友好）。
- 使用流：启动只把 name/description/location 以 `<available_skills>` XML 注入 system prompt（渐进披露）；模型用 read（或 bash）打开 SKILL.md 全文执行；`/skill:<name> [args]` 强制加载执行；`disableModelInvocation` 技能不进列表但可被应用显式调用。
- 优点：与 Anthropic/Codex 技能目录兼容（可直接复用既有技能资产）；渐进披露控制上下文成本；校验宽松（跨 harness 共享目录友好）；内容即 markdown+脚本，无运行时依赖。
- 缺点：技能正文加载完全靠模型自觉（文档明示不总照做，靠提示/`/skill:` 兜底）；无技能内资源打包（脚本放同目录，靠相对路径约定）；无内置技能运行隔离（技能可引导任意操作，security 明示先审阅）。

## H11 Subagent

- 实现位置：**无内建 subagent 原语**。coding-agent README 明示“ships with powerful defaults but skips features like sub agents and plan mode”——要子代理就装第三方 pi 包或让模型自建。
- 社区/官方形态（example 扩展）：`packages/coding-agent/examples/extensions/subagent/index.ts`（1038 行，官方示例但属扩展而非内核）：对每次 subagent 调用 spawn **独立 pi 进程**（隔离上下文窗），用 JSON 模式捕获结构化输出；三种模式 single / parallel(≤8 task,≤4 并发) / chain({previous} 占位符)；`agents.ts` 定义 agent 名称（默认值来自各自系统提示）；结果截断 PER_TASK_OUTPUT_CAP 50KB、临时目录 mkdtemp；还有 `examples/extensions/gondolin` 与社区 `pi-interactive-subagents` 等多进程扩展。
- harness 内核里可组合的分发能力：多 lane/session 并行 run、`runInBackground`/steer、fork（`harness/session/fork.ts` 快照复制到新会话文件/存储）、`fork-policy.ts`；`coding-agent` 的 session-worker / experimental server-client / mini worker-lane 结构支持“多 worker 会话”实验骨架（experimental/ 下 session-worker-manager、worker、mini 的 lane-service）——但没有“task 工具→ 子会话→ 结果回投”的开箱链路。
- 优点：设计取舍清晰（保持内核小，把 subagent 变成可安装扩展/可复制的 pi 包形态，用户按需选实现）；进程级隔离的方案天然上下文隔离且便于 JSON 收结构化结果。
- 缺点：无内建 = 默认用户拿不到（需手动装 example/第三方包）；进程派生开销大、无共享上下文/检查点（仅文件/JSON 传参传结果）；chain/parallel 均需扩展自行实现编排；agent 包也无“递归 agent 调用”API 暴露给公开 Agent（只有 harness lane 并发原语）。

## H12 Evaluator

- 实现位置：`packages/evals/`（README + `src/pi-harness.ts`、`src/smoke.eval.ts`、`src/extensions.eval.ts`、`src/vitest-evals/{harness-table,setup,reporter,summary,artifacts}.ts`）、根 `npm run eval`。
- 形态：Pi evals 是**行为级、模型回代、测试即 eval** 的检查：适配开源 [vitest-evals](https://github.com/getsentry/vitest-evals)（describeEval/it/断言/归一化 trace/judge）到真实 `AgentSession`（`createPiCodingAgentHarness`：临时 workspace+agent 目录、ModelRuntime.create 选 provider/model（CLI 或 PI_PROVIDER/PI_MODEL）、可选 noTools/transformSystemPrompt、每步 prompt→ 断言最终 assistant 文本与 usage、把真实 JSONL 会话挂为 artifact）。
- 断言示例：`expect(result.output.trim()).toBe("Paris")`、errors 空、usage.provider/model/totalTokens>0。评测脚本在隔离临时目录跑，产物 `runs.jsonl` + `sessions/` 附件（可含 prompt/源码/工具输出）；vitest-evals harness-table 支持 baseline vs candidate 对照（改 prompts/tools/skills/models 的回归测量）。文档定位：用真实 dev 工作流衡量端到端行为，而非 toy benchmark。
- 说明：这是**针对 harness 配置的端到端行为评测**，不是内置的“judge/grader 子系统”；运行时无 per-run 的自动 LLM 裁判 API（judge 概念来自 vitest-evals 上游）。
- 优点：真实会话与真实模型、可换 provider/model 做 A/B；能测系统提示/技能/工具/模型差异对行为的影响；产物可审计（session JSONL 落盘）；与 vitest 同构低门槛。
- 缺点：eval 即模型调用（成本/时间高，未设 key 会跳过）；断言以最终文本为主（无逐步过程打分）；覆盖点少（smoke/extensions 两例，仍处于起步形态）。

## 行为要点提取（供 Behavior IR）

- Pi 是"最小终端 coding harness"哲学：默认只给 read/bash/powershell/write/edit/grep/find/ls 8 个工具 + 扩展机制，缺省不含 subagent/plan 等重特性（README 明示）。
- 上下文 = 会话 Entry **树**（JSONL v3，id/parentId），活动位置即 tip；换分支=换 tip 重建上下文，不复制文件；/tree /fork /clone /label /branch-summary 构成导航记忆体系。
- 自动压缩按 `contextTokens > contextWindow - reserveTokens(16k)` 触发、`keepRecentTokens(20k)` 保留尾部；切点禁止落在 tool result 中段，大 turn 走 split-turn 双摘要；压缩/分支摘要走独立 LLM 调用（fresh session、禁 prompt-cache 写入）。
- 压缩是"摘要 + firstKeptEntryId 后真实消息"拼接，而非重放式；重复压缩从上次保留边界续算不漏幸存消息。
- 无工具级权限/审批：唯一门是**项目信任**（trust.json 按 canonical 目录存 true/false/null、最近祖先生效），只控制是否加载项目本地 settings/扩展/技能/提示/主题/SYSTEM.md；AGENTS.md/CLAUDE.md 不受信任门约束。
- 安全模型明示：无内建沙箱，等同启动用户权限；官方推荐 4 种外部隔离（Gondolin 微 VM 路由工具、Plain Docker、OpenShell、sbx）；工具 Operations/ExecutionEnv 注入点是重定向执行（SSH/容器）的官方扩展位。
- 技能采用 Agent Skills 标准：启动仅注入 name/description/location 的 `<available_skills>` XML，模型先 read SKILL.md 再执行（渐进披露，模型不总自觉）；兼容 ~/.claude/skills 与 ~/.codex/skills。
- AGENTS.md / CLAUDE.md / AGENTS.override.md 从 agentDir 与 cwd 祖先逐层收集、去重、git worktree shadow 去重后整文注入 `<project_context>`；`--no-context-files` 可关。
- 提示词是单一长字符串（角色→tools 列表→按工具集联动的 guidelines→pi 自文档按需读→context 文件→技能 XML→cwd），无结构化 message 数组；工具可见性反作用于 guidelines（有 grep/find/ls 就不鼓励 bash 探索）。
- 事件面丰富且类型化：扩展事件 30+ 种（tool_call 输入可变、可 block；message_end/tool_result 可改写结果；before_provider_headers 可改厂商请求头）+ harness 内核 HookMap（transform_context/before_payload/after_response/before_tool/before_compaction/before_navigation 等）两套并存。
- 工具 schema 由 TypeBox 定义贯穿校验/提示/UI；并行工具执行先顺序 preflight（before_tool block 语义）再并发；文件变更经互斥队列；bash 输出有界截断 + 全量落盘回读。
- 会话记忆 = 历史树 + 压缩/分支摘要，无向量/embedding 长期记忆层；跨会话知识靠 AGENTS.md/skills/用户提示注入。
- subagent 非内建：官方以"spawn 独立 pi 进程 + JSON 模式收结构化输出"的扩展实现（single/parallel/chain），内核只给多 lane/fork/并发原语。
- 评测 = vitest-evals 适配真实 AgentSession 的行为级模型回代测试（npm run eval，PI_PROVIDER/PI_MODEL 选模型），可 A/B 提示词/技能/工具/模型；产物含真实 session JSONL。
- 无 MCP 客户端抽象、无引用库/RAG、无 per-tool permission rules、无 plan mode、无内置 yolo/readonly 开关（只读由 --exclude-tools / noTools 或容器只读挂载达成）——相对同类 harness 的明确"非目标"清单。

## 参考来源

- 仓库根：`README.md`（Permissions & Containerization 声明、包清单、发布/构建说明）
- 包文档：`packages/agent/README.md`、`packages/ai/README.md`（供应商清单/Auth/Tools/事件/思考/上下文序列化）、`packages/coding-agent/README.md`、`packages/evals/README.md`
- 安全/边界：`packages/coding-agent/docs/security.md`、`docs/containerization.md`、`docs/sessions.md`、`docs/compaction.md`、`docs/skills.md`、`docs/session-format.md`、`docs/settings.md`
- 源码精读（packages/agent/src）：`agent-loop.ts`、`agent.ts`、`types.ts`、`index.ts`、`harness/agent-harness.ts`、`harness/hooks.ts`、`harness/system-prompt.ts`、`harness/types.ts`、`harness/context.ts`、`harness/compaction/compaction.ts`、`harness/runtime/lane.ts`、`harness/runtime/drive*.ts`、`harness/execution/*.ts`、`harness/session/*.ts`、`harness/skills.ts`
- 源码精读（packages/coding-agent/src）：`core/agent-session.ts`、`core/sdk.ts`、`core/main.ts`、`core/system-prompt.ts`、`core/resource-loader.ts`、`core/skills.ts`、`core/trust-manager.ts`、`core/extensions/types.ts`、`core/tools/index.ts`、`core/tools/bash.ts`、`core/compaction/*.ts`
- 源码精读（其它）：`packages/evals/src/pi-harness.ts`、`packages/session-backends/sqlite-node/src/sqlite/`、`packages/coding-agent/examples/extensions/subagent/index.ts`
- 克隆位置（临时目录，不在项目内）：`%TEMP%/pi-mono-research`
