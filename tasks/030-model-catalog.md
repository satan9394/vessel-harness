# 030 — 模型目录增强 + 定价全量（模型元数据与价目，参考 cc-switch）

- 状态：已合入（727d740，model-catalog + 定价回退）
- 优先级：P1
- 创建日期：2026-09
- 关联：goal-0b579936；依赖 029（成本估算用元数据）

## 目标

模型供应/定价模块做好：① 常用模型的元数据目录（contextWindow / output limit / 每 1M token 价目）——源自 models.dev 快照与 cc-switch 目录，落到 `configs/model-catalog.json`（数据化，非硬编码）；② pricing.json 与 model-catalog 对齐（价目单一来源）；③ resolvePrice 扩展支持从 model-catalog 查价。UI 不做。

## 验收标准

- [ ] `configs/model-catalog.json`（新）：常用模型条目 { id, provider?, contextWindow?, outputLimit?, priceIn?/priceOut?/priceCache? }，≥60 条（覆盖主流：claude/gpt/deepseek/qwen/kimi/glm/gemini/llama/qwen-coder 等）
- [ ] 数据来源标注：条目注明 models.dev / cc-switch 来源（头部注释）
- [ ] loadModelCatalog()（apps/cli/src/providers/ 或 usage/）+ 查询（byId / 按 provider）
- [ ] pricing.json 与 catalog 对齐：catalog 有价目时 resolvePrice 能查到（model > catalog > protocol > default）
- [ ] `vessel models --meta` 或类似：展示模型元数据（成本/context）——至少 CLI 可查（029 后 vessel usage 用）
- [ ] Vitest：catalog 加载/查询/与 pricing 联合解析
- [ ] 全量绿 + tsc 0
- [ ] 卡置"待验收"

## 涉及文件

- `configs/model-catalog.json`（新）、`apps/cli/src/providers/modelCatalog.ts`（新）+ 测试
- `apps/cli/src/providers/pricing.ts`（resolvePrice 扩展）
- 文档（PROVIDER-MANAGEMENT §6 pricing 衔接）

## 依赖

- 029（或并行——catalog 独立可先做）；调研数据：docs/ideas/data/models.dev-api.json（213 家全量含模型）为数据源

## 设计锚点

- 数据化：catalog 是数据文件，查询是纯函数；宁精不滥（主流模型 + 价目准确）
- models.dev-api.json 快照已有大量模型元数据可抽取；cc-switch 目录有 Claude 档位价目
- 价目单位：每 1M tokens USD（与 pricing.json 一致）

## 工作证明（执行器回填）

- [ ] diff / 测试 / tsc

## 验收结论（指挥回填）

- [x] 已合入
- 备注：
