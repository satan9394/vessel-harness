# 046 — Streaming Contract v2（typed chunks：message_start/text_delta/tool_call/usage/end）

- 状态：待验收
- 优先级：P0（Milestone C 首发；路线 §7.1）
- 创建日期：2026-09
- 关联：路线卡 046-049；goal（V1.0 产品化）

## 目标

定义并实现 ChatProvider 的 streaming 契约 v2：typed chunks（不只是 delta:string）。为 OpenAI-compatible stream（047）、Anthropic stream（048）、AgentLoop 接线（049）铺路。

## 验收标准

- [ ] `packages/llm/src/stream/types.ts`（或现有 provider 目录）：`StreamChunk` 联合类型
  ```ts
  type StreamChunk =
    | { type: 'message_start'; model?: string }
    | { type: 'text_delta'; text: string }
    | { type: 'tool_call_start'; id: string; name: string; arguments: string }
    | { type: 'tool_call_delta'; id: string; argumentsDelta: string }
    | { type: 'tool_call_end'; id: string }
    | { type: 'usage'; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }
    | { type: 'message_end'; finishReason?: string };
  ```
- [ ] `ChatProvider.stream?` 契约升级：现有 `stream?(...)` 若有则对齐为 `AsyncIterable<StreamChunk>`（或保留兼容 + 新增）
- [ ] `packages/llm/src/provider/openai-compatible.ts`：实现 `stream()`——调 `{base}/chat/completions` 带 `stream:true`，解析 SSE `data:` 行 → StreamChunk（delta.content→text_delta；delta.tool_calls→tool_call_start/delta/end；usage→usage chunk）
- [ ] `packages/llm/src/provider/anthropic.ts`：实现 `stream()`——调 `/v1/messages` 带 `stream:true`，解析 SSE event（content_block_delta→text_delta；content_block_start/stop 的 tool_use→tool_call_*；message_delta→usage/end）
- [ ] mock：`MockProvider.stream()` 返回同步 chunks（text + tool_call + usage），供测试
- [ ] 测试：types/解析器（OpenAI SSE 行→chunk、Anthropic SSE event→chunk）各 ≥4 例（用 mock fetch 返回 SSE 文本流）；MockProvider.stream 产出断言
- [ ] 全量 vitest/tsc 绿（362+ 无回归）
- [ ] 卡置"待验收"

## 涉及文件

- packages/llm/src/stream/（新：types.ts + 解析器）+ 测试
- packages/llm/src/provider/{openai-compatible,anthropic,mock}.ts（stream 实现）
- packages/llm/src/index.ts 导出

## 依赖

- 无（独立基础卡）

## 方法

- SSE 解析：逐行读 `data: {json}`，遇 `[DONE]` 结束；OpenAI/Anthropic 字段映射到 StreamChunk
- ChatProvider 接口加可选 stream（不破坏现有 chat 实现）；AgentLoop 接线在 049

## 工作证明（执行器回填）

- [ ] types/解析器/测试/tsc/vitest

> 执行器回填（2026-09）：StreamChunk 联合类型放 @vessel/shared/src/provider.ts（ChatProvider 契约所在地，
> 与既有约定一致）；packages/llm/src/stream/ 新增 types.ts（re-export）+ parseOpenAI.ts（SSE data: 行 → chunks，
> tool_calls 跨帧 id/name 状态跟踪）+ parseAnthropic.ts（event/data 帧 → chunks，block index→id 解析）；
> 三个 provider（OpenAICompatibleProvider / AnthropicProvider / MockProvider）均实现 stream()；index.ts 导出。
> 新增测试 23 例（parseOpenAI 9 + parseAnthropic 7 + provider stream 7）；全量 vitest 385 全绿、tsc exit 0。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：