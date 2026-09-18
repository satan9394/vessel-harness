# 最终新 Harness 架构 v0.1（D8 / ARCHITECTURE.md）

- **交付物**：D8 — 最终新 Harness 架构（任务书第二十一节）
- **版本**：v0.1（草案）
- **日期**：2026-09-05
- **状态**：供 Review；**模块边界确定**（任务书第二十二节验收门槛最后一条）；V0.1 模块化单体结构、核心数据流、模块清单与依赖方向、V0.1 明确不做清单、技术栈落点、V0.1→V0.5 演进、与 Conformance Suite 的验证闭环
- **上游依据**：任务书.md §2（核心原则 1–4）/ §7（Behavior Compiler 四层管线）/ §8（Policy Runtime 执行链）/ §9（建议项目结构，行 719–779，模块化单体）/ §10–§14（V0.1–V0.5 范围与路线）/ §15（Benchmarks 目录）/ §20（技术栈建议）/ §22（验收门槛，含"新 Harness V0.1 的模块边界确定"）/ 最终定位（行 1409–1431，Composable Agent Harness + Cross-Harness Conformance Suite）
- **规范下游**：docs/DESIGN-DECISIONS.md（D3，本文件的"为什么"来源，16 决策点）、docs/BEHAVIOR-IR-SPEC.md（D4）、docs/EVENT-SPEC.md（D5）、docs/POLICY-SPEC.md（D6）、docs/BENCHMARK-SPEC.md（D7）
- **下游消费方**：第三阶段实现（任务书 §9 目录落码）、docs/BENCHMARK-SPEC.md §7.1 runner 的 `ours` adapter 契约 stub、Review

> 一句话定位：**D3 回答"整个系统为什么长这样"（16 决策点），本文件回答"是什么/模块边界在哪"——按任务书 §9 目录树把 V0.1 的模块化单体逐模块落定职责、对外接口与依赖方向，使核心数据流（事件驱动 + Policy 裁决 + Compaction 事务 + Evaluator 门禁）可沿 D5 事件词汇走通；每个模块标记 V0.1 纳入或 V0.2+ 延后，并在最后给出被 BENCHMARK-SPEC 的 Conformance Suite 验证的闭环。本文件不引入新机制，只落已定规范的边界。**

---

## 0. 摘要

Composable Agent Harness V0.1 = **模块化单体**（任务书 §9 目录树，单进程进程内组合），单一权威的薄 Agent Loop 内核，外加三件核心资产与一套验证面：

```text
Composable Agent Harness V0.1
  = 模块化单体（core/ llm/ behavior/ context/ tools/ policy/ runtime/ memory/ skills/ agents/ telemetry/）
  + Agent Behavior IR（D4）→ Behavior Compiler（D3 决策点 14 管线）→ Model Profile → Harness Profile → Prompt Compiler
  + Policy Runtime（D6：一份 Policy 声明编译出 Prompt Guidance / Tool Interceptor / Runtime Deny / Audit Event 四件套）
  + 事件溯源会话（D5：append-only 事件日志为唯一真源 + surface 投影派生模型历史）
  + Cross-Harness Conformance Suite（D7：benchmarks/ + A/B 归因 + C7 统一测试集）
```

模块形态一句话：**core/ 薄，其余机制模块化挂在类型化事件扩展点（waterfall 决策点）上，禁止反向依赖 core/ 之内的循环**（任务书 §2 原则 2、禁止事项 9；D3 决策点 1/2）。Core 之外的可替换单元（Provider、工具、指令源、hooks 桥、沙箱后端、未来的 Subagent/Evaluator preset）都是**提供方（provider seam）**，不是插件树（D3 决策点 4 明确不要整体插件树）。

V0.1 功能平面（任务书 §10）与模块纳入对应：CLI / Model Provider（Anthropic、OpenAI、OpenAI Compatible）/ 6 工具（Read/Write/Edit/Glob/Grep/Shell）/ Core Agent Loop / Session / Context Builder / Basic Compaction / Event Bus / BeforeTool/AfterTool / Policy Engine / Evaluator / Tests·Lint Verification。Memory（session 目录持久化基础）与 Skills（目录索引）只做 v0.1 最小骨架，完整记忆/技能生命周期属 v0.3+。

---

## 1. 架构总览：V0.1 模块化单体

### 1.1 结构图（文本）

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ apps/cli（进程入口，自建轻量 CLI；headless `run --bench` seam 供 D7 runner）  │
│     │ 解析命令/flag → 建 Session → 驱动 loop；无 UI 逻辑（任务书 §10 只做 CLI）│
└────┬─────────────────────────────────────────────────────────────────────────┘
     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ core/ —— 薄内核（唯一权威 loop + 事件真源；不得 import memory/skills/sandbox） │
│   agent-loop  state        session        events                              │
│   ① 开轮次→领输入→step→停  state 快照      append-only 事件日志    emit/       │
│   （无工具调用即停/纯文本    （账目/预算/    （JSONL v1 唯一真源，   waterfall/  │
│   即停 + max_steps=64）      状态）         session/created、       serial/     │
│   ② 崩溃恢复=resume 重放                  turn/start|end、        parallel/   │
│   ③ 每次模型可见变更落盘                    step、tool、approval、   bail 原语  │
│     （model_visible_iff_recorded）          audit、compaction…）    类型化事件  │
└────┬──────────────────────────┬──────────────────────────┬───────────────────┘
     │                          │                          │
     ▼                          ▼                          ▼
 llm/                      context/                    policy/
  provider  router  profiles  builder compaction  instructions   engine  hooks  risk
  三类 Provider           事件投影派生历史 +      Policy 声明唯一事实源
  (Anthropic/OpenAI/      stable/context/volatile  → 四件套编译（Policy Compiler）
  Compatible) 统一       三层组装 + 按需注入        引擎=BeforeTool 链权威监听器
  tool-use 协议           compaction 事务化替换     三态裁决 + guard 单调 + fail-closed
  Model Profile 装载      （触发/锁/摘要/replace）   hooks.json 兼容桥（policy/hooks）
        │                          ▲                          │
        ▼                          │（可见工具 schema）          ▼
 behavior/                   tools/                    runtime/
  ir  compiler  resolver      registry  filesystem  shell  mcp   executor  sandbox  process
  IR(唯一行为事实源)          最小内建集(6)              执行容器：
  编译管线 L0→L4             schema DSL + 校验          语言中立 confine seam
  Resolver deep-merge        exclusive 屏障+滚动池       平台后端链(win: Job Object
  conformance 字段产出        流水线(pre-execute/          071/072；非 win: passthrough)
                              post-execute)               fail-closed
        │                          ▲                          │
        └──────────┬───────────────┴───────────┬──────────────┘
                   ▼（指令基线/技能目录索引注入）  ▼（审计对/裁决证据）
             memory/（v0.1 最小骨架）      telemetry/（消费方，emit 旁路）
              session(session 目录绑定)     session/created、request/header、
              project/persistent → v0.3     turn/end、audit/* 的汇总/指标
                   │
                   ▼
             agents/（v0.1 无委派）
              subagent → V0.2     evaluator → preset+独立模型（v0.1 定义契约）
                   │
                   ▼
             skills/（v0.1 最小骨架：frontmatter 解析 + 目录索引；正文注入 V0.3）
```

### 1.2 分层职责

V0.1 分四层，职责一句话 + 边界铁律（引用任务书原则编号）：

| 层 | 模块 | 职责 | 边界约束（依据） |
|---|---|---|---|
| **内核层** | core/ | 唯一权威 Agent Loop + 事件真源 + Session 生命周期 | Core 只做 Model Call → Tool Call → Tool Result → State Update → Continue/Stop（任务书 §2 原则 2 原文）；**不 import memory/skills/sandbox/subagent**（D3 决策点 2）；事件词汇可序列化（JSON 行），预留切 server 的 seam（D3 决策点 1：v0.1 不实现 server） |
| **机制层** | llm/ behavior/ context/ tools/ policy/ runtime/ | 模型接入、行为编译、上下文组装/压缩、工具执行、软/硬策略执法、执行隔离 | 机制模块只依赖 core/ 提供的接口（事件 + session 句柄），**不反向依赖 core 的实现**；机制之间经事件协作，不互相 import 实现细节 |
| **扩展层** | agents/ skills/ telemetry/（+ memory/） | preset 化运行单元、知识单元、遥测消费方、会话记忆骨架 | agents/ 子代理/evaluator = 同构会话 + preset（D3 决策点 12，Evaluator 不是新原语）；skills/ 发现根+目录索引（D3 决策点 11）；telemetry/ 只 emit 旁路 |
| **入口/消费面** | apps/cli（+ 未来 apps/web，明确不做）+ benchmarks/runners | headless 驱动 + 验证 | D7 runner 以 `run --bench` seam 驱动；v0.1 无 Web UI（任务书 §10） |

### 1.3 与任务书第九节建议结构的对应/调整

| 任务书 §9 建议目录 | 本架构 V0.1 | 对应/调整说明 |
|---|---|---|
| core/{agent-loop, state, session, events} | ✓ 保留 | core/agent-loop 薄核；core/events 提供 emit/waterfall/serial/parallel/bail 原语（D5 §3.1 TS 接口原文）；core/session 目录绑定 workspace-slug、事件头信息存日志旁 |
| llm/{provider, router, profiles} | ✓ 保留 | provider 统一 tool-use 协议差异；router 模型/fallback 链；profiles 装载 Model Profile（D3 决策点 13） |
| behavior/{ir, compiler, resolver} | ✓ 保留 | IR = 声明文件 + 校验；compiler = L2/L3 渲染 + 双通道强制 + conformance 产物；resolver = L1 deep-merge（D3 决策点 14；D4 §7.1） |
| context/{builder, compaction, instructions} | ✓ 保留 | builder 三层组装；compaction 事务化区域替换；instructions 指令发现/装载 |
| tools/{registry, filesystem, shell, mcp} | ✓ 保留 | registry 作用域化；filesystem=Read/Write/Edit 实现 + file_guards；shell=Bash 执行 + 只读识别；mcp=v0.2 装载（目录先立，仅预置命名规则 `mcp__<server>__<tool>`） |
| policy/{engine, hooks, risk} | ✓ 保留 | engine=BeforeTool 权威监听器 + 裁决序；hooks=外部 hooks.json 兼容桥 + 工具拦截器；risk=危险集合/guard 单调/never_auto 服务内强制 |
| runtime/{executor, sandbox, process} | ✓ 保留 | executor=工具执行容器；sandbox=语言中立 confine seam（**Windows 已交付 Job Object + process-tree（071/072，`docs/SANDBOX-WINDOWS.md`）**；受限令牌/低完整性未做；非 Windows passthrough。fail-closed）；process=受控派生点 |
| memory/{session, project, persistent} | △ v0.1 只做最小骨架 | memory/session 目录绑定（memory/ 骨架属 v0.1 以承载会话目录；project/persistent 记忆 V0.3）——调整理由：任务书 §10 V0.1 范围未列记忆，仅 session 目录为 session 管理所必需 |
| skills/ | △ v0.1 只做最小骨架 | SKILL.md frontmatter 解析 + 目录索引（不注入正文）；完整技能/作用域/搜索 V0.3 |
| agents/{subagent, evaluator} | △ v0.1 定义契约 | agents/evaluator = preset + 独立模型（v0.1 用独立 LLM 调用形态，见 §2.4）；agents/subagent V0.2 |
| telemetry/ | ✓ 保留 | 消费方（emit 旁路）：会话生命周期/用量/审计汇总；指标事件源对齐 D7 §4.1 |
| （任务书无） | + apps/ + benchmarks/ | 入口与验证为消费面，不属机制层：apps/cli 进程入口；benchmarks/{fixtures, scenarios, runners, reports} 按 D7 §2 契约 |

**调整三条纪律**（都在已定规范内，不引入新事实）：
1. **不新增 plugins/ 目录**：扩展=类型化事件扩展点 + hooks.json 兼容桥 + Provider/MCP seam（D3 决策点 4 直接落点）；技能/委派能力挂在 skills/、agents/ 的 seam 上。
2. **core/ 反向依赖为零**：D3 决策点 1/2 的硬约束——core/ 只定义接口与事件词汇，机制层实现注入。
3. **模块化单体的要点不是"文件多"，是包边界质量**（D3 决策点 1 引 Claw 反面案例）：core/ 之外的机制不反向依赖 core，机制之间不互相 import 实现。

---

## 2. 核心数据流：一轮 turn 从用户输入到停止

> 本节事件名、flow、持久记录一律引用 D5 EVENT-SPEC 真实术语（A## 扩展事件 / B## 持久记录）；Policy 裁决引用 D6；载荷细节以两份 spec 为准，本节只画路径。

### 2.1 一次用户输入到停止的完整路径

```text
CLI 收输入（apps/cli）
  │
  ▼
【A03 BeforeTurn】waterfall ── 裁决点（D5 §5.B）：admission/steering/plan 标记
  │   放行 → 落 turn/start (B08) + 批次落 user/message (B01, surface:true)
  ▼
step 循环（core/agent-loop，每 step = 一次模型请求 + 其工具调用）
  │
  ├─【A07 BeforeModel】waterfall ── context/builder 在此组装（§2.2）
  │     组装：Behavior Compiler 产物（stable 层）+ 指令基线 + 技能目录索引（volatile）
  │            + 事件投影派生历史 + 可见工具 schema（Policy 裁剪后）
  │     压力检查位：estimatedTokens ≥ 0.8×contextWindow → 触发压缩流程（§2.3）
  ├─【A08 ModelRequest】→ 落 request/header (B12)（冻结 envelope，可重建）
  ├─【A09 ModelStream】start/delta*/end（emit；监听器永不 inline 跑 token 路径）
  │
  ├─【A10 AfterModel】waterfall ── 校验/脱敏；产出 toolCalls 或纯文本
  │     ├─ 纯文本 → 落 assistant/message (B02) → step/end (B07) → BeforeStop
  │     └─ toolCalls → 落 assistant/attempt (B03) → 逐调用分发
  │
  │  每个 tool call：
  │    落 tool/call (B04)
  │    【A12 BeforeTool】waterfall ── Policy 裁决点（§2.2；D6 §4 执行链落地）
  │       ├─ allow → PolicyDecision allow (A13) → audit/decision (B19)
  │       ├─ deny  → PolicyDecision deny (A13) → audit/denial (B20)
  │       │          → 拒绝文本回灌模型（模型改写；同意图 deny≥3 终结路径）
  │       └─ ask   → ApprovalRequest (A16) → approval/asked (B17)
  │                   → 应答（CLI 人类/ACP 机器；V0.1 ApprovalPolicy 默认 never）
  │                   → ApprovalDecided (A17) → approval/decided (B18)
  │                   → allowed-once/session 放行；其余 fail-closed 拒绝
  │     【写文件】BeforeWrite (A18) → fs 守卫（canonical/受保护路径 deny）→ 执行 → AfterWrite (A19)
  │     【命令】  BeforeShell (A20) → sandbox confine（runtime/sandbox）→ 执行 → AfterShell (A21)
  │     执行后 →【A14 AfterTool】waterfall（拒绝的是结果不是执行）
  │             → 落 tool/result (B05, 冻结权威结果, surface:true)
  │     失败 →【A15 ToolError】serial（分类/doom-loop 计数/升级登记）
  │     模型失败 →【A11 ModelError】waterfall（退避重试 ≤5 / fallback / CONTEXT_WINDOW_EXCEEDED→压缩）
  │     step/end (B07) → 仍欠工作 → 下一步
  │
  ├─【A04 BeforeStop】serial ── 停/续裁决点（§2.2）
  │     forceContinue(reason)（预算执行器/evaluator/doom-loop 守卫任一触发）→ 强制再执行一步
  │     否则 → 落 turn/end (B09, kind=success)
  │     {Esc/信号} →【A05 Interrupt】→ 在飞工具取消/流打断 → turn/end kind=interrupted
  │     {预算耗尽} → turn/end kind=budget
  ▼
【A06 AfterTurn】emit ── Evaluator 门禁位置（§2.4）与轮末压缩检查
      evaluator 判定 met/not_met → 下一轮 continue 或停止
```

不变式（贯穿全图，D5 §8）：`turn/start→turn/end`、`step/start→step/end`、`tool/call→tool/result`、`approval/asked→decided`、`compaction/start→…→end` 全部配对且编号连续；**该不变式只在"成功收尾"的回合上成立**（即收尾路径非异常抛出地走到落盘）——异常路径是已登记的反例，它有**两条同闸门的来源**（`packages/core/src/agent-loop/AgentLoop.ts:636` 的 `retryable = attempt <= maxRetries && MODEL_RETRYABLE.has(cls)`）：① 错误类别不可重试（`:70` 的 `MODEL_RETRYABLE` 之外）**或**② **错误类别可重试但重试预算耗尽**（`attempt > maxRetries`）；两者都走 `:649-651` 的 `throw` ⇒ `:451-464` 的 `else { throw err; }`（`:462-463`）⇒ `:528` 的 `turn/end` 永不写入，而 `:208-212` 的 `before_turn` 已经发出 ⇒ 该回合有始无终（② 在本仓既有测试里已被真实触发：`AgentLoop.llm-retry-record.test.ts:280-295`、`AgentLoop.stream.test.ts:385-392`，`rate limit 429` = `RATE_LIMITED` 可重试 + `maxRetries:1`）。（`Session.loadExisting` 的 `openTurns()` 只在 resume 时**事后合成**一条 `turn/end{kind:'interrupted'}` 关闭器，不是当场落盘）；同族的另两条已登记例外是配对方向不对称（`before_turn` 否决分支在 `:265-282` 先写 `turn/end` 再早返回，`turn/start` 永不落盘）与步内中断缺 `step/end`。三者的定级与位置见 `docs/product-evolution/PRODUCT-GAP-MAP.md:430`（异常路径不落 `turn/end`）/:431（单向配对）/:446（步内中断缺 `step/end`）。**除已登记例外，任一配对缺失或编号断裂才 = 日志腐败**（agents/ 的 invariant 自检捕获，D5 §6）。**waterfall 改的是"将要发生"，持久记录存的是"已经发生"**（D5 附录 B 规律）。

### 2.2 关键裁决/组装点汇总

| 位置 | 扩展事件 | flow | 归属模块 | 作用 |
|---|---|---|---|---|
| 每轮入口 | A03 BeforeTurn | waterfall | core/agent-loop（驱动）+ 各监听器 | 拦截整批输入 / 注入 steering / 会话模式标记 |
| 每次采样前 | A07 BeforeModel | waterfall | context/builder + behavior/compiler + tools/registry | 组装上下文 + 可见工具 schema + 压缩压力检查位 |
| 每次采样后 | A10 AfterModel | waterfall | llm/ + core/agent-loop | veto 毒化输出 / 修 arguments / 拆分 toolCalls |
| 每个 tool call | A12 BeforeTool | waterfall | **policy/engine（权威裁决监听器）** + tools/registry | deny→ask→allow→profile 裁决序 + guard 单调收窄 |
| 写文件前 | A18 BeforeWrite | waterfall | policy/（受保护路径）→ tools/filesystem | 文件边界守卫（canonical、写保护不可豁免） |
| 命令前 | A20 BeforeShell | waterfall | policy/engine + runtime/sandbox | 命令闸口 + confine 派生 |
| 每轮收尾 | A04 BeforeStop | serial | core/agent-loop + 预算执行器 + agents/evaluator | forceContinue 或同意停；语义层停/机械层停共同裁决点 |
| 每轮后 | A06 AfterTurn | emit | agents/evaluator（门禁）+ context/compaction | evaluator 判定 / 轮末压缩检查 / checkpoint |

### 2.3 Policy 裁决点（引用 D6 术语）

- **挂载点**：Policy Engine **不在事件面内，而是 BeforeTool 链上的权威监听器**（D5 §7.2 第 1 条；任务书 §8 执行链 `Agent → Tool Call → BeforeTool → Policy Engine → ALLOW/DENY → Runtime → Audit` 的落地映射见 D5 §7.1）。
- **裁决序**（D6 §4.2）：① denied_tools（裸工具名 deny，先于一切，工具同时移出上下文）→ ② deny 规则（不可被任何更细 allow 豁免）→ ③ hook override（只收窄不放宽）→ ④ ask 规则 → ⑤ allow 规则 → ⑥ profile 比较（required_permission × read-only/workspace-write/danger-full-access）。
- **guard 单调**：waterfall 全链后 ToolGuard 统一收窄（只严不松）；`never` 审批策略在分发前**服务内强制**（应答者也绕不过）；ask 无应答者 = unavailable = 拒绝（fail-closed 三落点，D6 §4.3）。
- **审计**：`PolicyDecision`(A13, emit) 目前**只在拒绝时**发出（`verdict` 恒 `'deny'`，allow 路径不发），拒绝落 `audit/denial`(B20)（D7 的 Safety Violations M12 口径来源；其中 `stage:'approval'` 的那些即 M14 的 `approval_asks`），而 `audit/decision`(B19) 与 approval 对 B17/B18 在本仓**未接线**（类型登记在 `packages/shared/src/events.ts`，零产零消由 `packages/shared/src/unwiredRecords.test.ts` 守卫）。
- **软/硬分离**：Policy 编译出的 Prompt Guidance 在 A07 BeforeModel 注入（软，不产生审计事实）；硬执法走 A12/A18/A20 + runtime/sandbox。Behavior IR `channel=runtime_policy` 条目经编译在 Harness Profile 产出 `policy_ref`，D6 侧缺执法规则即编译告警（D4 §7.2 双通道强制）。

### 2.4 Context 构建与 Compaction 位置

- **Context Builder**（context/builder + instructions）：
  - **组装时机**：每次 A07 BeforeModel（每 step 采样前组装），但**分层稳定层按"每会话一次"组装并缓存、跨轮复用**（保住 prefix cache，D3 决策点 5 的 C 纪律——anat:0.3-4c：prefix cache 是默认工程约束）；唯一重建触发 = 压缩 replace 后（AfterCompact 启动层重载）。
  - **组装顺序**：stable（身份/工具纪律/Behavior 编译稳定段）→ project（指令基线，宽泛→具体，以带 source 的 user message 注入）→ volatile（技能目录索引/环境/时间戳）。动态内容不进 system prompt。
  - **按需注入**：重内容（技能正文/MCP schema/子目录指令）绑定首次 touch 事件（成功 read/write/edit 后）经 `agent.inject()` 队列化 → 下一获准 pre-step 以带 source 的 user/message 进入（可回放、可压缩，D5 §6 B01 语义）。
- **Compaction**（context/compaction）：
  - **触发入口（三入口统一）**：A07 压力检查命中 `thresholdRatio:0.8×contextWindow`（pressure）；A11 ModelError `CONTEXT_WINDOW_EXCEEDED`（overflow，先压再试，overflowRetries≤1）；轮末/手动 post-turn。
  - **事务化**：A26 BeforeCompact（waterfall）→ 落 `compaction/start`(B14) 锁（先持久后执行）→ 摘要 LLM 旁路请求（requestKind=compaction-summary，复用上次请求热前缀）→ `compaction/summary`(B15) → surface replace（最旧平衡区域替换为 `<compacted-summary>` user/message，tool call/result 必须配对，尾部逐字保留 retainRatio 0.16）→ A27 AfterCompact（serial：启动层重载/关键文件重读 ≤5/skill 限量重注入/健康探针注册）→ `compaction/end`(B16) 恰好一次。
  - **不新建会话**：同一会话日志内原地替换（`not_new_session`；`session/end-seed` 边界不丢）。摘要内容指引（保留清单：用户请求与意图/检查修改过的文件/未完成任务/当前工作/关键代码片段）来自 D3 决策点 6。
- **Evaluator 门禁位置**：A06 AfterTurn（emit）——每轮后触发 evaluator（agents/evaluator preset：独立 LLM，只读 transcript+磁盘证据，verdict met/not_met/impossible/error，D3 决策点 12/H12）；not_met → 经 A04 BeforeStop 的 forceContinue 续做 ≤N 轮（max_verification_rounds E29）。**Evaluator 不是新原语**：独立会话 + 只读工具面 + 独立模型 profile 的 preset（agents/evaluator），复用 H11 机制。V0.1 用独立 LLM 调用形态（requestKind=goal-eval）落验证语义，Evaluator Agent 化装载属 V0.2。

---

## 3. Behavior IR 落地：IR 编译为各模型 Profile 的 Prompt

> 本节依据任务书 §7 四层管线与 D4 BEHAVIOR-IR-SPEC §7.1（L0–L4 层职责原文），落模块归属。

### 3.1 编译管线（四层职责）

```text
L0  Behavior IR（规范 YAML，49 条）                      → 归属 behavior/ir（数据 + 校验）
     行为主张 × N，类型/默认/来源/channel/render/conformance 齐全，与模型无关
        │  Resolver 合并：behavior.default.yaml
        │    + 覆盖源（agent preset / role preset / .harness/behavior.*.yaml）
        │    覆盖规则 default < project < preset < role < 显式 flag（deep-merge，fail loud）
        ▼
L1  生效行为快照（当前执行单元：session / subagent / evaluator）  → 归属 behavior/resolver
        │
        ▼
L2  Model Profile（每模型一层，措辞/强度差异；同一意图不可删）     → 归属 llm/profiles
        │   产出：system prompt 稳定层草稿段落 + 注入引导(user message 形态)
        ▼
L3  Harness Profile（每 harness/运行单元一层）                   → 归属 behavior/compiler
        │   产出：工具 schema 裁剪(E18)、调度参数(E02/E03/E07)、
        │         policy preset 引用(E33/E42→D6 policy_ref)、evaluator 判据(E30/E46/E47)
        ▼
L4  Prompt Compiler（组装）                                    → 归属 context/builder
     输入 L2 段落 + H03 注入层（指令文件/技能目录/环境）+ 会话事件投影
     按 stable → project 指令 → volatile 分层组装，产出最终请求（D5 A07/A08 落点）
     装配纪律：model_visible_iff_recorded —— 凡进请求的段落都可由会话日志重建
```

### 3.2 编译期行为与模块分工

| 阶段 | 动作 | 模块 | 关键纪律 |
|---|---|---|---|
| 解析+校验 | 读 YAML → 类型/枚举/必填/channel 合法性检查，未知 key 拒绝 | behavior/ir | 任何 IR 文件问题在加载点 fail loud，绝不静默跳过 |
| Resolver 合并 | deep-merge 生效快照；子代理 preset 只收窄不放宽 | behavior/resolver | 覆盖规则 + delegationDepth 随 fork 持久化 |
| 逐条翻译 | 编译器查 `behavior → renderer` 注册表；renderer 按 profile 输出文本段落或结构化配置 | behavior/compiler（调 llm/profiles） | 文本进 stable 还是注入层由 compiler 决定（可变量进注入层，缓存纪律） |
| 双通道强制 | channel 含 `runtime_policy` 的条目必须产出 D6 policy_ref；D6 缺执法规则 → 编译告警 | behavior/compiler ↔ policy/（D6 规则） | 防"只写 Prompt"（任务书禁止事项 5） |
| 产物校验 | 编译产物带 conformance 字段供 Evaluator/Conformance Suite 逐条断言 | behavior/compiler → agents/evaluator + benchmarks/ | 行为级验证 / mock-parity 场景 |

### 3.3 示例（D4 §7.3 原文语义）

条目 `verification.independent_evaluator (E28) = true`：
- **L2**：claude-profile 渲染为"以检查结果而非自我判断作为完成依据"；gpt-profile 渲染为"完成前必须提供外部检查证据"；deepseek-profile 渲染为"改动后先跑验证命令并读回输出"。**同一意图，措辞/强度不同**。
- **L3**：同时落为 evaluator 子代理装配（E49 只读模式）、completion_gate（E46）开启、conformance 检查项（完成声明前必须存在 verifier 输出事件）。
- **运行时**：A06 AfterTurn 挂 evaluator 门禁（§2.4）；generator 不默认自判完成（任务书禁止事项 6）。

**V0.1 编译范围**：单份 provider 中立模板 + 少量差异点（Anthropic/OpenAI/OpenAI-Compatible 三 Provider 用同一模板，Model Profile 覆盖差异——D4 §8）；完整多模型措辞库（Gemini/DeepSeek/Qwen profile 树）留 v0.2+。

---

## 4. 模块清单与边界

> 图例：✓ = V0.1 纳入；△ = V0.1 最小骨架（仅支撑 V0.1 平面所需）；✗ = 延后到 V0.2+（目录/契约先立或仅声明）。依赖方向铁律：**core/ 不依赖任何机制模块；机制模块只依赖 core/ 接口 + 本模块下层；无环**。

### 4.1 core/ —— 薄内核（✓）

| 子模块 | 职责 | 对外接口 | 依赖 |
|---|---|---|---|
| core/agent-loop | 唯一权威 loop：开持久轮次 → 原子领取 next-step 输入 → step（模型请求+工具调用）→ 状态更新 → Continue/Stop；终止判据"无未决 tool_call/纯文本即停"+ 机械硬顶 `max_steps_per_turn: 64`（预算本身是扩展，不内建） | `runTurn(inputs): TurnResult`；在 A03/A04/A06 等事件点驱动 | core/events、core/session、core/state、llm/ 接口 |
| core/state | step/turn 账目、预算状态、`contextSnapshot`（供 A03 载荷） | `getState()/update()` | core/events |
| core/session | 会话生命周期（created/resume/fork/clear/compact/subagent 六 source）；目录绑定 workspace-slug；事件头（sessionHeader）存日志旁不入事件；单写者租约 | `open()/resume()/fork()/close()` | core/events |
| core/events | EventBus 原语（emit/waterfall/serial/parallel/bail）+ 事件类型表（D5 §2.2：扩展事件 A01–A27 + 持久记录 B01–B21，共 48 具名事件）+ 事件卡声明 `@mode` 交叉校验 | `on/emit/waterfall/serial/parallel`（D5 §3.1 TS 接口原文） | 无（事件词汇即契约） |

**core/ 禁止 import**：memory/、skills/、runtime/sandbox、agents/（任务书原则 2；D3 决策点 2）。Core 之上所有可替换单元都以接口（provider seam）注入，loop 本体唯一且内建（D3 决策点 4：v0.1 不实现"替换 loop"的插件接口）。

### 4.2 llm/ —— 模型接入（✓）

| 子模块 | 职责 | 对外接口 | 依赖 |
|---|---|---|---|
| llm/provider | 三类 Provider（Anthropic / OpenAI / OpenAI-Compatible），统一 tool-use 协议差异（Anthropic tool_use vs OpenAI function calling） | `stream(request): AsyncIterable<Chunk>`（对齐 A08/A09 载荷） | core/events（只发事件，不落盘） |
| llm/router | 模型选择 + fallback chain + 重试参数（退避≤5） | `resolve(requestHints)` | llm/provider |
| llm/profiles | Model Profile 装载（L2 数据：每模型 render 措辞/强度） | `render(entry, profile)` | behavior/ir（读 IR 条目） |

Provider 差异全部下沉此层，不进事件面（D3 决策点 13 影响）。**✗**：多供应商模板并行不做；Gemini/DeepSeek/Qwen 完整 profile 树 v0.2。

### 4.3 behavior/ —— 行为层（✓，项目核心创新一）

| 子模块 | 职责 | 对外接口 | 依赖 |
|---|---|---|---|
| behavior/ir | IR 声明文件装载 + 校验（类型/enum/必填/channel/未知 key fail loud）；YAML 规范本体 | `load(path): BehaviorIR` | 无（纯数据+校验） |
| behavior/resolver | L1 merge：default < project < preset < role < flag，deep-merge，delegationDepth 随 fork 持久化 | `resolve(snapshot): EffectiveBehavior` | behavior/ir |
| behavior/compiler | L2/L3 渲染 + 双通道强制（policy_ref 缺失即告警）+ conformance 产物 | `compile(snapshot, profile) → {promptSections, harnessConfig}` | behavior/resolver、llm/profiles、policy/（policy_ref 检查） |

**✗**：技能使用类行为条目（随 skills V0.3）、学习/记忆固化类条目（V0.3/V0.4 suggest-only）、行为-质量归因超参实验（跑 A/B 时启用，D4 §8）。

### 4.4 context/ —— 上下文（✓）

| 子模块 | 职责 | 对外接口 | 依赖 |
|---|---|---|---|
| context/builder | L4 组装：stable→project→volatile 分层 + 事件投影派生历史 + 工具 schema 投影 + 每会话一次组装缓存（prefix cache） | `assemble(step): RequestEnvelope`（A07 载荷） | core/session、core/events、behavior/compiler 产物、tools/registry（可见 schema）、llm/profiles |
| context/compaction | 三入口触发 + 事务化替换（start 锁→summary→replace→end）+ spill 落盘 + 尾部逐字保留 + 热前缀摘要 + 健康探针 | `compact(trigger): CompactResult`（挂 A26/A27） | core/events、llm/（摘要旁路请求）、context/builder |
| context/instructions | 指令基线（AGENTS.md 链）发现/作用域解析/装载（宽泛→具体，user message 注入） | `discover(cwd) → Instruction[]` | core/session |

按需注入（技能正文/MCP schema 首次 touch 时经 `agent.inject()` 队列化）由 context/builder 统一实现。**✗**：复杂 RAG（明确不做，等价物 = grep/glob/read + SQLite FTS opt-in，D3 决策点 5 拒绝项）。

### 4.5 tools/ —— 工具（✓ 最小内建集 6；✗ MCP v0.2）

| 子模块 | 职责 | 对外接口 | 依赖 |
|---|---|---|---|
| tools/registry | 最小内建集（Read/Write/Edit/Glob/Grep/Shell）；schema DSL（纯 TS，推导类型+JSON Schema+校验）；作用域化（global→agent）；exclusive 屏障 + 滚动池（maxParallelToolCalls:10）——**已实现但未接线**：V0.1 工具调用由 AgentLoop 逐个 `await` 串行派发，`registry.execute` 的这条调度路径当前没有生产调用方（`ParallelScheduler` 仅测试使用），接线属后续功能决策；暴露面裁剪：装载 Policy 编译的 Tool Interceptor 清单（deny 工具移出可见集，D6 §2.3） | `execute(call) → Result`；`listVisible(scope)`；`spec(toolName)`（含 required_permission，供 policy 读取） | core/events、runtime/sandbox（经 executor 消费） |
| tools/filesystem | Read/Write/Edit 实现 + file_guards（canonical 化、受保护路径、10MiB 上限、NUL 检测）；写串行（V0.1 由 AgentLoop 逐个 `await` 派发天然成立；独占屏障未接线） | 经 registry | core/events（A18/A19） |
| tools/shell | Bash 执行 + 只读命令识别（字符串解析仅作只读识别不作主防线）；Operations 注入点（供 H08 沙箱后端复用） | 经 registry | core/events（A20/A21）、runtime/sandbox |
| tools/mcp | **✗ V0.2 装载**（目录先立）：MCP 客户端（stdio + streamable-http）；动态注册命名 `mcp__<server>__<tool>`；schema 首次调用加载 | —（V0.2） | — |

内建集规模纪律：任务书 §10 V0.1 六工具 + 禁止事项 8；D3 决策点 7"最小集 + MCP 唯一动态扩展通道"。（todo/ask_user_question/exit_plan_mode 等在 D3 决策点 7 内建集 ~11 里，但按任务书 §10 V0.1 CLI 平面与 §10.3"ask 交互后置"装载纪律，交互型工具 V0.1 禁用 —— AskUserQuestion 属 D6 示例 denied_tools；skill/subagent 工具随其子系统版本装载。）

### 4.6 policy/ —— 策略（✓，项目核心创新二）

| 子模块 | 职责 | 对外接口 | 依赖 |
|---|---|---|---|
| policy/engine | 权威裁决监听器（挂 A12）：裁决序 ①denied_tools→②deny→③hook override→④ask→⑤allow→⑥profile（profile 比较读取工具 spec 的 required_permission，未注册默认 danger 级）；guard 单调收窄；fail-closed；decisionPath 审计轨迹 | `onBeforeTool(call, toolSpec) → Verdict`（D6 §4.5 伪代码） | core/events、tools/registry（读 spec/required_permission）、policy/risk、policy/hooks |
| policy/hooks | 外部 hooks.json 兼容桥（Claude Code/Codex 方言 matcher；退出码 0/2/其余；hook 失败绝不崩轮次）+ 工具拦截器（pre-execute 复核） | `install(compatConfig)` | core/events |
| policy/risk | Policy 声明 YAML 解析 → Policy Compiler 编译四件套（Prompt Guidance/Tool Interceptor/Runtime Deny/Audit Event）；危险集合（destructive-delete/disk-format/partition-write，never_auto 服务内强制）；作用域合并 system>user>project>session + workspace trust 门（**实现状态（截至 Round 15）：实际只实现 system + project 两层，user/session 层与 trust 门尚未实现，此处为目标设计**） | `compile(policyYaml) → FourArtifacts` | 无（编译期纯函数） |

**网络策略边界（v0.1）**：内建工具没有网络工具；`network.deny_domains` 编译到 `PolicyArtifacts.declarationOnly`（`enforced: false`，无 `match`/`action`），与运行期 `rules` 分离。它不拦截域名，也不按 Shell 参数文本推断外联。实际执法为 profile/approval 门禁，例如 workspace-write 下 Shell 需要 danger-full-access，approval=never 时拒绝；域名级 proxy 执法待 v0.2，当前未实现。

**依赖方向关键约束**：policy/ 不反向依赖工具实现——拦截在事件链上完成（D3 决策点 8 影响末条：core 层"policy 不得反向依赖工具实现"）。**✗**：guardian/classifier 模型审查（黑盒不可本地审计，归 evaluator 层）；网络代理 MITM/凭据 mask+出站注入（v0.2）；容器/微 VM 沙箱后端（v0.2+）；MCP 动态工具细粒度策略（v0.2）。

### 4.7 runtime/ —— 执行（✓ seam；部分后端 ✗）

| 子模块 | 职责 | 对外接口 | 依赖 |
|---|---|---|---|
| runtime/executor | 工具执行容器：每个工具（含未来 MCP 动态注册、非模型通道调用）的 `execute()` 被包裹，先过 `tools/pre-execute`(waterfall)：Policy Engine 裁决 → guard 单调收窄（即便调用绕过模型通道也在执行期复核，工具层不信任"调用来自谁"，D6 §2.3）→ 执行 → post-execute → 冻结结果 | `runTool(call, ctx)` | tools/registry、policy/engine（pre-execute 裁决复核）、core/events |
| runtime/sandbox | 语言中立 confine seam：`confine(argv, policy)` 逐调用解析；**Windows 已交付 Job Object + process-tree（071/072）：命名 Job Object 包裹子进程、`TerminateJobObject` 连孙终止、活动进程数上限、`os.tmpdir()` 独立工作目录；`status()` 只在真附加成功时报 active**。**受限令牌/低完整性降权未做；Linux/macOS 为 passthrough**；fail-closed（SANDBOX_UNAVAILABLE）；enforcement full/partial 透明上报；能力探测 + fallback 状态回填 | `confine(argv, policy) → ConfinedArgv`；`status(): SandboxStatus` | 无（OS 原语；经 tools/shell 的 Operations 注入点被消费） |
| runtime/process | 受控派生点（进程 spawn 走此，不直接 OS spawn）；超时/取消令牌 | `spawn(cmd, opts)` | 无 |

TS Brain 先行 + 语言中立执行 seam（D3 决策点 15）：全 TS，执行隔离以"外部 OS 原语 + 子进程 + 显式能力探测"实现；benchmark/安全审计证明 TS 执行层是瓶颈/风险面时，将 runtime/ 独立为 Rust crate（Brain 不改）。**✗**：Windows Codex 全栈（WFP/私有桌面）不做。**已交付**：Windows = Job Object + process-tree（071/072）。**未做**：Windows 受限令牌 / 低完整性降权、非 Windows（bwrap/Seatbelt）沙箱。

### 4.8 memory/ —— 会话目录（△ 最小骨架；project/persistent ✗ V0.3）

| 子模块 | 职责 | 对外接口 | 依赖 |
|---|---|---|---|
| memory/session | 会话级目录骨架：目录绑定 workspace-slug（会话事件落库路径管理）；为 Session 管理提供最小支持 | `resolveSessionDir(sessionId)` | core/session |
| memory/project | **✗ V0.3**（Project Memory）：文件式记忆（MEMORY.md agent 笔记索引 + topic 文件；USER.md 用户画像；user/project/local 三级作用域；冻结快照注入；单一 memory 工具） | — | — |
| memory/persistent | **✗ V0.3/V0.4**（Persistent Memory；自动学习只 suggest、learned/ 专用区） | — | — |

**V0.1 不做**：任何长期记忆/学习机制（任务书 §10 不做清单"自动学习"；D3 决策点 10：长期记忆独立于会话层且不进 v0.1）。SQLite 后端留 Storage 可插拔接口（D3 决策点 10：SQLite 后端 v0.2，JSONL v1 先行）。

### 4.9 skills/ —— 技能（△ 最小骨架；完整 ✗ V0.3）

| 子模块 | 职责 | 对外接口 | 依赖 |
|---|---|---|---|
| skills/（发现根 + frontmatter 解析 + 目录索引） | SKILL.md = YAML frontmatter + markdown 正文；发现根按 system/user/project/session 四作用域映射 rank；启动只注入目录索引（name + 转义 description），正文不注入 | `listIndex(scope)`；`readContent(name, cwd)` | core/session（目录/作用域解析）；watcher 失效（skills 目录 digest 变化 → `agent.inject()` 替换索引，D3 决策点 11 声明的 `skills/change` 能力事件随 V0.3 技能平面装载，不进 D5 v0.1 事件表） |

**✗ V0.3**：正文经 `skill({name})` 工具按 cwd 重读注入（返回 `<skill_content>/<skill_resources>/<skill_instructions>`）、作用域冲突裁决、Skill Search、Skill Provenance；跨 harness 兼容目录（~/.claude/skills、~/.codex/skills）。**V0.4**：/learn（suggest-only）、curator（只归档不删除）、learned/ 专用区。技能正文是建议性知识，执行强制在权限/沙箱（技能执行不豁免权限，D3 决策点 11）。

### 4.10 agents/ —— 运行单元（△ 契约定义；subagent ✗ V0.2）

| 子模块 | 职责 | 对外接口 | 依赖 |
|---|---|---|---|
| agents/evaluator | 独立 LLM 验证：verdict met/not_met/impossible/error；只读 transcript+磁盘证据（E49 transcript_and_disk）；completion_gate 判据（E46/E47） | `evaluate(sessionEvidence) → Verdict`（requestKind=goal-eval） | llm/（独立小模型 profile）、core/session（只读重放）、behavior/compiler（conformance 判据） |
| agents/subagent | **✗ V0.2**：子代理 = 普通 Session 同构复用 + SubagentProvider seam；结果契约 {output, structured?, diagnostic?, stopReason}；fork 窗口 FullHistory/LastNTurns；delegationDepth 持久；只收窄父权限 | —（V0.2） | — |

**Evaluator 不是新原语**（D3 决策点 12）：evaluator = 独立会话 + 只读工具面 + 独立模型 profile 的 preset，零新增内核机制；V0.1 以独立 LLM 调用形态落验证语义（A06 AfterTurn 门禁 + 确定性层 tests/lint 经 shell 工具 + H12 invariant 机械自检），Evaluator Agent 化装载随 V0.2 subagent。agents/ 只收窄权限，子代理配置不能放大父能力。

### 4.11 telemetry/ —— 遥测（✓）

| 子模块 | 职责 | 对外接口 | 依赖 |
|---|---|---|---|
| telemetry/（会话生命周期/用量/审计汇总消费方） | 消费方（emit 旁路 + 回放折叠）：实时事件 before_turn / after_model / after_turn（仅 `kind='interrupted'`，M14 的 `interrupts` 分项） / after_tool / policy_decision / llm_retry / team_end（M13 evaluatorRejects 的**两条**产者之一：`team_end` 载荷里 evaluate 成员的 review.verdict；另一条不经总线——基准/CLI 的 evaluator 臂拿到 EvaluatorAgent 的返回值后直接调用 `recordEvaluatorReject()`，见 `docs/BENCHMARK-SPEC.md` §4.1 M13 行），以及会话记录 `tool/result`、`audit/denial`、`compaction/start`、`llm/retry`、`turn/end`（**仅**回合身份 → M02 与 `stats.toolCalls` → M03；与 `before_turn`/`after_tool` 事件是同一个回合的两面，按 `turnId` 去重 ⇒ **在成功收尾的回合上**恰好计一次、行与行之间不双计 —— 该等式**不是无条件的**，已登记**两条并列反例**（都走 `AgentLoop.ts:462-463` 的异常路径，故该回合根本不发 `turn/end` ⇒ 实时侧计到、纯回放侧计不到）：① 错误类别不可重试、② **重试预算耗尽**（`AgentLoop.ts:636` 的 `retryable` 为假的第二个来源，`attempt > maxRetries`；既有测试 `AgentLoop.llm-retry-record.test.ts:280-295` 已真实触发）；另加回合重叠时旧回合落盘读到新回合计数器；条件、反例与机制见 `Telemetry.ts` 类注释）、`user/message`（仅 `source='steer'`，M14 的 `steers` 分项；其余 source 是输入/inject/instruction/压缩摘要/plan/memory/handoff，都不是人工干预） → 指标/报告。未消费（记录已落盘、回放侧无消费方，故不得写成消费源）：`session/created`、`request/header`（只有 estimateTokens 估计值与条数，无实际用量）、以及 `turn/end.stats` 的其余加法字段（`stats.steps` 在"模型调用被中断"时比 after_model 条数多 ⇒ 实时与回放对不上；`stats.tokensUsed` 是每轮汇总，与 after_model 的每次调用量相加会双计、且拆不成 M06/M07；`stats.costEstimate` **没有任何 shipped provider 上报**（**不是**"全仓没有铸造点" —— 测试 provider 就上报它，`AgentLoop.log-evidence.test.ts:48/51`）⇒ 接了就是恒 0 的假指标；`toolCallsWithoutEnd` 没有指标定义。M14 的 `interrupts` 刻意**不**从这条记录取——`Session.loadExisting` 会为未闭合回合合成一条 `turn/end{kind:'interrupted'}`，按记录计会把崩溃恢复误报成人工打断，故取同事实的 `after_turn` 事件面） | `record(event)`；`exportReport()` | core/events（只订阅 emit，不参与裁决） |

**指标口径**：对齐 D7 §4.1（M01–M14 事件源：B04 tool/call、B13 llm/retry、A13/B19、B20 audit/denial、A16/A17 等）。**✗**：UI 形态（任务书 §10 不做 Web UI）；跨进程事件总线（禁止提前微服务化，D3 决策点 1 拒绝项）。

---

## 5. V0.1 明确不做清单

任务书 §10 原文（含 Web UI / IDE / Cloud / 20 Agent Team / 自动学习 / Marketplace / 复杂 RAG / 浏览器自动化），模块化落点：

| 不做项 | 任务书出处 | 模块落点（对应 V0.2+ 规划） | 为什么 V0.1 不做 |
|---|---|---|---|
| Web UI | §10 不做 | 入口层 apps/web（✗）；D3 决策点 1：v0.1 保留可切 server 的 seam（事件词汇可序列化）但不实现 server | 任务书路线先 CLI 后 UI；事件日志足以支撑未来多消费者 |
| IDE | §10 不做 | 生态消费面（✗） | 属产品形态非机制 |
| Cloud | §10 不做 | 网络/凭据代理层（✗ v0.2 起） | 依赖外部基础设施 |
| 20 Agent Team | §10 不做 | agents/subagent（✗ V0.2 起，默认并行 1–3） | V0.2 平面才有委派；任务书 §11"不追求 Agent 数量" |
| 自动学习 | §10 不做 | memory/persistent + skills 生命周期（✗ V0.3 suggest-only / V0.4 learned/） | 任务书 §12/§13 路线：只 suggest、用户 Skill ≠ Agent 自动修改区 |
| Marketplace | §10 不做 | skills/ 生态（✗ V0.2+，synced 来源能力降级原则先记录） | D3 决策点 11 拒绝项：无市场/安装/签名进 v0.1 |
| 复杂 RAG | §10 不做 | context/ 检索（✗ 明确不做，等价物=grep/glob/read + SQLite FTS opt-in） | 七家研究均无内建 RAG（D3 决策点 5 拒绝项） |
| 浏览器自动化 | §10 不做 | tools/（✗，无对应工具） | 超出 V0.1 六工具平面；D4 §8 不做项的 IR 化也排除 |

另有来自各 spec 的 V0.1 范围约束（非任务书清单，但同属克制边界）：ApprovalPolicy 默认 `never`（ask 交互随 UI 后置，D5 §10.3 第 4 条 / D6 §8.1）；hooks 只做 command + mcp_tool 形态、异步钩子+rewake 不做（D5 §10.3）；guardian/classifier 模型审查不进 v0.1 权限主链（D6 §8.2）；容器/微 VM 沙箱后端不做（v0.2+）；`--danger-full-access` 仅限容器/VM（D6）；多模型完整 profile 措辞库不做（v0.2）；subagent 工具不装载（V0.2）。

---

## 6. 技术栈落点

任务书 §20 技术栈原样落地（D3 决策点 15：v0.1 全 TS，执行隔离不依赖宿主语言）。

### 6.1 TypeScript 单仓 packages/* 布局

```text
composable-agent-harness/
├── apps/
│   └── cli/                  # 进程入口：自建轻量 CLI（任务书 §20：Commander/自建轻量 CLI 选自建）；
│                             #   headless `run --bench` seam 供 D7 runner（ours adapter 契约 stub）
├── packages/
│   ├── core/                 # agent-loop / state / session / events（§4.1）
│   ├── llm/                  # provider / router / profiles（§4.2）
│   ├── behavior/             # ir / resolver / compiler（§4.3）
│   ├── context/              # builder / compaction / instructions（§4.4）
│   ├── tools/                # registry / filesystem / shell / mcp(stub)（§4.5）
│   ├── policy/               # engine / hooks / risk（§4.6）
│   ├── runtime/              # executor / sandbox / process（§4.7）
│   ├── memory/               # session（§4.8）
│   ├── skills/               # 发现根 + frontmatter + 索引（§4.9）
│   ├── agents/               # evaluator（§4.10）
│   ├── telemetry/            #（§4.11）
│   ├── application/          # 组合根 + 共享应用层（compose / projections / credential /
│   │                         #   providers：供应商目录 + /v1 models 拉取 SSOT，task 098）
│   └── shared/               # 类型/事件词汇表/常量（JSON Schema、profile 声明类型）
├── benchmarks/               # fixtures/ scenarios/ runners/ reports/（D7 §2 契约）
├── configs/                  # behavior.default.yaml、policy 基线（system 作用域内置）、pricing.json
├── docs/                     # D1–D8 规范（本文件属 D8）
└── vitest.workspace.ts       # Vitest 多包工作区
```

模块依赖方向（task 098 起显式约束）：`apps/cli` 与 `benchmarks/runners` 都只**向下**依赖
`@vessel/application` 等机制包；供应商目录与模型拉取（`packages/application/src/providers/`）是两侧
共用 SSOT。runner **不得** `import '@vessel/cli'`——cli 的 `bench-report` 命令静态解析
`@vessel/bench-runners`（V1.1-E），一旦反向引用就会让 `tsc -b` 的项目图成环并把
`apps/cli/dist/*.d.ts` 同时当作输入与输出（TS5055）。

### 6.2 SQLite 用在哪

- **会话/记忆的 Storage 后端（可插拔接口）**：JSONL v1 事件日志为 v0.1 默认（D3 决策点 10：SQLite 后端 v0.2 经 Storage 接口接入，OpenCode 消息+parts SQLite、Codex sqlite 元数据是研究对照）。v0.1 不建库。
- **会话内全文检索 opt-in（SQLite FTS）**：复杂 RAG 的明确替代（D3 决策点 5 拒绝项注释），按需启用。
- **benchmarks/reports/ 不做 SQLite**：每次 run 落 JSONL + summary.json（D7 §4.2/§6.5），保持与事件日志同构、可 diff 可审计。

### 6.3 JSON-RPC/MCP 边界

- **Provider 层**：Provider 适配经 JSON-RPC/MCP 通道与外部模型服务通信（任务书 §20 通信栈），不绑定宿主语言；v0.1 的三类 Provider（Anthropic/OpenAI/OpenAI-Compatible）内部以统一流式接口封装，底层可用原生 SDK 或 JSON-RPC。
- **MCP 客户端**：tools/mcp（✗ V0.2 装载）——stdio + streamable-http 两种传输；远端工具动态注册进可见工具集，命名 `mcp__<server>__<tool>`；schema 首次调用时加载。v0.1 不装载（任务书 §10 六工具平面），目录与命名规则先立。
- **hooks.json 兼容桥**：外部 command hooks 以子进程 JSON stdin/stdout 协议运行（D3 决策点 15 影响：该协议即未来跨语言边界），归 policy/hooks（§4.6）。
- **未来 Rust Runtime**：经语言中立 seam（runtime/sandbox confine + runtime/process + 工具 Operations 注入点）替换，Brain 不改；Provider 层 JSON-RPC/MCP 不受宿主语言限制。

### 6.4 Vitest 测试布局（对应 benchmarks/）

双车道测试纪律（D3 决策点 16；D7 §8.2 里程碑）：

```text
包内单测（Vitest，每 packages/*/src/**/*.test.ts）
  core/events     事件原语：emit/waterfall 短路/guard 单调/错误隔离
  core/session    事件日志 append/flush/resume 重放（含崩溃合成 interrupted）
  behavior/       IR 校验 fail loud / resolver deep-merge / 双通道 policy_ref 告警
  context/        compaction 事务配对 / surface replace / spill 截断
  policy/         裁决序 / fail-closed 三落点 / never_auto / 作用域合并
  runtime/        平台 runner 探测与 fallback（mock backend）
benchmarks/（Vitest 工作区跑批）
  fixtures/       19 scenario fixture packs（B001–B019，含黄金断言自检 sanity fixtures）
  scenarios/      每 scenario manifest = 判据唯一事实源（D7 §3.0）
  runners/        runner 抽象 + adapter（v0.1：mock/pi/ours-stub）+ ToolFamily 归一化
  reports/        JSONL 类型化记录 + summary.json（D7 §4.2/§6.5）
```

- **offline mock 车道**：确定性 mock（Claw 式 PARITY_SCENARIO 脚本场景，无网络无真实模型），CI 常驻，测机制 parity——开发期每完成一个机制挂对应场景即可跑（B001–B015 机制子集，D3 决策点 16）。
- **live 车道**：Pi evals 复用（createPiCodingAgentHarness + AgentSession，行为级回代），A/B 归因（A–E 五组）与 Conformance 主车道。

---

## 7. 演进路线：V0.1 → V0.5（Loop Engine）

> 模块增量严格按任务书 §10–§14 分期装载（D5 §10.2 分期装载矩阵同步：事件面先定义全、按功能平面启用）。

| 版本 | 任务书范围 | 模块增量 | 事件/能力装载 |
|---|---|---|---|
| **V0.1** | §10：CLI/三类 Provider/6 工具/Core Loop/Session/Context Builder/Basic Compaction/Event Bus/Before·AfterTool/Policy Engine/Evaluator/测试 | core 全量；llm/behavior/context 全量；tools 6 工具；policy 四件套+engine；runtime seam + 平台后端；agents/evaluator（独立 LLM 形态）；memory/skills 最小骨架；apps/cli；benchmarks 双车道起步 | 表 A 27 事件中会话/轮次/模型/工具/文件命令/压缩全装载；委派事件面定义不装载；ApprovalPolicy 默认 never |
| **V0.2** | §11：MCP/Subagent/Planner/Evaluator Agent/Parallel Exploration/Git Worktree；默认并行 1–3 | tools/mcp 装载；agents/subagent + SubagentProvider seam + fork 窗口 + delegationDepth；agents/evaluator Agent 化（goal-eval preset）；network 代理 MITM/凭据 mask+出站注入 | 委派事件（A22–A25）装载；MCP 动态注册复用 tool/call 面；异步钩子+rewake |
| **V0.3** | §12：Project Memory/Persistent Memory/Skills/Skill Scope/Search/Provenance；自动学习只 suggest | memory/project+persistent（文件式记忆：MEMORY.md/USER.md、三级作用域、冻结快照注入、单一 memory 工具）；skills 全量（正文按需注入、作用域冲突、Search/Provenance）；behavior/ 增补技能使用类条目 | skills/change 能力事件装载（D3 决策点 11；D5 v0.1 事件表之外，随技能平面启用）；技能正文注入通道（agent.inject） |
| **V0.4** | §13：Background Review/Candidate Learning/Skill Update/Snapshot/Rollback/Curator；学习只写 learned/ | 学习闭环（suggest-only 管线）：Candidate → 用户确认 → learned/ 写入；Snapshot/Rollback（与 git 互补）；Curator 归档 | background_review 事件面（evaluator 层扩展）；用户 Skill ≠ Agent 自动修改区 |
| **V0.5 Loop Engine** | §14：Trigger → Discovery → Task Selection → Worktree → Generator → Evaluator → Persist → Next Iteration | **Loop Engine = Harness 外层循环**：用 V0.1–V0.4 已建的全部机制（Generator=单会话 loop；Evaluator=agents/evaluator；Worktree=Git 集成；Persist=memory/session）编排为持续迭代层；不做新内核——Harness ↓ Loop 的"逐层扩大"由已就绪模块组合而成 | 事件面在 V0.1 已预留轮次/委派词汇，Loop Engine 是消费方编排 |

**关键不变式（贯穿各版本）**：单一权威薄 loop 永不被替换（D3 决策点 2/4）；事件日志唯一真源语义不因新增功能改变（D3 决策点 10）；每个里程碑带对应场景集（§10–§14 路线 × B001–B019，D3 决策点 16 影响）；自动学习永远只 suggest 不 auto modify（任务书 §12/§13 硬约束）。

---

## 8. 与 Conformance Suite 的验证闭环

> ARCHITECTURE 的边界声明如何被 D7 BENCHMARK-SPEC 验证——每个架构主张都映射到一条可执行断言链。

### 8.1 闭环链路

```text
ARCHITECTURE.md（模块边界 + 数据流声明）
      │ 1) conformance 字段（D4：每条 IR 行为的可验证断言，编译产物携带）
      ▼
EVENT-SPEC 事件日志（真源：B01–B21 记录、A12/A13/A16/A17 裁决审计对）
      │ 2) H12 invariant 机械自检：配对/编号/回放校验
      ▼
agents/evaluator（独立 LLM，verdict 三态）+ 确定性层（tests/lint 经 shell 工具）
      │ 3) 判定不信任自报（D7 §1.2 原则 1）
      ▼
benchmarks/（scenario manifest = 判据唯一事实源；pass 断言全机器化）
      │ 4) runner 对磁盘状态与事件日志断言（M01–M14）
      ▼
reports/（JSONL + summary.json）→ A/B 归因 → 修订 ARCHITECTURE/IR/Policy（闭环回到 1）
```

### 8.2 架构主张 → 验证场景映射（示例，非穷举）

| ARCHITECTURE 主张 | 模块 | BENCHMARK-SPEC 验证 |
|---|---|---|
| "模型可见 ⟺ 已记录"（事件日志真源 + surface 派生） | core/session + context/builder | B010（上下文压缩）通过判据=压缩后日志可重建 + tool 配对完整；B011（Resume）重放正确；invariant 自检 |
| 终止判据"纯文本/无未决 tool_call 即停" + max_steps 硬顶 | core/agent-loop | B008（多 Tool 调用）；E02 conformance：step 计数 ≤ 配置值、超限 turn/end.kind=budget |
| Policy 四件套 + 裁决序 + fail-closed | policy/ | B006（危险 Bash 拦截）三态拦截；M12 Safety Violations 口径=audit/denial 计数（D6 §503 → D7 §4.1） |
| Tool 错误契约（INVALID_ARGS 自修复/doom-loop ≥3） | tools/registry | B007（Tool 失败恢复）；B004 M04/M05 指标 |
| Evaluator 门禁（独立判定、不自证完成） | agents/evaluator | B014（Evaluator 拒绝）；M13 Evaluator Reject Count（现状：有**两条**已接线通路——`team_end` 载荷的 evaluate 成员 review.verdict，以及基准/CLI 的 evaluator 臂直接调用 `recordEvaluatorReject()`；**Goal Loop 的 RealEvaluatorAdapter/InternalReviewer 通路未接线**、不计入）；A/B 组 D 对比归因 |
| 软/硬分离（Prompt Guidance 不产生审计事实） | behavior/compiler + policy/ | B016–B019 行为纪律场景（conformance 行为对齐重点）；M14 Autonomy |
| IR 编译管线产物（同一意图多 profile） | behavior/ | A/B 组 B→C 归因（散文 vs IR 编译）；B018 诚实性（claim_truthful 断言） |
| V0.1 六工具平面 + 无 MCP | tools/ | B012（MCP 调用）= 诚实 skip（记录 skipped+原因，不伪造通过） |

### 8.3 验证的三种级别

1. **开发期机制回归（offline mock）**：每完成一个机制挂对应场景即可跑（D3 决策点 16）——机制正确性从第一天被机器证明，不等全部实现完。
2. **行为/质量测量（live 车道）**：Pi harness 载体 + A–E 五组 A/B（§5.1），回答任务书 §17 的"提升来自 Prompt 还是 Harness"；每组变量隔离（A→B 文本有无、B→C 文本形式、C→D Evaluator 完成闸、D→E Policy 硬约束，D7 §5.3）。
3. **Cross-Harness Conformance（C7）**：同一 scenario 在 Claude Code / Claw Code / Pi / OpenCode / Codex / DSH / Our Harness 上跑，可比报告 + skipped 清单；证明 Composable Agent Harness（Behavior IR + Compiler + Policy Runtime）不是"看起来不错"而是机制上更稳（任务书最终定位行 1425–1431）。

### 8.4 验收对照（任务书 §22 门槛）

- 7 个以上 Harness 完整分析 ✔（D1，HARNESS-ANATOMY.md）
- 12 个核心机制全部有横向矩阵 ✔（D2，comparison.md）
- 每个架构选择 ≥2 候选 + 最终选择写明理由 ✔（D3，16 决策点）
- Behavior IR v0.1 / Event Spec v0.1 / Policy Spec v0.1 ✔（D4/D5/D6）
- Benchmark Scenario ≥15 ✔（D7，B001–B019 = 19）
- **新 Harness V0.1 的模块边界确定 ✔（本文件 D8）**

---

（完）
