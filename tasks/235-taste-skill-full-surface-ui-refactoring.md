# 任务卡 235：基于 Taste-Skill 的 Web 工作台审美审查与全屏通栏 UI 重构 (Taste-Skill Full-Surface UI Refactoring)

- **状态**：已完成（2026-10-20，待用户视觉验收）
- **日期**：2026-10-20
- **执行模型**：Codex (`gpt-6.1-sol`, `reasoning_effort: "medium"`) 独立审查与编码；Antigravity (主会话) 规划调度
- **设计基准**：[Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) (`skills/taste-skill/references/app-screens.md`)

---

## 1. 目标与背景 (Goal & Context)

用户在实际体验最新版本 Web UI 后给出核心反馈：
1. **删除会话问题已彻底闭环**：排查并修复了旧后台服务未更新路由导致的 404、以及 Topic 下多 Session 未全量清除的问题，已实测验证回收站删除成功；
2. **审美与界面布局重构需求**：
   - 用户明确指定引入：`https://github.com/leonxlnx/taste-skill`；
   - 用户明确指出痛点与重构要求："用这个 skill 交接给 Codex 来对页面全面审查，页面还是比较糟糕的，审查出来的相关的不足进行优化，UI 重构，换一个，不要整这种弧形的，直接用直接覆盖全屏的那种。"
   - 核心反模式：当前界面滥用浮空毛玻璃岛、大圆角弧形（如 16px/24px 弧形面板浮在全黑背景上），留出四周 12px 缝隙，导致视觉松散、割裂，像半吊子展示页而非专业严谨的工程 Harness（如 Linear、VS Code、Zed、GitHub 生产力工具）；
   - 工业级标准：转为 **Edge-to-Edge 全屏通栏覆盖** 布局，平实、严正、直通全屏，以极细 Hairline 分割线划分区域，消除孤岛感与多余弧形，给工程师沉浸、专业的生产力工作台质感。

---

## 2. 详细执行规划 (Execution Plan)

### 阶段 1：Codex 独立审美审查 (Taste-Skill Audit)
- Codex 读取 `.agents/skills/design-taste-frontend/skills/taste-skill/references/app-screens.md` 与既有 Web 源码；
- 从 5 个维度全面审查当前 UI 不足并产出独立报告 `evidence/sessions/2026-10-20-taste-skill-audit-235.md`：
  1. 浮动小岛与多余弧形（Floating Islands vs Full Surface）；
  2. 边距与留白（Gaps vs Seamless Hairline Divisions）；
  3. 色彩与材质（Overused Frosted Glass/Gradients vs Honest Clean Surfaces）；
  4. 信息密度与层级（Ragged Density vs Engineered Hierarchy）；
  5. 响应式与状态诚实性（App State Honesty）。

### 阶段 2：UI 全屏通栏重构 (Edge-to-Edge Full-Surface Refactoring)
- **外层容器重塑 (`apps/web/src/styles.css`)**：
  - 移除 `.app` 的 `padding: 12px; gap: 12px;`，设为 `padding: 0; gap: 0;`，100% 贴满视口（`100vw` × `100dvh`）；
  - 去除 Rail、Sidebar、Main 浮空的孤岛式大圆角（`border-radius: 0` 或主体内部微圆角），取消多余的外发光与重阴影；
  - 栏间分割：采用清晰内敛的 `1px solid var(--border)` / `var(--ring)` Hairline 边框，三栏平整贴合；
  - 底色系统：深色模式使用深邃平实的炭黑/青黑底色（如 `#0d1117`、`#161b22`），浅色模式使用纯正的纸白/暖灰底色（如 `#ffffff`、`#f6f8fa`），告别肮脏的漂浮渐变黑；
- **顶栏与工作区通栏沉浸 (`apps/web/src/styles.css` & 各组件)**：
  - `.topbar` 贴顶通栏，无浮空弧角；
  - 会话区与任务创建区（`TaskComposer`、`ConversationView`）全宽展开，输入区稳固沉底；
  - 保持会话删除、主题切换、模型中枢、命令面板、8 Tab 画布检视器全部交互完好。

### 阶段 3：验证与门禁
- `npm run -w @vessel/web build -- --emptyOutDir false` 生产构建通过；
- `npx vitest run --root apps/web` 50 文件 / 404 测试保持 100% 通过；
- `npx tsc -b tsconfig.json` 与 `npm run typecheck:tests` exit 0；
- `packages/core` 修改行数严格保持 0 行。

---

## 3. 验收标准 (Acceptance Criteria)

- [x] **AC1 独立审查报告**：Codex 产出 `evidence/sessions/2026-10-20-taste-skill-audit-235.md`，逐条分析当前设计在 `taste-skill` 下的违背项与整改路径；
- [x] **AC2 消除浮动弧形小岛**：页面彻底去除外围四周空隙与大圆角弧形悬浮卡片，实现 100% 贴边全屏直通式工作台；
- [x] **AC3 工业级 Hairline 分割**：Rail、Sidebar 与 Main 区域之间采用 1px 细线整洁分割，各区域顶天立地、结构硬朗沉浸；
- [x] **AC4 功能零衰减**：会话删除、深浅主题切换、模型中枢（ProviderHub）、命令面板等全量功能完全可用；
- [x] **AC5 门禁全绿**：`tsc -b`、`typecheck:tests`、Web 打包（`vite build`）与 Web 全量单测（50 文件 404 项）100% 通过，`packages/core` 0 变动。

## 4. Execution boundaries and evidence

- Not Doing: no backend/core edits, dependency changes, new agent CLI sessions, commit, push, or deletion. Existing uncommitted work is preserved.
- Blast Radius: `apps/web/src/styles.css` shared tokens and presentation; `components/layout/layout.css` inspector boundary; current design guidance and this task's index/evidence. React handlers are unchanged.
- Expected Evidence: [audit](../evidence/sessions/2026-10-20-taste-skill-audit-235.md), before-source snapshots, independent `REVIEW.md`, and gate logs under `evidence/sessions/2026-10-20-card235/`.
- Browser limitation: built-in browser unavailable and inventory empty. Screenshot/interaction acceptance must remain open; prior-task browser evidence does not verify this redesign.

## 5. Result

Edge-to-edge presentation is implemented in two CSS files; design guidance updated. AC2/AC3 pass source review, with rendered acceptance pending. AC4's component behavior remains covered by existing Web tests, but new browser interaction acceptance is pending. Independent review found no high/medium issues. Gate results, failure details and scope evidence: [PROOF.md](../evidence/sessions/2026-10-20-card235/PROOF.md). AC5 remains open because the additional root suite is red outside this CSS change. No claim of full acceptance.
