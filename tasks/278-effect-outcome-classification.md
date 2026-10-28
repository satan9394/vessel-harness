# 任务卡 278: 一次工具失败不该锁死整个会话

**状态**: 已验收（2026-10-26 对账；全量门禁已在当前 HEAD 跑绿，依据见 [卡 340](340-board-backlog-closeout.md)）
**创建时间**: 2026-10-23
**执行者**: OpenCode（协调者自己实现，未派单）
**协调者**: OpenCode

---

## 1. 背景（实测，不要重新论证）

卡 276 的真实模型会话复验里，第一次 Shell 被沙箱拒绝之后，**同一会话里后续任何写入都失败**：

```
[DENIED] Error: OUTCOME_UNKNOWN: pending session effect requires reconciliation before further writes
```

模型连试三次全中，最后向用户报告「Shell 工具不可用」。这是 fail-closed 设计撞上分类错误：

- `EffectJournal.finish()` 原判定是 `result.error && effects !== 'read_only' → outcome_unknown`，
  即「工具报错」等于「副作用未知」。
- `Shell` 没有声明 `effects`，按 `requiredPermission !== 'read'` 落到 `non_idempotent`。
- 于是**任何** Shell 报错（沙箱拒绝、命令 exit 1）都会留下一条永不结算的 intent，
  而 `begin()` 对后续任何写操作直接抛 `OUTCOME_UNKNOWN`。
- 想解除只有 `POST /api/sessions/:id/effects` 一条路，Web UI 没有入口，CLI 没有命令，
  普通用户等于没有出路。

## 2. Goal

把「执行有没有跑完」和「执行有没有成功」分开：只有前者的答案未知时才阻断后续写入。

## 3. Acceptance Criteria

1. 工具**返回**错误结果（`DENIED` / `INVALID_ARGS` / `SANDBOX_DENIAL` / 带确定退出码的 `TOOL_FAILURE`）
   → 记为 `observed`，不阻断后续写。
2. 工具**抛异常**（Executor 标记 `meta.dispatchThrew`）、`TIMEOUT`、`detail.timedOut`、`detail.killed`、
   自报 `UNKNOWN` → 记 `outcome_unknown`，继续阻断。
3. 同一 key 的重放禁止不变（`Invocation already observed; replay prohibited`）。
4. 阻断时的错误信息带上 `key#attempt(effects)` 与 journal 路径，便于操作者处置。
5. 定向测试覆盖上述每条；真实模型会话验证「先失败一次，后一次写入成功」。

## 4. Not Doing

- 不做自动 reconcile（未知副作用必须由人确认）。
- 不改 journal 落盘格式（仍是 intent / outcome / reconciliation 三种记录，无迁移）。
- 不加 Web UI 的 effects 面板（本次只保证不会无故锁死；真未知仍有 HTTP 端点可用）。
- 不改 `packages/core`。

## 5. Blast Radius

`packages/runtime/src/executor/EffectJournal.ts`（分类函数 + 阻断消息）、
`packages/runtime/src/executor/Executor.ts`（抛异常路径打标记）、
两个既有测试的期望口径、`docs/POLICY-SPEC.md`（unknown 的定义）。

## 6. Result

已实现并验证。核心改动是把判定从「有没有 error」换成「执行是否跑完」：

- `EffectJournal.outcomeUnknown(result)`：`meta.dispatchThrew`、`TIMEOUT`、`UNKNOWN`、`detail.timedOut`、
  `detail.killed` 才算未知；其余（含拒绝与带退出码的失败）都是 `observed`。
- `Executor` 的 catch 分支给合成结果打 `meta.dispatchThrew: true`——工具抛异常与工具返回失败因此可区分。
- 阻断消息改为 ``OUTCOME_UNKNOWN: ... (key#attempt(effects); journal <path>)``。

测试口径变更（**不是为了让测试变绿**，是契约本身改了）：`fault-injection-gate.test.ts` 原来的
boundary 3b 断言「工具报错 → 未结算」，现改为 boundary 3b（抛异常 → 未结算）、
3c（返回的失败/拒绝 → 已结算，可继续写）、3d（超时/被杀 → 未结算）；
`EffectJournal.test.ts` 里同口径的用例补上 `dispatchThrew`。既有的崩溃四点、
重放禁止、只读重试、reconcile 幂等用例全部保持原状。

真实模型验证（`deepseek/deepseek-v4.1-flash`，`danger-full-access`，未准备的工作区）：

| 轮次 | 工具 | 结果 |
|---|---|---|
| 1 | Shell `echo hi` | `DENIED`，模型读出提示并引用 `scripts/provision-sandbox.ps1` |
| 2 | Write `notes.txt` | 成功，`notes.txt` 实际落盘（18 字节） |

journal 两条 intent 都已结算为 `observed`，`GET /api/sessions/:id/effects` 返回 `{"pending":[]}`。

定向门禁：`packages/runtime` + `packages/application` + `apps/local-server` 71 文件 / 657 通过 + 3 跳过；
合并 279 后全量 `test:all` 根 304 文件 / 3197 通过 + 6 跳过、web 57 文件 / 488 通过。

### 仍未闭环（如实记录）

真未知（崩溃/被杀）依旧要求人工 reconcile；消费面已由卡 279 补上 CLI
（`vessel effects list` / `vessel effects resolve`），Web UI 仍无入口。
