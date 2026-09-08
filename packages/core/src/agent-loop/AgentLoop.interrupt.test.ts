import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { EventBus, Session, AgentLoop } from '@vessel/core';
import type { ToolResultOutcome } from '@vessel/core';
import type {
  ChatProvider,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  ToolCall,
} from '@vessel/shared';
import type { ModelStreamEndPayload, ModelStreamStartPayload } from '@vessel/shared';

// ---------------------------------------------------------------------------
// Loop harness (same shape as AgentLoop.stream.test.ts): no fs/tools stack,
// tool calls are answered by a stub runTool. The interrupt controller is
// exercised through the loop's own public interrupt() seam.
// ---------------------------------------------------------------------------

interface Harness {
  session: Session;
  bus: EventBus;
  loop: AgentLoop;
}

async function makeLoop(
  dir: string,
  provider: ChatProvider,
  opts: {
    runTool?: (call: ToolCall, ctx?: { signal?: AbortSignal | null }) => Promise<ToolResultOutcome>;
    llmRetry?: { maxRetries?: number };
  } = {},
): Promise<Harness> {
  const session = await Session.open({ workspaceRoot: dir, sessionId: 'interrupt' });
  const bus = new EventBus();
  const loop = new AgentLoop({
    session,
    bus,
    provider,
    model: 'm',
    buildContext: async () => ({
      model: 'm',
      messages: [{ role: 'system', content: 'test' }],
      tools: [],
      estimateTokens: 10,
    }),
    runTool: opts.runTool ?? (async (call: ToolCall): Promise<ToolResultOutcome> => {
      void call;
      return { content: 'GOLD', meta: {} };
    }),
    getVisibleTools: () => [],
    llmRetry: opts.llmRetry,
  });
  return { session, bus, loop };
}

function watch(bus: EventBus) {
  const starts: ModelStreamStartPayload[] = [];
  const ends: ModelStreamEndPayload[] = [];
  const retries: { turnId: string; step: number; attempt: number; errorClass: string }[] = [];
  bus.on('model_stream_start', (p) => {
    starts.push(p as ModelStreamStartPayload);
  });
  bus.on('model_stream_end', (p) => {
    ends.push(p as ModelStreamEndPayload);
  });
  bus.on('llm_retry', (p) => {
    retries.push(p as { turnId: string; step: number; attempt: number; errorClass: string });
  });
  return { starts, ends, retries };
}

function startChunk(model = 'm'): StreamChunk {
  return { type: 'message_start', model };
}
function textChunk(text: string): StreamChunk {
  return { type: 'text_delta', text };
}
function usageChunk(): StreamChunk {
  return { type: 'usage', inputTokens: 1, outputTokens: 1 };
}
function endChunk(finishReason = 'stop'): StreamChunk {
  return { type: 'message_end', finishReason };
}

/**
 * Gated streaming provider: yields the given chunks but PAUSES mid-stream at a
 * promise gate until release() is called — deterministic control over "turn in
 * flight" windows (task 050 tests).
 */
class GatedStreamProvider implements ChatProvider {
  readonly id = 'gated';
  private waiters: (() => void)[] = [];
  private startedResolve!: () => void;
  readonly started = new Promise<void>((r) => (this.startedResolve = r));

  async chat(): Promise<ChatResponse> {
    throw new Error('chat() must not be called when provider.stream is present');
  }

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    void request;
    this.startedResolve();
    yield startChunk();
    yield textChunk('partial ');
    await this.hold();
    yield textChunk('rest');
    yield usageChunk();
    yield endChunk();
  }

  private hold(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const w = this.waiters.shift();
    if (w) w();
  }
}

describe('AgentLoop interrupt (task 050)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-interrupt-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('interrupting an in-flight model stream ends the turn kind=interrupted with pairing intact', async () => {
    const provider = new GatedStreamProvider();
    const { session, bus, loop } = await makeLoop(dir, provider);
    const { starts, ends } = watch(bus);

    const run = loop.runTurn('stream me');
    await provider.started; // model consumption began (turn scope is active)
    await new Promise((r) => setTimeout(r, 0)); // let the loop reach the gate
    expect(loop.interrupt()).toBe(true);

    provider.release(); // the gate now yields its next chunk → loop boundary detects abort
    const result = await run;

    expect(result.kind).toBe('interrupted');
    // turn pairing invariant: exactly one turn/start before one turn/end(kind=interrupted)
    const records = session.replay();
    const startIdx = records.findIndex((r) => r.type === 'turn/start');
    const endIdx = records.findIndex((r) => r.type === 'turn/end');
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThan(startIdx);
    expect((records[endIdx] as { kind: string }).kind).toBe('interrupted');
    // the interrupted stream attempt is closed (model_stream_start ↔ end pairing)
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(ends[0]!.finishReason).toBe('error');
    // scope is cleaned up when the turn settles
    expect(loop.turnActive).toBe(false);
    await session.close();
  });

  it('interrupting an in-flight tool dispatch stops the turn and pairs tool/call → tool/result', async () => {
    let toolStartedResolve!: () => void;
    const toolStarted = new Promise<void>((r) => (toolStartedResolve = r));
    let toolRelease!: () => void;
    const gate = new Promise<void>((r) => (toolRelease = r));
    const seenSignals: (AbortSignal | null | undefined)[] = [];

    const scripted: ChatProvider = {
      id: 'scripted',
      async chat(): Promise<ChatResponse> {
        throw new Error('chat() must not be called when provider.stream is present');
      },
      async *stream(): AsyncGenerator<StreamChunk> {
        yield startChunk();
        yield { type: 'tool_call_start', id: 'tc_1', name: 'Stub', arguments: '{}' };
        yield { type: 'tool_call_end', id: 'tc_1' };
        yield usageChunk();
        yield endChunk('tool_calls');
      },
    };

    const { session, loop } = await makeLoop(dir, scripted, {
      runTool: async (call, ctx) => {
        void call;
        seenSignals.push(ctx?.signal);
        toolStartedResolve();
        await gate; // tool work in flight until released (never released here)
        return { content: 'done', meta: {} };
      },
    });

    const run = loop.runTurn('do tool');
    await toolStarted; // the tool is executing; the loop awaits its result
    expect(loop.interrupt()).toBe(true);

    // the tool's runTool got the turn signal, and it aborted on interrupt
    expect(seenSignals[0]).toBeDefined();

    const result = await run;
    expect(result.kind).toBe('interrupted');
    expect(seenSignals[0]!.aborted).toBe(true);

    // session pairing: tool/call → tool/result (explicit interrupted result),
    // and turn/start → turn/end(kind=interrupted)
    const records = session.replay();
    const callIdx = records.findIndex((r) => r.type === 'tool/call');
    const resultIdx = records.findIndex((r) => r.type === 'tool/result');
    expect(callIdx).toBeGreaterThanOrEqual(0);
    expect(resultIdx).toBeGreaterThan(callIdx);
    const tr = records[resultIdx] as { error?: { message?: string }; meta?: Record<string, unknown> };
    expect(tr.error?.message).toBe('interrupted');
    expect(tr.meta?.interrupted).toBe(true);
    const endIdx = records.findIndex((r) => r.type === 'turn/end');
    expect((records[endIdx] as { kind: string }).kind).toBe('interrupted');
    await session.close();
  });

  it('the turn signal reaches the provider request (ChatRequest.signal) and abort is observed', async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const provider: ChatProvider = {
      id: 'signal-aware',
      async chat(): Promise<ChatResponse> {
        throw new Error('chat() must not be called when provider.stream is present');
      },
      async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
        seen.push(request.signal);
        yield startChunk();
        yield textChunk('first ');
        // signal-aware provider: an abort interrupts the in-flight read
        if (request.signal) {
          await new Promise<void>((resolve, reject) => {
            if (request.signal!.aborted) {
              reject(new Error('aborted'));
              return;
            }
            request.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          });
        }
        yield textChunk('never reached');
        yield usageChunk();
        yield endChunk();
      },
    };
    const { session, bus, loop } = await makeLoop(dir, provider);
    const { starts, ends } = watch(bus);

    const run = loop.runTurn('stream');
    // wait until the provider captured the signal and is blocked on its abort
    await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (seen.length > 0) {
          clearInterval(t);
          resolve();
        }
      }, 5);
    });
    expect(loop.interrupt()).toBe(true);
    const result = await run;

    expect(seen[0]).toBeDefined();
    expect(seen[0]!.aborted).toBe(true);
    expect(result.kind).toBe('interrupted');
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(ends[0]!.finishReason).toBe('error');
    await session.close();
  });

  it('an interrupt during model retry backoff wins over retry (no second attempt)', async () => {
    let attempts = 0;
    const flaky: ChatProvider = {
      id: 'flaky-chat',
      async chat(): Promise<ChatResponse> {
        attempts += 1;
        throw new Error('rate limit 429');
      },
    };
    const { session, bus, loop } = await makeLoop(dir, flaky, { llmRetry: { maxRetries: 5 } });

    let retrySeen!: () => void;
    const retried = new Promise<void>((r) => (retrySeen = r));
    bus.on('llm_retry', () => retrySeen());

    const run = loop.runTurn('boom');
    await retried; // first attempt failed and a retry is being scheduled
    expect(attempts).toBe(1);
    expect(loop.interrupt()).toBe(true);

    const result = await run;
    expect(result.kind).toBe('interrupted');
    expect(attempts).toBe(1); // abort beat the retry — no second attempt
    await session.close();
  });

  it('interrupt with no active turn is a no-op; the next turn still runs normally', async () => {
    const provider = new MockProvider([{ when: /.*/, response: { text: 'world' } }], { model: 'm' });
    const { session, loop } = await makeLoop(dir, provider);

    // idle: nothing to interrupt
    expect(loop.turnActive).toBe(false);
    expect(loop.interrupt()).toBe(false);
    expect(loop.interrupted).toBe(false);

    const result = await loop.runTurn('hello');
    expect(result.kind).toBe('success');
    expect(result.finalText).toBe('world');
    expect(loop.turnActive).toBe(false);
    await session.close();
  });
});
