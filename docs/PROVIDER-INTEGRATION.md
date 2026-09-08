# 多 API 供应商接入指南（PROVIDER-INTEGRATION.md）

> 版本：2026-09-05 · 适用范围：Composable Agent Harness（@vessel/llm provider 层）
> 目标：让第三方厂商 API 能**快速接入**——两条线协议（OpenAI 系 / Anthropic 系）+ 一个工厂入口，新增厂商多数情况零代码。

---

## 1. 现状：已支持哪些协议 / 厂商

| 协议 | Provider 类 | CLI --provider | 覆盖厂商（调研结论，docs/ideas/PROVIDER-RESEARCH-ANTHROPIC.md） |
|---|---|---|---|
| OpenAI chat/completions | `OpenAICompatibleProvider` | `openai-compatible` | OpenAI、DeepSeek、Qwen(DashScope)、Kimi(Moonshot)、GLM(Z.ai)、MiniMax、混元、xAI、vLLM、Ollama、OpenRouter、Gemini(OpenAI 兼容端) 等 |
| Anthropic Messages API | `AnthropicProvider` | `anthropic` | Anthropic Claude（原生 + Bedrock/Vertex/Azure 转售）、DeepSeek/Qwen 等的 Anthropic 兼容端 |
| 确定性脚本 | `MockProvider` | `mock` | 测试 / benchmark / 冒烟（离线） |

核心结论：**OpenAI + Anthropic 两套方言覆盖最广**（调研 §5）。业界主流（Vercel AI SDK / LiteLLM）也是"内部统一接口 + 每方言一个翻译器"，与本项目 ChatProvider seam 同思路。

## 2. 架构：为什么加厂商快

```
core/agent-loop ──► ChatProvider（shared 契约，vendor-agnostic）
                          ▲
        ┌─────────────────┼──────────────────┐
   OpenAICompatible   AnthropicProvider    MockProvider    ← 各说各的 wire
        └─────────────────┼──────────────────┘
                    createProvider(name, opts)   ← 统一工厂
                          ▲
                 cli --provider / TaskRouter tierMap / 测试
```

- **core 零改动**：Agent Loop / 上下文 / 策略只认 `ChatProvider` 接口（shared/provider.ts），不感知厂商。
- **新增厂商两种情形**：
  - 走**已有协议**（OpenAI 兼容 / Anthropic 兼容）→ 零代码，直接 CLI 配置（见 §4）。
  - **全新协议**（如 Gemini 原生 generateContent）→ 写一个 implements ChatProvider 的类（照 AnthropicProvider 约 150 行），工厂加一行（§5）。

## 3. ChatProvider 契约（厂商只需实现这个）

```ts
interface ChatProvider {
  readonly id: string;                       // 'openai-compatible' | 'anthropic' | ...
  chat(request: ChatRequest): Promise<ChatResponse>;
}
// ChatRequest: { model, messages, tools?, temperature?, maxTokens?, requestKind? }
//   messages: 统一 OpenAI 风格 —— system/user/assistant/tool 四角色；
//             assistant.toolCalls[] = 模型要调的工具；role:'tool' = 工具结果回传
//   tools:     [{ type:'function', function:{ name, description, parameters } }]
// ChatResponse: { content, toolCalls[{id,name,arguments}], finishReason: stop|tool_calls|length|error, usage{inputTokens,outputTokens,cacheReadTokens?}, raw }
```

厂商类的活：把内部统一消息**翻译成该方言**，再把方言响应**归一化**回上面结构。tool calling 往返是核心差异点（OpenAI 用 tool_calls/tool 角色；Anthropic 用 content 块 tool_use/tool_result）——照 provider 内转换层做即可。

## 4. 使用：接一个"已支持协议"的厂商（零代码）

```powershell
# 任何 OpenAI 兼容端点（DeepSeek / Qwen / vLLM / Ollama / …）
node apps/cli/dist/cli.js run --workspace . `
  --provider openai-compatible `
  --base-url https://api.deepseek.com/v1 --api-key $env:DEEPSEEK_KEY --model deepseek-chat `
  --prompt "实现一个功能…"

# Anthropic（或 Anthropic 兼容端）
node apps/cli/dist/cli.js run --workspace . `
  --provider anthropic `
  --base-url https://api.anthropic.com --api-key $env:ANTHROPIC_API_KEY --model claude-sonnet-4-5 `
  --prompt "实现一个功能…"

# 环境变量可替代参数：VESSEL_MODEL / VESSEL_BASE_URL / VESSEL_API_KEY
```

TaskRouter（V0.4）接多供应商：TierModelMap 的 providerId 直接绑 `anthropic`/`openai-compatible`/`mock`——任务类别自动路由到对应厂商（`docs/MISSION-V0.4.md`）。

## 5. 接入一个"全新协议"的厂商（约 1 步代码）

以 Gemini 原生 generateContent 为例的步骤：

1. 在 `packages/llm/src/provider/` 新建 `GeminiProvider.ts`：
   - `implements ChatProvider`，`id = 'gemini'`
   - `chat()` 里：内部消息 → Gemini 的 `systemInstruction` + `contents` + `tools.functionDeclarations`；响应 functionCall → 归一化成 `toolCalls`；functionResponse 回传照协议做
   - 参考 `AnthropicProvider.ts` 的结构（splitSystem / 消息转换 / usage 映射 / 错误映射）
2. `packages/llm/src/provider/createProvider.ts` 的 switch 加一行：
   ```ts
   case 'gemini':
     return new GeminiProvider({ baseUrl: requireUrl(name, opts.baseUrl), apiKey: opts.apiKey, model: opts.model });
   ```
3. `cli.ts` 帮助文案把 provider 枚举加上；可选：协议测试照 `anthropic-provider.test.ts`（本地 fake server 验证 wire format + tool 往返）。
4. `npx tsc -b` + `npx vitest run` 全绿。

> 若是"已有协议但厂商有特殊行为"（如某 OpenAI 兼容端点忽略某字段）：不改 core——在 provider 选项加开关或子类覆写，见 `docs/ideas/PROVIDER-RESEARCH-ANTHROPIC.md` §6.8 待验证项。

## 6. 协议陷阱速查（来自调研与实现，照做避坑）

**Anthropic（Messages API）**
- `max_tokens` **必填**（provider 默认 4096）。
- 消息只有 user/assistant；system 走**顶层 system 字段**（把内部前导 system 消息抽出合并）。
- 工具结果 = **user 消息的 content 块** `{type:'tool_result', tool_use_id, content}`；连续工具结果**合并进一条 user 消息**且 `tool_result` 放 content 最前（text 在后，否则 400）。
- assistant 的 tool_use 消息必须**原样回传**（id 保留）。
- 响应 content 是块数组：`text` / `tool_use{id,name,input}`；未知块类型跳过。
- `stop_reason`: end_turn→stop / tool_use→tool_calls / max_tokens→length。
- usage: input_tokens/output_tokens/cache_read_input_tokens（cache_creation 走 raw 扩展）。
- temperature 只在显式给时传（部分新模型拒绝非默认值）。
- 协议版本头：`anthropic-version: 2023-06-01`；鉴权 `x-api-key`。

**OpenAI 系（chat/completions）**
- system 是消息角色；工具结果 `role:'tool'` + `tool_call_id`。
- 模型 tool_calls 在 message.tool_calls；arguments 是 **JSON 字符串**要 parse。
- usage: prompt_tokens/completion_tokens（cached 在 prompt_tokens_details）。

## 7. 验证方式

```powershell
npx vitest run packages/llm              # provider 协议层测试（本地 fake server，不发真网络）
npx vitest run                           # 全量 211
# 端到端：本地 fake /v1/messages 或 /chat/completions，CLI --provider xxx 跑一轮 tool 往返
node apps/cli/dist/cli.js run --workspace <dir> --provider <p> --base-url <fake> --api-key k --model m --prompt "..."
```

## 8. 相关文档

- `docs/ideas/PROVIDER-RESEARCH-ANTHROPIC.md`：Anthropic 协议完整调研（JSON 示例 + 来源 URL + 待验证项）
- `packages/shared/src/provider.ts`：ChatProvider 契约（vendor 接入的唯一接口）
- `packages/llm/src/provider/AnthropicProvider.ts` / `OpenAICompatibleProvider.ts`：两个方言翻译器的参考实现
- `docs/DESIGN-DECISIONS.md` 决策点 13（多模型支持范围：Anthropic/OpenAI/OpenAI-Compatible 三类 + provider 中立模板 + Model Profile）
