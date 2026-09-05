# 设计决策记录（D3 / DESIGN-DECISIONS.md）

- **交付物**：D3 — 设计决策记录（任务书第二十一节）
- **版本**：v0.1（草案）
- **日期**：2026-09-05
- **状态**：供 Review；16 个决策点，每个 ≥2 候选方案 + 最终选择与理由 + 拒绝项与原因 + 对 D4–D8 的约束；与 comparison.md（D2）H01–H12 的 Decision 逐条一致（可交叉引用），不引入任何新事实
- **上游依据**：任务书.md §2 核心原则（行 43–145）、§6–§9（行 568–779：Behavior IR / Compiler / Policy Runtime / 建议项目结构）、§10–§14（V0.1–V0.5 路线）、§15–§17（Benchmark 强制项 / 统一指标 / A/B Test）、§20（技术栈建议，行 1180–1233）、§21 D3（行 1256–1267）、§22 验收门槛（行 1311–1328，含"每个架构选择至少 2 个候选、每个最终选择写明理由"）；docs/research/harness-matrix/comparison.md（D2，每机制 H01–H12 的 Decision/Why/Rejected/Proposed Spec）；docs/HARNESS-ANATOMY.md（D1，各章"共同抽象"与 §0.2/§0.3 范式结论）
- **下游消费方**：D4 BEHAVIOR-IR-SPEC、D5 EVENT-SPEC、D6 POLICY-SPEC、D7 BENCHMARK-SPEC（对齐对象）；D8 ARCHITECTURE.md（本记录是"为什么"的来源，D8 落"是什么/模块边界"）；第三阶段实现（任务书 §9）

> 一句话定位：**把第一阶段横向研究（D1 解剖 + D2 矩阵）沉淀为可追溯的决策——每个架构决策点都给出至少两个候选方案（引用各家做法）、最终选择、证据化理由、明确拒绝项，以及它对 Behavior IR / Event / Policy / Architecture 的约束；D3 是 D4–D8 规范的"为什么"，D4–D8 是 D3 的"是什么"。**

---

## 0. 摘要与阅读方法

### 0.1 为什么需要一份独立的决策记录

comparison.md（D2）已在每个机制（H01–H12）给出 Decision/Why/Rejected/Proposed Spec，但它是"机制粒度"的横向决策。D3 把这些机制决策提升到**架构决策点**粒度，并补充四类 research 阶段本身不含、但任务书强制的决策：

1. 模块形态与分层边界（任务书 §9 建议结构 → 决策点 1）；
2. 技术栈与实现路线（任务书 §20 → 决策点 15）；
3. Benchmark/Conformance 的"先行"承诺（任务书 §15–§17 → 决策点 16）；
4. 任务书原则对决策的约束关系（Core 薄、Prompt/Runtime 分离、Generator/Evaluator 分离、禁止事项 1–10）。

一句话：**D2 回答"这个机制怎么做"，D3 回答"整个系统为什么长这样"。**

### 0.2 候选命名法与证据引用约定

- 候选一律以"类 X 型 / 类 Y 型"命名（X/Y = 研究对象的架构范式，见 HARNESS-ANATOMY §0.2 的八类范式划分），例如"类 DSH 插件树 / 类 Codex 单体内核 / 类 Pi 极简内核"。研究对象不等于照抄对象——候选是"该范式代表了哪种取舍"，最终选择多为其可迁移点的组合（任务书 §1 核心目标"取各家长处 → 抽象公共机制"）。
- 证据引用缩写：`cmp:H0X` = comparison.md 的 H0X 章节；`anat:0.3-n` = HARNESS-ANATOMY.md §0.3 第 n 条总体结论；`§n` = 任务书.md 第 n 节；`IR:附录A` = BEHAVIOR-IR-SPEC 附录 A 条目。引用仅指向已有文档内容，不引入研究文档之外的新事实。
- 每条决策的影响栏标注**下游规范约束**：D4（Behavior IR）/ D5（Event）/ D6（Policy）/ D8（Architecture），供 D4–D8 与实现期回溯"这条规范是从哪个决策来的"。

### 0.3 决策点总表（16 条）

| # | 决策点 | 一句话决策 | 主要依据 |
| --- | --- | --- | --- |
| 1 | 模块形态 | 模块化单体（任务书 §9 目录），进程内组合，预留可切出的 server seam | §9 / cmp:H09、anat:0.2 |
| 2 | Core 厚度与 Agent Loop 所有权 | 单一权威薄 loop 进 core，Memory/Skill/Sandbox/Subagent/Hooks 不进 core | §2.2 / cmp:H01 |
| 3 | 事件系统形态 | 两域事件（持久会话事件 + 实时扩展事件），waterfall 决策点 | cmp:H06 / §四 H06 |
| 4 | 插件/扩展机制（是否要） | 不要整体插件树；要"类型化事件扩展点 + hooks.json 兼容桥 + MCP/Provider seam" | cmp:H06/H11 / anat:0.3-2 |
| 5 | Context 构建与指令分层 | 事件日志派生 + 三层组装（每会话一次）+ 按需注入 + 指令当 user message | cmp:H02/H03 / §3 / §禁止7 |
| 6 | Compaction 触发模型 | 三入口统一 + 事务化平衡区域替换 + 尾部逐字保留 + 热前缀摘要 | cmp:H04 |
| 7 | Tool 注册与并行调度 | 最小内建集 + 统一流水线 + exclusive 屏障 + MCP 唯一动态扩展 | cmp:H05 / §禁止8 |
| 8 | Policy 引擎位置（软/硬落地） | Policy 唯一事实源 → 四件套编译；Policy Engine 挂 BeforeTool 链 | §2.3/§8 / cmp:H07 |
| 9 | Sandbox 策略（平台范围） | confine seam + 三平台 runner + fail-closed + 容器同级 seam | cmp:H08 |
| 10 | Session/持久化 | 事件日志（append-only）为唯一真源；不 event-sourcing 不可行 | §H09 / cmp:H09 / anat:0.3-1 |
| 11 | Skills 作用域 | SKILL.md 开放标准 + rank 分层 + 索引渐进披露 + 调用时重读 | §H10 / cmp:H10 |
| 12 | Subagent/Evaluator 关系 | 子代理=独立会话（与主同构）；Evaluator 不是新原语而是 preset+独立模型 | §2.4 / cmp:H11/H12 |
| 13 | 多模型支持范围 | v0.1 三类 provider + 一份 provider 中立模板；差异走 Model Profile | §10 / §7 / cmp:H02 |
| 14 | Prompt 编译管线（Behavior IR） | Behavior IR → Model Profile → Harness Profile → Prompt Compiler | §6/§7/§18 / cmp:H02 |
| 15 | TypeScript vs Rust 边界 | TS Brain 先行 + 语言中立执行 seam（沙箱/进程走 OS 原语）；Rust Runtime 可选升级 | §20 |
| 16 | Benchmark 先行 | 第一天建 benchmarks/（≥15 场景、14 指标、A/B、Conformance Suite） | §15–§17 / cmp:H12 |

---

## 决策点 1：模块形态（模块化单体 vs Client/Server 起步 vs 服务化）

- **问题**：新 Harness 的顶层形态怎么定——单仓库多包进程内组合，还是学 OpenCode 的 Client/Server、Pi/Hermes 的 CLI 与 Agent 进程分离，还是直接服务化？

- **候选方案**：
  - 候选 A（类 OpenCode 产品级 Client/Server + 模块化单体并存）：单仓库多包，但把 Session 与 UI/TUI 之间的边界做成 server 契约（SSE/WebSocket 事件总线、消息+parts SQLite 落库），核心可被不同前端复用。优点：产品化形态成熟、UI/回放/审计共享同一存储；缺点：v0.1 即引入网络边界与序列化层，与"先 CLI 后 UI"的任务书路线（§10 明确不做 Web UI）冲突。
  - 候选 B（类 DSH / Pi 模块化单体）：单进程多包（DSH packages/ 插件树、Pi packages/ 分层），会话与 loop 在同一进程组合，无进程间边界。优点：开发期调试/回放/单测成本最低、事件溯源内核不需要跨进程传输；缺点：将来要出 Web/多客户端时需再切 server seam。
  - 候选 C（服务化/微服务，进程拆分 Brain/Policy/Sandbox 等）：独立部署单元。优点：隔离强；缺点：任务书 §9 明示"初期使用**模块化单体**，禁止提前微服务化"，且与"禁止一开始就做 Web UI/多 Agent Teams"同向——v0.1 没有任何分布式诉求。

- **决策**：模块化单体。仓库按任务书 §9 的建议结构组织（core/ llm/ behavior/ context/ tools/ policy/ runtime/ memory/ skills/ agents/ telemetry/），包内进程内组合；在 session 与外部消费者之间保留一个"可切出 server"的 seam 定义（事件词汇即可序列化），但 v0.1 不实现 server。

- **理由**：任务书 §9（行 719–779）直接给出建议目录并写明"初期使用模块化单体、禁止提前微服务化"——这是对形态的硬约束。研究侧：DSH 以单进程事件日志支撑 UI/遥测/回放全部派生（anat:0.2-4），证明单体加单一真源足以支撑多消费者；OpenCode 的 client/server 是其产品形态（TUI/App 并存）的产物，非机制必需（cmp:H09 OpenCode 行的消息+parts SQLite 与 EventV2 SSE 是为多前端服务的）。Claw 的"万行单体 tools crate"反面案例（cmp:H05 Rejected）说明单体内部的包边界质量才是关键——故模块化单体的要点不是"文件多"，而是 core/ 之外的机制不反向依赖 core。

- **拒绝**：不采用候选 C（服务化：禁止提前微服务化，§9）；不采用候选 A 的 server 边界进 v0.1（§10 V0.1 只做 CLI、明确不做 Web UI）；同时拒绝"无包边界的扁平单体"（Claw 教训，cmp:H05）。

- **影响**：D8 的包/目录契约直接采用 §9 树；core/ 不得 import memory/skills/sandbox（由决策点 2 强化）；会话事件词汇必须可序列化（D5 事件即 JSON 行），这是将来切 server seam 的前提；D7 runner（headless CLI 驱动）与 D5 的 `session/created` 事件共同构成无 UI 的消费面。

---

## 决策点 2：Core 厚度与 Agent Loop 所有权

- **问题**：Agent Core 里装什么、主循环（Agent Loop）归谁所有、轮次/步进语义与终止判据按哪家收敛？

- **候选方案**：
  - 候选 A（类 Claude Code 厚运行时）：三阶段 gather→act→verify 融合循环内建于运行时，工具/记忆/权限/沙箱全套挂在闭源内核上，外部只能通过 hooks 事件外露。优点：对外行为语义最完整（"无 tool call 即停"、三层前缀缓存排序、读并发/写串行）；缺点：Memory/Skill/Sandbox/Subagent 全部耦合进内核，与任务书原则 2 相反；闭源无法作为实现样本（anat:0.2-1）。
  - 候选 B（类 DSH 薄核 + 唯一可替换 loop）：`ReactLoopAgent` 只做"开持久轮次 → 原子领取 next-step 输入 → 跑模型与工具 → 事件化"，轮次预算不内建（README 明示由扩展点施加），一切旁路行为挂在文档化扩展点（`agent/pre-step`、`agent/turn-stopping`）。优点：符合本项目的 Composable 目标、崩溃恢复=重放、模型可见⟺已记录；缺点：抽象层重、无预算兜底需自建。
  - 候选 C（类 Pi 极简内核 + 双轨 harness）：公开层最小 `runAgentLoop`，另起一套检查点化 Lane/drive 状态机。优点：内核小；缺点：同一产品两套循环（语义双轨），与"单一权威 loop"冲突（cmp:H01 Rejected）。

- **决策**：组合——单一权威的**薄** loop 内核进 core（决策点 1 的 core/agent-loop），语义层采用 Claude Code/DSH/OpenCode 收敛的**"无未决 tool_call 即停/纯文本即停"**终止判据；机械层在 v0.1 默认装配 `max_steps_per_turn: 64` 硬顶，但预算本身作为 Policy 扩展而非内核逻辑（§2.2 原则 + DSH 立场，cmp:H01 Why）。step = 一次模型请求 + 其工具调用；user turn = 零或多个 step（不采用 Claw/Pi 的"一个用户轮即一次 run_turn"窄接口）。Memory/Skill/Sandbox/Subagent/Hooks **不硬编码进 Core**（任务书原则 2 原文）。

- **理由**：任务书原则 2（行 71–84："Agent Core 只负责 Model Call → Tool Call → Tool Result → State Update → Continue / Stop；Memory、Skill、Sandbox、Subagent、Hooks 等不得硬编码进入 Core"）是硬约束。anat:0.3-1/0.3-2 的三条主轴结论给出证据方向：会话真源形态（决策点 10）与组合/扩展语义（决策点 4）都要求"事件日志真源 + 单一权威循环"；cmp:H01 的 Why 对 A/B 两候选的对比结论是"以 B 的事件溯源内核为骨架、吸收 A 的纯文本即停对外语义与读写并行纪律、Claw 的压缩后健康探针、OpenCode 的 doom-loop 防护"，v0.1 默认装配机械硬顶（避免开发期失控，cmp:H01 Rejected 末条："不采用无任何轮次上限作为默认"）。

- **拒绝**：不采用候选 C 的双轨（Pi：迁移期两套 loop）；不采用 Codex 的单文件 2881 行 run_turn（不可维护，cmp:H01 Rejected）；不采用 Claw 把循环语义拆散到 CLI 层（REPL 持续性全在 UI 层，事件/后台/steering 无法统一建模，cmp:H01 Rejected）；不采用"无轮次上限"作为默认（任务书禁止事项 6 要求可验证收敛）。

- **影响**：D5 的 turn/step 事件词汇（`turn/start|end{kind}`、`step/start|end`、`agent/pre-step`、`agent/turn-stopping`、`llm/retry` 先持久）与 loop 决策点一一对应（cmp:H01 Proposed Spec 的 observability 行直接进 D5）；D4 的 E01 `turn_ends_without_tool_call` / E02 `max_steps_per_turn` 语义即本决策点的行为面（IR:附录A loop 类）；D6 把预算扩展（max_budget_usd / 轮次上限）放 Policy 层；D8 core/agent-loop 只实现上述五件事，禁止 import memory/skills/sandbox。

---

## 决策点 3：事件系统形态

- **问题**：事件/中间件/钩子系统按哪种语义建——Claude Code 的 35+ 单层事件面、DSH 的 Cordis 五分发 + 两域事件、还是 Claw 的极简三事件？

- **候选方案**：
  - 候选 A（类 Claude Code 35+ 事件 + 五形态 handler）：事件覆盖每个决策点（SessionStart/UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/Stop/SubagentStop…），handler 五形态含 command/http/mcp_tool/prompt/agent，支持 async+rewake。优点：覆盖度最全、对外行为契约最完整；缺点：PreToolUse 与 permission 职责重叠、prompt/agent 型 handler 是非确定性模型决策、事件面过大心智负担重（cmp:H06 Why）。
  - 候选 B（类 DSH Cordis 五分发 + 三事件域）：emit（观察）/waterfall（包装，不调 next() 即短路）/parallel/serial/bail 五种分发；会话事件（持久进日志）、agent 事件（实时扩展点）、能力事件三域。优点：瀑布语义明确"短路即决策"、guard 单调杜绝"先放行后否决"、会话事件进日志使 hook 可审计可回放；缺点：事件种类多、外部钩子只能记录不能产生运行级效果（明示限制）。
  - 候选 C（类 Claw 三工具事件 / 类 OpenCode 插件 Hooks + EventV2）：Claw 只有 PreToolUse/PostToolUse/PostToolUseFailure；OpenCode 把扩展做成插件变换链（permission.ask、tool.execute.before/after、chat.*.transform…）+ durable EventV2 总线。优点：接口薄（Claw）或变换语义统一（OpenCode）；缺点：Claw 覆盖面不足（无会话/轮级事件），OpenCode 的插件 API 与内置触发点存在两套并存迁移期。

- **决策**：两域事件 + waterfall 中间件：**持久会话事件**（作为会话事实进日志，供回放/evaluator/审计）+ **实时 agent 扩展事件**（waterfall 决策点，供策略/插件/安全层注入）；分发原语 v0.1 先实现 emit + waterfall（guard 单调），serial/parallel/bail 按需补充（cmp:H06 Decision）；handler 形态 v0.1 只做 command + mcp_tool（http 留后续），不引入 prompt/agent 型 hook；事件清单与 loop/工具/policy 决策点一一对应，杜绝为覆盖而覆盖。

- **理由**：cmp:H06 Decision 的完整论证——自研事件系统应分两类（持久型=会话事实、扩展型=决策点），正好对应 DSH 三事件域思想且与 H01 事件溯源一致（anat:0.3-2："扩展=类型化事件扩展点 + waterfall 中间件，不并存两套 hook API"）；Claude Code 的 35+ 事件面作为**覆盖度参考**而非照抄清单（cmp:H06 Decision："v0.1 只实现与自研 loop 决策点一一对应的事件"）；async+rewake 借鉴为长 hook 不阻塞主循环（cmp:H06 Why 末条）。任务书 §四 H06 的标准事件模型草案（BeforeTurn/BeforeModel/…/AfterTurn）即本决策的 v0.1 事件面来源（D5 已扩为 48 行总表）。

- **拒绝**：不采用候选 C 的 Claw 三事件（覆盖面不足，无法表达 SessionStart/Stop/压缩前等决策点，cmp:H06 Rejected）；不采用 OpenCode/Pi 式"两套平行 hook API 并存"（违反单一权威循环原则，cmp:H06 Rejected）；不采用 prompt/agent 型 hook 作 v0.1 主力（非确定性、成本不可控，判读职责归 H12 evaluator 层，cmp:H06 Rejected）。

- **影响**：D5 直接落点（48 事件总表、两域划分、waterfall 语义、`PolicyDecision`/`ApprovalRequest`/`ApprovalDecided` 审计对由 D6 消费）；D4 的 E01 等条目 conformance 依赖事件日志可查（IR:附录A loop/safety 类）；D6 的 Policy Engine 即 `BeforeTool` 链上的权威裁决监听器（D5 §7 接线约定）；D8 core/events 提供 emit/waterfall 原语。

---

## 决策点 4：插件/扩展机制（是否要、要多深）

- **问题**：是否建设"插件系统"？若建，是 DSH 式"一切皆插件"（连 loop 都可替换）、OpenCode/Hermes 式进程内钩子变换链、还是 Pi 式"无插件系统、能力靠扩展包约定"？

- **候选方案**：
  - 候选 A（类 DSH 插件树）：Cordis 插件树 + 三事件域 + 可替换 loop/agent 提供方。优点：可组合性最强（换 provider=换整个产品行为）；缺点：抽象层重、学习成本高，对中型 harness 是过度设计（anat:0.2-4 的价值判断是"与自研目标最同构"，但同构≠照搬全部）。
  - 候选 B（类 OpenCode/Hermes 进程内插件 Hooks + 变换链）：插件以 (input,output)=>output 变换链或枚举钩子（pre/post_tool_call、transform_*、chat.*.transform）注入，热路径钩子有超时上限、插件不 inline 跑 token 路径。优点：实现轻、语义清晰；缺点：仍需明确"哪些点可插"。
  - 候选 C（类 Pi 无插件系统 / 类 Codex 外部 hooks crate）：Pi 靠扩展包目录 + 官方示例（subagent 即 1038 行扩展自实现）；Codex 把外部钩子做成独立 hooks crate（command/MCP 后端、matcher 分组）。优点：内核零插件概念；缺点：Pi 的"能力靠用户自实现扩展包"对普通用户拿不到（cmp:H11 Rejected）；Codex 方案偏外部脚本生态。

- **决策**：**不要整体插件树，但要一等扩展点**——三类受控扩展并存：(1) 类型化事件扩展点（决策点 3 的 emit/waterfall 决策点，进程内，代码态）；(2) 外部 hooks.json 兼容桥（读取 Claude Code/Codex 两方言 matcher，退出码 2 阻塞、deny>ask>allow 合并、hook 失败绝不崩轮次——存量钩子可迁移，cmp:H06 Decision/Proposed Spec）；(3) Provider/MCP 级 seam（subagent provider 注册表、skill provider、sandbox backend、MCP 客户端作为动态工具通道，cmp:H11/H05）。v0.1 不实现"替换 loop 本体"的插件接口——loop 唯一且内建（决策点 2），可替换的是 loop 之外的提供方。

- **理由**：anat:0.3-2 主轴二结论："内核薄、单一权威 loop、扩展=类型化事件扩展点 + waterfall 中间件，**不并存两套 hook API**"——DSH 的"连 loop 都可替换"超出中型 harness 需求（决策点 2 已把 loop 所有权固定为唯一内建），但其事件扩展点与外部兼容桥是可迁移价值（cmp:H06 Why 候选 B）。任务书定位"可组合、可验证、可替换行为层"（行 1409–1413）要求的是**行为层**可替换（决策点 14 的 Behavior IR/Compiler 管线），不是内核本体可替换。Pi 的扩展包目录约定（skills/、extensions/）作为生态面吸收（cmp:H10/H11），MCP 是唯一动态工具扩展通道（cmp:H05 Decision："MCP 作为唯一动态扩展通道"）。

- **拒绝**：不采用候选 A 的整体插件树（决策点 2/3 已论证：抽象重、与单一权威循环冲突的边界）；不采用候选 C 的 Pi"无插件、全靠扩展包自实现"（subagent 等一等能力必须内建 seam 而非用户自写，cmp:H11 Rejected）；不采用双套 hook API 并存（同决策点 3 拒绝项）。

- **影响**：D8 不设 plugins/ 目录（能力挂在 tools/skills/agents/runtime 的 seam 上）；D5 增加 `subagent/start|end`、`skills/change` 等能力事件（持久/实时分域）；D6 的 hooks.json 兼容桥归 policy/hooks；D4 的技能/委派类条目（delegation 类）以 preset 而非插件形态表达。

---

## 决策点 5：Context 构建与指令分层

- **问题**：模型可见上下文如何组装——谁进 system、谁进 user、按什么顺序、什么预算、何时按需加载、如何防污染？

- **候选方案**：
  - 候选 A（类 Claude Code 常驻层 + 按需加载）：启动注入常驻层（base/工具说明/指令文件/技能索引），重内容（skill 正文、MCP schema、子目录 path 规则）在**首次接触匹配文件时**按需加载；指令（CLAUDE.md）以 user message 注入而非 system；无硬 token 预算，靠软上限+截断。优点：加载规则直观、省 token；缺点：上下文构成不可机器校验、无预算控制（cmp:H03 Why）。
  - 候选 B（类 DSH 事件派生 + 注入即数据）：会话日志单一真源、`deriveMessages()` 从 surface 事件投影模型历史（缓存节点、compaction 替换时重建）；一切注入=带 source 的持久 user/message；显式字节预算/去重/转义系统化；污染防护类型级强制。优点：无第二份"上下文状态"可漂移、可回放可压缩；缺点：每步派生有日志体积与实现复杂度（cmp:H03 Why）。
  - 候选 C（类 Hermes 三层拼接）：stable（身份/guidance）/context（workspace 快照/caller）/volatile（skills 索引/记忆/时间戳）三层 `\n\n` join，**每会话构建一次、跨轮复用**（保住上游 prefix cache，唯一重建触发=压缩）。优点：缓存纪律最好；缺点：无结构化边界、依赖 XML 标签消化差异。

- **决策**：组合——**B 为底**（事件日志派生模型历史 + 注入皆带 source 的持久 user message + 显式字节预算）、**C 为组装纪律**（stable/context/volatile 三层排序、每会话组装一次并缓存、跨轮复用保 prefix cache）、**A 为加载策略**（重内容绑定"首次 touch 事件"按需注入：skill 正文/MCP schema/子目录 AGENTS.md 成功 read/write/edit 后才加载）。指令基线（AGENTS.md 链）宽泛→具体、以 user message 注入；system prompt 只承载稳定身份与轮询不变的引导，动态内容（token/时间提醒）不进 system（anat:0.3-4c：动态内容往会话层追加方向放）。

- **理由**：任务书禁止事项 7（"把所有上下文永久塞进 System Prompt"）+ H03 研究结论（cmp:H03 Decision："事件日志派生 + 分层按需 + 源头截断…以 B 的模型可见⟺已记录不变式为骨架"）。anat:0.3-4c 的跨家共识"prefix cache 是默认工程约束"支撑 C 的每会话一次组装；Claude 的按需加载（cmp:H03 Why 候选 A 的"接触匹配文件才加载"）在 B 之上作为注入策略实现，两者不冲突（cmp:H03 Why 对比结论原文）。

- **拒绝**：不采用 Claw 全量 transcript 每轮重发无中间层（token 线性增长无预算，cmp:H03 Rejected）；不采用 OpenCode 每轮全量读库+序列化重排（长会话 CPU/估算成本线性增长，cmp:H03 Rejected）；不采用 Pi 每轮从 JSONL 重放整条分支作为唯一路径（读放大，cmp:H03 Rejected）；不采用 RAG 向量检索（四家研究均无内建 RAG，等价物=grep/glob/read + 会话 SQLite FTS opt-in，cmp:H03 Decision/Proposed Spec）。

- **影响**：D5 的注入通道=`agent.inject()` 队列化 → 下一 pre-step 带 source 的 user/message（可回放可压缩）；D4 的 context 类条目与 prompt 分层 render 规则（stable<context<volatile 顺序）；D6 的指令文件发现顺序与 workspace trust（AGENTS.md 不受信任门限制）;D8 context/builder + instructions + compaction 三个子模块边界。

---

## 决策点 6：Compaction 触发模型

- **问题**：何时压缩（触发源）、压缩什么/保留什么（区域与清单）、摘要怎么生成、压缩后会话怎么续、是否另起会话？

- **候选方案**：
  - 候选 A（类 Claude Code / Claw 阈值触发 + 摘要/归纳）：Claude 接近窗口上限自动压缩（先清 tool 输出再整段 summarize，保留用户请求/关键文件/最近 5 文件/调用过 skill ≤5000 token）；Claw 累计 input_tokens ≥100k 自动触发、最近 4 条逐字、旧消息启发式（非 LLM）归纳。优点：实现直接；缺点：Claw 纯启发式信息损失风险高（cmp:H04 Rejected），Claude 保留清单是提示性非结构性。
  - 候选 B（类 DSH/Pi 事件区域替换 + 事务化）：三入口（自动压力 thresholdRatio 0.8×contextWindow / CONTEXT_WINDOW_EXCEEDED 溢出先压再试 / 手动）；最旧**平衡** surface 段替换为带 source 的 `<compacted-summary>` user message（tool call/result 必须配对）；保留尾部逐字（retainRatio 0.16）；`compaction/start`(锁)→摘要→`summary`+replace→恰好一次 `compaction/end` 事务化；摘要请求复用上次请求热前缀。优点：压缩可回放可检测、配对完整、KV Cache 前缀复用显式、重复压缩不漏幸存消息；缺点：实现复杂（锁/账目/区域计算），摘要仍是一次额外模型请求（cmp:H04 Why）。
  - 候选 C（类 OpenCode/Codex 事件驱动滚动窗口）：OpenCode step-finish isOverflow 触发、head/tail 保留 + 隐藏 compaction agent 摘要 + auto-continue/重放；Codex 采样前预压/采样后 roll-over、保留全部用户消息原文、压缩再超窗从头丢项保前缀。优点：与长 turn 续作语义结合好；缺点：OpenCode 直接清空旧 tool 输出字段使旧细节不可再查（cmp:H04 Rejected，改 spill 落盘）。

- **决策**：B 为主（三入口统一、事务化、平衡区域替换、尾部逐字、配对边界、热前缀摘要、`not_new_session` 原地替换），叠加 C 的"保留全部用户消息原文 + 压缩中再超窗从头部丢项保前缀 + auto-continue/重放续作"与 A 的保留清单作为**摘要内容指引**（summarizer 提示必须列出：用户请求与意图/检查修改过的文件/未完成任务/当前工作/关键代码片段）；摘要生成默认独立 LLM（复用热前缀），启发式归纳仅作可配 fallback（Claw 型省成本）。

- **理由**：cmp:H04 Decision 的完整论证：事件日志真源下 B 是唯一能保证"压缩后模型可见内容仍可由日志重建"的方案（与 H01/H03 一致，anat:0.3-1）；tool 配对边界防 OpenAI-compat orphaned tool message（Claw 400 教训，cmp:H04 Claw 行）；"压缩必须原地、同一会话日志内"是 Claude/DSH/Codex/Pi 一致立场（cmp:H04 Rejected 末条）。Codex 的"保留全部用户消息原文"直接支撑 D4 E01 的 conformance（用户指令永不丢）。

- **拒绝**：不采用 Claw 纯启发式归纳作主路径（保留为可配 fallback，cmp:H04 Rejected）；不采用 Hermes micro_compaction 默认开（每轮重写前缀破坏 cache——Hermes 自己默认关，cmp:H04 Rejected）；不采用 OpenCode 直接清空 tool 输出字段（`[Old tool result content cleared]` 使旧细节不可再查，改为 spill 落盘+可回读，cmp:H04 Rejected）；不采用"压缩=另起新会话"（OpenCode token-budget 新窗口模式 v0.1 不做，cmp:H04 Rejected）。

- **影响**：D5 已有 `compaction/start|summary|end` 事件与持久记录（事务语义、先记账后执行）；D4 的 compaction 相关行为约束（保留清单对应 verifiable 产出）；D8 context/compaction 模块实现事务与 spill；D7 场景 B010（上下文压缩）的通过判据=压缩后日志可重建 + tool 配对完整（cmp:H04 Proposed Spec）。

---

## 决策点 7：Tool 注册与并行调度

- **问题**：内建工具集多大、工具注册与执行流水线怎么设计、并行调度纪律、动态扩展通道是什么？

- **候选方案**：
  - 候选 A（类 Claude Code/Claw 40+ 大工具面 + 深 Bash 解析）：canonical name 一套规则通吃 permission/hook/subagent；Bash 权限解析到 wrapper/compound/redirect。优点：开箱能力强；缺点：工具数量膨胀带来每轮 token 与认知成本、Bash 字符串解析深但永远补不完（Claw 自承仍是简单 `sh -lc`，cmp:H05 Why）。
  - 候选 B（类 Pi/Hermes 最小内建集 + 执行解耦）：Pi 8 个最小工具（bash/pwsh/read/write/edit/grep/find/ls）+ TypeBox schema 驱动 + Operations 注入点（可重定向 SSH/容器）；Hermes 核心工具每轮全量随请求发送故受"窄腰"纪律约束。优点：schema/上下文成本低、执行与 I/O 解耦天然支持远程沙箱；缺点：默认能力少需扩展补（cmp:H05 Why）。
  - 候选 C（类 DSH 统一流水线 + 并行调度原语）：`tool/call → pre-execute(waterfall) → ToolGuard(单调) → execute → output.render(纯投影) → post-execute → result(冻结)`；`ToolExecutionMode = parallel|exclusive`（独占=排序屏障）+ `maxParallelToolCalls` 滚动池（默认 10）。优点：权限/超时/展示/附着上下文/终结标记全覆盖且可插拔；缺点：管线长需纪律维护（cmp:H05）。

- **决策**：组合——**最小内建集（~11）**（read/write/edit/glob/grep/bash|pwsh/skill/subagent/todo/ask_user_question/exit_plan_mode）+ **C 的流水线与并行原语**（exclusive 屏障、滚动池默认 10、guard 单调、canonical value 仅执行期存在、日志只存 content/error/meta）+ **B 的 schema DSL**（v0.1 选 DSH 风格 ValueSchemaSpec，纯 TS 无运行时依赖，推导类型+JSON Schema+校验）+ **MCP 作为唯一动态扩展通道**（stdio + streamable-http，远端工具动态注册进 ctx.tools，命名 `mcp__<server>__<tool>`，schema 首次调用时加载）+ OpenCode 健壮性件（参数错 INVALID_ARGS 让模型自修复、输出源头限流默认 16KiB inline + 溢出 spill 落盘）。

- **理由**：任务书 §10 V0.1 工具范围（Read/Write/Edit/Glob/Grep/Shell）+ 禁止事项 8（不为通用性提前加几十个 provider/工具）+ cmp:H05 Decision："最小集 + 扩展点符合任务书'功能不做多、机制做对'的取向…MCP 作为唯一动态扩展通道（Pi 无 MCP 客户端是短板，我们要补上）"。并行纪律（读并发/写串行）是 Claude/Codex/DSH 收敛值（anat:0.3/ H01 共同抽象："只读并发 + 写/独占串行，并行度受滚动池约束"）。

- **拒绝**：不采用候选 A 的 40+ 大工具面与 Bash 深解析主防（每多一个工具是每轮 token 成本+安全面，cmp:H05 Why/Rejected）；不采用 Claw 万行单体 tools crate（不可维护，cmp:H05 Rejected）；不采用 Codex"无独立文件工具、全走 exec_command/apply_patch"（与文件工具化+文件边界守卫理念相反——Claw/OpenCode 的 canonical 化防 `../`/symlink 逃逸是参考，cmp:H05 Rejected）；不采用 Pi"无 MCP 客户端抽象"。

- **影响**：D5 的 tool 事件面（tool/call|result、tools/pre-execute|execute|post-execute）与错误契约；D6 的工具级 `required_permission` 与 denied_tools（裸工具名 deny=移出上下文）；D4 的 tool_use 类条目（只调显式工具/调前说明原因）；D8 tools/registry（作用域化 global→agent）+ tools/shell 的 Operations 注入点（供 H08 沙箱后端复用）。

---

## 决策点 8：Policy 引擎位置（软/硬分离如何落地）

- **问题**：安全与行为约束放哪一层——只写 Prompt、还是建立独立 Policy 引擎？软（引导）与硬（执法）如何在架构上分离并保持单一事实源？

- **候选方案**：
  - 候选 0（反例，任务书禁止事项 5：安全规则只写 Prompt）："不要删除 .git"只进 prompt。任何项目都不接受（任务书原则 3 明示必须同时允许 Prompt Policy + Runtime Policy + Tool Interceptor + Audit Log）。
  - 候选 A（类 Claude Code/Codex 四层叠加 + 模型审查）：permission modes（default/acceptEdits/plan/auto/dontAsk/bypass）→ rules（allow/ask/deny，deny→ask→allow 先匹配、deny 不可被更细 allow 豁免）→ hooks → sandbox；Codex 加 Guardian 模型审查 + execpolicy 规则引擎 + violation→升级重试。优点：纵深防御、免打扰自动审批面大；缺点：配置爆炸、classifier/guardian 是黑盒不可本地审计（cmp:H07 Why）。
  - 候选 B（类 DSH fail-closed + 审计对 + 单调 guard）：`tools/pre-execute(waterfall) → ToolGuard(单调) → ctx.approval.request()(waterfall→应答者) → 仅 allowed-once 放行，rejected/cancelled/unavailable 一律拒绝(fail closed)`；`never` 策略确定性拒绝且服务内强制（绕不过）；approval/asked+decided 审计事件对构成完整证据链；Behavior Safety（prompt 段落）与 Runtime Safety（沙箱+审批）共享同一 permission-presets 意图。优点：证据链完整、决策序无翻转、安全默认写进组合层；缺点：ask 无应答者即拒、无人值守体验硬（需应答者链）。
  - 候选 C（类 Pi 仅项目信任门）：无工具级权限系统（README 明示"runs with the permissions of the user"）。诚实但零工具约束（cmp:H07 Why 候选 C）。

- **决策**：**Policy 声明（YAML）为唯一事实源，编译期展开四件套**——Prompt Guidance（软/引导，编译进 prompt 段）+ Tool Interceptor（工具暴露面裁剪 + 执行期复核）+ Runtime Deny（Policy Engine 裁决 + 沙箱 OS 级兜底）+ Audit Event（每次裁决落持久日志）；Policy Engine 挂 `BeforeTool` 链做权威裁决（任务书 §8 执行链 `Agent → Tool Call → BeforeTool → Policy Engine → ALLOW/DENY → Runtime → Audit` 原文）。规则语义取 A 的 deny→ask→allow 先匹配 + deny 不可被更细 allow 豁免 + 危险集合任何模式不自批；执行保证取 B 的 fail-closed + guard 单调 + approval 审计事件对 + never 服务内强制；对外暴露单一三档 profile（read-only / workspace-write / danger-full-access，workspace-write 默认 + ask，Codex/Pi/Claw 收敛值）。guardian/classifier 模型审查放 evaluator 层（决策点 12/H12），不进 v0.1 权限主链。

- **理由**：任务书原则 3（行 87–115："软约束负责引导、硬约束负责执法"）与 §8 Policy Runtime（项目第二个核心创新）+ 禁止事项 5。cmp:H07 Decision 完整论证："以 Claude Code 的四层叠加…为规则语义，以 DSH 的 fail-closed + 审计事件对 + guard 单调为执行保证…行为安全与运行时安全显式分离并文档化各自失效面"。四家收敛的 deny 规则语义（deny→ask→allow、deny 不可豁免）是 anat:0.3-4a 的跨家共识。

- **拒绝**：不采用候选 C（Pi 无权限系统：对自动化/子代理场景不可接受，cmp:H07 Rejected）；不采用 bypassPermissions/YOLO 一类放行模式作一等模式（仅 danger-full-access + 文档警告仅限容器/VM，cmp:H07 Rejected）；不采用黑名单危险命令清单作唯一防线（维护成本高且易漏——Claude 亦主张 deny 规则+沙箱，v0.1 以 allowlist+deny 规则+沙箱兜底，cmp:H07 Rejected）；不采用 guardian/classifier 进 v0.1 主链（黑盒不可本地审计，归 H12，cmp:H07 Why 对比结论）。

- **影响**：D6 POLICY-SPEC 是本决策的直接落点（四件套、三态、决策序、scope 合并、审计接线、workspace trust）；D5 的 `PolicyDecision`/`ApprovalRequest`/`ApprovalDecided` 事件与审计自动持久记录由 D6 消费；D4 的 safety 类条目带 `channel: runtime_policy`（编译去 policy_ref 而非只 render，IR 双通道原则）；D8 policy/engine + hooks + risk 与 core 层"policy 不得反向依赖工具实现"的边界。

---

## 决策点 9：Sandbox 策略（平台范围与隔离深度）

- **问题**：执行隔离做到什么深度、覆盖哪些平台、无后端平台怎么办、与权限系统（决策点 8）和容器/远程的关系？

- **候选方案**：
  - 候选 A（类 Claude Code/Codex 深度 OS 级沙箱）：Seatbelt/bwrap（只读根 + 可写覆盖 + 受保护子路径强制只读 + 路径特异性排序）+ Windows 受限令牌 + WFP 网络过滤 + ACL + 私有桌面（Codex）；Claude 原生不支持 Windows（须 WSL2）+ 凭据 mask/代理注入。优点：真强隔离、防任意子进程；缺点：实现维护成本极高（Codex Windows 四套叠加），Claude 干脆放弃 Windows（cmp:H08 Why）。
  - 候选 B（类 DSH confine seam + 平台 runner 链）：`ctx.sandbox.confine(argv, policy)` 逐调用解析（workspaceRoot 派生自会话不可变 cwd、先语义规范化再词法防 symlink/.. 逃逸）；后端 Linux bwrap→Landlock / macOS Seatbelt / Windows ACL 受限令牌；fail-closed（SANDBOX_UNAVAILABLE）；enforcement full/partial 透明上报；容器/远程=同级能力 seam。优点：平台解耦、不夸大隔离强度、Windows 有真实方案、消费方只依赖 seam；缺点：部分平台强制 partial（cmp:H08 Why）。
  - 候选 C（类 Pi/OpenCode 无 OS 沙箱）：权限/信任即边界（Pi Project Trust 门；OpenCode permission + 进程派生点）；Hermes 本地=审批+env 清洗、真隔离外置 docker/modal/ssh。优点：实现最省；缺点：行为安全管不住任意子进程（各家共识），对自研自动化 harness 不够（cmp:H08 Why 末条）。

- **决策**：**B 为骨架**（confine seam + fail-closed + enforcement 透明 + 平台 runner 链），吸收 A 的 Linux 文件边界实现参照（只读根 + 可写覆盖 + 受保护子路径强制只读 + 路径特异性排序 + violation→denial 判定驱动升级重试）与 Claw 的健壮性件（能力探测而非存在性假设、容器检测 `/.dockerenv` 等防嵌套误判、fallback 状态回填 `SandboxStatus{enabled/supported/active/.../fallback_reason}`）；容器/远程（docker/ssh/microVM）作为**同级提供方 seam**（v0.2 起，通过 ExecutionEnv/Operations 注入点，Pi/Hermes 模式）；网络边界与凭据（mask + 代理注入）作为独立于文件沙箱的策略层（v0.1 声明 allowlist、v0.2 代理 MITM）；v0.1 默认读边界=workspace + 显式 allow 目录（**比 Claude 默认读全盘更保守**），凭据文件 denyRead 默认。

- **理由**：cmp:H08 Decision 的完整论证：B 是唯一同时给出 Windows 方案与完整性透明上报的一家；"执行隔离必须以 OS 级边界为最终防线（Behavior Safety 管不住任意子进程是各家共识），confine 抽象保证未来换更强后端（容器/微 VM）不动消费方"。任务书 §H08 平台范围含 Windows/Linux/macOS 三平台；Claude 放弃 Windows 而自研项目目标环境（§20）以 Windows 桌面为常态（研究运行于 Windows），故 Windows 方案是硬需求。anat:0.3-4e 跨家共识："隔离是能力边界，与行为边界必须分开"。

- **拒绝**：不采用候选 C 的 Pi/OpenCode 无 OS 沙箱立场（cmp:H08 Rejected）；不采用 Claw 的 HOME/TMPDIR 环境重定向**当作**隔离（明确 fallback_reason、默认 fail-closed 拒绝危险调用，cmp:H08 Rejected）；不采用 Codex Windows 全栈（WFP/私有桌面/服务端提升）进 v0.1（复杂度超限，v0.1 Windows=ACL 受限令牌 + 只读工具降级，cmp:H08 Rejected）；不采用 Claude 默认读全盘（防凭据默认暴露，cmp:H08 Rejected）。

- **影响**：D6 的 sandbox 域（模式三档、fail-closed、status 事件、runnerFailureRules vs denialSignatures 区分、Safety Violations 口径）；D5 的 sandbox 会话事件（sandbox/mode 覆盖持久记录）与文件/命令 seam 事件；D8 runtime/sandbox + executor + process 边界与语言中立 seam（决策点 15）；D4 的 git/safety 类条目（危险删除的硬通道落 policy_ref）。

---

## 决策点 10：Session / 持久化（是否 event-sourcing）

- **问题**：会话真源用什么形态——转录快照、全量消息库、还是仅追加事件日志（event-sourcing）？resume/fork/崩溃恢复语义随之怎么定？

- **候选方案**：
  - 候选 A（类 Claude/Claw/Pi 转录/Entry 树）：Claude JSONL 转录 + checkpoint；Claw JSONL snapshot+JSON 双格式 + fork 记 parent；Pi Entry 树（id/parentId，每轮从 tip 重放）。优点：实现直白；缺点：转录格式内部化不稳定、fork 继承语义各家不一、Pi 每轮整支重放读放大（cmp:H09 Why）。
  - 候选 B（类 DSH event-sourced 仅追加日志）：会话=仅追加事件日志（JSONL，每事件一行）；resume=重放 + 合成 interrupted 关闭器（不截断长轮次）；fork=取已完成轮次前缀深克隆 seed + parentSession + isSeeded + delegationDepth；单写者租约（并发第二写拒绝）；append write-behind、flush() 为持久性屏障、崩溃保留被中断轮次只丢撕裂尾部；格式迁移只发布新 generation 绝不改写已提交。优点：resume/fork/回放/遥测/UI 同构、崩溃不丢长轮次、跨进程写租约消除并发损坏；缺点：层数多、无内置长期记忆（cmp:H09 Why）。
  - 候选 C（类 OpenCode/Codex 全量消息库）：消息+parts 双层 SQLite（OpenCode）/ rollout JSONL + sqlite 元数据（Codex）+ 双阶段自动记忆管道。优点：可翻页/审计/import/revert；缺点：Codex rollout 多行类型复杂、自动记忆依赖后端状态库且污染风险高（cmp:H09 Why/Rejected）。

- **决策**：**B（event-sourcing）为会话唯一真源**：会话=append-only 事件日志（JSONL v1，每事件一行；SQLite 后端留可插拔 Storage 接口 v0.2）；历史=surface 投影派生（决策点 5）；resume=重放+合成 interrupted 关闭器；fork=seed 前缀+isSeeded+parentSession+delegationDepth；单写者租约；崩溃只丢撕裂尾部；格式迁移不可变发布。长期记忆独立于会话层：**文件式记忆**（MEMORY.md agent 笔记索引+topic 文件 / USER.md 用户画像，Hermes 型——会话开始冻结快照注入、中途写盘不改进程内提示保 prefix cache、文件锁+备份防漂移、单一 memory 工具、user/project/local 三级作用域）。Codex 双阶段自动记忆管道作为 v0.2 方向不进入 v0.1。

- **理由**：anat:0.3-1 差异主轴一："自研选择：事件日志为单一真源 + surface 投影派生模型历史…这是 Evaluator/回放/审计的地基"——本决策与决策点 2/3/5 共享同一条不变式（模型可见⟺已记录）。cmp:H09 Decision："会话是'发生过什么'（日志）、记忆是'跨会话保留什么'（文件索引+按需读），两者分离正好对应任务书 H09 的两种诉求"。任务书禁止事项与 §H09 要求区分 Conversation/Session/Project/Long-term 四类记忆，文件式记忆（可 git、可审计）比后端状态库更符合"Behaviors 可替换"的定位。

- **拒绝**：不采用候选 C 的 Codex rollout 多行类型 + 自动记忆管道进 v0.1（实现重、依赖后端状态库、污染标记机制尚需成熟，cmp:H09 Rejected）；不采用 Claw"落盘生命周期外置于 runtime"（落盘责任收进内核 append+flush，cmp:H09 Rejected）；不采用 Pi"记忆=历史+压缩摘要"（无独立长期记忆层、缺可检索/可写入口，cmp:H09 Rejected）；不采用 checkpoint/rewind 文件快照作为唯一回滚（Bash 改动漏网，与 git 互补、Bash 改动以 git 为准，cmp:H09 Rejected）。

- **影响**：D5 的持久记录清单（会话生命周期/轮次/工具/审批/压缩等 21 类自动落日志，EVENT-SPEC §6）即本决策的直接实现面；D4 的 memory/context 类条目（冻结快照注入语义）；D8 core/session + memory/session 边界（目录绑定 workspace-slug、header 存日志旁不入事件）。

---

## 决策点 11：Skills 作用域

- **问题**：技能（skill）按什么格式与发现机制组织、system/user/project/session 四级作用域如何裁决冲突、正文何时进上下文、技能可否自动增改？

- **候选方案**：
  - 候选 A（类 Claude Code 四级发现 + 丰富 frontmatter）：enterprise>personal>project>bundled 冲突规则；描述索引启动注入（截断 1536 字符）、正文按需加载、注入后跨轮保留、compact 后按 ≤5000 token 重注入；frontmatter 含 allowed-tools（turn 级授权）/context:fork/paths/disable-model-invocation。优点：能力面最全；缺点：正文跨轮常驻每行都是成本、frontmatter 大而难、allowed-tools 只覆盖当前 turn（cmp:H10 Why）。
  - 候选 B（类 DSH/Pi rank+scope 链 + 渐进披露）：provider 分层注册（rank 表 project 100 → … → user 500 → bundled 600，最近层赢重名）；目录注入只含 name+XML 转义 description（无正文/路径）；`skill({name})` 工具每次调用按 cwd 重读正文返回 `<skill_content>`/`<skill_resources>`/`<skill_instructions>`；isModelInvocable/userInvocable 门禁。优点：上下文成本近零、内容-元数据分离防泄露、无缓存一致性问题；缺点：每次重读有性能取舍、无市场/安装/签名（cmp:H10 Why）。
  - 候选 C（类 Hermes 生命周期自动化）：SKILL.md frontmatter 硬约束（description≤60 字符）+ `/learn` 活体 agent 一次产出技能 + curator 空闲期自动 pin/archive/consolidate（只归档不删除、可恢复）。优点：学习闭环完整；缺点：description≤60 硬约束过紧、AST 扫描发现复杂度高（cmp:H10 Rejected）。

- **决策**：**B 为骨架 + 任务书四级作用域**：SKILL.md = YAML frontmatter + markdown 正文（开放标准 Agent Skills 兼容）；发现根按 system/user/project/session 四作用域映射 rank（project `<root>/.dsh/skills` 100 < `.agents/skills` 200 < 用户级 400–500 < bundled 600），兼容 `~/.claude/skills`、`~/.codex/skills` 目录（Pi 型宽松校验跨 harness 共享）；启动只注入目录索引（name+转义 description），正文经 `skill` 工具调用时按 agent cwd 重读注入（返回 `<skill_content>`/`<skill_resources>`/`<skill_instructions>` 结构化）；同会话内按 skill 正文缓存 ≤5000 token（compact 后重注入，吸收 A 的跨轮保留但设上限）；allowed-tools turn 级授权保留为 frontmatter 字段；`/learn`（活体 agent 产出）与 curator（只归档不删除）列 v0.2（任务书 V0.3/V0.4 路线：自动学习只允许 suggest、用户 Skill ≠ Agent 自动修改区、learned/ 专用区）。

- **理由**：任务书 §H10 明示"作用域至少统一 system/user/project/session"，cmp:H10 Decision："技能是'知识即文件'的可组合单元，注入策略必须缓存友好、内容不泄漏正文/路径、来源可追溯（source/rank 是元数据不是信任链）"。V0.3 路线（§12：Skills + Skill Scope + Provenance，自动学习只 suggest）+ V0.4 路线（§13：用户 Skill ≠ Agent 自动修改区，学习只能写 learned/）是技能生命周期节奏的硬约束。anat:0.3-4 的 prefix cache 纪律（c）同样约束技能注入（索引轻、正文按需）。

- **拒绝**：不采用 Claw"技能=把文件全文读回给模型、无参数 schema/无执行器"的粗实现（cmp:H10 Rejected）；不采用 Hermes description≤60 硬约束与 AST 扫描发现（cmp:H10 Rejected）；不采用"正文常驻上下文无限保留"（无自动卸载，有成本上限，cmp:H10 Rejected）；不采用市场/签名链进 v0.1（OpenCode URL 仓库留 v0.2，synced 来源能力降级原则先记录，cmp:H10 Rejected/Proposed Spec）。

- **影响**：D5 的 `skills/change` 事件（watcher 同步失效、digest 变化 agent.inject() 替换目录）；D8 skills/ 目录（发现根 + frontmatter 解析 + rank 合并）；D4 的 delegation 类条目（技能目录以 volatile 层注入的 render 规则）；D6 的技能执行不豁免权限（技能正文是建议性知识，真正强制在权限/沙箱，cmp:H10 Why 末条）。

---

## 决策点 12：Subagent / Evaluator 关系

- **问题**：子代理（subagent）与 Evaluator 是不是两种独立原语？子代理上下文/权限/结果契约怎么定？Evaluator 用什么形态（内建模块 vs 子代理 preset vs 外包）？

- **候选方案**：
  - 候选 A（类 Claude Code/Hermes 全新独立上下文 + 只回摘要）：每子代理全新上下文窗口（不带主会话历史）、只回 summary + 元数据、后台精简工具集、嵌套默认 3 层/并发 20、worktree 隔离。优点：上下文隔离是核心卖点、并行写冲突最小；缺点：summary 是信息瓶颈、worktree 机制复杂（cmp:H11 Why）。
  - 候选 B（类 Codex fork 窗口子线程）：子代理=按 SpawnAgentForkMode{FullHistory,LastNTurns} fork 的独立 thread/rollout；角色只能收窄不能放大父权限；代理树可崩溃恢复（BFS）。优点：fork 继承平衡隔离与上下文、恢复整树；缺点：v1/v2 双套工具并存维护面翻倍（cmp:H11 Why）。
  - 候选 C（类 DSH seam + provider 注册表）：`ctx.subagents` + SubagentProvider（6 提供方）；能力 flag 校验（缺能力即 UNSUPPORTED_CAPABILITY 拒绝，绝不接受后忽略）；结果契约 {output, structured?, diagnostic?, stopReason}；可继续子代理（childId + send_message/interrupt/list_agents）；delegationDepth 持久（冷恢复不降低）。优点："换 provider=换整个产品行为"、结果契约统一、非完成原因一律视为失败；缺点：无 Planner/Reviewer 预设角色（机制非角色）、无 worktree（cmp:H11 Why）。

- **决策**：**C 为骨架**（子代理=普通 Session 同构复用，结果契约统一、能力 flag 显式声明、可继续子代理、delegationDepth 持久），叠加 B 的"fork 窗口可选 FullHistory/LastNTurns + 角色只能收窄父权限"与 A 的"父只见摘要不见中间过程（信息隐藏）+ 只读 Explore 预设"。**Evaluator 不是新原语**：H12 的三层验证 = ①确定性层（tests/lint/typecheck/build 经 shell 工具执行 + `{stdout,stderr,exitCode}` 契约回读）②独立 evaluator 子代理（Claude Code `/goal` 形态：独立小模型 + 结构化三态 met/not_met/impossible/error + 只读证据——放宽 /goal 的"只看 transcript"为"可读磁盘证据"）③机械自检 invariants（回放校验轮次/步骤编号、tool call/result 配对、retry 记录——DSH invariants 思想）。评审子代理（Codex `codex review`：review-only 工具限制 + 独立 review_model + rubric 结构化 findings + verification step 对照真实代码过滤误报）与 goal/evaluator 同为 **preset 子代理 + 独立模型配置**，零新增机制（复用 H11）。

- **理由**：任务书 §2.4（Generator/Evaluator 分离，禁止"写代码的自己检查自己自己宣布完成"）+ 禁止事项 6 + §H11/H12；cmp:H12 Decision："评审用子代理沿用 H11 机制（独立会话+schema 结果）零新增机制"，"完成语义必须外部化（可运行命令/独立评估模型/多 agent 交叉核验），且评估者与执行者之间必须有信息隔离"。cmp:H11 Decision："子代理必须与主代理同构（同一 Session/loop/事件），才能享受 resume/fork/审计；机制（seam+provider）先于角色（Planner/Reviewer），角色只是预设配置"——这同时回答"为什么 Evaluator 不做成内建独立模块"：它只是带独立模型与只读工具面的 preset 子代理（同 H11 机制复用）。

- **拒绝**：不采用 Pi"无内建 subagent、靠 spawn 独立进程扩展自实现"作默认（用户拿不到、进程开销大、无共享检查点，保留为一种 provider 实现选项，cmp:H11 Rejected）；不采用 Claw 同进程线程 + Task/Team/Cron 内存注册表当真编排（无故障隔离、重启即失，cmp:H11 Rejected）；不采用 Codex v1/v2 双套多代理工具并存（v0.1 只一套，cmp:H11 Rejected）；不采用 OpenCode"无内建 evaluator、全外包"缺口状态（任务书禁止事项 6 要求内建 evaluator 语义，cmp:H12 Rejected）；不采用 Hermes background_review 每轮学习判定进 v0.1（学习闭环留 v0.2 防记忆污染，cmp:H12 Rejected）；不采用 Claude `/goal` 的"evaluator 只看 transcript 不看磁盘"硬限制（v0.1 evaluator 只读模式=transcript+磁盘只读证据，比 /goal 更能验证"产物真实存在"，cmp:H12 Rejected）。

- **影响**：D4 的 delegation/verification/evaluator 三类条目（独立评判、证据要求、completion_gate=generator 不可默认自判完成）；D5 的 subagent/start|end 事件与 delegate 事件（结果回投通知）；D7 的 B013/B014 场景与 A/B Test 归因（提升来自 Prompt 还是 Harness）；D8 agents/subagent + evaluator 目录边界（evaluator 是 preset 配置 + 独立模型 profile，不新增内核机制）。

---

## 决策点 13：多模型支持范围

- **问题**：v0.1 支持多少模型/Provider、prompt 模板按什么粒度维护——按供应商各写一份、一份 provider 中立模板、还是锁死单一模型？

- **候选方案**：
  - 候选 A（类 OpenCode 按供应商模板库）：anthropic/gemini/gpt/codex/kimi 各一套 prompt 模板按 model.api.id 匹配（缺省 default.txt）。优点：每模型可精细调优；缺点：多模板并行维护成本高、匹配脆弱（cmp:H02 Rejected）。
  - 候选 B（单 provider 中立模板 + Model Profile 覆盖差异）：一份中立模板承载稳定行为，模型差异（能力/人格/工具调用格式）由 Model Profile 数据覆盖；差异经编译器（决策点 14）展开（Codex 的 model-specific personality/effort section 有 provenance 是同类思想的工程化）。优点：维护面最小、"Behavior 一致、Prompt 不必一致"；缺点：极端模型差异需 profile 补丁表达。
  - 候选 C（锁死单模型，类 Claude Code 只 Anthropic）：行为基准最稳。缺点：与任务书"多模型"目标（项目定位行 9：小型到中型、多模型）冲突。

- **决策**：v0.1 支持三类 Provider——**Anthropic / OpenAI / OpenAI Compatible**（任务书 §10 V0.1 范围原文）；prompt 组装用**一份 provider 中立模板**（决策点 5 的分层组装），模型间差异不进模板、进 **Model Profile**（每 IR 条目针对不同模型渲染不同措辞，同一条 `verification.independent_evaluator: true` 对 Claude/GPT/DeepSeek/Qwen 各生成对应提示）；Provider 层抽象统一 tool-use 协议差异（Anthropic tool_use vs OpenAI function calling）；v0.1 明确不做多供应商模板并行。

- **理由**：任务书 §10 V0.1（Model Provider：Anthropic、OpenAI、OpenAI Compatible）+ §7（Behavior Compiler：Unified Behavior → Claude/GPT/Gemini/DeepSeek/Qwen profiles）+ 禁止事项 8（"为所谓通用性提前加入几十个 Provider"）+ cmp:H02 Rejected："不采用 OpenCode 的按供应商维护十余份模板…多模板并行维护成本高、匹配脆弱；本项目 v0.1 只维护一份 provider 中立模板"。anat:0.3-5（Behavior IR 成立前提：prompt 侧行为高度可归纳、跨产品一致性极高）说明中立模板+profile 覆盖在行为侧可行。

- **拒绝**：不采用候选 A（十余份 vendor 模板：维护成本与匹配脆弱，cmp:H02 Rejected）；不采用候选 C（与"多模型"定位冲突）；不采用"提前接几十个 provider"（禁止事项 8）；OpenAI-Compatible 通道覆盖 DeepSeek/Qwen/本地服务（任务书 §10 语义），不单独为其建模板。

- **影响**：D4 的 Model Profile 编译目标与 render 规则（§7.3 示例：同一条目编译到不同 Model Profile，IR:附录A 的 render 字段）；D8 llm/provider + router + profiles 边界；D7 runner 的模型可配置性（A/B 组间换模型）；D5 无模型特定事件（模型差异全部下沉 provider/profile 层）。

---

## 决策点 14：Prompt 编译管线（Behavior IR 是核心创新）

- **问题**：行为约束与 prompt 的生成走什么管线——直接复制各家 prompt 原文、行为散落各 prompt 段落、还是显式 Behavior IR → 编译器管线？UNTRUSTED 语料（CL4R1T4S 类）如何进入？

- **候选方案**：
  - 候选 0（反例，任务书 §2.1：直接拼接各家 prompt/code）：Claude Code prompt + Codex prompt + … = 新项目，禁止。
  - 候选 A（行为即显式 IR）：保存"该 Agent 应该怎么行为"的声明（YAML），经 Model Profile → Harness Profile → Prompt Compiler 编译成各模型的具体提示（任务书 §6/§7）。优点：行为可版本化、可验证（conformance 字段）、可替换行为层而不动 harness；缺点：需要编译器与 profile 两层基建。
  - 候选 B（无独立 IR：行为散落在 prompt 段落/指令文件/hook 契约/权限规则四处，Pi/OpenCode/Claude 现状）：优点：零新增层；缺点：同一意图多处维护（anat:0.2 各范式共性：没有哪家把行为做成显式 IR，行为散落在 system prompt 段落、指令层级、hook 契约、权限规则、compaction 语义中，anat:0.3-5）。
  - 候选 C（单层 IR 无编译：只存 IR、渲染时模板直出不分模型）：比 B 好但未兑现"Behavior 一致、Prompt 不必一致"（§7 核心承诺）。

- **决策**：**A（显式 Behavior IR + 编译管线）**：Behavior IR（唯一行为事实源）→ Model Profile（按模型差异展开措辞）→ Harness Profile（本 harness 能力面/纪律）→ Prompt Compiler（产出最终分层 prompt 段，接决策点 5 的组装）。每条 IR 条目带 channel（prompt_guidance | runtime_policy，软引导/硬执法双通道，与决策点 8 对齐）与 conformance 字段（供 H12/Conformance Suite 断言，决策点 16）。UNTRUSTED 语料只走任务书 §18 管道：Raw Prompt → Parser → Behavior Extraction → Candidate Behavior → Review → Behavior IR（防 prompt injection 一起"融合"进项目）。

- **理由**：任务书 §6（"不保存'某家 Prompt 写了什么'，而保存'这个 Agent 应该怎么行为'"）/§7（三阶段：Behavior IR → Model Profile → Harness Profile → Prompt Compiler）/§18（CL4R1T4S 使用规范）是项目第一核心创新，D3 必须在架构层面把它定为管线而非实现细节。anat:0.3-5 给出实证："没有哪家把行为做成显式 IR…CL4R1T4S 证明 prompt 侧行为高度可归纳（跨产品一致性极高）——这正是 Behavior IR 成立的前提"。cmp:H02 Decision 的分层注入与"一份模板"（决策点 13）依赖此管线才能兑现多模型差异。

- **拒绝**：不采用候选 0/候选 B（禁止事项：不直接拼接、§18 禁止 UNTRUSTED 原文直进 system prompt、不把 prompt 当 Agent 全部能力——禁止事项 4）；不采用候选 C 的单层无编译形态（丢失去"Prompt 不必一致"的兑现）。另拒绝"只维护各家原始 prompt 常量于代码"（Pi/OpenCode 类：模板即代码、行为不可验证，与决策点 16 的 conformance 诉求冲突）。

- **影响**：D4 BEHAVIOR-IR-SPEC 是本决策的直接落点（12 类 49 条采纳集、双通道、来源标记、conformance 字段）；D6 的 policy_ref 落点（channel=runtime_policy 条目编译去 policy 声明而非只 render）；D7 的 conformance 字段消费与 A/B 组设计（Pi vs Pi+IR vs Pi+IR+Evaluator vs Pi+IR+Evaluator+Policy——§17 五组正是本管线的实验证明）；D8 behavior/{ir,compiler,resolver} 目录契约。

---

## 决策点 15：TypeScript vs Rust 边界

- **问题**：主语言与运行时怎么定——全 TS、全 Rust、还是 TS Brain + Rust Runtime 的异构？执行隔离（沙箱/进程/文件系统）在哪一层实现、语言如何选择？

- **候选方案**：
  - 候选 A（全 TypeScript，Node.js/Bun）：Brain 与 Runtime 同语言，单一工具链（Vitest 测试）、快速迭代、任务书默认栈。优点：开发速度与生态（§20 推荐技术栈全 TS 可行）；缺点：进程监督/文件系统隔离/沙箱的 OS 原语操控不如系统语言直接（§20 明示的触发条件）。
  - 候选 B（全 Rust）：Claw/Codex 型工程深度（零成本抽象、tokio、强类型沙箱）。优点：沙箱/进程/文件系统工程最深；缺点：开发周期长、与任务书"而不是从第一天就把所有东西 Rust 化"冲突、无法快速做行为实验（§20）。
  - 候选 C（TS Brain + 可选 Rust Runtime，任务书推荐）：TS 承担 Agent Brain/Orchestration（loop、Behavior 编译、策略、编排），执行层（sandbox、process supervision、filesystem isolation）先以 TS + 外部 OS 原语实现；发现"TypeScript 不够强"再独立 Rust Runtime，经语言中立 seam 替换。优点：先快后强、隔离关注点、符合任务书第二十节原话；缺点：需预先定义 seam 否则升级要重构。

- **决策**：**C（TS 先行 + 语言中立执行 seam）**。v0.1 全 TS（Brain/Orchestration/工具流水线/事件/策略裁决/编译器），数据 SQLite、配置 JSON/YAML、技能 Markdown+YAML frontmatter、通信 JSON-RPC/MCP、测试 Vitest、CLI 自建轻量（任务书 §20 原样）。**执行隔离不依赖宿主语言**：沙箱 confine seam（决策点 9）调 OS 级后端（Linux bwrap 子进程、macOS seatbelt、Windows ACL 受限令牌 runner），进程 spawn 走受控派生点（runtime/process），执行边界全部以"外部 OS 原语 + 子进程 + 显式能力探测"实现——这些边界可被 Rust Runtime 替换而不改 Brain（决策点 9 的 confine 抽象 + 工具 Operations 注入点即 seam）。当 benchmark（决策点 16）与安全审计证明 TS 执行层是瓶颈/风险面时，将 runtime/（sandbox、process、executor 的可替换部分）独立为 Rust crate。

- **理由**：任务书 §20（行 1180–1233）原话："如果后期发现 Sandbox/Process supervision/Filesystem isolation TypeScript 不够强，再将 Runtime 独立成 Rust…而不是从第一天就把所有东西 Rust 化"——这是技术栈的硬约束。§20 还给出完整默认栈（Node/Bun + SQLite + Vitest + JSON-RPC/MCP + Commander/自建 CLI），D3 不偏离。Claw（Rust parity 全量重写）与 Codex（Rust 全栈）的开发周期教训 + DSH/OpenCode/Hermes 证明 TS/Python 能支撑完整产品级 harness（anat:0.2-4/6/7），支持"先 TS 验证机制"路线；决策点 9 已把沙箱做成语言中立的 confine seam，天然支撑未来 Rust Runtime。

- **拒绝**：不采用候选 B（全 Rust 起步：违背任务书推荐与快速行为实验目标）；不采用候选 A 的"拒绝将来升级"变体（不留 seam，TS 执行层被证明不够强时无路可走）；不采用异构"第一天即 TS+Rust 双栈"（双工具链成本，Rust 侧无实际负载）。

- **影响**：D8 runtime/ 边界（executor/sandbox/process 以语言中立 seam 描述，Brain 不直接 import OS 原语）；D7 runner 用 TypeScript（BENCHMARK-SPEC §7.1 已定 runner 抽象 TypeScript）；D5 事件序列化契约（JSON Lines）跨语言稳定；Provider 层经 JSON-RPC/MCP（§20）不受宿主语言限制；D6 policy 编译与 hook 外部进程协议（command hooks JSON stdin/stdout）即未来跨语言边界（cmp:H06 Proposed Spec exit_code_semantics）。

---

## 决策点 16：Benchmark / Conformance 先行

- **问题**：测试与验证什么时候建——先实现后补测、第一天并行建、还是只写内部单测不建跨 harness 场景？如何回答"提升来自 Prompt 还是 Harness"？

- **候选方案**：
  - 候选 A（实现先行、补测试）：主流默认节奏。缺点：无法回答任务书 §17 的问题（无基线对照）；验收门槛 §22 明确 benchmark 先行（Benchmark Scenario ≥15 是解禁条件之一）；OpenCode 教训=无独立 eval 框架、外包外部测试流程（cmp:H12 OpenCode 行，判断为空缺）。
  - 候选 B（Benchmark/Conformance 与设计同步、第一天建立）：任务书 §15"Parity / Benchmark 是强制项，必须从第一天建立测试"+ §16 统一指标 + §17 A/B Test；Claw mock-parity harness 方法论（12+ 确定性场景、scenario→PARITY 引用自动核对、把"行为→代码→测试"写成可执行场景而非抄源码，cmp:H12 Claw 行）。优点：机制正确性从第一天被机器证明、A/B 归因可行；缺点：前期投入高。
  - 候选 C（只写内部单测、不建跨 harness 场景）：省事。缺点：无法证明"真的比某些原生 Harness 更稳定"（项目最终定位行 1425–1431 的 Conformance Suite 是定位承诺）；单测只能证内聚不能证行为对齐。

- **决策**：**B（Benchmark/Conformance 第一天建立）**：仓库按任务书 §15 建 `benchmarks/{fixtures,scenarios,runners,reports}/`；首批 Scenario ≥15（B001–B019，任务书 B001–B015 + 新增 B016–B019 到 ≥15，BENCHMARK-SPEC 已定）；统一指标 14 项（含 Autonomy=人工干预次数）；A/B Test A–E 五组（§17 原样：Native Pi → +Claude behavior → +Unified IR → +Evaluator → +Policy）；Cross-Harness Conformance Suite 跑同一场景多 harness（Claude/Claw/Pi/OpenCode/Codex/DSH/Our Harness）；v0.1 runner 先实现 mock/pi 两 adapter（确定性 mock 端到端回归，无网络无真实模型，Claw 方法论）；Behavior IR conformance 字段（决策点 14）作为行为断言来源；Harness 实现每完成一个机制即挂对应场景（开发期即可跑 B001–B015 的相关子集）。

- **理由**：任务书 §15（"必须从第一天建立测试"）、§16（"不要只比较任务成功没有"——指标含 Safety Violations/Evaluator Reject Count/Compactions）、§17（A/B 才能回答"提升到底来自 Prompt 还是 Harness"）、§22 验收门槛（Benchmark Scenario ≥15 为解禁条件）+ 最终定位（"以 Cross-Harness Conformance Suite 证明设计真的比原生 Harness 更稳定"，行 1425–1431）。cmp:H12 Decision 末句："Benchmark 场景集独立于运行时（…v0.1 建 evals/ 仓库化 runner）"；Claw 的 mock-parity 是唯一给出"把行为对齐写成可执行场景"的方法论样本（anat:0.2-2），且它是确定性 mock——无真实模型即可回归，符合开发期约束。

- **拒绝**：不采用候选 A（先实现后补测：违反 §15"从第一天"与 §22 解禁门槛；且无法做 §17 归因）；不采用候选 C（单测不证行为对齐，与 Conformance Suite 定位冲突）；不采用"benchmark 只在收尾阶段跑一轮"（§17 的 A/B 需要持续归因，BENCHMARK-SPEC §5 分段归因要求单变量隔离）。

- **影响**：D7 BENCHMARK-SPEC 是本决策的直接落点（19 场景、14 指标、A/B 五组、runner 抽象、Adapter 清单）；D4 的 conformance 字段被 D7 消费（行为断言来源）；H12 invariants 机械自检与 benchmark 回放共用会话日志（决策点 10）；D8 evals/ 接线与 headless 运行面（无 UI 可跑）；实现排期上每个 V0.1–V0.5 里程碑带对应场景集（§10–§14 路线 × B001–B019）。

---

## 附录：决策点 → 下游规范消费映射

| 决策点 | D4 Behavior IR | D5 Event | D6 Policy | D7 Benchmark | D8 Architecture |
| --- | --- | --- | --- | --- | --- |
| 1 模块形态 | — | — | — | headless 运行面 | §9 目录树 |
| 2 Core/Loop | E01/E02 loop 类 | turn/step 事件 | 预算扩展 | B008 多工具 | core/agent-loop |
| 3 事件形态 | conformance 查日志 | 48 事件总表 | 审计对 | 轨迹指标 | core/events |
| 4 扩展机制 | preset 形态 | 能力事件 | hooks 桥 | — | seam 目录 |
| 5 Context | render 分层 | inject 事件 | 指令预算 | — | context/ 三子模块 |
| 6 Compaction | 保留清单 | compaction/start|end | — | B010 | context/compaction |
| 7 Tool | tool_use 类 | tool 事件面 | required_permission | B005–B008 | tools/ |
| 8 Policy | safety channel | PolicyDecision 对 | D6 本体 | Safety Violations | policy/ |
| 9 Sandbox | git/safety 硬通道 | sandbox 会话事件 | sandbox 域 | — | runtime/sandbox |
| 10 Session | memory 类 | 持久记录 21 类 | — | B011 Resume | core/session |
| 11 Skills | volatile render | skills/change | 不豁免 | — | skills/ |
| 12 Subagent/Eval | delegation/verification/evaluator 类 | subagent 事件 | 权限单向收窄 | B013/B014、A/B | agents/ |
| 13 多模型 | Model Profile | — | — | runner 模型配置 | llm/ |
| 14 Prompt 管线 | D4 本体 | — | policy_ref | conformance 消费 | behavior/ |
| 15 TS/Rust | — | JSONL 契约 | command hooks | TS runner | runtime/ seam |
| 16 Benchmark | conformance 字段 | — | Safety 口径 | D7 本体 | evals/ |

（完）
