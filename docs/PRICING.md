# 计价与用量成本（PRICING.md）

> 任务卡：085（模型名归一）/ 086（缺价显式化）/ 087（统一计价）/ 089（统计时间维度）/ 090（cache 写入计价）/
> 091（定价变更回填 recompute）/ 092（用户价目覆盖 + 值守卫）/ 093（models.dev 同步）/ 094（provider 成本倍率）。
> 实现单一入口：`packages/shared/src/pricing.ts`（纯函数、零 I/O）。

## 1. 一句话

价格不是猜出来的：**能查到就报来源，查不到就明说是估算**（或 `--strict` 下按 0 记），
且 CLI / application / benchmarks 三条路径共用同一份查价实现，不会各算各的。
用量统计同时给**累计**与**本地日分桶**两个口径（089），成本按
input / output / cacheRead / **cacheWrite** 四项分算（090）；
价目可用 `vessel pricing sync` 从 models.dev 增量更新（093），
中转/代理加价用 provider 级**成本倍率**（094，只乘总额）。

## 2. 单一实现（为什么）

| 层 | 文件 | 角色 |
|---|---|---|
| 规则 | `packages/shared/src/pricing.ts` | 模型名归一 + 回退链 + `estimated` 语义 + 成本倍率（唯一实现） |
| CLI | `apps/cli/src/providers/pricing.ts` | 只负责读 `configs/pricing.json`，re-export 规则 |
| CLI 目录 | `apps/cli/src/providers/modelCatalog.ts` | 读 catalog：**用户态 `~/.vessel/model-catalog.json` 优先 → 包内 `configs/model-catalog.json` 兜底**（Round 20） |
| CLI 同步 | `apps/cli/src/providers/pricingSync.ts` | models.dev 拉取/解析/增量合并/原子写（093） |
| CLI 覆盖 | `apps/cli/src/usage/pricingOverride.ts` | 读/写 `~/.vessel/pricing.override.json` + 值守卫修复（092） |
| CLI 落盘 | `apps/cli/src/usage/UsageStore.ts` | 每条记录落 `estimated` / `pricingSource`；`recompute()` 按当前价目回填（091）；provider 倍率只乘总额（094） |
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
pricing.override.json（用户覆盖，092）  →  pricing.json models[<归一后名>]  →  model-catalog.json
    →  protocols[<protocol>]  →  models.default
```

| `source` | 含义 | `estimated` |
|---|---|---|
| `override` | 命中 `~/.vessel/pricing.override.json` 的覆盖价（092） | false |
| `model` | 命中 `configs/pricing.json` 模型级价 | false |
| `catalog` | 命中 catalog（**用户态 `~/.vessel/model-catalog.json` 优先**，无则包内 `configs/model-catalog.json`；Round 20） | false |
| `protocol` | 只命中协议级通用价（同协议所有未收录模型同价） | **true** |
| `default` | 落到 `models.default` 通用兜底价 | **true** |
| `unpriced` | `--strict` 下未收录、或命中删除墓碑（按 0 计价） | false |
`estimated = true` 的含义：**这个价不是该模型的专属价目**。展示层必须把它标出来
（`vessel usage` 会打印「含估算条目 N 条 / 价格来源分布」）。

**catalog 这一档的内部顺序**（Round 20，`modelCatalog.ts`）：

1. **用户态 catalog** `<usageRoot>/model-catalog.json` = `~/.vessel/model-catalog.json`
   （`VESSEL_USAGE_ROOT` 可覆盖，与 `pricing.override.json` 同根）——有文件就**用它**，
   不再看包内（**用户数据优先**）；文件损坏 → 回落包内 + 一条 warn（不静默当空表）；
   文件是 `{}`（无 `models` 数组）→ 按**用户主动清空**处理，空表生效**不回落**；
2. **包内内置 catalog** `<包>/configs/model-catalog.json`（models.dev 快照，随版本发布）——兜底。

**没有用户态文件时，读取结果与「只有包内」的旧实现逐字相同**（usage 成本不漂移）。
写侧同源：`vessel pricing sync` 的默认落点就是①那个用户态文件（§13）。
`pricing.json` **刻意不加**用户态层：用户定制通道已是最高优先级的 `pricing.override.json`
（有墓碑 + 值守卫），再开一层只会与之语义重叠。

## 5. 持久化字段（UsageStore）

`~/.vessel/usage.json`（`version: 2`）的每个 `provider::model` 条目：

- `estimated: boolean` —— 是否含估算计价
- `estimatedCostUsd: number` —— 其中估算部分的金额
- `pricingSource: 'override'|'model'|'catalog'|'protocol'|'default'|'unpriced'|'mixed'|'legacy'`
  - `override` = 命中用户覆盖文件（092）；`mixed` = 同一模型条目内多次调用来源不同
  - `legacy` = 085 之前写入、未保存来源的旧记录（不臆造来源，展示层单列）
- `cacheCreationTokens: number` —— cache 写入 token（090）
- `costBreakdown: { inputUsd, outputUsd, cacheReadUsd, cacheWriteUsd }` —— 成本分项（090）
- `cacheWriteDerivedCostUsd: number` / `cacheWriteDerived: boolean` —— 其中用了推导写入价的部分（见 §7）
- `recomputedAt?: string` / `recomputedFromLegacy?: boolean` —— `recompute` 实际改价时间与
  「曾是无来源 legacy 条目」的痕迹（091；无变更时不写，保证幂等，见 §11）
- `costMultiplier?: number` / `costMultiplierMixed?: boolean` —— 该条目用的 provider 成本倍率
  （094；缺省 1 时不写字段；历次倍率不一致时省略数值并标 `mixed`，见 §14）

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
    "firstTs": "…ISO…", "lastTs": "…ISO…",
    "models": {                  // 091 起：按模型子分项（改价后日成本可精确重算）
      "anthropic::claude-sonnet-4-5": {
        "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheCreationTokens": 0,
        "costUsd": 0, "calls": 0, "estimatedCostUsd": 0, "cacheWriteDerivedCostUsd": 0
      }
    }
  }
}
```

`models` 是**可选**字段（091 起写入；089~091 之间的旧分桶没有它）。缺它时该日分桶在
`recompute` 中跳过并计入 `dailySkipped`——宁可不动，也不按比例摊出假数字（见 §11）。

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

- `input_token_semantics`（input 是否含 cache）未做，故 cache 写入不从 inputTokens 扣减。
- 本卡不引入汇率/多币种。
- 095（导入导出）/ 096（多端点）与 UI 未做；091/092 见 §11/§12，093/094 见 §13/§14。

## 11. 定价变更回填：`vessel usage recompute`（091）

改价后历史成本不再「钉死」——按**当前**价目重算一遍即可对齐口径。

```powershell
vessel usage recompute                    # 全量重算并落盘
vessel usage recompute --dry-run          # 只看差异摘要，不写盘
vessel usage recompute --since 2026-09-01 --until 2026-09-07   # 只重算窗口内
```

**重算什么**：保留 token 原始值（input/output/cacheRead/cacheWrite 一律不动），
只重算 `costUsd` / `costBreakdown` / `estimated` / `estimatedCostUsd` /
`pricingSource` / `cacheWriteDerived*`。算法就是「用当前价目重新记录同样的 token」：
`costBreakdown(resolvePrice(...).price, 累计 token)`。

| 范围 | 重算方式 | 窗口筛选依据 |
|---|---|---|
| `entries`（累计条目，权威成本口径） | 按累计 token × 当前价 | `lastTs` 的本地日 |
| `daily`（本地日分桶） | 按 `models` 子分项逐模型重算后求和 | 日期键 |
| `recent`（最近明细） | 按单次记录 token × 当前价 | `ts` 的本地日 |

**口径与边界**：

1. **幂等**：同一价目连跑两次，第二次 `changed = 0`、`written = false`，`usage.json`
   逐字节不变（金额比较带 `1e-9` 容差，吸收「逐次累加 vs 累计一次算」的浮点尾差）。
2. **重算 = 重新记录**：测试断言「旧价记录 → recompute」与「新价直接记录」的
   成本/分项/来源一致（`apps/cli/src/usage/recompute.test.ts`）。
3. **来源收敛**：原 `mixed`（同一模型多次调用来源不同）重算后统一为本次命中的来源；
   这正是重算的目的——一条历史条目只该有一个当前价。
4. **legacy 条目**（085 之前无 `pricingSource`）：按当前规则重算，`pricingSource`
   更新为实际来源，并打 `recomputedFromLegacy: true` 留痕（不假装它从来就有来源）。
5. **旧日分桶**（无 `models` 子分项）：跳过并计数 `dailySkipped`，保持原值——
   跨模型总量无法反推模型价，按比例摊是猜数字，不做。
6. `--strict` 口径同样可重算：未收录条目变 `unpriced` + 0 成本，token 仍在（待补价回填）。
7. 非法 `--since/--until` 抛 `RangeError`（CLI 打印错误并 exit 2），与 `vessel usage` 同一校验。

## 12. 用户价目覆盖 + 值守卫（092）

**文件**：`~/.vessel/pricing.override.json`（与内置 `configs/pricing.json` **分离**）

```jsonc
{
  "version": 1,
  "models": {
    "claude-sonnet-4-5":            { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 },
    "deepseek::deepseek-chat":      { "input": 0.1, "output": 0.2 }   // 只对 deepseek 生效
  },
  "deleted": ["gemini-2.0-flash"]   // 删除墓碑：显式删除内置/目录条目
}
```

**为什么分离**（学 cc-switch 的设计思路，实现自写）：该文件只存「用户覆盖 + 删除墓碑」，
内置价目仍由版本维护。于是应用升级能继续修内置价，而不会把内置价固化成覆盖值；
用户覆盖可 diff、可审计、可回滚，也不必 fork 内置文件。

**键格式**：`model` 或 `provider::model`（与 `usage.json` 条目键同格式）。同一模型
两种键都存在时 **`provider::model` 胜**。键同样走 085 的归一（大小写/命名空间/日期/
effort 后缀/点号），所以 `ANTHROPIC/claude-3.5-sonnet-20241022` 也能命中
`claude-sonnet-4-5` 之外的 `claude-3-5-sonnet` 覆盖。

**优先级链**：`override` > 内置 `pricing.json` > `model-catalog.json` > `protocols` > `default`。
覆盖命中即终结（不再看后面任何一层）；`--strict` 下覆盖仍然生效（覆盖是用户对该模型的
专属价，strict 只禁 protocol 通用价与 default 兜底价）。

层序**不变**，变的是 `model-catalog.json` 这一档**从哪儿取**（Round 20）：
**用户态 `~/.vessel/model-catalog.json`（`VESSEL_USAGE_ROOT` 可覆盖）优先于包内内置
`configs/model-catalog.json`**；两者都没有（或用户态损坏）才落到空目录 → `protocols` / `default`。
`vessel pricing sync` 的**默认落点**就是这个用户态文件（`--catalog <path>` 仍按用户指定写该处），
于是「写进去 = 下一次读得到」；写目标不是用户态目录时 CLI 会 warn（写进去只会是回落层）。
`pricing.json` 不加用户态层——用户的定制通道就是上面这条链最高优先的 `pricing.override.json`。

**删除墓碑**：命中即 `source='unpriced'` + `deletedByOverride`，按 0 计价且**不回退**
目录/协议/兜底（否则「删了还在算钱」）。墓碑只做**归一后精确匹配**——删 `gpt-4o`
不会连坐 `gpt-4o-mini`。`vessel pricing override restore <key>` 可撤销。

**CLI**：

```powershell
vessel pricing override list                  # 当前覆盖 + 墓碑 + 优先级链
vessel pricing override set deepseek-chat --input 0.1 --output 0.2 [--cache-read 0.01] [--cache-write 0]
vessel pricing override set deepseek::deepseek-chat --input 0.1 --output 0.2   # provider 作用域
vessel pricing override delete gemini-2.0-flash    # 删除墓碑
vessel pricing override restore gemini-2.0-flash   # 撤销墓碑
vessel pricing override repair --file repairs.json # 值守卫式修复
vessel pricing claude-sonnet-4-5                   # 查询时同时显示覆盖/墓碑
```

**值守卫式修复**（`repair`）：输入一组「旧值 → 新值」对，**仅当覆盖现值等于旧值**才改成
新值：

| 情况 | 结果 |
|---|---|
| 现值 = `from` | `applied`（改成 `to`） |
| 现值 ≠ `from`（用户手改过） | `skipped-user-modified`（绝不冲掉手改） |
| 键不存在 | `skipped-absent`（修复不新建条目） |

```jsonc
// repairs.json（也接受 { "repairs": [...] }）
[
  { "key": "claude-sonnet-4-5",
    "from": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 },
    "to":   { "input": 3.5, "output": 17.5, "cacheRead": 0.35, "cacheWrite": 4.375 } }
]
```

无一条生效时不写文件（幂等）。读盘容错：文件缺失 / JSON 损坏 / 非法行（缺字段、非数字、
负价）→ 按空覆盖处理，不抛错也不猜价。

**内置更新不冲用户覆盖**：内置 `configs/pricing.json` 换新价后，覆盖文件内容不变，
解析结果仍用覆盖价（测试 `092 — 覆盖接入 UsageStore` 断言）。

**与 recompute 的关系**：覆盖改了价之后，`vessel usage recompute` 会把历史条目
按覆盖价重算（`source='override'`），两边口径自动对齐。

### 10.1 cache_creation 端到端采集（099 已打通）

链路：`AnthropicProvider`（`cache_creation_input_tokens`，非流式 + 流式 message_start）
→ `ChatUsage.cacheCreationTokens?` / `StreamChunk` usage（`packages/shared/src/provider.ts`）
→ `AgentLoop` 流式 usage 逐字段 last-wins 折叠 + `after_model`
→ `UsageStore.record` / `UsageProjection` 分项计价（089/090 已就绪，未改）。

- 非流式：`data.usage.cache_creation_input_tokens` → `usage.cacheCreationTokens`。
- 流式：Anthropic 只在 `message_start` 上报写入 token；`message_delta` 只带 `output_tokens`，
  故该帧 `cacheCreationTokens` 为 `undefined`，折叠时**不覆盖**前一帧的值（per-field last-wins）。
- OpenAI-compatible 系无此概念 → 字段缺省 `undefined`（**不写 0 假值**），
  下游按「未上报」处理：`cacheWriteUsd` 为 0、不产生推导写入价。
- MockProvider 可注入 `usage`（`MockProviderOptions.usage`），用于离线断言整条链路。

## 13. models.dev 价目同步：`vessel pricing sync`（093）

```powershell
vessel pricing sync                                  # 拉 models.dev → 更新 ~/.vessel/model-catalog.json（默认落点）
vessel pricing sync --dry-run                        # 只打印差异，不写盘
vessel pricing sync --provider anthropic             # 只同步某供应商（逗号分隔可多个）
vessel pricing sync --exclude 'openai/*,*embedding*' # 排除 glob（逗号分隔可多个）
vessel pricing sync --catalog D:\tmp\catalog.json    # 换目标文件（按用户意图写该处）
vessel pricing sync --url http://127.0.0.1:8080/api.json --timeout 5000   # 自建镜像/测试
```

**默认落点 = 用户状态根**（Round 20）：`<VESSEL_USAGE_ROOT>/model-catalog.json`，缺省
`~/.vessel/model-catalog.json`——与读取的最高优先级层同源（§4「catalog 这一档的内部顺序」），
也就在用户项目目录里**不再**凭空创建 `configs/`。`--catalog <path>` 语义不变（写用户指定处），
但写目标不是用户态目录时会在写盘前 warn：那份同步结果最多只是**回落层**
（用户态已有 catalog 时读不到），补救是 `--catalog "~/.vessel/model-catalog.json"` 或
`vessel pricing override set <model> --input … --output …`（覆盖优先级最高）。默认路径下两者相同 → 零噪音。

**三通道（学 cc-switch 的设计思路，实现自写）**：

| 通道 | 载体 | 谁维护 |
|---|---|---|
| 1. seed | `configs/pricing.json` | 版本（发版/手工） |
| 2. 值守卫修复 | `~/.vessel/pricing.override.json` 的 `repair`（§12） | 用户 / 版本给补丁（只改「现值 = 旧值」的行） |
| 3. models.dev 同步 | `~/.vessel/model-catalog.json`（默认；`--catalog` 可换） | 本命令（增量 upsert） |

**同步做什么**：拉 `https://models.dev/api.json`（默认 15s 超时、失败**重试 1 次**），
按 `provider → model` 增量 upsert 目录条目：

| 远端字段 | 目录字段 |
|---|---|
| `cost.input` / `cost.output` | `priceIn` / `priceOut` |
| `cost.cache_read` / `cost.cache_write` | `priceCache` / `priceCacheWrite` |
| `limit.context` / `limit.output` | `contextWindow` / `outputLimit` |

过滤：非文本输出（embedding/语音/图像，`modalities.output` 不含 `text`）、已弃用（`deprecated`）、
缺价（没有 input 或 output）、被 `--provider`/`--exclude` 排除的条目一律不收录，且**逐类计数打印**（不静默丢）。

**语义边界（与 cc-switch 刻意不同）**：

1. **离线/失败保留旧表**：拉取超时、连接失败、HTTP 5xx、响应非法 JSON、解析后 0 条可用模型，
   一律 `status=offline`：**不写盘、不清空**，打印 `⚠ 拉取/解析失败（已重试至多 1 次）：<原因>`
   + `未改动 <path>（保留旧表 N 条）`，并以 **exit 1** 收尾（同步没发生就要能被脚本看出来）。
2. **不覆盖用户覆盖**：同步只写 catalog，`~/.vessel/pricing.override.json` 一个字节都不动；
   优先级链 `override > 内置 pricing.json > catalog > protocols > default` 不变（§4）。
   cc-switch 的批量同步会静默覆盖同名手动价——这里刻意避开。
3. **不删条目**：远端未覆盖的既有条目**原样保留**（打印「保留 N 条」）。删价是显式操作
   （`pricing override delete` 墓碑，§12），同步不制造空洞。
4. **幂等**：远端数据与既有目录一致 → `status=unchanged`、**不写盘**（文件逐字节不变，
   连 `lastSyncAt` 都不动）。差异比较忽略 `null` 与「字段缺失」的区别。
5. **原子写**：`tmp + rename`（task 113 起统一走 `@vessel/shared` 的 `renameWithRetry`；Windows 上 EPERM/EBUSY/EACCES 有界重试 3 次、5/15ms 退避，仍失败则抛最后一次错误）。
6. `--dry-run` 只打印差异（新增/更新/未变/保留四类计数 + 前 10 条明细），不写盘。

`lastSyncAt` 记录最后一次成功写盘的 ISO 时间；`source` 字段写明来源 URL 与单位说明
（时间戳单独放 `lastSyncAt`，所以「只有时间变」不会触发写盘）。

## 14. provider 成本倍率（094）

用于中转/代理加价：`ProviderConfig.costMultiplier`（`~/.vessel/providers.json`，缺省 1）。

```powershell
vessel provider add proxy --protocol openai-compatible --base-url https://proxy.example/v1 --model gpt-5.1 --cost-multiplier 1.5
vessel provider set proxy --cost-multiplier 2        # 改倍率（不传该参数则保持原值）
vessel provider set proxy --cost-multiplier 1        # 回到缺省
vessel provider list                                 # 显示 ×2 标记
vessel usage                                         # 总额 + 分项合计 + 倍率说明
```

**计算点（唯一实现 `costBreakdown`）**：

```
分项：inputUsd = inputTokens × price.input / 1e6      （cacheRead/cacheWrite 同理）
rawTotalUsd = inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd
totalUsd    = rawTotalUsd × costMultiplier            ← 倍率只乘总额
```

- **只乘总额**：四项分项单价与分项金额**一律不变**；因此「分项之和 ≠ 总额」是**预期**的，
  差额就是倍率（`CostBreakdown.rawTotalUsd` / `costMultiplier` 显式给出这层关系）。
- **倍率乘在最终价之上**：先走 §4 的回退链（override > 内置 > catalog > protocol > default）
  拿到单价，再对总额乘倍率。所以与 `override`/`catalog` 天然共存，`pricingSource` 不受影响。
- **fail loud**：倍率 < 0、NaN、Infinity、非数字一律 `RangeError`
  （`ProviderStore.add/save/update` 校验 + `costBreakdown` 再校验），不静默按 1 处理——
  倍率直接乘在钱上，静默回退会让人以为加价生效了。倍率 **0 合法**（免计费）。
- **落盘留痕**：条目写 `costMultiplier`（缺省 1 不写）；同一 provider 中途改倍率导致历次不一致时，
  省略数值并标 `costMultiplierMixed: true`（不假装有唯一倍率）。
  `vessel usage recompute` 按**当前**倍率重算历史，重算后倍率收敛为唯一值、`mixed` 痕迹清除。
- **展示**：`vessel usage` 在含倍率时打印
  `成本倍率: N 条条目含 provider 倍率——总额 = 分项合计 × 倍率；分项合计 $X（分项单价未变）`；
  「按供应商」行打印 `$总额（分项合计 $Y × 倍率 m）`；不一致时打印 `（倍率不一致，分项合计 $Y）`。
- 覆盖/目录价源与倍率互不干扰：`vessel pricing override list` 与 `vessel pricing <model>`
  显示的仍是**单价**（倍率只在计费总额上生效）。
