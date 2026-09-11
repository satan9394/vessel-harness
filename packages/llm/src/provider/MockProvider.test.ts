import { describe, it, expect } from 'vitest';
import { MockProvider } from './MockProvider.js';
import type { ChatMessage, ChatRequest, MessageSource } from '@vessel/shared';

/**
 * MockProvider — 脚本匹配必须落在**真实输入**上（G-01）。
 *
 * 仓库工作区把注入消息排在真实输入之后：skills index（`source='environment'`）
 * 与 `Builder.ts` 以 `source='instruction'` 追加的 AGENTS.md 指令文件；
 * plan / Context Reset handoff / 显式注入还会带来 `plan` / `handoff` / `inject`
 * （连同 memory、compacted-summary，`INJECTED_MESSAGE_SOURCES` 共 7 项；
 * `steer` 是操作者实时输入，有意保持可匹配）。
 * 若匹配器只看「最后一条 user 消息」，真实用户输入会被注入消息遮蔽，
 * 于是永远命中 `(mock: no script entry matched)`。以下用例锁死这一回归。
 *
 * 判别力约定（独立 Evaluator 复核点）：删掉 `surfaceUserMessage()` 的来源过滤器后，
 * 这些用例**必须失败**——要么误命中（A3 的注入正文刻意能命中脚本正则），
 * 要么漏命中（A/A2/A4/A5/A6 的注入正文刻意**不**含脚本关键词，只有真实输入含）。
 * 因此本文档同时覆盖「不会误命中」与「不会漏命中」两个方向。
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

  it('A3: 仅剩注入消息（无真实输入）时不命中——注入正文纵然能命中正则，也不得被当成真实输入', async () => {
    const provider = new MockProvider([{ when: /summari[sz]e|总结/i, response: { text: 'OK' } }]);
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: '[环境] skills index … 总结 summary',
        source: 'environment',
      },
    ];

    const res = await provider.chat(req(messages));

    // 有判别力：正文刻意含 `总结`/`summary`。实现若不做来源过滤，会把它当作
    // surface 输入 → 误回 'OK'（本断言随即失败）。
    expect(res.content).not.toBe('OK');
    expect(res.content).toBe('(mock: no script entry matched)');
  });

  it('A4: source=plan 的注入消息在最后 → 仍命中前置真实输入', async () => {
    const provider = new MockProvider([{ when: /summari[sz]e|总结/i, response: { text: 'OK' } }]);
    const messages: ChatMessage[] = [
      { role: 'user', content: 'please summarize the README' },
      {
        role: 'user',
        content: '[计划] 当前里程碑：完成 G-01 回归覆盖，先读 README 再动手',
        source: 'plan',
      },
    ];

    // 注入正文不含脚本关键词：实现若只取「最后一条 user 消息」就会漏命中兜底文本。
    expect((await provider.chat(req(messages))).content).toBe('OK');
  });

  // A5：handoff / inject 是 Evaluator 点名的缺口；memory / compacted-summary 一并硬编码，
  // 使 7 个注入来源在本文件里全部有具名覆盖（不依赖从 shared 导入的集合本身）。
  const INJECTED_VARIANTS: readonly MessageSource[] = [
    'handoff',
    'inject',
    'memory',
    'compacted-summary',
  ];
  it.each(INJECTED_VARIANTS)(
    'A5: source=%s 的注入消息在最后 → 仍命中前置真实输入',
    async (source) => {
      const provider = new MockProvider([{ when: /summari[sz]e|总结/i, response: { text: 'OK' } }]);
      const messages: ChatMessage[] = [
        { role: 'user', content: 'please summarize the README' },
        { role: 'user', content: `[注入上下文 ${source}] 继续上一轮任务所需的背景材料`, source },
      ];

      expect((await provider.chat(req(messages))).content).toBe('OK');
    },
  );

  it('A6: 端到端判别——Builder 追加的 AGENTS.md instruction 压轴时，真实输入仍命中（删实现必失败）', async () => {
    const provider = new MockProvider([{ when: /summari[sz]e|总结/i, response: { text: 'OK' } }]);
    // 本仓库的真实遮蔽场景：工作区没有 skills index，压轴的注入消息是
    // `Builder.ts` 以 `[指令文件 <path>]\n<内容>` + source='instruction' 追加的 AGENTS.md。
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是 Vessel 系统中的一个 Agent（Composable Agent Harness 核心）。' },
      { role: 'user', content: 'please summarize the README' },
      {
        role: 'user',
        content: [
          '[指令文件 AGENTS.md]',
          '# Composable Agent Harness 开发约定',
          '- 主语言 TypeScript，测试用 Vitest。',
          '- 删除一律走回收站；禁止 force push。',
          '- 新功能必须带测试，收尾前跑全量验证。',
        ].join('\n'),
        source: 'instruction',
      },
    ];

    const res = await provider.chat(req(messages));

    // 指令正文刻意不含 `summarize`/`总结`：实现若不过滤 instruction，haystack 变成
    // AGENTS.md → 命中不了脚本 → 返回兜底文本 → 本断言失败。
    expect(res.content).toBe('OK');
    expect(res.content).not.toBe('(mock: no script entry matched)');
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
