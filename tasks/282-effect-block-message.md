# 任务卡 282: 会话被副作用未知挡住时，消息里要给出解除命令

**状态**: 已实现，定向测试通过；全量门禁由协调者跑
**创建时间**: 2026-10-23
**执行者**: OpenCode（协调者自己实现，未派单）
**协调者**: OpenCode

---

## 1. 背景

卡 278/279 之后，真未知副作用不再让会话「静默死掉」：有 journal 记录、有 `vessel effects` 命令。
但**会话里的人看到的仍然是一句技术错误**：

```
[DENIED] Error: OUTCOME_UNKNOWN: pending session effect requires reconciliation before further writes
(key#attempt(effects); journal <path>)
```

卡 276 的实测已经证明这句话的后果：模型重试三次，然后告诉用户「Shell 工具不可用」。
也就是说，即便给了出路，**没人知道那条路叫什么**。

## 2. Goal

挡住写入时，把「谁能解、用什么命令解」直接写进工具结果，而不是只写病历。

## 3. Acceptance Criteria

1. `compose.ts` 的 `beforeDispatch` 捕获 `OUTCOME_UNKNOWN`，在消息末尾追加
   `vessel effects resolve --session <本会话 id> --key <key> --attempt <n> --applied|--not-applied --evidence "..."`。
2. 非 `OUTCOME_UNKNOWN` 的错误原样抛出，不夹带噪音。
3. 该消息出现在 `tool/result`（模型与 UI 都看得到），且写入仍然被拒绝、会话仍处于 blocking。
4. 定向测试覆盖：消息含会话 id 与命令；`x.txt` 未生成；`pendingEffects()` 仍有那条 intent。

## 4. Not Doing

- 不自动 reconcile（未知副作用必须人确认）。
- 不加 Web UI 按钮（提示文本已给出可复制命令；面板另计）。
- 不改 `packages/core`。

## 5. Blast Radius

`packages/application/src/compose.ts`（beforeDispatch 的错误增强）、
`packages/application/src/effectBlockMessage.test.ts`（新增）、`docs/POLICY-SPEC.md`（一句同步）。

## 6. Result

已实现。`beforeDispatch` 现在把 journal 的 `OUTCOME_UNKNOWN` 重新抛出时追加两行：一句说明这是
需要人工确认的副作用，一行可直接复制的命令（带本会话 id）。其他错误原样抛出。

测试 `effectBlockMessage.test.ts` 用真实组合根 + 真实策略 + MockProvider 跑一个回合：
先在会话 journal 里种一条未结算的非幂等 intent，再让模型调用 `Write`。
断言拿到 `DENIED`、消息里同时有 `call_from_crash#1` 与
`vessel effects resolve --session sess_blocked`、`x.txt` 没有被创建、`pendingEffects()` 仍报那条 intent。

门禁：`tsc -b`、`typecheck:tests`、web typecheck、web build 全 exit 0；
`packages/application` 33 文件 / 265 通过 + 2 跳过；全量 `test:all` 根 305 文件 / 3198 通过 + 6 跳过、web 57 文件 / 488 通过。
