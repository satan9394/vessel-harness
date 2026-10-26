# Codex 应用 · 第二轮（Ultra）：7 段串行

> 依据（2026-10-26 核对）：
> - `learn.chatgpt.com/api/docs/guides/reasoning-best-practices`：keep prompts simple and direct；
>   避免 chain-of-thought 提示（「think step by step」「explain your reasoning」无益甚至有害）；
>   用分隔符；显式约束；把**成功判据**写具体。
> - `learn.chatgpt.com/api/docs/guides/model-selection`：GPT-6.1 Sol · Medium 定位是
>   「complex technical work and coordinated deliverables you expect to revise」——本批正是这类活；
>   Sol · Extra high 面向「polished deliverables / conflicting evidence」。
> - Codex 应用的 **Ultra 是并行子代理协调档**（不是 API 的 effort 取值），因此必须写死并发写规则。
>
> 用法：把 `---` 之后整段贴进 Codex 应用（Ultra / GPT-6.1 Sol），仓库根 `E:\Code_file\Projects\Vessel_Harness`。

---

## 上下文

仓库 `E:\Code_file\Projects\Vessel_Harness`。TypeScript + Node + npm workspaces + Vitest。
目标是补齐 provider 模块的用量与完整性能力。按 E → F → G → H → I → J → K → L → M → N → P → Q → D 顺序做。

## 约束

- 不 commit / push / git reset；不跑 `--live`；不改用户凭据。
- 不永久删除文件（测试自建 `os.tmpdir()` 临时目录除外）。
- 不动 `packages/core`；不改 usage 既有字段语义与价目表。
- 只改各段列出的文件。
- 测试用 `mkdtemp` 注入根，不读写真实 `~/.vessel`。
- 并发：并行只用于只读查看与跑测试；**同一文件同一时刻只有一个写者**。

| 文件 | 顺序 |
|---|---|
| `apps/cli/src/usage/UsageStore.ts` | E → J → Q |
| `apps/local-server/src/server.ts` | E → F → J → Q |
| `apps/web/src/api.ts` | E → J → Q |
| `apps/web/src/components/providers/ProviderSettingsModal.tsx` | E → J → L → P → Q |
| `apps/cli/src/cli.ts` | G → H → K → M |
| `apps/local-server/src/providers/ProviderStore.ts` | H → M |

## 前置

这三处上一轮已落地，先跑；任一红先修到绿：

```powershell
node node_modules/vitest/vitest.mjs run apps/local-server/src/providers apps/local-server/src/routes/providerRoutes.test.ts apps/local-server/src/server.test.ts
node node_modules/vitest/vitest.mjs run apps/cli/src/providers/profileCommands.test.ts
node node_modules/vitest/vitest.mjs run --root apps/web src/components/providers/ProviderSettingsModal.test.tsx
```

## E · 用量行「最近调用时间」

Goal：`byProvider()` 每行带 `lastTs`，Web 卡片显示相对时间；无可用时间时不显示。

Files：
- `apps/cli/src/usage/UsageStore.ts`：`byProvider()` 行加 `lastTs: string`，取该 provider 条目里最大 `lastTs`；
  非法/缺失跳过；无可用时间时不带该字段（不要空串/纪元）。
- `apps/local-server/src/server.ts`：`usageByProvider` 行类型加 `lastTs?: string`（透传）。
- `apps/web/src/api.ts`：`listProviderUsage` 行类型加 `lastTs?: string`。
- `ProviderSettingsModal.tsx`：用量行追加「最近：<相对时间>」；无 `lastTs` 整段不显示。
- `i18n.ts`：中英都加，英文不含 CJK。

Verify：
```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/usage
node node_modules/vitest/vitest.mjs run --root apps/web src/components/providers/ProviderSettingsModal.test.tsx
```
Done：两条命令 exit 0；有 `lastTs` 显示相对时间，无则不显示。

## F · `/api/providers/usage` 的 `since` / `until`

Goal：支持 `?since=YYYY-MM-DD&until=YYYY-MM-DD`，与 CLI 的 `usage --since/--until` 同口径；非法日期 400 `invalid_date`。

Files：`apps/local-server/src/server.ts`、`apps/local-server/src/server.test.ts`。
实现约束：过滤按行 `lastTs` 做；不新增第二套聚合；`totals` 形状与字段名不变。

Verify：
```powershell
node node_modules/vitest/vitest.mjs run apps/local-server/src/server.test.ts
```
Done：合法区间过滤生效、非法日期 400、不带参数时行为与现在一致。

## G · `vessel usage --csv`

Goal：`--csv` 输出固定表头 CSV；`--csv` 与 `--json` 互斥（exit 2）。

Files：`apps/cli/src/cli.ts`、`apps/cli/src/cli.test.ts`。
表头：`provider,model,calls,input_tokens,output_tokens,cache_read_tokens,cache_creation_tokens,cost_usd,estimated`
规则：数据来自 `store.byModel()`；成本 6 位小数；无记录只输出表头并 exit 0。

Verify：
```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/cli.test.ts
```
Done：表头、两行数据、无记录、互斥四条用例通过。

## H · 删除 provider 的 profile 悬空保护

Goal：仍有 profile 引用时默认拒绝删除；`--force` 级联删除引用 profile。

Files：`apps/local-server/src/providers/ProviderStore.ts`、`apps/cli/src/cli.ts` 及其测试。
- store：`profilesFor(id): string[]`；`remove(id)` 有引用时抛稳定错误（含引用名）；`remove(id, { force: true })` 先删 profiles 再删 provider，失败不半途。
- CLI：命中引用时打印 profile 名并提示 `--force`，exit 2；`--force` 时点名删掉的 profile。

Verify：
```powershell
node node_modules/vitest/vitest.mjs run apps/local-server/src/providers
node node_modules/vitest/vitest.mjs run apps/cli/src/cli.test.ts
```
Done：拒绝、级联、无引用正常删三条路径都有用例且 exit 0。

## I · `provider export` ↔ `provider import` 往返

Goal：往返不丢非敏感字段，key 不出现在任何文本。

Files：新增 `apps/cli/src/providers/providerRoundTrip.test.ts`（只补测试；若暴露真实缺陷，最小修复并在报告说明）。
覆盖：导出→导入空 store→再导出，非敏感字段逐字一致；key 不出现；`endpoints`/`modelCapabilities` 保留；
同 id 已存在时默认跳过且不改原记录。用假 CredentialStore + `mkdtemp`。

Verify：
```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/providers/providerRoundTrip.test.ts
```
Done：上述断言全绿。

## J · 用量卡「按模型 Top 3」

Goal：`byProvider()` 每行带 `models: {model, tokens, costUsd, calls}[]`（成本降序，最多 3 条，空则 `[]`）；
Web 卡片可展开显示。

Files：`apps/cli/src/usage/UsageStore.ts`、`apps/local-server/src/server.ts`、`apps/web/src/api.ts`、
`ProviderSettingsModal.tsx`、`i18n.ts` 及测试。
口径：`tokens = inputTokens + outputTokens`。

Verify：
```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/usage
node node_modules/vitest/vitest.mjs run --root apps/web src/components/providers/ProviderSettingsModal.test.tsx
```
Done：排序/截断有断言；展开与收起可用。

## K · CLI 人读「按供应商 Top 3 模型」

Goal：`vessel usage` 人读输出里，每个供应商段后缩进列出最多 3 行 `model · tokens · $cost`（成本降序）；
`--json` 输出不变。

Files：`apps/cli/src/cli.ts`、`apps/cli/src/cli.test.ts`（依赖 J 的 `models` 字段）。

Verify：
```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/cli.test.ts
```
Done：有模型时缩进行数与顺序正确；无模型时不额外输出；`--json` 未变。

## L · Web 显示「未配置密钥」

Goal：`apiKeyMasked` 为空时卡片显示温和提示「未配置密钥」；有掩码时保持现状。

Files：`ProviderSettingsModal.tsx`、`i18n.ts`、`ProviderSettingsModal.test.tsx`。

Verify：
```powershell
node node_modules/vitest/vitest.mjs run --root apps/web src/components/providers/ProviderSettingsModal.test.tsx
```
Done：两种状态各一条断言；英文无 CJK。

## M · `provider profile rename`

Goal：`vessel provider profile rename <old> <new>`；`new` 已存在 → exit 2；`old` 不存在 → exit 2；
profile 内容与引用的 provider 不变。

Files：`apps/local-server/src/providers/ProviderStore.ts` 及测试、`apps/cli/src/cli.ts` 及测试。

Verify：
```powershell
node node_modules/vitest/vitest.mjs run apps/local-server/src/providers
node node_modules/vitest/vitest.mjs run apps/cli/src/cli.test.ts
```
Done：重命名前后 `listProfiles` 内容一致、name 变化；两种失败路径有断言。

## N · API 与 CLI 的 profile 行为一致性快照

Goal：同一临时 store 上，CLI 与 HTTP API 的 list/save/use/delete 结果一致（字段集合与顺序）；
捕获两套 DTO 漂移。只补测试，不改生产。

Files：新增 `apps/local-server/src/routes/profileParity.test.ts`。

Verify：
```powershell
node node_modules/vitest/vitest.mjs run apps/local-server/src/routes/profileParity.test.ts
```
Done：四个操作的一致性断言全绿；失败时能指出哪一侧字段不同。

## P · Provider Hub 按名称过滤

Goal：供应商多于 5 个时显示搜索框，按 `name`/`baseUrl` 子串过滤（大小写不敏感）；清空恢复全部。

Files：`ProviderSettingsModal.tsx`、`i18n.ts`、`ProviderSettingsModal.test.tsx`。

Verify：
```powershell
node node_modules/vitest/vitest.mjs run --root apps/web src/components/providers/ProviderSettingsModal.test.tsx
```
Done：过滤命/未命中/清空三条断言；英文无 CJK。

## Q · 用量口径可见（T320 字段）

Goal：`byProvider()` 行加 `inputTokenSemantics?: 'cache-inclusive' | 'cache-exclusive' | 'mixed'`
（该 provider 各条目不一致 → `mixed`；无值时不带字段）；server/api 类型同步；
Web 卡片显示「口径：…」，无值不显示。

Files：`apps/cli/src/usage/UsageStore.ts` 及测试、`apps/local-server/src/server.ts`、`apps/web/src/api.ts`、
`ProviderSettingsModal.tsx` 及测试、`i18n.ts`。

Verify：
```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/usage
node node_modules/vitest/vitest.mjs run --root apps/web src/components/providers/ProviderSettingsModal.test.tsx
```
Done：聚合规则（同值/不一致/无值）有断言；Web 三种状态渲染正确。

## D · 文档（只改文档）
Files：`docs/PROVIDER-MANAGEMENT.md`、`docs/ARCHITECTURE.md`、`docs/MAGPIE-ABSORPTION.md`。
- `§3.4 从 cc-switch 导出导入`：命令、默认 dry-run、key 只进 `CredentialStore(secretRef)`、已存在跳过、`--prefix`、不读 cc-switch 库不写回。
- `§3.5 供应商 profile 快照`：独立文件 `~/.vessel/provider-profiles.json` 与形状；不存凭据不复制端点；四条 API 与状态码；`use` 只覆盖给定字段；provider 被删报悬空。
- `§3.6 删除与悬空保护`：`provider rm` 默认拒绝、`--force` 级联删 profile。
- `§3.7 用量导出`：`usage --csv` 字段表，与 `--json` 互斥。
- `ARCHITECTURE.md`：profile 快照是独立文件，不参与凭据解析。
- `MAGPIE-ABSORPTION.md`：对照表「切换与 profile」改为已支持独立文件快照但无跨供应商/配额路由；P1-3 标已吸收（T325）；P2-2 标已吸收（T324）。

Verify：
```powershell
node scripts/sync-web-presets.mjs --check
```
Done：四处改动可定位；未写「已支持跨供应商 failover / 配额感知路由 / profile 自动同步」。

## 收口门禁

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

## 报告

只给这九行，不要复述过程：

```
基线：<三条命令结果>
E：<lastTs + Web 展示 + 用例数>
F：<过滤 + 400 + 用例数>
G：<CSV 表头 + 互斥 + 用例数>
H：<拒绝 + 级联 + 用例数>
I：<往返差异 + key 是否出现>
J：<排序截断 + 展开>
K：<CLI Top3 输出 + 用例数>
L：<未配置密钥提示 + 用例数>
M：<rename 成功/两种失败 + 用例数>
N：<API/CLI 一致性 + 用例数>
P：<过滤三条 + 用例数>
Q：<口径聚合 + Web 三态>
D：<新增小节标题>
门禁：<16 条退出码，或失败项>
```
