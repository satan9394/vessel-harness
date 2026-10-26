# Codex 应用 · 第二轮执行单（Ultra）：7 段，串行，禁止并行写同一文件

> 用法：Codex 应用（Ultra / GPT-6.1 Sol）打开 `E:\Code_file\Projects\Vessel_Harness`，把 `---` 之后整段粘贴。
> **Ultra 会开并行子代理**：并行只允许只读查看与跑测试；**同一文件同一时刻只允许一个写者**。
> 段与段之间串行：上一段的验证命令没过，不许开始下一段。

---

你是本仓库的实现者（唯一写者）。仓库根 `E:\Code_file\Projects\Vessel_Harness`，TypeScript + Node + npm workspaces + Vitest。

## 0. 硬规则

1. 不 commit、不 push、不 `git reset`、不改用户凭据、不跑 `--live`。
2. 不永久删除文件（测试自建且位于 `os.tmpdir()` 下的临时目录除外）。
3. 不动 `packages/core`；不改 usage 记录的既有字段语义与价目表。
4. 只改每段列出的路径；要越界就停下在报告里说。
5. 测试一律用 `mkdtemp` + 注入根，不读写真实 `~/.vessel`。
6. **并发规则**：可以并行读代码、并行跑不冲突的测试；**写文件严格串行**。下表是同文件冲突点，务必按顺序：

| 文件 | 涉及段 |
|---|---|
| `apps/local-server/src/server.ts` | E → F → J |
| `apps/web/src/components/providers/ProviderSettingsModal.tsx` | E → J |
| `apps/cli/src/usage/UsageStore.ts` | E → J |
| `apps/cli/src/cli.ts` | G → H |
| `apps/local-server/src/providers/ProviderStore.ts` | H |

## 先跑一遍基线（不许跳过）

```powershell
node node_modules/vitest/vitest.mjs run apps/local-server/src/providers apps/local-server/src/routes/providerRoutes.test.ts apps/local-server/src/server.test.ts
node node_modules/vitest/vitest.mjs run apps/cli/src/providers/profileCommands.test.ts
node node_modules/vitest/vitest.mjs run --root apps/web src/components/providers/ProviderSettingsModal.test.tsx
```

任一红就先修到绿再进入 E 段（这三处上一轮刚落地：profile 的 store/HTTP、CLI `provider profile` 四子命令、Web Profiles 区块）。

---

## E. 用量行的「最近调用时间」

1. `apps/cli/src/usage/UsageStore.ts` 的 `byProvider()` 每行加 `lastTs: string`：取该 provider 所有条目里最大的
   `lastTs`（ISO 字符串字典序即时间序；非法/缺失跳过）；没有可用时间时**不带字段**（不要空串/纪元）。
2. `apps/local-server/src/server.ts` 的 `usageByProvider` 行类型补 `lastTs?: string`（只透传）。
3. `apps/web/src/api.ts` 的 `listProviderUsage` 行类型补 `lastTs?: string`。
4. `ProviderSettingsModal.tsx` 卡片用量行追加「最近：<相对时间>」；无 `lastTs` 则整段不显示。
5. `i18n.ts` 中英都加，英文不含 CJK。

验证：

```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/usage
node node_modules/vitest/vitest.mjs run --root apps/web src/components/providers/ProviderSettingsModal.test.tsx
```

## F. `GET /api/providers/usage` 支持 `?since=` / `?until=`

1. `apps/local-server/src/server.ts`：在 usage 路由上解析 `since`/`until`（`YYYY-MM-DD`，与 CLI 的
   `usage --since/--until` 同口径，非法日期 → 400 `invalid_date`），过滤交给注入的读取器前先判断：
   若注入函数支持参数则传参，否则**在 server 内按行 `lastTs` 过滤**（不要新增第二套聚合）。
2. `apps/local-server/src/server.test.ts`：覆盖合法过滤、非法日期 400、无 `since` 时行为不变。
3. 不改 `/api/providers/usage` 现有字段名与 `totals` 形状。

验证：

```powershell
node node_modules/vitest/vitest.mjs run apps/local-server/src/server.test.ts
```

## G. `vessel usage --csv`

1. `apps/cli/src/cli.ts`：`vessel usage --csv` 输出 CSV（表头固定）：
   `provider,model,calls,input_tokens,output_tokens,cache_read_tokens,cache_creation_tokens,cost_usd,estimated`
   行来自 `store.byModel()`；数值不带千分位、成本 6 位小数；无记录时只输出表头并 exit 0。
2. `--csv` 与 `--json` 互斥 → 同时给报用法错误 exit 2。
3. `apps/cli/src/cli.test.ts`：表头、两行数据、无记录、互斥四条。

验证：

```shell
node node_modules/vitest/vitest.mjs run apps/cli/src/cli.test.ts
```

## H. 删除 provider 时的 profile 悬空保护

1. `apps/local-server/src/providers/ProviderStore.ts`：新增 `profilesFor(providerId): string[]`；
   `remove(id)` 默认在「仍有 profile 引用」时抛 `profile_in_use`（附带引用名列表，错误 message 用 `profile_in_use:<names>` 之类的稳定格式）；
   新增 `remove(id, { force: true })` 时同时删除引用该 provider 的 profiles（同一个原子写序，先写 profiles 再写 providers，失败不半途）。
2. `apps/cli/src/cli.ts`：`vessel provider rm <id>` 命中引用时打印被引用的 profile 名并提示 `--force`，
   退出码 2；`--force` 时先删 profiles 再删 provider，输出里点名删掉的 profile。
3. 测试：store 层（有引用拒绝/force 级联/无引用正常删）、CLI 层（两种路径 + 提示文案无 key）。

验证：

```powershell
node node_modules/vitest/vitest.mjs run apps/local-server/src/providers
node node_modules/vitest/vitest.mjs run apps/cli/src/cli.test.ts
```

## I. `provider export` ↔ `provider import` 往返保真

只补测试，不改生产语义（除非测试暴露真实缺陷，那就最小修复并说明）。

1. 新测试 `apps/cli/src/providers/providerRoundTrip.test.ts`：
   导出（Vessel 自家格式）→ 导入到空 store → 再导出，两次导出的**非敏感字段**逐字一致；
   key 不出现在两边的文本里；带 `endpoints`/`modelCapabilities` 的 provider 往返后仍在；
   冲突场景（同 id 已存在）默认跳过且不改变原记录。
2. 用 `mkdtemp` 假 CredentialStore，别碰真实凭据。

验证：

```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/providers/providerRoundTrip.test.ts
```

## J. 用量卡展开「按模型 Top 3」

1. `UsageStore.byProvider()` 每行加 `models: { model, tokens, costUsd, calls }[]`（按成本降序，最多 3 条；
   没有条目时给空数组）。`tokens = inputTokens + outputTokens`（与 Web 现有展示口径一致）。
2. `server.ts` 的 usage 行类型同步；`apps/web/src/api.ts` 同步。
3. `ProviderSettingsModal.tsx`：用量行加「展开」切换，展开后列出 `model · tokens · $cost`（最多 3 行）。
4. `i18n.ts` 中英都加。
5. 测试：聚合排序/截断、Web 展开与收起。

验证：

```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/usage
node node_modules/vitest/vitest.mjs run --root apps/web src/components/providers/ProviderSettingsModal.test.tsx
```

## D. 文档收口（最后做，只改文档）

1. `docs/PROVIDER-MANAGEMENT.md` 增 **§3.4 从 cc-switch 导出导入**：`vessel provider import --from <file> [--dry-run] [--yes] [--prefix p] [--json]`；
   默认预览；key 只进 `CredentialStore(secretRef)`；已存在跳过；`--prefix` 并存；不读 cc-switch 数据库、不写回。
2. 同文件增 **§3.5 供应商 profile 快照**：独立文件 `~/.vessel/provider-profiles.json`
   （`{version:1, profiles:{name:{provider, model?, baseUrl?, label?}}}`）；不存凭据不复制端点；
   四条 API 与状态码；`use` 只覆盖给定字段；provider 被删时报悬空。
3. 同文件补 **§3.6 删除与悬空保护**：`provider rm` 遇 profile 引用默认拒绝、`--force` 级联删 profiles。
4. 同文件补 **§3.7 用量导出**：`usage --csv` 字段表与 `--json` 的关系。
5. `docs/ARCHITECTURE.md`：provider 段补一句「profile 快照是独立文件，不参与凭据解析」。
6. `docs/MAGPIE-ABSORPTION.md`：对照表「切换与 profile」改为已支持独立文件快照但无跨供应商/配额路由；
   P1-3 标「已吸收（T325）」、P2-2 标「已吸收（T324，仅导出文件导入）」。

不许写「已支持跨供应商 failover / 配额感知路由 / profile 自动同步」。

---

## 收口门禁（七段都做完后跑；红就修，不许放宽断言）

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

## 报告（最后一条消息只要这九行）

```
基线：<三条命令结果>
E 最近调用：<byProvider.lastTs + Web 展示 + 用例数>
F since/until：<过滤语义 + 400 + 用例数>
G CSV：<表头 + 互斥 + 用例数>
H 删除保护：<profile_in_use + --force 级联 + 用例数>
I 往返：<两次导出差异为空 + key 不出现>
J Top3：<排序/截断 + Web 展开>
D 文档：<新增小节标题>
门禁：<16 条命令退出码，或失败项>
```
