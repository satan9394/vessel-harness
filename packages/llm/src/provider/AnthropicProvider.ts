import type {
  ChatMessage,
  ChatProvider,
  ChatRequest,
  ChatResponse,
  ChatToolCall,
  ChatToolDef,
  StreamChunk,
} from '@vessel/shared';
import { AnthropicStreamParser, anthropicFinishReason } from '../stream/parseAnthropic.js';
import { sanitizeErrorBody } from './errorBody.js';

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
  /**
   * chat(): TOTAL wall-clock cap for the whole request (default 60_000ms).
   * stream(): only the FALLBACK for `streamIdleTimeoutMs` — never a total cap.
   */
  timeoutMs?: number;
  /**
   * stream() only: IDLE (inter-chunk) timeout, default `timeoutMs ?? 60_000`.
   *
   * Same contract as OpenAICompatibleOptions.streamIdleTimeoutMs (the two wire
   * protocols are siblings here and must not drift): the window opens when the
   * request goes out, restarts on the response headers and after every chunk,
   * and only a gap of `streamIdleTimeoutMs` with NO data at all aborts. A long
   * answer that keeps emitting chunks is never cut off — which is exactly why
   * stream() must not reuse chat()'s TOTAL `timeoutMs`.
   */
  streamIdleTimeoutMs?: number;
  /** default max_tokens when the request carries none (Anthropic REQUIRES it) */
  defaultMaxTokens?: number;
  /**
   * Round 66 — stream() diagnostic sink, default `console.warn`.
   *
   * Same shape as the repo's other narrow warning outlets (Sandbox `deps.warn`,
   * SubagentManager `opts.onWarn`, CredentialStore `opts.onWarn`): production
   * wiring passes NOTHING and gets a visible `console.warn`, while tests inject a
   * recorder to keep the suite output clean and to assert the negative control
   * ("a canonical stream prints nothing at all").
   *
   * Only ever called for a NON-ZERO anomaly count — see
   * `reportStreamDiagnostics`.
   */
  onWarn?: (message: string) => void;
}

/**
 * Error body of a stream() idle timeout (machine-readable) — sibling of
 * `streamIdleTimeoutError` in OpenAICompatibleProvider.ts; kept local so the two
 * providers stay independent modules (no provider↔provider import).
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
 * Round 66 — make the parser's two per-stream counters OPERATOR-VISIBLE.
 *
 * Why this function exists at all: `AnthropicStreamParser` grows two read-only
 * counters (`malformedFrames`, Round 54: a frame whose `data:` payload failed
 * JSON.parse — the half-written JSON tail of a TRUNCATED connection, which the
 * EOF residual-buffer feed pushes through the parse catch, is the most common
 * case of that failure, not its definition; `duplicateStarts`,
 * Round 65: a `content_block_start` arriving while that index's block is still
 * open — the PEER re-sending a frame the protocol forbids). Until this round
 * NOTHING in the repository read either getter (grep: parser + parser tests
 * only), so the visibility the two counters were built to provide lived
 * exclusively inside the getters — at runtime nobody read them, and an operator
 * could not see the incident. The provider owns the parser instance
 * (`new AnthropicStreamParser()` in stream()), so the terminal boundary of that
 * same stream is the natural consumption point.
 *
 * The two causes stay SEPARATE LINES, because they call for different responses
 * and merging them would make "the connection was cut mid-frame" and "the
 * upstream repeated itself" observationally identical — the exact blindness
 * Round 54 ended one level down:
 *   - `cause=truncated-frame`  — this frame's `data:` payload failed JSON.parse
 *     (a byte-level failure). The most common CAUSE is a transport truncated
 *     mid-frame, but "truncated" is not the CRITERION: a proxy's HTML error page
 *     or a `data: ping` line fails that same parse and is counted here too. The
 *     frame is dropped and NOT retained — the failing line IS in hand at the
 *     point that drops it, the parser just keeps no copy of it;
 *   - `cause=duplicate-start`  — the bytes parsed fine and the UPSTREAM
 *     re-sent a forbidden frame; the repeat's argument seed is DELIVERED, and
 *     the mechanism differs per shape while this counter does not distinguish
 *     them (it counts violating FRAMES, taken before the mapper): a repeat
 *     carrying `id`+`name` is folded into a `tool_call_delta` — addressed to the
 *     identity fixed by the block's FIRST start, so that holds whether the
 *     repeat re-sends the same id or carries a different one (Round 68) — while
 *     a repeat carrying no id/name at all yields no chunk from the mapper and is
 *     folded where the identity freeze is decided instead (Round 69). A repeat
 *     whose seed is EMPTY emits nothing on either path, because there is nothing
 *     to deliver. See the duplicate-start handling in `parseAnthropic`.
 * Each line carries its own machine-readable `key=count`, plus its own cause
 * token, so a log grep / alert rule can tell the two apart.
 *
 * NEGATIVE CONTROL (the point of the `> 0` guards): a canonical stream must
 * print NOTHING. A diagnostic that fires on every healthy stream is noise, and
 * noise is what hides the one stream that mattered — so zero counts emit zero
 * output, and there is no "summary line" for the healthy case.
 *
 * Frequency: at most one line per cause per stream (the caller invokes this
 * exactly once per stream, at its terminal boundary), i.e. ≤2 lines ever.
 * Deliberately NOT de-duplicated across streams: the counters are per-stream
 * instance state, so cross-stream suppression would require shared module state
 * — precisely the design the parser rejects (two parsers must never accumulate
 * into each other) — and "every anomalous stream is reported" is the point of
 * an operational signal. Repetition across streams is a property of the
 * upstream, and suppressing it would hide an ongoing incident.
 */
function reportStreamDiagnostics(
  warn: (message: string) => void,
  malformedFrames: number,
  duplicateStarts: number,
): void {
  if (malformedFrames > 0) {
    // Round 68 — 判据 vs 成因（同族清尾）。旧文案把「连接在帧中间被切断」——
    // **最常见成因**——写成了**判据**：真实判据只是「该帧 `data:` 载荷 JSON.parse
    // 失败」（字节层面），代理塞入的 HTML 错误页、`data: ping` 同样命中计数。旧文案的
    // 「不可恢复」也偏强：失败点（feed() 的 catch / mapper 的 catch）**手上就握着**
    // 那行原始文本，只是**不留档** ⇒ 应限定为「不留档」，而不是宣称「不可恢复」。
    warn(
      `[llm][anthropic] stream 诊断 cause=truncated-frame（判据：该帧 data: 载荷 JSON.parse 失败，即字节不可解析；` +
        `最常见成因是连接在帧中间被切断——代理塞入的错误页、data: ping 这类非 JSON 载荷同样计数）` +
        `malformedFrames=${malformedFrames}: 该帧已丢弃且不留档（原文就在丢弃点手上，只是不做留存），本轮输出可能不完整`,
    );
  }
  if (duplicateStarts > 0) {
    // Round 67 — the wording is derived information, and the old wording was WRONG
    // in a way this repo keeps paying for ("说的和做的不一致"): it asserted the
    // repeat's seed was DISCARDED, while the same-id shape folds that seed into a
    // `tool_call_delta` and the consumer does receive it (Round 64's fold; pinned
    // by streamProvider.test.ts ② and ⑥). The counter cannot be split per shape
    // here: it is ONE number taken at the FRAME, before the mapper, and the shapes
    // are decided inside `AnthropicStreamParser.feed()`. So this line must state
    // what happens to EVERY shape and never describe one shape as if it were all
    // of them.
    //
    // Round 68 — the same rule now catches this line's OTHER "会丢" claim. It used
    // to say a repeat carrying a DIFFERENT id loses its seed (the folded delta
    // pointed at the new id); the parser now freezes a started block's identity, so
    // the fold is addressed to the ORIGINAL id and that seed lands as well. Keeping
    // that clause after the fix would be the Round 67 lie with the shapes swapped,
    // so it is gone: "folded and delivered" covers every repeat that carries
    // id+name, and "lost" was left to the one shape that still was (no id/name).
    //
    // Round 69 — that last clause is gone too, because the parser closed it: a
    // repeat carrying no id/name now gets a fold at the identity-freeze point, so
    // its seed lands as well. THE LINE BELOW THEREFORE DESCRIBES NO LOSS AT ALL —
    // every shape delivers a non-empty seed, and an empty one has nothing to
    // deliver. The word 「丢失」 survives only inside 「均不丢失」 (and 「未丢」 for
    // the id+name fold), which is what a downstream wording assertion reads
    // (streamProvider.test.ts ⑦): leaving a bare "会丢/丢失" clause here would be
    // the Round 67 lie a third time.
    warn(
      `[llm][anthropic] stream 诊断 cause=duplicate-start（上游重发帧：协议违规）` +
        `duplicateStarts=${duplicateStarts}: 同一 index 的 content_block_start 在其 content_block_stop 之前再次到达；` +
        `该帧不得覆盖已累积的片段，也不得改写该 index 首次 start 已登记的身份；` +
        `它携带的 argument seed 三种形态均已送达（见 parseAnthropic 的重复 start 处理）：` +
        `带 id/name ⇒ start 被抑制，非空 seed 折入一条挂「原 id」的 tool_call_delta（未丢；同 id 与不同 id 皆然，` +
        `identity 以首次 start 为准）；无 id/name ⇒ 该帧不产生 start，parser 在冻结判定处直接补一条挂「原 id」的 tool_call_delta（同样未丢）；` +
        `三种形态的 seed 均不丢失，seed 为空（input:{} 或缺 input）时什么都不发——本就无信息可送`,
    );
  }
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
    // task 050: forward the turn-level signal onto the fetch controller
    const external = request.signal;
    const forwardAbort = () => controller.abort();
    if (external) {
      if (external.aborted) controller.abort();
      else external.addEventListener('abort', forwardAbort, { once: true });
    }
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
      external?.removeEventListener('abort', forwardAbort);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Anthropic ${resp.status} ${resp.statusText}: ${sanitizeErrorBody(text)}`);
    }

    const data = (await resp.json()) as AnthropicResponseBody;
    if (data.error) {
      throw new Error(`anthropic error: ${sanitizeErrorBody(data.error.message ?? data.error.type ?? 'unknown')}`);
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
    // BRIEF「同一个 wire 值，两个 provider 三套口径」: chat() and stream() call the
    // SAME function, so one wire `stop_reason` cannot get two conclusions depending
    // on which method the caller used. Pre-change this was a second, hand-written
    // ternary chain that mapped unknown reasons to `'error'` while
    // `anthropicFinishReason` passed them through verbatim (→ `AgentLoop` read
    // `'refusal'` as `'stop'` ⇒ `kind='success'` on the streaming path).
    // Every canonical mapping is byte-for-byte what the ternary produced:
    // end_turn/stop_sequence ⇒ 'stop', tool_use ⇒ 'tool_calls', max_tokens ⇒ 'length',
    // everything else (including a missing/empty `stop_reason`) ⇒ 'error'.
    const finishReason: ChatResponse['finishReason'] = anthropicFinishReason(stopReason);

    return {
      content,
      toolCalls,
      finishReason,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        cacheReadTokens: data.usage?.cache_read_input_tokens,
        // task 099: cache write tokens ride along as an optional field; absent
        // on the wire stays undefined (never coerced to 0) so the pricing
        // fallback chain can distinguish "no data" from "reported zero".
        cacheCreationTokens: data.usage?.cache_creation_input_tokens,
      },
      raw: data,
    };
    // prettier-ignore
  }

  /**
   * Streaming variant of chat() (task 046): POST {base}/v1/messages with
   * stream:true, read the SSE `event:`/`data:` frames and yield typed
   * StreamChunk[]. Does not change chat()'s one-shot behavior.
   */
  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const url = this.opts.baseUrl.replace(/\/$/, '') + '/v1/messages';
    const { system, rest } = splitSystem(request.messages);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': this.opts.anthropicVersion ?? '2023-06-01',
      'x-api-key': this.opts.apiKey ?? '',
    };

    const body: Record<string, unknown> = {
      model: this.opts.model,
      max_tokens: request.maxTokens ?? this.opts.defaultMaxTokens ?? 4096,
      messages: toAnthropicMessages(rest),
      stream: true,
    };
    if (request.temperature != null) body.temperature = request.temperature;
    if (system) body.system = system;
    if (request.tools && request.tools.length > 0) {
      body.tools = toAnthropicTools(request.tools);
      body.tool_choice = { type: 'auto' };
    }

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
    // event, a frozen UI). Identical semantics to the OpenAI-compatible sibling.
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
        resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
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
        throw new Error(`Anthropic ${resp.status} ${resp.statusText}: ${sanitizeErrorBody(text)}`);
      }

      const rbody = resp.body;
      if (!rbody) throw new Error('Anthropic stream: response has no body');
      const reader = rbody.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const parser = new AnthropicStreamParser();
      // Round 66 — the diagnostic outlet for THIS stream's parser counters.
      // Default `console.warn` (production visibility without any wiring);
      // tests inject `opts.onWarn` to record instead of printing.
      const warn = this.opts.onWarn ?? ((message: string) => console.warn(message));

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
        // Round 66 — the consumption point, and the ONLY one: the terminal
        // boundary of this stream. On the clean path `finish()` has just run
        // (the counters are then final); on an abnormal exit — caller abort,
        // idle timeout, read error — the counters still hold every frame that
        // WAS fed, and losing that visibility exactly when a turn died is the
        // failure this card exists to end. Exactly once per stream, no matter
        // which way the generator terminates: the `finally` body runs once, and
        // a consumer that abandons the generator early (`.return()`) lands here
        // too. Emits nothing when both counters are 0 (see
        // reportStreamDiagnostics) and adds no chunk to the stream.
        reportStreamDiagnostics(warn, parser.malformedFrames, parser.duplicateStarts);
      }
    } finally {
      clearIdle();
      external?.removeEventListener('abort', forwardAbort);
    }
  }
}
