# 开源 Agent Harness 研究对象权威索引与落地对照表 (REFERENCE-HARNESS-INDEX.md)

> **文档定位**：本文件整理自项目立项初期的核心参考源清单，规范化了固定仓库源、研究重点，并补充了 Vessel 历经 V0.1 至 V1.6 演进后的实际吸收、落地与转化对照记录。  
> **更新日期**：2026-10-02  
> **Clean-room 纪律**：所有外部开源仓库仅作为行为基准与架构设计参考，严禁直接复制或逆向源码，严格遵循接口自主设计原则。

---

## 1. 核心研究对象与 Vessel 落地转化矩阵

| 序号 | 项目名称 | 权威固定仓库源 | 核心研究维度 | Vessel 实际吸收与落地状态 |
|---|---|---|---|---|
| 1 | **Claude Code** | [anthropics/claude-code](https://github.com/anthropics/claude-code) | 官方产品架构、Hooks、Skills、权限与行为基准 | **已深度吸收**：Hooks 规范已在 Behavior IR 中抽象；Claude 插件与 Hook 生态全兼容层已于 V1.2（Epic 162 / 任务 159）落地。 |
| 2 | **Claw Code** | [ultraworkers/claw-code](https://github.com/ultraworkers/claw-code) | Rust 行为一致性实现、Parity Harness、工具与会话压缩 | **已吸收并升维**：Parity 理念升级为 Cross-Harness Conformance Suite；Bash 与 File 工具实现已独立重构并通过契约测试。 |
| 3 | **Pi / pi-mono** | [badlogic/pi-mono](https://github.com/badlogic/pi-mono) | 极简 Agent Kernel、统一 LLM API、Coding CLI | **核心已落地**：薄核思想已彻底在 `packages/core/src/agent-loop/AgentLoop.ts` 落地（仅负责状态步进，不侵入外围机制）。 |
| 4 | **DeepSeek Harness** | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | Everything-is-a-Plugin、事件总线、桌面协同 | **已吸收并在桌面网格落地**：插件哲学融入 Policy 拦截器；团队编排机制与桌面 Daemon 已在 V1.5（任务 172）与 V1.6（任务 175–176）落地。 |
| 5 | **OpenAI Codex** | [openai/codex](https://github.com/openai/codex) | Rust Runtime、OS 沙箱、Approval 审批、工具执行 | **已深度落地**：Windows Job Object 进程树隔离落地（任务 171）；方案预审（Approve & Run）落地（任务 175）；受限令牌纳入任务 180。 |
| 6 | **OpenCode** | [anomalyco/opencode](https://github.com/anomalyco/opencode) | 客户端/服务端架构、多 Provider、TUI/Web、SQLite | **已全面吸收**：Local Server 解耦（`apps/local-server`）、多 Provider 动态自省（任务 157）、SQLite WAL 与 FTS5 检索（任务 178）已全量落地。 |
| 7 | **Hermes Agent** | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | 记忆、技能、自学习循环、持久化 Agent | **部分落地 / 后续参考**：Memory 与 Skills 模块已在 `packages/` 独立成型；自省提炼与混合记忆检索规划于 V1.8（任务 181）。 |
| 8 | **CL4R1T4S** | [elder-plinius/CL4R1T4S](https://github.com/elder-plinius/CL4R1T4S) | 商业 Agent 泄露 Prompt 与行为语料研究 | **严格红线隔离**：全量标记为 UNTRUSTED RESEARCH DATA，仅供逆向防御参考，严禁直接作为 System Prompt 注入（硬性约束 1）。 |

---

## 2. 重点仓库深度研究路径与架构参考点

### 2.1 Claude Code 与 Claw Code

- **Claude Code 官方仓** (`anthropics/claude-code`)：
  - 核心参考点：官方 CLI 的命令行交互范式、Hooks 拦截机制、Skills 发现机制与默认安全确认等级。
  - 当前定性：作为产品功能完整性与用户交互习惯的权威基准。
- **Claw Code** (`ultraworkers/claw-code`)：
  - 核心参考目录：`/rust/crates/runtime/`、`/rust/crates/tools/`、`/PARITY.md`。
  - 启发点：其 `PARITY.md` 详尽梳理了 Bash、File Tools、Task Registry、Compaction 等机制的对齐标准，直接启发了 Vessel 的跨框架行为评测思想。

### 2.2 Pi / pi-mono

- **权威路径** (`badlogic/pi-mono`)：
  - `packages/pi-ai`：统一多供应商抽象。
  - `packages/pi-agent-core`：极简 Agent Loop 运行时与状态流转。
  - `packages/pi-coding-agent`：轻量命令行工具链。
- 启发点：证明了一个优秀的 Agent 核心循环必须足够精简（Sub-1000 行），外围机制通过生命周期事件挂载，这一思想构成了 Vessel 薄核（Thin Core）铁律的基础。

### 2.3 DeepSeek Harness

- **权威路径** (`deepseek-ai/deepseek-harness`)：
  - `README.md`、`docs/architecture/`、`packages/`。
  - 启发点：研究其“Everything is a Plugin”的插拔能力与长周期长任务运行时的状态保全，技术沉淀已归档至 `docs/research/DSH-DESKTOP-AND-TEAMS.md`。

### 2.4 OpenAI Codex

- **权威路径** (`openai/codex`)：
  - `codex-rs/`：Agent Loop、Tool execution、Sandbox、Approval、Session。
  - 启发点：作为系统级安全沙箱与严苛审批机制的参考范式，指导了 Vessel 在 Windows Job Object、文件锁自愈与 Low-Integrity 令牌隔离的设计。

### 2.5 OpenCode

- **权威路径** (`anomalyco/opencode`)：
  - 重点研究：`packages/opencode/` 下的 `session`、`provider`、`server`、`client`。
  - 启发点：OpenCode 的本地 Client/Server 架构与 SQLite 高性能索引实践，为 Vessel 提供了双 Surface（CLI + Web）同构设计以及 SQLite WAL 会话投影的工程依据，技术分析已落盘至 `docs/research/OPENCODE-V2-ARCHITECTURE.md`。

### 2.6 Hermes Agent 与 CL4R1T4S

- **Hermes Agent** (`NousResearch/hermes-agent`)：
  - 重点研究：Self-improving AI agent 机制、经验转 Skill 管道与持久化定时任务，作为后续任务 181 经验图谱演进的重要参考。
- **CL4R1T4S** (`elder-plinius/CL4R1T4S`)：
  - 约束要求：该仓库包含各类提示词注入攻击向量，仅作为安全基准（Safety Benchmark S001–S008）对抗样本的研究语料，严禁侵入生产 Prompt。

---

## 3. 研究对象版本锁定与追踪规约

为了确保研究结论的可复现性，后续凡引入新的次级参考源（Secondary Source）时，必须在文档中精确记录三要素：
1. 仓库 URL (`Repository URL`)；
2. 固定的提交哈希 (`Commit SHA`)；
3. 访问与评估日期 (`Evaluation Date`) 及引入依据。
