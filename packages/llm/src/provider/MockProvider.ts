import type { ChatProvider, ChatRequest, ChatResponse, ChatToolCall, ChatUsage, StreamChunk } from '@vessel/shared';

export interface MockScriptEntry {
  /** regex tested against the LAST user message; first match wins */
  when: RegExp | string;
  /** only match when the request has no tool results yet (first model call) */
  ifNoToolResult?: boolean;
  /** only match when the request has at least N tool results (state progression) */
  minToolResults?: number;
  /** only match when the request has at most N tool results (prevent re-entry) */
  maxToolResults?: number;
  response: {
    text?: string;
    toolCalls?: { name: string; arguments: Record<string, unknown> }[];
  };
}

export interface MockProviderOptions {
  model?: string;
  /** placeholder substitution in tool arguments, e.g. {cwd} */
  vars?: Record<string, string>;
  /** fallback text when no script entry matches */
  fallbackText?: string;
  /**
   * Usage reported by every scripted response (task 099). Lets tests drive the
   * real chain — provider → ChatUsage → after_model → UsageProjection /
   * UsageStore — with cache-write tokens (Anthropic `cache_creation_input_tokens`)
   * without a live endpoint. Defaults to `{ inputTokens: 100, outputTokens: 20 }`.
   */
  usage?: ChatUsage;
}

/**
 * llm/provider — deterministic scripted provider for offline tests, the CLI
 * smoke demo, and the benchmark offline lane (no network, no real model).
 */
export class MockProvider implements ChatProvider {
  readonly id = 'mock';

  constructor(
    private readonly script: MockScriptEntry[],
    private readonly opts: MockProviderOptions = {},
  ) {}

  /** Usage for every scripted response (task 099: injectable, copied per call). */
  private usage(): ChatUsage {
    return { ...(this.opts.usage ?? { inputTokens: 100, outputTokens: 20 }) };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const haystack = lastUser?.content ?? '';
    const toolResultsCount = request.messages.filter((m) => m.role === 'tool').length;
    const hasToolResults = toolResultsCount > 0;
    // {last_tool_result} placeholder: substituted with the most recent tool result content
    const lastTool = [...request.messages].reverse().find((m) => m.role === 'tool');
    const lastToolResult = lastTool?.content ?? '';
    const entry = this.script.find((e) => {
      if (e.ifNoToolResult && hasToolResults) return false;
      if (e.minToolResults !== undefined && toolResultsCount < e.minToolResults) return false;
      if (e.maxToolResults !== undefined && toolResultsCount > e.maxToolResults) return false;
      if (e.when instanceof RegExp) return e.when.test(haystack);
      return haystack.includes(e.when);
    });
    const model = this.opts.model ?? 'mock-model';

    if (!entry) {
      return {
        content: (this.opts.fallbackText ?? '(mock: no script entry matched)').replace(/\{last_tool_result\}/g, lastToolResult),
        toolCalls: [],
        finishReason: 'stop',
        usage: this.usage(),
      };
    }

    const toolCalls: ChatToolCall[] = (entry.response.toolCalls ?? []).map((tc, i) => ({
      id: `tc_mock_${i + 1}`,
      name: tc.name,
      arguments: this.substitute(tc.arguments, lastToolResult),
    }));

    return {
      content: (entry.response.text ?? '').replace(/\{last_tool_result\}/g, lastToolResult),
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      usage: this.usage(),
    };
  }

  private substitute(args: Record<string, unknown>, lastToolResult = ''): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === 'string') {
        out[k] = v
          .replace(/\{last_tool_result\}/g, lastToolResult)
          .replace(/\{(\w+)\}/g, (_, name: string) => this.opts.vars?.[name] ?? `{${name}}`);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  /**
   * Streaming variant of chat() (task 046): yields deterministic typed chunks
   * (message_start → text_delta → usage → message_end, or a tool_call sequence)
   * synchronously, mirroring the script resolution used by chat().
   */
  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const model = this.opts.model ?? 'mock-model';
    yield { type: 'message_start', model };

    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const haystack = lastUser?.content ?? '';
    const toolResultsCount = request.messages.filter((m) => m.role === 'tool').length;
    const hasToolResults = toolResultsCount > 0;
    const lastTool = [...request.messages].reverse().find((m) => m.role === 'tool');
    const lastToolResult = lastTool?.content ?? '';

    const entry = this.script.find((e) => {
      if (e.ifNoToolResult && hasToolResults) return false;
      if (e.minToolResults !== undefined && toolResultsCount < e.minToolResults) return false;
      if (e.maxToolResults !== undefined && toolResultsCount > e.maxToolResults) return false;
      if (e.when instanceof RegExp) return e.when.test(haystack);
      return haystack.includes(e.when);
    });

    const toolCalls: ChatToolCall[] = (entry?.response.toolCalls ?? []).map((tc, i) => ({
      id: `tc_mock_${i + 1}`,
      name: tc.name,
      arguments: this.substitute(tc.arguments ?? {}, lastToolResult),
    }));

    if (toolCalls.length > 0) {
      for (const tc of toolCalls) {
        yield { type: 'tool_call_start', id: tc.id, name: tc.name, arguments: JSON.stringify(tc.arguments) };
        yield { type: 'tool_call_end', id: tc.id };
      }
    } else {
      const text = (entry?.response.text ?? this.opts.fallbackText ?? '(mock: no script entry matched)').replace(/\{last_tool_result\}/g, lastToolResult);
      if (text.length > 0) yield { type: 'text_delta', text };
    }

    // task 099: usage chunk carries only the fields actually reported — the
    // default shape stays exactly `{inputTokens, outputTokens}` (no 0/undefined
    // padding), and an injected cacheCreationTokens rides along when present.
    const usage = this.usage();
    yield {
      type: 'usage',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
      ...(usage.cacheCreationTokens !== undefined ? { cacheCreationTokens: usage.cacheCreationTokens } : {}),
    };
    yield { type: 'message_end', finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop' };
  }
}
