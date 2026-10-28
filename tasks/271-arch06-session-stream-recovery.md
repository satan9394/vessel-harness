# 任务卡271：ARCH-06会话事件游标与断线恢复

**状态**：已验收（2026-10-26 对账；原「待协调者验收」，依据见 [卡 340](340-board-backlog-closeout.md)）

## Goal

补齐丢帧、重复、乱序、30秒断线、刷新与快速三会话切换后的消息/工具/计费/审批一致性。

## Existing Classification

部分实现：原生EventSource与Bearer fetch流均可重连，首屏可选hydrate，ConversationView已有会话代际守卫；但无version/session/event identity或cursor，Bearer不携带Last-Event-ID，缓存会话连接不补快照，重复增量直接叠加，onOpen仅清错。WidgetRoutes能重放当前内存决策，但未纳入统一checkpoint。

## Plan / Acceptance

1. 会话独立、单生产者的有界事件回放，版本/会话/epoch/单调cursor/event identity；原生Last-Event-ID与Bearer续传；过期/异epoch游标回退权威checkpoint。
2. 客户端去重，发现缺口/乱序主动重连续传；完整快照以服务端为准，包含工具/usage/审批和实际运行状态，不清空草稿、不伪报成功。
3. 定向故障测试覆盖丢1帧/重复2帧/乱序/30秒间隔/刷新/三会话隔离，两种传输均覆盖；真实浏览器通过临时故障代理验证30秒断线与真实模型恢复。
4. 六项指定门禁通过，报告记录退出码、JSONL行号与截图。

## Not Doing

不改core或执行循环、不永久写入流式推理、不把内存窗口冒充持久日志、不弱化同源/认证/沙箱、不commit/push、不跑test:all、不操作用户会话。

## Blast Radius

local-server会话SSE发布/回放与checkpoint、Web SSE消费者和ConversationView状态恢复、Widgets只读快照、相关测试/事件协议文档。

## Expected Evidence

独立定向测试、六项退出码、30秒故障代理与真实模型证据，统一写修复报告。若必须改core则停止并报告。

## Result

会话独立有界SSE回放、权威checkpoint、两传输续传及客户端去重/补缺已实现。六项门禁全0，server232/web471；真实运行中30,002ms断线、刷新、三会话切换通过。过程中的原生503停止重试、回放前水位导致重连循环均由真实测试发现并修复，保留失败证据。详细实现、测试名、JSONL行号和限制唯一记录于[evidence/sessions/2026-10-23-fix-wave-report.md](../evidence/sessions/2026-10-23-fix-wave-report.md)的ARCH-06节。未改core、未commit/push、未跑test:all。
