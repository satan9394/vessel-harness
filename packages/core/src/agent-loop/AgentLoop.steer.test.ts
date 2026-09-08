import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus, Session, AgentLoop } from '@vessel/core';
import type { ToolResultOutcome } from '@vessel/core';
import type { ChatMessage, ChatProvider, ChatRequest, ChatResponse, StreamChunk, ToolCall } from '@vessel/shared';
import type { SessionRecord } from '@vessel/shared';

// ---------------------------------------------------------------------------
// Loop harness for steering (task 051). buildContext derives model messages
// from the session surface projection (like the real ContextBuilder) and
// records every assembled envelope so tests can assert what the model saw.
// Providers are scripted chat() (or a gate-once stream for interrupt-style
// in-flight windows) — the same deterministic style as AgentLoop.interrupt.test.
// ---------------------------------------------------------------------------

interface Harness {
  session: Session;
  bus: EventBus;
  loop: AgentLoop;
  envelopes: { messages: ChatMessage[] }[];
}

function recordToMessage(r: SessionRecord): ChatMessage | null {
  switch (r.type) {
    case 'user/message':
    case 'assistant/message':
      return { role: r.role, content: r.content };
    case 'tool/result':
      return {
        role: 'tool',
        content: r.error ? `[${r.error.errorClass}] ${r.error.message}` : (r.content ?? ''),
        name: r.toolName,
        toolCallId: r.toolCallId,
      };
    default:
      return null;
  }
}

async function makeLoop(
  dir: string,
  provider: ChatProvider,
  opts: { runTool?: (call: ToolCall, ctx?: { signal?: AbortSignal | null }) => Promise<ToolResultOutcome> } = {},
): Promise<Harness> {
  const session = await Session.open({ workspaceRoot: dir, sessionId: 'steer' });
  const bus = new EventBus();
  const envelopes: { messages: ChatMessage[] }[] = [];
  const loop = new AgentLoop({
    session,
    bus,
    provider,
    model: 'm',
    buildContext: async () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'test' },
        ...session.surface().map(recordToMessage).filter((m): m is ChatMessage => m !== null && m.content !== ''),
      ];
      const env = { messages };
      envelopes.push(env);
      return { model: 'm', messages: env.messages, tools: [], estimateTokens: 10 };
    },
    runTool:
      opts.runTool ??
      (async (call: ToolCall): Promise<ToolResultOutcome> => {
        void call;
        return { content: 'TOOL-OK', meta: {} };
      }),
    getVisibleTools: () => [],
  });
  return { session, bus, loop, envelopes };
}

const text = (content: string): ChatResponse => ({
  content,
  toolCalls: [],
  finishReason: 'stop',
  usage: { inputTokens: 1, outputTokens: 1 },
});

const toolCall = (name: string, args: Record<string, unknown> = {}): ChatResponse => ({
  content: '',
  toolCalls: [{ id: 'tc_1', name, arguments: args }],
  finishReason: 'tool_calls',
  usage: { inputTokens: 1, outputTokens: 1 },
});

/** chat()-only scripted provider: answers calls in order (last script repeats). */
class ScriptChat implements ChatProvider {
  readonly id = 'script-chat';
  readonly requests: ChatRequest[] = [];
  constructor(private readonly script: ((req: ChatRequest) => ChatResponse)[]) {}
  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);
    const i = Math.min(this.requests.length - 1, this.script.length - 1);
    return this.script[i]!(request);
  }
}

/** Stream provider that blocks on a gate exactly once (when armed). */
class GateOnceStreamProvider implements ChatProvider {
  readonly id = 'gate-once';
  private waiters: (() => void)[] = [];
  private startedResolve!: () => void;
  readonly started = new Promise<void>((r) => (this.startedResolve = r));
  gateOpen = false;
  text = 'prefix ';

  async chat(): Promise<ChatResponse> {
    throw new Error('chat() must not be called when provider.stream is present');
  }

  async *stream(): AsyncGenerator<StreamChunk> {
    this.startedResolve();
    yield { type: 'message_start', model: 'g' };
    yield { type: 'text_delta', text: this.text };
    if (this.gateOpen) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    yield { type: 'text_delta', text: 'rest' };
    yield { type: 'usage', inputTokens: 1, outputTokens: 1 };
    yield { type: 'message_end', finishReason: 'stop' };
  }

  release(): void {
    this.waiters.shift()?.();
  }
}

function steerRecords(session: Session): { content: string; source?: string; ts?: string }[] {
  return session
    .replay()
    .filter((r) => r.type === 'user/message' && (r as { source?: string }).source === 'steer') as { content: string; source?: string; ts?: string }[];
}

describe('AgentLoop steering (task 051)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-steer-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a steer enqueued while idle is injected at the next turn step-1 boundary as a source=steer user message', async () => {
    const provider = new ScriptChat([() => text('hello')]);
    const { session, loop, envelopes } = await makeLoop(dir, provider);

    loop.steer('把范围缩小到 backend');
    expect(loop.pendingSteerCount).toBe(1);

    const result = await loop.runTurn('start task');
    expect(result.kind).toBe('success');

    // the step-1 model context (next buildContext after the boundary) contains the steer
    expect(envelopes).toHaveLength(1);
    const seen = envelopes[0]!.messages.find((m) => m.role === 'user' && m.content === '把范围缩小到 backend');
    expect(seen).toBeDefined();
    // injected → consumed
    expect(loop.pendingSteerCount).toBe(0);
    // recorded as an auditable B01 user/message record (source='steer')
    const recs = steerRecords(session);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.content).toBe('把范围缩小到 backend');
    expect(recs[0]!.source).toBe('steer');
    expect(typeof recs[0]!.ts).toBe('string');
    // ordering: steer lands after the user turn input, before the assistant answer
    const records = session.replay();
    const inputIdx = records.findIndex((r) => r.type === 'user/message' && (r as { content: string }).content === 'start task');
    const steerIdx = records.findIndex((r) => r.type === 'user/message' && (r as { source?: string }).source === 'steer');
    const asstIdx = records.findIndex((r) => r.type === 'assistant/message');
    expect(steerIdx).toBeGreaterThan(inputIdx);
    expect(asstIdx).toBeGreaterThan(steerIdx);
    await session.close();
  });

  it('a steer during an in-flight tool call never interrupts it and only redirects the next step', async () => {
    let toolStartedResolve!: () => void;
    const toolStarted = new Promise<void>((r) => (toolStartedResolve = r));
    let toolRelease!: () => void;
    const toolGate = new Promise<void>((r) => (toolRelease = r));
    const seenSignals: (AbortSignal | null | undefined)[] = [];

    const provider = new ScriptChat([() => toolCall('Stub'), () => text('final after steer')]);
    const { session, loop, envelopes } = await makeLoop(dir, provider, {
      runTool: async (call, ctx) => {
        void call;
        seenSignals.push(ctx?.signal);
        toolStartedResolve();
        await toolGate; // atomic-ish tool work in flight until released
        return { content: 'TOOL-DONE', meta: {} };
      },
    });

    const run = loop.runTurn('do the thing');
    await toolStarted; // the tool is executing inside step 1
    expect(loop.pendingSteerCount).toBe(0);

    loop.steer('先跑测试再继续'); // arrives mid-step: must only cache
    expect(loop.pendingSteerCount).toBe(1);
    // steer never aborts anything — the in-flight tool keeps running
    expect(seenSignals[0]?.aborted ?? false).toBe(false);

    toolRelease();
    const result = await run;
    expect(result.kind).toBe('success');
    expect(result.toolCalls).toBe(1);

    // step-1 context (assembled before the steer) does NOT contain the steer…
    const step1User = envelopes[0]!.messages.find((m) => m.role === 'user' && m.content === '先跑测试再继续');
    expect(step1User).toBeUndefined();
    // …the step-2 context (next buildContext after the boundary) DOES
    const step2User = envelopes[1]!.messages.find((m) => m.role === 'user' && m.content === '先跑测试再继续');
    expect(step2User).toBeDefined();
    expect(loop.pendingSteerCount).toBe(0);

    // the tool finished cleanly (no interrupted result) and the steer was recorded after it
    const records = session.replay();
    const toolRes = records.findIndex((r) => r.type === 'tool/result');
    expect(toolRes).toBeGreaterThanOrEqual(0);
    const tr = records[toolRes] as { error?: { message?: string }; meta?: Record<string, unknown> };
    expect(tr.error).toBeUndefined();
    expect(tr.meta?.interrupted).toBeUndefined();
    const steerIdx = records.findIndex((r) => r.type === 'user/message' && (r as { source?: string }).source === 'steer');
    expect(steerIdx).toBeGreaterThan(toolRes);
    await session.close();
  });

  it('multiple steers accumulate while a step runs and are all consumed in FIFO order at one boundary', async () => {
    let toolStartedResolve!: () => void;
    const toolStarted = new Promise<void>((r) => (toolStartedResolve = r));
    let toolRelease!: () => void;
    const toolGate = new Promise<void>((r) => (toolRelease = r));

    const provider = new ScriptChat([() => toolCall('Stub'), () => text('done')]);
    const { session, loop, envelopes } = await makeLoop(dir, provider, {
      runTool: async () => {
        toolStartedResolve();
        await toolGate;
        return { content: 'TOOL-DONE', meta: {} };
      },
    });

    const run = loop.runTurn('work');
    await toolStarted;
    loop.steer('first steer');
    loop.steer('second steer');
    expect(loop.pendingSteerCount).toBe(2);

    toolRelease();
    const result = await run;
    expect(result.kind).toBe('success');

    // both are injected in order at the single boundary
    const recs = steerRecords(session);
    expect(recs.map((r) => r.content)).toEqual(['first steer', 'second steer']);
    const users = envelopes[1]!.messages.filter((m) => m.role === 'user' && (m.content === 'first steer' || m.content === 'second steer'));
    expect(users.map((m) => m.content)).toEqual(['first steer', 'second steer']);
    expect(loop.pendingSteerCount).toBe(0);
    await session.close();
  });

  it('interrupt stops the turn but a queued steer survives and redirects the next turn (interrupt=停, steer=改方向)', async () => {
    const provider = new GateOnceStreamProvider();
    const { session, loop, envelopes } = await makeLoop(dir, provider);

    provider.gateOpen = true;
    const run1 = loop.runTurn('streaming turn');
    await provider.started;
    await new Promise((r) => setTimeout(r, 0));
    loop.steer('keep x untouched');
    expect(loop.pendingSteerCount).toBe(1);
    expect(loop.interrupt()).toBe(true);

    provider.release();
    const result1 = await run1;
    expect(result1.kind).toBe('interrupted');
    // the interrupted turn never reached a further boundary — steer stays pending
    expect(loop.pendingSteerCount).toBe(1);
    expect(steerRecords(session)).toHaveLength(0);

    // next turn drains it at its first boundary and the model sees the steer
    provider.gateOpen = false;
    const result2 = await loop.runTurn('continue');
    expect(result2.kind).toBe('success');
    expect(loop.pendingSteerCount).toBe(0);
    const recs = steerRecords(session);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.content).toBe('keep x untouched');
    const lastEnv = envelopes[envelopes.length - 1]!;
    const seen = lastEnv.messages.find((m) => m.role === 'user' && m.content === 'keep x untouched');
    expect(seen).toBeDefined();
    await session.close();
  });

  it('a steer that lands on the final pure-text step of a turn is not injected into that turn and applies to the next one', async () => {
    const provider = new GateOnceStreamProvider();
    const { session, loop, envelopes } = await makeLoop(dir, provider);

    provider.gateOpen = true;
    const run1 = loop.runTurn('answer only');
    await provider.started;
    await new Promise((r) => setTimeout(r, 0));
    loop.steer('applies next round'); // lands mid-stream of the final answer
    provider.release();
    const result1 = await run1;
    expect(result1.kind).toBe('success');
    expect(result1.finalText).toContain('rest');
    // no boundary was left in turn 1 — nothing injected into it
    expect(loop.pendingSteerCount).toBe(1);
    expect(steerRecords(session)).toHaveLength(0);
    expect(envelopes[0]!.messages.some((m) => m.role === 'user' && m.content === 'applies next round')).toBe(false);

    provider.gateOpen = false;
    const result2 = await loop.runTurn('next round');
    expect(result2.kind).toBe('success');
    expect(loop.pendingSteerCount).toBe(0);
    expect(steerRecords(session).map((r) => r.content)).toEqual(['applies next round']);
    const lastEnv = envelopes[envelopes.length - 1]!;
    expect(lastEnv.messages.some((m) => m.role === 'user' && m.content === 'applies next round')).toBe(true);
    await session.close();
  });
});
