# 202 — 双模态双轴工作台布局与常驻 Docked Inspector (Dual-Surface Layout & Docked Inspector)

- 编号：202
- 优先级：P1
- 关联模块：`apps/web`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已完成（本地验证）
- 创建日期：2026-10-09

---

## 1. 目标与意图

传统 Agent Web 界面往往是单列的即时通讯样式，导致用户在聊天时无法同时纵览项目的全局健康度、拓扑关系与系统指标。

本任务旨在建立 **Vessel Web 端双模态双轴工作台（Dual-Surface Layout）**：
1. **时间线与画布双轴解耦**：
   - **主轴（Left / Primary）**：对话时间线（Chat Timeline），沉浸式处理自然语言交互、任务分解与就地组件反馈；
   - **副轴（Right / Secondary）**：常驻可折叠 Docked Inspector 全景全能画布；
2. **深度集成既有核心可视化资产**：
   - 在 Docked Inspector 中整合四大 Tab 面板：
     - **Tab 1: Swarm 网格拓扑与 Peer 节点**（集成 `SwarmTopologyView` 与 RTT 延迟波形）；
     - **Tab 2: 认知自愈与反思规则**（集成 `CognitiveRulesDashboard`，实时反映 Policy 提炼经验）；
     - **Tab 3: KV Cache 经济学与工作区指纹**（展示真实 `billedHitRate`、三段式前缀布局与状态哈希变动）；
     - **Tab 4: AST 符号依赖视窗**（直观呈现当前会话涉及的模块关系与反向引用）；
3. **响应式与快捷交互**：
   - 支持一键展开/折叠副轴（键盘快捷键或顶部图标），自适应大屏多列与小屏单列沉浸模式。

---

## 2. 接口契约规范 (Interface-First)

### 2.1 工作台容器契约 (`apps/web/src/components/layout/DualSurfaceLayout.tsx`)

```tsx
export interface DualSurfaceLayoutProps {
  children: React.ReactNode; // Chat 主轴内容
  inspectorDefaultOpen?: boolean;
  sessionId: string;
}

export function DualSurfaceLayout({
  children,
  inspectorDefaultOpen = false,
  sessionId,
}: DualSurfaceLayoutProps): React.JSX.Element;
```

### 2.2 状态持久化与快捷控制
- 右侧面板展开/收起状态保存在 `localStorage`，刷新页面不丢失；
- 在移动端或窄屏宽度 (<1024px) 下自动转换为模态抽屉（Modal Drawer）弹出，不压缩主对话视图。

---

## 3. 验收标准与测试用例 (DoD)

1. **布局与交互测试 (`apps/web/src/components/layout/DualSurfaceLayout.test.tsx`)**：
   - 验证默认折叠/展开行为正常；点击切换按钮或快捷键能顺畅切换副轴状态；
   - 验证四个 Tab 切换流畅，分别能正确挂载对应的看板组件且无报错；
2. **构建与样式门禁**：
   - `npm run -w @vessel/web build -- --emptyOutDir false` exit 0，无任何 React 19 渲染告警；
3. **全仓回归**：
   - `npm run test:all` 与 `npm run typecheck:tests` exit 0。


## 4. Delivery evidence
2026-10-09: Web22 files/201 tests passed (including independent-review diff-header regression); server route12 tests passed. Types/build exit0. Browser verified four tabs, two-sample cache waveform, actual prefix/workspace telemetry with separate hashes, observed caller topology, persisted open/tab state, 800px modal focus trap/Escape, editable shortcut guard. Screenshots/logs evidence/sessions/2026-10-09-v2.4/card202-*. CLI observer injection remains203 integration requirement.

