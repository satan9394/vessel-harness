# T320 — usage 记录区分 input token 口径（cache-inclusive / cache-exclusive）

- Status: 已完成（2026-10-26；协调者直接实现；未提交、未推送）
- PDW task: none

> 依据：`docs/MAGPIE-ABSORPTION.md` §3 P1-1。
> 问题：不同协议的 `input_tokens` 定义不同——Anthropic 的 `input_tokens` **不含** cache 读/写，
> OpenAI/Gemini 的 `prompt_tokens` **已含** cache 命中。现在 `usage.json` 只存了一个
> `inputTokens` 数字，跨供应商对比时无法解释为什么同样的「input」成本不同。

## 0. 先读（只读）

1. `packages/shared/src/cacheMetrics.ts` — 唯一的 wire → 指标解析点（`extractProviderCacheMetrics`）。
2. `apps/cli/src/usage/UsageStore.ts` — `UsageEntry` / `UsageRecentEntry` / `record()` / 读盘容错。
3. `apps/cli/src/usage/usage-store.test.ts` — 既有断言风格与临时目录写法。

## 1. 做法（写死）

1. **口径只判一次**：在 `packages/shared/src/cacheMetrics.ts` 新增
   `export type InputTokenSemantics = 'cache-inclusive' | 'cache-exclusive'` 与
   `inputTokenSemanticsOf(rawUsage)`：wire 里出现 `input_tokens` → `cache-exclusive`，
   否则（`prompt_tokens` / `promptTokenCount` / `prompt_cache_hit_tokens`）→ `cache-inclusive`。
2. `CacheUsageMetrics` 增加**可选** `inputTokenSemantics`（可选是为了不破坏既有手工构造的测试夹具），
   由 `extractProviderCacheMetrics` 填入；`priceCacheMetrics` 的 spread 天然保留。
3. `UsageStore`：`UsageEntry` 与 `UsageRecentEntry` 增加可选
   `inputTokenSemantics?: InputTokenSemantics | 'mixed'`。`record()` 合并规则：
   首条照抄；后续相同则保持；不同则 `'mixed'`（不假装唯一）；本轮没带 cacheMetrics 时不改已有值。
   读盘容错沿用 `{...raw}` 透传，旧记录无该字段即「未记录」，不补默认值。
4. **不改** `byProvider()` 行结构（Web API 形状不变）；字段只随 `entries` / `recent`
   出现在 `vessel usage --json` 里，供人排查口径。

## 2. 不许做

- 不根据 `inputTokens` 与 cache 数字**反推**口径（只认 wire 字段，不做启发式猜测）。
- 不改 `billableInputTokens` 的既有计算、不动 `costBreakdown`、不动价目表。
- 不给未来记录补默认值、不重写历史记录（旧记录字段缺失就是缺失）。
- 不 commit / push；不动 `packages/core`。

## 3. 允许修改

```
packages/shared/src/cacheMetrics.ts
packages/shared/src/index.ts                     (导出新类型与函数)
packages/llm/src/discovery/cacheMetrics.test.ts  (补口径断言)
apps/cli/src/usage/UsageStore.ts
apps/cli/src/usage/usage-store.test.ts
```

## 4. 验收（逐条真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run packages/llm/src/discovery/cacheMetrics.test.ts
node node_modules/vitest/vitest.mjs run apps/cli/src/usage
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

## 5. 回报

```
口径解析：<文件 + 判据>
记录合并：<首条 / 相同 / 不同 / 无 cacheMetrics 四种情形>
持久化：<旧记录无字段时怎么显示>
测试：<新增用例数>
检查：<四条命令退出码>
未做：<如实写>
```

## Result

已完成（2026-10-26）。

1. **口径解析**（`packages/shared/src/cacheMetrics.ts`）：新增 `InputTokenSemantics =
   'cache-inclusive' | 'cache-exclusive'` 与 `inputTokenSemanticsOf(rawUsage)`；判据只认 wire
   字段（出现 `input_tokens` → `cache-exclusive`，否则 → `cache-inclusive`），不按 provider 名字猜。
   `CacheUsageMetrics.inputTokenSemantics` 为**可选**字段，`extractProviderCacheMetrics` 负责填，
   `priceCacheMetrics` 的 spread 天然保留。
2. **记录合并**（`apps/cli/src/usage/UsageStore.ts`）：`UsageEntry` 与 `UsageRecentEntry` 增可选
   `inputTokenSemantics`（条目值允许 `'mixed'`）。四种情形都覆盖：首条照抄；相同保持；
   不同记 `'mixed'` 且之后不会「变回唯一」；本轮无 cacheMetrics 时**不改已有值**。
3. **持久化**：读盘用 `{...raw}` 透传，旧记录没有该字段就读回 `undefined`（未记录），不补默认值；
   `billableInputTokens`、`costBreakdown`、价目与 `byProvider()` 行结构一律未动，Web API 形状不变。
4. **CLI 入口自证**：`vessel usage --json` 的 `byModel[]` / `recent[]` 直接来自 `entries` 与 `recent`，
   新字段随之出现。用临时 usage 根造一条 `cache-exclusive` 记录后真跑：
   `byModel[0].inputTokenSemantics = cache-exclusive`、`recent[0].inputTokenSemantics = cache-exclusive`（exit 0）。

测试：`packages/llm/src/discovery/cacheMetrics.test.ts` **14 passed**（新增 1 条覆盖 Anthropic /
OpenAI / DeepSeek / Google 四种 wire 与定价后保留）；`apps/cli/src/usage` **110 passed**
（新增 3 条：记录+无 metric 不改、mixed 且不回退、持久化与旧记录不补值）。
检查：`tsc -b` exit 0、`typecheck:tests` exit 0。

未做：没有把口径做成 `byProvider()` 的聚合列（同一供应商可能 mixed，聚合列会误导）；
没有回填历史记录；`apps/web` 侧暂不展示该字段。

