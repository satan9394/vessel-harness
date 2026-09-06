# MISSION V0.4 — Composable Agent Harness V0.4 执行任务书（Task Router / Orchestration Policy）

> 总指挥签发（2026-09-05，无人值守自主推进，personal-dev-workflow）。
> V0.3 已闭环：146 测试全绿 + 独立核验 VERDICT: PASS（docs/REVIEW-REPORT-V03.md）。
> 想法来源：docs/ideas/001-task-router-orchestration.md（oh-my-openagent 启发，用户已排 V0.4）。
> 工作区：`C:\work\Vessel_Harness`。

---

## 一、本阶段目标

在 V0.3 之上增量实现 **Task Router / Orchestration Policy 主线**（docs/ideas/001）：用户表达任务意图，Harness 决定"该用哪个角色/哪类模型"——衔接 D3 决策点 13（Model Profile，多模型差异下沉 profile）与决策点 12（角色 = preset 配置，"机制先于角色"）、任务书 V0.5 Loop Engine 的 Task Selection 上游物化。

一句话定位：**用户说"做什么"，Harness 决定"派谁/用什么模型做"。**

## 二、V0.3 交接现状（相关部分）

- `packages/llm/src/router/Router.ts`：SimpleRouter（18 行）——拿到 RouterHints 直接透传 provider/model，**无任务类别→模型/角色能力**。
- `packages/shared/src/provider.ts`：Router/RouterHints/ChatProvider 接口（core/agent-loop 依赖此接口，不 import llm 实现）。
- `packages/agents/`：V0.2 有 SubagentManager/Planner/EvaluatorAgent（机制）；决策点 12 明示"角色只是预设配置，机制先于角色"。
- 多 provider 已支持（OpenAICompatible/Mock），但无"按任务类别路由到不同 provider/model"的编排层。
- 测试基线：146 用例全绿；`npx tsc -b` exit 0。

## 三、V0.4 范围（克制增量，任务路由主线第一刀）

1. **Task Category 分类器**：把用户任务意图（自然语言 prompt）映射到任务类别（如 architecture/search/implementation/review/simple-fix/planning 等，类别集可配置）。实现方式：确定性规则 + 关键字分类器起步（不依赖 LLM，可离线测试），预留 LLM 分类 seam。
2. **Agent/Model Preset 库**：任务类别 → 预设（角色 + 模型类别 + 工具收窄提示）的映射表。落地决策点 12（角色=preset）与决策点 13（模型差异走 profile）：preset 声明 { category, agentPreset?, modelTier, description }。
3. **TaskRouter 路由**：给定任务 → 类别 → preset → (provider, model, agentPreset)；替换/增强 SimpleRouter；与 RouterHints 兼容（显式 hints 优先，类别路由兜底）。subagent 委派可用 preset 指定执行者。
4. **Benchmark 场景**：B022（分类路由——同一 harness 两类任务路由到不同 mock provider/model 且可断言）+ 收尾（V04-IMPLEMENTATION-NOTES.md + 独立核验）。

明确不做（V0.4 不做 / 后置）：可继续子代理（send_message/interrupt，EVENT-SPEC A25 预留，V0.5+）、learned/ 完整化（Snapshot/Rollback/Curator）、Task Router 的 LLM 分类器（seam 预留，实现留规则版）、Web UI、20-Agent Team。

## 四、硬性约束（同 V0.1–V0.3，逐条遵守）

1. clean-room：以本仓库 spec/架构为据，不复制研究项目源码。
2. 薄核纪律：llm/ 不反向依赖 core 实现（core 依赖 shared 接口）；agents 角色 preset 是配置不是新机制。
3. Generator/Evaluator 分离；依赖零环；无永久删除（回收站）；TypeScript；Windows/PowerShell；禁止 force push。
4. 新功能必须有 Vitest 测试；146 用例不得回归；B001–B021 benchmark 不回归。
5. 分类器默认确定性（离线可测）；LLM 分类只留 seam，不默认依赖网络。
6. preset 库是数据/配置，不硬编码进 core 或 agents 机制代码（可配置、可扩展、不抄 OmO 具体角色名）。

## 五、建议里程碑（以任务卡形式派活）

- **V0.4-M1** Task Category 分类器：类别定义 + 确定性分类（关键字规则）+ 测试。
- **V0.4-M2** Preset 库 + TaskRouter：类别→preset 映射 + resolve(任务)→(provider,model,preset) + SimpleRouter 兼容 + 测试。
- **V0.4-M3** 接线：compose/CLI 暴露（可选 task 提示自动路由）+ subagent preset 支持（委派时带 preset）+ 测试。
- **V0.4-M4** 收尾：B022 benchmark + V04-IMPLEMENTATION-NOTES.md + 独立核验（REVIEW-REPORT-V04.md）。

## 六、验收标准（全部满足才完成）

1. V0.4 范围内每项有可运行代码 + Vitest 测试；`npx vitest run` 全绿（≥146）+ `npx tsc -b` exit 0。
2. 分类器：确定性把示例任务分到正确类别（测试实证）。
3. TaskRouter：同类别任务路由到预设的 (provider, model)，与显式 RouterHints 兼容（显式优先）。
4. preset 库可配置（新增类别无需改机制代码）；不硬编码模型供应商绑定进 agents。
5. B022 场景可跑（mock 双 provider 路由断言）；B001–B021 不回归。
6. 交付说明（V04-IMPLEMENTATION-NOTES.md）+ 独立审查 PASS（REVIEW-REPORT-V04.md）。

## 七、执行纪律

- tasks/ 看板拆卡（006-0xx）；指挥会话直接实现（子代理通道在本环境不可靠，见 V03-PROGRESS 教训 2）；每卡验证 + git 提交。
- 进度写 docs/V04-PROGRESS.md；卡状态实时更新。

## 八、汇报格式（每张卡完成后）

结论 / 改动文件清单 / 验证证据（测试、tsc）/ 下一步。
