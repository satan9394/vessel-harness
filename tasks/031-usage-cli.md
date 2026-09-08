# 031 — 使用统计 CLI（vessel usage / pricing）+ 收尾

- 状态：已合入（08baad5，usage/pricing CLI）
- 优先级：P1
- 创建日期：2026-09
- 关联：goal-0b579936；依赖 029/030

## 目标

把使用统计做成可用命令 + 收尾 V0.9：`vessel usage`（显示累计消耗：总 tokens/成本/按供应商/按模型/最近 N 条）、`vessel pricing <model?>`（价目查询）、`vessel models` 可选带元数据。全量验证 + 文档 + 提交。

## 验收标准

- [ ] `vessel usage`：输出总消耗摘要（tokens in/out/cache、估算成本、调用次数）+ 按供应商 + 按模型 top 列表 + `--recent <n>` 最近记录
- [ ] `vessel pricing [model]`：查模型价目（无参列出 catalog 主流模型价目表）
- [ ] `vessel models` 支持 `--meta`（带 context/cost 列）或已有输出增强
- [ ] 命令注册进 cli.ts 分发 + 帮助文案
- [ ] 接线验证：跑一轮真实 mock 会话后 `vessel usage` 能看到记录（E2E）
- [ ] 全量 vitest/tsc 绿；文档（PROVIDER-MANAGEMENT 或 VESSEL）补 usage/pricing 用法
- [ ] 卡置"待验收"

## 涉及文件

- apps/cli/src/cli.ts（usage/pricing 命令）、usage/UsageStore.ts、modelCatalog.ts 消费
- 测试 + 文档

## 依赖

- 029、030

## 设计锚点

- usage/pricing 是只读查询命令；UsageStore 数据来自 029 的 after_model 落盘
- 输出对齐现有 CLI 风格（表格/列表）
- mock 会话能产生 usage 记录（接线验证）

## 工作证明（执行器回填）

- [ ] diff / 测试 / E2E / tsc

## 验收结论（指挥回填）

- [x] 已合入
- 备注：
