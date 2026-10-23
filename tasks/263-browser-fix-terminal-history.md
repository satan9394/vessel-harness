# 任务卡 263：刷新恢复终止原因

**状态**：已修并验证，待协调者验收（2026-10-22）

## Goal

第一波第3条：基于已持久化turn/end重建长度截断、取消/中断提示；历史正文与终止原因刷新后均保留。

## Not Doing

不改core，不用浏览器内存冒充持久化，不重写已可用消息恢复；不commit/push，不跑test:all，不动用户会话。

## Acceptance

后端从session.jsonl投影终止原因，HTTP与SSE快照一致；Web冷启动与刷新展示length和interrupted，换会话不串状态；有定向回归测试和指定真实模型IAB复验。其余两波目标保留。

## Blast Radius

local-server历史投影、Web transcript类型与ConversationView、关联测试。若需改core先停止并说明原因。

## Expected Evidence

定向测试、六项指定门禁、真实模型length/Stop后刷新证据，统一记录在两波修复报告。

## Result

终止原因从既有turn/end重放到消息；六项门禁exit 0，真实模型length/Stop及刷新保留均通过。改动、测试名与证据见[修复报告](../evidence/sessions/2026-10-23-fix-wave-report.md)。整体目标继续。
