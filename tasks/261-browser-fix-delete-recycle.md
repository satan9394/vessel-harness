# 任务卡 261：真实会话目录回收失败修复

**状态**：已验收（2026-10-26 对账；原「待协调者验收」，依据见 [卡 340](340-board-backlog-closeout.md)）

## Goal

修复浏览器验收报告中真实 OS 回收失败；夹具会话实际进入回收站，刷新后不回来。此卡是现有两波修复目标的第一条，不代表缩小整体目标。

## Not Doing

不改 packages/core；不删除用户数据；不绕过沙箱或回收站；不永久删除；不 commit/push；不跑 test:all；不调用其它本机 agent；本条不新增真实模型调用。

## Acceptance

1. 以系统临时目录自建夹具复现并辨明失败原因。
2. 真实回收成功与目录消失；IAB 删除后刷新不再出现。
3. 失败仍保留索引和数据，明确回收/关闭/索引失败，不静默吞错。
4. 针对根因的回归测试通过，保持已有并发删除与持久回滚断言。
5. 按目标跑 tsc -b、typecheck:tests、web typecheck、vitest run apps/local-server、test:web、web build；日志保留，packages/core diff 为零。

## Blast Radius

local-server 回收与会话删除生命周期、相关测试；若确需 application 的 controller 关闭接口，只做最小非核心修改。

## Expected Evidence

根因探针、定向测试及门禁日志、IAB before/after/refresh 截图。总进度与原文清单唯一位置为 evidence/sessions/2026-10-23-fix-wave-report.md。

## Result

本条根因、代码范围、测试名、六项门禁及真实模型IAB/OS回收站证据统一见 [两波修复报告](../evidence/sessions/2026-10-23-fix-wave-report.md)。整体目标其余条目继续。
