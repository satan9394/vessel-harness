import type {
  ChatMessage,
  ChatProvider,
  ChatRequest,
  ChatResponse,
  ChatToolCall,
  ChatToolDef,
} from '@vessel/shared';

/**
 * llm/provider — Anthropic native protocol provider (Messages API + tool_use).
 *
 * Covers Anthropic's own API and any Anthropic-protocol endpoint. This is the
 * second wire protocol beside the OpenAI family (chat/completions): the shared
 * ChatProvider seam keeps core/agent-loop agnostic — only this module speaks
 * the Anthropic dialect.
 *
 * Wire format: POST {baseUrl}/v1/messages
 *   headers: x-api-key, anthropic-version: 2023-06-01
 *   body: { model, max_tokens, system, messages, tools, tool_choice, temperature }
 *
 * Key protocol differences vs OpenAI, handled here:
 *   1. system is a TOP-LEVEL field (not a role:'system' message).
 *   2. assistant tool calls come back as content blocks {type:'tool_use',
 *      id, name, input} inside content[].
 *   3. tool results are sent back as USER messages whose content[] holds
 *      {type:'tool_result', tool_use_id, content} blocks.
 *   4. usage counts input_tokens + output_tokens (Anthropic does not split
 *      prompt/completion the OpenAI way); cache tokens ride along.
 */

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string;
  is_error?: boolean;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicResponseContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export interface AnthropicProviderOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Messages API version header; default 2023-06-01 */
  anthropicVersion?: string;
  timeoutMs?: number;
  /** default max_tokens when the request carries none (Anthropic REQUIRES it) */
  defaultMaxTokens?: number;
}

/** Extract leading role:'system' messages → Anthropic top-level system text. */
function splitSystem(messages: ChatMessage[]): { system: string | undefined; rest: ChatMessage[] } {
  const systems: string[] = [];
  let i = 0;
  while (i < messages.length && messages[i]!.role === 'system') {
    systems.push(messages[i]!.content);
    i += 1;
  }
  return { system: systems.length > 0 ? systems.join('\n\n') : undefined, rest: messages.slice(i) };
}

/**
 * Rebuild Anthropic message list from the internal OpenAI-style history.
 *
 * Internal history may carry `role:'tool'` messages (OpenAI round-trip shape:
 * [assistant(toolCalls)] [tool ×N] [user]). Anthropic REQUIRES tool results to
 * be user messages whose content[] holds tool_result blocks, immediately
 * following the assistant tool_use message with nothing in between. So we:
 *   1. walk the history; every role:'tool' message is buffered,
 *   2. flush them as a single user message (tool_result blocks) right when we
 *      hit the next user/assistant boundary — i.e. they merge into the
 *      following user message when one exists, else stand alone.
 */
function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  const buffer: ChatMessage[] = []; // pending role:'tool' messages

  /** tool_result blocks from the buffer (prepended to a user message content). */
  const toolBlocks = (): AnthropicToolResultBlock[] =>
    buffer.map((m) => ({
      type: 'tool_result',
      tool_use_id: m.toolCallId ?? `tc_${Math.random().toString(36).slice(2)}`,
      content: m.content,
    }));

  const clearBuffer = (): void => {
    buffer.length = 0;
  };

  for (const m of messages) {
    if (m.role === 'tool') {
      buffer.push(m);
      continue;
    }
    if (m.role === 'assistant') {
      // assistant can never carry tool_result — flush pending results as their
      // own user message, then emit the assistant message.
      if (buffer.length > 0) {
        out.push({ role: 'user', content: toolBlocks() });
        clearBuffer();
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        const blocks: AnthropicContentBlock[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const tc of m.toolCalls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
        }
        out.push({ role: 'assistant', content: blocks });
      } else {
        out.push({ role: 'assistant', content: m.content });
      }
      continue;
    }
    // user: merge pending tool results INTO this message (tool_result first),
    // per Anthropic ordering rule (research: tool_result must precede text).
    if (buffer.length === 0) {
      out.push({ role: 'user', content: m.content });
      continue;
    }
    const merged: AnthropicContentBlock[] = [...toolBlocks(), ...(m.content ? [{ type: 'text', text: m.content } satisfies AnthropicTextBlock] : [])];
    clearBuffer();
    out.push({ role: 'user', content: merged });
  }
  // trailing tool results (no following user) → standalone user message
  if (buffer.length > 0) {
    out.push({ role: 'user', content: toolBlocks() });
    clearBuffer();
  }
  return out;
}

function toAnthropicTools(tools: ChatToolDef[]): { name: string; description: string; input_schema: unknown }[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

interface AnthropicResponseBody {
  content?: AnthropicResponseContentBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  error?: { type?: string; message?: string };
}

/**
 * AnthropicProvider — speaks the Anthropic Messages API. `id` is 'anthropic'
 * so a TaskRouter tier map can bind providerId 'anthropic' directly.
 */
export class AnthropicProvider implements ChatProvider {
  readonly id = 'anthropic';

  constructor(private readonly opts: AnthropicProviderOptions) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 60_000);
    const url = this.opts.baseUrl.replace(/\/$/, '') + '/v1/messages';
    const { system, rest } = splitSystem(request.messages);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': this.opts.anthropicVersion ?? '2023-06-01',
      'x-api-key': this.opts.apiKey ?? '',
    };

    const body: Record<string, unknown> = {
      model: this.opts.model,
      max_tokens: request.maxTokens ?? this.opts.defaultMaxTokens ?? 4096, // Anthropic REQUIRES max_tokens
      messages: toAnthropicMessages(rest),
    };
    // temperature: only when the caller explicitly sets it — Anthropic defaults
    // are stable and some models reject non-default temperature (research §6).
    if (request.temperature != null) body.temperature = request.temperature;
    if (system) body.system = system;
    if (request.tools && request.tools.length > 0) {
      body.tools = toAnthropicTools(request.tools);
      body.tool_choice = { type: 'auto' };
    }

    let resp: Response;
    try {
      resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Anthropic ${resp.status} ${resp.statusText}: ${text.slice(0, 500)}`);
    }

    const data = (await resp.json()) as AnthropicResponseBody;
    if (data.error) {
      throw new Error(`anthropic error: ${data.error.message ?? data.error.type}`);
    }

    // Parse content blocks → text + tool_use calls.
    let content = '';
    const toolCalls: ChatToolCall[] = [];
    for (const block of data.content ?? []) {
      if (block.type === 'text' && block.text) content += block.text;
      if (block.type === 'tool_use' && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    const stopReason = data.stop_reason;
    const finishReason: ChatResponse['finishReason'] =
      stopReason === 'end_turn' || stopReason === 'stop_sequence'
        ? 'stop'
        : stopReason === 'tool_use'
          ? 'tool_calls'
          : stopReason === 'max_tokens'
            ? 'length'
            : 'error';

    return {
      content,
      toolCalls,
      finishReason,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        cacheReadTokens: data.usage?.cache_read_input_tokens,
      },
      raw: data,
    };
  }
}
