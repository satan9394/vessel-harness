# Magpie 对照与吸收清单（Vessel provider 模块）

> 性质：只读调研 + 吸收建议，**不含代码改动**。
> 对象：`https://github.com/yetone/magpie`（本地只读副本 `.harness/reference/magpie-main/`，Go 项目，已 gitignore）。
> 同期对照：`docs/ideas/CC-SWITCH-MODULE-STUDY.md`（cc-switch v3.20.2 三模块精读）与 Vessel 现状。
> clean-room：只记设计要点与文件路径，不搬运 Go 实现。
> 日期：2026-10-26。

---

## 1. 一句话结论

magpie 值得吸收的是**「供应商/账号/模型是三层数据 + 用量按 provider×model 落账 + 配额窗口在请求前扣减」**这套账本式设计；明确不吸收的是它的**本地网关（127.0.0.1:3425 多协议翻译）**、**订阅 OAuth 账号复用**、**明文 key 落盘**与**中间件插件体系**。

最直接的两项吸收已完成：**usage 的 `provider::model` 记录已提供按供应商的 CLI/Web/API 视图**（T317/T318），**Web 预设目录已从 application 真源生成**（T316）。

---

## 2. 三方对照表

| 维度 | magpie | cc-switch | Vessel 现状 |
|---|---|---|---|
| 预设与模型目录 | `internal/catalog/catalog.go`：`Model` 带 `Price`/`Efforts`/`APIs`/`Keys`，来源 models.dev + 厂商实时列表 | 预设带 `settingsConfig` 模板 + `templateValues`，约 641 条（10 个 app 文件重复） | 真源 `packages/application/src/providers/presets.data.ts`；Web 使用 `presets.generated.ts`，`presetsData.ts` 为薄壳（T316） |
| 供应商数据模型 | `internal/provider/provider.go`：`Provider` 含 `Was`/`Gave`（重命名历史）、`Preset`、`Key`、`AccessKeyID`；另有 `Group`/`Order` | `providers` 表（id+app_type）+ `provider_endpoints` + `provider_health` + `ProviderMeta` | `apps/cli/src/providers/ProviderStore.ts`（`~/.vessel/providers.json`）+ `secretRef`；端点已有 `vessel provider endpoint` 子命令 |
| 端点与容灾 | 账户/端点级 failover + `allowance_*` 系列（池化、最满、最近续期） | `endpointCandidates` + 测速自动选优 + `in_failover_queue` | 有端点候选与 `endpoint test`，已支持同一供应商内的运行时端点失败转移（T321）；无跨供应商失败转移或配额路由 |
| 切换与 profile | `magpie save work && magpie use work`（整套 agent 配置快照） | `profiles` 表（供应商/MCP/Skills/Prompt 分槽快照） | 只有当前供应商单值（`vessel provider switch`），无快照 |
| 用量与成本 | `internal/usage/usage.go`：`Record`（`provider`/`host`/`providerKeyId`/`account`）+ `Totals`（`calls/errors/retried/loops/input/output/cache_read/cache_write`） | 明细 `proxy_request_logs` + 日汇 `usage_daily_rollups` + 会话回填 + 去重账本 + `input_token_semantics` 落库 | `apps/cli/src/usage/UsageStore.ts`：键 `provider::model`，已含 `costUsd`/`cacheRead`/`cacheWritePriceSource`；已有按供应商聚合视图（T317/T318）与 input token 口径记录（T320） |
| 路由与配额 | `internal/routes/strategies.go`（`smart`/`order`/`rotate`/`usage`/`pace`）+ `internal/budget/budget.go`（窗口、在途预留、多窗口） | 无路由；失败转移队列 | 无路由组、无配额窗口；`packages/llm` 只有能力协商 |

---

## 3. 吸收清单

### P0-1 用量按供应商/模型出视图（用户明确要求）

- 解决什么：已补齐「钱花在哪个供应商」的视图（T317/T318）。
- 落点：`apps/cli/src/usage/UsageStore.ts`（只读聚合）、`apps/cli/src/cli.ts`（`vessel usage` 默认按供应商段，`--json` 的 `byProvider`）、`apps/local-server/src/server.ts`（`GET /api/providers/usage`）、`apps/web/src/components/providers/ProviderSettingsModal.tsx`（用量摘要）。
- 改动量：1–1.5 人日（CLI + API + Web 各一小块，数据集已存在）。
- 验收信号：`node apps/cli/dist/cli.js usage --json` 返回含 `byProvider` 的合法 JSON 且无记录时 exit 0；Web 有 token/成本摘要，无记录显示 `—`。

### P0-2 预设单一真源（消除 Web 手抄）

- 解决什么：已消除 `presetsData.ts` 与 `presets.data.ts` 两份手写的漂移风险（T316）。
- 落点：`scripts/sync-web-presets.mjs` + 生成物 `apps/web/src/components/providers/presets.generated.ts`；`apps/web/src/components/providers/presetsData.ts` 已退化为薄壳。显式检查入口：`npm run check:web-presets`。
- 改动量：0.5 人日。
- 验收信号：`--check` 幂等、`--write` 后 `--check` 仍 exit 0；Web 既有预设测试全绿。

### P1-1 `input_token_semantics` 落库

- 解决什么：不同协议对 `input_tokens` 是否含 cache 的定义不同；已记录口径，避免查询时丢失解释依据（T320）。
- 落点：`apps/cli/src/usage/UsageStore.ts` 的记录与聚合携带 `inputTokenSemantics`，口径定义在 `packages/shared/src/cacheMetrics.ts`；兼容旧记录。
- 改动量：0.5 人日 + 历史记录兼容。
- 验收信号：同一批 token 在两种语义下算出的成本不同、且可从记录字段复算；旧记录不报错。

### P1-2 端点失败转移（不引入本地网关）

- 解决什么：已补齐「主端点失败自动切候选」的执行路径（T321），仅限同一供应商。
- 落点：`apps/cli/src/providers/providerFactory.ts` 按候选端点构造运行时适配器；不引入本地网关。
- 改动量：1–2 人日（要定「哪些错误算可转移」）。
- 验收信号：注入一个必然失败的端点后，请求落到第二候选且审计留痕；全部失败时错误与现在一致。

### P1-3 供应商快照（profile）

- 解决什么：切供应商只能单值切换，没法「工作日用 A、周末用 B」整套切换。
- 落点：`apps/cli/src/providers/ProviderStore.ts` 增加命名快照（只存 provider id + model 选择），`vessel provider profile save|use|list`。
- 改动量：1 人日。
- 验收信号：保存两份快照后 `use` 能完整还原；快照里引用的供应商被删除时给明确错误。

### P2-1 值守卫式价目修复（cc-switch 的做法）

- 解决什么：`configs/pricing.json` 现在谁改谁赢，升级内置价会覆盖用户手改。
- 落点：`apps/cli/src/usage/pricingOverride.ts` 之外的「内置价修复」路径（新增 patch 表：旧值匹配才改）。
- 改动量：0.5 人日。
- 验收信号：用户改过的行在版本升级后保持；未改过的行被修到新价。

### P2-2 从 cc-switch 导入供应商

- 解决什么：已经有 cc-switch 的用户要重配一遍。
- 落点：`apps/cli/src/providers/` 新增只读导入器（解析 cc-switch 的 `providers` 表导出或配置文件），冲突默认跳过。
- 改动量：1 人日。
- 验收信号：导入 N 条后条目数正确、同名跳过并报告、`secretRef` 语义不被破坏。

---

## 4. 不吸收清单（附理由）

| 不吸收 | 理由 |
|---|---|
| 本地网关 `127.0.0.1:3425`（多协议翻译） | Vessel 自身就是 harness，provider 抽象已在进程内完成协议适配；再套一层网关会形成第二套模型解析与第二份计费真相 |
| 订阅 OAuth 账号复用（读 Claude Code / Codex 登录态） | 属于跨产品复用用户登录凭据，越界；Vessel 的凭据契约是 `secretRef` + `CredentialStore` |
| 明文 key 落盘（magpie `Provider.Key`、cc-switch `settings_config`） | Vessel 已有 `secretRef` 隔离，回退会降低安全性；cc-switch 研究里也明确「不要因为 cc-switch 也这样而回退」 |
| 中间件插件体系（`onRequest`/`onEvent`/`onResponse`） | 语义与 Vessel 的 Policy Engine（Prompt Guidance + Tool Interceptor + Runtime Deny + Audit）重叠；两套并存会让「谁在拦」不可判 |
| 自动账号发现（扫描各 CLI 的登录文件） | 同上，且会引入不可控的隐式网络身份 |

---

## 5. 给后续卡的硬边界

- **T316（预设生成物）**：只做 `presetsData.ts` 退化 + 生成脚本；不改预设内容、不给 Web 加 `@vessel/*` 依赖。
- **T317（CLI 用量）**：只读 `UsageStore`，不重算倍率、不改记录结构；成本直接取记录里的 `costUsd`。
- **T318（Web/API 用量）**：聚合逻辑只写一次（纯函数），CLI 与 local-server 共用；无记录显示 `—`，不显示 0。
- **T319（文档收口）**：只改 `docs/PROVIDER-MANAGEMENT.md` 与 `docs/ARCHITECTURE.md` 的相关段；当时不声称已支持 failover / 配额 / 导入；同一供应商端点失败转移后由 T321 吸收。

- **已吸收（T320）**：`input_token_semantics` 口径落库，见 `apps/cli/src/usage/UsageStore.ts` 与 `packages/shared/src/cacheMetrics.ts`。
- **已吸收（T321）**：同一供应商运行时端点失败转移，见 `apps/cli/src/providers/providerFactory.ts`；不扩展为跨供应商 failover 或配额路由。
- **尚未实现，留待后续**：profile 快照（P1-3）、价目值守卫（P2-1）、cc-switch 配置导入（P2-2）。
