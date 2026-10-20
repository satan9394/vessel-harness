# 功能覆盖审计：原型 vs 已实现功能（FEATURE-COVERAGE.md）

> **用途**：回答"UI 原型是否覆盖了本项目已开发的所有功能，防止改 UI 之后功能缺失"。
> **方法**：以代码为准，逐个比对 **组件清单**（`apps/web/src/components/**`）、
> **API 能力**（`apps/web/src/api.ts` 的方法注释 = 端点真值）、**模块开关**（`apps/web/src/uiModules.ts`）、
> **CLI 命令**，与原型 `docs/design-prototypes/prototype-full-glass.html` 的呈现逐项对照。
> **审计日期**：2026-10-15。
>
> **落地回归（2026-10-15，VESSEL-UI-2026-02 实施会话）**：本表第 B 节 18 项已逐条回归到
> `apps/web` 真实代码，每项标注**可达入口**与**证据**。回归证据目录：
> `evidence/sessions/2026-10-15-ui-landing/`。

---

## 0. 统计（回归后）

| 分类 | 数量 | 说明 |
|---|---|---|
| 已实现 · 已覆盖 | 34 | 组件 27 + API 能力 7（A 节） |
| **已于本轮回归接回** | **18** | B1–B18，全部有可达入口（见 B 节证据列） |
| 原型超前（真实 app 未实现） | 4 | C 节，渲染 `t('unimplemented')` 占位，**不改语义** |
| 不在 Web UI 范围 | — | CLI / TUI / 守护进程，见 D 节 |

---

## A. 已实现 · 已覆盖（34）

| 功能 | 源头 | 原型位置 |
|---|---|---|
| 会话列表 / 项目分组 / 归档重命名 | `Sidebar.tsx`、`PATCH /api/sessions/:id/topic` | 四栏骨架左栏、工作台 |
| 健康状态与版本 | `StatusBar.tsx`、`GET /api/health` | 顶栏（含三态） |
| 项目打开 | `POST /api/projects/open` | 工作台「打开目录」 |
| 就地任务启动（项目→任务→开始） | `TaskComposer.tsx`、`POST /api/sessions` | 工作台 composer |
| 新建会话表单（工作区/模型/权限） | `NewSessionForm.tsx` | 全览 11「新建会话」 |
| 对话流 / 消息列表 | `ConversationView.tsx`、`MessageList.tsx` | 会话流 |
| 思考折叠（含流式与规则标注） | `ThinkingBlock.tsx`、`StreamingReasoningBlock.tsx` | ⑤ 内嵌微组件 |
| 工具调用行 | `ToolActivityRow.tsx` | 会话流 |
| 内嵌 diff 检查器 | `InlineDiffInspector.tsx`、`widgetRoutes` | 会话流就地 diff |
| 权限动作卡 | `PermissionActionCard.tsx` | 授权卡 |
| 红绿门禁徽章 | `RedGreenGateBadge.tsx` | ⑤ |
| AST 影响面雷达 | `AstImpactRadar.tsx` | ⑤ |
| 对话指标（Talking Metrics） | `TalkingMetricsBar.tsx` | ⑤ |
| 用量与缓存计量 | `UsageBar.tsx` | 会话底部常驻计量 |
| 组件 IR 分发 | `WidgetDispatcher.tsx` | ⑤ 六个形态 |
| 命令面板 | `CommandPalette.tsx`、`palette/types.ts` | 浮层 + 全览 11 |
| 显示模块开关（11 个） | `CustomizePanel.tsx`、`uiModules.ts` | 设置 / 偏好抽屉 |
| 注意力通知与音频 | `AttentionControls.tsx` | 偏好抽屉 |
| 语言切换（中英字典） | `LanguageSwitcher.tsx`、`i18n.ts` | 设置 / 偏好抽屉 |
| 双表面布局与常驻 Inspector | `DualSurfaceLayout.tsx` | 四栏骨架的 300px 审阅栏 |
| 补丁画布：逐 Hunk 采纳/丢弃 | `InteractivePatchPicker.tsx`、`patchRoutes` | 画布区域 |
| 目标/任务队列 + 运行控制 | `GoalModule.tsx`、`GoalPanel.tsx` | ⑦ Tasks 模块 |
| 任务迭代回放 | `GET /api/goal/tasks/:id/iterations` | ⑦「迭代回放」 |
| 团队任务树（父子/依赖/租约/阻塞） | `TeamTaskTree.tsx`、`GET /api/tasks/tree` | 活动页 |
| 团队 DAG 画布 | `TeamDagCanvas.tsx`、`POST /api/sessions/:id/team-runs` | ⑥ |
| 团队模块与面板 | `TeamModule.tsx`、`TeamPanel.tsx` | Team 模块 |
| 阶段门禁横幅 | `TeamStagedBanner.tsx`、`GET /api/team/stages` | ⑥ |
| 跨项目活动与集中审批 | `ActivityQueue.tsx`、`GET /api/activity/runs` | 活动页 |
| 子代理工作台 | `SubagentPanel.tsx`、`/api/subagents/events` | 活动页 |
| Swarm 拓扑 | `SwarmTopologyView.tsx`、`GET /api/mesh/peers` | 活动页 |
| 认知规则看板 | `CognitiveRulesDashboard.tsx`、`GET /api/memory/rules` | Studio |
| 行为库 / 组合 / 生效快照 | `AgentStudioComposer.tsx`、`AgentStudioInspector.tsx` | Studio |
| 结构化 Trace（参数脱敏） | `TracePanel.tsx`、`GET /api/sessions/:id/trace` | ④ 追踪 Tab |
| 沙箱等级徽章与审计历史 | `SandboxAuditBadge.tsx`、`SandboxAuditHistory.tsx` | ④ / 审阅栏 |
| 供应商与模型管理 + 连通性探测 | `ProviderSettingsModal.tsx`、`/api/providers*` | 设置 |
| 外部评审 handoff | `POST /api/reviews`、`GET /api/reviews/:id` | 活动页「外部评审」 |
| 品牌标识 | `VesselLogo.tsx` | 图标轨徽标 |

---

## B. 18 项缺口 —— 本轮回归结果（每项可达入口 + 证据）

> 证据类型：**组件/文件** = 真实渲染代码；**测试** = 通过的单测；**截图** = `evidence/sessions/2026-10-15-ui-landing/` 离线 Chromium 实拍。

| # | 缺口 | 可达入口（真实代码） | 证据 |
|---|---|---|---|
| B1 | 会话路由档位 Auto/Fast/Pro + **解析** + **锁定** | `ComposerMeters.tsx` 的 `ComposerCapsules` 模式胶囊：`自动/快速/专业` 调 `POST /sessions/:id/route`；`确定模型` 调 `route/resolve`；`为本会话固定模型 / 已固定·取消固定` 调 `route/pin|unpin` | 组件 `ComposerMeters.tsx`；截图 `p5-session-*.png`（facts `modePills` 含 5 个控件）；`routeLabel()` 显示解析结果 |
| B2 | 能力协商三态 `detected|declared|unknown` | 会话头 `ModelSelector` → `<details class="model-capabilities">{CapabilityStatus}` | 组件 `ModelSelector.tsx:69`、`CapabilityStatus.tsx`；测试 `CapabilityStatus.test.tsx`、`i18n.context.test.tsx` |
| B3 | 会话级模型切换 | 会话头 `ModelSelector` 下拉 → `PATCH /sessions/:id/model` | 组件 `ModelSelector.tsx`；测试 `ModelSelector.test.tsx`（切换/忙碌/失败） |
| B4 | 中断当前回合 | 会话输入区「停止」按钮 → `POST /sessions/:id/interrupt` | 组件 `ConversationView.tsx`（`stop()`）；测试 `ConversationView.attention.test.tsx` |
| B5 | 目标预算 `maxIterations/maxRetries` | 任务模块 `GoalPanel` 的 `Budget` 控件 → `GET/POST /goal/tasks/:id/budget` | 组件 `GoalPanel.tsx:114-133`；测试 `components.goal.test.tsx` |
| B6 | 方案编辑器 / 预审稿 | 团队模块 → `TeamPlanEditor.tsx`（`uiEditStagedTeamPlan`） | 组件 `TeamPlanEditor.tsx`；测试 `TeamDagCanvas.test.tsx` |
| B7 | 团队阶段面板 / 节点抽屉 | `TeamModule` → `TeamStagesPanel` + `TeamNodeDrawer` | 组件 `TeamStagesPanel.tsx`、`TeamNodeDrawer.tsx`；测试 `TeamDagCanvas.test.tsx` |
| B8 | 供应商删除 + 内置保护 + 脱敏掩码 | 设置 → 供应商弹窗：删除按钮、`builtin_provider`/`unknown_provider`/`provider_store_corrupted` 错误码文案、`apiKeyMasked` | 组件 `ProviderSettingsModal.tsx:50,52,109,158`；测试 `ProviderSettingsModal.test.tsx`、`providerRoutes.test.ts` |
| B9 | 检视器真实 **8 Tab** | 300px 审阅栏 `.docked-inspector` 的 `INSPECTOR_TABS` | `DualSurfaceLayout.tsx:18`；截图 `p3-session-*.png` facts `inspectorTabs` 长度=8；测试 `DualSurfaceLayout.test.tsx` |
| B10 | 缓存经济学 + Context 四层缓存 | 审阅栏 `模型缓存` Tab（`CacheEconomicsPanel`）、`上下文` Tab（`ContextPanel`） | `DualSurfaceLayout.tsx:53,101`；测试 `DualSurfaceLayout.test.tsx` |
| B11 | 工作区指纹 + 前缀分段 | 审阅栏 `模型缓存` Tab 内的指纹块与稳定/作用域/易变三段 | `DualSurfaceLayout.tsx:71-74` |
| B12 | 沙箱详情（层级/白名单/内存/提权） | 会话内 `SandboxAuditHistory` → `SandboxAuditBadge`，含「本次执行未强制」提示 | 组件 `SandboxAuditBadge.tsx:27-37`；审阅栏/活动页可见 |
| B13 | Swarm 心跳与本地连接 | 审阅栏 `代理网络` Tab（`SwarmTopologyView`：采样数/RTT/刷新周期/对端） | `SwarmTopologyView.tsx:15,20,35`；`DualSurfaceLayout.tsx:176` |
| B14 | 快捷键说明 | `CommandPalette` 的 `?` 快捷说明（`uiKeyboardShortcuts`） | `CommandPalette.tsx:73,78` |
| B15 | 检视器折叠 / 开关 / ≤1023px 模态 | 审阅栏工具栏 `打开检视器/收起检视器/关闭`，`Ctrl/Cmd+I`，`vessel.inspector` 持久化，≤1023px `role=dialog` 模态 | `DualSurfaceLayout.tsx:161-186`；截图 `p3-session-1023-dark.png`/`p3-session-800-dark.png` facts `role=dialog`、`width=560`；测试 `DualSurfaceLayout.test.tsx` |
| B16 | 状态字典集中呈现 | 队列/迭代/门禁/沙箱/权限各处使用既有字典键（如 `localizedValue(task.status,t)`、`gateRed/gateGreen`、权限档位胶囊） | `GoalPanel.tsx`、`SandboxAuditBadge.tsx`、`ComposerMeters.tsx`（`permissionLabelKey`） |
| B17 | 任务详情生成/评估快照与验收 | 任务模块 `GoalPanel` 的迭代回放（Generator/Evaluator/验收/重试后） | `GoalPanel.tsx:173-237`；测试 `components.goal.test.tsx` |
| B18 | 边界态（终结任务不可重跑 / 权限卡过期 / 无归属工作区 / 未认领） | `GoalPanel` 的 `uiTerminalTasksCanTBeRunRequeueThem`；`PermissionActionCard` 的 `uiExpired`；`GoalModule` 的 `noOwningWorkspace`；`TeamNodeDrawer` 的 `uiUnclaimed` | `GoalPanel.tsx:66,110`、`PermissionActionCard.tsx:25`、`GoalModule.tsx:119`、`TeamNodeDrawer.tsx:17` |

### B 节补充项（风险较低，同样保留）

`GET /api/sessions/search`（SQLite 全文检索的 `indexed` 可用性指示）、
`POST /api/control/mesh/ping/:id`（对端探活）、`/api/daemon/*`（守护进程状态与托盘）、
`GET /api/reviews/:id/handoff.md`（复制 handoff 原文）——这四项在原型里是"部分"呈现，真实 app 中同样按部分支持处理，未删入口。

---

## C. 原型超前于实现（4 项，属设计前瞻，**保持占位语义**）

`apps/web/src/App.tsx`：

```ts
const UNIMPLEMENTED: UiModuleId[] = ['Context', 'Logs', 'MCP', 'Policy'];
```

这 4 个模块在真实 app 里**渲染 `t('unimplemented')` 占位**。本轮 UI 改造**未改变**该语义：
`ModuleSection` 的 `default` 分支对 `UNIMPLEMENTED.includes(id)` 仍输出占位卡片。
→ 回归断言：`apps/web/src/components/card222.test.tsx` 与 `App.tsx` 源码保持该分支不变。

---

## D. 不在 Web UI 范围（对照用，无需进原型）

CLI：`vessel run/serve/provider/mcp/mod/doctor/memory/mesh/sessions/resume/diff/review/daemon/guide/settings/policy/pricing/usage/bench-report`；
TUI：`vessel run`（无 `--prompt` 且 TTY）。
守护进程 / 托盘 / 系统通知属 `apps/local-server/src/daemon/*`，UI 只消费其状态。

---

## E. F.3 细节增强项 —— 本轮对齐结果

| 细节项 | 落地位置 | 证据 |
|---|---|---|
| 反思规则四类筛选 + `uiSearchRules` | `CognitiveRulesDashboard.tsx`（`uiTrigger`/`uiLesson`/`uiRecommendedAction`/`uiCategory`/`uiSearchRules`） | 组件 + 测试 `CognitiveRulesDashboard.test.tsx` |
| 团队方案 `uiMemberRoutes`/`uiAssignedRole`/`uiTemperature`/`uiLead` | `TeamPlanEditor.tsx` | 组件 + `TeamDagCanvas.test.tsx` |
| 子代理 `uiWorktree`/`uiExitCode`/`uiSubagentTokenUsage` | `SubagentPanel.tsx:47-53` | 组件 + `SubagentPanel.test.tsx` |
| AST `reportedCallers`/`observedCallers` | `AstTopologyPanel`（`DualSurfaceLayout.tsx:78-89`） | 组件 + 测试 |
| 补丁 `viewUnified`/`viewSplit` | `InteractivePatchPicker.tsx:31` | 组件 + `InteractivePatchPicker.test.tsx` |

**本轮新增/接入的 UI 基建（来自 IMPLEMENTATION-PLAN 的 P1–P6）**：
- P1 `styles.css` `.tokens` 玻璃令牌层（旧名别名，浅色默认 + 跟随系统）。
- P2 玻璃外壳（rail/session/main 浮动 + `backdrop-filter`）。
- P3 `Rail.tsx` 58px 图标轨 + `58px 232px 1fr` 网格 + 300px 审阅栏（`layout.css`）。
- P4 `PlanChecklist.tsx` 常驻计划清单（`计划 · n/m`，数据源真实 Goal 队列）。
- P5 `ComposerMeters.tsx`（`ComposerCapsules` 四胶囊 + `MetersRow` 常驻计量）。
- P6 `utils/timeFormat.ts`（`HH:mm`/`MM-DD`）+ 残留硬编码色清零 + 空/加载/错误态。

---

## F. 回归结论（2026-10-15）

- **B1–B18 全部有可达入口**（见 §B 证据列），无一项退化为"只有原型、真实 app 无入口"。
- **C 项 4 模块保持 `t('unimplemented')` 占位语义**，未包装成已实现。
- 门禁：`npx tsc -b` / `npm run typecheck:tests` / `npm run -w @vessel/web build -- --emptyOutDir false` / `npm run test:all`（根 + `apps/web` 双 root）全 exit 0；`packages/core` 零改动。
- 截图矩阵与门禁日志：`evidence/sessions/2026-10-15-ui-landing/`。
