/**
 * llm — the single wire→verdict table shared by the three finish-reason paths
 * this card converges (Anthropic `chat()`, Anthropic `stream()`, opencode-go
 * `chat()`).
 *
 * BRIEF「同一个 wire 值，两个 provider 三套口径」: before this module `@vessel/llm`
 * answered the question "what does this wire termination token mean?" in three
 * different places, with three different answers for the SAME token:
 *
 *   1. `stream/parseAnthropic.ts` `anthropicFinishReason()` — canonical Anthropic
 *      tokens mapped, and `default: return stopReason;` passed every unknown token
 *      THROUGH verbatim ('refusal' ⇒ 'refusal'). The consumer,
 *      `AgentLoop.normalizeFinishReason` (packages/core/src/agent-loop/AgentLoop.ts:86-90),
 *      only special-cases `'length'`/`'error'`/`'tool_calls'` — anything else falls
 *      to `'stop'`. So on the real path (`AgentLoop.callModel` streams whenever the
 *      provider has `stream()`) `stop_reason:'refusal'` became `kind='success'`
 *      (non-empty text) / `'budget'` (empty text): an UNKNOWN termination reason
 *      reported as a normal completion.
 *   2. `provider/AnthropicProvider.ts` `chat()` — the same unknown token ⇒ `'error'`.
 *      Two opposite conclusions for one wire value, decided by which method the
 *      caller happened to use.
 *   3. `provider/OpencodeGoProvider.ts` `mapFinishReason()` — `length`/`error` pass
 *      through and EVERYTHING else (including `content_filter` and any unknown
 *      token) ⇒ `'stop'`: a third verdict for a value the sibling OpenAI path
 *      already ruled on.
 *
 * The sibling OpenAI card (`stream/parseOpenAI.ts` `openAIFinishReason`) had
 * already set the ruling this module now applies to all three: "`content_filter`
 * 不是'模型正常说完了'… 未知值：宁可报错，也不把不认识的终止原因说成'完成'".
 *
 * WHY ONE TABLE AND NOT THREE: the invariant this card exists to establish is
 * "one wire token has one verdict". Per-protocol tables cannot provide it — e.g.
 * `'tool_use'` would be `'tool_calls'` at Anthropic and "unknown ⇒ error" at
 * opencode-go, i.e. two conclusions for one token, which is exactly the defect.
 * The canonical token sets of the two wire families are disjoint
 * (`stop`/`tool_calls`/`length`/`error` for OpenAI-shaped wires;
 * `end_turn`/`stop_sequence`/`tool_use`/`max_tokens` for Anthropic Messages), so
 * one union table maps every canonical token of every family to the value that
 * family already had — verified token-by-token against the pre-change behaviour
 * in the tests (`openai-finish-reason.test.ts` ⑤ for the OpenAI family,
 * `parseAnthropic.test.ts` for the Anthropic family, `opencodeGoProvider.test.ts`
 * for the Go endpoint) — while giving every unknown token the single honest
 * verdict `'error'`.
 *
 * The table is provider-agnostic on purpose: a token is either recognized (and
 * carries its verdict) or it is not (⇒ `'error'`). Nothing here inspects WHICH
 * provider produced the token, because that is the only way "同一个 wire 值不能
 * 有两个结论" holds by construction rather than by review.
 *
 * **已收敛（本段后续卡完成）**：`stream/parseOpenAI.ts` 的 `openAIFinishReason` **现在也委托本表**
 * （函数体一行 `return wireFinishReason(wire)`）。⇒ 本包内 **wire → finishReason 只有这一处 switch**；
 * OpenAI wire 能携带的每个 token 的既有映射**逐值未变**（含"有值但未知 ⇒ `'error'`"），
 * 唯一随收敛移动的是 `max_tokens`（`'error'` ⇒ `'length'`）——它**不在 OpenAI 官方枚举内**，
 * 而同为 OpenAI 形 wire 的 opencode-go 路径**早已**给 `'length'`，故收敛后两条同形路径不再自相矛盾。
 * 此前这里写着"the two are NOT the same function…'one table' 不含 OpenAI"——**那句现在已不成立**。
 *
 * Deliberately NOT covered here: the "wire carried NO token" case. Each path's
 * missing-value semantics are frozen and differ by design (OpenAI `chat()` ⇒
 * `'error'`; OpenAI/Anthropic `stream()` carry no `finishReason` on the boundary
 * chunk; Anthropic `chat()` ⇒ `'error'`; opencode-go `chat()` ⇒ `'stop'` /
 * `'tool_calls'`). Callers keep their own explicit branch for that (see
 * `OpencodeGoProvider.mapFinishReason`), and no path may turn "missing" into
 * `'length'`.
 *
 * Scope: `packages/llm` only. `AgentLoop.normalizeFinishReason` (packages/core) is
 * a different question — it normalizes the ALREADY-normalized internal value
 * against the observed content (hasToolCalls) — and `@vessel/llm` must not depend
 * on core, so it stays where it is.
 */
import type { ChatFinishReason } from '@vessel/shared';

/**
 * Map one raw wire termination token to the internal four-value closed set
 * (`ChatFinishReason = 'stop' | 'tool_calls' | 'length' | 'error'`).
 *
 *   `stop` / `end_turn` / `stop_sequence` -> `'stop'`        normal completion (既有裁决，逐字不变)
 *   `tool_calls` / `tool_use`             -> `'tool_calls'`  tool-call completion (既有裁决，逐字不变)
 *   `length` / `max_tokens`               -> `'length'`      truncation (既有裁决，逐字不变)
 *   `error`                               -> `'error'`       explicit wire error (既有裁决，逐字不变)
 *   anything else (present but unrecognized: `content_filter`, `refusal`,
 *   `pause_turn`, `function_call`, a future token) -> `'error'`
 *   no token at all (`undefined` / `''`)  -> `'error'`       (the OpenAI `chat()`
 *                                          existing verdict; paths with a frozen
 *                                          different missing-semantics branch
 *                                          BEFORE calling this, see module docs)
 *
 * `content_filter` is NOT "the model finished normally": the upstream filter cut
 * the answer off, and the internal closed set has no member for it, so `'error'`
 * is the only honest bucket (and it must never be relaxed to `'stop'`, which
 * would be reported as success). An unknown token gets the same treatment — fail
 * loud rather than call a termination reason we do not understand "completion".
 */
export function wireFinishReason(wire: string | undefined): ChatFinishReason {
  switch (wire) {
    case 'stop':
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'tool_calls':
    case 'tool_use':
      return 'tool_calls';
    case 'length':
    case 'max_tokens':
      return 'length';
    // 'error' and every unrecognized token share this branch: the wire says
    // something we either know is a failure, or do not understand at all.
    default:
      return 'error';
  }
}
