# 任务卡 277: 修复浏览器验收的两个 P2 缺陷

**状态**: 待执行
**创建时间**: 2026-10-23
**执行者**: Codex (`gpt-6.1-sol`, medium)
**协调者**: OpenCode

---

## 1. 来源

`evidence/sessions/2026-10-23-ui-final-report.md`（卡 275 的浏览器验收）给出两条 P2，均未修：

**B-F1 删除确认框忽略 Escape 且焦点丢失**
- 复现：打开可丢弃会话 → Tab 到删除图标 → Return → 按 Escape。
- 期望：取消确认并把焦点还给触发按钮。
- 实际：确认框仍然打开；`document.activeElement` 是 `BODY`。
- DOM 观测：`{"confirmationVisible":true,"focus":"BODY"}`；截图 `B5-delete-keyboard-escape.png`。

**C-F1 360px 英文视图 footer 压住 Goals**
- 复现：有内容的会话、Inspector 关闭、英文、视口 360×900。
- 期望：KEY HINTS 占据自己的布局空间，位于 Goals 之上。
- 实际：hints 父容器 y=810.02–842.92，Goals 容器从 y=774.03 开始（Goals 标签 790.03–808.62），重叠。
- 截图 `C-360-light-en.png`。

## 2. Goal

两条都修掉，且不回归既有交互。

## 3. Acceptance Criteria

1. Escape 关闭删除确认并把焦点还原到打开它的按钮；再按 Tab 仍能正常移动（不被困）。
2. 360×900 英文下，KEY HINTS 与 Goals 无交叠：可以用 `getBoundingClientRect()` 断言
   `hints.top >= goals.bottom`（允许 0–1px 误差）。
3. 新增/修改组件测试覆盖两条（jsdom 下能测的部分：Escape 处理、焦点还原；布局用可测的类名/结构或
   CSS 变量断言，若 jsdom 无法测几何则在测试里注明并给出浏览器复验步骤）。
4. 门禁：`npx tsc -b`、`npm run typecheck:tests`、`npm run -w @vessel/web typecheck`、`npm run test:web`、
   `npm run -w @vessel/web build`。
5. 不引入新的全局键盘监听；若必须，卸载时清理干净。

## 4. Not Doing

- 不改产品范围、不加新面板、不动 `packages/*`。
- 不为了让测试过而放宽断言；jsdom 测不了几何就如实说明。

## 5. Blast Radius

`apps/web/src/components/Sidebar.tsx`（或删除确认所在组件）、`apps/web/src/components/TaskComposer.tsx`
与相关 CSS、i18n（若文案需要）。

## 6. Result

待执行。
