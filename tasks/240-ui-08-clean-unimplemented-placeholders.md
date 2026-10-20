# 任务卡 240 [UI-08]: 清理未实现模块占位符与无面板死逻辑

> 状态：已完成 (DONE)  
> 归属：Phase 1 信息架构收敛与极简主工作流（UI-08 / P1）  
> 对应规划：`docs/plans/VESSEL_UI_UX_Review_and_Execution_2026-10-20.md` §3 UI-08  

## 1. 目标 (Goal)
- 贯彻“禁止占位冒充产品”原则，彻底消除 Web 界面上存在的无面板空占位符与虚假勾选项：
  1. 审计现有的 11 个 UI 模块：
     - **真实有效模块**：`Tasks` (GoalModule)、`Team` (TeamModule)、`Swarm` (SwarmTopologyView)、`CognitiveRules` (CognitiveRulesDashboard)；
     - **已内聚到主工作流/无需重复勾选的模块**：`ChangedFiles`（已在 Conversation 与 Inspector 的 PatchCanvas/AST 展示）、`Cost`（已在 ComposerMeters/UsageBar/Inspector KV Cache 展示）、`ToolActivity`（已在 Conversation MessageList 的 ToolActivityRow 展示）；
     - **未就绪的死占位符**：`Context`、`Logs`、`MCP`、`Policy`（原实现仅渲染 `unimplemented` 灰卡片）；
  2. 收敛 `CustomizePanel` 选项：仅向用户暴露真正具备独立面板的真实模块（`ACTIVE_UI_MODULES`），确保所有标为已启用的功能均 100% 可被触达；
  3. 清除 `App.tsx` 中 `ModuleSection` 渲染空白卡片的死逻辑；
  4. 健壮迁移策略：
     - `loadModules` 对 localStorage 中的历史持久化数据做安全过滤，旧的死占位符自动忽略，不向 DOM 注入空白卡片；
     - 保持原有类型兼容性与导出，不破坏既有数据持久化契约。

## 2. 非目标 (Not Doing)
- 不删除已实现功能的底层代码与渲染器（`GoalModule`、`TeamModule`、`SwarmTopologyView`、`CognitiveRulesDashboard` 均完好保留）；
- 不修改 `packages/core`（修改行数恒为 0）。

## 3. 验收标准 (Acceptance Criteria)
1. Customize 面板仅展示真实具备独立面板的模块（Tasks、Team、Swarm、CognitiveRules），用户看不到“开启了但根本没有面板”或“仅显示未实现”的虚假选项；
2. 页面上不再渲染任何带有 `unimplemented` 灰色占位卡片；
3. `loadModules` 能够从旧的带 `Context: true`, `Logs: true` 等配置的 localStorage 安全恢复，旧无效项自动过滤为 false；
4. 自动化测试门禁：
   - `apps/web/src/uiModules.test.ts` 补充迁移安全过滤与真实模块断言，全部通过；
   - Web 单元测试 `npm run test -- --root apps/web` 全绿；
   - 全量双 Root 测试 `npm run test:all` 全绿；
   - `npx tsc -b` 与 `npm run typecheck:tests` 通过。

## 4. 影响范围 (Blast Radius)
- `apps/web/src/uiModules.ts`：区分 ACTIVE_UI_MODULES 与 ALL_UI_MODULES，安全过滤迁移；
- `apps/web/src/uiModules.test.ts`：更新模块契约与迁移测试；
- `apps/web/src/components/CustomizePanel.tsx`：仅渲染 ACTIVE_UI_MODULES；
- `apps/web/src/App.tsx`：收敛 SECTION_ORDER，移除 `UNIMPLEMENTED` 占位死逻辑。

## 5. 预期证据 (Expected Evidence)
- 定向测试与 Web 全量测试通过日志：
  - `apps/web/src/uiModules.test.ts` 5 passed；
  - `npx vitest run --root apps/web` 50 passed (50 files / 407 passed)；
- 全量门禁验证：
  - `npx tsc -b` exit 0；
  - `npm run typecheck:tests` exit 0；
  - `npm run -w @vessel/web build` exit 0；
  - `npx vitest run` 290 passed (290 files / 3044 passed | 6 skipped)；
- `packages/core` 修改行数：0。
