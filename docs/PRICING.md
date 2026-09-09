# 计价与用量成本（PRICING.md）

> 任务卡：085（模型名归一）/ 086（缺价显式化）/ 087（统一计价）。
> 实现单一入口：`packages/shared/src/pricing.ts`（纯函数、零 I/O）。

## 1. 一句话

价格不是猜出来的：**能查到就报来源，查不到就明说是估算**（或 `--strict` 下按 0 记），
且 CLI / application / benchmarks 三条路径共用同一份查价实现，不会各算各的。

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

`~/.vessel/usage.json` 的每个 `provider::model` 条目新增：

- `estimated: boolean` —— 是否含估算计价
- `estimatedCostUsd: number` —— 其中估算部分的金额
- `pricingSource: 'model'|'catalog'|'protocol'|'default'|'unpriced'|'mixed'|'legacy'`
  - `mixed` = 同一模型条目内多次调用来源不同
  - `legacy` = 085 之前写入、未保存来源的旧记录（不臆造来源，展示层单列）

`recent[]` 每条同样带 `estimated` / `pricingSource`。

## 6. `--strict` 模式（选型）

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

## 7. 两条路径同价（回归断言）

`apps/cli/src/usage/pricing-parity.test.ts` 对同一模型、同一 token、同一价目表断言
`UsageProjection.costUsd === UsageStore.record().costUsd`（model / catalog / protocol /
default / strict 五种来源各一例 + 真实 `configs/` 价目一例）。

## 8. 不做的（后续卡）

- 089 统计时间维度、090 `cache_creation` 计价、091 定价变更回填、092 用户价目覆盖 + 值守卫。
- 本卡不引入汇率/多币种、不引入成本倍率（094 候选）。
