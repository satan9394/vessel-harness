# V0.5 执行进度（V05-PROGRESS.md）

> 接力文档：按 personal-dev-workflow 拆卡推进（tasks/ 看板 010-013）。
> 权威依据：docs/MISSION-V0.5.md、docs/ARCHITECTURE.md §7（V0.5 Loop Engine 定位）、任务书 §14。
> 最后更新：2026-09-05（**V0.5 全部完成，验收 VERDICT: PASS——任务书 V0.1–V0.5 全部版本路线完成**）。

## 0. 环境与基线

- 非沙箱会话：`npx vitest run` 可用。V0.4 基线 170 用例全绿（V0.5 起始），`npx tsc -b` exit 0。
- git：V0.5 提交链：a7f2fce（骨架）/ 459688b（进度）/ b21f86e（M1）/ 5f266fe（M2）/ 0af4139（M3）/ a82889d（M4 B023）/（收尾）。

## 1. 里程碑状态

| 里程碑 | 任务卡 | 状态 |
|---|---|---|
| M1 Loop Engine 核心状态机 | tasks/010-loop-engine-core.md | 已合入（b21f86e），182 测试全绿 |
| M2 Task Selection + Trigger | tasks/011-task-selection.md | 已合入（5f266fe），195 测试全绿 |
| M3 隔离工作区 | tasks/012-workspace-isolation.md | 已合入（0af4139），202 测试全绿 |
| M4 收尾（B023 + notes + 核验） | tasks/013-v05-closeout.md | 已合入（a82889d + notes + review），203 测试全绿，**V0.5 VERDICT: PASS** |

## 2. 验收标准映射（MISSION-V0.5 第六节）

1. ✅ 可运行代码 + 测试：203/203（≥ V0.4 170），`npx tsc -b` exit 0
2. ✅ Loop Engine 闭环：B023（verdict=met + ENGINE-GOLDEN-88 + persist 1 条）+ 单元测试（not_met 打回带证据 + **Generator 不自证**专项实证）
3. ✅ 隔离工作区：workspace 测试实证主工作区零改动、dispose 只清隔离目录
4. ✅ Task Selection 复用 V0.4 TaskRouter 语义（import 复用非重造）
5. ✅ B023 可跑：runner 14 用例全绿（B001–B022 无回归 + B023）
6. ✅ 交付说明（V05-IMPLEMENTATION-NOTES.md）+ 独立评审（REVIEW-REPORT-V05.md，VERDICT: PASS）

## 3. 已沉淀决策/教训

- **教训 5**：子代理写实现可靠、写测试易停滞 → 拆"子代理核心 + 指挥测试"（010 有效）。
- **教训 6**：子代理初始零产出需 steering 消息激活（011 有效）。
- **教训 7**：012 子代理读锚点阶段失败 → 指挥直接实现兜底。累计结论：本环境子代理通道不稳定（010 慢、011 需 steering、012 失败）；**最可靠路径 = 指挥直接实现**（010-013 四个核心质量一致，指挥实现更快）。
- **V0.5 设计要点沉淀**：Loop Engine 是外层编排（零 core import，ARCHITECTURE §7）；全协作方依赖注入（纯状态机可测）；Gen/Eval 分离机器实证；隔离纪律（workspace 只清自己创建的目录）；复用 V0.4/V0.2 机制（selection 复用 llm/router，worktree 复用 tools/git）。
