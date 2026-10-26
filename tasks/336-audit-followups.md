# T336 — 第二批审计（20261026202307-0d050e）后的修复

- Status: 已完成（2026-10-26；R1/R2/R3 全部落地，17 步门禁全绿）
- 来源：PDW `audit` 任务 `20261026202307-0d050e`（`accepted_local`），复核提交 `d024d44` + `e749a80`。
  A1–A6 全部 pass；本卡处理它挑出的问题。

## 审计结论与处置

| 编号 | 严重度 | 问题 | 处置 |
|---|---|---|---|
| F5 | **high** | 跑 `apps/cli/src/cli.test.ts` 会写真实 `~/.vessel/usage.json`（测试隔离缺口，文件里 3370-3372 已自认） | R2 修：相关 describe 块注入临时 `VESSEL_USAGE_ROOT` 并在 afterEach 还原；验证前后文件元信息不变 |
| F3 | medium | `usage --csv` 校验了 `--since/--until` 却仍导出全量 | R1 修：CSV 按同窗口过滤 |
| F4 | medium | CLI 的按供应商段 / `--json byProvider` 不过窗口，HTTP 过窗口，两侧不一致且未写文档 | R1 修：`byProvider` 支持窗口，CLI 与 HTTP 同口径；文档注明 |
| F7 | medium | HTTP `DELETE /api/providers/:id` 对被 profile 引用的供应商只回 400 `provider_request_failed`，不返回 `provider_in_use` 与引用名 | R1 修：改为 409 `{ error: 'provider_in_use', profiles }` |
| F6 | medium | 卡 325–330/335 首行状态与 Result 未同步 | 协调者已更正（本批提交） |
| F8 | low | 文档未记 `/api/providers/usage` 的 `since/until` 与新字段、未说明 CSV 窗口 | R1 一并补 |
| F1/F2 | blocker(scope) | 审计契约的 `scope` 漏了 `cli.test.ts`、`tasks/README.md`、`HANDOFF.md` | 契约书写问题，非产品缺陷；本卡记录，下个契约扩大 scope |

## 执行

- R1（`gpt-6.1-sol` medium）：UsageStore 窗口参数、CLI CSV/人读/JSON 同窗口、server 409、文档三处。
- R2（`gpt-6.1-terra` medium）：`cli.test.ts` 的 usage 根隔离。
- 两者文件集不重叠（R1 不碰 `cli.test.ts`，R2 不碰生产代码），并行执行。

## 验收

```powershell
pwsh -NoProfile -File scripts/gate-batched.ps1
```

外加人工核对：`~/.vessel/usage.json` 在跑完 `cli.test.ts` 后元信息未变；HTTP 删除被引用 provider 的 409 body。

## Result

最终：scripts/gate-batched.ps1 17 步全 exit 0；根 328 文件 / 3599（6 跳过）、web 58 / 519。

R1/R2 已落地，门禁与复核进行中：

- **F5（high）已修**：`cli.test.ts` 的 `provider export/import + endpoint` 块注入临时 `VESSEL_USAGE_ROOT` 并在 afterEach 还原；跑前/跑后真实 `~/.vessel/usage.json` 的 mtime 与大小一致（20:37:26 / 106263 字节），136 用例 exit 0。
- **F3（CSV 窗口）已修**：`UsageStore.byModel()` 与 `byProvider()` 都支持 `{since,until}`，按条目 `lastTs` 本地日过滤（含首含尾，边界可单用）；未传窗口时输出逐字不变；CSV 走同一窗口。
- **F4（CLI/HTTP 窗口口径）**：CLI 侧已是条目级窗口；HTTP 侧原本按供应商汇总行过滤，混合模型时不一致 —— 正由 R3 把注入契约改成 `usageByProvider(window)`，让两侧完全同口径。
- **F7（HTTP 删除错误码）已修**：`DELETE /api/providers/:id` 被引用时返回 409 `{error:'provider_in_use', profiles}`；引用名解析失败回落 400 `provider_in_use`；供应商与 profile 均保留。
- **F8（文档）已补**：§3.6 加 HTTP 409；§3.7 写明 CSV 支持窗口；§11 记录 `/usage` 的 `since/until` 与 `lastTs`/`models`/`inputTokenSemantics`。
- **F6（卡状态）**：325–330/335 状态与 Result 已更正；R1 自建的 337 已标记「并入本卡」，保留为执行证据。

R2 的证据（隔离自证）：

```
BEFORE: exists; mtimeUtc=2026-10-26T20:37:26.5328984Z; size=106263
AFTER : exists; mtimeUtc=2026-10-26T20:37:26.5328984Z; size=106263
TEST_EXIT: 0   METADATA_MATCH: True
```

