/**
 * llm/stream — Anthropic SSE event parser → StreamChunk[].
 *
 * The Anthropic Messages API streaming (`POST {base}/v1/messages?stream=true`)
 * emits SSE frames with an `event:` name and a `data: {json}` payload carrying
 * a discriminator `type`:
 *
 *   event: message_start        data: {"type":"message_start","message":{model,usage}}
 *   event: content_block_start  data: {"type":"content_block_start","index":i,"content_block":{type,text|id,name}}
 *   event: content_block_delta  data: {"type":"content_block_delta","index":i,"delta":{type:"text_delta"|"input_json_delta",...}}
 *   event: content_block_stop   data: {"type":"content_block_stop","index":i}
 *   event: message_delta        data: {"type":"message_delta","delta":{"stop_reason"}, "usage":{output_tokens}}
 *   event: message_stop         data: {"type":"message_stop"}
 *
 * Mapping table (task 046):
 *   - message_start                      -> message_start (model)
 *   - content_block_delta text_delta     -> text_delta
 *   - content_block_start tool_use       -> tool_call_start (id, name, partial input)
 *   - content_block_delta input_json     -> tool_call_delta (argumentsDelta)
 *   - content_block_stop (tool_use)      -> tool_call_end
 *   - message_delta                      -> usage (+ carries stop_reason)
 *   - message_stop                       -> message_end
 *   - content_block_stop of a tool_use block whose content_block_start carried
 *     no id/name                         -> explicit tool_call_start (placeholder
 *                                            identity) + tool_call_end
 *   - EOF without message_stop (finish()) -> open calls' tool_call_end, plus the
 *                                            placeholder flush above, plus
 *                                            message_end
 *
 * Round 53: `content_block.input` is the empty object `{}` on every canonical
 * tool_use frame (the arguments arrive afterwards as `input_json_delta`
 * fragments), so it is NOT used as an argument seed — see
 * anthropicToolInputSeed(). A non-empty `input` still is, unchanged.
 */

// BRIEF「同一个 wire 值，两个 provider 三套口径」: the normalization target type is
// owned by @vessel/shared (types.ts re-exports StreamChunk from there — same
// package, no new dependency).
import type { ChatFinishReason } from '@vessel/shared';
import { wireFinishReason } from '../finishReason.js';
import type { StreamChunk } from './types.js';

export interface AnthropicEventData {
  type?: string;
  index?: number;
  model?: string;
  content_block?: { type?: string; text?: string; id?: string; name?: string; input?: unknown };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  /** The `event:` name from the transport line (may be absent when parsing pure data payloads). */
  event?: string;
}

/**
 * Round 53 — the tool-argument SEED contributed by `content_block_start`.
 *
 * On the canonical Anthropic wire `content_block.input` is ALWAYS the empty
 * object `{}`: the real arguments arrive afterwards as
 * `content_block_delta.delta.partial_json` fragments, and the consumer APPENDS
 * them to whatever seed `tool_call_start.arguments` carried
 * (AgentLoop.consumeStream: `open.set(id, {name, args: chunk.arguments})`, then
 * `acc.args += chunk.argumentsDelta`). Serializing that empty placeholder as
 * `'{}'` made the accumulator hold `'{}{"path":"a.txt"}'` — not valid JSON — so
 * parseToolArguments degraded EVERY streaming Anthropic tool call to
 * `{ _raw: … }` and the tool never saw its arguments.
 *
 * An own-key-less object input therefore yields the empty seed: it carries no
 * information, and an empty seed is exactly what "the block announced nothing
 * yet" produces. A non-empty `input` — an implementation handing over the whole
 * argument object in `content_block_start` — serializes exactly as before, so
 * neither wire shape loses data. Arrays and primitives keep JSON.stringify
 * semantics unchanged.
 */
export function anthropicToolInputSeed(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 0) return '';
  return JSON.stringify(input);
}

/**
 * Map one Anthropic `data:` payload (JSON stripped of `data:`) to StreamChunk[].
 *
 * Round 54 — malformed-frame observability. This mapper is STATELESS by design,
 * so it cannot keep a count of its own; the one signal it produced and threw
 * away was "this string payload is not parseable JSON at the byte level" (the
 * half-written tail of a truncated connection, most commonly). `onMalformed` is
 * the opt-in sink for exactly that signal: it fires once, immediately before the
 * payload is dropped, and is never invoked for a payload that parsed.
 *
 * The parameter is OPTIONAL, which is the whole point of the choice: the return
 * type stays `StreamChunk[]` (no call site, no consumer contract changes), the
 * function stays pure for every caller that omits it, and no new symbol is
 * exported (`packages/llm/src/index.ts` re-exports this module wholesale).
 * AnthropicStreamParser.feed() supplies a sink that bumps its per-stream
 * malformedFrames counter; see the class docs for why the two paths can never
 * double count the same frame.
 */
export function parseAnthropicEvent(payload: unknown, onMalformed?: () => void): StreamChunk[] {
  if (payload == null) return [];
  let ev: AnthropicEventData;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (trimmed.length === 0) return [];
    try {
      ev = JSON.parse(trimmed) as AnthropicEventData;
    } catch {
      // Round 54: previously a bare `return []` — the frame left no trace at all.
      onMalformed?.();
      return [];
    }
  } else {
    ev = payload as AnthropicEventData;
  }
  if (typeof ev !== 'object' || ev === null) return [];

  const chunks: StreamChunk[] = [];
  switch (ev.type) {
    case 'message_start': {
      const model = ev.model ?? ev.message?.model;
      chunks.push({ type: 'message_start', model });
      const usage = ev.message?.usage ?? ev.usage;
      if (usage) chunks.push(anthropicUsageChunk(usage));
      break;
    }
    case 'content_block_start': {
      const block = ev.content_block;
      if (block?.type === 'tool_use' && block.id && block.name) {
        chunks.push({
          type: 'tool_call_start',
          id: block.id,
          name: block.name,
          arguments: anthropicToolInputSeed(block.input),
        });
      }
      break;
    }
    case 'content_block_delta': {
      const d = ev.delta;
      if (d?.type === 'text_delta' && d.text != null) {
        chunks.push({ type: 'text_delta', text: d.text });
      } else if (d?.type === 'input_json_delta' && d.partial_json != null) {
        chunks.push({ type: 'tool_call_delta', id: toolIdPlaceholder, argumentsDelta: d.partial_json });
      }
      break;
    }
    case 'content_block_stop': {
      chunks.push({ type: 'tool_call_end', id: toolIdPlaceholder });
      break;
    }
    case 'message_delta': {
      if (ev.usage) chunks.push(anthropicUsageChunk(ev.usage));
      // BRIEF「同一个 wire 值…三套口径」: this guard IS the frozen "missing value"
      // semantics of the streaming path and must stay exactly as it is — a
      // message_delta without `stop_reason` (or with `''`, which is falsy too)
      // emits NO `message_end` here, so the boundary chunk carries no
      // `finishReason` field at all and the consumer keeps its existing
      // `'stop'`/`'tool_calls'` reading. The normalization table is only reached
      // for a token the wire actually carried.
      if (ev.delta?.stop_reason) {
        chunks.push({ type: 'message_end', finishReason: anthropicFinishReason(ev.delta.stop_reason) });
      }
      break;
    }
    case 'message_stop': {
      chunks.push({ type: 'message_end' });
      break;
    }
    default:
      break;
  }
  return chunks;
}

/**
 * Placeholder id for Anthropic tool_call_delta / tool_call_end: the streaming
 * input_json_delta and content_block_stop frames do NOT carry the tool call id
 * (Anthropic only names it once, in content_block_start). The parser tracks
 * block identity via the `index`; consumers that need a concrete id should map
 * the block index → id themselves (AgentLoop wiring is task 049).
 */
export const toolIdPlaceholder = 'anthropic-tool';

/** Rewrite for inputs whose id is known from the parser's per-index tracking. */
export function anthropicUsageChunk(
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  },
): Extract<StreamChunk, { type: 'usage' }> {
  return {
    type: 'usage',
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    // task 099: Anthropic reports cache writes only on message_start (the
    // message_delta frame carries output_tokens alone), so this stays
    // undefined there — the consumer folds per-field last-wins and an
    // undefined field never clobbers the earlier value.
    cacheCreationTokens: usage.cache_creation_input_tokens,
  };
}

/**
 * Anthropic wire `stop_reason` → the internal four-value closed set.
 *
 * BRIEF「同一个 wire 值，两个 provider 三套口径」— this is now a DELEGATION to the
 * package's single table (`wireFinishReason`, packages/llm/src/finishReason.ts),
 * exactly like `openAIFinishReason` in parseOpenAI.ts. One wire token must have
 * ONE verdict in every path of `@vessel/llm`.
 *
 * 改前（本卡的复现）：`default: return stopReason;` **原样透传**未知值 ——
 * `message_delta{stop_reason:'refusal'}` 产出的就是 `message_end{finishReason:'refusal'}`，
 * 而消费侧 `AgentLoop.normalizeFinishReason`（AgentLoop.ts:86-90）对非
 * `length`/`error`/`tool_calls` 的值一律归成 `'stop'` ⇒ 真实路径（`callModel` 只要
 * provider 有 `stream()` 就走流式）上 `'refusal'` = `kind='success'`（文本非空）/
 * `'budget'`（文本空）—— **把"未知终止原因"说成"正常结束"**，而同一个值在非流式
 * `AnthropicProvider.chat()` 里是 `'error'`。同批给 OpenAI 立下的裁决相反
 * （parseOpenAI.ts `openAIFinishReason`：content_filter/未知值 ⇒ 'error'）。
 *
 * 既有映射逐字不变（本卡逐条上锁，见 parseAnthropic.test.ts）：
 *   end_turn / stop_sequence -> 'stop'、tool_use -> 'tool_calls'、max_tokens -> 'length'；
 *   `'stop'`/`'tool_calls'`/`'length'`/`'error'`（OpenAI 形 token）改前走 default
 *   **原样透传**，而透传值恰好与共享表的值相同 ⇒ 这四者同样逐字不变。
 * 变化只在"表不认识的值"：改前原样透传（⇒ 最终被 loop 读成 'stop'），现在 ⇒ `'error'`。
 *
 * **缺失/空值的既有语义不变**：流式路径根本不会用缺失值调用本函数 ——
 * `parseAnthropicEvent` 的 `message_delta` 分支有 `if (ev.delta?.stop_reason)` 守卫
 * （空串 `''` 同样是 falsy），所以"wire 不带 stop_reason ⇒ `message_end` 不带
 * `finishReason` 字段"逐字不变；非流式 `chat()` 的缺失值改前/改后都是 `'error'`
 * （共享表对 `undefined`/`''` 给 `'error'`，与该路径既有裁决一致）。
 */
export function anthropicFinishReason(stopReason: string | undefined): ChatFinishReason {
  return wireFinishReason(stopReason);
}

/** Extract the JSON payload after an SSE `data:` field from a transport line. */
export function anthropicSSELineData(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith(':')) return null;
  const fieldEnd = line.indexOf(':');
  if (fieldEnd === -1) return null;
  const field = line.slice(0, fieldEnd).trim();
  if (field !== 'data') return null;
  return line.slice(fieldEnd + 1).trim();
}

/**
 * Stateful driver for one Anthropic stream. Feeds the raw SSE lines (both the
 * `event:` and `data:` frames) and collects StreamChunk[]. Tracks the tool-use
 * block by content index so content_block_delta/stop can carry the real id.
 *
 * Round 52 — the two Anthropic counterparts of the Round 46 OpenAI fix in
 * parseOpenAI.ts, under the same policy: never drop data on the floor.
 *   1. A `tool_use` block whose `content_block_start` carries no `id`/`name`
 *      produced NO `tool_call_start`, while its `input_json_delta` frames kept
 *      producing `tool_call_delta`. Consumers key their argument accumulator by
 *      the id of the start chunk (AgentLoop.consumeStream: `open.get(chunk.id)`,
 *      appending only `if (acc)`), so every fragment was silently discarded.
 *      Identity and fragments are now tracked per block index
 *      (`pendingArgsByIndex`), and a call whose identity never completes is
 *      surfaced EXPLICITLY at its block boundary (and at the stream boundary)
 *      instead of vanishing.
 *   2. `finish()` returned `[]` for a truncated stream (EOF without
 *      `message_stop`): no `message_end`, and no `tool_call_end` for a block
 *      that was still open. It now runs the same terminal boundary as the
 *      OpenAI driver: flush the never-identified calls, close the calls that
 *      did start, then emit `message_end`.
 *
 * Round 54 — the one thing Round 52 left silent: a frame whose `data:` payload
 * is not parseable JSON (the truncated tail of a dropped connection, which the
 * provider feeds from its leftover buffer at EOF, is the most common CAUSE —
 * the criterion is just "that payload failed JSON.parse", so a proxy's error
 * page or a `data: ping` line counts too) was still dropped without a trace. It
 * stays dropped, and nothing retains it — the raw line IS in hand at the catch
 * that drops it, the parser simply keeps no copy — but it is now COUNTED, per
 * stream, via the read-only `malformedFrames` getter.
 * No new event type, no change to feed()'s return shape, no change to
 * `message_end`, and no change to the shared event vocabulary.
 *
 * Duplicate `content_block_start` — the third member of the family this file
 * keeps closing (Round 46 OpenAI "start after start", Round 52 here
 * "identity-incomplete block", Round 53 "the `{}` seed"): a wire that repeats
 * `content_block_start` for an index that already started used to re-emit
 * `tool_call_start`, and AgentLoop.consumeStream's `open.set(...)` then
 * OVERWROTE the accumulator holding every fragment received so far. The start
 * is now suppressed for a started index; a non-empty seed it carries is folded
 * into a `tool_call_delta` instead of being discarded, and an empty seed emits
 * nothing. Canonical streams (one start per index) are byte-for-byte unchanged —
 * see the `startedIndexes` guard in feed() and the duplicate-start cases in
 * parseAnthropic.test.ts.
 *
 * Round 65 — the observability counterpart of that fix, and the reason it must
 * be a SEPARATE counter. A repeated `content_block_start` is a PROTOCOL
 * VIOLATION, and the wire has a second shape of it that the `startedIndexes`
 * guard cannot even see: a repeat that carries no `id`/`name`, for which
 * `parseAnthropicEvent` emits no `tool_call_start` at all (its `block.id &&
 * block.name` guard is false), so feed()'s chunk loop never runs for that frame.
 * (As written, that shape also lost its `input` seed: it was written into
 * `toolInputJsonByIndex` and read by nobody — `flushToolBlock`, the only reader,
 * serves UNSTARTED blocks, and this index is started. Round 69 below closes that
 * last loss with a fold of its own, taken at the same `identityFrozen` test.)
 * BOTH shapes are now counted, once per violating frame, by the read-only
 * `duplicateStarts` getter, because the count is taken at the frame (before the
 * mapper) rather than at the emitted chunk.
 *
 * Deliberately NOT folded into `malformedFrames`: that one means "this frame's
 * `data:` payload failed JSON.parse — a byte-level failure, whose most common
 * cause is a connection truncated mid-frame"; this one means "the bytes parsed
 * fine and the PEER re-sent a frame the protocol forbids". Merging them would
 * make "the connection was cut" and "the upstream repeated itself"
 * observationally identical — the exact blindness Round 54 was written to end,
 * one level up.
 *
 * Round 68 — the OTHER half of that violation, and the reason "suppress the
 * repeat" was only half a fix. Round 64 stopped the repeated start from being
 * re-emitted, but the frame still reached the two `set()` calls that register a
 * tool_use block's identity, which OVERWROTE it whenever the repeat carried a
 * DIFFERENT id (+ name). Identity is not decoration here: every chunk of the
 * block's remaining life is addressed from `toolIdByIndex` — each
 * `input_json_delta` and the `content_block_stop`'s `tool_call_end` — so the
 * rewrite re-addressed all of it to an id the consumer had never opened a call
 * for (AgentLoop.consumeStream keys its accumulator by the START's id:
 * `open.get(chunk.id)`). Three consequences, all silent: the repeat's folded
 * seed landed in no accumulator, the ORIGINAL call received no `tool_call_end`
 * of its own (the agent loop's stream-boundary fallback closed it instead), and
 * the stream carried an orphan `tool_call_end` for a call nobody opened. The
 * identity of a STARTED block is now frozen at its first start: a repeat cannot
 * rewrite it, and the folded seed is addressed to that frozen id — which makes
 * this shape behave exactly like the same-id shape Round 64 had already made
 * safe. A block whose identity is still INCOMPLETE is deliberately NOT frozen:
 * completing it from a later frame is Round 52's recovery (the identity-late
 * wire order), and such a block has no consumer-side call to address yet.
 *
 * Round 69 — shape A, the last member of the family, and the one no earlier fix
 * could reach. A repeat that carries NO `id`/`name` but a non-empty `input`
 * (the two earlier shapes both carry an identity, so they at least produce a
 * `tool_call_start` for the chunk loop to intercept) makes
 * `parseAnthropicEvent`'s `block.id && block.name` guard emit NOTHING, so
 * feed()'s chunk loop — where Round 64's fold and Round 68's frozen address both
 * live — never runs for that frame. The seed it wrote into
 * `toolInputJsonByIndex` was read by nobody (`flushToolBlock` serves UNSTARTED
 * blocks; this index is started), so the frame's arguments vanished with no
 * chunk, no accumulator entry and no trace beyond the `duplicateStarts` count.
 * The fold is therefore taken one level up, at the SAME `identityFrozen` test
 * where the identity freeze is decided: a STARTED index + a frame carrying
 * neither `id` nor `name` + a non-empty seed ⇒ one `tool_call_delta` addressed
 * to the block's frozen id, i.e. the id the consumer opened its accumulator
 * under. Empty seeds emit nothing, the same information-free rule Round 64 uses
 * for `input:{}`/absent `input`. Every other frame takes the pre-existing path
 * untouched: a canonical stream never freezes, and a repeat carrying `id`/`name`
 * still folds in the chunk loop.
 *
 * Round 70 — the three residual corners Round 69 left open, closed here. None of
 * them touches a canonical stream (one `content_block_start` per index, whose
 * `input` is the empty placeholder), and none of them fires on the shapes Rounds
 * 64/68/69 already fixed:
 *   1. the HALF-IDENTITY repeat (only `id`, or only `name`) was invisible to the
 *      mapper for exactly the same reason shape A was — `block.id && block.name`
 *      is false — so it reached the same seedless path. The fold below is now
 *      taken on `!(block.id && block.name)` ("identity incomplete") instead of
 *      `!block.id && !block.name` ("identity entirely absent"), which is the
 *      literal complement of the mapper's guard. It cannot double-deliver: a
 *      STARTED index has no reader for `toolInputJsonByIndex` at all (its only
 *      readers are `flushToolBlock` and the chunk loop's start branch, and both
 *      run for unstarted blocks), which is the same fact that justifies (3);
 *   2. `toolInputJsonByIndex` was an index→SINGLE-VALUE map, so a second frame
 *      carrying a seed OVERWROTE the first. Two reachable paths lost data:
 *      (a) two identity-incomplete starts on one index — `flushToolBlock`
 *      surfaced only the LAST seed; (b) an identity-late completion — the start
 *      carried only the completing frame's seed and the earlier one was deleted
 *      by the `forgetToolBlock` that follows the start. It now APPENDS, like
 *      `pendingArgsByIndex`, and a start CONSUMES what earlier frames left there;
 *   3. the write no longer touches a started index (`!identityFrozen`), where it
 *      could only create an entry nobody reads, and no longer stores a frame's
 *      seed when that frame's own `tool_call_start` already carries it.
 */
export class AnthropicStreamParser {
  /** block index -> tool_use id (only content_block_start carries it). */
  private readonly toolIdByIndex = new Map<number, string>();
  /** block index -> tool_use name (only content_block_start carries it). */
  private readonly toolNameByIndex = new Map<number, string>();
  /**
   * block index -> the argument seeds contributed by `content_block_start`
   * frames at that index which did NOT deliver a start of their own, in wire
   * order, APPENDED to each other.
   *
   * Round 70 changed two things about this map, both about not losing an earlier
   * seed:
   *   - it used to be written with `set(index, seed)`, i.e. an index→SINGLE-VALUE
   *     map, so a second seeded frame at that index overwrote the first. Two
   *     reachable paths lost data that way: two identity-incomplete starts (only
   *     the last seed reached `flushToolBlock`) and the identity-late completion
   *     (only the completing frame's seed reached the start). It now APPENDS,
   *     exactly like `pendingArgsByIndex`. An information-free seed is never
   *     stored at all, so appending cannot pad the entry with empty strings;
   *   - it is no longer written once the index has STARTED (`!identityFrozen`)
   *     nor for a frame whose seed its own `tool_call_start` already carries.
   *
   * Round 53 still governs the VALUE: the canonical empty-object `input` yields
   * `''` (no seed), so the accumulated value under a canonical stream is the
   * fragments alone. Round 70 only changed how the contributions of SEVERAL
   * frames combine; the frames themselves are unchanged.
   *
   * Readers: exactly two, and both require the block to be UNSTARTED —
   * `flushToolBlock` (identity never completed) and the chunk loop's
   * `tool_call_start` branch, which PREPENDS the buffered seeds to the start's
   * own arguments and clears the entry. That is why it is safe for the write to
   * be skipped on a started index: such an entry could never be read.
   */
  private readonly toolInputJsonByIndex = new Map<number, string>();
  /**
   * Round 52: block index -> `input_json_delta` fragments that arrived while the
   * block had not started (no complete identity), held in wire order so the
   * eventual start can replay them — or so the boundary flush can surface them
   * explicitly. An entry only exists once a fragment has arrived.
   */
  private readonly pendingArgsByIndex = new Map<number, string>();
  /**
   * Round 52: block indexes whose `tool_call_start` has been emitted. Only a
   * block in here has a consumer-side accumulator a `tool_call_delta` can still
   * land in.
   */
  private readonly startedIndexes = new Set<number>();
  /** Round 52: block indexes seen as a tool_use block (started or not). */
  private readonly toolIndexes = new Set<number>();
  private started = false;
  private ended = false;
  /**
   * Round 54 — how many frames THIS stream dropped because their `data:` payload
   * was not parseable JSON. Instance state, not module state: it is per stream by
   * construction, so two parsers can never accumulate into each other, and
   * nothing here is shared with `parseAnthropicEvent` (which owns no state).
   */
  private malformedFrameCount = 0;
  /**
   * Round 65 — block indexes whose `content_block_start` has arrived and whose
   * `content_block_stop` has NOT: the "this block is still open" test that
   * defines a duplicate-start protocol violation. It covers every block type
   * (text and tool_use alike — the protocol has one block per index, so a repeat
   * for an open index is the violation whatever the block holds), and the entry
   * is cleared at `content_block_stop` (and by forgetToolBlock, which drops
   * every trace of a closed block). Reusing an index AFTER its block closed is
   * therefore legal and counts nothing.
   */
  private readonly openBlockIndexes = new Set<number>();
  /**
   * Round 65 — how many `content_block_start` frames THIS stream delivered for
   * an index whose block was still open. Instance state, exactly like
   * malformedFrameCount: per stream by construction, never module state, so two
   * parsers can never accumulate into each other.
   */
  private duplicateStartCount = 0;

  /**
   * Round 54 — READ-ONLY per-stream count of frames dropped as unparseable.
   *
   * Why this exists at all: at EOF the transport hands the leftover buffer to
   * feed() as one last frame (AnthropicProvider.ts "if (buffer.trim().length > 0)
   * parser.feed(buffer)"), so the half-written JSON tail of a TRUNCATED
   * connection necessarily lands in feed()'s parse catch. Pre-Round-54 that
   * catch returned [] exactly like every "there was nothing to emit" path, which
   * made "the connection was cut mid-frame" and "the model simply sent no more
   * frames" observationally identical — a successful-looking turn with silent
   * byte loss.
   *
   * Idempotency boundary: a frame is counted at most once, at the single
   * `catch (JSON.parse)` that drops it, and only for a line that reached that
   * parse. Reading this getter never mutates anything; finish() does not re-scan
   * frames, so it cannot re-count. A line fed after the stream already ended
   * (post message_stop) returns before the parse and is NOT counted — trailing
   * bytes beyond the terminal boundary are out of scope by design.
   */
  get malformedFrames(): number {
    return this.malformedFrameCount;
  }

  /**
   * Round 65 — READ-ONLY per-stream count of duplicate-`content_block_start`
   * protocol violations: a `content_block_start` arriving for an index whose
   * block has not been `content_block_stop`ped yet.
   *
   * Why a SEPARATE counter rather than folding it into malformedFrames: the two
   * describe different incidents that need different responses. malformedFrames
   * means this frame's `data:` payload failed JSON.parse — a byte-level failure
   * whose most common CAUSE is a truncated connection, i.e. the TRANSPORT is
   * broken. This one means the bytes were perfectly fine and the
   * PEER re-sent a frame the protocol forbids — the UPSTREAM is confused, and
   * what happens to the argument seed riding on the repeat depends on the
   * repeat's SHAPE, which this counter does not look at: Round 64 folded a
   * same-id repeat's non-empty seed into a `tool_call_delta`, Round 68 made
   * a different-id repeat behave the same by addressing that fold to the block's
   * FROZEN identity, and Rounds 69/70 gave the identity-INCOMPLETE shapes — a
   * repeat carrying no `id`/`name` and a repeat carrying only one of the two,
   * both of which the mapper's identity guard turns into no chunk at all — a
   * fold of their own at the `identityFrozen` test in feed(). A repeat carrying
   * a non-empty seed therefore DELIVERS it in every shape, and one carrying
   * an empty seed delivers nothing because there is nothing to deliver.
   * "Dropped" is therefore NOT a property of this counter and must never be
   * asserted from it. One merged number would make "the connection was cut" and
   * "the upstream repeated itself" observationally identical.
   *
   * The criterion is deliberately the literal one — the block is OPEN (no
   * `content_block_stop` seen for this index) and another `content_block_start`
   * arrives for it — because it is the only criterion that sees EVERY shape
   * of the violation:
   *   - the shape Round 64's guard in feed() handles: the repeat carries
   *     `id`+`name`, so a `tool_call_start` IS produced, the guard suppresses it
   *     and folds its non-empty seed into a `tool_call_delta` — addressed, since
   *     Round 68, to the block's frozen identity, so it lands in the consumer's
   *     accumulator whether the repeat's id matches the first start's or not;
   *   - the shapes the chunk loop never reaches: the repeat's identity is
   *     INCOMPLETE (no `id`/`name` at all, or only one of the two — Round 70),
   *     so `parseAnthropicEvent`'s identity guard emits NOTHING for it and
   *     feed()'s chunk loop is never entered. Since Round 69 (and, for the
   *     half-identity case, Round 70) that frame's non-empty seed is folded where
   *     the freeze is decided (the `identityFrozen` branch of feed()'s
   *     content_block_start handling), so it is delivered too.
   *     Counted here all the same, because this test is taken at the FRAME,
   *     before the mapper — the count never depended on an emission point.
   * A narrower "already STARTED" test would silently miss that second shape.
   *
   * NOT counted, by construction: the first start of an index; a start after
   * that index's `content_block_stop` (the entry is deleted there — index reuse
   * is legal once the block closed); deltas and stops that never opened a block;
   * and any frame fed after the terminal `message_stop`, where feed() returns
   * before parsing (the same documented boundary as malformedFrames).
   *
   * Idempotency boundary: each violating FRAME is counted exactly once, at the
   * single `openBlockIndexes.has(index)` test in feed(); the mapper never counts,
   * so one frame can never be counted on two paths. Reading this getter mutates
   * nothing, and finish() re-scans no frames, so neither can re-count.
   */
  get duplicateStarts(): number {
    return this.duplicateStartCount;
  }

  feed(line: string): StreamChunk[] {
    if (this.ended) return [];
    const out: StreamChunk[] = [];

    // The `data:` line carries the payload; the `event:` line is descriptive.
    const data = anthropicSSELineData(line);
    if (data === null) return out;

    let ev: AnthropicEventData;
    try {
      ev = JSON.parse(data) as AnthropicEventData;
    } catch {
      // Round 54: this is the reachable one — the truncated tail frame arrives
      // here via the provider's EOF residual-buffer feed. Count it, then drop it
      // as before (the counter is the ONLY behaviour change).
      this.malformedFrameCount += 1;
      return out;
    }
    if (typeof ev !== 'object' || ev === null) return out;

    if (!this.started && ev.type === 'message_start') this.started = true;

    const index = ev.index ?? 0;

    // Round 65 — protocol-violation accounting, taken in the ONE place that sees
    // every `content_block_start` frame whatever the mapper does with it: before
    // parseAnthropicEvent runs, so the shape whose identity guard emits no chunk
    // at all (no `id`/`name`) is counted exactly like the shape that does emit
    // one. A start for an index whose block is still open is the violation (the
    // protocol allows one start per block, and only a `content_block_stop` — or
    // the stream's terminal boundary — closes one); the first start of an index
    // never counts, and neither does a start after that index was stopped.
    if (ev.type === 'content_block_start') {
      if (this.openBlockIndexes.has(index)) this.duplicateStartCount += 1;
      this.openBlockIndexes.add(index);

      // Round 52: content_block_start is the ONLY frame that carries a tool-use
      // block's id/name, so remember whatever it announced — even partially. A
      // block that never completes its identity is still surfaced below.
      const block = ev.content_block;
      if (block?.type === 'tool_use') {
        this.toolIndexes.add(index);
        // Round 68 — FIRST START FREEZES IDENTITY. An index that has already
        // emitted its `tool_call_start` owns the id that every later chunk of the
        // block is addressed to (the `tool_call_delta`s below and the
        // `content_block_stop` end all read `toolIdByIndex`), so a repeat must
        // not REWRITE it: pre-fix these two `set()` calls replaced the id with
        // the repeat's, re-addressing the rest of the block's life to an id the
        // consumer had never opened (AgentLoop.consumeStream `open.get(chunk.id)`)
        // — the repeat's seed landed nowhere, the original call got no end of its
        // own, and the stream carried an orphan `tool_call_end`.
        //
        // The guard is the STARTED test, deliberately not "any identity was
        // registered": a block whose identity is still incomplete has no
        // consumer-side call yet, and COMPLETING that identity from a later frame
        // is Round 52's recovery for the identity-late wire order. Freezing it
        // here would turn that recovery back into a placeholder-id flush.
        const identityFrozen = this.startedIndexes.has(index);
        if (block.id && !identityFrozen) this.toolIdByIndex.set(index, block.id);
        if (block.name && !identityFrozen) this.toolNameByIndex.set(index, block.name);
        const seed = anthropicToolInputSeed(block.input);
        // Round 69/70 — the duplicate-start family's identity-INCOMPLETE shapes,
        // folded HERE because this is the only place they can be seen. A repeat
        // whose identity is incomplete — neither `id` nor `name` (Round 69's
        // shape A, e.g. `{input:{limit:2}}`), or only ONE of the two (Round 70's
        // half-identity shapes: `{id,input}` / `{name,input}`) — makes the
        // mapper's `block.id && block.name` guard emit no chunk at all, so the
        // chunk loop below (where Round 64's fold lives) is never entered for
        // that frame, and a seed written into `toolInputJsonByIndex` there would
        // have no reader (`flushToolBlock` and the chunk loop's start branch both
        // require an UNSTARTED block). The chunk emitted here is the very shape
        // the consumer accumulates, addressed to the block's FROZEN id:
        // AgentLoop.consumeStream appends `argumentsDelta` to the accumulator
        // opened by the first start's id (`open.get(chunk.id)`), so the repeat's
        // arguments land instead of vanishing.
        //
        // Three conjuncts, each load-bearing:
        //   - `identityFrozen`  ⇒ the frame IS a repeat (a first start of an
        //     incomplete-identity block must keep Round 52's recovery: it has no
        //     consumer-side call yet, and its seed is buffered for
        //     flushToolBlock / the eventual start — see the write below);
        //   - `!(block.id && block.name)` ⇒ exactly the frames the mapper drops,
        //     because it is the literal complement of the mapper's own guard.
        //     Round 69 spelled this `!block.id && !block.name` (the complement
        //     minus the half-identity frames), which silently excluded a repeat
        //     carrying only one of the two — the mapper dropped it just the same,
        //     so its seed reached the same readerless write and was lost. Round
        //     70 widened the conjunct to the mapper's actual complement; a repeat
        //     carrying BOTH still goes through the chunk loop and takes Round
        //     64/68's path, byte-for-byte as before. Widening cannot double
        //     deliver: on a started index this map has no reader at all;
        //   - `seed !== ''` ⇒ an information-free repeat (`input:{}` / absent
        //     `input`) emits NOTHING, the same rule Round 64 applies there. A
        //     `tool_call_delta` with an empty `argumentsDelta` would be a junk
        //     chunk the consumer could not even notice.
        // A canonical stream (one start per index) never has a frozen identity,
        // so this branch is dead on it.
        if (identityFrozen && !(block.id && block.name) && seed !== '') {
          out.push({ type: 'tool_call_delta', id: this.toolIdByIndex.get(index) ?? toolIdPlaceholder, argumentsDelta: seed });
        }
        // Round 70 ②/③ — the seed buffer of an UNSTARTED block, APPEND-only. The
        // pre-Round-70 write was `if (block.input != null) set(index, seed)`,
        // which turned this index→value map into a silent OVERWRITE point:
        //   (a) two identity-incomplete starts at one index (each carrying a
        //       non-empty `input`) kept only the LAST seed for the eventual
        //       `flushToolBlock` ⇒ the earlier one was lost;
        //   (b) an identity-late completion kept only the completing frame's seed
        //       [the start's own `arguments`] while the earlier seed sat in this
        //       map until the start's `forgetToolBlock` deleted it ⇒ also lost.
        // Appending in wire order fixes both: `flushToolBlock` and the chunk
        // loop's start branch (which prepends this buffer) then see every seed.
        //
        // The other two conjuncts are what keeps the write from being DEAD:
        //   - `!identityFrozen` ⇒ once the index has started, both readers are
        //     unreachable (`isUnstartedToolBlock` starts with
        //     `startedIndexes.has(index)`, and the chunk loop's prepend runs for a
        //     start that then clears the entry), so such a write could only create
        //     an entry nobody reads. Removing it loses no data: the seed of a
        //     repeat on a started index is delivered by the fold above, and the
        //     seed of the block's own start rode on its `tool_call_start`;
        //   - `!(block.id && block.name)` ⇒ a frame with COMPLETE identity
        //     delivers its seed through its own start chunk below, so buffering it
        //     would double count it in that chunk's `arguments`;
        //   - `seed !== ''` ⇒ an information-free frame appends nothing (and an
        //     entry holding `''` would be indistinguishable from no entry to
        //     every reader anyway) — the same rule as the fold above.
        if (!identityFrozen && !(block.id && block.name) && seed !== '') {
          this.toolInputJsonByIndex.set(index, (this.toolInputJsonByIndex.get(index) ?? '') + seed);
        }
      }
    }

    // message_stop is the terminal boundary — the Anthropic counterpart of the
    // OpenAI driver's `[DONE]` handler: close whatever is still open BEFORE the
    // message_end chunk. On the canonical wire every block has already been
    // stopped here, so this sweep is empty and the output is unchanged.
    if (ev.type === 'message_stop') {
      out.push(...this.closeOpenToolCalls());
      this.ended = true;
    }

    // Round 65: the block is CLOSED from here on — reusing this index is legal,
    // so it must stop counting as an open block. Cleared for every block type
    // (a text block's stop lands here too, and it closes just as much).
    if (ev.type === 'content_block_stop') this.openBlockIndexes.delete(index);

    // A tool_use block that never started (identity incomplete) is surfaced at
    // its own boundary, ahead of the generic mapping below: the mapped
    // tool_call_end of that content_block_stop must not become a bare end for a
    // call the consumer never opened.
    if (ev.type === 'content_block_stop' && this.isUnstartedToolBlock(index)) {
      out.push(...this.flushToolBlock(index));
    }

    // Round 54: the sink is wired even though `ev` is already a parsed object
    // here (so this particular call can never fire it) — it makes the counter
    // correct BY CONSTRUCTION for any future wiring that hands the raw `data:`
    // string to the mapper instead. It cannot double count: the catch directly
    // above and this sink are mutually exclusive per frame, because a payload
    // that reaches the mapper as an object never re-enters JSON.parse.
    const chunks = parseAnthropicEvent(ev, () => {
      this.malformedFrameCount += 1;
    });

    // content_block_stop also fires for TEXT blocks; only a stop of a block we
    // actually started yields tool_call_end (deliberate rule, unchanged).
    const isToolStop = ev.type === 'content_block_stop';
    for (const c of chunks) {
      if (c.type === 'tool_call_start') {
        // Round 70 ② — the seeds of the EARLIER `content_block_start` frames at
        // this index (identity-late wire order: they could not deliver a start of
        // their own, so they were buffered — see the `toolInputJsonByIndex` write
        // above) are PREPENDED to the start's own arguments, and the buffer is
        // cleared: the start is the ONE moment that buffer becomes deliverable.
        // Pre-Round-70 those seeds were overwritten or left to `forgetToolBlock`,
        // so only the completing frame's `input` survived; now every seed of the
        // block's life arrives, in the order the frames arrived.
        //
        // Prepending (rather than interleaving with the fragments below) is the
        // deliberate, minimal-diff choice: the two buffers are each
        // order-preserving but mutually lossy about interleaving, so the rule
        // stated here is "all `content_block_start` seeds first, then the
        // fragments" — the same rule the pre-existing sentence below states for
        // the single-seed case, generalized. Canonical streams never write this
        // buffer ⇒ `undefined` ⇒ byte-identical output.
        const bufferedSeed = this.toolInputJsonByIndex.get(index);
        if (bufferedSeed !== undefined) {
          c.arguments = bufferedSeed + c.arguments;
          this.toolInputJsonByIndex.delete(index);
        }

        // Identity complete: fragments that arrived before it (identity-late
        // wire order) are replayed as part of the start's arguments, in the
        // order Anthropic defines them (`input` first, then the fragments). The
        // canonical order leaves the buffer empty ⇒ byte-identical output.
        const pending = this.pendingArgsByIndex.get(index);
        if (pending !== undefined) {
          c.arguments += pending;
          this.pendingArgsByIndex.delete(index);
        }

        // A SECOND `content_block_start` for a block index that already started
        // — the Anthropic counterpart of the Round 46 guard in
        // parseOpenAIStreamChunk (`state.startedIndexes.has(index)`), under the
        // same policy. The block index IS the identity: everything after the
        // first start is a continuation, so a repeated start must NOT be
        // re-emitted. Re-emitting it makes the consumer OVERWRITE the
        // accumulator it already holds (AgentLoop.consumeStream
        // `case 'tool_call_start': open.set(chunk.id, { name, args: chunk.arguments })`),
        // silently discarding every fragment accumulated since the first start.
        //
        // The repeated start is therefore dropped — but NOT the arguments it
        // carries. A non-empty seed (`content_block_start.input` with own keys)
        // is FOLDED into an append-only `tool_call_delta`, the one chunk shape
        // the consumer accumulates, so the earlier fragments and this frame's
        // data both survive. An empty seed (`input:{}` / absent `input`, i.e.
        // what anthropicToolInputSeed turns into `''`) contributes nothing and
        // is not emitted at all — a duplicate start carrying no information is
        // byte-for-byte invisible downstream, exactly like a single start.
        //
        // `pendingArgsByIndex` is merged first, so even a (currently impossible)
        // buffered fragment on an already-started index would be carried into
        // the folded delta rather than disappear.
        //
        // Round 68: the fold is addressed to the block's FROZEN identity —
        // `toolIdByIndex`, which the Round 68 guard in feed()'s
        // content_block_start branch no longer lets a repeat overwrite — and NOT
        // to `c.id`, the id this particular frame happens to carry. That single
        // difference is what makes a repeat carrying a DIFFERENT id behave like
        // the same-id one: the seed lands in the accumulator the first start
        // opened, the block's own `content_block_stop` still closes that same id,
        // and no orphan `tool_call_end` is produced. On a same-id repeat the two
        // expressions are the same string ⇒ byte-identical output.
        //
        // Round 69: this fold only ever sees a repeat that carries an identity —
        // the mapper must produce a `tool_call_start` for the loop to run at all.
        // The repeat that carries NEITHER `id` nor `name` is folded upstream, at
        // the `identityFrozen` test in feed()'s content_block_start handling,
        // which is the only place that frame is visible.
        if (this.startedIndexes.has(index)) {
          if (c.arguments !== '') {
            out.push({ type: 'tool_call_delta', id: this.toolIdByIndex.get(index) ?? c.id, argumentsDelta: c.arguments });
          }
          continue;
        }

        this.startedIndexes.add(index);
        out.push(c);
        continue;
      }

      if (c.type === 'tool_call_delta') {
        if (!this.startedIndexes.has(index)) {
          // No start has been emitted for this block, so a delta would be
          // dropped by every consumer that keys its accumulator by the start's
          // id (AgentLoop.consumeStream does exactly that). Hold the fragment —
          // content_block_stop / finish() surfaces it explicitly.
          this.pendingArgsByIndex.set(index, (this.pendingArgsByIndex.get(index) ?? '') + c.argumentsDelta);
          continue;
        }
        out.push({ ...c, id: this.toolIdByIndex.get(index) ?? c.id });
        continue;
      }

      if (c.type === 'tool_call_end') {
        if (!isToolStop || !this.startedIndexes.has(index)) continue;
        out.push({ ...c, id: this.toolIdByIndex.get(index) ?? c.id });
        this.forgetToolBlock(index);
        continue;
      }

      out.push(c);
    }

    return out;
  }

  /**
   * Finalize the stream — the OpenAI driver's `finish()` semantics: close the
   * calls that are still open and emit `message_end`, so a truncated connection
   * (EOF with no `message_stop`) ends the stream with the same terminal signals
   * as the OpenAI path instead of returning `[]`.
   */
  finish(): StreamChunk[] {
    if (this.ended) return [];
    this.ended = true;
    return [...this.closeOpenToolCalls(), { type: 'message_end' }];
  }

  /**
   * Round 52 — the terminal boundary, the Anthropic counterpart of the OpenAI
   * driver's `closeToolCalls(true)`:
   *   - every tool_use block whose identity never completed is surfaced
   *     explicitly by flushToolBlock (placeholder call — never dropped);
   *   - every block that DID start but never saw its content_block_stop gets its
   *     tool_call_end.
   * Both in block order, so a stream with several parallel tool blocks stays
   * deterministic.
   */
  private closeOpenToolCalls(): StreamChunk[] {
    const out: StreamChunk[] = [];

    const unstarted = new Set<number>([
      ...this.toolIndexes,
      ...this.pendingArgsByIndex.keys(),
      ...this.toolIdByIndex.keys(),
      ...this.toolNameByIndex.keys(),
    ]);
    for (const index of [...unstarted].filter((i) => !this.startedIndexes.has(i)).sort((a, b) => a - b)) {
      out.push(...this.flushToolBlock(index));
    }

    for (const index of [...this.startedIndexes].sort((a, b) => a - b)) {
      out.push({ type: 'tool_call_end', id: this.toolIdByIndex.get(index) ?? toolIdPlaceholder });
      this.forgetToolBlock(index);
    }
    return out;
  }

  /**
   * Round 52: surface a tool_use block whose identity never completed — the
   * Anthropic counterpart of parseOpenAI's flushPendingToolCalls(). One
   * `tool_call_start` carrying everything the wire delivered (the id if we saw
   * one, else `toolIdPlaceholder`; the name if we saw one, else `''`; the
   * block's `input` seed followed by every buffered fragment in wire order),
   * immediately followed by its `tool_call_end`. An empty name is deliberate: it
   * is not a resolvable tool name, so the registry answers with an explicit
   * machine-readable error instead of the call vanishing.
   */
  private flushToolBlock(index: number): StreamChunk[] {
    const id = this.toolIdByIndex.get(index) ?? toolIdPlaceholder;
    const name = this.toolNameByIndex.get(index) ?? '';
    const seed = this.toolInputJsonByIndex.get(index) ?? '';
    const pending = this.pendingArgsByIndex.get(index) ?? '';
    const out: StreamChunk[] = [
      { type: 'tool_call_start', id, name, arguments: seed + pending },
      { type: 'tool_call_end', id },
    ];
    this.forgetToolBlock(index);
    return out;
  }

  /** Is this block a tool_use block that never emitted a tool_call_start? */
  private isUnstartedToolBlock(index: number): boolean {
    if (this.startedIndexes.has(index)) return false;
    return (
      this.toolIndexes.has(index) ||
      this.pendingArgsByIndex.has(index) ||
      this.toolIdByIndex.has(index) ||
      this.toolNameByIndex.has(index)
    );
  }

  /** Drop every trace of a block that has been closed (or flushed). */
  private forgetToolBlock(index: number): void {
    this.toolIdByIndex.delete(index);
    this.toolNameByIndex.delete(index);
    this.toolInputJsonByIndex.delete(index);
    this.pendingArgsByIndex.delete(index);
    this.startedIndexes.delete(index);
    this.toolIndexes.delete(index);
    // Round 65: the block is closed, so it is no longer "open" — keeps this
    // method's contract ("every trace") literally true, including for the blocks
    // closed at the stream's terminal boundary rather than by a stop frame.
    this.openBlockIndexes.delete(index);
  }
}