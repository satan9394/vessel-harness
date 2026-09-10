# 115 — 队列 statSync 加有界重试（消除 runSync 索引竞态 flaky）

- 编号：115
- 状态：待执行
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

- [ ] 定位 runSync 的 3 处 statSync（L387/L453/索引路径）及其 catch 处理——确认静默 continue 为 stale 根源
- [ ] **有界重试**：statSync 加与 113 helper 同语义的重试（3 次/5-15ms，仅 EPERM·EBUSY·EACCES 重试，其它错误立即
      抛；全部失败抛最后错误——**不静默 continue**；或按队列语义合理降级并记录选型）
- [ ] 若放共享 helper：可在 `packages/shared/src/atomicWrite.ts` 加 `statWithRetry`（或新 helper 文件）——选型记录；
      复用 `@vessel/shared` 依赖（engine→shared 已确认无环）
- [ ] 测试 ≥3 例：stat 前 2 次抛 EPERM 第 3 次成功（索引更新正确）/ 非锁错误立即抛 / runSync 全量并发下 stale
      消除（或注入证明）；沿用 113 的 vi.mock('node:fs') 方案；`tsc -b` exit 0 + 全量 vitest（1190+ 无回归）+ web 82
- [ ] 文档同步（TASK-QUEUE-ITERATION-STORE 若涉）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只给 runSync 的 stat 读路径加有界重试。不改队列状态机/原子写语义；不加依赖；不做无关重构。

## 涉及文件（指针，执行器自行精化）

- `packages/engine/src/project-task-queue.ts`（3 处 statSync）
- 复用/扩展：`packages/shared/src/atomicWrite.ts`（113 helper）或新 stat helper（选型记录）

## 方法

- 读 114 卡 §踩坑 + queue runSync 现状 → stat 加有界重试（不静默 continue）→ 注入测试 → 全量验证

## 工作证明（执行器回填：stat 位置/重试方案/选型/diff/测试输出/全量 vitest/tsc/web 结果，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：