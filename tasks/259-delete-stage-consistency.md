# 任务卡 259: 删除的跨阶段一致性（ARCH-02 / UI-01 的 P0）

**状态**: 已验收（2026-10-26 对账；协调者独立复核段在卡内，真机删除由第一波补证，依据见 [卡 340](340-board-backlog-closeout.md)）
**创建时间**: 2026-10-22
**执行者**: Codex (`gpt-6.1-sol`, medium)
**协调者**: OpenCode

---

## 1. Goal (目标)

按执行契约 `tasks/prompts/codex-task-259-delete-consistency.md`：会话删除采用「等待 writer 落定 → 索引移除（内存 + 持久化）→ 回收目录 → 关闭/移除 controller」。破坏性回收前先验证索引可持久化；回收失败恢复原始 SessionMeta；补偿失败明确诊断，不误报成单纯回收失败。

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
2. 选择 index-first + 补偿回滚：索引移除失败则不回收，恢复内存、Topic、journal 与兼容 JSON；回收失败恢复原始元数据。补偿也失败时返回 `session_index_stale` + id + stage，明确索引需要修复，不能保证重启后仍可见；当前进程保留元数据以便重试。
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

### 一致性与接口

- 采用 index-first + 补偿回滚，避免回收成功后还有可导致失败响应的持久化步骤。`remove()` 的唯一生产调用方是本次 DELETE 路径，已同步调整。
- `sessions.metadata.jsonl` 是权威事实，`sessions.json` 为兼容视图。索引失败时强制追加原始元数据（即使 tombstone 已写但 fsync 抛错、缓存尚未更新），再恢复快照；补偿失败保留内存/Topic，并返回 stale 诊断。
- 回收成功后 controller.close 失败仍返回 200，附 `warning: session_controller_close_failed, stage: controller`，前端显示双语警告；不把已删除项保留成可重试失败。
- 原 pending-recycle 测试改名为 `waits for recycling before acknowledging deletion, after durably removing the session index`：继续断言等待回收、拒绝并发删除/写入；按新契约断言回收期间索引已持久移除。
- 前端以 ID 保存双语错误键；仅移除成功项，失败行展示 ID、原因与重试按钮。重试只传该失败 ID；in-flight Set 阻止重复发送。删除失败不再误报整体服务断连。
- 无新依赖；packages/core、删除入口与确认交互、回收站实现均未改。未 commit/push/切分支，未运行 test:all；未修改 .pdw 配置或调用外部 Agent。此为执行契约的实现交证，未自行标记 PDW accepted_local。

### 门禁（最后一次产品/测试编辑之后）

| 命令 | 实测结果 | 原始日志 |
|---|---|---|
| `npx tsc -b tsconfig.json` | exit 0 | [tsc](../evidence/sessions/2026-10-22-task259-tsc.log) |
| `npm run typecheck:tests` | exit 0 | [test types](../evidence/sessions/2026-10-22-task259-test-types.log) |
| `npm run -w @vessel/web typecheck` | exit 0 | [Web types](../evidence/sessions/2026-10-22-task259-web-types.log) |
| `npx vitest run apps/local-server` | exit 0；21 文件 / 219 passed | [server](../evidence/sessions/2026-10-22-task259-server.log) |
| `npm run test:web` | exit 0；52 文件 / 432 passed | [Web](../evidence/sessions/2026-10-22-task259-web.log) |

额外验证：SessionRegistry + SessionIndexIntegration **2 文件 / 24 passed，exit 0**（[日志](../evidence/sessions/2026-10-22-task259-registry.log)）；Web `build -- --emptyOutDir false` **exit 0**（[日志](../evidence/sessions/2026-10-22-task259-web-build.log)，保留既有 chunk-size warning）。`git diff --check` exit 0。

新增断言覆盖：实际快照 rename 失败、journal tombstone 写入后 fsync 失败、补偿快照也失败、HTTP 索引失败不回收/不关闭且可重试、回收失败且持久恢复、回滚失败且诊断 stale/保留内存/重试成功、controller 关闭失败仍确认已删除。

UI 组件用例 `apps/web/src/App.deletion.test.tsx`：

- `removes two successes, shows the failed item reason and retries only that item`：a/b/c 同批，a/c 移除，b 保留并显示具体回收失败原因；点击真实 Sidebar 重试回调，调用序列严格为 a,b,c,b，最终列表与错误均清空。
- `retains per-item index and stale-index reasons and suppresses duplicate in-flight deletes`：分别保存 b/c 的索引失败与 stale 原因，进行中重复点击不重复发请求。
- api.test.ts 另覆盖错误 body 保留与六种原因的中英映射。

### 真实 HTTP 失败响应

独立夹具使用构建后的真实 HTTP DELETE handler，临时注册表；注入一次索引失败，回收失败由原有回收 guard 拒绝测试 junction 触发；stale 分支额外注入 restore persist 失败。**未执行 OS 回收或永久删除**。端口先检查为空再绑定 **3001**。可重跑：`node evidence/sessions/task259-browser-fixture.mjs --probe`（先检查端口）。[完整响应及重启可见性](../evidence/sessions/2026-10-22-task259-responses.json)，[成功复跑日志](../evidence/sessions/2026-10-22-task259-response-probe-rerun.log)，exit 0。

```json
{"error":"session_index_failed","id":"task259-b","stage":"index"}
{"error":"session_recycle_failed","id":"task259-recycle","stage":"recycle"}
{"error":"session_index_stale","id":"task259-stale","stage":"rollback"}
```

三者均 HTTP 500。前两者内存及新 registry 实例均可见；第三者内存可见但新实例不可见，这是明确诊断的索引修复状态，不是已恢复的成功承诺。测试证明在同一进程解除故障后可重试完成。进程崩溃时发生在“索引已移除、回收尚未完成”的孤立目录恢复不在本卡事务保证内，未引入新的持久事务框架。

### 边界与交接

- 浏览器**未实测**：CUA 创建 IAB 返回 `Browser is not available: iab`，随后 inventory 为 `apps: [], browsers: []`。仅完成组件/HTTP 证据，不把它们当浏览器验收。可运行上面的 fixture（不带 --probe）并在真实浏览器确认三条同 Topic → 删除确认 → 仅 b 保留与具体原因 → 重试 b → 刷新无会话。此模式不创建 session 目录，覆盖 UI 与索引 handler，不覆盖真实回收站。
- 第一轮 focused 测试发现夹具断言误写 `.vessel`（实际 `.harness`），已修正；Web focused 的 node 测试需要 theme 副作用桩，已补；对应早期失败日志保留。最终 server/Web/registry 门禁均绿。
- HTTP probe 首轮已保存响应，但 `process.exit(0)` 触发 Windows libuv teardown assertion；去掉强制退出后自然退出，复跑 exit 0，原失败日志保留。
- 本次夹具状态均在脚本自行创建的系统临时目录；未清理，未接触用户会话或真实供应商。停止了本次 fixture 服务，交付时不保留监听进程。
- 源码回退范围为本卡 git diff 中的 local-server 删除路径、SessionRegistry、Web 删除状态/API/双语/Sidebar 及相关测试；未覆盖初始未跟踪的执行 prompt 与 codex 日志。

### 协调者独立复核（2026-10-22）

- 独立探针（不走执行者的用例）：对 `SessionRegistry` 注入 `persist` 失败后调用 `remove()`，结果为 `threw: true`、内存元数据原样保留、新建 registry 从磁盘读出的元数据逐字一致。即「索引失败 = 什么都没发生」成立。
- 代码核对：删除顺序为 索引移除 → 回收目录 → 关闭 controller；`remove()` 在 persist 失败时用 `restore(previous)` 补偿内存与 topic 索引；回收失败复用同一 `restore()`；回滚再失败抛 `AggregateError` 映射为 `session_index_stale`；controller 关闭失败只降级为 200 + warning。
- 门禁由协调者重跑：`tsc -b` 0、`typecheck:tests` 0、`@vessel/web typecheck` 0、`apps/local-server` 21 文件 / 219 项、`test:web` 52 文件 / 432 项、`test:all` 根 291 文件 / 3112 通过 + 6 跳过、web 52 文件 / 432 通过。
- `packages/core` 未改动（`git diff --stat -- packages/core` 为空）；`packages/application/src/session` 4 文件 / 34 项通过。
- 未覆盖项沿用执行者口径、不额外承诺：真实浏览器交互、真实 OS 回收站、进程崩溃导致的孤立目录恢复。
