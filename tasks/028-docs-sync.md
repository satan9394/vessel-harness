# 028 — 文档全面同步 Vessel（cah → vessel 收尾）

- 状态：待执行
- 优先级：P1
- 创建日期：2026-09
- 关联：goal-0b579936；依赖 026/027

## 目标

所有文档的 cah 引用改 vessel：PROVIDER-INTEGRATION.md（@cah/llm 等包引用 → @vessel/）、PROVIDER-MANAGEMENT.md（已 vessel 化，核对残留）、VESSEL.md（命名分层表更新：@cah/* → @vessel/*、cah 别名删除说明）、AGENTS.md（项目级，若引用包名）、docs/ideas/*.md、TEST-REPORT、UI 相关 HTML（若含 cah）。

## 验收标准

- [ ] docs/**/*.md 与 *.html 的 `@cah/`、`cah `、`CAH_` 零残留（排除 ideas 调研历史记录——调研报告是历史快照可保留原文并在头部注明；但操作类文档必须干净）
- [ ] 决策：调研类 docs/ideas/*.md 属于历史调研记录，保留原文但头部加"历史快照（V0.9 前，含旧包名 cah）"标注；操作类（PROVIDER-*/VESSEL/AGENTS）必须全 clean
- [ ] 卡置"待验收"

## 涉及文件

- docs/PROVIDER-INTEGRATION.md、PROVIDER-MANAGEMENT.md、VESSEL.md、AGENTS.md、TEST-REPORT-V07.md、V0x-PROGRESS.md 头部
- docs/agent-cli-analysis.html、ui-split-layout.html（若含 cah）
- docs/ideas/*.md（加历史标注）

## 依赖

- 026、027

## 工作证明（执行器回填）

- [ ] 残留检查表

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
