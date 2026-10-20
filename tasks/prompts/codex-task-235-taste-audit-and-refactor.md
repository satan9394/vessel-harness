# 任务 235：基于 Taste-Skill 的 Web 工作台全面审美审查与全屏通栏 UI 重构

## 1. 角色定位与任务背景

你是 **Codex**（`gpt-6.1-sol`，思考深度 `medium`），负责独立对 Vessel Web 工作台进行高阶审美审查与前端 UI 重构。

### 用户原始需求与痛点
用户最新反馈：
> "【https://github.com/leonxlnx/taste-skill】用这个skill交接给Codex来对页面全面审查，页面还是比较糟糕的，审查出来的相关的不足进行优化，UI重构，换一个，不要整这种弧形的，直接用直接覆盖全屏的那种。"

当前界面最大的硬伤是：
- 滥用浮动毛玻璃孤岛卡片（四周有 `padding: 12px; gap: 12px;` 留出缝隙，卡片用各种大圆角弧形漂浮在全黑背景上）；
- 整体视觉松散、割裂、带有强烈的模版感与业余感，像个半吊子 landing page 演示品，而不是像 Linear、VS Code、Zed、GitHub 这样专业、严正、工业级全屏通栏（Edge-to-Edge）的生产力 Harness。

设计基准库已克隆在本地：
`.agents/skills/design-taste-frontend/skills/taste-skill/references/app-screens.md`（重点参考第 1 节核心法则、第 3 节 Shell 与分栏规范）。

---

## 2. 工作范围与两阶段要求

### 第一阶段：全面审美审查并产出审查报告
1. 深入研读 `.agents/skills/design-taste-frontend/skills/taste-skill/references/app-screens.md`；
2. 审查 `apps/web/src/styles.css`、`apps/web/src/App.tsx`、`apps/web/src/components/layout/Rail.tsx`、`Sidebar.tsx`、`TaskComposer.tsx`、`ConversationView.tsx` 等；
3. 输出审美审查报告到 `evidence/sessions/2026-10-20-taste-skill-audit-235.md`，至少包含：
   - 当前界面 5 个违背 `taste-skill` 的核心缺陷（弧形小岛、留白缝隙、材质滥用、层级混乱、沉浸感不足）；
   - 对标工业级全屏工作台（Edge-to-Edge）的具体重构策略。

### 第二阶段：实施 UI 重构（彻底消除弧形小岛，落地全屏通栏）
1. **外层栅格与视口贴合 (`apps/web/src/styles.css`)**：
   - 移除 `.app` 的 `padding: 12px; gap: 12px;`，改为 `padding: 0; gap: 0; width: 100vw; height: 100dvh;`；
   - 彻底移除 Rail、Sidebar、Main 外层的孤岛圆角（`border-radius: 0`），使其顶天立地贴满屏幕；
   - 三栏之间采用严整清爽的 Hairline 细分割线：
     - Rail 58px 右侧边框：`border-right: 1px solid var(--ring);`；
     - Navigation-shell 232px 右侧边框：`border-right: 1px solid var(--ring);`；
     - 主工作区 Main 占据剩余全部宽度（`1fr`），无外围边距。
2. **顶栏与工作区通栏平铺**：
   - `.topbar` 贴顶贯穿，高度稳定（如 48px），移除浮空圆角与多余外边距；
   - 工作台首页（`workbench-home`）与会话区（`conversation-wrap`）高度充满整个主视口（`height: 100%`），工作流内容垂直居中或平顺流式排列；
   - 彻底消除背后露出的漂浮全黑死角，给整个 App 统一赋予专业平实的底色梯度（深色模式下深灰/炭黑 `#0d1117` / `#161b22`，浅色模式下 `#ffffff` / `#f6f8fa`）。
3. **按钮与组件几何去浮夸化**：
   - 去除不必要的大弧形圆角（如从 16px/24px 收敛到实用的 4px-6px 极简微圆角）；
   - 保留上一轮交付的深浅色切换、会话删除、模型中枢嵌入（`ProviderHub`）、GFM Markdown 与 OpenUI 生成式卡片功能。

---

## 3. 验收标准与门禁红线

1. **红线纪律**：
   - `packages/core` 修改行数严格为 0；
   - 禁止任何彻底删除命令（遵循 Windows 回收站纪律）；
   - 纯本地开发，严禁 `git push`。
2. **测试门禁**：
   - `npx vitest run --root apps/web`: 50 个测试文件全部 passed；
   - `npx tsc -b tsconfig.json` exit 0；
   - `npm run typecheck:tests` exit 0；
   - `npm run -w @vessel/web build -- --emptyOutDir false` 生产构建 exit 0。
