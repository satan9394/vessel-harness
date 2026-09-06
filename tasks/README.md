# tasks/ — 任务卡看板

> 个人开发工作流（personal-dev-workflow）在本仓库的进度载体。一张卡一个文件，状态写在卡内首行。
> 生命周期：拆卡 → 派活 → 交证 → 验证 → 验收 → 复盘。详见 skills/personal-dev-workflow 与根 AGENTS.md。

## 卡命名

`NNN-短横线描述.md`，如 `001-project-memory.md`。状态取值：待执行 / 执行中 / 待验收 / 已合入 / 打回。

## 当前迭代

- V0.3（docs/MISSION-V0.3.md）：**已完成并验收 PASS**（146 测试，REVIEW-REPORT-V03.md）。
- V0.4（docs/MISSION-V0.4.md）：Task Router / Orchestration Policy 主线，拆卡完成，执行中。

| 卡 | 标题 | 状态 |
|---|---|---|
| 001 | Project Memory 核心（V0.3-M1） | 已合入 fc8ae84 |
| 002 | Persistent Memory（V0.3-M2） | 已合入 3bcf37f |
| 003 | Skills 正文注入（V0.3-M3） | 已合入 64832d0 |
| 004 | Skill Scope/Search/Provenance（V0.3-M4） | 已合入 410f1f0 |
| 005 | 自动学习 suggest 通道（V0.3-M5） | 已合入 8ef5e0b |
| 006 | V0.4-M1 Task Category 分类器 | 待执行 |
| 007 | V0.4-M2 Preset 库 + TaskRouter | 待执行（依赖 006） |
| 008 | V0.4-M3 接线（compose/subagent preset） | 待执行（依赖 007） |
| 009 | V0.4-M4 收尾（B022 + notes + 核验） | 待执行（依赖 008） |
