# 115 — 队列 statSync 加有界重试（消除 runSync 索引竞态 flaky）

- 编号：115
- 状态：已合入（2026-09-18 对账）
- 对账记录：原状态行「待验收」；实际已合入，证据：main 代码（task 115 statWithRetry）。
- 优先级：P2（与 113/114 同型的 Windows 锁 flaky 治理——stat 读路径；114 记录"若复现可另卡"）
- 创建日期：2026-09-10
- 关联：114（b83de45：记录的 runSync 裸 statSync 竞态；expected ['C','B'] to equal ['C'] 一次时序失败；
      机制=杀软瞬锁 EPERM → catch 静默 continue → stale 索引）；113（helper）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 问题（114 记录，非 114 范围）

`packages/engine/src/project-task-queue.ts` 的 `runSync` 对已知条目用**裸 `fs.statSync(meta).mtimeMs`**
（L387/L453 + L428 注释所述路径）判断 mtime 变化；Windows 杀软瞬时锁文件时 stat 抛 EPERM → catch 静默
`continue` → 该条目沿用旧索引（stale）→ 队列正确性偶发 flaky（114 实测一次 `expected ['C','B'] to equal
['C']`，隔离/基线/改后/全量对照均为非本卡回归）。同类问题已在 rename 写路径治理（113/114），stat 读路径补齐。

## 验收标准（执行器逐条勾选）

- [x] 定位 runSync 的 3 处 statSync（L387/L453/索引路径）及其 catch 处理——确认静默 continue 为 stale 根源
- [x] **有界重试**：statSync 加与 113 helper 同语义的重试（3 次/5-15ms，仅 EPERM·EBUSY·EACCES 重试，其它错误立即
      抛；全部失败抛最后错误——**不静默 continue**；或按队列语义合理降级并记录选型）
- [x] 若放共享 helper：可在 `packages/shared/src/atomicWrite.ts` 加 `statWithRetry`（或新 helper 文件）——选型记录；
      复用 `@vessel/shared` 依赖（engine→shared 已确认无环）
- [x] 测试 ≥3 例：stat 前 2 次抛 EPERM 第 3 次成功（索引更新正确）/ 非锁错误立即抛 / runSync 全量并发下 stale
      消除（或注入证明）；沿用 113 的 vi.mock('node:fs') 方案；`tsc -b` exit 0 + 全量 vitest（1190+ 无回归）+ web 82
- [x] 文档同步（TASK-QUEUE-ITERATION-STORE 若涉）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只给 runSync 的 stat 读路径加有界重试。不改队列状态机/原子写语义；不加依赖；不做无关重构。

## 涉及文件（指针，执行器自行精化）

- `packages/engine/src/project-task-queue.ts`（3 处 statSync）
- 复用/扩展：`packages/shared/src/atomicWrite.ts`（113 helper）或新 stat helper（选型记录）

## 方法

- 读 114 卡 §踩坑 + queue runSync 现状 → stat 加有界重试（不静默 continue）→ 注入测试 → 全量验证

## 工作证明（执行器回填：stat 位置/重试方案/选型/diff/测试输出/全量 vitest/tsc/web 结果，全部写进本文件，勿留对话里）

### 1. stat 位置定位（grep 确认，3 处 statSync）

`packages/engine/src/project-task-queue.ts` 共 3 处落到 statSync（含注释路径）：

| 位置 | 场景 | 原 catch 处理 | 判定 |
|---|---|---|---|
| L387（`writeMeta`） | 写后读 mtime 透传索引 | catch 静默用当前时钟兜底（保守置脏） | 非 stale 根源（byId 刚写本实例写后 record，mtime 仅缓存校验值），加重试增强 |
| L428（注释） | 索引路径说明 | — | 同步注释 |
| L453（`runSync`） | 增量 sync 对已知条目校验 mtime | catch **静默 `continue`**（条目沿用旧索引） | **stale 根源**（114 实测 `expected ['C','B'] to equal ['C']` 的机制）——必须去静默 |

### 2. 重试方案与选型

- **选型：共享 helper**。在 `packages/shared/src/atomicWrite.ts` 加 `statWithRetry`（与 `renameWithRetry`
  同居同一文件，复用其 `RENAME_RETRY_ATTEMPTS=3` / `RENAME_RETRY_DELAYS_MS=[5,15]` /
  `RENAME_RETRYABLE_CODES` / `isRetryable` / `sleepBlocking`）——Windows 锁治理同一主题、语义 1:1 对齐、
  单点维护；engine 已依赖 `@vessel/shared`（114 确认无环），`@vessel/shared` 经 `index.ts` 的
  `export * from './atomicWrite.js'` 自动导出。默认 stat 用 fs 命名空间**动态属性访问**
  （`(p) => fs.statSync(p)`，同 renameWithRetry 范式），vitest 文件级 mock('node:fs') 可拦截。
  不新开 helper 文件的理由：与 rename 重试共享常量与错误分类，拆文件反而重复。
- **L453 catch 分类（关键语义）**：statWithRetry 对锁错误重试 3 次尽后抛最后错误（不吞错）→ runSync catch：
  - `ENOENT`/`ENOTDIR` → `continue`（meta 真缺失/被外部删除，视同损坏跳过——**原合法语义保留**，非 stale）；
  - 其它（EPERM/EBUSY/EACCES 重试尽等）→ **不静默 continue**，按队列语义降级：`mtimeMs = Date.now()`
    保守置脏 → 必然 ≠ 缓存 mtime → 强制 `readMeta` 重读 → 正确性以 disk 为锚（与 writeMeta 兜底同语义）。
    静默 continue 的旧行为 = 沿用旧索引 = stale；降级重读 = 宁读不丢。
- L387（writeMeta）改走 `statWithRetry`，catch 兜底保留（极端竞态用时钟兜底的注释语义不变）。

### 3. diff 摘要（5 文件，+231/-13）

- `packages/shared/src/atomicWrite.ts`：文件头注释扩展（113/115 双主题）+ `StatWithRetryOptions` +
  `statWithRetry(file, opts): fs.Stats`（3 次/5-15ms/仅锁错误重试，全失败抛最后错误）。
- `packages/engine/src/project-task-queue.ts`：`import { renameWithRetry, statWithRetry }`；L387/L453
  `statWithRetry(file).mtimeMs` + catch 分类（见 §2）；L428 索引注释同步。
- `packages/shared/src/atomicWrite.test.ts`（+4）：statWithRetry 单测——EPERM×2 第 3 次成功（注入 stat/sleep，
  断言退避 5/15ms）；EBUSY 重试尽抛最后错误（不吞错）；ENOENT 立即抛不重试不退避；默认真实 fs 往返（mtimeMs 可用）。
- `packages/engine/src/project-task-queue.test.ts`（+4，沿用 113 的 vi.mock('node:fs') 方案：
  mock 工厂增 statSync 真实委托包装）：
  1. enqueue writeMeta stat（L387）EPERM×2 → 第 3 次成功：`statSync` 恰 3 次（裸 statSync 第 2 次即抛 =
     helper 接管证明）+ 写透传索引 list 立即可见；
  2. 跨实例装载 runSync stat（L453）EPERM×2 → 第 3 次成功：`statSync` 3 次 + in-progress 装载正确
     （旧行为静默 continue → 条目不进索引 → list 空 = stale 缺失）；
  3. 非锁错误 ENOENT 立即抛不重试：`statSync` 恰 1 次 + runSync 视同损坏跳过（合法语义）——与上两例 3 次对照；
  4. **stale 消除注入证明**：cached 条目（A）跨实例改终态（in-progress→met）后，s 增量 sync 时 stat 锁错误
     重试尽（2 条目 × 3 次 = 6 个 EPERM）→ 不静默 continue → 置脏强制重读 → `list({status:'met'})` 即见 A
     （旧行为 A 仍显示 in-progress）；断言 `statSync` 恰 6 次；EPERM 用尽后恢复真实 stat 再 sync 索引收敛无残影。
- `docs/TASK-QUEUE-ITERATION-STORE.md`：§2 存储模式段标注 stat 读路径走 `statWithRetry`（task 115，
  锁重试尽保守置脏强制重读、不静默 continue）。CONTEXT-RESET-HANDOFF.md 的原子写段属 HandoffStore
  （get/list 全读、无 stat 索引机制），不涉本卡，未改。

### 4. 命令输出（定向 → 全量）

- `npx tsc -b tsconfig.json` → **exit 0**（TSC_EXIT=0）。
- 定向（2 文件）：`npx vitest run packages/shared/src/atomicWrite.test.ts packages/engine/src/project-task-queue.test.ts`
  → **36 passed (36) · Test Files 2 passed (2) · EXIT=0**（atomicWrite 13 = 原 9+新 4；queue 23 = 原 19+新 4）。
- 全量（root，后台 67.3s）：`npx vitest run` → **1198 passed | 1 skipped（1199）· Test Files 111 passed (111) ·
  EXIT=0**。基线 1190 + 本卡新 8 例（shared 4 + queue 4）= 1198，无回归。唯一 skipped 为既知（Sandbox.test.ts）。
- `npx vitest run --root apps/web` → **82 passed (82) · EXIT=0**（基线 82 持平）。

### 5. 踩坑（环境备注）

- 全量 vitest 一次通过（67.3s，与 113/114 量级一致）；无 EPERM/spawn/管道失败；命令纪律单次尝试执行。
- 新 describe 中 `makeStore` 是 task 063 describe 的局部函数（词法作用域不可见），需在新 describe 内重定义
  （单调递增时钟同款）——已修复。
- 注入用例细节：mock 必须设在目标操作之前且 `mockClear`（enqueue/claim 的 writeMeta 也调 statSync）；
  T4 用 6 个 `mockImplementationOnce`（2 条目 × 3 次重试全失败）规避 readdir 次序不定性——无论 A/B 谁先
  都恰耗尽 6 个 Once，统计稳定。

### 6. 提交

- `fix(engine,shared): bounded retry for queue stat reads — kill runSync stale-index flaky (task 115)`
  （含 shared atomicWrite.ts + 其测试、engine project-task-queue.ts + 其测试、TASK-QUEUE-ITERATION-STORE.md、
  本任务卡；未混入指挥侧文档与 benchmarks/reports）。

## 验收结论（指挥回填）

- [x] 合入（commit 38e057f）
- 备注：指挥独立复核——`tsc -b` exit 0；全量 vitest **1198 passed + 1 skipped / exit 0**（111 files，= 1186 +
  8 新用例）；web 82。
  认可：shared 新增 `statWithRetry`（复用 113 语义：3 次/5-15ms，仅锁错误重试、其它立即抛）；queue 3 处 stat
  路径（writeMeta L387 + runSync L453）改走 helper；**关键语义修正**——runSync 的 catch 不再静默 continue：
  ENOENT/ENOTDIR 才跳过（meta 真缺失合法语义），锁错误重试尽降级**保守置脏**（mtimeMs=Date.now()）强制重读
  disk（正确性以 disk 为锚）——从机制上消除 114 记录的 stale 索引 flaky；+8 测试（EPERM×2 第 3 次成功 /
  非锁 ENOENT 不重试 / 6 个 EPERM 重试尽置脏重读见新状态且无残影）。**115 关闭——stat 读路径治理闭环
  （rename+stat 全套 Windows 锁 flaky 治理完成）**。