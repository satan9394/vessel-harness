# 114 — 补齐剩余原子写裸 rename（engine 3 处 + cli.ts），flaky 治理彻底闭环

- 编号：114
- 状态：待执行
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

- [ ] 先 grep 确认 4 处现状（`git grep -n 'renameSync\|promises.rename' packages/engine apps/cli/src/cli.ts`），
      判断哪些是原子写（tmp+rename）哪些不是（不误改非原子语义）
- [ ] 原子写点改走 `renameWithRetry`/`renameWithRetryAsync`（113 helper，`@vessel/shared`；engine 是否依赖 shared 需先确认——engine 应已依赖 shared 类型契约，确认无环）
- [ ] 若某处不是原子写（无 tmp 阶段）但偶发 EPERM，也按 helper 语义包一层重试（记录选型）
- [ ] 测试 ≥4 例：engine 相关包回归 + EPERM 注入（沿用 113 的 vi.mock 方案）+ helper 复用确认；`tsc -b` exit 0 +
      全量 vitest（1186+ 无回归）+ web 82
- [ ] 文档同步（若涉写入约定）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只把 4 处裸 rename 收敛到已建 helper。不改语义/格式；不加依赖（helper 已存在）；不做无关重构。

## 涉及文件（指针，执行器自行精化）

- `packages/engine/src/handoff/`、`packages/engine/src/iteration-store.ts`、`packages/engine/src/project-task-queue.ts`
- `apps/cli/src/cli.ts`（writeTextAtomic）
- 复用：`packages/shared/src/atomicWrite.ts`（113：renameWithRetry / renameWithRetryAsync）

## 方法

- grep 定位 → 判断原子语义 → 逐一收敛到 helper → 测试（含注入 EPERM）→ 全量验证

## 工作证明（执行器回填：4 处现状判定/迁移 diff/测试输出/全量结果，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：