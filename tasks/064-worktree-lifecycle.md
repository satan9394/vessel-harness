# 064 — Worktree 生命周期（workspace 创建→使用→清理完整闭环）

- 状态：待验收
- 优先级：P0（Wave 3 / Milestone E）
- 创建日期：2026-09-08
- 关联：061/062（Real Gen/Eval adapters 的迭代 workspace）；063（IterationStore 接 persist）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §11 真实链（Worktree/Temp Workspace 环节）；
  已知问题：062 踩坑记录 "LoopEngine attempt1 的 workspace 不 dispose（既有 engine 行为，归 064）"

## 目标

修完整 workspace/worktree 生命周期：LoopEngine 每次迭代/attempt 的工作区（TempDir 或 Git Worktree）
必须创建→使用→清理完整闭环（含异常/中断/重试路径），杜绝 os.tmpdir 残留与泄漏。复用既有
tools/git/Worktree.ts（V0.2）与 engine/workspace.ts（TempDir/GitWorktree 工厂，V0.5 已建）——
本卡补 LoopEngine 侧的生命周期接线与清理保证。

## 验收标准（执行器逐条勾选）

- [x] 定位并修复 "attempt1 workspace 不 dispose" 缺陷：LoopEngine 每次迭代创建的工作区在迭代结束
      （成功/met/not_met/异常/中断）都保证 dispose；重试路径多 attempt 各自清理
- [x] 异常安全：抛错/中断（含 050 interrupt 语义）时也走清理；多次 dispose 幂等；不触碰主工作区
      （engine/workspace.ts 既有隔离保证不破坏）
- [x] Git Worktree 模式：worktree 创建/使用/`git worktree remove` 清理闭环（复用 tools/git/Worktree.ts）；
      TempDir 模式同理（os.tmpdir 清理，复用既有约定）
- [x] 回归验证：修复后无 workspace 残留（测试断言：迭代/异常/重试后 temp/worktree 目录清零）；
      061/062 e2e 通过
- [x] 测试 ≥6 例：正常迭代清理/异常清理/中断清理/多 attempt/幂等 dispose/主工作区不触碰；
      root vitest/tsc 绿（590+ 无回归）
- [x] 文档同步（workspace 生命周期语义）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只修生命周期闭环。Goal UI（065）、budget（066）、handoff（067）各自成卡。
- 不重写 workspace 工厂（复用既有 TempDir/GitWorktree 实现），只补 LoopEngine 接线与清理。

## 涉及文件（指针，执行器自行精化）

- packages/engine/src/LoopEngine.ts（迭代/attempt 生命周期、workspace 创建与 dispose 调用点）
- packages/engine/src/workspace.ts（既有工厂：TempDirWorkspaceFactory/GitWorktreeWorkspaceFactory——查 dispose 语义）
- packages/tools/src/git/Worktree.ts（V0.2 worktree 实现，remove 走 git 管理）
- packages/engine/src/real-generator-adapter.ts + real-evaluator-adapter.ts（061/062：attempt workspace 使用点）
- 测试：engine 既有 e2e + 新增生命周期测试

## 方法

- 读 LoopEngine 迭代循环与 workspace 工厂；找 dispose 缺失/未覆盖路径
- 用 try/finally（或等价）保证每 attempt/迭代清理；中断语义（050）并入清理路径
- 测试用可控失败/中断注入验证清理

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 待执行器回填（2026-09-08，任务 064）

### 修复点/设计选择（先说为什么）

1. **缺陷根因**：`LoopEngine.runTask` 旧实现把 `workspace` 变量放在 attempt 循环外，只在循环结束
   的 finally dispose **最后一次**创建的 workspace。重试路径 attempt>1 会再次调 workspaceFactory
   新建 workspace 并**覆盖引用**，attempt1（乃至每个前序 attempt）的 workspace 永远不被 dispose →
   os.tmpdir 残留（062 已知问题的准确机理，非"finally 缺失"而是"重试覆盖引用导致前序泄漏"）。
2. **修复结构（per-attempt try/finally）**：把 workspace 收进**单 attempt 作用域**——每个 attempt
   内新建局部 `workspace`，`try { generate → evaluate → admit/retry } finally { disposeWorkspace }`。
   met/stopped 的 return、未达上限的 `continue`（retry）、generate/evaluate 抛错（含 050 中断语义
   表现为 rejection/throw）全部先走 finally 再离开 attempt；前序 attempt 的 workspace 不可能被
   后续引用覆盖而泄漏。`outputPath` 语义不变（最后一次 admit 时引用当次 workspace root）。
3. **guardDeps 配对守卫（fail loud）**：`workspaceFactory` 与 `disposeWorkspace` 必须成对提供，
   否则构造期抛错——"给了 factory 却没给 dispose"是必然泄漏的接线 bug，不静默。
4. **不重写工厂**：TempDir（rmSync os.tmpdir 隔离目录）/ GitWorktree（git worktree remove）既有
   实现与隔离保证（workspace.test.ts 已断言）原样保留；本卡只在 LoopEngine 每 attempt 结束调用
   该 dispose seam。主工作区不触碰由工厂隔离 + 测试复证。
5. **幂等**：每个 created root 恰好 dispose 一次（per-attempt 唯一拥有）；TempDir 工厂 dispose
   （rmSync force）重复调用安全（测试复证）。
6. **050 中断语义并入**：LoopEngine 不新增信号机制（engine 是编排层，非 AgentLoop）；中断在真实链
   表现为 generate/evaluate 的 rejection/throw（adapter 会话中断 → fail loud 上抛），per-attempt
   finally 保证该路径同样 dispose——用可控 rejection 注入测试实证。

### 改动文件 + diff 摘要

- **packages/engine/src/LoopEngine.ts**（-62/+71 核心）：
  - `runTask` 重构：外层单 `workspace` 变量 + 循环末 finally → 每 attempt 局部 workspace +
    per-attempt `try/finally disposeWorkspace`；`continue`（retry）与所有 return/throw 都先 dispose。
  - `guardDeps` 增 workspaceFactory↔disposeWorkspace 成对校验（fail loud）。
  - 类头注释 + deps 注释补 workspace 生命周期语义（task 064）。
- **packages/engine/src/workspace-lifecycle.test.ts**（新增，13 例）：
  正常 met 单 attempt 清理恰一次；**062 回归：重试 not_met→met 两个 attempt workspace 都 dispose +
  os.tmpdir 前缀清零**；耗尽重试 stopped 3 attempt 全清理；generate/evaluate 抛错清理且错误原样上抛；
  中断（rejection）下前序+当前 attempt 都清理；多迭代逐任务清理；幂等（每个 created root dispose 恰
  一次 + TempDir 二次 dispose 安全）；主工作区隔离（重试下主目录零文件）；guardDeps 配对 fail loud；
  Git Worktree 闭环 2 例（fake runner：add/remove 平衡 + 异常路径 remove 照常）。
- **docs/WORKSPACE-LIFECYCLE.md**（新增）：workspace 生命周期语义文档（缺陷根因/生命周期契约/
  两模式闭环/消费方接线/测试）。

### 测试输出（root 全量 vitest + tsc）

- `npx vitest run packages/engine/src/workspace-lifecycle.test.ts packages/engine/src/loop-engine.test.ts packages/engine/src/workspace.test.ts packages/engine/src/real-generator-adapter.test.ts packages/engine/src/real-evaluator-adapter.test.ts`
  → Test Files 5 passed / Tests 52 passed（含新增 lifecycle 13 例，061/062 e2e 10+10 全绿）
- **全量 `npx vitest run` → Test Files 69 passed (69) / Tests 603 passed (603)**（590 基线 + 13 新增，零回归）
- `npx tsc -b tsconfig.json` → TSC_EXIT=0（全量类型绿，含新测试文件）

### 环境备注

- 本会话 vitest/tsc 均可直跑（未遇 EPERM/esbuild 限制），全量套件后台 job 收尾（上述 603 passed）。

### 踩坑记录

1. 最初误以为"finally 缺失"——细读 runTask 才发现 finally 一直在，真正缺陷是**重试时新建 workspace
   覆盖唯一引用**，只有最后一次被 dispose。修复不是"加 finally"而是"把 dispose 收进每 attempt 作用域"。
2. `continue` 在 try 内会先执行 finally 再进入下一轮 attempt——利用该语义天然保证 retry 前先 dispose，
   无需额外簿记；已用测试（重试后 attempt1 目录清零）实证。
3. 测试里 `{ root: os.tmpdir() }` 这类 fake workspace 直接作为 dispose 目标有"误删 tmp 根"风险——凡是
   接真实 TempDir 工厂的用例都断言了前缀目录清零，且 dispose 只经工厂 seam，未直接 rmSync 任意路径。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
