# V0.4 执行进度（V04-PROGRESS.md）

> 接力文档：按 personal-dev-workflow 拆卡推进（tasks/ 看板 006-0xx）。
> 权威依据：docs/MISSION-V0.4.md、docs/ideas/001-task-router-orchestration.md、DESIGN-DECISIONS 决策点 12/13。
> 最后更新：2026-09-05（M1 完成）。

## 0. 环境与基线

- 非沙箱会话：`npx vitest run` 可用。V0.3 基线 146 用例全绿（V0.4 起始），`npx tsc -b` exit 0。
- git：V0.4 提交链：13e74b4（骨架+卡 006-009）/ （M1）。

## 1. 里程碑状态

| 里程碑 | 任务卡 | 状态 |
|---|---|---|
| M1 Task Category 分类器 | tasks/006-task-category.md | 已合入（1d49838），155 测试全绿 |
| M2 Preset 库 + TaskRouter | tasks/007-task-router.md | 已合入（TaskRouter + DEFAULT_PRESETS），166 测试全绿 |
| M3 接线（compose/subagent preset） | tasks/008-task-router-wiring.md | 待执行（依赖 007） |
| M4 收尾（B022 + notes + 核验） | tasks/009-v04-closeout.md | 待执行（依赖 008） |

## 2. 验收标准映射（MISSION-V0.4 第六节）

（逐张卡合入后回填）

## 3. 已沉淀决策/教训

- V0.3 教训（子代理通道不可靠）延续：V0.4 指挥会话直接实现。
