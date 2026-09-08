# 058 — Internal Reviewer flow（内部评审真流程）

- 状态：待执行
- 优先级：P0（Wave 2 / Milestone D）
- 创建日期：2026-09-08
- 关联：055（reviewer preset）；057（TeamRuntime 骨架，前置）；061-062（Wave 3 真 adapter 延伸）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §8（reviewer 角色=evaluator/no-write，
  model_tier review）+ 项目既有 Evaluator/评审机制

## 目标

Internal Reviewer flow：developer/generator 产出（改动的文件、diff、测试结果）交给 reviewer
（evaluator 角色）按验收标准评估 → 输出 met / not_met（+ 理由/反馈）；not_met 时反馈回到生成侧
（rework 循环基础）。复用既有 Evaluator Agent 与既有 delegate/调用机制，不新造 primitive。

## 验收标准（执行器逐条勾选）

- [ ] Reviewer 调用流程：给定产出上下文（任务+验收标准+改动摘要+测试结果）→ reviewer preset 化
      Agent 评估 → 结构化结论 met/not_met + 理由 + 建议（输出形状可注入/可断言）
- [ ] 与 057 TeamRuntime 集成：generator 完成 → reviewer 评估的骨架真正可用（e2e：mock generator
      产出 → reviewer 判 not_met → 反馈可见）
- [ ] 会话/记录可区分 reviewer 的产出与反馈（团队可观测性延续 057 投影）
- [ ] 复用既有 EvaluatorAgent / AgentLoop / delegate 机制（不改写 core）；评估判据与验收标准来源
      明确（任务卡/任务对象的验收标准字段——查现有 Task/Evaluation 模型）
- [ ] 测试：met/not_met 判定、反馈形状、与 TeamRuntime 集成、异常路径，新增 ≥6 例；全量
      vitest/tsc 绿（426+前卡新增数 无回归）
- [ ] 文档同步（Internal Review 流程说明）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做内部评审真流程。External Review（059）、自动重试循环（Wave 3 真 adapter）不在本卡。

## 涉及文件（指针，执行器自行精化）

- packages/agents（Evaluator/EvaluatorAgent、delegate、presets）
- 057 TeamRuntime（若已建）
- 任务/验收标准模型（tasks/ 卡模型或包内 Evaluation/Task 类型）

## 方法

- 读 §8 与既有 EvaluatorAgent；复用机制把"产出→评审→met/not_met"跑通并测试

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
