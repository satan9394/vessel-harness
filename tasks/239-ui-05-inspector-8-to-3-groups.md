# 任务卡 239 [UI-05]: Inspector 8 合 3 职责化重组

> 状态：已完成 (DONE)  
> 归属：Phase 1 信息架构收敛与极简主工作流（UI-05 / P1）  
> 对应规划：`docs/plans/VESSEL_UI_UX_Review_and_Execution_2026-10-20.md` §3 UI-05  

## 1. 目标 (Goal)
- 彻底解决右侧 Inspector 面板 8 个平级标签平铺导致的视觉混乱与认知负荷过重问题：
  1. 将 8 个平级标签重组为 3 个职责大组：
     - **变更 Changes**（默认）：Patch / Diff (`patch`)、AST 影响 (`ast`)
     - **执行 Execution**：任务树与审批 (`tasks`)、Swarm 节点拓扑 (`swarm`)
     - **诊断 Diagnostics**：Trace 轨迹 (`trace`)、KV 缓存与指纹 (`cache`)、上下文缓存 (`context`)、认知规则 (`cognition`)
  2. 采用两级导航（3 个主职责组 + 当前组子胶囊切换），300px 宽度内清晰规整；
  3. 兼容策略：
     - 读取 `localStorage['vessel.inspector']` 时自动做 `oldTab -> group + subtab` 映射，迁移不丢用户记忆；
     - 保持原有外部调用 `tabRequest`（如 `requestView('patch')`）和 Ctrl+K 命令完全兼容，自动定位至对应组及子 tab；
  4. 窄屏（≤1180px）保持可无障碍关闭（Escape、遮罩点击）的右侧抽屉。

## 2. 非目标 (Not Doing)
- 不删除任何现有数据和功能组件（Patch, AST, Tasks, Swarm, Trace, Cache, Context, Cognition 完整保留）；
- 不修改底层 API 契约（`packages/core` 变动必须为 0）。

## 3. 验收标准 (Acceptance Criteria)
1. 视觉呈现：Inspector 顶部为 3 个主职责组标签（变更 / 执行 / 诊断），下方展示对应职责组的子功能胶囊；
2. 职责划分与默认值：
   - 默认选中【变更 Changes】下的 `patch`（Diff 补丁选择器）；
   - 点击主组可切换职责域，并默认激活该组首个子项；
   - 点击子胶囊在组内平滑切换；
3. 兼容性与直达性：
   - `readInspectorState` 遇到旧格式能平滑迁移并正确解析所属组；
   - 外部传入 `tabRequest` 能直达指定子 tab 并自动激活其父组；
   - 快捷键 Ctrl+I 正常开关；
4. 自动化门禁：
   - `DualSurfaceLayout.test.tsx` 扩充 3 组重构后的渲染、切换与旧状态迁移断言，全部通过；
   - Web 单元测试 `npm run test -- --root apps/web` 全绿；
   - 全量双 Root 测试 `npm run test:all` 全绿；
   - `npx tsc -b` 与 `npm run typecheck:tests` 通过。

## 4. 影响范围 (Blast Radius)
- `apps/web/src/components/layout/DualSurfaceLayout.tsx`：增加 InspectorGroup 及两级导航渲染与兼容映射；
- `apps/web/src/components/layout/layout.css`：优化 Inspector 头部与两级 Tab 的精致排版；
- `apps/web/src/components/layout/DualSurfaceLayout.test.tsx`：更新与补充两级导航测试；
- `apps/web/src/i18n.ts`：补充三组国际化词条（`inspectorGroupChanges`, `inspectorGroupExecution`, `inspectorGroupDiagnostics`）。

## 5. 预期证据 (Expected Evidence)
- 定向测试与 Web 全量测试通过日志：
  - `apps/web/src/components/layout/DualSurfaceLayout.test.tsx` 24 passed；
  - `npx vitest run --root apps/web` 50 passed (50 files / 407 passed)；
- 全量门禁验证：
  - `npx tsc -b` exit 0；
  - `npm run typecheck:tests` exit 0；
  - `npx vitest run` 290 passed (290 files / 3044 passed | 6 skipped)；
- `packages/core` 修改行数：0。
