# Vessel Harness 架构整改与实施规范

> **文档编号**：VESSEL-ARCH-2026-01  
> **版本**：v1.0（建议稿）  
> **适用基线**：Vessel v0.10.0 相关设计图  
> **范围**：Harness 内核、运行状态、行为编译、上下文、权限、模型适配、子代理、可观测性和验证  
> **不包含**：Web UI 视觉与交互细节（见独立文档 `Vessel_Web_UI_UX_Improvement_Plan.md`）  
> **证据性质**：依据提供的五份 HTML 架构图及两轮对话中的架构审查意见；**尚未检查真实仓库、测试报告或运行日志**。文中“现状”专指设计图中的声明，“建议”均不是已实现功能。

---

## 0. 执行摘要：先建立可验证的运行语义

**总体判断**：保留模块化单体（modular monolith）、薄 Core、唯一 AgentLoop、EventBus、事件会话、Behavior IR L0→L4、Runtime Policy 和 Executor 复核。当前最需要整改的不是模块数量，而是这些模块之间缺少充分形式化的**事实源、状态机、授权、恢复与编译契约**。

### 决策摘要

| ID | 问题/目标 | 优先级 | 核心整改 | 出口条件 |
|---|---|---|---|---|
| ARC-01 | `append-only JSONL` 与“原地替换历史”语义冲突 | P0 | Event Log 与 Session Projection 分离 | 可重放、不修改原始事件、压缩失败无副作用 |
| ARC-02 | `runtime_policy` 缺少规则仅告警 | P0 | 强制约束 fail-to-compile；原子激活 | 缺失硬执法绝不启用 |
| ARC-03 | Run/Turn 的终止、取消和提交语义不够明确 | P0 | 形式化状态机与执行预算 | 终态唯一、强制继续不越过硬预算 |
| ARC-04 | 崩溃后工具副作用不确定 | P0 | Durable Execution / Effect Reconciliation | 重启不盲目重复执行有副作用的工具 |
| ARC-05 | 裸工具名和无作用域审批存在权限风险 | P0 | 规范化 Tool ID + 执行许可 + 参数绑定审批 | 未授权路径无法触发工具执行 |
| ARC-06 | Stable Context 只按 Session 缓存不充分 | P1 | 依赖版本化缓存与分层失效 | 配置变化及时生效且可审计 |
| ARC-07 | Behavior 兼容停留在文本级会失真 | P1 | 语义 IR + 兼容等级 + Conformance | 可区分导入、渲染、硬执法和验证 |
| ARC-08 | Provider 差异可能泄漏进 Core | P1 | Capability Contract + 统一流事件 | 增加 Provider 不修改 AgentLoop |
| ARC-09 | Compaction 缺少信息保全验证 | P1 | 守恒断言 + 摘要回溯链 | 任务意图、拒绝与调用配对均保留 |
| ARC-10 | Subagent / Team 易复制第二套 Loop | P2 | AgentInstance 配置化、任务树调度 | 复用同一个执行内核 |
| ARC-11 | 性能/审计/回放验证不闭环 | P1–P2 | Fault Injection + Golden Fixture + Telemetry | 每次发布具备回归证据 |

**实施总原则**：先立契约与测试，再改数据和运行时；不为实现这些功能而引入微服务，也不让 `core` import `memory/skills/sandbox/subagent` 的具体实现。

---

## 1. 事实依据、术语与评审边界

### 1.1 输入源（源图事实）

1. `vessel-architecture-overview.html`：`apps/cli`、`apps/local-server`、`apps/web` 经 `application/composeHarness` 组装；Core 为 `AgentLoop + EventBus + Session`；机制层包含 `llm/context/behavior/policy/tools/runtime`；扩展层包含 `agents/skills/memory/engine/telemetry`；`append-only JSONL` 被定义为会话事实源。
2. `vessel-turn-sequence.html`：`runTurn → before_turn(A03) → turn/start + user/message → before_model(A07) → Provider stream → after_model(A10) → before_tool(A12) → runTool → before_stop(A04) → turn/end → after_turn(A06)`；`before_tool` 权威裁决，Runtime 二次复核。
3. `vessel-behavior-pipeline.html`：L0 `behavior/ir`，L1 `behavior/resolver` deep-merge，L2 `llm/profiles`，L3 `behavior/compiler` 与 `policy_ref`，L4 `context/builder` 组装 `RequestEnvelope`；强制条目缺少 `policy_ref` 目前描述为“告警”。
4. `vessel-context-lifecycle.html`：A07 每步组装；稳定层“每会话一次”；pressure / overflow / post-turn 三入口；`compaction/start` 持久锁；最旧平衡区域改为摘要；`not_new_session`；工具调用与结果不拆对。
5. `vessel-policy-workflow.html`：`before_tool(A12)` 经过 Policy Engine 的六步裁决与 Guard 单调收窄；`deny/ask/allow` 三态；`approval=never` fail-closed；Executor 在实际执行时复核；审计包括 `audit/denial(B20)` / `policy_decision(A13)`。

### 1.2 概念边界（建议标准化）

- **Event Log**：不可变追加的持久事实，记录曾发生的决策和结果。
- **Projection / Surface**：由 Event Log 重建的、可版本化的会话视图；可按 Compaction 改变模型可见投影。
- **RequestEnvelope**：一次明确的模型请求快照，含输入、工具 schema、模型配置及溯源元数据。
- **Turn**：由一次用户输入启动、可能包含多次模型采样/工具调用的逻辑轮次。
- **Run**：一次可暂停、恢复、结束的执行实体。一个 Session 可包含多个 Run/Turn，具体一对多关系要在 schema 中固定。
- **Step / Attempt**：模型调用或工具调用的具体执行单元及其重试尝试。
- **Agent Preset**：可复用的配置声明；**AgentInstance** 是使用该声明运行的一次实例；**Subagent** 是受父任务授权并由同一 Runtime 执行的子实例。
- **Policy Decision**：对拟执行操作的三态裁决；**Execution Permit** 是绑定特定操作的验证凭证（建议实现）。

**不变量优先于模块实现**：对外暴露的术语、状态和事件字段一旦稳定，Web、CLI、工具、Provider 及子代理必须共同遵守。

---

## 2. 总体目标架构与依赖纪律

### 2.1 保留既有模块化单体

```text
apps/cli           apps/local-server           apps/web
    \                    |                       /
                  application/composeHarness
                             |
                    core (AgentLoop/EventBus/Session)
                      ^  contracts/events  ^
                      |                    |
        llm / context / behavior / policy / tools / runtime
                      |
        agents / skills / memory / engine / telemetry
```

> 箭头是概念关系，不代表文件夹间全部为直接 import。实际依赖方向应以类型契约与依赖检查测试定义。

### 2.2 新增“执行平台契约”，而非第二层业务 Core

建议在 `shared/contracts`（或项目现有等价位置）维护：

- `RunState`, `TurnState`, `StepState`, `ToolInvocation`, `EffectRecord`
- `SessionEventV1`, `ProjectionRevision`, `RequestEnvelopeV1`
- `EffectiveBehavior`, `ProviderCapabilities`, `PolicyDecision`, `ExecutionPermit`
- `AgentInstanceSpec`, `TaskLease`, `ApprovalRequest`

在 `application` 负责跨模块编排：能力快照装配、checkpoint 协调、recovery、模型调用和审批等待的服务接口。Core 本体只保留通用循环、事件与会话协议，避免复合业务逐渐回流 Core。

**禁止**：为不同模式创建独立的 Model→Tool→Model Loop；让 HTTP 控制器直接调用未经 Runtime/Policy 验证的工具；让 UI 在本地推导未经后端确认的成功状态。

---

## 3. ARC-01：Event Log 与 Session Projection 双层模型 [P0]

### 3.1 图中矛盾

架构图宣称 `append-only JSONL` 为唯一真源，但 Context 图又要求“同一会话日志内原地替换”。两者若均指**物理日志字节**则不能同时成立；如果“替换”只是逻辑 Surface 操作，则需要明确到数据契约。

### 3.2 目标不变量

1. 原始事件只追加，不物理改写已提交事件。
2. UI、Provider 历史、恢复流程均从相同的 Session Projection 规则读取数据。
3. 每次模型实际接收的输入必须可由**已记录事件和固定版本依赖**解释；机密内容不能因为可重建而被无保护持久化。
4. Compaction 提交新投影版本；不删除原始操作证据。
5. 同一 Session 中，多个运行并发更新必须以 revision/sequence 约束冲突。

### 3.3 提议数据结构（示意，并非既有 API）

```ts
interface SessionEventV1 {
  eventId: string;
  sessionId: string;
  runId?: string;
  turnId?: string;
  seq: number;            // session 内单调递增
  type: string;           // 白名单、版本化的事件类型
  timestamp: string;      // UTC ISO8601
  schemaVersion: 1;
  causationId?: string;
  correlationId?: string;
  payload: unknown;
}

interface SurfaceRevision {
  sessionId: string;
  revision: number;
  basedOnEventSeq: number;
  compactionId?: string;
  visibleSegments: Array<{
    kind: 'event_range' | 'compacted_summary';
    fromSeq?: number;
    toSeq?: number;
    summaryRef?: string;
  }>;
  requestHash?: string;
}
```

`model_visible_iff_recorded` 重写为更严格的语义：**发送给 Provider 的每个语义段，都可追溯到记录、原文附件或受版本约束的生成产物；并非所有日志事件都必须向模型可见。**

### 3.4 Compaction 原子提交协议

```text
read current projection revision
  → claim compaction lease (expectedRevision)
  → persist compaction/start
  → select balanced range
  → generate summary candidate
  → validate summary + tool pairing + constraints
  → append compaction/committed (summaryRef, range, oldRevision, newRevision)
  → atomically publish projection revision
  → append compaction/end outcome
```

若后端存储无法将 `compaction/committed` 与 revision 发布纳入同一物理事务，应使用可恢复的提交协议：事件先记录 intent/commit，恢复时幂等重建投影，确保任意崩溃点可收敛到同一有效 revision。`compaction/end 恰好一次` 应理解为**逻辑终态唯一**，不依赖普通 JSONL 追加天然获得分布式 exactly-once。

### 3.5 测试与验收

- 任意 compaction 前后，原始事件文件哈希前缀不变。
- 从空数据库全量重放可得到相同有效 Surface Revision。
- 两个并发压缩只允许一个 revision 获胜；另一个正常报告冲突/重试。
- 在摘要生成、commit、projection 写入、end 记录四处注入崩溃，重启后不出现半替换。
- Tool Call/Result 配对、拒绝记录与关键用户限制可回溯。

---

## 4. ARC-02 / ARC-07：Behavior IR 语义编译与强约束 [P0/P1]

### 4.1 维持 L0→L4 结构，修订保证等级

| 层 | 图中职责 | 目标改进 |
|---|---|---|
| L0 IR | 装载、未知 key 拒绝 | 版本化 Schema、来源/签名/信任级别、冲突域 |
| L1 Effective Snapshot | deep-merge | 字段级合并策略、优先级、不可覆盖字段、provenance |
| L2 Model Profile | 按模型翻译表达 | Provider Capabilities、unsupported feature 报告、语义不可丢失 |
| L3 Harness Profile | Tool Schema/调度/Policy Ref | 强制项 policy_ref 必须有效；编译产生证明清单 |
| L4 RequestEnvelope | stable/project/volatile | 请求快照哈希、模型可见证据、明确的 token/caching 边界 |

不能假设所有 JSON 都可以安全 deep-merge。数组（替换/追加/去重）、冲突规则（拒绝/显式覆盖）、权限项（仅收窄）应按 schema 做不同处理。

### 4.2 行为声明的推荐语义分类

```text
Instruction        风格和回答指导（软）
Workflow           顺序与步骤约束（可用 Prompt 或编排实现）
Constraint         有安全影响的限制（Runtime 强制）
ToolStrategy       工具可见性、偏好、参数策略
Verification       检查项、Evaluator 门禁
ResourceBudget     时长、成本、采样数、工具调用限制
ContextStrategy    检索、缓存、摘要策略
```

每条约束应包含 `id / version / source / category / severity / enforcementChannel / applicability / assertions`。不能把“兼容一份 Prompt 文本”等同于“精确复现其他 Agent 的语义”。

### 4.3 编译失败策略

| 条件 | 推荐结果 |
|---|---|
| 一般 Prompt 指令无法完美适配 | Warning，报告降级与用户可见差异 |
| `runtime_policy` 规则未映射、映射无效、运行期无法执行 | **Error：禁止激活该配置快照** |
| 合并后权限比上游限制更宽 | Error 或通过合法 meet 收窄，绝不默许放宽 |
| 强制约束没有可断言的验证途径 | Error（关键约束）；一般条目明确降级 |
| Provider 缺少所需的功能（例如 structured output） | Error 或显式选择定义好的兼容执行路径 |
| 不受信任来源注入高权限配置 | 拒绝/隔离，需用户显式核验 |

### 4.4 兼容性等级与验收

`Importable → Renderable → Mappable → Enforceable → Verified`。这是逐级能力标记，不应作为所有外部提示词都必然可以达到的承诺。

每条行为保留：`sourceRef`、解析结果、有效优先级、输出渠道、规则映射和 Conformance Assertion。建立 Golden Fixture 覆盖：Prompt 冲突、数组合并、模型降级、越权行为、Skill 依赖变化。

**验收**：删除一个强制 `policy_ref` 后，编译报错且不会激活；变更 L0 声明后能够追踪每一层有效快照的差异；同一输入跨 Provider 的兼容等级和禁用原因清晰可查。

---

## 5. ARC-03：AgentLoop、Run/Turn 状态机与预算 [P0]

### 5.1 当前时序需要显式区分“准备结束”和“已经提交”

图中 `before_stop(A04)` 可 `forceContinue`，`after_turn(A06)` 被描述为 evaluator 门禁之一。建议让**所有可阻止成功提交的判定发生在 commit 之前**，例如新增 `before_turn_commit`（名称可按现有 API 兼容）；`after_turn` 只做事后通知与不改变本次结果的副作用。

### 5.2 建议 Run 状态

```text
CREATED -> PREPARING -> RUNNING
                        | -> WAITING_APPROVAL -> RUNNING
                        | -> SUSPENDED -> RUNNING
                        | -> FINALIZING -> COMPLETED
                        | -> DENIED / FAILED / CANCELLED / EXHAUSTED
```

`DENIED` 是策略/授权拒绝，不应混入内部故障统计。`EXHAUSTED` 表示预算用尽，和 `FAILED` 的系统故障区别对待。若现有持久格式只有 `turn/end(kind=error)`，迁移期可以保留兼容映射，但新增结构化 `outcomeReason`。

**状态转换要求**：只允许单写入方或 CAS revision 执行转换；进入终态后禁止重新转为 RUNNING；恢复执行必须产生新 Attempt，而不篡改旧事件。

### 5.3 强制预算

```ts
interface ExecutionBudget {
  maxModelSteps: number;
  maxToolCalls: number;
  maxElapsedMs: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxEstimatedCost?: number;
  maxConsecutiveErrors: number;
}
```

`forceContinue`、Evaluator 重试、Subagent 创建和 Provider Retry 必须受预算约束。预算计数与恢复后持续累加，不因 HTTP 客户端刷新重置。

### 5.4 测试与验收

- 纯文本无工具调用能够正常完成，而非误入死循环。
- `before_turn` 拒绝：0 次模型调用，写入拒绝审计与确定终态。
- `forceContinue` 达到硬预算后不能继续。
- `after_turn` 通知异常不能改写已提交成功结果（可记录后处理失败）。
- 两个客户端同时停止/恢复同一 Run，状态及事件序列仍唯一。

---

## 6. ARC-04：Durable Execution、重试和副作用协调 [P0]

### 6.1 问题场景

`runTool` 已经修改文件，但进程在写入 `tool/result` 前崩溃。恢复时若直接再次执行，可能造成重复变更。**Event Sourcing 不自动等于 exactly-once 副作用。**

### 6.2 提议执行协议

```text
Invocation planned + input hash
 → Policy approved / ExecutionPermit validated
 → Execution intent persisted (idempotencyKey)
 → Executor dispatches
 → Outcome observed and persisted
 → ToolResult projected
 → AgentLoop continues
```

每次工具调用绑定：`sessionId/runId/turnId/stepId/attemptId/toolId/argumentsHash/idempotencyKey`。将工具按副作用语义登记为 `read_only / idempotent_write / non_idempotent / externally_irreversible`。

### 6.3 恢复策略（不能一刀切）

| 执行类别 | 崩溃后结果未知时 |
|---|---|
| 纯读取 | 可以重试；仍应记录 Retry Attempt |
| 明确幂等写入 | 使用相同 idempotency key 和校验重试 |
| 非幂等本地写入 | 先核对文件状态或事务标记，无法判定则暂停 |
| 外部不可逆操作 | `OUTCOME_UNKNOWN`，查询远端结果或人工协调 |

Checkpoint 必须包括最后已提交 Event Seq、Run State、Surface Revision、待处理 Invocation、审批状态、预算计数及有效配置版本。引入恢复扫描器，在进程启动时识别 `RUNNING` 但 Lease 已失效的 Run，执行幂等协调，不直接重试全部工具。

### 6.4 并发与取消

- 后端为每个 Run 设单一调度所有者或有效 Lease。
- Cancel 应向模型流、工具进程和子任务传播；无法即时取消的执行应保持 `CANCELLING/OUTCOME_UNKNOWN` 语义（若引入该中间态，必须纳入状态机）。
- SSE 断线不是 Run 中断；客户端重新连接使用 Event Cursor 获取缺失事件。
- 审批等待时不得保留无界打开的 HTTP 请求；存为持久等待任务，恢复后仍可审批。

### 6.5 验收

对以下故障点做自动注入：记录 intent 前、intent 后/dispatch 前、工具完成/结果持久化前、结果持久化后/投影前、审批同意后/执行前。每一种都必须得出可解释、可恢复且不盲目重放不可逆操作的结果。

---

## 7. ARC-05：Policy 与 Executor 的可信闭环 [P0]

### 7.1 保留六步裁决，扩大授权对象

保留图中的 `denied_tools → deny rules → hook narrow → ask → allow → profile` 及 Guard 单调收窄。改变的是裁决目标不再只是“裸工具名”，而是规范化的**操作身份 + 参数 + 权限范围 + 运行主体**。

```ts
interface CanonicalToolInvocation {
  canonicalToolId: string; // 如 mcp:github/create_issue 或 builtin:shell/execute
  providerId?: string;
  subject: { sessionId: string; runId: string; agentInstanceId: string };
  argumentsCanonicalHash: string;
  requestedScopes: string[];
  effects: 'read_only' | 'idempotent_write' | 'non_idempotent';
}
```

裸名称只可用于用户友好的展示和兼容查询，不可成为跨 Provider 唯一安全身份。MCP Tool Registry 要防止同名工具冲突和来源漂移。

### 7.2 Execution Permit（建议新增）

一次成功 `allow` 或 `ask` 审批生成短期、单操作的结构化授权：绑定 `subject / canonicalToolId / argsHash / resourceScope / policyRevision / expiry / nonce`。Executor 在 dispatch 前核对并重放原规则的运行期关键限制。令牌签名/完整性方案依赖进程边界与威胁模型决定；**不能仅靠 Agent 构造的 JSON 字段证明授权有效**。

### 7.3 安全边界

- `approval=never` 和无人审批时 `ask` 为 fail-closed。
- 用户批准一次具体 shell 命令，不得扩展为永久通配 `shell` 权限。
- Workspace 根目录必须经路径规范化、realpath/symlink 检查与实际沙箱隔离（权限拦截不是 OS 隔离的替代品）。
- 非模型调用通道、CLI 内部命令、MCP 和 Subagent 均走同一 Tool Executor。
- `audit/denial` 记录 `stage/ruleId/toolId/reason/subject`，敏感参数默认进行脱敏或独立加密。
- Subagent 的有效权限 = 父授予范围 ∩ 子 Agent Preset ∩ 全局 Policy ∩ 当前资源约束。

### 7.4 安全测试套件

包含别名与大小写混淆、路径穿越、symlink 逃逸、MCP 同名冲突、审批后参数变化、已过期 permit、Policy 更新撤销、未授权直接调用 Executor、Hook 放宽尝试、子代理权限升级。**阻断条件**：有一条绕过核心 Runtime 验证的可执行路径，P0 不能关闭。

---

## 8. ARC-06 / ARC-09：Context 失效、压缩与信息保全 [P1]

### 8.1 缓存分层

图中 `stable/project/volatile` 的组装顺序保留，但把“stable 每会话仅构建一次”修订为“在依赖输入不变期间缓存”。分开管理四类缓存：

| 缓存 | 内容 | 失效条件 |
|---|---|---|
| Assembly Cache | L4 组装中间段 | Behavior/Project/Skill/Policy 配置变化 |
| Provider Prefix Cache | Provider 能识别的稳定前缀 | 顺序、文本、模型/Provider 改变 |
| Projection Cache | 事件日志派生 Surface | Session Event Seq / Surface Revision 改变 |
| Token Estimation Cache | 各部分 token 估计 | 内容、Tokenizer 或模型上限改变 |

推荐版本化 Key 至少纳入 `modelProfileHash, behaviorSnapshotHash, policyRevision, projectInstructionHash, skillManifestHash, toolSchemaHash, contextSchemaVersion`。不要将这些 Hash 写成永久不变的内建集合，实际依据依赖图细化。

### 8.2 统一三入口 Compaction

保留 `pressure / CONTEXT_WINDOW_EXCEEDED / post-turn or manual`，统一调用同一事务服务。Overflow Retry 建议仍限制为**一次压缩后一次明确重试**（与图中“≤1”设计相符），失败时向 Run 暴露确定的错误而不是循环压缩。

### 8.3 摘要信息保全断言

压缩候选必须保留：任务目标、禁止事项、用户最新要求、未完成任务、关键路径与修改事实、工具调用结果、未解决错误、审批/拒绝状态、未完成调用。工具 Call/Result 不能拆对。摘要记录包含被覆盖区间、摘要版本和来源引用；注入内容应标记“摘要是历史视图而非高优先级系统指令”。

压缩前后运行固定问答/断言 fixture（例如：目标文件、禁止修改目录、待办项、最近一次拒绝是什么），为信息保真建立回归检查。不能以字数压缩比取代语义保真测试。

---

## 9. ARC-08：Provider 能力协商与统一模型事件 [P1]

定义 `ProviderCapabilities`（能力为已验证/声明/未知三态，不可仅用 boolean 全部默认 true）：

- Tool Calls / Parallel Tool Calls / Tool Call Streaming
- Structured Output / JSON Schema
- Reasoning Parameters / Stop Reason
- Multimodal Input / Output
- Context Window、Token Usage、成本估算
- Prompt Cache / Rate Limit / Retry Characteristics

Provider Adapter 负责归一化 `model_delta / tool_call_started / tool_call_arguments_delta / tool_call_completed / usage / finish_reason / provider_error` 等事件；Core 只看抽象类型和明确的终止信号。功能不支持时由编译器/路由器返回可解释错误，禁止静默丢弃有约束意义的设置。

**验收**：新增一个 OpenAI-Compatible Provider 不改 Core；流式 tool arguments 非完整 JSON 时不会被当作已就绪调用；模型调用重试不会导致已完成工具重复执行。

---

## 10. ARC-10：Subagent、Team 与 Task Queue [P2]

**原则**：Agent 不是第二套 Runtime，而是同一 Runtime 执行的一组有作用域配置。

```ts
interface AgentInstanceSpec {
  instanceId: string;
  parentInstanceId?: string;
  modelProfileRef: string;
  behaviorSnapshotRef: string;
  policyScopeRef: string;
  contextScopeRef: string;
  toolScopeRef: string;
  budget: ExecutionBudget;
}
```

调度层只负责任务依赖 DAG、Lease、队列与结果归并。子代理使用独立的 Session/Run 子上下文和受限工具集；共享代码目录时需要明确文件写入互斥、工作区隔离或变更合并协议。

**最小交付**：先支持单父 → 多只读子任务 → 结果回传；再支持受控写入和并行变更。子任务中断、超时、父取消、审批等待都必须有确定的传播策略和状态事件。

---

## 11. ARC-11：Conformance、Telemetry 与质量闸门

### 11.1 必须新增/完善的测试层

1. **Contract Tests**：共享类型、事件 Schema、Provider/Tool/Policy 接口兼容。
2. **State Model Tests**：Run/Turn 状态转换穷举，非法转换拒绝。
3. **Crash/Fault Injection**：持久化和外部副作用各边界断点恢复。
4. **Policy Adversarial Tests**：工具身份、路径和审批参数绕过测试。
5. **Behavior Golden Tests**：L0→L4 生效快照、冲突与 `runtime_policy` 编译失败。
6. **Context Fidelity Tests**：压缩前后信息守恒与引用可追溯。
7. **Provider Fixtures**：不同 stop reason、工具流、429/timeout、部分响应。
8. **End-to-End Scenarios**：从用户输入到 Diff/Result/Replay 的可回归任务。

### 11.2 观测数据

统一关联维度：`sessionId / runId / turnId / stepId / attemptId / agentInstanceId / eventSeq / traceId`。Telemetry 只能旁路订阅，不能干扰 EventBus 权威裁决。敏感 Prompt、API Key、原始 Tool Arguments 默认不进入外部 Telemetry；如需要采样，必须有脱敏与开关。

建议监控：Run 完成率、Policy Denial 分布、审批等待时间、Step p50/p95、恢复成功率、Provider 429 与 Retry、Token/Cost、压缩触发和失败、工具执行耗时。

### 11.3 测试结果判定

P0 缺陷不得以 UI 规避、Warning 或“用户一般不会这样做”替代修复。构建机器上至少要求 P0 的状态机、崩溃注入和权限对抗集通过；失败必须阻塞发版。性能阈值应基于基线测量设定，不预设缺乏数据支持的固定数字。

---

## 12. 分阶段实施与交付清单

### Phase 0：测量与契约冻结（实施前）

- 对照真实源码确认五份图哪些已实现，哪些仅为设计：标记 `Implemented / Partial / Designed / Absent`。
- 输出 `Event Catalogue`、`Run State Transition Table`、`Tool Side-Effect Classification`、`Behavior Schema Inventory`。
- 记录现有 Session JSONL 样本、典型 Run Trace、Provider Fixtures 和实际崩溃/重试测试基线。
- 建立依赖方向检查（Core 不 import 具体子系统）。

### Phase 1：P0 数据与生命周期

- `ARC-01`：Event Log/Projection 分离与事件 revision。
- `ARC-03`：Run State Machine、Budget、终态和前置提交门禁。
- 提供旧 Session 无损读取适配器：**旧日志只读解析 → 新投影重建；不直接覆盖旧历史**。

### Phase 2：P0 安全与恢复

- `ARC-05`：规范化 Tool ID、审批作用域、Execution Permit、Executor 验证。
- `ARC-04`：Execution Intent、Checkpoint、Recovery Scanner、Effect Reconciliation。
- `ARC-02`：`runtime_policy` 编译失败拦截，与权限测试闭环。

### Phase 3：P1 跨模型一致性与 Context

- `ARC-07/08`：Behavior 语义分类、Capability Contract、Provider Adapter。
- `ARC-06/09`：分层缓存、可恢复 Compaction、Fidelity 测试。

### Phase 4：P2 调度和可观测性

- 子代理/团队任务树与租约。
- 跨模块 Trace/Benchmark 与发布门禁。
- 对外发布稳定的 Run/Task/Event API 供 Web 和 CLI 共用。

### 交付物清单

| 交付物 | 责任域 | 最低要求 |
|---|---|---|
| Event & Projection RFC | Core / Session | 不变量、版本、恢复协议、兼容迁移 |
| Run Lifecycle RFC | Core / Application | 状态机、预算、取消、失败语义 |
| Tool Security RFC | Policy / Runtime | Tool ID、审批绑定、验证接口、威胁模型 |
| Behavior Compiler RFC | Behavior / LLM | 合并规则、强制项错误、Conformance 格式 |
| Context RFC | Context | 缓存依赖图、Compaction 提交与信息守恒 |
| Contract Test Suite | QA / Benchmarks | P0 自动门禁、跨 Provider Fixture |
| Telemetry Schema | Telemetry | Correlation ID、默认隐私策略 |

---

## 13. 开发任务模板（直接创建 Issue 使用）

每一个整改 Issue 必须包含：

- **问题 ID/模块**：例如 `ARC-04 / runtime`。
- **图中事实**：引用本地五份 HTML 对应节点或术语。
- **真实代码证据**：文件路径、调用链、现有测试（实施阶段补充）。
- **目标不变量**：不超过 5 条、可测试。
- **设计决定**：涉及哪些 Schema/API；如何迁移旧 Session。
- **实现范围**：明确不重构的模块，避免范围扩散。
- **错误/恢复行为**：失败后状态、审计与用户可见结果。
- **自动测试**：正向、异常、并发、崩溃、权限回归。
- **完成定义**：所有对应出口条件有证据通过。

---

## 14. 架构层的最终验收条件（Definition of Done）

- [ ] 物理 Event Log 永远 append-only，Surface 可版本化重建。
- [ ] 每个 Run 有唯一明确的合法状态与确定终态。
- [ ] 所有 `forceContinue`、Retry、子任务都受剩余预算约束。
- [ ] 恢复后未知副作用不会被盲目重复执行。
- [ ] 未绑定具体工具/参数/权限范围的批准无法被 Executor 接受。
- [ ] `runtime_policy` 缺失对应执法能力时编译失败，旧有效配置保持不变。
- [ ] Provider 适配差异不能污染 Core 或悄悄删除强制语义。
- [ ] Context 缓存依赖改变会失效，摘要可追溯且信息守恒。
- [ ] 子代理不拥有第二套 Loop，不继承超出父授权的权限。
- [ ] Web、CLI 和后续 Desktop 读取同一 Run/Event/Policy 状态，不自行推导执行成功。

### 需在源码核查后才能下定论的问题

1. 当前 JSONL 是否真的被原地修改？若仅 Surface 修改，`ARC-01` 主要是文档与契约整改，而非存储重写。
2. `after_turn` 是否实际参与提交门禁？若只是异步通知，无须改动行为，只需澄清术语。
3. Executor 是否已经有不可绕过的授权校验、幂等机制和工作区隔离？若存在，直接补充契约和对抗测试。
4. Context 缓存是否实际上已追踪配置版本？若存在，不必重复新增 Cache Manager。
5. Provider 与 Subagent 是否已有兼容测试？以真实 Fixture 为准。

**决策原则：以真实证据决定改动规模；优先修正语义和验证，避免为了符合文档重写原本已经正确的实现。**
