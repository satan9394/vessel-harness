# Vessel Web UI/UX 整改与产品工作台实施规范

> **文档编号**：VESSEL-UI-2026-01  
> **版本**：v1.0（建议稿）  
> **适用基线**：Vessel v0.10.0 当前 Web 截图  
> **目标定位**：**Vessel — Composable Agent Workbench（可组合 Agent 工作台）**  
> **范围**：信息架构、首页、会话、工作台、模型管理、命令面板、权限、Inspector、响应式、视觉语言、可用性与前后端契约  
> **不包含**：AgentLoop、Policy、Compaction 等后端机制的实现规范（见独立文档 `Vessel_Harness_Architecture_Improvement_Plan.md`）  
> **证据性质**：依据用户提供的 6 组 UI 截图（含中英文版本）、前述两轮反馈以及 Harness 设计图。**未提供当前完整会话执行页面、交互录屏或前端源码**；截图没有展示的功能不得直接判定为“未实现”。

---

## 0. 总结：从“设置弹窗 + 会话列表”转型为 Agent 工作台

截图证明 Vessel 目前已经有本地 Server 状态、项目与历史会话、新建会话、Provider 设置、命令搜索和模块显示选择等基础 Web 元素。瓶颈主要是**信息架构与任务路径**，而不是配色过于朴素。

**目标体验**：用户能够迅速选择项目并开始任务；运行期间清楚看到目标、步骤、权限、工具执行、文件变更和结果；进阶用户可以进入独立的 Agent Studio 组合与验证行为配置；整个 UI 不产生独立于 Harness 的执行真相。

### 建议总决策

1. Web 成为当前主交互界面；Runtime 不嵌入 Web，CLI/TUI 与后续 Desktop 复用同一 Session/Run API。
2. 将一级产品区域控制为 **Workbench / Activity / Agent Studio / Settings**；不要把所有功能平铺到首页。
3. Workbench 推荐**左侧项目与会话 / 中间执行对话 / 右侧上下文 Inspector**，右侧按需显示，窄屏自动折叠。
4. 新建任务改为**选择项目 → 输入任务 → 开始**；模型/权限/模式在输入区附近显式可见，保留进阶设置入口。
5. 严格区分 **Capability（功能启用）/ Policy（权限）/ Visibility（显示）**，Customize 仅改变布局，不改变执行语义。
6. 不显示大段 Debug IDs、重复的 `Untitled topic` 或永久占位卡；技术细节放到 Inspector/详情面板。
7. 把 **Run 状态、审批、Diff、任务树**放在明显位置；让 Harness 能力在 UI 中可观察、可解释。

---

## 1. 输入截图与观察记录

### 1.1 用户提供的截图（去除中英文重复信息）

| 编号 | 文件 | 直接观察到的内容 | 审查结论 |
|---|---|---|---|
| UI-01 | `01-workbench-overview.png` | 顶部 Server OK、模型设置/通知/命令/自定义；左侧 Project 和多条 Untitled topic；主体欢迎文案与 Goals、Changed Files 占位 | 首页缺少任务输入主入口；信息密度分配失衡 |
| UI-02 | `02-provider-settings.png` | DeepSeek Preset、Provider Name、OpenAI Compatible、Base URL、API Key、逗号分隔模型列表、拉取/测试/保存 | 基础接入可用，但 Provider 与 Model 管理需分离 |
| UI-03 | `03-command-palette.png` | 同一列表混合系统操作、新建会话和大量 `sess_...` 及长路径 | 搜索结果缺少语义分组、标题与上下文 |
| UI-04 | `04-new-session.png` | 先选 Offline demo Model、权限、手填 Workspace Root、再创建 | 默认流程配置优先，任务输入延后；缺少项目选择器 |
| UI-05 | `05-customize-modules.png` | Swarm/Cognition/Team/Goals/Changed Files/Context/Tool Activity/Logs/Cost/MCP/Policy 勾选项 | Display Modules 与功能开关可能被用户混淆；需要信息分层 |
| UI-06 | `06-mobile-responsive-800px.png` | 侧栏仍占较宽空间；顶栏长文本与按钮多行堆叠，状态文本纵向变窄 | 需要结构性响应式切换，而非仅 Flex Wrap |

**未证实事项**：Provider 连接是否真的失败；Change Files 是否有其他入口；Session 页面是否有 Diff/Tool/Approval；是否已经存在 Run API、键盘快捷键或 Session 标题生成；API Key 是否安全存储。这些应在前端/后端代码审查阶段核实。

### 1.2 产品参照与边界

来自此前对比研究的设计启发：

- **OpenCode**：轻量 TUI/CLI 操作效率、命令式导航、项目/会话一致性、多前端共享后端。
- **Codex**：项目下多任务/线程、并行执行、Diff 审阅与任务监督。
- **Claude Code**：运行过程、Plan、授权与代码变更之间的紧密反馈。
- **DeepSeek Harness / DSH**：本地 Web 入口、可组合的模式与按会话变化的右侧工作区。

这些是要比较的**交互设计原则**，不是要求与竞品逐项完全同构；版本和具体能力在实施阶段以官方产品当前版本再验证。Vessel 的区别应落在 Behavior IR、Policy、Context 和 Conformance 的可见性，而非把四套界面拼接起来。

---

## 2. 信息架构（IA）：定义一级区域与对象层级 [UI-P0]

### 2.1 推荐导航

```text
Vessel
├── Workbench             日常工作（默认入口）
│   ├── Projects           项目列表 / 最近项目
│   └── Sessions           按项目聚合的会话
│       └── Runs           当前会话内的执行时间线
├── Activity              跨项目运行状态 / 待审批 / 失败 / 历史
├── Agent Studio          Behavior Library / Composer / Compile & Verify
└── Settings              Providers & Models / Permissions / Tools / UI Preferences
```

不要在侧栏同时以未定义的近义词呈现 `Topic` 和 `Session`。如果后端存在 Topic 聚合，明确它是 Session 的上级对象；否则将用户界面统一称为 Session/会话，内部 ID 可以保留旧词以平滑迁移。

### 2.2 五个核心对象

| 对象 | 归属/生命周期 | UI 可见字段 | 关键操作 |
|---|---|---|---|
| Project | 工作目录或仓库 | 名称、相对路径、最近活动、当前分支（若可用） | 打开、固定、切换、创建任务 |
| Session | 项目下持续的上下文和任务对话 | 标题、最近更新、状态、模型/配置摘要 | 打开、重命名、归档、搜索 |
| Run | 单次执行状态机 | Running/Waiting/Failed 等、耗时、进度 | Stop、Resume、Inspect、Review |
| Agent Preset | 可复用配置 | 名称、有效版本、兼容等级、权限摘要 | 选择、克隆、编辑、测试 |
| Subagent | 父 Run 的执行子实例 | 角色、任务、状态、所用模型、结果 | 查看详情、跳转父任务 |

不要把“代理网络”直接作为项目树的一部分。Subagent 默认附属于 Run/Task Tree；Activity 可以提供跨项目聚合视图。

### 2.3 左侧导航尺寸建议

桌面默认宽度约 `240–280px`（可调），窄屏折叠。顶部品牌区不应大于必须；Project 为主分组，Session 行展示：标题（单行省略）＋状态点＋上次活动。项目路径使用次要提示或 tooltip，不默认显示长绝对路径。重命名/归档放入行操作 `···`。

**标题策略**：未输入任务前可显示“新会话”；第一条有效任务产生标题候选后允许编辑。不要强制即时依赖模型生成标题；失败时用第一条任务摘要做确定性回退。

---

## 3. 首页与首次启动体验 [UI-P0]

### 3.1 首页按状态渲染，而非固定两张卡片

| 状态 | 主体 UI | 主要行动 |
|---|---|---|
| 没有项目 | 欢迎标题、选择目录、最近目录（若有） | Open Project |
| 有项目、没有会话 | 当前 Project 标题、任务输入框、模型/模式/权限选择 | Start Task |
| 有历史但当前无 Run | 最近任务、继续会话、快捷新任务 | Resume / New Task |
| 存在运行中或待审批任务 | Active Runs、待审批强调、当前项目任务入口 | Review / Inspect |
| Server 断线或 Provider 不可用 | 服务/配置异常状态、重试入口、只读历史 | Reconnect / Configure |

**删除/隐藏默认首页中的永久占位**：`GOALS` 和 `CHANGED FILES` 如果没有当前项目/Run 数据，不应常驻占据主要视线。若功能未实现，应该在开发模式/功能介绍中标记，而不是普通用户的核心卡片。

### 3.2 推荐首页线框（桌面）

```text
┌───────────────────────────────────────────────────────────────────────┐
│ Vessel  /  Composable_Agent_Harness       [Search] [Activity] [Menu] │
├──────────────────┬────────────────────────────────────────────────────┤
│ Projects         │ Composable Agent Harness                           │
│  • Composable... │ E:/Code_file/Projects/...        [Open folder]     │
│                  │                                                    │
│ Recent Sessions  │ What should Vessel work on?                         │
│  ○ Refactor ...  │ ┌────────────────────────────────────────────────┐ │
│  ◉ Policy...     │ │ Describe a task... @files /commands           │ │
│  ○ Context...    │ └────────────────────────────────────────────────┘ │
│                  │ [Model ▾] [Agent ▾] [Plan ▾] [Workspace write ▾] [▶]│
│                  │                                                    │
│                  │ Continue work                                      │
│                  │ [Run A: Waiting Approval] [Run B: Completed]       │
├──────────────────┴────────────────────────────────────────────────────┤
│ Status: server connected · active project · 1 task needs approval     │
└───────────────────────────────────────────────────────────────────────┘
```

所有条目仅作线框示例，不是已证实的运行状态。

### 3.3 首页交互验收

- 首次已经有有效 Project/Provider 的用户，直接输入任务即可执行，不强制打开模型设置。
- 可以明确区分“当前项目路径”与历史会话所关联的工作区。
- 没有任务时不显示假的 Goals/Changed Files 数据。
- 连接异常不阻止浏览已持久化且允许读取的 Session 历史。

---

## 4. 新建会话与任务启动 [UI-P0]

### 4.1 修改默认路径

当前：`New Session → Model → Permission → Workspace Root → Create → 才能输入任务`。

建议：`Project → Task Input → (Model / Agent / Mode / Permission) → Start`。

需要支持两种入口：

- **快捷新任务（默认）**：当前工作区已选，输入任务并提交后创建 Session 与 Run。
- **高级新会话**：显式创建空 Session，支持自定义 Agent Preset、Model Profile、权限和 Project Root。保留高级入口是为了兼容脚本/调试需求。

### 4.2 控件数据来源与失败态

| 控件 | 数据来源 | 异常/缺省处理 |
|---|---|---|
| Project | 本地服务允许访问的最近目录 | 无效路径阻止执行，提供重新选择 |
| Model | 经过校验或配置的模型列表 | 不可用时显示原因；不可静默换模型 |
| Agent | 已发布且可编译的 Effective Preset | 不兼容时明确阻止选择或标降级 |
| Execution Mode | Plan / Execute / Review（若后端支持） | 未实现的模式不可出现为可点击入口 |
| Permission | 实际 Policy Profile | 显示有效权限摘要，不能用 UI 开关改写既有 Run |
| Task | 用户自然语言＋引用资源 | 空文本不发起 Run；可保存草稿 |

**Offline demo** 应标记为“演示模型（不会连接真实 Provider）”，不要和线上模型在身份上混淆。加载过程中保留“当前已选择值 + 加载状态”，失败时提供重试，并解释对创建任务的影响。

### 4.3 安全边界

UI 显示的 `Workspace write` 是权限声明，不是最终授权依据。所有写文件与 Shell/MCP 执行都以 Backend Policy/Executor 的裁决为准。更换新 Session 权限不得静默扩大正在运行的旧 Session 权限。

---

## 5. 主工作台：三栏布局与简洁执行时间线 [UI-P1]

### 5.1 总体结构

```text
┌──────── Navigation ───────┬──────────── Conversation / Run ───────────┬──────── Inspector ───────┐
│ Projects / Sessions       │ Breadcrumb  Project / Session            │ Tabs: Changes / Tasks    │
│  ● Running task           │ Active Model · Mode · Permission         │       / Context / Trace  │
│  ! Waiting approval       │                                          │                       │
│  ○ Completed task         │ User request                             │ Changed Files           │
│                           │ Agent message                            │  fileA.ts +18 -5        │
│ Activity shortcuts        │ ▸ Tool: read_file (completed)            │  fileB.ts modified      │
│                           │ ▸ Tool: shell (approval needed)          │                       │
│                           │ Task checklist / status                  │ Selected change / Diff  │
│                           │                                          │                       │
│                           │ [Message @files /commands ...]  [Send] │                       │
└───────────────────────────┴──────────────────────────────────────────┴───────────────────────┘
```

**默认策略**：简单任务只显示简洁对话与必要状态；复杂任务按需展开 Tool Call、Plan、Diff 和 Trace。将专业能力作为“可检查层”，而不是对每条模型响应都显示完整调试日志。

### 5.2 Conversation 时间线信息层级

1. 用户输入与文件引用。
2. Assistant 的对用户可呈现内容。
3. Run/Step 状态（Executing、Waiting Approval、Cancelled、Failed、Completed）。
4. Tool Activity：默认折叠显示工具名、动作、耗时、结果；展开时才显示经脱敏的参数/输出。
5. Approval Card：固定而明显地显示拟执行操作、影响范围、可选操作。
6. Result Summary：完成工作、变更文件、测试结果、未完成项。

不要用原始 Provider `reasoning` 或内部推理流代替任务进度解释。可以公开展示任务计划、可验证步骤、工具记录、结果和风险提示。

### 5.3 Inspector 推荐标签

| Tab | 默认可见条件 | 功能 |
|---|---|---|
| Changes | 有文件变更时优先 | 文件列表、Diff、接受/回退（若后端支持） |
| Tasks | 有 Plan 或多 Step 时 | 执行列表、进度、失败/阻塞原因 |
| Context | 进阶查看 | 层组成、有效快照版本、压缩事件 |
| Activity | 有工具调用时 | Tool Call 详情、模型步骤、时间线 |
| Policy | 需要审批/存在拒绝时优先 | 有效授权、审批历史、拒绝原因 |
| Cost | Provider 支持计量时 | Token、费用估计、预算 |
| Trace | 开发者模式 | 结构化 Event/Run/Step 诊断 |

MCP 是工具来源与连接管理能力，默认不必为每个 Session 占一个常驻 Inspector Tab；优先放 `Settings → Tools & MCP`，当前工具事件仍在 Activity 中可见。

### 5.4 高级布局策略

- Inspector 打开状态及上次 Tab 按项目/会话适度记忆。
- Panel 支持拖动宽度，但不应在 P1 之前实现任意多 Dock 或嵌套拖拽。
- 主聊天区保证最小可读宽度，右侧 Inspector 优先被折叠。
- 只有合法 Backend Action 可以触发状态修改。Web 不凭借前端按钮点击就立即显示“工具执行成功”。

---

## 6. 模型管理：从表单升级为 Provider / Model Registry [UI-P1]

### 6.1 新页面结构

```text
Settings / Models & Providers
┌────────────────────────────┬─────────────────────────────────────────┐
│ Providers                  │ Provider Detail                         │
│  DeepSeek    [Connected]   │ Name / Protocol / Endpoint             │
│  OpenAI      [Configured]  │ Credential status [Update] [Remove]     │
│  Local       [Unverified]  │ [Test connection] [Discover models]     │
│  [+ Add Provider]          │                                         │
│                            │ Models                                  │
│                            │  Model ID | Status | Capabilities       │
│                            │  ...                                    │
└────────────────────────────┴─────────────────────────────────────────┘
```

将用户目前手动输入的 `deepseek-chat, deepseek-reasoner` 解析成独立记录，并兼容旧配置的导入/导出。模型列表支持搜索、状态过滤与能力标签，不依靠可维护性差的逗号分隔大文本框。

### 6.2 三种健康状态

- **Configured**：本地保存设置，但没有确认可调用。
- **Connected/Verified**：近期真实连接测试通过（带测试时间）。
- **Unavailable/Error**：当前请求失败，附失败原因/建议处理方式。

“服务器在线”不等于“Provider 可用”，应分开表达。并避免将因本地网络/限流导致的失败直接推断为 Provider 永久不可用。

### 6.3 安全处理

API Key 不回显明文；可更新、清除；展示是否已配置与更新时间；不要将 API Key 送往前端全局状态持久层、事件日志或 Telemetry。真实密钥存储安全需要后端验证，文案必须与实现一致。

### 6.4 Capability 状态可见

至少展示 Tool Calling、Streaming、Context Window、Structured Output、Reasoning、Multimodal、Usage Reporting 等信息来源；区分 `Detected / Declared / Unknown`。该信息应由 Backend `ProviderCapabilities` 返回，与 Behavior L2 编译用的是同一有效能力快照。

---

## 7. Command Palette：高频操作入口，而非 ID 列表 [UI-P1]

### 7.1 当前问题

截图中 `Model settings`、`New Session`、沙箱会话创建和大量 `sess_...` 混在单层结果列表。原始 Session ID 长、重复路径多，导致结果缺乏辨识度。

### 7.2 建议的分组与搜索

| 结果组 | 第一行 | 第二行 | 右侧 |
|---|---|---|---|
| Actions | “新建任务” | 当前项目 | 快捷键 |
| Sessions | “Review policy engine” | 项目 · 上次活动 | Run 状态 |
| Projects | “Composable Agent Harness” | 规范化路径 | 最近使用 |
| Agent Presets | “Research Agent” | 适配状态 | 适用模型 |
| Navigate | “查看 Diff” | 当前 Run | 位置 |
| Commands / Skills | `/test` 或 Skill 名称 | 说明/参数 | 权限提示 |

支持 Ctrl/Cmd+K、箭头导航、Enter 执行、Esc 关闭、模糊检索和常用项排序。跨平台快捷键通过系统识别切换显示。命令面板不是关键能力的唯一发现入口。

### 7.3 权限与结果安全

Command Palette 中的写操作、Shell 命令仍必须经过统一 Policy；搜索结果与快捷键不能绕过审批。`sess_*` 保留在 Developer Details 或复制 ID 操作中，不默认显示。

---

## 8. Customize、Agent Studio 与配置边界 [UI-P1/P2]

### 8.1 将当前 Customize 明确更名为 Layout

截图显示 `DISPLAY MODULES`，因此现有勾选项应被视为**可见性开关**。为了阻止误解，分离：

1. **Layout / Visibility**：显示或隐藏右侧 Inspector 的某个 Tab，不修改任何后端能力。
2. **Capability**：启用/禁用 MCP、子代理调度等能力，需后端校验。
3. **Policy**：真正的工具/文件/审批权限，由 Backend 版本化执行。

“隐藏 Policy”绝不能等同于关闭 Policy，“隐藏 Team”也不能终止正在运行的子任务。

### 8.2 简化 Layout Presets

- **Focus**：左侧可折叠、中间对话优先，不常驻 Inspector。
- **Coding**：右侧优先 Changes/Diff。
- **Execution**：右侧优先 Tasks/Activity/Policy。
- **Inspect**：右侧优先 Context/Trace/Cost。

允许用户个性化顺序与展开状态，但先实现 Preset + Tabs + Resize，完整自由 Docking 放到后期，避免前端复杂性暴涨。

### 8.3 建议的 Agent Studio（Vessel 核心差异化）

```text
Agent Studio
├── Library
│   ├── Imported Prompts / Behaviors
│   ├── Presets / Skills
│   └── Compatibility: Importable / Renderable / Mappable / Enforceable / Verified
├── Composer
│   ├── 行为组合与优先级
│   ├── 模型与工具作用域
│   ├── 冲突检查 / Policy 关联
│   └── 生效配置预览
└── Compile & Verify
    ├── L0 → L1 → L2 → L3 → L4 生效链
    ├── 编译错误 / 降级警告
    ├── Policy Enforcement Mapping
    └── Conformance Report
```

**重要前置条件**：只有当 Harness 中 Behavior IR 的有效快照、编译错误和 Conformance 数据稳定后，才应实现可编辑的 Studio。早期可先做只读 Inspector，防止前端呈现未真正生效的“配置”。

Agent Studio 可按三个问题组织：**导入了什么？实际编译成了什么？能否验证它运行时遵守了这些要求？**

---

## 9. Run 状态、审批与多任务 Activity [UI-P0/P1]

### 9.1 Run 状态展示标准

| Backend Run State（建议） | UI 文案 | 默认操作 |
|---|---|---|
| CREATED / PREPARING | 准备中 | 查看配置、取消（若允许） |
| RUNNING | 运行中 | 查看进度、停止 |
| WAITING_APPROVAL | 等待授权 | 查看操作、批准/拒绝 |
| SUSPENDED | 已暂停 | 恢复、查看原因 |
| FINALIZING | 正在完成 | 查看检查项 |
| COMPLETED | 已完成 | 查看结果、Diff |
| DENIED | 已拒绝 | 查看规则与原因 |
| FAILED | 执行失败 | 查看错误、可恢复动作 |
| CANCELLED | 已取消 | 查看终止原因 |
| EXHAUSTED | 达到执行限制 | 查看预算、重新规划 |
| OUTCOME_UNKNOWN（工具结果） | 工具结果待确认 | 核验，不默认重试 |

状态应来自后端事件和快照，而不是前端根据“消息加载完毕”猜测完成。若 Runtime 尚未支持某状态，应在实施前统一 Backend State Mapping。

### 9.2 Approval Card 必需字段

- 操作对象与规范化工具名（例如 Shell/MCP/文件写入）。
- 目标资源（路径/仓库/外部系统）及参数摘要。
- 预期影响与限制说明（必要时明确未知）。
- `Allow once` / `Deny`；可扩展“本次受限范围允许”，但必须由后端提供其精确作用域。
- 审批前后状态、提交中禁用重复点击、审批过期/配置变化时重新评估。

审批不能把 UI 的点击直接当成永久授权。审批决策要与当前 Operation Hash、Policy Revision 等绑定（对应 Harness 文档 ARC-05）。

### 9.3 Activity 独立区域

按 `Needs attention / Running / Completed / Failed` 提供跨项目列表。用户可从任何区域定位待审批任务，并跳转到对应 Session/Run 的上下文。不建议默认把 Activity 设计成复杂“节点网络图”；可靠的任务树、依赖和状态先于炫目的动画。

---

## 10. 响应式与自适应行为 [UI-P1]

### 10.1 推荐起始断点（需实测调整）

| Viewport | 行为 | 不应出现的问题 |
|---|---|---|
| `>= 1440px` | 左导航 + 主内容 + Inspector 三栏 | 任何一栏失去最小可读宽度 |
| `1024–1439px` | 默认双栏，Inspector 以右侧抽屉/覆盖层展开 | 顶部操作栏超宽堆积 |
| `768–1023px` | 左导航折叠为抽屉；主内容优先 | 左侧固定栏持续挤压会话 |
| `< 768px` | 单栏、顶部极简、底部输入、侧栏和检查器抽屉 | 横向滚动或重要按钮离屏 |

断点为建议，不是从原截图测出的可靠设备宽度。需要使用 CSS viewport 测试，并在中文、英文、200% 文本缩放情况下分别验证。

### 10.2 顶栏瘦身

桌面顶栏建议包含：Project/Session 标识、当前 Run 状态、搜索入口、Activity 通知与溢出菜单。

`Model settings / Mute cues / Notifications / Commands / Customize / English` 不应全部永远平铺在顶部。模型选择放输入区或 Session Header；声音/语言/主题进 Preferences；Commands 使用显式搜索图标＋快捷键；服务健康可用小状态入口查看完整详情。

### 10.3 对截图中 800px 缺陷的具体修复

- Server Status 左右 flex 区域设置 `min-width: 0`、单行摘要和省略，点击查看详情。
- 顶栏按钮不要依赖 `flex-wrap` 任意换行，收进 `More` 或侧边抽屉。
- 左侧栏在 Tablet 断点变成 Drawer，不再和主内容永久并列。
- Goals/Changed Files 从首页固定横向卡片改为上下文触发显示。
- Modal 在窄屏改成接近全屏的 Sheet，输入框和确认按钮保持可见。
- 主对话输入区宽度适配，避免固定 px 造成屏幕溢出。

### 10.4 方向正确性的响应式测试

测试视口至少包括 375×812、390×844、768×1024、800×900、1024×768、1280×800、1440×900；还需检查系统缩放 125%/150%、文本 200% 和中英文切换。不能仅凭桌面 DevTools 的一个分辨率通过验收。

---

## 11. 视觉语言与组件系统 [UI-P1]

### 11.1 设计方向

保持中性、紧凑、清晰的开发者工具风格。无需为“高级感”引入大量玻璃拟态、渐变、发光边框。区分三种视觉层次：**全局导航、主任务、运行证据**。蓝色用于主操作与当前选中项；成功/危险/待授权必须使用文字和图标共同表达，不能只靠颜色。

### 11.2 Token 建议（初始值，不是冻结实现）

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --font-ui: system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-code: ui-monospace, "Cascadia Code", "SFMono-Regular", monospace;
  --sidebar-width: 256px;
  --inspector-width: 360px;
}
```

真正的 Light/Dark/System 配色值应由视觉稿及 WCAG 对比度测试定稿。建议字体层级：正文 14–16px、次要 12–13px、标题 18–24px，路径和代码使用等宽字体。中文与英文字体需要做混排宽度测试。

### 11.3 组件基础清单

- `AppShell / Sidebar / TopBar / OverflowMenu`
- `ProjectSwitcher / ProjectRow / SessionRow / RunStatusBadge`
- `TaskComposer / ModelPicker / AgentPicker / ModePicker / PermissionPicker`
- `RunTimeline / AssistantMessage / ToolActivityCard / ApprovalCard / ResultSummary`
- `InspectorDock / DiffViewer / TaskTree / ContextPanel / PolicyPanel / TracePanel`
- `CommandPalette / ModelRegistry / ProviderDetails / CredentialStatus`
- `EmptyState / LoadingState / ErrorState / OfflineState / NotificationCenter`

**必须有组件契约**：Props、状态类型、禁用条件、键盘操作、Loading/Error/Empty 用例、埋点与权限语义。不能仅依据截图复刻而忽略真实交互状态。

---

## 12. 与 Harness 的 API/事件契约（跨文档接口）

### 12.1 最小后端能力依赖表

| 前端能力 | 依赖的 Backend Contract | 不能由前端代替的职责 |
|---|---|---|
| 首页/Session 列表 | Project、Session Query、Recent Activity | 真实 Session 关联与状态 |
| Composer | Model Registry、Agent Preset、Effective Permission | 能力冲突检查与权限上限 |
| Run Timeline | Run Snapshot + Event Stream + Cursor | 事件排序、重放、终态判断 |
| Approvals | ApprovalRequest + Decision Submission | Policy 复核、permit、审计 |
| Diff | File Change / Patch Artifact | 变更来源与写入权限判定 |
| Context Inspector | Surface Revision + Compaction Metadata | 摘要来源与生效快照 |
| Agent Studio | L0–L4 Compile/Verify/EffectiveSnapshot | 强制项的编译与验证 |
| Cost | Usage/Cost Report | Provider 计量口径、预算 |
| Activity | 多 Run 聚合查询 | Run 的跨客户端单一真实状态 |

### 12.2 UI 状态消费原则

**1. Snapshot + Stream**：页面首开先拉当前后端快照，再订阅带 cursor 的事件；服务端应提供单调序列，前端去重并校验连续性。发现缺口时重取快照，不盲目拼接。

**2. Optimistic UI 的边界**：可以提前显示“正在提交审批/正在请求取消”，但在后端确认前不可显示“已批准/已停止/执行成功”。

**3. 分离前端布局状态**：当前 Tab、面板宽度、主题、字体密度属于 UI Preferences；Policy/Capability/Run State 属于后端数据，不能由 Local Storage 的面板开关影响。

**4. 隐私/安全**：Provider 密钥不进浏览器持久化；日志面板默认折叠/脱敏敏感参数，复制 Trace 要标记是否可能包含敏感信息。

**5. HTTP 本地服务安全**：如果 Server 仅用于本机，仍应明确绑定地址、跨源请求策略、会话认证、CSRF/本地网页越权风险。尤其不应假设 localhost 端口自动安全。实施细节由后端安全设计确认。

### 12.3 推荐事件示例（示意）

```json
{
  "sessionId": "s_123",
  "runId": "r_456",
  "seq": 318,
  "type": "tool/approval_requested",
  "payload": {
    "approvalId": "a_789",
    "toolId": "builtin:shell/execute",
    "scopeSummary": "Workspace write",
    "status": "waiting"
  }
}
```

示例只用于 UI 契约讨论，字段必须最终与架构文档中的 Event Catalogue 保持一致；绝不能将这个示例当作已存在的 API。

---

## 13. 无障碍、本地化、故障与空态 [UI-P1]

### 13.1 Accessibility

- 所有按钮、Checkbox、Dialog、Palette、Tree、Tabs 可键盘操作。
- Modal 开启后合理管理焦点，Esc 行为明确，关闭后焦点返回原入口。
- 图标按钮必须有可访问名称；状态不能只靠颜色表示。
- 重要的 `WAITING_APPROVAL / FAILED` 变化通过适当的 live region 通知，不频繁播报普通 token 流。
- 亮/暗主题保持必要的文字对比度；支持 Reduced Motion。

### 13.2 国际化

当前有中英文页面，但布局长度变化明显。推荐使用语义化 i18n key 而非硬编码按钮文本；日期、路径、数字和费用进行区域化；模型 ID、CLI Command、文件路径保持原样。切换语言后不应重置当前 Run 或正在填写的表单。

### 13.3 错误与空状态

为每个关键页面定义 `loading / empty / ready / degraded / error`，至少覆盖：无 Project、无 Session、无模型、模型连接失败、服务断开、Session 已归档、权限不足、没有文件变更、Run 重连中、审批过期。错误必须给出可执行的下一步，而不是永久显示 `Loading...`。

---

## 14. 按截图定位的整改任务清单（可直接拆 Issue）

| 任务 ID | 修改点 | 依赖 | 优先级 | 验收标准 |
|---|---|---|---|---|
| UI-001 | 首页按 Project/Session/Run 状态生成，提供任务输入 | Project/Session 查询 | P0 | 已配置用户首页直接启动任务 |
| UI-002 | 项目→会话树；统一 Topic/Session 名称 | 数据语义审查 | P0 | 无重复未命名长列表；导航可定位 |
| UI-003 | 会话自动标题、归档/重命名进菜单 | Session metadata | P0 | 标题可读且可编辑 |
| UI-004 | 新建任务快捷流程；高级配置折叠 | Model/Policy 可用状态 | P0 | 不强制填绝对路径和模型设置 |
| UI-005 | 精简顶栏、显式运行与待审批状态 | Run/Approval API | P0 | 任何页能定位需关注任务 |
| UI-006 | 统一 Session Mode/Model/Permission 视图 | Effective config API | P0 | 前端所示与后端有效配置一致 |
| UI-007 | 三栏 Shell 与按需 Inspector | Changes/Activity 查询 | P1 | 对话/Diff 可并排查看，窄屏可折叠 |
| UI-008 | Tool Timeline 和 Approval Card | Run Event Stream、Policy | P1 | 不重复执行/审批，不误报完成 |
| UI-009 | Provider Registry 及 Model 记录 | Provider API | P1 | 连接/模型/能力状态可查 |
| UI-010 | Command Palette 搜索语义分组 | Session/Project Index | P1 | 常用操作可键盘完成、少原始 ID |
| UI-011 | Customize → Layout Presets | Local UI Preferences | P1 | 隐藏面板不改变 Capability/Policy |
| UI-012 | 800px 和手机端响应式重排 | Shell / Tokens | P1 | 无严重工具栏换行、无水平溢出 |
| UI-013 | Activity 多 Run 聚合与审批队列 | Run State + Cursor | P1/P2 | 跨项目可找到等待授权的 Run |
| UI-014 | Agent Studio 只读 L0-L4 检查视图 | Behavior Compiler | P2 | 有效配置和冲突可追溯 |
| UI-015 | Agent Studio Composer/Verify | Conformance API | P2 | 无效强制行为不可激活 |
| UI-016 | Team/Subagent Task Tree | Agent/Task Contracts | P2 | 子任务状态可审计、可跳转 |
| UI-017 | 自定义布局、高级 Trace 体验 | Telemetry/Event API | P3 | 无性能退化、可恢复布局 |

---

## 15. 实施顺序与跨团队交接

### Sprint 0：代码与页面基线确认

- 检查 Web Router、状态管理、现有 Session/Provider/Run API。
- 建立截图回归集（中文/英文、窄屏/桌面、空态/失败态）。
- 确认未提供的会话执行页真实功能；所有整改 Issue 标注 `Present/Partial/Missing`。
- 与 Harness 团队冻结 Project/Session/Run/Approval 的最小 Schema，不等后端全部重构再开始非依赖 UI 改动。

### Sprint 1：P0 可用性与启动路径

- `UI-001` 至 `UI-006`：侧栏、标题、新任务、导航和生效配置呈现。
- 降低首页空白带来的操作摩擦，关闭虚假占位卡，分离 Server/Provider 状态。
- 把 800px 顶栏溢出纳入紧急布局修复，虽属于完整 P1 响应式方案的一部分。

### Sprint 2：P1 主工作台

- `UI-007/008/010/011/012`：三栏、Inspector、Tool/Approval、Palette、Layout Presets、响应式。
- Diff 和 Tool Activity 与 Run Event Stream 绑定，不通过纯前端虚构任务状态。

### Sprint 3：P1 管理与多任务

- `UI-009/013`：Provider Registry、Activity 聚合、待审批队列。
- 运行错误归因、重连补偿和通知中心。

### Sprint 4：P2 核心差异化

- `UI-014/015/016`：Behavior Studio、Conformance、Task Tree。
- 以前述架构文档 `ARC-02/07/10` 对应 API、测试通过为交付门槛。

**依赖策略**：UI 壳体、导航、视觉 Tokens、空态等可以独立并行开发；涉及工具授权、恢复、事件重放和 Behavior 生效的界面必须以经过验证的后端契约为准。

---

## 16. 性能与体验指标（建议验收）

| 指标 | 建议目标 | 测量方式 |
|---|---|---|
| 任务启动步骤 | 已配置环境下，从 Workbench 直接提交 | 可用性测试/操作记录 |
| 会话定位 | 当前项目内两次主导航动作以内 | 任务测试 |
| 当前 Project Root 清晰度 | 一眼可见或一次操作可见 | 视觉审查 |
| 审批可发现性 | 跨项目能定位所有 Waiting Approval | E2E 测试 |
| 文件变更审查 | 当前 Run 一次操作进入 Changes/Diff | E2E 测试 |
| Run 状态一致性 | Web/CLI 同一 Run 终态一致 | Contract/E2E 测试 |
| 断线恢复 | Cursor 不漏事件、不重复结果 | 模拟离线与重连 |
| 布局适配 | 375–1440px 无关键内容横向溢出 | Playwright / 视觉回归 |
| 键盘可用性 | 关键任务无需鼠标完成 | 无障碍测试 |
| Provider 错误可诊断 | 可区分服务/网络/凭证/模型/限流 | 故障注入 |

对于首屏性能、输入延迟、长 Event Timeline 内存占用，可在 Sprint 0 取得实际基线后设定量化门限。不要在缺乏测量时宣称改版已提高百分之多少。

---

## 17. UI 端最终验收（Definition of Done）

- [ ] `Project / Session / Run / Agent Preset / Subagent` 在导航和界面上含义一致。
- [ ] 已配置用户无需先打开模型配置即可从当前项目启动新任务。
- [ ] 顶部状态栏不堆满设置按钮，800px 界面无异常竖排文字。
- [ ] 左侧会话优先展示有辨识度的标题和执行状态，而非默认重复的 ID/路径。
- [ ] Command Palette 支持分组、模糊检索、键盘操作，不把原始 `sess_*` 作为首要标签。
- [ ] Provider 管理可以单独诊断连接状态与模型能力，API Key 不明文回显。
- [ ] UI 关闭或隐藏 Policy/Team/Cost 面板，不影响权限执行、任务运行或计量。
- [ ] Run、Tool、Approval、Diff 的状态来自相同的 Backend Snapshot/Event 流。
- [ ] 断网重连后不把旧状态误判为完成，不重复审批结果。
- [ ] Console/Trace 可定位问题，但敏感输入默认受到保护。
- [ ] 中英文、浅/暗主题、键盘和小屏测试通过。
- [ ] Agent Studio 仅展示真实有效的 L0–L4 编译结果，未实现编译验证前不伪造成功指标。

---

## 18. 尚需补充的真实样本与决策问题

正式实施前应收集而非猜测：

1. **完整会话工作界面**：输入、工具调用、审批、Diff、任务进度、错误与完成态的截图/录屏。
2. **当前前端源码**：路由、组件树、状态管理、CSS 与响应式布局实现。
3. **真实 API**：Project/Session/Run/Provider/Tool/Event/Approval 的现有接口与错误模型。
4. **任务生命周期证据**：至少一个成功和一个异常 Run 的完整事件样本。
5. **目标用户优先级**：是否以单人本地 Coding 工作为主，还是近期需要多项目、多 Agent 并行监督。当前建议默认先服务于前者，并保留通往后者的清晰路径。

**最终建议**：优先把首页、新建任务、项目/会话导航、权限状态、任务 Timeline 和 800px 响应式问题解决。Vessel 的 UI 不需要更复杂的装饰，而需要**更短的任务路径、更明确的运行事实和更可信的控制边界**。
