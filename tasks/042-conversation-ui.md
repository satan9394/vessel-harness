# 042 — Conversation UI（会话对话界面 + SSE 实时流）

- 状态：已合入（2026-09-18 对账）
- 对账记录：原状态行「待执行」；实际已合入，证据：docs/V1.0-CHECKPOINT.md Milestone B（292cfd2）。
- 优先级：P0（Milestone B 核心；路线 §6.2-6.3、卡 042）
- 创建日期：2026-09
- 关联：路线卡 042；goal（V1.0 产品化）；依赖 041（web shell 已合入 d12de0f）、040（SSE 投影已合入 4d1be02）、044（serve/web）

## 目标

在 apps/web 里实现真正的对话界面：打开/新建会话 → 发消息 → runTurn → 通过 SSE 实时流显示 conversation/tool/usage 增量。让 Web 成为可用的日常交互面。

## 验收标准

- [ ] 会话视图：左侧栏点 session → 主区显示对话（消息流：user/assistant 气泡 + 工具活动行 + 底部输入框 + 发送按钮 + Stop 按钮占位）
- [ ] 发消息：POST /api/sessions/:id/turns（api.ts 已有 runTurn）→ 显示 assistant 回复；同时打开 SSE /api/sessions/:id/events 实时接收 conversation/tool/usage/policy 增量并渲染（EventSource 或 fetch stream）
- [ ] SSE 消费：`src/sse.ts`（EventSource 封装，onEvent 回调按 type 分发 conversation/tool/usage/policy）；断线重连（EventSource 自动重连）
- [ ] 工具活动行：tool delta 显示工具名 + 状态（started/done/denied）+ 耗时（来自 ToolActivityProjection）
- [ ] 用量显示：usage delta 累计显示 tokens/cost（可放会话头部或底部状态条）
- [ ] 组件：`ConversationView.tsx`（消息列表+输入框）、`MessageList.tsx`、`ToolActivityRow.tsx`、`UsageBar.tsx`；样式遵循 UI-THEME
- [ ] 测试：sse.ts 的解析/分发单测（mock EventSource）；api.ts 已有；组件测可选（jsdom 若配则加 1 个 ConversationView 冒烟——不配则跳过，以 vite build 通过为准）
- [ ] `vite build` 通过；root vitest/tsc 不破坏（337+ 绿，新增 web 测试算 web 侧）
- [ ] 卡置"待验收"

## 涉及文件

- apps/web/src/sse.ts（新）+ sse.test.ts
- apps/web/src/components/ConversationView.tsx、MessageList.tsx、ToolActivityRow.tsx、UsageBar.tsx（新）
- apps/web/src/App.tsx（接会话视图路由/状态）
- apps/web/src/styles.css（对话样式）

## 依赖

- 041（web shell）、040（SSE 投影事件类型：conversation/tool/usage/policy delta）

## 方法

- api.ts 已有 createSession/runTurn；加 getSessionEvents(id) 返回 EventSource
- App 状态：selectedSessionId → ConversationView 拉历史（GET /api/sessions/:id 的 state？——若 server 没有历史消息 API，先只显示新消息+SSE 实时；历史回放可选本卡不做或加 GET /api/sessions/:id/messages projection——若 040 的 ConversationProjection 可经 server 暴露就用它，否则本卡先实时流）
- 需确认 server 是否有"历史消息"端点：查 apps/local-server/src/server.ts 的 GET /api/sessions/:id（返回 state 还是含 messages）——没有就本卡先做实时 + 提示"历史回放下阶段"

## 工作证明（执行器回填）

- [ ] sse/组件/构建/测试

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：