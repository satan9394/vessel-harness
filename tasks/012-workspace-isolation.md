# 012 — V0.5-M3 隔离工作区（Worktree / 临时目录）

- 状态：已合入（2026-09-05，指挥实现验收；子代理通道失败兜底）
- 优先级：P1
- 创建日期：2026-09-05
- 关联卡片：依赖 010；MISSION-V0.5

## 目标

Loop Engine 每迭代在隔离工作区执行：仓库可用时 git worktree（复用 packages/tools/src/git/Worktree.ts），否则临时目录。迭代产物与主工作区隔离；清理走回收站/%TEMP%（不永久删除用户数据）。

## 验收标准

- [x] WorkspaceFactory 接口：create(task) → Workspace{root,meta?}（对接 LoopEngine.workspaceFactory）；dispose(ws) 清理隔离目录
- [x] TempDirWorkspaceFactory：os.tmpdir() 下 mkdtemp（非 git 默认）；dispose rmSync（仓库测试约定）
- [x] GitWorktreeWorkspaceFactory：复用 V0.2 createWorktree/removeWorktree（GitRunner 可注入）；dispose 走 git worktree remove（git 管理，非自有永久删除）
- [x] createDefaultWorkspaceFactory：auto 检测 .git → worktree/tempdir，或显式 mode 覆盖（可测）
- [x] 产物隔离：迭代写文件只落隔离目录，主工作区零改动（LoopEngine 集成测试实证）
- [x] Vitest 7 用例：tempdir 隔离/dispose 清理/产物隔离/模式选择/auto 检测/git runner 注入
- [x] `npx vitest run` 全绿不回归（202 全绿）；`npx tsc -b` exit 0
- [x] 卡状态置"待验收"，回填工作证明

## 涉及文件

- `packages/engine/src/workspace.ts`（新建：TempDir/GitWorktree/Default 三工厂 + WorkspaceFactory 接口）
- `packages/engine/src/workspace.test.ts`（新建：7 用例）
- `packages/engine/src/index.ts`（导出）、`packages/engine/tsconfig.json`（references + ../tools）
- `docs/V05-PROGRESS.md`

## 依赖

- 依赖任务卡：010
- 阻塞于：010 合入

## 设计锚点

- 复用 V0.2 Worktree（createWorktree/removeWorktree，GitRunner 可注入——测试用 fake runner）
- 非 git 场景 mkdtemp（测试清理同既有测试约定：os.tmpdir() 下 rmSync 可接受——仓库既有测试统一此做法）
- 主工作区隔离是 Loop Engine 的关键属性（防迭代间污染）

## 工作证明（执行器回填）

- [x] diff / 测试结果 / tsc exit 0：workspace.ts 三工厂 + workspace.test.ts 7 用例；全量 202 用例全绿、tsc exit 0

## 验收结论（指挥会话回填）

- [x] 合入 / 打回 / 调整方向：合入（2026-09-05 指挥验收）
- 备注：7 条验收标准全 PASS。执行记录：012 子代理（065eca0e）在读 Worktree.ts 锚点阶段即失败中断（closing message 停在第一步）→ 指挥直接实现兜底（教训 7：子代理通道对"读锚点后实现"类任务仍不稳定，本环境最可靠路径 = 指挥直接实现 + 事后记录）。workspace.ts 由指挥实现，质量与 010/011 子代理核心一致。
