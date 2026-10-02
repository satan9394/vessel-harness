import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentLoop, EventBus, Session } from '@vessel/core';
import type { ChatProvider, ChatRequest, ChatResponse, StreamChunk } from '@vessel/shared';
import { ContextBuilder } from '../builder/Builder.js';
import { Compaction } from './Compaction.js';
import { computeAdaptiveThreshold } from './adaptiveThreshold.js';
import { isContextOverflowError } from './overflowClassifier.js';
import { createOverflowRecovery } from './overflowRecovery.js';

const overflow = new Error("HTTP 400 The input is longer than the model's context length");
const response: ChatResponse = { content: 'recovered', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 1 } };
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('adaptive compaction', () => {
  it.each([
    [1_000_000, 65_536, 65_536, 0.85, 680_000],
    [200_000, 65_536, 65_536, 0.85, 38_928],
    [200_000, 4096, 65_536, 1, 130_368],
    [32_000, 4096, 1024, 0.85, 21_760],
    [32_000, 4096, 65_536, 0.85, -42_432],
  ])('reserves output and buffer (%i)', (contextWindow, maxOutputTokens, safetyBufferTokens, cjkSafetyRatio, expected) => {
    expect(computeAdaptiveThreshold({ contextWindow, maxOutputTokens, safetyBufferTokens, cjkSafetyRatio })).toBe(expected);
  });

  it('defaults to CJK calibration and rejects invalid budgets', () => {
    expect(computeAdaptiveThreshold({ contextWindow: 1_000_000, maxOutputTokens: 65_536 })).toBe(680_000);
    expect(() => computeAdaptiveThreshold({ contextWindow: NaN, maxOutputTokens: 1 })).toThrow(RangeError);
    expect(() => computeAdaptiveThreshold({ contextWindow: 10, maxOutputTokens: -1 })).toThrow(RangeError);
    expect(() => computeAdaptiveThreshold({ contextWindow: 10, maxOutputTokens: 1, cjkSafetyRatio: 2 })).toThrow(RangeError);
  });

  it.each([
    "The input is longer than the model's context length", 'maximum context length is 128000 tokens',
    'context window exceeded', 'prompt is too long: 201000 tokens', 'context_length_exceeded',
    'input token count (21000) exceeds the maximum number of tokens allowed (20000)',
    'context token limit exceeded', 'prompt has too many tokens',
    "This model's maximum context length is 8192 tokens. You requested 9000 tokens (8000 in messages, 1000 in completion tokens).",
    'Input token count (21000) exceeds the maximum number of tokens allowed (20000), including output token allowance.',
  ])('recognizes context exhaustion: %s', (message) => expect(isContextOverflowError(new Error(`HTTP 400 ${message}`))).toBe(true));

  it.each(['HTTP 400 invalid tool arguments', 'token limit exceeded', 'too many tokens',
    'max_tokens exceeded output token limit', 'HTTP 429 tokens per minute rate limit exceeded',
    'max_tokens must be at most 4096', null, undefined])('does not classify unrelated failures: %s', (error) => {
    expect(isContextOverflowError(error)).toBe(false);
  });

  it('recognizes SDK error bodies while respecting HTTP status', () => {
    expect(isContextOverflowError({ statusCode: 400, error: { message: 'prompt is too long' } })).toBe(true);
    expect(isContextOverflowError({ status: 400, message: 'token limit exceeded' })).toBe(true);
    expect(isContextOverflowError({ status: 400, message: 'too many tokens' })).toBe(true);
    expect(isContextOverflowError({ status: 429, message: 'maximum context length' })).toBe(false);
  });

  async function harness(provider: ChatProvider) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-adaptive-'));
    roots.push(root);
    const session = await Session.open({ workspaceRoot: root, sessionId: 'adaptive' });
    for (let i = 0; i < 12; i++) await session.appendSync({ type: 'user/message', msgId: `m${i}`, role: 'user', content: `history-${i} ${'x'.repeat(1000)}`, surface: true });
    const bus = new EventBus();
    const builder = new ContextBuilder({ session, model: 'mock', stableSections: () => [], policyGuidance: () => [], instructions: () => [], getVisibleTools: () => [] });
    const compaction = new Compaction({ session, summarize: async () => 'compact facts' });
    const compact = vi.spyOn(compaction, 'compact');
    const loop = new AgentLoop({ session, bus, model: 'mock', provider, buildContext: (step) => builder.assemble(step), runTool: async () => ({ meta: {} }), getVisibleTools: () => [], modelErrorRecovery: createOverflowRecovery({ session, bus, builder, compaction, maxOutputTokens: 4096 }) });
    return { session, bus, loop, compact };
  }

  it('compacts, rebuilds the actual request and recovers once', async () => {
    const requests: ChatRequest[] = [];
    const chat = vi.fn(async (request: ChatRequest) => { requests.push({ ...request }); if (requests.length === 1) throw overflow; return response; });
    const h = await harness({ id: 'mock', chat });
    const event = vi.fn(); h.bus.on('compaction:overflow_intercepted', event);
    try {
      expect((await h.loop.runTurn('continue')).kind).toBe('success');
      expect(chat).toHaveBeenCalledTimes(2);
      expect(h.compact).toHaveBeenCalledWith('overflow');
      expect(requests[1]!.messages.length).toBeLessThan(requests[0]!.messages.length);
      expect(requests[1]!.maxTokens).toBe(4096);
      expect(event).toHaveBeenCalledTimes(1);
      expect(h.session.replay().filter((r) => r.type === 'compaction:overflow_intercepted')).toHaveLength(1);
      const headers = h.session.replay().filter((r) => r.type === 'request/header');
      expect(headers.at(-1)!.messageCount).toBe(requests[1]!.messages.length);
    } finally { await h.session.close(); }
  });

  it('terminates on repeated overflow without an unbounded loop', async () => {
    // 150000 contains a misleading 5xx substring for the generic classifier.
    const chat = vi.fn(async () => { throw new Error('HTTP 400 maximum context length is 150000 tokens'); });
    const h = await harness({ id: 'mock', chat });
    try {
      await expect(h.loop.runTurn('continue')).rejects.toThrow('Model call failed');
      expect(chat).toHaveBeenCalledTimes(2); expect(h.compact).toHaveBeenCalledTimes(1);
    } finally { await h.session.close(); }
  });

  it.each([false, true])('stream recovery is safe with prior output=%s', async (priorOutput) => {
    let attempts = 0;
    const stream = async function* (): AsyncIterable<StreamChunk> {
      attempts += 1;
      if (attempts === 1) { if (priorOutput) yield { type: 'text_delta', text: 'partial' }; throw new Error('HTTP 400 maximum context length is 150000 tokens'); }
      yield { type: 'text_delta', text: 'recovered' }; yield { type: 'message_end', finishReason: 'stop' };
    };
    const h = await harness({ id: 'mock', chat: async () => response, stream });
    const end = vi.fn(); h.bus.on('model_stream_end', end);
    try {
      if (priorOutput) await expect(h.loop.runTurn('continue')).rejects.toThrow('Model call failed');
      else expect((await h.loop.runTurn('continue')).kind).toBe('success');
      expect(attempts).toBe(priorOutput ? 1 : 2);
      expect(h.compact).toHaveBeenCalledTimes(priorOutput ? 0 : 1);
      expect(end).toHaveBeenCalledTimes(attempts);
    } finally { await h.session.close(); }
  });
});
