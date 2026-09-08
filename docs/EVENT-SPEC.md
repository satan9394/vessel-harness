# Agent 生命周期事件规范 v0.1（D5 / EVENT-SPEC.md）

- **交付物**：D5 — 生命周期事件规范（任务书第二十一节）
- **版本**：v0.1（草案）
- **日期**：2026-09-05
- **状态**：供 Review；事件词汇与 H06 研究结论（comparison.md / HARNESS-ANATOMY.md）对齐
- **上游依据**：任务书.md §H06「Hooks / Middleware / Events」（行 319–361，标准事件模型草案 16 事件与事件序列）、§四 H01 Agent Loop、§八 Policy Runtime（行 655–711：`BeforeTool → Policy Engine → ALLOW/DENY → Runtime → Audit` 执行链）；docs/research/harness-matrix/comparison.md（H01 行 33–98、H04 行 223–285、H05 行 287–348、H06 行 350–407、H11 行 676–739、H12 行 743–806）；docs/HARNESS-ANATOMY.md（H01 行 53–84、H03、H04、H06 行 228–259、H07）；研究文档 codex.md / deepseek-harness.md / claude-code.md 各 H06 章节
- **下游消费方**：D6 POLICY-SPEC（Policy Engine 与审计接线）、D8 ARCHITECTURE.md（core/events 模块边界）、第三阶段实现（任务书 §9 `core/events`、`core/agent-loop`）、D7 BENCHMARK-SPEC（轨迹指标口径）、Evaluator / 回放 / 审计

> 一句话定位：**给任务书草案的事件模型定出正式 v0.1——事件面与 loop 决策点一一对应、每个事件有明确触发时机/载荷/flow 语义/消费方；同一事实分「扩展事件（可订阅可决策）」与「持久记录（自动落日志）」两域表达，任何进入模型或执行的动作都可由日志重建（D1 结论 0.3-1、DSH 原则 1）。**

---

## 0. 摘要

本规范把任务书 H06 的标准事件模型草案（16 事件）正式化为 **v0.1 全生命周期事件面**，并按研究结论（D1 H06 共同抽象）做两件事：

1. **域分离**：**扩展事件**（realtime extension，可订阅、带 flow 语义、供策略/插件/安全注入）与**持久记录**（persistent session event，会话日志自动落盘、供回放/evaluator/审计）分开定义；扩展事件是「决策点」，持久记录是「事实」，两者一一镜像（DSH「模型可见 ⟺ 已记录」）。
2. **补齐缺口**：草案只有 16 个钩子名，缺少会话生命周期、模型请求构造/流式、子代理结果回传、Policy 裁决、审批审计、错误恢复等决策点；本规范吸收 Codex 12 事件 / Claude Code 35+ 事件 / DSH agent·tool·approval·compaction 词汇后**新增 11 个扩展事件**（全部显式标注「新增」），并给出 21 个自动持久记录。

**v0.1 总量：48 个具名事件** —— 27 个可订阅扩展事件（含草案 16 个）+ 21 个自动持久记录（见第 2 节总表）。实现分期见第 10 节（事件面先定全，装载按 V0.1/V0.2 功能平面启用）。

名词口径沿用研究文档（comparison.md / HARNESS-ANATOMY）：**轮次 turn** = 一次用户回合；**步骤 step** = 一次模型请求 + 其工具调用（H01 决策：user-turn = 1+ steps）。

---

## 1. 设计动机与核心思想

1. **事件面 = loop 决策点清单，不为覆盖而覆盖**。任务书禁止事项 10（不只做功能列表）与 comparison.md H06 Decision 一致：每个事件都必须挂在自研 loop 的真实决策点上，保证全部可观测、可回放。
2. **两域一事实**。持久记录进会话日志（唯一真源），扩展事件在决策点分发；同一事实的两面在命名与字段上对应（如 `BeforeTool` ⇄ `tool/call`，`AfterTool` ⇄ `tool/result`）。
3. **五种分发语义，决策只有 waterfall/serial 两种**。emit=观察（fire-and-forget）、waterfall=可拦截/改载荷（不调 `next()` 即短路=决策）、serial=顺序追加副作用（可裁决但不改主载荷）、parallel=无依赖并行观察/变换；guard 单调（只能收窄，杜绝「先放行后否决」翻转）是 DSH 铁律，v0.1 全盘继承（comparison.md H06 Decision / H07 共同抽象）。
4. **Policy Engine 是 BeforeTool 链上的一个权威裁决者，不是事件本身**。任务书 §8 执行链 `BeforeTool → Policy Engine → ALLOW/DENY → Runtime → Audit` 在 v0.1 落地为：`BeforeTool`(waterfall，Policy/审批/沙箱各以监听器注入) → guard 收窄 → `PolicyDecision`(emit，裁决+决策轨迹) → 执行 → `AfterTool` → `audit/*` 记录。软约束（prompt）与硬约束（Policy/沙箱/审批）分离原则（任务书 §2.3、D1 结论 4a）不变。
5. **先持久、后等待**。重试（`llm/retry`）、压缩（`compaction/start` 锁）、审批（`approval/asked`）都在等待/执行前先落日志，崩溃不留隐形待办；配对结束标记恰好一次（DSH 原则 4）。
6. **钩子失败绝不崩轮次**；热路径钩子超时上限、插件不 inline 跑 token 路径（Hermes/OpenCode 执行纪律，comparison.md H06 Decision）。

---

## 2. 事件分类法与 v0.1 事件总表

### 2.1 命名与域约定

| 域 | 命名 | 是否可订阅 | 落日志 | 用途 |
|---|---|---|---|---|
| 扩展事件（钩子点） | CamelCase，保留任务书草案名 | ✅ `on(name, listener)` | 否（其镜像记录落日志） | 策略/插件/安全注入；决策或观察 |
| 持久记录 | 小写斜线（与研究词汇一致，如 `user/message`、`turn/end`、`approval/asked`） | ❌ 系统产生 | ✅ 自动、仅追加 | 会话真源、回放/evaluator/审计/不变式 |

### 2.2 v0.1 事件总表（48 行）

**表 A：扩展事件（27，可订阅）** —— 来源列：`草案`=任务书 H06 标准事件模型原文；`新增`=本规范按研究结论补充。

| # | 事件 | 组 | flow | 来源 |
|---|---|---|---|---|
| A01 | SessionStart | 会话生命周期 | waterfall | 新增 |
| A02 | SessionEnd | 会话生命周期 | emit | 新增 |
| A03 | BeforeTurn | 轮次 | waterfall | 草案 |
| A04 | BeforeStop | 轮次 | serial | 草案 |
| A05 | Interrupt | 轮次 | serial | 新增 |
| A06 | AfterTurn | 轮次 | emit | 草案 |
| A07 | BeforeModel | 模型 | waterfall | 草案 |
| A08 | ModelRequest | 模型 | emit | 新增 |
| A09 | ModelStream | 模型 | emit | 新增 |
| A10 | AfterModel | 模型 | waterfall | 草案 |
| A11 | ModelError | 模型（错误恢复） | waterfall | 新增 |
| A12 | BeforeTool | 工具与策略 | waterfall | 草案 |
| A13 | PolicyDecision | 工具与策略（裁决） | emit | 新增 |
| A14 | AfterTool | 工具与策略 | waterfall | 草案 |
| A15 | ToolError | 工具与策略（错误） | serial | 草案 |
| A16 | ApprovalRequest | 工具与策略（审批） | waterfall | 新增 |
| A17 | ApprovalDecided | 工具与策略（审批审计） | emit | 新增 |
| A18 | BeforeWrite | 文件写 seam | waterfall | 草案 |
| A19 | AfterWrite | 文件写 seam | serial | 草案 |
| A20 | BeforeShell | 命令 seam | waterfall | 草案 |
| A21 | AfterShell | 命令 seam | parallel | 草案 |
| A22 | BeforeDelegate | 委派 | waterfall | 草案 |
| A23 | SubagentStart | 委派 | emit | 新增 |
| A24 | SubagentStop | 委派（结果回传） | emit | 新增 |
| A25 | AfterDelegate | 委派 | serial | 草案 |
| A26 | BeforeCompact | 压缩 | waterfall | 草案 |
| A27 | AfterCompact | 压缩 | serial | 草案 |

**表 B：持久记录（21，自动落日志，非订阅决策点）**

| # | 记录 | # | 记录 | # | 记录 |
|---|---|---|---|---|---|
| B01 | `user/message` | B08 | `turn/start` | B15 | `compaction/summary` |
| B02 | `assistant/message` | B09 | `turn/end` | B16 | `compaction/end` |
| B03 | `assistant/attempt` | B10 | `session/created` | B17 | `approval/asked` |
| B04 | `tool/call` | B11 | `session/end-seed` | B18 | `approval/decided` |
| B05 | `tool/result` | B12 | `request/header` | B19 | `audit/decision` |
| B06 | `step/start` | B13 | `llm/retry` | B20 | `audit/denial` |
| B07 | `step/end` | B14 | `compaction/start` | B21 | `audit/safety` |

> 计数口径：本规范 v0.1 共定义 **48** 个具名事件 = 表 A 27（16 草案 + 11 新增）+ 表 B 21（自动持久记录）。草案 16 个全部收录（对照见附录 A）。

---

## 3. 事件总线核心接口与订阅/发布规则

### 3.1 接口（TS 形态，供 D8 落为 `core/events`）

```ts
type DispatchMode = 'emit' | 'waterfall' | 'serial' | 'parallel' | 'bail';
// emit      ：fire-and-forget 观察；监听器返回值被忽略；先注册先调（同一事件内有序），异常隔离
// waterfall ：包装模式；监听器签名 (payload, next) => Promise<Result>；
//             「不调用 next() 即短路」= 拦截/决策；next(payload') 可改载荷续传
// serial    ：顺序副作用链；每监听器拿到上一监听器返回的 side-effects/裁决累加结果，可追加不可改主载荷
// parallel  ：无依赖并行执行，全部 settle（任一失败记 handler_error，不崩事件面）
// bail      ：任一监听器抛错/返回 bail 即停（v0.1 保留语义，不为核心事件默认启用）

interface EventBus {
  on<E extends ExtensionEventName>(name: E, listener: Listener<E>): Disposer; // 返回注销函数
  emit<E>(name: E, payload: PayloadOf<E>): void;                             // 观察
  waterfall<E>(name: E, payload: PayloadOf<E>, next: Next<E>): Promise<ResultOf<E>>; // 决策
  serial<E>(name: E, payload: PayloadOf<E>, acc: AccOf<E>): Promise<AccOf<E>>;       // 副作用/裁决累积
  parallel<E>(name: E, payload: PayloadOf<E>): Promise<void>;
}
```

类型安全：`…Map → derived-union` 模式（对照 DSH：`SessionEventMap`/`TurnEndReasonMap` 等，插件用 declaration merging 扩展）；事件声明处标注 `@mode`（dispatch 模式）与分组，目录生成器交叉校验声明与分发调用点（DSH H06 关键机制，deepseek-harness.md 行 218）。

### 3.2 订阅/发布规则

1. **作用域**：`on()` 默认绑定当前 agent 作用域，随作用域 dispose 自动注销（返回 disposer）；全局监听用 `onGlobal()`（仅限会话级/审计类消费者）。事件载荷一律携带 `agentId`、`sessionId`、`cwd`，子代理内事件可路由（comparison.md H06 Proposed Spec `scope_safety`）。
2. **决策合并语义**：同一事件的多个 waterfall 监听器**并行跑**，权限类决策取最严格（任一 `deny` 即 deny；`deny > ask > allow` 合并，DSH hook-protocol 语义）；guard 单调收窄在 waterfall 全链之后强制执行，**任何监听器不得放宽 guard 已收窄的边界**。
3. **错误隔离与超时**：监听器抛错 → 记 `handler_error`（诊断事件，见 3.4）绝不崩轮次；热路径钩子有超时上限（默认 ≤ 3s，可配；异步+rewake 形态 v0.1 不实现，留 v0.2——comparison.md H06 Proposed Spec `async_hooks`）。
4. **持久镜像规则**：凡「进入模型可见面或执行面」的载荷变更，扩展事件只负责「改」，持久记录负责「存」；事件处理器内对 payload 的修改**不自动落盘**，由 loop 在镜像记录点统一落盘（保证日志=真源）。
5. **外部兼容桥**（hooks.json，Claude Code/Codex 方言 matcher）作为扩展事件的一类监听器适配层接入（`hooks-claude-code`/`hooks-codex` 思路）；退出码 0=无决策 / 2=阻塞（stderr 为原因）/ 其余非零=记录非阻塞；hook 失败绝不崩轮次。v0.1 定义接线位置，实现装填按分期（第 10 节）。

### 3.3 与 Policy Engine 的衔接（总则，详见第 7 节）

`BeforeTool` 是 Policy Engine 的**挂载点**而非引擎本身：Policy 规则求值、审批请求、沙箱模式解析都以 waterfall 监听器形式注册在 `BeforeTool`；引擎裁决结果与决策轨迹由 `PolicyDecision`(emit) + `audit/decision`(记录) 落证据链。DENY 分支：`audit/denial` 记录 → 拒绝文本回灌模型（模型改写而非死循环）；`never` 审批策略在 waterfall 分发**之前**服务内强制（应答者也绕不过，fail-closed）。

### 3.4 补充诊断事件

`handler_error`（扩展事件，emit）：监听器异常隔离记录，载荷 `{eventName, listenerId, error:{kind,message}, agentId}`，消费方=诊断/遥测；不算入主事件表（v0.1 事件面成员），仅说明监听器错误不污染主流程。

---

## 4. 事件卡模板与通用字段

每个扩展事件按下卡定义。**通用字段**（每卡载荷含，不再逐卡重复）：

```text
eventId    : string        # 形如 <agentId>:<sessionId>:<seq>，单调（回放排序键）
agentId    : string        # 产生该事件的 agent；子代理事件=子 agentId
sessionId  : string        # 所在会话（子代理=独立子会话 id）
cwd        : string        # 会话不可变工作目录（H08 派生规则）
seq        : number        # 会话内事件序号（不变式校验用）
```

**flow 语义取值**（第 3 节定义）：`waterfall`（可拦截/改载荷）/ `serial`（可追加副作用、可裁决）/ `parallel`（无依赖并行观察）/ `emit`（fire-and-forget 观察）。**卡内「裁决」指该事件能改变主流程走向的出口值**；无裁决的事件即使 waterfall 也只改载荷。

---

## 5. 逐事件规范

### 5.A 会话生命周期（SessionLifecycle，新增域）

#### A01 SessionStart（新增）
- **触发时机**：一次会话进入「可跑」状态时，按来源**每会话至多一次**（启动/恢复/清空/压缩后/子代理派生），在任何 BeforeTurn 之前；会话创建事务发布 `session/created` 之后（DSH：构造 → setup → 发布 `session/created`/`agent/created`/`agent/session-start` → 启动驱动器，行 53）。
- **载荷字段**：`source: 'startup'|'resume'|'fork'|'clear'|'compact'|'subagent'|'evaluator'|'plan'`（V0.2 新增 `'evaluator'`/`'plan'`，对应 Evaluator Agent 隔离会话与 Planner 注入；对应 DSH `SessionStartSource`，行 209/315）；`sessionHeader:{formatVersion, cwd, parentSession?, isSeeded, delegationDepth, agentPreset, origin?}`（对照 DSH SessionHeader，行 308）；`settings:{sandboxMode, approvalPolicy, toolRestrictions, model}`。
- **flow**：`waterfall`——可**拦截**（如：工作区信任门拒绝、resume 的健康探针失败）→ 拒绝本轮启动并给出 `reason`；可**改载荷**（按 source 装载：恢复时注入 resume 提示、clear 时装载新 seed、子代理按 frontmatter 裁剪工具/模型）。
- **消费方示例**：工作区指令装载器（把 AGENTS.md 基线作为带来源的持久 user/message 注入，H02 共同抽象）、技能目录索引装载、MCP 工具名快照装载、外部 hooks（Codex `SessionStart` matcher 按 source 匹配）、审计（会话创建/恢复留痕）。
- **关联机制/镜像**：`agent/session-start`（DSH）；`SessionStart`（Codex/Claude）；记录：`session/created`、`session/end-seed`。

#### A02 SessionEnd（新增）
- **触发时机**：会话关闭（dispose/超时空闲/用户退出/clear/预算耗尽/致命错误）且所有轮次已闭合；teardown 顺序固定（停排空 → 撤作用域 → detach agent → detach session，DSH 行 54）。
- **载荷字段**：`reason:'disposed'|'user-exit'|'idle-timeout'|'clear'|'budget'|'error'`；`ledger:{turns, steps, toolCalls, compactions, totalCostEstimate?, errorCount?}`；`interruptedTurns?:seq[]`（崩溃恢复时合成的 `interrupted` 关闭器清单，H09）。
- **flow**：`emit`——fire-and-forget 观察，消费方不得阻断会话关闭；SessionEnd 钩子合计有 1.5s 预算（Claude Code hooks 超时纪律，claude-code.md 行 184）。
- **消费方示例**：标题生成/摘要归档、retention sweep（30 天，Claude）、遥测/指标落库、外部 hooks（Codex `SessionEnd` 按结束原因触发）。
- **关联机制/镜像**：`SessionEnd`（Codex/Claude）；记录：`session/end-seed` 语义邻接（fork 边界标记）与 `turn/end`。

### 5.B 轮次（Turn）

#### A03 BeforeTurn（草案）
- **触发时机**：驱动器打开新轮次、原子领取 pending next-step 输入 + 一条排队消息（`Inbox.claim`，DSH 行 42）之后、首步采样之前；**每轮一次**。
- **载荷字段**：`turnId`；`inputs:UserMessageLike[]`（本轮领到的用户/排队消息批次，含 `source`）；`claimed:boolean`；`contextSnapshot:{stepIndex, toolPending:boolean, budgetState?}`；`turnNumber`。
- **flow**：`waterfall`——可**拦截**：拒绝整批输入（`reject(reason)` → 关不含步骤的轮次，反馈给用户/请求方；对照 DSH `agent/pre-step` reject 语义行 28–29）；可**改载荷**：改写/增删 inputs（注入 steering、goal 续跑提示、plan-mode 标记、上一轮 compact 的 auto-continue 提示）。
- **消费方示例**：admission 门（输入清洗/长度门限）、goal/steering 注入器、session-mode 标记注入（plan/autonomous）、外部 hooks（Claude `UserPromptSubmit` 近似、Codex `UserPromptSubmit` 采样前）。
- **关联机制/镜像**：`agent/pre-step`（enter 路径，DSH）；`UserPromptSubmit`（Codex/Claude，近似）；记录：`turn/start`、随后首步 `user/message` 批量追加。

#### A04 BeforeStop（草案）
- **触发时机**：驱动器判定「不再欠下任何工作」（本步无未决 tool_call、无 steering/排队输入）时、关轮前；对照 DSH `agent/turn-stopping`（serial，行 46）与 Codex `Stop`（run_turn_stop_hooks，行 104）。
- **载荷字段**：`turnId`；`candidateKind:'no-pending-tool'|'pure-text'|'max-steps'|'budget'|'policy'`；`pendingToolCalls:[]`（应为空，非空则 loop 先派发）；`stats:{steps, tokensUsed?, costEstimate?}`；`stopVotes:{}`（累积）。
- **flow**：`serial`——顺序追加副作用/裁决，**可裁决**：任一监听器 `forceContinue(reason)` → 驱动器强制再执行一步（Goal 未达成 → evaluator 续做、doom-loop 转权限询问后继续）；否则全体默认同意 → `turn/end`。这是「语义层停（纯文本即停）」与「机械层停（maxStepsPerTurn 64 硬顶/预算）」两层的共同裁决点（H01 共同抽象 2，comparison.md 行 81）。
- **消费方示例**：轮次预算执行器（`maxStepsPerTurn`/`maxBudgetUsd`）、evaluator 触发（goal 条件未 met → forceContinue）、doom-loop 守卫（同工具同输入 ≥3 次→转权限询问/暂停，H01 Proposed Spec）、外部 Stop hook（可 block+continuation，防重入由驱动器保证 `stop_hook_active`）。
- **关联机制/镜像**：`agent/turn-stopping`（DSH）；`Stop`（Codex/Claude）；记录：`turn/end`。

#### A05 Interrupt（新增）
- **触发时机**：用户 Esc / 系统信号 / 策略紧急打断，目标为「在飞模型采样或在飞工具」；任意时刻异步触发（对照 Codex `Interrupt` 事件、Claude Esc 中断 steer-in-flight、Hermes interrupt_control、DSH 协作式 `agent.cancel()`）。
- **载荷字段**：`target:'model'|'tool'|'turn'`；`inFlight:{requestId?, toolCallIds?[]}`；`queuedAction:'stop'|'steer'|'cancel-tool'`；`steerMessage?`（steer-in-flight 的新指示）。
- **flow**：`serial`——顺序记录/叠加处置副作用；驱动器随后落地语义：采样中断 → `ModelStream end {interrupted:true}`（前缀落盘）；未分发工具 → 合成 `ABORTED_BEFORE_DISPATCH` 结果；轮次以 `turn/end {kind:'interrupted'}` 落盘（DSH 行 49、H01 Proposed Spec cancellation）。消费方不能阻止打断本身，可挂清理副作用。
- **消费方示例**：取消令牌广播、在飞 shell 进程组终止、部分文本保留与「未完成」标记注入、审计 `audit/safety`（人为介入留痕）。
- **关联机制/镜像**：`Interrupt`（Codex 12 事件之一）；记录：`turn/end`、`tool/result`。

> **实现注记（050，InterruptController 落地）**：turn 级中断不新增事件词汇——沿用既有 flat
> 事件与持久记录表达（packages/core/src/agent-loop/InterruptController.ts）：
> - 每个 active turn 持有一个 AbortController 作用域（AgentLoop 内 InterruptController：
>   turn 开始 `begin()`、外部 `interrupt()` 触发 abort、turn 收尾 `end()` 清理并释放信号；
>   可查询 `active/aborted`）。外部表面（CLI 首次 Ctrl+C、`POST /api/sessions/:id/interrupt`、
>   web Stop）统一走 `loop.interrupt()`。
> - **采样中断**：在飞 stream 以既有 attempt 级收尾 `model_stream_end {finishReason:'error'}`
>   关闭（flat 词汇无 interrupted finishReason，与失败 attempt 同一种 attempt 配对表达）；
>   重试包装不再重试（abort 优先于 retry）；轮次以 `turn/end {kind:'interrupted'}` 落盘，
>   `turn/start → turn/end` 配对不变式保持。
> - **在飞工具**：能传则传——`ChatRequest.signal`（provider fetch 即时 abort）、
>   `ToolExecutionContext.signal` → shell 子进程（runCommand signal → kill）、MCP call
>   （信号 race）、subagent 委托（父 abort → 子 loop interrupt → 子 turn kind=interrupted）；
>   不能传的边界检查中断并停止（AgentLoop 在 step 边界 / 每 chunk / 工具 await 处检查）。
>   被中断的在飞工具以 `tool/result {error:{…'interrupted'}, meta:{interrupted:true}}` 显式关闭
>   （`tool/call → tool/result` 配对保持）。
> - **UI/CLI**：Ctrl+C 第一次 = interrupt 当前 turn，第二次 = exit（readline 层两段式状态机）；
>   `POST /api/sessions/:id/interrupt`（040 框架已留缝）与 web Stop 按钮同一 interrupt 缝。
>   部分文本保留 / resume UI 属 053，steering 属 051，均不在 050 范围内。

> **实现注记（051，SteeringQueue 落地）**：运行中 steer 不新增事件词汇——steer 以既有
> B01 `user/message` 持久记录表达（`source:'steer'` 判别值扩展，@vessel/shared
> `UserMessageRecord.source` 联合；实现见 packages/core/src/agent-loop/SteeringQueue.ts）：
> - **SteeringQueue**：`enqueue`/`drain` 均同步（无 await 间隙，单线程事件循环下取整批原子，
>   不丢不重）；每项带 `source`（user/api/cli/web）与 `ts`（ISO 入队时间戳）——pending 态
>   可审计；AgentLoop 持有一个实例，公开 `steer(content, source?)` 与 `pendingSteerCount`。
> - **只改方向、永不打断**：AgentLoop 只在 step boundary（下一 step 的 buildContext/模型调用
>   之前）drain 队列，把每条 steer 落为 `user/message {source:'steer', surface:true}` 记录；
>   in-flight 的模型采样 / 工具执行（含原子文件写入）期间的入队只缓存，下一 boundary 才注入。
>   与 A05 语义互补：interrupt 停 turn、steer 改下一轮方向；turn 内无剩余 boundary 时未消费
>   steer 跨 turn 保留，于下一 turn 首 boundary 注入。注入后队列即清空（消费即清）。
> - **消息形态**：模型上下文经由既有 surface 投影（模型可见 ⟺ 已记录）派生，ContextBuilder
>   无需改动——B01 记录的 seq/ts 即持久审计轨迹。
> - **server seam**：`POST /api/sessions/:id/steer`（040 框架已留缝；SessionController.steer →
>   loop.steer）；web/CLI 后续复用同一缝（053 resume/UI 不在本卡）。

#### A06 AfterTurn（草案）
- **触发时机**：`turn/end` 已落盘、驱动器把控制权交还宿主时；每轮恰好一次。
- **载荷字段**：`turnId`；`kind:'success'|'error'|'interrupted'|'budget'`（对照 DSH `turn/end {kind}` 与 H01 词汇，行 84）；`stats:{steps, toolCalls, tokensUsed?, durationMs, costEstimate?}`；`lastAssistantMsgSeq?`。
- **flow**：`emit`——fire-and-forget 观察（旁路消费者，不阻塞下一轮）。
- **消费方示例**：每轮后 evaluator 触发（`/goal` 型独立小模型只读 transcript 判定，H12）、轮末自动压缩检查（Claw 每轮落盘后 `maybe_auto_compact()`，行 41）、checkpoint/快照（Claude checkpointing：每用户 prompt 建，只跟踪文件编辑）、标题/用量遥测、预算记账（审计 `audit/safety`/budget 指标）。
- **关联机制/镜像**：`turn/end` 持久记录（AfterTurn 的镜像）；`agent/assistant-stream` end（DSH，关联）。

### 5.C 模型（Model）

#### A07 BeforeModel（草案）
- **触发时机**：**每个 step 采样前**——上下文组装（系统提示分层 + 工具 schema 投影 + 派生历史）后、请求冻结前；也即 compaction 压力检查位（自动压缩入口之一，DSH 行 137）与注入队列排空位。
- **载荷字段**：`stepId`；`messages`（派生历史 + 本步 user 消息）；`systemSections:[{name, order, text?, scope}]`；`tools:ToolSchema[]`（按 allowlist 投影，回调/超时绝不上行）；`requestHints:{provider?, model?, fallbackChain?[]}`；`context:{estimatedTokens?, contextWindow?, pressure:boolean}`。
- **flow**：`waterfall`——可**拦截**：改写后为空/拒绝 → 关闭不含步骤的轮次（DSH reject 语义）；可**改载荷**：改 system sections（注入行为 IR 编译产物、技能目录、指令基线）、增删可见工具 schema（裸工具名 deny → 移出上下文，H07 共同抽象）、改写 provider/model/fallback 链、清空/截断注入内容；**可在此触发 BeforeCompact 流程**（压力 `thresholdRatio:0.8` 检查命中时）。
- **消费方示例**：system-prompt 组装器、指令/技能装载器、工具可见性过滤、token 预算与截断（spill>50KB 外置）、凭据脱敏注入、外部 hooks（Codex `UserPromptSubmit`≈ 采样前）。
- **关联机制/镜像**：`agent/request`（waterfall，DSH）；`agent/pre-step`（enter）；记录：随后 `request/header`。

#### A08 ModelRequest（新增）
- **触发时机**：请求**已冻结**、即将调用 `ctx.llm.stream` 时（BeforeModel 全部修改完成后）；对照 DSH `request/header`（把完整 envelope 写入日志使请求可重建，行 43）。
- **载荷字段**：`requestId`；`provider/model`；`envelope:{system, messages, tools, toolChoice?, maxTokens?, temperature?}`（可重建全量）；`usageEstimate?`；`requestKind:'turn'|'compaction-summary'|'goal-eval'|'title'`（区分旁路模型请求）。
- **flow**：`emit`——fire-and-forget 观察；载荷为冻结快照，监听器**不得改写**（改写必须在 BeforeModel）。
- **消费方示例**：请求折叠（`foldRequestHeader` 供重建/审计）、token meter 记账、prefix-cache 命中统计（三层前缀缓存排序依据）、replay/evaluator（「模型可见 ⟺ 已记录」不变式落点）。
- **关联机制/镜像**：记录：`request/header`（ModelRequest 的持久镜像，同一 schema）；机制 `agent/request` 之后校验 provider/model 存在（缺省可补齐，无适配器以 `NO_ADAPTER` 失败）。

#### A09 ModelStream（新增）
- **触发时机**：流式采样进行中：首 token（`start`）→ 每增量（`delta`/`reasoning`）→ 结束（`end`）；异常（`error`→ ModelError 流程）；打断（`end {interrupted:true}`）。
- **载荷字段**：`requestId`；`event:'start'|'delta'|'reasoning'|'end'|'error'`；`deltaText?`；`reasoningDelta?`；`toolCallDeltas?[]`（流式 tool_call 增量）；`usageDelta?{inputTokens?, outputTokens?, cacheRead?}`；`interrupted?:boolean`；`finishReason?`（stop / tool_calls / length / content_filter）。
- **flow**：`emit`——fire-and-forget 观察，**监听器永不 inline 跑在 token 路径上**（Hermes 执行纪律，comparison.md 行 378）；需要每消费者独立有界队列（丢最旧）的形态 v0.2。
- **消费方示例**：UI/CLI 增量渲染、prefix-cache 与 token 实时记账、成本/速率监控、内容安全旁路扫描（盲化：不看 tool results，H07 共同抽象）。
- **关联机制/镜像**：`agent/assistant-stream`（start/chunk*/end，DSH）；记录：结束后落 `assistant/message`/`assistant/attempt`。

> **实现注记（049，flat 事件族落地）**：共享词汇 `@vessel/shared` 把 A09 的
> `event:'start'|'delta'|'end'` 判别字段粒度化为三个可独立订阅的 EventType 成员——
> `model_stream_start` / `model_stream_delta` / `model_stream_end`（沿用仓库扁平扩展事件
> 命名惯例 before_model/after_model、before_tool/after_tool，见 packages/shared/src/events.ts）：
> - 三个事件共享相关信封 `{turnId, step, requestId}`；`requestId = req_{turnId}_step{step}`
>   为确定性 id，同一次逻辑请求的重试 attempt 共享（按 step 区分，跨 attempt 稳定）。
> - `model_stream_start`：`{turnId, step, requestId, model}`——开始消费 provider.stream()
>   迭代前恰好一次。
> - `model_stream_delta`：`{turnId, step, requestId, chunk}`——每段 text_delta /
>   tool_call_start / tool_call_delta / tool_call_end 增量各一次；`chunk` 为 StreamChunk
>   原始联合（消费方自累积 tool arguments / UI 增量渲染）。
> - `model_stream_end`：`{turnId, step, requestId, finishReason, text, toolCalls, usage}`
>   ——流终止后恰好一次（与 start 配对）；`finishReason` 归一化到
>   `'stop'|'tool_calls'|'length'|'error'`，`usage` 为逐字段 last-wins 合并的
>   ChatUsage，`text/toolCalls` 为与 chat() 等价的累积终态。失败的 attempt 以
>   `finishReason:'error'` 关闭流再走 llm/retry（attempt 级配对不变式）。
> - 终止记账 chunk（usage / message_end）不单独发 delta，折叠进 end payload；
>   增量 token 实时记账如需逐帧 usage 可在 v0.2 扩展 delta 载荷。

#### A10 AfterModel（草案）
- **触发时机**：流结束、assistant 最终载荷（文本或 tool_calls 列表）组装完成后、进入工具分发**之前**；对照 DSH `agent/assistant-stream` end + `assistant/message|attempt` 持久化（行 208）。
- **载荷字段**：`requestId`；`stepId`；`finalText?`；`toolCalls:[{toolCallId, name, arguments}]`（原始 JSON，DSH `tool/call` 原始 arguments 词汇，行 166）；`finishReason`；`attemptNo`。
- **flow**：`waterfall`——可**拦截**（veto，不入分发）：输出治理判定毒化/空响应/畸形 tool_call 时拦截并按 ModelError 通道回灌修正（≤attempt 上限防死循环）；可**改载荷**：改写模型可见文本、修 arguments JSON、删除某 toolCall（不让其进分发）。
- **消费方示例**：结构化输出 schema 校验（失败重试 ≤ 上限后 error，H12 structured_contract）、内容脱敏/redact、tool-call 完整性校验（缺省参数 → 反馈模型自修复，OpenCode invalid 工具兜底思想）、guardian/classifier 盲化审查、verification 触发（模型声明需外部验证）。
- **关联机制/镜像**：记录：`assistant/message`（纯文本终态）/ `assistant/attempt`（含中间或被打断尝试）；后续每 tool call 落 `tool/call`。

#### A11 ModelError（新增，Error/Recovery）
- **触发时机**：模型请求失败（请求错误/空响应/超时/限流/服务端/上下文溢出/适配器缺失）在**失败 step 关闭后、轮次关闭前**触发；对照 DSH `agent/request-error`（waterfall，行 48）。
- **载荷字段**：`requestId`；`stepId`；`kind:'EMPTY_RESPONSE'|'RATE_LIMIT'|'SERVER'|'TIMEOUT'|'TRANSPORT'|'CONTEXT_WINDOW_EXCEEDED'|'AUTH'|'MODEL'|'NO_ADAPTER'|'CONTENT_FILTER'`；`llmError:{code?, message, providerSpecific?}`；`attemptNo`；`fallbackChain?[]`。
- **flow**：`waterfall`——监听器返回 `{kind:'retry'}` 且不调 `next()` 即恢复（DSH 语义）；`{kind:'abort'}` → `turn/end {kind:'error'}`；`CONTEXT_WINDOW_EXCEEDED` → 先走 BeforeCompact（溢出入口）再重试（`maxOverflowRetries:1`）。
- **重试纪律**：rate_limit/overloaded/server/timeout/transport/empty 可重试（指数退避+抖动，normal 最多 5 次）；auth/model 错误不重试（H01 共同抽象）；provider 不可用走 fallback chain；**先持久后等待**：等待前先落 `llm/retry` 记录。
- **消费方示例**：`llm-retry` 执行器、预算/成本监控（rate limit 计数）、遥测错误分类、audit/safety（Safety Violations 指标供 D7 口径）。
- **关联机制/镜像**：记录：`llm/retry`；机制 `dsh-llm-retry`；`agent/request-error`。

### 5.D 工具与策略（Tool & Policy）

#### A12 BeforeTool（草案）
- **触发时机**：assistant 的每个 tool call 进入分发管线时——tool 级闸口；对照统一流水线 `tool/call → tools/pre-execute(waterfall: allow|deny|ask)`（DSH 行 303 / comparison.md H05 Proposed Spec）。
- **载荷字段**：`toolCallId`；`toolName`；`arguments`（原始 JSON）；`mode:'parallel'|'exclusive'`（独占=排序屏障，读并发/写串行纪律）；`restrictions:ToolRestriction[]`（allow/deny 过滤）；`policyHints:{sandboxMode?, approvalNeeded?}`；`parallelIndex?`。
- **flow**：`waterfall`——**决策闸口**：可 `deny(reason)`（拒绝文本回灌模型）；可 `ask()`（转 ApprovalRequest，见 A16）；可 `allow()` 并**改 arguments**（updatedInput 语义，Codex/Claude）；guard 单调收窄在全链后强制执行。Policy Engine、审批、沙箱解析均作为此事件链上的监听器（第 7 节）。
- **消费方示例**：Policy 规则引擎（allow/ask/deny 规则，deny 不可被更细 allow 豁免）、ToolGuard（单调否决）、审批请求器、沙箱模式解析（confine policy 逐调用派生，H08）、成本预算 deny、doom-loop 计数、外部 hooks（Claude `PreToolUse`、Codex `PreToolUse` 带 updated_input 重建 invocation）。
- **关联机制/镜像**：记录：`tool/call`；机制 `tools/pre-execute` + `ToolGuard`；D6 Policy Engine。

#### A13 PolicyDecision（新增，Policy 裁决事件）
- **触发时机**：BeforeTool 全链 + guard 收窄后、执行**前**，对每个走策略链的调用恰好一次；任务书 §8 执行链的 `Policy Engine → ALLOW/DENY` 落点。
- **载荷字段**：`toolCallId`；`toolName`；`verdict:'allow'|'deny'|'ask'`；`decisionPath:[{stage:'rule'|'hook'|'guard'|'approval'|'profile', ref:string, outcome:string}]`（可审计轨迹：命中规则 id/钩子名/guard 收窄/审批 id/profile）；`effectiveSandboxMode?`；`reason?`。
- **flow**：`emit`——裁决已定，监听器只观察（不改变结果；如需在裁决前介入应挂 BeforeTool）。
- **消费方示例**：审计（`audit/decision` 记录）、UI 透明展示（为何放行/拒绝）、evaluator 安全指标（Safety Violations）、审批缓存（ApprovedForSession 按 key 序列化，Codex）。
- **关联机制/镜像**：记录：`audit/decision`；机制：D6 Policy Engine 裁决序（denied_tools → deny → hook override → ask → allow → profile 比较，H07 共同抽象收敛）。

#### A14 AfterTool（草案）
- **触发时机**：工具体执行完成（成功或带错误值）、输出渲染为模型可见 ContentBlock 后；对照 `tools/post-execute(accept|block+feedback)` → `tools/result`（冻结权威结果）。
- **载荷字段**：`toolCallId`；`toolName`；`output:{content, error?, meta?}`（**canonical value 仅执行期存在，value 不入日志**——日志只存 content/error/meta，DSH 行 180）；`render:{inlineBytes, spilled?:{path, truncated}}`（源头限流：默认 inline 16KiB、溢出 spill 落盘给预览+路径）；`durationMs`；`sandboxEnforcement?`。
- **flow**：`waterfall`——工具**已执行**，本事件拒绝的是「结果」不是「执行」（Codex 明示，行 103）：可 `block(reason)`（把结果作废、feedback 文本回灌模型）、可**改载荷**：替换模型可见输出（updatedToolOutput）、注入 `additionalContext`（附加上下文）、标记 spill/截断状态。
- **消费方示例**：敏感输出脱敏/改写、上下文注入（文件变更摘要 attach）、预算/令牌记账、doom-loop 状态复位（成功即清零计数）、外部 hooks（Claude `PostToolUse`、Codex `PostToolUse`）。
- **关联机制/镜像**：记录：`tool/result`（冻结、入会话、下一步据此重新派生历史）；机制 `tools/post-execute`、`tools/result`。

#### A15 ToolError（草案，错误恢复）
- **触发时机**：工具执行失败（抛出/非零退出/超时/沙箱拒绝/参数无效/MCP 崩溃）时，在 AfterTool 的 error 分支触发。
- **载荷字段**：`toolCallId`；`toolName`；`errorClass:'INVALID_ARGS'|'TOOL_FAILURE'|'SANDBOX_DENIAL'|'RUNNER_FAILURE'|'TIMEOUT'|'MCP_UNAVAILABLE'|'ABORTED_BEFORE_DISPATCH'`；`toolFailure?:{message, info}`（H05 error_contract）；`feedback`（回灌模型的错误文本，可被监听器改写）；`retryHint?:'retry'|'rewrite'|'escalate'|'terminal'`。
- **flow**：`serial`——**不可阻断**错误回灌（错误必须回到模型或终结路径），监听器按序追加副作用：错误分类计数、doom-loop 计数（同工具同输入 ≥3 转权限询问）、升级重试登记（沙箱拒绝且允许升级 → 二次审批带 `retry_reason` 以更宽松沙箱重试，Codex）、失败归档。
- **消费方示例**：错误分类器（INVALID_ARGS 回模型自修复 vs ToolFailure 可继续/终结两类的映射）、遥测、audit/denial（沙箱拒绝记录）、MCP 重连器。
- **关联机制/镜像**：记录：`tool/result`（error 变体）；机制 H05 error_contract、H08 失败分类（runner 失败 vs denial 先判 runner 再判拒绝）。

#### A16 ApprovalRequest（新增，审批）
- **触发时机**：BeforeTool 链裁决为 `ask`（策略或钩子要求人工/机器确认）时，在等待应答前**先落 `approval/asked` 再等待**（先持久后等待）；对照 DSH `ctx.approval.request()` → `approval/request` waterfall（行 239–243）。
- **载荷字段**：`requestId`；`resource:{toolName, summary（描述性摘要，不含密钥/敏感原文）, argsDigest?}`；`policySnapshot:'ask'|'never'`；`requesterAgentId`；`delegationDepth`；`cacheKey?`（ApprovedForSession 会话级缓存键）。
- **flow**：`waterfall`——应答者（UI 人类 / ACP 机器监听器）可短路作答；**无应答者 = unavailable = 拒绝（fail closed）**；`never` 策略在分发前服务内强制拒绝，应答者也绕不过。
- **消费方示例**：CLI 审批弹窗、ACP 机器应答者、权限规则追加（用户批准后追加 allow 规则，Codex proposed_execpolicy_amendment 思路）。
- **关联机制/镜像**：记录：`approval/asked`；机制：DSH `approval/request`、`approval/asked|decided` 审计对、`ApprovalPolicy`；Codex 审批缓存/二次审批。

#### A17 ApprovalDecided（新增，审批审计）
- **触发时机**：审批有最终决定时（无论谁裁决、是否超时、是否无人应答），恰好一次；与 A16 构成审计事件对（`approval/asked → decided` 完整证据链，DSH 行 227/263）。
- **载荷字段**：`requestId`；`decision:'allowed-once'|'allowed-session'|'rejected'|'cancelled'|'unavailable'`；`responder:'human'|'machine'|'policy-never'|'timeout'|'none'`；`cacheUpdated?:boolean`（allowed-session 写入会话级缓存）；`reason?`。
- **flow**：`emit`——决策已定，只观察；结果语义由 loop 强制执行（allowed-once 放行本次、rejected/cancelled/unavailable 一律拒绝并 fail-closed 回灌模型）。
- **消费方示例**：审计证据链闭合、决策缓存（ApprovedForSession）、UI 通知、D7 指标（Autonomy=人工介入次数）。
- **关联机制/镜像**：记录：`approval/decided`；机制：DSH `approval/decided`；fail-closed 语义（H07 共同抽象）。

### 5.E 文件与命令 seam（Write / Shell）

#### A18 BeforeWrite（草案，文件写 seam）
- **触发时机**：写类文件工具（write/edit/apply_patch）真正触碰文件系统**前**；文件边界守卫主闸口。
- **载荷字段**：`writeId`；`toolName`；`targetPath`（**canonical 化后**：拒绝 `../` 与 symlink 逃逸，先 fs 语义规范化再词法，H08 逐调用策略）；`op:'create'|'overwrite'|'patch'`；`content`/`diff`（将写入内容或补丁）；`sizeBytes`；`guardFlags:{exists, protectedPath:boolean, readOnlyMode:boolean}`；`scope:{workspaceRoot}`。
- **flow**：`waterfall`——可 `deny(reason)`（受保护路径如 `.git/.ssh/凭据/配置` 写保护不可豁免，H07 共同抽象）；可**改载荷**：改写将写入内容（格式化器/注入头/模板展开/脱敏）。执行纪律：**写类工具串行**（读并发/写串行），独占屏障由此事件所在 step 的调度保证。
- **消费方示例**：文件边界守卫（canonical 化 + 受保护路径 deny + 读写上限 10MiB + NUL 二进制检测，H05 file_guards）、格式化器、内容注入器、doom-loop/checkpoint（只跟踪文件编辑工具做 checkpoint 快照）、外部 hooks（Claude `PreToolUse` 的文件写分支）。
- **关联机制/镜像**：机制：H05 file_guards、H08 fs 边界；记录：无独立记录（成败由 `tool/result` 捕获）；checkpoint 由 AfterWrite 触发。

#### A19 AfterWrite（草案）
- **触发时机**：写类工具成功落盘后（与写失败分支区分：写失败走 ToolError）。
- **载荷字段**：`writeId`；`toolName`；`targetPath`；`bytesWritten`；`diffPreview`/`resultHash`；`checkpoint?:{op, newState?}`（checkpoint 候选：每用户 prompt 建的快照只跟踪文件编辑，Claude checkpointing）。
- **flow**：`serial`——**不可拦截回滚**（已落盘是事实）；监听器按序追加副作用：checkpoint 登记、变更通知（FileChanged 语义）、索引/搜索更新、依赖图失效标记。
- **消费方示例**：checkpoint 管理器（/rewind 数据源）、文件监视器（通知主会话「关键文件被修改」以注入下一步上下文）、git 状态感知。
- **关联机制/镜像**：机制：Claude `FileChanged`、checkpointing；记录：`tool/result`。

#### A20 BeforeShell（草案，命令 seam）
- **触发时机**：shell/bash/pwsh 工具执行命令**前**（解析出可执行 argv 后、派生 sandbox 策略前）；命令级闸口。
- **载荷字段**：`shellId`；`commandLine`；`argv`；`classification`（只读识别：git 子命令门控、重定向/就地改写标志/命令链标记——字符串解析仅作只读命令识别，Claw/Claude 纪律，H05 comparison 行 330）；`sandboxRequest:{mode, networkPolicy?, allowedMounts?}`；`workdir`；`envPolicy?`。
- **flow**：`waterfall`——可 `deny(reason)`（危险命令前缀黑名单、deny 规则命中、策略 `never` 强制）；可 `ask()`（转 ApprovalRequest）；可**改载荷**：改写 argv/env、收紧 sandboxRequest、注入凭据出站（凭据 mask + 代理出站注入）。
- **消费方示例**：危险命令黑名单（is_dangerous_command 前缀集合：destructive-delete/disk-format/partition-write 等，任务书 §8）、命令 allowlist、沙箱策略解析（`ctx.sandbox.confine(argv, policy)` fail-closed：无后端 SANDBOX_UNAVAILABLE，H08）、网络策略决策（代理/MITM + allowlist）、外部 hooks。
- **关联机制/镜像**：机制：H07 命令分类/allowlist、H08 confine、exec_delegate Operations 注入点（SSH/容器重定向 seam，H05 Proposed Spec）；记录：`tool/call` + `audit/denial`。

#### A21 AfterShell（草案）
- **触发时机**：命令进程结束（正常/非零退出/超时被杀）后、输出限流渲染前。
- **载荷字段**：`shellId`；`exitCode`；`stdoutBytes`/`stderrBytes`（**源头限流 16KiB 默认**，溢出 spill 落盘给预览+路径）；`sandboxStatus?:{enabled, enforcement:'full'|'partial'|'none', fallbackReason?}`（enforcement partial 透明上报，绝对边界消费方必须拒绝或暴露差异，H08）；`timeoutMs?`。
- **flow**：`parallel`——无依赖并行观察（读型并行、输出多消费者各自处理；写类/独占命令的串行由调度保证）；不可改主结果。
- **消费方示例**：输出截断/spill 管理器、终端 UI 增量显示、沙箱状态回填（ConfinedArgv/SANDBOX_UNAVAILABLE 分类：先判 runner 失败再判命令被拒）、遥测。
- **关联机制/镜像**：记录：`tool/result`；机制：H08 失败分类、H05 输出源头限流。

### 5.F 委派（Subagent / Delegate）

#### A22 BeforeDelegate（草案）
- **触发时机**：模型调用 subagent/subagent_fork 工具、服务端校验能力 flag 后、派生子会话**前**（H11 Proposed Spec：capability_flags 缺能力即 UNSUPPORTED_CAPABILITY 拒绝，绝不接受后忽略）。
- **载荷字段**：`delegateId`；`toolName`；`request:{prompt, agentType/preset, options:{forkSource?, outputSchema?, toolFilter?, model?, depthLimit?}}`；`delegationDepth`（持久，父+1，冷恢复不降低）；`concurrencyState:{activeChildren, maxConcurrent}`；`parentContextBudget?`。
- **flow**：`waterfall`——可 `deny(reason)`（深度/并发上限、工具/模型不可用、权限收窄校验失败——子代理配置只能收窄父能力永不放大，roles_shrink_only）；可**改载荷**：改 prompt、收紧 toolFilter、注入父上下文片段（fork 窗口 FullHistory/LastNTurns 选择）。
- **消费方示例**：委派调度器（spawn slot 预留）、上下文信息隐藏过滤（父只见结果不见子中间过程）、预算/并发控制、外部 hooks（Claude `SubagentStart` 可注上下文）。
- **关联机制/镜像**：机制：H11 seam+provider、depth 校验；记录：`tool/call`（subagent 工具调用）。

#### A23 SubagentStart（新增）
- **触发时机**：子会话成功创建并开始运行后（BeforeDelegate 放行、provider.start() 返回 run 句柄时）。（对照 dsh `subagent/start`，emit 仅观察，行 212。）
- **载荷字段**：`delegateId`；`childAgentId`；`childSessionId`；`preset`；`isContinuable:boolean`（预留稳定 childId → send_message/interrupt/list_agents）；`forkSource?`。
- **flow**：`emit`——fire-and-forget 观察（子代理独立跑，父循环不阻塞等待，除非显式 wait）。
- **消费方示例**：子代理树 UI/清单（list_agents）、资源监控、遥测、审计（谁派生谁）。
- **关联机制/镜像**：`subagent/start`（DSH）；`SubagentStart`（Codex/Claude）；记录：`session/created`（子会话）。

#### A24 SubagentStop（新增，结果回传）
- **触发时机**：子会话结束（completed/error/aborted/max_tokens/refusal）且结果契约已冻结时；父侧看到的结果是摘要/结构化结果而非中间过程（info_hiding，H11）。
- **载荷字段**：`delegateId`；`childAgentId`；`childSessionId`；`result:{output（最后非空 assistant 消息|累计流）, structured?（outputSchema 捕获即校验）, diagnostic?, stopReason:'completed'|'aborted'|'error'|'max_tokens'|'refusal'}`；`isError:boolean`（stopReason≠completed 一律 isError，H11 行 729）；`durationMs`；`delegationDepth`。
- **flow**：`emit`——fire-and-forget 观察；结果回灌路径由 loop 接管（作为子代理工具结果注入父上下文/通知父等待方），本事件不改变回传内容。
- **消费方示例**：父侧完成通知、结果 schema 校验留痕、子代理审计（SubagentStop hook 拦截，Codex 行 192）、后台完成注入器。
- **关联机制/镜像**：`subagent/end`（DSH）；`SubagentStop`（Codex/Claude）；记录：`tool/result`（subagent 工具结果契约）。

#### A25 AfterDelegate（草案）
- **触发时机**：子代理结果已注入父上下文（作为 `tool/result` 可见）之后；委派闭环完成点。
- **载荷字段**：`delegateId`；`toolCallId`；`result`（同 A24，视图给父模型）；`followUp?:{continuable:boolean, canSendMessage:boolean}`（可继续子代理：running→steer / waiting→唤醒 / 无→冷恢复再 steer）。
- **flow**：`serial`——顺序追加副作用：delegationDepth 记账、并发槽释放、continuation 管理器注册/唤醒（后续 send_message 走工具通道）。
- **消费方示例**：并发槽调度、可继续子代理管理（continuable 管理器）、目标/预算记账（委派是否算入 maxStepsPerTurn，v0.2 定义）。
- **关联机制/镜像**：机制：H11 continuable/send_message/interrupt；记录：`step/end`（含委派的 step 关闭）。

### 5.G 压缩（Compaction）

#### A26 BeforeCompact（草案）
- **触发时机**：**任何**压缩入口实际执行摘要前——压力自动（在 BeforeModel 压力检查命中 `thresholdRatio:0.8×contextWindow`）、溢出恢复（ModelError `CONTEXT_WINDOW_EXCEEDED` 先压再试）、手动 `/compact`（可带 focus 指令）、轮间 idle maintenance（H04 Proposed Spec 三入口）；压缩**先落 `compaction/start` 锁再执行**（先持久后等待，锁语义见 B14）。
- **载荷字段**：`trigger:'pressure'|'overflow'|'manual'|'post-turn'`；`context:{estimatedTokens, contextWindow, activeScope?}`；`regionPlan?:{startSeq, endSeq, retainTailTokens}`（最旧平衡 surface 范围，tool call/result 必须配对）；`focus?`（/compact 焦点指令）；`retryOf?:number`（溢出重试计数 ≤ maxOverflowRetries）。
- **flow**：`waterfall`——可**拦截**：终止压缩（如 evaluator/外部归档进程拒绝）→ 跳过本轮压缩并记账；可**改载荷**：改 regionPlan、注入归档指令（PreCompact 先归档完整 transcript 再压缩，Claude 行 120）、附加 summarizer_hint（保留清单：用户请求/检查修改过的文件/未完成任务/调用过的 skill 限量重注入，H04 Proposed Spec）。
- **消费方示例**：归档器、transcript 导出、外部 hooks（Claude/Codex `PreCompact`）。
- **关联机制/镜像**：记录：`compaction/start`；机制：H04 事务化压缩、tool-result-pruner（压缩前先修剪超长结果，thresholdChars 8192/head 4096/tail 1024，无模型调用）。

#### A27 AfterCompact（草案）
- **触发时机**：压缩完成、surface replace 已落地（`compaction/end` 已落盘）之后；压缩**不新建会话**（同一日志原地替换，`session/end-seed` 边界不丢，H04）。
- **载荷字段**：`trigger`；`replaced:{startSeq, endSeq}`；`summarySeq`；`summaryText`（摘要全文，仅供旁路消费者；模型可见面是 `<compacted-summary>` user/message + surfaceOp:replace）；`obscuredTokens`；`reloadPlan?:{reloadInstructions:boolean, rereadFiles:<=5, reinjectSkills:<=5000 token/个}`。
- **flow**：`serial`——顺序追加副作用：启动层重载（指令基线/技能目录索引/MCP 工具名）、关键文件重读、技能正文限量重注入、压缩后**健康探针**注册（下一轮探针失败 → 拒绝该轮并提示新会话，Claw 纪律，行 41/232）、auto-continue 提示注入（合成 "Continue if you have next steps…"，可关）。
- **消费方示例**：上下文重建器、token 账目、健康探针、缓存统计。
- **关联机制/镜像**：记录：`compaction/end`（恰好一次）、`compaction/summary`；机制：H04 continuation/auto-continue。

### 5.H 团队（Team，task 057 新增三个 emit 扩展事件）

> **实现注记（057，TeamRuntime/TeamProjection 落地）**：多 Agent 协作运行时（§8.2：小→1 /
> 中→2 / 复杂→3 个 preset 化 Agent）需要把"一次团队运行"的编排事实表达为可订阅事件。
> 按 §10.3.5「新增事件须走声明合并 + 本文件修订」规矩，新增三个 emit 事件（`@vessel/shared`
> `EventType` 成员 + 载荷类型，flat 命名沿用本仓库惯例）；**成员回合/工具/delegate 一律复用既有词汇**，
> 不复制 loop 事件。设计取舍与理由见 docs/TEAM-RUNTIME.md §5（新增 `team_phase` 的原因：既有
> turn 事件载荷不带成员/会话身份，需要阶段-成员激活锚点做事件归属）。

| # | 事件 | 触发时机 | 载荷要点 | flow | 镜像/复用 |
|---|---|---|---|---|---|
| T01 | `team_start` | 团队运行开始（阵容快照） | `teamRunId/task/complexity?/roster[]`（roster 行=memberId/presetId/role/tier?/model/providerId） | emit | 成员会话 B10 `session/created{source:'team'|'subagent', agentPreset, parentSession}` |
| T02 | `team_phase` | 每个成员阶段开始（成员激活/阶段切换锚点） | `teamRunId/ordinal/phase('orchestrate'\|'generate'\|'evaluate')/memberId/presetId/role/delegateOf?/promptPreview?` | emit | 阶段事件后的 `before_turn/after_turn/after_tool` 归当前成员窗口 |
| T03 | `team_end` | 团队运行收尾（逐成员摘要） | `teamRunId/outcome('completed'\|'failed')/members[]`（含 sessionId/parentSessionId/delegationDepth/status/output/stopReason）/durationMs/error? | emit | 成员阶段行闭合、delegate 行（A23/A24）闭合 |

- **成员回合/工具/产出**：不新增事件 —— top-level 成员会话跑在团队共享 EventBus 上
  （`IsolatedRuntimeOptions.bus` 注入），`before_turn`/`after_turn`/`after_tool` 原样流转，
  TeamProjection 以 `team_phase` 窗口归属到成员；delegate 子代理（复杂阵容 lead 的
  developer/reviewer）按 info-hiding 惯例只以 A23/A24（`subagent_start/stop`）上团队总线。
- **持久记录**：不新增 B 记录 —— 成员出处用既有 B10（source 扩展 `'team'` 判别值 +
  `agentPreset`/`parentSession`/`delegationDepth` 区分成员）；编排事实（team 事件）为瞬态
  扩展事件（同其余扩展事件"镜像记录落在成员会话日志"的语义）。

---

## 6. 自动持久记录清单（21，会话日志）

> 设计约束：日志=唯一真源；surface 派生模型历史只投影三种记录（`user/message`、`assistant/message`、`tool/result`，DSH 行 107）；边界/审计/账目记录不产生消息但可回放、可做不变式校验（H12 invariant_selfcheck）。所有记录含 §4 通用字段。

- **B01 `user/message`** —— 用户输入/排队消息/注入上下文（带 `source` 区分生产方：user/steering/inject/skill-instructions/compacted-summary/plan（V0.2 新增：Planner 注入的 Plan 一等对象）/memory（V0.3 新增：Project Memory 冻结快照注入）），`surface:true`。触发：BeforeTurn 放行批次、`agent.inject()` 队列化消息在下一次获准 pre-step 进入。可被压缩 replace。
- **B02 `assistant/message`** —— 模型纯文本终态（无未决 tool_call），`surface:true`，含 `finishReason`。
- **B03 `assistant/attempt`** —— 模型**尝试**（含中间产物或被 `interrupted:true` 前缀打断的流），`surface:false`；与 B02 关系：终态 message 覆盖尝试（DSH 词汇）。
- **B04 `tool/call`** —— 每个进入分发的工具调用，`surface:false`（原始 arguments JSON，供配对不变式）。字段：`toolCallId, toolName, arguments, mode`。
- **B05 `tool/result`** —— 冻结权威结果，`surface:true`（下一步据此重新派生历史）；只存 `content/error/meta`（canonical value 不入日志）；`error` 变体覆盖 ToolError 失败；子代理结果契约（output/structured/stopReason）也落此。
- **B06 `step/start`** / **B07 `step/end`** —— 步骤边界（不产生消息）；配对不变式（回放校验：编号连续、tool 配对、retry 记录）。
- **B08 `turn/start`** / **B09 `turn/end`** —— 轮次边界（`turn/end {kind: success|error|interrupted|budget}`，崩溃恢复在 resume 时合成 `interrupted` 关闭器）。
- **B10 `session/created`** —— 会话创建（含 `parentSession`/`isSeeded`/`delegationDepth`/`origin:'subagent'` 等 header 元数据存日志旁）；回滚保护：setup 失败不发布任何 id。
- **B11 `session/end-seed`** —— 种子边界标记（fork = seed 前缀 + 谱系；压缩不丢此边界）。
- **B12 `request/header`** —— 每个冻结请求的全量 envelope（system/messages/tools/配置/适配器默认值），可 `foldRequestHeader` 重建请求；「模型可见 ⟺ 已记录」不变式落点（DSH 原则 1，行 43/320）。
- **B13 `llm/retry`** —— 每次重试决策在等待前落盘（先持久后等待）：`{requestId, kind, attemptNo, backoffMs, decision:'retry'|'fallback'|'abort'}`。
- **B14 `compaction/start`** —— 压缩锁（先记账后执行；崩溃=可检测锁 `busy`，早于 `session/end-seed` 的陈旧锁忽略）。
- **B15 `compaction/summary`** —— 摘要全文（仅日志，模型可见面是 replace 后的 summary user/message）；`sourceEventSeqs` 覆盖被遮蔽节点。
- **B16 `compaction/end`** —— 恰好一次的结束标记（配对：start→summary+replace→end）。
- **B17 `approval/asked`** / **B18 `approval/decided`** —— 审批审计对（先持久后等待：等待前先落 asked；decided 闭合证据链，fail-closed 无应答=unavailable=拒绝）。
- **B19 `audit/decision`** —— PolicyDecision 的持久镜像（verdict + decisionPath 决策轨迹），可审计「为什么放行/拒绝」。
- **B20 `audit/denial`** —— 硬拒绝记录（Policy deny、沙箱 SANDBOX_DENIAL、never 审批、写保护 deny）：`{toolCallId, stage, ruleRef?, reason, sandboxMode?}`；D7 口径（Safety Violations）与 Evaluator 证据。
- **B21 `audit/safety`** —— 人为介入/紧急事件留痕（Interrupt、Esc、审批人工决定、steer）：`{kind, actor:'user'|'machine'|'system', detail}`；Audit Log 事实基础（任务书 §2.3、H07 证据链）。

---

## 7. 与 Policy Engine 的衔接（D6 接线约定）

### 7.1 任务书执行链的落地映射

```text
任务书 §8 执行链                EVENT-SPEC 落地
Agent → Tool Call        →    AfterModel(A10) 产出 toolCalls → 每调用落 tool/call(B04)
→ BeforeTool             →    BeforeTool(A12) waterfall（决策闸口）
→ Policy Engine          →    Policy 规则引擎作为 A12 监听器：裁决序 denied_tools → deny 规则 → hook override → ask → allow → profile
→ ALLOW / DENY           →    guard 单调收窄 + A13 PolicyDecision(emit) + audit/decision(B19)
   （ask 分支）           →    ApprovalRequest(A16) → approval/asked(B17) → 应答 → ApprovalDecided(A17) → approval/decided(B18)
→ Runtime                →    sandbox confine（A20 BeforeShell / 工具执行）→ AfterTool(A14)
→ Audit                  →    audit/denial(B20) / audit/decision(B19) / audit/safety(B21)
```

### 7.2 边界与责任

1. **Policy Engine 不在事件面内，而是 BeforeTool 链上的权威监听器**（与 BeforeTool → Policy Engine → ALLOW/DENY 顺序一致）；D6 定义规则/裁决序/profile，本规范只定义挂载点与证据事件。
2. **guard 单调**：waterfall 全链可 allow/deny/ask，guard 收窄后任何监听器不得放宽；`never` 策略在 waterfall 分发前服务内强制（DSH 纪律），`ask` 无应答者 fail-closed 拒绝。
3. **软/硬分离不变**：Behavior IR 编译产物经 BeforeModel/BeforeTool 注入引导（软）；强制走 Policy/审批/沙箱（硬），prompt 段不产生 Audit 事实，只有执法路径产生（D1 结论 4a、任务书 §2.3）。
4. **deny 反馈循环纪律**：deny 文本回灌模型后可继续（模型改写），但**同调用连续 deny ≥3 次即终结该意图路径**（denial breaker/doom-loop 纪律，Hermes/OpenCode），避免死循环追问。

---

## 8. 一轮完整 turn 的事件流（文本时序图）

v0.1 主流程（V0.1 平面：单 agent、无委派；`[V0.2]` 标注子代理/委派步骤；`{}` 为可选/条件分支）：

```text
── Session 生命周期 ──────────────────────────────────────────────
 SessionStart (A01, source=startup)                 【new-session | resume | ...】
   └→ 记录 session/created (B10) + 装载指令基线(user/message) + [fork: session/end-seed (B11)]

── Turn N ─────────────────────────────────────────────────────────
 BeforeTurn (A03)  ── waterfall：admission / steering 注入 / plan 标记
   └→ 记录 turn/start (B08)；放行批次落 user/message (B01)

 step S1 ───────────────────────────────────────────
   BeforeModel (A07) ── waterfall：组装 system+tool schema+历史
     {压力命中 thresholdRatio 0.8 →
        BeforeCompact (A26) → compaction/start (B14)
          → (摘要 LLM 旁路请求: request/header B12) → compaction/summary (B15)
          → surface replace → AfterCompact (A27) → compaction/end (B16) }
   ModelRequest (A08) → 记录 request/header (B12)
   ModelStream (A09)  start / delta* / reasoning* / end      [stream]
   AfterModel (A10) ── waterfall：校验/脱敏；产出 toolCalls 或纯文本
     └→ 纯文本 → 落 assistant/message (B02) → step/end (B07) → BeforeStop
     └→ toolCalls → 落 assistant/attempt (B03)

   每个 tool call ──────────────────────────────────
     记录 tool/call (B04)
     BeforeTool (A12) ── waterfall：Policy 规则 / 审批 / 沙箱解析
       ├─ deny ──→ PolicyDecision deny (A13) → audit/denial (B20)
       │           → 拒绝文本回灌模型 → AfterTool(denied 结果) → ToolError 分类(可继续)
       ├─ ask ───→ ApprovalRequest (A16) → approval/asked (B17)
       │           → [应答: 人工/机器] → ApprovalDecided (A17) → approval/decided (B18)
       │             └─ allowed-once → 继续；rejected/cancelled/unavailable → 拒绝(fail-closed)
       └─ allow ──→ PolicyDecision allow (A13) → audit/decision (B19)
     [写文件: BeforeWrite (A18) → fs 守卫 → 执行 → AfterWrite (A19, checkpoint)]
     [命令:   BeforeShell (A20) → sandbox confine → 执行 → AfterShell (A21)]
     AfterTool (A14) ── waterfall：accept/block+feedback/附加上下文
       └→ 记录 tool/result (B05, 冻结, surface)
     {执行失败 → ToolError (A15) → 分类/重试登记/doom-loop 计数}
     {ModelError (A11) → llm/retry (B13) → 退避重试 | fallback | CONTEXT_WINDOW_EXCEEDED→压缩}
     step/end (B07) → 仍欠工作 → 下一步 step S2 (循环 BeforeModel ...)

 ── 收尾 ──────────────────────────────────────────────────────────
 {无未决 tool_call && 无新输入} →
 BeforeStop (A04) ── serial：预算/evaluator/doom-loop 裁决
   ├─ forceContinue(reason) → 强制再执行一步 → 回到 step 循环
   └─ 同意停 ──→ 记录 turn/end (B09, kind=success)
 {Esc/信号} → Interrupt (A05) → 在飞工具取消/流打断(interrupted:true) → turn/end kind=interrupted
 AfterTurn (A06) ── emit：evaluator(/goal) / 轮末压缩检查 / checkpoint / 指标
 {AfterTurn evaluator 判定 not_met → 下轮 continue}
 {预算耗尽} → turn/end kind=budget

── 委派（V0.2 平面）───────────────────────────────────────────────
   [模型调 subagent 工具 → AfterModel toolCalls]
   BeforeDelegate (A22) ── waterfall：深度/并发/权限收窄校验
   SubagentStart (A23) ── 子会话独立跑（自己 SessionStart...turn...AfterTurn）
     {子会话崩溃恢复 = resume 重放 + 合成 interrupted 关闭器}
   SubagentStop (A24, 结果契约冻结) → 结果注入父上下文 (tool/result)
   AfterDelegate (A25) ── serial：槽释放 / continuation 注册

── Session 关闭 ───────────────────────────────────────────────────
 SessionEnd (A02, reason=disposed|user-exit|...) → 归档/遥测/retention
```

不变式（贯穿全图）：`turn/start→turn/end`、`step/start→step/end`、`tool/call→tool/result`、`approval/asked→decided`、`compaction/start→…→end` 全部配对且编号连续；任一缺失 = 日志腐败（H12 invariant_selfcheck 捕获）。

---

## 9. 错误与恢复语义总表（Error/Recovery）

| 失败面 | 事件 | 恢复动作 | 持久证据 |
|---|---|---|---|
| 模型请求失败（限流/服务端/超时/空响应/传输） | ModelError（retry） | 指数退避+抖动 ≤5 次；fallback chain | `llm/retry` |
| 模型请求失败（auth/model/无适配器） | ModelError（abort） | 不重试 → `turn/end {kind:'error'}` | `turn/end` |
| 上下文溢出 | ModelError（CONTEXT_WINDOW_EXCEEDED） | BeforeCompact 先压再试（overflowRetries≤1） | `compaction/start…end` |
| 内容过滤/毒化输出 | AfterModel（veto） | 回灌修正重试（≤attempt 上限） | `assistant/attempt` |
| 工具失败（执行/超时/MCP） | ToolError | INVALID_ARGS 回模型自修复；ToolFailure 可继续/终结分类 | `tool/result{error}` |
| 沙箱拒绝（denial vs runner） | ToolError（SANDBOX_DENIAL/RUNNER_FAILURE） | 可升级→二次审批（retry_reason）以更宽松沙箱重试；否则 deny 文本回灌 | `audit/denial` |
| 审批无应答/拒绝/取消 | ApprovalDecided（unavailable/rejected/cancelled） | fail-closed 拒绝 | `approval/decided` |
| 用户打断（Esc/信号） | Interrupt | 协作式取消：未分发工具 ABORTED_BEFORE_DISPATCH、流 interrupted:true | `turn/end{interrupted}` |
| 崩溃/进程死亡 | （resume 时） | 重放日志 + 合成 `interrupted` 关闭器（不截断长轮次） | `turn/end{interrupted}` 合成 |
| 压缩后健康探针失败 | AfterCompact | 拒绝该轮并提示新会话（不空转） | `compaction/end` + 诊断 |
| 钩子/监听器异常 | `handler_error`（诊断） | 记错误，绝不崩轮次；热路径超时上限 | 诊断事件（不入主表） |
| 连续拒绝死循环 | BeforeTool/ToolError 计数 | denial breaker：同意图连续 deny ≥3 次终结该路径 | `audit/denial` |

---

## 10. v0.1 范围声明与实现分期

### 10.1 本规范内

- **事件面定全**：第 2 节 48 个具名事件全部给出定义（名称/触发/载荷/flow/消费方），供 D8 落模块边界、供第三阶段按分期装载——**先定义全、再按功能平面启用**，避免 v0.1 结束后补事件撕裂架构。
- **装载规则**：扩展事件（表 A）与持久记录（表 B）的**装载按 V0.1/V0.2 功能平面**（任务书 §10/§11）：非当期平面的事件卡仍具名定义、总线实现预留，但不默认注册触发（见 10.2）。

### 10.2 分期装载矩阵

| 事件/记录 | V0.1（§10：CLI/单 agent/6 工具/Event Bus/Policy/Evaluator） | V0.2（§11：Subagent/MCP/Planner） |
|---|---|---|
| 会话：SessionStart/End、session/*、audit/* | 装载（CLI 会话 + 审计） | — |
| 轮次：BeforeTurn/BeforeStop/Interrupt/AfterTurn、turn/* | 装载 | — |
| 模型：BeforeModel/ModelRequest/ModelStream/AfterModel/ModelError、request/header、assistant/*、llm/retry | 装载 | — |
| 工具：BeforeTool/AfterTool/ToolError/PolicyDecision/ApprovalRequest/ApprovalDecided、tool/* | 装载（Policy 接线 + ApprovalPolicy=never 先落地，ask 交互后置） | — |
| 文件/命令：BeforeWrite/AfterWrite/BeforeShell/AfterShell | 装载（H05 file_guards + H08 sandbox 基础） | — |
| 压缩：BeforeCompact/AfterCompact、compaction/* | 装载（Basic Compaction，H04） | — |
| 委派：BeforeDelegate/SubagentStart/SubagentStop/AfterDelegate | 事件面定义，**不装载**（subagent 工具 V0.2） | 装载 |
| MCP 动态注册触发 | — | 事件面复用（tool/call 等），仅注册表不同 |

### 10.3 明确不做（留 v0.2+）

1. **不实现异步钩子 + rewake**（Claude asyncRewake）：v0.1 钩子同步跑、带超时上限（comparison.md H06 Proposed Spec `async_hooks` 列为后续）。
2. **不实现 prompt/agent 型 handler**（Claude 五形态中的 prompt/agent 型非确定性决策）：保留给 evaluator 层扩展而非 hook 语义（H06 Rejected）。
3. **不做跨进程事件总线/事件溯源**（Hermes 缺口、Pi EventV2 SSE 形态不进入单进程内核）：v0.1 模块化单体、单进程事件总线（任务书 §9 禁止提前微服务化）。
4. **不把审批 ask 交互作为默认装配**：V0.1 ApprovalPolicy 默认 `never`（确定性拒绝），`ask` 形态与 ACP 机器应答者随交互 UI 后置；fail-closed 语义不变。
5. **不扩展事件表之外的新事件种类**：事件面收敛，新增事件须走声明合并 + 本文件修订（DSH declaration merging 纪律）。

---

## 附录 A：任务书草案 16 事件 → 本规范对照

| 任务书草案（H06，行 339–361） | 本规范条目 | 组 | flow | 状态 |
|---|---|---|---|---|
| BeforeTurn | A03 | 轮次 | waterfall | 保留（含 reject/enter 语义） |
| BeforeModel | A07 | 模型 | waterfall | 保留（+系统提示组装/压力检查位） |
| AfterModel | A10 | 模型 | waterfall | 保留（+veto/改载荷） |
| BeforeTool | A12 | 工具与策略 | waterfall | 保留（决策闸口） |
| AfterTool | A14 | 工具与策略 | waterfall | 保留（拒绝的是结果不是执行） |
| ToolError | A15 | 工具与策略 | serial | 保留（错误恢复） |
| BeforeWrite | A18 | 文件写 seam | waterfall | 保留（fs 边界守卫） |
| AfterWrite | A19 | 文件写 seam | serial | 保留 |
| BeforeShell | A20 | 命令 seam | waterfall | 保留（命令闸口） |
| AfterShell | A21 | 命令 seam | parallel | 保留 |
| BeforeDelegate | A22 | 委派 | waterfall | 保留 |
| AfterDelegate | A25 | 委派 | serial | 保留 |
| BeforeCompact | A26 | 压缩 | waterfall | 保留 |
| AfterCompact | A27 | 压缩 | serial | 保留 |
| BeforeStop | A04 | 轮次 | serial | 保留（Stop 裁决点） |
| AfterTurn | A06 | 轮次 | emit | 保留 |
| （无） | A01/A02 | 会话生命周期 | waterfall/emit | **新增**（Codex SessionStart/SessionEnd、DSH agent/session-start） |
| （无） | A05 | 轮次 | serial | **新增**（Codex Interrupt、DSH agent.cancel） |
| （无） | A08/A09 | 模型 | emit/emit | **新增**（DSH request/header、agent/assistant-stream） |
| （无） | A11 | 模型错误 | waterfall | **新增**（DSH agent/request-error、llm/retry） |
| （无） | A13 | 策略裁决 | emit | **新增**（任务书 §8 Policy Engine 裁决点） |
| （无） | A16/A17 | 审批 | waterfall/emit | **新增**（DSH approval/asked\|decided、fail-closed） |
| （无） | A23/A24 | 委派 | emit/emit | **新增**（DSH subagent/start\|end、Codex SubagentStart/Stop） |

## 附录 B：持久记录镜像映射

| 扩展事件 | 持久镜像记录 | 扩展事件 | 持久镜像记录 |
|---|---|---|---|
| A01 SessionStart | session/created（+装载 user/message） | A16 ApprovalRequest | approval/asked |
| A03 BeforeTurn | turn/start、user/message | A17 ApprovalDecided | approval/decided |
| A04 BeforeStop | （裁决后）turn/end | A13 PolicyDecision | audit/decision |
| A07 BeforeModel | （冻结后）request/header | A12 BeforeTool（deny） | audit/denial |
| A10 AfterModel | assistant/message / assistant/attempt | A05 Interrupt | audit/safety + turn/end |
| A14 AfterTool | tool/result | A26 BeforeCompact | compaction/start |
| A24 SubagentStop | tool/result（子代理契约） | A27 AfterCompact | compaction/end |

> 规律：**waterfall 改的是"将要发生"，记录存的是"已经发生"**；决策事件（A12/A13/A16/A17/A26）都有一对以上持久审计镜像——这正是「可审计、可回放」承诺的实现位（H07 approval/asked→decided 证据链、DSH 先持久后等待、审计事件）。

（完）