# Vessel 后续开发方向与产品化路线 v1.0

> 基于当前 `Composable_Agent_Harness` ZIP 实际代码、Git 历史、V0.1–V0.9 进度文档，以及此前关于 Vessel 品牌哲学、三角色协作、CLI/Web 双 Surface、端口 5678 的讨论整理。
>
> 文档定位：**从“已经做出很多 Harness 机制”转向“做成真正可长期使用、可验证、可发布的 Vessel 产品”**。
>
> 日期：2026-09-07

---

## 0. 最终结论

当前项目已经不再是一个“刚起步的 Agent Demo”。从仓库结构看，它已经具备一个中型 Agent Harness 的大部分关键机制：薄 Agent Loop、事件系统、会话、Context/Compaction、工具、Policy、MCP、Subagent、Evaluator、Memory、Skills、TaskRouter、Loop Engine、Provider 管理、用量与定价等。

**下一阶段不应该继续横向堆功能。**

建议把方向明确切换为：

```text
V0.x：机制构建阶段 —— 基本完成
              ↓
V1.x：产品化 + 真实运行 + 可靠性证明
              ↓
V2.x：跨 Harness / 长周期自治 / Agent OS 化
```

接下来真正重要的不是“再加第 72 个供应商”“再加几个 Agent”“再造一个更炫的 TUI”，而是解决 5 个核心问题：

1. **让一个真实用户可以每天稳定使用 Vessel；**
2. **让 CLI 和本地 Web UI 成为同一个 Harness 的两个 Surface，而不是两套产品；**
3. **让当前已经存在的 TaskRouter / Evaluator / Loop Engine / Agent 能真正进入默认生产路径；**
4. **补上目前最明显的生产缺口：流式输出、中断/Steering、真实 OS Sandbox、凭据安全、会话控制面；**
5. **用 Cross-Harness Conformance Suite 证明 Vessel 的价值，而不是靠功能列表证明。**

一句话路线：

> **先把 Vessel 做成“可靠、安静、可观察的日常 Agent”，再把它做成“会自动组织多个模型与 Agent 的 Harness”。**

---

# 一、当前项目真实状态审计

## 1.1 仓库规模

本次 ZIP 解压后，排除 `.git`、`node_modules`、`dist`、`.dsh-vision-router`、运行时 session 等非源码目录，粗略统计：

- TypeScript：约 **131 个文件 / 14,895 行**；
- Markdown：约 **110 个文件 / 16,011 行**；
- `apps/cli/src`：约 3,410 行；
- `packages/`：约 10,736 行；
- `docs/`：约 12,681 行；
- 现有核心 workspace 包约 13 个：
  - `shared`
  - `core`
  - `llm`
  - `behavior`
  - `context`
  - `tools`
  - `policy`
  - `runtime`
  - `memory`
  - `skills`
  - `agents`
  - `telemetry`
  - `engine`
- 另有：
  - `apps/cli`
  - `benchmarks/runners`
  - benchmark fixtures / scenarios / reports
  - 31 张开发任务卡

Git 当前约 **75 个提交**。

项目自己的 V0.9 记录显示 Windows 原环境中已达到 **297 tests 全绿 + TypeScript build 通过**。

### 本次 ZIP 的测试说明

我在当前 Linux 沙箱中尝试重新运行测试，但 ZIP 内携带的是 Windows 环境的 `node_modules`，Rollup 的 Linux 原生 optional dependency 不存在，同时 npm workspace 软链状态在 ZIP 跨系统解压后不可直接复用，因此无法把“本环境跑不起来”解释为项目回归。

下一阶段开始前，应在你的 Windows 原环境执行一次：

```powershell
npm install
npx tsc -b
npx vitest run
```

把它作为 V1.0 新路线的基线快照。

---

## 1.2 已经真正存在的能力

### A. Core Agent Loop

`packages/core/src/agent-loop/AgentLoop.ts` 已经是真正的薄 Loop，而不是伪代码。

当前主路径已经包含：

```text
BeforeTurn
→ buildContext
→ Model Call
→ Tool Calls
→ BeforeTool / Policy
→ Runtime Executor
→ Tool Result
→ 回灌模型
→ Pure Text / Budget Stop
→ BeforeStop
→ AfterTurn
```

并有：

- 模型失败重试；
- max steps；
- denial breaker；
- append-only Session 记录；
- tool call / result 事件化。

这部分**不要再大改**，后续以“补控制面”和“补可观察性”为主。

---

### B. Event + Session

当前 `Session` 已采用 JSONL 事件日志作为事实源，并支持：

- replay；
- surface projection；
- session lease；
- 崩溃后 unfinished turn 补 interrupted；
- compaction 区域替换。

这是未来 Web UI、CLI、恢复、审计、Trajectory、Agent Team 面板最重要的基础。

**建议未来所有 UI 状态都从事件投影生成，不另外再造一套 UI 真相。**

---

### C. Behavior IR + Vessel Constitution

当前六条 Vessel 哲学已经不是纯品牌文字，而是进入：

`configs/behavior.default.yaml`

以 `vessel.*` 行为 IR 的形式编译进入 stable system。

这一方向完全正确，应继续坚持：

```text
哲学 / 行为
→ IR
→ Compiler
→ Model / Harness Profile
→ Prompt / Runtime
```

不要退回“大段 system prompt 手写人格”的方式。

---

### D. Policy Runtime

当前已经实现：

```text
Policy declaration
→ denied tools
→ deny rules
→ ask rules
→ allow rules
→ permission profile
→ fail-closed
```

并且 protected paths、dangerous shell、force push 等已经落在运行时而不只是 Prompt。

这是 Vessel 和普通“Prompt Agent”真正拉开差距的地方。

但当前仍存在一个重要生产缺口：**OS Sandbox 目前只是 seam，Windows 上实际 enforcement 仍是 partial/passthrough。**

这必须在稳定版之前处理。

---

### E. Context / Compaction / Memory / Skills

当前已经有：

- stable system layer；
- 项目 instructions；
- project memory snapshot；
- skills index；
- event-derived conversation history；
- basic compaction；
- model context window 接口。

说明当前项目已经拥有“上下文工程”的基本骨架。

下一步不应该继续增加更多 Context Source，而应重点解决：

1. Context Budget 可观察；
2. Context Source provenance；
3. 长任务 Context Reset / Handoff；
4. 压缩前后行为一致性；
5. 真实模型上验证压缩效果。

---

### F. Agents / Evaluator / Loop Engine

已经有：

- `SubagentManager`
- isolated runtime
- Planner
- deterministic Evaluator
- `EvaluatorAgent`
- LoopEngine
- Task Selection / TaskRouter
- temp/worktree workspace

但这里存在一个重要事实：

> **很多高级机制已经“实现了”，但还没有成为普通用户每天自然走到的默认路径。**

例如：

- `TaskRouter` 在 `composeHarness()` 有入口，但普通 `vessel run` 并未默认把任务路由接起来；
- `LoopEngine` 是成熟的外层状态机，但 Generator / Evaluator 的真实生产接线仍不是默认交互入口；
- Lead / Developer / Reviewer 三角色目前主要是文档角色卡，不是正式的 preset/profile 体系；
- External Gemini Reviewer 目前没有正式 handoff protocol。

这将是 V1.x 非常重要的一条主线：

> **把“存在于 package 中的机制”变成“存在于产品体验中的能力”。**

---

## 1.3 当前最明显的结构性问题

### 问题 1：Composition Root 还绑在 CLI

现在核心组合发生在：

`apps/cli/src/compose.ts`

这在只有 CLI 时没问题。

但一旦加入本地 Web UI，如果继续让 Web 自己复制一份 compose 逻辑，就会形成：

```text
CLI Harness
Web Harness
```

两套状态、两套 wiring、两套 bug。

必须先解决这个问题，再正式写 Web UI。

---

### 问题 2：真实 Surface 只有 CLI

目前 Web 相关只有：

- `docs/ui-split-layout.html`
- 静态截图
- UI theme 规范

还没有真实应用。

当前 CLI 是 readline 交互，Provider/setup 等交互已经够用，但作为产品“脸”仍然偏工具化。

这正是后续最适合进入产品化阶段的位置。

---

### 问题 3：Streaming 还没进入主 Loop

`ChatProvider` 已经预留 `stream?()`，但当前 OpenAI Compatible / Anthropic 实际实现仍是一次性 `chat()`，AgentLoop 也主要消费完整结果。

没有 Streaming 会直接影响：

- Web UI 实时体验；
- CLI 输出体验；
- interrupt；
- steering；
- live trajectory；
- 长任务用户信任感。

因此 Streaming 属于 V1.0/V1.1 的 P0。

---

### 问题 4：中断 / Steering 还不够一等公民

目前 Loop 有 turn/step，但缺少真正用户可操作的：

```text
interrupt current run
steer while running
queue follow-up
resume after interruption
```

对于长任务 Agent，这比再增加 Provider 更重要。

---

### 问题 5：Sandbox 仍是 partial

`packages/runtime/src/sandbox/Sandbox.ts` 已经明确写明：

> 当前主要是 confine seam，OS-level backend 后续补。

因此 Vessel 当前的安全结构是：

```text
Policy 很强
↓
真正 OS 隔离仍不足
```

如果 Vessel 未来对外宣传“硬安全边界”，这个缺口必须补齐。

---

### 问题 6：品牌迁移还没彻底到持久化目录

虽然 bin、package 已完成 Vessel 化，但当前仍存在：

```text
~/.dsh/providers.json
~/.dsh/current.json
~/.dsh/usage.json
```

这对于公开产品会非常奇怪。

建议 V1.0 做一次正式迁移：

```text
~/.dsh/*
→ ~/.vessel/*
```

并提供 one-time migration，而不是让用户手改。

项目局部状态也建议统一考虑：

```text
.harness/
```

是否升级为：

```text
.vessel/
```

我的建议是：**公开可见的项目级配置用 `.vessel/`，内部 session event 可继续兼容读取 `.harness/`，V1.x 做迁移层。**

---

### 问题 7：API Key 明文 JSON

当前 ProviderStore 文档明确说明 Key 明文写入配置文件。

这作为个人 PoC 可以接受，但作为一个强调 Policy / Security 的 Vessel 产品，会形成明显理念冲突。

V1.x 应拆成：

```text
providers.json
= provider metadata

OS Credential Store
= secrets
```

至少优先支持 Windows Credential Manager，接口层保持跨平台可扩展。

---

### 问题 8：版本命名已经混乱

项目路线已经做到 V0.9，但：

```json
"version": "0.1.0"
```

仍然存在于 root / CLI package。

同时 ARCHITECTURE.md 仍大量标注 v0.1。

建议以后区分两种版本：

```text
Product Version：0.10.0 / 1.0.0
Spec Version：Behavior IR v0.1 / Event Spec v0.1
```

不要再让“项目版本”和“协议版本”混在一起。

---

# 二、Vessel 的产品定位应该固定下来

## 2.1 最终定位

建议正式固定：

> **Vessel — A Composable Agent Harness**
>
> 一个本地优先、模型无关、可组合、可观察、带硬策略边界的 Agent Harness。

不是：

- OpenCode clone；
- Claude Code clone；
- DSH clone；
- Multi-Agent Demo；
- Provider 聚合器；
- Prompt 框架。

而是：

```text
Model 可替换
Behavior 可编译
Tools 可组合
Policy 可执法
Context 可治理
Agent 可委派
Output 可验证
Surface 可替换
```

---

## 2.2 Vessel 产品公式

建议以后 README 统一用：

```text
Vessel
=
Model
+ Behavior
+ Context
+ Tools
+ Policy
+ Memory
+ Evaluator
+ Orchestration
+ Runtime
+ Surfaces
```

其中 `Surfaces` 是当前项目下一阶段必须补上的一级概念。

---

## 2.3 新增一条 UI 哲学

此前 Vessel 六条哲学之外，产品 UI 层建议补一条设计原则，但不要把它加入 Agent Behavior IR，因为它属于 Surface 设计规范：

> **Capability is abundant. Interface is quiet.**
>
> **能力丰富，界面安静。**

含义：

- Harness 可以有很多机制；
- 默认 UI 不应该把所有机制全部展示；
- 信息按需展开；
- 专业用户能看到全部证据；
- 普通用户只看到当前任务需要的部分。

---

# 三、CLI 与 Web 的最终架构

## 3.1 不二选一

最终必须是：

```text
                 Vessel Application Layer
                          │
             ┌────────────┴────────────┐
             │                         │
         Vessel CLI               Vessel Web
        Terminal Surface          Local UI Surface
             │                         │
             └────────────┬────────────┘
                          │
                    Vessel Harness
```

**同一个 Session / Loop / Policy / Memory / Provider。**

---

## 3.2 CLI 的定位

CLI 不再追求“做成另一个 OpenCode 全屏 TUI”。

它负责：

- SSH；
- Server / headless；
- 快速一次性任务；
- CI；
- Debug；
- Script；
- 高级用户；
- 低资源环境。

CLI 继续保持：

```text
vessel
vessel run
vessel web
vessel serve
vessel setup
vessel provider
vessel models
vessel usage
vessel pricing
```

但不要花大量时间把 readline 改成复杂 Ink/TUI。

---

## 3.3 Web 的定位

Web 是 Vessel 的主要日常交互面。

固定：

```text
http://127.0.0.1:5678
```

不是 `0.0.0.0`。

默认只允许本机访问。

建议：

```powershell
vessel web
```

行为：

1. 检查 5678；
2. 若未启动则启动 local server；
3. 打开默认浏览器；
4. 进入当前工作区；
5. CLI 仍可继续作为控制入口。

另保留：

```powershell
vessel serve
```

只启动服务，不自动开浏览器。

---

# 四、必须先做的架构重构：Application Layer

## 4.1 把 compose 从 CLI 移出去

当前：

```text
apps/cli/src/compose.ts
```

建议迁移为：

```text
packages/application/
  src/
    compose.ts
    SessionController.ts
    RunController.ts
    ProjectRegistry.ts
    SessionRegistry.ts
    projections/
```

然后：

```text
apps/cli
→ @vessel/application

apps/local-server
→ @vessel/application

apps/web
→ HTTP/SSE
```

### Application Layer 负责什么

它不是第二个 Core。

它只做：

- 创建/恢复 session；
- composeHarness；
- run / interrupt / steer；
- provider/model/permission 变更；
- team runtime；
- event projection；
- 对外暴露稳定 command API。

Core AgentLoop 不动。

---

# 五、Local Server 设计

## 5.1 技术选择

推荐 Node + TypeScript，继续保持现有主技术栈。

不要为了一个本地 UI 上微服务。

建议目录：

```text
apps/
  cli/
  local-server/
  web/
```

`local-server` 同一个 Node 进程负责：

- API；
- SSE；
- 静态 Web 资源；
- Session controller。

---

## 5.2 API 最小集合

### Health

```text
GET /api/health
```

### Projects

```text
GET  /api/projects
POST /api/projects/open
```

### Sessions

```text
GET  /api/sessions
POST /api/sessions
GET  /api/sessions/:id
POST /api/sessions/:id/turns
POST /api/sessions/:id/interrupt
POST /api/sessions/:id/steer
```

### Events

```text
GET /api/sessions/:id/events
Content-Type: text/event-stream
```

第一阶段用 SSE 即可。

不需要为了双向通信直接上 WebSocket。

控制命令继续走 POST。

---

## 5.3 Event Projection

不要让 Web 自己解析 JSONL。

新增 projection：

```text
ConversationProjection
TaskProjection
TeamProjection
ToolProjection
UsageProjection
PolicyProjection
```

它们全部由 Event Log 派生。

例如：

```text
subagent_start
subagent_stop
→ TeamProjection

before_tool / tool/result
→ ToolActivityProjection

audit/denial
→ PolicyProjection

after_model usage
→ UsageProjection
```

这样 UI 永远只是“看 Harness 已发生的事实”。

---

# 六、Web UI 最终设计方向

## 6.1 默认必须极简

左侧建议最终只有：

```text
Vessel

+ New Session

Projects
  当前项目

Recent Sessions

Settings
```

不要一级菜单：

```text
Agents
Modules
```

原因：它们不是用户来 Vessel 的目的。

---

## 6.2 Agent Team 从上下文出现

在当前 session 顶部：

```text
3 Agents
```

点击展开：

```text
Lead       Active
Developer  Working
Reviewer   Waiting
```

而不是左侧单独“Agent 管理后台”。

---

## 6.3 模块化 UI

右上：

```text
Customize
```

可勾选：

```text
✓ Team
✓ Tasks
✓ Changed Files
□ Context
□ Tool Activity
□ Logs
□ Cost
□ MCP
□ Policy
```

默认建议只开：

```text
Tasks
Changed Files
```

复杂任务自动建议打开 Team。

---

## 6.4 主题

继续沿用现有决定：

```text
浅色 / 深色 = 跟随系统
```

用：

```css
prefers-color-scheme
```

不要把主题切换按钮放成核心视觉元素。

但 Settings 中可允许用户以后 override：

```text
System
Light
Dark
```

首版可只做 System。

---

## 6.5 前端技术栈

推荐：

```text
React
Vite
TypeScript
CSS Variables
Lucide Icons
```

不推荐首版用 Next.js：

- 本地应用不需要 SSR；
- 不需要 Server Components；
- 会增加不必要复杂度。

也不建议直接套大而全 UI 模板，容易重新变成“卡片海洋”。

UI 原则：

```text
少阴影
少卡片
少渐变
少颜色
大量留白
细分隔线
信息按需展开
```

---

# 七、Streaming / Interrupt / Steering：V1 的核心交互能力

## 7.1 Provider Streaming

当前 `ChatProvider` 已预留 `stream?()`。

下一步正式实现：

```text
OpenAI-compatible stream
Anthropic stream
```

并统一成 typed chunks：

```text
message_start
text_delta
tool_call_start
tool_call_delta
tool_call_end
usage
message_end
```

不要只保留 `delta:string`。

---

## 7.2 AgentLoop 支持 Streaming

Loop 仍然只有一个，但模型调用路径改成：

```text
Provider stream available
→ stream path

otherwise
→ chat fallback
```

EventBus 发：

```text
model_stream/start
model_stream/delta
model_stream/tool_call
model_stream/end
```

Web / CLI 都订阅同样事件。

---

## 7.3 Interrupt

每个 active turn 建立：

```text
AbortController
```

所有：

- provider fetch；
- shell process；
- MCP call；
- subagent；

都要能拿到 AbortSignal。

UI：

```text
Stop ■
```

CLI：

```text
Ctrl+C 第一次 = interrupt current turn
Ctrl+C 第二次 = exit
```

---

## 7.4 Steering

支持运行中追加：

```text
“先别改这个文件”
“把范围缩小到 backend”
“先跑测试再继续”
```

建议机制：

```text
SteeringQueue
```

在 step boundary 注入 user steer event。

不要打断正在执行的不可中断原子文件写入。

---

# 八、三 Agent 体系真正代码化

## 8.1 不新造 Agent 机制

继续坚持：

> 角色 = preset/profile，不是新的 runtime primitive。

新增：

```text
packages/agents/src/presets/
```

定义：

```yaml
id: lead
role: orchestrator
model_tier: pro
tools: [...] 
can_delegate: true

id: developer
role: generator
model_tier: pro|fast
write: true

id: reviewer
role: evaluator
model_tier: review
write: false
```

---

## 8.2 默认团队

Vessel 默认项目模板：

```text
Lead
Developer
Reviewer
```

但不是所有任务都启动 3 个。

路由：

```text
小任务
→ Single Agent

中任务
→ Developer + Reviewer

复杂任务
→ Lead + Developer + Reviewer
```

这符合 Vessel 的最低必要复杂度哲学。

---

## 8.3 你的模型配置

建议配置成可改 profile，不写死：

```yaml
models:
  pro: deepseek-v4-pro
  fast: deepseek-v4-flash
  review_internal: deepseek-v4-flash
  review_external: agy-cli-gemini
```

默认可以按当前你的实际资源：

```text
Lead       → DeepSeek V4 Pro
Developer  → DeepSeek V4 Flash / Pro（由任务复杂度决定）
Reviewer   → Internal Flash
高价值任务 → External Gemini Review
```

重点是：**角色和模型解绑。**

---

# 九、External Gemini / AGY CLI 的正确设计

AGY CLI 不是普通 API Provider，不应伪装进 `ChatProvider`。

第一版正式设计成：

```text
External Review Adapter
```

不是模型 Provider。

## 9.1 Handoff Artifact

保存：

```text
.vessel/reviews/<review-id>/handoff.md
```

内容：

```text
Task
Acceptance Criteria
Changed Files
Diff Summary
Test Results
Architecture Constraints
Review Checklist
Required Output Schema
```

UI：

```text
External Review Required
[Copy Handoff]
[Open Folder]
[Import Result]
```

用户在 AGY CLI 跑完，粘贴或导入结果。

---

## 9.2 后续可选自动化

只有当 AGY CLI 官方稳定支持机器调用、结构化输出，并且账号授权模式允许时，再研究：

```text
Local CLI Adapter
```

不要为了“自动”做不稳定的 shell hack。

---

# 十、TaskRouter 真正进入默认产品路径

现在 TaskRouter 已有，但用户仍主要手动选模型。

下一阶段应让用户只选：

```text
Auto
Fast
Pro
```

其中默认：

```text
Auto
```

内部：

```text
Task
→ classify category
→ choose role
→ choose tier
→ resolve provider/model
```

用户界面显示实际选择：

```text
Auto → DeepSeek V4 Pro
```

并允许点击 Pin：

```text
Pin for this session
```

这样用户不需要每轮想“Flash 还是 Pro”。

---

# 十一、把 Loop Engine 接进真实 Generator / Evaluator

现在 LoopEngine 本身已经做得比较完整。

下一步不要重写它，而是写真实 adapter：

```text
RealGeneratorAdapter
RealEvaluatorAdapter
ProjectTaskQueue
IterationStore
```

真实运行：

```text
Task Selection
→ Worktree/Temp Workspace
→ Developer Agent
→ Tests
→ Reviewer Agent
→ met / not_met
→ retry
→ persist
```

## 11.1 必须限制默认自治范围

默认：

```text
maxIterations = 1
maxRetries = 1
```

用户进入：

```text
Goal / Loop Mode
```

再放宽。

不要普通聊天默认无限循环。

---

# 十二、长任务：Compaction 之后要做 Context Reset

当前已经有 Basic Compaction。

后续建议新增另一条机制：

```text
Context Reset + Structured Handoff
```

用于真正多小时任务。

格式：

```yaml
handoff:
  goal:
  completed:
  current_state:
  changed_files:
  tests:
  decisions:
  blockers:
  next_actions:
  evidence:
```

然后新 Agent / 新 Session 从 Handoff 启动。

不要只靠把越来越长的对话不断 compact。

---

> **§12.1 实现落地（task 067，2026-09）**：上述 Context Reset + Structured Handoff 已实现于
> `packages/engine/src/handoff/`（docs/CONTEXT-RESET-HANDOFF.md）：
> - handoff 记录字段名与本节 yaml **逐字一致**（goal/completed/current_state/changed_files/tests/
>   decisions/blockers/next_actions/evidence，snake_case），JSON 存储即 §12 结构；
> - 存储走 059/063 模式（`~/.vessel/handoffs`，env `VESSEL_HANDOFFS_ROOT` 覆盖；id 前缀 `handoff_`；
>   tmp+rename 原子写；目录布局 meta.json + handoff.md 文本投影）；
> - 素材聚合自 063 IterationStore / 任务对象 + 064 清理前快照（collectHandoffMaterial）；
> - 触发 = 066 budget（0.9×contextWindow，晚于 Compaction 0.8）或会话长度阈值（1500 条）或手动 force；
>   065 Goal UI 可见 seam = handoffSeamState（纯状态，本卡不深做 UI）；
> - 新 Session 从 handoff 启动：seedSessionFromHandoff（B01 user/message source='handoff' 注入
>   goal/completed/next_actions 起始上下文，blockers/decisions 透传，完整记录按 handoff id 可查）
>   + handoffToTaskSeed（接 061-064 LoopEngine 运行链）。
> - 与既有 Compaction 并存：compact = 同一 session 内压缩；reset = 新 Session 从 handoff 重启
>   （何时 compact vs reset 见 CONTEXT-RESET-HANDOFF.md §1）。

---

# 十三、安全必须成为 Vessel 的核心产品差异

## 13.1 Sandbox：稳定版 blocker

当前 Sandbox 只是 partial seam，因此：

> **Vessel 1.0 Stable 不应该在真正 OS Sandbox 完成之前发布。**

可以先发布：

```text
1.0 Beta
```

但 Stable 必须明确完成安全 runtime。

---

## 13.2 TypeScript + Rust 的合理分工

现在不建议把整个项目重写 Rust。

推荐：

```text
TypeScript
→ Agent brain / orchestration / context / policy / UI

Rust sidecar
→ process execution / sandbox / filesystem confinement / OS integration
```

也就是：

```text
Vessel Core (TS)
      │
      │ JSON-RPC / stdio
      ▼
Vessel Runtime (Rust)
```

先做 Windows，因为这是你的主环境。

后续：

- macOS Seatbelt backend；
- Linux Landlock/seccomp/bwrap backend。

---

## 13.3 Runtime 必须回报真实 Enforcement

当前已有 `SandboxStatus` 思路，应扩展成：

```json
{
  "backend": "windows-restricted-token",
  "filesystem": "enforced",
  "process": "enforced",
  "network": "partial",
  "fallback": false
}
```

UI 必须显示：

```text
Safety
Protected
```

或者：

```text
Partial Protection
```

禁止安全状态“看起来启用了，实际上 passthrough”。

---

# 十四、凭据系统

V1.x 把：

```text
~/.dsh/providers.json
```

迁移成：

```text
~/.vessel/providers.json
```

其中只存：

```json
{
  "id": "deepseek",
  "protocol": "openai-compatible",
  "baseUrl": "...",
  "model": "...",
  "secretRef": "credential:vessel/deepseek"
}
```

API key 存 OS Credential Store。

新增：

```text
CredentialStore interface
```

后端：

```text
Windows Credential Manager
macOS Keychain
Linux Secret Service
```

如果系统不可用，再显式提示用户是否允许 plaintext fallback。

不能默默回退。

---

# 十五、Cross-Harness Conformance Suite：项目真正的“护城河”

这是当前最应该补强、而不是继续堆功能的地方。

目前 benchmark 已经有 B001–B023 的场景资产，但真正的 Cross-Harness 价值还没有完全跑起来。

## 15.1 分五层 Benchmark

### L0 — Unit / Integration

现有 Vitest。

### L1 — Deterministic Harness Scenarios

现有 B001–B023。

继续增加：

- streaming；
- interrupt；
- steering；
- resume；
- provider malformed tool call；
- compaction；
- context reset；
- external review handoff；
- sandbox；
- permission false positive。

### L2 — Real Model Regression

固定真实模型：

```text
DeepSeek V4 Pro
DeepSeek V4 Flash
```

每次 release 跑 20–50 个固定场景。

### L3 — Cross-Harness

同一 fixture 跑：

```text
Vessel
DSH
OpenCode
Codex
Pi
Claude Code（可自动化的部分）
```

统一采集：

```text
success
wall time
tool calls
invalid calls
retries
input/output/cache tokens
cost
context peak
compactions
human intervention
policy violations
resume success
```

### L4 — Long-Running Soak

运行：

```text
30 min
1 h
3 h
6 h
```

重点：

- 状态漂移；
- context；
- cost runaway；
- tool retry storm；
- memory corruption；
- session resume。

### L5 — Safety Conformance

攻击：

- 删除；
- 路径逃逸；
- symlink；
- prompt injection；
- MCP malicious result；
- git destructive actions；
- secrets read；
- network SSRF；
- policy merge downgrade。

---

# 十六、Vessel V1.x 建议版本路线

## V0.10 — Stabilization / Release Preparation

目标：**先把现有项目从“迭代痕迹很多”整理成干净产品基线。**

任务：

1. Windows clean install 后重跑全部测试；
2. package/product version 统一；
3. `~/.dsh` → `~/.vessel` migrator；
4. 决定 `.harness` → `.vessel` 项目状态迁移策略；
5. root README；
6. LICENSE；
7. SECURITY.md；
8. CHANGELOG；
9. CI：Windows + Linux；
10. provider key 明文风险文档显式化。

### 验收

```text
clean clone
→ npm install
→ npm run build
→ npm test
→ vessel --version
→ vessel run mock
```

全通过。

---

## V1.0-beta — Dual Surface

目标：**CLI + Local Web 同一 Harness。**

任务：

1. 新建 `@vessel/application`；
2. compose 从 CLI 移到 application；
3. `apps/local-server`；
4. 固定 `127.0.0.1:5678`；
5. `apps/web` React + Vite；
6. Session list；
7. conversation projection；
8. tasks / changed files projection；
9. UI 模块勾选；
10. system light/dark；
11. `vessel web` / `vessel serve`。

### 明确不做

- Electron；
- full-screen CLI TUI；
- cloud account；
- remote collaboration；
- marketplace。

---

## V1.1 — Live Agent UX

目标：**让 Vessel 真正像生产 Agent 一样“活着工作”。**

任务：

1. Streaming Providers；
2. streaming AgentLoop；
3. SSE；
4. interrupt；
5. steering；
6. live Tool Activity；
7. live Context Usage；
8. live Cost；
9. resume session；
10. crash recovery UI。

---

## V1.2 — Roles + Routing

目标：**把已有多模型/多 Agent 机制产品化。**

任务：

1. AgentPreset schema；
2. Lead / Developer / Reviewer；
3. TaskRouter 默认 Auto；
4. model tier；
5. TeamProjection；
6. internal Reviewer；
7. external review handoff；
8. UI 3 Agents 面板；
9. simple task auto single-agent；
10. complex task auto team。

---

## V1.3 — Real Loop

目标：**把 LoopEngine 从“组件”变成“可实际使用的 Goal Mode”。**

任务：

1. RealGeneratorAdapter；
2. RealEvaluatorAdapter；
3. persistent TaskQueue；
4. Worktree isolation；
5. retry / evaluator feedback；
6. Goal UI；
7. Loop budget；
8. pause / resume；
9. Handoff artifact；
10. long-run report。

---

## V1.4 — Security Runtime

目标：**让“硬安全边界”名副其实。**

任务：

1. CredentialStore；
2. Rust execution sidecar PoC；
3. Windows restricted execution；
4. process tree control；
5. filesystem boundary；
6. network policy seam；
7. sandbox status；
8. security test suite；
9. approval/escalation protocol；
10. UI Safety status。

完成前继续标 Beta。

---

## V1.5 — Cross-Harness Proof

目标：**证明 Vessel，而不是描述 Vessel。**

任务：

1. DSH adapter；
2. OpenCode adapter；
3. Codex adapter；
4. Pi adapter；
5. Claude Code 可测 adapter；
6. 30+ shared scenarios；
7. real DeepSeek models；
8. report generator；
9. regression thresholds；
10. README Benchmark section。

这一步完成后，项目才真正拥有“别人难复制的资产”。

---

## V1.6 — 1.0 Stable

Stable 门槛建议：

```text
✓ 双 Surface
✓ Streaming
✓ Interrupt / Steering
✓ Resume
✓ Model Routing
✓ 3-Agent Profile
✓ External Review Handoff
✓ OS-level Sandbox 至少 Windows 可用
✓ Secret Store
✓ Cross-Harness Benchmark
✓ Long-run 3h soak
✓ 安全场景全绿
✓ clean install 可复现
```

然后正式：

```text
Vessel 1.0.0
```

---

# 十七、V2.x 再考虑的东西

以下都不要现在做：

### V2.0 候选

- Remote Control；
- Cloud worker；
- multi-device；
- team collaboration；
- plugin marketplace；
- skills registry；
- background scheduler；
- persistent multi-project agent；
- autonomous maintenance；
- learned behavior curator；
- web/mobile companion。

这些是“Agent OS”阶段，不是当前阶段。

---

# 十八、当前明确不要做的事情

## 1. 不再继续扩 71 个 Provider

71 已经足够。

新增 Provider 必须来自：

- 用户真实需求；
- 新协议；
- 重要官方供应商。

不是为了数字好看。

---

## 2. 不做复杂全屏 TUI

CLI 当前“丑”不代表要投入大量时间复制 OpenCode TUI。

Vessel 的差异化不应该是：

> “我也有一个很好看的终端。”

而应该是：

> “同一个 Agent Harness，终端和网页都能自然工作。”

---

## 3. 不上 Electron

Local Web 先跑通。

等真实用户使用后再决定是否需要 Desktop Shell。

---

## 4. 不做微服务

当前约 15k TS LOC，完全没必要。

模块化单体继续保持。

---

## 5. 不做无限多 Agent

默认最多 3 个。

Simple Task 用 1 个。

---

## 6. 不做自动自我改写核心

Learning 只能：

```text
suggest
→ candidate
→ review
→ learned scope
```

不要让 Agent 修改 core/policy 自己放权。

---

## 7. 不把 Gemini/AGY CLI 硬伪装成 API Provider

先用 External Review Protocol。

---

# 十九、后续开发任务拆卡建议

建议从下一轮直接从 **032** 开始。

## Milestone A — V0.10 Stabilization

```text
032 clean-install baseline + version taxonomy
033 ~/.vessel migration
034 credential storage abstraction
035 public README / LICENSE / SECURITY / CHANGELOG
036 Windows/Linux CI + package smoke
```

## Milestone B — V1.0-beta Surface

```text
037 @vessel/application extraction
038 SessionRegistry + ProjectRegistry
039 local server 127.0.0.1:5678
040 event projections + SSE
041 apps/web shell
042 conversation UI
043 task/files optional modules
044 vessel web / vessel serve
045 light/dark + Chinese/English i18n skeleton
```

## Milestone C — V1.1 Live

```text
046 streaming provider contract v2
047 OpenAI-compatible stream
048 Anthropic stream
049 AgentLoop stream wiring
050 interrupt controller
051 steering queue
052 live tool/context/cost projections
053 resume/crash UI
```

## Milestone D — V1.2 Team

```text
054 AgentPreset spec
055 Lead/Developer/Reviewer presets
056 TaskRouter default Auto mode
057 TeamRuntime / TeamProjection
058 Internal Reviewer flow
059 External Review Handoff
060 team UI
```

## Milestone E — V1.3 Goal Loop

```text
061 RealGeneratorAdapter
062 RealEvaluatorAdapter
063 persistent project TaskQueue
064 worktree lifecycle
065 Goal/Loop UI
066 pause/resume/budget
067 Context Reset Handoff
068 1h soak test
```

## Milestone F — V1.4 Security

```text
069 OS Credential Store
070 vessel-runtime Rust protocol
071 Windows sandbox backend
072 process-tree confinement
073 filesystem confinement
074 runtime enforcement telemetry
075 safety benchmark pack
```

## Milestone G — V1.5 Conformance

```text
076 harness adapter contract
077 DSH adapter
078 OpenCode adapter
079 Codex adapter
080 Pi adapter
081 Claude Code adapter
082 real-model benchmark lane
083 report/dashboard
084 release gates
```

---

# 二十、每个版本的验收方式必须改变

以前主要验收：

```text
test green
feature exists
```

以后应变成四层：

```text
1. Code
2. Behavior
3. UX
4. Long-run
```

例如 Streaming：

### Code

```text
unit pass
provider parse pass
```

### Behavior

```text
tool call streaming 不丢参数
usage 正确
```

### UX

```text
Web 实时显示
Stop 立即生效
```

### Long-run

```text
连续 30 分钟无 memory/event leak
```

---

# 二十一、建议建立 Release Gate

每次进入版本收尾，固定跑：

```text
Gate 1 Build
Gate 2 Unit
Gate 3 Deterministic Bench
Gate 4 Real Model Bench
Gate 5 Safety
Gate 6 Resume
Gate 7 UX Smoke
Gate 8 Packaging
```

最终输出：

```text
release-report.json
release-report.md
```

不要再只靠“子代理说做完了”。

这非常符合 Vessel 的：

> 不以自证为证。

---

# 二十二、项目成功的判断标准

Vessel 不应以“功能多少”判断成功。

真正成功应该表现为：

## 1. 用户层

```text
下载安装到开始工作 < 5 分钟
```

## 2. 日常层

```text
用户只输入目标
而不是天天配置 Agent / Model / Tool
```

## 3. 可靠性

```text
任务出错
→ 可恢复
→ 可审计
→ 不丢上下文
```

## 4. 安全

```text
模型犯错
≠ 主机立即遭殃
```

## 5. 证据

```text
Vessel 在固定 benchmark
比 native baseline 更稳定 / 更安全 / 更少干预
```

## 6. 可替换

```text
换模型
不改 Agent Core
```

这才真正符合 Vessel 这个名字。

---

# 二十三、我建议你现在立即做什么

如果现在只能选一个下一步，我不会先做 Multi-Agent，不会先做 Sandbox，也不会先加 Provider。

我会按这个顺序：

```text
第一步
V0.10 清理 / 稳定基线

第二步
抽出 @vessel/application

第三步
Local Server :5678

第四步
极简 Web UI

第五步
Streaming + Interrupt

第六步
3-Agent / Router 接入真实路径

第七步
LoopEngine 真接线

第八步
OS Sandbox

第九步
Cross-Harness Benchmark
```

原因是：

> 当前项目不是“能力不够”，而是“能力还没有被整理成一个真正可以每天使用的产品”。

---

# 二十四、最终目标架构

```text
                           VESSEL
        Carry intelligence. Shape behavior. Guard execution.

                              │
                    ┌─────────┴─────────┐
                    │ Application Layer │
                    └─────────┬─────────┘
                              │
             ┌────────────────┴────────────────┐
             │                                 │
         CLI Surface                       Web Surface
         vessel                         127.0.0.1:5678
             │                                 │
             └────────────────┬────────────────┘
                              │
                      Session Controller
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
     Agent Loop           Team / Router         Loop Engine
         │                    │                    │
         ├──────────┬─────────┴───────┬────────────┤
         │          │                 │            │
      Context     Behavior          Policy      Evaluator
         │          │                 │            │
         └──────────┴───────┬─────────┴────────────┘
                            │
                         Tools / MCP
                            │
                      Vessel Runtime
                       (Rust sidecar)
                            │
                 OS Sandbox / Process / FS
                            │
                    Real User Workspace
```

这张图里最关键的一点：

> **CLI 和 Web 在最上面；Vessel 真正有价值的东西全部在下面。**

Surface 可以换，Model 可以换，Agent 可以换。

Vessel 仍然是 Vessel。

---

# 二十五、一句话收尾

当前项目最危险的下一步不是“做错功能”，而是**继续因为看到别家有一个功能，就给 Vessel 再加一个功能**。

现在应该结束“功能收集期”，进入“系统收敛期”。

下一阶段只围绕三件事：

```text
Productize
让它真正好用

Harden
让它真正可靠

Prove
让数据证明它有价值
```

这三件事完成后，Vessel 才会从一个很完整的 Harness 工程项目，变成一个真正有产品身份、有技术差异、有公开价值的 Agent。
