# V0.5 执行进度（V05-PROGRESS.md）

> 接力文档：按 personal-dev-workflow 拆卡推进（tasks/ 看板 010-013）。
> 权威依据：docs/MISSION-V0.5.md、docs/ARCHITECTURE.md §7（V0.5 Loop Engine 定位）、任务书 §14。
> 最后更新：2026-09-05（M1 完成）。

## 0. 环境与基线

- 非沙箱会话：`npx vitest run` 可用。V0.4 基线 170 用例全绿（V0.5 起始），`npx tsc -b` exit 0。
- git：V0.5 提交链：a7f2fce（骨架 + 卡 010-013）/ 459688b（进度骨架）/（M1）。

## 1. 里程碑状态

| 里程碑 | 任务卡 | 状态 |
|---|---|---|
| M1 Loop Engine 核心状态机 | tasks/010-loop-engine-core.md | 已实现（packages/engine，子代理核心 + 指挥补测试），182 测试全绿，待提交 |
| M2 Task Selection + Trigger | tasks/011-task-selection.md | 待执行（依赖 010） |
| M3 隔离工作区 | tasks/012-workspace-isolation.md | 待执行（依赖 010） |
| M4 收尾（B023 + notes + 核验） | tasks/013-v05-closeout.md | 待执行（依赖 010-012） |

## 2. 验收标准映射（MISSION-V0.5 第六节）

（逐张卡合入后回填）

## 3. 已沉淀决策/教训

- V0.1–V0.4 教训延续：子代理通道历史不可靠 → 010 派子代理（用户明确要求子代理执行），若卡死则指挥会话兜底（沿用教训 1/2）。
- 实现位置决策：V0.5 Loop Engine 放新包 `packages/engine`（独立编排层，011-013 都往里加），不塞 apps/cli。
- **教训 5（V0.5-M1）**：子代理完成核心实现（LoopEngine.ts + tsc 通过，质量高）但测试编写停滞 ~15 分钟无产出 → 指挥保留其核心、补测试兜底完成 010。规律：子代理"写实现"可靠、"写测试"易停滞。后续 011-013 派活可拆"实现→交证→指挥补测试"或子代理先交核心再补测试。核心产出质量好说明聚焦指令有效，继续用。
