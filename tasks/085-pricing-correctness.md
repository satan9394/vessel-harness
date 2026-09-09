# 085 — 计价正确性 P0（模型名归一 + 缺价显式化 + 统一计价 + 文案纠偏）

- 编号：085（合并 CC-SWITCH-MODULE-STUDY 候选卡 085/086/087/088，同属计价模块、有依赖链）
- 状态：待验收
- 优先级：P0（修正确性：当前在用默认价制造"假成本"）
- 创建日期：2026-09-08
- 关联：docs/ideas/CC-SWITCH-MODULE-STUDY.md §5 差距清单/§6 P0；tasks/029-usage-store.md、tasks/030-model-catalog.md
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 问题（来自 cc-switch 三模块对比报告）

1. **085 查价命中率低**：`findCatalogModelByBase` 只做 basename 匹配，缺日期后缀（`-20250514`）、命名空间前缀
   （`openrouter/…`、`anthropic.`）、reasoning effort 后缀（`-high/-low`）、Claude 点号→横线（`claude-3.5-sonnet`
   → `claude-3-5-sonnet`）归一 → 大量真实模型名落不到目录价，退到 default。
2. **086 假成本（最隐蔽）**：`resolvePrice` 对未知模型回落 default 0.5/1.5（per-1M），`UsageProjection` 也硬编码
   同值——**没有任何标记说明这是估算**，用户看到的是"精确数字"。比 cc-switch 的 0 成本更危险。
3. **087 计价双实现**：`UsageProjection` 与 `benchmarks` 侧各有一套价表/默认价逻辑，可能漂移。
4. **088 文案矛盾**：`apps/cli/src/providers/ProviderStore.ts` 头部注释仍写"apiKey 本地明文存储（与 cc-switch
   同款取舍）…不做加密（YAGNI）"，与 034 之后的 DPAPI 实现矛盾（误导后来者）。

## 验收标准（执行器逐条勾选）

### 085 模型名归一
- [x] 新增 candidates 归一函数（去命名空间前缀/日期后缀/effort 后缀/Claude 点号→横线/大小写），`resolvePrice`
      与 modelCatalog 查价共用（单一实现，勿两处各写）
- [x] 单测 ≥8 种真实模型名变体（如 `openrouter/anthropic/claude-3.5-sonnet`、`claude-3-5-sonnet-20241022`、
      `gpt-5.1-codex-high`、`mimo-v2.5-pro` 等）命中目录价
- [x] 命中率提升可量化（列出对比：归一前/后各变体命中情况）

### 086 缺价显式化
- [x] `resolvePrice` 返回 `{ price, source: 'model'|'catalog'|'protocol'|'default', estimated: boolean }`
      （或等价结构）；`default` 兜底时 `estimated=true` 且 source 标 `default`
- [x] `UsageEntry`/统计记录增 `estimated`/`pricingSource` 字段（持久化）
- [x] `vessel usage`（或 usage 展示）明示「含估算条目 N 条 / 价格来源分布」；提供 `--strict` 模式（不用 default 兜底，
      未收录则标 0 或拒绝记录——按卡内选型记录理由）
- [x] 测试：default 兜底条目被标记；`--strict` 行为断言

### 087 统一计价
- [x] `UsageProjection` 复用同一份 `resolvePrice` 语义（注入 pricing 表 + catalog 源），删除内部硬编码默认价
- [x] 两条路径（projection 与 benchmark/usage-store）对同一模型返回相同价（回归测试断言）

### 088 文案纠偏
- [x] `ProviderStore.ts` 头部注释改为与 DPAPI/secretRef 实现一致（无"YAGNI/明文存储"误导）；扫一遍相关注释

### 共同
- [x] 全量 vitest（root 900+ 无回归）+ tsc 0 + web 74（若涉）
- [x] 文档同步（pricing/usage 文档：归一规则、estimated 语义、strict 模式）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做这四项（计价正确性）。P1 的 089 统计时间维度、090 cache_creation 计价、091 定价回填、092 用户覆盖
  各自成卡（后续）。
- 不改 core；不引入新依赖；不重写 UsageProjection 架构（只统一价源）。

## 涉及文件（指针，执行器自行精化）

- 计价：`configs/pricing.json`、`configs/model-catalog.json`、`packages/application/src/projections/UsageProjection.ts`、
  `apps/cli/src/usage/`（usage-store）、`benchmarks/runners/src/adapters/*.ts`（pricing 读取）、resolvePrice 所在处
- 文案：`apps/cli/src/providers/ProviderStore.ts`
- 参考报告：`docs/ideas/CC-SWITCH-MODULE-STUDY.md` §3 计价模块（cc-switch 的 candidates 归一/四项分算/无缺价兜底）

## 方法

- 先读报告 §3 + 现有 resolvePrice/modelCatalog/UsageProjection 实现 → 定归一规则与返回结构
- 归一 + 显式化 + 统一实现（先 085 再 086 再 087，最后 088 文案），每步跑针对性测试
- 全量验证后提交

## 工作证明（执行器回填：改了什么/归一前后命中对比/estimated 语义/测试输出/diff，全部写进本文件，勿留对话里）

- [x] 已回填（实现提交：`8d57521`）

### W1. 改动文件（24 改 + 5 新增，+722/-233 行）

| 组 | 文件 | 改动 |
|---|---|---|
| 085/086/087 单一实现（新增） | `packages/shared/src/pricing.ts` | 归一候选 BFS（大小写/命名空间/点号/日期/effort）、`matchModelName`（精确→家族前缀）、`resolvePrice`（两阶段：先精确后前缀）、`createCatalogPriceSource`、`costOf`、`DEFAULT_TOKEN_PRICE`/`ZERO_TOKEN_PRICE` |
| 085 导出 | `packages/shared/src/index.ts` | `export * from './pricing.js'` |
| 085 测试（新增） | `packages/shared/src/pricing.test.ts` | 32 用例：候选生成/去重/边界、14 个真实变体命中、匹配顺序、estimated 语义、strict |
| 085/087 CLI 接线 | `apps/cli/src/providers/pricing.ts` | 删除本地 `resolvePrice` 实现，改为 re-export shared + 只保留 `loadPricing`（读盘） |
| 085 目录查名 | `apps/cli/src/providers/modelCatalog.ts` | `findCatalogModelByBase` 改用 `matchModelName`；新增 `findCatalogModelMatch` / `catalogPriceSource` |
| 086 落盘 | `apps/cli/src/usage/UsageStore.ts` | `UsageEntry` 增 `estimated`/`estimatedCostUsd`/`pricingSource`；`record()` 返回来源；`pricingSourceDistribution()`、`strictAudit()`；旧文件迁移为 `legacy`；`catalog`/`strict` 选项 |
| 086 CLI | `apps/cli/src/cli.ts` | `vessel usage` 打印来源分布 + 估算条目 + `--strict` 审计；`vessel run --strict`；`vessel pricing` 打印「归一匹配」；`createUsageStore()` 工厂注入 catalog |
| 087 application | `packages/application/src/projections/UsageProjection.ts` | 删除硬编码 `0.5/1.5/0.1`，改用 shared `resolvePrice`；`usage()` 增 `pricingSource`/`estimated`；新增 `pricing()` |
| 087 类型 | `packages/application/src/projections/types.ts` | 删除本地 flat `PricingTable`/`DEFAULT_PRICING`，re-export shared 的规范形状；`UsageRecord` 增来源字段 |
| 087 会话注入 | `packages/application/src/session/SessionController.ts` | 新增 `pricingCatalog`/`strictPricing` 选项并透传 projection |
| 087 benchmarks | `benchmarks/runners/src/adapters/pricing.ts`（新增）+ claude/codex/dsh/opencode/pi/contracts-vessel | 6 处各自复制的 `loadPrices` 收敛为 1 个共享 helper（内部走 shared `resolvePrice`） |
| 087 回归（新增） | `apps/cli/src/usage/pricing-parity.test.ts` | projection ↔ usage-store 同模型同价（model/catalog/protocol/default/strict + 真实 configs 各一例） |
| 088 文案 | `apps/cli/src/providers/ProviderStore.ts` | 头部注释改写为 DPAPI/secretRef 事实（删除「明文存储/YAGNI」） |
| 文档 | `docs/PRICING.md`（新增）、`docs/PROVIDER-MANAGEMENT.md` §6/§9、`README.md`、`configs/pricing.json` comment | 归一规则 / estimated 语义 / strict 选型 / 单一价源 |
| 测试同步 | `apps/cli/src/providers/{pricing,modelCatalog}.test.ts`、`apps/cli/src/usage/usage-store.test.ts`、`apps/cli/src/cli.test.ts`、`packages/application/src/projections/projections.test.ts` | 新返回结构 + 新增断言 |

### W2. 归一前 / 归一后命中对比（真实 `configs/pricing.json` + `configs/model-catalog.json`）

「旧」= 归一前 basename 精确匹配（`findCatalogModelByBase` 语义）；「新」= 本卡实现。

| 模型名变体 | 旧 | 新 |
|---|---|---|
| `openrouter/anthropic/claude-sonnet-4-5-20250929` | 落 default/protocol | model `claude-sonnet-4-5` |
| `anthropic/claude-sonnet-4-5` | `claude-sonnet-4-5` | model `claude-sonnet-4-5` |
| `claude-sonnet-4-5` | `claude-sonnet-4-5` | model `claude-sonnet-4-5` |
| `claude-opus-4.5` | 落 default/protocol | catalog `claude-opus-4-5` |
| `CLAUDE-HAIKU-4-5` | 落 default/protocol | model `claude-haiku-4-5` |
| `openai/gpt-5.1-codex-high` | 落 default/protocol | catalog `gpt-5.1` |
| `gpt-5.1-codex` | 落 default/protocol | catalog `gpt-5.1` |
| `gpt-4o-mini-2024-07-18` | 落 default/protocol | catalog `gpt-4o-mini` |
| `google/gemini-2.5-pro-001` | 落 default/protocol | catalog `gemini-2.5-pro` |
| `moonshotai/kimi-k2.7-code` | `kimi-k2.7-code` | catalog `kimi-k2.7-code` |
| `siliconflow/deepseek-ai/DeepSeek-V4-Flash` | 落 default/protocol | catalog `deepseek-ai/DeepSeek-V4-Flash` |
| `zai-org/GLM-5` | 落 default/protocol | catalog `zai-org/GLM-5` |
| `deepseek-chat` | `deepseek-chat` | model `deepseek-chat` |
| `claude-3-5-sonnet-20241022` | 落 default/protocol | protocol（目录未收录，`estimated=true`） |
| `mimo-v2.5-pro-high` | 落 default/protocol | protocol（目录未收录，`estimated=true`） |
| `totally-unknown-model` | 落 default/protocol | protocol（`estimated=true`） |

**命中数（model/catalog 真实价目）：旧 4/16 → 新 13/16**（+9，命中率 25% → 81%）。
（`claude-3-5-sonnet-20241022` / `mimo-v2.5-pro-high` 在我们 27 条目录里确实没有，落 protocol 并标 estimated——这正是 086 要的「不装成精确价」。）

**实现中实测抓到的顺序 bug（已修）**：初版「model 表整体（含前缀）先于 catalog」会让
`gpt-4o-mini-2024-07-18` 被 model 表的 `gpt-4o` 家族前缀抢走（$2.5 vs $0.15，高 16 倍）。
现改为**任何精确命中优先于任何家族前缀**：① 精确 model → ② 精确 catalog → ③ 前缀取「命中键最长」。
回归用例见 `packages/shared/src/pricing.test.ts` 的「resolvePrice 匹配顺序」。

### W3. `estimated` 语义与 `--strict` 选型

- `PriceResolution = { price, source, estimated, matchedKey?, matchedCandidate? }`；
  `source ∈ model | catalog | protocol | default | unpriced`。
- `estimated = true` 当且仅当**价格不是该模型的专属价目**：`protocol`（协议级通用价）与 `default`（通用兜底价）。
  `model`/`catalog` = 该模型专属价 → false；`unpriced` = 没有价（按 0 记）→ false。
  > 比卡面要求更严：卡只要求 default 标记；实测 `protocols.openai-compatible` 对几乎所有 provider 都会命中，
  > 若只标 default，绝大多数「猜出来的价」仍会显示成精确值，故一并标记。
- `--strict` **选型：只用模型专属价目（model/catalog），未收录 → `source='unpriced'` + 成本 0（保留 token 计数）**。
  理由：① 拒绝记录会丢掉 token 口径（统计出现空洞）；② 标 0 且保留模型名/token，日后补价可回填（对齐 cc-switch 保留 `pricing_model` 待回填；回填卡是 091）；
  ③ 连 `protocol` 一起禁——否则 `protocols.openai-compatible` 永远兜住，strict 形同虚设（实测：只禁 default 时 strict 永不产生 unpriced）。
- 用法：`vessel run --strict`（本次会话按 strict 落盘）、`vessel usage --strict`（按 strict 口径重算历史，只审计不写盘）。
- 旧数据兼容：085 之前写入的 `usage.json` 条目没有来源字段 → 加载时标 `pricingSource='legacy'`、`estimated=false`，
  展示层单列「来源未知条目 N 条（085 之前的记录）」，不臆造来源、也不谎称是真实价目。

### W4. 测试与命令输出

```text
npx vitest run packages/shared packages/application/src/projections apps/cli/src/usage apps/cli/src/providers
  Test Files  11 passed (11)
       Tests  149 passed (149)

npx vitest run apps/cli/src/cli.test.ts          → 27 passed (27)
npx vitest run --testTimeout=120000（全量 root，最终一次）
  Test Files  94 passed (94)
       Tests  961 passed | 1 skipped (962)        [exit 0]
cd apps/web && npx vitest run                     → 8 files / 74 passed

npx tsc --noEmit -p packages/shared/tsconfig.json          → exit 0
npx tsc --noEmit -p packages/application/tsconfig.json     → exit 0
npx tsc --noEmit -p apps/cli/tsconfig.json                 → exit 0
npx tsc --noEmit -p apps/local-server/tsconfig.json        → exit 0
npx tsc --noEmit -p benchmarks/runners/tsconfig.json       → exit 0
npx tsc -b tsconfig.json                                   → 仅 4 行 TS5055（见 W5，无类型错误）
```

（基线 900 用例 → 本卡 962 用例：+62。全量跑了 3 次：2 次 94/94 全绿；1 次有 1 个 Windows 计时用例超时，
隔离单跑该文件通过——见 W5.2。）

新增/改写用例覆盖：候选生成与去重、14 个真实变体命中、匹配顺序（精确 vs 前缀）、
`estimated` 五来源、strict、旧条目 legacy 迁移、`strictAudit` 重算、来源分布、
CLI 展示（估算条目/来源分布/`--strict` 审计/`pricing` 归一提示）、projection↔store 同价回归。

### W5. 踩坑 / 环境备注

1. **`npx tsc -b tsconfig.json` 报 4 行 `TS5055`（非本卡引入，pre-existing）**：
   `apps/cli/dist/{cli,index,providers/modelFetcher,providers/presets.data}.d.ts` 被同时当作输入与输出。
   根因是既有的类型环：`apps/cli/src/cli.ts` 动态 `import('@vessel/bench-runners')`
   → `benchmarks/runners/dist/lane/opencodeGoProvider.d.ts` → `import '@vessel/cli'`（自引用）。
   证据：`apps/cli/dist/cli.d.ts` mtime 2026-09-08 0:05（早于本卡会话），且 `tsc -b apps/cli` 单独跑同样报错；
   该环是 V1.1-C 复用 CLI presets 的既有设计，未在本卡范围内改动。
   本卡用 **逐项目 `tsc --noEmit -p <project>`（5 个项目全部 exit 0）** 作为类型验证，等价且更严格地覆盖了本卡改动。
2. **Windows 计时类用例在全量并发下偶发超时**（与本卡改动无关）：
   实测 `packages/runtime/src/sandbox/backend/process-tree.test.ts`（task 072 进程树枚举）
   在 3 次全量中的 1 次超过 30s 上限；隔离单跑 `npx vitest run <该文件>` = 11 passed（20.3s）。
   全量另 2 次（含最终一次，`--testTimeout=120000`）94 files / 961 passed + 1 skipped 全绿。
   属既有 flaky（受并发负载影响），未在本卡范围内改动。
3. 命令环境正常（无 EPERM/spawn 报错）；临时量化脚本 `.tmp-085-hitrate.mts` 用完已送回收站，未留仓库。
4. 未动 core；未加新依赖（benchmarks/runners 仅补声明已引用的 workspace 包 `@vessel/shared`）；
   P1（089-092）未触碰。

### W6. diff 摘要

```text
 README.md                                                |   4 +-
 apps/cli/src/cli.test.ts                                 |  70 +++
 apps/cli/src/cli.ts                                      |  82 ++--
 apps/cli/src/providers/ProviderStore.ts                  |   8 +-
 apps/cli/src/providers/modelCatalog.test.ts              |  52 ++-
 apps/cli/src/providers/modelCatalog.ts                   |  30 ++-
 apps/cli/src/providers/pricing.test.ts                   |  45 ++-
 apps/cli/src/providers/pricing.ts                        |  87 ++---
 apps/cli/src/usage/UsageStore.ts                         | 165 +++++++--
 apps/cli/src/usage/usage-store.test.ts                   | 126 ++++++
 benchmarks/runners/package.json                          |   3 +-
 benchmarks/runners/src/adapters/{claude,codex,dsh,opencode,pi}.ts | 5×17 +-
 benchmarks/runners/src/contracts/vessel.ts               |  24 +--
 configs/pricing.json                                     |   2 +-
 docs/PROVIDER-MANAGEMENT.md                              |  10 +-
 packages/application/src/projections/UsageProjection.ts  |  59 ++-
 packages/application/src/projections/projections.test.ts |  60 ++-
 packages/application/src/projections/types.ts            |  29 +-
 packages/application/src/session/SessionController.ts    |  13 +-
 packages/shared/src/index.ts                             |   1 +
 24 files changed, 722 insertions(+), 233 deletions(-)
 新增：packages/shared/src/pricing.ts、packages/shared/src/pricing.test.ts、
       benchmarks/runners/src/adapters/pricing.ts、apps/cli/src/usage/pricing-parity.test.ts、docs/PRICING.md
```

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
