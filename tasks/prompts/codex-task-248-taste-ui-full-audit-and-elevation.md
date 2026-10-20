# 任务 248：基于 Taste-Skill 的 Web 工作台全面审美审查与全屏重构（Codex 首席执行）

## 1. 角色与运行规约
你是 **Codex**（运行模型为 `gpt-6.1-sol`，思考深度 `medium`）。
用户已显式授权由你独立对 Vessel Web 进行全面的高阶审美审查、UI 重构优化与代码落地。

---

## 2. 用户原始核心反馈与痛点

用户明确要求你以 **taste-skill**（本地路径：`.agents/skills/design-taste-frontend/skills/taste-skill/`）为最高设计准则，解决以下关键痛点：

1. **拒绝悬空孤岛与弧形小卡片，采用全屏直接覆盖（Edge-to-Edge）**：
   - 杜绝在黑色背景上浮动各种大圆角卡片、四周留缝隙的业余演示模版感；
   - 采用严整、平直、顶天立地全屏覆盖的工业级工作台布局（对标 Linear, VS Code, Zed, GitHub）；
   - 模块与面板之间使用 1px Hairline 细分割线清晰划分。
2. **重塑按钮实体感，杜绝纯文字展示**：
   - 用户严重痛点：“你相关的按钮，根本就是文字展示，连个按钮都没有，很糟糕”；
   - 必须为操作按钮（发送、停止、测试、切换、重置、折叠、删除等）赋予坚实的物理实体感：清晰的边框、背景层次、hover 状态、active 按压反馈与细微阴影，杜绝扁平文字当按钮。
3. **深浅双色主题稳定可见**：
   - 确保浅色（Light）与深色（Dark）主题切换开关与视觉体验稳定、实体化，高对比度无死角。
4. **Markdown 与回答排版专业化**：
   - 会话回答、总结卡片与富文本必须排版考究：段落呼吸感、标题梯度、引用块左侧色带、代码块实体边框与内衬，杜绝杂乱标签外露。
5. **已存凭据免输直测与会话删除**：
   - 保持已配供应商免输 API Key 一键直测连通性（`testDirect`）；
   - 保持会话物理删除（回收站）的真实状态回执与一致性。

---

## 3. 本地参考依据 (Taste-Skill)
请深入阅读并严格遵循项目内的设计规范文件：
- `.agents/skills/design-taste-frontend/skills/taste-skill/SKILL.md`
- `.agents/skills/design-taste-frontend/skills/taste-skill/references/app-screens.md`
- `.agents/skills/design-taste-frontend/skills/taste-skill/references/layout.md`
- `.agents/skills/design-taste-frontend/skills/taste-skill/references/tells.md`
- `.agents/skills/design-taste-frontend/skills/taste-skill/references/critique.md`

重点吸收：
- 消除 AI 廉价感（No floating pill soup, no arbitrary huge radiuses）；
- 紧凑（Density with purpose）、层级分明（Clear typography scale）；
- 严正的界面材质与状态反馈。

---

## 4. 实施要求

### 第一步：审美走查与审查报告
- 审查 `apps/web/src/styles.css`、`apps/web/src/components/` 下的关键组件（`Sidebar.tsx`, `ConversationView.tsx`, `TaskComposer.tsx`, `ProviderHub.tsx`, `ActivityQueue.tsx` 等）；
- 输出审美审查与优化说明至 `evidence/sessions/2026-10-20-codex-taste-elevation-248.md`。

### 第二步：代码重构落地
- 优化 `apps/web/src/styles.css`：
  - 按钮实体化类名（`.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-sm`, 各类操作图标按钮）；
  - 全屏通栏无缝容器，消除冗余外层弧度；
  - Markdown 排版实体化细节；
- 检查并精修相关组件渲染细节。

### 第三步：门禁与验证
- 保证 `packages/core` 修改行数严格为 0（薄核纪律）；
- 保证删除走 Windows 回收站；
- 运行验证：
  - `npx vitest run --root apps/web`（全量通过）；
  - `npx tsc -b`（exit 0）；
  - `npm run typecheck:tests`（exit 0）；
  - `npm run -w @vessel/web build`（构建成功）。
