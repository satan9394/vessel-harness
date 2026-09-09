# OpenCode 网关 key 实测验证（用户提供 key 重测 V1.1-F 的 401）

> 目的：用**用户单独创建并提供的 API key**（指纹 `sk-8Dl…Cp4n1`）实测 opencode 官方网关
> （Zen 付费端点 + Go 订阅端点），确认**协议形态、模型清单、计费/额度状态**，并解释 V1.1-F
> 记录的 `401 CreditsError Insufficient balance` 到底是「key 无效」还是「另一把 key / 账户额度」问题。
>
> 密钥铁律遵守情况：该 key **仅在 pwsh 进程内存中使用**（`$k='…'` 变量，命令结束即消失），
> 本文档、仓库、日志、回复中**只有指纹** `sk-8Dl…Cp4n1`，**无完整 key、无任何可复用片段**。

- 验证时间：2026-09-09 14:20 UTC（本地 2026-09-09 07:20，GMT-7）
- 执行方式：Windows / PowerShell 7，直连（无代理），每条探测**只跑一次**，失败即记录不重试
- 关联卡片：`tasks/V1.1-F-real-model-verify.md`（历史 401 结论）、`docs/REAL-MODEL-LANE.md`（lane 接线）

---

## 1. 结论速览

| 项目 | 结果 |
|---|---|
| key 有效性 | **有效**（两端点 `/v1/models` 均 200，鉴权通过） |
| Go 端点 `https://opencode.ai/zen/go/v1/models` | **200**，35 模型 |
| Zen 端点 `https://opencode.ai/zen/v1/models` | **200**，70 模型 |
| 清单是否含 MIMO V2.5 | **是**：`mimo-v2.5` + `mimo-v2.5-pro`（Go 清单内） |
| 最小聊天（Go 端点，`mimo-v2.5`） | **200 成功**，usage `prompt=248 / completion=8 / total=256`，`cached_tokens=192`，`cost="0"` |
| 最小聊天（Zen 付费端点，`claude-haiku-4-5`） | **401 `CreditsError` Insufficient balance**（Zen 余额为 0，与 key 无关） |
| 最小聊天（Zen 免费模型，`mimo-v2.5-free`） | **429 `FreeUsageLimitError`**（免费档限流） |
| 协议确认 | **OpenAI-compatible 成立**：`GET /v1/models` + `POST /v1/chat/completions` 均可用；**Go 端点额外强制 `x-opencode-session` 头**，缺失返回 400 |
| 与 V1.1-F 的关系 | V1.1-F 用的是**另一把 key**（本机 CC Switch `~/.cc-switch/cc-switch.db` 内 `hs`/`zl` 的 `{file:}` 引用 key）；本次用用户提供的 key 在 **Go 端点实测成功**，故「此前测错 key」成立 |

一句话：**这把 key 可用，而且能真正跑通 MIMO V2.5**；V1.1-F 的 401 是凭据来源（另一把 key / 该账户
Zen 余额）问题，不是协议或实现问题。

---

## 2. 端点与协议

### 2.1 实测端点

| 端点 | 方法 | 结果 |
|---|---|---|
| `https://opencode.ai/zen/go/v1/models` | GET | 200，`data` 数组 35 项，元素形如 `{"id":"minimax-m3","object":"model","created":1788963548,"owned_by":"opencode"}` |
| `https://opencode.ai/zen/v1/models` | GET | 200，`data` 数组 70 项，同上结构 |
| `https://opencode.ai/zen/go/v1/chat/completions` | POST | 无 session 头 → 400；带 `x-opencode-session` → **200 正常补全** |
| `https://opencode.ai/zen/v1/chat/completions` | POST | 401 `CreditsError`（付费模型）/ 429 `FreeUsageLimitError`（免费模型） |

认证统一为 `Authorization: Bearer <key>`，与 OpenAI 一致。

### 2.2 协议判定

- **`GET /v1/models`**：两端点均为 OpenAI 形态（`object:"list"` + `data[].id/object/created/owned_by`）。**成立**。
- **`POST /v1/chat/completions`**：请求体为 OpenAI Chat Completions 形状
  （`model` / `messages` / `max_tokens`），响应为 `chat.completion` + `choices[].message` + `usage`
  （含 `prompt_tokens_details.cached_tokens`、`completion_tokens_details.reasoning_tokens`）。**成立**。
- **Go 端点的强制附加头**：缺 `x-opencode-session` 时返回
  `400 {"type":"error","error":{"type":"MissingSessionID","message":"Error from provider (Console Go):
  Request is missing x-opencode-session and cannot be routed efficiently. …"}}`。
  官方文档（<https://opencode.ai/docs/go/>）明确要求客户端
  「Send a stable session ID in `x-opencode-session` for each conversation so we can optimize routing
  and prompt caching」。补上该头后同一请求立刻 200。**这是 Go 链路的协议硬要求，不是可选项。**
- **模型与端点不是一一对应**：官方文档 Endpoints 表显示 Go 上
  `chat/completions` 承载 GLM / Kimi / LongCat / DeepSeek / **MiMo-V2.5(-Pro)** / Hy / Omen，
  而 MiniMax、Qwen 系走 `https://opencode.ai/zen/go/v1/messages`（`@ai-sdk/anthropic`），
  Grok / GPT-5.6-Luna / Muse Spark 走 `https://opencode.ai/zen/go/v1/responses`（`@ai-sdk/openai`）。
  **按模型选路径**是接入时必须处理的映射。

---

## 3. 模型清单摘要

### 3.1 Go 端点（35 个，`/zen/go/v1/models`）

```
minimax-m3, minimax-m2.7, minimax-m2.5, kimi-k3, kimi-k2.7-code, kimi-k2.6, longcat-2.0,
kimi-k2.5, glm-5.2, glm-5.3-flash, glm-5.3, glm-5.1, glm-5, deepseek-v4-pro, deepseek-v4-flash,
deepseek-v4-flash-vision-exp, qwen3.7-max, qwen3.8-max, qwen3.8-flash, qwen3.7-plus,
qwen3.6-plus, qwen3.5-plus, mimo-v2-pro, mimo-v2-omni, mimo-v2.5-pro, mimo-v2.5, hy4-preview,
hy3, hy3-preview, gpt-5.6-luna, grok-4.5, grok-4.6, muse-spark-1.3-contributor,
muse-spark-1.2-contributor, omen-alpha
```

- **MIMO 家族在列**：`mimo-v2.5`、`mimo-v2.5-pro`（另有 `mimo-v2-pro`、`mimo-v2-omni`）。
- 与 V1.1-F 的 `source=live count=35` **完全一致**（清单未变化，佐证端点稳定）。

### 3.2 Zen 端点（70 个，`/zen/v1/models`）

- 前半（付费）：`claude-fable-5/5-1`、`claude-opus-5/4-8/4-7/4-6/4-5`、`claude-sonnet-5/4-6/4-5/4`、
  `claude-haiku-4-5`、`gemini-3.6/3.8/3.7/3.5-flash(-lite)/3.1-pro/3-flash`、
  `gpt-6-astra`、`gpt-5.6-sol/terra/luna`、`gpt-5.5(-pro)`、`gpt-5.4(-pro/mini/nano)`、
  `gpt-5.3-codex(-spark)`、`gpt-5.2(-codex)`、`gpt-5.1(-codex-max/codex/codex-mini)`、`gpt-5(-codex/nano)` …
- 后半：`grok-build-0.1`、`grok-4.6`、`grok-4.5`、`muse-spark-1.3/1.2`、`deepseek-v4-pro/flash/
  flash-vision-exp`、`glm-5.3-flash/5.3/5.2/5.1/5`、`minimax-m3/m2.7/m2.5`、`kimi-k3/k2.7-code/k2.6/k2.5`、
  `qwen3.6-plus/3.5-plus`、`big-pickle`，以及**免费档** `deepseek-v4-flash-free`、
  `mimo-v2.5-free`、`muse-spark-1.3/1.2-contributor-free`、`ling-3.0-flash-fin-free`、
  `nemotron-3-ultra-free`、`nemotron-3.5-lightning-free`。
- Zen 是**按量付费/余额制**（credits），Go 是 **$10/月订阅 + 额度上限**（5h $12 / 周 $30 / 月 $60，
  见官方文档 Usage limits）——两套计费相互独立，这解释了「Go 能跑、Zen 报余额不足」。

---

## 4. 最小聊天调用实测（原文摘要）

### 4.1 Go 端点 —— 成功（这是关键证据）

```
POST https://opencode.ai/zen/go/v1/chat/completions
Authorization: Bearer <key>            (指纹 sk-8Dl…Cp4n1)
x-opencode-session: 9aa2af68-c417-4f03-982a-8dbfa4f021f2   (随机 UUID)
{"model":"mimo-v2.5","messages":[{"role":"user","content":"hi"}],"max_tokens":8}

HTTP/1.1 200
{"id":"gen-1788963563-6oBR4kxQwZsyLAwmd4oF","object":"chat.completion","created":1788963563,
 "model":"mimo-v2.5","choices":[{"index":0,"finish_reason":"length","message":{"role":"assistant",
 "content":null,"reasoning":"Hmm, the user just said \"", …}}],
 "usage":{"prompt_tokens":248,"completion_tokens":8,"total_tokens":256,
          "prompt_tokens_details":{"audio_tokens":0,"cached_tokens":192,"cache_write_tokens":0},
          "completion_tokens_details":{"audio_tokens":0,"reasoning_tokens":0}},
 "cost":"0"}
```

要点：

- **HTTP 200，真实补全返回**，`model` 回显 `mimo-v2.5`，链路端到端打通。
- usage：`prompt_tokens=248`、`completion_tokens=8`、`total_tokens=256`、`cached_tokens=192`（prompt 缓存命中）。
- `finish_reason:"length"` + `content:null` + `reasoning` 有值 → **MiMo V2.5 是推理模型**：
  8 个 max_tokens 全被 reasoning 吃掉。接入时 max_tokens 必须留出思维链预算，否则拿不到 content。
- 响应含 `cost:"0"`：Go 订阅制下单次调用不计 per-request 费用（额度按美元上限计量，见官方文档）。

### 4.2 Go 端点 —— 缺 session 头（协议反例）

```
HTTP/1.1 400
{"type":"error","error":{"type":"MissingSessionID","message":"Error from provider (Console Go):
 Request is missing x-opencode-session and cannot be routed efficiently.
 Please see https://opencode.ai/docs/go/#where-can-i-use-it"}}
```

注意：这是 **400 而不是 401**，说明**鉴权已经通过**（key 被接受），失败发生在路由阶段。

### 4.3 Zen 付费端点 —— 401 余额不足

```
POST https://opencode.ai/zen/v1/chat/completions   {"model":"claude-haiku-4-5", …}

HTTP/1.1 401
{"type":"error","error":{"type":"CreditsError","message":"Insufficient balance.
 Manage your billing here: https://opencode.ai/workspace/wrk_01M0D76E9KB5KKZFB43XQ6PY1D/billing"}}
```

与 V1.1-F 记录的 `401 CreditsError Insufficient balance` **错误原文完全同型**，指向同一 workspace
的 Zen 余额。该 key 的 **Go 订阅有效**，但 **Zen credits 余额为 0**。

### 4.4 Zen 免费模型 —— 429 限流

```
POST https://opencode.ai/zen/v1/chat/completions   {"model":"mimo-v2.5-free", …}

HTTP/1.1 429
{"type":"error","error":{"type":"FreeUsageLimitError","message":"Rate limit exceeded. Please try again later."}}
```

### 4.5 错误类型归类（对应任务要求）

| 错误 | 归属 | 判定 |
|---|---|---|
| 400 `MissingSessionID` | 端点/协议 | 缺 `x-opencode-session`，**非鉴权失败**（鉴权已通过） |
| 401 `CreditsError`（Zen） | 账户额度 | Zen 余额不足；**key 本身有效**（同 key 在 `/v1/models` 与 Go 端点均 200） |
| 429 `FreeUsageLimitError`（Zen free） | 限流 | 免费档配额/频率限制 |
| — | key 无效 | **未出现**（无 401 invalid_api_key / 403） |
| — | 模型不可用 | **未出现**（mimo-v2.5 直接 200 返回） |

网络层面：直连成功，**未触发超时/代理**，因此未使用 `http://127.0.0.1:7897` 代理（按铁律不做无谓重试）。

---

## 5. 与 V1.1-F 的 401 对比

| 维度 | V1.1-F（历史） | 本次（用户提供 key） |
|---|---|---|
| key 来源 | 本机 CC Switch `~/.cc-switch/cc-switch.db`（`app_type=opencode`，`hs`/`zl` 两条的 `{file:}` 引用） | 用户单独创建并直接提供（指纹 `sk-8Dl…Cp4n1`） |
| `/zen/go/v1/models` | 200 / count=35 | 200 / count=35（一致） |
| 最小聊天（Go，mimo-v2.5） | 401 `CreditsError` Insufficient balance | **200 成功 + usage 数据** |
| 结论 | 鉴权通、清单通、聊天被计费阻塞 → pending(billing) | **key 可用，Go 链路真实可跑** |

因此：**V1.1-F 的 401 属于「key / 账户额度」问题，不是协议、不是实现缺陷**。用户指出的
「此前用的不是这把 key」成立——V1.1-F 读的是本机 CC Switch 里的另一把 key（该卡 2026-09-08 的
更正备注已声明这种读取方式越界并移除）。本次用用户提供的 key，**Go 端点最小聊天实测通过**。

同时注意两点仍成立：

1. 该账户的 **Zen 付费端点余额为 0**（401 同型），所以 Zen 付费模型仍不可用；免费档 429 限流。
   要跑 Zen 付费模型需充值，或改用 Go 订阅额度。
2. V1.1-F 未记录 `x-opencode-session` 这一硬要求——本次实测证明**缺它必 400**。

---

## 6. 对 harness 的落地结论（可执行）

1. **凭据**：opencode-go 链路的 key 用用户主动写入的 CredentialStore / `OPENCODE_API_KEY`（097 已收敛
   的两条来源），不要再去读本机 CC Switch 应用数据库。
2. **协议**：`baseUrl=https://opencode.ai/zen/go/v1` + `protocol=openai-compatible` 成立，但 provider 实现
   必须：① 每个会话生成稳定 ID 并以 **`x-opencode-session`** 头发送；② 按模型映射路径
   （`chat/completions` vs `messages` vs `responses`）；③ 设置**具名 User-Agent**（官方要求，勿用通用
   SDK/HTTP 库名）。
3. **计费语义**：Go 为订阅制（额度按美元上限），响应 `cost` 字段可为 `"0"`；Zen 为余额制，401 CreditsError
   应继续按 V1.1-F 的 `judgeRealModelLaneWithBilling` 语义判 **pending(billing)**，不伪造 pass。
4. **推理模型**：`mimo-v2.5` 返回 `reasoning`，`max_tokens` 需覆盖思维链，否则 `content` 为空。
5. **可复现验证**：Go 端点最小探针（带 session 头）可作为 real-model gate 的连通性前置检查。

---

## 7. 密钥安全声明

- key 仅出现在 pwsh 进程内存（`$k` 变量），随进程结束销毁；未写入文件、未进 git、未进日志。
- 本文档及仓库其它文件仅含指纹 **`sk-8Dl…Cp4n1`**（前 6 + 后 4），无可复用的完整值或中间片段。
- 未做任何重试轰炸：`/v1/models` 每端点 1 次、聊天探测各 1 次（含 1 次补 session 头的协议验证）、
  未使用代理。
