# Card 223 · PROOF — Web UI 视觉重塑与设计技能引入（原型阶段）

日期：2026-10-14 · 执行：OpenCode（DeepSeek-v4.1-Flash，goal 模式）
任务卡：`tasks/223-web-ui-visual-overhaul-and-design-skills.md`

本文件只覆盖 **P0（技能引入）+ P1（三套候选原型）**。`apps/web` 全量重构与门禁在用户选定方向后执行。

---

## 1. 星标库检索与筛选

用 `stars-tools/stars.py search` 在 core 层 + 全站池（`--pool`）检索设计/UI 主题，并把设计创意层索引
（`stars-scan/lite/design-creative.jsonl`，107 条）逐条过了一遍。设计创意层里大量条目是 CAD / 3D / PPT /
游戏 / 网文，与"网页 UI"无关；筛出与 Web 界面设计、评审、验收直接相关的子集后按用途分了三档。

冻结检查：目标技能在 `stars-scan/skill-freeze.json` 中均为 `ENABLED`（非冻结），无需 `--force`。

## 2. 全局挂载 —— 已全部撤销

> **纠正（2026-10-14，用户指令）**：本卡最初把 9 个技能挂到了本机 4 个 Agent 的全局技能根
> （`stars.py deploy --agent oc|cc|codex|dsh`）。用户明确要求**只挂到当前项目下、不要挂全局**，
> 因此已逐个 `stars.py undeploy` 撤销：`~/.claude/skills`、`~/.codex/skills`、`~/.dsh/skills`
> 三处的残留均为 **0**。本卡的实际交付形态是**项目内 `.agents/skills/` 副本**，不含任何全局挂载。

撤销清单一并记录，便于回溯：`baseline-ui`、`improve-ui`、`create-design-md`、`visual-acceptance`、
`design-prototype`、`dsh-client-ui-ux`、`make-interfaces-feel-better`、`visual-design-foundations`、
`web-design-guidelines`（各 4 个 Agent，共 36 次 undeploy，全部成功）。

**未挂载过**：`frontend-design`。`stars.py deploy frontend-design` 报 `skill reference is ambiguous`
（同名技能存在于 `anthropics/claude-code` 与 `brycewang-stanford/...` 两处），当时即未挂载。

## 3. 复制进项目 `.agents/skills/`（18 个）

| 技能 | 上游仓库 | 许可证 |
|---|---|---|
| `baseline-ui` / `improve-ui` / `create-design-md` / `fixing-motion-performance` | ibelick/ui-skills | MIT |
| `visual-acceptance` / `design-prototype` | huiliyi37/Tianshu-harness | Apache-2.0 |
| `dsh-client-ui-ux` | deepseek-ai/deepseek-harness | MIT |
| `make-interfaces-feel-better` | affaan-m/ECC | MIT |
| `visual-design-foundations` / `design-system-patterns` | wshobson/agents | MIT |
| `high-end-visual-design` / `minimalist-ui` / `gpt-taste` / `redesign-existing-projects` | Leonxlnx/taste-skill | MIT |
| `impeccable` | pbakaus/impeccable | Apache-2.0 |
| `emil-design-eng` / `animate` | emilkowalski/skills | MIT |
| `extract-design` | Manavarya09/design-extract | MIT |

- 上游许可证全文：`.agents/skills/_licenses/`（9 份）。
- 来源与版权登记：`.agents/skills/THIRD_PARTY_NOTICES.md`。
- `impeccable` 只复制 `SKILL.md` + `reference/`（415 KB），省略上游 `scripts/`（含约 1 MB 的
  `font-index.json` 与浏览器自动化脚本），已在 NOTICES 中声明。

### 3.1 许可证审查发现（重要）

本仓库在 GitHub 上为 **Public**，因此复制前逐个核对了上游 LICENSE：

- `anthropics/claude-code` 的 `LICENSE.md` 为 **"Anthropic PBC. All rights reserved."**（专有许可）→
  `frontend-design` **未**复制进仓库。
- `vercel-labs/agent-skills` 仓库内**找不到任何 LICENSE / COPYING 文件**（授权不明）→
  `web-design-guidelines` **未**复制进仓库。

这两者既未复制进仓库，也未做全局挂载，本轮完全未使用；仅作为审查结论登记在 `THIRD_PARTY_NOTICES.md` 中。

## 4. 三套候选方向原型（P1 交付物）

> **勘误（2026-10-14，第二轮）**：下面这三份初版被用户判定"依旧不好看"，根因是它们只是换了配色的
> 后台管理面板（满屏 1px 灰描边、三列对称卡片、贴顶导航、无字阶层级）。**已被取代，仅作存档。**
> 现行交付物见 §4.1。

### 4.0 初版（已被取代，存档）

全部为**自包含 HTML**，无外链、无构建、无依赖，双击即可离线打开：

- `docs/design-prototypes/direction-1-precision.html` — 方向一 克制精密（Linear / Vercel / Raycast）
- `docs/design-prototypes/direction-2-paper.html` — 方向二 极简 Paper（Notion × OpenAI）
- `docs/design-prototypes/direction-3-terminal.html` — 方向三 工业终端（等宽 / 直角 / 高对比）
- `docs/design-prototypes/index.html` — 三选一对比索引页
- `docs/DESIGN.md` — 三套设计语言的令牌草稿（颜色 / 间距 / 圆角 / 层级 / 字体 / 动效）+ 共有规则

每套原型含同一组画面以便横向比较：**侧栏 + 顶栏**、**工作台首页（Project → Task → Start）**、
**会话视图（消息 / 工具行 / 授权块 / 右侧 Inspector）**、**组件与状态片段（按钮 / 徽章 / 表格 / 空态 / 提示 / 色板 / 字阶）**。

评审与截图可用 URL 片段固定状态：

```
direction-1-precision.html#theme=dark&lang=en&vp=800
```

`theme` = `light|dark|auto`，`lang` = `zh|en`，`vp` = `800|desktop`。页面顶部"评审工具条"不属于产品 UI，
仅用于评审与截图（`docs/UI-THEME.md` 规定产品不提供手动主题切换，原型保持"跟随系统"为默认）。

浅色为默认、深色跟随 `prefers-color-scheme`；颜色全部走 CSS 变量；`@media (max-width:800px)` 为真实
折叠规则（原型以图标栏代表折叠形态，真实实现中 ≤800px 为无障碍抽屉，已在原型注释与 DESIGN.md 中标注）。

### 4.1 现行交付物（精修版，工艺基线）

按 `high-end-visual-design` 的"绝对零度"禁令重做——它明确禁止 generic 1px 灰描边、硬投影、
三列对称网格、贴顶导航、无插值的状态切换，正是初版的全部病灶。

工艺基线（三套共用）：浮动面板（不贴边）、发丝 `ring` 取代灰描边、**双层 bezel**（外壳 + 内芯，
`border-radius: calc()` 同心圆角）、大范围柔和扩散阴影取代硬投影、宏观留白、大字阶（标题 34–50px /
正文 14–15px / 标签 10.5px 全大写宽字距）、**去边发丝列表**取代三列卡片、胶囊按钮 + **内嵌尾随图标圈**
（hover 位移 + 缩放）、自定义 `cubic-bezier(.32,.72,0,1)` 入场且只动 `transform`/`opacity`、
尊重 `prefers-reduced-motion`。

| 文件 | 内容 |
|---|---|
| `docs/design-prototypes/console-v2.html` | 方向一「克制精密」的精修单页（全屏真实界面）。用户已确认此工艺水平"对路"。 |
| `docs/design-prototypes/directions-v2.html` | **主交付物**：五套方向共用同一工艺，单页内切换 `data-dir`，另有 工作台/会话 × 浅/深 × 中/EN。 |

五套方向（同一工艺，不同审美）：

- **`precision` 精密**：OLED 中性底 + 顶部径向环境光，靛蓝强调，Geist 无衬线，圆角 13/18/24，
  柔和扩散阴影。深色为强项。**用户已确认此方向保留。**
- **`mono` 单色**（OpenAI 风）：纯白 / 纯黑两极，**零彩色强调**（主按钮即墨色胶囊），发丝线极淡，
  留白最大，字距收紧。最克制的一套。
- **`swiss` 瑞士网格**：冷中性灰 + **信号红**强调 + 直角（4px）+ 粗全大写标签 + 结构线，
  Helvetica 血统。最"设计史"的一套。
- **`glass` 柔玻璃**：半透明叠层 + 三团柔和光场（紫 / 薄荷 / 蜜桃），大圆角 16/22/30，
  导航与顶栏带 `backdrop-filter`。最柔和、最有物理感的一套。
- **`noir` 高反差**：纯黑 + **荧光酸绿**强调 + 极紧字距 + 大字号。最锐利、最有科技感的一套。

第二轮曾产出 `paper`（纸感）与 `terminal`（终端）两套，**已按用户指令移除**（对应 token 块与
方向专属覆盖规则已从文件中删除，非仅隐藏）。

URL 片段：`directions-v2.html#dir=glass&theme=dark&screen=conv&lang=en`。

**已知限制**：Geist 无中日韩字形，中文一律回退系统 CJK 字体（当前为微软雅黑），因此所有方向的
"字体性格"对中文只部分成立；纯英文界面下差异最明显。

节拍/取舍对照仍见 `index.html`。

### 4.2 结构概念（骨架不同，非换皮）

第四轮自省：五套"方向"共用同一骨架，只换了配色/圆角/字体，因此结构层面的创意没有机会出现。
补做三套**信息架构与主视图都不同**的概念：

| 文件 | 结构 | 与其它概念的关键差异 |
|---|---|---|
| `concept-01-spotlight.html` | 聚光（Command-First） | **完全无侧栏**；首页 = 居中大命令栏（19px 输入）+ 分组实时结果流；运行中的会话在**底部浮动 dock**；会话视图 = 居中窄列（780px），检查器是**浮层抽屉**而非常驻右栏 |
| `concept-02-bento.html` | 舱位（Bento 任务控制台） | **完全无侧栏**，改为顶部分段控件；首页 = **不对称 bento 网格**（运行卡 2×2、审批卡 1×2、成本/上下文 1×1、工具/会话 2×1）；会话 = 「步骤索引 + 执行流 + 小卡面板组」三栏驾驶舱 |
| `concept-03-timeline.html` | 时间轴（Timeline DVR） | 会话**不是聊天记录**，而是横向执行时间轴：思考 / 工具 / 审批 / 策略四泳道，每步是一段按时长成比例的可点选条，带 playhead 与**可拖拽 scrubber**；总览页把每个会话画成一条迷你步骤条（含图例） |

三套均已离线 Chromium 实拍（浅/深，`evidence/sessions/2026-10-14-card223/c1-*、c2-*、c3-*`）。

**过程中修掉的真实缺陷**：`concept-01` 中 `.pill.run`（运行中状态胶囊）与执行流容器类 `.run` 同名，
胶囊因此继承了容器的 `display:flex; flex-direction:column; width:min(780px,…)`，被撑成 648×294 的
巨型圆角块。已把容器改名为 `.runview`，并核查其余四份原型无同类冲突（`裸 .run{ 规则数 = 0`）。

### 4.3 功能完整原型（主交付物 · 玻璃）

第五轮：用户指出"你做的不全面，没有展现所有功能，所以我不好抉择"。据此产出一份把**全部功能面**铺开的原型。

`docs/design-prototypes/prototype-full-glass.html`，玻璃视觉，六个区域：

| 区域 | 覆盖的功能 |
|---|---|
| 工作台 | Project → Task → Start 就地启动；项目/模型/权限/模式直选；最近会话；项目列表。**可切「列表 ↔ 舱位」两种结构** |
| 会话 | 消息流、思考折叠、工具行、**内嵌 diff 微组件**（可跳画布）、**红绿门禁徽章**、**AST 影响面**、**权限审批卡**、usage 条、输入区；右侧 Inspector 四 Tab（概览/变更/上下文/追踪）+ 沙箱审计徽章。**可切「流 ↔ 时间轴」两种结构** |
| 画布补丁 | 变更文件列表、逐 Hunk 卡片（**采纳 / 丢弃 / 恢复 / 退回**）、文件统计、应用到工作区（含回滚提示）、门禁预检 |
| 活动 | KPI 行（运行中/待审批/今日花费/缓存命中）、**集中审批队列**、**团队任务树**（父子 · 依赖 · 租约 · 阻塞）、**Swarm 拓扑**（SVG）、跨项目运行、**子代理**（含作用域收窄说明） |
| Agent Studio | **行为库**（规则码 + 来源标签 + L0–L4 等级）、加入组合 / 冲突检测、**组合结果**（冲突高亮）、**兼容性阶梯** Importable→Verified、**认知规则看板** |
| 设置 | **供应商与模型表**（拉取模型 / 测试 / 端点探测 / 导入导出脱敏）、**策略与权限**（开关，含"不可关闭（硬执法）"）、**工具与 MCP**、**模块可见性**（只改显示不改执行语义）、语言与主题（明示产品无手动浅深切换） |
| 全局 | **命令面板**（Ctrl+K，分组 + 键盘提示，不显示内部 id 与长路径）、侧栏图标轨、毛玻璃顶栏与面板、≤1180/900 响应式 |

**可比结构**：同一份原型内用 `data-wbmode`（list/bento）与 `data-svmode`（stream/timeline）切换，
让用户在**功能完整**的前提下判断骨架，而不是看两个残缺页面猜。

URL 片段：`prototype-full-glass.html#theme=dark&area=activity&palette=1`（`area` = workbench/session/canvas/activity/studio/settings；`palette=1` 打开命令面板）。

**修掉的真实缺陷**：侧栏的命令面板按钮没有 `data-area-btn` 属性，未被 `.rail button[data-area-btn]`
选中，因而吃了浏览器默认按钮底色，在深色下渲染成一个**白色方块**。已改为 `.rail button` 统一基础样式。

截图：`evidence/sessions/2026-10-14-card223/full-*.png`（12 张，含 800px 与浅色）。

### 4.4 定稿骨架：四栏工作台 + 审阅台

用户要求"综合 OpenCode / Claude Code / Codex 等著名 Agent 的 UI 优点，你来定"。据此把三套结构概念收敛为
一个**四栏骨架**，落在 `prototype-full-glass.html` 的 `data-area="synthesis"`：

`58px 图标轨 + 232px 会话/项目栏 + 中央过程流 + 300px 审阅栏`

逐项借鉴与理由：

| 借鉴对象 | 采纳的具体做法 |
|---|---|
| Codex | 左侧会话/项目列表 + 中央过程 + **独立右侧审阅栏**；**审批档位**（workspace-write / read-only）做成输入区胶囊 |
| Claude Code | **常驻计划清单**（`计划 · 3 / 5`，✓ 完成 / ● 当前 / · 待办 + 耗时）；**改文件前就地给 diff 并 采纳/拒绝**；**上下文余量计量**常驻 |
| OpenCode | 键盘优先 + `/` 与 ⌘K 命令面板；底部状态行；多会话并行 |
| 同类共识 | 多任务列表 + 中央过程 + 审阅面的稳定布局（Cursor / Zed / Antigravity 皆然） |

**否决项**：无侧栏的「聚光」外壳——多会话/多项目场景撑不住，上述产品无一例外都保留了会话列表。
「舱位 bento」下沉到活动页（多会话监控是它的强项）；「时间轴」下沉到审阅栏的追踪 Tab（作二级视图强，作主视图伤日常流程）。

**修掉的结构缺陷（重要）**：新增 `synthesis` 区域时，插入点的 `oldString` 把**上一节（showcase）的
`</section>` 一并吞掉**了，结果新区域被嵌进前一节内部；由于两个区域都靠 `.on` 切 `display`，
前一节隐藏时会把整棵子树隐藏 → 打开该区域**整页空白**。已补回闭合标签；核查结果
`<section>` 19/19、`<div>` 774/774 配平（`{`/`}` 相差 1 属正常，来源是页面里展示的代码片段 `capabilities ?? {}`、`=> {`）。

截图：`full-syn-dark.png` / `full-syn-light.png` / `full-syn-en.png` / `full-syn-1200.png`。

### 4.5 功能覆盖审计与缺口补齐（回答"改 UI 会不会丢功能"）

以代码为准做了逐项比对（47 个非测试组件 + `api.ts` 端点注释 + `uiModules.ts` + CLI 面），
产出 **`docs/design-prototypes/FEATURE-COVERAGE.md`**。

**结论：不是全覆盖。** 已实现功能中 **8 项缺失或部分缺失**，另有 **4 项原型超前于实现**。

| 缺口 | 证据源头 | 处理 |
|---|---|---|
| B1 会话路由档位 Auto/Fast/Pro + 锁定 | `POST/GET /api/sessions/:id/route*` | 已补（全览 12 节 + 会话头部内联） |
| B2 能力协商三态 `detected/declared/unknown` | `CapabilityStatus.tsx`、`GET /api/models` | 已补（全览 12 节） |
| B3 会话级模型切换 | `PATCH /api/sessions/:id/model`、`ModelSelector.tsx` | 已补（全览 12 节 + 会话头部内联） |
| B4 中断当前回合 | `POST /api/sessions/:id/interrupt` | 已补（全览 12 节 + 会话头部内联） |
| B5 目标预算 maxIterations/maxRetries + 暂停/续跑 | `POST/GET /api/goal/tasks/:id/budget` | 已补（全览 12 节） |
| B6 方案编辑器（预审草稿） | `TeamPlanEditor.tsx` | 已补（全览 12 节） |
| B7 阶段面板 + 节点抽屉 | `TeamStagesPanel.tsx`、`TeamNodeDrawer.tsx` | 已补（全览 12 节） |
| B8 供应商删除 + 内置保护 + 密钥掩码 | `DELETE /api/providers/:id`、`apiKeyMasked` | 已补（全览 12 节 + 设置表内联） |

**C. 原型超前于实现（4 项，已加标注）**：`App.tsx` 中 `UNIMPLEMENTED = ['Context','Logs','MCP','Policy']`
会把这四个模块渲染为 `t('unimplemented')` 占位，而原型此前给了它们完整内容。现已在模块卡上标注
「设计前瞻 · 现为占位」，避免被误读成"已有功能"。

**低风险补充项**（原为部分呈现）：`/api/sessions/search` 的 `indexed` 指示、`/api/control/mesh/ping/:id` 对端探活、
`/api/daemon/*` 守护进程状态与托盘、`GET /api/reviews/:id/handoff.md` 复制原文。已在审计表记账，待逐项收口。

**回归约定**：`apps/web` 改造完成后，用本表逐项回归——**每一项都必须在新 UI 里有可达入口**。

截图更新：`ui/current/{session,settings,showcase,narrow-session,narrow-settings}-*.png`（全览板加高到 8600px 容纳第 12 节）。

## 5. 截图证据（离线 Chromium 实拍）

`evidence/sessions/2026-10-14-card223/`

**归档结构（2026-10-15 整理，共 132 张）**：

```
evidence/sessions/2026-10-14-card223/ui/
├── index.html          ← 画廊页：132 张全部列出，可逐张点开（脚本扫描目录生成，与实际文件一一对应）
├── current/    40 张   当前原型：六区域 × 浅/深 × 中英 + 结构变体（列表/舱位、流/时间轴）
│                       + 浮层（命令面板 3 态）+ 窄屏 900/800 + 全览板浅深
├── directions/ 15 张   视觉皮肤探索（精密/单色/瑞士/玻璃/高反差 × 浅深 + 会话页）
├── concepts/   12 张   结构探索（聚光 / 舱位 / 时间轴 / console-v2 精修单页）
└── archive/    65 张   早期轮次存档（direction-1/2/3、v2 系列、概念草稿等）
```

入口：`ui/index.html`。原始散图已全部移入上述目录，evidence 根目录不再有散落 png。

采集方式：本机真实 `chrome.exe` headless（`--headless=new --screenshot`，`--window-size` 1440×2200 或
800×2500）。**注意**：`--blink-settings=preferredColorScheme` 在本机 headless 下不生效（浅/深截图
MD5 曾完全一致），故改为页面自带的 `#theme=` 片段驱动，浅/深/中/英/800 四态 MD5 互不相同，可证状态真实切换。

## 6. 验证与不宣称

已验证：

- 18 个技能目录落地且均含 `SKILL.md`；9 份上游许可证落地。
- 曾误加的 36 次全局挂载已全部 `undeploy` 撤销，四个 Agent 目录残留核验为 0；项目内副本保留。
- 三套原型 + 索引页 + DESIGN.md 存在；离线 Chromium 渲染成功，13 张截图四态哈希互异。
- 原型文件行尾为 LF，符合仓库 `.gitattributes` 的 `* text=auto eol=lf`。

不宣称：

- **未**在真实浏览器中手工点过每个按钮与切换器（语言/视口由 `#lang=`/`#vp=` 驱动验证，等价于点击同一处理函数）。
- **未**做像素级视觉回归（`visual-acceptance` 的多主题矩阵 + 像素真值判据），留待选定方向后的重构阶段。
- **未**改动 `apps/web` 任何一行；本轮不跑 `test:all`（无源码改动，测试结果与 card222 基线一致，未重跑故不引用数字）。
- 原型是**方向示意**，不是最终实现；其中的示例数据（run id、文件名、步数）为演示内容。

## 7. 下一步

等用户从三套中选定一套 → 收敛 `docs/DESIGN.md` → 按选定方向对 `apps/web` 做令牌层 + 组件重皮 →
跑门禁（web 单测 / typecheck / build `-- --emptyOutDir false` / 根 `tsc -b` / `typecheck:tests`）→
出选定方向的中英 × 浅深 × 桌面/800px 截图矩阵。
