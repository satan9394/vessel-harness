# 001 — Project Memory 核心

- 状态：待执行
- 优先级：P0
- 创建日期：2026-09-05
- 关联卡片：依赖 002（Persistent Memory 在其后，复用本项目作用域分层）

## 目标

按 docs/ARCHITECTURE.md §4.8 memory/project 蓝图实现项目级记忆：文件式存储（MEMORY.md agent 笔记索引 + topic 文件），提供显式写入通道、检索与冻结快照注入，跨会话可用；作为 V0.3 记忆体系第一块。

## 验收标准

- [ ] `packages/memory/src/project/` 新增实现：MEMORY.md 索引 + topic 文件读写；user/project/local 三级作用域解析（本卡至少 project 级可用）
- [ ] 单一 memory 工具（读/写/检索入口）挂到工具面，走既有 BeforeTool→Policy→Execute 管线；不 import core（扩展 seam）
- [ ] 冻结快照注入：上下文构建时可将 project 记忆以带 source 的 user/message 注入（可回放、可压缩，对齐 EVENT-SPEC source 纪律）
- [ ] 跨会话可用：同 workspaceRoot 二次解析仍读到已写记忆（文件持久，非内存态）
- [ ] Vitest 测试覆盖读写往返/跨会话/注入格式；`npx vitest run` 全绿不回归 104 基线
- [ ] `npx tsc -b tsconfig.json` exit 0
- [ ] 卡状态置"待验收"，回填工作证明（diff + 测试结果）

## 涉及文件（执行器按需扩展）

- `packages/memory/src/project/*`（新建）
- `packages/memory/src/index.ts`（导出新模块）
- `packages/memory/src/project/project-memory.test.ts`（新建）
- 接线视需要：`apps/cli/src/compose.ts`、`packages/context/src/builder/Builder.ts`（注入 seam）
- `docs/V03-PROGRESS.md`（里程碑勾选，不存在则建）

## 依赖

- 依赖任务卡：无（V0.2 已完成，ARCHITECTURE §4.8 蓝图在案）
- 阻塞于：—

## 设计锚点（指挥提供，执行器遵守）

- 文件式记忆而非 DB：MEMORY.md 索引 + topic 文件（ARCHITECTURE §4.8 原文，行 344）
- 作用域 user/project/local 三级；本卡实现 project 级，结构上预留 user/local 不冲突
- 冻结快照注入对齐现有 context 三层组装与 source 纪律（参考 V0.2 injectPlan source='plan' 先例）
- 薄核纪律：memory 不得被 core import；接线走组合根（compose.ts）或 context seam
- clean-room：不复制研究项目源码；删除走回收站

## 工作证明（执行器回填）

- [ ] diff 已提供
- [ ] 测试结果已提供（vitest 相关用例 + 全量不回归）
- [ ] tsc exit 0 已提供

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回 / 调整方向
- 备注：
