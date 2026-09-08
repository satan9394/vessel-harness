# V0.9 执行进度（V09-PROGRESS.md）— Vessel 品牌彻底化 + 使用统计模块

> 接力：tasks 026-031。触发：用户要求彻底移除 cah 别名与 @vessel/* 包名 + 增加使用统计模块（模型供应/消耗/定价，参考 cc-switch），UI 不做。
> 最后更新：2026-09（拆卡完成，026 执行中）。

## 0. 基线

- 285 测试绿；tsc 0。@vessel/ 全仓 201 处；CAH_ 环境变量 16 处；bin 有 cah 别名。

## 1. 里程碑

| 卡 | 标题 | 状态 |
|---|---|---|
| 026 | @vessel/* → @vessel/* 包名迁移 | 执行中 |
| 027 | 移除 cah 别名 + CAH_* → VESSEL_* | 已合入 0eb0d89 |
| 028 | 文档全面同步 Vessel | 已合入 43a1a53 |
| 029 | 使用统计核心（UsageStore 落盘） | 待执行 |
| 030 | 模型目录增强 + 定价全量 | 待执行 |
| 031 | usage/pricing CLI + 收尾 | 待执行 |

## 2. 关键决策

- 改名迁移：批量脚本 `@vessel/` → `@vessel/`（字符串替换）+ 逐包核对 name + npm install 重建软链；不留 cah 别名（027）。
- 使用统计：UsageStore 持久化 ~/.dsh/usage.json（原子写），after_model 接线；模型元数据/价目数据化到 configs/model-catalog.json（来源 models.dev 快照/cc-switch）。
- 调研类 docs/ideas 历史快照保留原文+头部标注；操作类文档必须 clean。
