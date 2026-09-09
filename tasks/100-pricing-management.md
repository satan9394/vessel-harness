# 100 — 定价管理（历史回填 recompute + 用户价目覆盖）

- 编号：100（合并 CC-SWITCH-MODULE-STUDY 候选卡 091/092）
- 状态：已合入
- 优先级：P1
- 创建日期：2026-09-08
- 关联：085（source/estimated 语义，已合入）；089/099（usage 分项与 daily 分桶，已合入）；docs/CC-SWITCH-IMPROVEMENTS-PROGRESS.md
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标

1. **091 定价变更回填**：`vessel usage recompute` —— 按当前价目重算历史用量成本（幂等 + dry-run）。
   改价后历史成本不再"钉死"，且可验证重算结果与直接重跑一致。
2. **092 用户价目覆盖**：`~/.vessel/pricing.override.json`（覆盖 + 删除墓碑）与内置 `configs/pricing.json` 分离；
   提供**值守卫**式迁移（仅当现值 = 旧值才改，避免覆盖用户改动）。

## 验收标准（执行器逐条勾选）

### 091 recompute
- [x] `vessel usage recompute [--dry-run] [--since/--until]`：按当前价目重算历史条目成本（保留 token 原始值，
      只重算 cost/estimated/pricingSource）；**幂等**（连跑两次结果一致）
- [x] dry-run 输出差异摘要（受影响条目数/金额变化），不落盘
- [x] 重算与"用新价目重新记录"结果一致（测试断言）
- [x] 旧数据兼容：无 pricingSource 的 legacy 条目按当前规则重算并标注

### 092 用户覆盖 + 值守卫
- [x] `~/.vessel/pricing.override.json`：按 `provider::model`（或既有键格式）覆盖单价；支持删除墓碑
      （显式删除内置条目）；与 `configs/pricing.json` 分离，内置更新不覆盖用户覆盖
- [x] 加载优先级：override > 内置（> catalog > protocol > default，沿用 085 的 source 语义并新增 `override` 来源）
- [x] 值守卫式迁移工具（仅当现值 = 旧值才改），避免内置更新冲掉用户手改
- [x] 测试 ≥8 例：覆盖生效/墓碑删除/优先级/值守卫/内置更新不冲用户/异常

### 共同
- [x] `npx tsc -b tsconfig.json` exit 0；全量 vitest（root 994+ 无回归）+ web 74
- [x] 文档同步（PRICING.md：recompute 用法、override 文件格式与优先级、值守卫）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 091+092。P2（093-096）后续卡；不做 UI。
- 不读用户本机应用数据；密钥不落盘；不加新依赖。

## 涉及文件（指针，执行器自行精化）

- `packages/shared/src/pricing.ts`（085：resolvePrice/source——新增 override 来源）
- `apps/cli/src/usage/UsageStore.ts` + `vessel usage` 命令（apps/cli/src/cli.ts）
- `configs/pricing.json`（内置，不改语义）
- `~/.vessel/pricing.override.json`（新，用户态）
- 参考报告 §3（cc-switch 的 DB 覆盖 + model-pricing.json 墓碑 + 值守卫修复 + 历史回填）

## 方法

- 先读 085 的 resolvePrice/source 与 UsageStore 记录结构 → 加 override 加载层 + 值守卫 → recompute 命令 →
  测试（含幂等与 dry-run）

## 工作证明（执行器回填：改了什么/override 格式/优先级链/recompute 幂等证据/测试输出，全部写进本文件，勿留对话里）

> 交接说明：前一执行器实现本卡后**在收尾阶段失败**，留下可用半成品（未提交）。
> 本次接手工作 = 审查（对照 091/092 全部验收标准）→ 补缺（CLI 端到端测试）→ 全量验证 → 交证 → 提交。
> **未重写实现**；`npx tsc -b tsconfig.json` 接手时即 exit 0。

- 实现提交：`ecf422a` `feat(usage): 100 pricing management — recompute + user override`（11 files, +2046/-48）

### 1. 改动文件与 diff 摘要

| 文件 | 类型 | 摘要 |
|---|---|---|
| `packages/shared/src/pricing.ts` | M +162/-8 | `PriceSource` 新增 `override`；`ResolvePriceOptions.override`；阶段 0 覆盖/墓碑判定（先于 strict）；`createOverridePriceSource` + `overrideModelCandidates`；`matchModelName` 支持注入 `candidates`（复用 085 归一，不写第二套匹配） |
| `apps/cli/src/providers/pricing.ts` | M +5 | re-export `createOverridePriceSource` / `overrideModelCandidates` / `OverridePriceSource` 等类型 |
| `apps/cli/src/usage/pricingOverride.ts` | **新增 238 行** | `PricingOverrideStore`：读盘容错 / 原子写（tmp+rename，Windows 有界重试）/ `set` / `tombstone` / `restore` / `repair`（值守卫）/ `source()` 适配 |
| `apps/cli/src/usage/UsageStore.ts` | M +371/-9 | `recompute()`（entries/daily/recent 三范围，1e-9 金额容差）；`UsageStoreOptions.override`；日分桶新增按模型子分项 `models`；条目新增 `recomputedAt` / `recomputedFromLegacy`；`resolveUsageRoot()` 抽出 |
| `apps/cli/src/cli.ts` | M +238/-12 | `vessel usage recompute [--dry-run] [--since] [--until]`；`vessel pricing override [list/set/delete/restore/repair]`；`vessel pricing <model>` 同时显示覆盖/墓碑；位置参数改 `slice(1)` 分发 |
| `apps/cli/src/cli.test.ts` | M **+7 例（本次接手补）** | CLI 端到端：recompute 落盘+幂等 / dry-run 不落盘 / 非法日期 exit 2 / override set·list·delete·restore / set 缺参与非法价 exit 2 / repair 值守卫 / 覆盖+recompute 联动 |
| `apps/cli/src/usage/pricing-override.test.ts` | **新增 13 例** | 覆盖生效、墓碑删除、优先级、值守卫、内置更新不冲用户、异常（损坏/非法行/RangeError） |
| `apps/cli/src/usage/recompute.test.ts` | **新增 15 例** | 重算=重新记录、幂等、dry-run、窗口、legacy、日分桶子分项、strict、覆盖参与重算 |
| `packages/shared/src/pricing.test.ts` | M **+9 例** | 优先级链、归一、provider 作用域、墓碑精确匹配、strict 交互、非法行忽略 |
| `docs/PRICING.md` | M +138/-12 | §11 recompute 用法与口径；§12 override 格式/优先级/墓碑/值守卫/与 recompute 的关系；§5/§6 字段与分桶补充 |

新增测试合计 **44 例**（9 shared + 13 override + 15 recompute + 7 CLI），远超验收要求 ≥8 例。

### 2. override 文件格式（`~/.vessel/pricing.override.json`，与内置 `configs/pricing.json` 分离）

```jsonc
{
  "version": 1,
  "models": {
    "claude-sonnet-4-5":       { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 },
    "deepseek::deepseek-chat": { "input": 0.1, "output": 0.2 }   // 只对 provider=deepseek 生效
  },
  "deleted": ["gemini-2.0-flash"]   // 删除墓碑：显式删除内置/目录条目
}
```

- 键格式：`model`（对所有 provider）或 `provider::model`（作用域）；同一模型两键并存时 **`provider::model` 胜**。
- 键走 085 同一套归一（大小写/命名空间/日期后缀/effort 后缀/点号→横线）。
- 读盘容错：文件缺失 / JSON 损坏 / 非法行（缺 input/output、非数字、负价）→ 按空覆盖处理，不抛错、不猜价。
- 写盘原子（tmp + rename，Windows 上有界重试）；`set` 非法价抛 `RangeError` 且不落盘半成品。
- 覆盖与墓碑互斥：`set` 会清掉同键墓碑，`tombstone` 会删掉同键覆盖。

### 3. 加载优先级链

`override > 内置 pricing.json（models[归一名]）> model-catalog.json > protocols[protocol] > models.default`

- 覆盖命中即**终结**（不再看后面任何一层），`source='override'`、`estimated=false`；`--strict` 下同样生效
  （覆盖是用户对该模型的专属价；strict 只禁 protocol 通用价与 default 兜底）。
- 墓碑命中 → `source='unpriced'` + `deletedByOverride=true`、按 0 计价且**不回退**（否则「删了还在算钱」）；
  墓碑只做归一后**精确**匹配（删 `gpt-4o` 不连坐 `gpt-4o-mini`）。
- 判定位置在 `resolvePrice` **阶段 0**，先于内置表/目录/strict 判定。

### 4. recompute 幂等证据

- 语义：保留 token 原始值，只重算 `costUsd` / `costBreakdown` / `estimated` / `estimatedCostUsd` /
  `pricingSource` / `cacheWriteDerived*`；算法 = 「用当前价目重新记录同样的累计 token」。
- store 级（`recompute.test.ts`）：「同一价目连跑两次 → 第二次零变更且文件逐字节不变」——
  `changed=0`、`written=false`、`entries.changed=0`、`daily.changed=0`、`recent.changed=0`、`readFile === snapshot`。
- CLI 级（`cli.test.ts` 新增）：第一次输出 `已落盘`，第二次输出 `无差异`。
- 幂等的三个实现要点：① 金额比较带 `1e-9` 容差（吸收「逐次累加 vs 累计一次算」的浮点尾差）；
  ② `recomputedAt` 只在**真变更**时写；③ 零变更时**不调用 save()**。
- dry-run：`--dry-run` 只算差异（`written=false`、文件逐字节不变、内存也未改），CLI 打印
  扫描/受影响/金额前后/增减 + 条目差异 Top10。
- 旧数据：legacy（无 `pricingSource`）按当前规则重算并标 `recomputedFromLegacy=true`（落盘后重开仍在）；
  旧日分桶（无 `models` 子分项）**跳过并计数** `dailySkipped`，保持原值（跨模型总量无法反推模型价，不按比例摊）。
- 与「重新记录」一致：`recompute.test.ts` 断言重算后的 tokens/cost/分项/estimated/source 与「用新价目直接记录」逐项相等。

### 5. 测试与验证输出

```
npx tsc -b tsconfig.json                                    → exit 0（接手时与收尾后各跑一次均 0）
npx vitest run apps/cli/src/cli.test.ts \
  apps/cli/src/usage/recompute.test.ts \
  apps/cli/src/usage/pricing-override.test.ts \
  packages/shared/src/pricing.test.ts
  → Test Files 4 passed (4) · Tests 114 passed (114)   [48 + 13 + 15 + 38]
npx vitest run（root 全量）
  → Test Files 2 failed | 96 passed (98) · Tests 2 failed | 1038 passed | 1 skipped (1041)
     基线 994 passed + 1 skipped → 1038 = 994 + 44 例新增，零新增回归
     2 例失败均为**已知 flaky**（与本卡无关，纯负载相关）：
       · packages/engine/src/project-task-queue.test.ts → EPERM rename meta.json.tmp（066 pause/resume）
       · packages/runtime/src/sandbox/backend/process-tree.test.ts → 30s 超时（072 时序窗口）
     两者单独重跑：Test Files 2 passed (2) · Tests 29 passed (29) → 判定非回归
npx vitest run（apps/web）                                   → Test Files 8 passed (8) · Tests 74 passed (74)
```

手工核验（可复现）：

```powershell
$env:VESSEL_USAGE_ROOT = "$env:TEMP\vessel-100-demo"   # 隔离到临时目录，不碰真实 ~/.vessel
vessel pricing override set deepseek-chat --input 0.01 --output 0.02
vessel pricing override list
vessel usage recompute --dry-run          # 看差异摘要，不落盘
vessel usage recompute                    # 落盘
vessel usage recompute                    # 第二次 → "无差异"（幂等）
vessel pricing override delete deepseek-chat   # 墓碑
vessel pricing override restore deepseek-chat  # 撤销
```

### 6. 环境备注 / 踩坑

1. **前一执行器收尾失败**：接手时未提交改动已可用（`tsc -b` exit 0、针对性 114 passed），
   故采取「审查 + 补缺 + 验证 + 交证」，未重写实现。
2. **全量 vitest 有 2 例 flaky**：并发负载下 `project-task-queue` 偶发 EPERM rename、
   `process-tree` 时序测试偶发 30s 超时；单独重跑均通过。**非本卡回归**，未改动相关代码。
3. 沙箱受限会话下 `npx vitest run` 可能因 esbuild spawn EPERM 不可用（本项目已知），
   本次在非受限环境执行，全部命令一次成功、无重试。
4. 未加任何新依赖；未给 core 加机制；未读用户本机应用数据（测试全部落在
   `os.tmpdir()` 或 `VESSEL_USAGE_ROOT` 临时目录）。

## 验收结论（指挥回填）

- [x] 合入（commits ecf422a 实现 + 2a209a9 回填）
- 备注：指挥独立复核——`tsc -b` exit 0；全量 vitest 1039 passed + 1 skipped（唯一失败为已知 process-tree 时序
  flaky，隔离重跑通过；执行器另一次全量出现的 project-task-queue EPERM 亦为已知 flaky）；web 74 passed。
  认可：接手执行器**审查+补缺+验证**而非重写（前一执行器失败时留下的半成品经逐条核对实现完整正确）；
  recompute 幂等有硬证据（同价目第二次 changed=0/written=false/usage.json 逐字节不变，1e-9 容差 + recomputedAt
  仅真变更时写）；--dry-run 不落盘且文件不变；优先级链 override > 内置 > catalog > protocol > default（覆盖命中即
  终结，strict 下仍生效；墓碑按 0 计价且不回退）；值守卫 repair 三态（applied/skipped-user-modified）；
  补 7 例 CLI 端到端测试（+44 总，基线 994→1038 零新增回归）。**100 关闭。**
