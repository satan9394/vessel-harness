import type { ChatProvider, ChatRequest, ChatResponse, StreamChunk } from '@vessel/shared';

const NETWORK_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);

/** Inspect structured errors, including Node fetch's cause; never match message text. */
export function isEndpointFailure(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  let network = false;
  let status: number | undefined;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const e = current as { name?: string; code?: string; status?: number; statusCode?: number; response?: { status?: number }; cause?: unknown };
    if (e.name === 'AbortError') return false;
    status ??= e.status ?? e.statusCode ?? e.response?.status;
    network ||= NETWORK_CODES.has(e.code ?? '');
    current = e.cause;
  }
  return status !== undefined ? status === 408 || status === 429 || (status >= 500 && status <= 599) : network;
}

export type EndpointSwitch = (from: string, to: string) => void;

/** In-memory sticky preference. Each call visits every endpoint at most once. */
export class EndpointFailoverProvider implements ChatProvider {
  private preferred = 0;
  readonly stream?: (request: ChatRequest) => AsyncIterable<StreamChunk>;

  constructor(
    private readonly endpoints: readonly { url: string; provider: ChatProvider }[],
    private readonly onSwitch?: EndpointSwitch,
  ) {
    if (endpoints.length < 2) throw new Error('Endpoint failover requires two endpoints');
    if (endpoints.every(endpoint => endpoint.provider.stream)) this.stream = request => this.streamRequest(request);
  }

  get id() { return this.endpoints[this.preferred]!.provider.id; }
  get capabilities() { return this.endpoints[this.preferred]!.provider.capabilities; }
  get defaultMaxOutputTokens() { return this.endpoints[this.preferred]!.provider.defaultMaxOutputTokens; }

  private order(): number[] {
    return [this.preferred, ...this.endpoints.map((_, i) => i).filter(i => i !== this.preferred)];
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const order = this.order();
    for (const [attempt, index] of order.entries()) {
      const endpoint = this.endpoints[index]!;
      try {
        const response = await endpoint.provider.chat(request);
        this.preferred = index;
        return response;
      } catch (error) {
        const next = order[attempt + 1];
        if (request.signal?.aborted || next === undefined || !isEndpointFailure(error)) throw error;
        this.onSwitch?.(endpoint.url, this.endpoints[next]!.url);
      }
    }
    throw new Error('No endpoint attempted');
  }

  private async *streamRequest(request: ChatRequest): AsyncIterable<StreamChunk> {
    const order = this.order();
    for (const [attempt, index] of order.entries()) {
      const endpoint = this.endpoints[index]!;
      let emitted = false;
      try {
        for await (const chunk of endpoint.provider.stream!(request)) {
          emitted = true;
          yield chunk;
        }
        this.preferred = index;
        return;
      } catch (error) {
        const next = order[attempt + 1];
        if (emitted || request.signal?.aborted || next === undefined || !isEndpointFailure(error)) throw error;
        this.onSwitch?.(endpoint.url, this.endpoints[next]!.url);
      }
    }
  }
}
