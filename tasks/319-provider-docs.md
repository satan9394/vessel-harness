# T319 — provider 重构的文档收口

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 前置：T315（magpie 对照）、T316（Web 预设生成物）、T317（CLI `--by-provider`）、T318（Web 用量）。

## 0. 先读这些（只读）

1. `docs/PROVIDER-MANAGEMENT.md` — 现有 provider 管理文档（本卡主要改它）。
2. `docs/ARCHITECTURE.md` 的 package 清单与 provider 相关段。
3. `docs/MAGPIE-ABSORPTION.md`（T315 产出）— 只引用结论，不重抄。
4. 本批新增的代码：`scripts/sync-web-presets.mjs`、`apps/web/src/components/providers/presets.generated.ts`、`packages/application/src/providers/usageAggregate.ts`、`apps/local-server` 的 `/api/providers/usage`。

## 1. 要写的内容（只改这两份文档）

`docs/PROVIDER-MANAGEMENT.md` 补三节（每节 8–15 行）：

1. **预设的单一真源**：`packages/application/src/providers/presets.data.ts` 是真源，Web 的 `presets.generated.ts` 由 `node node_modules/tsx/dist/cli.mjs scripts/sync-web-presets.mjs --write` 生成，`--check` 用于守卫；**手改生成物会被 `--check` 打回**。
2. **用量视图**：`vessel usage --by-provider [--json]` 的口径（数据来自既有 UsageStore，成本直接用记录里的 `costUsd`，不再乘倍率）；Web 的 `/api/providers/usage` 与 Provider Hub 卡片摘要；无记录时的表现（`—` / 空数组 / exit 0）。
3. **与 magpie / cc-switch 的边界**：一句话说明吸收了哪些（预设单一源、用量按供应商聚合），明确**不吸收**本地网关、订阅 OAuth 账号复用、明文 key 落盘、中间件插件体系——理由指向 `docs/MAGPIE-ABSORPTION.md`，不重抄。

`docs/ARCHITECTURE.md`：若 package 清单或 provider 归属与实现不符，按实现改准（最多 5 行改动）。

## 2. 不许做

- 不改代码、不改测试、不改 HANDOFF（协调者维护）。
- 不重抄 `docs/MAGPIE-ABSORPTION.md` 的整节内容。
- 不声称「已支持 failover / 配额感知 / 导入 cc-switch」——那些还没做。
- 不 commit / push。

## 3. 允许修改

```
docs/PROVIDER-MANAGEMENT.md
docs/ARCHITECTURE.md
```

## 4. 验收（真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run benchmarks/runners/src/spec-manifest-parity.test.ts apps/cli/src/telemetry/telemetryDocs.test.ts
node node_modules/tsx/dist/cli.mjs scripts/sync-web-presets.mjs --check
```

两条都必须 exit 0（文档锚点守卫 + 生成物一致）。

## 5. 回报

```
新增节：<三个小标题>
改准：<ARCHITECTURE 改了哪几行>
不声称：<确认没有把未做的写成已做>
守卫：<两条命令退出码>
```
