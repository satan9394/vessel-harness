# 任务卡 237 — 会话安全删除端到端一致性与真实回执 (ARCH-02 & UI-01)

- Status: 已完成（2026-10-20，本地测试通过，单项回执及状态一致性已闭环）
- Mode: standard
- Source: human-requested & docs/plans/VESSEL_Architecture_Review_and_Execution_2026-10-20.md (ARCH-02 & UI-01)
- Risk: medium

---

## 1. 目标与背景 (Goal & Context)

在架构与 UI 审查中（白皮书 A-02 / UI-F01）：
- **致命缺陷**：`apps/web/src/App.tsx` 约 119–127 行：
  ```ts
  await Promise.all(ids.map(id => api.deleteSession(id).catch(() => {})));
  setSessions((current) => current.filter((item) => !ids.includes(item.id)));
  ```
  该逻辑把所有的子请求错误用 `.catch(() => {})` 直接吞掉，并在前端直接将所有请求的 ID 从会话列表中剔除。
  当网络超时、服务端回收站锁死、权限被拒（403）或服务异常（500）时，前端依然向用户展示“删除成功”，造成“假删除”假象；用户一旦刷新页面，未被删除的会话又重新出现。
- **目标**：
  1. 彻底消除吞掉错误的逻辑，建立端到端的一致性回执；
  2. 只有服务端显式返回 `{ ok: true }` 的 ID 才从前端状态中移除；
  3. 若发生部分或全部失败，保留失败条目并触发真实错误提示，支持幂等重试；
  4. 回收站安全纪律（`recycleDaemonPath`）保持严格执法。

---

## 2. 不做的事 (Not Doing)

- 不执行任何永久摧毁性物理删除（所有物理文件严格走系统回收站）；
- 不改写未受影响的其它 API 契约；
- 不在 `packages/core` 引入任何代码。

---

## 3. 详细实现规划 (Implementation Details)

### 前端状态管理 (`apps/web/src/App.tsx`)
- 重构 `deleteSession(idOrIds)`：
  - 维护 `successfulIds` 与 `failedIds`；
  - 逐项收集 `api.deleteSession(id)` 的执行结果；
  - 仅对 `successfulIds` 执行 `setSessions` 过滤和 `setSelectedSessionId` 重置；
  - 若 `failedIds.length > 0`，保留失败条目并触发 `setServerError(true)` 警告。

### 验收测试
- 编写单测模拟部分删除失败场景（例如传入 3 个 ID，2 个成功，1 个 500 抛错），断言前端仅移除成功项，失败项继续留在列表中。

---

## 4. 验收标准 (Acceptance Criteria)

- [x] **AC1 真实单项过滤**：仅成功返回 `ok: true` 的 ID 被前端状态剔除；
- [x] **AC2 错误不静默**：失败的会话 ID 依然保留在列表中，触发服务端错误提示；
- [x] **AC3 测试全绿**：Web 单测与本地 Server 测试通过；
- [x] **AC4 全量门禁**：`tsc -b`、`typecheck:tests`、Web 打包通过，`packages/core` 0 改动。
