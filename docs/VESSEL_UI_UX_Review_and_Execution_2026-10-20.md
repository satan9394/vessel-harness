# VESSEL UI / UX 审查与 Agent 可执行整改规范

> 文档 ID：`VESSEL-UI-2026-03`  
> 版本：1.0（2026-10-20）  
> 项目：[satan9394/vessel-harness](https://github.com/satan9394/vessel-harness)  
> **唯一审查基线**：`feat/v2.8-taste-ui`，提交 `3a1bf2f257ad3d56a2fa343796bc5629354be2f8`  
> 状态：**截图 + React 组件 + API 调用静态审查；本次未实跑浏览器**  
> 架构先决规范：`VESSEL_Architecture_Review_and_Execution_2026-10-20.md`。

## 0. 产品决定：极简默认、专业渐进、底层不删

**最终建议：坚持已经采用的 Edge-to-Edge 工业化视觉，停止更换皮肤；将界面从“展示所有能力”改成“围绕一次编码任务的工作流”。**

产品不是通用聊天机器人，更不是 Prompt 商店。它是本地工程工作台。自然顺序应是：

> 选项目 → 讲任务 → 观察执行 → 处理异常/审批 → 审查变更 → 再迭代或结束。

正常状态不应反复打断；安全问题和待审批事项必须优先浮现。允许专家深入诊断，但不强制每个用户同时理解 Behavior IR、Swarm、AST、Compaction、Cache、Policy、Trace 和 Provider。

### 0.1 不做什么

- 不再做一次 Glass/Gradient/Bento/拟物风视觉重构。Card 235 的通栏、Hairline、深浅主题基础保留。
- 不删除现有 Agent Studio、Subagent、任务树、追踪、Diff、Provider 等后端能力；只减少默认曝光并改善分组。
- 不强制 UI 遵循 OpenCode/Claude Code 的一模一样布局；借鉴其状态与操作模式，而不是照抄视觉。
- 不实现新的渲染框架、第二个设计系统或新的全局状态管理库，除非现有方案经过证据证明不够用。
- 不因测试文件通过而宣称真实浏览器交互无回归。

## 1. 本轮已确认的源码级 UX 问题

| ID | 级别 | 证据位置 | 已确认现象 | 产品影响 |
|---|---|---|---|---|
| UI-F01 | S/P0 | `apps/web/src/App.tsx` 约 119–127 | 删除会话会 swallow 单项 Promise error，之后把所有请求 ID 从本地移除。 | 用户看到删除成功，服务端数据可能仍存在。 |
| UI-F02 | S/P0 | `apps/local-server/src/routes/activityRoutes.ts` 约 91–104 | 没有活跃 Turn 的 session 默认分类为 completed。 | Activity 可能把失败/未知误标完成。 |
| UI-F03 | S/P1 | `apps/web/src/components/activity/ActivityQueue.tsx` 约 74–79 | 对 `session/team/subagent/goal` 各类型都传 `run.id` 给 `onOpenSession`。 | 非 Session 类型可能打开不存在的会话。 |
| UI-F04 | S/P1 | `apps/web/src/App.tsx` 约 37–56、235–324 | `Context/Logs/MCP/Policy` 可勾选，却渲染未实现占位；另一些模块在这里返回 null。 | “可自定义”给出了能力已可用的错觉。 |
| UI-F05 | S/P1 | `apps/web/src/App.tsx` 约 176–231 | 常驻 Rail、Sidebar、Topbar、Activity/Studio/Settings；Project/Session 与多个入口共存。 | 导航层次和用户注意力分散。 |
| UI-F06 | S/P1 | `apps/web/src/components/layout/DualSurfaceLayout.tsx` 17–19、161–185 | 单 Inspector 含 `swarm/cognition/context/cache/ast/patch/tasks/trace` 八个平级标签。 | 工程细节平铺，审查代码的主路径不突出。 |
| UI-F07 | S/P1 | `apps/web/src/components/providers/ProviderHub.tsx` + `ProviderSettingsModal.tsx` | ProviderHub 实际为完整设置面板的 embedded wrapper，配置项与预设库同时呈现。 | 新增供应商与管理已配置供应商混为一体。 |
| UI-F08 | S/P1 | `apps/web/src/components/studio/AgentStudioComposer.tsx` 约 25–31、70–96 | Composer 只是 staged/advisory verification，不负责激活。 | 用户可能把“验证通过”理解成已经作用于 Run。 |
| UI-F09 | S/P2 | `apps/web/src/App.tsx` 约 208–214 | 偏好设置在顶部菜单与 Settings 区域重复出现。 | 控件归属不清、状态应保持同步。 |
| UI-F10 | D/P1 | `tasks/235-taste-skill-full-surface-ui-refactoring.md` | 任务卡称待用户视觉验收，且在之前的审查包里普通对话截图与首页截图重复。 | 需要真实执行态浏览器录像/交互验收，而非更多静态概念图。 |

标记解释：S=源码核实，D=任务文档自报。上表有些是已证实实现方式但风险仍需端到端复现，严禁把所有风险直接宣称“生产 Bug 已复现”。

## 2. 目标信息架构与界面语言

### 2.1 仍保留四个功能区域，但改变入口层级

- **Workbench：默认主视图**。项目、会话、输入、执行过程、审批、Diff。
- **Activity：待处理工作中心**。待批准、失败/需确认、运行中；已完成默认低优先级且可过滤。
- **Agent Studio：高级配置**。Agent Profiles、Behavior Composer、有效规则检查、执行时快照；不把安全底线作为普通可勾选行为。
- **Settings：全局配置**。Provider、模型默认值、MCP/Tools（仅已实现部分）、语言、主题、通知、权限说明。ProviderHub 可以作为这里的一级页面，不再在主任务路径打开整个目录墙。

上述区域保留**语义上的四区**，但是**不保留强制常驻的 58px Rail**。导航以一个可折叠侧边栏为主；Activity/Studio/Settings 从侧边栏底部及 Ctrl+K 可进入。小屏侧栏为抽屉。原四区相关功能不得因导航简化而丢失。

### 2.2 目标布局（桌面，无活动任务）

```text
┌──────────────────────────────────────────────────────────────┐
│ VESSEL / project-name             [搜索/命令] [设置] [状态]    │
├─────────────────┬────────────────────────────────────────────┤
│ 项目            │                                            │
│  project-name   │       今天需要 VESSEL 做什么？               │
│                 │       ┌────────────────────────────────┐   │
│ + 新建任务       │       │ 描述任务 / 添加上下文 / 拖入文件   │   │
│ 最近会话         │       └────────────────────────────────┘   │
│  Refactor ...   │       Model · 工作区权限 · 高级选项    [↑] │
│  Tests ...      │                                            │
│                 │                                            │
│ Activity [2]    │                                            │
│ Agent Studio    │                                            │
│ Settings        │                                            │
├─────────────────┴────────────────────────────────────────────┤
│ 本地连接正常（弱提示）  ·  当前项目/模型  ·  Ctrl+K            │
└──────────────────────────────────────────────────────────────┘
```

### 2.3 目标布局（有活动任务）

```text
┌───────────────────┬─────────────────────────────┬─────────────┐
│ 项目 / 会话        │ 任务 / 对话 / 执行时间线      │ Inspector*  │
│ - active session  │  ✓ 分析                     │ [变更]     │
│ - another session │  … 编辑文件                 │ [执行]     │
│                   │  ! 待审查                  │ [诊断]     │
│                   │  [批准/拒绝（仅真实审批）]   │ Diff / ...  │
│                   │                             │             │
│                   │ [继续提问 / steer / stop]   │             │
└───────────────────┴─────────────────────────────┴─────────────┘
* Inspector 默认关闭；有审批/明确用户操作时按需开启；窄屏覆盖/抽屉。
```

**关键**：单个项目只需一个主要任务入口；进入会话后在原位置转入执行态，避免两套全屏 UI 导致理解成本。需要保留 TaskComposer、ConversationView 两个组件及各自职责，不要求粗暴合并源文件。

### 2.4 层级与 token 原则

- 外壳 Edge-to-Edge；栏间 hairline 1px；默认结构性矩形；内部按钮和输入可保留小半径。
- 顶部高度紧凑；正文最大可读宽度有上限、但容器仍全屏；不要在超宽屏把整个文字段落铺满 4K。
- 颜色首先表达操作状态而非装饰，严重错误、审批、失败要比连接正常更显眼。
- 正文与元数据形成两级清晰对比；不要让原始模型 ID、绝对路径与长 hash 统治主界面。
- 保留 dark/light 与中英 i18n；禁止硬编码新的中文/英文字符串绕过 `LanguageProvider`。
- 扩展面板不能制造新“漂浮岛”，也不能为了极简牺牲必需的可操作反馈。

## 3. 单项整改卡：按前置协议逐步实现

### UI-01 / P0 — 会话删除：禁止虚假的成功

**文件**：`apps/web/src/App.tsx`、`Sidebar.tsx`、`api.ts`、服务端 DELETE 路由与测试。

**执行**：依赖架构 `ARCH-02` 修复契约；UI 等待成功回执再移除对应项；多会话 topic 删除返回部分失败时应逐项显示；请求在运行、索引锁住、Recycle Bin 无法访问时保留条目且可重试。删除前清晰说明进入回收站的真实行为，禁止“永久删除”暗示。

**AC**：三条记录中服务端故意让一条失败，前端恰好留下失败项；拒绝/取消不修改列表；刷新不会让已失败的 ID凭空消失；有 Vitest + 浏览器回归。

### UI-02 / P0 — Activity 的完成状态必须可信

**文件**：`ActivityQueue.tsx`、`workbench.ts`、`apps/local-server/src/routes/activityRoutes.ts`。

**执行**：依赖 `ARCH-01` 的状态投影，将 `unknown`、`interrupted`、`cancelled` 等最终结果按已验证的状态展示；不得以 `!turnActive` 表示 completed。摘要按“待处理 → 失败/未知 → 运行中 → 已完成”呈现。若已有服务端既定排序，不可仅靠前端重排掩盖数据语义错误。

**AC**：真实失败 Run 出现在需要介入/失败区，终态证明在 API 与 UI 一致；未知状态必须说明尚未确认；点击卡片打开合法详情。

### UI-03 / P1 — Workbench 导航简化，不删功能

**文件**：`App.tsx`、`components/layout/Rail.tsx`、`Sidebar.tsx`、`TaskComposer.tsx`、`NewSessionForm.tsx`、`styles.css`、`components/layout/layout.css`。

**执行顺序**：

1. 为项目切换、最近会话、搜索、创建任务、Activity/Studio/Settings、主题/语言、命令面板写现状功能清单及测试。
2. **优先实验性去常驻 Rail**；将四个导航入口并入 Sidebar 的固定末端区域或统一折叠菜单。保留键盘与触屏等价路径。
3. 将“新任务”保持单一主路径；高级会话的 provider/permission 不删，只进入高级选项；老命令面板动作仍工作。
4. 首次进入默认聚焦空状态的任务输入；选现有会话恢复对话布局；不同工作区切换不误发送原草稿。
5. 800px 及以下使用左抽屉；展开时对话不可被误点，Escape 能关闭并恢复焦点。

**AC**：用户只需一次选择项目 + 一次写任务即可创建；同一状态不出现两个同权重的“开始任务”主按钮；侧边栏和 Ctrl+K 覆盖过去 Rail 全部操作；没有功能消失；窄屏横向滚动条不出现。

**禁止**：为了去 Rail 重写后端 Session 创建模型或删去 `TaskComposer` 的权限选项；不能牺牲已有键盘 trapFocus 与 aria。

### UI-04 / P1 — Activity 专职“行动中心”

**文件**：`ActivityQueue.tsx`、`App.tsx`、`workbench.ts`。

**执行**：移除 Activity 中重复的完整普通会话清单；已完成内容默认折叠或筛选；保留待审批 inline 决策、失败详情与刷新机制。`run.kind==='session'` 时可按 sessionId 打开会话；`team/subagent/goal` 跳转到其对应详情或不可跳转时给出明确入口，不得把其 id 冒充 Session ID。若审批没有响应接口，按钮必须禁用或用明确只读文案；不能通过 UI 假批准。

**AC**：四类 Activity 项均有正确的去向（会话/团队详情/子代理详情/任务详情）；无不存在的 session 跳转；pending/failed 一眼可分；审批结果刷新数据源后收敛。

### UI-05 / P1 — Inspector 从 8 平级标签变成 3 个职责组

**文件**：`components/layout/DualSurfaceLayout.tsx`、`components/layout/layout.css`、`App.tsx` 的 `INSPECTOR_TABS` 与 command palette、对应组件测试。

**不得删除**原有 `swarm/cognition/context/cache/ast/patch/tasks/trace` 信息和数据能力。将导航组织为：

| 新组 | 展示顺序 | 原组件 |
|---|---|---|
| **变更 Changes**（默认） | Patch / Diff → AST 影响 → 变更回执 | `patch`, `ast` |
| **执行 Execution** | 任务树 → Swarm/子 Agent → 审批/执行状态 | `tasks`, `swarm`，并关联主对话事件 |
| **诊断 Diagnostics** | Trace → Context → Cache → Behavior/Cognition | `trace`, `context`, `cache`, `cognition` |

**兼容策略**：既有 `vessel.inspector` localStorage 带旧 tab；提供 `oldTab -> group/subpanel` 映射，不丢用户上次定位。Ctrl/Cmd+I、App 中 `requestView('patch')` 等调用在迁移期保持别名映射，直接逐个删除旧 tab 会引起已有命令面板回归。

**AC**：正常执行时 Inspector 默认关闭；“查看变更”可一键到 Changes/Diff；Ctrl+K 旧命令可跳转对应内容；屏宽 ≤1180px 仍为焦点可管理的抽屉；功能/测试覆盖率不下降。

### UI-06 / P1 — Provider Hub 管理与发现分离

**文件**：`components/providers/ProviderHub.tsx`、`ProviderSettingsModal.tsx`、`PresetsGallery.tsx`、`presetsData.ts`、`ModelQuickSwitcher.tsx`、相关后端路由。

**执行**：Settings 首屏仅展示已配置 Provider（名字、当前状态、模型数、上次检查时间、主要操作）；点击“添加供应商”后才打开预设搜索与步骤式表单。自定义 URL/key 模式不需要穿越卡片墙；不要把已保存 masked key 显示成真实可复用的 API key；编辑模型列表时保留已验证的连接状态与用户密钥。预设数据一源化由 `ARCH-05` 先实施或提供过渡 adapter。

**AC**：已有 Provider 可两步内找到并测试；新用户可以明确从预设或自定义添加；已保存 key 不在屏幕/日志泄漏；搜索与分类仍覆盖当前目录；拉取模型失败显示具体可用错误码；原 Provider 测试通过。

### UI-07 / P1 — Agent Studio 说清“草稿/可用/已激活”

**文件**：`components/studio/AgentStudioComposer.tsx`、`AgentStudioInspector.tsx`、`components/CognitiveRulesDashboard.tsx`、`apps/local-server/src/routes/behaviorRoutes.ts`；配合 `packages/application/src/behavior/composeDraft.ts`。

**执行**：Agent 行为和系统安全展示为不同子区域。前者可以组合 Profile、规则优先级、模板、工具偏好；后者只读展示当前有效 Policy、来源、强制程度与失败原因。现有 Composer 仅 advisory，因此按钮文案固定为 **“验证候选配置”**，明确“未作用于正在运行的 Agent”。**不准只靠按钮重命名成“应用规则”**；若未来开发激活功能，必须有 `activation revision → compiler snapshot hash → run/session binding → effect scope` 的版本化后端契约和独立授权。

**AC**：验证通过时仍清楚标为未激活；compile failed 候选绝不启用；Policy 不可被行为模板移除或弱化；L0–L4 五级兼容性不再隐含跨 Harness 实际通过 live conformance。

### UI-08 / P1 — 隐藏未实现模块，禁止占位冒充产品

**文件**：`App.tsx`、`uiModules.ts`、`CustomizePanel.tsx`、各模块相关测试。

**执行**：`Context/Logs/MCP/Policy` 当前存在 `UNIMPLEMENTED` 标识；默认为用户隐藏，若开发者模式打开则显示 `Not available / Planned` 且禁用而非可勾选“空模块”。`ChangedFiles/Cost/ToolActivity` 在 `ModuleSection` 中返回 null 的分支应作为检查候选：如果数据已在 Conversation/Inspector 展示，则不应额外作为可勾选面板出现；删除 UI 入口不能删掉实际渲染器。对旧 localStorage modules state 迁移时忽略无效项，保留有效项。

**AC**：用户看不到“开启了但根本没有面板”的选项；所有标为已启用的功能可以被触达；旧配置加载无错误；未实现模块不占 DOM 空白。

### UI-09 / P2 — 对话与输入收束为高信噪比执行体验

**文件**：`ConversationView.tsx`、`MessageList.tsx`、`ToolActivityRow.tsx`、`TaskComposer.tsx`、`ComposerMeters.tsx`、`PlanChecklist.tsx`。

**执行**：主流只展示用户需求、阶段摘要、工具重要结果、待审批与最终 Diff。细工具调用默认可折叠，错误默认不可隐藏；不向主对话重复打印 AST/cache/所有追踪仪表。任务为空时输入器自适应紧凑，文字增长时增高；发送/停止/重试之间遵循状态机，不提供实际上不能执行的操作。确保 SSE streaming 时滚动尊重手动阅读：只有用户位于底部附近时自动滚动。

**AC**：真实运行 20+ 工具调用时页面仍可看清当前步骤；滚动到历史消息不会被新事件强制拉回底部；长输出不会撑爆窗口；Ctrl+Enter/Enter 与中文 IME 在发送前不冲突；停止失败不静默呈现成功。

### UI-10 / P2 — 响应式、可访问性、视觉审美的最终验证

**目标尺寸**：桌面 1440×900、宽屏 1920×1080 / 2560×1440、窄屏 1180、平板 800、移动 390×844；深色/浅色；英文/中文；高达 200% 浏览器缩放。

**验收重点**：

- 侧栏、Inspector、Provider Hub、命令面板不相互遮挡；所有模态窗 Escape 与 focus return 正确。
- `aria-expanded`、`aria-selected`、`role="status"`、错误提示有正确关联；Tab/Shift+Tab/方向键可操作；禁用状态原因可理解。
- 颜色对比度按 WCAG AA 基准检查：普通正文至少 4.5:1、大文本及 UI 组件关键图形至少 3:1；不能只凭颜色区分状态。
- 截图需要覆盖真实对话/审批/失败/恢复/Diff，而非仅首页。所有产品截图注明 commit 和测试环境；上一轮 ZIP 中的对话图需重新验证是否真正对应执行态。
- 不为了通过截图审美而隐藏关键错误反馈、减少可触达面积或破坏系统状态。

## 4. 精确 IA 规则：默认信息与高级信息分流

| 信息 | 默认主界面 | 次级/高级路径 | 呈现时机 |
|---|---|---|---|
| 项目与当前会话 | 显示 | — | 始终 |
| 模型易读名与权限等级 | 紧凑显示 | 详细 Provider/模型 ID | 任务创建/执行 |
| 工具调用过程 | 汇总当前动作 | 完整命令、参数、Trace | 需要调试时 |
| 计划与当前步骤 | 当前进展 | 完整 Task Tree | 运行中 |
| Diff/变更文件 | 结果入口 | Changes Inspector/Hunk | 产生改动时 |
| Approval/Deny | 显著卡片 | Policy 决策链 | 必须人工介入时 |
| Cache、AST 图谱、Compaction | 默认不显示 | Diagnostics | 特殊分析时 |
| Agent Teams/Swarm | 单 Agent 时不显示 | Execution | 实际有子代理时 |
| Provider 目录墙 | 不显示 | Settings → 添加 Provider | 添加配置时 |
| 服务器健康 | 正常弱化 | 状态详情 | 连接失败时提升 |
| Behavior IR 原始 hash | 不显示 | Studio → 有效快照 | 审查规则时 |

## 5. 从已有功能迁移，不制造重复实现

### 5.1 组件映射表

| 现有组件 | 决策 | 新位置/职责 | 注意 |
|---|---|---|---|
| `Rail.tsx` | 移除常驻展示；代码是否删除视回归结果 | Sidebar 末端导航 | 迁移四区域的 keyboard/tooltip/theme 操作 |
| `Sidebar.tsx` | 保留并简化 | 项目+会话+主导航 | 不在每行重复路径/时间全文 |
| `TaskComposer.tsx` | 保留 | 未创建任务时中心输入 | 与 `NewSessionForm` 的高级配置一致 |
| `ConversationView.tsx` | 保留 | 执行与对话主视图 | 不动 SSE 的既有契约 |
| `DualSurfaceLayout.tsx` | 保留并重组 | Inspector 3 组 | 保留旧命令与 localStorage 迁移 |
| `ActivityQueue.tsx` | 保留并修复 | 待处理、失败和进行中 | 遵从后端状态事实 |
| `AgentStudioComposer.tsx` | 保留，文案与权限分层 | 候选编译验证 | 不声称已激活 |
| `AgentStudioInspector.tsx` | 保留，专家模式 | 有效快照与规则来源 | 默认折叠原始数据 |
| `ProviderSettingsModal.tsx` | 保留表单能力、拆视图 | 已配置 Provider/添加流程 | 凭据遮蔽、模型选择回归 |
| `CustomizePanel.tsx` | 收窄选项范围 | Settings → 界面 | 禁止虚假的可勾选占位 |
| `CommandPalette` | 保留，增强动作映射 | 全局 Ctrl+K | 新旧入口对照回归 |

### 5.2 Inspector 向后兼容迁移草案

```ts
// 本段为迁移示例，不是现有源码。
const inspectorMigration = {
  patch: ['changes', 'patch'], ast: ['changes', 'impact'],
  tasks: ['execution', 'tasks'], swarm: ['execution', 'agents'],
  trace: ['diagnostics', 'trace'], context: ['diagnostics', 'context'],
  cache: ['diagnostics', 'cache'], cognition: ['diagnostics', 'behavior'],
} as const;
```

保留原始 `InspectorTab` 命令 ID 映射与序列号，避免 `App.tsx` 中 `requestView(tab)` 旧指令无法工作。切换 Inspector 的 session 时优先确保当前会话 ID 隔离，避免上一会话的 Diff 数据短暂闪现。

## 6. 不可跳过的浏览器端到端场景

| 用例 | 操作 | 必须观察的结果 | 关联 |
|---|---|---|---|
| E2E-01 | 首次启动无 Provider | UI 明确引导添加模型或 mock 限制 | UI-03/06 |
| E2E-02 | 创建任务并自动执行 | 创建后进入唯一会话、首条消息只发一次 | UI-03/09 |
| E2E-03 | 正在输出时切到别的会话再返回 | 不串消息、不丢用户草稿 | UI-09 |
| E2E-04 | 单个删除模拟 500 | 不假删除、明确重试 | UI-01 |
| E2E-05 | 一个 Topic 批量删除，部分失败 | 成功项消失，失败项仍在 | UI-01 |
| E2E-06 | 工具失败/网络中断 | Activity 不标完成，UI 提供恢复/错误 | UI-02/09 |
| E2E-07 | Activity 点击 team/subagent/goal | 路由至对应详情，不打开幽灵会话 | UI-04 |
| E2E-08 | 新增自定义 Provider、测试、重选模型 | 既有凭据未泄漏，测试与保存语义准确 | UI-06 |
| E2E-09 | Studio 候选 compile rejected | 不可激活，错误来源明确 | UI-07 |
| E2E-10 | 旧 Inspector localStorage 选中 `cache` | 自动导航 Diagnostics/Cache | UI-05 |
| E2E-11 | 800px 与 390px 打开导航、Inspector、命令面板 | 焦点与 Escape 正常、无横向裁切 | UI-10 |
| E2E-12 | 真实会话包含 diff / approval / >20 工具调用 | 内容可读、审批可操作、Diff 审阅不丢失 | UI-09/10 |
| E2E-13 | 中文 IME 组合输入并按 Enter | 不误发半个词，Shift+Enter 可换行 | UI-09 |
| E2E-14 | 刷新正在运行的页面 | 重新获取真实状态，绝无虚假成功 | UI-02/09 |

UI-01 与 UI-02 的真状态需要架构 `ARCH-02` / `ARCH-01` 先修；没有前置条件时只完成 UI 骨架会产生错误结果。

## 7. 迭代计划（每一轮可独立验收、可回滚）

| 批次 | 工作包 | 允许改动范围 | 里程碑完成判据 |
|---|---|---|---|
| U0 | UI-01 + UI-02 | UI + API 协议对应修复 | 用户数据/状态不会假成功 |
| U1 | UI-03 + UI-04 | `App`, `Sidebar`, `Rail`, Activity, CSS | 默认导航从“双主导航”归一到一个 |
| U2 | UI-05 + UI-08 | Inspector, Customize, command IDs | 8 个专业能力保留、3 组入口、占位不误导 |
| U3 | UI-06 + UI-07 | Provider, Studio, i18n | 设置与规则语义不混淆 |
| U4 | UI-09 + UI-10 | 对话、输入、测试、CSS | 真实任务四态/窄屏双主题视觉验收 |

**UI 完成的定义是“用户完成任务的成本下降且行为正确”，不是“删掉多少组件/行数”。** 每轮用导航任务路径长度、误操作、状态错误、审查 Diff 的成功率，以及键盘可达性评估。降低认知负担与保持功能完整必须同时满足。

## 8. Agent 执行手册与门禁

### 8.1 在运行前读取

```text
1. AGENTS.md
2. HANDOFF.md（明确识别历史/当前描述，不覆盖本审查 SHA）
3. docs/DESIGN-DECISIONS.md
4. docs/plans/Vessel_Web_UI_UX_Improvement_Plan.md（历史已实施内容）
5. tasks/218-web-ui-ux-workbench-improvement-implementation.md
6. tasks/223... tasks/235...（重点 229–235；避免重复实现）
7. 本文 + 同版本架构规范
```

### 8.2 实施禁止项

- 不把源代码文件打包“重做”当优化，不擅自迁移 Vite/React/npm。
- 不让 UI 消费模型自由文本来决定是否已获得授权；一切审批以服务器可验证结果为准。
- 不扩大权限或把安全策略从运行时挪到 Prompt。
- 不因移除可见模块就删除后台事件、回放、审核或诊断代码。
- 不在用户工作区永久删除数据；遵守回收站协议和 npm/test 隔离约束。
- 不为了降低信息密度隐藏 error、cancel、unknown 或待审批。
- 不自称已经运行浏览器、完成用户视觉验收或执行了 live Agent，除非确有日志/证据。

### 8.3 推荐验证命令（在用户工作区执行）

```powershell
npm ci
npm run build
npm run typecheck:tests
npm run -w @vessel/web typecheck
npm run -w @vessel/web build -- --emptyOutDir false
npm run test:all
```

此外必须运行浏览器交互走查（可复用仓库 `scripts/run-browser-agent-walkthrough*.py`，先检查其当前适用性），生成真实截图 + 可追溯录屏/日志；只凭单元测试的交付不能关闭 E2E 条目。

### 8.4 每张 UI 卡的 Agent 汇报模板

```markdown
### UI-XX 完成记录
- 本轮 Git SHA / 工作区状态：
- 原问题源码证据 + 复现步骤：
- 修改的组件 / 状态契约 / i18n keys：
- 被隐藏但保留的能力映射：
- 交互前后路径和变化：
- 桌面/800px/390px + dark/light 截图证据：
- 键盘与无障碍检查：
- 自动测试和实际执行结果：
- 真实浏览器 E2E 结果：
- 独立 Reviewer 意见：
- 风险/回滚命令/残留事项：
```

## 9. 需要补充的运行时证据（非静态实施前置条件）

- **最优先**：一段真实会话录屏（任务输入→工具流→审批或失败→Diff→结束），分辨率至少 1440×900；另提供一次 800px 下的操作演示。
- 和录屏一致的脱敏 `Run/Session` 事件流（包括 tool calls、approval、final status），便于核对 UI 是否按事件事实显示。
- 任选 3 个典型真实任务：小修复、跨文件重构、使用 Subagent 的并行审查。用来测默认信息密度是否合适。
- 如果以后希望做完全无边框的像 Codex 桌面端那样的产品，需要说明是否准备做本地桌面壳；现阶段在 Web 中优先保证浏览器和移动端布局，不提前造 Electron/Tauri。

## 10. 外部产品参考（截至 2026-10-20）

- OpenCode V2.1.0：<https://opencode.ai/changelog>。借鉴 TUI Todo 的按需展示、长执行过程不丢连接和 Diff 审查，而不是再开一个重复“任务系统”。
- OpenCode V2.0.30：<https://opencode.ai/changelog>，按 Turn 的 Changed Files 与 docked diff；对应本方案的 Changes Inspector。
- DeepSeek Harness：<https://github.com/deepseek-ai/deepseek-harness/releases>。借鉴插件按需加载、会话输入恢复和 minimal/advanced 分层；不必把所有插件配置常驻主界面。
- Codex：<https://github.com/openai/codex/releases>。借鉴执行期间 steering、权限恢复、搜索式配置和重连反馈。
- Claude Code：<https://code.claude.com/docs/en/agents> 与 <https://code.claude.com/docs/en/agent-teams>。轻量委派优先，Team 使用要与真正可见的协作价值对应。

## 11. UI 最终 DoD：未完成就不能关闭整改

- [ ] 无“Rail + Sidebar”两套常驻主导航；四区能力仍能到达。
- [ ] 首页到首个任务执行路径明确；高级权限/模型选择仍可访问。
- [ ] 删除出现部分失败时不假成功；不会静默隐藏数据。
- [ ] Activity 状态来自权威事件；失败、未知、取消不显示完成。
- [ ] 各类 Activity 项正确跳转，审批只依据可验证后端结果。
- [ ] Inspector 统一三组，八项原专业能力与 Ctrl+K 旧入口等价可达。
- [ ] Provider 已配置/添加流程分离，凭据安全、模型搜索与能力探测无回归。
- [ ] Studio 明确 staged/verified/active 区别，绝不宣称验证即激活。
- [ ] 未实现的可勾选模块被隐藏或明确标记计划中，不出现“开启却为空”。
- [ ] 1440、1180、800、390 四个关键宽度下深浅双主题均可用，语言不溢出。
- [ ] 不仅 Vitest/构建通过，而且完成 E2E-01~14，有实际截图与失败/审批/审查证据。
- [ ] 源码 Reviewer 与 UX Reviewer 均签收，变更可回滚，架构契约未被 UI 偷偷修改。

**终局标准：用户不必先理解 Harness，便能从输入任务直接走到可审查、可恢复、可解释的结果；需要专家诊断时仍能无损深入全部已有能力。**
