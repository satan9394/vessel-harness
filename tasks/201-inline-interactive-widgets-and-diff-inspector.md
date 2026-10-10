# 201 — Web 对话流内嵌交互微组件与可折叠 Diff 检查器 (Inline Interactive Widgets & Diff Inspector)

- 编号：201
- 优先级：P1
- 关联模块：`apps/web`, `packages/application`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已完成（本地验证）
- 创建日期：2026-10-09

---

## 1. 目标与意图

在 Web 端交互中，用户最大的痛点是面对大段平铺的补丁文本或缺乏上下文的确认提示。

本任务旨在建立 **Vessel Web 端就地交互微组件生态（Inline Interactive Widgets）**，将任务 200 定义的 `WidgetBlock` 在 React 19 对话流中直接渲染为高保真、可操作的交互卡片：
1. **GitHub 风格可折叠 Diff 检查器 (`InlineDiffInspector.tsx`)**：
   - 呈现文件路径、增删统计标签（`+N / -M`）；
   - 支持一键折叠/展开、Unified 代码高亮与行号对齐；
2. **Red→Green 门禁验真徽章 (`RedGreenGateBadge.tsx`)**：
   - 动态指示红（Red 阶段失败验证）与绿（Green 阶段修复合规）双态指示灯；
   - 呈现防伪 SHA-256 凭据徽章与可展开的错误特征摘要；
3. **AST 影响面雷达图谱 (`AstImpactRadar.tsx`)**：
   - 直观展示本次编辑影响的外部调用者（Caller）与关联模块，告别黑盒盲改；
4. **就地审批交互卡片 (`PermissionActionCard.tsx`)**：
   - 渲染优雅的选项按钮组，点击后异步发送响应并原地切换为禁用/已确认视图。

---

## 2. 接口契约规范 (Interface-First)

### 2.1 组件分发容器 (`apps/web/src/components/widgets/WidgetDispatcher.tsx`)

```tsx
import type { WidgetBlock } from '@vessel/shared';

export interface WidgetDispatcherProps {
  widget: WidgetBlock;
  sessionId: string;
  onRespond?: (widgetId: string, optionId: string) => Promise<void>;
}

export function WidgetDispatcher({ widget, sessionId, onRespond }: WidgetDispatcherProps): React.JSX.Element;
```

### 2.2 样式与可访问性规范
- 采用 Tailwind CSS，完全匹配当前黑暗/明亮主题与精致极简风格；
- 按钮带有微交互悬浮态与加载中（loading）指示，防止重复点击；
- 折叠状态默认针对 >20 行的 Diff 进行自动折叠，避免单次刷屏阻断阅读。

---

## 3. 验收标准与测试用例 (DoD)

1. **组件单元与交互测试 (`apps/web/src/components/widgets/InlineDiffInspector.test.tsx` 等)**：
   - 验证 `InlineDiffInspector` 正确解析并呈现 Unified Diff 的增删行数，点击折叠切换显示状态；
   - 验证 `RedGreenGateBadge` 在 `phase: 'red_verified'` 时显示警告黄红徽章，在 `green_verified` 时显示成功绿徽章并展示哈希前缀；
   - 验证 `PermissionActionCard` 点击选项后正确调用 `onRespond`，并切换状态为 `resolved`；
2. **生产构建检查**：
   - `npm run -w @vessel/web build -- --emptyOutDir false` exit 0；
3. **全仓回归**：
   - `npm run test:all` 与 `npm run typecheck:tests` exit 0。


## 4. Delivery evidence
2026-10-09: Web21 files/188 tests passed; Web typecheck, test typecheck, production build with emptyOutDir=false exit0. Actual browser verified four cards, >20-line collapse/expand, full proof hash, permission response resolving waiting turn, disabled resolved controls and reload replay. No browser warnings/errors. Evidence: evidence/sessions/2026-10-09-v2.4/card201-*.log and card201-resolved.jpg.

