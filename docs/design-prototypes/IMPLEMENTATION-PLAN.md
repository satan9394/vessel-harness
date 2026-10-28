# Vessel Web UI 落地实施规划书（IMPLEMENTATION-PLAN）

> **文档编号**：VESSEL-UI-2026-02
> **用途**：把已定稿的「**玻璃视觉 + 四栏工作台/审阅台**」从原型**落进 `apps/web` 真实代码**。
> **给谁看**：接手本任务的新会话 / 新执行器。**开工前先读本文件，再读 §1 列的既有文档。**
> **上游输入**：
> - 原型（唯一权威视觉参考）：`docs/design-prototypes/prototype-full-glass.html`
> - 设计规范：`docs/DESIGN.md`
> - **功能覆盖清单（回归基准）**：`docs/design-prototypes/FEATURE-COVERAGE.md`
> - 截图总览：`evidence/sessions/2026-10-14-card223/ui/index.html`
> - 任务卡：`tasks/223-web-ui-visual-overhaul-and-design-skills.md`
> **状态**：规划完成，等待实施。**当前 `apps/web` 零改动**。

---

## 0. 一句话目标

把 `apps/web` 的界面从"满屏 1px 灰框、无层级、裸 slug 外露"改造成**玻璃质感的四栏工作台**，
且**不丢失任何已实现功能**（以 `FEATURE-COVERAGE.md` 的 18 项缺口 + 细节项为逐条回归基准）。

## 1. 开工前必读（按顺序）

1. `HANDOFF.md` —— 项目现状与接管协议。
2. `AGENTS.md` —— 硬性约束 10 条与禁做清单。
3. `docs/DESIGN.md` —— 玻璃令牌全表、四栏规格、各区域职责（**本规划的视觉依据**）。
4. `docs/design-prototypes/FEATURE-COVERAGE.md` —— **功能回归清单（最重要）**。
5. `docs/design-prototypes/prototype-full-glass.html` —— 原型本体（`data-area` 切换各区域；`#theme=` / `#lang=` 可控状态）。
6. `docs/UI-THEME.md` —— 浅色默认 + 跟随系统，不可违反。

## 2. 不可协商的硬约束

| # | 约束 | 依据 |
|---|---|---|
| 1 | **`packages/core` 零改动**（`git diff --stat packages/core/` 必须为空） | `AGENTS.md` 硬性约束 2/5 |
| 2 | **不引入新依赖**，包管理器锁 **npm**；禁止 pnpm/bun/yarn 锁文件 | 决策点 19 |
| 3 | **不引入 Tailwind**；样式继续用 CSS 变量 + 既有 CSS 文件 | 决策点 19 + `UI-THEME.md` |
| 4 | **浅色默认，深色跟随 `prefers-color-scheme`**；产品**不提供**手动浅深切换 | `docs/UI-THEME.md` 铁律 |
| 5 | **颜色只写 CSS 变量**，禁止组件内硬编码 hex | `UI-THEME.md` 铁律 1 |
| 6 | Web 构建用 **`npm run -w @vessel/web build`**（默认保留 dist；要清空时用 `npm run -w @vessel/web build:clean`） | 历史事故（V2.1 执行偏差） |
| 7 | **中英双语不回退**（走 `apps/web/src/i18n.ts` 字典，不新增硬编码文案） | `AGENTS.md` |
| 8 | **删除一律进回收站**，禁止 `rm`/`Remove-Item` 等永久删除 | 删除铁律 |
| 9 | **纯本地**：不 commit / 不 push / 不 publish；不驱动其它 agent | `AGENTS.md` |
| 10 | 尊重 **`prefers-reduced-motion`**；动效只动 `transform`/`opacity` | `DESIGN.md` §7 |

## 3. 视觉规格（落地用）

**令牌**取 `docs/DESIGN.md` §2.1 的表（玻璃浅/深两套）。落地到 `apps/web/src/styles.css` 顶部 `:root`。

**保留旧变量名作为别名**（避免一次性改完所有组件 CSS，降低风险）：

```
--bg → --bg（沿用）        --panel/--panel2 → --panel/--panel-2
--border → --ring（发丝）   --text/--text-soft/--dim → --text/--text-2/--text-3
--accent/--green/--red/--yellow → --accent/--ok/--danger/--warn
--hover/--row-line → --panel-2/--ring
```

**玻璃质感**：`--glass: color-mix(in srgb, var(--panel) 78%, transparent)`；
**只对固定/吸顶元素**（导航轨、顶栏、浮层）用 `backdrop-filter: blur(26px) saturate(1.7)`。

**四栏规格**：

```
[58px 图标轨] [232px 会话/项目栏] [中央：过程流 + 输入] [300px 审阅栏]
≤1180px：会话栏与审阅栏收起（抽屉 / 浮层）
≤1023px：画布检视器转为模态（焦点陷阱 + Esc + 回焦）—— 与既有实现一致
```

## 4. 分阶段实施（每阶段可独立验证）

> 原则：**小步、可回滚、每步跑定向测试**。不要一次改完所有组件 CSS。

### 阶段 P1 · 令牌层（不动结构）
- 改 `apps/web/src/styles.css`：` :root` / 深色块换成玻璃令牌；**同时定义旧名别名**。
- 玻璃环境光放在 `body` 的 background（固定层，不随滚动）。
- 验收：`npx tsc -b` + web 单测仍绿；界面配色已变但布局未动。

### 阶段 P2 · 玻璃外壳
- `.navigation-shell`、`.topbar` 上 `--glass` + `backdrop-filter`；
- 面板改**浮动**（去掉贴边）：`.app` 加 padding/gap，各面板独立圆角。
- 验收：浅/深截图各一张比对。

### 阶段 P3 · 四栏骨架（结构性）
- `.app` 网格改为 `58px 232px 1fr 300px`；新增**审阅栏**容器（复用既有 `.docked-inspector` 的能力）。
- **检视器 Tab 必须是真实 8 个**：`swarm / cognition / context / cache / ast / patch / tasks / trace`，
  中文标签取字典原值：**代理网络 / 认知规则 / 上下文 / 模型缓存 / 影响范围 / 代码补丁 / 任务树 / 追踪**；
  面板名 **画布检视器**；保留 `Ctrl/Cmd+I` 开关、`vessel.inspector` 持久化、≤1023px 模态。
- 验收：四个区域可切换，Tab 数与名称与 `DualSurfaceLayout.tsx` 的 `INSPECTOR_TABS` 一致。

### 阶段 P4 · 中央过程流
- **常驻计划清单**（借鉴 Claude Code）：✓ 完成 / ● 当前 / · 待办 + 每步耗时，标题 `计划 · n / m`。
  数据源：既有 goal/task 状态（`apps/web/src/goal.ts`）。
- **就地 diff**：改动前先展示，带 `采纳 / 拒绝 / 在画布中逐块处理`，复用 `InlineDiffInspector.tsx`。
- **授权卡**：`批准一次 / 本会话内总是允许 / 拒绝`，复用 `PermissionActionCard.tsx`。
- 「工具行」复用 `ToolActivityRow.tsx`。

### 阶段 P5 · 输入区与计量
- 胶囊行：项目 / 模型 / **审批档位** / 模式（模型胶囊复用 `ModelSelector.tsx`）。
- 底部常驻计量：上下文占用（进度条）、缓存命中、花费、计划进度、键位提示。
- 复用 `UsageBar.tsx`、`TalkingMetricsBar.tsx`。

### 阶段 P6 · 修丑点（`DESIGN.md` §6）
1. 满屏 1px 同权重灰框 → `--ring` 发丝 + 面板分层。
2. **裸 slug 与长绝对路径**（`VESSEL-CARD222-FIXTURE-SZVBBY`、`C:\work\AppData\...`）
   → 列表只显示可读名 + 项目名；完整值收进详情等宽块。
3. 会话标题用可读标题；时间统一 `HH:mm` / `MM-DD`。
4. 补齐**空态**（带下一步动作）、**加载态**（结构骨架）、**错误态**（就地 + 重试）。
5. **Agent Studio 的边框卡片墙** → 收敛为分区 + 去边列表。

### 阶段 P7 · 功能覆盖对齐（**不可省**）

把 `FEATURE-COVERAGE.md` 的 **B1–B18 全部接回真实代码**，每项都要有可达入口：

| 项 | 落地要点 |
|---|---|
| B1 会话路由档位 Auto/Fast/Pro + 锁定 | 复用 `ModelMessages` 的 `modelAuto/Fast/Pro`、`uiResolve`、`uiPinForThisSession` |
| B2 能力协商三态 | 复用 `CapabilityStatus.tsx` + `capabilityDetected/Declared/Unknown` |
| B3 会话级模型切换 | `PATCH /api/sessions/:id/model` + `ModelSelector.tsx` |
| B4 中断当前回合 | `POST /api/sessions/:id/interrupt`（与任务级 pause/cancel 区分） |
| B5 目标预算 | `POST /api/goal/tasks/:id/budget` + `budget/pause/resume` 键 |
| B6 方案编辑器预审 | `TeamPlanEditor.tsx` + `uiEditStagedTeamPlan` |
| B7 阶段面板 + 节点抽屉 | `TeamStagesPanel.tsx` / `TeamNodeDrawer.tsx` |
| B8 供应商删除 + 内置保护 | `DELETE /api/providers/:id` + `providerErrBuiltin` / `providerErrStoreCorrupted` + `apiKeyMasked` |
| B9/B15 检视器 8 Tab + 折叠 + 窄屏模态 | 见阶段 P3 |
| B10 缓存效益 + Context 四层 | `CacheEconomicsPanel` + `ContextPanel`（两者已在 `DualSurfaceLayout.tsx`，只需让新布局不丢它们） |
| B11 工作区指纹 + 前缀分段 | 同上（`uiWorkspaceFingerprint` / `uiStable|Scoped|Volatile` / `uiPrefixSHA256`） |
| B12 沙箱详情 | `SandboxAuditBadge.tsx` / `SandboxAuditHistory.tsx` 扩展：层级、只读白名单、可写路径、内存上限、提权削减；**未声明要显式写"本次执行未强制"** |
| B13 Swarm 心跳与本地连接 | `SwarmTopologyView.tsx` 扩展：采样数 / RTT / 刷新周期 / 无响应对端 |
| B14 快捷键说明 | 新增面板，键位见 `uiKeyboardShortcuts` / `uiCommandsCtrlCmdK` / `uiToggleInspectorCtrlCmdI` |
| B16 状态字典集中呈现 | 把 `StatusMessages` 的 59 个状态在各处**正确使用**（不是另造词） |
| B17 任务详情生成/评估快照 | `GoalPanel.tsx` 扩展：Generator / Evaluator / 验收 / 重试后 |
| B18 边界态 | 终结任务不可重跑（`uiTerminalTasksCanTBeRunRequeueThem`）、权限卡过期（`uiExpired`）、无归属工作区（`uiNoOwningWorkspace`）、未认领（`uiUnclaimed`） |

**F.3 的细节增强项**也要对齐（见 `FEATURE-COVERAGE.md` §F.3）：
反思规则四类筛选与 `uiSearchRules`、团队方案 `uiMemberRoutes/uiAssignedRole/uiTemperature/uiLead`、
子代理 `uiWorktree/uiExitCode/uiSubagentTokenUsage`、AST `reportedCallers/observedCallers`、
补丁 `viewUnified/viewSplit` 视图切换。

**C 项（Context / Logs / MCP / Policy 四个模块）**：真实实现里由 `App.tsx` 的
`UNIMPLEMENTED` 渲染为 `t('unimplemented')`。**改造后必须保持"占位"语义**，不得让它们看起来像已实现。

### 阶段 P8 · 门禁与证据

```powershell
npx tsc -b tsconfig.json                                              # 必须 exit 0
npm run typecheck:tests                                               # 必须 exit 0
npm run -w @vessel/web build                   # 必须 exit 0
npm run test:all                                                      # 根 + apps/web 双 root 全绿
git diff --stat packages/core/                                        # 必须为空
```

截图矩阵（离线 Chromium 实拍）：**中英 × 浅/深 × 桌面/1366/1023/800**，覆盖七个区域 + 浮层；
存 `evidence/sessions/<日期>-ui-landing/`，并生成画廊页。

## 5. 完成定义（DoD）

- [ ] `FEATURE-COVERAGE.md` 的 **B1–B18 逐条有可达入口**，并在该表上标注证据（截图或测试名）。
- [ ] 门禁四项全 exit 0；`packages/core` 零改动；双 root 测试全绿。
- [ ] 中英双语无硬编码新增；`prefers-reduced-motion` 生效；≤1023px 检视器模态行为正确。
- [ ] 截图矩阵齐备并留档；任务卡与 `tasks/README.md` 收口。
- [ ] 未 commit / 未 push / 无永久删除。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 大量组件 CSS 同时改，回归面失控 | 分 P1–P8 小步走，每步跑定向测试；旧变量名保留为别名 |
| 为了"好看"丢掉功能（**本次核心风险**） | **以 `FEATURE-COVERAGE.md` 为回归基准**，18 项逐条核；改完再核一遍 |
| 窄屏行为回退 | 显式测 1023 / 800 两档；沿用既有 `matchMedia('(max-width: 1023px)')` 判据 |
| 深色下白块 / 对比度不足 | 每次截图**必须浅深各一张**；对比度 ≥ 4.5:1 |
| 误把"设计前瞻"当已实现 | `UNIMPLEMENTED` 四模块保持占位语义 |
| 构建产出被清空（历史事故） | 使用 `npm run -w @vessel/web build`，脚本已内置保留 dist；要清空时用 `npm run -w @vessel/web build:clean` |

## 7. 交付物清单

1. `apps/web/src/**`（样式 + 组件）改动。
2. `docs/DESIGN.md` 如需微调（保持单一真相源）。
3. `docs/design-prototypes/FEATURE-COVERAGE.md` **回归结果**（逐项打勾 + 证据）。
4. `evidence/sessions/<日期>-ui-landing/`：门禁日志 + 截图矩阵 + 画廊页。
5. `tasks/223-*.md` 状态收口 + `tasks/README.md` 一行。
