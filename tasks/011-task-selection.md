# 011 — V0.5-M2 Task Selection + Trigger/Discovery

- 状态：待执行
- 优先级：P1
- 创建日期：2026-09-05
- 关联卡片：依赖 010；MISSION-V0.5

## 目标

Loop Engine 的迭代输入源：任务队列（Trigger）+ 候选选择（Task Selection 用 V0.4 TaskRouter 语义决定执行 preset）。最小 Discovery：从任务队列取下一项（backlog 发现留 seam）。

## 验收标准

- [ ] 任务队列接口（enqueue/next/drain），迭代按队列顺序消费
- [ ] Task Selection：每任务经 TaskRouter（或注入的 selector）得 {category, preset, tier} → 决定 Generator 的执行配置（model/provider/agentPreset 引用）
- [ ] Discovery seam：迭代完成后的"下个任务来源"可注入（默认取队列；未来可接记忆/backlog）
- [ ] Vitest：队列顺序消费、selection 映射正确、队列空则迭代停止
- [ ] `npx vitest run` 全绿不回归；`npx tsc -b` exit 0
- [ ] 卡状态置"待验收"，回填工作证明

## 涉及文件（按需扩展）

- `packages/engine/src/`：taskQueue.ts + selection.ts（新建）
- 测试：taskQueue.test.ts / selection.test.ts
- 复用 `packages/llm/src/router/TaskRouter.ts`（V0.4，不重造）
- `docs/V05-PROGRESS.md`

## 依赖

- 依赖任务卡：010
- 阻塞于：010 合入

## 设计锚点

- Task Selection 语义来自任务书 §14 与 V0.4 TaskRouter（docs/ideas/001）
- 显式队列优先，backlog/记忆发现留 seam（V0.5 不做自动发现）
- llm/router 已导出的 classifyTask/TaskRouter 直接复用

## 工作证明（执行器回填）

- [ ] diff / 测试结果 / tsc exit 0

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回 / 调整方向
- 备注：
