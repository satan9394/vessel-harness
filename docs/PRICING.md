# 计价与用量成本（PRICING.md）

> 任务卡：085（模型名归一）/ 086（缺价显式化）/ 087（统一计价）/ 089（统计时间维度）/ 090（cache 写入计价）。
> 实现单一入口：`packages/shared/src/pricing.ts`（纯函数、零 I/O）。

## 1. 一句话

价格不是猜出来的：**能查到就报来源，查不到就明说是估算**（或 `--strict` 下按 0 记），
且 CLI / application / benchmarks 三条路径共用同一份查价实现，不会各算各的。
用量统计同时给**累计**与**本地日分桶**两个口径（089），成本按
input / output / cacheRead / **cacheWrite** 四项分算（090）。

## 2. 单一实现（为什么）

| 层 | 文件 | 角色 |
|---|---|---|
| 规则 | `packages/shared/src/pricing.ts` | 模型名归一 + 回退链 + `estimated` 语义（唯一实现） |
| CLI | `apps/cli/src/providers/pricing.ts` | 只负责读 `configs/pricing.json`，re-export 规则 |
| CLI 落盘 | `apps/cli/src/usage/UsageStore.ts` | 每条记录落 `estimated` / `pricingSource` |
| application | `packages/application/src/projections/UsageProjection.ts` | 复用同一 `resolvePrice`（不再有硬编码默认价） |
| benchmarks | `benchmarks/runners/src/adapters/pricing.ts` | 6 个 adapter 共用（原先各自抄了一份） |

改价 / 改归一规则只改一处，三条路径不会漂移。

## 3. 模型名归一规则（candidates）

输入任意真实模型名，按「变换次数最少优先」生成候选队列，**先精确匹配、再家族前缀匹配**：

| 规则 | 例子 |
|---|---|
| 大小写不敏感 | `CLAUDE-OPUS-4-5` → `claude-opus-4-5` |
| 去命名空间前缀（可多级） | `openrouter/anthropic/claude-3.5-sonnet` → `claude-3.5-sonnet` |
| Claude 点号→横线 | `claude-3.5-sonnet` → `claude-3-5-sonnet` |
| 去日期后缀 | `claude-3-5-sonnet-20241022` / `-2025-08-07` / `@20241022` → `claude-3-5-sonnet` |
| 去 reasoning effort 后缀 | `gpt-5.1-codex-high` → `gpt-5.1-codex` |
| 家族前缀（兜底） | `gpt-5.1-codex` → `gpt-5.1`（`-`/`.`/`_`/`@`/`:` 边界才算） |

多条规则可叠加（如 `openrouter/anthropic/claude-3.5-sonnet-20241022` → `claude-3-5-sonnet`）。
effort 后缀集合：`high` / `medium` / `low` / `minimal` / `none` / `thinking` / `non-thinking` / `reasoning` / `instant` / `xhigh`。

注意：**先精确后前缀**，所以 `gpt-4o-mini-2024-07-18` 落 `gpt-4o-mini` 而不是 `gpt-4o`；
目录里同名多厂商（如 `gpt-4o-mini` 只在 catalog、`gpt-4o` 在 pricing.json）时，
精确命中（catalog 的 `gpt-4o-mini`）优先于另一张表的家族前缀（model 表的 `gpt-4o`）。

匹配分两阶段，**任何精确命中都优先于任何家族前缀命中**：

1. 精确：`pricing.json` model 表 → catalog（model 表赢）
2. 家族前缀：model 表 / catalog 中取「命中键最长」者

（该顺序是 085 实现中实测修出来的：早先版本让 model 表的前缀 `gpt-4o` 抢走了
`gpt-4o-mini-2024-07-18`，价格高 16 倍——见 `packages/shared/src/pricing.test.ts`
的「匹配顺序」用例。）

## 4. 回退链与价格来源

```
pricing.json models[<归一后名>]  →  model-catalog.json  →  protocols[<protocol>]  →  models.default
```

| `source` | 含义 | `estimated` |
|---|---|---|
| `model` | 命中 `configs/pricing.json` 模型级价 | false |
| `catalog` | 命中 `configs/model-catalog.json`（models.dev 快照） | false |
| `protocol` | 只命中协议级通用价（同协议所有未收录模型同价） | **true** |
| `default` | 落到 `models.default` 通用兜底价 | **true** |
| `unpriced` | `--strict` 下未收录（按 0 计价） | false |
`estimated = true` 的含义：**这个价不是该模型的专属价目**。展示层必须把它标出来
（`vessel usage` 会打印「含估算条目 N 条 / 价格来源分布」）。

## 5. 持久化字段（UsageStore）

`~/.vessel/usage.json`（`version: 2`）的每个 `provider::model` 条目：

- `estimated: boolean` —— 是否含估算计价
- `estimatedCostUsd: number` —— 其中估算部分的金额
- `pricingSource: 'model'|'catalog'|'protocol'|'default'|'unpriced'|'mixed'|'legacy'`
  - `mixed` = 同一模型条目内多次调用来源不同
  - `legacy` = 085 之前写入、未保存来源的旧记录（不臆造来源，展示层单列）
- `cacheCreationTokens: number` —— cache 写入 token（090）
- `costBreakdown: { inputUsd, outputUsd, cacheReadUsd, cacheWriteUsd }` —— 成本分项（090）
- `cacheWriteDerivedCostUsd: number` / `cacheWriteDerived: boolean` —— 其中用了推导写入价的部分（见 §7）

`recent[]` 每条同样带 `estimated` / `pricingSource` / `cacheCreationTokens`。
`daily` 见 §6。

## 6. 时间维度：本地日分桶（089）

`usage.json` 的 `daily: Record<'YYYY-MM-DD', UsageDailyBucket>`，与 `entries` 的**累计总量并存**
（累计不因分桶而消失；分桶也不回填历史）。

```jsonc
"daily": {
  "2026-09-07": {            // 键 = 本地日（本机时区，不是 UTC）
    "inputTokens": 0, "outputTokens": 0,
    "cacheReadTokens": 0, "cacheCreationTokens": 0,
    "costUsd": 0, "calls": 0,
    "estimatedCostUsd": 0,       // 当日估算部分
    "cacheWriteDerivedCostUsd": 0, // 当日用推导写入价的部分
    "firstTs": "…ISO…", "lastTs": "…ISO…"
  }
}
```

**口径（学 cc-switch `usage_daily_rollups` 的思路，实现自写）**：

1. **本地日**：按 `Date` 的本地 `getFullYear/getMonth/getDate` 归档，跨时区/跨夏令时不会漂到 UTC 日。
2. **只把「完整本地日」计入完整日合计**：`complete = date < 今天(本地)`；今天与未来日都不完整，
   `dailySummary()` 把它们放进 `partial`，**不混进 `complete` 的合计**（避免半天数据被当成一整天）。
3. **不伪造历史分桶**：读入的旧文件（`version: 1`、无 `daily` 字段）→ 历史只保留 `entries` 的累计，
   `daily` 从空开始，只记录读入之后的新事件；`migratedFromLegacy()` 为 true，CLI 会打印提示。
   分桶键非法（非 `YYYY-MM-DD`）的行在读入时丢弃。

**CLI**：

```powershell
vessel usage                                  # 累计 + 成本分项 + 今日/本月（有分桶数据时）
vessel usage --by-day                         # 按本地日列出全部分桶
vessel usage --since 2026-09-01 --until 2026-09-07 --by-day   # 窗口（含首含尾）
```

窗口汇总打印两组：`完整本地日合计`（参与统计）与 `未完整本地日（今天/未来，不计入上面合计）`。
`--since/--until` 只接受 `YYYY-MM-DD`（含真实日期校验），非法值打印错误并 exit 2。
默认行为（不带窗口参数）与 089 之前一致，只多打成本分项与今日/本月两行。

## 7. cache 写入计价与缺字段回退（090）

`TokenPrice.cacheWrite`（每 1M tokens）——Anthropic 的 `cache_creation_input_tokens` 单价，
通常比 cache read 贵一个量级（Sonnet 4.5：read $0.30 / write $3.75）。

**四项分算**：`costBreakdown(price, tokens)` 返回 `{inputUsd, outputUsd, cacheReadUsd, cacheWriteUsd, totalUsd}`
（`costOf` 即 `totalUsd` 的别名）。`cacheCreationTokens` **不从 inputTokens 扣减**——上报侧的
`input_token_semantics` 归一尚未落地，先只做「独立成项」，等有语义字段再谈扣减。

**缺字段回退（`resolveCacheWritePrice`）**：

| 情况 | 单价 | `cacheWritePriceSource` |
|---|---|---|
| 价目行显式写了 `cacheWrite` | 显式值（写 `0` = 该家不单独收写入费） | `explicit` |
| 没写，但行内有 `cacheRead`（说明支持 cache 语义） | `input × 1.25` | `derived` |
| 连 cache 语义都没有 | `0` | `absent` |

- 为什么是 `input × 1.25` 而不是 `cacheRead × 倍率`：写入价与基础 input 价挂钩
  （Anthropic 5m TTL 即 1.25×），而 read 价各家折扣差异极大（0.1× ~ 0.5× input），
  拿它推导会让写入价随折扣乱跳。
- 回退**只对确实上报了 cache 写入 token 的调用生效**（实践中即 Anthropic 系缓存），
  不会给不写缓存的供应商凭空加钱。
- 推导价在条目/分桶上留痕（`cacheWriteDerived` / `cacheWriteDerivedCostUsd`），
  `vessel usage` 会提示「cache 写入分项含推导价 $X」。`--strict` 未收录模型的零价
  （`ZERO_TOKEN_PRICE`）显式带 `cacheWrite: 0`，不参与推导。

`configs/pricing.json` 与 `configs/model-catalog.json`（`priceCacheWrite`）已补该字段：
Anthropic 系为真实价，OpenAI/DeepSeek 系写 `0`（不单独收写入费）。

## 8. `--strict` 模式（选型）

**语义**：只用**模型专属价目**（`model` / `catalog`）。`protocol` 级通用价与 `default`
兜底价都属于「不是这个模型的价」，strict 下一并禁用 → 未收录模型 `source='unpriced'`、成本按 0 记。

> 为什么连 `protocol` 一起禁：`configs/pricing.json` 的 `protocols.openai-compatible` 几乎
> 对所有 provider 都会命中，若 strict 只禁 `default`，strict 实际上永远空转（永远拿不到 `unpriced`）。

**为什么是「标 0」而不是「拒绝记录」**：拒绝记录会丢掉 token 计数（统计口径出现空洞），
而「标 0 + 保留模型名与 token」既不会制造假成本，又保留日后补价回填的能力
（与 cc-switch 保留 `pricing_model` 待回填的思路一致；回填卡是后续 091）。

**用法**：

```powershell
vessel run --strict              # 本次会话按 strict 口径落盘（未收录按 0 记）
vessel usage                     # 看价格来源分布 + 估算条目数
vessel usage --strict            # 按 strict 口径重算历史（只审计，不写盘）
```

`vessel usage --strict` 会打印：strict 口径成本、与当前成本的差额、以及「未收录条目 N 条
（当前记了 $X，属猜测成本）」。

## 9. 两条路径同价（回归断言）

`apps/cli/src/usage/pricing-parity.test.ts` 对同一模型、同一 token、同一价目表断言
`UsageProjection.costUsd === UsageStore.record().costUsd`（model / catalog / protocol /
default / strict 五种来源各一例 + 真实 `configs/` 价目一例）。
两条路径现在都走 `costBreakdown`（090 起），分项也同源。

## 10. 不做的（后续卡）

- 091 定价变更回填（`vessel usage recompute`）、092 用户价目覆盖 + 值守卫。
- `cache_creation` 的**端到端采集**（AnthropicProvider 解析 `cache_creation_input_tokens` →
  core `ChatUsage` → after_model → `UsageStore.record`）尚未接通：本卡范围内不改 core，
  `UsageStore.record` / `UsageProjection` / `compose` 的入口已就绪（`cacheCreationTokens?`），
  上游一旦上报即自动分项计价。另：`input_token_semantics`（input 是否含 cache）未做，
  故 cache 写入不从 inputTokens 扣减。
- 本卡不引入汇率/多币种、不引入成本倍率（094 候选）。
