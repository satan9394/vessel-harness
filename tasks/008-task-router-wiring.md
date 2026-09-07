# 008 — V0.4-M3 接线（compose/subagent preset 支持）

- 状态：已合入（2026-09-05 指挥实现并验收）
- 优先级：P1
- 创建日期：2026-09-05
- 关联卡片：依赖 006/007；MISSION-V0.4

## 目标

把 TaskRouter 接进组合根：CLI run 可选按任务自动路由（或用显式 --provider/--model 时保持现状）；subagent 委派支持 preset 指定执行者（决策点 12：角色=preset）。

## 验收标准

- [x] compose 可选接线：提供 task 提示时经 TaskRouter 选 (provider, model)；显式 provider/model 时不动（向后兼容）
- [x] subagent 委派 preset：createSubagentTool 或 manager 支持 preset 引用（映射到既有的角色工具收窄/模型，不新建机制）
- [x] 端到端测试或 compose 测试覆盖接线路径
- [x] `npx vitest run` 全绿不回归；`npx tsc -b` exit 0
- [x] 卡状态置"待验收"，回填工作证明

## 涉及文件

- `apps/cli/src/compose.ts`（taskRouter 接线：taskPrompt→自动路由；暴露 taskRouter/routedCategory）
- `apps/cli/src/cli.test.ts`（+2 task routing 测试）
- `packages/agents/src/subagent/createSubagentTool.ts`（preset 选项透传 + meta）
- `packages/agents/src/subagent/subagent.test.ts`（+1 preset 透传测试）
- `packages/llm/src/router/TaskRouter.ts`（导出 TaskCategoryPresets 类型）
- `docs/V04-PROGRESS.md`

## 依赖

- 依赖任务卡：006、007
- 阻塞于：007 合入

## 设计锚点

- 决策点 12：角色 preset 不新增机制，只做配置映射（SubagentManager.delegate 已有 preset 字段，工具补透传）
- 显式配置永远优先（无 taskPrompt 即不路由，测试实证）
- 薄核：preset 是数据，不进 core

## 工作证明（执行器回填）

- [x] diff / 测试结果 / tsc exit 0：compose taskRouter 接线 + Subagent preset 透传；cli +3、agents +1 用例；全量 169 用例全绿、tsc exit 0

## 验收结论（指挥会话回填）

- [x] 合入 / 打回 / 调整方向：合入（2026-09-05 指挥验收）
- 备注：4 条验收标准全 PASS；009（收尾）已解锁。
