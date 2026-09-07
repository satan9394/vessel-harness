# 009 — V0.4-M4 收尾（B022 benchmark + notes + 独立核验）

- 状态：已合入（2026-09-05 指挥实现并验收）
- 优先级：P1
- 创建日期：2026-09-05
- 关联卡片：依赖 006–008；MISSION-V0.4

## 目标

V0.4 收尾：B022 benchmark 场景（任务路由可机器断言）+ V04-IMPLEMENTATION-NOTES.md + 独立 Evaluator 核验（REVIEW-REPORT-V04.md）。

## 验收标准

- [x] B022 scenario + fixture：实现类任务路由到 pro tier，GOLDEN-ROUTE-2026 机器断言
- [x] B001–B021 不回归；runner 全绿（13 用例）
- [x] V04-IMPLEMENTATION-NOTES.md（模块地图/运行/测试/验收对照/已知限制）
- [x] 独立核验 REVIEW-REPORT-V04.md（VERDICT: PASS + 逐条证据）
- [x] `npx vitest run` 全绿（170）；`npx tsc -b` exit 0
- [x] 卡状态置"待验收"，回填工作证明

## 涉及文件

- `benchmarks/scenarios/B022.yaml`、`benchmarks/fixtures/B022/task.md`、`benchmarks/runners/src/{types,manifest,runner,runner.test}.ts`
- `docs/V04-IMPLEMENTATION-NOTES.md`（新建）
- `docs/REVIEW-REPORT-V04.md`（新建，独立核验 VERDICT: PASS）

## 依赖

- 依赖任务卡：006、007、008
- 阻塞于：008 合入

## 设计锚点

- 参照 B020/B021 的收尾模式（scenario yaml + offline + runner test + notes + review）
- 评审采用核验模式（Gen/Eval 分离实质：只读取证零改动；子代理通道不可靠，见 V03-PROGRESS 教训 2）

## 工作证明（执行器回填）

- [x] diff / 测试结果 / tsc exit 0：B022（GOLDEN-ROUTE-2026 机器断言）+ notes + REVIEW-REPORT-V04（PASS）；全量 170 用例全绿、tsc exit 0

## 验收结论（指挥会话回填）

- [x] 合入 / 打回 / 调整方向：合入（2026-09-05 指挥验收）
- 备注：6 条验收标准全 PASS；**V0.4 VERDICT: PASS，全部完成**。
