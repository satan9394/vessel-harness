import { describe, it, expect } from 'vitest';
import { MockProvider } from './MockProvider.js';
import type { ChatMessage, ChatRequest } from '@vessel/shared';

/**
 * MockProvider — 脚本匹配必须落在**真实输入**上（G-01）。
 *
 * 仓库工作区会把 skills index 作为最后一条 user 消息注入（`source='environment'`）；
 * 若匹配器只看「最后一条 user 消息」，真实用户输入会被注入消息遮蔽，
 * 于是永远命中 `(mock: no script entry matched)`。以下用例锁死这一回归。
 */
function req(messages: ChatMessage[]): ChatRequest {
  return { model: 'mock-model', messages };
}

describe('MockProvider — 注入消息不得遮蔽真实输入（G-01）', () => {
  it('A: 真实输入在前、environment 注入在后时仍命中脚本', async () => {
    const provider = new MockProvider([{ when: /summari[sz]e|总结/i, response: { text: 'OK' } }]);
    const messages: ChatMessage[] = [
      { role: 'system', content: 'you are a helpful agent' },
      { role: 'user', content: 'please summarize the README' },
      {
        role: 'user',
        content: '[环境] skills index: read, write, bash ...',
        source: 'environment',
      },
    ];

    const res = await provider.chat(req(messages));

    expect(res.content).toBe('OK');
    expect(res.content).not.toBe('(mock: no script entry matched)');
    expect(res.finishReason).toBe('stop');
  });

  it('A2: 注入消息在中间（真实输入仍为最后一条）也能命中', async () => {
    const provider = new MockProvider([{ when: /总结|summari[sz]e/i, response: { text: 'OK' } }]);
    const messages: ChatMessage[] = [
      { role: 'user', content: '[环境] skills index ...', source: 'environment' },
      { role: 'user', content: '总结一下 README' },
    ];

    expect((await provider.chat(req(messages))).content).toBe('OK');
  });

  it('A3: 仅剩注入消息（无真实输入）时不命中，回落到兜底文本', async () => {
    const provider = new MockProvider([{ when: /summari[sz]e|总结/i, response: { text: 'OK' } }]);
    const messages: ChatMessage[] = [
      { role: 'user', content: '[环境] skills index ...', source: 'environment' },
    ];

    expect((await provider.chat(req(messages))).content).toBe('(mock: no script entry matched)');
  });

  it('B: 无匹配脚本 → 默认兜底文本；注入 fallbackText 时返回该文本', async () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'please summarize the README' }];

    const bare = await new MockProvider([]).chat(req(messages));
    expect(bare.content).toContain('no script entry matched');
    expect(bare.toolCalls).toEqual([]);
    expect(bare.finishReason).toBe('stop');

    const custom = await new MockProvider([], { fallbackText: '（mock）无脚本命中' }).chat(req(messages));
    expect(custom.content).toBe('（mock）无脚本命中');

    // 不匹配的脚本条目同样走兜底
    const miss = await new MockProvider([{ when: /never-matches-xyz/, response: { text: 'NOPE' } }]).chat(req(messages));
    expect(miss.content).toContain('no script entry matched');
  });

  it('C: whenToolResult 命中最后一条以 [TOOL_FAILURE] 开头的 tool 消息', async () => {
    const provider = new MockProvider([
      { when: /.*/, whenToolResult: /^\[TOOL_FAILURE\]/, response: { text: 'RECOVERED' } },
      { when: /.*/, response: { text: 'FALLBACK-ENTRY' } },
    ]);
    const messages: ChatMessage[] = [
      { role: 'user', content: 'please read the README' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc_1', name: 'Read', arguments: { path: 'README.md' } }] },
      { role: 'tool', content: '[TOOL_FAILURE] file not found', toolCallId: 'tc_1' },
    ];

    const res = await provider.chat(req(messages));
    expect(res.content).toBe('RECOVERED');

    // 对照组：非失败 tool 结果 → 落到下一条通用脚本
    const okMessages: ChatMessage[] = [
      { role: 'user', content: 'please read the README' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc_1', name: 'Read', arguments: { path: 'README.md' } }] },
      { role: 'tool', content: 'hello', toolCallId: 'tc_1' },
    ];
    expect((await provider.chat(req(okMessages))).content).toBe('FALLBACK-ENTRY');
  });
});
