# 004 — Skill Scope / Search / Provenance

- 状态：待执行
- 优先级：P1
- 创建日期：2026-09-05
- 关联卡片：依赖 003（正文可读后做内容检索）

## 目标

补全技能生命周期：system/user/project/session 四层作用域冲突裁决、按描述/正文的检索、来源（provenance）审计。对应任务书第十二节 Skill Scope/Search/Provenance 与 ARCHITECTURE §4.9。

## 验收标准

- [ ] 四层作用域冲突裁决：同名技能在不同层，nearest-wins 且可审计（现有 listIndex 已 nearest-wins，需显式裁决 + 记录）
- [ ] Skill Search：按名称/描述/正文关键字检索，返回命中 + 来源
- [ ] Skill Provenance：每个技能带来源（scope 层 + sourcePath + 元数据），可列出、可审计
- [ ] 现有 4 层发现根逻辑（system/user/project/session）与 rank 语义不回归
- [ ] Vitest 测试覆盖冲突裁决/检索命中/provenance 审计；`npx vitest run` 全绿不回归 104 基线
- [ ] `npx tsc -b` exit 0
- [ ] 卡状态置"待验收"，回填工作证明

## 涉及文件

- `packages/skills/src/index.ts`（扩展 search/provenance/scope 裁决）
- `packages/skills/src/*.test.ts`
- `docs/V03-PROGRESS.md`

## 依赖

- 依赖任务卡：003
- 阻塞于：003 合入

## 设计锚点

- 决策点 11 / ARCHITECTURE §4.9：索引渐进披露 + rank 分层 + 调用时重读
- 现有 parseSkillFrontmatter/listIndex 保持兼容；在之上加 search/provenance
- Provenance 是安全维度（任务书 §18 精神）：泄露/逆向技能需标 UNTRUSTED 不直入 System Prompt——provenance 字段要为该场景留位

## 工作证明（执行器回填）

- [ ] diff / 测试结果 / tsc exit 0

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回 / 调整方向
- 备注：
