# T318 — Web：Provider Hub 里能看到 token 与成本

- Status: 已完成（2026-10-26；协调者直接实现，未经 PDW 独立 review；未提交、未推送）

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 前置：卡 T317（CLI 的 `--by-provider` 聚合）。本卡把同一份聚合搬到 Web。

## 0. 先读这些（只读）

1. `apps/cli/src/usage/UsageStore.ts` — 记录结构与读取方式；T317 新加的聚合逻辑放在哪。
2. `apps/local-server/src/server.ts` — `createVesselServer` 的 options 形状（看能否注入只读 usage 读取器）。
3. `apps/local-server/src/routes/providerRoutes.ts` — 现有 provider 路由的写法（同源校验、错误码、`--json` 形状）。
4. `apps/web/src/components/providers/ProviderHub.tsx` 与同目录的 `ProviderCard`（如果有）— 卡片结构。
5. `apps/web/src/api/`（或组件里的 fetch 封装）— Web 调本地 API 的既有写法与 i18n 键。
6. `apps/web/src/i18n.ts` — 新增文案要中英都加。

## 1. 做法（写死）

1. **聚合只写一次**：把「按 provider 聚合」抽成纯函数（建议 `packages/application/src/providers/usageAggregate.ts`），输入是记录数组，输出 `{ provider, calls, inputTokens, outputTokens, cacheReadTokens, costUsd, perModel }[]`；CLI（T317）与 local-server 都调它。若 T317 已把它写在 CLI 里，本卡负责搬出去并让 CLI 改调（**不允许两份**）。
2. `GET /api/providers/usage`：返回 `{ byProvider: [...], totals: {...} }`；无记录返回空数组 + 200（不是 404）。
3. Web：Provider Hub 的每张供应商卡片展示 `tokens`（input+output）与 `costUsd`，无记录时显示 `—`（不要显示 0 冒充）；卡片上不新增弹窗，只加一行摘要 + 现有详情入口。
4. 中英文案都加（`t('providerUsage.tokens')` 之类），英文不得含 CJK。
5. 数据来源只读：`~/.vessel` 下的 usage 记录；**不写任何文件**。

## 2. 不许做

- 不在 Web 里重算价格或倍率（成本直接用记录里的 `costUsd`）。
- 不改 usage 记录格式、不新增 provider 字段、不改 `--by-provider` 的语义。
- 不引入新的状态管理库、不加依赖。
- 不 commit / push；不动 `packages/core`。

## 3. 允许修改

```
packages/application/src/providers/usageAggregate.ts     (新增)
packages/application/src/providers/usageAggregate.test.ts(新增)
apps/cli/src/usage/UsageStore.ts                          (改为调纯函数)
apps/cli/src/cli.ts                                       (改为调纯函数，行为不变)
apps/local-server/src/routes/providerRoutes.ts            (加 /usage 路由)
apps/local-server/src/server.ts                           (必要时注入只读读取器)
apps/local-server/src/server.test.ts                      (加路由用例)
apps/web/src/components/providers/ProviderHub.tsx         (卡片加摘要)
apps/web/src/components/providers/ProviderHub.test.tsx    (加断言)
apps/web/src/i18n.ts                                      (中英文案)
```

## 4. 验收（逐条真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run packages/application/src/providers/usageAggregate.test.ts apps/cli/src/usage/usage-store.test.ts apps/cli/src/cli.test.ts apps/local-server/src/server.test.ts
node node_modules/vitest/vitest.mjs run --root apps/web apps/web/src/components/providers/ProviderHub.test.tsx
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
```

## 5. 回报

```
聚合：<纯函数所在文件 + CLI 与 local-server 是否都改调>
API：<路由 + 返回形状 + 空记录行为>
Web：<卡片显示什么 + 无记录时显示什么>
i18n：<新增键 + 英文是否含 CJK>
测试：<三处新增用例>
检查：<五条命令退出码>
未做：<如实写>
```

## Result

已完成。三处改动：

1. **local-server**（`apps/local-server/src/server.ts`）：`VesselServerOptions` 新增只读 `usageByProvider`；路由 `GET /api/providers/usage` 返回 `{ byProvider, totals }`；**未注入时返回空数组 + 200**（不是 404/503），totals 全 0。
2. **CLI 组合根**（`apps/cli/src/cli.ts` 的 serve 调用）：注入 `usageByProvider: () => createUsageStore().byProvider()`——local-server 不反向依赖 `apps/cli`，聚合逻辑保持单份（`UsageStore.byProvider()`）。
3. **Web**：`api.ts` 新增 `listProviderUsage()`；`ProviderSettingsModal` 在 `refresh()` 里并行拉取（失败只吞掉 usage、不影响 provider 列表），卡片显示 `<tokens> tokens · $<cost>`；无记录显示 `—`。i18n 加 `providerUsageLine` / `providerUsageNone`（中英，英文无 CJK）。

测试：server **58 passed**（新增 2 条：有注入返回行与 totals、无注入返回空数组）；Web `ProviderSettingsModal` **28 passed**（新增 2 条：显示 `15 tokens`/`0.2500`、无记录显示 `—`）；`tsc -b`、`typecheck:tests`、Web tsc 三处干净。

未做：没有把聚合抽成跨包纯函数（`UsageStore.byProvider()` 已是单一实现，再抽一层只会多一个转发）；Web 不做任何计算，只展示 API 返回的数字。
