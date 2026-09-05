# MISSION V0.1 — Composable Agent Harness 第二阶段执行任务书

> 总指挥签发（前序窗口，2026-09-05）。本文件 + `任务书.md` 的第九/十节 + `docs/ARCHITECTURE.md` 是 V0.1 实现的唯一权威依据。
> 工作区：`C:\work\Vessel_Harness`（必须在同一工作区打开新窗口）。

---

## 一、状态交接（第一阶段已完成，验收 PASS）

第一阶段（Harness 解剖 + 规范设计）已全部交付并经独立审查 **VERDICT: PASS**（`docs/REVIEW-REPORT.md` 末尾）。现状：

| 资产 | 位置 | 内容 |
|---|---|---|
| 总任务书 | `任务书.md` | 项目完整目标、原则、路线（V0.1–V0.5）、禁止事项、汇报格式 |
| 研究对象 URL | `参考.md` | 8 项目固定源 |
| 8 份项目解剖 | `docs/research/harness-matrix/{claude-code,claw-code,pi,deepseek-harness,codex,opencode,hermes,cl4r1t4s}.md` | 每份 H01–H12 全维度 + 行为要点 |
| 横向矩阵+决策 | `docs/research/harness-matrix/comparison.md` = `docs/HARNESS-COMPARISON.md` | 12×7 矩阵 + 每机制 Decision/Why/Rejected/Proposed Spec |
| 解剖总纲 | `docs/HARNESS-ANATOMY.md` | 各机制跨家对比 + 共同抽象 |
| 架构决策 | `docs/DESIGN-DECISIONS.md` | 16 个决策点（≥2 候选/理由/拒绝/影响），**实现必须遵守** |
| 行为 IR | `docs/BEHAVIOR-IR-SPEC.md` | 12 类 49 条 + L0–L4 编译管线 |
| 事件规范 | `docs/EVENT-SPEC.md` | 48 事件定义（v0.1 用其中 BeforeTool/AfterTool 等子集） |
| 策略规范 | `docs/POLICY-SPEC.md` | 软/硬分离四件套，6 策略域 |
| 基准规范 | `docs/BENCHMARK-SPEC.md` | 19 scenario（B001–B019）+ 14 指标 + A/B 设计 |
| V0.1 架构 | `docs/ARCHITECTURE.md` | **V0.1 模块边界与落码依据** |
| 基准目录 | `benchmarks/{fixtures,scenarios,runners,reports}/` | 空骨架，本阶段填充首批 |

## 二、本阶段目标

按 `docs/ARCHITECTURE.md` 的 V0.1 模块边界，**用 TypeScript 实现一个可运行的最小 Harness V0.1**（模块化单体，不微服务化），并落地首批 benchmark fixture。

## 三、V0.1 范围（照 ARCHITECTURE.md §V0.1 与 任务书.md 第十节，克制）

实现：
- **CLI** 入口（`claude` 式最小交互/单发模式）
- **Model Provider** 抽象 + 至少 1 个可用实现（OpenAI-compatible 优先；接口预留 Anthropic/OpenAI）
- **6 个核心工具**：Read / Write / Edit / Glob / Grep / Shell
- **Core Agent Loop**（薄核：Model Call → Tool Call → Result → State Update → Continue/Stop）
- **Session**（对话状态保存/恢复）
- **Context Builder**（指令 + 历史 + 工具定义组装）
- **Basic Compaction**（最简上下文压缩）
- **Event Bus** + BeforeTool / AfterTool（对应 EVENT-SPEC v0.1 事件子集）
- **Policy Engine**（POLICY-SPEC 四件套的最小落地：至少 filesystem.protected 与 shell.deny 两域，Prompt Guidance + Runtime Deny + Audit 事件；软约束与硬约束分离）
- **Evaluator 契约**（Generator/Evaluator 分离：测试/验证门禁接口）
- **Vitest 测试** 覆盖上述核心路径

明确不做（V0.2+ 或任务书明确排除）：Web UI、IDE、Cloud、20-Agent Team、自动学习、Marketplace、复杂 RAG、浏览器自动化、MCP、Subagent、Async Hooks、Guardian 主链（见 ARCHITECTURE.md 克制项清单）。

## 四、硬性约束

1. **clean-room 自主实现**：以本仓库 spec 为准写代码，不复制研究项目源码（任务书第十九节）。参考实现细节可查 `docs/research/harness-matrix/` 但不得照搬。
2. **Prompt 与 Runtime 分离**：安全规则必须同时落在 Policy Engine（硬），禁止只写进 prompt。
3. **Generator/Evaluator 分离**：不得自宣布完成；用测试/Evaluator 验证后才算完成。
4. **模块化单体**：单仓库 packages/*（或 src/* 分层），依赖方向零环，Core 保持薄。
5. **全局铁律**：禁止任何永久删除（回收站）；禁止 force push/重写 git 历史；默认 TypeScript；Windows/PowerShell 环境。
6. **多步任务用 todo 追踪**；每完成一个里程碑按任务书精神自我验证。

## 五、建议里程碑（M1→M7 顺序推进，每个都跑得动）

- **M1** monorepo 骨架：package 划分、tsconfig、vitest 基建、CLI 入口冒烟（`--help`/`--version` 可跑）
- **M2** Event Bus + Session 基础（事件发布/订阅 + 会话保存恢复）
- **M3** 最小闭环：Context Builder + 工具注册表（6 工具）+ Agent Loop 跑通"读文件→回答"一轮
- **M4** Provider 接口 + OpenAI-compatible 实现（可用 mock/本地端点先验证）
- **M5** Policy Engine（filesystem.protected + shell.deny）+ BeforeTool/AfterTool 接线 + Audit
- **M6** Basic Compaction
- **M7** Evaluator 契约 + Vitest 测试补齐 + `benchmarks/` 落地首批 scenario（至少 B001 读取文件、B002 搜索代码、B003 修改单文件、B004 修改多文件、B005 Bash 执行可跑通）

## 六、验收标准（全部满足才算完成）

1. V0.1 范围内每项有可运行代码 + 对应 Vitest 测试通过
2. Agent Loop 端到端冒烟：CLI 能对工作区一个真实小任务完成至少 1 轮"读→工具→回答"
3. Policy 演示：一条被 shell.deny 拦截的命令返回 DENY + 审计事件，而非仅靠 prompt 劝阻
4. `benchmarks/` 首批 5 个 scenario 有 fixture 且本地实现能跑（输出 JSONL 报告）
5. 交付说明 `docs/V01-IMPLEMENTATION-NOTES.md`：模块地图、如何跑、测试命令、已知限制
6. 独立审查 PASS（对代码与测试做 Evaluator 式复审）

## 七、执行经验（前序窗口踩坑，务必遵守）

- **后台并行 subagent 在本环境不可靠**（大批量会中途失败）：需要多代理时用**前台逐个执行**（run_in_background: false），或小批量（≤3）后台。
- 研究/抓取类工作优先 `web_fetch`；`git clone --depth 1` 到 `%TEMP%` 可行但失败勿重试超 2 次。
- 长文档阅读用 read 分段（offset/limit）。
- 审查请用独立 Evaluator 视角（新开审查窗口或前台 subagent 扮演），不要自己审自己。
- 目标轮数：本阶段建议 `create_goal` 的 max_goal_rounds = 60。

## 八、向总指挥汇报格式（完成后）

结论 / 交付物清单（路径）/ 验证证据（测试输出、冒烟结果、benchmark 报告节选）/ 已知限制与后续（V0.2 建议）。
