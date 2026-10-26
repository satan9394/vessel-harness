# T320b — 修复卡 320 的回归：三处 cacheMetrics 夹具缺新字段

- Status: 已完成（2026-10-26；PDW 任务 `20261026153155-a85d70`，implement=codex、review=opencode，`accepted_local`）
- PDW task: none（契约 `.pdw/contracts/320b-cachemetrics-fixtures.json`）

> 病灶：卡 320 给 `CacheUsageMetrics` 加了**可选** `inputTokenSemantics`，并在唯一的解析点
> `extractProviderCacheMetrics` 里填值。三处测试用 `toEqual` / `toContainEqual` 深比较整个
> `cacheMetrics` 对象，多一个键就红。卡 320 当时只跑了 `apps/cli/src/usage` 与
> `packages/llm/src/discovery/cacheMetrics.test.ts`，没跑全量，于是回归漏到 main。

## 1. 失败的三个点（全量批次实证）

1. `packages/llm/src/stream/parseAnthropic.test.ts` —「cache write usage (task 099) >
   maps message_start message.usage.cache_creation_input_tokens …」：期望值的 `cacheMetrics`
   需补 `inputTokenSemantics: 'cache-exclusive'`（Anthropic 报文带 `input_tokens`）。
2. `packages/llm/src/stream/parseOpenAI.test.ts` —「plain text SSE > text_delta >
   maps usage to a usage chunk with cache tokens」：需补 `inputTokenSemantics: 'cache-inclusive'`
   （OpenAI 形态用 `prompt_tokens` / `prompt_cache_hit_tokens`）。
3. `benchmarks/runners/src/lane/opencodeGoChatProvider.test.ts`（约 239 行）—「102 · mock 端到端 …
   usage 归一」：期望的 `cacheMetrics` 需补该字段，取值以**实际解析结果**为准（先看该夹具喂的是
   哪种 wire 形态，再写值；不许为了让测试绿而改生产代码的判据）。

## 2. 做法与边界（写死）

- **只改这三处测试的期望值**，不改 `packages/shared/src/cacheMetrics.ts`、不改解析器、
  不改 `UsageStore`、不改价目。若某处必须改生产代码才能修，停下来报 blocker，不要自行扩大范围。
- 三个期望值必须与被测 wire 形态一致（`input_tokens` → `cache-exclusive`；
  `prompt_tokens`/`prompt_cache_hit_tokens`/`promptTokenCount` → `cache-inclusive`）。
  不确定就先跑该文件看实际 receipt，再落值。
- 顺手检查同一批断言里有没有别的 `cacheMetrics` 深比较也缺字段（同文件内即可），一并补齐。
- 不 commit / push；不动 `packages/core`；不改 `.pdw/`。

## 3. 允许修改

```
packages/llm/src/stream/parseAnthropic.test.ts
packages/llm/src/stream/parseOpenAI.test.ts
benchmarks/runners/src/lane/opencodeGoChatProvider.test.ts
```

## 4. 验收（PDW checks 会真跑，另加整包回归）

```powershell
node node_modules/vitest/vitest.mjs run packages/llm
node node_modules/vitest/vitest.mjs run benchmarks/runners/src/lane
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

要求：`packages/llm` 20 文件 / 336 用例全绿、`benchmarks/runners/src/lane` 全绿、
`tsc` 干净；生产代码 diff 为空（只有测试期望值变化）。

## 5. 回报

```
根因：<一句话>
改动：<三个文件分别补了什么值 + 依据的 wire 形态>
生产代码：<确认零改动 / 或 blocker>
检查：<三条命令的退出码与用例数>
未做：<如实写>
```

## Result

已完成（2026-10-26，PDW 任务 `20261026153155-a85d70`，implement = codex，review = opencode，`accepted_local`）。

- 根因：卡 320 给 `CacheUsageMetrics` 新增可选 `inputTokenSemantics`，三处测试对整个 `cacheMetrics`
  做深比较（`toEqual` / `toContainEqual`），多一个键即红。卡 320 当时只跑了两个局部套件，漏了全量。
- 改动：只在三处期望值里各加一个字段，值按 wire 形态取（不是按 provider 名猜）——
  `parseAnthropic.test.ts` → `'cache-exclusive'`（报文带 `input_tokens`）、
  `parseOpenAI.test.ts` → `'cache-inclusive'`、`benchmarks/runners/src/lane/opencodeGoChatProvider.test.ts`
  → `'cache-inclusive'`。
- 生产代码零改动：`git diff` 对 `packages/shared/src/cacheMetrics.ts`、`packages/llm/src/discovery`、
  `apps/cli/src/usage` 全空；除三个测试文件外本次任务没碰任何文件。
- 检查：PDW 三条 checks 全绿（`packages/llm` 20 文件 336、`benchmarks/runners/src/lane` 5 文件 71、
  `tsc -p tsconfig.test.json --noEmit`）；协调者另跑全量门禁：根 322 文件 / 3484（3478 通过 + 6 跳过）、
  web 58 文件 496、`tsc -b` 与 `typecheck:tests` 均 exit 0。
- 复核角色的额外提醒（已采纳）：加 `inputTokenSemantics: undefined` 也能骗过深比较，所以上面三个值
  必须是字面量；以及「全量 = 根 + apps/web」不能只用 llm/lane 两条代替——这次补跑的就是全量。

