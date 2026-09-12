import type {
  ChatMessage,
  ChatProvider,
  ChatRequest,
  ChatResponse,
  ChatToolCall,
  ChatToolDef,
  StreamChunk,
} from '@vessel/shared';
import { OpenAIStreamParser, openAIFinishReason } from '../stream/parseOpenAI.js';
import { sanitizeErrorBody } from './errorBody.js';

interface OpenAIChatMessage {
  role: string;
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  /** DeepSeek 系 thinking 模式：assistant 消息须回传上一轮的思维链（task 109）。 */
  reasoning_content?: string;
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
    if (m.reasoningContent) {
      base.reasoning_content = m.reasoningContent;
    }
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
      /** DeepSeek 系 thinking 模式的思维链字段（task 109）。 */
      reasoning_content?: string | null;
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
  /**
   * chat(): TOTAL wall-clock cap for the whole request (default 60_000ms).
   * stream(): only the FALLBACK for `streamIdleTimeoutMs` — never a total cap.
   */
  timeoutMs?: number;
  /**
   * stream() only: IDLE (inter-chunk) timeout, default `timeoutMs ?? 60_000`.
   *
   * The window opens when the request goes out, restarts when the response
   * headers arrive and after every chunk; only a gap of `streamIdleTimeoutMs`
   * with NO data at all aborts the stream. A long answer that keeps emitting
   * chunks is never cut off — which is exactly why stream() must not reuse
   * chat()'s TOTAL `timeoutMs`. Set it independently for models that think
   * silently for a long time before the first token.
   */
  streamIdleTimeoutMs?: number;
}

/**
 * Error body of a stream() idle timeout (machine-readable).
 *
 * Contract (asserted by tests; consumed upstream by `AgentLoop.classifyModelError`,
 * whose `/timeout/i` rule maps it to errorClass 'TIMEOUT' — the retry wrapper may
 * retry the attempt, and the turn closes with `model_stream_end {finishReason:'error'}`
 * instead of hanging silently):
 *   `<providerId> stream idle timeout: no data received for <N>ms`
 *
 * Deliberately NOT an AbortError: "the upstream went silent" and "the caller
 * interrupted the turn" must stay distinguishable downstream.
 */
function streamIdleTimeoutError(providerId: string, idleMs: number): Error {
  const err = new Error(
    `${providerId} stream idle timeout: no data received for ${idleMs}ms ` +
      `(idle threshold streamIdleTimeoutMs=${idleMs}; stream() has no total cap — long answers are legal)`,
  );
  err.name = 'StreamIdleTimeoutError';
  return err;
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
    // task 050: forward the turn-level signal onto the fetch controller
    const external = request.signal;
    const forwardAbort = () => controller.abort();
    if (external) {
      if (external.aborted) controller.abort();
      else external.addEventListener('abort', forwardAbort, { once: true });
    }
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
      external?.removeEventListener('abort', forwardAbort);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`OpenAI-compatible ${resp.status} ${resp.statusText}: ${sanitizeErrorBody(text)}`);
    }

    const body = (await resp.json()) as OpenAIResponseBody;
    if (body.error) {
      throw new Error(`provider error: ${sanitizeErrorBody(body.error.message ?? body.error.type ?? 'unknown')}`);
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
      // BRIEF「截断信号到不了 loop」（非流式）: 改前这里是
      //   `choice?.finish_reason === 'stop' || choice?.finish_reason === 'tool_calls'
      //      ? choice.finish_reason : 'error'`
      // ⇒ 非 stop/tool_calls 的**一切**（含 `'length'`）都被塌缩成 `'error'`。AgentLoop 的
      // 截断判据只看 `finishReason === 'length'`（AgentLoop.ts:429），于是被 max_tokens
      // 截断的回答在这条本仓最常用的路径上仍然报成 kind='success'。
      // 现在改用与流式**同一张**归一表（`openAIFinishReason`，而它**已委托** `finishReason.ts`
      // 的唯一表 `wireFinishReason`）：'length' 透传成 'length'，stop/tool_calls 逐字不变。
      //
      // **Round 126 更正**：此处原文写"其它/缺失仍是既有的 'error'"——那只对 **OpenAI wire 能携带的
      // token** 成立（`content_filter`/`function_call`/未知/缺失 ⇒ 'error'，与改前逐值相同）。
      // 收敛之后，**跨家族 token**（`end_turn`/`stop_sequence` ⇒ 'stop'、`tool_use` ⇒ 'tool_calls'、
      // `max_tokens` ⇒ 'length'）也随共享表给出**与 Anthropic 一致**的结论——这正是收敛的目的；
      // 它们不在 OpenAI 官方枚举内，只会出现在兼容层/网关。
      finishReason: openAIFinishReason(choice?.finish_reason),
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
        cacheReadTokens: body.usage?.prompt_tokens_details?.cached_tokens,
      },
      raw: body,
      // task 109: DeepSeek 系 thinking 模式思维链归一进 ChatResponse（AgentLoop 持久化后回传）
      reasoningContent: message?.reasoning_content ?? undefined,
    };
    // prettier-ignore
  }

  /**
   * Streaming variant of chat() (task 046): POST {base}/chat/completions with
   * stream:true, read the SSE `data:` lines from the response body and yield
   * typed StreamChunk[]. Does not change chat()'s one-shot behavior.
   */
  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const url = this.opts.baseUrl.replace(/\/$/, '') + '/chat/completions';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.opts.apiKey) headers.Authorization = `Bearer ${this.opts.apiKey}`;

    // task 050: forward the turn-level signal so an interrupt aborts the fetch
    // and the in-flight reader.read() rejects (the consumer stops promptly).
    const controller = new AbortController();
    const external = request.signal;
    const forwardAbort = () => controller.abort();
    if (external) {
      if (external.aborted) controller.abort();
      else external.addEventListener('abort', forwardAbort, { once: true });
    }

    // ---- IDLE timeout — deliberately NOT chat()'s total timeout -------------
    // chat() caps the WHOLE request at `timeoutMs` (one `setTimeout` around the
    // fetch). That is right for a one-shot response but fatal for a stream: a
    // long answer is legitimate, so a total cap would strangle it. This path
    // therefore watches the GAP BETWEEN DATA instead. The window opens before the
    // request is sent (the upstream may accept the TCP connection and then never
    // answer at all), and is restarted when the response headers arrive and after
    // every chunk. Only "no data at all for `idleMs`" aborts the fetch — exactly
    // the case that used to hang the turn silently forever (no error, no audit
    // event, a frozen UI).
    // Threshold: `streamIdleTimeoutMs` (independent knob for models that think
    // silently before the first token) → `timeoutMs` → the same 60_000 default
    // chat() uses, so one knob still tunes both unless a caller splits them.
    const idleMs = this.opts.streamIdleTimeoutMs ?? this.opts.timeoutMs ?? 60_000;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let idleFired = false;
    const clearIdle = (): void => {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    };
    const armIdle = (): void => {
      clearIdle();
      idleTimer = setTimeout(() => {
        idleFired = true;
        controller.abort();
      }, idleMs);
    };

    try {
      armIdle(); // covers the "connected but nothing came back" window too
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
            stream: true,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        // The abort WE caused must not surface as a bare AbortError (the consumer
        // would see an unexplained stream failure). A caller abort keeps its
        // original semantics untouched.
        if (idleFired && !external?.aborted) throw streamIdleTimeoutError(this.id, idleMs);
        throw err;
      }
      armIdle(); // headers are data ⇒ the upstream is alive; restart the window

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`OpenAI-compatible ${resp.status} ${resp.statusText}: ${sanitizeErrorBody(text)}`);
      }

      const body = resp.body;
      if (!body) throw new Error('OpenAI-compatible stream: response has no body');
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const parser = new OpenAIStreamParser();

      try {
        for (;;) {
          let doneFlag = false;
          let value: Uint8Array | undefined;
          try {
            const read = await reader.read();
            doneFlag = read.done;
            value = read.value;
          } catch (err) {
            if (idleFired && !external?.aborted) throw streamIdleTimeoutError(this.id, idleMs);
            throw err;
          }
          if (doneFlag) break;
          armIdle(); // a chunk arrived — reset the idle window (long answers stay legal)
          if (value) buffer += decoder.decode(value, { stream: true });
          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIdx);
            buffer = buffer.slice(newlineIdx + 1);
            const chunks = parser.feed(line);
            for (const c of chunks) yield c;
          }
        }
        if (buffer.trim().length > 0) {
          const chunks = parser.feed(buffer);
          for (const c of chunks) yield c;
        }
        const finalChunks = parser.finish();
        for (const c of finalChunks) yield c;
      } finally {
        reader.releaseLock();
      }
    } finally {
      clearIdle();
      external?.removeEventListener('abort', forwardAbort);
    }
  }
}
