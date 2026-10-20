# Task 230 — 基于 Open Claude UI (CDS) 的侧边栏会话管理与任务输入器质感升级

## Status: COMPLETED
- **Owner**: 主会话 (Planner/Coordinator) 调度
- **Research & Audit**: OpenCode (`commandcode/deepseek/deepseek-v4.1-flash`)
- **Implementer**: Codex (`gpt-6.1-sol`, reasoning_effort: medium)
- **Reviewer**: OpenCode (`commandcode/deepseek/deepseek-v4.1-flash#max`)
- **Reference**: `https://github.com/Caho1/open-claude-ui` · Claude Design System (CDS)
- **Date**: 2026-10-19

---

## 1. Goal
在 Task 228（发丝细边/IME守卫/滚动消隐）与 Task 229（消息流/工具卡片/思考链/动效令牌）的基础上，针对 Vessel Web UI（`apps/web`）目前仍存在明显“机械生硬感”的两大核心组件——侧边栏（Sidebar）与任务输入器（TaskComposer），依照 CDS 规范进行深度重塑与质感跃迁：

1. **P1: 侧边栏与会话树沉浸式重构 (Sidebar.tsx & .sidebar / .topic-*)**：
   - **打破线框牢笼 (Kill Border Prison)**：彻底移除 `.topic-group` 之间生硬的 `1px solid var(--row-line)` 下边框，改用物理间距与悬停背景高亮区分层次；
   - **真实按日期分段**：修复此前在 `useMemo` 中因 `flatMap` 导致日期分段被吞噬的问题，呈现「今天 (Today) / 昨天 (Yesterday) / 最近 7 天 (Previous 7 Days) / 更早 (Earlier)」规范日期分段；
   - **发丝高亮指示条 (Active Rail)**：当前激活的 Session 条目左侧挂载 2px 宽度的柔和指示轨（`border-radius: var(--r-pill); background: var(--accent);`），带有平滑高度伸展过渡；
   - **悬停浮现微动效操作栏 (Inline Action Group)**：移除原生粗糙的 `<details><summary>···</summary>`，改为会话行悬停/聚焦时通过 `--dur-snap` + `opacity` 平滑浮现的内联图标按钮（重命名/归档），并保留完善的键盘无障碍可访问性；
   - **搜索胶囊化**：将 `.topic-search` 重构为带内嵌放大镜图标、清空体验、精密圆角与发丝聚焦环的搜索胶囊。

2. **P1: 任务输入器同心圆角与胶囊化工具栏 (TaskComposer.tsx & .task-composer)**：
   - **CDS 同心圆角容器**：重构 `.task-composer` 结构，将输入区升级为拥有 `--r-composer: 20px` 的同心圆角 Surface 容器；
   - **三态柔和投影**：挂载 Normal（微发丝）、Hover（发丝强化）、Focus-within（发丝双环 + 柔和外发光）三态投影过渡；
   - **流线型胶囊选择器 (Capsule Selects)**：将原生突兀的 `<select>` 升级为带自定义下箭头、发丝外框、`--r-pill` 圆角的微型胶囊控件，与底部操作栏融为一体；
   - **光学对齐的发送按钮**：优化发送按钮（Send Button）圆角与微交互，在忙碌/创建态展示加载提示，在输入框有内容时高亮激活；
   - **保留输入法守卫**：完整继承 Task 228 建立的 `isComposingRef` + `nativeEvent.isComposing` + `keyCode === 229` IME 守卫逻辑。

3. **P1: 变量清理与动效物理学收敛**：
   - 清除历史残留的 `--panel2`、`--row-line` 等过时 CSS 变量，统一收敛到 CDS Surface 阶梯；
   - 交互元素（按钮、胶囊、侧栏条目）按压挂载 `:active { transform: scale(0.98); }` 微回弹与 `--dur-fast: 60ms` 极速反馈。

---

## 2. Not Doing
1. **禁止修改核心**：`packages/core` 修改行数严格保持为 0。
2. **禁止破坏既有单测与功能**：既有的所有会话切换、重命名、归档、新建会话与 IME 守卫逻辑 100% 保持兼容。
3. **禁止引入重量级外部依赖**：不引入复杂 UI 库，纯原生 React Hooks + CSS 现代特性。
4. **纯本地开发**：不向 GitHub push，所有删除走 Windows 回收站。

---

## 3. Scope & Blast Radius
- `apps/web/src/components/Sidebar.tsx`: 侧边栏结构、真实日期分段、内联操作栏与 active rail
- `apps/web/src/components/TaskComposer.tsx`: 任务输入器圆角容器、胶囊选择器与发送按钮
- `apps/web/src/styles.css`: 侧边栏与输入器相关样式重构、过时变量清理、微动效
- `apps/web/src/i18n.ts`: 补充缺失的日期或操作多语言词条（如 `topicYesterday`）
- `apps/web/src/components/Sidebar.test.tsx`: 补充或更新侧边栏单测

---

## 4. Acceptance Criteria
1. **侧边栏视觉与交互**：
   - 消除生硬横线分隔，条目 hover 有平滑背景浮动；
   - 激活的会话具备左侧 active rail 发丝高亮；
   - 会话操作按钮悬停平滑浮现；
   - 具备清晰的日期分组。
2. **输入器质感**：
   - 具备同心圆角 `--r-composer: 20px` 与三态投影；
   - 模型与权限选择器呈现胶囊化质感；
   - IME 守卫单测与功能 100% 正常。
3. **门禁全绿**：
   - `npx tsc -b` exit 0；
   - `npm run typecheck:tests` exit 0；
   - `npm run -w @vessel/web test` 100% 通过；
   - `npm run -w @vessel/web build` 0 警告成功构建；
   - `npm run test:all` 双 Root 全量通过；
   - `packages/core` 0 改动。

---

## 5. Result & Evidence
- **交付内容**:
  - `apps/web/src/components/Sidebar.tsx`: 消除 Border Prison（无底层横线切断），支持真实「今天 / 昨天 / 最近 7 天 / 更早」日期分段展示；会话条目左侧挂载 2px active rail 发丝指示轨；操作菜单改版为悬停浮现微动效按钮（带 pencil / archive 图标、无障碍 `aria-label` 与快捷键）；搜索输入框胶囊化。
  - `apps/web/src/components/TaskComposer.tsx`: 输入区域重塑为拥有 `--r-composer: 20px` 同心圆角的 Surface 容器，挂载三态柔和发丝投影；底部操作栏升级为流线型 Capsule Selects，发送按钮对齐微弹反馈；IME 输入法合成守卫 100% 完整保留。
  - `apps/web/src/i18n.ts`: 补充 `topicYesterday` 词条（中/英）。
  - `apps/web/src/styles.css` & `dashboard.css`: 清理历史遗留的 `--panel2` 与 `--row-line`，收敛至 CDS Surface 规范。
  - `apps/web/src/components/Sidebar.test.tsx`: 新增 6 个独立单测，全面覆盖日期分段边界、会话归档/过滤、最新活跃连续性等。
- **独立审查结论**:
  - OpenCode (`deepseek/deepseek-v4.1-flash#max`) 审查报告位于 `evidence/sessions/2026-10-19-opencode-review-230.md`，无破坏性阻断缺陷，单测与类型全数覆盖。
- **全量门禁实测结果**:
  - `npx tsc -b`: exit 0
  - `npm run typecheck:tests`: exit 0
  - `npm run -w @vessel/web test`: 43 files / 371 passed (100%)
  - `npm run -w @vessel/web build -- --emptyOutDir false`: exit 0 (200ms)
  - `npx vitest run` (根): 289 files / 3,063 passed | 6 skipped (100%)
  - 全量双 Root 测试: **332 测试文件 / 3,434 passed | 6 skipped (100%)**
  - `packages/core` 修改行数: **0**

