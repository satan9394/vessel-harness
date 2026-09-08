# Worktree / Workspace 生命周期 —— LoopEngine 隔离工作区完整闭环（task 064）

> 实现卡：`tasks/064-worktree-lifecycle.md`；权威需求：`docs/Vessel_后续开发方向与产品化路线_v1.0.md`
> §11（真实链 Worktree/Temp Workspace 环节）+ `packages/engine/src/LoopEngine.ts`（seam 契约）+
> `packages/engine/src/workspace.ts`（TempDir/GitWorktree 工厂，V0.5-M3 已建）。
> 前置：010（LoopEngine）、012（workspace 隔离）、061/062（Real Gen/Eval adapters 的 attempt workspace）。
> 代码位置：`packages/engine/src/LoopEngine.ts`（runTask per-attempt dispose）、
> `packages/engine/src/workspace-lifecycle.test.ts`（生命周期回归测试）。

## 1. 一句话

修完整 workspace/worktree 生命周期：LoopEngine **每次 generate attempt** 创建的工作区
（TempDir 或 Git Worktree）必须在**该 attempt 结束**时 dispose —— met/stopped admit、重试、
异常、中断全路径都清理，杜绝 `os.tmpdir()` 残留与泄漏。复用既有工厂
（`TempDirWorkspaceFactory` / `GitWorktreeWorkspaceFactory`），本卡只补 LoopEngine 侧的
**per-attempt 接线与清理**，不重写工厂。

```text
LoopEngine iteration ── runTask(task)
  └─ attempt 1: workspaceFactory(task) → ws1 ── generate/evaluate ──┬─ met     → admit → return
                                                                     ├─ not_met → dispose(ws1) → continue
                                                                     └─ 抛错    → dispose(ws1) → throw
  └─ attempt 2: workspaceFactory(task) → ws2 ── generate/evaluate ── ...
       （ws1 已在上一次 attempt 结束时 dispose —— 062 已知问题的修复点）
```

## 2. 为什么 attempt 级 dispose（062 踩坑的根因）

- **症状（062 记录）**：`LoopEngine attempt1 的 workspace 不 dispose`——061/062 e2e 之后
  `os.tmpdir()` 残留一个临时目录。
- **根因**：旧实现把 `workspace` 变量放在 attempt 循环**外面**，循环结束后只在最后 dispose 一次。
  重试路径上 attempt > 1 会调用 `workspaceFactory` 创建**新的** workspace 并**覆盖**旧引用，
  于是 attempt 1 的 workspace 永远失去了 dispose 的机会——只有最后一次创建的 workspace
  会在 finally 里被清理。
- **修复**：把 workspace 的生命周期收进**单个 attempt 的作用域**——每个 attempt 内新建局部
  `workspace`，在该 attempt 自己的 `try/finally` 中 dispose。任何出口（`return`/`continue`/
  `throw`）都会先走 finally，前序 attempt 的 workspace 不可能被后续 attempt 的引用覆盖而泄漏。
- **为什么不改工厂**：`TempDirWorkspaceFactory`（`fs.rmSync` os.tmpdir 隔离目录）与
  `GitWorktreeWorkspaceFactory`（`git worktree remove`，git 管理）的隔离保证已在 V0.5-M3 建成并
  由 `workspace.test.ts` 断言（dispose 只清自己创建的目录、绝不碰主工作区）。本卡只保证
  LoopEngine 在每个 attempt 结束都**调用**该 dispose seam。

## 3. 生命周期契约（LoopEngine 侧）

1. **per-attempt 唯一拥有**：`workspaceFactory` 存在时，每个 generate attempt 创建恰好一个
   workspace；该 workspace 不跨 attempt 存活，绝无"多个 attempt 引用同一变量"的共享态。
2. **全路径清理**：`try { generate → evaluate → admit/retry } finally { disposeWorkspace(ws) }`——
   `met`（admit 后 return）、最终 `not_met`/`impossible`/`error`（admit stopped 后 return）、
   未达上限的 retry（`continue`）、以及 generate/evaluate 抛错（异常/050 中断语义都表现为
   rejection/throw）都经 finally dispose。
3. **幂等**：引擎对每个创建的 workspace 恰好 dispose 一次（每个 attempt 的 finally 只处置本
   attempt 创建的实例）；`TempDirWorkspaceFactory.dispose`（`rmSync force`）本身重复调用安全。
4. **不触碰主工作区**：dispose 委托给注入的 `disposeWorkspace` seam（061/062/runner 均接工厂
   `dispose`），工厂保证只清 os.tmpdir 隔离目录 / git 管理的 worktree——主工作区零改动
   （`workspace.test.ts` "artifact writes stay inside the isolated dir" 实证 + 064 重试路径复证）。
5. **fail loud 配对守卫**：`workspaceFactory` 与 `disposeWorkspace` 必须成对提供（guardDeps 抛错）——
   "给了 factory 却没给 dispose"是必然泄漏的接线 bug，构造期即暴露，不静默。

## 4. 两种模式闭环

- **TempDir 模式**（非 git 仓库默认）：`TempDirWorkspaceFactory` → `fs.mkdtempSync`（os.tmpdir）
  → attempt 结束 `fs.rmSync(recursive, force)`。回归测试断言 os.tmpdir 中该前缀目录清零。
- **Git Worktree 模式**（仓库有 .git）：`GitWorktreeWorkspaceFactory` → V0.2
  `createWorktree`（`git worktree add`）→ attempt 结束 `removeWorktree`（`git worktree remove`）。
  测试经注入 fake git runner 断言 add/remove 次数平衡、异常路径也 remove（无真实 git spawn，
  V0.2 同款测试约定）。

## 5. 消费方接线（不变）

061 `RealGeneratorAdapter` / 062 `RealEvaluatorAdapter` / benchmarks runner 均经
`LoopEngineDeps.workspaceFactory` + `disposeWorkspace` 接工厂——本卡不改这三个消费方的调用形状，
只让引擎在**每个 attempt** 保证 dispose；061/062 的 e2e（attempt1 not_met → retry → attempt2 met）
在修复后不再残留 attempt1 的临时目录。

## 6. 测试

`packages/engine/src/workspace-lifecycle.test.ts`（13 例）：
正常迭代（met 单 attempt 清理恰一次）；**重试 not_met→met：attempt1 与 attempt2 两个 workspace
都 dispose、os.tmpdir 前缀清零（062 回归）**；耗尽重试 stopped：3 attempt 全清理；异常
（generate/evaluate 抛错）清理 + 错误原样上抛；中断语义（050：generate rejection）下前序与当前
attempt 都清理；多迭代（maxIterations>1）逐任务清理；幂等（每个 created root dispose 恰一次 +
TempDir 工厂二次 dispose 安全）；主工作区隔离（重试路径下主目录零文件）；guardDeps 配对守卫
fail loud；Git Worktree 模式闭环（add/remove 平衡 + 异常路径 remove 照常）。
全量 vitest/tsc 绿（root 590+ 无回归，本卡新增 13 例无回归）。
