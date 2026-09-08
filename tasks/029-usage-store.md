# 029 — 使用统计核心（UsageStore：会话/供应商/模型级消耗落盘）

- 状态：已合入（db70f8a，UsageStore 闭环）
- 优先级：P0
- 创建日期：2026-09
- 关联：goal-0b579936；参考 cc-switch 用量统计思路

## 目标

新增持久化使用统计：监听 after_model 事件，把 tokens（input/output/cacheRead）、调用次数、估算成本按 **模型 / 供应商 / 会话** 累计，落盘 `~/.dsh/usage.json`（原子写，复用 ProviderStore 同款 tmp+rename），可跨会话查询。UI 不做。

## 验收标准

- [ ] `UsageStore`（放 apps/cli/src/usage/ 或独立模块）：record(model, provider, {inputTokens, outputTokens, cacheReadTokens, calls}) → 累计；session 维度 + provider 维度 + model 维度
- [ ] 成本累计：用 pricing resolvePrice(model, protocol) 估算（input×价 + output×价 + cache×价），存 per-entry cost
- [ ] 原子写 ~/.dsh/usage.json（VESSEL_USAGE_ROOT env 可隔离测试，兼容注入 rootDir）；首次无文件返回空不报错
- [ ] 接线：compose 的 after_model 或 telemetry 记录后调用 UsageStore.record（在 apps/cli 层接线，不污染 core）
- [ ] 查询 API：total()/byProvider()/byModel()/recent(n)
- [ ] Vitest：累计正确、成本估算、跨"会话"持久（两次 record 后重开 store 读一致）、原子写、env 隔离
- [ ] `npx vitest run` 全绿；tsc exit 0
- [ ] 卡置"待验收"

## 涉及文件

- `apps/cli/src/usage/UsageStore.ts`（新建）+ `usage.test.ts`
- `apps/cli/src/compose.ts`（after_model 接线）或 cli 层
- `docs/V09-PROGRESS.md`（新）

## 依赖

- pricing（configs/pricing.json + resolvePrice，已有）；provider catalog（已有）

## 设计锚点

- 参考 cc-switch 用量统计：按模型/供应商聚合，成本=用量×价目
- 复用 ProviderStore 原子写模式（tmp+rename）
- after_model 事件已带 usage（telemetry.test 证实），接线点清晰
- cost 用 resolvePrice(model, protocol) 逐条估算

## 工作证明（执行器回填）

- [ ] diff / 测试 / tsc

## 验收结论（指挥回填）

- [x] 已合入
- 备注：
