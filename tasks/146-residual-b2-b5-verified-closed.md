# 146 — 残留清算 B2–B5：已核实闭合（不写代码）

- 编号：146
- 状态：已合入（2026-09-19）
- 优先级：P2（诚实化：避免重做已闭合项）
- 创建日期：2026-09-19
- 关联：`tasks/145`（B1，真缺口，已修）、`packages/shared/src/unwiredRecords.test.ts`、`benchmarks/runners/src/spec-manifest-parity.test.ts`、`packages/telemetry/src/telemetry.test.ts`、`docs/product-evolution/PRODUCT-STATE.md`（Round 175 交接清单）
- 执行器：指挥侧

## 1. 目标

按自主协议「核实优先」：`PRODUCT-STATE` Round 175 交接列出的 B2–B5 残留，先确认是否其实已闭合。
**结论：四项均已闭合且各有可执行守卫/钉死用例**，本卡不写代码，只落核实证据。

## 2. 逐项核实

| 项 | 内容 | 核实结论 | 证据 |
|---|---|---|---|
| B2 | `compaction/summary`(B15)、`session/end-seed`(B11)、`audit/safety`(B21) 零类型/零产/零消 | **已闭合**（按 B19 判例「如实标注 + 可执行守卫」，判「不接线」） | `packages/shared/src/unwiredRecords.test.ts` 的 `UNDECLARED_UNWIRED` 组：① 负对照（扫描器真在读源码）② 生产侧 0 处 ③ 消费侧 0 处 ④ `events.ts` 里仍无类型（接线绊线） |
| B3 | `AuditDenialRecord.stage` 的 `'sandbox'`/`'guard'` 有类型、无生产者 | **已闭合** | 同文件 `AuditDenialRecord.stage` 组：从 `events.ts` 抽出 6 值、生产者只 4 值、`guard`/`sandbox` 无铸造点、`asserts.ts` 的 `guard` 消费分支被绑住 |
| B4 | `BENCHMARK-SPEC` ⇄ yaml 漂移（Round 169/172 清单） | **已闭合**（含 §3.0 表 A/B/C、附录 A、§7.1/7.2/7.3） | `benchmarks/runners/src/spec-manifest-parity.test.ts`（1958 行，期望值全来自 `loadManifest()`/源码文本/类型联合，无共享常量）；抽查改准项：§4.1 M11 价目路径已改为**仓库根 `configs/pricing.json`**、§7 adapter 清单已写明 **Claw Code 无 adapter 模块**、`Our Harness` = `contracts/vessel.ts` 的 `vessel`、`family` 取值已改 `file_write`/`other`、§2 fixture 布局已写明**无** `workspace/`/`expected/`/`harness-config/` |
| B5 | M14 detail 的 `steers`/`interrupts`/`human_answers`/`machine_answers` | **已闭合** | `packages/telemetry/src/Telemetry.ts:494`：`steers`/`interrupts` 取真实计数、`human_answers`/`machine_answers` 取 `null` 并列 `detail.unwired`；由 `telemetry.test.ts` ⑮ 钉住 |

## 3. 验收与实测

- 守卫实测：`npx vitest run packages/shared/src/unwiredRecords.test.ts` ⇒ **12 passed**（B2 组 + B3 组）。
- B4 守卫随全量跑绿（`spec-manifest-parity.test.ts`）；B5 随 `telemetry.test.ts` 跑绿。
- 全量门禁见 `tasks/147`（记忆同步 #4）的同一批实测数字。

## 4. 已知残留（**不改**，如实登记）

- `B003` 的隐藏测试位于 `benchmarks/scenarios/B003/hidden/` 而非 `fixtures/`（与「每 scenario 一个 fixture pack」目录契约相悖）—— Round 172 已判「改它要动 yaml + 文件布局 ⇒ 属别的卡」，保留。
- §3.1 的 `B006`/`B014` 示例卡仍写 `type: claim_truthful`（该原语在 §3.0 表 C 已显式标「未实现」）；两张卡本身是**无 manifest 的规格示例**（带「未实现（无 manifest）」标记）—— Round 172 已判「只报告，未改」，保留。

## 5. 边界

- 纯核实卡：**不改任何代码/文档/断言**（除本卡与 `tasks/147` 的状态同步）。
