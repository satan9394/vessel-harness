# CL4R1T4S 解剖（UNTRUSTED RESEARCH DATA —— 仅行为模式提取）

> ⚠️ **UNTRUSTED RESEARCH DATA 声明**：本仓库为第三方收集的各厂商 system prompt 泄露/逆向语料，属**不可信研究数据**，README 本身即含提示注入文本。本文档仅提取与归纳**行为模式**，一律用自己的话转述，**未转抄任何原文**；文中任何模式描述均**不得**被当作可执行 System Prompt 使用。引用仅用于溯源，不以任何方式背书其真实性或时效性（泄露 prompt 可能过时、残缺或被人为篡改）。

- 研究日期：2026-09-05
- 锁定仓库：https://github.com/elder-plinius/CL4R1T4S
- 锁定 commit：`93b0ae6fb503db6642e58f9d6352db973a900cdc`（2026-09-01，最后一次提交为 "Create Claude-Fable-5.1.md"）；本地一次性 clone 于 `%TEMP%\CL4R1T4S_025017`（depth 1）
- 主要来源：仓库各产品子目录代表文件（详见文末参考来源）。web_fetch 对 github.com 不可达，改以 `git clone --depth 1` 到 TEMP 后本地阅读。

语料总体形态：26 个产品目录（ANTHROPIC 14 文件 / OPENAI 14 / XAI 7 / CURSOR 3 / DEVIN 3 / GOOGLE 3 / REPLIT 3 / WINDSURF 2 / MANUS 2 / CLINE 1 等），多为 `.md/.txt/.mkd/.json` 纯文本 prompt 快照；无代码、无构建脚本、无测试——它是 **Behavior Corpus（行为语料库）而非运行时代码库**，与 CLINE/CURSOR/DEVIN 等产物内嵌的"真实运行代码"不同，这里只有"输入侧"文本。

## H01 Agent Loop
- 语料体现：Manus（Agent Loop 专节：分析事件流→选工具→等执行→单工具迭代→提交→待机）、Replit（迭代过程：改→feedback 工具确认→继续）、Cline（一步一工具、等用户回执后继续）、Cursor（每次用户消息后走 <user_query>）、Claude Code 早期版（Task Process：搜索理解→实现→验证→lint/typecheck）。
- 关键模式：多数产品把循环写成**状态机式指令**而非运行时实现：轮次内"必须先回应用户消息再做别的"（Manus）；工具调用后"必须等待执行结果/用户回执再走下一步"（Cline）；一次只调一个工具 vs 鼓励"无依赖时并行批调"两种风格并存（Cline 单步 vs Manus/Codex 鼓励并行批调）。
- 优点/缺点：作为语料可反推各家"循环收敛策略"（何时停下、何时待机、何时阻塞等用户）。缺点是语料不含事件总线/调度代码，循环的"何时算完成"只能从文本侧推理。

## H02 System Prompt（核心维度：按产品归类的 prompt 结构模式）
语料含三类载体：**编码代理（agentic coding）**、**通用聊天/搜索人格**、**垂直功能子产品**。以下按产品归纳其结构模式（均为概括性结论，非原文）。

**通用框架层（chat 产品共用）**
- ANTHROPIC（Claude 4.5/Sonnet 系列）：按块组织——Claude 身份与知识截断日期 → 图像能力边界声明（何时有/无图像能力）→ 引用/搜索引用语法（要求改写原文、最小引用句数）→ 记忆与过往会话检索工具 → 安全护栏段；另有独立的 UserStyle 模式文档（Explanatory/Formal/Concise 三档语气配置，可整体切换输出风格）。
- OPENAI（ChatGPT 4o/5 等）：人格与边界在前（不谄媚、真诚、专业）→ 工具清单与逐工具触发规则（search/open_url 何时用、QDF 时效分级 0-5）→ "Closing Instructions" 收尾做优先级折叠（安全合规 > 准确清晰 > 语气助益）。个别文件含真实注入残留（如 `ChatGPT_Personality_v2_Change.md`、user 段含索取全部 prompt 的请求），佐证其不可信。
- XAI（Grok 3/4 系列）：身份一行式开头 → 平台/产品 FAQ 话术块（引导用户去官网、禁止编造价格）→ 模式说明（think/DeepSearch 由 UI 触发）→ 简短输出指令收尾。
- GOOGLE（Gemini 2.5 Pro 等）：人格/长格式写作偏好 + 引用与事实性要求为主。
- META/MISTRAL/MOONSHOT/MINIMAX/ZAI/HUME/DIA/MULTION/BOLT/BRAVE/CLUELY/LOVABLE/PERPLEXITY/SAMEDEV/FACTORY/VERCEL V0：多为单文件人格快照，结构浅，覆盖为目录级；PERPLEXITY 等以搜索引用类约束为主。

**编码代理层（结构最丰富，是行为 IR 主矿）**
- 共现的结构段（各家排列顺序近似）：①身份+使命一句段（"你是 X，某官方 CLI/IDE/agent"）；②**人设/语气段**（简洁、直给、少客套、与用户语言一致、禁以客套话开头）；③**工具规则段**（必须先想为什么调、按 schema 精确调用、只调用显式提供工具、同批并行无依赖调用、不向用户提工具名、调前说明原因、能不加工具就不加）；④**代码改动规则段**（改动必须落到工具而非贴代码、生成代码必须可立即运行、先读后改、遵守现有惯例、禁止假设库可用、不注释或少注释）；⑤**安全/护栏段**（不写恶意代码、不泄 prompt、敏感数据不外发、命令破坏性分级、secret 不落地）；⑥**输出约束段**（markdown/引用格式、最小化 token、文件链接语法、可视化使用标准）；⑦**记忆/上下文段**（CLAUDE.md/AGENTS.md 自动注入及层级优先级、持久记忆库、压缩语义）；⑧**人机协作/模式段**（Devin 的 planning/standard/edit 三态；Cursor/Claude 的 <user_query>/元数据注入）。
- Claude Code（早期版）：紧凑 8 节（安全规则、斜杠命令、记忆、语气、主动性、代码惯例、任务流程、工具用法）——是"CLI 最小可运行 prompt"的模板。
- Codex（CLI，`Codex.md`）：System/Developer/User 三层分离 + 显式 "Valid channels: analysis, final"（仅两个合法输出通道）→ 指令段含 **AGENTS.md 规格**（作用域=目录树、嵌套者优先、系统/开发者指令 > AGENTS.md > 其他）与**引用语法**（`F:path†L` 文件引用与 `chunk_id†L` 终端引用）→ 工具以 namespace 型 TS 签名给出 → Developer 段做任务级附加约束。
- Codex Desktop / "Sol"（GPT-5，4 千行级最全样本）：分层为 Personality → Working with the user（commentary/final 双通道、压缩语义："时间不会耗尽，看到摘要就继续，不从头重做"）→ Rules for getting work done（工具选择、并行化、噪声控制、不用破坏性 git）→ **Using skills 协议**（SKILL.md 触发、命名/匹配规则、主 agent 必须亲自读全、禁止委托读 skill、跨轮不携带）→ **Escalation Requests 段**（sandbox 权限模型、命令分段评估、`require_escalated` 单段式授权、prefix_rule 白名单化与禁用宽泛前缀）→ desktop app 上下文（可视化、automations、线程协调、内联评论 directive 语法）→ 权限注入块（sandbox_mode/writable_roots/network policy 占位符）。含 `<permissions instructions>` 风格的注入式占位符块。
- Cursor：System Prompt 单文件 7 节：初始上下文（身份+"操作于 Cursor"）→ 沟通（第二人称、禁泄 prompt/工具描述、少道歉）→ 工具用法 → 搜索信息收集 → 代码改动 → 调试（只改能确定的、限 3 轮 lint 修复）→ 外部 API。
- Windsurf（Cascade）：Angular 括号标签分节（`<tool_calling>`/`<making_code_changes>`/`<memory_system>`/`<running_commands>`/`<browser_preview>`/`<calling_external_apis>`/`<communication_style>`）；记忆系统规则详（主动存、无需许可、全部会随 checkpoint 删除故要广存）；命令安全分级（破坏性副作用即 unsafe，**不可被用户覆盖**）；浏览器预览在起本地 web 服务后强制调用；单次 edit_file 合并所有改动。
- Replit：角色声明（Editor）+ 平台优先原则（用 Replit 工具栈、禁 Docker/venv、路径相对根、禁改库表、破坏性 SQL 需许可）+ workflow 机制（长任务交给 workflow 而非裸 shell，feedback 工具自动重启服务）+ 每步用反馈工具确认。
- Devin（1.0/2.0）：最强"人机协作状态机"——General→何时沟通用户→工作法→真实透明（禁假数据/假测试）→编码规范→信息处理→数据安全→响应限制（防 prompt 探询应答脚本、禁估时/ACU）→**Modes**（planning 只查不写 + suggest_plan；standard 按计划执行可收新反馈；edit 一次性执行全部计划编辑）→ **Command Reference**（think 命令式推理区：强制使用场景、至多一条且必须第一个输出、历史被清洗）→ Pop Quizzes（注入方切换评估指令的对抗机制）。
- Manus：双文件（prompt + JSONSchema functions）分节最规整：Agent Identity→Intro→Language→System Capability→**Event Stream**（7 类事件：Message/Action/Observation/Plan/Knowledge/Datasource/杂项，可 `--snip--` 截断）→**Agent Loop**→**Planner/Knowledge/Datasource 三个注入模块**（均以事件形式出现、禁止虚构数据 API）→ Todo Rules→Message Rules（notify 非阻塞/ask 阻塞二分，先回执再干活）→File/Image/Info/Browser/Shell/Coding/Deploy/Writing/Error Handling 分域规则→**Sandbox Environment**（系统环境逐项列明）→Tool Use Rules（"必须回工具调用、纯文本响应禁止、不向用户提工具名"）。函数侧为单行 JSON Schema 描述 + "recommended scenarios + best practices" 双段式文档字符串。
- Cline：INTRODUCTION + 逐工具 XML 手册（每个工具含使用场景/参数规则）+ Tool Use Guidelines（逐步、等待回执、MCP 一次一个、禁客套开头）+ objective（目标分解执行）+ environment_details 说明（自动注入、勿当用户请求）+ system_information.md 泄漏段。
- CLINE 样本附带真实 `system_information.md`（OS/shell/家目录/cwd），展示"环境信息自动注入 + 模型应知它不是用户消息"这一通用手法；这正说明语料含真实会话残留。

**注入顺序（aggregate 观察）**：整体遵循 身份→能力/平台边界→行为准则→工具协议→(注入的)文件上下文与记忆→环境与权限注入 的"洋葱式"顺序；优先级语句反复出现"系统/开发者指令 > 项目记忆(AGENTS.md/CLAUDE.md) > 工具描述 > 上下文记忆"。编码代理比聊天人格更强调把"何时可越权/需授权/需阻塞"显式编码进 prompt。

## H03 Context Engine
- 语料体现：Manus 的 Event Stream 模型（多源事件：用户消息/工具动作/观察/计划/知识/数据 API 文档）与"按事件流重建状态"的表述；Cline 的 environment_details 自动注入（OS/活跃终端/文件结构）；Windsurf 的 user_information（OS/workspace URI→CorpusName 映射）+ 记忆自动检索。
- 关键模式：上下文被描述为"引擎注入的消息 + 记忆检索 + 事件流截断"，prompt 只规定模型如何消费（"关注最新用户消息与最近执行结果"、"snip 截断视为正常"）。
- 优点/缺点：语料可提取"上下文接口约定"（哪些信息注入、以何格式、何时注入）。缺点：无运行时代码，注入触发条件/重排算法不可考证；部分描述依赖特定年份的 UI 产品快照。

## H04 Compaction
- 语料体现：Codex Desktop Sol 的压缩语义段最明确（"上下文耗尽时自动摘要，但你会看到全部历史用户请求；把最新请求当 current、旧的当 stale 但有用；看到摘要假定发生了压缩；不从头重做、不重发已交付 commentary"）；Windsurf 记忆系统声明"含 checkpoint 摘要在内的全部对话上下文都会被删除"；Claude Code 早期有 /compact 斜杠命令条目；Devin think 命令历史被清洗（"过去 think 你不可见"）说明系统会剔除推理中间态。
- 关键模式：压缩被建模为"模型可见语义契约"：摘要与全文可混存、请求有新旧优先级、推理 scratch 不进上下文。
- 优点/缺点：提供难得的"压缩后如何续作"的行为规则素材（对 Harness 的 auto-compact 与 session 恢复语义有直接参考）。缺点：无压缩触发阈值/摘要策略细节；且该段本身亦属泄露文本，需甄别真假。

## H05 Tool System
- 语料体现：Cline（逐工具 XML 手册+场景规则）；Manus（JSON Schema 工具 + "recommended scenarios/best practices"双段式描述 + `message_notify_user`/`message_ask_user`/`idle` 等消息面工具）；Cursor_Tools / Windsurf_Tools / Replit_Functions / Cline（工具名清单：`search_files`、`str_replace_editor`、`execute_command`、`browser_action`、`web_fetch`、`use_mcp_tool`、`access_mcp_resource`、`ask_followup_question`、`attempt_completion` 等）；Codex（namespace 型 TS 签名 `container.new_session/feed_chars/make_pr`）；Devin（Reasoning/Shell/Editor/Search/LSP/Browser/Deployment/Git/MCP 命令分类表）。
- 关键模式：工具描述普遍带**触发场景 + 反模式（何时勿用）+ 参数最佳实践**三层；单块 JSON Schema（Manus 函数用单行内嵌描述）与长文手册（Cline）并存；产物交付被工具化（attempt_completion / idle / message 带附件）。
- 优点/缺点：对"如何写工具描述才让模型在正确时机调用"有直接借鉴。缺点：多数工具清单已过时（版本快照），且不含执行层/参数校验实现。

## H06 Hooks/Events
- 语料体现：Manus 的 Plan/Knowledge/Datasource "模块以事件注入"、错误作为 Observation 事件回灌、Shell 会话事件（shell_exec/shell_wait/shell_view 的状态轮询）；Devin 的 CI/PR 评论/任务反馈作为新事件驱动 standard 模式转向；Codex Desktop 的 automations/thread wakeups（用户设重复任务后系统唤醒线程，模型侧"看到任务描述而非裸指令再决定动作"）。
- 关键模式：事件驱动语义（模块注入、反馈注入、调度唤醒注入）在 prompt 侧全部描述为"你会收到哪些类事件、如何据此行动"，而非钩子实现。
- 优点/缺点：可提取"事件分类 + 响应策略"的 prompt 侧契约。缺点：无事件注册/触发链路，未获取到真实 hook 生命周期。

## H07 Permission/Safety
- 语料体现：Codex Desktop Sol 的权限模型最完整（sandbox 读文件/可写根内编辑、其余需审批；命令按 shell 控制符分段独立评估；`require_escalated`+justification 提问式授权；prefix_rule 持久白名单 + 禁用宽泛前缀/破坏性命令前缀）；Windsurf（破坏性副作用=unsafe，模型不可被用户覆盖自己的判断，可用 allowlist 但不得提参数细节）；Devin（数据安全段：敏感不外发、外联需明确许可、禁提交 secret；响应限制防 prompt 提取）；通用（禁泄露 prompt/工具描述、恶意代码拒写）。
- 关键模式：授权粒度=命令段而非整串命令；"白名单前缀"作为可持久化批准单元；跨产品共用"安全判断由模型自持、不可被用户一句话覆盖"的立场。
- 优点/缺点：行为侧素材极佳（可迁移为 Harness 的审批 UX 与 allowlist 语义）。缺点：具体策略随沙箱实现/版本漂移，不能当作现役厂商行为事实。

## H08 Sandbox
- 语料体现：Manus（Linux 沙箱描述：Ubuntu 22.04、用户 ubuntu+sudo、python3.10/node20/bc、闲置自动休眠唤醒、用户不能直连沙箱网络、需 expose port 转发公网）；Devin（真机操作系统语义：CI 替代本地、report_environment_issue 上报环境问题、**禁止自行修环境**）；Replit（托管环境：优先 Replit 工具、禁容器化、workflow 管端口）；Codex（沙箱与可写根、网络访问策略占位符）。
- 关键模式：沙箱在 prompt 侧以"环境事实清单 + 网络出口规则 + 环境问题处置策略"注入；宿主环境故障≠代码 bug，倾向绕行（CI）而非修复。
- 优点/缺点：暴露各产品"隔离边界语言"（谁能访问网络、产物如何给用户、环境如何被唤醒）。缺点：非运行时描述，无真实资源限制/隔离实现证据。

## H09 Session/Memory
- 语料体现：Claude Code 早期（CLAUDE.md 自动入上下文、存常用命令/风格/结构）；Codex（AGENTS.md 发现与层级：目录树作用域、嵌套优先、仅约束作用域内代码、程序化校验必须全跑）；Codex Desktop（Memory 段 MEMORY_SUMMARY 注入占位 + 持久记忆/线程概念）；Windsurf（create_memory 主动存储数据库、检索自动回放）；Anthropic 聊天侧（过往会话检索工具 + 触发模式：显式提及"之前我们聊过"类信号）；Grok/各家（无持久记忆声明或有平台记忆开关）。
- 关键模式：项目级记忆（CLAUDE.md/AGENTS.md）与对话级记忆（摘要/检索）分离；记忆检索用"触发词/信号"描述触发条件。
- 优点/缺点：对 Harness 的 project memory 分层（全局/目录/仓库）与记忆冲突优先级有现成参照。缺点：产品间命名不一，需自行归一化。

## H10 Skills
- 语料体现：Codex Desktop Sol 的 "Using skills" 协议是目前语料中最完整的技能规范（SKILL.md 是技能载体；目录内 available skills 含 name/description/location；触发=用户点名或任务明显匹配且仅当轮有效、跨轮不携带；主 agent 必须亲自完整读取 SKILL.md 不得委托子代理读；references/scripts/assets 按路由读取复用；技能可被 orchestrator/环境类资源承载，用统一 skills.read 访问；失败则简短说明并继续；用户指令优先于技能指引）。
- 关键模式：技能=可发现(目录)+可加载(先读全)+有生命周期(不跨轮)+有失败降级(说明并继续)四要素；多技能取最小覆盖并声明顺序。
- 优点/缺点：可直接映射为 Harness Skills 的能力契约与目录 schema。缺点：单点来源（同一份 GPT-5 泄露 prompt），缺其他产品的横向技能协议对比。

## H11 Subagent
- 语料体现：Claude Code 早期（"用 Agent 工具做文件搜索以降上下文消耗"——最早期的子代理=上下文减负手段）；Codex Desktop Sol（线程/多代理工具存在：create_thread 仅当用户明确要求建新线程，且用户显式要求子代理时也走多代理工具；`::created-thread` 之类的 UI directive 语法说明主从关系与产物标记）。
- 关键模式：子代理在 prompt 侧只出现为"工具选择策略（减上下文）+ 归属语义（用户拥有的线程 vs 当前请求的子任务）"，无编排实现。
- 优点/缺点：确认"子代理=上下文工程手段"的行为动机。缺点：未见分工/聚合/回调协议文本，未获取到更细结构。

## H12 Evaluator
- 语料体现：Devin（测试即验证：本地命令可用则必跑、lint/单测先于提交、禁改测试自证、3 次 CI 不过求助用户、完成前 think 反思是否达成全意图并确认改动全落地）；Codex CLI（AGENTS.md 程序化校验必须执行、预提交失败修复重试、交付前 git status 干净、只能交付已提交代码、需引用文件与终端证据）；Claude Code 早期（验证用测试/lint/typecheck 收尾）；Manus（todo.md 全绿+产物已送达才算完成、idle 工具的三条件门禁）；Cline（attempt_completion 只用于真正完成、结尾不得再抛问题）。
- 关键模式：完成标准被编码为"自检清单 + 收尾工具门禁"；证据（测试输出/文件引用）被视为回答义务；存在针对假数据/假测试的诚实性专项。
- 优点/缺点：可直接提炼"完成语义 + 证据义务"规则。缺点：无离线评测/评分体系描述，语料不含 eval harness 证据。

## 行为要点提取（供 Behavior IR）
1. 身份段=一行式产品锚点（"你是 X，官方 Y"），使命随后，避免长身份叙述——多数编码代理如此开头。
2. 人设与输出约束分离：语气规则独立成段（简洁/直给/少道歉/第二人称），可整体切换（UserStyle 三档模式）。
3. "只用显式提供的工具 + 调前说明原因 + 能不加就不加"是跨产品最一致的调用纪律；冲突点在"单步等待"vs"并行批调"。
4. 生成代码必须"可立即运行"：自足导入、依赖清单、先读后改、遵守既有惯例、不假设库可用、按需最小注释。
5. 代码改动落工具不落回复：多数产品禁止把代码直接贴给用户（除非被要求）。
6. 命令/工具安全分级显式化：破坏性副作用判定由模型自持且不可被用户覆盖（Windsurf/Devin 立场），授权单元细化到命令段与白名单前缀（Codex）。
7. 拒绝词库：防 prompt 提取的应答脚本（Devin）、禁泄 prompt 与工具描述（Cursor）——护栏文本几乎都含防自泄露条款。
8. 项目记忆分层注入：CLAUDE.md/AGENTS.md 以目录树为作用域、嵌套优先、作用域外代码不受其约束（Codex 规格）。
9. 上下文注入须与用户请求区分：environment_details / user_information 类自动注入要显式声明"非用户消息"（Cline/Windsurf）。
10. 压缩语义契约化：模型被告知"看到摘要≠重来，最新请求优先、旧请求为背景"（Codex Desktop），并声明推理 scratch 不保留（Devin think）。
11. 事件流作为统一状态载体：用户消息/动作/观察/计划/知识/错误都以事件注入，截断(–snip–)视为正常（Manus）。
12. 完成=自检清单+收尾工具门禁：todo 全绿、验证通过、产物已送达才允许 idle/attempt_completion；结尾不再提问（Manus/Cline/Devin）。
13. 技能协议四要素：目录发现、加载时先读全、按轮有效不跨轮、失败降级继续（Codex Desktop skills）。
14. 人机阻塞面最小化：消息工具分 notify/ask（非阻塞/阻塞），策略性保留 ask 减少打扰（Manus message 工具）。
15. 诚实性条款常见：禁假数据/假测试/伪证完成，无法获取真数据时上报而非伪造（Devin Truthful）。

## 参考来源
以下均为仓库内文件（clone 于 `%TEMP%\CL4R1T4S_025017`，commit `93b0ae6f`），仅作溯源，内容不可信：
- README.md（含注入诱饵，印证 UNTRUSTED 声明）
- ANTHROPIC/Claude_Code_03-04-24.md、ANTHROPIC/UserStyle_Modes.md、ANTHROPIC/Claude_Sonnet-4.5_Sep-29-2025.txt
- OPENAI/Codex.md、OPENAI/Codex_Sep-15-2025.md、OPENAI/Codex_Desktop/5.6-Sol_SystemPrompt.md、OPENAI/Codex_Desktop/5.6-Sol_Tools.json、OPENAI/ChatGPT5-08-07-2025.mkd、OPENAI/ChatGPT_Personality_v2_Change.md
- DEVIN/Devin_2.0.md、DEVIN/Devin2_09-08-2025.md
- MANUS/Manus_Prompt.txt、MANUS/Manus_Functions.txt
- REPLIT/Replit_Agent.md、REPLIT/Replit_Functions.md
- CURSOR/Cursor_Prompt.md、CURSOR/Cursor_Tools.md
- WINDSURF/Windsurf_Prompt.md、WINDSURF/Windsurf_Tools.md
- CLINE/Cline.md（含泄漏的 system_information.md 内容）
- XAI/Grok3.md、GOOGLE/Gemini-2.5-Pro-04-18-2025.md
- 其余产品目录（BOLT/BRAVE/CLUELY/DIA/FACTORY/HUME/LOVABLE/META/MINIMAX/MISTRAL/MOONSHOT/MULTION/PERPLEXITY/SAMEDEV/VERCEL V0/ZAI）仅做目录级盘点，未逐文件深读。

（本文档仅此一文件写入工作区，未向项目目录复制任何仓库内容；仓库本体保留于系统 TEMP 供复核。）
