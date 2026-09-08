import type {
  ChatMessage,
  ChatProvider,
  ChatRequest,
  ChatResponse,
  ChatToolCall,
  ChatToolDef,
} from '@vessel/shared';

interface OpenAIChatMessage {
  role: string;
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
}

function toOpenAIMessages(messages: ChatMessage[]): OpenAIChatMessage[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content, name: m.name };
    }
    const base: OpenAIChatMessage = { role: m.role, content: m.content };
    if (m.toolCalls && m.toolCalls.length > 0) {
      base.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }));
    }
    return base;
  });
}

function toOpenAITools(tools: ChatToolDef[]): { type: 'function'; function: { name: string; description: string; parameters: unknown } }[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters },
  }));
}

interface OpenAIResponseBody {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  error?: { message?: string; type?: string };
}

export interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
}

/**
 * llm/provider — OpenAI-compatible chat provider (covers DeepSeek/Qwen/local endpoints).
 * Wire format: POST {baseUrl}/chat/completions with function calling.
 */
export class OpenAICompatibleProvider implements ChatProvider {
  readonly id = 'openai-compatible';

  constructor(private readonly opts: OpenAICompatibleOptions) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 60_000);
    const url = this.opts.baseUrl.replace(/\/$/, '') + '/chat/completions';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.opts.apiKey) headers.Authorization = `Bearer ${this.opts.apiKey}`;

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.opts.model,
          messages: toOpenAIMessages(request.messages),
          tools: request.tools && request.tools.length > 0 ? toOpenAITools(request.tools) : undefined,
          temperature: request.temperature ?? 0,
          max_tokens: request.maxTokens,
          stream: false,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`OpenAI-compatible ${resp.status} ${resp.statusText}: ${text.slice(0, 500)}`);
    }

    const body = (await resp.json()) as OpenAIResponseBody;
    if (body.error) {
      throw new Error(`provider error: ${body.error.message ?? body.error.type}`);
    }
    const choice = body.choices?.[0];
    const message = choice?.message;

    const toolCalls: ChatToolCall[] = (message?.tool_calls ?? []).map((tc) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function?.arguments ?? '{}') as Record<string, unknown>;
      } catch {
        args = { _raw: tc.function?.arguments };
      }
      return { id: tc.id ?? `tc_${Math.random().toString(36).slice(2)}`, name: tc.function?.name ?? 'unknown', arguments: args };
    });

    return {
      content: message?.content ?? '',
      toolCalls,
      finishReason: (choice?.finish_reason === 'stop' || choice?.finish_reason === 'tool_calls'
        ? choice.finish_reason
        : 'error') as ChatResponse['finishReason'],
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
        cacheReadTokens: body.usage?.prompt_tokens_details?.cached_tokens,
      },
      raw: body,
    };
  }
}
