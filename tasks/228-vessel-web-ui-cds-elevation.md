# Task 228 — 基于 Open Claude UI (CDS) 的 Vessel Web UI 深度优化落地

## Status: COMPLETED
- **Owner**: 主会话 (Planner/Coordinator) 调度
- **Research & Benchmark**: OpenCode (`commandgota/deepseek/deepseek-v4.1-flash`)
- **Implementer**: Codex (`gpt-6.1-sol`, reasoning_effort: medium)
- **Reviewer**: OpenCode (`commandgota/deepseek/deepseek-v4.1-flash#max`)
- **Reference**: `https://github.com/Caho1/open-claude-ui` · Claude Design System (CDS)
- **Date**: 2026-10-19
- **Completed**: 2026-10-19

---

## 1. Goal
基于 OpenCode (DeepSeek-v4.1-Flash) 对 `Caho1/open-claude-ui` 的深度逆向规范调研报告 (`evidence/sessions/2026-10-19-open-claude-ui-study.md`)，
在当前 Vessel Web UI（`apps/web`）中全面落地 Claude 官方设计系统（CDS）的核心工程物理学与人文质感：
1. **P0: 落地 IME 中文/日文输入法合成守卫 (`TaskComposer.tsx`)**：
   - 拦截 `onCompositionStart` 与 `onCompositionEnd`，当处于输入法拼音组字阶段（`isComposing` 或键码 `229`）时按 `Enter` 仅确认候选词，**坚决不触发任务提交**；
   - 确立 `Enter` 发送、`Shift+Enter` 换行的规范，并保证在非合成态正常提交。
2. **P0/P1: 视网膜高分屏发丝细边与表面色阶 (`styles.css`, `layout.css`)**：
   - 引入 `--ring-hairline: 1px`，在 `@2x/@3x` 高分屏媒体查询下自适应补偿为 `0.5px`，消除边框粗重感；
   - 补齐精密圆角阶梯：`--r-0: 4px`、`--r-sm: 6px`、`--r-md: 8px`、`--r-panel: 10px`、`--r-composer: 20px`，实现严谨的同心圆角；
   - 优化三层立体焦点环（内隔离垫片 + 主强调色环 + 微光漫射）。
3. **P1: 原生滚动消隐非线性遮罩 (`ConversationView.tsx`, `layout.css`, `styles.css`)**：
   - 引入基于 CSS `mask-image` 的上下边缘 24px 滚动消隐羽化类（`.scroll-fade-mask`），使聊天流与检视器内容在进出视口边界时柔和消隐，消除生硬硬裁切感。
4. **P1: 交互时间常数与微反馈 (`styles.css`, `card222.css`)**：
   - 对齐 CDS 几何咬合物理常数（120ms 切换，70ms 触觉按压反馈）；
   - 按钮、胶囊与侧栏交互项的统一触觉回弹与无障碍焦点管理。

---

## 2. Not Doing
1. **禁止修改核心**：`packages/core` 修改行数严格保持为 0。
2. **禁止破坏既有测试**：所有 Web 单测及 289 个根测试 100% 保持 PASS。
3. **禁止引入重量级外部依赖**：不引入 Tailwind CDN 或任何第三方 UI 库，纯原生 CSS Variables + React Hooks 落地。
4. **纯本地开发**：不向 GitHub push，所有删除走 Windows 回收站。

---

## 3. Scope & Blast Radius
- `apps/web/src/components/TaskComposer.tsx`: IME 合成状态守卫与按键处理
- `apps/web/src/components/TaskComposer.test.tsx`: 新增 IME 拼音输入不误触提交的独立单元测试（6 个用例）
- `apps/web/src/styles.css`: 视网膜发丝细边补偿、精密圆角阶梯、三层焦点环与滚动消隐遮罩
- `apps/web/src/components/layout/layout.css`: 检视器 `.inspector-content` 滚动容器消隐与抽屉发丝投影
- `apps/web/src/components/ConversationView.tsx`: 消息滚动区域应用 `.scroll-fade-mask` 遮罩
- `apps/web/index.html`: 挂载 `class="tokens"` 确保双向共享主题令牌
- `evidence/sessions/2026-10-19-open-claude-ui-study.md`: 1.6 万字 CDS 逆向调研分析报告
- `evidence/sessions/2026-10-19-opencode-review-228.md`: OpenCode 对抗性审查全量报告

---

## 4. Acceptance Criteria
1. **IME 守卫验证通过**：编写专门的单元测试，模拟中文输入法合成期间按 Enter（`isComposing: true` 或 `keyCode: 229`），断言 `onStarted` 绝对不被调用；只有在 `compositionend` 之后敲击 Enter，才正常触发提交。
2. **发丝细边与圆角生效**：`--ring-hairline` 在 `@media (min-resolution: 2dppx)` 具备 `0.5px` 声明，精密圆角阶梯定义完整。
3. **滚动消隐遮罩落地**：聊天流或检视器滚动容器具备 `mask-image` 渐变羽化样式，且在不支持遮罩的环境下优雅回退为普通滚动。
4. **门禁全绿**：
   - `npx tsc -b` exit 0；
   - `npm run typecheck:tests` exit 0；
   - `npm run -w @vessel/web test` 保持 100% 通过（且包含新增的 IME 守卫单测）；
   - `npm run -w @vessel/web build` 0 警告成功构建；
   - `npm run test:all` 双 Root 全量通过；
   - `packages/core` 0 改动。

---

## 5. Result & Verification Evidence
- **Codex 沙箱执行**: `evidence/sessions/2026-10-19-codex-task-228.log`（`gpt-6.1-sol`, medium, 消耗 118,951 tokens，exit 0）。
- **OpenCode 独立对抗审查**: `evidence/sessions/2026-10-19-opencode-review-228.md`（DeepSeek-v4.1-Flash#max 深度审查，确认 IME 三重守卫、独立单测、视网膜发丝、圆角阶梯、双消隐遮罩与 core 0 改动全部符合契约）。
- **静态类型与单测全量门禁**:
  - `npx tsc -b`: exit 0
  - `npm run typecheck:tests`: exit 0
  - `npm run -w @vessel/web build`: built in 321ms, exit 0
  - Web 单测: **41 文件 / 351 passed (100%)**
  - 根测试: **289 文件 / 3063 passed | 6 skipped (100%)**
  - 全仓总计: **330 文件 / 3414 测试 100% 全部通过**
  - `packages/core` 保持 **0 行改动**。
