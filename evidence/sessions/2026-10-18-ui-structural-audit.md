# 《Web UI 结构优化与设计走查报告》
### Vessel Harness · `apps/web` 前端落地结构与设计规范审查

**审查人**：OpenCode 架构与设计审查专家（DeepSeek-v4.1-Flash）
**审查对象**：`apps/web/src/App.tsx`、`components/layout/layout.css`、`styles.css`、`components/layout/Rail.tsx`、`components/Sidebar.tsx`、`components/ConversationView.tsx`（含被 `ConversationView` 依赖但未在本次快照中出现的 `MessageList.tsx`、`DualSurfaceLayout.tsx`、`TaskComposer.tsx`、`styles.css` 下半部分）
**审查基准**：`.agents/skills/*` 五份设计技能规范 + 现有设计令牌（`docs/DESIGN.md §2.1/§4`）
**结论前置**：当前 UI 的问题**不是配色或视觉风格问题，而是结构问题**——网格是"固定像素合唱团"、空白态是"孤岛"、右侧检视器与下方面板"两个主人一间房"、层级靠 `shadow-2` 反复堆叠、微交互只有 hover 没有 press/focus。这些问题的共性是：**每一次局部重构都在既有结构上叠加补丁，而不是重画结构**。因此本报告给出的是结构重塑方案，而非样式微调。

> ⚠️ **证据边界声明**：本报告所有代码定位均来自本次提供的文件快照。凡涉及 `DualSurfaceLayout.tsx`、`MessageList.tsx`、`TaskComposer.tsx`、`styles.css` 未被截断部分的结论，均标注为 **【待确认】**，并已在第四部分转为 Codex 的**前置校验步骤**，不得当作既成事实直接改代码。

---

## 一、GitHub 与业界前沿设计规范调研

本次调研对象为仓库内已落地的五份设计技能（`impeccable@4.3.1`、`emil-design-eng`、`make-interfaces-feel-better`、`minimalist-ui`、`dsh-client-ui-ux`），并对照业界既有实践（Emil Kowalski 的 `vaul`/`sonner` 交互约定、Radix Primitives 的层叠与焦点模型、WCAG 2.2 §2.5.8 Target Size、Apple HIG 44pt 命中区、Material 3 的 enter/exit 非对称动效）。从中提炼出**五条适用于本项目的设计铁律**。

> **给 Codex 的提醒**：以下铁律中，第 1/2/3/5 条直接来自仓库内技能文件，**可在 PR 中直接引用**；涉及外部仓库（`vaul`、`sonner`、Radix）的表述为业界通行约定，引用前需重新核对上游文档，勿凭印象写进 PR 描述。

### 铁律 1 · 令牌与性质优先于字面值（Specificity over literals）
> 来源：`make-interfaces-feel-better`（Transition Scope）、`dsh-client-ui-ux`（Visual foundation）、`emil-design-eng`（Review Format 示例行）

- **禁止 `transition: all`**，必须逐条声明变更属性；`will-change` 只用于 `transform/opacity/filter` 的首帧卡顿，禁止 `will-change: all`。
- **禁止引入字面值**：颜色、圆角、间距、字号，先搜索目标页面与最近同类兄弟页面（Plugins 页为全页参考）已用的令牌；只有不存在时才新增，且新增必须进令牌层。
- **字号来自主题排版变量**；平行内容共享同一字号，一页内不同字号数量必须保持很小（**13px ��已确立的行/详情字号**）。
- **字重上限 500**（仅 ui-theme 拥有的 markdown 排版令牌例外），强调靠尺寸与墨色而非加粗。

### 铁律 2 · 同心圆角与光学对齐（Concentric radius & optical alignment）
> 来源：`make-interfaces-feel-better`（Concentric Radius / Optical Alignment）

- **外层圆角 = 内层圆角 + 内边距**。padding 过大时把两层视为独立表面，不强行套公式——追求的是**光学一致**，不是数学正确。
- **几何居中 ≠ 视觉居中**：图标按钮、三角、箭头、星形等非对称图形需要 1px 级的手工偏移，优先修 SVG，其次用 margin/padding 补偿。

### 铁律 3 · 状态完备性与命中区下限（Complete states & hit areas）
> 来源：`emil-design-eng`（Animation Decision Framework）、`make-interfaces-feel-better`（Motion / Hit Areas）

- **任何可交互元素必须有 hover / active / focus-visible / disabled 四态**；按钮必须有按压反馈（`scale(0.97)` 或 `0.96`），并保留一个可关闭的动效开关。
- **入场**：`opacity` + 小位移 `translateY` + 可选 blur 组合；**出场**：比入场更短更轻，通常 **150ms**。
- **命中区 ≥ 40×40px，布局允许时 44×44px**；视觉图标更小时用伪元素扩展，但不得让扩展区互相重叠。
- 图标��换必须做 `opacity + scale + blur` 交叉淡入，禁止瞬间显隐。

### 铁律 4 · 频次决定是否该有动效（Frequency gates animation）
> 来源：`emil-design-eng`（The Animation Decision Framework）

| 使用频率 | 决策 |
|---|---|
| 100+ 次/天（快捷键、命令面板开关） | **永不动画** |
| 数十次/天（hover、列表导航） | 移除或**大幅削减** |
| 偶发（模态、抽屉、toast） | 标准动画 |
| 罕见/首次（引导、反馈表单） | 可用完整入场序列 |

> 这条铁律对 Vessel 的直接含义：**Rail 的四个区域按钮、Sidebar 的会话行、Inspector 的 8 个 Tab，都属于"数十次/天"档位**——它们的动效应当被削减到接近瞬时（≤120ms），把动效预算留给抽屉、模态、空态入场。

### 铁律 5 · 层级靠空间与单一边框，不靠阴影堆叠（One plane, one border）
> 来源：`minimalist-ui`（Banned Elements：禁止 Tailwind 默认重阴影，阴影必须"几乎不存在或极度弥散且 alpha < 0.05"）、`dsh-client-ui-ux`（Reuse before adding）、`impeccable`（craft floor）

- **边框负责分离与焦点环，阴影负责真正的悬浮**。二者不可同时在同一平面上满配。
- **复用优先于新增**：能通过扩展现有组件/容器/交互实现的，绝不新建并行��素；图标只能从既有图标库取最语义接近的一枚，新增 glyph 需设计评审。
- **纯色大块背景、渐变、霓虹、3D 玻璃拟态（导航栏轻模糊除外）**为禁止项；主 CTA 用 `#111111` 级墨色实底，而非品牌色大面积铺陈。
- **双主题必须逐一验证**：任何"墨色/背景"对必须在 light 与 dark 下都保持可读，**dimmed 色永远不许直接用在文字上**。

---

## 二、当前落地 UI 结构的 5 大关键缺陷与代码定位

### 缺陷 1 · 网格是固定像素合唱团：三列 + 检视器互相挤压，且存在 1024–1180px 的**断点死区**

**现象**
`.app` 用三个硬编码列宽，`.dual-surface` 在检视器打开时再叠加一个硬编码 300px 列。所有伸缩压力全部由主工作台独自承担。

**代码定位**
```css
/* styles.css · .app */
.app {
  display: grid;
  grid-template-columns: 58px 232px minmax(0, 1fr);  /* ← 三列全固定 */
  gap: 12px;
  padding: 12px;
  height: 100vh;
  height: 100dvh;
}
```
```css
/* components/layout/layout.css */
.dual-surface { display: grid; grid-template-columns: minmax(0, 1fr); flex: 1 0 auto; min-height: 420px; }
.dual-surface.inspector-open { grid-template-columns: minmax(0, 1fr) 300px; gap: 12px; }
@media (max-width: 1180px) {
  .dual-surface.inspector-open { grid-template-columns: minmax(0, 1fr); }   /* ← 只改列数，不改定位方式 */
}
@media (max-width: 1023px) {
  .docked-inspector { position: fixed; inset: 0 0 0 auto; z-index: 61; width: min(90vw, 560px); border-radius: 0; }
  .inspector-backdrop { position: fixed; inset: 0; z-index: 60; background: #0008; }
}
```

**量化影响**（固定开销 = padding 24 + gap 24 + rail 58 + sidebar 232 = **338px**，检视器打开再扣 **312px**）：

| 视口宽度 | 主工作台可用宽度 | 检视器打开时聊天流宽度 | 结果 |
|---|---|---|---|
| 1440px | 1102px | 790px | 可用 |
| 1280px | 942px | **630px** | 偏窄，代码块横向滚动 |
| 1181px | 843px | **531px** | 接近不可用 |
| 1024–1180px | 686–842px | **374–530px** 或整列堆叠 | **死区：检视器既不 dock 也不 drawer，而是被塞到聊天流下方** |
| 834px | 496px | — | 232px 侧栏纹丝不动 |
| 390px | **52px** | — | 布局崩溃 |

**根因**
1. 断点策略不一致：`1180px` 只改列数、`1023px` 才改定位，`1024–1180px` 之间的 `.docked-inspector` 既不是固定列（列数已变单列）也不是 overlay（媒体查询未命中），于是**以普通文档流形式堆叠在 `.chat-surface` 之下**，配合其 `min-height: 420px`，用户会看到"聊天流 + 一个突兀的整高面板"。
2. `.inspector-backdrop` 的基础样式**只存在于 `≤1023px` 的媒体查询内**，没有基础声明。若 `DualSurfaceLayout.tsx` 在 `>1023px` 也渲染该元素 **【待确认】**，它会渲染为一个无样式的空 div。
3. `.main { overflow: hidden }` 与 `.dual-surface { flex: 1 0 auto; min-height: