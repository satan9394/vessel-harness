# Task 254: Browser Audit Findings Remediation — History Hydration, Goal Status Truth, and Activity Polish (Fixes BV-01, BV-02, BV-03, BV-04)

状态：待验收（整改已实现，定向门禁通过；真实浏览器复验待环境恢复）
负责人：Codex (`gpt-6.1-sol`, medium reasoning effort)
规划 / 架构监督：Antigravity
前序依赖：[任务卡 253](253-browser-verification.md) 浏览器六场景实测报告揭示的 4 项产品缺陷

## 1. 目标 (Goal)
攻坚修复 Codex 在 25 分钟内置浏览器 37 张截图实测中所抓出的 4 项真实产品缺陷：
1. **BV-01 (P1 核心缺陷) — 页面刷新 (Reload) 导致对话历史消息在界面展示丢失**：
   - 解决历史会话与已完成会话在页面刷新重载后无法从持久化磁盘重构出消息列表的严重体验技术债；
   - 在服务端 `apps/local-server/src/server.ts` 中实现控制器按需自愈重开（当内存无 controller 但 sessionRegistry 有记录时自动从磁盘打开，杜绝 `session_not_found` 404）；
   - 提供会话历史 transcript 接口（如 `GET /api/sessions/:id/messages` 或在 session 详情中附带 `messages`），并在前端 `ConversationView.tsx` 挂载时，若无内存快照则自动从服务端拉取已持久化的历史对话（user/assistant 消息），确保持久化数据在刷新后 100% 正常回显。
2. **BV-02 (P1) — 待处理 Goal (pending) 被误标为 running**：
   - 修复 `apps/local-server/src/routes/activityRoutes.ts:192-195` 中三元表达式将 `pending` 状态的 goal 任务错误归入 `: 'running'` 的假活跃缺陷；
   - 只有 `task.status === 'in-progress'` 才标记为 `running`，`pending` 状态归为真实等待/未知状态，绝不虚假显示正在执行。
3. **BV-03 (P2) — Activity 中点击 Goal 卡片无任何跳转或详情展示**：
   - 优化 `apps/web/src/components/activity/ActivityQueue.tsx`，为非 session 类型的卡片（如 goal）提供清晰的状态展示、目标详情展开或禁用说明，杜绝死链接。
4. **BV-04 (P2) — 刷新按钮文案纠偏**：
   - 修正 Activity 列表顶部刷新按钮误用 `t('modelRetry')` 导致文字显示为“重新加载模型”的文案错误，换用准确的“刷新活动/重试”文案。

## 2. 禁做事项 (Not Doing)
- 严禁修改 `packages/core`（薄核纪律：严格 0 修改）；
- 严禁永久删除任何文件（所有删除走回收站，除临时测试自建目录外）；
- 不引入外部新依赖，不篡改其他无关 UI 布局。

## 3. 验收标准 (Acceptance Criteria)
1. **BV-01 验证**：
   - 在前端创建并完成一条会话对话后，刷新页面（F5），重新点开该会话，之前的用户提问与助手回复必须完整渲染在页面消息列表中，不再显示空对话；
   - 请求历史存档会话（如磁盘已存在的合法会话）时能够自动拉起，不再报 404；
   - 服务端单测与 Web 单测覆盖历史回放与消息拉取。
2. **BV-02 验证**：
   - 当 `goalTasks` 中有 `status === 'pending'` 的条目时，`GET /api/activity` 返回的 `status` 绝不是 `'running'`；单测确认。
3. **BV-03 & BV-04 验证**：
   - Activity 顶部的刷新按钮不再显示“重新加载模型”；
   - Goal 卡片展现清晰信息与合理交互。
4. **门禁指标**：
   - `git diff HEAD --stat -- packages/core` 必须为 0；
   - `npx tsc -b` exit 0；
   - `npm run typecheck:tests` exit 0；
   - `apps/local-server` 测试 100% 通过；
   - `npm run test:web` 全部通过。

## 4. 影响面 (Blast Radius)
- `apps/local-server/src/server.ts`
- `apps/local-server/src/server.test.ts`
- `apps/local-server/src/routes/activityRoutes.ts`
- `apps/local-server/src/routes/activityRoutes.test.ts`
- `apps/web/src/components/ConversationView.tsx`
- `apps/web/src/components/activity/ActivityQueue.tsx`
- `apps/web/src/api.ts`

## 5. 预期证据 (Expected Evidence)
- `evidence/sessions/2026-10-21-codex-task-254.log`
- `evidence/sessions/2026-10-21-codex-task-254-proof.md`

## 6. Result

Implemented BV-01–04 locally. API contract, verification, retained-session replay and acceptance limits are recorded in the [verification proof](../evidence/sessions/2026-10-21-codex-task-254-proof.md). Browser acceptance remains pending; no commit or push.
