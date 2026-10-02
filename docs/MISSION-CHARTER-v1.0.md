# 《通用 Coding Agent Harness 二次开发任务书 v1.0》(MISSION-CHARTER-v1.0.md)

> **文档定位**：本项目（Vessel，前身 Composable Agent Harness）的创世任务书（Founding Charter），编制于 2026-09-05。  
> **归档与对照状态**：**已全面闭环并升维**（2026-10-02 对账）。本任务书规划的规范产物、核心架构铁律与早期里程碑已 100% 落地。  
> **规范依据**：本任务书是 `docs/ARCHITECTURE.md`、`docs/DESIGN-DECISIONS.md`、`docs/POLICY-SPEC.md` 与 `docs/BEHAVIOR-IR-SPEC.md` 的事实起源。

---

## 0. 创世要求与当前实施状态对照 (Founding Charter Delivery Matrix)

| 阶段 / 规划项 | 任务书原始要求 | 当前实际落地状态 (截至 V1.6) | 权威依据文档 |
|---|---|---|---|
| **核心定位** | Composable Agent Harness：Behavior IR + Compiler + Policy Runtime | **已完全落地**：系统形成 Behavior IR、Compiler 与硬策略运行时，作为核心产品差异 | `docs/ARCHITECTURE.md` |
| **交付物 D1–D8** | 解剖矩阵、对比矩阵、决策记录、IR/Event/Policy/Benchmark 规范 | **全部交付合入**：D1–D8 八份顶层设计规范在根目录 `docs/` 完整成型并持续生效 | `docs/DESIGN-DECISIONS.md` 等 |
| **三大铁律** | 薄核（Thin Core）、Prompt/Runtime 分离、Generator/Evaluator 分离 | **全仓硬性约束**：写入 `AGENTS.md`，并在 CI/测试中设立守卫拦截破坏 | `AGENTS.md` |
| **V0.1–V0.5 里程碑** | 薄 Loop、MCP/Subagent、Memory/Skills、TaskRouter、Loop Engine | **已全部合入**：100% 通过确定性离线回归测试与独立代码审查 | `docs/REVIEW-REPORT-V0{1..5}.md` |
| **跨框架评测** | Parity / Benchmark / Cross-Harness Conformance Suite | **已构建完成**：25 个确定性离线基准场景全部全绿通过 | `benchmarks/runners/` |

---

## 一、项目目标

基于现有高质量 Coding Agent / Harness 项目进行系统拆解、横向对比与二次设计，最终形成一个：

> **小型到中型、模块化、可插拔、多模型、可扩展、带硬安全边界的 Coding Agent Harness。**

项目不追求重新造一个巨型 Claude Code。

核心目标是：

```text
取各家长处
    ↓
抽象公共机制
    ↓
建立统一 Agent 行为层
    ↓
重新实现一个干净的中型 Harness
```

最终目标公式：

```text
Agent = Model + Behavior + Context + Tools + Policy + Memory + Evaluator + Orchestration + Runtime
```

---

## 二、核心原则

必须严格遵守以下原则：

### 1. 不直接拼接项目代码
禁止简单堆叠或逆向拼凑外部源码，遵循“研究实现 → 抽象机制 → 编写规范 → 自主实现”的 Clean-room 流程。

### 2. Core 必须足够薄
Agent Core 只负责核心步进：
`Model Call → Tool Call → Tool Result → State Update → Continue / Stop`。
Memory、Skill、Sandbox、Subagent、Hooks 等不得硬编码进入 Core。

### 3. Prompt 和 Runtime 必须分离
安全规则（如禁止删除关键目录）禁止仅写在 Prompt 中，必须实现双通道硬执法：
- Prompt Guidance（给模型的指导）
- Tool Interceptor（工具拦截器）
- Runtime Deny（运行时拒绝）
- Audit Event（审计事件）

### 4. Generator 和 Evaluator 必须分离
Generator Agent 不得自证任务完成，产物必须经过独立 Evaluator（或确定性静态判据）验证。

### 5. 依赖严格单向，绝对禁止循环依赖
Core 仅依赖 shared；Policy 绝不反向依赖 tools；Context 绝不反向依赖 CLI。

---

## 三、第一阶段研究对象与基准矩阵 (H01–H12)

通过对 Claude Code、Claw Code、Pi-mono、DeepSeek Harness、OpenAI Codex、OpenCode、Hermes Agent 与 CL4R1T4S 的解剖，提炼了十二项关键机制：
- **H01 CLI Interface**：命令行解析、交互循环、TUI 与控制台透出；
- **H02 System Prompt**：稳定系统引导、行为微调与角色模板；
- **H03 Context Engine**：上下文组装、Token 预算分配与前缀缓存优化；
- **H04 Compaction**：长会话动态上下文压缩与溢出恢复；
- **H05 Tool System**：工具注册表、参数校验与跨进程执行；
- **H06 Hooks / Middleware / Events**：生命周期拦截与事件驱动；
- **H07 Permission / Safety**：安全策略模型、风控拦截与人在循环确认；
- **H08 Sandbox**：宿主文件系统隔离、进程树监管与特权降权；
- **H09 Session / Memory**：会话持久化、日志追溯与短期/长期记忆；
- **H10 Skills**：动态技能发现、渐进式披露与脚本挂载；
- **H11 Subagent / Multi-Agent**：子代理网格、隔离运行时与 Worktree 隔离；
- **H12 Evaluator / Verification**：确定性验证机制与双盲独立审查。

*(注：上述十二项机制的完整解剖对比详见 `docs/HARNESS-ANATOMY.md` 与 `docs/HARNESS-COMPARISON.md`)*

---

## 四、核心阶段演进路线

### 1. Behavior IR 与 Behavior Compiler
将行为规则从散乱的自然语言提示词中抽离，定义结构化声明式 Behavior IR（`configs/behavior.default.yaml`），并通过编译器将其确定性编译进 Agent 的 Stable System Prompt 与运行时策略。

### 2. Policy Runtime
构建独立于模型的策略硬执法引擎，支持 `allow / ask / deny` 三态判定，针对高危文件操作、网络外联与命令执行实现毫秒级阻断与结构化审计。

### 3. 渐进式版本节奏
- **V0.1**：薄 Core Loop、基础工具集、Session JSONL、基础 Policy 引擎；
- **V0.2**：MCP 协议客户端、Subagent 基础架构、Evaluator Agent 独立验证；
- **V0.3–V0.5**：Memory / Skills 挂载、TaskRouter 动态分流、Loop Engine 自动化循环。

*(注：V0.1 至 V0.5 已经于 2026 年 9 月全部交付并通过验收，后续 V1.0 至 V1.6 的产品化与网格演进详见 `docs/Vessel_后续开发方向与产品化路线_v1.0.md` 与各版本 Roadmap)*

---

## 五、底线禁令与红线纪律

1. 禁止一开始盲目实现复杂的 Web 界面或超大 Agent 队伍；
2. 禁止把 Prompt 当作安全边界，禁止缺乏硬性运行时的纯文本防御；
3. 禁止 Generator 默认自判通过；
4. 严格遵守 Clean-room 规范，严禁侵犯外部开源项目版权；
5. 必须保持模块化单体架构，禁止提前微服务化。
