# T308 — 修 304 的 evidence 错位隐患

- Status: 已完成（2026-10-26；PDW 任务 `20261026081002-dbd8ea` `accepted_local`；未提交、未推送）
- PDW task: none
- Mode: standard（证据链正确性修复 + 测试）
- Source: 卡 304 验收记录里的潜在缺陷
- Risk: low（只加可选字段、改一处关联方式）

## Goal

`compose.ts` 目前用 `events[index]` 把反思规则与轨迹事件配对。这依赖 `AutonomousReflectionEngine.processSessionEnd` 的默认 `minSeverity = 0`——该值下 severity 过滤永不生效，index 恰好对齐。一旦调用方传 `minSeverity > 0`，实现里的 `continue` 会让 `rules` 比 `events` 短，配对整体错位，`suggest()` 的 evidence 会指向**错误的事件**。

修法：让引擎把事件来源随规则一起返回，调用方不再猜。

## Not Doing

- 不改 `LearnedStore` 的持久化结构、不改 suggest/approve 语义、不改三要素门。
- 不改 `processSessionEnd` 的返回**顺序**或数量（只加可选字段）。
- 不 commit / push / 删文件；不加依赖；不动 `packages/core`。

## 设计

1. `packages/memory/src/reflection/autonomousReflection.ts`：
   - 新增导出类型 `export type ReflectedRule = ReflectiveRule & { evidenceSource?: { sourceSequence?: number; sourceId?: string } }`，并说明这是「产生该规则的那条轨迹事件的稳定来源」。
   - `processSessionEnd(...)` 返回类型改为 `Promise<ReflectedRule[]>`。
   - 两个 push 分支（`autoPersist === false` 与写入 store 之后）都带上 `evidenceSource: { ...(event.sourceSequence !== undefined ? { sourceSequence: event.sourceSequence } : {}), ...(event.sourceId !== undefined ? { sourceId: event.sourceId } : {}) }`；两个字段都缺时**不要**带空对象（保持 `undefined`）。
2. `packages/application/src/compose.ts`：
   - 删掉 `const event = events[index];` 与对 `events` 的索引依赖。
   - evidence 改用 `rule.evidenceSource`：有 `sourceSequence` → `<sessionDir>/session.jsonl#seq=<n>`；否则有 `sourceId` → 保持**现有格式**（与改动前逐字一致，测试已锁定该字符串）；两者都没有 → 空数组（走「缺 evidence」分支 warn 一次）。
   - `rules.entries()` 改成 `for (const rule of rules)`（不再需要 index）。

## Acceptance

- AC1：`processSessionEnd` 返回的每条规则都带 `evidenceSource`（当对应事件有 `sourceSequence` 或 `sourceId` 时），两个都缺时不带该字段。
- AC2：`compose.ts` 不再出现 `events[index]` 这类索引配对；evidence 字符串格式与改动前逐字一致（`session.jsonl#seq=` 与 `sourceId` 分支）。
- AC3：新增一条 engine 层用例钉住错位：`events = [tool_failure(有 sourceSequence=7), policy_denial(有 sourceId='d-1')]`，调 `processSessionEnd(..., { minSeverity: 2 })` → 只返回 1 条，且其 `evidenceSource` 指向 **policy_denial**（`sourceId === 'd-1'`、`sourceSequence === undefined`），**不是**第一条事件的 seq=7。
- AC4：既有 `compose.test.ts` 的 16 条用例保持通过（含 evidence 字符串断言与「缺 evidence 时 warn 一次」）。
- AC5：定向 vitest、`tsc -b`、`typecheck:tests` exit 0。

## Blast Radius

`packages/memory/src/reflection/autonomousReflection.ts`、`packages/memory/src/reflection/autonomousReflection.test.ts`、`packages/application/src/compose.ts`、`packages/application/src/compose.test.ts`。回滚 `git checkout -- <上述文件>`。

## Expected Evidence

定向 vitest 输出、`tsc -b` / `typecheck:tests` 退出码、PDW review 结论；协调者另跑全量。

## Result

已完成。`autonomousReflection.ts` 新增导出 `ReflectedRule = ReflectiveRule & { evidenceSource?: { sourceSequence?: number; sourceId?: string } }`，`processSessionEnd` 返回该类型；两个 push 分支都带 provenance，两个字段都缺时**不带**该键（不是空对象），返回条数与顺序不变。`compose.ts` 删掉 `events[index]` 配对与未使用的 `event` 变量，evidence 改由 `rule.evidenceSource` 构造，字符串格式与改动前逐字一致。

回归用例直接钉住错位：`minSeverity: 2` 下 `[tool_failure(sourceSequence=7), policy_denial(sourceId='d-1')]` 只返回一条，`evidenceSource === { sourceId: 'd-1' }`、`sourceSequence` 为 `undefined`（旧实现会指向 7）；`autoPersist` 的 true/false 两分支各测一遍；第三条无来源的规则确认不会把 `evidenceSource` 写进持久化；compose 侧另加两条（有 seq / 只有 id）证明它用的是规则 provenance 而不是输入事件。

PDW 任务 `20261026081002-dbd8ea`：`accepted_local`，4 次调用、0 修复。定向 2 文件 / 22 passed；`tsc -b`、`typecheck:tests` exit 0；全量 `npm run test:all` 根 **316 文件 / 3367 passed + 6 skipped**、web **58 / 494**。
