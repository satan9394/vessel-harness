# 043 — UI 模块勾选（Customize：Team/Tasks/Changed Files/Context/Tool Activity/Logs/Cost/MCP/Policy）

- 状态：已合入（2026-09-18 对账）
- 对账记录：原状态行「待验收」；实际已合入，证据：docs/V1.0-CHECKPOINT.md Milestone B（835b06d）。
- 优先级：P1（Milestone B；路线 §6.3）
- 创建日期：2026-09
- 关联：路线卡 043；goal（V1.0 产品化）；依赖 042（已合入 292cfd2）

## 目标

apps/web 右上 Customize 面板：可勾选显示模块（Team/Tasks/Changed Files/Context/Tool Activity/Logs/Cost/MCP/Policy），默认只开 Tasks + Changed Files（路线 §6.3）；勾选状态本地持久（localStorage）。UI 哲学"能力丰富界面安静"。

## 验收标准

- [ ] Customize 按钮（右上）+ 弹出面板：checkbox 列表（Team/Tasks/Changed Files/Context/Tool Activity/Logs/Cost/MCP/Policy）
- [ ] 默认勾选：Tasks + Changed Files；其余关
- [ ] 勾选状态存 localStorage（key 如 vessel.ui.modules）；刷新保持
- [ ] 主区/会话视图按勾选显示对应面板（占位即可：Tasks/Changed Files 显示"开发中"或简单列表；Cost 显示 UsageBar；Tool Activity 显示工具行；Team/Context/Logs/MCP/Policy 占位"未实现"）
- [ ] 至少让 Cost 和 Tool Activity 复用 042 已做的 UsageBar/ToolActivityRow
- [ ] vite build 通过；root vitest/tsc 不破坏（362+ 绿）
- [ ] 卡置"待验收"

## 涉及文件

- apps/web/src/components/CustomizePanel.tsx（新）+ App.tsx（挂 Customize 按钮 + 模块渲染逻辑）+ styles.css
- 测试：localStorage 逻辑可单测（utils 或 hook）；组件测可选

## 依赖

- 042（UsageBar/ToolActivityRow 可复用）

## 方法

- 简单 useState + localStorage 读写（JSON）
- 模块渲染：主区按 enabledModules 渲染对应区块

## 工作证明（执行器回填）

- [x] CustomizePanel / 勾选持久 / 模块渲染 / build（web vitest 18 绿、vite build ok、root tsc -b 0 / root vitest 362 绿；commit 835b06d）

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：