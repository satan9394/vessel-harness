# 011 — V0.5-M2 Task Selection + Trigger/Discovery

- 状态：已合入（2026-09-05，子代理核心 + 指挥补测试验收）
- 优先级：P1
- 创建日期：2026-09-05
- 关联卡片：依赖 010；MISSION-V0.5

## 目标

Loop Engine 的迭代输入源：任务队列（Trigger）+ 候选选择（Task Selection 用 V0.4 TaskRouter 语义决定执行 preset）。最小 Discovery：从任务队列取下一项（backlog 发现留 seam）。

## 验收标准

- [x] 任务队列接口（enqueue/next/peek/drain/isEmpty/size），迭代按 FIFO 顺序消费；next() 空返 null
- [x] Task Selection：selectTaskFor(task) 经 classifyTask → category → DEFAULT_PRESETS → preset/tier；router 可注入得具体 model
- [x] Discovery seam：TaskQueue 接口即 seam（未来 backlog/记忆发现实现同接口）；queueSelectTask 适配器对接 LoopEngine.selectTask
- [x] Vitest 13 用例：FIFO/peek/drain/isEmpty/queueSelectTask 对接 LoopEngine/分类映射/review→reviewer/search→fast/注入覆盖/unknown 兜底
- [x] `npx vitest run` 全绿不回归（195 全绿）；`npx tsc -b` exit 0
- [x] 卡状态置"待验收"，回填工作证明

## 涉及文件

- `packages/engine/src/taskQueue.ts`（新建，子代理）：TaskQueue 接口 + ArrayTaskQueue + createTaskQueue + queueSelectTask
- `packages/engine/src/selection.ts`（新建，子代理）：selectTaskFor + classifyTaskFor + 三 seam（classify/presets/router）
- `packages/engine/src/task-selection.test.ts`（新建，指挥补 13 用例）
- `packages/engine/src/index.ts`（导出，子代理）、`packages/engine/tsconfig.json`（references + llm，子代理）
- `docs/V05-PROGRESS.md`

## 依赖

- 依赖任务卡：010
- 阻塞于：010 合入

## 设计锚点

- Task Selection 语义来自任务书 §14 与 V0.4 TaskRouter（docs/ideas/001）
- 显式队列优先，backlog/记忆发现留 seam（V0.5 不做自动发现）
- llm/router 已导出的 classifyTask/TaskRouter 直接复用

## 工作证明（执行器回填）

- [x] diff / 测试结果 / tsc exit 0：taskQueue.ts + selection.ts（子代理，tsc exit 0 + 冒烟通过）+ task-selection.test.ts 13 用例（指挥补）；全量 195 用例全绿、tsc exit 0

## 验收结论（指挥会话回填）

- [x] 合入 / 打回 / 调整方向：合入（2026-09-05 指挥验收）
- 备注：6 条验收标准全 PASS。执行记录：子代理初始 ~9 分钟零产出，steering 消息后立即产出核心并交证（教训 6：011/012 类小范围卡派活需含"限时 + steering 兜底"）。分工有效：子代理实现核心、指挥补测试。
