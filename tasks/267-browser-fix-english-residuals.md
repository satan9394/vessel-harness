# 任务卡267：供应商描述与主题无障碍文案国际化

**状态**：已修并验证，待协调者验收（2026-10-22）

## Goal

第一波7：英文界面的供应商描述、预设名称与主题按钮aria-label/title使用英文；中文界面保留原文。

## Not Doing

不改供应商端点/协议/模型，不改application元数据，不改core，不commit/push，不跑test:all。

## Acceptance

全目录英文无中文残留，主题两方向无障碍标签随语言变化；有负向测试及六项指定门禁与IAB证据。

## Blast Radius

Web预设呈现、主题按钮、翻译与关联测试。

## Expected Evidence

测试名/退出码、中英截图共用现有目录；记录于修复报告。

## Result

英文预设名称/描述与主题aria-label/title已国际化，中文保留，端点元数据不变。六项门禁exit 0，IAB英文卡片与主题双向切换通过。详见[修复报告](../evidence/sessions/2026-10-23-fix-wave-report.md)。
