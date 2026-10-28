# 任务卡 357: `GET /api/trash` 只读列表

- Status: 已验收（2026-10-27 验收：Codex 实现 + 独立复核 PASS，协调者复跑 local-server 26 文件 / 312 passed、两处 tsc exit 0，全量门禁 17 步全绿）
- PDW task: none（交接单 `tasks/prompts/codex-handoff-2026-10-27-wave2.md` 的 T13，`gpt-6.1-terra`/medium）
- 前置：卡 345c（服务端删除改道）必须先完成——同一文件 `server.ts`，同一时刻只有一个写者

## 1. Goal

卡 345 §2 第 4 条要求「HTTP 只读：`GET /api/trash`（同源、不含凭据、不带删除动作）」，但目前**不存在**：
`apps/local-server/src` 全目录搜 `api/trash` / `trashStore` 零命中。补一个纯读端点，让 Web 以后能在不碰删除逻辑的前提下看暂存区。

## 2. 要做的事

1. 新增 `GET /api/trash`：返回 `trashStore.list({ root })` 的白名单 DTO——
   `entries: [{ id, origin, kind, reason, deletedAt, expiresAt, sizeBytes }]` 与 `skipped: [{ id, reason }]`。
2. 根规则与 345c 一致：`(VesselServerOptions.workspace ?? process.cwd())/.harness/trash`；根不存在返回空列表（200，不 404）。
3. 同源校验与其它读端点一致；只接受 `GET`，`POST/DELETE` 返回 405 或沿用现有未知方法行为（二者选一，写进报告）。
4. 绝不返回文件内容、凭据、绝对路径以外的敏感字段；不触发 purge、不写盘。
5. 测试 ≥3 条：空根返回空列表、有条目时 DTO 字段齐全且不含内容、跨源请求被拒（403）。

## 3. Not Doing

- 不做 Web UI、不加删除/恢复端点（restore/purge 已有 CLI）。
- 不改 `DELETE /api/sessions/:id`（345c 负责）。
- 不在服务端做 TTL 计算以外的判定，不返回 trash 根之外的条目。

## 4. Acceptance

1. `GET /api/trash` 返回可解析 JSON，字段与 §2 一致；空根时 `entries: []`。
2. 同源门禁生效：带外源 Origin 的请求被拒；纯读，服务端零写入。
3. 测试 3 条全绿，`apps/local-server` 全段绿，两处 tsc 干净。
4. 文档同步：`docs/DELETION-AND-RETENTION.md` 写明该端点已实现、只读、字段白名单。

## 5. Blast Radius

`apps/local-server/src/server.ts`（新增读端点）、`apps/local-server/src/server.test.ts`、
`docs/DELETION-AND-RETENTION.md`。无依赖变化、无 Web 改动。

## 6. Expected Evidence

端点命令与响应样例（脱敏）、三条测试的计数、`local-server` 段 exit、两处 tsc exit。

## 7. Result

- T13 定向自验与独立只读复核 PASS（2026-10-27）；仅填本 Result，保留卡面/索引。实现 `gpt-6.1-terra` / `medium`，独立复核 `gpt-6.1-terra` / `low`（交接单：单只读端点与 DTO 白名单）；Codex 应用辅助模式，无 Fast/Ultra，同一文件无并发写者。
- 修改 `apps/local-server/src/server.ts`、`server.test.ts`、`docs/DELETION-AND-RETENTION.md`：GET 根为 `(workspace ?? process.cwd())/.harness/trash`；同源门禁，空根 200；entries 严格投影 7 个字段，skipped 只投影 id 与固定 `invalid_entry`，避免损坏 JSON 的解析错误泄露文件片段。POST/DELETE 沿用 404 `{"error":"not_found"}`；跨源 GET 为 403 `{"error":"cross_origin_denied"}`。
- 新增 3 条测试：缺根返回空且不创建根；真实到期条目与损坏元数据只返回 DTO、内容字节不变且不 purge；跨源拒绝及 POST/DELETE 无写动作。夹具使用 mkdtemp 工作区与用户根，未加 sleep、未削弱断言。协调者在内存中移除新端点 10 行后，重建的 server.ts SHA-256 与 T6 修复前后冻结值 `1ed7e0eee0b586d0c52c629a407a6a5c656a29d95795329546a255d1ffad04d4` 完全一致，确认 T6 删除/启动语义未变。

| 最后源码编辑后的自验命令 | exit | 结果 |
|---|---:|---|
| `node node_modules/vitest/vitest.mjs run apps/local-server` | 0 | 26 文件 / 306 passed（128.76s） |
| `node node_modules/typescript/bin/tsc -b tsconfig.json` | 0 | 无诊断 |
| `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` | 0 | 无诊断 |

- Vitest 外层进程仅设 `VESSEL_TRASH_TTL_DAYS=0`，保护其它既有夹具的 cwd；专用启动清理测试显式设 7/0 并使用临时根，真实 purge 覆盖保留。独立复核核对源码、原始日志、退出码及当前 SHA-256 后 PASS。
- 协调者额外实际 HTTP 验证（tsc 构建后运行 `node C:/work/AppData/Local/Temp/vessel-wave-a-KgYB0Y/T13-http-proof.mjs`）：exit 0；临时工作区空根 GET → 200 `{"entries":[],"skipped":[]}`，真实条目 GET → 200 与预期 7 字段逐字相等；跨源 403；POST/DELETE 各 404；payload 仍存在、无 purge 审计文件。完整响应与夹具路径存 `T13-http-proof.json`。
- 日志与哈希：`C:/work/AppData/Local/Temp/vessel-wave-a-KgYB0Y/T13-result.json`、`T13-vitest.log`、`T13-tsc-build.log`、`T13-tsc-tests.log`。SHA-256：server.ts = `089b5c599606d0db5754eae1267f9d111179cb3810ec3d594eb30a5bd87a1f36`；server.test.ts = `5f6d96725f80dca07af3c6b4253a25eca0e79d48ce77e224de58c21e92b89410`；删除文档 = `a5c44b523ee219eebcaefa16039408f8e512e64c6db95118386b0f1a6e55663e`。
- 未做：Web UI、恢复/删除 HTTP、全量门禁、commit/push/分支或范围外修改。被拒命令：无。补充 HTTP 探针首轮在创建夹具前 exit 1：`ERR_PACKAGE_PATH_NOT_EXPORTED: No "exports" main defined in .../@vessel/application/package.json`（使用 CommonJS resolve 解析 import-only 导出）；只修临时验证脚本读取 manifest 的 `exports.import`，随后实际 HTTP 验证通过，未改产品或验收判据。

#### 协调者验收（2026-10-27，独立复跑）

- 代码复核：路由挂在 `handleApi` 顶部 `segs.length === 2 && segs[1] === 'trash' && method === 'GET'`，与其它 `/api/*` 的 `segments()` 口径一致；先做同源校验再读盘，空根走 `trashStore.list` 返回空数组（不创建根）。`skipped` 一律投影成 `{ id, reason: 'invalid_entry' }`——比契约要求的「不泄露内容」更严，直接把解析器原文挡掉。
- 我自己的复跑：`vitest run apps/local-server` exit 0、26 文件 / **312 passed**（含 T13 3 条 + T14 6 条）；两处 tsc exit 0；全量门禁 17 步全绿（`local-server` 段 312、其余同上轮）。
- 与 T6 的边界核对：Codex 用「内存里移除本卡新增 10 行 → 重建哈希等于 T6 冻结值」证明没有改动删除/启动语义，这个手法可复现，我接受其结论；`server.ts` 当前哈希 `089b5c59…1f36` 与卡内一致。
- 边界（不宣称）：daemon 常驻模式没有 `workspace` 选项，`GET /api/trash` 在 daemon 里同样取启动 cwd 的 `.harness/trash`；这与 T14 的清理根口径一致，属已知边界，已在 `docs/DELETION-AND-RETENTION.md` 写明。Web UI 未接（本卡不做）。
