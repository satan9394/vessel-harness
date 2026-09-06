# 003 — Skills 正文注入（SKILL.md 按需进上下文）

- 状态：待执行
- 优先级：P0
- 创建日期：2026-09-05
- 关联卡片：004 复用本卡的作用域冲突裁决；依赖 001/002 的注入通道抽象

## 目标

让 SKILL.md 正文按需进入上下文（当前只有 name+description 索引，正文不注入）。落实 D3 决策点 11：索引渐进披露 + 调用时重读 + 正文注入边界与 token 纪律。

## 验收标准

- [ ] `packages/skills/src/` 实现技能正文装载：给定技能名，重读 SKILL.md 并返回正文（含 frontmatter 元数据 + body）
- [ ] 正文注入走既有注入通道（agent.inject / user/message 带 source，可回放可压缩）——对齐 context 层纪律
- [ ] 渐进披露成立：默认上下文只有索引（不膨胀）；调用/检索命中时才注入正文
- [ ] token 纪律：正文过长可裁剪或分块，有明确上限常量；不整库灌入
- [ ] 与 V0.3-M3 里程碑对应：Vitest 测试覆盖装载/注入格式/渐进披露/token 上限
- [ ] `npx vitest run` 全绿不回归 104 基线；`npx tsc -b` exit 0
- [ ] 卡状态置"待验收"，回填工作证明

## 涉及文件

- `packages/skills/src/index.ts`（扩展）或新增 `packages/skills/src/load/*`
- `packages/skills/src/*.test.ts`（新建）
- 注入接线视需要：context/builder 或组合根
- `docs/V03-PROGRESS.md`

## 依赖

- 依赖任务卡：001、002（注入通道抽象；如已由前卡建好则直接复用）
- 阻塞于：001/002 合入

## 设计锚点

- 决策点 11 原文：SKILL.md 开放标准 + rank 分层 + 索引渐进披露 + 调用时重读（docs/DESIGN-DECISIONS.md 行 47）
- ARCHITECTURE §4.9 skills 蓝图：正文按需注入、作用域冲突、Search/Provenance（V0.3 全量）
- 薄核纪律：skills 不进 core；正文注入是 context seam 职责

## 工作证明（执行器回填）

- [ ] diff / 测试结果 / tsc exit 0

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回 / 调整方向
- 备注：
