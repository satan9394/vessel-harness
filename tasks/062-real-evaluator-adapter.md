# 062 — RealEvaluatorAdapter（真实 Evaluator 接入 LoopEngine）

- 状态：待执行
- 优先级：P0（Wave 3 / Milestone E）
- 创建日期：2026-09-08
- 关联：061（RealGeneratorAdapter，对称前置）；058（Internal Reviewer/review 结论已结构化）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §11（L1184-1228）

## 目标

RealEvaluatorAdapter：把 055/058 建的 preset 化 Reviewer（evaluator）+ 内部评审结论接到 LoopEngine 的
Evaluator seam——generator 产出（061）→ 测试结果 + reviewer 评估 → met/not_met + 反馈 → 驱动 retry 决策。
不重写 LoopEngine，只写 adapter。复用 058（InternalReviewer + TeamReviewConclusion）不重复造。

## 验收标准（执行器逐条勾选）

- [ ] 摸清 LoopEngine 的 Evaluator seam（与 061 同源：engine/loop 的 generator/evaluator 对称接口），确认接入点
- [ ] RealEvaluatorAdapter：产出（改动+测试结果+验收标准）→ reviewer（evaluator preset，只读面）→
      met/not_met + 理由 + 建议（复用 058 TeamReviewConclusion 形状）→ 回读给 loop 决策 retry/met
- [ ] 复用 058 InternalReviewer/conclusion（不新造解析/结论）；met/not_met 语义与 058 一致
- [ ] 测试：adapter 输入→结论→retry 决策/异常/与 058 复用，新增 ≥6 例；root vitest/tsc 绿（544+061 新增数 无回归）
- [ ] 文档同步
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 Evaluator 侧真 adapter。TaskQueue/IterationStore（063）、retry 自动循环（如并入 066 budget）各自成卡。
- 默认上限（maxRetries=1）沿用 061 的 §11.1 机制。

## 涉及文件（指针，执行器自行精化）

- LoopEngine/EngineLoop 的 Evaluator seam（与 061 同一引擎侧）
- packages/agents/src/reviewer/（058：InternalReviewer/conclusion TeamReviewConclusion）+ presets（reviewer）
- 061 RealGeneratorAdapter 产出形状（若已合入）
- 任务/验收标准/测试结果来源

## 方法

- 与 061 对称：adapter 包装 058 reviewer 调用；结论转 loop evaluator 输出契约
- met/not_met 语义、上限机制与 061 对齐

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
