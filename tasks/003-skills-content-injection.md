# 003 — Skills 正文注入（SKILL.md 按需进上下文）

- 状态：待验收（工作证明已回填，2026-09-05 指挥直接实现，等待验收合入）
- 优先级：P0
- 创建日期：2026-09-05
- 关联卡片：004 复用本卡的作用域冲突裁决；依赖 001/002 的注入通道抽象

## 目标

让 SKILL.md 正文按需进入上下文（当前只有 name+description 索引，正文不注入）。落实 D3 决策点 11：索引渐进披露 + 调用时重读 + 正文注入边界与 token 纪律。

## 验收标准

- [x] `packages/skills/src/` 实现技能正文装载：给定技能名，重读 SKILL.md 并返回正文（含 frontmatter 元数据 + body）
- [x] 正文注入走既有注入通道（agent.inject / user/message 带 source，可回放可压缩）——对齐 context 层纪律（Skill 工具返回可注入文本块，调用方决定注入）
- [x] 渐进披露成立：默认上下文只有索引（不膨胀）；调用/检索命中时才注入正文
- [x] token 纪律：正文过长可裁剪或分块，有明确上限常量；不整库灌入
- [x] 与 V0.3-M3 里程碑对应：Vitest 测试覆盖装载/注入格式/渐进披露/token 上限
- [x] `npx vitest run` 全绿不回归 104 基线；`npx tsc -b` exit 0
- [x] 卡状态置"待验收"，回填工作证明

## 涉及文件

- `packages/skills/src/load/SkillLoader.ts`（新建：loadSkillContent/formatSkillBody/createSkillTool）
- `packages/skills/src/load/skill-loader.test.ts`（新建：8 用例）
- `packages/skills/src/index.ts`（export * load）
- `apps/cli/src/compose.ts`（Skill 工具挂工具面）
- `docs/V03-PROGRESS.md`

## 依赖

- 依赖任务卡：001、002（注入通道抽象；如已由前卡建好则直接复用）
- 阻塞于：001/002 合入

## 设计锚点

- 决策点 11 原文：SKILL.md 开放标准 + rank 分层 + 索引渐进披露 + 调用时重读（docs/DESIGN-DECISIONS.md 行 47）
- ARCHITECTURE §4.9 已写死注入形态（行 353-355）：正文经 `skill({name})` 工具按 cwd 重读注入，返回 `<skill_content>/<skill_resources>/<skill_instructions>` 三段式；`readContent(name, cwd)`；技能正文是建议性知识，执行强制在权限/沙箱（技能执行不豁免权限）；跨 harness 兼容目录（~/.claude/skills、~/.codex/skills）
- 注入通道走 agent.inject / 既有 source 纪律（context Builder 现 source='instruction'，对齐它）
- 薄核纪律：skills 不进 core；正文注入是 context seam 职责

## 工作证明（执行器回填）

- [x] diff / 测试结果 / tsc exit 0：SkillLoader + Skill 工具 + compose 接线；skills 8 用例全绿、全量 131 用例全绿、tsc exit 0

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回 / 调整方向
- 备注：指挥自验 7 条验收标准全 PASS；等待拍板合入。合入后 004 可解锁。
