# 任务卡266：Mock预设可见可用与协议一致性

**状态**：已验收（2026-10-26 对账；原「待协调者验收」，依据见 [卡 340](340-board-backlog-closeout.md)）

## Goal

第一波6：Provider Hub显示现有Mock模板，并可通过模型选择器使用内置离线模型；编辑协议与后端实际支持保持一致。

## Not Doing

不把内置Mock注册成可写供应商，不伪造网络探测，不放宽真实供应商校验，不改core，不commit/push、不跑test:all。

## Acceptance

Mock可搜索选择，说明离线限制、不要求URL/key，启动器显式选择mock；协议编辑仍只提供后端允许的openai-compatible/anthropic，mock只作为内置只读协议。有对应测试、六项指定门禁及IAB运行证据。

## Blast Radius

Web预设目录、ProviderSettingsModal、模型选择器及任务启动表单，关联测试；后端仅校验既有契约测试。

## Expected Evidence

定向测试、六项退出码、Mock真实浏览器操作截图统一在修复报告。

## Result

Mock恢复目录展示及显式模型选择；内置协议只读，编辑协议与后端两种可配置协议一致。六项门禁exit 0，IAB临时夹具Mock执行成功。详细测试与证据见[修复报告](../evidence/sessions/2026-10-23-fix-wave-report.md)。
