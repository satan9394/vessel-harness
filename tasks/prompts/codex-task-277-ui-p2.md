# Codex 执行契约：卡 277 修复两个 P2 UI 缺陷

仓库 `E:\Code_file\Projects\Vessel_Harness`，分支 `main`，工作树干净。

## 先读

1. `tasks/277-ui-p2-fixes.md`（范围与验收，唯一权威）
2. `evidence/sessions/2026-10-23-ui-final-report.md` 的 `### Finding B-F1` 与 `### Finding C-F1`
3. `apps/web/src/components/Sidebar.tsx`（删除确认）
4. `apps/web/src/components/TaskComposer.tsx` 与相关 CSS（footer / Goals）

## 两个缺陷

**B-F1**：删除确认框按 Escape 不关闭，且焦点掉到 `BODY`（实测 `{"confirmationVisible":true,"focus":"BODY"}`）。
期望：Escape 取消确认并把焦点还给打开它的按钮；Tab 仍可用。

**C-F1**：360px 英文视图下，KEY HINTS 的父容器 y=810.02–842.92，而 Goals 容器从 y=774.03 开始，
两者重叠。期望 `hints.top >= goals.bottom`。

## 要做

1. 两处都修，且不回归既有交互（删除确认的鼠标路径、Tab 顺序、Esc 在其它浮层的行为）。
2. 新增测试：
   - Escape 关闭确认 + 焦点还原（jsdom 可测）。
   - 360px 英文布局：jsdom 测不了真实几何就**如实注明**，改为断言改动的结构/类名，并给出浏览器复验步骤。
3. 门禁：`tsc -b`、`typecheck:tests`、`@vessel/web typecheck`、`test:web`、`web build`。

## 红线

- 不引入全局键盘监听；必须用则卸载清理干净。
- 不放宽断言、不改 `packages/*`、不 commit/push、不跑 `test:all`。
- 不为了让 360px 通过而隐藏内容或缩小字号——要的是布局不再重叠。

## 交付

- 改动说明 + 新增测试名。
- 门禁退出码与计数。
- 明确写出：哪一条是 jsdom 真验证、哪一条只能靠浏览器复验（附复验步骤）。
