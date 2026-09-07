# Anthropic 原生协议 Provider + 多厂商 API 接入调研

> 调研日期：2026-09 前后（资料以当时平台文档与 SDK 为准）
> 用途：为 Composable Agent Harness 增加 Anthropic Messages API provider，把现有 OpenAI-compatible provider 补齐成「OpenAI 系 + Anthropic 系」双协议覆盖
> 范围：纯网络调研整理，不改代码
> 重要说明：本报告基于 Anthropic 官方 docs（platform.claude.com，即原 docs.anthropic.com）为主、Vercel AI SDK / LiteLLM / Ollama 等开源实现为辅。凡是厂商兼容层与官方行为不一致或未被官方确认的，一律标注「待验证」。

---

## 0. 一页结论（TL;DR）

- Anthropic 接入是 **POST `https://api.anthropic.com/v1/messages`**，认证用 `x-api-key` 头 + `anthropic-version: 2023-06-01` 头。
- 与 OpenAI 最大差异有四处：
  1. **system 不进 messages 数组**，走请求体顶层 `system` 字段（Messages API 里**没有** `role:"system"` 消息；Claude Opus 4.8/Fable 5 等新模型才支持会话中途的 `role:"system"`，属例外，见 §1.5）。
  2. **消息内容不是扁平字符串**，而是 `content` 块数组（`text`/`tool_use`/`tool_result`/`thinking`/`image`/`document`…）；字符串只是单 text 块的简写。
  3. **tool calling 不用独立 `tool` 角色**：模型请求调工具时，assistant 消息的 `content` 数组里含 `{type:"tool_use", id, name, input}`；工具结果由**下一条 user 消息**的 `content` 数组里的 `{type:"tool_result", tool_use_id, content, is_error}` 回传。整条往返是「assistant 消息原样回传 + 新 user 消息带 tool_result」。
  4. **`max_tokens` 是必填**、token 计量是 input/output 二分（+ cache_creation/cache_read 两个可选缓存计数），没有 OpenAI 的 completion_tokens/prompt_tokens 命名。
- 现有 `ChatProvider` 的 OpenAI 风格消息模型（`role:'tool'` + assistant `toolCalls`）可以直接做语义映射，**不必改 core/agent-loop**，只需在 provider 内部做双向翻译（详见 §6 伪代码）。
- 主流厂商分布（详见 §5）：**纯 Anthropic 协议**的只有 Anthropic 一家（含 Bedrock/Vertex/GCP/阿里云百炼等官方转售）；**DeepSeek / Zhipu GLM (Z.ai) / Qwen (DashScope) / Kimi (Moonshot) / MiniMax / 腾讯混元 TokenHub / Ollama / vLLM(部分版本起) / OpenRouter** 等都是 **OpenAI Chat Completions 为主 + 额外提供 Anthropic `/v1/messages` 兼容端点**；**Gemini（原生）与 xAI 是自成一派/OpenAI 系**。所以「OpenAI 系 + Anthropic 系」两套转换层覆盖面最广。

---

## 1. Messages API 请求格式

### 1.1 端点与认证头

- URL：`POST https://api.anthropic.com/v1/messages`
- 认证：`x-api-key: <ANTHROPIC_API_KEY>`（或 `Authorization: Bearer`，SDK 新版本两者皆可；AI SDK 文档确认默认 `x-api-key`，可配 `authToken` 切换为 Bearer）
- 必带头：`anthropic-version: 2023-06-01`（LiteLLM / Ollama 兼容层也都按此默认）
- 内容头：`content-type: application/json`
- 可选头：`anthropic-beta`（beta 特性）、`anthropic-user-profile-id`（用户画像，需 beta）

官方 curl 示例（来源：platform.claude.com「Using the Messages API / API reference」）：

```bash
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-opus-5",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello, Claude"}
    ]
  }'
```

### 1.2 请求体字段（官方 API reference，body 参数）

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `model` | 是 | string | 模型 ID，如 `claude-sonnet-4-5` |
| `max_tokens` | **是** | number | 本次最多生成的 token 数。**必须显式传**；可设 `0` 只预热缓存不生成 |
| `messages` | 是 | array | 历史对话，role 只能 `user`/`assistant`（`tool_result` 也放在 user 消息里） |
| `system` | 否 | string 或 text 块数组 | **顶层 system prompt**，不是消息 |
| `tools` | 否 | array | 工具定义，`{name, description, input_schema}` |
| `tool_choice` | 否 | object | `auto`(默认)/`any`/`tool:{name}`/`none`，可加 `disable_parallel_tool_use` |
| `temperature` | 否 | number | **注意：Claude 4.7+ / Mythos 等新模型已不支持 temperature/top_p/top_k，设非默认值会 400**（见 §6.6） |
| `top_p` / `top_k` | 否 | number | 同上，仅旧模型 |
| `stop_sequences` | 否 | string[] | 自定义停止序列 |
| `stream` | 否 | boolean | SSE 流式 |
| `thinking` | 否 | object | extended/adaptive thinking（`{type:"adaptive"}` 或 `{type:"enabled", budget_tokens:N}`） |
| `metadata` | 否 | object | 如 `{user_id}` |

（来源：platform.claude.com/docs/en/api/messages/create 的 body 参数列表）

### 1.3 消息角色与 content 结构

- 消息 `role` 只有 **`user` / `assistant`** 两种（Messages API 层面无 system 角色）。
- 相邻相同 role 会被自动合并成一个 turn。
- 每条消息的 `content` 可以是：
  - `string`（= `[{type:"text", text:...}]` 简写），或
  - 内容块数组，元素形如：
    - `{type:"text", text:"..."}`
    - `{type:"tool_use", id, name, input}`（assistant 发起调用）
    - `{type:"tool_result", tool_use_id, content?, is_error?}`（user 回传结果）
    - `{type:"thinking", thinking, signature}`（assistant，需开启 thinking）
    - `{type:"redacted_thinking", data}`（thinking 被 redact 时）
    - `{type:"image", source:{type:"base64"|"url"|"file", ...}}` / `{type:"document", source:{...}}`
- 例子：`{"role":"user","content":"Hello, Claude"}` 等价于 `{"role":"user","content":[{"type":"text","text":"Hello, Claude"}]}`。
- 单请求消息上限 100,000 条。

### 1.4 多轮对话示例（官方）

```json
{
  "model": "claude-opus-5",
  "max_tokens": 1024,
  "messages": [
    {"role": "user", "content": "Hello, Claude"},
    {"role": "assistant", "content": "Hi, I'm Claude. How can I help you?"},
    {"role": "user", "content": "Can you explain LLMs in plain English?"}
  ]
}
```

### 1.5 system 的传法 —— 关键差异

**官方原话**：Messages API「没有 `"system"` role 的输入消息」；要带 system prompt 用**顶层 `system` 参数**。

```json
{
  "model": "claude-opus-5",
  "max_tokens": 1024,
  "system": "You are a helpful coding assistant. 只输出代码。",
  "messages": [{"role": "user", "content": "写一个快速排序"}]
}
```

`system` 可以是 string 或 text 块数组（块数组便于给某块加 `cache_control`）。

**例外（新模型、待验证语义细节）**：平台文档说明在 Claude Fable 5 / Claude Mythos 5 / Claude Opus 4.8 / Opus 5 上支持**会话中途**插入 `"role":"system"` 的消息（不能是 messages 第一条；作用等同顶层 system 但不会使已有缓存前缀失效）。这是一条较新的能力，做 provider 时不必优先支持，能处理即可标注待验证。

> 对现有 ChatProvider 的影响：OpenAI 风格里 `role:'system'` 是普通消息，且可能在任意位置出现多条。转换时必须把所有 system 消息抽出合并进顶层 `system`（多条用数组/换行拼接），其余 user/assistant/tool 才进 `messages`。详见 §6.2。

---

## 2. tool_use 协议（Anthropic 版 function calling）

### 2.1 工具定义格式（请求 `tools` 数组）

注意：**没有 OpenAI 的 `{type:"function", function:{...}}` 两层壳**，是平铺的 `{name, description, input_schema}`，`input_schema` 是 JSON Schema（draft 2020-12）。可选加 `"strict": true`（新能力，保证输入严格符合 schema；Anthropic-schema 工具如 bash/text_editor 另有一批专用定义，这里只讨论用户自定义工具）。

```json
{
  "model": "claude-opus-5",
  "max_tokens": 1024,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get the current weather for a location.",
      "input_schema": {
        "type": "object",
        "properties": {
          "location": { "type": "string", "description": "City name, e.g. Paris" }
        },
        "required": ["location"]
      }
    }
  ],
  "messages": [{ "role": "user", "content": "What's the weather in Paris?" }]
}
```

（来源：platform.claude.com/docs/en/api/messages/create 的 tools 说明、how-tool-use-works 文档）

### 2.2 模型返回：`tool_use` content 块

响应是完整 Message 对象，`stop_reason:"tool_use"`，`content` 数组里**每个工具调用是一个块**（可多个并行）：

```json
{
  "id": "msg_01Aq9w938a90dw8q",
  "model": "claude-opus-5",
  "role": "assistant",
  "stop_reason": "tool_use",
  "content": [
    { "type": "text", "text": "I'll check the current weather for you." },
    {
      "type": "tool_use",
      "id": "toolu_01A09q90qw90lq917835lq9",
      "name": "get_weather",
      "input": { "location": "Paris", "unit": "celsius" }
    }
  ]
}
```

块字段：`id`（工具结果回传时要对上的 ID，前缀 `toolu_`）、`name`、`input`（对象，符合 input_schema）。官方明说 `stop_reason:"tool_use"` 时**还没有任何东西被执行**，执行是你的代码的事。

### 2.3 结果回传：user 消息里的 `tool_result` 块

规则（官方「Handle tool calls」，务必照做）：
1. 把**上一步 assistant 响应原样**（含 text 与全部 tool_use 块）追加为一条 assistant 消息；
2. 新建一条 **user** 消息，`content` 是 `tool_result` 块数组；
3. `tool_result.tool_use_id` 必须等于对应 `tool_use.id`；
4. `content` 可以是字符串、text/image/document 块数组；出错时 `content` 放错误说明并加 `"is_error": true`；
5. **该 user 消息里 `tool_result` 块必须排在 content 数组最前**，普通 text 只能跟在结果后面（text 在 tool_result 前会 400）；
6. **同轮多个工具的结果必须一次性放在同一条 user 消息里**，不能拆多条、不能中间插别的消息。

官方错误示例（会 400）：
```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "Here are the results:" },
    { "type": "tool_result", "tool_use_id": "toolu_01", "content": "15 degrees" }
  ]
}
```

官方正确示例：
```json
{
  "role": "user",
  "content": [
    { "type": "tool_result", "tool_use_id": "toolu_01", "content": "15 degrees" },
    { "type": "text", "text": "What should I do next?" }
  ]
}
```

错误场景示例（工具抛异常）：
```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "ConnectionError: the weather service API is not available (HTTP 500)",
      "is_error": true
    }
  ]
}
```

### 2.4 多轮 tool_use 完整往返（照抄可用的消息序列）

第 1 次请求 → 响应含 tool_use；执行工具后第 2 次请求的完整 body：

```json
{
  "model": "claude-opus-5",
  "max_tokens": 16000,
  "tools": [ /* 与第一次相同的 tools 数组 */ ],
  "messages": [
    { "role": "user", "content": "What's the weather in Paris?" },
    {
      "role": "assistant",
      "content": [
        { "type": "text", "text": "I'll check the weather for you." },
        {
          "type": "tool_use",
          "id": "toolu_01A09q90qw90lq917835lq9",
          "name": "get_weather",
          "input": { "location": "Paris" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        { "type": "tool_result", "tool_use_id": "toolu_01A09q90qw90lq917835lq9", "content": "88°F, sunny" }
      ]
    }
  ]
}
```

若还有第二轮调用，就继续「assistant 原样回传（含新 tool_use）→ user 带 tool_result」循环，直到 `stop_reason != "tool_use"`。

**循环退出条件**（官方 how-tool-use-works）：`while stop_reason == "tool_use"` 继续；遇到 `end_turn` / `max_tokens` / `stop_sequence` / `refusal` 退出。

**thinking 变体注意事项**：若开启了 thinking 且响应含 `thinking` 块，回传 assistant 消息时这些块必须**原样保留、顺序不变**（含 `signature`），否则 400；`redacted_thinking` 块不可过滤。tool 循环中一条 assistant turn 只允许一种 thinking 配置。

### 2.5 与 OpenAI tool calling 的差异对照

| 维度 | OpenAI Chat Completions | Anthropic Messages |
|---|---|---|
| 工具定义 | `{type:"function", function:{name,description,parameters}}` | `{name, description, input_schema}`（平铺） |
| 模型请求工具 | assistant 消息顶层 `tool_calls:[{id, type:"function", function:{name, arguments(string)}}]` | assistant 消息 `content[]` 内 `{type:"tool_use", id, name, input(object)}` |
| arguments 形态 | **JSON 字符串**，需自行 parse | **已是对象**，无需 parse |
| 结果回传 | 独立 `role:"tool"` 消息 + `tool_call_id`，`content` 为字符串 | user 消息内 `tool_result` 块 + `tool_use_id`，`content` 字符串或块数组 |
| 角色模型 | system/user/assistant/tool 四种 | user/assistant 两种 + 顶层 system + content 块类型承载工具语义 |
| 并行调用 | 多个 tool_calls 可并行 | 多个 tool_use 块可并行，结果同条 user 消息合并回传 |

（来源：Anthropic 官方文档「Differences from other APIs」小节 + OpenAI 文档常识对照）

---

## 3. 响应格式

### 3.1 Message 对象

官方示例（完整非流式响应）：

```json
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "content": [ { "type": "text", "text": "Hello!" } ],
  "model": "claude-opus-5",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": { "input_tokens": 12, "output_tokens": 6 }
}
```

### 3.2 content 块类型（响应侧）

- `text`：`{type:"text", text}`（含 citations 时为 `citations` 数组，选配）
- `tool_use`：`{type:"tool_use", id, name, input}`（见 §2.2）
- `thinking`：`{type:"thinking", thinking, signature}` —— 需开启 thinking；部分新模型默认不返回可见 thinking 文本（要 `display:"summarized"` 才返回，否则 text 为空仅 signature）
- `redacted_thinking`：`{type:"redacted_thinking", data}` —— 被策略 redact 的思考，必须原样回传
- 服务端工具类（新）：`server_tool_use` / `web_search_tool_result` 等（web_search/web_fetch/code_execution 由 Anthropic 服务器执行，**不需要你回传 tool_result**，一般可忽略，遇到未知块跳过即可）
- 输入侧额外还有 `image` / `document` / `search_result` 等（本项目第一版可不管，除非要多模态）

> 实现建议：**对未知 `type` 的块一律跳过而不是报错**——Anthropic 会随版本加新块类型，如 `refusal`（200 + `stop_reason:"refusal"`、`content:[]`、`stop_details`，安全分类器拦截）。

### 3.3 stop_reason 枚举

| stop_reason | 含义 | 映射到本项目的 finishReason |
|---|---|---|
| `end_turn` | 自然结束 | `stop` |
| `tool_use` | 请求调用工具（client 工具，等你回 tool_result） | `tool_calls` |
| `max_tokens` | 达到 max_tokens 截断 | `length`（注意：若截断恰好发生在 tool_use 块生成中途，块不可用——官方 pitfall，建议当可重试错误） |
| `stop_sequence` | 命中自定义 stop_sequences | `stop`（近似；`stop_sequence` 字段会给出命中的序列） |
| `refusal` | 安全分类器拦截（内容为空，200 响应） | `error`（或单独 error 子类型） |
| `pause_turn` | （新）服务端工具循环暂停，需原样续传继续 | 视作需续传的特殊态（第一版可不处理） |

### 3.4 usage 字段 —— 与 OpenAI 的计量差异

```json
"usage": {
  "input_tokens": 2095,
  "output_tokens": 503,
  "cache_creation_input_tokens": 2095,
  "cache_read_input_tokens": 0
}
```

| Anthropic 字段 | 含义 | OpenAI 对应 |
|---|---|---|
| `input_tokens` | 输入 token | `prompt_tokens` |
| `output_tokens` | 输出 token | `completion_tokens` |
| `cache_creation_input_tokens` | 写入缓存的 token（按缓存写定价） | 无直接对应（OpenAI `prompt_tokens_details.cached_tokens` 是读侧） |
| `cache_read_input_tokens` | 命中缓存读取的 token（按缓存读定价） | `prompt_tokens_details.cached_tokens` |
| 注意 | **input_tokens 不含 cache_creation/read**，三者是并集关系：input_tokens = 普通输入部分；总输入成本 = (input − cache_creation − cache_read) × 输入价 + cache_creation × 写价 + cache_read × 读价 | — |

> 对本项目 usage 归一化的影响：现有 `ChatUsage = {inputTokens, outputTokens, cacheReadTokens?}`。直接映射 `input_tokens→inputTokens`、`output_tokens→outputTokens`、`cache_read_input_tokens→cacheReadTokens` 即可（字段天然对齐）；若要算成本，需额外把 `cache_creation_input_tokens` 带出去（建议塞进 `raw` 或扩展 usage，见 §6.4）。
>
> 「Anthropic 计量是 input+output，与 OpenAI 不同」：官方计费单位都是「每 1M tokens × 单价」，但 Anthropic 把缓存的读写单列；DeepSeek 等兼容层的 usage 命名可能与官方不一致（DeepSeek 用 `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens` 文档化在 OpenAI 侧，Anthropic 兼容端未保证字段映射，**待验证**，见 §5）。

---

## 4. 统一抽象层：业界怎么在「一套内部消息」上兼容两家

### 4.1 Vercel AI SDK（`@ai-sdk/anthropic` + `@ai-sdk/openai`/`openai-compatible`）

思路：**SDK 内部定义统一 LanguageModel 接口**（`generateText`/`streamText` 的 `messages` 是 SDK 自有的 `{role, content}` 结构），每个 provider 包把统一结构翻译成自家 wire 格式：

- `@ai-sdk/anthropic`：把 SDK 消息里的 system 提出来放顶层 `system`；把 `tool_use`/`tool_result` 翻译成 Anthropic 的 content 块；工具定义翻译成 `input_schema`；把 reasoning 翻译成 `thinking` 块并原样回传（`sendReasoning` 默认 true）；cache control 通过 `providerOptions.anthropic.cacheControl` 附加。
- `@ai-sdk/openai` / `openai-compatible`：走 `chat/completions` 或 Responses。
- provider 支持矩阵（AI SDK 官方 providers 页列出一大串，注意 Anthropic、OpenAI、Google、Mistral 等各自有 provider 包；DeepSeek、Moonshot、Qwen/Alibaba、Zhipu 等基本都走 **openai-compatible**，AI SDK 也提供统一 `OpenAI Compatible Providers` 页）。
- 关键点：AI SDK 对 tool 结果的回传（`tool_result`）在设计上对齐了 Anthropic 的块语义，但对外 API 仍是统一 role 消息；本项目可借鉴的是**「provider 内部做翻译，对外接口不动」**的架构。

来源：ai-play.vercel.app（AI SDK docs）providers/anthropic 与 providers-and-models 页。

### 4.2 LiteLLM（`/v1/messages` 统一端点 + 翻译）

- LiteLLM 直接把 Anthropic Messages 格式作为**第二官方方言**：`POST {proxy}/v1/messages` 收 Anthropic 格式请求，翻译后打到任意后端（openai/anthropic/bedrock/vertex/gemini…），响应也转回 Anthropic 格式。文档里同一条消息示例可分别发给 `anthropic/claude-3-haiku`、`openai/gpt-4`、`gemini/...`。
- 翻译有损：`cache_control` 会被丢弃、`thinking` 映射成目标方推理参数、`tool_choice` 部分后端不支持等。
- v1.92.0 起对「原生支持 Anthropic 的 OpenAI-compatible 服务器（如自托管 vLLM、各厂商 Anthropic 兼容端点）」提供 `supported_endpoints: ["/v1/messages"]` **原生透传**（不翻译，直转发），说明「既原生 Anthropic 又 OpenAI」的服务器越来越多。
- 另一个有启发的事实（vercel/ai issue #12889）：LiteLLM 把 Anthropic 模型经 OpenAI 兼容口转出时，thinking 块会以 `delta.reasoning_content` / `delta.thinking_blocks[]` 这类**非标准字段**流式吐出，官方 OpenAI-compatible provider 不归一化 —— 提醒我们：**「OpenAI 兼容」不等于「协议无损」**，thinking/cache 这类 Anthropic 特有语义跨协议必丢或扭曲。

来源：docs.litellm.ai/docs/anthropic_unified、docs/litellm.ai/docs/anthropic_unified/native_passthrough。

### 4.3 OpenAI 自家：Responses API vs Chat Completions

- OpenAI 现在有三层：Chat Completions（`/v1/chat/completions`，业界兼容基准）、**Responses API（`/v1/responses`）**、Agents SDK。
- Responses 的 tool calling 用 `function_call` output item + `function_call_output` input item（role 不再是重点，input/output item 化），比 Chat Completions 更像 Anthropic 的「块/项」思路，但仍是 OpenAI 系、不与 Anthropic wire 互通。
- 结论：市场上「统一」的主流仍是两套方言 + 各自网关翻译（LiteLLM/OpenRouter/NewAPI 等），或像 AI SDK 那样对外接口统一、wire 各自翻译。本项目选后者最省事。

### 4.4 Claude Code 用的格式

Claude Code 走的就是 Anthropic Messages API 原生格式（工具用 bash/text_editor 等 Anthropic-schema 工具）；它可被 Ollama/DeepSeek/Z.ai/腾讯混元等通过 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` 指向各自的 Anthropic 兼容端点替换后端。这反证了「Anthropic 协议」已成为 Claude Code 这类 Agent 客户端的**事实标准方言之一**，所以厂商纷纷提供 `/v1/messages` 兼容端点。

---

## 5. 主流厂商协议分布（2025–2026）

按「该项目做 Anthropic + OpenAI 两类协议能覆盖谁」来组织：

| 厂商/服务 | OpenAI Chat Completions (`/v1/chat/completions`) | OpenAI Responses (`/v1/responses`) | Anthropic Messages (`/v1/messages`) | 备注 |
|---|---|---|---|---|
| **Anthropic**（原生） | ❌（不提供；需网关） | ❌ | ✅ **原生** | `api.anthropic.com` |
| **AWS Bedrock / GCP Vertex / Azure AI Foundry / 阿里云百炼等转售 Claude** | ❌ | ❌ | ✅ Anthropic 协议 | Claude 在这些云上以 Anthropic Messages 原生暴露（LiteLLM 文档确认 Azure 用 `.../anthropic` 端点） |
| **OpenAI** | ✅ 原生 | ✅ 原生 | ❌ | 需网关翻译 |
| **xAI (Grok)** | ✅ 原生 | 部分/自研 | ❌（crabllm 注释明说无原生 /messages，仅经翻译网关） | 走 openai 系 |
| **Google Gemini**（原生 generateContent） | ❌（原生不是） | ❌ | ❌ | 但提供 **OpenAI 兼容端点**（`generativelanguage.googleapis.com/v1beta/openai`，官方已支持）与 **Anthropic 兼容端点**（`.../v1beta/anthropic`，Gemini API 官方 Anthropic 兼容，AI SDK 有 `@ai-sdk/google` 原生 + 社区 Anthropic 兼容）。Gemini 其实两家方言都能接，但「原生」是 generateContent，需要翻译。 |
| **DeepSeek** | ✅ 原生 | ✅（较新，V4 起支持 Responses） | ✅（官方 Anthropic 兼容端 `https://api.deepseek.com/anthropic`，OpenAI SDK 也可 `anthropic` 前缀路由） | 双协议官方支持。注意兼容层有损：`cache_control` 忽略、`budget_tokens` 忽略（用 `output_config.effort`）、`document` 块不支持、`is_error`/`disable_parallel_tool_use` 忽略等 |
| **Zhipu GLM (Z.ai)** | ✅ 原生 | 部分 | ✅（`https://api.z.ai/api/anthropic/v1`） | 双协议 |
| **Qwen (阿里 DashScope)** | ✅ 原生（compatible-mode） | 视版本 | ✅（`.../apps/anthropic/v1` 或 `/compatible-mode/v1` 旁挂 Anthropic 端，厂商以 DashScope 文档为准，待验证精确路径） | 双协议 |
| **Kimi (Moonshot)** | ✅ 原生 | 部分 | ✅（`https://api.moonshot.ai/anthropic/v1`） | 双协议 |
| **MiniMax** | ✅ 原生 | 部分 | ✅（`https://api.minimax.io/anthropic/v1`） | 双协议 |
| **腾讯混元 TokenHub** | ✅ 原生 | ✅（部分模型兼容模式） | ✅ | 官方文档明确「所有模型统一支持 OpenAI Chat Completions 与 Anthropic Messages 两协议」，同一 base URL 换路径切换，鉴权分别 Bearer / x-api-key |
| **Ollama（本地）** | ✅ | ❌ | ✅（`http://localhost:11434/v1/messages`，专为 Claude Code 等提供） | 双协议；`tool_choice`、缓存、count_tokens 不支持；token 数近似 |
| **vLLM（本地）** | ✅ 原生（业界标准） | 部分版本 | ✅（新版本起提供 `/v1/messages` Anthropic 兼容，待验证确切版本） | 双协议（以版本为准） |
| **OpenRouter（聚合网关）** | ✅ | 部分 | ✅（提供 `/anthropic` 兼容端） | 双协议网关 |
| **LiteLLM / NewAPI 等网关** | ✅ | 视实现 | ✅（LiteLLM v1.92+ 可原生透传） | 网关负责翻译 |

结论：**做 Anthropic + OpenAI 两种 wire 方言 = 覆盖 Anthropic/OpenAI/xAI/DeepSeek/GLM/Qwen/Kimi/MiniMax/混元 + 本地 Ollama/vLLM + 各网关**。唯一要额外考虑的是 Gemini 原生 generateContent（若要走它，既非 OpenAI 也非 Anthropic，通常经其官方 OpenAI/Anthropic 兼容端即可，本项目可不做原生）。

> 兼容层风险提示（多处标注待验证）：DeepSeek Anthropic 兼容端忽略 `cache_control`、thinking 的 `budget_tokens`，`document` 块不支持；Ollama 不支持 `tool_choice`；各兼容层的 usage 缓存字段命名与官方 Anthropic 不一定一致。做 provider 时「发什么字段」要按厂商页面核对，不能假设官方语义全保留。

---

## 6. 实现要点建议（对接现有 ChatProvider）

### 6.0 现状核对（读了仓库代码）

`packages/shared/src/provider.ts` 的契约：

- `Role = 'system' | 'user' | 'assistant' | 'tool'`
- `ChatMessage { role, content: string, name?, toolCallId?, toolCalls?: {id,name,arguments: Record}[] }`
- `ChatToolDef { type:'function', function:{name, description, parameters: Record} }`
- `ChatRequest { model, messages, tools?, temperature?, maxTokens? }`
- `ChatResponse { content, toolCalls: {id,name,arguments}[], finishReason: 'stop'|'tool_calls'|'length'|'error', usage:{inputTokens,outputTokens,cacheReadTokens?}, raw? }`
- `ChatProvider.chat(req): Promise<ChatResponse>`

`OpenAICompatibleProvider` 已实现 OpenAI 风格双向转换（`role:'tool'`→`{role:'tool', tool_call_id}`；assistant toolCalls→`tool_calls`；tools→`{type:'function',function:{...}}`；usage `prompt_tokens`→inputTokens 等）。

→ 现有语义**已经是 OpenAI 风格但足够中性**：system 单独成消息、assistant.toolCalls 表示调用请求、role:'tool'+toolCallId 表示结果。**新增 AnthropicProvider 不需要改 shared 契约，也不需要动 agent-loop**；只需做一个镜像的 AnthropicProvider 实现该接口。这是推荐路径。

### 6.1 推荐结构

在 `packages/llm/src/provider/` 新增：

- `AnthropicProvider.ts`（implements ChatProvider，`id = 'anthropic'`）
- 建议把转换逻辑拆成纯函数便于单测：`toAnthropicMessages()` / `toAnthropicTools()` / `fromAnthropicResponse()` —— 参考现有 `toOpenAIMessages` 的做法，风格一致。

### 6.2 消息映射（请求侧）

| 内部 ChatMessage | Anthropic wire |
|---|---|
| `role:'system'`（任意位置、可多条） | 抽出来合并 → 顶层 `system`（多条用换行 `\n\n` 或 text 块数组拼接；**不进 messages**） |
| `role:'user'`，无工具结果 | `{role:'user', content}`（字符串即可） |
| `role:'assistant'`，无 toolCalls | `{role:'assistant', content}` |
| `role:'assistant'` + `toolCalls:[...]` | `{role:'assistant', content:[{type:'text',text}, ...{type:'tool_use', id, name, input}]}`（text 可选；**必须保证原始工具调用顺序与 ID 不变**，多轮回传时直接复用上轮响应块） |
| `role:'tool'`（带 toolCallId） | **不能独立成消息**。要并进**紧跟其后的那条 user 消息**（或创建一条 user 消息）的 content 数组，转成 `{type:'tool_result', tool_use_id: toolCallId, content, is_error?}` |

**坑 1：OpenAI 风格的历史是 `[assistant(toolCalls)] → [tool(...) × N] → [user?]`，而 Anthropic 要求 `[assistant(含tool_use)] → [user(含tool_result)]`。转换算法应做「工具结果归并」**：遍历消息，遇 `role:'tool'` 就把它缓存，若下一消息是 `role:'tool'` 继续缓存；遇到下一非 tool 消息时，若缓存非空，则把 tool_result 块（以及同条 user 消息原有的文本）合并进紧随其后的那条消息 —— 更稳的写法是「重组」：把每条 `role:'tool'` 的内容按顺序 append 到**当前待构建的 user 消息**，直到出现新的 user 文本或结束。

**坑 2：`content` 是 string 而非块数组时**，直接传字符串即可，Anthropic 接受。

**坑 3：若历史上 assistant 的 toolCalls 之后没有对应 tool 结果**（异常中断的会话），发送前应把该 assistant 消息的 toolCalls 丢弃或截断历史（Anthropic 会因「tool_use 后无紧邻 tool_result」报 400），或补一个空 tool_result。

**坑 4：consecutive 同 role 会自动合并**——无碍，但注意 tool_result 所在 user 消息里若既有文本又有结果，文本必须在结果**之后**（见 §2.3 规则 5）。

### 6.3 工具定义映射

```ts
// 内部 → Anthropic
{ type:'function', function:{ name, description, parameters } }
  → { name, description, input_schema: parameters }
```

`parameters` 已是 JSON Schema 对象，直接搬。可选：加 `strict:true`（若 schema 是 object 且含 required）。

### 6.4 响应侧解析（非流式）

```ts
// Anthropic Message → ChatResponse
contentText  = content.filter(b => b.type === 'text').map(b => b.text).join('') ?? ''
toolCalls    = content.filter(b => b.type === 'tool_use')
               .map(b => ({ id: b.id, name: b.name, arguments: b.input }))  // input 已是对象，免 parse
finishReason = { end_turn:'stop', stop_sequence:'stop', tool_use:'tool_calls', max_tokens:'length', refusal:'error' }[stop_reason] ?? 'error'
usage = {
  inputTokens:   usage.input_tokens,
  outputTokens:  usage.output_tokens,
  cacheReadTokens: usage.cache_read_input_tokens,        // 与现有字段对齐
  // 若要精确算成本：cache_creation_input_tokens 也需留存，建议放 usage 扩展或 raw
}
raw = body
```

- `thinking` 块：本项目接口没有 reasoning 字段，直接丢弃即可（不回传就无 thinking 循环负担）；若要回传 thinking 则必须原样保留（见 §2.4 注）。
- 未知块类型跳过（含 server_tool_use 系）。

### 6.5 tool_use/tool_result 多轮往返的关键约束（实现时逐条验证）

1. assistant 的 tool_use 消息必须**原样回传**（块内容、顺序、thinking signature 一个不能改）。
2. tool_result 必须紧跟在对应 assistant 消息之后，中间不能有别的消息。
3. 并行工具的结果一次性放同一 user 消息，按 tool_use_id 配对，放 content 数组最前。
4. 错误用 `is_error:true` + 说明性 content（让模型能修正重试），不要回空串。
5. 循环上限：agent-loop 已有（或应加）轮次上限；`stop_reason:'max_tokens'` 恰逢 tool_use 生成中被截断 = 不可用块，按可重试错误处理（提高 max_tokens 或压缩上下文）。
6. `tools` 数组每次往返请求都要带上（与首请求一致）。

### 6.6 max_tokens 必填与模型差异

- Anthropic **必须**显式 `max_tokens`。现有 `ChatRequest.maxTokens?` 是可选 → AnthropicProvider 里要设默认值（如 4096/8192），且优先用 request 传入值。
- **temperature/top_p/top_k 慎传**：Claude 4.7+ 等新模型传非默认 temperature 会直接 400（官方明确）。做法：AnthropicProvider 忽略/不传 temperature，或按模型白名单决定是否发送（`request.temperature ?? 0` 这种 OpenAI provider 的写法在 Anthropic 上会出事——OpenAI provider 用 0 默认，Anthropic 干脆不传最安全）。**待验证**：不同模型族的支持表以官方 models 页为准。
- tool-using 请求要留足 max_tokens 余量（思考+多块输出），否则常见截断。

### 6.7 错误映射

| HTTP / 现象 | 建议动作 |
|---|---|
| 400 `invalid_request_error`（缺 max_tokens、tools 格式、system 位置、tool_result 顺序、thinking 被改等） | 抛业务错误，提示「请求构造问题」，多数 400 来自 tool 循环格式（官方 pitfall 明说大多数 400 是 tool_result 没配对/没紧随） |
| 401 `authentication_error` | 换 key |
| 403 `permission_error` | 权限 |
| 404 `not_found_error` | model 名错 |
| 429 `rate_limit_error` | 退避重试；响应头有 `retry-after-ms`/`x-ratelimit-*`（可读 headers 拿 retry-after） |
| 500 / 529 `overloaded_error` | 服务过载，退避重试 |
| 超预算/余额类 | 转 error finishReason |
- 官方错误对象形如 `{"type":"error","error":{"type":"overloaded_error","message":"..."}}`；非 2xx 时建议保留原始 body 到错误消息便于排查（现有 OpenAI provider 就是拼 status+body）。
- 响应 200 但 `stop_reason:'refusal'`（安全拦截）：按 `finishReason:'error'` 处理并记录 `stop_details`。

### 6.8 需要「待验证」再拍板的点（实现前）

1. 各 Anthropic 兼容厂商（DeepSeek/GLM/Qwen/Kimi/MiniMax/Ollama/vLLM）的 usage 缓存字段与 tool_result 语义是否与官方一致（DeepSeek 已确认 cache_control 被忽略、`is_error` 忽略 —— 若要官方 Anthropic + 这些兼容端点共用同一 provider，需做能力降级开关）。
2. `system` 同时存在 + `role:'system'` 中段消息（仅 Opus 4.8/Fable 5 等）的支持策略。
3. Claude 4.7+ temperature 禁用的精确模型清单。
4. 若以后做流式：Anthropic SSE 事件类型（`message_start`/`content_block_start`/`content_block_delta`(`text_delta`/`input_json_delta`/`thinking_delta`)/`content_block_stop`/`message_delta`/`message_stop`）与 OpenAI `choices[].delta` 的归一化差异（可参考 LiteLLM 经 OpenAI 口吐 thinking 的非标准字段教训）。

### 6.9 与 OpenAICompatibleProvider 并存的接线建议

- Router 现在按 `{provider, model}` resolve 到某个 ChatProvider 实例。新增后只需：构造时按 provider id 选 `AnthropicProvider`（baseUrl 默认 `https://api.anthropic.com`，headers `x-api-key` + `anthropic-version`）或 `OpenAICompatibleProvider`。
- 由于 Anthropic 兼容端点（DeepSeek `/anthropic`、Ollama `/v1/messages` 等）与官方 Anthropic 行为差异主要在「忽略高级字段」，第一版可先只保证：text 对话、tools + 单/并行 tool_use/tool_result 往返、usage 基础三字段、错误映射 —— 这套是各兼容层都支持的核心子集（Ollama 官方文档确认 tools/tool_result/thinking 块均支持）。

---

## 7. 参考来源（URL 清单）

Anthropic 官方（platform.claude.com / docs.anthropic.com，主依据）：
- Messages API create reference（请求/响应/字段/工具往返格式）：https://platform.claude.com/docs/en/api/messages/create
- Using the Messages API（基础请求/响应示例、多轮、prefill、vision）：https://platform.claude.com/docs/en/build-with-claude/working-with-messages
- How tool use works（agentic loop、stop_reason 循环、tool 分类）：https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works.md
- Handle tool calls（tool_use 解析、tool_result 回传规则、is_error、格式要求/400 反例）：https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
- Thinking & tool workflows（thinking+tool 多轮往返、assistant 原样回传、signature 规则）：https://platform.claude.com/docs/en/build-with-claude/thinking-tool-workflows
- Anthropic 官方 TS/Python SDK 仓库（字段佐证）：github.com/anthropics/anthropic-sdk-typescript、anthropics/anthropic-sdk-python

统一抽象 / 网关：
- Vercel AI SDK — Anthropic provider（baseURL/x-api-key/authToken、thinking、cache control、disableParallelToolUse、structured outputs、refusal→content-filter 映射）：https://ai-play.vercel.app/providers/ai-sdk-providers/anthropic
- Vercel AI SDK — Providers and Models（统一 LanguageModel 抽象、openai-compatible 覆盖面、自托管）：https://ai-play.vercel.app/docs/foundations/providers-and-models
- vercel/ai issue #12889（LiteLLM 经 OpenAI 兼容口吐 Anthropic thinking 的非标准字段问题）：https://github.com/vercel/ai/issues/12889
- LiteLLM `/v1/messages`（Anthropic 方言统一端点 + 翻译到任意后端）：https://docs.litellm.ai/docs/anthropic_unified/
- LiteLLM Native `/v1/messages` passthrough（vLLM 等原生双协议服务器透传，v1.92+）：https://docs.litellm.ai/docs/anthropic_unified/native_passthrough
- LiteLLM Anthropic provider 页（Anthropic 在 Bedrock/Vertex/Azure 也走原生 Anthropic 协议）：https://docs.litellm.ai/docs/providers/anthropic
- LiteLLM vLLM provider 页 / OpenAI-Compatible Endpoints：https://docs.litellm.ai/docs/providers/vllm 、https://docs.litellm.ai/docs/providers/openai_compatible

厂商协议兼容（Anthropic 兼容端点证据）：
- Ollama Anthropic compatibility（`/v1/messages`、工具、Claude Code、不支持项表）：https://docs.ollama.com/api/anthropic-compatibility
- 腾讯云 TokenHub Language Model API Overview（所有模型统一双协议表：OpenAI Chat/Responses vs Anthropic，认证 x-api-key）：https://www.tencentcloud.com/document/product/1300/80632
- crabllm-provider compat.rs（DeepSeek/Z.ai/Qwen DashScope/MiniMax/Kimi/Moonshot 的 OpenAI + Anthropic 双 base URL 一览；xAI 无原生 Anthropic）：https://docs.rs/crate/crabllm-provider/latest/source/src/provider/compat.rs
- DeepSeek Anthropic API 兼容说明（第三方整理：`api.deepseek.com/anthropic`、claude 前缀路由、忽略字段清单）：搜索 "DeepSeek Anthropic API Compatibility: Field Mapping"（chat-deep.ai 整理文，字段以 DeepSeek 官方页为准，待验证）

> 调研工具备注：本次会话内置 web_search 与 Tavily 均因凭据/端点配置不可用，实际用 Exa 完成检索，并直接抓取 platform.claude.com 页面正文。文内官方行为均出自上述官方 URL 抓取结果。
