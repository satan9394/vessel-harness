# 012 — V0.5-M3 隔离工作区（Worktree / 临时目录）

- 状态：待执行
- 优先级：P1
- 创建日期：2026-09-05
- 关联卡片：依赖 010；MISSION-V0.5

## 目标

Loop Engine 每迭代在隔离工作区执行：仓库可用时 git worktree（复用 packages/tools/src/git/Worktree.ts），否则临时目录。迭代产物与主工作区隔离；清理走回收站/%TEMP%（不永久删除用户数据）。

## 验收标准

- [ ] WorkspaceFactory 接口：create() → 隔离目录 + 主工作区内容/引用；destroy() 走回收站纪律或 %TEMP% 清理
- [ ] git worktree 路径：仓库有 .git 时用 createWorktree（V0.2 已实现）；非 git 仓库用临时目录（mkdtemp）
- [ ] 产物隔离：迭代写文件只落隔离目录，主工作区零改动（测试快照实证）
- [ ] Vitest：worktree 模式 + 临时目录模式都覆盖；destroy 后隔离目录不存在（回收站/%TEMP%）
- [ ] `npx vitest run` 全绿不回归；`npx tsc -b` exit 0
- [ ] 卡状态置"待验收"，回填工作证明

## 涉及文件（按需扩展）

- `packages/engine/src/workspace.ts`（新建：WorkspaceFactory 双模式）
- 测试：workspace.test.ts
- 复用 `packages/tools/src/git/Worktree.ts`
- `docs/V05-PROGRESS.md`

## 依赖

- 依赖任务卡：010
- 阻塞于：010 合入

## 设计锚点

- 复用 V0.2 Worktree（createWorktree/removeWorktree，GitRunner 可注入——测试用 fake runner）
- 非 git 场景 mkdtemp（测试清理同既有测试约定：os.tmpdir() 下 rmSync 可接受——仓库既有测试统一此做法）
- 主工作区隔离是 Loop Engine 的关键属性（防迭代间污染）

## 工作证明（执行器回填）

- [ ] diff / 测试结果 / tsc exit 0

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回 / 调整方向
- 备注：
