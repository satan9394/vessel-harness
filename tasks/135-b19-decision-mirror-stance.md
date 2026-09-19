# 135 — B19 契约口径收口：v1 决策镜像只记 deny

- 编号：135
- 状态：已合入（2026-09-18）
- 优先级：P2（诚实化：契约句"每次恰好一次"与实现"只记 deny"不一致）
- 创建日期：2026-09-18
- 关联：`tasks/118`（`deny_domains` declaration-only 同款做法）、`packages/shared/src/events.ts` 的 `AuditDecisionRecord` JSDoc、`docs/POLICY-SPEC.md` §2.5/§7.2、`docs/EVENT-SPEC.md` A13/B19
- 执行器：指挥侧

## 1. 背景与口径决定

`POLICY-SPEC` §2.5 / §7.2 与 `EVENT-SPEC` A13 的契约句写"每一次走策略链的调用**恰好产出一次** `PolicyDecision`(A13) + `audit/decision`(B19)"，而实现里 `policy_decision` **只在 deny 时 emit**、`audit/decision` **零生产者**（`unwiredRecords.test.ts` 反向断言守卫）。

**产品口径（拍定）：v1 决策镜像只记 deny** —— 不实现 allow 镜像。理由：① 当前**零消费者**（无 UI/回放/conformance 读它）；② 接线后每个工具调用都多落一条记录，会话日志显著膨胀；③ 生产者必须在 `packages/core`（AgentLoop），属**运行时语义变更**，按本仓纪律要独立卡 + 对抗评审，而收益为零。"allow 也落一份"登记为**未来可选增强（须先有消费方）**。

## 2. 改动（纯文档 + 一处 JSDoc，零代码语义/零断言）

| 落点 | 改动 |
|---|---|
| `docs/POLICY-SPEC.md` §2.5 | 契约句改为「**v1 口径：决策镜像只记 deny**（`audit/denial`）」，下表标注为**完整契约**；实现状态注补"v1 不接线 + allow 镜像为未来可选增强" |
| `docs/POLICY-SPEC.md` §7.2 | 执行链的 `ALLOW/DENY` 与 `Audit` 行标注 **v1：deny 分支 / 唯一落盘审计记录**；链下实现状态注同步 |
| `docs/EVENT-SPEC.md` 表 B 注 | 补"v1 决策镜像只记 deny，B19 不接线" |
| `docs/EVENT-SPEC.md` A13 | 触发时机区分「**契约**：恰好一次」vs「**v1 实现：只 deny 分支 emit**」；消费方/镜像注标 B19 v1 未接线 |
| `docs/EVENT-SPEC.md` B19 | 条目注改为「**v1 不接线**：类型已登记、零生产者/零消费者；v1 口径 = 只记 deny，allow 镜像为未来可选增强」 |
| `packages/shared/src/events.ts` `AuditDecisionRecord` JSDoc | 补 v1 口径（只改注释，不动类型/行为） |

**代码与 `unwiredRecords.test.ts` 守卫不动**（B19 继续"已登记未接线"）。

## 3. 验收与实测

- 门禁：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` 根 **177 文件 / 2234 passed + 6 skipped** + web **11/120**。
- 核验：`POLICY-SPEC`/`EVENT-SPEC` 不再出现"每次恰好一次（暗示已实现）"的无条件表述；`events.ts` 类型未变（`unwiredRecords.test.ts` 仍绿）。

## 4. 边界

- 若未来出现消费方（审计 UI / conformance / 回放），接线须独立成卡 + 独立评审（core 运行时语义变更）。
