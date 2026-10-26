# T318 — Web：Provider Hub 里能看到 token 与成本

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
