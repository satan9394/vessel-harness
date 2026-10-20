# Task 227 — Web UI 结构重塑与设计系统规范落地

## Status: COMPLETED (2026-10-18)
- **Owner**: 主会话 (Planner/Coordinator) 调度
- **Research & Audit**: OpenCode (`commandgota/deepseek/deepseek-v4.1-flash`)
- **Implementer**: Codex (`gpt-6.1-sol`, reasoning_effort: medium)
- **Reviewer**: OpenCode (`commandgota/deepseek/deepseek-v4.1-flash#max`)
- **Date**: 2026-10-18

---

## 1. Goal
基于 OpenCode (DeepSeek-v4.1-Flash) 的调研走查报告 (`evidence/sessions/2026-10-18-ui-structural-audit.md`)，
并依据设计规范技能（`impeccable`, `emil-design-eng`, `make-interfaces-feel-better`, `minimalist-ui`, `dsh-client-ui-ux`），
彻底重塑 `apps/web` 落地中的结构性缺陷：
1. **重构 App 外层网格与自适应策略**：消灭固定三列 + 检视器互相挤压的“固定像素合唱团”，消灭 1024px–1180px 检视器向下错位堆叠的断点死区，支持侧边栏折叠/紧凑切换。
2. **重塑空白工作台（`workbench-home`）**：终结单一输入框居中的“孤岛感”，增加最近会话快捷入口、项目状态与开箱指引卡片，与工作区有机联动。
3. **理顺双表面检视器（DualSurfaceLayout）与流式内容**：聊天流与右侧检视器各自形成清晰的自包含滚动边界，输入区吸底稳定，下部模块面板层级规整。
4. **消减线框牢笼（Border Prison）与层级堆叠**：去除多层卡片内部重复的边框与重阴影，建立清晰的表面色阶与交互四态（hover / active:scale(0.98) / focus-visible）。

---

## 2. Not Doing
1. **禁止修改核心**：`packages/core` 修改行数严格保持为 0（实测 0 行）。
2. **禁止破坏既有 API 与测试契约**：所有 40 个 Web 端组件测试及 289 个根测试必须 100% 保持 PASS。
3. **禁止引入未受控的外部 CSS 库**：严禁引入 Tailwind CDN 或臃肿 UI 组件库，纯原生 CSS Variables + 既有设计令牌落地。
4. **禁止向远端 push**：纯本地开发，所有删除走 Windows 回收站。

---

## 3. Scope & Blast Radius
- `apps/web/src/App.tsx`: 布局外壳、侧边栏折叠状态、空白态工作台增强
- `apps/web/src/styles.css`: 网格系统、断点媒体查询、卡片边框层次与微交互动效
- `apps/web/src/components/layout/layout.css`: 双表面检视器断点、浮层/抽屉定位与滚动容器
- `apps/web/src/components/layout/DualSurfaceLayout.tsx` & `.test.tsx`: 检视器 1180px 断点与单元测试
- `apps/web/src/components/Sidebar.tsx`: 侧边栏折叠与响应式样式
- `apps/web/src/components/TaskComposer.tsx`: 草稿请求填充机制与样式优化
- `apps/web/src/components/ConversationView.tsx`: 聊天流自包含滚动与底部吸底结构
- `apps/web/src/i18n.ts`: 补充空白态快捷卡片等相关国际化文本

---

## 4. Acceptance Criteria & Final Verification Evidence
1. **断点死区消除**：在 1024px–1180px 以及各种视口宽度下，检视器统一在 `1180px` 断点触发覆盖式抽屉（Drawer Overlay），消除流式内容向下挤压变形的死区。
2. **侧栏折叠支持**：左侧 Session 列表在桌面端支持一键折叠（`.sidebar-collapsed`），顶部工具栏配备折叠切换按钮，为聊天流释放充足排版呼吸宽度。
3. **空白工作台层级丰富**：首页在无选中会话时，除输入框外，直观呈现常用预设任务胶囊 (`starter-pill`)、最近会话卡片网格 (`home-session-grid`) 以及工作区在线状态卡片 (`home-workspace`)。
4. **微交互与层级干净**：所有主按钮与 Tab 具备 active 按压反馈 (`scale(0.98)`) 与无障碍 focus-visible 焦点环；卡片内部采用微妙表面色阶 (`var(--panel-2)`) 消除线框牢笼。
5. **门禁全绿**：
   - `npx tsc -b` exit 0；
   - `npm run typecheck:tests` exit 0；
   - `npm run -w @vessel/web build` 257ms exit 0；
   - `npm run -w @vessel/web test` 40 测试文件 / 345 passed (100%)；
   - `npm run test:all` 双 Root **329 测试文件 / 3,408 passed | 6 skipped** 全绿；
   - `packages/core` 修改行数严格保持为 **0**。

---

## 5. Multi-Role Execution Evidence
1. **调研走查与设计规范**：OpenCode (`commandgota/deepseek/deepseek-v4.1-flash`) 产出 `evidence/sessions/2026-10-18-ui-structural-audit.md`。
2. **代码编写实施**：Codex (`gpt-6.1-sol`, reasoning_effort: medium) 在独立沙箱中推进，消耗 128,895 tokens，日志位于 `evidence/sessions/2026-10-18-codex-task-227.log`。
3. **独立对抗审查**：OpenCode (`commandgota/deepseek/deepseek-v4.1-flash#max`) 审查产出 `evidence/sessions/2026-10-18-opencode-review-227.md`。
