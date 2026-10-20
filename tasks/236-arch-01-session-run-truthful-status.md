# 任务卡 236 — 会话与 Run 状态真实性投影及 Activity 可信呈现 (ARCH-01 & UI-02)

- Status: 已完成（2026-10-20，本地测试通过，双Root及类型门禁全绿）
- Mode: standard
- Source: human-requested & docs/plans/VESSEL_Architecture_Review_and_Execution_2026-10-20.md (ARCH-01 & UI-02)
- Risk: medium

---

## 1. 目标与背景 (Goal & Context)

在架构审查与 UI 审查中（白皮书 A-01 / UI-F02）：
- **致命缺陷**：`apps/local-server/src/routes/activityRoutes.ts` 约 108 行：
  ```ts
  const status: ActivityStatus = approval ? 'needs_attention' : live?.turnActive ? 'running' : 'completed';
  ```
  该逻辑将所有没有活跃 Turn 的非活动会话一律粗暴默认标记为 `completed`！即使该会话在执行过程中因报错失败、崩溃中断、取消、或从未执行任何有效 Turn，也在前端被粉饰为“已完成”，严重违背了“让异常充分可观察、真实反映系统状态”的工程底线。
- **目标**：
  1. 建立具有权威事件追溯的 Run 状态映射：支持 `queued | running | waiting_approval | completed | failed | interrupted | cancelled | unknown`；
  2. 消除“静止即成功”的假象：只有观测到权威成功终态事件/回执时才标记为 `completed`；若中断或无确切成功证据，标为 `unknown`；有报错标为 `failed`；
  3. 前端 `ActivityQueue.tsx` 与工作台状态视图依据真实投影展示，将“待审批 → 失败/未知 → 正在运行 → 已完成”分层呈现。

---

## 2. 不做的事 (Not Doing)

- 不重写底层的持久化数据库或 SessionRegistry 存储引擎；
- 不强制更改已有存量历史会话的不可变事件记录；
- 不在 `packages/core` 中增加任何机制代码（薄核纪律）。

---

## 3. 详细实现规划 (Implementation Details)

### 后端与协议层 (`apps/local-server/src/routes/activityRoutes.ts`)
1. 增强 `ActivitySessionSource` 与 `ActivityLiveState`：
   - 注入 session 的最后执行事件/状态信息（如 `lastRunStatus?: 'completed' | 'failed' | 'cancelled' | 'interrupted'`，`recordCount?: number`）；
   - 从 `SessionController` / `sessionRegistry` / 事件回放中提取最后一次 Turn 的权威状态；
2. 重构 `ActivityRoutes.list()` 状态判定逻辑：
   - 若有待处理审批，优先级最高，标为 `needs_attention`；
   - 若当前 `turnActive` 为 true，标为 `running`；
   - 若最近一次 Turn 报错或存在 failure 事件，标为 `failed`；
   - 若从未执行任何 Turn（如刚创建但未发送任何消息的空会话），标为 `queued` 或 `unknown`，绝不直接标为 `completed`；
   - 只有显式存在正常完成的 Turn 记录且无未决错误时，才标为 `completed`；
   - 无法确认结果的异常情况标为 `unknown`；
3. 更新 `STATUS_ORDER` 排序：
   - 优先级：`needs_attention` (0) → `failed` (1) → `running` (2) → `unknown` (3) → `completed` (4)。

### 前端与组件层 (`apps/web/src/components/activity/ActivityQueue.tsx` & `workbench.ts`)
1. 扩展 `ActivityStatus` 类型声明以兼容 `unknown` / `queued` / `interrupted` / `cancelled`，确保旧枚举平滑过渡；
2. 增加对应的状态徽章样式（如 `unknown` 显示中性灰色，`failed` 显示警示红，`needs_attention` 显示高亮琥珀色）；
3. 状态排序与分组：优先浮现需要介入的事项，已完成项沉底或默认折叠。

---

## 4. 验收标准 (Acceptance Criteria)

- [x] **AC1 状态真实性**：没有运行记录的空会话、执行报错中断的会话不会被返回为 `completed`；
- [x] **AC2 失败显式可见**：失败的 Run 在 ActivityQueue 中醒目呈现为 `failed` 并展示相关错误摘要；
- [x] **AC3 排序科学**：待处理审批与失败项排在列表最前，已完成项排在最后；
- [x] **AC4 单元测试通过**：为 `activityRoutes.test.ts` 补充 8 类终态与边界条件的测试用例；
- [x] **AC5 全量门禁**：`npm run test:all` 双 Root 全绿，`tsc -b` exit 0，`packages/core` 0 改动。
