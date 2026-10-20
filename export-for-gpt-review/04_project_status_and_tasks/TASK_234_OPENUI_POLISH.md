# 任务卡 234 — OpenUI 生成式排版体系融入与 Web 体验痛点全景整改方案 (OpenUI Generative UI & UX Polish Plan)

- Status: 已合入（2026-10-19，本地双 Root 全量测试通过，门禁全绿）
- Mode: standard
- Source: human-requested (用户反馈：供应商重复输Key、缺少会话永久删除、深浅主题丢失、按钮纯文字无实体交互、回答缺少排版与Markdown裸标签、参考 thesysdev/openui 进行架构融合规划)
- Risk: medium

---

## 1. 目标与背景 (Goal & Context)

用户在实际体验 Vessel Web 工作台过程中，提出了以下 5 项严重影响可用性与交互美感的痛点：
1. **已有供应商重复输 Key**：在测试连接或拉取模型时，系统强制要求用户每次都必须重新手动输入 API Key，即使此前已保存过该凭据；
2. **缺少会话永久删除**：侧边栏仅有重命名与归档，测试产生的失败或废弃会话无法永久删除；
3. **深浅色主题切换能力丢失**：界面此前被写死为仅跟随系统深色，缺少用户手动切换深/浅色模式的入口与状态持久化；
4. **按钮缺少实体质感与交互教育**：很多操作直接表现为裸文字链接，缺少实体 Button 视觉特征（边框、微底色、悬浮态）以及 Tooltip / 快捷键教育；
5. **回答排版杂乱、Markdown 裸标签、缺少生成式 UI 交互**：消息正文目前为纯文本直接渲染，导致标题、加粗、代码块等 Markdown 标记裸露且排版凌乱；用户特别指定参考 [thesysdev/openui](https://github.com/thesysdev/openui) 将 Generative UI 与富排版深度融合到会话中。

---

## 2. 详细整改规划 (Implementation Breakdown)

### 模块 A：已有供应商测试与拉取支持「凭据自动复用」
- **后端路由支持 (`apps/local-server/src/routes/providerRoutes.ts`)**：
  - 在 `ProviderRoutes.test(value)` 与 `pullModels(value)` 中，若入参未传 `apiKey`（或为空串、掩码）：
    - 检查传入的 `name`（或 `id`），如果 `this.store().get(name)` 存在，自动从已有的 Provider 配置及其关联的安全凭据后端（`CredentialBackend`）中安全解析已有的 `apiKey`；
    - 仅当既没有传入新 Key 且本地也没有该供应商的历史凭据时，才抛出 `invalid_api_key`。
  - 在 `save(value)` 中：若 `b.apiKey` 为空，且 `store.get(b.name)` 已存在，保留原有凭据（复用已有的 secretRef），避免用户每次编辑模型列表时被清空 Key。
- **前端输入体验优化 (`apps/web/src/components/providers/ProviderSettingsModal.tsx`)**：
  - 当编辑已存在的供应商时，API Key 输入框的 placeholder 显示为 `•••••••• (已保存凭据，留空则保持)`；
  - `validateProvider` 调整：若当前处于编辑已存在供应商状态且 `apiKey` 为空，放行校验；
  - 测试连接与拉取模型按钮在 Key 为空时正常可用，点击直接复用已保存凭据完成端点握手。

### 模块 B：会话（Session）物理永久删除功能
- **后端删除端点 (`apps/local-server/src/server.ts` & `apps/application`)**：
  - 新增 `DELETE /api/sessions/:id` 端点；
  - 内存态清理：从会话管理器（`SessionManager`）中注销并释放资源；
  - 磁盘清理（严格遵循 Windows 回收站铁律）：将会话持久化目录/文件通过安全回收站 API 移入系统回收站，禁止使用 `rm` / `unlink` 永久物理摧毁；
  - 返回状态 `{ ok: true, id }`。
- **前端交互 (`apps/web/src/components/Sidebar.tsx` & `api.ts`)**：
  - 在侧边栏每个 Session / Topic 行的右侧动作区，新增「删除」图标按钮（垃圾桶图标）；
  - 交互教育与防误触：点击触发轻量级二次确认弹窗或气泡确认（如：“确定删除此会话吗？删除后将移入回收站”）；
  - 确认删除后：调用 API，前端列表中即时移除该项；若当前正在浏览被删除的会话，自动切换回空会话或最新会话。

### 模块 C：深色 / 浅色主题手动切换与常驻控制
- **主题控制器与持久化 (`apps/web/src/utils/theme.ts` & `styles.css`)**：
  - 建立三态主题机制：`system` | `dark` | `light`，优先读取 `localStorage.getItem('vessel_theme')`；
  - 在 `<html>` 或 `body` 挂载 `data-theme="dark"` / `data-theme="light"` 属性；
  - 改造 `styles.css`：将原先仅在 `@media (prefers-color-scheme: dark)` 下生效的深色 CSS 变量，同步映射到 `[data-theme="dark"]` 选择器下；当指定 `data-theme="light"` 时强制激活浅色 CSS 变量；
- **常驻视觉入口 (`apps/web/src/components/layout/Rail.tsx`)**：
  - 在左侧 Rail 图标轨底部（语言切换按钮旁），常驻实体 ThemeToggle 按钮；
  - 提供太阳（浅色）与月亮（深色）平滑切换动效，并提供悬浮 Tooltip（如 `切换为深色模式 (Ctrl+Shift+T)`）。

### 模块 D：按钮视觉实体化与交互教育 (Button Deslop & Affordance)
- **视觉实体化规范 (`apps/web/src/styles.css` & 各组件)**：
  - 消除伪装成文字的可点击项：为侧边栏折叠按钮、重命名/归档/删除动作、快捷模型切换 Pill、设置操作按钮赋予实体 Button 质感：
    - 明确的边界：`border: 1px solid var(--ring)`；
    - 明确的微底色填充：`background: var(--panel-2)`；
    - 圆角规范：`border-radius: var(--r-md)`；
    - 交互动效：`:hover` 时微抬升与高亮，`:active` 时轻微按下（`transform: translateY(1px)`）；
- **交互教育与快捷键标识 (Education & Tooltips)**：
  - 每个操作按钮均提供清晰的 `title` / Tooltip 说明，告诉用户该按钮的作用；
  - 引入键盘快捷键徽章（如保存 `Enter`、取消 `Esc`、搜索 `Ctrl+K`、删除确认快捷键），提升极客操作直觉。

### 模块 E：融入 OpenUI（thesysdev/openui）与 Generative UI 富排版方案
- **参考架构分析 ([thesysdev/openui](https://github.com/thesysdev/openui))**：
  - OpenUI 的精髓在于：**用极高 Token 效率的流式 DSL（OpenUI Lang）替代纯文本或笨重 JSON，让 AI 在回答中直接流式渲染原生 UI 组件**。
  - 对于 Vessel 来说，AI Agent 的最终输出不仅是“一堆文字”，通常包含：**任务完成总结、影响与文件变动（Diff）、测试指标与通过率、后续操作按钮**。
- **分阶段融合方案**：
  - **阶段 1：会话富排版与 Markdown 渲染引擎（即时解决排版杂乱与裸标签）**：
    - 升级 `apps/web/src/components/MessageList.tsx` 中的消息渲染层，引入现代化轻量 Markdown 解析器；
    - 正确解析 `#` 标题、加粗、无序/有序列表、任务复选框（Checklist）、引用块与标准表格；
    - 代码块增强：语法高亮、语言指示标签、一键复制按钮、折叠超长代码段；
  - **阶段 2：OpenUI Generative UI 流式组件层深度整合**：
    - 引入 OpenUI 组件规范（兼容 `@openuidev/react-lang` 协议）：
    - 注册 Vessel 专属生成式 UI 组件集：
      1. `<VesselSummaryCard>`：高阶任务结论卡（包含状态徽章、耗时、核心结论）；
      2. `<VesselMetricsGrid>`：关键指标面板（通过用例数、覆盖率、Token 开销）；
      3. `<VesselDiffViewer>`：代码补丁可视化展开/折叠面板；
      4. `<VesselActionGroup>`：可交互确认操作组（如：“继续执行下一步”、“回滚改动”）；
    - 运行时流式挂载：当 Agent 输出特定的结构化标记或 OpenUI Lang 块时，前端自动流式实例化为原生的 React 交互卡片，彻底超越传统纯文本对话框！

---

## 3. 验收标准 (Acceptance Criteria)

- [x] **已有供应商免密测试**：编辑已有供应商时，无需再次输入 API Key 即可成功执行「测试连接」与「一键拉取模型」，复用已存储凭据；
- [x] **会话安全物理删除**：侧边栏提供删除按钮与二次确认防手误交互，后端安全将对应会话移入 Windows 回收站并即时更新侧边栏；
- [x] **深浅主题切换与持久化**：左侧 Rail 底部提供实体 ThemeToggle 开关，点击即时在浅色与深色之间切换，刷新页面后偏好状态不丢失；
- [x] **按钮实体化与交互教育**：侧边栏、快捷切换区、模态框内所有交互动作均具备实体 Button 质感与 Tooltip 交互提示，告别裸文本伪按钮；
- [x] **富排版与 Markdown 引擎落地**：会话正文消灭裸露 Markdown 标记，标题、列表、表格、代码块均呈现精致现代排版；
- [x] **OpenUI 生成式卡片支持**：会话支持流式渲染结构化总结与指标卡片；
- [x] **门禁与红线守卫**：`packages/core` 行修改严格为 0；`npx tsc -b`、`npm run typecheck:tests`、`npm run test:all` 双 Root 保持全绿。

---

## 4. 实测门禁与交付证据 (Evidence)

- **类型与构建检查**：
  - `npx tsc -b tsconfig.json`: exit 0
  - `npm run typecheck:tests`: exit 0
  - `npm run -w @vessel/web build -- --emptyOutDir false`: exit 0 (构建耗时 789ms)
- **单测与全量回归**：
  - `apps/local-server/src/server.test.ts`: 25 passed (含 `DELETE /api/sessions/:id` 安全测试)
  - `apps/web` 全套单测: 50 文件 / 404 项测试全部 passed，0 警告
  - 双 Root 全量测试 `npm run test:all`:
    - 根: 289 文件 / 3041 passed / 6 skipped / 0 failed
    - Web: 50 文件 / 404 passed / 0 failed
    - 合计: 339 文件 / 3445 项测试全部通过
- **架构红线**：
  - `git diff packages/core`: 0 改动
  - 删除操作严格遵循 Windows 回收站纪律 (`recycleDaemonPath`)，无任何危险硬删除。
