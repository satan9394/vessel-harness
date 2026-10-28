# 任务卡270：UI-09工具细节折叠与Stop失败反馈

**状态**：已验收（2026-10-26 对账；原「待协调者验收」，依据见 [卡 340](340-board-backlog-closeout.md)）

## Goal

完成UI-09剩余缺口：工具参数默认折叠、失败原因默认可见；Stop失败明确提示、可重试，不伪报中断完成。

## Existing Classification

部分实现：卡246已提供IME/滚动底部守卫、回到底部与SSE恢复清错；卡262/263已补多行与终止原因历史。缺口：ToolActivityRow参数直接展开、错误只有状态缺原因；历史投影丢参数；MessageList全折叠可藏错误；ConversationView.stop吞错且无请求中防重。仅补这些缺口，保留既有仪表/审批/Diff入口。

## Not Doing

不改core，不重写执行循环或对话布局，不放宽沙箱，不commit/push、不跑test:all、不碰用户会话。

## Acceptance

默认成功/运行工具参数折叠，名称状态始终可读；error/denied原因及卡片不被默认/全折叠隐藏；刷新参数及原因仍在。Stop请求中防重复，失败显示原因且保持实际运行状态/草稿，可重试；切会话或后续回合不显示旧Stop错误。定向测试、六项门禁、真实模型21+工具调用与滚动/详情/刷新验证。

## Blast Radius

Web ToolActivityRow/MessageList/ConversationView、ToolDelta、local-server工具历史与实时投影及关联测试。

## Expected Evidence

失败→通过测试、六项退出码、临时夹具真实模型20+工具与JSONL行号、统一截图目录，记录至修复报告。

## Result

参数默认折叠、错误可见、Stop失败/防重/过期保护、工具摘要去重与实际消息区滚动边界均已修复。六项门禁exit 0，真实模型22次主批次/24条历史、刷新、滚动、Stop与草稿验证通过。详见[修复报告](../evidence/sessions/2026-10-23-fix-wave-report.md)。
