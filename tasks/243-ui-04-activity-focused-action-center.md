# 任务卡 243 [UI-04]: Activity 专职行动中心与路由归位

> 状态：已完成 (DONE)  
> 归属：Phase 2 配置中心分层与单一事实源（UI-04 / P1）  
> 对应规划：`docs/plans/VESSEL_UI_UX_Review_and_Execution_2026-10-20.md` §3 UI-04  

## 1. 目标 (Goal)
- 彻底解决 Activity 页面被普通历史会话列表淹没以及跨类型 ID 混淆的严重痛点：
  1. **移除 Activity 页面中重复的完整普通会话列表**：
     - 普通会话列表已在左侧 Sidebar 集中归位，Activity 页面不再重复展示所有普通会话卡片；
     - Activity 专职聚焦于跨项目行动与待处理中心：待审批决策（`needs_attention`）、失败故障（`failed`）与当前运行任务（`running`）；
  2. **解决 UI-F03：杜绝将非会话 ID 冒充 Session ID**：
     - 在 `ActivityQueue.tsx` 中，严格仅当 `run.kind === 'session'` 时才触发 `onOpenSession(run.id)`；
     - 其它运行类型（`team` / `subagent` / `goal`）展示真实类型与 ID 标签，严禁将其 id 传递给普通会话跳转；
  3. **完成状态按需折叠**：
     - 已完成（`completed`）项默认折叠在 `<details>` 中，保持主界面高信噪比与注意力集中；
     - 待处理与运行中高亮展示。

## 2. 非目标 (Not Doing)
- 不删除既有的集中审批决策与响应后端 API（`respondWidget` 等保持完整运行）；
- 不修改 `packages/core`（修改行数恒为 0）。

## 3. 验收标准 (Acceptance Criteria)
1. 界面呈现：
   - 切换到 Activity 区域时，不再重复展示全局普通会话列表；
   - 仅包含跨项目待处理队列（ActivityQueue）、团队任务树（TeamTaskTree）与子代理网格（SubagentWorkspace）；
2. 路由守卫：
   - 仅对 `run.kind === 'session'` 渲染打开会话按钮，点击正确导航至对应会话；
   - 非 session 项（如 goal、team、subagent）不展示会话打开按钮，杜绝 404 伪跳转；
3. 自动化测试门禁：
   - `card222.test.tsx` 扩充非会话类型隔离与只针对 session 跳转的断言，全部通过；
   - Web 单元测试 `npm run test -- --root apps/web` 50 文件 / 410 passed 全绿；
   - `npx tsc -b` 与 `npm run typecheck:tests` 通过；
   - `npm run -w @vessel/web build` 通过。

## 4. 影响范围 (Blast Radius)
- `apps/web/src/components/activity/ActivityQueue.tsx`：区分 run.kind 守卫，已完成项折叠；
- `apps/web/src/App.tsx`：移除 Activity 页面内冗余普通会话平铺；
- `apps/web/src/components/card222.test.tsx`：扩充跳转路由守卫测试。

## 5. 预期证据 (Expected Evidence)
- 定向测试与 Web 全量测试通过日志：
  - `apps/web/src/components/card222.test.tsx` 11 passed；
  - `npx vitest run --root apps/web` 50 passed (50 files / 410 passed)；
- 全量门禁验证：
  - `npx tsc -b` exit 0；
  - `npm run typecheck:tests` exit 0；
  - `npm run -w @vessel/web build` exit 0；
- `packages/core` 修改行数：0。
