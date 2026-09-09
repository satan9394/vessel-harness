/**
 * task 103 — lane 与 CLI/TUI 收敛到**同一份** opencode-go 协议实现（方案 A / SSOT）。
 *
 * 断言：
 *   1. lane 侧 `opencodeGoChatProvider.ts` 只是 `@vessel/llm` 的 re-export 外壳（同一个类/常量）；
 *   2. lane resolver 构造出的 provider 就是 llm 的实现，且沿用同一会话 id（102 语义不变）；
 *   3. 请求头仍由那一份实现注入（x-opencode-session + 具名 UA）。
 */
import { describe, it, expect } from 'vitest';
import {
  OpencodeGoProvider,
  OpencodeGoError,
  OPENCODE_GO_SESSION_HEADER,
  OPENCODE_GO_USER_AGENT,
  classifyOpencodeGoError,
  type OpencodeGoFetch,
} from '@vessel/llm';
import * as laneShim from './opencodeGoChatProvider.js';
import { resolveOpencodeGoProvider } from './opencodeGoProvider.js';

describe('103 — lane 复用 @vessel/llm 的 opencode-go 实现（无重复协议逻辑）', () => {
  it('lane re-export 与 @vessel/llm 指向同一个类/常量/函数', () => {
    expect(laneShim.OpencodeGoProvider).toBe(OpencodeGoProvider);
    expect(laneShim.OpencodeGoError).toBe(OpencodeGoError);
    expect(laneShim.OPENCODE_GO_SESSION_HEADER).toBe(OPENCODE_GO_SESSION_HEADER);
    expect(laneShim.OPENCODE_GO_USER_AGENT).toBe(OPENCODE_GO_USER_AGENT);
    expect(laneShim.classifyOpencodeGoError).toBe(classifyOpencodeGoError);
  });

  it('lane resolver 构造的是 llm 实现，并复用注入的会话 id', () => {
    const provider = resolveOpencodeGoProvider(
      { id: 'opencode-go:mimo-v2.5', displayName: 'OpenCode Go mimo-v2.5', tier: 'flash', defaultModel: 'mimo-v2.5' },
      { keyResolver: () => 'sk-test-not-a-real-key', sessionId: 'lane-session-fixed' },
    );
    expect(provider).toBeInstanceOf(OpencodeGoProvider);
    expect((provider as OpencodeGoProvider).sessionId).toBe('lane-session-fixed');
  });

  it('头注入仍来自那一份实现：x-opencode-session + 具名 UA', async () => {
    const calls: Record<string, string>[] = [];
    const fetchImpl: OpencodeGoFetch = async (_url, init) => {
      calls.push((init.headers ?? {}) as Record<string, string>);
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const provider = resolveOpencodeGoProvider(
      { id: 'opencode-go:mimo-v2.5', displayName: 'OpenCode Go mimo-v2.5', tier: 'flash', defaultModel: 'mimo-v2.5' },
      { keyResolver: () => 'sk-test-not-a-real-key', sessionId: 'lane-session-fixed', fetchImpl },
    );
    await provider!.chat({ model: 'mimo-v2.5', messages: [{ role: 'user', content: 'ping' }] });
    expect(calls[0]![OPENCODE_GO_SESSION_HEADER]).toBe('lane-session-fixed');
    expect(calls[0]!['User-Agent']).toBe(OPENCODE_GO_USER_AGENT);
    expect(calls[0]!.Authorization).toBe('Bearer sk-test-not-a-real-key');
  });
});
