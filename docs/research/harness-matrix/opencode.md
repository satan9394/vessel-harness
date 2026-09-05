# OpenCode 解剖

- 研究日期：2026-09-05（基于本地浅克隆读取源码，当日 HEAD）
- 锁定仓库与 commit：https://github.com/anomalyco/opencode @ `e2894562f8ba943d72172d10b727c24d5f650c16`
  （注意：新主仓库为 anomalyco/opencode，非旧 sst/opencode）
- 主要来源：仓库 `packages/opencode/src`（session / agent / provider / tool / server / permission / skill / question / plugin 等模块）、`packages/plugin`、`packages/core`、`packages/schema`；源码经 `git clone --depth 1` 到 TEMP 目录后本地精读。
- 技术底座摘要：TypeScript + Bun 运行时；Effect-TS（结构化并发/依赖注入 LayerNode）；AI SDK v6（`streamText`/`generateObject`）为默认 LLM 通道并预留 native runtime 通道；Drizzle + SQLite 持久化；事件总线 EventV2（可路由 location、durable）；前后端分离 Client/Server（HTTP/SSE/WebSocket + OpenAPI，TUI/Desktop/App 均连 server）。
- 模块划分（packages）：opencode（核心应用逻辑）、core（可复用服务与 Schema）、plugin（插件契约）、llm（LLM 客户端抽象）、client / sdk / sdk-next（客户端库）、tui / console / web / desktop / app（UI）、server（HTTP API 定义与路由）、cli（命令行入口）。

## H01 Agent Loop

- 实现位置：`packages/opencode/src/session/prompt.ts`（`prompt`→`loop`→`runLoop`，L1052 起）；`session/processor.ts`（单次流处理 `SessionProcessor`）；`session/run-state.ts`（runner 并发护栏）；`session/status.ts`。
- 核心流程：用户 prompt → `SessionPrompt.prompt()` 建 user message → `runLoop` 进入 `while(true)`：读全部消息 → `MessageV2.latest` 找最近 user/finished assistant 及 pending `task`（compaction/subtask）→ 先处理 subtask 或 compaction；若最近 assistant 已结束且有 token overflow 则注入 compaction 任务；否则取 agent（含 mode/steps/permission）→ `SessionReminders.apply`（plan/build 切换注入）→ 新建 assistant message → `SessionProcessor.create`（处理工具调用、文本/推理增量）→ `SessionTools.resolve` 组装工具集 → 组 system（env+instructions+MCP+skills）→ `handle.process(streamText)` → processor 按 `LLMEvent` 事件流把 reasoning/text/tool 增量写成 Part 落库，step-finish 记录 snapshot patch → processor 返回 `"compact" | "stop" | "continue"`，loop 据此决定 break 还是继续下一轮（携带工具结果续跑）。
- 关键机制：一个"用户回合"内可多次调用 LLM（每次生成独立 assistant message 直到 finish 非 tool-calls）；doom-loop 检测（同工具相同输入连续 ≥3 次 → 权限询问）；retry 策略（`session/retry.ts`，指数退避+抖动+Retry-After，默认 5 次）；busy/并发由 `SessionRunState` 的 Runner 管理（同时只有一轮 runLoop，shell 可并行进入）；interrupt（abort）时 processor.cleanup 把所有 running 工具标 error 并补 snapshot。
- 优点：loop 状态机边界清晰；每轮 step 可独立重启/重试/中断；parts 持久化让回放与 UI 增量渲染天然可行；单用户回合多次 LLM 调用与工具执行完全解耦。
- 缺点：`while(true)` 内每次都全量重读消息并重新估算（开销随会话长度增长，靠 compaction 缓解）；步骤无显式 budget 管理（仅 agent.steps 上限提示）；循环与 compaction/subtask 交织使控制流分支多、测试面大。

## H02 System Prompt

- 实现位置：`packages/opencode/src/session/system.ts`（环境块/技能块/MCP 指令块）、`session/prompt.ts` L1250 附近组 system 数组、`session/instruction.ts`（AGENTS.md/CLAUDE.md 指令）、`agent/agent.ts`（agent prompt 与 hidden 内部 agent）、`session/prompt/*.txt`（按供应商分的 system prompt 模板：anthropic / beast / codex / copilot-gpt-5 / default / gemini / gpt / kimi / meta / trinity）。
- 组成：`[env, instructions(AGENTS.md 等), mcp_instructions, skills块]`。env 含模型名、工作目录、workspace root、是否 git 仓库、平台、今天日期、可选 `<available_references>`。`SystemPrompt.provider(model)` 按 model.api.id 匹配选择模板（claude→anthropic.txt，gemini→gemini.txt，o1/o3→beast.txt，codex→codex.txt…），否则 default.txt。技能用 `<available_skills>` 块给全量描述；MCP 服务器指令用 `<mcp_instructions>`。
- 指令注入：`Instruction.system()` 收集 global AGENTS.md（+~/.claude/CLAUDE.md，可禁）、项目向上一级找到的第一个 AGENTS.md/CLAUDE.md（不再叠祖先层）、config.instructions（文件+http URL，5s 超时拉取）。
- 附加层：`agent/steps` 上限时在消息尾部追加 MAX_STEPS_PROMPT；json_schema 输出时加 `STRUCTURED_OUTPUT_SYSTEM_PROMPT`；`SessionReminders` 在 plan→build 切换/plan 模式插入 plan.txt/plan-mode.txt/build-switch.txt。
- 优点：供应商/模型专属提示模板（含缓存签名、reasoning 使用说明等），可经插件 `experimental.chat.system.transform` 改写；env/instructions/MCP/skills 分块便于按权限裁剪。
- 缺点：多模板并行维护成本高；XML 风格标签（env/skill/mcp 块）是既有惯例非强标准；配置缺省时某些模板（如 meta/kimi）依赖模型 API id 关键字匹配，脆弱。

## H03 Context Engine

- 实现位置：`packages/opencode/src/session/message-v2.ts`（消息→ModelMessage 转换、`filterCompacted`、`toModelMessagesEffect`）、`session/prompt.ts`（getModel、组 messages、`SessionCompaction.select` 预算）、`session/session.ts`（SessionV1/Part/Part 的 SQLite CRUD，Drizzle）、`packages/core/session`（core 层 schema/数据库表 `MessageTable`/`PartTable`）。
- 核心机制：消息以 user/assistant message + parts（text/reasoning/tool/step-start/step-finish/patch/file/compaction/subtask）双层模型落库。每轮 loop 用 `MessageV2.filterCompactedEffect` 读全消息并按 compaction 关系重排（compaction-user → summary → retained tail → continue-user）；`toModelMessagesEffect` 逐条转 AI SDK `ModelMessage`：错误 assistant 跳过、reasoning 块按 provider 处理、已完成 tool 结果截断（默认 2k 字符级截断策略 `truncateToolOutput`）、媒体文件在工具结果中按供应商能力提取为后续 user 消息（OpenAI 只支持文本工具结果）、pending/running 工具写 `[Tool execution was interrupted]`、不同模型切换时丢弃 reasoning 元数据只留文本。
- 预算：`usable()` = model 输入上限 - reserved（默认 20k 或 maxOutputTokens）；`overflow.ts isOverflow`：总量 ≥ usable 时触发 compaction；token 估算是 `Token.estimate`（按字符/JSON 估算）。
- 优点：细粒度 parts 持久化（增量更新 text/tool 输出不用整条重写）；上下文构造集中在 message-v2，便于跨模型差异适配（media in tool result、signed reasoning、providerExecuted 工具）；compaction 后重排逻辑保证连续性。
- 缺点：全量消息每轮读库+序列化转换，长会话 CPU 与 token 估算成本线性增长（虽有 compaction 兜底）；token 估算是近似值非逐 token 精确；`filterCompacted` 的重排逻辑复杂、对顺序边界敏感。

## H04 Compaction

- 实现位置：`packages/opencode/src/session/compaction.ts`（select/prune/process/create）、`session/overflow.ts`（阈值）、`session/prompt.ts` runLoop 触发点、`agent/prompt/compaction.txt`（compaction agent 的系统提示）、`session/summary.ts`（每 assistant step 后 diff 汇总）。
- 触发：每 step-finish 后 `SessionSummary.summarize`（diff stats）；若 `isOverflow` 为真 → `compaction.create`（注入 compaction part 的 user 消息）→ loop 下一轮发现任务类型 compaction → `compaction.process`：选 head/tail（保留最近 N 个 turn 共 ≤ preserve_recent_tokens 预算，默认 min(15k, max(2k, usable*25%))，可配置 compaction.tail_turns / preserve_recent_tokens / reserved / auto），把旧历史序列化成文本喂给隐藏 `compaction` agent（`buildPrompt`：previousSummary + context 对话序列化文本），产出结构化 summary；随后决定 replay（overflow 场景从最后一个非 compaction user 消息重放）或 auto-continue（合成 "Continue if you have next steps…" user 消息，带 `compaction_continue` metadata，插件可关）。
- `prune`：旧完成 tool 输出在保护 PRUNE_PROTECT(40k token) 之后、超 PRUNE_MINIMUM(20k) 时把更老 tool 输出字段标 `compacted` 清空（保留 skill 类工具输出）。
- 优点：自动压缩+自动继续，用户几乎无感；重放逻辑保留原始 user 意图；可配置 tail 预算；插件可整体替换/增补 compaction prompt（experimental.session.compacting）并决定是否 auto-continue。
- 缺点：序列化转文本丢结构化（工具输入 JSON.stringify 可能很大）；已压缩 tool 输出以 `[Old tool result content cleared]` 占位，旧细节不可再查；压缩本身消耗一轮 LLM 调用与 token；若历史超过模型上限压缩失败会报 ContextOverflowError 终止。

## H05 Tool System

- 实现位置：`packages/opencode/src/tool/`（tool.ts 定义层、registry.ts 注册/筛选、schema.ts、json-schema.ts、truncate.ts 输出截断、及各工具实现 read/glob/grep/edit/write/apply_patch/shell/task/todo/webfetch/websearch/skill/question/lsp/plan/code-mode/invalid 等）；`session/tools.ts`（`SessionTools.resolve`：把内部 Tool.Def 包装成 AI SDK `tool()` 并注入 Tool.Context：abort、callID、sessionID、messages、metadata、ask 权限门）。
- 定义范式：`Tool.define(id, Effect<Def>)`；Def = { id, description, parameters(Schema/JSONSchema), execute(args, ctx) → ExecuteResult { title, metadata, output, attachments } }。包装层做：参数 Schema 解码失败 → `InvalidArgumentsError`（让模型改写输入）；输出经 `Truncate.output` 截断（超限内容落盘返回路径 + metadata.truncated）；plugin `tool.definition` 可改 description/parameters。
- 注册与筛选：registry.state 组合 builtin（invalid/shell/read/glob/grep/edit/write/task/fetch/todo/search/skill/patch/question 等）与 custom（config 目录下 `tool(s)/*.{js,ts}` 动态 import 的 plugin tool，含 zod→JSONSchema 转换）；`registry.tools()` 按模型/agent 过滤（如 websearch 仅限支持 provider、gpt 系列用 apply_patch 而非 edit/write、question 工具默认仅 app/cli/desktop 客户端启用）；`Permission.visibleTools/disabled` 隐藏整个被 deny 的工具（如 edit 三件套 deny、read 工具列表）。
- MCP：mcp.tools() 每服务器工具转为 AI SDK tool，执行前 `ctx.ask({permission: key, patterns:["*"]})`；MCP resources 能力可选注入 list/read resource 工具；图片/blob 附件按 mime/大小白名单处理。
- 内部特殊工具：`task`（调子代理）、`invalid`（AI SDK repairToolCall 兜底：找不到工具名时转 invalid 工具并传回错误）、`doom_loop` 是权限而非工具。
- 优点：内部工具与 AI SDK 的适配层集中；schema 校验错误可被模型自修复；per-tool 输出截断、ask 权限、before/after 钩子齐全；自定义工具 = 配置文件放脚本即可，无需编译。
- 缺点：工具定义依赖 effect Schema 与 zod 双轨（插件用 zod，内置用 effect Schema），需转换桥；Registry 里按 modelID 子串判断工具集（如 gpt）偏脆；每次 resolve 都重建整套工具上下文。

## H06 Hooks/Events

- 实现位置：`packages/plugin/src/index.ts`（`Hooks` 接口：声明所有可钩子点）；`packages/opencode/src/plugin/index.ts`（`Plugin.Service`，内部插件+从 npm/本地加载插件，维护 `hooks: Hooks[]` 并暴露 `trigger(name,input,output)` 把 output 逐插件变换）；触发点遍布 session/prompt.ts、session/tools.ts、session/compaction.ts、session/llm/request.ts、tool/registry.ts、tool/shell.ts、server（pty）等。
- 插件形态：server 插件 = `async (ctx, options) => Hooks`（ctx 提供 SDK client、$ BunShell、serverUrl 等）；v1 插件可选 `tool` 字段返回自定义工具；新版支持 v2 Effect/promise 插件 API（`plugin/v2`：command/context/event/skill/agent/aisdk…）。加载源：内部插件（Codex/Copilot/Modal 等 auth/provider 插件）、`plugin` 配置（npm 包或本地路径）、config 目录下工具脚本。
- 已确认钩子清单（plugin Hooks 接口）：dispose、event（订阅全部 event）、config、tool 工具注册、auth、provider、chat.message、chat.params、chat.headers、permission.ask（可改 ask/deny/allow）、command.execute.before、tool.execute.before/after、shell.env、experimental.chat.messages.transform、experimental.chat.system.transform、experimental.provider.small_model、experimental.session.compacting、experimental.compaction.autocontinue、experimental.text.complete、tool.definition。
- 事件：EventV2 事件总线（`packages/core/event.ts`），事件类型来自 schema（Session Event Created/Updated/Diff/Error、Message 增补、Permission Asked/Replied、Question 系列、compaction、todo 等）；`EventV2Bridge` 负责把发布绑定到 instance location（directory/project/workspace）并桥到 GlobalBus（SSE 推送 `event` / `sync`）；server 经 WebSocket/SSE 转发，TUI/App 订阅。事件带 durable 标记（顺序/聚合）。
- 优点：钩子以输出对象原地变换（output 贯穿多插件），组合自然；事件全量可订阅（插件可做审计/扩展 UI）；权限与工具生命周期都开钩。
- 缺点：钩子命名混杂 `experimental.*` 与正式（不稳定契约，代码注释明示可能变动）；插件在宿主进程内运行（非隔离），坏插件可拖垮会话；无显式 hook 优先级/顺序文档（按注册序）。

## H07 Permission/Safety

- 实现位置：`packages/opencode/src/permission/`（index.ts 求值+ask/reply、arity.ts 命令参数元数、evaluate.ts 转发）；ruleset 定义在 `@opencode-ai/core/v1/permission`；`agent/subagent-permissions.ts`；`question/`（模型向用户提问）。
- 规则模型：`Rule = { permission: string; pattern: string; action: "allow"|"ask"|"deny" }`；ruleset 为 Rule 数组；`evaluate(permission, pattern, ...rulesets)` 用 `Wildcard.match` 对 permission 与 pattern 双通配，取 `findLast`（后写覆盖先写）。`fromConfig` 展开 config.permission 对象；`merge` 即 flat 拼接（顺序即优先级，后置覆盖）。agent 默认与用户配置合并（agent.ts 里 defaults + user），会话级 session.permission 也参与（merge(agent.permission, session.permission)）。
- ask 流程：Permission.ask 遍历 patterns：全 allow 通过；任一 deny → DeniedError；否则生成 Request、publish `Event.Asked`、`Deferred.await` 阻塞等 UI（TUI/App）reply。reply=reject → Rejected/Corrected(带反馈)；reply=once → 放行一次；reply=always → 把 `always` 列表写入本会话 approved 列表，并顺带放行同会话其余匹配请求。权限请求带 metadata（工具名/输入/描述）供用户决策。
- 安全策略集：读 .env 默认 ask；external_directory 默认 ask（白名单目录如 truncation/技能/引用目录 allow）；`doom_loop` ask；question/plan_enter/plan_exit 默认 deny 内建（build agent 允许 question/plan_enter）；工具级规则（如 task 里对 subagent_type 名 ask、read 对模式）。arity.ts 约束部分命令参数组合（如 websearch/browser 工具 CLI 形状、`deno run`、`docker container` 子命令）用于权限校验精度。
- 优点：permission+pattern 双通配的规则叠加简单灵活，后写优先；会话级 once/always 记忆贴近交互；权限块可经插件 permission.ask 改写；可隐藏/禁用工具与整个 agent。
- 缺点：approve 规则为进程内存态（重启丢失，但会随 Session 行持久化 permission 字段的部分）；模式匹配用通配非 glob 语义；模型在工具执行前先 `ctx.ask`，被拒后模型会收到反馈再改写，路径依赖循环检测兜底。

## H08 Sandbox

- 实现位置：无独立沙箱子系统；安全边界即 **权限系统 + 进程派生点**（`tool/shell.ts` 用 `ChildProcessSpawner`/effect spawn 直接在本机执行；`tool/shell/id.ts` 的 `ShellID` 权限维度；`packages/core/cross-spawn-spawner.ts`）。
- 现状：shell 工具把用户配置的 `shell`（bash/pwsh/cmd 等）作为首选，工作目录/环境注入，命令直接派生到用户机器；bash 默认超时 2 分钟（`bashDefaultTimeoutMs`），输出截断。read/glob/grep 有目录范围约束：`external_directory` 规则控制工具能否访问工作区外的路径，白名单目录（truncation spill 目录、技能目录、reference 目录）默认 allow，其余 ask。读 .env 类文件默认 ask。`permission/arity.ts` 用于限制如 `websearch` CLI 之类的工具参数组合。
- "沙箱"语义上的隔离均靠 permission 而非 OS/容器：无容器、无 bwrap/sandbox-exec、无 seccomp；workspace 概念（experimentalWorkspaces/Worktree）可切换 git worktree，仅"工作副本"隔离非执行隔离。代码模式(code-mode)/LSP 同样运行在宿主进程/本机。
- 优点：跨平台开箱即用、无需容器依赖；规则化授权比沙箱更接近 IDE 助手习惯；shell 交互式 pty 与并行 shell（shell 工具与主 loop 并存）。
- 缺点：对恶意/粗心模型没有真正执行隔离（模型可读写工作区外若获授权）；无 network 策略（webfetch/websearch 走宿主网络）；权限决定可能只覆盖工具级不覆盖进程内插件副作用；无撤销式文件系统（依赖 snapshot/revert 事后回滚而非预防）。

## H09 Session/Memory

- 实现位置：`packages/opencode/src/session/session.ts`（Session 服务：SQLite 存储 Info/Messages/Parts、fork、title、summary/cost/tokens/revert/permission 字段）；`packages/core/session`（表与 SQL、Schema SessionV1/WithParts）；`session/run-state.ts`（runner map，单 session 串行）；`background/job.ts`（子代理/后台任务 Registry）；`snapshot/`、`git`、`session/revert.ts`（git 快照回滚）；`session/summary.ts`（文件 diff 汇总）。
- 会话模型：Session = { id(ULID 倒序), slug, projectID/workspaceID, directory/path, parentID(子代理/分支会话), title, agent, model, version, summary(additions/deletions/files/diffs), cost, tokens(input/output/reasoning/cache), share_url, revert 指针, permission(会话级 ruleset), time }。消息持久化于 MessageTable/PartTable，DB 为 SQLite（drizzle-orm，effect-sqlite 驱动）。SessionID/MessageID/PartID 均有 ascending()/descending() 生成。
- 会话操作：create（父/子标题 "New session - ts" / "Child session - ts"）、fork（从某 messageID 分叉，标题带 fork #N）、children（parent 链列举）、list/listGlobal、setTitle/setArchived/setMetadata/setPermission/setRevert/setSummary/setShare、updateMessage/Part（增量 text）、removeMessage/removePart、diff（VCS/snapshot diff）。runLoop 由 SessionRunState 保证每 session 同时一个 runner（busy 状态下再 prompt 会报 BusyError；cancel/interrupt 支持）；shell 会话可并行 startShell。
- 记忆：分三种——(1) DB 会话历史（全部 parts 可翻页 `MessageV2.page`）；(2) 每 step-finish 的 snapshot patch（`Snapshot.track/patch` 基于 git 工作树 vs committed 记录文件级 diff，写进 part 供 UI/revert 使用，参考 session.summary）；(3) compaction summary 压缩历史。AGENTS.md/指令也随项目作为"记忆"一部分注入。session.summary 与 SessionSummary 非 LLM 摘要（前者为统计字段），真正的叙事摘要走 compaction。
- 优点：结构化、可翻页、可审计的消息库使 UI/断点恢复/import/回放容易；fork 与 parent 支持会话树；快照粒度（step 级）支持精准 revert/分享 diff。
- 缺点：一次 loop 全量读库放大 IO；成本/token 统计字段多为近似（见 getUsage 里对 AI SDK v6 口径的调整与多个 provider metadata hack）；记忆主要在显式历史内，跨会话知识靠 config/instructions 外部文件。

## H10 Skills

- 实现位置：`packages/opencode/src/skill/`（index.ts 服务、discovery.ts URL 技能仓库下载）、`tool/skill.ts`（skill 工具注入）、内置 skill 常量 `customize-opencode`（内容来自 `@opencode-ai/core/plugin/skill`）。
- 发现源：SKILL.md（frontmatter name+description + markdown body）。扫描：global `~/.claude/skills/**/SKILL.md`、`~/.agents/skills/**`（可分别用 disableClaudeCodeSkills / disableExternalSkills 关）；项目向上目录 `{skills}/**/SKILL.md`（从 cwd 至 worktree 的第一个匹配层）；config 目录 `{skill,skills}/**/SKILL.md`；config `skills.paths` 指定额外目录；config `skills.urls` 从远端 index.json（Schema: {skills:[{name,files,version}]}）并发下载到缓存目录（version 变化时 staging+rename 原子替换，`discovery.ts`）。内置 customize-opencode 注册在磁盘发现前，同名磁盘 skill 可覆盖。
- 使用流：system prompt 里给 `<available_skills>`（verbose：name/description/location）；模型调 `skill` 工具（params.name）→ 权限 `skill:<name>` ask → 返回 `<skill_content>`（body + base 目录 + ripgrep 采样的非 SKILL.md 文件清单）。Skill 权限 deny 时从 system prompt 隐藏；compaction/prune 保护 skill 工具输出不清除；模型每 agent 可配 skill 过滤（available(agent) 按 permission evaluate）。
- 优点：三路来源（官方配置/项目/外部 URL 市场）覆盖面广；URL 技能带版本原子更新；技能即 markdown 与 Anthropic 系惯例兼容；工具只读注入不改模型本身。
- 缺点：技能加载是无状态字符串注入（无内置流程编排、无嵌套技能解析）；发现是目录扫描（规模大时 IO 高，靠缓存/版本控制缓解）；description 缺省的技能不暴露（fmt 只列有 description 的）。

## H11 Subagent

- 实现位置：`packages/opencode/src/tool/task.ts`（task 工具：参数 description/prompt/subagent_type/task_id/background/command）、`session/prompt.ts` handleSubtask（L255）+ runLoop subtask 分支、`agent/agent.ts`（内置 agent 定义与 mode: "subagent"|"primary"|"all"）、`agent/subagent-permissions.ts`。
- 模型：子代理 = **独立子 Session**（`sessions.create({ parentID: 当前会话 })`，agent 名字段设为 subagent_type），父会话深度限制 `subagent_depth`（默认 1，防无限嵌套）。task 工具触发流程：请求权限 task:<subagent_type>（默认 ask 一次，always "*"）→ 子会话权限 = 父会话的 deny 与 external_directory 规则 + 子代理自身 ruleset + 默认禁 todowrite/task（除非其规则允许）→ 通过 `prompt()` 在子会话里跑完整 runLoop（子代理可同主代理完全并行/可中断）。
- 内置 subagent：general（并行研究/多步任务，禁 todowrite）、explore（快速搜索，只许 grep/glob/list/read/webfetch/websearch/bash 等只读+有限命令，无编辑权），均 mode:"subagent"。plan 是 primary（禁编辑但允许写 plans 目录 md）。agent 配置可加自定义 subagent（mode all/subagent，permission 自理，可指定 model/prompt/temperature 等）。
- 前台 vs 后台：前台 task → `background.start` 注册子会话 job 后 `wait`（等同 session runner）；`background=true`（需 OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS）→ 立即返回 `<task state="running">`，完成后自动注入合成 user 消息 `renderOutput` 到父会话并继续；可传 task_id 续接既有子会话。多子代理并发由 background registry + session runner（每子会话独立）支撑；handleSubtask 在同一个父会话消息里把整个子代理运行标成一条 running tool part，子会话完成（text 或 error）后回填。
- 结果形态：输出 `<task id state="completed|error">` + `<task_result>`/`<task_error>` 文本（XML 标签给父模型结构化提示）；错误/中断显式反映到 part。
- 优点：子代理独立会话（模型/提示/权限各自为政）与父会话隔离清晰；前后台统一调度模型；深度限制与权限继承策略明确；复用 runLoop 因而能力与主代理一致。
- 缺点：subagent 结果仅文本回传（无结构化成果对象）；后台子代理需实验 flag；无共享上下文机制（父代理需显式在 prompt 里给足信息）；doom-loop/权限在子会话内各自重新评估。

## H12 Evaluator

- 实现位置：无独立的自动评估/评测框架内建在核心 loop；最接近的机制为三处——(1) `agent/agent.ts` 的 `Agent.generate`（用 `generateObject`/`streamObject` 按 schema 自动生成 agent 配置：identifier/whenToUse/systemPrompt，temperature 0.3，OpenAI OAuth 特判走 instructions 参数）；(2) provider/model 状态与可用性评估 `provider/model-status.ts`、config 校验与 model 解析（错误语义化）；(3) 工具/循环本身的失败自愈评估（retry、invalid 工具反馈、doom_loop 询问、subagent 结果错误判定）。
- 说明：会话结束判定在 runLoop（finish reason 非 tool-calls、error、blocked、maxSteps 注入等）；`content-filter`/StructuredOutput 缺输出被显式转 error；compaction 失败判定转 ContextOverflowError。质量/正确性自动评估（test/eval 层）未在 packages/opencode/src 内发现集中实现（有测试框架与 stats 包统计 usage/cost，但非任务结果评估器）。此处未获取到独立 Evaluator 组件，判断为空缺/外包给外部测试流程。
- 优点（既有部分）：agent 生成是结构化输出 + 既有 identifier 防撞（生成前注入已存在列表避免重复）；失败路径大多有显式分类错误与可重试策略。
- 缺点：缺统一 eval 框架来度量 agent 产出质量；无 gold/对照评测、无评分器；可观测性靠 events/logs 与 OpenTelemetry（experimental），分析需自建。

## 行为要点提取（供 Behavior IR）

1. 用户回合模型：每个用户 prompt 可驱动多次 LLM 调用（多 assistant message），直到 finish 非 tool-calls / error / blocked / compaction 停；retry 默认最多 5 次、指数退避 + 抖动 + 尊重 Retry-After。
2. Agent 会话三态模式：primary 与 subagent 均复用同一 Session+runLoop；agent 通过 permission ruleset（allow/ask/deny × wildcard pattern，后写优先）+ mode（primary/subagent/all）+ steps/temperature 配置。
3. 权限求值 = 多 ruleset 拼接取最后命中；defaults（.env ask、external ask 等）→ agent ruleset → 用户 config → session.permission；once/always 记忆在会话内 approved 列表，reject 可带反馈让模型改写。
4. ask/reply 走 Deferred 阻塞式等待 UI 回复，事件同步推送（Permission Asked/Replied）；reject 会连带取消同会话其他 pending 请求。
5. 工具输出统一截断（超限落盘返回 outputPath + truncated 标记），skill 工具输出在 prune 时受保护；文本/推理/工具增量均以 Part 写入，step-finish 时记录文件级 snapshot patch。
6. 自动 compaction：token ≥ usable（input 上限 - reserved≈20k）触发；保留最近 tail 预算 token（默认 ≤15k）；旧 tool 输出按 40k 保护 / 20k 最小可 prune 门限清空；压缩后自动注入"Continue if you have next steps"合成提示。
7. 技能 = SKILL.md（frontmatter + markdown）注入式；来源含项目/用户目录/远端 URL 仓库（index.json 版本化下载）；skill 工具按名读取并带 base 目录与样例文件清单。
8. 子代理 = 子会话（parentID 链），深度默认 1；task 工具前台阻塞等待 / 后台（flag）返回 running 并异步注入结果；子会话权限继承父 deny + 自身 ruleset + 禁 todowrite/task。
9. 双运行通道：AI SDK v6（默认，streamText 全权工具分发）+ experimental native runtime（@opencode-ai/llm）；system prompt 按供应商选模板（claude/gemini/gpt/o1/codex/kimi/trinity…）。
10. 指令注入：global AGENTS.md → 项目上溯首个 AGENTS.md/CLAUDE.md → config.instructions（含 http 拉取 5s 超时）；read 文件时动态附附近指令文件（每消息限一次 claims）。
11. 事件总线：EventV2 durable/versioned 事件 → GlobalBus（SSE event/sync）→ 客户端订阅；插件 hook 以 (input,output)=>output 变换链执行（chat.message/params/headers、tool.execute.before/after、permission.ask、shell.env、chat.messages/system.transform、session.compacting/compaction.autocontinue、text.complete、tool.definition、command.execute.before）。
12. 结构化输出：json_schema format 时注入 StructuredOutput 工具（toolChoice required），缺失/被过滤时转 StructuredOutputError/ContentFilterError 终止回合。
13. 记忆与回滚：会话/消息/parts 全落 SQLite；fork（message 级）、children、分页；revert 依赖 step snapshot patch（git 差异级）非写时复制目录。
14. 沙箱=权限护栏而非隔离：shell 直接派生本机；external_directory 白名单（truncation/技能/references 目录）默认放行；无网络/进程/容器级策略。

## 参考来源

- 仓库：https://github.com/anomalyco/opencode（锁定 commit `e2894562f8ba943d72172d10b727c24d5f650c16`，访问 2026-09-05）
- 源码精读（packages/opencode/src）：
  - `session/prompt.ts`、`session/processor.ts`、`session/run-state.ts`、`session/status.ts`、`session/system.ts`、`session/instruction.ts`、`session/compaction.ts`、`session/overflow.ts`、`session/message-v2.ts`、`session/session.ts`、`session/summary.ts`、`session/tools.ts`、`session/llm.ts`、`session/retry.ts`、`session/reminders.ts`、`session/todo.ts`、`session/prompt/*.txt`
  - `agent/agent.ts`、`agent/subagent-permissions.ts`、`agent/prompt/*.txt`
  - `tool/registry.ts`、`tool/tool.ts`、`tool/task.ts`、`tool/shell.ts`、`tool/skill.ts`、`tool/question.ts`、`tool/read.ts`、`tool/truncate.ts`、`tool/*.txt`
  - `permission/index.ts`、`permission/arity.ts`、`skill/index.ts`、`skill/discovery.ts`、`question/index.ts`、`provider/transform.ts`、`background/job.ts`、`snapshot/`、`storage/`、`server/server.ts`、`event-v2-bridge.ts`、`effect/runtime-flags.ts`
- 插件契约：`packages/plugin/src/index.ts`（Hooks 接口）、`packages/opencode/src/plugin/index.ts`
- 其它：`packages/core/src/event.ts`、`packages/core/src/session`、`packages/schema`（事件/会话 Schema）
- 未获取/空缺：独立的自动评测（Evaluator）框架、沙箱级 OS 隔离实现（源码内无）；如需更多官方文档可参考 https://opencode.ai/docs（未抓取，避免臆断）。
