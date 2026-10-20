# Task 229 — 基于 Open Claude UI (CDS) 的 Web UI 消息流与工具调用卡片质感升级

## Status: COMPLETED
- **Owner**: 主会话 (Planner/Coordinator) 调度
- **Research & Audit**: OpenCode (`commandcode/deepseek/deepseek-v4.1-flash`)
- **Implementer**: Codex (`gpt-6.1-sol`, reasoning_effort: medium)
- **Reviewer**: OpenCode (`commandcode/deepseek/deepseek-v4.1-flash#max`)
- **Reference**: `https://github.com/Caho1/open-claude-ui` · Claude Design System (CDS)
- **Date**: 2026-10-19

---

## 1. Goal
在 Task 228 完成发丝细边补偿、IME 守卫、圆角阶梯与双滚动消隐的基础上，根据 CDS 逆向规范（CDS 手册第 3.1、3.2、3.5 节），对 Vessel Web UI（`apps/web`）的消息流与工具执行卡片进行深度质感跃迁：

1. **P1: 交互式工具调用决策卡片（Tool Use Card / Activity Pill）**：
   - 将原单调文本行 `.tool-row` 升级为符合 CDS 3.5 规范的精密折叠卡片/胶囊：
     - 采用 `var(--panel-2)` 色阶垫底与发丝细边 `var(--ring-hairline) solid var(--ring)`，圆角使用 `--r-sm` (6px)；
     - 状态指示灯（`.dot`）：执行中显式微呼吸动画（`dot-warn` 呼吸脉冲），完成呈现凝练绿点（`dot-ok`），拦截/失败呈现红点（`dot-err`）；
     - 支持参数摘要（`tool-args`）与耗时（`tool-dur`）的光学排版对齐与溢出省略。
2. **P1: 思考流折叠卡片（Thinking Accordion）CDS 质感升级**：
   - 增强 [`StreamingReasoningBlock.tsx`](apps/web/src/components/widgets/StreamingReasoningBlock.tsx) 与 `.thinking-block` 视觉契约；
   - 挂载左侧 `--think: #7c5ce0` 思考主题色发丝强调线与动态状态指示点（`thinking-dot`）；
   - 平滑折叠展开微动画（`interpolate-size: allow-keywords;` + 160ms 缓动过渡）。
3. **P1: 消息气泡排版与 Markdown 渲染美化**：
   - 助手消息正文（`.msg-assistant .msg-body`）应用 `text-wrap: pretty;`，防止孤字掉行；
   - 行内代码与引用块采用 `var(--panel-2)` 底色 + 发丝内阴影，字阶统一为精密 monospace；
   - 用户消息气泡（`.msg-user .msg-body`）对齐同心圆角（`--r-1: 14px`）与柔和主强调色垫底。
4. **P1: 补齐 CDS 动效令牌与排版物理学**：
   - 在 `.tokens` 中补齐时长令牌：`--dur-fast: 60ms`、`--dur-snap: 120ms`、`--dur-base: 200ms`、`--dur-sheet: 300ms`、`--dur-slow: 450ms`；
   - 补齐缓动曲线：`--ease-swift: cubic-bezier(0.16, 1, 0.3, 1)`、`--ease-enter: cubic-bezier(0.22, 1, 0.36, 1)`；
   - 为计数器、时间、Token 计量等动态数字启用 `font-variant-numeric: tabular-nums`，消除数字跳动重排。

---

## 2. Not Doing
1. **禁止修改核心**：`packages/core` 修改行数严格保持为 0。
2. **禁止破坏既有测试**：所有 41 个 Web 单测及 289 个根测试 100% 保持 PASS。
3. **禁止引入重量级外部依赖**：不引入额外大型第三方库，纯原生 CSS Variables + React Hooks 落地。
4. **纯本地开发**：不向 GitHub push，所有删除走 Windows 回收站。

---

## 3. Scope & Blast Radius
- `apps/web/src/styles.css`: 补充动效时长令牌、缓动曲线、等宽数字、工具调用卡片样式与气泡排版
- `apps/web/src/components/ToolActivityRow.tsx`: 升级工具活动卡片的 DOM 结构与无障碍属性
- `apps/web/src/components/widgets/StreamingReasoningBlock.tsx`: 优化思考块折叠与无障碍状态
- `apps/web/src/components/ToolActivityRow.test.tsx` (如有/新增): 工具调用状态与渲染的单测覆盖

---

## 4. Acceptance Criteria
1. **工具调用卡片升级**：`.tool-row` 具备 `var(--panel-2)` 背景、发丝细边与精密圆角，状态灯具备明确色阶与状态语义；
2. **思考块质感提升**：`.thinking-block` 具备主题色强调、平滑折叠与等宽计时代币率；
3. **动效令牌与排版补齐**：`.tokens` 具备 `--dur-*` 与 `--ease-*` 规范令牌；时间与计数值均挂载 `tabular-nums`；
4. **门禁全绿**：
   - `npx tsc -b` exit 0；
   - `npm run typecheck:tests` exit 0；
   - `npm run -w @vessel/web test` 100% 通过（41+ 测试文件）；
   - `npm run -w @vessel/web build` 0 警告成功构建；
   - `npm run test:all` 双 Root 全量通过；
   - `packages/core` 0 改动。

---

## 5. Result & Evidence
- **交付代码**:
  - `apps/web/src/components/ToolActivityRow.tsx`: 全面升级为 CDS 3.5 规范的结构，支持 `tool-row--running/ok/danger` 状态色系、`tool-rail`、`tool-dot`（带呼吸脉冲）、自动格式化毫秒/秒、参数摘要截断与双行省略、完善的 `role="group"` / `aria-label` 语义；
  - `apps/web/src/components/ToolActivityRow.test.tsx`: 14 个独立测试全绿，覆盖状态联合体、时间格式化、无障碍可访问性与参数截断；
  - `apps/web/src/styles.css`: 注入 CDS 动效时长令牌与缓动曲线、思考块 `--think: #7c5ce0` 发丝高亮线、`tabular-nums` 动态计数等宽字体、`text-wrap: pretty;` 防止孤字掉行。
- **独立审查结论**:
  - 独立评审人 OpenCode (`deepseek-v4.1-flash#max`) 出具对抗性复核报告 (`evidence/sessions/2026-10-19-opencode-review-229.md`)，评定结果为 **PASS / 完整达标**。
- **全量门禁实测结果**:
  - `npx tsc -b`: exit 0
  - `npm run typecheck:tests`: exit 0
  - `npm run -w @vessel/web build`: exit 0 (289ms, 90 modules transformed)
  - `npm run -w @vessel/web test`: 42 files / 365 passed (100%)
  - `npm run test:all`: 双 Root 全量 331 files / 3,428 passed (100%)
    - 根: 289 files / 3,063 passed | 6 skipped
    - Web: 42 files / 365 passed
  - `packages/core` 修改行数: **0**

