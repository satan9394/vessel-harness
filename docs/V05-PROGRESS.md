# V0.5 执行进度（V05-PROGRESS.md）

> 接力文档：按 personal-dev-workflow 拆卡推进（tasks/ 看板 010-013）。
> 权威依据：docs/MISSION-V0.5.md、docs/ARCHITECTURE.md §7（V0.5 Loop Engine 定位）、任务书 §14。
> 最后更新：2026-09-05（M1、M2 完成）。

## 0. 环境与基线

- 非沙箱会话：`npx vitest run` 可用。V0.4 基线 170 用例全绿（V0.5 起始），`npx tsc -b` exit 0。
- git：V0.5 提交链：a7f2fce（骨架）/ 459688b（进度）/ b21f86e（M1）/（M2）。

## 1. 里程碑状态

| 里程碑 | 任务卡 | 状态 |
|---|---|---|
| M1 Loop Engine 核心状态机 | tasks/010-loop-engine-core.md | 已合入（b21f86e），182 测试全绿 |
| M2 Task Selection + Trigger | tasks/011-task-selection.md | 已实现（taskQueue + selection，子代理核心 + 指挥测试），195 测试全绿，待提交 |
| M3 隔离工作区 | tasks/012-workspace-isolation.md | 待执行（依赖 010） |
| M4 收尾（B023 + notes + 核验） | tasks/013-v05-closeout.md | 待执行（依赖 010-012） |

## 2. 验收标准映射（MISSION-V0.5 第六节）

（逐张卡合入后回填）

## 3. 已沉淀决策/教训

- **教训 5（M1）**：子代理写实现可靠、写测试易停滞 → 011/012 派活改"子代理只交核心 + 指挥补测试"，有效。
- **教训 6（M2）**：小范围卡派子代理初始 ~9 分钟零产出，steering 消息后立即产出交证 → 子代理派活需含"限时产出预期 + 停滞即 steering"。
- 实现位置：V0.5 Loop Engine 放新包 packages/engine（010-013 都往里加）。
