# 161 — Web 侧边栏 Topic 列表重构与 Thinking/Talking 详情抽屉 (Topic Sidebar & Talking APM Drawer)

- 编号：161
- 状态：已合入（用户验收通过 2026-09-24）
- 优先级：P1
- 创建日期：2026-09-24
- 关联模块：`apps/web`, `apps/local-server`
- 执行模型：Codex (GPT-6 Luna - Max Thinking)
- 验收人：用户

## 1. 目标与意图

在 `apps/web` 前端界面中实现工业级的现代交互体验：
1. 重构 Sidebar：以 Topic（主题）为中心进行分组展示，支持快速切换、重命名、搜索与归档清理。
2. 引入推演思考手风琴卡片（Thinking Accordion）：在推理大模型返回时，以带计时器的可折叠块展示思考过程，默认收起，点击平滑展开。
3. 引入 Talking 详情抽屉/微型指示栏：每一轮对话展示四个维度 Token 拆解（Prompt / Completion / Reasoning / Cache Read）、网络往返 Latency、以及基于 pricing 换算的单轮成本。

## 2. 权威开源参考基准与读取指引 (GitHub & Local Assets)

### 重点参考开源项目：
1. **Cline**：`https://github.com/cline/cline`
   - 对标要点：Thinking 思考折叠卡交互、实时 Token 与成本透明展示设计。
   - 读取方式：在线查阅其 webview UI 组件实现模式。
2. **Dify (开源核心版)**：`https://github.com/langgenius/dify`
   - 对标要点：侧边栏会话列表分组（Today/Previous 7 days/Earlier）以及消息底部的 APM 详情抽屉。
   - 读取方式：在线查阅其前端 Conversation / Chat 组件交互架构。

### 读取纪律：
- 严禁全量克隆大仓库至本工作区。
- 参考其 UI 交互布局与用户心智模型，使用当前项目的原生 React + CSS 模块实现，严禁引入过重的大型第三方组件库。

## 3. 接口与组件契约

在 `apps/web/src/components/` 扩展与重构：
- `Sidebar.tsx`：接收 `topics: SessionTopic[]`，按时间分组展示，支持搜索过滤输入框和重命名菜单。
- `ThinkingBlock.tsx`：渲染可折叠推演文本，显示思考耗时（如 `思考了 14 秒`），流式输出中自动保持折叠或由用户展开。
- `TalkingMetricsBar.tsx`：渲染单轮对话性能指标栏：
  - 时延（Latency，毫秒）
  - Token Breakdown（提示 / 输出 / 思考 / 缓存命中）
  - 估算成本（基于当前模型单价折算，如 `$0.0012`）

## 4. 确定性完成门禁 (DoD)

- [x] **组件测试**：在 `apps/web/src/` 下新建/更新测试文件：
  - 测试 `ThinkingBlock` 点击展开/折叠状态切换无异常。
  - 测试 `TalkingMetricsBar` 接收四维 Token 数据与时延时，正确格式化并渲染数值。
  - 测试 `Sidebar` 在接收到带 Topic 的会话列表时正确渲染分组标题。
- [x] **构建检查**：
  - `npm run -w @vessel/web build` 必须 exit 0。
  - `npm run typecheck:tests` 必须 exit 0。
  - `npx tsc -b tsconfig.json` 必须 exit 0。
- [x] **全量回归**：
  - `npm run test:all` 双 root 全部通过。

## 5. 架构红线与禁做项 (Out of Scope & Invariants)

- **性能底线**：超长 Thinking 文本（例如上万字）必须具备基本的高效渲染，严禁因频繁重绘造成输入框卡顿。
- **纯粹前端视图**：所有底层数据源必须通过既有的 `api.ts` 与 SSE 事件通道获取，严禁前端直接跨层去摸本地文件系统。
- 绝不得破坏既有 Web 功能的冒烟测试。

## 6. 架构提示与避坑点 (GAN 对抗审计沉淀)

- 在流式接收 `thinking_delta` 的过程中，为避免 React 渲染抖动，建议结合 requestAnimationFrame 或简单节流更新思考内容。
- 如果模型未返回 reasoning 或缓存命中 Token 为 0，对应的指标项应优雅隐藏，保持 UI 清爽，不做多余的 `0` 堆砌。
