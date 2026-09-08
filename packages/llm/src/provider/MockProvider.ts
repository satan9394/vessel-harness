import type { ChatProvider, ChatRequest, ChatResponse, ChatToolCall } from '@vessel/shared';

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
        usage: { inputTokens: 100, outputTokens: 20 },
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
      usage: { inputTokens: 100, outputTokens: 20 },
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
}
