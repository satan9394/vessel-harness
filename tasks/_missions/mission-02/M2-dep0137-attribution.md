# M2 `DEP0137` 告警归因（定位到文件/用例；归因到新测试文件才修）

- 状态：执行完成（归因完成 · 处置＝只登记不改 · 待验收）
- 优先级：**P2**（是告警不是失败，但 Node 未来会把它变成错误）
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 3
- 来源：**planned**（三轮评审均登记、始终未归因）

## 背景（事实，均已实测）

- 告警逐字：
  `(node:NNNN) [DEP0137] DeprecationWarning: Closing a FileHandle object on garbage collection is deprecated. Please close FileHandle objects explicitly using FileHandle.prototype.close(). In the future, an error will be thrown if a file descriptor is closed during garbage collection.`
- 出现规律：**三份全量日志各恰好 1 次**（`.dsh-mission/evidence/M2-test-all.log`、`M2-test-all-rerun.log`、`M2-test-all-rerun2.log`）；在 `M2-test-all-rerun2.log` 中它落在 `✓ AgentLoop.stream.test.ts`（`:252`）与 `✓ turnEndWitness.test.ts`（`:256`）**之间**。
- **Mission 2 的定向运行里也复现过**（W2 与 W3b 的记录都提到"如期复现"），而 W1 轮**没有**（W1 验收那次 stderr 干净）。
- 已知线索：`turnEndWitness.test.ts`（Mission 2 新增，408 行 / 4 用例）与它相邻；该文件里每个 `Session` 都被显式 `close()`（执行器自述）；`packages/core/src/session/Session.ts` 的 `close()` 确实调用 `fd.close()`（`Session.ts:250-253`）。

## 目标

**把它归因到具体文件（最好到具体用例）**，然后**按归属处置**：

- **若归因到 Mission 2 新增/修改的测试文件**（`turnEndWitness.test.ts` / `turnEndConditionGuard.test.ts` / `telemetry.test.ts`）⇒ **修**：只允许修**资源管理**（例如某条路径打开的 `Session`/`FileHandle` 没关；补 `close()` 或用 `try/finally`），**不得改任何断言**、不得改运行时源码。
- **若归因到既有文件**（Mission 2 之前就有的测试或源码）⇒ **只登记，不改**（超本卡授权）；把证据（哪个文件、原始 stderr、复跑命令）写清，进 Deferred Backlog。
- **若二分后仍无法归因** ⇒ 如实写"未归因"+ 已排除的文件清单 + 你的假设与下一步可行手段。

## 方法（预算内）

- 用**定向 vitest 逐文件**（或二分）跑，观察 stderr：`npx vitest run <单个文件>`；**≤4 次**。
- 建议起点：`packages/telemetry/src/turnEndWitness.test.ts` 单独跑 → 若复现，再在该文件内用 `-t '<用例名>'` 定位到具体用例。
- 每次运行都要**保留原始 stderr**（不要把告警过滤掉）与**显式退出码**。
- **不要**跑 `tsc -b` / `test:all`（那是 M3 的额度）；不要跑全仓（预算不够）。

## 硬边界

- **不得改任何断言**；不得改运行时源码（`packages/*/src/**` 非测试文件）；不得改 `docs/**`
- 若修的是测试文件，只改资源管理（`close()`/`try-finally`/`afterEach`），改完**必须再跑 1 次同一文件**证明"告警消失且用例仍全绿"
- 不做 git 写操作；不 install；不建子 Agent；命令文本不得含永久删除类 API 字面名

## 验收标准（客观门禁）

- [ ] 给出**归因结论**：具体文件（尽量到用例）+ 支撑它的**原始 stderr** 与命令
- [ ] 若归因到新测试文件：已修，且**再次运行该文件**时告警消失、用例仍全绿（贴两次原始输出与退出码）
- [ ] 若归因到既有文件或无法归因：如实登记（含已排除清单），**未改任何文件**
- [ ] 零断言改动（若改了文件，贴 `git diff -U0` 过滤 `expect|it(` 的结果）
- [ ] `git status --short` 如实（改动集合与你的结论一致）
- [ ] 定向 vitest 用量 ≤4 次（逐次说清用途）

## 涉及文件（含爆炸半径）

- 可能改（**仅当归因落到新测试文件**）：`packages/telemetry/src/turnEndWitness.test.ts`（优先嫌疑）、`turnEndConditionGuard.test.ts`、`telemetry.test.ts`
- 只读：`packages/core/src/session/Session.ts`（`close()`/`loadExisting()`）、`packages/core/src/agent-loop/AgentLoop.ts`、M2 的两份修复记录

## 预期证据（执行器回填）

> 完整版：`.dsh-mission/evidence/M2-dep0137-attribution.md`（含逐字原始输出）。
> 原始日志：`.dsh-mission/evidence/M2-dep0137-run{1..4}.{stdout,stderr}.log`、`M2-dep0137-minrep.*`。

- [x] 逐次运行的命令 + 原始 stderr（**含那条告警**）+ 退出码 —— 4 次定向 vitest（预算 4/4）
  - run1 `vitest run packages/telemetry/src/turnEndWitness.test.ts` → **exit 0，stderr 含 "Closing file descriptor 4 on garbage collection" + `[DEP0137]`**
  - run2 `… -t '①'` → exit 0，stderr 空；run3 `… -t '②|③|④'` → exit 0，stderr 空
  - run4 `vitest run packages/core/src/session/Session.test.ts`（既有同形文件）→ exit 0，stderr 空
- [x] 归因结论与推理链（为什么是它）——
  **stderr 归属＝ M2 新文件 `packages/telemetry/src/turnEndWitness.test.ts`（单独跑即复现）／触发用例＝用例①「崩溃合成收尾」**；
  **缺陷本体＝ `packages/core/src/session/Session.ts:141` 的 `this.append(...)` 未 `await` ⇒ 与 `close()`（`:250-253`）竞态 ⇒ FileHandle 永不关闭**。
  判定器（GC 无关）`.dsh-mission/evidence/M2-dep0137-minrep.mts`：复刻用例① 序列 ⇒ `settled=<open FileHandle> => LEAKED`；
  只多一个时间片的对照 ⇒ `no leak`（两次运行逐字相同）。故**测试侧没有可做的"资源管理"修法**
  （该用例已经 `close()`，是 `close()` 空转），按硬边界 **归因到 `packages/core/**` 运行时源码 ⇒ 只登记不改**。
- [x] 若修：改前/改后对照 + 修后复跑证据 —— **未修**（超授权）；core 侧建议的最小修法（`await this.append(...)`）
  与可复用的 A/B 判定器已写进归因记录，供后续有授权的卡执行。
- [x] 偏差 / 未完成项 / 你的假设 —— 偏差：额外自建 tsx 判定器（非 vitest run，已声明、两次运行）；
  未完成：core 一行修法未施加；假设：run2/3/4 的空 stderr 由 GC 时机解释（依据＝判定器 + 同形文件）。
- [x] 零断言改动 / 零文件改动 —— `git status --short` 仍只有 M1 的 4 项；`turnEndWitness.test.ts` 与 `Session.ts` 对 HEAD 无 diff。

**附带发现（早于 M2）**：`turnEndWitness.test.ts` 创建于 07:05，而 `C5b-run1-mutationA.log`（02:17，
只跑 telemetry 三文件、日志内 `turnEndWitness` 出现 0 次）已有同一条告警 ⇒ 该告警族早于 M2；
那一处的机制是 `turnEndBoundary.test.ts` 用例失败后跳过 `close()`（`:213`）的测试卫生问题，
按"既有文件 ⇒ 只登记不改"进 Deferred Backlog。

## 验收结论（Evaluator / 指挥会话回填）

- 结果：
- 备注：
