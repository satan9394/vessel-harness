import {
  INJECTED_MESSAGE_SOURCES,
  type ChatMessage,
  type ChatProvider,
  type ChatRequest,
  type ChatResponse,
  type ChatToolCall,
  type ChatUsage,
  type StreamChunk,
} from '@vessel/shared';

export interface MockScriptEntry {
  /** regex tested against the LAST **surface** user message; first match wins */
  when: RegExp | string;
  /** only match when the request has no tool results yet (first model call) */
  ifNoToolResult?: boolean;
  /** only match when the request has at least N tool results (state progression) */
  minToolResults?: number;
  /** only match when the request has at most N tool results (prevent re-entry) */
  maxToolResults?: number;
  /** only match when the LAST tool result content matches (e.g. TOOL_FAILURE detection) */
  whenToolResult?: RegExp | string;
  response: {
    text?: string;
    toolCalls?: { name: string; arguments: Record<string, unknown> }[];
    /** thinking 模式思维链（task 109）：注入后经 AgentLoop 持久化 → ContextBuilder 回传 reasoning_content。 */
    reasoningContent?: string;
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
 * Last user message belonging to **real surface input** — context-injected
 * user messages (volatile skills index / instructions / project memory /
 * compaction summary) are skipped for script matching (G-01). A repo workspace
 * appends the skills index as the LAST user message; without this filter the
 * read/summary smoke script could never hit (`(mock: no script entry matched)`).
 * Operator steering (`source='steer'`) is real drive input and stays matchable.
 */
function surfaceUserMessage(messages: ChatMessage[]): ChatMessage | undefined {
  return [...messages].reverse().find(
    (m) => m.role === 'user' && !INJECTED_MESSAGE_SOURCES.has(m.source ?? ''),
  );
}

function testPattern(p: RegExp | string, text: string): boolean {
  return p instanceof RegExp ? p.test(text) : text.includes(p);
}

interface MatchContext {
  /** concatenated content of the last real (non-injected) user message */
  haystack: string;
  toolResultsCount: number;
  hasToolResults: boolean;
  lastToolResult: string;
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

  private context(request: ChatRequest): MatchContext {
    const lastUser = surfaceUserMessage(request.messages);
    const toolResultsCount = request.messages.filter((m) => m.role === 'tool').length;
    const lastTool = [...request.messages].reverse().find((m) => m.role === 'tool');
    return {
      haystack: lastUser?.content ?? '',
      toolResultsCount,
      hasToolResults: toolResultsCount > 0,
      // {last_tool_result} placeholder: substituted with the most recent tool result content
      lastToolResult: lastTool?.content ?? '',
    };
  }

  private matches(entry: MockScriptEntry, c: MatchContext): boolean {
    if (entry.ifNoToolResult && c.hasToolResults) return false;
    if (entry.minToolResults !== undefined && c.toolResultsCount < entry.minToolResults) return false;
    if (entry.maxToolResults !== undefined && c.toolResultsCount > entry.maxToolResults) return false;
    if (entry.whenToolResult !== undefined && !testPattern(entry.whenToolResult, c.lastToolResult)) return false;
    return testPattern(entry.when, c.haystack);
  }

  /** First script entry matching the request (deterministic; chat() and stream() share it). */
  private resolve(request: ChatRequest): { entry?: MockScriptEntry; ctx: MatchContext } {
    const ctx = this.context(request);
    return { entry: this.script.find((e) => this.matches(e, ctx)), ctx };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { entry, ctx } = this.resolve(request);
    const model = this.opts.model ?? 'mock-model';

    if (!entry) {
      return {
        content: (this.opts.fallbackText ?? '(mock: no script entry matched)').replace(/\{last_tool_result\}/g, ctx.lastToolResult),
        toolCalls: [],
        finishReason: 'stop',
        usage: this.usage(),
      };
    }

    const toolCalls: ChatToolCall[] = (entry.response.toolCalls ?? []).map((tc, i) => ({
      id: `tc_mock_${i + 1}`,
      name: tc.name,
      arguments: this.substitute(tc.arguments, ctx.lastToolResult),
    }));

    return {
      content: (entry.response.text ?? '').replace(/\{last_tool_result\}/g, ctx.lastToolResult),
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      usage: this.usage(),
      reasoningContent: entry.response.reasoningContent,
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

    const { entry, ctx } = this.resolve(request);

    // task 109: thinking 模式思维链先行（对齐 DeepSeek 系流式增量顺序：reasoning → content/tool）
    if (entry?.response.reasoningContent) {
      yield { type: 'reasoning_delta', text: entry.response.reasoningContent };
    }

    const toolCalls: ChatToolCall[] = (entry?.response.toolCalls ?? []).map((tc, i) => ({
      id: `tc_mock_${i + 1}`,
      name: tc.name,
      arguments: this.substitute(tc.arguments ?? {}, ctx.lastToolResult),
    }));

    if (toolCalls.length > 0) {
      for (const tc of toolCalls) {
        yield { type: 'tool_call_start', id: tc.id, name: tc.name, arguments: JSON.stringify(tc.arguments) };
        yield { type: 'tool_call_end', id: tc.id };
      }
    } else {
      const text = (entry?.response.text ?? this.opts.fallbackText ?? '(mock: no script entry matched)').replace(/\{last_tool_result\}/g, ctx.lastToolResult);
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
