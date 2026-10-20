# 基于 Open Claude UI (CDS) 的 Vessel Web UI 深度优化方案与整改清单

> **调研落盘路径**：`evidence/sessions/2026-10-19-open-claude-ui-study.md`
> **调研对象**：`https://github.com/Caho1/open-claude-ui`（Claude Design System 逆向工程 · CDS 1.0 / CDS 2.0 演进）
> **被审查对象**：Vessel Harness 现有前端（`apps/web/src/styles.css`、`components/layout/layout.css`、`components/ConversationView.tsx`、`components/TaskComposer.tsx`、`App.tsx`）
> **产出级别**：面向后续 Codex 在独立沙箱中编码落地的确定性实施基线
> **调研时间**：2026-10-19

---

## 目录

- [一、Open Claude UI (CDS) 核心设计精髓拆解与对标价值](#一open-claude-ui-cds-核心设计精髓拆解与对标价值)
- [二、Vessel Web UI 当前落地与 CDS 规范的差距走查](#二vessel-web-ui-当前落地与-cds-规范的差距走查)
- [三、系统性整改方案与落地细则](#三系统性整改方案与落地细则)
- [四、任务卡 228：确定性验收断言与实施步骤清单](#四任务卡-228确定性验收断言与实施步骤清单)
- [附录 A：整改实施顺序与依赖拓扑](#附录-a整改实施顺序与依赖拓扑)
- [附录 B：回归风险与回滚策略](#附录-b回归风险与回滚策略)

---

## 一、Open Claude UI (CDS) 核心设计精髓拆解与对标价值

CDS 的价值不在于「Claude 长什么样」，而在于它把**视觉高级感**降解为**可复制的工程约束**。以下逐一拆解六大可迁移精髓。

### 1.1 Surface 0–3 色彩阶梯：用「明度微差」代替「生硬描边」

CDS 摒弃了「每个区块都描一道灰边」的业余做法，改用 4 阶递��的表面亮度建立空间纵深：

| 令牌 | 浅色 | 深色 | 语义 | Vessel 对应物 |
| :--- | :--- | :--- | :--- | :--- |
| `--cds-surface-0` | `#f9f9f7` | `#0b0b0b` | 侧边栏 / 窗口根底 | `--bg` |
| `--cds-surface-1` | `#fcfcfb` | `#151515` | 主聊天画布 | `--panel-2`（近似） |
| `--cds-surface-2` | `#ffffff` | `#1a1a19` | 消息容器 / 卡片 | `--panel` |
| `--cds-surface-3` | `#ffffff` | `#20201f` | 输入框 / 高亮浮层 | `--panel-3`（近似） |

**核心洞察**：CDS 深色模式严格遵守「每阶下沉 2 个 HEX 单位」的等距步进律（`#20201f → #1e1e1d → ... → #0b0b0b`），彻底消除 OLED 屏上的灰阶断层色斑。Vessel 的深色表面（`#0d0f18 → #131725 → #1a1f30`）虽然也是递进，但步进间距不均匀（Δ≈6, 7, 13），存在色带风险。

**对标价值**：Vessel 已有 `--panel / --panel-2 / --panel-3` 三阶，结构上已具备 Surface 阶梯雏形，**无需推倒重来**，只需补齐表面阶梯的语义命名、统一深色步进律、并明确「一屏一条视线至多穿过一层闭合边框」的边界哲学。

### 1.2 陶土橙（Clay `#d97757`）色彩哲学：克制的暖色重音

CDS 拒绝赛博蓝紫，主品牌色选用温润陶土橙。其关键不在于「橙」，而在于**用色纪律**：

- **Clay 只出现在高价���触点**：思考脉冲点、聚焦环、拖拽吸附光晕、发送按钮焦点。
- **强调态加重色** `--cds-clay-emphasized: #cc5a36` 用于 hover 加深。
- **聚焦环三层结构**：

```css
--cds-focus-shadow:
  inset 0 0 0 1px var(--cds-surface-1),      /* 隔离垫片 */
  0 0 0 1.5px var(--cds-clay),                /* 品牌主聚焦环 */
  0 0 6px 1px rgba(217, 119, 87, 0.25);       /* 环境漫射光晕 */
```

**对标价值**：Vessel 现用 `--accent: #5b6cff`（靛蓝）。本方案**不主张强行改为陶土橙**（品牌资产归 Vessel 所有），而是主张把「Clay 用色纪律」迁移过来：将 `--accent` 定位为**唯一高价值强调色**，并补齐三层焦点环。若需更贴近 CDS 温润质感，可提供 `--accent-clay: #d97757` 作为可选主题。

### 1.3 0.5px 视网膜发丝细边（Retina Hairline）

CDS 最关键的光学工程之一：**在 `@2x/@3x` 视网膜屏上，标准 `1px` 占 2–3 个物理发光点，视觉过重**。其解决方案：

```css
:root { --cds-ring-hairline: 1px; }
@media (min-resolution: 2dppx), (resolution >= 2x) {
  :root { --cds-ring-hairline: 0.5px; }
}
@media (min-resolution: 3dppx), (resolution >= 3x) {
  :root { --cds-ring-hairline: calc(1px / 3); }
}
```

**并有两条防抖动的铁律**：

1. **弃用 `border: 1px solid`���改用 `box-shadow: inset 0 0 0 Npx`**——绕开盒模型，切换激活态时零重排。
2. **深色模式倒角高光逆转**：深色浮层不加白色外框，改用 `inset 0 0 0 1px rgba(255,255,255,0.10)` 模拟工业硬件倒角顶光。

**对标价值**：Vessel 全量使用 `border: 1px solid var(--ring)`（rails、docked-inspector、卡片），在高分屏上偏厚重，且 hover/active 切换时存在微观重排风险。**这是整改收益最高、改动最集中的一项**。

### 1.4 精密圆角拓扑矩阵

CDS 建立了完整的圆角语义层级，且定义了**同心圆角公式**：

```css
--radius-card: calc(var(--cds-radius) + calc(.25rem * var(--cds-rem-scale, 1)));
```

| 令牌 | 像素 | 承载组件 |
| :--- | :--- | :--- |
| `--radius-sm` | 4px | 快捷键徽章 |
| `--radius-md` | 6px | 极小按钮 |
| `--radius-lg` | 8px | **标准按钮 / 输入框 / 菜单项** |
| `--cds-panel-radius` | 10px | 附件条目 |
| `--radius-xl` | 12px | 代码块 / 抽屉 |
| `--radius-2xl` | 16px | 模态框 |
| `--cds-message-bubble-radius` | 18px | 用户消息气泡 |
| `--cds-radius-composer` | 20px | **底部常驻输入框** |

**对标价值**：Vessel 的圆角阶梯从 14px 起步（`--r-1: 14px → --r-4: 30px`），**整体偏「大而软」**，缺少 4–8px 的精密小圆角用于按钮、徽章、菜单项。这导致精细控件（模型胶囊、分段 Tab、徽章）在 Vessel 中一律退化为 `--r-pill`，视觉上「一圆到底」，丧失光学层次。**建议补齐 4/6/8px 精密阶梯，仅保留 pill 用于真正的胶囊滑块与状态点**。

### 1.5 IME 中文输入法合成守卫

CDS 对 CJK 输入的防线极为细致（依据生产包取证）：

- **焦点态 `isComposing` 拦截**：在 `compositionstart → compositionend` 之间，`Enter` 属于「确认候选词」语义，**绝不能触发提交**。
- **回车换行 vs 提交的双键契约**：`Enter` 提交、`Shift+Enter` 换行，且二者在合成态均需让位给 IME。
- **输入框字号防缩放底线**：`font-size: max(16px, 14px)`，规避 iOS WebKit 焦点强制缩放。

**对标价值**：**这是 Vessel 当前最严重的可用性缺陷**。`TaskComposer.tsx` 的 `submit(event)` 挂在 `onSubmit` 上，中文用户用拼音输入「执行」时，键入 `zhi xing` 后按 `Enter` 选词，浏览器会同时派发 `submit` 事件，**导致任务在中文词未完成时就以乱码/半成品文本提交**。此项属于 P0 必修。

### 1.6 Zero-JS 滚动消隐遮罩（Scroll-Driven Fade Mask）

CDS 用纯 CSS `mask-image` 实现上下边缘 28px 非线性羽化，且由滚动时间轴驱动（`scroll-timeline`），GPU Compositor 承载，零主线程开销：

```css
--cds-scroll-fade-size: 28px;
--cds-scroll-fade-mask: linear-gradient(
  to bottom,
  var(--strip) 0%,
  rgb(from var(--strip) r g b / .85) 13%,
  rgb(from var(--strip) r g b / .50) 40%,
  rgb(from var(--strip) r g b / .15) 70%,
  transparent 100%
);
```

**核心洞察**：传统的滚动容器边缘处理有两种劣化——要么**硬截断**（文字被生硬切断），要么**叠加纯色渐变层**（在玻璃拟态/彩色光场上会出现色偏）。CDS 用 `color-mix()` / `rgb(from ...)` 动态提取当前背景色，做到**任何背景都能自适应羽化**。

**对标价值**：Vessel 的 `.inspector-content` 使用 `overflow: auto`，消息流 `ConversationView` 亦无边缘处理，滚动时文字在顶/底**硬生生截断**，与 CDS 的杂志级流畅感差距明显。此项为 P1，收益视效显著。

---

## 二、Vessel Web UI 当前落地与 CDS 规范的差距走查

> 走查方法：以 `styles.css` 的 `.tokens` 层为基准，逐条对照 CDS 规范，标注差距等级（P0 阻断 / P1 显著 / P2 优化）。

### 2.1 差距总览矩阵

| # | 差距维度 | CDS 规范 | Vessel 现状 | 等级 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | IME 合成守卫 | `isComposing` 拦截 Enter | **完全缺失** | **P0** |
| 2 | 发丝细边 | `0.5px` @2x + `box-shadow` 代替 border | 全量 `border: 1px solid` | **P0** |
| 3 | 深色字重逆补偿 | 深色 `wght -40` | 无 | P1 |
| 4 | 滚动消隐遮罩 | 28px 非线性 fade mask | 无，硬截断 | P1 |
| 5 | 焦点环 | 三层陶土环 | 默认浏览器 outine（疑似） | P1 |
| 6 | 圆角精度阶梯 | 4/6/8/10/12/16/18/20px | 14/18/24/30 + pill | P1 |
| 7 | 动效令牌 | 5 档时长 + 7 条曲线 | 仅 `--ease` 单曲线 | P1 |
| 8 | 输入框双环投影 | Resting/Hover/Focus 三态 | 未明确 | P2 |
| 9 | 图标基线校准 | `.align-[-0.125em]` | 无 | P2 |
| 10 | 文本换行约束 | `text-wrap: pretty/balance` | 无 | P2 |
| 11 | 表面阶梯语义 | Surface 0–3 命名 | `bg/panel/panel-2/panel-3` | P2 |
| 12 | 深色等距步进 | 每阶 Δ2 HEX | 步进不均（Δ6/7/13） | P2 |

### 2.2 逐项精确走查

#### 差距 1（P0）：TaskComposer 无 IME 合成守卫

**证据**（`TaskComposer.tsx`）：

```tsx
async function submit(event: React.FormEvent) {
  event.preventDefault(); if (!root || !task.trim() || busy || loading || failed || unavailable || disabled) return;
  ...
}
return <form className="task-composer" onSubmit={submit}>
  ...
  <textarea ref={taskInput} id="taskInput" className="input task-input" ... />
```

**问题**：`submit` 只挂在 `<form onSubmit>`，`<textarea>` 无 `onCompositionStart/End` 守卫，且未拦截 `Enter` 键。中文拼音输入时按 Enter 选词会触发提交。**这是 CJK 用户的确定性数据损坏路径**。

#### 差距 2（P0）：border 过粗且触发重排

**证据**（`layout.css`）：

```css
.docked-inspector { border: 1px solid var(--ring); }
.rail { border: 1px solid var(--ring); box-shadow: var(--shadow-2); }
```

**问题**：
- 视网膜屏上视觉过重（2–3 物理点）。
- `.inspector-tabs [aria-selected='true']` 切换时 `border-color` 变化会计入盒模型 → 微观重排。

#### 差距 3（P1）：深色模式无字重逆补偿

**证据**（`styles.css`）：`body { font-weight` 未在 `@media (prefers-color-scheme: dark)` 中差异化。白字黑底的**光渗效应**会使深色模式文字感知上粗 10–15%。

#### 差距 4（P1）：聊天流无滚动消隐

**证据**：`.inspector-content { overflow: auto; }` 与 `ConversationView` 的 `listRef` 均无 `mask-image`。滚动时顶底文字硬截断。

#### 差距 5（P1）：焦点环缺位

**证据**：`styles.css` 无 `:focus-visible` 定义；`.inspector-tabs [aria-selected='true']` 仅用 `border-color: var(--ring-2)`。

#### 差距 6（P1）：圆角阶梯缺精密小值

**证据**：`--r-1: 14px` 起步，`.inspector-tabs .btn` 用 `--r-pill`。CDS 的 4/6/8px 精密层级完全缺位。

#### 差距 7（P1）：动效令牌单薄

**证据**：`--ease: cubic-bezier(0.32, 0.72, 0, 1)` 单曲线，无时长令牌。CDS 有 `60/120/200/300/450ms` 5 档 + 7 条专用曲线。

#### 差距 8–12（P2）：细节工程

- Composer 三态投影未定义。
- 图标无 `vertical-align` 校准。
- 无 `text-wrap: pretty / balance`。
- 表面令牌命名无 Surface 语义。
- 深色步进不均。

---

## 三、系统性整改方案与落地细则

> 以下四组整改相互解耦，可并行实施。每项均给出**可直接落地的最小代码**。

### 3.1 令牌层升级：CDS 语义映射 + 发丝细边 + 字重逆补偿

#### 3.1.1 在 `.tokens` 中补齐 CDS 语义层（向后兼容）

保留 Vessel 现有变量为别名，**新增** CDS 语义层，避免既有组件 CSS 大面积改动（延续 `IMPLEMENTATION-PLAN §3` 的别名策略）：

```css
.tokens {
  /* ——— 既有令牌保持不变 ——— */
  --bg: #e4e8f3;
  --panel: #ffffff;
  --panel-2: #f2f4fb;
  --panel-3: #e4e8f5;
  /* ... */

  /* ——— 新增：CDS Surface 语义阶梯映射 ——— */
  --surface-0: var(--bg);        /* 侧边栏 / 根底 */
  --surface-1: var(--panel-2);   /* 主聊天画布 */
  --surface-2: var(--panel);     /* 消息容器 / 卡片 */
  --surface-3: var(--panel-3);   /* 输入框 / 浮层 */

  /* ——— 新增：发丝细边与 alpha 阶梯 ——— */
  --alpha-1: rgba(38, 44, 80, 0.05);
  --alpha-2: rgba(38, 44, 80, 0.10);
  --alpha-3: rgba(38, 44, 80, 0.16);
  --border: var(--ring);
  --border-strong: var(--ring-2);
  --ring-hairline: 1px;          /* 由媒体查询覆盖 */

  /* ——— 新增：精密圆角阶梯 ——— */
  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-panel: 10px;
  --radius-xl: 12px;
  --radius-2xl: 16px;
  --radius-bubble: 18px;
  --radius-composer: 20px;

  /* ——— 新增：动效时长令牌 ——— */
  --dur-fast: 60ms;
  --dur-snap: 120ms;
  --dur-base: 200ms;
  --dur-sheet: 300ms;
  --dur-slow: 450ms;

  /* ——— 新增：物理缓动曲线全集 ——— */
  --ease-swift: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-expand: cubic-bezier(0.19, 1, 0.22, 1);
  --ease-enter: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-overshoot: cubic-bezier(0.34, 1.3, 0.64, 1);
  --ease-pop: cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

#### 3.1.2 视网膜发丝细边 CSS

```css
:root { --ring-hairline: 1px; }

@media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 2dppx), (resolution >= 2x) {
  .tokens { --ring-hairline: 0.5px; }
}
@media (-webkit-min-device-pixel-ratio: 3), (min-resolution: 3dppx), (resolution >= 3x) {
  .tokens { --ring-hairline: calc(1px / 3); }
}

/* 发丝细边实用类：用 box-shadow 代替 border，零重排 */
.hairline {
  box-shadow: inset 0 0 0 var(--ring-hairline) var(--border);
}
.hairline-strong {
  box-shadow: inset 0 0 0 var(--ring-hairline) var(--border-strong);
}
```

**迁移 `.docked-inspector` / `.rail`**：

```css
.docked-inspector {
  /* 原：border: 1px solid var(--ring); */
  border: 0;
  box-shadow: inset 0 0 0 var(--ring-hairline) var(--border), var(--shadow-2);
}
```

#### 3.1.3 深色模式字重逆补偿

```css
@media (prefers-color-scheme: dark) {
  body {
    /* 光渗逆补偿：深色下整体减薄，仅对可变字重有效 */
    font-variation-settings: 'wght' 360, 'GRAD' 0;
  }
  .font-medium, .fw-500 { font-variation-settings: 'wght' 460, 'GRAD' 0; }
  .font-semibold, .fw-600 { font-variation-settings: 'wght' 550, 'GRAD' 0; }
}
```

> **注意**：此补偿仅对**可变字体**（Geist Variable / 系统 Variable Sans）生效。若当前 `font-family` 回退到静态字重（如 `PingFang SC`），则需改为类级别 `font-weight: 380/470/560` 的近似值。**实施时须用 `document.fonts.check('16px Geist')` 探测可用性，双分支落地**。

#### 3.1.4 三层焦点环

```css
:focus-visible {
  outline: none;
  box-shadow:
    inset 0 0 0 1px var(--surface-1),
    0 0 0 1.5px var(--accent),
    0 0 6px 1px color-mix(in srgb, var(--accent) 25%, transparent);
}
```

### 3.2 输入引擎升级：IME 守卫 + Composer 圆角与操作栏

#### 3.2.1 抽出可复用的 IME 守卫 Hook

新建 `apps/web/src/components/hooks/useCompositionGuard.ts`：

```ts
import { useRef, useCallback } from 'react';

/**
 * IME 合成守卫：合成态内 Enter 属于「确认候选词」，禁止触发提交。
 * 同时暴露 wrapKeyDown，用于 textarea 的 Enter 提交 / Shift+Enter 换行契约。
 */
export function useCompositionGuard() {
  const composingRef = useRef(false);

  const onCompositionStart = useCallback(() => { composingRef.current = true; }, []);
  const onCompositionEnd = useCallback(() => { composingRef.current = false; }, []);
  const isComposing = useCallback(() => composingRef.current, []);

  const wrapKeyDown = useCallback(
    (handler: (e: React.KeyboardEvent) => void) =>
      (e: React.KeyboardEvent) => {
        // 合成态：一切提交/换行语义让位给 IME
        if (composingRef.current || (e.nativeEvent as any).isComposing) return;
        handler(e);
      },
    [],
  );

  return { onCompositionStart, onCompositionEnd, isComposing, wrapKeyDown };
}
```

#### 3.2.2 改造 `TaskComposer.tsx` 的 textarea

```tsx
const guard = useCompositionGuard();

const handleKeyDown = guard.wrapKeyDown((e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    // 复用现有 submit 逻辑（抽出为 submitTask()）
    void submitTask();
  }
  // Shift+Enter 走默认换行
});

<textarea
  ref={taskInput}
  id="taskInput"
  className="input task-input"
  placeholder={t('taskPlaceholder')}
  value={task}
  onChange={(event) => setTask(event.target.value)}
  onCompositionStart={guard.onCompositionStart}
  onCompositionEnd={guard.onCompositionEnd}
  onKeyDown={handleKeyDown}
/>
```

> **同时须守卫 `<form onSubmit>`**：若保留了原生表单回车提交路径，需在 `submit(event)` 首行加 `if (guard.isComposing()) { event.preventDefault(); return; }`。

#### 3.2.3 Composer 外框圆角与三态投影

```css
.task-composer textarea,
.composer {
  border-radius: var(--radius-composer); /* 20px */
  border: 0;
  /* 常态 */
  box-shadow:
    0 4px 20px rgba(38, 44, 80, 0.035),
    inset 0 0 0 var(--ring-hairline) var(--border);
  transition:
    box-shadow var(--dur-base) var(--ease-swift),
    border-radius var(--dur-base) var(--ease-swift);
}

.composer:hover {
  box-shadow:
    0 4px 24px rgba(38, 44, 80, 0.06),
    inset 0 0 0 var(--ring-hairline) var(--border-strong);
}

.composer:focus-within {
  box-shadow:
    0 4px 24px rgba(38, 44, 80, 0.08),
    inset 0 0 0 var(--ring-hairline) var(--border-strong),
    0 0 0 1px var(--border-strong);
}

/* iOS 焦点防缩放底线 */
.task-composer textarea,
.composer textarea {
  font-size: max(16px, 14px);
  border: 0;
  outline: none;
  background: transparent;
}
```

### 3.3 聊天流滚动消隐遮罩升级

#### 3.3.1 纯 CSS 遮罩工具类

新建 `apps/web/src/styles/scroll-fade.css`（或并入 `styles.css`）：

```css
:root {
  --scroll-fade-size: 28px;
}

/**
 * 上下滚动消隐遮罩。
 * 用 color-mix 动态提取背景色（var(--surface-1)），保证在玻璃/彩色光场上无色偏。
 * 使用 mask-image 而非覆盖层，不遮挡交互事件。
 */
.scroll-fade-y {
  --strip: var(--surface-1);
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 var(--scroll-fade-size),
    #000 calc(100% - var(--scroll-fade-size)),
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 var(--scroll-fade-size),
    #000 calc(100% - var(--scroll-fade-size)),
    transparent 100%
  );
  /* 平滑边缘，避免 mask 锯齿 */
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

/* 仅顶部 / 仅底部变体 */
.scroll-fade-top {
  --strip: var(--surface-1);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 var(--scroll-fade-size));
  mask-image: linear-gradient(to bottom, transparent 0, #000 var(--scroll-fade-size));
}
.scroll-fade-bottom {
  --strip: var(--surface-1);
  -webkit-mask-image: linear-gradient(to top, transparent 0, #000 var(--scroll-fade-size));
  mask-image: linear-gradient(to top, transparent 0, #000 var(--scroll-fade-size));
}
```

#### 3.3.2 应用到消息流与 Inspector

```css
.inspector-content {
  overflow: auto;
  overscroll-behavior: contain;
  /* 新增消隐 */
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 var(--scroll-fade-size),
    #000 calc(100% - var(--scroll-fade-size)),
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 var(--scroll-fade-size),
    #000 calc(100% - var(--scroll-fade-size)),
    transparent 100%
  );
}
```

#### 3.3.3 进阶（可选）：滚动位置感知显隐（Zero-JS）

利用原生 `animation-timeline: scroll()`（Chrome 115+ / Safari 26+）实现「触顶时遮罩归零」：

```css
@supports (animation-timeline: scroll()) {
  .scroll-fade-y {
    animation: fade-top linear both;
    animation-timeline: scroll(self block);
    animation-range: 0 28px;
  }
  @keyframes fade-top {
    from { --scroll-fade-size: 0px; }
    to { --scroll-fade-size: 28px; }
  }
}
```

> **兼容策略**：`@supports` 不满足时自动回退到 3.3.2 的静态遮罩，功能不缺失。

### 3.4 交互微动效与精密尺寸

#### 3.4.1 几何咬合曲线（120ms / 70ms）

CDS 的按钮与胶囊强调「快速到位、无残影」：

```css
.btn,
.chip,
.capsule,
[role='tab'] {
  transition:
    background-color var(--dur-snap) var(--ease-swift),
    color var(--dur-snap) var(--ease-swift),
    box-shadow var(--dur-snap) var(--ease-swift),
    transform var(--dur-fast) var(--ease-swift);
}

/* 按压物理微回弹 */
.btn:active,
.chip:active,
.capsule:active {
  transform: scale(0.98);
}

/* 卡片抬升 */
.card:hover,
.module-card:hover {
  transform: translateY(-1.5px);
  box-shadow: var(--shadow-2);
}
```

#### 3.4.2 胶囊滑块超调曲线

```css
.segmented-slider {
  transition: transform var(--dur-base) var(--ease-overshoot);
}
```

#### 3.4.3 消息入场消融

```css
@keyframes timeline-block-enter {
  from {
    opacity: 0;
    transform: translateY(5px) scale(0.99);
    filter: blur(4px);
  }
  to {
    opacity: 1;
    transform: none;
    filter: blur(0);
  }
}
.timeline-block-enter {
  animation: timeline-block-enter var(--dur-base) var(--ease-enter);
}
```

#### 3.4.4 图标基线与文本换行

```css
/* 行内图标光学基线校准 */
.icon-inline { vertical-align: -0.125em; }
.icon-inline-sm { vertical-align: -0.075em; }

/* 标题均衡、正文去孤字 */
:is(h1, h2, h3, h4), .card-title { text-wrap: balance; }
:is(p, li, dd, blockquote) { text-wrap: pretty; }

/* 超长 ID 安全换行 */
.workspace-fingerprint, .token-id, .model-id {
  overflow-wrap: anywhere;
  word-break: normal;
}

/* 动态计数锁定等宽数字 */
.counter, .token-count, .timer, time {
  font-variant-numeric: tabular-nums;
}
```

---

## 四、任务卡 228：确定性验收断言与实施步骤清单

> **任务卡编号**：TASK-228
> **标题**：Vessel Web UI — CDS 规范对齐（令牌 / IME / 滚动消隐 / 微动效）
> **执行环境**：独立 Sandbox（Codex 自动编码）
> **约束**：所有改动向后兼容；既有变量名保留为别名；不改动品牌 accent 色值。

### 4.1 交付物清单（DoD）

| 编号 | 交付物 | 路径 |
| :--- | :