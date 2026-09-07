# V0.4 执行进度（V04-PROGRESS.md）

> 接力文档：按 personal-dev-workflow 拆卡推进（tasks/ 看板 006-009）。
> 权威依据：docs/MISSION-V0.4.md、docs/ideas/001-task-router-orchestration.md、DESIGN-DECISIONS 决策点 12/13。
> 最后更新：2026-09-05（**V0.4 全部完成，验收 VERDICT: PASS**）。

## 0. 环境与基线

- 非沙箱会话：`npx vitest run` 可用。V0.3 基线 146 用例全绿（V0.4 起始），`npx tsc -b` exit 0。
- git：V0.4 提交链：13e74b4（骨架）/ 1d49838（M1）/ be345bf（M2）/ ef7ac13（M3）/ 9e0b556（M4 B022）/（收尾）。

## 1. 里程碑状态

| 里程碑 | 任务卡 | 状态 |
|---|---|---|
| M1 Task Category 分类器 | tasks/006-task-category.md | 已合入（1d49838），155 测试全绿 |
| M2 Preset 库 + TaskRouter | tasks/007-task-router.md | 已合入（be345bf），166 测试全绿 |
| M3 接线（compose/subagent preset） | tasks/008-task-router-wiring.md | 已合入（ef7ac13），169 测试全绿 |
| M4 收尾（B022 + notes + 核验） | tasks/009-v04-closeout.md | 已合入（9e0b556 + notes + review），170 测试全绿，**V0.4 VERDICT: PASS** |

## 2. 验收标准映射（MISSION-V0.4 第六节）

1. ✅ 可运行代码 + 测试：170/170（≥ V0.3 146），`npx tsc -b` exit 0
2. ✅ 分类器确定性：taskCategory 9 用例（六类中英/未知兜底/规则优先级/seam）
3. ✅ TaskRouter 路由：taskRouter 11 用例 + cli 2（compose 级实证）+ B022（端到端 GOLDEN-ROUTE-2026）
4. ✅ preset 可配置：DEFAULT_PRESETS 数据 + presets/tierModel/classify 可注入；agents 源码零 llm import（无供应商绑定泄漏）
5. ✅ B022 可跑：runner 13 用例全绿（B001–B021 无回归 + B022）
6. ✅ 交付说明（V04-IMPLEMENTATION-NOTES.md）+ 独立评审（REVIEW-REPORT-V04.md，VERDICT: PASS）

## 3. 已沉淀决策/教训

- V0.3 教训延续：子代理通道不可靠 → V0.4 全程指挥会话直接实现 + 核验模式评审（REVIEW-REPORT-V04 OBS-3）。
- **教训 4（本阶段）**：runner.test.ts 用 edit 追加时 old_string 匹配多处导致误删 V0.3 组——已用 `git checkout HEAD` 恢复 + PowerShell Add-Content 追加（重复文本场景避免 edit）。后续对重复结构的测试文件追加用 Add-Content 或唯一锚点。
- **V0.4 设计要点沉淀**：TaskRouter 是"任务→类别→tier"编排层（决策点 12/13 落地），补在 llm/router 不触碰 behavior 编译管线；角色=预设配置不新建机制；显式配置永远优先（无 taskPrompt 即不路由）。
