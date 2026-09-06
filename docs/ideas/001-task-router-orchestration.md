# 想法记录：Task Router / Orchestration Policy（受 oh-my-openagent 启发）

- 状态：backlog（未排期，未拆执行卡）
- 来源：用户 2026-09-05 提供 oh-my-openagent 分析（6.8 万 Star 现象拆解）
- 关联：docs/DESIGN-DECISIONS.md 决策点 13/14、docs/MISSION-V0.3.md、任务书第十一节 V0.5 Loop Engine（Task Selection）

## 想法原文（用户，提炼）

OmO 火爆核心不是 Agent 技术代差，而是产品化：预设 Agent 角色（Opinionated Roles）、Task→Category→Model 路由、one-command 工作流（ultrawork）、Completion Loop（验证不过不结束）。
对 Composable Agent Harness 的启示：在 Behavior IR + Behavior Compiler + Policy Runtime 之外，增加"Task Router / Orchestration Policy"——用户只说"开发这个功能"，Harness 自动判：架构→Pro、搜索→Flash、实现→Pro、审查→Gemini、简单修复→Flash。

## 影响分析（指挥核查，2026-09-05）

1. **模型路由现状**：packages/llm/src/router/Router.ts SimpleRouter（18 行）——拿到 hints 透传，无类别→模型能力；决策点 13/14 已要求 model profile 与多模型编译，实现未兑现。
2. **Agent 角色现状**：V0.2 有 Planner/Evaluator/Subagent 机制（packages/agents/），但无"预设角色+工具+模型+协作规则"打包的角色库。
3. **上游已规划**：任务书 V0.5 Loop Engine 含 Task Selection（任务书行 942）；Task Router 是其上游物化。
4. **行为层现状**：Behavior IR/Compiler/Policy 已落地（决策点 14），但管"行为编译"，不管"任务→类别→模型"。
5. **结论**：不是新增孤立模块，而是补齐"任务→类别→模型/角色"的 Orchestration 主线，衔接决策点 13/14 与 V0.5 Task Selection。
6. **与 V0.3 关系**：不冲突（不同包/关注点），但量级大，不进 V0.3 001–005；候选 V0.4 或独立阶段。

## 候选去向（用户拍板）

- A：排 V0.4（推荐——V0.3 记忆/技能线先收口，Task Router 作为下阶段一级主线）
- B：插队拆执行卡（动 llm/router + 新增 task-classifier，与 memory 卡不同包可并行 1 worker）
- C：只先做"预设 Agent 角色库"最小切片（Opinionated roles），Task Router 后置
- D：仅记录，不排期

## 沉淀结论（复盘时回填）

（待用户拍板后更新）
