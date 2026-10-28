# 任务卡265：首屏与历史就绪后的输入焦点

**状态**：已验收（2026-10-26 对账；原「待协调者验收」，依据见 [卡 340](340-board-backlog-closeout.md)）

## Goal

第一波5：启动器首屏可直接输入；会话输入在历史加载完成后获得焦点，保留用户主动移到其它控件的焦点。

## Not Doing

不改core，不重写草稿，不commit/push，不跑test:all，不操作用户会话。

## Acceptance

有异步历史就绪与不抢焦点测试，六项指定门禁通过，IAB首屏与历史会话可直接输入并留证。

## Blast Radius

Web启动器/ConversationView及关联测试。

## Expected Evidence

定向测试、门禁退出码、浏览器focus与文本证据统一写修复报告。

## Result

启动器原生autoFocus；会话等待历史快照就绪后聚焦，用户在等待期间选择其它控件则不抢焦点。六项门禁exit 0，IAB无需点击输入框直接输入通过。详细测试与证据见[修复报告](../evidence/sessions/2026-10-23-fix-wave-report.md)。
