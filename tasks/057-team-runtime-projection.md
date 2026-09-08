# 057 — TeamRuntime / TeamProjection（多 Agent 协作运行时 + 事件投影）

- 状态：待执行
- 优先级：P0（Wave 2 / Milestone D）
- 创建日期：2026-09-08
- 关联：054-056（preset/路由，前置）；058（Internal Reviewer）；060（team UI 消费投影）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §8（默认团队 lead/developer/reviewer；
  路由 §8.2 决定启动几个；不新造 Agent 机制——复用 049-051 已建的单 AgentLoop 能力）

## 目标

TeamRuntime：按 056 路由结果组合多个 preset 化的 Agent 协作用于一次任务（小→1 个 / 中→2 个 /
复杂→3 个），复用既有单 Agent loop 与 delegate 机制（不新造 primitive）；TeamProjection：把团队
协作过程投影为事件（给 060 UI），每个 agent 的 turn/工具/产出可观测。

## 验收标准（执行器逐条勾选）

- [ ] TeamRuntime：输入任务 + 路由决定（或显式阵容）→ 组合 preset 化的 Agent；Lead 可 delegate 给
      Developer（复用既有 delegate/subagent 机制），Reviewer 可被调用评估（或留给 058 接真流程——
      本卡先保证"阵容可组合、可顺序驱动：generator 产出 → evaluator 检查"的骨架）
- [ ] 每个团队成员跑在既有 AgentLoop/Session 机制上（复用，不新造）；会话/记录可区分团队成员
- [ ] TeamProjection：按既有 projections 模式（040/052 的 event projection 框架）投影团队过程：
      team/start、agent/turn、delegate 关系、阶段切换等（命名/表达遵循 EVENT-SPEC 与 049/050 的
      "尽量不新增词汇、用既有记录/事件表达"惯例；确需新增按 EVENT-SPEC 规矩加并注明理由）
- [ ] 测试：阵容组合/顺序驱动（gen→eval 骨架）/投影事件/异常路径，新增 ≥6 例；全量 vitest/tsc 绿
      （426+前卡新增数 无回归）
- [ ] 文档同步（TeamRuntime 用法）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 骨架 + 投影。058（Internal Reviewer 真流程）、059（External Handoff）、060（UI）各自成卡。
- 不新造 Agent primitive；不加新依赖。

## 涉及文件（指针，执行器自行精化）

- packages/agents/src/ 或新 team 模块（运行时组合）
- 既有 AgentLoop/Session/delegate（packages/core/agents）
- projections 框架（packages/application/src/projections/）
- 054/055 preset 体系

## 方法

- 读 §8 与既有 delegate/subagent 实现；TeamRuntime 作为组合器驱动 preset agents
- TeamProjection 照 040/052 投影模式；复用事件与记录词汇优先

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
