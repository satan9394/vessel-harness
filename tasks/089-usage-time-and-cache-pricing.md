# 089 — 统计增强（时间维度 + cache_creation 计价）

- 编号：089（合并 CC-SWITCH-MODULE-STUDY 候选卡 089/090，同属 UsageStore/计价层）
- 状态：已合入
- 优先级：P1（能力补齐：答得出"本月花了多少"、cache 写入不再低估）
- 创建日期：2026-09-08
- 关联：docs/ideas/CC-SWITCH-MODULE-STUDY.md §2 统计模块/§3 计价模块/§6 P1；085（计价正确性，已合入）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 问题（来自 cc-switch 对比报告）

1. **089 统计无时间维度**：`UsageStore` 只有累计总量（inputTokens/outputTokens/cost 累计），**答不出"今天/本月花了
   多少"**、无趋势、无时间窗口查询。cc-switch 有明细表 + 日汇总表（`usage_daily_rollups`，只纳入完整本地日）。
2. **090 缺 cache_creation 计价**：`TokenPrice` 只有 input/output/cacheRead；Anthropic 的 **cache write
   （cache_creation）单价通常比 cache read 贵一个量级**，当前未计价 → 成本被低估。

## 验收标准（执行器逐条勾选）

### 089 时间维度
- [x] `UsageStore` 增按日分桶（如 `daily: Record<'YYYY-MM-DD', {inputTokens, outputTokens, cacheReadTokens?,
      cacheCreationTokens?, costUsd, calls}>`），与累计总量并存；**本地日**口径（与 cc-switch 一致，只纳入完整本地日）
- [x] `vessel usage` 支持 `--since <date>` / `--until <date>` / `--by-day`（按日列出）；默认行为保持兼容
- [x] 原子写语义保持（沿用既有 tmp+rename/DPAPI 无关的持久化方式）；旧 usage 文件迁移（无 daily 字段 → 视为
      legacy 累计，不伪造历史分桶；迁移策略记录）
- [x] 测试：跨日聚合正确、日边界（本地时区）、窗口过滤、旧文件兼容、原子写

### 090 cache_creation 计价
- [x] `TokenPrice` 增 `cacheWrite?`（per-1M）；`UsageStore.record` 接收 `cacheCreationTokens?`
- [x] `configs/pricing.json` 与 `configs/model-catalog.json` 补 `cacheWrite` 字段（Anthropic 系必填；OpenAI 系可缺）；
      缺字段时回退策略明确（如 `cacheRead × 倍率` 或标注 `estimated`——按 085 的 source/estimated 语义）
- [x] 成本分项计算含 cache write；`vessel usage` 展示分项（input/output/cacheRead/cacheWrite）
- [x] 测试：带 cache 写入的会话成本不再低估（断言分项）；缺字段回退行为

### 共同
- [x] `npx tsc -b tsconfig.json` exit 0；全量 vitest（root 957+ 无回归）+ web 74（若涉）
- [x] 文档同步（usage 统计口径/时间窗口/cache 计价；参考 docs/PRICING.md）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 089+090。091（定价回填 recompute）、092（用户价目覆盖）后续卡；P2 四张更后。
- 不重写 UsageStore 架构（在其上补维度）；不改 core；不引入新依赖；不读用户本机应用数据。

## 涉及文件（指针，执行器自行精化）

- `apps/cli/src/usage/UsageStore.ts` + `usage-store.test.ts` + `vessel usage` 命令（apps/cli/src/cli.ts）
- `packages/shared/src/pricing.ts`（085 的 TokenPrice/resolvePrice——补 cacheWrite）
- `configs/pricing.json`、`configs/model-catalog.json`
- `packages/application/src/projections/UsageProjection.ts`（若需同步分项）
- 参考报告 §2/§3

## 方法

- 先读 UsageStore 现有结构与 085 的 pricing 实现 → 设计 daily 分桶与 cacheWrite 字段 → 实施 + 迁移 →
  CLI 查询参数 → 测试

## 工作证明（执行器回填：改了什么/daily 结构/迁移策略/cacheWrite 回退/测试输出/diff，全部写进本文件，勿留对话里）

执行器：DSH 隔离子代理（2026-09-08）。提交：`feat(usage): 089 local-day buckets + 090 cache_creation pricing`。

### 1. 改动文件（`git diff --stat`，17 文件 / +1210 −95）

| 文件 | 改了什么 |
|---|---|
| `packages/shared/src/pricing.ts` | `TokenPrice.cacheWrite?`；`CACHE_WRITE_INPUT_MULTIPLIER=1.25`；`resolveCacheWritePrice()`；`CostBreakdown` + `costBreakdown()`（四项分算）；`costOf()` 改为 `costBreakdown().totalUsd`；`ZERO_TOKEN_PRICE` 显式 `cacheWrite:0` |
| `packages/shared/src/pricing.test.ts` | +7 用例：四项分算 / 不低估 / 缺字段推导 / 显式 0 不推导 / 无 cache 语义 absent / 向后兼容 / ZERO 不推导；两处 `toEqual` 改 `ZERO_TOKEN_PRICE` |
| `apps/cli/src/providers/pricing.ts` | re-export 新符号（`costBreakdown` / `resolveCacheWritePrice` / 常量 / 类型），仍只负责读盘 |
| `apps/cli/src/providers/modelCatalog.ts` | `CatalogModel.priceCacheWrite?` + 目录价源映射 |
| `apps/cli/src/providers/pricing.test.ts` | 断言改用 `ZERO_TOKEN_PRICE` |
| `apps/cli/src/usage/UsageStore.ts` | daily 分桶 + 窗口查询 + 迁移 + cache 写入分项 + 原子写有界重试（核心改动） |
| `apps/cli/src/usage/usage-store.test.ts` | +11 用例（089/090 两组，见 §4） |
| `apps/cli/src/usage/pricing-parity.test.ts` | +2 用例：cache 写入（显式/推导）两条路径同价 |
| `apps/cli/src/cli.ts` | `vessel usage --since/--until/--by-day` + 成本分项 + 今日/本月 + 推导价提示；`vessel pricing` 显示 cache 写单价；help 同步 |
| `apps/cli/src/cli.test.ts` | +4 用例：按日窗口 / 成本分项 / 非法日期 exit 2 / 旧文件提示 |
| `configs/pricing.json` | 版本 0.3；Anthropic 系 `cacheWrite`（sonnet 3.75 / haiku 1.0 / protocol 3.75）；OpenAI·DeepSeek·mock 显式 0 |
| `configs/model-catalog.json` | `priceCacheWrite`（opus 6.25 / haiku 1.25 / sonnet 3.75）+ source 说明 |
| `packages/application/src/projections/UsageProjection.ts` | 用 `costBreakdown` 取代内联公式；累计 `cacheCreationTokens`；`usage()` 返回分项 |
| `packages/application/src/projections/types.ts` | `UsageRecord` 增 `cacheCreationTokens` / `costBreakdown`（re-export `CostBreakdown`） |
| `packages/application/src/compose.ts` | `UsageStoreLike.record` 增可选 `cacheCreationTokens` 并透传（090 落库入口就位） |
| `docs/PRICING.md` | 新增 §6 时间维度 / §7 cache 写入计价与回退；§5 持久化字段更新；§10「不做的」收敛到 091/092 |
| `docs/PROVIDER-MANAGEMENT.md` | §9 命令说明同步（新 flag / 分项 / version 2 / 分桶） |

### 2. daily 结构与迁移策略

```jsonc
// ~/.vessel/usage.json  version: 2
"daily": {
  "2026-09-07": {                       // 键 = 本地日（本机时区 getFullYear/getMonth/getDate，不是 UTC）
    "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheCreationTokens": 0,
    "costUsd": 0, "calls": 0,
    "estimatedCostUsd": 0,              // 当日估算部分（protocol/default 兜底）
    "cacheWriteDerivedCostUsd": 0,      // 当日 cache 写入用推导价的部分
    "firstTs": "…ISO…", "lastTs": "…ISO…"
  }
}
```

- **与累计并存**：`entries`（provider::model 累计）不动，`daily` 是叠加维度；两者各写各的，互不推导。
- **本地日**：`localDateKey(Date)` 用本地年月日；测试用本地构造的 `Date` 断言（并在非 UTC 机器上断言与 ISO 日不同）。
- **完整本地日**：`complete = date < 今天(本地)`。`daily({since,until,completeOnly})` 支持过滤；`dailySummary()` 把
  完整日与未完整日（今天/未来）**分开合计**，半天数据不混进完整日合计（对齐 cc-switch rollup 口径）。
- **迁移策略（不伪造历史）**：读入无 `daily` 字段的旧文件（version 1）→ `daily = {}`，历史只保留 `entries` 累计，
  `migratedFromLegacy()` 为 true（CLI 打印「无本地日分桶…」）；分桶只记录读入之后的新事件，绝不回填、不摊派。
  旧条目缺 `cacheCreationTokens`/`costBreakdown` → 补 0，`totals().entriesWithoutBreakdown` 计数并在 CLI 提示
  「历史条目 N 条无成本分项（金额仍计入总额）」。
- **原子写**：仍是 tmp + `renameSync`。Windows 杀软/索引器偶发锁文件导致 rename `EPERM/EBUSY`（本次全量并发跑
  实测命中一次）→ 加了**有界重试**（3 次，5/15ms 退避；其他 errno 立即抛）。语义不变：要么完整旧文件、要么完整新文件。

### 3. cacheWrite 回退策略

`resolveCacheWritePrice(price)`：

| 情况 | 单价 | 来源标记 |
|---|---|---|
| 价目行显式写了 `cacheWrite`（含显式 `0` = 该家不单独收写入费） | 显式值 | `explicit` |
| 没写，但行内有 `cacheRead`（说明支持 cache 语义） | `input × 1.25` | `derived` |
| 连 cache 语义都没有（无 `cacheRead`） | `0` | `absent` |

- 为什么是 `input × 1.25` 而非 `cacheRead × 倍率`：写入价与基础 input 价挂钩（Anthropic 5m TTL 即 1.25×），
  read 价各家折扣差异极大（0.1×~0.5× input），拿它推导会让写入价随折扣乱跳。
- 回退**只在确实上报了 cache 写入 token 时生效**（实践中即 Anthropic 系缓存），不会给不写缓存的供应商凭空加钱。
- 留痕：条目 `cacheWriteDerived` / `cacheWriteDerivedCostUsd`、分桶 `cacheWriteDerivedCostUsd`、`record()` 返回
  `cacheWritePriceSource`；`vessel usage` 打印「⚠ cache 写入分项含推导价 $X」。
- `ZERO_TOKEN_PRICE`（strict 未收录）显式 `cacheWrite: 0`，不参与推导；`DEFAULT_TOKEN_PRICE` 故意不写（保持可审计的 derived）。
- `estimated` 语义不混用：`estimated` 仍只表示「价格行不是该模型的专属价目」；cache 写入推导是**分项级**估算，单独标记。

### 4. 测试与命令输出

新增 24 个用例（shared 7 + UsageStore 11 + CLI 4 + parity 2），全部通过。

```
$ npx vitest run apps/cli/src/usage
 ✓ apps/cli/src/usage/usage-store.test.ts (24 tests) 1848ms
 ✓ apps/cli/src/usage/pricing-parity.test.ts (10 tests) 1212ms
 Test Files  2 passed (2)
      Tests  34 passed (34)

$ npx vitest run packages/shared/src/pricing.test.ts apps/cli/src/providers/pricing.test.ts apps/cli/src/cli.test.ts
 ✓ packages/shared/src/pricing.test.ts (39 tests)
 ✓ apps/cli/src/providers/pricing.test.ts (8 tests)
 ✓ apps/cli/src/cli.test.ts (31 tests)
```

覆盖点对照验收标准：

| 验收点 | 用例 |
|---|---|
| 跨日聚合 | `usage-store.test.ts`「跨日聚合：同一模型落在不同本地日桶，累计总量并存」 |
| 日边界（本地时区） | 「日边界按本地时区切分（23:59:59 与次日 00:00:00 不同桶）」+ 与 ISO 日对比 |
| 窗口过滤 | 「窗口过滤含首含尾；completeOnly 只留完整本地日」 |
| 完整本地日口径 | 「dailySummary 把完整本地日与未完整本地日分开合计」 |
| 旧文件兼容/迁移 | 「旧文件（无 daily 字段）读入为 legacy 累计…」+ CLI「无本地日分桶」用例 |
| 原子写 | 「原子写保持：无 .tmp 残留，文件含 version 2 + daily 分桶，重开可读」 |
| 非法日期 | store `RangeError` + CLI exit 2 两处 |
| cache 写入不低估 | 「显式 cacheWrite：分项含 cache 写入，成本不再低估」（22.05 vs 18.30）+ parity「两条路径同价」 |
| 缺字段回退 | 「缺 cacheWrite 字段 → input×1.25 推导并标记 cacheWriteDerived」+「无 cache 语义 → absent」 |
| 分项展示 | CLI「成本分项: input … cacheWrite $3.7500」 |

### 5. 全量验证

| 命令 | 结果 |
|---|---|
| `npx tsc -b tsconfig.json` | **exit 0**（无输出） |
| `npx vitest run`（root） | 981 passed + 1 skipped + **1 failed（已知 flaky：`process-tree.test.ts`「attaches a pre-spawned grandchild…」30s 超时，与 089/090 无关，基线同样存在）** |
| `npx vitest run`（apps/web） | **74 passed**（8 文件） |

root 基线 957 passed + 1 skipped → 本次 **981 passed**（+24 新用例；web 未回归）。

### 6. 踩坑 / 环境备注

1. **时区符号坑**：JS `getTimezoneOffset() = UTC − 本地`，本机为**正值（西侧）**。最初按「正值=东侧」写断言，
   两次失败后改成按符号分支（西侧用 23:30、东侧用 00:30）才通过——断言本身不依赖机器时区。
2. **`ZERO_TOKEN_PRICE` 加字段引发既有断言失败**：`pricing.test.ts` / `providers/pricing.test.ts` 里
   `toEqual({input:0,output:0,cacheRead:0})` 因新增 `cacheWrite:0` 失败，改为 `toEqual(ZERO_TOKEN_PRICE)`。
3. **全量并发下 `renameSync` 偶发 EPERM**：`usage-store.test.ts` 在满并发全量跑时命中一次（隔离跑 3 次均通过）。
   已按 §2 加有界重试；这是 Windows 杀软/索引器锁文件的环境抖动，不是逻辑错误。
4. **上游 cache_creation 采集未接通（有意留边界）**：本卡范围写明「不改 core」，故
   `AnthropicProvider` 解析 `cache_creation_input_tokens` → core `ChatUsage` → `after_model` 这一段没做；
   但 `UsageStore.record` / `UsageProjection` / `compose.UsageStoreLike` 的入口（`cacheCreationTokens?`）
   已就位，上游一旦上报即自动分项计价。已在 docs/PRICING.md §10 记为后续。
5. **`input_token_semantics` 未做**：cache 写入 token 不从 `inputTokens` 扣减（归一语义缺失时扣减会更乱），
   只做「独立成项」，见 docs/PRICING.md §7。
6. **范围克制**：未碰 091/092；未改 core；未加依赖；未读用户本机应用数据（097 守卫测试未受影响）。

## 验收结论（指挥回填）

- [x] 合入（commit cdf1374）
- 备注：指挥独立复核——`tsc -b` exit 0；全量 vitest 980 passed + 1 skipped（失败为已知 process-tree 时序 flaky，
  重跑确认 94 files passed；另一次全量出现 2 failed 系偶发 rename EPERM flaky，均非本卡回归）；web 74 passed。
  认可：daily 本地日分桶（`complete = date < 今天(本地)`，完整日与今日分开合计；旧文件只保累计不伪造历史分桶 +
  migratedFromLegacy 提示）；cacheWrite 三档（explicit / derived=input×1.25 / absent 0）+ 留痕与 CLI 提示；
  原子写加有界重试（3 次）抗 Windows 杀软锁文件；新增 24 用例。
  **记录的边界（后续卡）**：① cache_creation **端到端采集未做**（卡边界"不改 core"）——AnthropicProvider→core
  ChatUsage 未上报 cacheCreationTokens，入口已就绪，需另卡打通；② `input_token_semantics` 未做（cache 写入不从
  inputTokens 扣减）。**089 关闭。**
