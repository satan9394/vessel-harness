# 任务卡272：ARCH-01剩余运行结果证据

**状态**：已修并验证，待协调者验收（2026-10-22）

## Goal

冷启动/刷新Activity时，不必打开会话或构造模型控制器也能保留持久cancelled/interrupted/failed/completed；无权威终态返回unknown。Run identity与Session identity分开，保留状态来源及观察修订。

## Existing Classification

部分实现：258已消除team/subagent虚假完成，264已分开取消/中断/失败且双语展示。现有Activity仅从已加载controller读终态；registry索引不携带终态，冷启动未打开会话丢失已知结果。未闭合turn/start直接映射interrupted，缺少终态证据。

## Not Doing

不改core/执行状态机、不重写已实现取消映射、不模拟模型成功、不修改历史会话记录、不commit/push、不跑test:all、不动用户会话。

## Acceptance / Plan

1. 共享只读运行观察器供实时与registry流式历史使用，最新回合覆盖旧成功，缺失/陌生/不匹配终态unknown；明确区分回收器实际生成interrupted记录与推断中断。
2. queued/running/waiting_approval/completed/failed/interrupted/cancelled/unknown八类表驱动测试；冷启动HTTP与审批/运行优先级测试；日志只读、无模型调用。
3. 六项指定门禁；真实Stop会话Activity在服务重启前后及刷新一致，记录JSONL行号及截图。

## Blast Radius

application只读运行观察/SessionRegistry、local-server Activity来源、Web可选契约字段、ConversationView恢复终止标记/断网结果未知及定向测试。

## Expected Evidence

修复报告中测试名/六项退出码、真实历史API/UI证明、最小失败复现及JSONL行号。

## Result

只读实时/冷历史结果共用观察器、最新Run证据、未知终态及恢复中的取消/截断提示已补齐。最后六项门禁全0，server246/Web475；真实Stop冷启动/刷新保持中断，日志SHA不变。实现、测试名、门禁及限制唯一记录于[修复报告ARCH-01节](../evidence/sessions/2026-10-23-fix-wave-report.md)。未改core、未commit/push、未跑test:all。
