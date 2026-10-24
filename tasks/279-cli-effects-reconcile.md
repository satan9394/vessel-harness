# 任务卡 279: 给「未知副作用」一条 CLI 出路

**状态**: 已实现，定向测试 + 真实 CLI 进程验证通过；全量门禁由协调者跑
**创建时间**: 2026-10-23
**执行者**: OpenCode（协调者自己实现，未派单）
**协调者**: OpenCode

---

## 1. 背景

卡 278 把「工具失败」与「执行是否跑完」分开之后，日常失败不再锁死会话。但**真未知**
（进程被杀、工具抛异常）仍然会阻断该会话的后续写入——这是有意的 fail-closed 设计。

问题是消费面只有一条：`GET/POST /api/sessions/:id/effects`。Web UI 没有入口，CLI 没有命令，
所以只用 CLI 的人遇到之后**没有任何出路**：既看不到 pending，也没法写回执。

## 2. Goal

给人一条不需要起服务、不需要手写 curl 的解除路径，且必须与 HTTP 路径写同样的审计记录。

## 3. Acceptance Criteria

1. `vessel effects list [--session <id>]`：列出工作区内仍有未结算 intent 的会话及其 `key#attempt`。
2. `vessel effects resolve --session <id> --key <k> --attempt <n> --applied|--not-applied --evidence "<说明>"`：
   写入回执、解除阻断，并在 `session.jsonl` 落下与控制器同形的 `audit/effect_reconciled`。
3. 缺参、同时给 `--applied` 与 `--not-applied`、未知 key → 明确退出码（2 / 1），且**不改动 journal**。
4. 会话被其他进程持有时拒绝动手（单写者租约），并提示改用 HTTP 端点。
5. 旧调用仍不可重放（`Invocation already observed; replay prohibited`）。
6. `--json` 与既有命令一致。

## 4. Not Doing

- 不加 Web UI 的 effects 面板（浏览器验收成本另算；CLI 已覆盖「无出路」）。
- 不自动对账、不提供 `--force` 跳过证据。
- 不把 reconcile 暴露成模型工具（那是审批捷径）。
- 不改 `packages/core`。

## 5. Blast Radius

`packages/application/src/session/effectsRecovery.ts`（新增，领域逻辑）与其测试、
`packages/application/src/index.ts`（导出）、`apps/cli/src/commands/effectsCommand.ts`（新增，参数与呈现）、
`apps/cli/src/cli.ts`（分派 + USAGE）、`apps/cli/src/cli.effects.test.ts`（新增）。

## 6. Result

已实现并验证。

`effectsRecovery.ts` 只有三件事：读 journal 汇总 pending、按 `key#attempt` 找到目标 intent、
写回执并追加 `audit/effect_reconciled`。它刻意**不**经过 `SessionController`——控制器要供应商、
模型与策略工件，而 CLI 场景只需要 journal 与 session log。这三行逻辑与控制器重复是有意的，
文件头注释写明了「改控制器时必须同步这里」。

CLI 侧只做参数校验与呈现：`list` 打印 `会话 → key#attempt effects tool`；`resolve` 打印结果，
被租约挡住时提示「停掉占用进程，或在服务运行时用 HTTP 端点」。

真实 CLI 进程验证（`apps/cli/dist` 构建后直接跑，不是跑源码）：

```
$ vessel effects list --workspace <ws>
sess_real
  call_real#1  non_idempotent  builtin:Write

$ vessel effects resolve --workspace <ws> --session sess_real --key call_real --attempt 1 --not-applied --evidence "inspected temp fixture"
Resolved builtin:Write call_real#1 as not_applied.
No pending effects remain in this session; writes are unblocked.

$ vessel effects list --workspace <ws>
No pending effects in <ws>.
```

落盘记录（与 HTTP 路径同形）：

```json
{"type":"audit/effect_reconciled","surface":false,"key":"call_real","attempt":1,
 "invocationHash":"f476c161...","resolution":"not_applied","seq":1,"ts":"..."}
```

定向门禁：`apps/cli/src/cli.effects.test.ts` 3 项 + `effectsRecovery.test.ts` 4 项全绿。
测试夹具直接写 journal 原始行（崩溃现场就是那一行），因此 CLI 测试不引入 `@vessel/core` /
`@vessel/runtime` 这两个本包并未依赖的包。

一个自查出来的缺陷：`Session.open` 对未知 id 会顺手建目录，于是打错 session id 会留下一个空会话。
现在先查 journal 是否存在再开——没有 journal 就等于没有待解副作用，直接报 `no pending effect`，
并有 `refuses an unknown session id without creating a phantom session directory` 固化。

### 已知边界

CI/无服务场景可用；服务正在持有该会话时只能走 HTTP（这是单写者租约的正确表现，不是缺陷）。
