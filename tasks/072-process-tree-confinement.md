# 072 — Process-Tree Confinement（进程树完整约束）

- 状态：已合入
- 优先级：P0（Wave 4 / Milestone F）
- 创建日期：2026-09-08
- 关联：071（Windows Job Object 后端：kill-tree 整树终止已实现）；073（filesystem confinement）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md（V1.4 Security：process-tree confinement）

## 目标

在 071（Job Object 整树终止）基础上补 process-tree confinement 的完整语义：进程树边界可声明与审计
（哪些进程属于本次执行）、孙进程跟踪与约束（071 的 attach 时序窗口——attach 前已派生的进程要纳入）、
树外逃逸检测与响应、资源上限（CPU/内存——071 留本卡）。机制层硬执法，不宣称未实现能力（071 的诚实
上报风格延续）。

## 验收标准（执行器逐条勾选）

- [x] 摸清 071 现状（windows-job-object backend：job attach/时序窗口/资源上限 best-effort）——明确本卡补什么
- [x] 进程树跟踪：执行派生的进程树可枚举/审计（pid 关系、存活/退出状态）；071 的 attach 时序窗口处理
      （attach 前已派生的孙进程纳入约束——本机可测路径）
- [x] 树外逃逸检测：派生于 job 外或脱离树的进程被检测 + 记录 + 可选终止（机制硬执法）
- [x] 资源上限：CPU/内存（071 留的）——Job Object 或等价机制落地（本机可测 best-effort + 诚实标注）
- [x] 测试 ≥6 例：树枚举/时序窗口/逃逸检测/资源上限/审计记录/异常；全量 vitest/tsc 绿（682+ 无回归）
- [x] 文档同步（process-tree confinement 语义与限制）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做进程树约束。filesystem confinement（073）、telemetry（074）、safety benchmark（075）各自成卡。
- 不宣称未实现能力（受限令牌等 071 已标注的留原生 sidecar 或后续）。

## 涉及文件（指针，执行器自行精化）

- packages/runtime/src/sandbox/backend/windows-job-object.ts（071：job holder/时序窗口/资源上限现状）
- packages/runtime/src/sandbox/（Sandbox.ts 能力面扩展）
- packages/runtime/src/process/（runCommand：onSpawn/pid 钩子已有）

## 方法

- 读 071 实现与测试；补树跟踪（pid 关系登记 + 枚举）、时序窗口（attach 前派生纳管）、逃逸检测、
  资源上限（Job Object 限制或等价）
- 诚实标注：Windows 机制可测则实测，不可测（如跨会话 job 语义）文档注明

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

### 改动文件 + diff 摘要

- 新增 `packages/runtime/src/sandbox/backend/process-tree.ts`
  - `ProcessTreeTracker`：纯状态机（无 OS 依赖）——`registerNode(pid,parentPid,command)`、`markExit(pid,exitCode)`、
    `childrenOf`/`isDescendantOf`/`snapshot`/`auditLog`，追加式审计（spawn/exit/attached/escape-detected/escape-terminated/window-closed）。
  - `detectEscapes(rootPid, liveDescendants, confined, opts)`：逃逸判定纯规则——当前存活后代 pid 不在「已确认纳管集合」
    即逃逸；`terminateEscaped` 时调注入的 `terminate(pids)` 硬终止。
- 扩展 `packages/runtime/src/sandbox/backend/windows-job-object.ts`
  - `JobObjectLimits` 新增 `maxProcessTimeMs`（每进程 CPU 时间）、`maxWorkingSetBytes`（工作集，软目标）。
  - holder 脚本：按传入限制组合 flags（ACTIVE_PROCESS=0x8、PROCESS_TIME=0x2、WORKINGSET=0x1）。
    **修复 071 笔误**：071 用 `0x4`（实际是 JOB_TIME）并标注 ACTIVE_PROCESS；改回正确的 `0x8`。
  - 新增 `enumerateDescendants(rootPid)`：CIM Win32_Process ParentProcessId BFS，取当前存活后代——供时序窗口关闭 + 逃逸检测。
  - 新增 `attachPidsToJob(jobName,pids)`：把已存在 pid 逐个 AssignProcessToJobObject 拉进同一 job（时序窗口纳管）。
  - 新增 `terminatePids(pids)`：TerminateProcess 逐个终止（逃逸硬执法，pid 级，不动 root/job）。
  - `JobObjectConfinement` 增 `rootPid?` + `attachDescendants?`（可选保持 071 mock 兼容）。
- 扩展 `packages/runtime/src/sandbox/Sandbox.ts`
  - `SandboxLimits` 增 `maxProcessTimeMs`/`maxWorkingSetBytes`/`terminateEscaped`/`closeTimingWindow`。
  - `openConfinement()`：attach 时登记 root、创建 job、枚举当前后代并 `attachDescendants` 逐个纳管（时序窗口）、
    dispose 时 `runEscapeDetection`；会话增 `tree()`/`audit()`。
  - `run()`：onSpawn 登记 root + job 创建 + 时序窗口纳管；结束时逃逸检测；返回 `{..., processTree, audit}`。
  - 新增私有 `runEscapeDetection(tree, confined, limits)`：CIM 复举 → detectEscapes → 审计 + 可选硬终止。
  - `SandboxDeps` 增 `enumerateDescendants`/`attachPidsToJob`/`terminatePids`（可注入，便于跨平台单测）。
- 文档 `docs/SANDBOX-WINDOWS.md`：新增「072 — Process-Tree Confinement」能力/限制/API 节，更新状态行。

### 新增测试数与命令输出

新增 `packages/runtime/src/sandbox/backend/process-tree.test.ts`（11 例）：
树枚举+存活状态、审计 trail、逃逸检测（纯）、逃逸硬终止（纯）、时序窗口纳管（unit fake）、run() 树+审计、
资源上限转发、job factory 异常降级、非 win32 gate、dispose 逃逸检测终止、**真实 Windows 时序窗口集成
（即时派生孙进程被枚举纳管 + dispose 后 root+孙进程均死，本机实测）**。

命令输出（受限环境实测可行，本机直跑）：

```
npx vitest run --reporter=basic
  Test Files  77 passed (77)
      Tests  693 passed | 1 skipped (694)

npx tsc -b tsconfig.json   # exit 0，无类型错误
```

基线 682+1 → 693+1，净增 11 例，无回归。

> 诚实备注（与本卡无关）：全量并行跑时偶见 2 个**既有**测试的并发抖动失败（engine/iteration-store
> `renameSync` 并发写共享 store、apps/local-server goal-seam-control 时序），单片单跑均绿，第三次全量复跑 693 全绿。
> 属并行测试调度竞态，非本卡改动引入（本卡只动 packages/runtime/src/sandbox/）。

### 设计选择与理由（含诚实限制）

1. **树跟踪用纯 TS 状态机**（`ProcessTreeTracker`），OS 无关可单测；OS 侧只留在 windows-job-object（CIM/PowerShell）。
   分层清晰：书面向量 vs 机制。
2. **时序窗口**：用「attach 后 CIM 枚举当前后代 + 逐个 AssignProcessToJobObject」拉进同一 job。把 071 的
   「完全不纳管」降为「覆盖枚举时刻已存在的后代」。**诚实限制**：枚举与 attach 之间仍有极小竞态残窗（非数学零窗口），
   已在文档标注。
3. **逃逸检测**：定义为「当前存活后代 ∉ 已确认纳管集合」，在 dispose()/run() 结束时 CIM 复举触发（非实时轮询）。
   `terminateEscaped:true` 时 TerminateProcess 逐个硬终止（不动 root/job）。诚实：逃逸检测非毫秒级实时，且漏检
   窗口中已 exit/断链/breakaway 出可视链的进程——靠活动进程上限兜底 fork 炸弹。
4. **资源上限**：holder 用正确 flag 组合设置 ACTIVE_PROCESS/PROCESS_TIME/WORKINGSET，OS 强制 best-effort。
   WORKINGSET 是软目标（非硬提交墙）已如实标注。**顺带修复 071 的 0x4→0x8 flag 笔误**。
5. **异常**：job factory 抛错 → attach 降级（job=null）、run() 仍返回结果不 throw（071 同风格）。

### 踩坑记录

- 071 holder 里 `Flags=0x4` 标注 ACTIVE_PROCESS，实际 0x4 是 JOB_TIME；改 0x8 才能真正启用活动进程上限。
- PowerShell `$queue[1..($queue.Count-1)]` 在 Count=1 时产生倒序区间导致死循环 → 改用 `Queue[int]` + `Dequeue()` BFS。
- openConfinement 的 method-shorthand 里 `this` 指向会话对象而非 Sandbox → 显式捕获 `enumerateDescendants`/`runEscapeDetection`。
- TS「closure 赋值的 let 被收窄成 never」→ 用 holder 对象（`attachHolder.promise`）规避 CFA 收窄。

### 验收结论（指挥回填）

- [x] 合入（commit 277ef9d）
- 备注：指挥独立复核——全量 vitest 77 文件 693 测试全绿 + 1 skipped（零失败）、tsc -b 0 错误，与执行器自报一致。
  设计认可：ProcessTreeTracker（跨平台树跟踪 + append-only 审计）+ detectEscapes（纯规则逃逸检测，terminateEscaped
  硬终止）+ windows-job-object 扩展（enumerateDescendants CIM BFS / attachPidsToJob 关 071 时序窗口 / terminatePids /
  CPU+内存资源上限）+ 修复 071 ACTIVE_PROCESS flag 笔误（0x4→0x8）。诚实限制标注（逃逸检测非实时、极小残窗、
  工作集软目标、仅 Windows）。真实 Windows 时序窗口集成实测（孙进程纳管 + dispose 双杀）。下一张：073（filesystem
  confinement）。
