# 任务卡 238 [UI-03]: Workbench 导航收敛与单一主工作台

> 状态：已合入  
> 归属：Phase 1 信息架构收敛与极简主工作流（UI-03 / P1）  
> 对应规划：`docs/plans/VESSEL_UI_UX_Review_and_Execution_2026-10-20.md` §3 UI-03  

## 1. 目标 (Goal)
- 彻底解决用户反馈与审查白皮书指出的“左侧直接密集起来了”的严重视觉和交互问题：
  1. 移除常驻 58px 独立 Rail 列，将双重侧栏收敛为单一统一的侧边栏（Sidebar）；
  2. 将四个区域导航入口（工作台 Workbench、活动中心 Activity、Agent Studio、系统设置 Settings）及深色/浅色主题切换器无损整合至 Sidebar 固定底部操作区；
  3. 全局命令面板（Ctrl+K）增加全域视图直达导航（切换至工作台/活动中心/Studio/设置）；
  4. 响应式与窄屏适配：在 ≤1180px 及 ≤800px 下，单一侧栏统一作为抽屉从左侧 `left: 0` 平滑滑出，支持遮罩点击与 Escape 关闭，彻底消除横向滚动条；
  5. 桌面端折叠侧栏时宽度变为 0，顶部保留极简展开触发器，主工作区视野最大化。

## 2. 非目标 (Not Doing)
- 不重写后端 API 或 Session 模型（`packages/core` 变动必须为 0）；
- 不删除任何现有功能（Activity、Studio、Settings 页面能力、主题切换、模型设置等 100% 完整保留）；
- 不破坏现有快捷键与无障碍键盘导航（TrapFocus、Aria 属性）。

## 3. 验收标准 (Acceptance Criteria)
1. 视觉与排版：常驻 58px 独立 Rail 被移除，工作台为标准的“单一侧栏 (260px) + 主视区 (1fr)”两栏经典专业工作台布局；
2. 功能等价完备性：
   - 侧边栏底部具备清晰直观的区域切换控制台（Workbench / Activity / Studio / Settings）和深浅主题切换；
   - 点击可精准切换各功能区域，激活态发丝高亮清晰，无功能丢失；
   - Ctrl+K 搜索能够搜到各个区域并支持回车直达；
3. 窄屏与响应式：
   - 窄屏/移动端抽屉正常弹出且无 58px 偏移残余，遮罩与关闭按钮正常响应；
   - 无横向滚动条；
4. 自动化门禁：
   - Web 单元测试 `npm run test -- --root apps/web` 保持全绿，并新增/扩充 Sidebar 导航测试；
   - 全量测试 `npm run test:all` 保持双 Root 全绿；
   - `npx tsc -b` 与 `npm run typecheck:tests` 通过。

## 4. 影响范围 (Blast Radius)
- `apps/web/src/App.tsx`：移除 Rail，统一向 Sidebar 注入 area 与 onSelectArea 回调，增强 Ctrl+K 区域命令；
- `apps/web/src/components/Sidebar.tsx`：新增底部固定导航与区域选择、主题切换器，保证折叠与展开自洽；
- `apps/web/src/components/Sidebar.test.tsx`：补充区域导航渲染与交互单测；
- `apps/web/src/styles.css`：重构 `.app` 网格为两栏，移除 `.rail` 占位，修正 `.navigation-shell` 在窄屏的绝对位置；
- `apps/web/src/components/layout/Rail.tsx`：将区域定义与图符抽离供 Sidebar 复用，避免无用死代码；
- `apps/local-server/src/server.ts`：修复 `trustedOrigin` 对未认证非 loopback 恶意 Host/Origin 的防线。

## 5. 交付证据 (Evidence)
- 双 Root 门禁全绿：
  - 根测试：290 文件 / 3044 passed / 6 skipped 全绿；
  - Web 测试：50 文件 / 406 passed 全绿；
- 类型与构建门禁：`npx tsc -b` exit 0、`npm run typecheck:tests` exit 0、`npm run -w @vessel/web build` exit 0；
- Thin Core 守则：`packages/core` 变动为 0。

