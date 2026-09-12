/**
 * `createProvider` 必须把 `streamIdleTimeoutMs` 转发给 provider（BRIEF：经工厂路径不可达的旋钮）。
 *
 * 判别性：用一个**连上但不发数据**的假上游，经**工厂**构造 provider（而不是直接 `new`），
 * 断言它在阈值后以 `StreamIdleTimeoutError` 结束。
 * 删掉 `createProvider.ts` 里那两行转发 ⇒ 实例只能回落到 `timeoutMs`（此处设得很大）
 * ⇒ 流永不结束 ⇒ 本用例红。
 */
import { describe, it, expect } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createProvider } from './createProvider.js';

/** 连上、收请求、然后什么都不发（让 reader 永远 pending）。 */
function hangingServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const sockets: import('node:net').Socket[] = [];
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // 故意不 write、不 end
    });
    server.on('connection', (s) => sockets.push(s));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

/** 收集流，带硬截止：超时未收口即视为"永不结束"。 */
async function collectBounded(
  iter: AsyncIterable<unknown>,
  ms: number,
): Promise<{ status: 'ended' | 'hung'; error?: unknown }> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<{ status: 'hung' }>((r) => {
    timer = setTimeout(() => r({ status: 'hung' }), ms);
  });
  const run = (async (): Promise<{ status: 'ended' | 'hung'; error?: unknown }> => {
    try {
      for await (const _ of iter) void _;
      return { status: 'ended' };
    } catch (error) {
      return { status: 'ended', error };
    }
  })();
  const out = await Promise.race([run, deadline]);
  if (timer) clearTimeout(timer);
  return out;
}

describe('createProvider — streamIdleTimeoutMs 必须经工厂可达', () => {
  it('① anthropic：工厂构造的实例在空闲阈值后以 StreamIdleTimeoutError 收口（不转发 ⇒ 永不结束 ⇒ 红）', async () => {
    const up = await hangingServer();
    try {
      const p = createProvider('anthropic', {
        baseUrl: up.url,
        apiKey: 'k',
        model: 'm',
        timeoutMs: 60_000, // 大：证明收口来自 idle 阈值而不是它
        streamIdleTimeoutMs: 200,
      });
      const res = await collectBounded(
        p.stream!({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
        3_000,
      );
      expect(res.status).toBe('ended');
      expect((res.error as Error).name).toBe('StreamIdleTimeoutError');
    } finally {
      await up.close();
    }
  });

  it('② openai-compatible：同一转发（不转发 ⇒ 永不结束 ⇒ 红）', async () => {
    const up = await hangingServer();
    try {
      const p = createProvider('openai-compatible', {
        baseUrl: up.url,
        apiKey: 'k',
        model: 'm',
        timeoutMs: 60_000,
        streamIdleTimeoutMs: 200,
      });
      const res = await collectBounded(
        p.stream!({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
        3_000,
      );
      expect(res.status).toBe('ended');
      expect((res.error as Error).name).toBe('StreamIdleTimeoutError');
    } finally {
      await up.close();
    }
  });

  it('③ 负对照：不传 streamIdleTimeoutMs 时，阈值回落 timeoutMs（既有语义不变）', async () => {
    const up = await hangingServer();
    try {
      const p = createProvider('anthropic', {
        baseUrl: up.url,
        apiKey: 'k',
        model: 'm',
        timeoutMs: 200, // 小：作为回落阈值
      });
      const res = await collectBounded(
        p.stream!({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
        3_000,
      );
      expect(res.status).toBe('ended');
      expect((res.error as Error).name).toBe('StreamIdleTimeoutError');
    } finally {
      await up.close();
    }
  });
});
