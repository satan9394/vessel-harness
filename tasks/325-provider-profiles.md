# T325 — 供应商 profile 快照（独立文件 + local API，不含 Web 界面）

- Status: 待执行（2026-10-26；v2：按 scan 的 blocker 修订）
- PDW task: none（契约 `.pdw/contracts/325-provider-profiles.json`）

> 依据：`docs/MAGPIE-ABSORPTION.md` §3 P1-3。
> v1 契约被 scan 判 blocked，两个真实原因（已采纳）：
> 1. `providers.json` 根是**裸数组**（多处既有测试按数组解析），塞不进 `profiles` 顶层字段；
> 2. `/api/providers/*` 的分发与状态码在 `apps/local-server/src/server.ts` 的 `handleRequest`，
>    `providerRoutes.ts` 只是类方法，且 server.ts 的兜底 catch 把所有异常回成 400。
> v2 因此改成：**profile 独立文件** + **scope 加 `server.ts`**。

## 1. 需求（写死）

1. **存储**：新文件 `~/.vessel/provider-profiles.json`（与 `providers.json` 同目录，按同一个
   `vesselHome()`/根解析取路径，**不改 `providers.json` 的任何形态**）。文件内容：
   `{ "version": 1, "profiles": { "<name>": { "provider": string, "model"?: string, "baseUrl"?: string, "label"?: string } } }`。
   - 文件不存在 → 空对象，不创建；写入走原子写（tmp + rename，沿用 `renameWithRetry`），
     损坏 JSON → 读出显式错误（不静默清空）。
2. **不存凭据、不复制端点**：profile 只引用 provider id 与 `model`/`baseUrl` 两个覆盖；
   apiKey/secretRef/endpoints 仍归 `providers.json` 里的 provider。
3. **store 方法**（`apps/local-server/src/providers/ProviderStore.ts`）：
   - `listProfiles(): { name } & Profile[]`（按 name 升序、稳定）；
   - `saveProfile(name, profile)`：name 非空、去首尾空白、≤64、不含空白字符；`provider` 必须存在
     （沿用 store 既有「provider not found」错误风格）；同名覆盖 = 更新；
   - `useProfile(name)`：只覆盖给定的 `model` / `baseUrl`（未给字段保留原值），返回更新后的
     `ProviderConfig`；profile 指向的 provider 已被删 → 显式错误（说明悬空），**不静默创建**；
   - `deleteProfile(name): boolean`。
4. **HTTP**（分发写在 `apps/local-server/src/server.ts`，DTO 由 `routes/providerRoutes.ts` 提供）：
   - `GET /api/providers/profiles` → 200 `{ profiles: [...] }`（无 profile 也 200 空数组）；
   - `POST /api/providers/profiles` body `{ name, provider, model?, baseUrl?, label? }` → 201 `{ profile }`；
     非法 body / name 非法 / provider 不存在 → 400 `{ error: ... }`；
   - `POST /api/providers/profiles/:name/use` → 200 `{ provider }`；未知 name → 404 `{ error: 'unknown_profile' }`；
   - `DELETE /api/providers/profiles/:name` → 200 `{ ok: true }`；未知 → 404 `{ error: 'unknown_profile' }`。
   - **必须在 server.ts 的分发里显式返回 404/400**，不能靠兜底 catch（它统一回 400）。
   - 沿用既有同源校验（GET 无 Origin 也要能过，写请求按现有规则）。

## 2. 不许做

- 不改 `providers.json` 的裸数组根、不加迁移、不改任何既有测试对数组形态的假设。
- 不在 profile 里存凭据/端点池；不改 `secretRef` 机制。
- 不加 Web 界面、不加 CLI 子命令（本卡只到 store + HTTP）。
- 不动 `packages/core`、不改 usage/价目、不 commit。

## 3. 允许修改

```
apps/local-server/src/providers/ProviderStore.ts
apps/local-server/src/providers/ProviderStore.test.ts        (若无则建)
apps/local-server/src/routes/providerRoutes.ts
apps/local-server/src/routes/providerRoutes.test.ts
apps/local-server/src/server.ts
apps/local-server/src/server.test.ts
```

## 4. 验收（PDW checks 会真跑）

```powershell
node node_modules/vitest/vitest.mjs run apps/local-server/src/providers apps/local-server/src/routes/providerRoutes.test.ts
node node_modules/vitest/vitest.mjs run apps/local-server/src/server.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

测试须覆盖：save/list/use/delete 正常路径；同名覆盖；name 非法被拒；provider 不存在被拒；
provider 删除后 use 报悬空错误；profile 文件不存在时不创建、损坏时显式报错；
HTTP 四条路由的 200/201/400/404 分支（用临时 vesselHome，别碰真实 `~/.vessel`）。

## 5. 回报

```
存储：<文件路径 + 形状 + 原子写与损坏处理>
store：<四个方法语义与错误>
HTTP：<四条路由 + 状态码 + 是否走显式分支>
兼容：<providers.json 未改动>
测试：<新增用例数与覆盖点>
检查：<四条命令退出码>
未做：<如实写>
```

## Result

（待 PDW implement + review 完成后由协调者填写）
