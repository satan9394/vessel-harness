# T223 — Web UI Visual Overhaul + Design Skill Intake

- Status: 已落地（2026-10-15 P1–P8 实施到 apps/web；原型阶段此前完成）
- Mode: goal
- Source: human-requested
- Risk: medium

## 策划阶段收口（2026-10-15）

原型与规范阶段**到此收口**，实施移交新对话。两份交接文档已落盘：

| 文档 | 用途 |
|---|---|
| `docs/design-prototypes/IMPLEMENTATION-PLAN.md` | **落地实施规划书**（VESSEL-UI-2026-02）：P1–P8 分阶段、每阶段验收、DoD、风险对策 |
| `docs/design-prototypes/NEW-CONVERSATION-PROMPT.md` | **新对话开局 Prompt**（整段可复制），含硬约束与 18 项功能回归要求 |

**实施依据**：`docs/DESIGN.md`（视觉与 IA 规格）+ `docs/design-prototypes/FEATURE-COVERAGE.md`（功能回归基准，B1–B18）。
**本卡不再推进实现**；实施完成后由新卡/新会话回填证据。

## 定稿决策（2026-10-15）

**视觉 = 玻璃（Glass）**；**信息架构 = 四栏工作台 + 审阅台**：
`58px 图标轨 + 232px 会话/项目栏 + 中央过程流 + 300px 审阅栏`。
用户要求"综合 OpenCode / Claude Code / Codex 等著名 Agent 的 UI 优点，你来定"。
综合结论与逐项借鉴（计划清单、就地 diff、审批档位、常驻计量、独立审阅面、命令面板）写在 `docs/DESIGN.md` 第 3–4 节。
**被否决**：无侧栏的「聚光」外壳（多会话场景撑不住）；「舱位」下沉到活动页、「时间轴」下沉到追踪 Tab。
骨架本体见 `docs/design-prototypes/prototype-full-glass.html` 的 `data-area="synthesis"`。

## 断点（2026-10-14 收工状态，历史）

**已定**：视觉方向 = **玻璃（Glass）**。用户明确："颜色主题就玻璃，其他不需要。"
—— `directions-v2.html` 里其余四套皮肤（精密 / 单色 / 瑞士 / 高反差）作废，只需保留玻璃。

**未定**：信息架构 / 骨架。用户原话："不好抉择诶……因为你做的不全面，没有展现所有功能，所以我不好抉择。"
—— 即：三套结构概念（聚光 / 舱位 / 时间轴）各只做了首页 + 一个主视图，**整个功能面没露出来**，
无法据此判断结构好坏。这是暂停的直接原因。

**已完成（2026-10-15）**：功能完整的玻璃主题原型 `docs/design-prototypes/prototype-full-glass.html`——
六区域全上、命令面板、可比结构（工作台·列表↔舱位；会话·流↔时间轴）。用户尚未据此表态。
需要覆盖（对照现网 `apps/web` 与 local-server 端点）：

| # | 区域 | 必须出现的功能 |
|---|---|---|
| 1 | 工作台 Workbench | Project → Task → Start 就地启动；模型 / 权限 / 模式直选；最近会话；项目列表；归档与重命名 |
| 2 | 会话 Session | 消息流、思考折叠、工具行、**内嵌 diff 组件**、**权限审批卡**、红绿门禁徽章、AST 影响雷达、usage 条、输入区 |
| 3 | Inspector | 四个 Tab：概览 / 变更 / 上下文 / 追踪（Trace 结构化事件、参数脱敏） |
| 4 | 画布 Canvas | 单 Hunk 补丁选择器（逐块采纳 / 丢弃 / 回退）、双视图 diff |
| 5 | 活动 Activity | 跨项目运行列表、**集中审批队列**、**团队任务树**（父子/依赖/租约/阻塞）、Swarm 拓扑、子代理 |
| 6 | Agent Studio | 行为库、Composer（组合规则 / 优先级 / 冲突检测）、L0–L4 兼容阶梯与 Conformance 校验、认知规则看板 |
| 7 | 设置 Settings | 供应商与模型（列表 / 添加 / 拉取模型 / 端点测试）、策略与权限、工具与 MCP、模块可见性、语言与主题 |
| 8 | 全局 | 命令面板（Ctrl+K，分组 + 键盘导航）、注意力通知、抽屉/浮层、≤800px 响应式 |

**约束沿用**：玻璃视觉；`docs/UI-THEME.md` 铁律（浅色默认 + 跟随系统）；中英双语；800px；自包含 HTML 可离线打开。
**未开工**：`apps/web` 仍为 **0 行改动**（`git status --porcelain -- apps/web packages/core` 为空）。

## Goal

把筛选出的设计/UI 技能引入本机 Agent 与项目，并产出三套候选视觉方向的高保真 HTML 原型 + `docs/DESIGN.md` 草稿；用户选定方向后，按选定方向对 `apps/web` 做全量视觉重构（设计令牌层 + 组件重皮 + 深浅色 / 中英 i18n / 800px 响应式），彻底解决当前 "满屏 1px 灰框、无层级、裸 slug 外露" 的视觉问题。

## Not Doing / Constraints

- 零 `packages/core` 源码改动。
- 纯本地：不 commit、不 push、不 publish、不调用其它 Agent harness、不做永久删除（一切删除进回收站）。
- 不引入新依赖、不引入 Tailwind / pnpm / bun / yarn 锁文件（守 `docs/DESIGN-DECISIONS.md` 决策点 19）。
- 保留 `docs/UI-THEME.md` 铁律：浅色默认 + `prefers-color-scheme` 跟随系统深色 + 颜色只写 CSS 变量。
- Web 构建必须携带 `-- --emptyOutDir false`。
- 原型阶段（P1）不得改动 `apps/web`，避免影响既有测试。
- 第三方技能副本必须随附许可证并登记 `THIRD_PARTY_NOTICES`。

## Acceptance Criteria

### 1. 技能引入 —— 完成（仅项目内挂载）
- [x] 设计/UI 类技能已复制进项目 `.agents/skills/`，含 `SKILL.md`。共 18 个技能目录。
- [x] `THIRD_PARTY_NOTICES` 登记来源仓库与路径，上游许可证全文存于 `.agents/skills/_licenses/`。
- [x] 许可证审查：`frontend-design`（anthropics/claude-code，专有许可）与 `web-design-guidelines`（vercel-labs，无许可证）**未**复制进本公开仓库。
- [x] **全局挂载已全部撤销**：用户要求技能只挂在当前项目下，不挂全局。曾误挂到 opencode / claude_code / codex / deepseek_harness 的 9 个技能已逐个 `stars.py undeploy`，四个 Agent 目录残留均为 0。

### 2. 三套候选原型 —— 完成
- [x] `docs/design-prototypes/direction-1-precision.html`（方向一 克制精密）
- [x] `docs/design-prototypes/direction-2-paper.html`（方向二 极简 Paper）
- [x] `docs/design-prototypes/direction-3-terminal.html`（方向三 工业终端）
- [x] 每套含：侧栏+顶栏、工作台首页、会话视图（含 Inspector）、组件与状态片段。
- [x] 每套支持浅色 / 深色 / 中英 / 800px 切换，并有真实 `@media (max-width:800px)` 折叠规则。
- [x] `docs/design-prototypes/index.html` 对比索引页。
- [x] `docs/DESIGN.md` 含三套候选设计语言令牌（颜色 / 间距 / 圆角 / 层级 / 字体 / 动效）+ 共有规则。
- [x] 离线 Chromium 实拍 13 张（3 方向 × 浅深中英 + 800px，含索引页），无外链依赖。

### 2.1 精修版（工艺基线，取代初版）—— 完成
- [x] 首轮三份初版被用户判定"依旧不好看"：根因是它们只是换了配色的后台管理面板（满屏 1px 灰描边、三列对称卡片、贴顶导航、无字阶层级），**不是设计过的产品**。
- [x] 按 `high-end-visual-design` 技能（明确"Block all the common defaults that make AI designs look cheap"）重做：浮动面板（不贴边）、发丝 ring 取代灰描边、双层 bezel（外壳 + 内芯）、大范围柔和扩散阴影取代硬投影、大留白、大字阶、去边发丝列表取代三列网格、胶囊按钮 + 内嵌尾随图标圈、自定义 cubic-bezier 入场（只动 transform/opacity 且尊重 `prefers-reduced-motion`）。
- [x] `docs/design-prototypes/console-v2.html`：方向一的精修单页（全屏真实界面），用户确认**工艺水平对路**。
- [x] **第三轮（用户指令）**：保留 `精密`，**移除 `纸感` 与 `终端`**，按"多来点"再补四套新方向 —— 现单页内可切换 `data-dir`：`precision` 精密 / `mono` 单色（OpenAI 风，纯黑白零彩色）/ `swiss` 瑞士网格（信号红 + 结构线 + 直角）/ `glass` 柔玻璃（半透明叠层 + 柔和光场）/ `noir` 高反差（纯黑 + 荧光酸绿）。
- [x] 换字体为 Geist / Geist Mono（Google Fonts + 本地回退）。
- [x] **第四轮（用户指令"你就变动了颜色，框架没变"）**：五套方向确实共用同一骨架，只换了皮。补做三套**骨架不同**的结构概念：
  - `docs/design-prototypes/concept-01-spotlight.html` —— 聚光（Command-First）：**无侧栏**，整页大命令栏 + 实时结果流 + 底部 dock；会话为居中窄列 + 浮层抽屉。
  - `docs/design-prototypes/concept-02-bento.html` —— 舱位（Bento 任务控制台）：**无侧栏**，顶部分段导航 + **不对称 bento 网格**（2×2 / 1×2 / 2×1）；会话为三栏驾驶舱。
  - `docs/design-prototypes/concept-03-timeline.html` —— 时间轴（Timeline DVR）：会话是**横向执行时间轴**（思考/工具/审批/策略四泳道 + 可拖拽 scrubber），总览页把每个会话画成迷你步骤条。
- [x] 修掉一个真实缺陷：`concept-01` 里 `.pill.run`（运行中胶囊）与执行流容器 `.run` 类名冲突，导致胶囊继承 `display:flex;flex-direction:column` 被撑成 648×294 的巨型圆角块；已把容器改名 `.runview`，并全量核查其余原型无同类冲突。
- [x] 初版 `direction-1/2/3-*.html` 保留为存档，已在 `index.html` 顶部标注"已被取代"。
- [x] **第五轮（白天续做，2026-10-15）**：用户指出"你做的不全面，没有展现所有功能，所以我不好抉择"。
  据此做**一份功能完整的玻璃主题原型** `docs/design-prototypes/prototype-full-glass.html`：
  - 六个区域全上：工作台 / 会话（含 Inspector 四 Tab：概览·变更·上下文·追踪）/ 画布补丁（单 Hunk 采纳·丢弃·回退）/ 活动（KPI + 集中审批队列 + 团队任务树 + Swarm 拓扑 + 跨项目运行 + 子代理）/ Agent Studio（行为库 + Compose 冲突检测 + L0–L4 兼容阶梯 + 认知规则看板）/ 设置（供应商与模型表 + 拉取模型/测试/端点探测 + 策略与权限 + 工具与 MCP + 模块可见性 + 语言/主题）。
  - 另含：命令面板覆盖层（Ctrl+K，分组 + 键盘提示，不显示内部 ID 与长路径）、沙箱审计徽章、红绿门禁徽章、AST 影响面、内嵌 diff 微组件、usage 条。
  - **在同一份里可比结构**：`data-wbmode` 列表 ↔ 舱位（不对称 bento），`data-svmode` 流 ↔ 时间轴（四泳道 + 可拖拽 scrubber）。
  - 玻璃视觉：半透明叠层 + 三团光场 + 导航/顶栏真实毛玻璃；浅色默认跟随系统；中英双语；≤1180/900 响应式。
  - 修掉一个真实缺陷：侧栏命令面板按钮未被 `[data-area-btn]` 选中而吃了浏览器默认按钮底色，渲染成白色方块；已改为 `.rail button` 统一基础样式。
- [x] **第六轮（用户："你要把你这些展现的UI全量展示，所有模块均展示，这样我才能到底对比好不好"）**：
  在同一份原型内新增**「全览 · 所有模块」板**（图标轨最后一个 ▦ 图标，`data-area="showcase"`），
  一条滚动内铺开 11 节并配左侧锚点目录：① 全局骨架（图标轨 + 顶栏三态）② 工作台双结构（列表 / 舱位并排）
  ③ 会话双结构（流 / 时间轴并排）④ Inspector 四 Tab ⑤ 内嵌微组件六态（PermissionActionCard / RedGreenGateBadge /
  AstImpactRadar / InlineDiffInspector / StreamingReasoningBlock / TalkingMetrics·UsageBar）⑥ 画布补丁 + 团队 DAG（SVG 节点图 + 阶段门禁）
  ⑦ **模块全览 11 个**（Swarm / CognitiveRules / Team / Tasks·Goals / ChangedFiles / Context / ToolActivity / Logs / Cost / MCP / Policy，每个都是真实形态）
  ⑧ 活动 / 子任务树 / 沙箱审计历史 / 子代理 / 记忆与网格 / 外部评审 ⑨ Agent Studio（行为库 + 组合冲突 + L0–L4 + 认知规则）
  ⑩ 设置与弹窗（供应商表 + 供应商设置弹窗 + 策略开关 + 模块可见性）⑪ 新建会话 / 命令面板 / 偏好抽屉。
  另加 `palette=1` URL 参数便于截图与演示打开命令面板。
- [x] 全览板离线 Chromium 实拍：`full-showcase-dark.png` / `full-showcase-light.png`（1500×7600）。
- [x] **第七轮（2026-10-15，用户："综合这些优点，你觉得哪一种更好"）**：定稿四栏骨架并落成原型 `data-area="synthesis"`：
  会话/项目栏（状态点 + 搜索）、中央过程流（**常驻计划清单 3/5** + 思考折叠 + 工具行 + **就地 diff 带 采纳/拒绝/在画布中逐块处理** + 授权卡）、
  输入区（项目/模型/**审批档位**/模式胶囊 + 双层 bezel + **上下文/缓存/花费/计划计量**）、审阅栏（变更/上下文/**追踪（内嵌时间轴）**）。
  修掉一个结构缺陷：新增区域时误替换掉了上一节的 `</section>`，导致新区域被嵌套进前一节、两者互斥隐藏而整页空白；已补回闭合标签（section 19/19、div 774/774 配平）。
  「plan checklist」「就地 diff」「审批档位」「常驻计量」四项分别借鉴 Claude Code 与 Codex，已写入 `docs/DESIGN.md`。
- [x] **第八轮（2026-10-15，用户："UI 展现的是我们项目开发的所有功能吗？免得改完 UI 功能缺失"）**：
  以代码为准做了**功能覆盖审计**，产出 `docs/design-prototypes/FEATURE-COVERAGE.md`：
  逐个比对 47 个非测试组件（`apps/web/src/components/**`）、`apps/web/src/api.ts` 的端点注释（能力真值）、
  `uiModules.ts` 的模块开关与 CLI 命令面。
  - **结论：不是全覆盖**。已实现功能中 **8 项缺失/部分缺失（B1–B8）**，另 **4 项原型超前于实现**（C，需标注）。
  - 已在原型补齐 B1–B8（新增全览第 12 节）：会话路由档位 Auto/Fast/Pro + 锁定（`/sessions/:id/route*`）、
    能力协商三态 `detected|declared|unknown`（`CapabilityStatus.tsx` + `/api/models`）、会话级模型切换
    （`PATCH /sessions/:id/model`）、**中断当前回合**（`/sessions/:id/interrupt`）、目标预算
    （`maxIterations/maxRetries`、暂停/续跑）、方案编辑器预审（`TeamPlanEditor.tsx`）、阶段面板 + 节点抽屉
    （`TeamStagesPanel.tsx`/`TeamNodeDrawer.tsx`）、供应商删除与内置保护（`builtin_provider`/`unknown_provider`/
    `provider_store_corrupted` + `apiKeyMasked`）。
  - 高价值项已**内联进真实区域**：会话头部加 路由档位 + 模型切换 + 停止本回合；设置表加 删除/脱敏掩码/内置不可删行。
  - C 项处理：给 Context / Logs / MCP / Policy 四个模块卡加「设计前瞻 · 现为占位」标注
    （真实 app 里 `App.tsx` 的 `UNIMPLEMENTED` 会把它们渲染成 `t('unimplemented')`）。
  - 截图已更新并在原目录：`ui/current/{session,settings,showcase,narrow-*}.png`（仍 132 张，全览板加高到 8600px 容纳第 12 节）。
- [x] **第九轮（2026-10-15，用户："你要是不确定，你就再对比"）**：做了**第二轮核验**，改用更硬的证据源——
  强类型字典 `i18n.ts`（**9 个接口、691 个键**）逐条对照，而不是只看组件名。
  - **又发现 10 类缺口（B9–B18），并纠正第一轮的一处错误定性**：
    - **B9（结构性）**：检视器真实是 **8 个 Tab**，权威定义在 `DualSurfaceLayout.tsx` 的
      `INSPECTOR_TABS = ['swarm','cognition','context','cache','ast','patch','tasks','trace']`，
      真实标签（取自字典）：代理网络 / 认知规则 / 上下文 / 模型缓存 / 影响范围 / 代码补丁 / 任务树 / 追踪；
      原型此前画的「概览 / 变更」**根本不是它的 Tab**（改动文件属 ChangedFiles 模块）。
    - B10 缓存效益面板与 Context 四层缓存、B11 工作区指纹与前缀分段、B12 沙箱详情（路径白名单/内存上限/提权档位/平台层级）、
      B13 Swarm 心跳与本地连接、B14 快捷键说明、B15 检视器折叠与 ≤1023px 模态（焦点陷阱+Esc+回焦，持久化键 `vessel.inspector`）、
      B16 状态字典 59 键集中呈现、B17 任务详情生成/评估快照与验收、B18 边界态（终结任务不可重跑/权限卡过期/无归属工作区/未认领）。
  - **已补齐**：会话区域右栏与综合方案右栏均改为**真实 8 Tab**；右栏真实现缓存效益 + 工作区指纹 + 前缀分段；
    新增全览板第 13 节覆盖 B12–B18。
  - **过程教训**：两次批量替换都因 `oldString` 吞掉相邻闭合标签，分别造成**整页空白**与 `div` 失衡；
    已形成硬性检查——**批量改 HTML 后核对 `<section>/<div>/<aside>` 开闭计数**（现为 21/21、933/933、4/4）。
  - 证据与逐项回归清单：`docs/design-prototypes/FEATURE-COVERAGE.md`（含 F.1 二轮补充证据、F.2 落地位置、F.3 未收口细节项）。
- [x] **第十轮（2026-10-15，用户："开新对话全面落地，写规划书 + 提供 Prompt"）**：
  策划阶段在此收口，实施移交新会话。新增两份交接文档：
  - `docs/design-prototypes/IMPLEMENTATION-PLAN.md`（VESSEL-UI-2026-02）：10 条硬约束、玻璃令牌落地与**旧变量别名**策略、
    四栏规格与断点、**P1–P8 分阶段**（每阶段含验收）、B1–B18 逐项落地要点与复用组件映射、
    C 项（UNIMPLEMENTED 四模块）必须保持占位语义、DoD、六条风险对策（首条即"为了好看丢掉功能"）。
  - `docs/design-prototypes/NEW-CONVERSATION-PROMPT.md`：整段可复制的新对话开局 Prompt，
    含必读顺序、硬约束、P1–P8 步骤、**检视器 8 Tab 的硬事实纠正**、DoD、以及"不确定就对比代码"的提醒。
  - `docs/DESIGN.md` 顶部与 `index.html` 已加指向这两份文档的入口；**`apps/web` 仍为 0 行改动**。

### 3. 用户选定方向 —— 待办
- [ ] 用户明确回复选定方向一 / 二 / 三。

### 4. 全量重构（选定方向后执行）—— 已完成
- [x] 设计令牌层接入 `apps/web/src/styles.css`，沿用变量纪律。
- [x] 导航 / 侧栏 / 顶栏 / 卡片 / 按钮 / 输入 / 徽章 / 表格 / 抽屉 / 命令面板统一到新令牌。
- [x] Agent Studio 卡片墙收敛；裸 slug 与长路径收进详情；补齐空态 / 加载 / 错误 / 骨架。
- [x] 微交互 + `prefers-reduced-motion` 兜底。
- [x] 中英双语与 800px 响应式不回退。

### 5. 门禁与交付完整性（重构阶段执行）
- [x] `apps/web` 单测、web typecheck、`npm run -w @vessel/web build -- --emptyOutDir false` 全 exit 0。
- [x] 根 `npx tsc -b`、`npm run typecheck:tests` exit 0。
- [x] `git diff --stat packages/core/` 严格为空。
- [x] 截图证据：中英 × 浅/深 × 桌面/1366/1023/800 矩阵（64 张）存档。

## Blast Radius

- 已落地：`docs/design-prototypes/`、`docs/DESIGN.md`、`.agents/skills/`（18 个技能 + `_licenses/` + `THIRD_PARTY_NOTICES.md`）、本机四 Agent 的技能挂载。
- 已完成（重构阶段）：`apps/web/src/styles.css`、`components/layout/*`、`components/ComposerMeters.tsx`、
  `components/PlanChecklist.tsx`、`components/activity/ActivityQueue.tsx`、`utils/timeFormat.ts`、`i18n.ts`、`vite.config.ts` 等。
- `packages/core` **零改动**（全程未触碰）。

## Expected Evidence

- [x] `docs/design-prototypes/*.html` 三套 + `index.html`。
- [x] `docs/DESIGN.md` 三套令牌草稿。
- [x] 技能挂载与复制清单：`evidence/sessions/2026-10-14-card223/PROOF.md`。
- [x] 截图矩阵 13 张：`evidence/sessions/2026-10-14-card223/*.png`。
- [x] 实施阶段门禁日志 + 64 张全矩阵截图：`evidence/sessions/2026-10-15-ui-landing/PROOF.md`、`gallery.html`。
- [x] 真实浏览器功能走查（browser-skill）与修复记录：`evidence/sessions/2026-10-15-ui-landing/bsk-functional/FINDINGS.md`。

## Result

- Verdict: **已落地并走查闭合（2026-10-15/16）**。原型阶段 PASS；实施阶段按 `IMPLEMENTATION-PLAN.md` 的 **P1–P8 全量落地到 `apps/web`**；
  随后用 `browser-skill`（独立 Agent Window）做真实浏览器功能走查，发现并修复 5 处缺陷。
- Evidence: `evidence/sessions/2026-10-15-ui-landing/PROOF.md`（门禁日志 + 逐阶段证据）、
  `evidence/sessions/2026-10-15-ui-landing/gallery.html`（截图矩阵画廊 64 张 + P2–P6 代表图）、
  `docs/design-prototypes/FEATURE-COVERAGE.md`（B1–B18 逐条可达入口 + 证据）、
  `evidence/sessions/2026-10-15-ui-landing/bsk-functional/FINDINGS.md`（走查 12 张截图 + 缺陷/修复，含未修观察项）、
  原型阶段证据 `evidence/sessions/2026-10-14-card223/PROOF.md` 与 132 张原型截图。
- 走查发现并修复（详见 FINDINGS.md §2）：
  1. **Vite 代理 403（阻断级）**：Vite 8 代理默认 `changeOrigin: true` 改写 Host，使后端 `trustedOrigin` 判为跨域，
     拦截全部带 Origin 的写请求（compose / 供应商增删测 / 真实供应商建会话）→ `vite.config.ts` 改 `changeOrigin: false`。
  2. **矮视口重叠**：`.dual-surface` 被同级 `.module-sections` 挤到 229px 而内容需 ~375px → 保底 `min-height: 420px` + 包裹层滚动。
  3. **「模型」胶囊显示 `default`**（用户反馈）→ 新增 `resolveModelLabel` 分级回退，不再裸显占位值。
  4. **活动页长绝对路径 + 时间长格式** → `shortPathLabel` + `formatStamp`（完整值收进 `title`）。
  5. **Agent Studio 详情卡片墙**去边框改发丝（P6 同批）。
  > 未修观察项：活动页对无 topic 标题的会话会显示裸 id（服务端聚合 `run.title`，正常建会话流程不触发）。
- 门禁（最后一次编辑之后执行）：`npx tsc -b` / `npm run typecheck:tests` /
  `npm run -w @vessel/web build -- --emptyOutDir false` / `npm run test:all` 全 exit 0；
  根 **289 文件 / 3037 passed + 6 skipped**，web **40 文件 / 340 passed**；`packages/core` 零改动。
- Residual risk: 未做真实 provider 联网走查（全程 mock provider）；移动端未真机验证。
- Resume: 无（已闭环）。如需视觉微调，从 `apps/web/src/styles.css` 的 `.tokens` 与 `docs/DESIGN.md` 入手。
