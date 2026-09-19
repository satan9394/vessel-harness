# 138 — migrate「回收失败后重跑」：**已核实闭合**（不写代码）

- 编号：138
- 状态：已核实闭合（2026-09-18）
- 优先级：P4（Round 124「仍开放」①的最后一项）
- 创建日期：2026-09-18
- 关联：`tasks/124`、`apps/cli/src/migrate.ts`（②裁决）、`apps/cli/src/cli.ts` `cmdMigrate`、`apps/cli/src/cli.test.ts:3380` 的 ② 用例组
- 执行器：指挥侧

## 1. 待办原文与核实结论

Round 124 记："**`migrate` 的'平台不支持回收'与'回收失败'分流**、**回收失败后再跑会短路退 0**"。**两者均已实现且已有判别性测试**，本卡只登记证据、**不改代码**。

## 2. 证据（逐条可核）

| 断言 | 实现 | 判别性测试 |
|---|---|---|
| 「不支持」≠「失败」：`RecycleUnsupportedError` ⇒ 退 **0** + 手工提示 | `migrate.ts` 的 `attemptRecycle` 分流 `recycleUnsupported`；`cmdMigrate` 该分支 `return 0` | `cli.test.ts:3514`（①-c，判别性：删掉该分支 ⇒ code 变 1 ⇒ RED）；`migrate.test.ts:161`（-a） |
| 「尝试后失败」⇒ 退 **1**，且说清"数据已迁移成功、旧目录未回收、不回滚" | `cmdMigrate` 的 `recycleError` 分支 `return 1` | `cli.test.ts:3407`（②-a） |
| **回收失败后再跑不短路退 0**：`~/.vessel` 已存在时**先看旧根是否仍在**，仍在 ⇒ 本次**再尝试一次回收**，结局同样分流 | `runVesselMigration` 的 `vessel-present` 分支调 `attemptRecycle`（`migrate.ts:206-211`） | `cli.test.ts:3599`（**②-e**：`vessel-present` + 回收失败 ⇒ **退 1**，并断言文案含"会再尝试一次回收"、**反锁**旧承诺 `跳过并退 0`）；`migrate.test.ts:250` |
| 成功路径文案/退出码逐字不变（负对照） | — | `cli.test.ts:3447`（②-b）、`:3474`（②-c）、`:3563`（②-d）、`:3633`（②-f） |

## 3. 结论

- **已核实闭合**：`vessel migrate` 在"回收失败"后再跑**仍会退 1**（会再尝试回收，成功即退 0），**不会**短路退 0；「不支持」与「失败」分流正确。
- 无代码改动、无测试新增（判别性用例已在 `cli.test.ts:3380` 的 ② 组内，含反锁）。
