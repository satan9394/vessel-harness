# MISSION V0.3 — Composable Agent Harness V0.3 执行任务书

> 总指挥签发（2026-09-05，本对话，按 personal-dev-workflow 拆卡推进）。
> V0.2 已闭环：104 测试全绿 + 独立核验 VERDICT: PASS（docs/REVIEW-REPORT-V02.md）+ git 已建仓（main，初始提交 a65ce7c）。
> 工作区：`C:\work\Vessel_Harness`。

---

## 一、本阶段目标

在 V0.2 之上增量实现任务书第十二节（V0.3 范围）与 V02-IMPLEMENTATION-NOTES.md §6.7 建议：
Project Memory、Persistent Memory、Skills 完整生命周期（正文注入/作用域/搜索/来源）、自动学习只允许 suggest 不得 auto modify。

权威文档不变：`任务书.md`（第十二节 V0.3 范围）、`docs/DESIGN-DECISIONS.md`（16 决策点，实现必须遵守；Memory 见决策点 10、Skills 见决策点 11）、`docs/ARCHITECTURE.md`、`docs/EVENT-SPEC.md`、`docs/POLICY-SPEC.md`、`docs/BEHAVIOR-IR-SPEC.md`、`docs/BENCHMARK-SPEC.md`。

## 二、V0.2 交接现状（相关部分）

- `packages/memory/src/index.ts` 仅导出 `./session/SessionDir.js`（V0.1 最小骨架：会话目录绑定）。
- `packages/skills/src/index.ts`：SKILL.md frontmatter 解析 + 目录索引（四层 scope：system/user/project/session，rank 分层、nearest wins）。注释明示：正文不注入、完整生命周期（content injection/scope conflict/search）留 V0.3。
- Event 词汇已含 `source` 枚举（V0.2 扩展 `'evaluator'|'plan'`，EVENT-SPEC 已同步）；V0.3 若引入新事件/字段须按 EVENT-SPEC 纪律走声明合并 + 本文件修订。
- 测试基线：18 文件 104 用例全绿（`npx vitest run`）；`npx tsc -b` exit 0。

## 三、V0.3 范围（任务书第十二节，克制增量）

1. **Project Memory**：项目级记忆（跨会话、按项目隔离）——不是 session 日志的简单复用；需要独立的存储/检索与显式写入通道。
2. **Persistent Memory**：用户/跨项目级长期记忆；作用域与 Project Memory 分层。
3. **Skills 完整生命周期**：
   - 正文注入（SKILL.md 正文进入上下文——当前只有 name+description 索引）；
   - Skill Scope（system/user/project/session 四层，冲突裁决）；
   - Skill Search（按描述/内容检索）；
   - Skill Provenance（来源可信度/审计）。
4. **自动学习只允许 `suggest`**：Agent 可产生「候选技能/记忆条目」建议，不得 auto modify 用户区；只能写专门的 `learned/` 区域（任务书第十三节 V0.4 部分约束提前为设计前提亦可，但 V0.3 只做 suggest 通道）。

明确不做（V0.4+ / 任务书排除）：Background Review 自动采纳、Snapshot/Rollback、Curator、Web UI、20-Agent Team、复杂 RAG、Browser 自动化。

## 四、硬性约束（同 V0.1/V0.2，逐条遵守）

1. clean-room：以本仓库 spec 为据，不复制研究项目源码。
2. Prompt 与 Runtime 分离；Generator/Evaluator 分离（自动学习的 suggest 必须经独立评审/用户拍板，不得自宣布生效）。
3. 模块化单体、依赖零环、Core 薄核（照 DESIGN-DECISIONS/ARCHITECTURE）。
4. 全局铁律：禁止任何永久删除（回收站）；禁止 force push；TypeScript；Windows/PowerShell。
5. 新功能必须有 Vitest 测试；104 用例不得回归（跑全量确认）；B001–B019 benchmark 不回归。
6. 记忆与技能都是扩展机制，不得硬编码进 core/（薄核纪律）；通过 seam/事件接入。
7. 自动学习只允许 suggest：不得直接修改用户技能/记忆区。

## 五、建议里程碑（顺序推进，每步可验证；以任务卡形式派活）

- **V0.3-M1** Project Memory 核心：项目级记忆存储（文件/SQLite）+ 显式写入通道 + 检索 + 事件接线 + 测试。
- **V0.3-M2** Persistent Memory：用户级持久记忆 + 分层作用域（project vs persistent）+ 冲突裁决 + 测试。
- **V0.3-M3** Skills 正文注入：SKILL.md 正文按需进入上下文（调用时重读/渐进披露，决策点 11）+ 注入边界与 token 纪律 + 测试。
- **V0.3-M4** Skill Scope/Search/Provenance：四层作用域冲突裁决 + 描述/内容检索 + 来源审计 + 测试。
- **V0.3-M5** 自动学习 suggest 通道：候选技能/记忆建议产出 → 独立评审 → 用户拍板 → 落盘 `learned/`（只写 learned 区）+ 测试。
- **V0.3-M6** 收尾：全量 vitest + tsc + benchmark 回归 + 新增 V0.3 benchmark scenario（编号 B020 起）+ V03-IMPLEMENTATION-NOTES.md + 独立 Evaluator 核验（REVIEW-REPORT-V03.md）。

## 六、验收标准（全部满足才完成）

1. V0.3 范围内每项有可运行代码 + Vitest 测试通过；`npx vitest run` 全绿（≥ 104）+ `npx tsc -b` exit 0。
2. Project Memory：端到端演示跨会话写入与读取项目记忆。
3. Persistent Memory：端到端演示用户级记忆与项目级记忆分层、互不串扰。
4. Skills：端到端演示技能正文注入（上下文含 SKILL.md 正文）、四层作用域冲突裁决、检索命中。
5. 自动学习：suggest 通道产出候选但不落用户区；只有用户拍板后才写入 `learned/`；测试实证无 auto modify。
6. V0.2 benchmark B001–B019 不回归；新增 ≥2 个 V0.3 benchmark scenario 可跑。
7. 交付说明更新（V03-IMPLEMENTATION-NOTES.md）+ 独立审查 PASS（REVIEW-REPORT-V03.md）。

## 七、执行纪律

- tasks/ 看板拆卡；每张卡一个隔离执行器；指挥会话验收后更新卡状态并提交 git（auto_commit: false，手动提交留可回滚点）。
- 每完成一个里程碑跑一次相关测试；长命令放后台 job。
- 若单次会话跑不完：进度写到 docs/V03-PROGRESS.md，任务卡状态保持，下次接力先读进度文件。

## 八、汇报格式（每张卡完成后）

结论 / 改动文件清单 / 验证证据（测试、tsc、benchmark 结果节选）/ 下一步。
