# CC Switch 三模块源码精读 + 与本项目对比

> 任务：拉取 github.com/farion1231/cc-switch 源码，精读**供应商 / 统计 / 计价**三个模块，与本仓库对应实现对比，产出差距清单与改进建议。
> 性质：**调研产物**（docs/ideas/），不改任何产品代码；clean-room——只记录设计要点与文件路径，不搬运实现。
> 日期：2026-09-09 · 执行者：隔离执行器（子代理）

---

## 0. 源码获取方式与版本

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/farion1231/cc-switch` |
| 版本 | **v3.20.2**（`package.json` / `src-tauri/Cargo.toml` 均为 `3.20.2`；CHANGELOG 顶部 `[3.20.2] - 2026-09-07`） |
| commit | **`f3b18df12007d0fd79fd8ad8d310880664015197`**（`git ls-remote --heads origin main` 于抓取时刻） |
| 落地路径 | `.harness/reference/cc-switch/`（**`.harness/` 已在 `.gitignore` 第 4 行，源码不入库**） |
| 体量 | 约 47 MB / 10 个 app 预设文件 + 完整 Rust 后端 + React 前端 |

获取过程（命令各按纪律只尝试 1–2 次，失败如实记录，不重试）：

1. `git clone --depth 1 <url>`（直连）→ **180s 超时**，留下不完整 `.git`（7.5 MB，`your current branch appears to be broken`）→ 该目录已**走回收站**清理（`Microsoft.VisualBasic.FileIO.FileSystem::DeleteDirectory`）。
2. `git -c http.proxy=http://127.0.0.1:7897 clone --depth 1`（代理）→ 进程挂死、约 15 分钟无任何输出、`Get-Process git` 已无进程 → `job_kill` 中止（同样回收站清理残留）。
3. `git -c http.proxy=... ls-remote` → **4s 成功**，确认网络与代理可用、`main = f3b18df...`。
4. 改用 codeload tarball 走代理：`https://codeload.github.com/farion1231/cc-switch/tar.gz/refs/heads/main` → **30 MB / 182s** 下载成功 → 解压到 `.harness/reference/cc-switch/`（版本即上表）。

交叉核对：本机另有一份既有只读副本 `D:\workspaces\2026_08_17\cc-switch-src`（v3.20.0，commit `0b5da51`，tag v3.20.0）。逐文件比对三模块核心文件——`model_pricing.rs` / `usage_stats.rs` / `calculator.rs` / `usage_rollup.rs` / `providers.rs` / `modelsDevPricing.ts` / `types/usage.ts` **字节级一致**，仅 `schema.rs` 不同（v3.20.2 定价 seed 扩表 + 九月调价修复）。故本文结论对 v3.20.0/v3.20.2 均成立。

**边界声明**：全程**未读取本机 `~/.cc-switch/cc-switch.db`**（用户应用数据，与本任务无关，越界）。报告内不复制任何密钥；源码测试里的示例 key 一律以 `<redacted>` 处理。

---

## 1. 供应商模块

### 1.1 关键文件路径

| 层 | 路径 |
|---|---|
| 预设数据（前端） | `src/config/{claude,claudeDesktop,codex,gemini,grokBuild,hermes,openclaw,opencode,pi,universal}ProviderPresets.ts` |
| 预设/供应商类型 | `src/types.ts`（`ProviderPreset` / `Provider` / `ProviderMeta` / `ProviderCategory`） |
| 后端模型 | `src-tauri/src/provider.rs`（`Provider` / `ProviderMeta` / 凭据解析 `extract_credentials`） |
| 后端服务 | `src-tauri/src/services/provider/{mod,live,endpoints,usage,gemini_auth,pi}.rs` |
| 存储 DAO | `src-tauri/src/database/dao/{providers,providers_seed,universal_providers}.rs` + `database/schema.rs` |
| 命令层 | `src-tauri/src/commands/{provider,import_export,deeplink}.rs` |
| UI | `src/components/providers/{ProviderList,ProviderCard,AddProviderDialog,EditProviderDialog,AuthSettingsPanel,FailoverPriorityBadge,ProviderHealthBadge}.tsx` + `forms/hooks/*` |

### 1.2 数据结构

**预设（`ProviderPreset`）**：`name` / `nameKey`(i18n) / `websiteUrl` / `apiKeyUrl` / **`settingsConfig`（目标应用的配置片段对象）** / `isOfficial` / `isPartner` / `primePartner` / `category` / `apiKeyField`（`ANTHROPIC_AUTH_TOKEN` \| `ANTHROPIC_API_KEY`）/ **`templateValues`（模板变量：label/placeholder/defaultValue/editorValue）** / **`endpointCandidates[]`** / `theme`（icon/backgroundColor/textColor）/ `apiFormat`（`anthropic` \| `openai_chat` \| `openai_responses` \| `gemini_native`）/ `providerType`（`github_copilot` \| `codex_oauth` \| `xai_oauth`）/ `requiresOAuth` / `hidden` / `modelsUrl`。

预设规模（按 `websiteUrl:` 计数，v3.20.2 实测）：claude 90 / claudeDesktop 87 / codex 85 / hermes 79 / openclaw 78 / opencode 78 / pi 74 / grokBuild 41 / gemini 27 / universal 2 = **约 641 条**；分类计数：`aggregator` 243、`cn_official` 209、`third_party` 159、`official` 6、`cloud_provider` 5、`custom` 1、`omo` 1。同一厂商在多个 app 文件中重复出现（如 Claude 官方出现在 6+ 份文件里）。

**落库供应商（`providers` 表）**：`id` + `app_type` 复合主键，字段 `name` / **`settings_config`（JSON 文本，按 app 结构不同：Claude 是 settings.json 形态、Codex 是 `{auth, config}`）** / `website_url` / `category` / `created_at` / `sort_index` / `notes` / `icon` / `icon_color` / **`meta`（JSON）** / `is_current` / `in_failover_queue`。

**关联表**：`provider_endpoints`（provider_id+app_type → url, added_at，多端点与测速）、`provider_health`（健康度/连续失败/最后错误，供熔断与徽章）、`settings.universal_providers`（跨 app 统一供应商 JSON，带 `apps` 启用位）、`profiles`（跨 app 项目快照：供应商/MCP/Skills/Prompt 分槽）。

**`ProviderMeta` 要点**：`custom_endpoints` / `commonConfigEnabled` / `usage_script` / `endpointAutoSelect` / **`costMultiplier`** / **`pricingModelSource`** / `apiFormat` / `authBinding` / `apiKeyField` / `isFullUrl` / `promptCacheKey` / `promptCacheRouting` / `codexFastMode` / `impersonateClaudeCode` / `maxOutputTokens` / `customUserAgent` / `liveConfigManaged` / `providerType`。

### 1.3 核心逻辑

- **预设 → 卡片**：`settingsConfig` 是「目标 CLI 的配置片段」，加上 `templateValues` 的 `{{baseUrl}}`/`{{apiKey}}` 占位替换后写入对应 live 配置；`apiFormat` 决定是否经本地代理做协议转换。
- **增删改**：`ProviderService::{add,update,delete,list,current}`（`services/provider/mod.rs`）；`providers_seed.rs` 在启动时幂等 seed 官方供应商，保证「一键切回官方」入口始终存在。
- **切换（`switch`）**：先取 per-app 切换锁 → 判断 live 配置是否被**代理接管**（存在 live backup 或 live 里是代理占位）→
  - 接管中：**热切换**（只改 DB `is_current`，代理按 `is_current` 路由，不重启客户端）；
  - 未接管：`switch_normal` 写 live 配置文件（先备份原配置）。
  - 防呆：**接管模式下禁止切到官方供应商**（用代理访问官方 API 有封号风险，源码给出明确错误提示）。
- **导入导出**：`import_export.rs`（配置文件导入/导出、DB 备份轮转 `backup.rs`、`profiles` 快照）；`deeplink` 支持 `ccswitch://` 深链导入（v3.19.x 起对导入预览做递归脱敏）。
- **密钥处理**：API key 直接存在 provider 的 `settings_config` JSON 中（**明文随 SQLite 落盘**）；**没有** keyring/DPAPI 加密层。系统 keychain 仅用于读取 Claude/Codex/Gemini 的**订阅 OAuth 凭据**（`services/subscription.rs`）。安全投入集中在**日志/预览脱敏**（v3.18.0 起：结构化序列化器 + 正则链双层清洗，请求体一律不记）与**深链导入确认框**。
  - 备注：本仓库 V1.1-F 在用户旧库中观察到的 `{file:...}` 密钥引用，在 v3.20.2 源码中**已无该机制**（全仓 grep 无匹配），属旧版本/旧数据形态，勿据此设计。
- **UI 交互**：卡片列表 + 状态徽章（健康/失败切换）+ 拖拽排序（`update_sort_order`）+ 失败切换队列（`in_failover_queue`）+ 端点测速自动选优。

### 1.4 值得借鉴

1. **预设自带配置片段 + 模板变量**：一条预设 = 「端点 + 认证字段名 + 该 CLI 的配置骨架 + 变量占位」，填充即用，比我们的 `baseUrl+defaultModel` 信息密度高。
2. **`endpointCandidates` + 测速自动选优 + `provider_endpoints` 表**：多端点容灾，我们完全没有。
3. **接管态热切换 / 官方供应商防呆隔离**：切换语义分「写文件」与「只改路由」两种，且对高风险组合硬拦。
4. **启动 seed 官方入口**：任何情况下都有「切回官方」的确定路径（我们靠 mock 内置 + preset 目录，语义不同但目标一致）。
5. **`hidden` 标志**：预设可保留在代码里但不在 UI 暴露——适合我们收留长尾但不打扰用户。

### 1.5 潜在坑（我们要避开的）

1. **同一厂商在 10 个 app 文件里重复 6–8 次**：`base-url` 漂移与维护成本是结构性的；我们单应用 71 条单一事实源反而是优势。
2. **明文密钥落库**：任何能读 DB 的进程/备份都能拿到 key；我们 DPAPI + secretRef 明显更安全，**不要因为「cc-switch 也这样」而回退**（`ProviderStore.ts` 头部注释里那条「与 cc-switch 同款取舍」的说明已过时，建议改文案）。
3. **`third_party` 159 条分销长尾**：季度性开关/改名/改域，属于「会烂的数据」；我们「宁少而准」的取舍是对的。

---

## 2. 统计模块

### 2.1 关键文件路径

| 层 | 路径 |
|---|---|
| 代理侧采集 | `src-tauri/src/proxy/usage/{logger,parser,calculator,mod}.rs`（每条转发请求落一条明细） |
| 会话日志回填 | `src-tauri/src/services/session_usage.rs` + `session_usage_{codex,gemini,grokbuild,opencode,pi}.rs` |
| 聚合查询 | `src-tauri/src/services/usage_stats.rs`（4360 行）、`usage_cache.rs`、`sql_helpers.rs` |
| 存储/归档 | `src-tauri/src/database/dao/usage_rollup.rs` + `database/schema.rs` |
| 命令层 | `src-tauri/src/commands/usage.rs`、`src-tauri/src/usage_events.rs`（前端刷新通知） |
| 前端 | `src/components/usage/{UsageDashboard,UsageHero,UsageTrendChart,ProviderStatsTable,ModelStatsTable,RequestLogTable,RequestDetailPanel,UsageDateRangePicker,format}.tsx`、`src/types/usage.ts`、`src/lib/usageRange.ts`、`src/utils/usageDisplay.ts` |

### 2.2 数据结构

**明细表 `proxy_request_logs`**（PK `request_id`）：`provider_id` / `app_type` / `model` / **`request_model`（客户端请求的别名）** / **`pricing_model`（实际计价用的模型名）** / `input_tokens` / `output_tokens` / `cache_read_tokens` / `cache_creation_tokens` / **`input_token_semantics`** / 四项分成本 + `total_cost_usd`（**TEXT 存 Decimal**）/ `latency_ms` / `first_token_ms` / `duration_ms` / `status_code` / `error_message` / `session_id` / `provider_type` / `is_streaming` / `cost_multiplier` / `created_at` / **`data_source`（`proxy` \| `*_session`）**。索引覆盖 provider+app、created_at、model、session、status。

**日汇总表 `usage_daily_rollups`**（PK `date, app_type, provider_id, model, request_model, pricing_model`）：`request_count` / `success_count` / 四类 token / `total_cost_usd` / `avg_latency_ms` / `input_token_semantics`。

**辅助表**：`session_log_sync`（文件级增量游标：path + mtime + 行偏移）、`session_usage_dedup`（`data_source + request_id` 主键 + `semantic_id` 索引，去重账本）。

**对外结构**：`UsageSummary`（total_requests/total_cost/四类 token/**success_rate**/**real_total_tokens**/**cache_hit_rate**）、`UsageSummaryByApp`、`DailyStats`、`ProviderStats`（含 avg_latency）、`ModelStats`（含 avg_cost_per_request）、`RequestLogDetail`、`LogFilters`（app_type/provider_name/model/status_code/start_date/end_date）、`PaginatedLogs`。

### 2.3 核心逻辑

- **双数据源**：① 本地代理转发时逐条记录（最准，含延迟/首字节/状态码）；② **解析各 CLI 自己的本地会话数据**做回填——Claude Code 的 `~/.claude/projects/**/*.jsonl`、opencode 的 `~/.local/share/opencode/opencode.db`（SQLite）、Codex/Gemini/GrokBuild/Pi 各自的日志。无代理模式下也能出统计。
- **增量 + 去重**：按文件 mtime/偏移增量解析（`session_log_sync`），用 `semantic_id` 账本避免「代理已记的请求」被会话回填重复计入。
- **token 语义归一**：Codex/Gemini 的 `input_tokens` **包含** cache read/write，需先扣减再按输入价计费；Claude/Anthropic 的 `input_tokens` 已是 fresh input，不扣。语义以 `input_token_semantics` 列落库，查询时用 `fresh_input_sql()` 统一投影。
- **查询合并**：汇总 = 明细表聚合 + 日汇总表聚合求和；**只纳入被查询区间完整覆盖的「完整本地日」rollup 行**（`compute_rollup_date_bounds`），避免半天数据重复计数。app_type 维度做了折叠（`claude-desktop` → `claude`）。
- **保留与归档**：`rollup_and_prune(retain_days)` —— 超过保留期的明细按**本地日边界对齐**的 cutoff 聚合进日表后删除，SAVEPOINT 保证原子；**剪枝前先尽力回填 0 成本行**（源码注释明说剪枝不可逆、一旦删除就永远失去补价重算机会）。
- **展示**：Dashboard（Hero 总览 + 趋势图 + 按 app 分布）+ Provider/Model 排行 + 分页请求日志 + 请求详情面板 + 日期范围选择器。

### 2.4 值得借鉴

1. **双数据源 + 去重账本**：不依赖「必须走我的代理」才能统计。我们的等价物是 `iteration-store` 的事件流水——将来若加旁路入口，同样需要一张去重账本。
2. **明细 + 日汇总双层，且 rollup 行只在「完整本地日」参与查询**：既省查询，又不失真。这是把「性能」和「正确」同时解决的关键细节。
3. **`input_token_semantics` 落库**：把「input 是否含 cache」变成**数据**而不是代码分支——换供应商/协议时不用改查询。我们目前完全没有这个概念。
4. **成本回填**（定价修正后重算历史 0 成本行）：价格会变，历史成本要能跟着修正。
5. **成功率 / 缓存命中率 / 延迟 / 首字节**等运营指标，以及 `pricing_model ≠ model` 的双列设计（路由接管时真实上游模型与客户端别名不同）。

### 2.5 潜在坑

1. **4360 行单文件 + 大量手写 SQL 字符串拼接**：可读性与可测试性差（代价换来了完整的 SQL 能力）。
2. **剪枝不可逆**：源码自己承认「明细删了，0 成本行就永远失去补价机会」——这是用数据换性能，我们若学它必须先有「重算源」。
3. **成本用 TEXT 存 Decimal**：SQL 聚合要 `CAST(... AS REAL)`，跨表 JOIN 与排序成本高，且精度在 SQL 层又掉回浮点。
4. **数据源漂移**：6 类会话解析器各自依赖上游 CLI 的私有日志格式，上游一改就要跟。

---

## 3. 计价模块

### 3.1 关键文件路径

| 层 | 路径 |
|---|---|
| 定价存储/同步 | `src-tauri/src/services/model_pricing.rs` |
| 内置价目 seed + 调价修复 | `src-tauri/src/database/schema.rs`（`seed_model_pricing` / `repair_current_model_pricing`） |
| 成本计算 | `src-tauri/src/proxy/usage/calculator.rs`（`CostCalculator` / `CostBreakdown` / `ModelPricing`） |
| 查价与归一 | `src-tauri/src/services/usage_stats.rs`（`find_model_pricing` / `model_pricing_candidates`） |
| 命令层 | `src-tauri/src/commands/usage.rs`（get/update/update_batch/delete + models.dev 同步状态） |
| 前端 | `src/lib/modelsDevPricing.ts`、`src/components/usage/{PricingConfigPanel,PricingEditModal,ModelsDevAutoSyncPanel,ModelsDevPickerDialog}.tsx` |

### 3.2 数据结构

**表 `model_pricing`**（PK `model_id`）：`display_name` / `input_cost_per_million` / `output_cost_per_million` / `cache_read_cost_per_million` / `cache_creation_cost_per_million` —— 四列均为 **TEXT（Decimal 字符串）**。

**用户覆盖文件 `~/.cc-switch/model-pricing.json`**：
```
{ version, models_dev_sync{autoSyncEnabled, includeCommonModels,
    selectedModelKeys[], excludedCommonModelKeys[], lastSyncAt, lastSyncError},
  models[], deletedModelIds[] }
```
关键设计：**该文件只存「用户覆盖 + 删除墓碑」，内置价仍由 DB 拥有**——这样应用升级能继续修复内置价，而不会把内置价固化成覆盖值。

**内置价目**：`schema.rs` 中 `pricing_data` 数组（v3.20.2 实测 **92 条**，覆盖 Claude / GPT / Gemini / DeepSeek / Kimi / MiniMax / GLM / MiMo / Qwen / Grok / Mistral / Cohere / Doubao / Step 等）+ `repair_current_model_pricing`（**带旧值守卫的调价 UPDATE**，用于「官方改价」场景）。

### 3.3 核心逻辑

- **成本计算**（`CostCalculator`）：
  - 四项分别计：`token × 单价 / 1_000_000`，全程 `rust_decimal::Decimal`；
  - **cache 语义**：`calculate_for_app` 按 app 决定 input 是否含 cache——含则先 `saturating_sub(cache_read).saturating_sub(cache_creation)`；
  - **倍率只乘总额**：`total = (input+output+cache_read+cache_creation) × cost_multiplier`（provider 级倍率，用于中转站加价）；
  - 产出 `CostBreakdown{input_cost, output_cost, cache_read_cost, cache_creation_cost, total_cost}` 分别落库，可审计。
- **查价**（`find_model_pricing_row`）：先构造 **candidates 归一队列**——去命名空间前缀（`provider/`）、去 Claude Desktop 非 Anthropic 前缀、去 Bedrock 版本后缀、**去日期后缀**、去 reasoning effort 后缀、Claude 的 `.`→`-`；然后**先精确匹配、再前缀匹配**。命中即返回四价。
- **缺价处理**：**没有** protocol 级或 default 级兜底 —— 查不到价就**不计价（成本 0）**，但保留 `pricing_model`，以便日后补价后回填。
- **价格更新三通道**：
  1. **内置 seed**：随版本发布（`INSERT OR IGNORE`，不覆盖已存在的行）；
  2. **值守卫修复**：`repair_current_model_pricing` 用「旧值 + 新值」成对 UPDATE，**仅当现值等于旧值才更新**——用户手改过的行不会被版本升级覆盖；
  3. **models.dev 同步**：前端拉 `https://models.dev/api.json`（15s 超时、1h stale），过滤掉非文本/弃用模型，用户挑选要同步的模型 → 批量 upsert。**注意：批量同步会覆盖同名手动价**（源码测试明确断言此行为）。
- **历史回填**：定价变更后调用 `backfill_missing_usage_costs[_for_model]` 重算历史 0 成本行。
- **币种/单位**：USD / per-1M tokens，无汇率层。

### 3.4 值得借鉴

1. **值守卫修复（old-value guarded repair）**：既能随版本修正官方调价，又绝不覆盖用户手改——非常干净的「升级友好」模式。我们改 `pricing.json` 时无此保护（谁改谁赢）。
2. **覆盖文件与内置表分离 + 删除墓碑**：用户覆盖可 diff/可审计/可回滚，内置价仍可被版本修复。
3. **模型名 candidates 归一**（日期/命名空间/effort/点号后缀）：直接决定查价命中率，我们的 `findCatalogModelByBase` 只做 basename，命中率会低一截。
4. **`cache_creation` 独立一价**：Anthropic 的 cache write 价比 read 价贵一个量级（示例 3.75 vs 0.3），我们只记 `cacheRead`，会低估带 cache 写入的会话成本。
5. **定价变更后回填历史成本**。
6. **成本分项落库**（不是只存总额），事后可解释「钱花在哪」。

### 3.5 潜在坑

1. **内置价目 92 条硬编码在 Rust 里**：每次调价都要发版，只能靠 repair 表打补丁 → 长期累积成一堆「旧值守卫」补丁。
2. **无任何缺价回退**：未收录模型成本恒 0，用户容易误读为「没花钱」。我们相反——用 `default 0.5/1.5` 兜底，会把未知模型算成**假成本**，也是坑，且更隐蔽。
3. **models.dev 批量同步会静默覆盖手动价**。
4. **金额 TEXT 存储**：SQL 层精度回退 + 聚合成本高。

---

## 4. 与本项目对比

我们侧依据：`apps/cli/src/providers/{presets.data.ts,ProviderStore.ts,setup.ts,modelFetcher.ts,modelCatalog.ts,pricing.ts}`、`packages/application/src/credential/CredentialStore.ts`、`packages/application/src/projections/UsageProjection.ts`、`apps/cli/src/usage/UsageStore.ts`、`configs/{pricing.json,model-catalog.json}`、`packages/engine/src/iteration-store.ts`。

| 维度 | 我们（vessel / CAH） | CC Switch v3.20.2 |
|---|---|---|
| 预设组织 | 单文件 `presets.data.ts`，**71 条**，5 类（official/cn/intl/aggregator/local），厂商级实体 | 10 个按目标 app 分文件，**约 641 条**，7 类，含 159 条分销长尾 |
| 预设字段 | id/name/protocol/baseUrl/defaultModel/category/hint/auth | + `settingsConfig` 片段 / `templateValues` / `endpointCandidates` / `apiFormat` / `apiKeyField` / `theme` / `hidden` / `modelsUrl` |
| 配置存储 | `~/.vessel/providers.json` + `current.json`（JSON SSOT，原子写 tmp+rename） | SQLite `cc-switch.db`：`providers`(id,app_type) + `provider_endpoints` + `provider_health` + `universal_providers`(settings JSON) + `profiles` |
| 多应用支持 | 单应用（自研 harness 自身） | 10 个目标 CLI 各自的配置格式 |
| 切换语义 | 改 `current.json`，进程内**热生效** | 写 live 配置 + 备份；接管态可热切换；per-app 锁；官方供应商在接管态被硬拦 |
| 密钥安全 | **CredentialStore + Windows DPAPI 加密**，`secretRef` 引用，旧明文自动迁移（`ProviderStore` 已接线） | **明文存在 `settings_config` 里**；仅订阅 OAuth 凭据读系统 keychain；靠日志/预览脱敏 |
| 导入导出 | 无 | 文件导入导出 + DB 备份轮转 + profiles 快照 + 深链导入 |
| 统计采集 | `after_model` 事件（进程内单一源）→ `UsageStore.record()` | **代理拦截 + 6 类 CLI 会话日志回填**（双源 + 去重账本 + 增量游标） |
| 统计存储 | `~/.vessel/usage.json`：`provider::model` 聚合 + 200 条 recent 环形缓冲 | SQLite：明细表 + 日汇总表 + 剪枝 + 增量/去重表 |
| 统计维度 | 总量 / 按 provider / 按 model / 最近 N 条 | + 时间范围与趋势 / 按 app / 成功率 / 缓存命中率 / 延迟与首字节 / 分页明细 / 请求详情 |
| 计价表 | `configs/pricing.json`（7 模型 + 2 协议 + default）+ `configs/model-catalog.json`（**27 条**，models.dev 快照） | DB `model_pricing`（92 内置 + 用户覆盖 + models.dev 同步）+ 覆盖文件 + 删除墓碑 |
| 计价维度 | input / output / cacheRead | input / output / cache_read / **cache_creation** + `cost_multiplier` + 请求/响应计价源 |
| 查价回退 | model → catalog → protocol → **default 兜底** | **无兜底**（0 成本 + 保留 `pricing_model` 待回填） |
| 模型名归一 | `findCatalogModelByBase`（仅 basename） | 多级 candidates（命名空间/日期/effort/点号/Bedrock 版本） |
| 价格更新 | 手工改 JSON / 重新生成 catalog | seed + **值守卫修复** + models.dev 自动同步 + 历史成本回填 |
| 数值精度 | JS `number`（浮点） | `Decimal`（字符串存储） |

---

## 5. 差距清单

### 5.1 我们缺什么（cc-switch 有、我们没有）

| # | 差距 | 影响 |
|---|---|---|
| G1 | 统计**没有时间维度**：无时间窗口、无按日/按周趋势、无日聚合表 | 只能看累计，「这个月花了多少」答不出来 |
| G2 | 统计缺**成功率 / 缓存命中率 / 延迟**等运营指标 | 无法判断供应商质量 |
| G3 | 计价只有 `cacheRead`，**没有 `cache_creation`** | 带缓存写入的 Anthropic 会话成本被低估 |
| G4 | **没有模型名归一**（日期后缀/命名空间/effort 后缀） | 查价命中率低，大量模型落到 default |
| G5 | **定价变更后不回填历史成本** | 改价后历史数据与新数据口径不一致 |
| G6 | 价目是**静态快照**（`model-catalog.json` 27 条 + `pricing.json` 7 条），无自动同步 | 价目很快过期，需要人工重新生成 |
| G7 | 供应商缺**导入/导出与备份轮转** | 换机/迁移只能手抄 |
| G8 | 供应商缺**多端点 + 测速选优** | 单点故障无退路 |
| G9 | 缺 **provider 级成本倍率**（中转站加价） | 用第三方中转站时成本估算失真 |
| G10 | 缺 **`pricing_model ≠ model` 的双列**（路由别名场景） | 将来做模型路由时成本无法审计 |

### 5.2 我们做得更好（不要退回去）

| # | 优势 | 证据 |
|---|---|---|
| B1 | **密钥加密**：DPAPI + `secretRef` + 旧明文自动迁移 | `CredentialStore.ts`（`windows-dpapi` 后端、探活、fail-over）；cc-switch 明文落库 |
| B2 | **SSOT 简洁可审计**：providers.json 可 diff、可 review、原子写 | `ProviderStore.ts` `writeJsonAtomic` + fail-loud 校验 |
| B3 | **预设宁少而准**：71 条厂商级，不收长尾分销 | cc-switch `third_party` 159 条随季度烂掉 |
| B4 | **热生效无需重启客户端** | 我们改 `current.json` 即生效；cc-switch 需写 live 配置/重启对应工具 |
| B5 | **事件溯源底座**：统计理论上可从事件流水重算 | `packages/engine/src/iteration-store.ts` + `UsageProjection`；cc-switch 用不可逆剪枝换性能 |
| B6 | 有**查价回退链**（model→catalog→protocol→default） | cc-switch 无回退（代价是未知模型恒 0） |

### 5.3 值得借鉴（学设计，不抄实现）

| # | 借鉴点 | 出处 |
|---|---|---|
| L1 | **值守卫修复**：升级只改「现值仍等于旧值」的行，绝不覆盖用户手改 | `schema.rs::repair_current_model_pricing` |
| L2 | **覆盖与内置分离 + 删除墓碑**：用户覆盖单独成文件，内置表仍可被版本修复 | `model_pricing.rs` + `model-pricing.json` |
| L3 | **模型名 candidates 归一**（多级剥离后缀，先精确后前缀） | `usage_stats.rs::model_pricing_candidates` |
| L4 | **明细 + 日汇总双层，且 rollup 只在完整本地日参与查询** | `usage_rollup.rs::compute_local_midnight_cutoff` / `compute_rollup_date_bounds` |
| L5 | **token 语义落库**（`input_token_semantics`），而非写死代码分支 | `schema.rs` + `sql_helpers.rs` |
| L6 | **成本分项落库**，可解释、可回填 | `calculator.rs::CostBreakdown` |
| L7 | **缺价显式化 + 保留计价模型名待回填**（而不是静默算成某个默认价） | `find_model_pricing_row` 返回 `None` 的路径 |
| L8 | **倍率只乘总额**、四类 token 分项独立计价 | `calculator.rs` |
| L9 | **双数据源 + 去重账本**（同一请求多入口不重复计） | `session_usage_dedup` |
| L10 | 预设携带**配置片段 + 模板变量**，填充即用 | `ProviderPreset.settingsConfig/templateValues` |

### 5.4 我们的坑（比对方更隐蔽，要主动修）

| # | 坑 | 说明 |
|---|---|---|
| P1 | **default 兜底制造假成本**：`resolvePrice` 未知模型回落到 `0.5/1.5/0.1`，`UsageProjection` 同样有 `0.5/1.5/0.1` 硬编码兜底 | 用户看到的是「有成本」，实际是猜的；cc-switch 的 0 成本至少不会误导 |
| P2 | **两套计价实现**：`apps/cli/src/providers/pricing.ts`（有回退链）与 `packages/application/src/projections/UsageProjection.ts`（自己一套 rate + 硬编码默认） | 口径可能不一致，且 application 层无法读盘 |
| P3 | **`ProviderStore` 头部注释仍写着「apiKey 本地明文存储（与 cc-switch 同）…不做加密（YAGNI）」** | 与 034 之后的实现（DPAPI + secretRef）矛盾，误导后来者 |
| P4 | 金额用 JS `number` 累加 | 长尾多次累加有精度漂移风险 |

---

## 6. 改进建议（任务卡候选，按优先级；本任务**不实现**）

> 编号从 **085** 起（现有任务卡最大 084 / V1.1-F）。每条给出验收要点，便于直接拆卡。

### P0（先修正确性，成本不高）

| 卡 | 标题 | 内容 | 验收 |
|---|---|---|---|
| 085 | **计价命中率：模型名归一** | 新增 candidates 归一（去命名空间前缀 / 日期后缀 / reasoning effort 后缀 / Claude 点号→横线），`resolvePrice` 与 `modelCatalog` 查价共用 | 单测覆盖 ≥8 种真实模型名变体；未收录模型命中率提升可量化 |
| 086 | **成本可信度：缺价显式化** | `resolvePrice` 返回 `{price, source: 'model'\|'catalog'\|'protocol'\|'default', estimated: boolean}`；`UsageEntry` 增 `estimated`/`pricingSource`；`vessel usage` 明示「含估算」 | default 兜底的条目在统计里被标记；`--strict` 模式下不用 default |
| 087 | **统一计价实现** | 让 `UsageProjection` 复用同一份 `resolvePrice` 语义（注入 pricing 表 + catalog 源），删除其内部硬编码默认价 | 两条路径对同一模型返回相同价；回归测试绿 |
| 088 | **文案纠偏** | 修正 `ProviderStore.ts` 头部「明文存储 / 不做加密」注释，与 DPAPI 实现对齐 | 注释与代码一致，无「YAGNI」误导 |

### P1（能力补齐）

| 卡 | 标题 | 内容 | 验收 |
|---|---|---|---|
| 089 | **统计时间维度** | `UsageStore` 增按日分桶（`daily: Record<'YYYY-MM-DD', totals>`）；`vessel usage --since/--until/--by-day`；可选 cache 命中率/成功率（需先有失败事件） | 跨日聚合正确；原子写保持；测试覆盖日边界 |
| 090 | **cache_creation 计价** | `TokenPrice` 增 `cacheWrite?`；`UsageStore.record` 接收 `cacheCreationTokens`；`configs/pricing.json` 与 `model-catalog.json` 补该字段（缺则回退 cacheRead×倍率或标注） | 带 cache 写入的会话成本不再低估；测试断言分项 |
| 091 | **定价变更回填** | 提供 `vessel usage recompute`：按当前价目重算历史条目（事件溯源重放或按 `provider::model` 重算），幂等 | 改价后 recompute 结果与直接重跑一致；dry-run 模式 |
| 092 | **用户价目覆盖 + 值守卫** | 新增 `~/.vessel/pricing.override.json`（覆盖 + 删除墓碑），与 `configs/pricing.json` 分离；提供值守卫式迁移（仅当现值=旧值才改） | 用户覆盖不被内置更新覆盖；墓碑生效；单测覆盖 |

### P2（体验与扩展）

| 卡 | 标题 | 内容 | 验收 |
|---|---|---|---|
| 093 | **models.dev 同步** | `vessel pricing sync` 拉 models.dev 生成/更新 `model-catalog.json`（带选择/排除、超时、离线回退），不再依赖手工快照 | 离线时保留旧表并给出提示；同步不改用户覆盖 |
| 094 | **provider 成本倍率** | `ProviderConfig` 增 `costMultiplier?`，`UsageStore.record` 只乘总额 | 倍率只作用于 total；测试断言分项不变 |
| 095 | **供应商导入导出 + 备份轮转** | `vessel provider export/import <file>`（**导出默认脱敏**，key 走 secretRef 占位），`~/.vessel/backups/` 轮转 | 导入不落明文 key；备份可回滚 |
| 096 | **多端点 + 测速** | `ProviderConfig.endpoints[]`，`vessel provider endpoint add/remove/test` | 端点列表落盘；测速结果只作建议不改默认 |

### P3（观察项，暂不做）

- **明细/汇总双层 + 剪枝**（L4）：我们用量规模远小于 cc-switch，且事件溯源已可重算，暂无必要；若 `usage.json` 超过阈值再评估。
- **双数据源 + 去重账本**（L9）：等出现「代理 + 直连」双入口时再做。
- **`pricing_model ≠ model` 双列**（G10）：等 TaskRouter 真的做模型别名/路由时再做。

---

## 7. 结论（一句话）

CC Switch 的价值不在「供应商多」，而在**三件事的工程化**：预设即配置片段、统计的双源去重与双层归档、计价的「内置 + 覆盖 + 值守卫 + 回填」四件套。我们**密钥安全、SSOT 简洁、热生效、事件溯源可重算**四点已优于它，应当保持；**统计时间维度、cache_creation 计价、模型名归一、缺价显式化、定价回填**是最值得抄的五项设计——其中「缺价显式化」与「模型名归一」是 P0，因为我们现在正在**用默认价制造假成本**。

---

## 附录 A：clean-room 与安全声明

- 本文只记录设计要点与文件路径，**未搬运任何实现代码**；正文中的字段/表结构为「数据结构描述」，用于对比。
- 未复制任何密钥；源码中的示例 key 一律 `<redacted>`。
- **未读取、未修改**本机 `~/.cc-switch/` 下的任何应用数据。
- cc-switch 源码仅落在 `.harness/reference/`（已 gitignore），**不入库**；本次提交只含本报告。
- 清理动作全部走回收站（直连 clone 残留、代理 clone 残留各一次），无永久删除。

## 附录 B：抓取时点与复现命令

```powershell
# 版本确认（4s）
git -c http.proxy=http://127.0.0.1:7897 ls-remote --heads https://github.com/farion1231/cc-switch main

# 源码获取（30MB / 182s，替代 clone——clone 直连超时、走代理挂死）
Invoke-WebRequest -Uri 'https://codeload.github.com/farion1231/cc-switch/tar.gz/refs/heads/main' `
  -OutFile .harness\reference\cc-switch-main.tar.gz -Proxy 'http://127.0.0.1:7897' -TimeoutSec 600
tar -xzf .harness\reference\cc-switch-main.tar.gz -C .harness\reference\cc-switch --strip-components=1
```
