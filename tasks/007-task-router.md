# 007 — V0.4-M2 Preset 库 + TaskRouter

- 状态：已合入（2026-09-05 指挥实现并验收）
- 优先级：P0
- 创建日期：2026-09-05
- 关联卡片：依赖 006（类别定义）；MISSION-V0.4

## 目标

任务类别 → Agent/Model Preset 映射 + TaskRouter 路由：resolve(任务)→(provider, model, preset)，与显式 RouterHints 兼容（显式优先，类别路由兜底），可配置、不硬编码模型绑定进 agents。

## 验收标准

- [x] Preset 声明类型：{ category, agentPreset?, modelTier, description }（配置/数据，非机制代码）
- [x] 默认 preset 表（数据文件或常量表）：每类别一个预设（如 implementation→pro 模型、simple-fix→flash 模型、review→独立模型），模型 tier 到实际 provider/model 由配置映射
- [x] TaskRouter.resolve(prompt 或 hints)：有显式 hints 用 hints，否则 classifyTask → preset → (provider, model, agentPreset)；与现有 Router 接口兼容或替换增强
- [x] 可配置：新增类别/改映射不改机制代码
- [x] Vitest：路由正确性、显式优先、未知类别兜底、可配置性
- [x] `npx vitest run` 全绿不回归；`npx tsc -b` exit 0
- [x] 卡状态置"待验收"，回填工作证明

## 涉及文件

- `packages/llm/src/router/TaskRouter.ts`（新建）
- `packages/llm/src/router/taskRouter.test.ts`（新建：11 用例）
- `packages/llm/src/index.ts`（导出）
- `docs/V04-PROGRESS.md`

## 依赖

- 依赖任务卡：006
- 阻塞于：006 合入

## 设计锚点

- MISSION-V0.4 §3.2/§3.3；决策点 12（角色=preset，机制先于角色）、决策点 13（模型差异走 profile/tier）
- agentPreset 引用 agents/ 既有 preset 概念（Evaluator/Planner 是 preset 先例），不新建代理机制
- RouterHints 显式 provider/model 永远优先于类别推断（向后兼容）

## 工作证明（执行器回填）

- [x] diff / 测试结果 / tsc exit 0：TaskRouter + presets（DEFAULT_PRESETS/TierModelMap）+ 11 用例；llm 24 用例全绿、全量 166 用例全绿、tsc exit 0

## 验收结论（指挥会话回填）

- [x] 合入 / 打回 / 调整方向：合入（2026-09-05 指挥验收）
- 备注：6 条验收标准全 PASS；008 已解锁。
