# tasks/ — 任务卡看板

> 个人开发工作流（personal-dev-workflow）在本仓库的进度载体。一张卡一个文件，状态写在卡内首行。
> 生命周期：拆卡 → 派活 → 交证 → 验证 → 验收 → 复盘。详见 skills/personal-dev-workflow 与根 AGENTS.md。

## 卡命名

`NNN-短横线描述.md`，如 `001-project-memory.md`。状态取值：待执行 / 执行中 / 待验收 / 已合入 / 打回。

## 当前迭代

- **V0.1–V0.5 全部完成并独立验收 PASS**（docs/REVIEW-REPORT-V0{1,2,3,4,5}.md）。
- V0.5 = 任务书最后一个版本里程碑（Loop Engine），至此任务书 V0.1–V0.5 版本路线全部落地。
- 后续候选（超任务书路线 / V0.5 之后的增强）：可继续子代理（send_message/interrupt）、真实 generator 接线、记忆发现 Discovery、learned 完整化、Cross-Harness Conformance Suite 实跑。拆卡前先出新 MISSION。

| 卡 | 标题 | 状态 |
|---|---|---|
| 001 | Project Memory 核心（V0.3-M1） | 已合入 fc8ae84 |
| 002 | Persistent Memory（V0.3-M2） | 已合入 3bcf37f |
| 003 | Skills 正文注入（V0.3-M3） | 已合入 64832d0 |
| 004 | Skill Scope/Search/Provenance（V0.3-M4） | 已合入 410f1f0 |
| 005 | 自动学习 suggest 通道（V0.3-M5） | 已合入 8ef5e0b |
| 006 | V0.4-M1 Task Category 分类器 | 已合入 1d49838 |
| 007 | V0.4-M2 Preset 库 + TaskRouter | 已合入 be345bf |
| 008 | V0.4-M3 接线（compose/subagent preset） | 已合入 ef7ac13 |
| 009 | V0.4-M4 收尾（B022 + notes + 核验） | 已合入 9e0b556 + dbbec94 |
| 010 | V0.5-M1 Loop Engine 核心 | 已合入 b21f86e |
| 011 | V0.5-M2 Task Selection + Trigger | 已合入 5f266fe |
| 012 | V0.5-M3 隔离工作区 | 已合入 0af4139 |
| 013 | V0.5-M4 收尾（B023 + notes + 核验） | 已合入 a82889d + （收尾提交） |
| 014 | 供应商 SSOT 存储 | 已合入 3544f0f |
| 015 | models 命令（拉取模型列表） | 已合入 3544f0f + 1314e41 |
| 016 | provider 命令组 | 已合入 1314e41 |
| 017 | run 默认 + pricing 扩展 | 已合入 1314e41 + d759f3a |
| 018 | 收尾（PROVIDER-MANAGEMENT 文档） | 已合入 |
