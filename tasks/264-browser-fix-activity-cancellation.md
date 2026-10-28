# 任务卡 264：Activity区分取消、中断与失败

**状态**：已验收（2026-10-26 对账；原「待协调者验收」，依据见 [卡 340](340-board-backlog-closeout.md)）

## Goal

第一波第4条：真实Stop后Activity展示中断；取消与执行失败保留不同状态及双语文案，实时与刷新历史一致。

## Not Doing

不改packages/core，不重写生命周期，不commit/push，不跑test:all，不动用户会话。

## Acceptance

后端session/team/subagent/goal聚合不再将取消映射为失败；前端契约、分组、徽标同步；真失败仍为失败。定向测试、六项指定门禁、原真实Stop会话IAB复验。

## Blast Radius

local-server Activity投影、Web Activity类型/翻译/样式及关联测试。

## Expected Evidence

测试名称、门禁退出码、真实session.jsonl行号与Activity刷新截图，记录到既有修复报告。

## Result

后端与前端保留独立interrupted/cancelled状态，失败不变。六项指定门禁exit 0，真实Stop会话Activity刷新仍显示已中断。详情见[修复报告](../evidence/sessions/2026-10-23-fix-wave-report.md)。
