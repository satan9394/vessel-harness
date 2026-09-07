# V0.5 执行进度（V05-PROGRESS.md）

> 接力文档：按 personal-dev-workflow 拆卡推进（tasks/ 看板 010-013）。
> 权威依据：docs/MISSION-V0.5.md、docs/ARCHITECTURE.md §7（V0.5 Loop Engine 定位）、任务书 §14。
> 最后更新：2026-09-05（M1、M2、M3 完成）。

## 0. 环境与基线

- 非沙箱会话：`npx vitest run` 可用。V0.4 基线 170 用例全绿（V0.5 起始），`npx tsc -b` exit 0。
- git：V0.5 提交链：a7f2fce（骨架）/ 459688b（进度）/ b21f86e（M1）/ 5f266fe（M2）/（M3）。

## 1. 里程碑状态

| 里程碑 | 任务卡 | 状态 |
|---|---|---|
| M1 Loop Engine 核心状态机 | tasks/010-loop-engine-core.md | 已合入（b21f86e），182 测试全绿 |
| M2 Task Selection + Trigger | tasks/011-task-selection.md | 已合入（5f266fe），195 测试全绿 |
| M3 隔离工作区 | tasks/012-workspace-isolation.md | 已实现（workspace.ts 三工厂，指挥实现），202 测试全绿，待提交 |
| M4 收尾（B023 + notes + 核验） | tasks/013-v05-closeout.md | 待执行（依赖 010-012） |

## 2. 验收标准映射（MISSION-V0.5 第六节）

（逐张卡合入后回填）

## 3. 已沉淀决策/教训

- **教训 5（M1）**：子代理写实现可靠、写测试易停滞 → 拆"子代理核心 + 指挥测试"。
- **教训 6（M2）**：子代理初始零产出需 steering 消息激活。
- **教训 7（M3）**：012 子代理在读锚点阶段即失败中断 → 指挥直接实现兜底。累计观察：子代理通道对本环境仍不稳定（010 成功但慢、011 需 steering、012 失败）；最可靠路径 = 指挥直接实现（010-012 三个核心质量一致，速度更快）。013 收尾（B023/notes/核验）直接指挥实现。
