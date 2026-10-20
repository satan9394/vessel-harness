# Task 232 — 模型供应商全屏独立中枢、高级模型搜索筛选器与 CC-Switch 权威预设补齐 (Provider Hub Full-Surface & Advanced Model Picker)

## Status: COMPLETED
- **Owner**: 主会话 (Planner/Coordinator) 调度
- **Research & Design**: OpenCode (`commandcode/deepseek/deepseek-v4.1-flash`)
- **Implementer**: Codex (`gpt-6.1-sol`, reasoning_effort: medium)
- **Reviewer**: OpenCode (`commandcode/deepseek/deepseek-v4.1-flash#max`)
- **Reference**: CC-Switch / Open Claude UI / `make-interfaces-feel-better` / `impeccable`
- **Date**: 2026-10-19
- **Evidence**: `apps/web/.task232-evidence/PROOF.md`, `evidence/sessions/2026-10-19-agent-walkthrough-232/`

---

## 1. Goal & Background
解决用户指出的两大核心体验痛点：
1. **痛点一：模型模块入口体验差、做得很丑陋，单独挪出来作为一级独立大视图**：
   - 当前在左侧切到 Settings 时，中间主体只有「模型设置」四个字的一个孤零零按钮，点击后才弹窗；
   - 重构为将模型供应商中枢（Provider Hub）抽离为独立的主视图面板 `ProviderHub.tsx`，在 `area === 'settings'`（或独立视图）下**直接平铺展开**，作为完整、专业、大气的工作台，彻底告别“先看按钮再点弹窗”的断层体验；保留全局 Modal 模式以供 TaskComposer 快捷唤起。
2. **痛点二：Lark（飞书）等海量模型缺乏搜索与批量操作（全选/全不选/反选）**：
   - 彻底重构 `ModelChips.tsx` 为高级模型选择器组件（`ModelChips.tsx` / `ModelSelectorPanel.tsx`）：
     - **模型实时模糊搜索框**：快速过滤候选模型（如搜索 `lark`, `deepseek`, `flash`, `qwen`, `gpt` 等）；
     - **批量快捷操作栏**：一键「全选 (Select All)」、「全不选 (Deselect All)」、「反选 (Invert)」、「仅选常用 (Recommended)」；
     - **状态计数与统计徽章**：实时显示「已选 X / 共 Y 个模型」；
     - **海量模型流线型自适应滚动**：上下带有发丝消隐羽化遮罩（Fade Mask），告别长列表撑爆页面；
3. **痛点三：权威供应商预设全面对齐 CC-Switch 级别**：
   - 补全飞书 Lark（火山方舟/飞书项目专属端点）、百川、MiniMo、零一万物等权威预设，确保预设丰富度达到并超越 CC-Switch 标准。

---

## 2. Not Doing
1. **禁止修改核心**：`packages/core` 修改行数严格保持为 0。
2. **禁止破坏既有供应商数据**：兼容既有 `providers.json` / `current.json` 存储格式与 API 契约。
3. **纯本地开发**：不向 GitHub push，所有删除走 Windows 回收站。

---

## 3. Scope & Blast Radius
- `apps/web/src/components/providers/ModelChips.tsx`: 升级为带搜索、全选/全不选/反选、计数徽章的高级选择器
- `apps/web/src/components/providers/ProviderSettingsModal.tsx` & `ProviderHub.tsx`: 抽离为既可独立全屏平铺渲染、也可作为 Modal 弹出的自适应结构
- `apps/web/src/App.tsx`: 在 Settings 区域直接完整内嵌展示模型供应商全屏中枢
- `apps/web/src/components/providers/presetsData.ts` & `packages/application/src/providers/presets.data.ts`: 对齐飞书 Lark 及 CC-Switch 级别预设
- `apps/web/src/styles.css`: 补充全屏展台布局、模型高级筛选工具栏、发丝羽化滚动区域样式
- `apps/web/src/i18n.ts`: 补充全选、全不选、反选、模型筛选等中英文词条

---

## 4. Acceptance Criteria
1. **独立全屏工作台**：进入设置区域时，直接呈现完整的模型供应商管理中枢，包含已配列表、预设分类展台与表单，无需再次点击按钮弹窗；
2. **高级模型筛选器**：支持输入关键词实时过滤模型；支持「全选」、「全不选」、「反选」批量操作；展示选中计数；
3. **CC-Switch 预设齐备**：涵盖飞书 Lark、Command GOTA 等全部主流预设；
4. **全量门禁**：
   - `npx tsc -b` exit 0；
   - `npm run typecheck:tests` exit 0；
   - `npm run -w @vessel/web test` 100% 通过；
   - `npm run -w @vessel/web build` 0 警告成功构建；
   - `packages/core` 0 改动。

---

## 5. Verification & Acceptance Evidence
- **Web UI 单测**: `npx vitest run --root apps/web` 全量 **48 文件 / 396 passed (100%)**，耗时 17.36s；
- **Web 生产构建**: `npm run -w @vessel/web build` 0 警告成功（`dist/` 输出完整，打包耗时 184ms）；
- **TypeScript 静态检查**: `npm run typecheck:tests` exit 0，`npx tsc -b tsconfig.json` exit 0（全仓类型零错误）；
- **薄核零侵入**: `git diff --stat packages/core` 输出严格为空（0 修改）；
- **端到端 Chromium 走查**: `python scripts/run-browser-agent-walkthrough-232.py` **4/4 PASS (100%)**：
  1. `01_OpenHomePage` PASS (1016ms)
  2. `02_ValidateFullScreenProviderHub` PASS (656ms)
  3. `03_SelectLarkPreset` PASS (422ms)
  4. `04_ValidateAdvancedModelChips` PASS (625ms)
  - Console Errors: 0，Page Errors: 0；
  - 截取 4 张全真机高清渲染截图归档于 `evidence/sessions/2026-10-19-agent-walkthrough-232/`。
- **独立对抗性审查**: OpenCode (`deepseek/deepseek-v4.1-flash#max`) 审查报告已归档至 `evidence/sessions/2026-10-19-opencode-review-232.md`。

