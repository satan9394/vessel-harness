# 任务卡 259: 删除的跨阶段一致性（ARCH-02 / UI-01 的 P0）

**状态**: 待执行（卡 258 完成后派发）
**创建时间**: 2026-10-22
**执行者**: Codex (`gpt-6.1-sol`, medium)
**协调者**: OpenCode

---

## 1. Goal (目标)

会话删除在「回收站成功 → 内存移除 → 注册表持久化」这三步之间不能出现**会误报成功的中间态**，也不能出现**已回收却报告失败、重试已无对象**的裂缝。

审计给出的定位（`evidence/sessions/2026-10-22-doc-conformance-report.md` ARCH-02 / UI-01）：

- `apps/local-server/src/server.ts:809–814`：先关闭/移除 controller，再调用 `registry.remove()`。
- `packages/application/src/session/SessionRegistry.ts:414–418`：`remove()` 先删内存再 persist；持久化失败无法回滚已回收的目录。
- `apps/web/src/App.tsx:107`：客户端只收集 `successfulIds`；失败仅显示整体连接错误。
- `apps/web/src/api.ts:425`：删除接口的错误面。

缺口：回收成功后若注册表持久化失败，磁盘/内存/注册表三层口径不一致，且对外仍只有一个 `recycle_failed` 检测点；UI 只给整体成败，没有逐项失败原因与仅重试失败项。

## 2. Not Doing (非目标)

- 不改删除的用户入口与确认交互（不加二次弹窗、不改文案结构）。
- 不改回收站实现（仍必须走 `SendToRecycleBin`），不做永久删除。
- 不引入分布式事务或新的持久化框架。
- 不 commit、不 push、不删除文件。

## 3. Acceptance Criteria (验收标准)

1. 定义一个明确的阶段结果：回收失败、index 持久化失败、控制器关闭失败各自可区分，且对外错误码/字段能让前端分辨「该项失败原因」。
2. 持久化失败时，三层口径要么一致回滚（该项仍可见、可重试），要么明确收敛为「已回收但索引未更新」并在下一次读取时自愈；二者择一并在卡内写清选择了哪个、为什么。
3. 批量删除：成功项从列表移除，失败项保留并显示**逐项**原因；重试只针对失败项。
4. 新增测试覆盖：回收成功 + persist 失败、控制器关闭失败、批量部分失败、失败后重试成功。
5. 门禁：`npx tsc -b`、`npm run typecheck:tests`、`npm run -w @vessel/web typecheck`、`npx vitest run apps/local-server`、`npm run test:web` 全绿。

## 4. Blast Radius (影响面)

- `apps/local-server/src/server.ts`（删除路径）
- `packages/application/src/session/SessionRegistry.ts`
- `apps/web/src/App.tsx`、`apps/web/src/api.ts`、`apps/web/src/components/Sidebar.tsx`
- 相关测试

## 5. Expected Evidence

- 三个阶段各自失败时的实际返回（贴响应体）。
- 批量部分失败的 UI 行为说明 + 组件测试名。
- 五条门禁的命令 + 退出码 + 测试计数。
- 明确写出第 2 条选择了哪种一致性策略及理由。

## 6. Result

待执行。
