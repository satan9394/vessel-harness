# T325 — 供应商 profile 快照（store + 本地 API，不含 Web 界面）

- Status: 待执行（2026-10-26）
- PDW task: none（契约 `.pdw/contracts/325-provider-profiles.json`）

> 依据：`docs/MAGPIE-ABSORPTION.md` §3 P1-3。
> 现状：`vessel provider switch` 只能切「当前供应商」单值；同一供应商没有「模型 A/端点 A」与
> 「模型 B/端点 B」两套可切换的配置。

## 1. 需求（写死）

1. **数据**：`~/.vessel/providers.json` 顶层新增 `profiles?: Record<string, Profile>`（缺省不出现，
   旧文件读入后 `profiles` 为空对象，不补写）。`Profile` 形状：
   `{ provider: string; model?: string; baseUrl?: string; label?: string }`。
   - **不存 apiKey、不存 secretRef、不复制 endpoints 列表**——profile 只引用 provider id 与两端覆盖，
     凭据与端点池仍归 provider 自己（避免同一份凭据两处真相）。
2. **store 方法**（`apps/local-server/src/providers/ProviderStore.ts`）：
   - `listProfiles(): { name, ...Profile }[]`（按 name 排序，稳定）；
   - `saveProfile(name, profile)`：name 校验（非空、去首尾空白、长度 ≤ 64、不允许空白字符）；
     `provider` 必须存在，否则抛既有风格的显式错误；同名覆盖即更新；
   - `useProfile(name)`：把该 profile 的 `model` / `baseUrl` 应用到 provider 配置（未给字段不动原值），
     返回更新后的 provider；provider 已被删除 → 抛显式错误（说明 profile 悬空），**不静默创建**；
   - `deleteProfile(name)`：不存在返回 false。
3. **API**（`apps/local-server/src/routes/providerRoutes.ts`）：
   - `GET /api/providers/profiles` → `{ profiles: [...] }`（无 profile 返回空数组 + 200）；
   - `POST /api/providers/profiles` body `{ name, provider, model?, baseUrl?, label? }` → 201 `{ profile }`；
   - `POST /api/providers/profiles/:name/use` → 200 `{ provider }`；
   - `DELETE /api/providers/profiles/:name` → 200 `{ ok: true }` / 404 `{ error: 'unknown_profile' }`；
   - 沿用既有同源校验与错误码风格（与现有 `/api/providers*` 一致）。
4. `saveProfile` / `useProfile` 写盘必须走 store 既有的原子写 + 备份路径，不新增第二条写出路径。

## 2. 不许做

- 不在 profile 里存凭据、不复制 endpoints、不改 `secretRef` 机制。
- 不加 Web 界面（本卡只到 API；Web/CLI 命令是后续卡）。
- 不动 `packages/core`、不改 usage/价目、不 commit。

## 3. 允许修改

```
apps/local-server/src/providers/ProviderStore.ts
apps/local-server/src/providers/ProviderStore.test.ts   (若无则建)
apps/local-server/src/routes/providerRoutes.ts
apps/local-server/src/routes/providerRoutes.test.ts
```

## 4. 验收（PDW checks 会真跑）

```powershell
node node_modules/vitest/vitest.mjs run apps/local-server/src/providers apps/local-server/src/routes/providerRoutes.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

测试须覆盖：save/list/use/delete 正常路径；同名覆盖；name 非法被拒；provider 不存在被拒；
provider 被删后 use 报悬空错误；旧 providers.json 无 `profiles` 字段时读取不报错且不补写；
API 四条路由的成功/404/400 分支。

## 5. 回报

```
数据：<profiles 形状 + 与 provider 的关系>
store：<四个方法的语义与错误>
API：<四条路由 + 状态码>
兼容：<旧文件读取行为>
测试：<新增用例数与覆盖点>
检查：<三条命令退出码>
未做：<如实写>
```

## Result

（待 PDW implement + review 完成后由协调者填写）
