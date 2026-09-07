# V0.5 执行进度（V05-PROGRESS.md）

> 接力文档：按 personal-dev-workflow 拆卡推进（tasks/ 看板 010-013）。
> 权威依据：docs/MISSION-V0.5.md、docs/ARCHITECTURE.md §7（V0.5 Loop Engine 定位）、任务书 §14。
> 最后更新：2026-09-05（骨架就绪，010 子代理执行中）。

## 0. 环境与基线

- 非沙箱会话：`npx vitest run` 可用。V0.4 基线 170 用例全绿（V0.5 起始），`npx tsc -b` exit 0。
- git：V0.5 提交链：a7f2fce（骨架 + 卡 010-013）。

## 1. 里程碑状态

| 里程碑 | 任务卡 | 状态 |
|---|---|---|
| M1 Loop Engine 核心状态机 | tasks/010-loop-engine-core.md | 执行中（子代理 8970d2f9） |
| M2 Task Selection + Trigger | tasks/011-task-selection.md | 待执行（依赖 010） |
| M3 隔离工作区 | tasks/012-workspace-isolation.md | 待执行（依赖 010） |
| M4 收尾（B023 + notes + 核验） | tasks/013-v05-closeout.md | 待执行（依赖 010-012） |

## 2. 验收标准映射（MISSION-V0.5 第六节）

（逐张卡合入后回填）

## 3. 已沉淀决策/教训

- V0.1–V0.4 教训延续：子代理通道历史不可靠 → 010 派子代理（用户明确要求子代理执行），若卡死则指挥会话兜底（沿用教训 1/2）。
- 实现位置决策：V0.5 Loop Engine 放新包 `packages/engine`（独立编排层，011-013 都往里加），不塞 apps/cli。
