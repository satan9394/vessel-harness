# 任务卡 262：会话多行输入

**状态**：已验收（2026-10-26 对账；原「待协调者验收」，依据见 [卡 340](340-board-backlog-closeout.md)）

## Goal

第一波第2条：粘贴换行原样保留，Shift+Enter换行，Enter发送；保护中文IME。接续同一两波目标，不重置其它条目。

## Not Doing

不改core、后端或模型选择；不commit/push；不跑test:all；不动用户会话。

## Acceptance

定向测试覆盖多行原值提交、Shift+Enter不提交、Enter只提交一次、IME/229不提交、busy不重复发送。真实指定模型IAB验证粘贴、换行与提交后日志保留换行。六项门禁按目标执行，报告明确范围与退出码。

## Blast Radius

ConversationView、输入框样式、直接关联组件测试。

## Expected Evidence

定向Vitest日志、真实模型浏览器截图与session.jsonl；总结果只写evidence/sessions/2026-10-23-fix-wave-report.md。

## Result

改动、测试名、六项门禁及真实模型粘贴/键盘/日志原值证据统一见[修复报告](../evidence/sessions/2026-10-23-fix-wave-report.md)。
