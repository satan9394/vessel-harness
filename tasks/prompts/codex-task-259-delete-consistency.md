# Codex 执行契约：卡 259 删除的跨阶段一致性

仓库 `E:\Code_file\Projects\Vessel_Harness`（Windows，npm workspaces，TypeScript，Vitest）。
分支 `main`。**不要 commit、不要 push、不要切分支。**

## 先读

1. `tasks/259-delete-stage-consistency.md` —— 唯一权威范围与验收。
2. `evidence/sessions/2026-10-22-doc-conformance-report.md` 的 `### [ARCH-02]`、`### [UI-01]`、`## 必须修的 P0` 第 2 条。
3. 现状代码：`apps/local-server/src/server.ts` 的 `DELETE /api/sessions/:id`（约 789–818 行）、
   `packages/application/src/session/SessionRegistry.ts` 的 `remove()`（约 404–410 行）、
   `apps/web/src/App.tsx` 批量删除收集 `successfulIds` 的部分、`apps/web/src/api.ts` 删除接口。

## 现状问题（已核实，不要重新论证）

删除路径当前顺序是：中断并等 writer 落定 → **回收目录** → 关闭 controller → 从 `controllers` 删除 → `sessionRegistry.remove(id)`。

`SessionRegistry.remove()` 是「先 `sessions.delete(id)` 再 `persist()`」。于是存在两个裂缝：

1. persist 抛错时内存已经删了，磁盘索引还在 → 同进程内该会话消失，重启后又出现。
2. 此时目录**已经被回收**，而服务端返回 `500 session_recycle_failed` —— 错误码说的是回收失败，实际回收成功、失败的是索引。用户重试时对象已不存在。

## 必须达到的语义

**原则：破坏性操作最后做，可回滚的先做，失败原因必须可分辨。**

要求（这是验收口径，不是建议）：

1. 先做**索引移除**（内存 + 持久化）。若这一步失败：什么都没被销毁，返回明确的 `session_index_failed`，会话仍完整可见、可重试。
2. 索引移除成功后再**回收目录**。若回收失败：把索引**回滚**回原状（用先前取到的 `SessionMeta` 恢复），返回 `session_recycle_failed`，会话仍可见、可重试。
3. 回滚本身再失败时，不许假装干净：返回可诊断的 `session_index_stale`（或等价），并在响应体里带上 id 与阶段，允许前端明确告知「已失败且索引需修复」。
4. 回收成功后关闭 controller、从 `controllers` 移除；这一步失败不得把已完成的回收报成失败（保持现在这条口径）。
5. 批量删除：成功项移除、失败项保留并**逐项**显示原因；重试只针对失败项，不得重发已成功项。
6. 端到端不能出现「界面说删了、刷新后又回来」或「界面说失败、对象已没了」这两种状态。

第 1、2 步的顺序可以调整，但**必须满足**：破坏性的目录回收发生在索引可回滚之后，且任何失败都有可分辨的错误码。若你认为有更稳的顺序，在最终回复里说明理由并给出对应测试。

## 现有测试（不要改坏）

`apps/local-server/src/server.test.ts` 里已有：
- `waits for recycling before acknowledging deletion or removing the session index`
- `reports recycling failure and retains the session for a successful retry`
- `settles the interrupted writer before recycling a session`

## 硬约束

- 不改回收站实现，不做永久删除，不引入新依赖。
- 不动 `packages/core`；不改删除的用户入口与确认交互。
- 新错误码要在 `apps/web/src/api.ts` 与 UI 侧有对应文案（中英双语），不要只加一个裸字符串。
- 不跑 `npm run test:all`（约 8 分钟，协调者跑）。

## 必须交付

1. 代码 + 测试：覆盖「索引移除失败」「回收失败并回滚」「回滚也失败」「批量部分失败」「失败后重试成功」。
2. 门禁逐条跑并记录退出码与计数：
   - `npx tsc -b tsconfig.json`
   - `npm run typecheck:tests`
   - `npm run -w @vessel/web typecheck`
   - `npx vitest run apps/local-server`
   - `npm run test:web`
3. 最终回复给出：三个失败阶段的真实响应体（贴 JSON）、批量部分失败的 UI 行为与组件测试名、五条门禁结果、以及你最终采用的顺序与理由。

## 完成判据

卡 259 的 5 条验收全部成立且五条门禁全绿。做不到就如实说明卡在哪，不要宣布完成。
