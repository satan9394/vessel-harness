# 交给 Codex 应用：provider 模块收尾四连（一次粘贴跑完）

> 用法：Codex 应用打开仓库根 `E:\Code_file\Projects\Vessel_Harness`，把本文件 **"---" 之后**全部内容作为 prompt 粘贴。
> 顺序 A → B → C → D，每段做完先跑该段的验证命令，再做下一段；最后跑 §5 全量门禁。
> Fast 已开（`~/.codex/config.toml` 的 `service_tier = "priority"`），不要改模型/思考档位。

---

你是本仓库的实现者（唯一写者）。仓库根 `E:\Code_file\Projects\Vessel_Harness`；TypeScript + Node + npm workspaces；测试 Vitest。四张卡按顺序做完，别跳步。

## 0. 硬规则（违反即失败）

1. **不要 commit / push**。
2. **不永久删除任何文件**（`rm` / `del /f` / `fs.rmSync` 禁止；测试自建且位于 `os.tmpdir()` 下的临时目录除外）。
3. **不动 `packages/core`**；不改 usage 记录结构与价目表；不跑 `--live`；不读写真实用户凭据。
4. 只改每段列出的路径；要越界就停下并在报告里说明。
5. 测试一律用临时目录注入（`mkdtemp`），不得读写真实 `~/.vessel`。
6. 现有工作树**已有未提交的半成品**（见 A），不要回滚。

---

## A. 卡 T325（补完）：provider profile 的 HTTP 层 + 测试

### A.1 现状（先读，别重写）

- `apps/local-server/src/providers/ProviderStore.ts` 已加入 `ProviderProfile`、`profilesFile`、
  `listProfiles/saveProfile/useProfile/deleteProfile`、`readProfiles` 与原子写。
- `apps/local-server/src/routes/providerRoutes.ts` 已加入 `listProfiles/saveProfile/useProfile/deleteProfile`
  （`useProfile` 对 `unknown_profile` 返回 `undefined`）。
- 缺：`server.ts` 的四条路由分发、全部测试。

### A.2 要做

在 `apps/local-server/src/server.ts` 的 `/api/providers*` 分支附近（约 504-521 行）加，**必须显式返回状态码**（该文件兜底 catch 统一回 400）：

- `GET /api/providers/profiles` → `200 { profiles }`（空也 200）
- `POST /api/providers/profiles` → `201 { profile }`；body/name/provider 非法 → `400 { error }`
- `POST /api/providers/profiles/:name/use` → `200 { provider }`；`undefined` → `404 { error: 'unknown_profile' }`
- `DELETE /api/providers/profiles/:name` → `200 { ok: true }`；未知 → `404 { error: 'unknown_profile' }`

注意与既有 `^\/api\/providers\/[^/]+$` 的 DELETE 与 `/api/providers/test` 等前缀路由的先后顺序，别让 `profiles` 被当成 provider id。

### A.3 测试

- `apps/local-server/src/providers/ProviderStore.test.ts`（有则追加）：
  save→list 升序；同名覆盖；name 非法（空/纯空白/>64/含空白）；provider 不存在；
  `useProfile` 只覆盖给定字段并返回更新后的 config；provider 被删后 use 报悬空错误；
  delete 不存在返回 false；`provider-profiles.json` 缺失时读为空且**不创建**；损坏时显式报错不清空；
  断言 `providers.json` **仍是裸数组**。
- `apps/local-server/src/server.test.ts`：四条路由的成功/400/404；每个用例独立临时 `vesselHome`。

### A.4 验证

```powershell
node node_modules/vitest/vitest.mjs run apps/local-server/src/providers apps/local-server/src/routes/providerRoutes.test.ts
node node_modules/vitest/vitest.mjs run apps/local-server/src/server.test.ts
```

---

## B. 卡 T327：CLI `vessel provider profile list|save|use|delete`

### B.1 命令面

```
vessel provider profile list [--json]
vessel provider profile save <name> --provider <id> [--model <m>] [--base-url <u>] [--label <text>]
vessel provider profile use <name> [--json]
vessel provider profile delete <name>
```

- `list`：人读 `name  provider=<id>  model=<m|->  baseUrl=<u|->`；`--json` 给 `{ profiles }`；空列表打印 `无 profile。` exit 0。
- `save`：必填 `--provider`；校验失败（name 非法/provider 不存在）→ exit 2 + 一行可操作错误。
- `use`：调 `store.useProfile`；人读 `已启用 profile <name>（provider=<id>）`；`--json` 给 `{ provider }`；未知 → exit 2。
- `delete`：不存在也 exit 0。
- 任何输出不得出现 apiKey/secretRef。

### B.2 边界

必须调用 `ProviderStore` 既有方法，**不得复制一份 profile 校验/读写**；不改 `provider switch` 语义。

### B.3 允许修改

```
apps/cli/src/providers/profileCommands.ts        (新增)
apps/cli/src/providers/profileCommands.test.ts   (新增)
apps/cli/src/cli.ts                              (接子命令)
apps/cli/src/cli.test.ts                         (最小用例)
```

### B.4 验证

```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/providers/profileCommands.test.ts
node node_modules/vitest/vitest.mjs run apps/cli/src/cli.test.ts
```

---

## C. 卡 T328：Web Provider Hub 的 profile 区块

### C.1 要做

1. `apps/web/src/api.ts` 增 `listProfiles` / `saveProfile` / `useProfile` / `deleteProfile`（沿用既有 request 封装）。
2. `ProviderSettingsModal.tsx`：供应商列表下方加 **Profiles** 区块，列出 `name / provider / model / baseUrl`；
   每行「启用」→ `useProfile(name)` → 成功刷新 provider 列表与 usage，给一行成功提示；
   空列表用占位文案（不是 0）；接口失败只影响该区块。
3. `i18n.ts` 中英文案都加，英文不含 CJK。

### C.2 边界

不在 Web 重算模型/端点；不新增状态库；不改 `/api/providers/usage` 形状；不做 profile 创建表单。

### C.3 允许修改

```
apps/web/src/api.ts
apps/web/src/components/providers/ProviderSettingsModal.tsx
apps/web/src/components/providers/ProviderSettingsModal.test.tsx
apps/web/src/i18n.ts
```

### C.4 验证

```powershell
node node_modules/vitest/vitest.mjs run --root apps/web src/components/providers/ProviderSettingsModal.test.tsx
node node_modules/vitest/vitest.mjs run --root apps/web
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
```

---

## D. 卡 T326：文档收口（只改文档）

1. `docs/PROVIDER-MANAGEMENT.md` 增 **§3.4 从 cc-switch 导出导入**：命令、默认 dry-run、key 只进
   `CredentialStore(secretRef)`、已存在跳过、`--prefix`、不读 cc-switch 数据库不写回。
2. 同文件增 **§3.5 供应商 profile 快照**：独立文件 `~/.vessel/provider-profiles.json`、
   形状 `{version:1, profiles:{name:{provider, model?, baseUrl?, label?}}}`、不存凭据不复制端点、
   四条 API 与状态码、`use` 只覆盖给定字段、provider 被删报悬空。
3. `docs/ARCHITECTURE.md`：provider 段补一句「profile 快照是独立文件，不参与凭据解析，也不复制端点池」。
4. `docs/MAGPIE-ABSORPTION.md`：对照表「切换与 profile」行改为已支持独立文件快照但无跨供应商/配额路由；
   P1-3 标「已吸收（T325）」、P2-2 标「已吸收（T324，仅从用户导出文件导入）」。

不许写「已支持跨供应商 failover / 配额感知路由 / profile 自动同步」。

---

## 5. 全量门禁（四段都做完后跑，全部通过才算完成）

本机单进程跑全量会在文件切换处挂起，按批跑：

```powershell
node node_modules/vitest/vitest.mjs run packages/shared packages/core
node node_modules/vitest/vitest.mjs run packages/llm
node node_modules/vitest/vitest.mjs run packages/behavior packages/context
node node_modules/vitest/vitest.mjs run packages/tools packages/policy
node node_modules/vitest/vitest.mjs run packages/runtime packages/memory
node node_modules/vitest/vitest.mjs run packages/skills packages/agents
node node_modules/vitest/vitest.mjs run packages/telemetry packages/engine
node node_modules/vitest/vitest.mjs run packages/application
node node_modules/vitest/vitest.mjs run apps/cli
node node_modules/vitest/vitest.mjs run apps/local-server
node node_modules/vitest/vitest.mjs run benchmarks/runners
node node_modules/vitest/vitest.mjs run index.test.ts
node node_modules/vitest/vitest.mjs run --root apps/web
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
```

任一条红就修到绿再继续；**不要用放宽断言的方式变绿**（尤其别把 `toEqual` 改成 `toMatchObject` 来绕过）。

## 6. 报告格式（最后一条消息只要这八行）

```
A profile HTTP：<四条路径 + 状态码 + 测试数>
B CLI：<四个子命令 + 测试数>
C Web：<Profiles 区块 + 测试数>
D 文档：<四处文件与新增小节>
providers.json 形态：<未改变的证据>
门禁：<15 条命令的退出码，或失败项与原因>
未做/偏离：<如实写，没有写「无」>
git status：<改了哪些文件>
```
