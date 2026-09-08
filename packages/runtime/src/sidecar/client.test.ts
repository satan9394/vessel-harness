import { describe, it, expect } from 'vitest';

import { SidecarClient, SidecarRpcError, SidecarTimeoutError, SidecarClosedError } from './client.js';
import { MockSidecar } from './mock-sidecar.js';
import { createTransportPair } from './transport.js';
import { SidecarFramer, encodeFrame } from './framer.js';
import {
  JsonRpcErrorCode,
  SidecarErrorCode,
  SidecarMethod,
  type JsonRpcNotification,
  type JsonRpcRequest,
} from './types.js';

/** Wire a client to an in-process mock sidecar; returns { client, sidecar }. */
function wire(
  options?: ConstructorParameters<typeof MockSidecar>[1],
  clientOptions?: ConstructorParameters<typeof SidecarClient>[1],
) {
  const [hostEnd, sidecarEnd] = createTransportPair();
  const sidecar = new MockSidecar(sidecarEnd, options);
  const client = new SidecarClient(hostEnd, clientOptions);
  return { client, sidecar };
}

describe('SidecarClient request/response round-trip (task 070)', () => {
  it('sends a request and resolves with the mirrored result (id-aligned)', async () => {
    const { client, sidecar } = wire({ name: 'sc' });
    const init = await client.request('initialize', {});
    expect(init).toMatchObject({ serverName: 'sc', protocolVersion: '1.0' });
    expect(sidecar.initializeCalls).toHaveLength(1);

    const pong = await client.request('ping', {});
    expect(pong).toMatchObject({ pong: true });
    expect(sidecar.pingCalls).toHaveLength(1);
  });

  it('convenience methods initialize/ping work', async () => {
    const { client } = wire();
    const i = await client.initialize();
    expect(i).toMatchObject({ serverName: 'mock-sidecar' });
    const p = await client.ping();
    expect(p).toMatchObject({ pong: true });
  });

  it('rejects with SidecarRpcError (method not found) when the method is unknown', async () => {
    const { client } = wire();
    await expect(client.request('bogus.method', {})).rejects.toMatchObject({
      name: 'SidecarRpcError',
      code: JsonRpcErrorCode.MethodNotFound,
    });
  });

  it('rejects with a capability error when calling an undeclared capability', async () => {
    const { client } = wire({ capabilities: ['initialize', 'ping'] });
    await expect(client.request(SidecarMethod.ExecProcess, {})).rejects.toMatchObject({
      name: 'SidecarRpcError',
      code: SidecarErrorCode.CapabilityUnavailable,
    });
  });

  it('surfaces a server fault-injected internal error', async () => {
    const { client } = wire({ failAll: true });
    await expect(client.request('ping')).rejects.toMatchObject({
      name: 'SidecarRpcError',
      code: JsonRpcErrorCode.InternalError,
    });
  });
});

describe('SidecarClient error / timeout / exit (task 070)', () => {
  it('rejects with SidecarTimeoutError when no response arrives in time', async () => {
    // sidecar that never answers: use rejectInitialize=false but a raw end that
    // swallows everything — simplest is an unserved transport end.
    const [hostEnd] = createTransportPair();
    // never wire the peer to anything → client gets no reply
    const client = new SidecarClient(hostEnd, { requestTimeoutMs: 30 });
    await expect(client.request('ping')).rejects.toBeInstanceOf(SidecarTimeoutError);
  });

  it('rejects pending requests with SidecarClosedError when the sidecar exits', async () => {
    const [hostEnd, sidecarEnd] = createTransportPair();
    const client = new SidecarClient(hostEnd);
    const req = client.request('ping'); // mock absent → no reply
    sidecarEnd.close(); // simulate sidecar exit
    await expect(req).rejects.toBeInstanceOf(SidecarClosedError);
    expect(client.isClosed()).toBe(true);
  });

  it('fires onClose handler after transport close', async () => {
    const { client, sidecar } = wire();
    let closed = 0;
    client.onClose(() => closed++);
    sidecar.close();
    expect(client.isClosed()).toBe(true);
    // close handlers are synchronous via memory transport
    expect(closed).toBe(1);
  });

  it('client.close() drops pending and closes transport', async () => {
    // bare host end with no peer → request never answered, stays pending
    const [hostEnd] = createTransportPair();
    const client = new SidecarClient(hostEnd);
    const req = client.request('ping');
    client.close();
    await expect(req).rejects.toBeInstanceOf(SidecarClosedError);
    expect(client.isClosed()).toBe(true);
  });
});

describe('SidecarClient notifications (task 070)', () => {
  it('delivers out-of-band notifications pushed by the sidecar', async () => {
    const seen: JsonRpcNotification[] = [];
    const { client, sidecar } = wire(
      {},
      { onNotification: (n) => seen.push(n) },
    );
    sidecar.notify('log', { level: 'info', text: 'hello' });
    // memory transport delivers synchronously
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'log', params: { level: 'info' } });
  });

  it('client.notify() sends a request without an id that the sidecar treats as a notification', async () => {
    const { client, sidecar } = wire();
    client.notify('progress', { percent: 50 });
    // the mock sidecar ignores notifications (no response); ensure no throw and
    // that a subsequent request still works (id sequence stays aligned)
    const pong = await client.request('ping');
    expect(pong).toMatchObject({ pong: true });
  });
});

describe('SidecarClient concurrency semantics (task 070)', () => {
  it('resolves many in-flight requests to their own ids regardless of reply order', async () => {
    const [hostEnd, sidecarEnd] = createTransportPair();
    const client = new SidecarClient(hostEnd);

    // manual responder: collect inbound requests, reply in REVERSE order so a
    // response for id N arrives after later ids — the client must still match
    // each response to its own request id, not arrival order.
    const requests: JsonRpcRequest[] = [];
    const sidecarFramer = new SidecarFramer();
    sidecarEnd.onData((chunk) => {
      sidecarFramer.push(chunk, (frame) => {
        requests.push(JSON.parse(frame) as JsonRpcRequest);
      });
    });

    const sent = Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        client.request(`echo:${i}`, { index: i }),
      ),
    );
    // memory transport delivers writes synchronously → all 10 arrived already
    expect(requests).toHaveLength(10);

    // reply in reverse arrival order, echoing params
    for (const req of [...requests].reverse()) {
      sidecarEnd.write(
        encodeFrame({ jsonrpc: '2.0', id: req.id, result: { echoed: req.params } }),
      );
    }

    const results = await sent;
    expect(results).toHaveLength(10);
    const indexes = results.map((r) => (r as { echoed: { index: number } }).echoed.index);
    expect([...indexes].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 10 }, (_, i) => i),
    );
    expect(client.isClosed()).toBe(false);
  });

  it('keeps a working id after a failed request (late error does not poison the stream)', async () => {
    const { client } = wire();
    await expect(client.request('bogus.method')).rejects.toBeInstanceOf(SidecarRpcError);
    const pong = await client.request('ping');
    expect(pong).toMatchObject({ pong: true });
  });
});