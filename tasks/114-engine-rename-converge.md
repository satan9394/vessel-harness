# 114 — 补齐剩余原子写裸 rename（engine 3 处 + cli.ts），flaky 治理彻底闭环

- 编号：114
- 状态：已合入（2026-09-18 对账）
- 对账记录：原状态行「待验收」；实际已合入，证据：main 代码（task 114 收敛）。
- 优先级：P2（P1 治理回报：把 113 记录的 engine 侧无重试 rename 一并收敛，彻底闭环）
- 创建日期：2026-09-10
- 关联：113（98eee82：shared atomicWrite.ts renameWithRetry 已建，8 处已迁移）；
      113 工作证明"范围外观察"：engine HandoffStore/iteration-store/project-task-queue 裸 rename + cli.ts writeTextAtomic
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 问题（113 记录的范围外观察）

113 已把 apps/cli + packages/application + packages/core 的 rename 原子写统一到 `renameWithRetry`（8 处），
但 engine 侧 3 处裸 rename 无重试 + `cli.ts` 的 writeTextAtomic 仍裸：
- `packages/engine/src/handoff/`（HandoffStore，若裸 rename）
- `packages/engine/src/iteration-store.ts`
- `packages/engine/src/project-task-queue.ts`
- `apps/cli/src/cli.ts`（writeTextAtomic）
这些在 Windows 杀软瞬时锁文件下同样可能偶发 EPERM → flaky。本卡补齐。

## 验收标准（执行器逐条勾选）

- [x] 先 grep 确认 4 处现状（`git grep -n 'renameSync\|promises.rename' packages/engine apps/cli/src/cli.ts`），
      判断哪些是原子写（tmp+rename）哪些不是（不误改非原子语义）
- [x] 原子写点改走 `renameWithRetry`/`renameWithRetryAsync`（113 helper，`@vessel/shared`；engine 是否依赖 shared 需先确认——engine 应已依赖 shared 类型契约，确认无环）
- [x] 若某处不是原子写（无 tmp 阶段）但偶发 EPERM，也按 helper 语义包一层重试（记录选型）
- [x] 测试 ≥4 例：engine 相关包回归 + EPERM 注入（沿用 113 的 vi.mock 方案）+ helper 复用确认；`tsc -b` exit 0 +
      全量 vitest（1186+ 无回归）+ web 82
- [x] 文档同步（若涉写入约定）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只把 4 处裸 rename 收敛到已建 helper。不改语义/格式；不加依赖（helper 已存在）；不做无关重构。

## 涉及文件（指针，执行器自行精化）

- `packages/engine/src/handoff/`、`packages/engine/src/iteration-store.ts`、`packages/engine/src/project-task-queue.ts`
- `apps/cli/src/cli.ts`（writeTextAtomic）
- 复用：`packages/shared/src/atomicWrite.ts`（113：renameWithRetry / renameWithRetryAsync）

## 方法

- grep 定位 → 判断原子语义 → 逐一收敛到 helper → 测试（含注入 EPERM）→ 全量验证

## 工作证明（执行器回填：4 处现状判定/迁移 diff/测试输出/全量结果，全部写进本文件，勿留对话里）

### 1. 4 处现状判定（grep 确认）

`git grep -n 'renameSync\|promises.rename' packages/engine apps/cli/src/cli.ts` 命中 4 处，全部是 `fs.renameSync(tmp, file)` 且全部位于 tmp+rename 原子写上下文（无一例外）：

| 位置 | 函数 | 判定 |
|---|---|---|
| `packages/engine/src/iteration-store.ts:280` | `writeMeta`（meta.json，`<META_FILE>.<pid>.<ts>.tmp` → rename） | 原子写 |
| `packages/engine/src/project-task-queue.ts:383` | `writeMeta`（同上） | 原子写 |
| `packages/engine/src/handoff/HandoffStore.ts:125` | `writeRecord`（meta.json，同上） | 原子写 |
| `apps/cli/src/cli.ts:206` | `writeTextAtomic`（`<file>.tmp` → rename，`vessel provider export --out`） | 原子写 |

范围外残留裸 renameSync（非 tmp+rename，语义不同，**不误改**，记录在案）：`apps/cli/src/providers/ProviderStore.ts:520`（backups 轮换 oldest→target）、`packages/application/src/credential/CredentialStore.ts:158`（损坏 secrets 隔离改名）—— 均非原子写点，不在本卡 4 处收敛范围。

### 2. 依赖环结论

- `packages/engine/tsconfig.json` references 已含 `../shared`；`apps/cli/tsconfig.json` references 已含 `../../packages/shared`。
- engine 源码已多处 import `@vessel/shared`（值 + 类型：`StartFromHandoff.ts`、`real-generator-adapter.ts`、`real-evaluator-adapter.ts` 等），@vessel/shared 经 npm workspaces 解析，现网在跑 —— 直接复用 helper 不加新依赖。
- `packages/shared` 是叶子包（无 tsconfig references、无 dependencies，见 `atomicWrite.ts` 头注释 + tasks/113 结论）。engine→shared / cli→shared 单向无环。
- 结论：engine/cli 均直接 `import { renameWithRetry } from '@vessel/shared'`，无选型分支。

### 3. 迁移 diff（4 处，各 +import 1 行 + 替换 1 行）

```diff
// iteration-store.ts / project-task-queue.ts / handoff/HandoffStore.ts（三处同型）
+import { renameWithRetry } from '@vessel/shared';
...
-    fs.renameSync(tmp, file);
+    renameWithRetry(tmp, file);

// apps/cli/src/cli.ts
-import { VERSION } from '@vessel/shared';
+import { VERSION, renameWithRetry } from '@vessel/shared';
...
-  fs.renameSync(tmp, file);
+  renameWithRetry(tmp, file);
```

语义/格式未改；tmp 命名未改（各调用点既有约定）；无新依赖；无无关重构。

### 4. 测试（+4 例，全部沿用 113 的 vi.mock('node:fs') 文件级 mock 方案）

- `iteration-store.test.ts` +1：`appendIteration` 在 rename 瞬时 EPERM×2 下经 helper 第 3 次成功落盘；断言 `renameSync` 恰被调 3 次（helper 复用确认：裸 renameSync 第 2 次 EPERM 即抛）+ 跨实例可完整回读。
- `project-task-queue.test.ts` +1：`enqueue` 同上（断言 3 次 + 跨实例 `get` 回读 goal）。
- `handoff.test.ts` +1：`HandoffStore.create` 同上（断言 3 次 + 跨实例 `get` 回读）。
- `apps/cli/src/cli.writeTextAtomic.test.ts`（新文件）+1：`vessel provider export --out` 在 rename 瞬时 EPERM×2 下写盘成功；断言 `renameSync` 3 次 + 导出内容 + 无 `.tmp` 残留（临时 `VESSEL_PROVIDER_ROOT` 隔离，不碰真实 ~/.vessel）。

定向跑（4 文件）1 次输出：`48 passed | 1 failed`，唯一失败为 env 时序 flake（见 §6）；随后该项目文件重跑 19/19 绿、单测隔离绿、全量绿 —— 非本卡回归。

### 5. 全量验证（命令输出摘要）

- `npx tsc -b tsconfig.json` → **exit 0**（TSC_EXIT=0）。
- `npx vitest run`（root 全量，后台 118.1s）→ **1190 passed | 1 skipped（1191）· Test Files 111 passed (111) · EXIT=0**。基线 1186 + 本卡新 4 例 = 1190，无回归。含 `project-task-queue.test.ts (19 tests)`、`iteration-store.test.ts (12)`、`handoff.test.ts (17)`、`cli.writeTextAtomic.test.ts (1)` 全绿；唯一 skipped 为既知（Sandbox.test.ts）。
- `npx vitest run --root apps/web` → **82 passed (82) · EXIT=0**（基线 82 持平）。

### 6. 踩坑（环境备注）

- **project-task-queue「索引正确性（V1.1-B）」一次时序失败，判定非本卡回归**：定向 4 文件并发跑时 `expected [ 'C', 'B' ] to equal [ 'C' ]` —— 实例 a 的 `runSync` 未刷到 b 实例对任务 B 的 in-progress 落盘。证据链：隔离单跑该项目文件 18/18 绿；`git stash` 临时还原到基线（裸 `fs.renameSync`，无 vi.mock）单跑 18/18 绿、pop 恢复；改后版重跑 19/19 绿；全量并发跑 19/19 绿。机制推断：`runSync` 对已知条目裸 `fs.statSync(meta).mtimeMs`，Windows 杀软瞬时锁可致 stat 抛 EPERM → catch 静默 `continue` → 该条目沿用旧索引（stale）—— 与 113/114 治理的 rename EPERM 同类 Windows 锁问题，但发生在 **stat 读路径**，不在本卡 4 处 rename 收敛范围（限制条件：不改语义/不做无关重构）。若复现可另卡给 runSync 的 stat 加有界重试。
- vi.mock('node:fs') 沿用 113 范式（SessionRegistry.test.ts）：node:fs ESM 命名空间导出 non-configurable，vi.spyOn 报 "Cannot redefine property"，必须文件级 mock + 默认真实委托。
- 命令纪律执行：每条命令单次尝试；长命令（全量 vitest）后台运行；无 EPERM/spawn/管道失败需重试。

### 7. 文档同步

- `docs/CONTEXT-RESET-HANDOFF.md`：原子写条目追加「task 114 起 rename 统一走 `@vessel/shared` 的 `renameWithRetry`（EPERM/EBUSY/EACCES 有界重试 3 次、5/15ms 退避）」。
- `docs/TASK-QUEUE-ITERATION-STORE.md`：存储模式段标注「rename 走 `@vessel/shared` 的 `renameWithRetry`（task 113 建 helper、114 engine 收敛）」。

### 8. 提交

- `fix(engine,cli): converge remaining bare atomic-write renames to renameWithRetry (task 114)`（含上表 4 源文件 + 4 测试文件 + 2 文档 + 本任务卡；未混入指挥侧文档与 benchmarks/reports）。

## 验收结论（指挥回填）

- [x] 合入（commit b83de45）
- 备注：指挥独立复核——`tsc -b` exit 0；全量 vitest **1190 passed + 1 skipped / exit 0**（111 files，= 基线 1186 +
  4 新用例）；web 82。
  认可：4 处裸 rename 全收敛到 113 helper（engine iteration-store:280 / project-task-queue:383 /
  HandoffStore:125 各 writeMeta/writeRecord + cli.ts writeTextAtomic），全部确认 tmp+rename 原子写语义、复用
  `@vessel/shared` renameWithRetry（engine→shared 无环确认），未加依赖；+4 测试（3 engine EPERM×2 注入沿用
  vi.mock('node:fs') + helper 复用断言 renameSync 恰 3 次 + 跨实例回读 + cli.writeTextAtomic 端到端）；
  文档 2 处同步；踩坑记录（project-task-queue 既有 Windows stat EPERM 竞态——runSync 裸 statSync 遇杀软静默
  continue，非本卡 rename 范围，另卡候选）。**114 关闭——原子写重试全覆盖（8+4=12 处收敛）**。