# 任务卡 244 [ARCH-03]: EffectJournal 故障注入与未知副作用恢复证明

> 状态：已完成 (DONE)  
> 归属：Phase 3 执行可靠性、外部生态对齐与高信噪比体验（ARCH-03 / P0）  
> 对应规划：`docs/plans/VESSEL_Architecture_Review_and_Execution_2026-10-20.md` §3 ARCH-03 与 `docs/POLICY-SPEC.md`  

## 1. 目标 (Goal)
- 核实并确证 `EffectJournal` 在多断点崩溃场景下的副作用不可逆与非幂等防护能力：
  1. 验证 `ToolCall → policy → permit → effect intent fsync → dispatch → outcome fsync → event projection` 完整调用链；
  2. 针对四类崩溃边界进行确定性恢复断言：
     - **边界 1（Intent 前 / Dispatch 前）**：写入 intent 后进程崩溃，恢复时标记未知并暂停，禁止自动重试写副作用；
     - **边界 2（Dispatch 后 / Outcome 记录前）**：外部写操作已执行但进程立即崩溃，恢复时阻断重放，标记 `OUTCOME_UNKNOWN` 并要求协调；
     - **边界 3（Outcome 记录后）**：工具结果已持久化后崩溃，恢复时严禁重放已完成项（`already observed`）；
     - **边界 4（授权边界与参数篡改）**：若工具调用参数哈希在恢复时被篡改或放大权限，立即拒绝（`identity changed`）；
  3. 确认只读操作与非幂等操作的差异化处理：只读操作允许安全递增 attempt 重试，写操作强制要求 reconcile。

## 2. 事实核查与实现证据 (Implementation Evidence)
- **底层实现**：`packages/runtime/src/executor/EffectJournal.ts`
  - 使用 `fs.openSync` + `fs.fsyncSync` 保证 intent 与 outcome 原子落盘；
  - `pending()` 动态过滤未闭环的 intent；
  - `begin()` 硬约束：未决的写副作用直接抛出 `OUTCOME_UNKNOWN: pending session effect requires reconciliation before further writes`；
  - 参数指纹篡改抛出 `Invocation identity changed during recovery`；
  - 已完成项抛出 `Invocation already observed; replay prohibited`。
- **可执行故障注入套件**：`packages/runtime/src/executor/fault-injection-gate.test.ts`（7 项）与 `EffectJournal.test.ts`（3 项）全部通过：
  - `boundary 1 — crash after pre-dispatch intent: recovery pauses, never re-executes` (PASS)
  - `boundary 2 — crash after dispatch, before tool result: unknown outcome blocks replay` (PASS)
  - `boundary 3 — crash after the tool result is recorded: replay is prohibited outright` (PASS)
  - `boundary 3b — an errored non-idempotent effect stays unresolved (outcome_unknown)` (PASS)
  - `boundary 4 — approval transition binds the exact operation hash (no widen, no replay)` (PASS)
  - `a pending non-idempotent effect blocks any further write until reconciled` (PASS)
  - `read-only work is recoverable without reconciliation (safe to regenerate)` (PASS)

## 3. 验收结论
- ARCH-03 故障注入与未知副作用恢复证明已在 `packages/runtime` 完整闭环并具备确定性自动化门禁，无需代码变动，状态核验 PASS。
