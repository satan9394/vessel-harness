# 013 — V0.5-M4 收尾（B023 benchmark + notes + 独立核验）

- 状态：待执行
- 优先级：P1
- 创建日期：2026-09-05
- 关联卡片：依赖 010–012；MISSION-V0.5

## 目标

V0.5 收尾：B023 benchmark（一次 Loop Engine 迭代闭环机器断言）+ V05-IMPLEMENTATION-NOTES.md + 独立 Evaluator 核验（REVIEW-REPORT-V05.md）。

## 验收标准

- [ ] B023 scenario：Loop Engine 单次迭代（选任务→Generator→Evaluator met→Persist），断言机器可验证（verdict/证据落盘可见）
- [ ] B001–B022 不回归；runner 全绿
- [ ] V05-IMPLEMENTATION-NOTES.md（模块地图/运行/测试/验收对照/已知限制）
- [ ] 独立核验 REVIEW-REPORT-V05.md（VERDICT + 逐条证据）
- [ ] `npx vitest run` 全绿；`npx tsc -b` exit 0
- [ ] 卡状态置"待验收"，回填工作证明

## 涉及文件

- `benchmarks/scenarios/B023.yaml` + fixture
- `benchmarks/runners/src/*`（如需要 engine 驱动）
- `docs/V05-IMPLEMENTATION-NOTES.md`（新建）
- `docs/REVIEW-REPORT-V05.md`（新建，独立核验）

## 依赖

- 依赖任务卡：010、011、012
- 阻塞于：012 合入

## 设计锚点

- 参照 B022 收尾模式
- 评审采用核验模式（Gen/Eval 分离实质：只读取证零改动）
- Loop Engine 是编排层——B023 的 mock generator/evaluator 驱动确定性迭代

## 工作证明（执行器回填）

- [ ] diff / 测试结果 / tsc exit 0

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回 / 调整方向
- 备注：
