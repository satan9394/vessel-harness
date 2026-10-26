# T335 — 并行道产物与待修项（L3 已修、L4 待修）

- Status: 进行中（2026-10-26）
- 来源：`tasks/332-codex-lanes-plan.md` 的四道并行执行

## 已收（绿）

| 道 | 段 | 结果 | 证据 |
|---|---|---|---|
| L3 | I 往返保真 | **发现并修复真缺陷**：`providerTransfer.ts` 的导入白名单漏了 `modelCapabilities` 与 `catalogEvidence`，往返会静默丢字段；已补两行 allowlist | 新测试 `apps/cli/src/providers/providerRoundTrip.test.ts` 2/2 通过 |
| L4 | N API/CLI 一致性 | **测试按严格口径红**：同一操作 CLI 回 `{"deleted":true}`、HTTP 回 `{"ok":true}`；Terra 未改生产代码，如实报告 | `apps/local-server/src/routes/profileParity.test.ts` 4 用例中 1 红 |

## 待修（L4 的发现）

- **决策**：以 HTTP 为准（`{"ok":true}`），CLI 的 `provider profile delete --json` 对齐；理由：与 `provider rm` 的 `{ok:true}` 风格一致，且 API 是 Web/CLI 的公共面。
- **落点**：`apps/cli/src/providers/profileCommands.ts` 的 `delete` 分支（`emitJson({ deleted })` → `{ ok: true }`），并同步 `profileCommands.test.ts` 与 `cli.test.ts` 里的断言。
- **为什么不在 L4 里顺手改**：`cli.test.ts` 此刻被 L2（G/K 段）持有，同一文件不能两个写者；必须等 L2 收工后再跑一条 L4b。
- **L4b 命令**：`codex exec --sandbox workspace-write -C <repo> -m gpt-6.1-sol -c model_reasoning_effort="medium" "<只改 profileCommands delete 输出与两处断言，跑 profileParity + profileCommands + cli.test>"`

## 其余待收

- L1（E→F→J→Q→L→P）与 L2（G→H→K→M）仍在跑；收工后串行跑 L5（D 文档）。
- 全量门禁只由协调者跑一次：`pwsh -NoProfile -File scripts/gate-batched.ps1`。

## Result

（待 L1/L2/L5 与 L4b 收齐后补）
