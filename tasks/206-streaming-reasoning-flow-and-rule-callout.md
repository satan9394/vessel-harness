# 206 — 流式思考链可视化折叠器与认知规则标注 (Streaming Reasoning & Cognition Callouts)

- 编号：206
- 优先级：P1
- 关联模块：`apps/web`, `packages/shared`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已验证（root 28 / web 22；类型门禁 exit 0）
- 创建日期：2026-10-10

---

## 1. 目标与意图

随着具备深度思考能力模型（OpenAI GPT-6.1 Sol、DeepSeek-R1 等）的普及，模型在输出真实指令前会产生长达数千字的思维链（Chain-of-Thought / Reasoning）。如果直接平铺在屏幕上，会严重稀释核心产物的可读性。

本任务旨在建立 **Vessel 流式思考链可视化折叠器与经验规则标注体系**：
1. **带动态计时器的可折叠思考流 (`ReasoningAccordion.tsx`)**：
   - 流式接收 `reasoning_content`，展示实时呼吸动效与动态耗时 Ticker（`思考中... 4.2s`）；
   - 思考结束进入正文输出时，自动平滑收起为轻量胶囊卡片，点击可随时展开查看推演全文；
2. **认知经验规则靶向标注 (`RuleCalloutBadge.tsx`)**：
   - 当会话命中或生成经验规则（`ReflectiveRule`）时，在思考流旁渲染徽章，点击直接查看过往教训与避免踩坑的说明。

---

## 2. 接口契约规范 (Interface-First)

### 2.1 组件类型契约 (`apps/web/src/components/chat/ReasoningAccordion.tsx`)

```tsx
export interface ReasoningAccordionProps {
  content: string;
  isStreaming: boolean;
  elapsedMs?: number;
  matchedRules?: Array<{ id: string; trigger: string; lesson: string }>;
  defaultExpanded?: boolean;
}

export function ReasoningAccordion(props: ReasoningAccordionProps): React.JSX.Element;
```

---

## 3. 验收标准与测试用例 (DoD)

1. **组件单元测试 (`apps/web/src/components/chat/ReasoningAccordion.test.tsx`)**：
   - 验证流式状态下展示动画与计时；流式完成后默认处于收起状态；点击切换展开/折叠；
   - 验证传入 `matchedRules` 时能够正确呈现规则徽章并展示教训文本；
2. **构建与门禁**：
   - `npm run -w @vessel/web build -- --emptyOutDir false` exit 0；
   - `npm run test:all` 全绿通过。

工作证明：`evidence/sessions/2026-10-10-v2.5/card206-proof.md`。完整回归与浏览器门禁由 Epic 209 执行。

