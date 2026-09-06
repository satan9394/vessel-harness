# V0.3 执行进度（V03-PROGRESS.md）

> 接力文档：按 personal-dev-workflow 拆卡推进（tasks/ 看板）。每完成一张卡更新本文件 + 任务卡状态。
> 权威依据：docs/MISSION-V0.3.md、docs/ARCHITECTURE.md §4.8/§4.9、docs/DESIGN-DECISIONS.md（决策点 10/11）。
> 最后更新：2026-09-05（骨架就绪，001 执行中）。

## 0. 环境与基线

- 非沙箱会话（danger-full-access）：`npx vitest run` 可用。基线 104 用例（18 文件）全绿，`npx tsc -b` exit 0。
- git 已建仓：main，a65ce7c（V0.1+V0.2 基线）/ 2b5f459（MINOR 修复）/ e9a771a（骨架）/ （任务卡提交）。

## 1. 里程碑状态

| 里程碑 | 任务卡 | 状态 |
|---|---|---|
| M1 Project Memory 核心 | tasks/001-project-memory.md | 已实现（指挥直接实现），115 测试全绿，待验收/合入 |
| M2 Persistent Memory | tasks/002-persistent-memory.md | 待执行（依赖 001） |
| M3 Skills 正文注入 | tasks/003-skills-content-injection.md | 待执行（依赖 001/002 注入通道） |
| M4 Skill Scope/Search/Provenance | tasks/004-skill-scope-search-provenance.md | 待执行（依赖 003） |
| M5 自动学习 suggest 通道 | tasks/005-auto-learn-suggest.md | 待执行（依赖 001–004） |
| M6 收尾（benchmark/notes/独立核验） | 待拆卡 | 未开始 |

## 2. 验收标准映射（MISSION-V0.3 第六节）

（逐张卡合入后回填证据）

## 3. 已沉淀决策/教训

- 工作流落地：AGENTS.md + tasks/ 看板 + MISSION-V0.3.md 已建（commit e9a771a）。
- memory/project 按 ARCHITECTURE §4.8 文件式蓝图施工，不用 DB。
- **教训（2026-09-05，无人值守第 1 轮）**：001 首次派活（子代理 b6f63a88）长时间零产出疑似卡死，中断重派（cbfebac7）。原因研判：任务范围对一个子代理偏大 + 指令要求读过多锚点再动手，探索期失控。对策：重派指令改为"先写核心文件、每读一个锚点就动手、遇环境错误立即报告不重试卡死、先跑单包测试再全量"。后续派活沿用此格式：聚焦核心交付 + 分步验证 + 快速上报错误。
