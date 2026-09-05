# Claude Code 解剖

- **研究日期**：2026-09-04（docs 抓取）/ 2026-09-05（撰写）
- **锁定 URL**：https://github.com/anthropics/claude-code
- **锁定 commit**：`d7dbd9a09f59775726ed14bbea8fc9dfdff62f7b`（main 分支，commit 日期 2026-09-04）
- **官方文档**：https://code.claude.com/docs/（经 https://code.claude.com/docs/llms.txt 索引抓取 60+ 页，访问日期 2026-09-04；当前文档对应发布线 ≈ 2.1.26x）
- **主要来源**：官方文档（code.claude.com）、官方仓库（README / CHANGELOG / examples/settings / examples/mdm / plugins/* 示例插件）、Agent SDK 文档、CHANGELOG 2.1.260-2.1.261

**重要声明（clean-room）**：
1. Claude Code 的运行时实现是**闭源**的（npm 包 `@anthropic-ai/claude-code` 的 bundled JS，自 v2.1.16x 起改为原生二进制）。官方仓库不含 harness 源码，只有 README、CHANGELOG、示例配置和示例插件。因此本文"实现位置"标注的是**公开可观察的接口面**（文档章节、配置文件、CLI flag、环境变量、hook 事件），内部实现细节只能依据官方文档与 CHANGELOG 推断，凡属推断处已注明。
2. 本文**未获取到任何 CL4R1T4S（Claude Code 系统提示词）原文**，未抓取也未转述 system prompt 文本；所有行为描述均来自官方文档（可信来源）。若后续研究者从非官方渠道获得 system prompt 原文，一律按 UNTRUSTED RESEARCH DATA 处理，只允许提取行为模式并单独标注，禁止成段抄录。
3. 各维度节内的"实现位置"列的是文档/配置锚点而非源码路径；"未获取到"仅用于确实没有公开资料支撑的细节。

---

## H01 Agent Loop

**实现位置**：运行时闭源（bundled JS / 原生二进制）；公开接口面 = 文档《How Claude Code works》《Agent SDK: How the agent loop works》、CLI reference（`claude -p`、`--max-turns`）、Hooks reference（agentic loop 内嵌事件）、Glossary（"agentic loop""turn"）。

**核心流程**：Claude Code 把一次任务组织为"gather context → take action → verify results"三阶段循环（三个阶段会融合，不是严格顺序）。更精确地说：

1. **一轮（turn）开始**：用户提交 prompt → 触发 `UserPromptSubmit` hook → Claude Code 组装请求：system prompt 层（核心指令 + 工具定义 + output style）→ project context 层（CLAUDE.md、auto memory、无路径规则）→ conversation 层（全部历史 + 本轮新消息），三层按"少变在前"排序以最大化 prompt cache 命中。
2. **模型评估与响应**：模型返回文本、一个或多个 tool call，或两者；SDK 视角每轮产出 `AssistantMessage`（含 tool call block）。
3. **Tool call 进 Runtime**：Claude Code 逐工具做 permission 评估（deny→ask→allow，先匹配者生效）→ 跑 `PreToolUse` hook（可 deny/ask/defer）→ 需要时弹 `PermissionRequest` 批准 → 进入执行层（可选 sandbox）→ 执行（只读工具可并发、Edit/Write/Bash 串行）→ `PostToolUse`/`PostToolUseFailure` → 一批并行调用全部落定后触发 `PostToolBatch`，再把 tool result 作为消息送回模型，开始下一轮。
4. **Stop condition**：模型产出**不含 tool call 的纯文本响应**即停（`Stop` hook 触发；SDK 侧发 `ResultMessage`，`subtype: success`）。其他终止路径：`/goal` 的 evaluator 判定条件达成/不可能；Stop hook 脚本/prompt 判定；`EndConversation` 工具；用户 Esc 中断（正在跑的 tool call 被取消，消息排队下轮发）；API 错误（`StopFailure`）。
5. **最大轮次**：交互会话默认**无轮次上限**（依赖模型自己收尾）；非交互 `claude -p --max-turns <n>`、Agent SDK `maxTurns`（只计 tool-use 轮）、`--max-budget-usd`（按花费封顶，subagent 花费计入）；子代理用 frontmatter `maxTurns`（达限返回 partial 输出，主代理可 resume）；`/goal` 条件里可写 "or stop after 20 turns" 子句；`/loop` 是定时轮询循环。workflow 另有 1000 agents/run 上限。
6. **Retry / Error Recovery**：API 无响应头时按 `API_TIMEOUT_MS`（默认 10 分钟）等待重试；rate limit/overloaded 自动退避重试；fallback model chain 在模型不可用时换链上第一个可用模型（subagent 同规则）；Fable 模型的 safety classifier 触发自动模型回退；子代理被 API 错误截断时保留 partial 文本并明确标记"未完成"而非假装结果；`StopFailure` hook 可挂钩处理（matcher 可按错误类型：rate_limit/overloaded/authentication_failed 等）；auto-compact thrashing 保护（连续几次压缩后上下文立刻回满 → 停止自动压缩并报错，不空转烧钱）。

**关键机制**：
- 请求三层前缀缓存：系统提示层/项目上下文层/会话层按变更频率排序；切换模型、改 effort、连 MCP、改 deny 工具、compact、升级都会使缓存失效。
- 并行工具执行：只读类（Read/Glob/Grep/只读 MCP）并发，状态修改类（Edit/Write/Bash）串行；自定义 MCP 工具默认串行，靠 `readOnlyHint` 注解开启并发。
- 中断模型：Esc 立即停；不打断正在跑的工具，直接输新消息则下轮生效（steer-in-flight）。

**优点**：循环语义简单（"无 tool call 即停"）且对外可观测（SDK 五类消息流：SystemMessage/AssistantMessage/UserMessage/StreamEvent/ResultMessage）；每轮请求做三层前缀缓存，长会话成本被压得很低；并行工具调度区分读写，兼顾吞吐与一致性；错误面完整（StopFailure、partial output、fallback chain、thrashing 保护）。
**缺点**：交互模式无默认轮次上限，开放任务可能无限循环（官方把"给一个可验证的检查"列为最佳实践而非强制）；运行时代码闭源，循环内部细节（请求组装、缓存断点插入位置）只能黑盒观察；`/goal` 的 evaluator 只能读 transcript 不能自己跑命令，条件写不好会误判。

---

## H02 System Prompt

**实现位置**：运行时闭源；公开可配置面 = CLI flags（`--system-prompt`/`--system-prompt-file` 整体替换、`--append-system-prompt`/`--append-system-prompt-file` 追加、`--agents` 的 `prompt` 字段、`--append-subagent-system-prompt`）、`output-styles/`（自定义 system prompt 段落）、`--exclude-dynamic-system-prompt-sections`、subagent frontmatter body。

**组成与注入顺序**（依据官方《Explore the context window》模拟数据，token 数为示意）：
1. **System prompt（Base）**：核心行为指令 + 工具使用说明 + 响应格式，~4.2K token，**最先加载且用户不可见**；其中含"动态段"——工作目录、平台、shell、OS 版本、是否 git 仓库、git 分支/状态/近期提交（git 段在 system prompt 末尾单独成块）。这些每机每目录不同，因此 prompt cache 以"机器+目录"为作用域。
2. **Auto memory**：MEMORY.md 前 200 行或 25KB（先到者）在会话开始时注入（作为项目上下文层，位于 system prompt 之后）。
3. **环境信息**：cwd/platform/shell/OS/git 状态（~280 token）。
4. **MCP 工具（默认延迟）**：只列工具名与 server 说明（~120 token）；完整 schema 由 ToolSearch 按需加载；`ENABLE_TOOL_SEARCH=auto` 可在占用 ≤10% 窗口时预载，`=false` 全量预载。
5. **Skill 描述索引**：每 skill 一行描述（~450 token），完整内容仅在实际调用时注入；`disable-model-invocation: true` 的 skill 不进索引。
6. **用户级 CLAUDE.md**（`~/.claude/CLAUDE.md`，~320 token）→ **项目 CLAUDE.md**（~1800 token，建议 <200 行）→ 无路径 rules → 更深目录的 CLAUDE.md。
7. **用户 prompt** 与后续对话。

**注入顺序规则**：managed policy CLAUDE.md → 用户 CLAUDE.md → 项目 CLAUDE.md → CLAUDE.local.md；目录树上从文件系统根向下到 cwd 依次拼接（更接近 cwd 的指令**读在后面**，即优先级更高）；同目录内 CLAUDE.local.md 附在 CLAUDE.md 之后。**CLAUDE.md 是以"user message"注入，不是 system prompt 的一部分**——这是官方明确的行为差异（Glossary 与 troubleshooting 都确认：CLAUDE.md 内容是作为 system prompt 之后的用户消息送达的）。

**关键机制**：
- Base（Claude Code 身份）与项目指令分层：`--system-prompt` 整体替换默认身份（会丢掉全部工具引导与安全指令，官方警告自行负责）；`--append-system-prompt` 保留身份追加规则；output style 也是 system prompt 的一部分，会话启动时固定（中途改不生效，为保缓存）。
- 动态内容按"缓存友好"策略注入：plan mode 指令、skill/command 内容都以 conversation message 追加，不动已缓存前缀；output style 和 CLAUDE.md 启动时读一次、会话中修改不生效。
- Subagent 只拿到"自己的 prompt + 环境细节"，**不含** Claude Code 主 system prompt；`--agent` 启动时该 prompt 完全替换默认 system prompt。
- `--exclude-dynamic-system-prompt-sections`：把每机动态段（工作目录、环境信息、内存路径、git 标志）移进第一条 user message，用于跨机/跨用户共享 prompt cache。

**优点**：分层清晰（Base/输出风格/项目指令/会话指令），替换/追加两个方向都可控；把 CLAUDE.md 放 user message 层让"指令是建议不是硬约束"的语义显式化；动态段移到消息层是缓存工程上的精巧设计。
**缺点**：system prompt 本体完全闭源且随版本变（升级即缓存全失效）；注入顺序只通过文档示例可见、无机器可读规范；output style 中途修改不生效，容易让用户困惑（文档用大段 FAQ 解释）。

> CL4R1T4S 相关：本文未获取到任何 system prompt 原文；上文的"核心指令/工具说明/响应格式"仅为文档对该层的功能描述（可信来源），不是原文转述。

---

## H03 Context Engine

**实现位置**：运行时闭源；公开面 = 《Explore the context window》（交互式时间线，官方自述"what loads automatically, what each file read costs, when rules and hooks fire"）、《How Claude Code uses prompt caching》、《How Claude remembers your project》、`/context`（`/context` 显示当前占用）、`/cost`/statusline `current_usage`、`debug-your-config`（`/doctor`）、`costs`。

**各类内容如何进上下文**：
- **System**：每次请求都带（缓存）。
- **User/对话历史**：每轮追加，永不重置（除非 /clear//compact）；文件读取结果以 tool result 形式入会话层。
- **Project（CLAUDE.md 体系）**：启动时加载 cwd 到根的所有 CLAUDE.md/CLAUDE.local.md + 无 `paths` 的 rules（拼接而非覆盖）；子目录里的 CLAUDE.md 与 `paths:` 规则在**首次读取匹配文件时按需加载**（`InstructionsLoaded` hook 可观测加载原因：session_start/nested_traversal/path_glob_match/include/compact）。
- **Memory**：MEMORY.md 前 200 行/25KB 启动注入；topic 文件不入会话，Claude 用标准文件工具按需读。
- **Skills**：描述索引启动注入；正文按需注入，注入后跨轮保留（compact 后按每 skill ≤5000 token 重新注入）。
- **Tool 定义**：内建工具每次请求全量带；MCP schema 默认延迟（ToolSearch），避免闲置 server 吃上下文。
- **Files**：由 Claude 主动 Read 进入；读取结果可被截断（见下）。
- **RAG**：Claude Code 无独立 RAG 子系统；近似物是 auto memory（MEMORY.md 索引 + topic 文件按需读）与 path-scoped rules（按文件路径触发），均为"小索引 + 按需拉取"模式。

**加载顺序与优先级**（启动时）：System prompt → auto memory → env info → MCP 工具名（延迟）→ skill 描述 → 用户 CLAUDE.md → 项目 CLAUDE.md →（用户 prompt）。运行中：path 规则 / 嵌套 CLAUDE.md / skill 正文 / MCP schema 全部按需加载，谁先触发谁进。

**Token Budget**：无用户可配的硬预算（窗口由模型决定：200K 或 sonnet[1m]/opus[1m] 1M）；有一组**软上限与截断**：
- Bash/任务输出：`bashOutputMaxChars`/`taskOutputMaxChars` 默认截断，超限存文件、给模型预览+路径（上限可提到 128K 字符）。
- Hook 输出：>10,000 字符存文件，模型收到预览+路径；`additionalContext` 才进上下文，exit 0 的 stdout 只进 debug log。
- Skill 描述列表：description+when_to_use 合并截断 1,536 字符；subagent 描述合计 >15,000 token 启动警告。
- CLAUDE.md：>4 MiB 直接跳过；建议 <200 行；MEMORY.md 超 200 行/25KB 时写入会收到"重写索引"错误。
- 图片/PDF：按 API 请求上限整批移除最老的（每批一次慢轮）。

**Trimming**：三层顺序——先清旧 tool output（保留你的请求与关键代码片段）→ 仍不够则 summarize 对话（compaction）→ 单文件/单输出过大导致反复回满则停止自动压缩报 thrashing 错误。`/context` 提供当前占用视图；`/compact focus on X` 可指导摘要焦点。

**污染防护**：
- auto mode classifier **看不到 tool results**（提交给分类器的内容剥离了工具输出），文件/网页里的敌对文本无法直接操纵它；另有 server-side probe 扫描 tool result。
- Subagent output scanning（v2.1.210+）：子代理报告若模仿 `<system-reminder>` 或 `Human:/Assistant:` 行则插反斜杠；提及 `bypassPermissions`/`--dangerously-skip-permissions` 则加 `[harness: ...]` 标记行（不改写内容，真正防护靠权限与 sandbox）。
- WebFetch 用独立上下文窗口隔离抓取内容。
- 来自 claude.ai 的 synced skill 描述会转义尖括号、清洗控制字符，防其冒充内部格式。
- CLAUDE.md 的块级 HTML 注释注入前剥离；外部 `@import` 首次需批准。
- 文件变更通知：Claude 读过的文件被外部编辑时，追加 `<system-reminder>` 通知而非篡改历史（保缓存）。

**优点**：官方用一整页交互式模拟把"什么在什么时候进上下文、各花多少 token"讲得极清楚，工程上把"不变前缀 + 按需加载 + 分层截断"组合得很成熟；污染防护有分层（classifier 盲化、子代理输出扫描、synced 内容消毒、独立 fetch 上下文）。
**缺点**：无用户级 token 预算控制（只能靠 /context 观察与 /compact 干预）；MCP 延迟加载在旧模型/特定 provider 上回退为全量预载；截断策略不可配（如图片移除批次大小不可调）；RAG 缺失，超长记忆靠 MEMORY.md 索引手工维护。

---

## H04 Compaction

**实现位置**：运行时闭源；公开面 = 《Explore the context window》"What survives compaction"、prompt-caching "Compacting the conversation"、model-config "auto-compact window"、hooks `PreCompact`/`PostCompact`、checkpointing "Summarize"、troubleshooting "thrashing"、Agent SDK `compact_boundary` 消息、CLAUDE.md 里可写 "Compact Instructions" 段。

**何时压缩**：上下文接近模型窗口上限时**自动**压缩（`/compact` 手动可随时触发，可带焦点指令）；`/goal` 或长任务前官方建议手动在自然断点压缩；恢复一个超 100K token、闲置 >1h 的会话时（Pro/Max）弹出"resume from summary"对话框，可选立即压缩。

**压缩什么**：按顺序——先清除旧 tool outputs → 再把剩余对话整体 summarize。摘要由一次独立请求产生：**相同的 system prompt + tools + 历史**，末尾追加一条总结指令作为最后一条 user message（缓存热时该请求读前缀缓存，费用很低；缓存冷时最贵，例如恢复旧会话后立即压缩）。

**保留什么**（官方明确清单）：
- 你的请求与意图、关键技术概念、检查/修改过的文件及重要代码片段、错误及修复方式、未完成任务、当前工作。
- 启动内容（system prompt、CLAUDE.md、auto memory、MCP 工具）在压缩后**自动重载**（CLAUDE.md 从磁盘重读；仅当与启动时一致才命中缓存）。
- **重读最多 5 个最近修改的文件** + 重新加载匹配它们的 path rules。
- **重新注入调用过的 skill 正文**（每个 ≤5000 token）。
- **不保留**：完整 tool 输出、中间推理；skill 描述索引**不重注入**（启动后一次性的）；只存在于对话里的早期指令可能丢失（官方据此建议持久规则写进 CLAUDE.md）。

**Tool Call/Result 完整性**：压缩后的历史不再包含逐条 tool call/result（进摘要）；但 `/rewind` 菜单的 "Summarize from here / Summarize up to here" 只是压缩上下文，**原始 transcript 留在磁盘**，Claude 仍可经 `/export` 或后续读文件引用细节。`PreCompact` hook 可先归档完整 transcript 再压缩。

**是否新 Session**：不是。压缩在同一 session 内原地替换消息历史（SDK 发 `compact_boundary` 事件；`/clear` 才是另起新会话，且旧会话可 `/resume` 或在同进程 rewind 菜单里恢复）。

**状态恢复**：resume-from-summary 三选项（摘要恢复 / 原样全量恢复 / 不再询问）；压缩后 `SessionStart` matcher 支持 `compact`/`clear` 等触发原因；workflow/subagent 在压缩进行中不会被误判为 stalled（2.1.26x 修复）；auto-compact 连续数次无效即停并报 `Autocompact is thrashing`，提示 `/compact keep only the plan and the diff` 式聚焦。

**优点**：有非常清晰的"保留清单"（用户请求、关键文件、调用过的 skill、5 个最近文件），且压缩请求复用缓存前缀，成本透明；PreCompact/PostCompact hook 让外部系统可归档；thrashing 保护避免死循环烧钱。
**缺点**：摘要由模型生成，信息损失不可控（官方明示"早期指令可能丢"）；压缩阈值/保留文件数（5 个）不可配；"Compaction instructions" 段只能靠模型意图匹配（标题任意），无结构化指令。

---

## H05 Tool System

**实现位置**：运行时闭源；公开面 = 《Tools reference》（完整工具清单、每工具行为与权限要求）、`mcp.md`/`mcp-quickstart`、Agent SDK `custom-tools`/`tool-search`、`commands.md`（内建命令）、`settings`（permissions/hooks）、`env-vars`、CLI flags（`--allowedTools`/`--disallowedTools`/`--tools`/`--mcp-config`）。

**内建工具集**（v2.1.26x，约 40+，按官方分类）：
- 文件：`Read`、`Edit`、`Write`、`NotebookEdit`、`LSP`（代码智能：跳转定义/查引用/类型错误，需 code intelligence 插件）
- 搜索：`Glob`、`Grep`
- 执行：`Bash`、`PowerShell`（Windows 原生）
- Web：`WebSearch`、`WebFetch`（另有 Chrome/computer use 等平台工具）
- 编排：`Agent`（spawn subagent）、`Skill`、`TaskCreate/Get/List/Update`、`TodoWrite`（默认被 task 工具取代）、`Workflow`、`AskUserQuestion`、`ToolSearch`、`WaitForMcpServers`
- 后台/调度：`Monitor`、`CronCreate/Delete/List`、`ScheduleWakeup`、`TaskStop`、`TaskOutput`（已废弃，改读输出文件）
- 会话/通信：`EndConversation`、`EnterPlanMode`/`ExitPlanMode`、`EnterWorktree`/`ExitWorktree`、`SendMessage`、`ListAgents`、`ListMcpResourcesTool`、`ReadMcpResourceTool`、`Artifact`、`PushNotification`、`SendUserFile`、`ReportFindings`、`RemoteTrigger`、`ShareOnboardingGuide`、`SendFeedback`

**Schema / Registry**：内建工具定义进 system prompt 层；MCP 工具命名 `mcp__<server>__<tool>`（插件内嵌 server 用 `mcp__plugin_<plugin>_<server>__<tool>` 作用域名）；MCP 还提供 resources/prompts；工具 canonical name 用于 permission 规则、hook matcher、subagent tools 列表三处（显示标签可能不同，如 "Stop Task" 的 canonical 是 `TaskStop`）。

**Dispatch 流程**：模型请求 tool call → permission 评估（deny→ask→allow，先匹配生效；裸工具名 deny 会把工具从上下文移除）→ `PreToolUse` hook（可 deny/改输入）→ `PermissionRequest`/classifier → sandbox 边界 → 执行（读并发/写串行）→ `PostToolUse`/`PostToolUseFailure` → `PostToolBatch` → result 作为 user message 回模型。

**Result / Error**：tool result 以 user message 回模型；deny 时模型收到 rejection message；hook 可改输出（`updatedToolOutput`）或追加上下文（`additionalContext`）；`PostToolUseFailure` 覆盖失败分支；MCP server 崩溃自动重连并重发；错误码文档化在 `errors.md`（如 model_not_found、max_output_tokens）。

**动态注册**：
- MCP：`claude mcp add --scope user|project|local`、`.mcp.json`（项目共享，${ENV} 引用）、`--mcp-config`、plugin-bundled servers、claude.ai connectors；支持 stdio/http/sse/ws；**动态工具更新**（server 运行时改工具列表）；**ToolSearch** 延迟加载 schema（默认开启；`alwaysLoad` 豁免、阈值预载可配）。
- 自定义工具：Agent SDK 的 in-process MCP server（`readOnlyHint` 注解控制并发）。
- 插件：可带 commands/agents/skills/hooks/MCP servers/executables（PATH）。

**特定工具行为要点**（权限面）：Bash 有内建只读命令集（ls/cat/grep/git 只读形式等）免批准；剥离 wrapper（timeout/time/nice/nohup/command 等）与安全 env 前缀后做规则匹配；compound command 按子命令拆分匹配（`safe-cmd && evil` 不会被一条 allow 放行）；重定向目标按文件规则检查；Bash 规则解析不了（>10K 字符、网络 UNC 路径等）时 fail-closed 弹批准。WebFetch 按 domain 规则 + 预批准文档域名；WebSearch 每次批准一次可记住。`EndConversation` 不能被 deny 规则移除（只要有别的工具可用）。

**优点**：工具面统一（canonical name 一套规则通吃 permission/hook/subagent）；默认延迟加载 MCP schema 的上下文工程很成熟；权限规则对 Bash 的解析（wrapper/compound/redirect）相当深，把"字符串前缀匹配"的漏洞补得很全；错误面完整且有错误码文档。
**缺点**：闭源导致无法扩展内建工具语义（只能走 MCP）；规则语法复杂（gitignore 风格路径、`*` 通配、`:` 后缀），学习成本高且易写错（官方专门给了警告清单）；工具数量膨胀（40+ 内建 + MCP），上下文与认知负担不低。

---

## H06 Hooks / Middleware / Events

**实现位置**：`hooks.md`（reference：事件 schema、JSON 输入输出、exit code、async/http/prompt/agent 四类 handler）、`hooks-guide.md`（教程）、`agent-sdk/hooks.md`（SDK 回调）；配置位置 = settings.json（user/project/local/managed）、插件 `hooks/hooks.json`、skill 与 subagent frontmatter；仓库内示例：`plugins/security-guidance/hooks/hooks.json`、`plugins/ralph-wiggum`（Stop hook）、`plugins/learning-output-style`（SessionStart）。

**事件清单（v2.1.26x，35+ 个）**，三类节奏：
- 每会话一次：`SessionStart`、`SessionEnd`、`Setup`（`--init`/`--maintenance`）
- 每轮一次：`UserPromptSubmit`、`UserPromptExpansion`、`Stop`、`StopFailure`、`TeammateIdle`
- 每次 tool call：`PreToolUse`、`PermissionRequest`、`PermissionDenied`、`PostToolUse`、`PostToolUseFailure`、`PostToolBatch`（每批并行调用落定后、下一模型调用前）
- 子代理/任务：`SubagentStart`、`SubagentStop`、`TaskCreated`、`TaskCompleted`
- 上下文/配置：`PreCompact`、`PostCompact`、`InstructionsLoaded`、`ConfigChange`、`FileChanged`、`CwdChanged`、`DirectoryAdded`
- 模型：`PreModelSwitch`（可阻止）、`PostModelSwitch`
- 工作区/通知/杂项：`WorktreeCreate`、`WorktreeRemove`、`Notification`、`MessageDisplay`、`Elicitation`、`ElicitationResult`

**配置结构（三层）**：event → matcher group（过滤触发面）→ handler（实际执行）。matcher 语义：纯字母数字/`|`/`,` = 精确名单；含其他字符 = JavaScript 正则（未锚定）。`if` 字段用 permission 规则语法再过滤（如 `Bash(rm *)`）。handler 五类：`command`（shell，stdin 收 JSON）、`http`（POST JSON，响应体同 JSON 格式）、`mcp_tool`（调已连接 MCP 工具）、`prompt`（调 Claude 单轮评估）、`agent`（spawn 子代理验证后再决策，实验性）。

**JSON 输入/输出契约**：输入含 `session_id`、`cwd`、`hook_event_name`、`tool_name`/`tool_input`（工具事件）、`agent_id`/`agent_type`（子代理内触发时）。输出 `hookSpecificOutput`：`PreToolUse` → `permissionDecision: allow|deny|ask|defer` + `permissionDecisionReason` + `updatedInput`；`PostToolUse` → `additionalContext`（进模型上下文）/`updatedToolOutput`（替换输出）；`Stop` → 决定是否继续。**exit code 语义**：0+无输出 = 无决策（不构成批准）；exit 2 = 阻止并把 stderr 给模型（PostToolUse 场景只能报错不能阻止，因工具已执行）；stdout 非 JSON 进 debug log。>10K 字符输出存文件给预览。

**关键机制**：
- 并行执行：同事件多 handler 并行跑，权限决策取最严格（任一 deny 即 deny）；定义在多个 settings 文件时去重。
- **异步 hook**：`async: true` 后台跑，`asyncRewake`/`rewakeMessage` 在完成时唤醒模型继续（security-guidance 插件对 git commit/push 的后台安全审查是官方范例）。
- hook 决策**不绕过** permission 规则（deny/ask 仍生效），且 `PreToolUse` 在 permission prompt 之前跑（EndConversation 除外）。
- 作用域与安全：`allowManagedHooksOnly` 可禁用 user/project/plugin hooks（managed 豁免）；`allowedHttpHookUrls`/`httpHookAllowedEnvVars` 白名单；subagent 内工具事件同样触发（带 agent_id）；subagent frontmatter hooks 需 workspace trust；skill frontmatter hooks 从调用起作用于本会话剩余部分。
- 超时：command/http/mcp_tool 默认 600s（UserPromptSubmit/PreModelSwitch/PostModelSwitch 30s，MessageDisplay 10s，SessionEnd 合计 1.5s 预算）。

**优点**：事件面极全（35+，覆盖循环每个决策点，甚至 PreModelSwitch/MessageDisplay/InstructionsLoaded）；五种 handler 形态覆盖 shell/HTTP/MCP/LLM/子代理；JSON 契约稳定；异步+rewake 模式解决"长 hook 不阻塞主循环"。
**缺点**：`PreToolUse` 与 permission 系统职责重叠（规则先于 hook 生效，文档专门澄清），心智负担重；prompt/agent 型 hook 是模型决策、非确定性；闭源使事件触发时序只能靠文档图（hooks-lifecycle.svg）推断；matcher 正则与精确名单的隐性切换容易踩坑。

---

## H07 Permission / Safety

**实现位置**：`permissions.md`（规则语法）、`permission-modes.md`（模式与 classifier）、`security.md`（威胁模型）、`auto-mode-config.md`、`sandboxing.md`（OS 级边界）、`settings-reference`（`permissions.*`、`sandbox.*`）、managed settings / MDM 模板（仓库 `examples/mdm`、`examples/settings/*.json`）。

**权限分层（四层叠加）**：
1. **Permission modes**（基线）：`default`(Manual)/`acceptEdits`/`plan`/`auto`/`dontAsk`/`bypassPermissions`，Shift+Tab 循环切换；Pro/Max/Team 交互会话默认 auto。
2. **Permission rules**（细粒度）：`allow`/`ask`/`deny` 三数组，**deny→ask→allow 先匹配生效**（deny 优先且不能被更细的 allow 豁免）；裸工具名 deny 把工具整体移出上下文；scoped 规则（`Bash(rm *)`、`Read(./.env)`、`WebFetch(domain:*.example.com)`、`Edit(path)`、`Agent(Explore)`、参数匹配 `Agent(model:opus)`）只拦匹配调用。
3. **Hooks**：`PreToolUse` 可 deny/ask/defer（不 bypass 规则）。
4. **Sandbox + 外层隔离**：OS 级文件/网络边界；容器/VM/worktree 可选。

**行为要点（Behavior Safety，模型/指令层）**：
- CLAUDE.md/规则是"建议不是强制"（官方反复声明：想硬拦用 PreToolUse hook 或 deny 规则）。
- **Auto mode classifier**：独立小模型后台审查动作，看不到 tool results（防注入操纵），拦 scope escalation、未知基础设施、敌对内容驱动的操作；显式 ask 规则仍强制弹窗；`PermissionDenied` 事件覆盖分类器拒绝（含无 verdict 的拒绝，可返回 `retry: true` 让模型重试）。
- 内建只读命令集免批准；`acceptEdits` 只自动批工作区内文件编辑与固定文件系统命令集。
- 网络：WebFetch/WebSearch 默认需批准；`curl`/`wget` 不在只读集（要网络就显式 allow）；UNC 路径警告（凭据泄露面）。
- 危险操作永不自批：显式 ask 规则、需用户交互的工具（AskUserQuestion/requiresUserInteraction）、`rm -rf /`、`rm -rf ~` 等 critical paths、跨会话消息安全阀——**任何模式（含 bypassPermissions）都不自动放行**。
- Workspace trust：首次进入项目弹信任对话框；未信任前不加载项目 allow 规则/插件市场/外部 CLAUDE.md import/subagent frontmatter hooks；`-p` 会话自动信任 settings hooks 但项目 agents 仍需信任。
- 防注入：上下文盲化 classifier、subagent 输出扫描、命令注入检测（可疑复合命令即使被 allow 也再确认）、fail-closed 匹配（解析不了的命令一律批准）、WebFetch 独立上下文、synced skill 消毒。

**Runtime Safety（执行层，OS/进程）**：
- Bash sandbox（Seatbelt/bubblewrap）、网络代理白名单、凭证 deny/mask、子进程环境清洗（`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` 含 Linux PID namespace）、`--restricted` 模式（给 eval harness 用：去掉执行类工具、文件工具限工作区、只读 managed 设置、禁 bypass）、worktree 隔离、云会话独立 VM + 网络控制 + 审计日志、凭据存 Keychain/受限文件权限。

**Behavior Safety vs Runtime Safety 的官方区分**：权限系统是"**模型试图做什么之前**"的检查（behavior），sandbox 是"**命令已经运行时**"的 OS 级边界（runtime）；文档明确：Read/Edit deny 规则不拦任意子进程（Python/Node 自己开文件），要 OS 级强制必须开 sandbox；auto mode classifier 拦的是"行为"，sandbox 拦的是"能力"。

**优点**：分层清晰、可叠加（模式×规则×hook×sandbox×外层隔离），且每一层都有 managed settings 强制面（disableBypassPermissionsMode/disableAutoMode/allowManagedHooksOnly/allowManagedDomainsOnly/failIfUnavailable）；"任何模式都不自批"的清单做得实在。
**缺点**：面多导致配置爆炸（settings 里 permissions/sandbox/credentials 数十个键）；bypassPermissions 存在本身就是把双刃剑（官方只推荐容器/VM 内用）；classifier 是黑盒模型决策，误杀/漏放不可本地审计；闭源使威胁模型无法独立复核。

---

## H08 Sandbox

**实现位置**：`sandboxing.md`、`sandbox-environments.md`；设置键 `sandbox.*`（enabled/filesystem/network/credentials）；平台实现：macOS **Seatbelt**（内置，零安装）、Linux/WSL2 **bubblewrap + socat**（+可选 seccomp 过滤器的 unix socket 阻断）、**原生 Windows 不支持**（须 WSL2）；`/sandbox` 面板查看模式/依赖/配置。

**workspace-only / read-only / full access 对应**：
- 默认写边界：cwd 及其子目录 + `--add-dir`/`permissions.additionalDirectories` 目录 + 会话临时目录（`$TMPDIR` 重定向到它）；worktree 会话额外允许写共享 `.git`（hooks/config 除外）。
- 默认读边界：**全盘可读**（除 denyRead/credentials deny 外），官方明示这意味着默认能读 `~/.aws/credentials`、`~/.ssh`——要防就配 `sandbox.credentials` 或 `denyRead`/`blockReadsOutsideWorkingDirectories`。
- Protected paths：`.claude` 配置、`.claude/skills|agents|commands|hooks`、`.mcp.json`、shell 启动文件、`.gitconfig`、`.vscode`/`.idea`、`.git` 内 hooks/config、`~/.claude` 大部分内容、`~/.claude.json`、凭据存储——**写保护不可豁免**（allowWrite 也不行，唯一开关是关掉整个文件系统隔离）。
- `sandbox.filesystem.disabled=true`：只留网络隔离、去掉文件隔离（仅 user/managed/`--settings` 可设，项目 settings 不能关；`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` 存在时强制保持）。

**网络**：代理进程跑在 sandbox **外**；默认无预允许域名（首次访问弹批准，auto 模式交 classifier）；`allowedDomains` 预允许；`WebFetch(domain:*)` 规则会把域名加入 allowlist；`strictAllowlist`/`allowManagedDomainsOnly` 改为硬拒绝；`HTTPS_PROXY` 等上游代理隧道；`tlsTerminate` 让代理终结 TLS 以做凭据注入；`allowUnixSockets`/seccomp 管 socket；`allowLocalBinding` 管本地监听。

**Credential 保护**：`credentials.files`/`credentials.envVars`，模式 `deny`（不可读/不注入）或 `mask`（命令看到 sentinel 占位值，出站到 `injectHosts` 白名单时由代理换回真值；支持 `extract` 正则、JWT `decode`、AWS SigV4 重签名）；macOS 文件 mask 退化为 deny。

**Shell 与逃逸面**：
- 模式：auto-allow（可沙箱化命令直接跑）vs regular permissions（沙箱化也要批准）；`allowUnsandboxedCommands` escape hatch——沙箱拒绝的命令由 Claude 分析后带 `dangerouslyDisableSandbox: true` 重试（走常规权限流）；`allowUnsandboxedCommands:false` = strict 模式（除 excludedCommands 外全必须沙箱化）。
- path escape：权限规则对 symlink 双路径检查（allow 需两边都匹配、deny 任一边匹配）；工具打开已批准文件后会复核路径仍指向原处（防 TOCTOU/symlink 换向）；worktree 场景拒绝把 git 重定向进主 checkout、命令文本无法证明 git 留在 worktree 内也拒绝。
- 命令解析逃逸：wrapper 剥离清单（timeout/time/nice/nohup/stdbuf/command/builtin/noglob + 安全 env 前缀），`devbox run`/`direnv exec`/`npx`/`docker exec` 这类执行器**不剥离**（官方警告 `Bash(devbox run *)` 会匹配到 `devbox run rm -rf .`）。
- Ubuntu 24.04+ AppArmor 需为 bubblewrap 放行 userns；WSL1 不支持沙箱。
- 外层隔离选项对比：内置 sandbox / sandbox runtime（`@anthropic-ai/sandbox-runtime`，容器级）/ devcontainer / Docker / VM（`sandbox-environments.md`）。

**优点**：OS 级强制（覆盖所有子进程）与"行为级"权限互补，官方明确这是唯一能防任意子进程读写的层；credential mask + 代理注入是非常成熟的"让工具能联网认证但拿不到真凭据"设计；escape hatch 有清晰降级路径（沙箱失败→常规权限流→显式批准）。
**缺点**：原生 Windows 无沙箱（WSL2 是 workaround）；默认读全盘（含凭据文件）需要主动加固；mask 机制复杂（sentinel/代理/TLS 终结/重签名），配置错误时静默认证失败；seccomp 过滤器是可选依赖，装了才防 unix socket 逃逸。

---

## H09 Session / Memory

**实现位置**：`sessions.md`、`memory.md`、`checkpointing.md`、`claude-directory.md`、`agent-sdk/sessions.md`、`env-vars`（`CLAUDE_CONFIG_DIR`、`CLAUDE_CODE_SKIP_PROMPT_HISTORY`、`CLAUDE_CODE_PROJECT_DIR_NAME`）；转录存储 `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`（cwd 非字母数字字符替换为 `-`，超 200 字符截断+hash）。

**四类记忆**：
1. **Conversation**：每 session 一个 JSONL 转录（消息/工具调用/元数据逐行 JSON），格式内部化、版本间可能变（官方警告勿直接解析，用 `/export` 或脚本接口）；30 天 retention sweep（`cleanupPeriodDays`）。
2. **Session**：session ID 绑定项目目录；`--continue`（最近）、`--resume <id|name>`、`/resume` 选择器、`--from-pr`；恢复内容 = 完整历史（含工具调用与结果）+ 模型（转录里保存，被 retired/被 allowlist 排除时回退）+ agent（`--agent` 启动的会话恢复该 agent 的 prompt/工具/模型）+ 权限模式（终端 resume 恢复，picker/`/resume` 不恢复）+ 活动 goal（计数/计时/花销基线重置）+ 未过期 scheduled tasks；**不恢复** `--mcp-config`/`--settings`/`--plugin-dir`/`--add-dir`（settings 文件会重读）。
3. **Project**：CLAUDE.md 层次（managed→user→project→local，目录树根→cwd 拼接）+ `.claude/` 配置（settings/rules/skills/agents/workflows/hooks）+ auto memory（按 git 仓库作用域，worktrees 共享）。
4. **Long-term**：auto memory（`~/.claude/projects/<project>/memory/MEMORY.md` 索引 + topic 文件，Claude 自己读写；200 行/25KB 注入；`/memory` 查看编辑；`autoMemoryEnabled` 开关；`CLAUDE_CODE_DISABLE_AUTO_MEMORY`）；subagent memory（frontmatter `memory: user|project|local` → `~/.claude/agent-memory/`、`.claude/agent-memory/`、`.claude/agent-memory-local/`）；用户 CLAUDE.md 跨项目。

**Resume / Fork / Clear / Compact 后恢复**：
- **Resume**：追加新消息到同一 session（同 ID）；两台终端同时 resume 同 session 会交错写入同一转录（官方提醒用 fork）。
- **Fork**：`/branch`、`--fork-session`、`/subtask`、SDK `forkSession`——复制转录到**新 session ID**，原会话不动；fork 的权限 grants 不继承（`--fork-session` 新进程需重新批准；`/branch` 同进程内继承）。
- **Clear**：`/clear` 新会话，旧会话保留可 `/resume` 或同进程 rewind 菜单恢复；`/clear <name>` 给旧会话命名。
- **Compact 后恢复**：同一 session；`/rewind` 的 Summarize 选项保留原始转录可引用；checkpoint 随会话保存（resume 后仍可 `/rewind`）。
- **Checkpoint**：每次用户 prompt 建一个 checkpoint（文件编辑前快照），保留最近 100 个；只跟踪文件编辑工具（**Bash 改的文件不跟踪**、子代理编辑一般不跟踪、symlink/hardlink 跳过）；`/rewind`/Esc-Esc 恢复代码+对话/仅对话/仅代码。

**跨 Session 记忆**：auto memory（每 repo 一个目录）+ CLAUDE.md + subagent memory；另有 **cross-session messaging**（v2.1.224+：`ListAgents`/`SendMessage` 给本机其他 Claude Code 会话或远程会话发消息）与 session storage（Agent SDK `sessionStore` 把转录镜像到 S3/Redis 等跨机 resume）。

**优点**：转录落盘 JSONL 使 resume/fork/export/审计全都有据；auto memory 的"索引+主题文件"模式控制跨会话注入成本；checkpoint 与会话共存（resume 后可 rewind）；agent memory 有 user/project/local 三级作用域。
**缺点**：转录格式不稳定（版本间可能破）；无跨机原生同步（要靠 sessionStore 或手动搬文件）；`/clear` 与 compact 的边界对用户不直观（文档 FAQ 长）；checkpoint 覆盖面有限（Bash/子代理改动漏网）。

---

## H10 Skills

**实现位置**：`skills.md`、`claude-directory`（skills/ 目录）、`commands.md`（内建命令与 bundled skills）、`plugins`（skills/ 目录）；遵循 [Agent Skills](https://agentskills.io) 开放标准 + Claude Code 扩展（调用控制、子代理执行、动态上下文注入）；仓库示例 `plugins/frontend-design/skills/`、`plugins/plugin-dev/skills/`（带 references/scripts 的完整 skill 包）。

**Discovery / 作用域**：位置层级 enterprise（managed settings 目录）> personal（`~/.claude/skills/`）> project（`.claude/skills/`）> plugin（`<plugin>/skills/`，命名空间 `plugin:skill`）；从 cwd 向上到 repo root 发现；**嵌套 `.claude/skills/`** 在读取/编辑该子目录文件时按需激活（目录限定名如 `apps/web:deploy`）；`--add-dir` 目录的 skills 也加载；热检测（watcher，新增顶层目录需重启）；冲突规则：enterprise>personal>project>bundled skill 同名覆盖（别名不覆盖）；skill 优先于同名 command；synced（claude.ai）skill 永远被本地同名命令压过。

**Loading**：描述索引在启动进上下文（description+when_to_use 截断 1,536 字符）；**正文按需加载**（Claude 自动匹配或 `/name` 调用时），注入后跨轮保留；`disable-model-invocation: true` → 不进索引、只能用户调（副作用类 skill 官方推荐）；`user-invocable: false` → 隐藏 `/` 菜单只能模型调；`paths:` glob → 只在匹配文件工作时自动触发；subagent `skills:` 字段预载全量正文；`context: fork` → 在 fork 出的子代理上下文运行（`agent:` 指定类型、`background` 控制等待）；调用过的 skill 在 compact 后按 ≤5000 token/个重新注入。

**Execution**：`SKILL.md` = YAML frontmatter + markdown 正文；`!`command`` / ` ```! ` 动态上下文注入（运行命令、把输出内联进 prompt；`shell: powershell` 可选）；`@file` 引用捆绑文件；`$ARGUMENTS`/`$0..$n` 参数；frontmatter 字段：`name`/`description`/`when_to_use`/`argument-hint`/`arguments`/`disable-model-invocation`/`user-invocable`/`allowed-tools`（**turn 级**免批准授权，下条消息即清）/`disallowed-tools`/`model`（turn 级覆盖）/`effort`/`context`/`agent`/`background`/`hooks`（调用起注册到会话结束）/`paths`/`shell`/`metadata`/`license`/`compatibility`。

**Install / Update / Conflict / Provenance**：
- 分发：目录拷贝、git 共享、插件市场安装（`/plugin`、marketplace.json）、claude.ai 账号同步（`CLAUDE_CODE_SYNC_SKILLS=1` 非交互下载到 `~/.claude/skills/synced/`）、上传 claude.ai（仅允许 spec 六字段：name/description/license/compatibility/metadata/allowed-tools，多余字段硬报错）。
- 更新：watcher 热更新；插件需 `/reload-plugins`；`/skills` 菜单管理。
- 冲突：见上；另有 `skillOverrides` 设置级控制（`"name": "off"` 隐藏、`"user-invocable-only"` 等）。
- **Provenance 安全**：synced skill 正文不执行 `!` 命令、不展开 `@`、占位符按字面（本地 skill 才有这些能力）；描述消毒（转义尖括号/控制字符）；`disableSkillShellExecution` 占位符可全局关 `!`。

**优点**：以目录+SKILL.md 打包（正文+捆绑文件+可选插件化）是干净的可分发单元；模型自动调用与用户手动调用双通道 + 三级作用域 + 冲突解析完备；`allowed-tools` 的 turn 级授权粒度好（副作用不出借）；按需加载把"常驻知识"成本压到几乎为零。
**缺点**：命令/技能机制合并后历史包袱仍在（commands/ 仍可用、同名 skill 优先）；skill 正文进上下文后跨轮常驻（官方提醒每行都是成本，但无自动卸载）；synced skill 能力降级（无 `!`/`@`）对用户不透明；`allowed-tools` 授权只覆盖当前 turn，多轮流程需重复触发。

---

## H11 Subagent / Multi-Agent

**实现位置**：`sub-agents.md`、`agents.md`（并行方式对比）、`agent-view.md`（后台会话面板）、`agent-teams.md`（lead+teammates）、`workflows.md`（动态工作流脚本）、`worktrees.md`、`cross-session-messaging.md`；仓库示例 `plugins/feature-dev/agents/`（code-explorer/architect/reviewer）、`plugins/code-review/`（5 并行 Sonnet agent）、`plugins/pr-review-toolkit/`。

**内置 Subagent 类型**：`Explore`（只读快搜，模型继承主会话但 Claude API 上封顶 Opus）、`Plan`（plan mode 研究用，只读）、`general-purpose`（全工具多步任务）、`claude`（兜底）、`statusline-setup`、`claude-code-guide`（Haiku）。

**定义**：Markdown 文件 = YAML frontmatter + 正文（正文即 subagent system prompt）；frontmatter：`name`（必须，小写连字符，`:` 保留给插件）、`description`（必须，决定何时被委派；合计 >15K token 启动警告）、`tools`/`disallowedTools`（allow/deny，支持 `mcp__server` 级）、`model`（含 `inherit`，解析顺序：调用参数→frontmatter→`CLAUDE_CODE_SUBAGENT_MODEL`→主会话模型）、`permissionMode`、`maxTurns`、`skills`（预载）、`mcpServers`（内联定义，会话级信任）、`hooks`、`memory`（user/project/local）、`background`、`effort`、`isolation: worktree`、`color`、`initialPrompt`、`experimental.cacheTtl`。作用域优先级：managed > `--agents` CLI > project > user > plugin。

**Context 隔离**：全新上下文窗口；不带主会话历史、已调用 skill、已读文件、主会话 auto memory（**fork 除外**：`/subtask` 或 skill `context: fork` 复制主会话对话）；初始上下文 = 自己的 system prompt + 环境细节 + 委派 task message + CLAUDE.md（Explore/Plan 跳过以省成本）+ MCP/skills（减去 plan-mode 控制工具、后台任务工具、默认 Agent 工具防递归）；**只回主会话一个 summary + 元数据尾（token 数/时长）**。

**工具/权限隔离**：`tools` allowlist / `disallowedTools` denylist（先 deny 后 allow 解析）；后台 subagent 只有精简内建工具集（Read/Grep/Glob/Bash/PowerShell/Edit/Write/NotebookEdit/WebFetch/WebSearch/TodoWrite/Skill/ToolSearch/EnterWorktree/ExitWorktree/Monitor/TaskStop/SendMessage/Artifact + 全 MCP）；`permissionMode` 可独立设置但父会话 bypass/acceptEdits 优先、auto 模式下继承 classifier 且 frontmatter mode 被忽略；`Agent(agent_type)` 限制可 spawn 的类型；前台子代理的权限 prompt 透传给你，后台子代理的提示浮到主会话（Esc 只拒当前调用不杀子代理）。

**结果回主 / 再生成**：完成 → summary 回主上下文（后台子代理 → 完成通知，Claude 等到通知才汇报）；`maxTurns` 达限 → partial 输出 + 可 `SendMessage`/resume 续跑；输出扫描（防注入）后 Claude 才读报告；`SubagentStart`/`SubagentStop` hook 全程可观测。

**最大深度 / 并发**：嵌套默认 **3 层**（`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`，v2.1.219 起；1 关闭嵌套）；并发默认 **20**（`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`；ultracode 会话豁免）；无会话总 spawn 上限（旧的 MAX_SUBAGENTS_PER_SESSION=200 已移除）；subagent 达深度极限时 Agent 工具被收回。

**Worktree**：`isolation: worktree` 在 `.claude/worktrees/` 建临时 git worktree（默认从 default branch 分支，而非父会话 HEAD）；Bash/PowerShell 命令被强制留在 worktree 内（拒绝 git 重定向进主 checkout、命令文本无法验证时拒绝）；无改动自动清理；`.worktreeinclude` 把 gitignored 文件（.env 等）复制进新 worktree；`-w`/`--worktree` 以 worktree 启动整个会话。

**其他多 Agent 形态**（Claude Code 把"多任务"拆成四种机制）：
- **Subagents**：单会话内委派（上面全部）。
- **Agent view / background agents**：`claude --bg` 后台会话、`claude agents` 面板监控、`--json` 脚本接口。
- **Agent teams**（实验性）：lead 会话 + 独立会话 teammates，共享任务列表、peer 消息（SendMessage）、TeammateIdle hook。
- **Dynamic workflows**：Claude 写的 JS 脚本（`agent()`/`pipeline()`/`parallel()`/`phase()`/`log()` + `args`），运行时后台执行几十到数百个 agent，中间结果留在脚本变量不进主上下文，只回一个综合结果；约束：16 并发、1000 agents/run、4096 items/parallel、无模块加载、禁 `Date.now()`/`Math.random()`（保证可重放）、失败/停止可同一会话内续跑（已完成 agent 回放缓存结果）；同前缀 fan-out 延迟 5s 起步以共享 prompt cache。

**优点**：上下文隔离是核心卖点（官方用 token 数字证明：子代理读 6.1K token 只回 420 token）；工具/权限/模型/记忆全部可按 agent 独立配置；深度+并发双重上限默认合理；worktree 隔离把并行写的冲突降到最低；workflow 把编排代码化、可审查可重放。
**缺点**：子代理返回的 summary 是信息瓶颈（丢细节）；后台子代理工具集被砍，复杂任务可能被迫前台跑；teams/workflows 是实验性/较新功能，稳定性文档自己标注"experimental"；fork 继承父上下文意味着 fork 型子代理没有隔离收益（成本由调用者权衡）。

---

## H12 Evaluator / Verification

**实现位置**：`best-practices`（verification loop 概念）、`goal.md`（/goal evaluator）、`code-review.md`/`ultrareview.md`（多 agent 代码审查）、`security-guidance.md`/`claude-security.md`（安全扫描插件）、`github-actions.md`（CI）、`tools-reference`（`ReportFindings` 工具、bundled `/verify`/`/run` skills）、`checkpointing.md`（回滚）、Agent SDK `structured-outputs`（JSON Schema 校验）。

**Verification Loop（核心概念）**：官方把"给 Claude 一个可运行检查"定义为**无人值守运行的前提**——test suite、build、截图对比等；Claude 迭代到检查通过为止，而不是自己判断"做完了"。没有 verification loop 时，唯一判定完成的只有模型自己（官方原文语义）。`/goal`、`claude -p` 无人值守、dynamic workflows 都依赖此模式。

**内置评估机制**：
- **`/goal`**：每 turn 结束后由**独立小模型**（默认 Haiku 级）对照条件评估 transcript（evaluator 不跑命令、不读文件，只读对话），返回三态：met / impossible / error（需你修复的错误）；条件 ≤4000 字符，可含 turn/时间子句；/goal 是 session-scoped prompt-based Stop hook 的包装。
- **`/code-review`（本地）**：多 agent 并行分析 diff + 全代码库上下文，各自查一类问题 → **verification step 对照真实代码行为过滤 false positives** → 去重、按严重度排序 → 内联评论 + 摘要；`effort` 低=只报最确信项（少误报），高=更广覆盖；`REVIEW.md` 自定义规则（find+verify agent 与 rank agent 都读）；`--fix` 直接应用修复（后台运行时的编辑不进 checkpoint，需 git 回滚）；`/code-review ultra` 升级云端 deep review（更细多 agent、verifier 交叉核验、可回贴 PR）。
- **`/verify` / `/run`（bundled skills）**：构建并运行 app 验证改动（"不 fallback 到测试或类型检查"——跑真实 app）；`/run-skill-generator` 把可复现的启动配方记录为项目 skill（`.claude/skills/run-<name>/`），后续 `/verify` 照方抓药；记录文件只在失败时被 Claude 改写（避免每会话 diff）。
- **Tests / Lint / Typecheck / Build**：没有内建抽象，通过 `Bash` 跑（权限可 allow 如 `Bash(npm test *)`）；`BashOutput`/输出截断管控海量输出。
- **Security**：`security-guidance` 插件（官方仓库）：PreToolUse/PostToolUse/Stop hook 检测 9 类危险模式（命令注入/XSS/eval/危险 HTML/pickle/os.system），git commit/push 触发**后台异步重审**（asyncRewake 唤醒模型处理）；`Claude Security` 插件扫描整个代码库出漏洞报告 → 转补丁供审阅。
- **Runtime/Browser/Screenshot**：`/run` 驱动 CLI/server/TUI/browser 类 app；Chrome 扩展（Web 应用测试/console 调试）；computer use（macOS GUI 自动化）；Desktop iOS simulator pane；Artifact 预览页。
- **Structured output**：`claude -p --json-schema` / Agent SDK structured outputs（JSON Schema/Zod/Pydantic），校验失败达重试上限返回 `error_max_structured_output_retries`；workflow `agent({schema})` 先验 schema 可满足性。
- **Checkpoint/Rewind**：文件级回滚（`/rewind`）作为"验证失败后的安全网"，与 git 互补。
- **CI 集成**：GitHub Actions（@claude 提及触发、issue→PR）、GitLab CI、`--restricted` 模式专为 eval harness 设计（禁执行工具、限文件域、禁读用户/项目设置、禁 bypass）。

**优点**：把"验证"定义为**独立于模型的外部检查**（test/build/screenshot/多 agent 交叉核验），并明确"无人值守的前提"；/goal 用独立小模型做 evaluator 避免"干活的人自己验收"；code-review 的 verification step（对照真实行为过滤误报）是很好的多 agent 质检模式；安全审查可做成 hook 链（PreToolUse 模式检测 + Stop 异步重审）。
**缺点**：所有 test/lint/typecheck 都靠 Claude 自己调 Bash 执行，没有内建 test-runner 抽象；/goal evaluator 只读 transcript 不看磁盘，条件必须能由对话自证；verification 的"完成标准"没有结构化验收契约（全靠自然语言条件 + 模型判定）；代码审查/安全扫描主要是插件与云端服务形态，本地能力依赖安装。

---

## 行为要点提取（供 Behavior IR）

以下为从 Claude Code 官方行为中抽象出的、可迁移到自研 Harness 的行为规则（每条 = 一个可验证行为约束）：

1. **Turn = 一次模型往返**：模型产出含 tool call 的响应即继续循环，产出纯文本响应即停；"无 tool call 即结束"是最简单的终止判据，且每轮对外可观测（消息流/事件流）。
2. **请求三层前缀**：system prompt 层（少变）→ project context 层 → conversation 层（多变）按变更频率排序，最大化 prompt cache 命中；任何对前置层的修改（换模型/改工具集/compact）都会使整链缓存失效，设计时必须显式计价。
3. **上下文分层预算**：常驻内容（CLAUDE.md、memory、skill 描述、工具名）启动注入；重内容（skill 正文、MCP schema、path 规则、主题记忆）按需加载；加载点绑定"首次接触匹配文件/首次调用"事件。
4. **截断先于压缩**：上下文压力下先清旧 tool 输出与图片，再整段 summarize；summarize 请求复用当前前缀并追加总结指令（缓存友好）。
5. **压缩保留清单**：用户请求与意图、关键文件与代码片段、调用过的 skill 正文（限量）、最近修改的文件（重读）；持久规则必须放项目指令文件而非对话历史——这条应作为平台级文档承诺。
6. **指令是建议，规则是强制**：CLAUDE.md/提示词只塑造模型行为；要硬性边界必须走权限规则、hook、sandbox 三层中的强制层（deny/ask/allow 先匹配生效，hook 不 bypass 规则）。
7. **权限先于执行、deny 优先**：工具执行前必经 deny→ask→allow 评估；裸工具名 deny 直接移除工具定义；scoped 规则按参数模式匹配；任何模式（含 bypass）都不自动放行"危险集合"（关键路径删除、需人交互的工具、显式 ask 项）。
8. **Behavior Safety 与 Runtime Safety 分离**：行为层管"模型试图做什么"（权限/分类器/hook），运行时层管"命令能碰到什么"（sandbox/容器/凭据遮蔽）；两者独立可组合，文档必须明示各自的失效面（如 deny 规则拦不住任意子进程）。
9. **分类器盲化**：自动化批准/审查模型不能看到 tool results（防文件/网页注入操纵审查结论）；审查输入与执行输入分离。
10. **子代理隔离 = 独立上下文 + 摘要回流**：子代理自带 system prompt/工具/模型/记忆，只回最终文本 + 元数据；后台子代理用精简工具集；嵌套与并发必须有默认上限（3 层/20 并发）。
11. **外部内容消毒**：子代理报告、同步技能、Web 抓取等外部来源进入上下文前做模式扫描/转义/隔离（冒充内部格式的文本被改写或标记）；真正防护靠权限与沙箱，消毒只是提示层。
12. **Hook 事件面覆盖循环全生命周期**：tool 前/后、批量后、每轮停、子代理起止、压缩前后、模型切换前后、会话起止均有事件；决策类事件（PreToolUse）返回结构化 JSON 决策而非自由文本。
13. **会话即转录**：会话 = 目录绑定的 JSONL 转录；resume 追加、fork 复制出新 ID、/clear 另起、checkpoint 随会话保存；转录格式内部化，对外提供导出/脚本接口。
14. **跨会话记忆用"索引+主题文件"**：启动只注入索引（限量），细节按需读回；记忆按仓库作用域共享、按代理可独立作用域（user/project/local）。
15. **验证必须外部化**：完成判据应由独立检查（可运行命令、独立评估模型、多 agent 交叉核验）给出，而不是干活模型自证；无人值守模式以存在 verification loop 为前提。
16. **缓存友好是默认工程约束**：新功能（plan 指令、skill、文件变更通知）默认以"追加到会话层"方式实现，避免破坏前缀；破坏前缀的操作（/model、/compact）要有明确的成本提示。

---

## 参考来源

**仓库（锁定）**
- https://github.com/anthropics/claude-code — commit `d7dbd9a09f59775726ed14bbea8fc9dfdff62f7b`（2026-09-04）
- README.md（产品定位/安装方式，npm 安装已弃用）
- CHANGELOG.md（2.1.260–2.1.261：bashOutputMaxChars、/skill-doctor、subagent 输出扫描修复、compaction 与缓存行为细节等）
- examples/settings/{settings-strict,settings-bash-sandbox,settings-lax}.json + README（managed settings 形态）
- examples/mdm/（macOS mobileconfig / Windows ADMX+Set-ClaudeCodePolicy.ps1）
- plugins/README.md + plugins/*/.claude-plugin/plugin.json + plugins/security-guidance/hooks/hooks.json（插件结构、hooks.json 真实样例）
- plugins/feature-dev/agents/code-architect.md（subagent frontmatter 真实样例）
- .claude/commands/commit-push-pr.md（command allowed-tools 与 `!` 插值样例）

**官方文档（https://code.claude.com/docs，抓取于 2026-09-04，经 llms.txt 索引）**
- llms.txt（166 页索引）、overview、how-claude-code-works、context-window、prompt-caching、memory、sessions、claude-directory、glossary、checkpointing、troubleshooting、costs、statusline、debug-your-config、large-codebases、features-overview
- hooks、hooks-guide、sub-agents、agents、agent-teams、workflows、worktrees、agent-view、cross-session-messaging、skills、plugins、plugins-reference、discover-plugins、plugin-marketplaces
- permissions、permission-modes、sandboxing、sandbox-environments、security、auto-mode-config、settings、settings-reference、model-config、env-vars、cli-reference、commands、tools-reference、goal、headless、interactive-mode、mcp、mcp-quickstart、code-review、ultrareview、security-guidance、claude-security、github-actions、computer-use、output-styles、managed-settings、server-managed-settings
- Agent SDK：agent-sdk/agent-loop、agent-sdk/sessions、agent-sdk/hooks、agent-sdk/subagents、agent-sdk/skills、agent-sdk/modifying-system-prompts、agent-sdk/custom-tools、agent-sdk/tool-search、agent-sdk/permissions、agent-sdk/file-checkpointing、agent-sdk/claude-code-features、agent-sdk/session-storage、agent-sdk/structured-outputs、agent-sdk/user-input

**产品/标准**
- https://agentskills.io — Agent Skills 开放标准（skills frontmatter 兼容面）
- https://code.claude.com/docs/en/whats-new/index.md — 周报（v2.1.16x 起原生二进制、fork mode 默认、auto mode 默认等演进证据）

**未获取到**：Claude Code 运行时源码（闭源）；CL4R1T4S / system prompt 原文（本文未收集，亦未转述）。
