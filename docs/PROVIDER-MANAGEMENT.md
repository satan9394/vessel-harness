# 供应商配置管理（PROVIDER-MANAGEMENT.md）

> 版本：2026-09（V0.8：品牌 Vessel）· 对标 cc-switch 的"配置管理/一键切换"体验，但本项目自己是 Harness 运行时
> 关联：docs/VESSEL.md（品牌与运行）、docs/PROVIDER-INTEGRATION.md（协议层接入）、docs/MISSION-V0.4.md（TaskRouter 多模型路由）、docs/ideas/PROVIDER-TUI-RESEARCH.md（交互/供应商/权限设计调研）
> 命令前缀：**`vessel`**（V0.9 起唯一命令名，cah 已彻底移除）

---

## 1. 一句话

把"供应商 + 模型"存成可管理的配置（`~/.dsh/providers.json`），`vessel provider switch` 一键切换默认供应商，`vessel models` 拉取可用模型——`vessel run` 不传参时自动用当前默认供应商跑。**直接敲 `vessel` 进入交互对话界面**（opencode 式），供应商配置/模型/权限全是界面内斜杠命令，不用先记参数。

## 1.5 交互体验（一条命令开始）

```powershell
vessel         # 直接进交互对话（需要终端）：输入文字跑任务，斜杠命令管配置
vessel setup   # 或：引导式配置供应商向导（搜索选→key→拉模型→勾选）
```

TUI 内斜杠命令：`/provider`（配置供应商）、`/models`（当前供应商模型）、`/model <id>`（切模型）、`/permission`（切权限）、`/help`、`/quit`。全局 `vessel` 命令：`npm link ./apps/cli` 后任意目录可用。

## 1.6 供应商目录（71 条）

内置 71 个预填端点的供应商（数据在 `packages/application/src/providers/presets.data.ts`——task 098 起由 `apps/cli` 下沉到 application 层，CLI 向导与 benchmark runner 共用同一 SSOT，避免 `tsc -b` 项目图成环；来源见 `docs/ideas/PROVIDER-TUI-RESEARCH.md` §A3）：官方国际（Anthropic/OpenAI/Gemini/xAI/Groq/Mistral…）、国产官方（DeepSeek/Qwen/Kimi/GLM/MiniMax/豆包/混元/百炼/千帆…）、聚合（OpenRouter/硅基流动/魔搭/Novita/302AI…）、本地（Ollama/vLLM/LM Studio/llama.cpp/Jan）+ mock。向导里按类别标签（[官方]/[国产]/[国际]/[聚合]/[本地]）搜索即得，"自定义端点"随时可加。

## 1.7 权限三档（对齐市面 agent）

`--permission <mode>`（run）或 TUI `/permission`：
| 模式 | 行为 |
|---|---|
| read-only | 只读探索：Read/Grep/Glob 放行，写/执行拒绝 |
| workspace-write（默认） | 写工作区放行，高危操作 fail-closed 拒绝 |
| danger-full-access | 全权限（protected 路径与 .env 读取仍拒绝，保留电路熔断） |

映射到既有 policy profile（`configs/policy.default.yaml` 的 read-only/workspace-write/danger-full-access）+ approval never。

---

## 2. 存储（SSOT）

| 文件 | 内容 |
|---|---|
| `~/.vessel/providers.json` | 供应商列表（id/name/protocol/baseUrl/endpoints?/secretRef/model/models?/costMultiplier?/note?）——含密钥的写 `secretRef`（`credential:vessel/<id>`），不再落明文 apiKey |
| `~/.vessel/secrets.json` | 凭据存储（task 034）：Windows 默认 DPAPI 加密（`ProtectedData`），否则 plaintext 显式降级（写时 warn 提示） |
| `~/.vessel/current.json` | 当前默认供应商 id（缺省 `mock`） |
| `~/.vessel/backups/` | 写前自动备份（task 095）：`providers.<ts>.json` / `current.<ts>.json`，每类保留 N 份（默认 5） |

- 目录沿用项目 ~/.vessel 约定（memory/skills 同款）。
- 原子写：先写 `.tmp` 再 rename，防半写损坏（task 113 起 rename 统一走
  `@vessel/shared` 的 `renameWithRetry`：EPERM/EBUSY/EACCES 有界重试 3 次、5/15ms 退避）。
- **apiKey 经 CredentialStore 管理（`packages/application/src/credential/`）**：
  - 后端选择（069 起显式 probe + fail-over，不静默）：`probeBackends()` 探测各 OS 凭据后端可用性 →
    `selectBackend()` 按优先级取首个可用 OS 后端；全部不可用才降级 plaintext，并把每个被跳过
    后端的 reason（平台不符/工具链缺失）随 warn 一并输出，供用户对照平台矩阵排查。
  - 平台支持矩阵（069）：
    | 平台 | 首选后端 | 探测条件 | 本机可测 |
    |---|---|---|---|
    | Windows | `windows-dpapi`（ProtectedData，绑定当前用户） | platform=win32 且 PowerShell/ProtectedData 就绪 | ✅（DPAPI 真实现 + 往返自检 `probe()`） |
    | macOS | `macos-keychain`（适配层占位，未注册实现） | platform=darwin 且 `security` 可用 | ❌（本机不可测；探测/选择逻辑已实现并测试） |
    | Linux | `linux-libsecret`（适配层占位，未注册实现） | platform=linux 且 `secret-tool`(libsecret) 可用 | ❌（同上） |
    | 全部不可用 | `plaintext` 显式降级 | — | ✅（写时 console.warn 不静默） |
  - 降级路径：OS 后端全部不可用 → `PlaintextCredentialStore`（明文 + 每次写入 console.warn）。
    降级后 secret 未加密落盘 secrets.json，泄露风险等同旧版明文存储——不要把 `~/.vessel`
    同步到不受信的地方。
  - 错误边界（069）：损坏文件默认 fail loud（`CredentialError`，延续 034 语义）；显式
    `recoverCorrupted: true` 时损坏文件改名隔离为 `secrets.json.corrupted-<ts>` 备份并以空结构
    继续（改名留档非删除）；IO/权限失败统一抛带 errno `code` 的 `CredentialError`；运行时
    可用性可用 `store.probe()` 自检（DPAPI 做真实 Protect/Unprotect 往返）。
  - 读取时 ProviderStore 自动把 secretRef 解析回 apiKey（`get(id).apiKey` 无感可用）。
  - 旧 providers.json 含明文 apiKey → 加载时自动迁入 store 并改写为 secretRef（原子写；幂等）。
  - 仍别把 `~/.vessel` 同步到不受信的地方——非 Windows 降级明文时泄露风险等同旧版。
- 测试/多环境隔离：设 `VESSEL_PROVIDER_ROOT` 环境变量可改存储根（CI/测试不碰真实 ~/.vessel；唯一环境变量）。
- `mock` 是内置供应商：永不持久化、不可删除、`list` 首项、无配置时默认。

## 3. 命令参考

```powershell
# 查看所有供应商（* = 当前默认）
vessel provider list

# 当前默认
vessel provider current

# 添加（真实协议需 --base-url；--model 建议指定真实模型）
vessel provider add ds --protocol openai-compatible --base-url https://api.deepseek.com/v1 --api-key <key> --model deepseek-chat
vessel provider add ant --protocol anthropic --base-url https://api.anthropic.com --api-key <key> --model claude-sonnet-4-5

# 删除 / 切换
vessel provider remove ds
vessel provider switch ant        # 或 use

# 拉取可用模型
vessel models                     # 当前默认供应商的模型
vessel models --provider ds       # 指定供应商
```

## 3.1 导入导出与备份轮转（task 095）

```powershell
# 导出（默认脱敏：apiKey 永不出现在导出文件里）
vessel provider export --out providers-export.json   # 写文件（原子写：.tmp → rename）
vessel provider export > providers-export.json       # 不传 --out → JSON 打到 stdout，可直接重定向

# 导入（合并；同名冲突默认跳过）
vessel provider import providers-export.json                       # 默认 --on-conflict skip
vessel provider import providers-export.json --on-conflict overwrite
vessel provider import providers-export.json --dry-run             # 只预演，不写盘
vessel provider import providers-export.json --keep 10             # 本次写盘保留 10 份备份
```

**导出脱敏语义（硬要求，没有例外）**

| 情形 | 导出结果 |
|---|---|
| 配置有明文 apiKey（旧格式/未启用凭据库） | 剥离 `apiKey`，写 `secretRef: credential:vessel/<id>` **占位引用** |
| 配置已有 secretRef | 原样保留该**引用**（引用不是密钥，它指向本机凭据库） |
| `secretRef` 里被塞了非 `credential:` 的值 | 一律替换为占位引用（防止任何形态的明文密钥被导出） |
| `--with-secrets` | **直接拒绝（exit 2）**——本项目不存在明文导出路径 |

- 导出文件是信封结构：`{kind: "vessel-provider-export", version: 1, exportedAt, redacted: true, keysRedacted, current, count, providers[]}`；`buildExport()` 落盘前自检「序列化结果里不得出现 `apiKey` 字段」，命中即抛错拒绝输出。
- **换机迁移**：导出文件不含密钥；密钥要么整体搬运 `~/.vessel`（含 DPAPI 加密的 secrets.json），要么在新机器 `vessel provider set <id> --api-key <key>` 重新录入（经 CredentialStore 加密落盘，不进 providers.json）。
- **导入合并策略**：默认 `skip`（同名 id 保留本地）；`--on-conflict overwrite` 用文件内容覆盖，但**文件未带密钥时保留本地 secretRef 绑定**（避免覆盖把本机密钥引用弄丢）；非交互 CLI 不「询问」。内置 `mock` 一律跳过；文件里的明文 `apiKey`（手写/第三方文件）一律剥离并在结果里报告。全部同名跳过时**不写盘**（无变更）。
- 文件校验 fail loud：非 JSON、缺 `kind`、`version` 不匹配、`protocol` 非法、id 重复 → 抛错且一个字节都不写。

**备份轮转（写配置前自动备份）**

- 每次写 `providers.json` / `current.json` **之前**，把旧文件字节原样复制到 `~/.vessel/backups/<kind>.<ISO 时间戳>.json`（可直接拷回目标文件回滚）。
- 保留份数：默认 5，可配 `--keep <n>`（import 命令）或环境变量 `VESSEL_PROVIDER_BACKUP_KEEP`（0 = 关闭备份）；每类文件各自计数。
- **轮转不做任何删除**（项目删除铁律）：达到上限时把最旧一份**改名**成新时间戳再覆盖，文件数恒 ≤ N；改名失败（Windows 偶发 EPERM）退化为原地覆盖。
- 写盘仍是原子写（`.tmp` → rename），备份先于写盘，因此任何时刻都有一份完整旧配置。

## 3.2 多端点与测速（task 096）

```powershell
vessel provider endpoint list ds                                  # * = 默认端点（baseUrl）
vessel provider endpoint add ds https://backup.example/v1 --label backup
vessel provider endpoint remove ds https://backup.example/v1
vessel provider endpoint test ds                                  # 探测该 provider 全部候选端点 + 给建议
vessel provider endpoint test ds --set-default                    # 显式采纳建议（唯一会改默认端点的形式）
vessel provider endpoint test --all                               # 探测所有已配置供应商
vessel provider endpoint test ds --timeout 5000                   # 单端点超时（默认 3000ms）
```

- 数据结构：`ProviderConfig.endpoints?: {url, label?}[]`；`baseUrl` 恒为**默认端点**，`endpoints` 是**候选池**。候选池为空/缺省时按 `[baseUrl]` 处理（`effectiveEndpoints()`）；`endpoint add` 首次会把当前 baseUrl 物化进候选池首项，保证默认端点不被挤掉。
- 校验 fail loud：`endpoints` 必须是 `{url, label?}` 数组，url 非空且不重复，label 非空字符串。
- **测速 = 最小探测**：对 `{base}/models` 发一个 **不带任何凭据** 的 `GET`（避免把 key 送到用户临时填的候选地址），只取「是否可达 + 延迟」；HTTP 401/403 也算可达（网络/TLS 通了，只是未鉴权）。
- 结果形状：`{url, label?, probeUrl, reachable, ok, status?, latencyMs, error?}`；排序为「2xx/3xx 优先 → 可达但需鉴权 → 不可达」，同档按延迟升序。
- **只给建议**：默认只打印建议（`建议：<url>（最快可达，123ms）——仅建议，未改动默认端点。`），**绝不自动改 baseUrl**；只有显式 `--set-default` 才把 baseUrl 改成建议端点（且要求单个 id，`--all --set-default` 直接拒绝）。全部不可达 → exit 1，配置不变。

## 3.3 key 入库（task 105：opencode-go 示例）

**一次入库、之后免 env**：把 key 写进 CredentialStore（DPAPI 密文），`vessel run` 直接消费 store 里的 key。

```powershell
# 1) 入库：key 只在命令行/进程内出现，落盘由 CredentialStore 加密
vessel provider add opencode-go --protocol openai-compatible `
  --base-url https://opencode.ai/zen/go/v1 --model mimo-v2.5 --api-key <key>
#    已有同名条目 → vessel provider set opencode-go --api-key <key> 原地更新（不新建重复条目）

# 2) 设为默认（一次性）
vessel provider switch opencode-go

# 3) 此后无需任何 env
vessel run --prompt "ping"
```

- 落盘结果：`providers.json` 只留 `secretRef: "credential:vessel/opencode-go"`（**无 apiKey**）；
  `secrets.json` 为 `backend=windows-dpapi` 密文；`~/.vessel/*.json` 里扫描不到 `sk-` 明文。
- **两条来源的优先级**：`CredentialStore` → 环境变量 `OPENCODE_API_KEY`（task 097）。两者都空 →
  provider 报「API key 无效或无权限」。lane/驱动侧另有 `--key-source=auto|env|store` 显式选源
  （诊断用，只打印来源名/长度/是否一致，**不出密钥**）。实测（task 105）：`store` / `env` / `auto`
  三路均可用；`auto` 在 env 被塞假值时仍选 store（store 优先语义保持）。
- ✅ **无参 `vessel`（TUI）已接 CredentialStore（task 106 修复）**：`runChat()` 的默认 `ProviderStore` 与
  `vessel run` 共用 `createDefaultProviderStore()`（`apps/cli/src/providers/defaultStore.ts`），
  `secretRef` 正常解析回 apiKey。修复前是裸 `new ProviderStore()`（无凭据后端）→ 401 `Missing API key`。
  回归证据：`apps/cli/src/tui/chat.test.ts` 的「secretRef → apiKey」用例（本地 loopback 端点断言
  `Authorization: Bearer <key>`，不打真实网络）。
- ✅ **测试不再耦合机器状态（task 106 修复）**：`cli.test.ts` 的 run smoke 与 `chat.test.ts` 的 TUI 用例
  现在显式注入临时 `VESSEL_PROVIDER_ROOT`（provider 状态根，`secrets.json` 同根）+ `VESSEL_USAGE_ROOT`，
  默认 store 的根目录由 `providerStateRoot()` 断言。把默认 provider 切成真实供应商后这两个文件仍全绿。

## 4. 模型拉取（vessel models）行为

| 供应商协议 | 行为 |
|---|---|
| `openai-compatible` | 实时调 `GET {base}/v1/models`（自动尝试 `/models` 兜底）→ 列出真实模型；401/网络错给清晰报错 |
| `anthropic` | Anthropic 官方无公开模型枚举端点 → 内置 Claude 代际清单兜底（**诚实标注"非实时"**）；若你用的 Anthropic 兼容层暴露 `/v1/models`，可按 openai-compatible 配 |
| `mock` | 离线，提示无模型列表 |

拉到的模型 id 可直接 `--model <id>` 使用，或登记进 `configs/pricing.json` 的 models 表算成本。

## 5. vessel run 的供应商解析（优先级从高到低）

1. 显式 `--provider/--model/--base-url/--api-key`（最优先，向后兼容）
2. 环境变量 `VESSEL_MODEL/VESSEL_BASE_URL/VESSEL_API_KEY`
3. 当前默认供应商（`vessel provider switch` 设的；model/baseUrl/apiKey 从配置取）
4. 兜底 `mock`（无任何配置时的离线冒烟，会提示）

## 5.1 opencode-go（Go 端点）协议要求与配置（task 102 / 103）

**端点**：`https://opencode.ai/zen/go/v1`（preset id `opencode-go`，线协议仍是 `openai-compatible`）。

**协议硬要求**（实测见 `docs/OPENCODE-KEY-VERIFY.md`）：Go 端点鉴权通过后，聊天请求**必须**带
`x-opencode-session`（每个会话一个稳定 UUID），否则返回 **400 `MissingSessionID`**（不是 401——
鉴权已过，失败在路由阶段）；并且要求具名 `User-Agent`（不要用通用 SDK/HTTP 库名）。

**实现只有一份（task 103 SSOT）**：`packages/llm/src/provider/OpencodeGoProvider.ts`。
CLI（`vessel run`）、TUI（无参 `vessel`）与 benchmark lane 都经 `createProvider('opencode-go', …)`
构造它——`providerFactory.ts` 按 **preset id**（而不是线协议名）解析，所以配了 `opencode-go`
就自动带会话头 + 具名 UA。lane 侧 `benchmarks/runners/src/lane/opencodeGoChatProvider.ts`
只是 re-export 外壳，**不存在第二份协议逻辑**。

**怎么配**（密钥不落明文：写入 `~/.vessel` 时经 CredentialStore，或走环境变量）：

```powershell
vessel provider add opencode-go --protocol openai-compatible `
  --base-url https://opencode.ai/zen/go/v1 --model mimo-v2.5 --api-key sk-...
vessel provider switch opencode-go
vessel run --prompt "ping"          # 自动带 x-opencode-session + 具名 UA
vessel                               # TUI 同一份实现；一个会话内 session id 稳定
# 单发临时指定（不写盘）：--provider opencode-go 缺省即用 preset base-url
vessel run --provider opencode-go --api-key sk-... --model mimo-v2.5 --prompt "ping"
```

**错误分类**（`classifyOpencodeGoError`，CLI/TUI 会打印 kind + 一句可操作提示）：

| wire | kind | 处理 |
|---|---|---|
| 400 `MissingSessionID` | `missing-session` | 用内置 opencode-go provider（自动注入会话头）；不重试 |
| 401 `CreditsError` / `Insufficient balance` | `credits` | 余额/额度不足 → 充值或换 key；不重试 |
| 401 / 403 其它 | `auth` | key 无效/无权限 |
| 429 / `FreeUsageLimitError` | `rate-limit` | 有限退避重试（复用同一 session id） |
| 5xx / 超时 / 网络 | `server` / `timeout` / `network` | 有限退避重试 |
| `/messages`、`/responses` 家族（MiniMax/Qwen、Grok/GPT-5.6-Luna/Muse Spark） | `unsupported-route` | 本卡只做能力声明，显式抛错不静默走错端点 |

模型家族走 `/chat/completions` 的：GLM / Kimi / LongCat / DeepSeek / **MiMo** / Hy / Omen
（`resolveOpencodeGoRoute`）。推理模型（`mimo-v2.5`）默认 `max_tokens=8192`，留思维链预算。

## 6. 与 TaskRouter / pricing 的衔接

- **TaskRouter**（V0.4，任务→类别→模型档位）：TierModelMap 的 providerId 可直接绑 `anthropic`/`openai-compatible`，tier 的 model 用供应商默认模型即可（`docs/MISSION-V0.4.md`）。
- **pricing**：`configs/pricing.json` v0.2 支持 `models.<model-id>` 精确价（deepseek/claude/gpt 已有预设）与 `protocols.<protocol>` 兜底价；`loadPricing()`/`resolvePrice()` 按 模型 > catalog > 协议 > default 解析（mock 零价），模型名先经归一（命名空间/日期/effort/点号/大小写），`default`/`protocol` 命中会标 `estimated=true`。规则与实现见 `docs/PRICING.md`；`vessel models` 拉到的模型 id 可登记进 models 表。
- **TaskRouter（V0.4）与 run 默认（V0.6）**是两条独立路径：显式 --provider 定会话用哪个协议端点；TaskRouter 在"多 provider 可用、按任务自动选"时接管。

## 7. 新增一个厂商（回顾，详见 PROVIDER-INTEGRATION.md）

- 走已有协议（OpenAI 兼容 / Anthropic）→ 零代码：`vessel provider add <id> --protocol <p> ...` + `switch`。
- 全新协议 → `packages/llm/src/provider/` 写一个 `implements ChatProvider` 的类 + `createProvider` 工厂加一行 + 这里 `PROVIDER_PROTOCOLS` 加一档。

## 8. 验证

```powershell
npx tsc -b && npx vitest run   # 全量绿
# 命令冒烟（隔离目录，不碰 ~/.dsh）：
$env:VESSEL_PROVIDER_ROOT = "$env:TEMP\vessel-smoke"
node apps/cli/dist/cli.js provider add demo --protocol mock --model mock
node apps/cli/dist/cli.js provider list
node apps/cli/dist/cli.js models --provider ant   # anthropic 内置清单
```

## 9. 使用统计与定价（V0.9 / 085-090）

- `vessel usage [--recent <n>] [--strict] [--since <date>] [--until <date>] [--by-day]`：显示累计消耗（tokens in/out/cache 读/cache 写、估算成本、调用次数）与**成本分项**（input/output/cacheRead/cacheWrite），按供应商与模型聚合；打印**价格来源分布**与**估算条目数**；`--strict` 按「不用 default 兜底」的口径重算历史（只审计不写盘）。
  - 089 时间维度：`--since/--until`（本地日 `YYYY-MM-DD`，含首含尾）与 `--by-day`（按日列出）；**完整本地日**与今天（未完整）分开合计。有分桶数据时默认还会打印「今日 / 本月」两行。
  - 数据落盘 `~/.vessel/usage.json`（`version: 2`，原子写 tmp+rename；`VESSEL_USAGE_ROOT` 可隔离测试）：`entries`（累计）+ `daily`（本地日分桶，见 `docs/PRICING.md` §6）。
- `vessel pricing [model]`：查模型价目；`vessel pricing claude-sonnet-4-5` 查单个模型（命中归一化名时会打印「归一匹配: "输入" → "表键"」，并列出 cache 读/写单价）；无参列出 configs/model-catalog.json 主流模型价目表。价目单位为 USD / 1M tokens。
- 查价实现只有一份：`packages/shared/src/pricing.ts`（归一规则、回退链、`estimated` 语义、`costBreakdown` 四项分算），CLI / `UsageProjection` / benchmarks 共用；详见 `docs/PRICING.md`。
- `vessel run --strict`：本次会话按 strict 口径计价（未收录模型按 0 记并标 `unpriced`，token 计数仍保留）。
- mock 会话也会产生 usage 记录（E2E 接线验证），可 `vessel usage` 直接看到。
