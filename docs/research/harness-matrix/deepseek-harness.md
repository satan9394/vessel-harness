# DeepSeek Harness 解剖

- 研究日期：2026-09-05
- 锁定仓库：https://github.com/deepseek-ai/deepseek-harness
- 锁定 commit：`d347e703908d0406b7a7ef80e3a0e594d86b2215`（main，2026-09-05 访问；`git clone --depth 1` 于 `%TEMP%\dsh-repo-20260905014747`）
- 本机安装：`@deepseek-ai/dsh@0.1.2-alpha.5`（D:\...\nvm_a\v24.14.0\node_modules\@deepseek-ai\dsh）与 `C:\Users\USER\.dsh\profiles\node_modules\@deepseek-ai\` 下约 200 个已发布包（版本 0.1.2-alpha.5 系列）；两者与仓库 HEAD 存在版本差异，正文以仓库 commit 为准，本机安装用于验证发行形态
- 主要来源：README.zh.md / AGENTS.md / docs/architecture.zh.md / docs/subsystems/*.zh.md / .agents/notes/implemented/**（设计决策记录）/ packages/**（源码）/ 本机已安装包 README

**一句话定位**：dsh 是一个"一切皆插件"（Everything-is-a-Plugin）的 Cordis 插件树 agent harness：产品每一部分（模型适配器、工具注册表、会话日志、agent loop 本身）都是可从配置替换的插件；会话是一条仅追加的类型化事件日志（event-sourced），模型历史从日志派生；loop 保持"唯一具体实现、可替换"的最小核，其余全部挂在类型化事件扩展点上。官方仍处于 Developer Preview（可能破坏性变更），构建于 vendor 的 [Cordis](https://github.com/cordiverse/cordis)（论文《A Programming Paradigm for Spatiotemporal Composability》, arXiv:2608.25512）。

---

## H01 Agent Loop

### 实现位置
- 唯一具体循环：`packages/core/agent-loop`（`src/index.ts` 插件入口与工厂注册、`src/agent.ts` 的 `ReactLoopAgent` 驱动器、`src/tool-calls.ts` 工具调度、`src/constants.ts` 的 `DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10`、`src/invariant.ts` 可重建性不变式）。
- 抽象面：`packages/core/agent`（`ctx.agents`、`Agent` 句柄、`agent/*` 事件）；`packages/llm/llm`（`ctx.llm` 流式 seam）。
- 重试：`packages/llm/llm-retry`（失败请求重试执行器）。
- 本机安装包：`dsh-agent-loop`、`dsh-agent`、`dsh-llm-retry`（lib/index.js 等）。

### 核心流程
"步骤"= 一次模型请求 + 它调用的工具；"轮次"= 零或多个步骤。官方时序（docs/architecture.zh.md#turn-flow）：

```
turn/start
  claim next-step 输入 + 一条排队消息（inbox）
  组装 prompt sections + tool schemas
  -> agent/pre-step (waterfall) reject | enter(messages, startsRequestSeries?)
     reject 或改写为空 -> 关闭不含步骤的轮次
     step/start
     追加 entered messages 为 user/message
     从日志派生历史 deriveMessages()
     agent/request -> llm/stream -> agent/assistant-stream start/chunk*/end
       assistant/message | assistant/attempt
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     工具要求继续或新输入到达 -> claim -> 下一步
  -> agent/turn-stopping (serial)
turn/end
```

- **一轮开始**：驱动器在轮次边界先开持久轮次，再原子领取 pending next-step 输入 + 一条排队提示词（`Inbox.claim`）；消息经 `agent/pre-step` waterfall 决定是否进入步骤；进入决定在 `step/start` 后追加完整 `user/message` 批次。
- **Model Request 构建**：`agent/request`（waterfall）后校验 `provider`/`model` 必须存在（缺省可补齐、无适配器则以 `NO_ADAPTER` 失败）；渲染系统提示词 + 可见工具 schema + 派生历史；`request/header` 事件把完整 envelope（调用配置、适配器默认值、system、tools）写入日志，使每个请求可重建（`foldRequestHeader`）。
- **Tool Call 进 Runtime**：模型工具调用经"受守卫的工具流水线"分发（详见 H05）；`maxParallelToolCalls`（默认 10）限制并行安全调用，独占调用单独运行并构成排序屏障。
- **Tool Result 回模型**：每个被接纳的结果追加 `tool/result` 到会话日志，下一步据此重新派生历史。
- **Stop Condition**：轮次在"不再欠下任何工作"时关闭；`agent/turn-stopping`（serial）在无工具/steering 后续时运行，可强制再执行一步。**无内置轮次预算**（README 明示：限制失控轮次的策略必须从扩展点如 `agent/turn-stopping` 执行取消）。
- **最大轮次**：无。唯一相关上限是 `maxParallelToolCalls` 与各策略自行施加的预算。
- **Retry**：`agent/request-error` waterfall（失败步骤关闭后、轮次关闭前）；监听器返回 `{ kind: 'retry' }` 且不调用 `next()` 即恢复；`dsh-llm-retry` 执行器在等待前先把 `llm/retry` 事件持久化（"先持久、后等待"），normal mode 对 `EMPTY_RESPONSE/RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT` 指数退避最多 5 次（默认），always mode 无尝试上限；提供方适配器拥有按路由 `retryPolicy`；压缩溢出重试（`compactionRetries`/`maxOverflowRetries`，见 H04）另计。
- **Error Recovery**：未处理失败为终态（`turn/end { kind: 'error' }`，结构化 `LlmFailure`）；崩溃恢复由持久层在 resume 时合成 `interrupted` 关闭器（见 H09）；取消是协作式（`agent.cancel()`，取消的流以 `interrupted: true` 前缀落盘，未分发工具调用得到 `ABORTED_BEFORE_DISPATCH` 合成结果）。

### 关键机制
- `ctx.agents.create()/resume()` 经 `setFactory()` 注册的工厂创建，插件只依赖 `agent` 抽象、绝不依赖 `agent-loop`，循环因此可整体替换。
- 创建是受回滚保护的事务：构造 → setup → 发布（`session/created`、`agent/created`、`agent/session-start`）→ 启动驱动器；setup 失败/commit 抛出/所有者 dispose 则回滚且不发布任何 id。
- 所有权：`AgentHandle.dispose()` 只有持有者可用；teardown 顺序固定（停排空 → 撤作用域 → detach agent → detach session）。

### 优点
- 循环极薄且可替换（接口-工厂分离）；模型可见事实全部落日志，可重建、可回放、可压缩。
- 并行安全显式化：独占屏障 + 有界滚动池，杜绝隐式并发竞态。
- 取消/重试/崩溃恢复都有持久化证据，不留隐形待办。

### 缺点
- 无内置轮次预算/最大轮次，失控循环需第三方策略自行拦截（README 明示为限制）。
- 会话/事件/作用域抽象较重，理解与二次实现成本高；"插件失败只关轮次不关循环"的边界对插件作者要求高。

---

## H02 System Prompt

### 实现位置
- `packages/core/system-prompt`（`ctx.systemPrompt`：`section()/context()/tools()/variable()/assemble()`，`system-prompt/assemble` waterfall，`system-prompt/change` 事件）。
- 工作区指令：`packages/context/agent-instructions`（`dsh-agent-instructions`：AGENTS.md/CLAUDE.md 加载、预算、baseline/refresh）。
- 部署 persona / agent 预设：`packages/preset/agent-presets`（persona 作为 `deployment:persona` 提示词段落）；计划模式：`packages/plan/plan`（`plan:policy` 段落，first-party 顺序 500）。
- 本机：`dsh-system-prompt`、`dsh-agent-instructions`、`dsh-agent-presets`、`dsh-plan-mode`、`dsh-persona`。

### 核心流程
1. 插件按 `ctx.systemPrompt.section({name, order, text|fn, complete?})` 注册片段；组装时按 `order` 升序、同 order 按名称 code-unit 排序（`getSectionOrder()` 集中分配仓库内顺序）。
2. `assemble(context)` 收集 global + 该 scope 的 sections、dynamic contexts、tool schemas（`ToolProviderResult`）、variables，然后跑 `system-prompt/assemble` waterfall（监听器可改写，返回权威值）；若存在有效 `complete` 段，组装后强制它成为唯一提示词段落。
3. 文本支持 `{{variable}}` 插值（`variable(name, provider)`，渲染时缺值即失败）。
4. 动态上下文 `PromptContext`（带来源的缓存安全结构）在快照变化时以持久 user-role 消息注入（见 H03）。
5. 每次请求前由 agent loop 调 `assembleContextFor(agent, signal)` 组装；组装结果（system 文本 + 工具 schema）写入 `request/header` 事件。

### 关键机制
- **分层与遮蔽**：scoped section/context/variable 遮蔽同名 global；agent preset 的常驻组合可给单 agent 注入独立段落；子 agent `persona` 遮蔽部署 persona（同模板语义）。
- **注入顺序**：sections（order+name）→ contexts（order）→ 工具 schema（允许列表）→ 历史消息（`deriveMessages`，在请求内）；工作区指令 baseline 作为**持久 user 消息**紧随已领取消息进入第一批次（宽泛→具体、用户全局在前），比系统提示词更"轻"、可压缩。
- **软性引导**：plan mode 等只注册提示词段落 + 工具，不限制工具目录（"引导而非强制"）。
- **污染防护**：模型可见 ⟺ 已记录；注入消息内字面 `</system-reminder>` 被转义，仓库控制文本无法关闭插件控制的框架；skill 目录 description 经 XML 转义；KV Cache 视角下任何组装变化都会破坏前缀复用（文档逐节标注影响）。

### 优点
- Prompt 完全插件化、可组合、可按 scope 遮蔽，无需改 loop；budget/截断/去重（AGENTS.md/CLAUDE.md 内容相同只渲染一次）内置。
- 软硬分离：引导走 prompt，强制走 sandbox/approval（详见 H07）。

### 缺点
- "部署 persona 空串即无 persona"等默认依赖组合层正确重述；patch 覆盖整行 config 不合并，覆盖方必须重述想保留的字段。
- 对 KV Cache 高度敏感：任何 system/tool 变化使复用失效，文档把这一点当作一等约束而非缺陷（但客观上成本敏感）。

---

## H03 Context Engine

### 实现位置
- 组装：`packages/core/system-prompt`（sections/contexts/tools/variables）；`packages/core/session`（`deriveMessages()`、surface、`request/context`）；`packages/llm/token-meter`（`ctx.tokenMeter` 定价/回放）；`packages/spill/*`（工具输出 spill，`maxInlineBytes: 50000` 默认）。
- 注入方：`dsh-agent-instructions`（工作区指令）、`packages/skill/tool-skill`（skill 目录）、`packages/context/*`（request-context 插件族）、`packages/interaction/user-approval`（审批策略快照）等，统一走 `agent.inject()`/pre-step 批次。

### 核心流程与加载顺序
1. **System**：`ctx.systemPrompt` 组装（H02）。
2. **Tool 定义**：`ctx.tools` 注册表 `schemas()` 按允许列表投影为模型可见 `ToolSchema[]`（回调/超时/展示元数据绝不外泄）。
3. **对话历史**：从会话日志 surface 派生（`user/message`、`assistant/message`、`tool/result` 三种 surface 事件按序投影；边界/attempt/日志事件不产生消息）；缓存每个 surface 节点一次，替换（compaction）时重建。
4. **项目指令**：`dsh-agent-instructions` 首步注入 baseline（用户全局 `$DSH_HOME/AGENTS.md` + 项目指令链，`.git` 标记根，`maxBytes: 65536` 默认；预算规则：先省略宽泛文件、最后截断最具体文件并可见通知）；后续由成功的 `read/write/edit` touch 驱动增量（新增/更新/移除通知）。
5. **Skills**：`dsh-tool-skill` 在首个非空完整视图的 pre-step 注入持久 `<system-reminder>` 目录（只含排序后的 name + XML 转义 description，无正文/路径）；digest 变化时 `agent.inject()` 替换。
6. **动态 Context / 注入**：`agent.inject()` 队列化模型可见上下文，在下一次获准的 pre-step 作为带来源 user/message 进入（文件变更通知、子目录 AGENTS.md、cron、goal 续跑等），**不唤醒**驱动器。
7. **RAG/文件**：无内置 RAG；等价物是 grep/glob/read 工具 + session 搜索（`session_search`，SQLite 全文，默认 `openAt: never` opt-in）+ 附件（content-addressed）。

### 关键机制
- **Token Budget**：`ctx.tokenMeter` 单例按已消费日志 revision 定价（路由适配器容量 `contextWindow` 记录于 `request/context` 事件）；指令/skill 目录/工具输出各有显式字节预算与截断策略；spill 策略把 >50KB 工具输出外置文件。
- **Trimming**：无逐条滚动窗口；由 compaction（H04）整体替换旧 surface 段；压力判断在 `agent/pre-step` 串行执行。
- **优先级**：scope 遮蔽 global；预算截断"宽泛先丢、具体后截"；注入上下文与普通提示词共用一条带来源 user/message 词汇，`source` 区分生产方。
- **污染防护**：`session.append` 强制 lossless-JSON 校验（非 JSON 数据在源头拒绝）；注入框架转义关闭标记；模型可见输入必须配套新 SessionEvent（否则运行时不变量失败）；surface 替换必须完整覆盖被遮蔽节点。

### 优点
- 单一真源（日志）+ 派生（surface/deriveMessages），无第二份"上下文状态"可漂移；所有注入可回放、可压缩、可恢复。
- 预算/截断/去重/转义系统化，防污染是类型与不变式层面强制，而非仅约定。

### 缺点
- 无长上下文窗口管理之外的 RAG/向量记忆（明确不提供，属设计取舍）；`request/header` 全量快照 + 每步派生带来额外日志体积与复杂度。

---

## H04 Compaction

### 实现位置
- seam：`packages/compaction/compaction`（`ctx.compaction` 抽象 + `compaction/*` 事件 + `toolPairingBalancedBefore/After`）。
- 后端：`packages/compaction/compaction-basic`（阈值/保留/摘要/溢出恢复，`src/region.ts`、`src/summarizer.ts`）。
- 配套：`packages/compaction/compaction-tool-result-pruner`（超长工具结果修剪）、`packages/compaction/command-compact`（`/compact` 手动）。
- 本机：`dsh-compaction`、`dsh-compaction-basic`、`dsh-compaction-tool-result-pruner`、`dsh-command-compact`。

### 核心流程
1. **何时压缩**：三入口——自动压力（`agent/pre-step` 串行监听器，默认 `thresholdRatio: 0.8` × 路由模型 contextWindow 触发）、上下文溢出恢复（`agent/request-error` 响应 `CONTEXT_WINDOW_EXCEEDED`，先压缩再重试，`maxOverflowRetries: 1`）、手动 `/compact`（`compactNow()` 作为轮次间 idle maintenance，未达压力也可压缩）。
2. **压缩什么**：最旧的**平衡** surface 范围（工具调用/结果必须配对，但可不整轮压缩）；保留近期尾部逐字（`retainRatio: 0.16` 或 `retainTokens`）。
3. **保留什么**：尾部对话逐字保留；旧段替换为一条 `<compacted-summary>` 框定的 user/message（`surfaceOp: { op: 'replace', start, end }`，`sourceEventSeqs` 覆盖全部被遮蔽节点）；原始摘要全文保留在仅日志的 `compaction/summary` 事件；被遮蔽 token 数记账。
4. **Tool Call/Result 完整性**：区域边界必须工具配对平衡；`dsh-compaction-tool-result-pruner` 在压缩前修剪超长结果（默认 `thresholdChars: 8192`、保留 head 4096/tail 1024），修剪本身无模型调用，可能让压缩完全跳过摘要；单次超大不可分单元无法修复（明示限制）。
5. **是否新 Session**：**否**——同一会话日志内原地替换 surface 节点；不启动新会话、不丢 `session/end-seed` 边界。
6. **状态恢复**：状态全部折叠自日志（`compaction/start`/`summary`/`end` 标记对即锁与账目）；崩溃遗留的未配对 `compaction/start` 可被检测（`busy`），早于 `session/end-seed` 的陈旧锁被忽略。

### 关键机制
- 先记账后执行：`compaction/start`（锁）→ 摘要生成 → `compaction/summary` + 替换 → 恰好一次 `compaction/end`；崩溃表现为可检测锁而非虚假完成。
- 摘要请求复用热前缀：逐字回放上次路由请求的 system/tools/被遮蔽区域消息，辅助调用成为会话真前缀（KV Cache 友好）。
- 摘要失败拒绝"不缩小的摘要"；`manualCompactionErrorCode` 覆盖 busy/cancelled/changed/summary/commit/persistence。

### 优点
- 事务化、可检测、可重放；不丢工具配对完整性；压力/溢出/手动三入口统一；KV Cache 前缀复用是显式设计目标。

### 缺点
- 摘要是一次额外模型请求（成本 + 延迟）；"不可分单元"（单条超大工具调用）无法修复；自动/溢出策略需要路由容量信息，动态路由容量缺失时自动路径降级为警告并带完整历史继续。

---

## H05 Tool System

### 实现位置
- 核心：`packages/core/tools`（`ctx.tools` 注册表、`ToolDefinition`、`defineTool` DSL、`ValueSchemaSpec` schema DSL、`tools/*` 事件、`ToolRestriction`）；`packages/core/scope`（按 agent 作用域注册原语）。
- 工具包：fs（`dsh-tool-fs`：read/write/edit/glob/grep/str_replace_editor/read_image/terminal_*）、shell（`dsh-tool-bash`、`dsh-tool-pwsh`）、web（`dsh-tool-web`：web_search/web_fetch，`dsh-web-search-deepseek`、`dsh-web-fetch-http` 提供方）、MCP（`dsh-mcp-client`：stdio/streamable-http）、LSP（`dsh-lsp`）、subagent（`dsh-tool-subagent`/`-control`）、skill（`dsh-tool-skill`）、session 查询（`session_event_*`、`session_search`）、jobs（`job_*`）、goal（`create_goal/get_goal/update_goal`）、todo（`todo_write`）、schedule（`schedule_*`）、workflow（`workflow`）、ralph（`ralph`）、ask-user（`ask_user_question`）、cordis 运行时（`cordis_define/run/stop/undefine/inspect_*`）、plan（`exit_plan_mode`）、code-runtime（`run_code`）。完整清单见 `docs/tool-catalog.zh.md`（62 个条目）。
- 本机：`dsh-tool-fs/lib/{read,write,edit,glob,read-image,...}.js`、`dsh-mcp-client/lib/{connection,tools,transport}.js` 等。

### 核心流程（执行流水线）
```
tool/call (会话事件, 原始 arguments JSON)
  -> tools/pre-execute (waterfall)  决策 allow | deny(reason) | ask(reason)
  -> ToolGuard (单调: 返回 reason 即否决, 无 allow 结果)
  -> tools/execute (waterfall 包装层, 可替换 signal 不可移除)
  -> 工具体 execute(args, exec) -> 规范 JSON value
  -> output.render(args, value) 投影为 ContentBlock; presentationMeta?; finalizeContent?
  -> tools/post-execute (waterfall) accept | accept(value) | block(feedback)
  -> tools/result (emit, 冻结的权威结果) -> tool/result 会话事件
```

### 关键机制
- **Schema**：`defineTool` 用类型化 `ValueSchemaSpec`（string/number/integer/boolean/null/array/object/json/oneOf）同时推导 TS 类型、编译 JSON Schema、校验参数与输出；参数错误 `ToolArgsError(INVALID_ARGS)`、输出错误 `ToolOutputError(INVALID_TOOL_OUTPUT)`。
- **Registry**：作用域化；每层注册 + 沿 scope 链合并；`ToolRestriction`（allow/deny 对**继承的 global 工具**过滤，交集后叠加本作用域自注册——子 agent 保留回报所需工具）；注册返回 exact disposer（effect 语义）。
- **Dispatch**：`ToolExecutionMode = parallel | exclusive`（独占屏障）；`maxParallelToolCalls` 滚动池；PTC 模式（`run_code` 内子分发）经 `tools/ptc-dispatch-log` 可改写持久副本。
- **Result**：成功值仅执行期存在（`value` 不入日志）；日志只存 content/error/meta；`tool/result.meta` 由工具私有（如 fs 携带上下文 diff），JSON 序列化强制。
- **Error**：规范化 `ToolFailure{message, info?}`；`concludesTurn()` 标记成功结果终结当前轮次；`deferContext()` 把嵌套上下文附着到本执行结果。
- **动态注册**：插件 `ctx.tools.register()`（effect）；`cordis_*` 工具可在运行时定义/运行/停止/撤销插件（自省式插件管理）；MCP 客户端把远端工具动态注册进 `ctx.tools`。
- **超时/溢出**：`timeoutMs`（由 `dsh-tool-call-timeout-policy` 在 tools/execute 包装）；spill 策略外置超大输出。

### 优点
- 统一流水线（pre/guard/execute/post/finalize/result）覆盖权限、超时、展示、上下文附着、结论标记，全部可插拔；canonical value + 纯 render 投影使展示可回放。
- 工具目录本身就是上下文的一部分（schema 进 request/header），工具变更自动影响 KV Cache 语义并被文档显式管理。

### 缺点
- 类型系统重（schema DSL + 推导 + 校验三层），新工具作者学习曲线陡；工具结果 canonical 值不入日志，回放无法恢复"程序拿到的值"（有意的取舍，但调试受限）。

---

## H06 Hooks / Middleware / Events

### 实现位置
- 事件框架：vendor 的 `@deepseek-ai/cordis`（`ctx.on/emit/waterfall/parallel/serial/bail`、`ctx.effect()`）；`docs/cordis-api/events.zh.md`。
- 产品事件词汇：`packages/core/agent`（`agent/*`）、`packages/core/tools`（`tools/*`）、`packages/core/system-prompt`（`system-prompt/*`）、`packages/core/session`（`session/*`）、`packages/interaction/user-approval`（`approval/*`）、`packages/skill`（`skills/change`）、`packages/compaction`（`compaction/*` 会话事件）。
- 外部钩子桥接：`packages/hooks/hook-protocol`（`dsh-hook-protocol`：matcher/runner/codec/merge/events）、`packages/hooks/hooks-claude-code`、`packages/hooks/hooks-codex`（兼容 Claude Code/Codex hooks.json）。
- 本机：`dsh-hook-protocol`、`dsh-hooks-claude-code`、`dsh-hooks-codex`。

### 标准事件模型映射（dsh 视角）
| 任务书概念 | dsh 对应 |
|---|---|
| PreToolUse | `tools/pre-execute`（waterfall，allow/deny/ask）+ `ToolGuard`（单调否决）；Claude Code 桥接映射 `PreToolUse` |
| PostToolUse | `tools/post-execute`（waterfall，accept/block+feedback/attach context）；桥接 `PostToolUse` |
| BeforeModel | `agent/request`（waterfall，可补 provider/model/改写请求）；桥接 `UserPromptSubmit` 走 `agent/pre-step` |
| AfterModel | `agent/assistant-stream`（emit：start/chunk*/end）+ `assistant/message`/`assistant/attempt` 持久化；`agent/request-error`（失败恢复） |
| BeforeAgent / AfterAgent | `agent/created` / `agent/disposed`（emit）；`agent/session-start`（startup/resume/clear/compact 四来源） |
| BeforeCompact / AfterCompact | 无独立事件；压力压缩挂在 `agent/pre-step`、溢出恢复挂在 `agent/request-error`；事务锁为 `compaction/start`/`end` 会话事件 |
| Stop | `agent/turn-stopping`（serial，可强制再执行一步）；桥接 `Stop` |
| SubagentStop | `subagent/start`/`subagent/end`（emit，仅观察）；桥接 `SubagentStart`（可注上下文，同进程）/`SubagentStop`（只观察） |
| 提示词级拦截 | `agent/pre-step`（reject / enter(messages, startsRequestSeries?)） |

### 关键机制
- **五种分发模式**：emit（观察）/ waterfall（包装，`next()` 委托、不调用即短路）/ parallel / serial / bail；waterfall 监听器"必须调用 next() 才委托"是 repo 铁律。
- **三事件域**：会话事件（持久、`session/event` 广播、进日志）；agent 事件（携带活跃 Agent 的实时扩展点）；能力事件（`fs/*`、`tools/*`、`telemetry/*` 等给 seam 附加策略）。
- **类型安全**：`…Map → derived-union` 模式（`SessionEventMap`/`ContentBlockMap`/`TurnEndReasonMap` 等，插件用 declaration merging 扩展）；事件 JSDoc 需 `@mode`，目录生成器交叉校验声明与分发调用点。
- **外部钩子**：`dsh-hook-protocol` 统一两方言（仅 matcher 的 mode 不同：claude-code 字面量/正则，codex 未锚定正则）；退出码 2 阻塞（stderr 为原因）、其余非零非阻塞记录、`deny > ask > allow` 合并、`hook/invoked`/`hook/result` 仅日志配对；`http/mcp_tool/prompt/agent` handler 跳过并警告；钩子失败绝不让轮次崩溃。

### 优点
- 事件即扩展点（"选对事件域是大多数改动的第一个决定"）；模型可见行为与日志一一对应；外部 hooks 兼容层让 Claude Code/Codex 存量钩子零重写迁移。
- waterfall 短路 + 单调 guard 的组合杜绝"先放行后否决"翻转。

### 缺点
- 事件种类极多（会话 12+ 核心变体 + 插件扩展），学习/调试成本高；`hook/*` 仅日志、无 surface 语义，外部钩子无法产生模型可见注入之外的效果（`continue: false` 无运行级效果，明示限制）。

---

## H07 Permission / Safety

### 实现位置
- 审批：`packages/interaction/user-approval`（`ctx.approval`、`approval/request` waterfall、`approval/asked`/`decided` 审计对、`ApprovalPolicy = ask | never`）。
- 权限预设：`packages/interaction/permission-presets`（sandbox 模式 × approval 策略捆绑）。
- 沙箱策略：`packages/sandbox/sandbox-policy`（`ctx.sandboxPolicy.resolve()` 优先级：批准的模式覆盖 > 会话 `sandbox/mode` 事件 > 部署默认）。
- 文件系统：`packages/fs/fs-sandbox`（围栏 `ctx.fs` 写入）、`packages/fs/fs-observation-policy`、`packages/credentials`（凭据边界）。
- 文档：SAFETY.md、docs/subsystems/approval.zh.md、permission-presets.zh.md。

### 核心流程（工具调用权限链）
```
tools/pre-execute waterfall (allow/deny/ask)
  -> ToolGuard (单调否决)
  -> (ask 时) ctx.approval.request() -> approval/request waterfall -> 应答者
       (UI 人类应答者 / ACP 机器决策)
  -> 仅 'allowed-once' 放行; rejected/cancelled/unavailable 一律拒绝 (fail closed)
```

### Behavior Safety（软约束：引导模型行为）
- 提示词段落（plan mode 引导、persona、agent-instructions 预算、repeat-tool-reminder 连续重复提醒、skill 目录）。
- 明确原则："引导而非强制"（plan mode README）；安全默认写入组合层：`workspace-write + ask`、web 抓取免逐次审批但提供方拒绝非公开地址、遥测默认关。
- `dsh-fs-observation-policy` 让 write/edit 观察驱动指令/skill 目录失效（结构化文件系统活动，而非 shell 导航）。

### Runtime Safety（硬约束：执法）
- 文件系统边界：`SandboxMode = read-only | workspace-write | danger-full-access`；`fs-sandbox` 围栏 `ctx.fs`（在它之上再挂普通 fs 提供方会导致 profile 加载失败——重复注册即拒绝）。
- 命令边界：沙箱化 shell 执行器（`bash-sandbox`/`pwsh-sandbox`）包装 argv；`ctx.sandbox.confine()` 无后端时 `SANDBOX_UNAVAILABLE` fail-closed，静默无隔离透传非法。
- 网络边界：`SandboxMode` 词汇明确**不含网络**；web 工具自带 trust 策略（匿名 fetch 只接受公开 HTTP(S)、解析并校验目标、固定连接；DeepSeek 搜索用同一 DEEPSEEK_API_KEY 凭据）。
- 审批策略：`ask` 委托应答者链（无应答者默认 `unavailable` 拒绝）；`never` 确定性拒绝，且在 waterfall 分发**之前**于服务内强制（即使 prepend 应答者也绕不过）。
- 凭据：`dsh-credentials-local`（环境 > `.credentials.yaml` > 项目/用户 .env；设置写入的托管文档从不物化进进程环境）；`credential-boundaries` 决策记录原子注册。
- 危险命令分类：无内置命令分类白/黑名单；等价机制是 sandbox 文件效果策略 + 审批 ask + 桥接钩子阻塞（exit 2）+ ToolGuard。保护 `$DSH_HOME`、`.system` 子目录跳过等由各消费方实现。

### 优点
- 软（prompt）硬（runtime）分离是显式架构原则，且两者共享同一份意图（权限预设把 sandbox+approval 捆绑为单一 UI 选择器）。
- 审批闭合结果 + fail-closed（unavailable 也拒绝）+ 单调 guard + 审计事件对（approval/asked→decided）构成完整证据链。

### 缺点
- Developer Preview 未审计（SAFETY.md 明示"不得视为安全或生产就绪"）；沙箱与宿主共享内核/文件系统，不隔离"项目本就有权访问的资源"；部分平台强制执行只有 partial（Windows ACL Everyone/硬链接、旧 Landlock ABI）。

---

## H08 Sandbox

### 实现位置
- seam：`packages/sandbox/sandbox`（`ctx.sandbox.confine(argv, policy)` 返回 `ConfinedArgv`）。
- 提供方：`packages/sandbox/sandbox-local`（runner 链：Linux bwrap → Landlock（`@deepseek-ai/node-addon-landlock-run` 原生插件）、macOS Seatbelt（`sandbox-exec`）、Windows ACL 受限令牌 runner（`packages/sandbox/sandbox-windows-acl`，`dsh-sandbox-windows-acl`）；`src/profiles.ts` 平台 profile 构建）。
- 消费方：`packages/shell/bash-sandbox`、`packages/shell/pwsh-sandbox`；策略服务 `packages/sandbox/sandbox-policy`。
- 本机：`dsh-sandbox`、`dsh-sandbox-local/lib/{index,profiles}.js`、`dsh-sandbox-windows-acl`、`dsh-fs-sandbox`、`dsh-sandbox-policy`。

### 核心机制
- **模式**：`read-only`（仅必需 sink，如 /dev/null；Windows 不授予任何显式可写根）、`workspace-write`（工作区根 + 后端承诺的临时区）、`danger-full-access`（**不经过 ctx.sandbox**，消费方直接 spawn 原始 argv）。网络与进程可见性不在词汇内。
- **逐调用策略**：`SandboxPolicy` 每次调用解析并携带（`workspaceRoot` 从会话不可变 cwd 派生，先文件系统语义规范化再词法规范化，防 `symlink/..` 逃逸；agentless 回退部署配置根）；`sandbox/mode` 会话事件持久记录覆盖。
- **强制执行完整性**：`enforcement: full | partial` 由后端报告（旧 Landlock ABI、Windows Everyone/硬链接 = partial），要求绝对边界的消费方必须拒绝或暴露差异。
- **失败分类**：`denialSignatures`（按后端方言：EROFS/EACCES/EPERM）+ `runnerFailureRules`（runner 自身在命令执行前失败的证据：允许退出码门控 + stderr 致命签名 + 信息行排除）；先判 runner 失败（沙箱基础设施故障）再判拒绝（沙箱正常工作并阻止了命令）。
- **平台细节**：bwrap profile 组合只读宿主根 + 全新 /dev + 私有 PID 命名空间（procfs 魔法链接无法绕过挂载）；workspace-write 另加临时 /tmp 与可写工作区绑定。Windows：每工作区确定性写入 SID + 常驻 ACE；每活跃会话/工作区对随机私有临时目录 + 独立 SID + 可撤销 ACE；崩溃残留既不能阻止也不能授权恢复会话；报告 partial（受限令牌必须保留 Everyone；NTFS 硬链接别名）。
- **path escape / symlink escape**：cwd/root 规范化 + sandbox 内 `fs-sandbox` 围栏 + runner 挂载边界共同防逃逸；Seatbelt 根目录规范化（/tmp ≡ /private/tmp）。
- **container**：非 `ctx.sandbox` 提供方——容器/microVM/远程执行被定位为完整能力 seam 的同级实现（消费方把 fs 与进程提供方指向远程沙箱，Bash/PTY/LSP 一并迁移）。无独立 container 后端。

### 优点
- fail-closed 契约（SANDBOX_UNAVAILABLE，绝不静默无隔离运行）；强制执行完整性透明上报（partial 不夸大为 full）；逐调用策略支持并发会话不同边界 + 一次性提权重试。
- 平台 runner 选择有功能探测、结果缓存、方言分类，消费方与平台解耦。

### 缺点
- macOS 依赖已弃用的 `sandbox-exec`（Apple 移除则无替代）；Landlock/Windows 部分场景仅 partial 强制；runner 选择在提供方生命周期内缓存（安装/修复 runner 需重载插件）；`runnerCommand` 覆盖是操作方断言（若 runner 是 bash 脚本，解释器先于约束启动）。

---

## H09 Session / Memory

### 实现位置
- 内存真源：`packages/core/session`（`Session` 仅追加事件日志、surface、`deriveMessages()`、`request/header` 折叠、fork API）；`ctx.sessions` store。
- 持久化：`packages/session/session-persistence`（`SessionPersistence` 抽象 + `SessionHandle`）→ `packages/session/session-persistence-jsonl`（JSONL v2，`session.v2.jsonl[.zstd]`，每事件一行）。
- 投影/查询/标题：`packages/session/session-projection`、`session-query`/`session-query-sqlite`、`session-title(-first-prompt-llm)`、`session-reference`（跨会话引用）、`session-stats`、`session-telemetry(-otel)`。
- 存储位置（本机实证）：`$DSH_HOME/sessions/<workspace-slug>/<session-uuid>/` 下 `session.jsonl.zstd`、`session_projcache.json`、`workspace.json`；另有 `$DSH_HOME/storages/`（投影缓存等）。根配置：`dsh-session-persistence-jsonl` 的 `root: dshHomePath('sessions')`。

### 四类记忆（任务书视角）
| 类型 | dsh 对应 |
|---|---|
| Conversation State | 会话日志 = 唯一真源；UI/轨迹/遥测/回放全部由事件派生 |
| Session State | `SessionHeader`（format version、cwd、`parentSession`、`isSeeded`、`delegationDepth`、`agentPreset`、`origin:'subagent'`）存于日志旁（存储元数据，不入事件）；`session/end-seed` 标记构造种子边界 |
| Project Memory | 无持久项目记忆模块；等价物是工作区指令（AGENTS.md）、session 按 workspace-slug 分目录、会话搜索（opt-in SQLite 全文）、跨会话引用工具（`session_event_read/search`、`session_search`）、`session-reference`（只读引用另一会话） |
| Long-term Memory | **未内置**（明确无自动学习）；官方提供第三方记忆 MCP 示例（overlay，需手动配置）；跨会话记忆靠"保留会话 + resume/fork + 引用工具"实现 |

### 核心流程
- **Resume**：`ctx.agents.resume({ resumeSessionId })` → 持久层 `open(id, 'write')`（单写者所有权，并发第二次 open 拒绝）→ 读日志 → 追加 `interruptedTurnClosers`（缺失工具错误、未闭合 step/end、合成 `turn/end { kind: 'interrupted' }`）→ `SessionStore.prepare` 校验冻结 → 发布。
- **Fork**：`ctx.sessions.fork(source, boundary?, childId)` 取到 boundary（含）的已完成轮次前缀 → 深克隆 seed + `parentSession` + `isSeeded: true` + 精确 `inheritedEventCount` + 继承 cwd；拒绝结束于开放轮次的前缀。子 agent fork 用父级"最后一个 turn/end 为止"的平衡前缀。
- **Clear**：`agent/session-start` 的 `SessionStartSource` 含 `'clear'`；web 层有清空/归档/重命名/搜索会话操作。
- **Compact 后恢复**：压缩不新建会话（见 H04），`compaction/*` 标记对 + surface replace 全部在日志内，恢复即重放折叠。
- **持久化语义**：`append` 是 best-effort（有界 write-behind 批处理窗口）；`flush()` 是持久性屏障（循环在领取下一轮次前用作检查点）；崩溃恢复保留被中断轮次（不截断长轮次），只丢弃撕裂物理尾部；格式迁移：相邻 `vN → vN+1` 只发布新 generation 文件，绝不重命名/替换/删除已提交 generation，未来版本拒绝而非回退。

### 关键机制
- 模型可见 ⟺ 已记录 + 可重建请求（`request/header` 全量快照）；`ignorable: true` 标记未知事件可跳过，缺失则必须拒绝重建。
- 投影 seam：`ctx.sessionProjections` 单元增量折叠提交事件，`stateOf()`/`snapshot()` 供 host/客户端；session 列表身份（subagent 目录）三级供值（live 水位 → 投影缓存 → 冷观察）。

### 优点
- 事件溯源使 resume/fork/回放/遥测/UI 全部同构；崩溃恢复不丢长轮次；跨进程写租约（单写者句柄）消除并发损坏。
- 格式迁移不可变发布策略保护历史会话。

### 缺点
- 无内置长程记忆/学习（依赖第三方 MCP overlay）；SQLite 全文搜索默认关闭（`openAt: never`）；事件日志 + 投影 + 缓存层数多，运维心智负担高。

---

## H10 Skills

### 实现位置
- seam：`packages/skill/skill`（`ctx.skills`：`registerProvider/list/snapshot/get`，`skills/change` 事件）。
- 提供方：`packages/skill/skill-filesystem`（本地目录，chokidar 监视）、`packages/skill/skill-badge`（随包徽章，默认 disabled）、runtime `register()` 贡献。
- 消费方：`packages/skill/tool-skill`（目录注入 + `skill` 工具）、`packages/api/session-controller`（浏览器 `SessionSkillCatalog`）。
- 本机：`dsh-skill`、`dsh-skill-filesystem`、`dsh-skill-badge`、`dsh-tool-skill`。

### 核心流程
1. **Discovery**：provider 分层注册（host/全局层 + 各 scope 层，scope 链合并，最近层直接赢得重名；单层内按 rank → provider 顺序 → 本地顺序）。本地提供方 rank 表：project-dsh `<root>/.dsh/skills`(100) < project-agents `<root>/.agents/skills`(200) < custom `Config.customSkillDirs`(300) < user-dsh `<dshHome>/skills`(400) < user-agents `<agentsHome>/skills`(500) < bundled(600)。项目根 = 含 `.git` 的最近祖先（经 `ctx.fs` 探测，远程/沙箱不回落宿主）；用户根跳过 `.system` 子目录。
2. **Loading**：`ctx.skills.get(name)` 每次调用都经胜出提供方重读正文（不缓存完整定义）；kebab-case 名称（`^[a-z0-9]+(?:-[a-z0-9]+)*$`）；接受 `<name>/SKILL.md` 与 `<name>.md`；不支持嵌套递归 `**/SKILL.md`。
3. **Scope**：`SkillViewOptions { scope, cwd, signal }`——cwd 选工作区敏感 skill；scope 选层；signal 取消发现/加载（与加载竞速防挂死）。
4. **Execution**：模型侧目录注入（首个非空完整视图的 pre-step，持久 `<system-reminder>`，只含 name + 转义 description）；`skill({name})` 工具校验名称、查目录、`isModelInvocable` 门禁、按 agent cwd 重读、再查策略，返回 `<skill_content name=...>` + `<skill_resources>` + `<skill_instructions>`。
5. **Install/Update**：无市场/包管理器；安装 = 放文件（项目/用户/自定义根目录）；更新 = 改文件 + watcher 失效（模型侧 write/edit 观察同步失效，宿主 watcher 覆盖 IDE/Git/shell 变更）；`skills/change` 无 diff，消费方自行重取 `snapshot()`。
6. **Conflict**：rank 裁决 + 提供方注册顺序 + 本地顺序；不完整观测（provider 失败/发现中变更）不缓存并保留 last-good；运行时注册同层同名 first-wins。
7. **Provenance**：`SkillSummary.source`（7 类来源桶，prompt 可见元数据，不构成优先级）、`provider`、`rank`、`resourceBase`（directory/url/opaque）；目录绝不暴露正文/绝对路径。
8. **Invocation 策略**：`modelInvocable` / `userInvocable`（frontmatter `disable-model-invocation`、`user-invocable`，默认 true）；四种组合全保留；两 false 仅受信 `get()` 可取。

### 优点
- 分层 registry + rank + scope 链设计统一了 system/user/project/session 级来源与冲突裁决；内容-元数据分离（摘要 vs 正文）防止目录泄露；热刷新（watcher + digest + `skills/change`）无需重启。

### 缺点
- 无内置安装/更新/市场/签名校验（provenance 是元数据不是信任链）；发现跟随后台 watcher 与模型侧 fs touch（shell cd 不触发）；`get()` 每次重读正文，远程/大 skill 有性能与一致性权衡。

---

## H11 Subagent / Multi-Agent

### 实现位置
- seam：`packages/subagent/subagent`（`ctx.subagents`、`SubagentProvider`、`SubagentStartRequest`、`SubagentRun`、`SubagentResult`、continuable 管理器 `src/continuation.ts`、描述符 `src/descriptor.ts`）。
- 提供方（6 个）：`subagent-spawn-in-process`（spawn）、`subagent-fork-in-process`（fork）、`subagent-acp`、`subagent-codex`、`subagent-claude-code`、`subagent-dsh-sdk`。
- 消费方：`packages/subagent/tool-subagent`（`subagent`/`subagent_fork` 工具）、`tool-subagent-control`（`send_message`/`interrupt_agent`/`list_agents` 全局控制工具）。
- 编排：`packages/workflow`（`workflow` 工具，worker-thread 提供方）、`packages/todo`、`packages/goal`（goal 续跑）、`packages/experimental/agent-teams`（实验性 `spawn_teammate`/`team_task_*`/`wait_agent`）。
- 本机：`dsh-subagent`、`dsh-subagent-spawn-in-process`、`dsh-subagent-fork-in-process`、`dsh-subagent-in-process-driver`、`dsh-tool-subagent`、`dsh-tool-subagent-control`、`dsh-workflow`、`dsh-workflow-worker-thread`、`dsh-tool-ralph`。

### 核心流程
- **单次委托**：模型调 `subagent`/`subagent_fork` → 工具构建 `SubagentStartRequest` → 服务按能力 flag 校验（`agentOptions/outputSchema/depthLimit/toolFilter/persona`，缺能力即 `UNSUPPORTED_CAPABILITY` 拒绝，绝不接受后忽略）→ 解析持久描述符 → `provider.start()` → `SubagentRun.result` = `{ output, structured?, diagnostic?, stopReason }`。
- **结果回主**：`output` = 子 agent 最后一条非空 assistant 消息（无则累计流）；`structured` 仅在请求 `outputSchema` 且成功捕获时存在（object-rooted JSON Schema 子集，进程内强制 capture 工具）；非 `completed` stopReason（aborted/error/max-tokens/refusal）映射为 `isError` 工具结果。
- **可继续后台子 agent**：`startContinuable()` 预留稳定 childId → 描述符快照 → provider 只交分离的 `ContinuableCreateSpec`（可选父历史 seed）→ 管理器经 activation-owner 作用域创建子 Agent → inbox 接受初始提示词即返回 `{childId, messageId}`；此后 `send_message`（仅直接 parent/child，按 Activation 状态 running→steer / waiting→唤醒 steer / 无→冷恢复再 steer）、`interrupt_agent`（`keepInbox` 取消，唯一公开停止操作）、`list_agents`（running/idle/ready）。
- **最大深度**：`maxDepth` 绝对上限 + 持久 `delegationDepth`（父+1，冷恢复不降低，超限/超域拒绝）。
- **并发**：distinct starts 可重叠；共享容量控制器只延迟不耦合结算；`maxParallelToolCalls` 约束模型侧；workflow 工具可并行 fan-out 多 subagent（结构化 schema 校验结果）。
- **Worktree**：**未提供**（无 git worktree 工具/机制；隔离靠子 agent 作用域 + cwd 继承 + 沙箱边界，而非 git worktree）。

### Context / 权限隔离
- 每个子 agent 获得**新的扁平 scope**（`agent.ctx`），不继承父注册（继承靠 preset 的 standing composition `composeFrom()` 绑定同一组合实例，或 fork 的已完成轮次前缀 seed）；`toolFilter`（allow/deny）从子 agent 的 prompt 消失**并**拒绝执行（"可见性而非权限"——权限隔离由沙箱/审批负责）；persona 遮蔽仅限该子 agent；fork 子 agent provider/model 与父一致（KV Cache 复用）。
- 一次性 vs 可继续：一次性 run 无 steering/无恢复；可继续对话无 run，管理器直接持 `AgentHandle`，inbox 是唯一 FIFO。

### 优点
- 提供方注册表 + 能力显式声明使"换一个提供方 = 换整个产品行为"（同 seam 下从进程内到 ACP/Codex/Claude Code）；结果契约统一（output/structured/diagnostic/stopReason）且消费方对非完成原因一律视为失败。
- 可继续子 agent 的激活/冷恢复/所有权图设计完善（settle 条件 = 完全停稳 + 子级全 dispose + flush 结算 + handle dispose）。

### 缺点
- 无 Planner/Reviewer/Evaluator 预设角色（是机制不是角色）；worktree 并行缺失；实验性 agent-teams 未进正式发布；可继续子 agent 的最终结算对持久化失败只记录不重试（可能缺失/陈旧状态）。

---

## H12 Evaluator / Verification

### 实现位置与事实
- **无独立 Evaluator 模块/agent**（grep docs 全库无 evaluator 子系统；任务书式 Generator/Evaluator 分离不是 dsh 产品概念）。验证能力分布在：
  1. 仓库测试体系（docs/testing.md）：unit（vitest，`test:coverage` 每文件 100% 门禁）→ real-API e2e（`test:e2e`，无 key 自跳过）→ expected（`test:expected`）→ snapshot（`test:snapshot`：keyless 录制会话重放，`snapshots/session|sdk|acp|web/`，`dsh-session-snapshot` 包管共享规则）→ web 浏览器快照（`test:web`，Chromium，CI 只读 replay）。
  2. 计划评审门：`packages/plan/plan` + `dsh-plan-mode`——agent 以 `exit_plan_mode` 呈交计划，用户 Approve / Keep planning（评审即验证门，但仍是人工）。
  3. 目标/任务跟踪：`packages/goal`（`create_goal/get_goal/update_goal`，持久同会话目标，goal-round-driver 续跑）、`packages/todo`（`todo_write`，`allowParallelInProgress`）。
  4. 结构化结果：subagent `outputSchema`（object-rooted JSON Schema，捕获即校验）；workflow 工具（agent(prompt, {schema}) 返回校验对象，坏 schema 必杀脚本）。
  5. 运行时校验：`packages/code-runtime`（`run_code` 执行 Python/JS 代码，worker-thread 提供方）、bash/pwsh（跑测试/lint/typecheck/build）、terminal（持久 shell）、`packages/runtime-diagnostics/invariants`（`dsh-invariants` 伴生插件回放校验会话日志关系：轮次/步骤编号、执行封闭、工具调用/结果配对、retry 记录）。
  6. CI/验收：`dsh-webhook-github`（GitHub 评审 webhook 触发会话）、BENCHMARK.md（仅 3 行：跑 Python SDK `jsonrpc-agent` 最小变体、独立 workspace/session id 跑任务——**未获取到**成体系 benchmark 场景/指标定义）。
- Tests/Lint/Typecheck/Build：**无内置面向 agent 的验证工具**；靠 shell 工具调用项目自身命令 + 结果回读（工具结果含 stderr + 退出码语义）；`dsh-tool-bash` 结果规范含 `{ stdout, stderr, exitCode }` 式契约（canonical tool output contract）。
- Browser/Screenshot：**未内置浏览器自动化**（web UI 自己的浏览器快照测试是仓库测试基建，不是 agent 工具）。
- Requirement/Security check：无独立模块；等价物是 plan 评审、approval、`dsh-tool-web` trust 策略、`dsh-sandbox` fail-closed。

### 结论
H12 在 dsh 中呈现为"验证是外围测试体系 + 人工评审门 + 结构化返回契约"，而非 agent 内建 evaluator。对 Behavior IR 的启示：独立 Evaluator 需自建（可复用其 subagent outputSchema + workflow 结构化结果 + invariant 回放思想）。

---

## 行为要点提取（供 Behavior IR）

1. **模型可见 ⟺ 已记录（可重建请求）**：任何进入模型请求的内容必须能从会话日志重建；新增模型可见输入必须新增会话事件，否则运行时不变量失败。
2. **一切皆插件 + 注册即可逆副作用**：每个能力（模型适配器、工具、会话日志、loop）都是可配置替换的插件；`register()` 返回 exact disposer，卸载即撤销，禁止特权内核。
3. **Waterfall 中间件约定**：要委托必须调用 `next()`，短路即决策；守卫单调（`ToolGuard` 只能收窄不能放行，监听器顺序无法把拒绝翻回允许）。
4. **先持久、后等待**：重试（`llm/retry`）、压缩（`compaction/start` 锁）、审批审计（`approval/asked`）都在等待/执行前先落日志，崩溃不留隐形待办；配对的结束标记恰好一次。
5. **Fail loud，不静默降级**：`UNSUPPORTED_CAPABILITY`、`SANDBOX_UNAVAILABLE`、`NO_ADAPTER`、重复服务注册（fs 提供方）都在加载/调用点拒绝；缺失引用绝不静默跳过。
6. **沙箱逐调用解析、fail-closed**：策略按每次能力调用解析并携带；无后端/无应答者一律拒绝；runner 基础设施失败与命令被拒严格分类（fatal signatures vs denial signatures）。
7. **工具输出规范契约**：工具体返回 canonical lossless-JSON value，纯 render 投影为模型内容；展示/回放与执行值解耦；`value` 不入日志，日志只存 content/error/meta。
8. **并行安全显式声明**：`isConcurrencySafe`/`parallel` 才可重叠；独占调用是排序屏障；分类一元性（比较同级调用的分类必须独占）；`concludesTurn` 让工具声明终结轮次。
9. **上下文注入即持久消息**：inject/指令/skill 目录都是带来源的 `user/message`（可回放、可压缩、可恢复），经 inbox 送达；预算截断"宽泛先丢、具体后截"，去重（同内容只渲染一次）与转义（`</system-reminder>`）系统化。
10. **Compaction 是日志内事务**：保留近期尾部逐字、最旧平衡段替换为摘要、工具调用/结果配对完整、摘要请求复用上次请求热前缀（KV Cache 友好）；三入口（压力/溢出/手动）。
11. **子 agent 能力显式声明**：`capabilities` flag 逐项声明，缺能力即拒绝（接受后忽略=违规）；`toolFilter` 是可见性不是权限（权限靠沙箱/审批）；委派深度持久化（`delegationDepth`），冷恢复不降级。
12. **会话即事件日志**：fork = seed 前缀 + `isSeeded` 谱系 + `session/end-seed` 边界；resume = 重放 + 崩溃修复（合成 `interrupted` 关闭器）；崩溃长轮次不截断；格式迁移只发布新 generation、绝不改写已提交文件。
13. **引导与执法分离**：prompt 段落只引导（plan mode、persona、指令预算）；强制一律走 sandbox/approval/guard（permission preset 把 sandbox×approval 捆绑成单一选择器）。
14. **KV Cache 是一等约束**：系统提示词/工具目录/路由的任何变化都会破坏前缀复用；设计上保持"仅追加历史 + 稳定前缀"并逐节记录影响。
15. **Loop 保持最小可替换**：所有超出"调用模型、运行工具、重复"的行为都挂在文档化扩展点（`agent/*`、`tools/*`、`session/*` 事件），改 loop 需更新架构文档。

---

## 参考来源

- GitHub 仓库（锁定 commit `d347e703908d0406b7a7ef80e3a0e594d86b2215`，2026-09-05 访问，`git clone --depth 1`）：
  - https://github.com/deepseek-ai/deepseek-harness — README.zh.md、AGENTS.md、SAFETY.md、BENCHMARK.md、LICENSE(MIT)
  - docs/architecture.zh.md、docs/cordis-primer.zh.md、docs/testing.md、docs/tool-catalog.zh.md
  - docs/subsystems/{core,session,system-prompt,tools,compaction,sandbox,approval,permission-presets,subagent,skills,conversation,persistence}.zh.md
  - packages/**（core/agent, core/agent-loop, core/session, core/system-prompt, core/tools, llm/llm-retry, compaction/*, sandbox/*, shell/*, fs/*, interaction/*, skill/*, subagent/*, hooks/*, plan, preset, session/*, web, context/*, workflow, goal, todo）
  - .agents/notes/implemented/**（architecture/feature 目录，如 2026-07-16-explicit-turn-cancellation、2026-07-10-parallel-tool-call-execution、2026-08-08-windows-acl-restricted-token-sandbox、2026-08-05-profile-plugin-bundles 等设计决策记录）
- 本机安装（0.1.2-alpha.5 发布形态，用于验证发行包结构）：
  - `D:\tools\NVM_Windows\nvm_a\v24.14.0\node_modules\@deepseek-ai\dsh`（CLI 启动器：lib/bin.js、lib/profile-boot-*.js、package.json 依赖清单）
  - `C:\Users\USER\.dsh\profiles\node_modules\@deepseek-ai\`（dsh-base/cordis.patch.yml 498 行组合清单、dsh-agent-loop、dsh-agent-instructions、dsh-sandbox-local、dsh-compaction-basic、dsh-llm-retry、dsh-plan-mode、dsh-hook-protocol、dsh-hooks-claude-code、dsh-tool-fs、dsh-mcp-client 等包的 README.zh.md 与 lib/）
  - `C:\Users\USER\.dsh\`（profiles/web/cordis.patch.yml 实际用户覆盖、sessions/ 会话存储布局实证）
- 外部参考：Cordis 上游 https://github.com/cordiverse/cordis ；论文 arXiv:2608.25512《A Programming Paradigm for Spatiotemporal Composability》（经 README 引用，未直接核读论文原文）。
