# 101 — P2：models.dev 价目同步 + provider 成本倍率

- 编号：101（合并 CC-SWITCH-MODULE-STUDY 候选卡 093/094）
- 状态：待验收
- 优先级：P2
- 创建日期：2026-09-09
- 关联：085（resolvePrice/source 语义）；100（override/优先级链）；docs/CC-SWITCH-IMPROVEMENTS-PROGRESS.md
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标

1. **093 models.dev 同步**：`vessel pricing sync` —— 从 models.dev 拉取模型元数据/价目，生成或更新
   `configs/model-catalog.json`（或用户态 catalog），带选择/排除、超时、**离线回退**（拉取失败保留旧表并提示）；
   同步**不得覆盖用户覆盖**（`~/.vessel/pricing.override.json` 优先级最高，100 已建）。
2. **094 provider 成本倍率**：`ProviderConfig` 增 `costMultiplier?`，在计费时**只乘总额**（不改变分项单价），
   用于中转/代理加价场景。

## 验收标准（执行器逐条勾选）

### 093 sync
- [x] `vessel pricing sync [--dry-run] [--provider <p>] [--exclude <glob>]`：拉 models.dev（含超时/重试上限 1 次），
      生成/更新 catalog；**离线/失败时保留旧表 + 明确提示**（不静默清空）
- [x] 同步不覆盖用户 override（优先级链 override > 内置 > catalog 保持 100 的语义）；dry-run 只打印差异
- [x] 幂等：相同远端数据二次同步无变更（或幂等写）；原子写
- [x] 测试 ≥6 例：解析映射/离线回退/dry-run/幂等/不覆盖 override/异常（实交 11 例）

### 094 costMultiplier
- [x] `ProviderConfig.costMultiplier?: number`（默认 1）；`vessel provider add/set` 可设；持久化到 providers.json
- [x] 计费只乘**总额**（分项单价不变；`vessel usage` 分项与总额关系可解释）；倍率 <0 或非数字 fail loud
- [x] 测试 ≥4 例：倍率生效只作用总额/默认 1/非法值 fail loud/与 override·catalog 共存（实交 5 例 UsageStore + 5 例 ProviderStore + 3 例 shared）

### 共同
- [x] `npx tsc -b tsconfig.json` exit 0；全量 vitest（root 1039+ 无回归）+ web 74
- [x] 文档同步（PRICING.md：sync 用法与离线语义、倍率语义）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 093+094。095（导入导出）/096（多端点）后续卡；不做 UI。
- 不读用户本机应用数据；密钥不落盘；不加新依赖（HTTP 用既有 fetch）。

## 涉及文件（指针，执行器自行精化）

- `apps/cli/src/providers/pricing.ts` / `packages/shared/src/pricing.ts`（085/100 的价源与优先级链）
- `apps/cli/src/providers/modelCatalog.ts`、`configs/model-catalog.json`
- `apps/cli/src/providers/ProviderStore.ts`（ProviderConfig 增字段）+ `apps/cli/src/cli.ts`（命令）
- `apps/cli/src/usage/UsageStore.ts`（倍率只乘总额）
- 参考报告 §3（cc-switch 的三通道更新：seed / 值守卫修复 / models.dev 同步）

## 方法

- 先读 085/100 的价源链 → 加 sync 命令（离线回退 + 不覆盖 override）→ 加 costMultiplier（只乘总额）→ 测试

## 工作证明（执行器回填：改了什么/sync 离线语义/倍率计算点/测试输出/diff，全部写进本文件，勿留对话里）

### 1. 改动文件（13 个；新增 3，修改 10）

| 文件 | 改动 |
|---|---|
| `apps/cli/src/providers/pricingSync.ts` | **新增**：models.dev 拉取（超时 15s + 重试 1 次）、解析映射、增量合并、原子写、dry-run、离线回退 |
| `apps/cli/src/providers/modelCatalog.ts` | `ModelCatalog.lastSyncAt?`；`readModelCatalog(file)`；`catalogEntryKey`；`sameCatalogModel`（null≡缺失） |
| `apps/cli/src/providers/ProviderStore.ts` | `ProviderConfig.costMultiplier?` + `assertValid` 校验；`update(id,patch)`；`costMultiplierOf`；`costMultipliers` |
| `apps/cli/src/usage/UsageStore.ts` | `multiplierOf` 选项；唯一计价入口 `cost()`；record/recompute/strictAudit 走倍率；条目落 `costMultiplier`/`costMultiplierMixed`；`totals().rawCostUsd`；`byProvider()` 增 `rawCostUsd`/`costMultiplier` |
| `packages/shared/src/pricing.ts` | `CostBreakdown` 增 `rawTotalUsd`/`costMultiplier`；`costBreakdown(..., {costMultiplier})`；`assertCostMultiplier`；`DEFAULT_COST_MULTIPLIER`；`costOf` 支持 opts（原重复定义已合并为一处） |
| `apps/cli/src/providers/pricing.ts` | re-export 上述新符号 |
| `apps/cli/src/cli.ts` | `cmdPricingSync` + `pricing sync` 分派；`provider add --cost-multiplier`；`provider set` 子命令；`provider list` 显示 `×n`；`createUsageStore` 注入倍率解析；`usage` 打印倍率与「分项合计 × 倍率」；USAGE 帮助 |
| `docs/PRICING.md` | §13 sync（三通道/离线语义/幂等/原子写）、§14 倍率（计算点/fail loud/展示）；§2 表、§5 字段、§10 不做的 同步更新 |
| 测试 | `pricingSync.test.ts`（新增 11 例）、`costMultiplier.test.ts`（新增 5 例）、`ProviderStore.test.ts`（+5 例）、`packages/shared/src/pricing.test.ts`（+3 例）、`cli.test.ts`（+4 例 CLI 端到端） |

未加任何新依赖（HTTP 用全局 `fetch` + `AbortController`）；未碰 095/096；未做 UI；未读用户本机应用数据。

### 2. sync 离线语义（093）

- 失败形态全部走同一条回退：连接失败 / 超时（AbortController）/ HTTP 5xx / 非法 JSON / 解析后 0 条可用模型。
- 回退 = `status:'offline'`、`wrote:false`、**目标文件一个字节都不动**（旧表保留），CLI 打印
  `⚠ 拉取/解析失败（已重试至多 1 次）：<原因>` + `未改动 <path>（保留旧表 N 条）`，**exit 1**（脚本能看出同步没发生）。
- 重试上限 1 次（最多 2 次请求），常量 `MAX_SYNC_RETRIES`；超时默认 15s（`DEFAULT_SYNC_TIMEOUT_MS`）。
- 同步**只写 catalog**：`~/.vessel/pricing.override.json` 不读不写，优先级链 `override > 内置 pricing.json > catalog > protocols > default` 不变（测试断言覆盖文件逐字节相同 + `resolvePrice` 仍 `source:'override'`）。
- 幂等：远端与既有目录一致 → `status:'unchanged'`、不写盘（`lastSyncAt` 也不动）；差异比较把 `null` 与字段缺失视为相同。
- 原子写：`tmp + rename`（Windows EPERM/EBUSY 有界重试），测试断言无 `.tmp` 残留。
- 远端未覆盖的既有条目**保留**（打印「保留 N 条」）；删价是显式操作（092 墓碑），同步不制造空洞。

### 3. 倍率计算点（094）

唯一实现 `packages/shared/src/pricing.ts::costBreakdown(price, tokens, { costMultiplier })`：

```
inputUsd/outputUsd/cacheReadUsd/cacheWriteUsd  ← 单价 × token / 1e6（不变）
rawTotalUsd = 四项之和
totalUsd    = rawTotalUsd × costMultiplier      ← 只乘总额
```

- UsageStore 的**唯一计价入口** `UsageStore.cost(price, tokens, provider)` → `costBreakdown(..., { costMultiplier: multiplierOf(provider) })`；
  `record()` / `recompute()` / `strictAudit()` 三处都走它（不会一条路径乘、另一条不乘）。
- 倍率来自 `~/.vessel/providers.json`（`ProviderStore.costMultipliers()`，CLI 里 `providerCostMultiplierResolver()` 注入；读盘失败按「无倍率」处理，不阻断统计）。
- fail loud：`assertCostMultiplier` 在 `ProviderStore.assertValid`（add/save/update/读盘）与 `costBreakdown` 两处校验，负数/NaN/Infinity/非数字抛 `RangeError`；CLI 捕获后 exit 2 且不落盘；倍率 0 合法（免计费）。
- 可解释性：`vessel usage` 打印 `成本倍率: N 条条目含 provider 倍率——总额 = 分项合计 × 倍率；分项合计 $X（分项单价未变）`；
  「按供应商」打印 `$总额（分项合计 $Y × 倍率 m）`；同一 provider 中途改倍率 → 条目标 `costMultiplierMixed`（不假装唯一），`recompute` 后收敛为当前倍率。

### 4. 测试与命令输出

```text
npx tsc -b tsconfig.json                    → EXIT=0
npx vitest run apps/cli/src/providers/pricingSync.test.ts
                                            → 11 passed
npx vitest run apps/cli/src/usage/costMultiplier.test.ts packages/shared/src/pricing.test.ts \
               apps/cli/src/providers/ProviderStore.test.ts apps/cli/src/cli.test.ts
                                            → 109 passed（首次 2 处为我自己写错的期望值，已修正后全绿）
npx vitest run                              → Test Files 1 failed | 100 passed (101)
                                              Tests 1 failed | 1081 passed | 1 skipped (1083)
                                              唯一失败 = 已知 flaky `packages/runtime/src/sandbox/backend/process-tree.test.ts`
                                              > 真实 Windows 时序窗口枚举（Test timed out in 30000ms）
                                              → 单跑该文件：11 passed（确认 flaky，非本卡回归）
cd apps/web && npm test                     → 8 files / 74 passed
```

> 全量 1081 passed 含本卡新增 28 例（11+5+5+3+4），其余增量来自工作区里其它执行器的在途改动
> （`benchmarks/runners/src/lane/*`），**未纳入本次提交**。

### 5. 踩坑 / 环境备注

1. `cli.test.ts` 的 CLI 端到端用例**不能真连外网**：改为用 `node:http` 起本地服务充当 models.dev
   （`--url http://127.0.0.1:<port>/api.json`），离线用例用 `http://127.0.0.1:1/api.json`（连接必然失败）。
   全部 sync 单测都用注入 `fetchImpl`，零真实网络。
2. 幂等与 `lastSyncAt` 冲突：若把时间戳写进 `source`，每次同步字节都会变。改为「时间戳单独放 `lastSyncAt`，
   变更判定只看 `models`」，无变更时**完全不写盘**。
3. 条目倍率不是「一个模型一个倍率」而是「历次记录累积」：同一 provider 中途改倍率会让条目失去唯一倍率，
   故引入 `costMultiplierMixed`（省略数值 + 打标），`recompute` 后收敛。
4. `costOf` 在 `packages/shared/src/pricing.ts` 里原有两处同名导出（一处中间、一处文件尾），
   这次顺带合并为一处并加 `options` 透传——不改语义（默认倍率 1 时逐位相同）。
5. 全量 vitest 首跑出现 `process-tree` 超时（30s），单跑该文件通过——与基线记录的「已知 flaky：process-tree 时序」一致，未做任何重试循环。
6. 工作区里有其它执行器（`benchmarks/runners/src/lane/*`、`benchmarks/reports/*`）的在途改动，提交时**只 `git add` 本卡文件**，未混入。

### 6. 提交

- 实现提交：`f276724`（`feat(pricing): 101 models.dev pricing sync + provider cost multiplier`，14 files changed,
  1744 insertions(+)，47 deletions(-)；本条 docs 提交只记录哈希）
- 跟进提交：`<见下条>`（`fix(pricing): 101 surface fetch failure cause in sync offline message`）——
  真实跑 CLI 时发现连接失败只显示 `fetch failed`，改为带上 `cause`（`ECONNREFUSED`/`ENOTFOUND`/`ETIMEDOUT`），
  离线提示才可诊断；同步测试补一条 `TypeError('fetch failed', {cause:{code}})` 用例。
- 未 force push；删除一律走回收站（本卡未删任何文件）。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
