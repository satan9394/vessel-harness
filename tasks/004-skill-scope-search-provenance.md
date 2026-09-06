# 004 — Skill Scope / Search / Provenance

- 状态：已合入（2026-09-05 指挥实现并验收）
- 优先级：P1
- 创建日期：2026-09-05
- 关联卡片：依赖 003（正文可读后做内容检索）

## 目标

补全技能生命周期：system/user/project/session 四层作用域冲突裁决、按描述/正文的检索、来源（provenance）审计。对应任务书第十二节 Skill Scope/Search/Provenance 与 ARCHITECTURE §4.9。

## 验收标准

- [x] 四层作用域冲突裁决：同名技能在不同层，nearest-wins 且可审计（现有 listIndex 已 nearest-wins，需显式裁决 + 记录）
- [x] Skill Search：按名称/描述/正文关键字检索，返回命中 + 来源
- [x] Skill Provenance：每个技能带来源（scope 层 + sourcePath + 元数据），可列出、可审计
- [x] 现有 4 层发现根逻辑（system/user/project/session）与 rank 语义不回归
- [x] Vitest 测试覆盖冲突裁决/检索命中/provenance 审计；`npx vitest run` 全绿不回归 104 基线
- [x] `npx tsc -b` exit 0
- [x] 卡状态置"待验收"，回填工作证明

## 涉及文件

- `packages/skills/src/search/SkillSearch.ts`（新建：searchSkills/resolveSkill/createSkillSearchTool + UNTRUSTED 检测）
- `packages/skills/src/search/skill-search.test.ts`（新建：7 用例）
- `packages/skills/src/index.ts`（export * search）
- `apps/cli/src/compose.ts`（SkillSearch 工具挂工具面）
- `docs/V03-PROGRESS.md`

## 依赖

- 依赖任务卡：003
- 阻塞于：003 合入

## 设计锚点

- 决策点 11 / ARCHITECTURE §4.9：索引渐进披露 + rank 分层 + 调用时重读
- 现有 parseSkillFrontmatter/listIndex 保持兼容；在之上加 search/provenance
- Provenance 是安全维度（任务书 §18 精神）：泄露/逆向技能需标 UNTRUSTED 不直入 System Prompt——provenance 字段要为该场景留位

## 工作证明（执行器回填）

- [x] diff / 测试结果 / tsc exit 0：SkillSearch + resolveSkill（冲突审计）+ UNTRUSTED 标记；skills 15 用例全绿、全量 138 用例全绿、tsc exit 0

## 验收结论（指挥会话回填）

- [x] 合入 / 打回 / 调整方向：合入（2026-09-05 指挥验收）
- 备注：7 条验收标准全 PASS；005 已解锁。
