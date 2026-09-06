# 008 — V0.4-M3 接线（compose/subagent preset 支持）

- 状态：待执行
- 优先级：P1
- 创建日期：2026-09-05
- 关联卡片：依赖 006/007；MISSION-V0.4

## 目标

把 TaskRouter 接进组合根：CLI run 可选按任务自动路由（或用显式 --provider/--model 时保持现状）；subagent 委派支持 preset 指定执行者（决策点 12：角色=preset）。

## 验收标准

- [ ] compose 可选接线：提供 task 提示时经 TaskRouter 选 (provider, model)；显式 provider/model 时不动（向后兼容）
- [ ] subagent 委派 preset：createSubagentTool 或 manager 支持 preset 引用（映射到既有的角色工具收窄/模型，不新建机制）
- [ ] 端到端测试或 compose 测试覆盖接线路径
- [ ] `npx vitest run` 全绿不回归；`npx tsc -b` exit 0
- [ ] 卡状态置"待验收"，回填工作证明

## 涉及文件（按需扩展）

- `apps/cli/src/compose.ts`
- `packages/agents/src/subagent/*`（preset 支持，最小改动）
- 测试：apps/cli 或对应包
- `docs/V04-PROGRESS.md`

## 依赖

- 依赖任务卡：006、007
- 阻塞于：007 合入

## 设计锚点

- 决策点 12：角色 preset 不新增机制，只做配置映射
- 显式配置永远优先（任务书"克制"精神）
- 薄核：preset 是数据，不进 core

## 工作证明（执行器回填）

- [ ] diff / 测试结果 / tsc exit 0

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回 / 调整方向
- 备注：
