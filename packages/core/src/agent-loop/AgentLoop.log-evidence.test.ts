import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentLoop, EventBus, Session } from '@vessel/core';
import type { ChatProvider, ChatResponse, StreamChunk, TurnEndRecord } from '@vessel/shared';

describe('turn/end JSONL evidence', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-log-evidence-')); });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function run(provider: ChatProvider, turns = 1) {
    const session = await Session.open({ workspaceRoot: dir });
    const loop = new AgentLoop({
      session, provider, bus: new EventBus(), model: 'test', maxSteps: 3,
      buildContext: async () => ({ model: 'test', messages: [], tools: [], estimateTokens: 0 }),
      runTool: async () => ({ content: 'ok', meta: {} }), getVisibleTools: () => [],
      llmRetry: { maxRetries: 1 },
    });
    try {
      for (let turn = 0; turn < turns; turn++) await loop.runTurn('test');
      const records = fs.readFileSync(session.logPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const end = records.find(r => r.type === 'turn/end') as TurnEndRecord;
      console.log('JSONL turn/end:', JSON.stringify(end));
      return { end, records };
    } finally { await session.close(); }
  }

  function streaming(phases: StreamChunk[][]): ChatProvider {
    let attempt = 0;
    return {
      id: 'fake', chat: async () => { throw new Error('stream expected'); },
      async *stream() { yield* phases[attempt++]!; },
    };
  }

  it('A: persists usage from two model steps into JSONL', async () => {
    let call = 0;
    const { end } = await run({ id: 'fake', async chat() {
      call++;
      return {
        content: call === 1 ? '' : 'done', finishReason: call === 1 ? 'tool_calls' : 'stop',
        toolCalls: call === 1 ? [{ id: 'one', name: 'test', arguments: {} }] : [],
        usage: { inputTokens: call === 1 ? 10 : 20, outputTokens: call === 1 ? 2 : 3, costEstimate: call === 1 ? 0.125 : 0.25 },
      };
    } });
    expect(end.stats).toEqual({ steps: 2, toolCalls: 1, durationMs: expect.any(Number), tokensUsed: 35, costEstimate: 0.375 });
  });

  it('B: persists start-only fallback id after a later normal step', async () => {
    const { end, records } = await run(streaming([
      [{ type: 'tool_call_start', id: 'unfinished', name: 'test', arguments: '{"x":' }],
      [{ type: 'text_delta', text: 'done' }, { type: 'message_end', finishReason: 'stop' }],
    ]));
    expect(records.find(r => r.type === 'tool/call').arguments).toEqual({ _raw: '{"x":' });
    expect(end.toolCallsWithoutEnd).toEqual(['unfinished']);
  });

  it('negative: normal stream without usage preserves exact key sets and legacy stats', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { end } = await run(streaming([
      [{ type: 'tool_call_start', id: 'complete', name: 'test', arguments: '{}' }, { type: 'tool_call_end', id: 'complete' }],
      [{ type: 'text_delta', text: 'done' }, { type: 'message_end', finishReason: 'stop' }],
    ]));
    expect(end.stats).toEqual({ steps: 2, toolCalls: 1, durationMs: 0 });
    expect(Object.keys(end).sort()).toEqual(['kind', 'seq', 'stats', 'ts', 'turnId', 'type']);
  });

  it('negative: missing chat usage omits stats additions', async () => {
    const { end } = await run({ id: 'fake', async chat() {
      return { content: 'done', toolCalls: [], finishReason: 'stop' } as unknown as ChatResponse;
    } });
    expect(end.stats).toEqual({ steps: 1, toolCalls: 0, durationMs: expect.any(Number) });
  });

  it('stream usage folds cumulative fields once and preserves reported zero cost', async () => {
    const { end } = await run(streaming([[
      { type: 'usage', inputTokens: 10, outputTokens: 1 },
      { type: 'usage', outputTokens: 5, costEstimate: 0 },
      { type: 'text_delta', text: 'done' },
    ]]));
    expect(end.stats).toEqual({ steps: 1, toolCalls: 0, durationMs: expect.any(Number), tokensUsed: 15, costEstimate: 0 });
  });

  it.each([
    { type: 'usage' },
    { type: 'usage', cacheReadTokens: 7 },
  ] as StreamChunk[])('negative: usage without input/output/cost omits keys (%j)', async chunk => {
    const { end } = await run(streaming([[chunk, { type: 'text_delta', text: 'done' }]]));
    expect(end.stats).toEqual({ steps: 1, toolCalls: 0, durationMs: expect.any(Number) });
  });

  it('reported zero tokens are present, missing cost is omitted', async () => {
    const { end } = await run(streaming([[
      { type: 'usage', inputTokens: 0, outputTokens: 0 }, { type: 'text_delta', text: 'done' },
    ]]));
    expect(end.stats).toEqual({ steps: 1, toolCalls: 0, durationMs: expect.any(Number), tokensUsed: 0 });
  });

  it('retry excludes failed attempt ids and usage, retaining only successful fallback ids', async () => {
    let attempt = 0;
    const { end, records } = await run({ id: 'retry', chat: async () => { throw new Error('stream expected'); },
      async *stream(): AsyncGenerator<StreamChunk> {
        attempt++;
        if (attempt === 1) {
          yield { type: 'tool_call_start', id: 'failed', name: 'test', arguments: '{' };
          yield { type: 'usage', inputTokens: 999, outputTokens: 999, costEstimate: 999 };
          throw new Error('network failure');
        }
        if (attempt === 2) {
          yield { type: 'tool_call_start', id: 'accepted', name: 'test', arguments: '{}' };
          yield { type: 'usage', inputTokens: 4, outputTokens: 2 };
        } else yield { type: 'text_delta', text: 'done' };
      },
    });
    expect(attempt).toBe(3);
    expect(end.toolCallsWithoutEnd).toEqual(['accepted']);
    expect(end.stats).toEqual({ steps: 2, toolCalls: 1, durationMs: expect.any(Number), tokensUsed: 6 });
    expect(records.filter(r => r.type === 'tool/call').map(r => r.toolCallId)).toEqual(['accepted']);
  });

  it('retry followed by a compliant stream omits fallback ids', async () => {
    let attempt = 0;
    const { end } = await run({ id: 'retry', chat: async () => { throw new Error('stream expected'); },
      async *stream(): AsyncGenerator<StreamChunk> {
        if (++attempt === 1) {
          yield { type: 'tool_call_start', id: 'failed', name: 'test', arguments: '{}' };
          throw new Error('network failure');
        }
        yield { type: 'text_delta', text: 'done' };
      },
    });
    expect(attempt).toBe(2);
    expect(Object.keys(end).sort()).toEqual(['kind', 'seq', 'stats', 'ts', 'turnId', 'type']);
    expect(end.stats).toEqual({ steps: 1, toolCalls: 0, durationMs: expect.any(Number) });
  });

  it('the same loop starts its next turn without previous stats or fallback ids', async () => {
    const { records } = await run(streaming([
      [{ type: 'tool_call_start', id: 'first', name: 'test', arguments: '{}' }, { type: 'usage', inputTokens: 8, outputTokens: 2 }],
      [{ type: 'text_delta', text: 'done' }],
      [{ type: 'text_delta', text: 'second turn' }],
    ]), 2);
    const ends = records.filter(r => r.type === 'turn/end');
    expect(ends).toHaveLength(2);
    expect(ends[0].toolCallsWithoutEnd).toEqual(['first']);
    expect(ends[0].stats.tokensUsed).toBe(10);
    expect(ends[1].stats).toEqual({ steps: 1, toolCalls: 0, durationMs: expect.any(Number) });
    expect(Object.keys(ends[1]).sort()).toEqual(['kind', 'seq', 'stats', 'ts', 'turnId', 'type']);
  });
});
