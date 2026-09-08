import { describe, it, expect, afterEach, vi } from 'vitest';
import { createEventStream } from './sse';

/** Minimal EventSource-like stub driven by a captured handler list. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  /** onmessage is set by createEventStream, not by the fake's own dispatch. */
  onmessage: ((ev: { data: string }) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

/** Push one SSE data frame into the current fake instance's onmessage handler. */
function emit(instance: FakeEventSource, frame: unknown) {
  if (!instance.onmessage) throw new Error('onmessage not wired');
  instance.onmessage({ data: JSON.stringify(frame) });
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.instances = [];
});

describe('createEventStream', () => {
  it('opens an EventSource for the given URL', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    createEventStream('/api/sessions/s1/events');
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe('/api/sessions/s1/events');
  });

  it('dispatches a conversation delta by type', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const onConversation = vi.fn();
    createEventStream('/url', { onConversation });
    emit(FakeEventSource.instances[0], {
      type: 'conversation',
      delta: { role: 'assistant', text: 'hello' },
      ts: 1000,
    });
    expect(onConversation).toHaveBeenCalledTimes(1);
    expect(onConversation).toHaveBeenCalledWith({ role: 'assistant', text: 'hello', ts: 1000 });
  });

  it('dispatches tool / usage / policy deltas by type', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const onTool = vi.fn();
    const onUsage = vi.fn();
    const onPolicy = vi.fn();
    createEventStream('/url', { onTool, onUsage, onPolicy });

    const inst = FakeEventSource.instances[0];
    emit(inst, { type: 'tool', delta: { toolName: 'read', status: 'started' }, ts: 1 });
    emit(inst, { type: 'usage', delta: { inputTokens: 5, calls: 1 }, ts: 2 });
    emit(inst, { type: 'policy', delta: { toolName: 'rm', rule: 'rf1', reason: 'denied' }, ts: 3 });

    expect(onTool).toHaveBeenCalledWith({ toolName: 'read', status: 'started', ts: 1 });
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 5, calls: 1, ts: 2 });
    expect(onPolicy).toHaveBeenCalledWith({ toolName: 'rm', rule: 'rf1', reason: 'denied', ts: 3 });
  });

  it('ignores unknown frame types (e.g. ping) without failing', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const onEvent = vi.fn();
    createEventStream('/url', { onEvent });
    emit(FakeEventSource.instances[0], { type: 'ping', ts: 0 });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0]).toEqual({ type: 'ping', ts: 0 });
  });

  it('calls onError for malformed JSON and keeps going', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const onError = vi.fn();
    createEventStream('/url', { onError });
    const inst = FakeEventSource.instances[0];
    // raw (non-JSON) data frame
    inst.onmessage!({ data: 'not-json' });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('close() tears down the underlying EventSource', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const stream = createEventStream('/url');
    const inst = FakeEventSource.instances[0];
    expect(inst.closed).toBe(false);
    stream.close();
    expect(inst.closed).toBe(true);
  });
});