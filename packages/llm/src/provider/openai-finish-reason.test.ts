import { describe, it, expect } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ChatResponse, StreamChunk } from '@vessel/shared';
import { OpenAICompatibleProvider } from '../index.js';
import { OpenAIStreamParser, openAIFinishReason } from '../stream/parseOpenAI.js';

/**
 * BRIEF「OpenAI 系路径上**截断信号到不了 loop**：`max_tokens` 截断在 loop 眼里不存在」。
 *
 * ## 改前复现（源码级追链；本卡禁跑命令，故不复述执行输出，只给可复核的行号链路）
 *
 * ① 非流式被**塌缩**（OpenAICompatibleProvider.ts:179-181 改前）：
 *      `choice.finish_reason === 'stop' || === 'tool_calls' ? choice.finish_reason : 'error'`
 *    假上游返回 `finish_reason:'length'` ⇒ 三元两个等值判断都不成立 ⇒ 取 `'error'`
 *    ⇒ `ChatResponse.finishReason === 'error'`（**不是** 'length'）。
 *    下游 AgentLoop 的截断判据是 `terminalFinishReason === 'length'`（AgentLoop.ts:429）
 *    ⇒ 恒为 false ⇒ 被 max_tokens 截断的回答仍然 `kind='success'`。
 *    本文件用例 ① 就是这条复现的判别式：改前 `expect(r.finishReason).toBe('length')` 必红
 *    （旧值 'error'），`expect(r.finishReason).not.toBe('error')` 同时红。
 *
 * ② 流式**根本没携带**（parseOpenAI.ts 改前的 :291/:306）：
 *      两处收口都只 `out.push({ type: 'message_end' })` / `[{ type: 'message_end' }]`，
 *      接口 `OpenAIStreamChunk.choices[].finish_reason`（:57）声明了却全程没人读 ⇒
 *      `message_end` 上没有 `finishReason` ⇒ AgentLoop.ts:641-643 的
 *      `if (chunk.finishReason) wireFinish = chunk.finishReason;` 从不触发 ⇒
 *      AgentLoop.ts:667 `normalizeFinishReason(undefined, hasToolCalls)` ⇒ `'stop'`
 *      ⇒ 截断信号**消失**（`ChatResponse.finishReason === 'stop'`）。
 *    本文件用例 ② 是这条复现的判别式：改前末块是 `{type:'message_end'}`，
 *    归一结果 'stop' ⇒ 两条断言都红。
 *
 * ## 本卡的修法（两步，最小）
 *   (a) 非流式：`'length'` **透传**（不再把非 stop/tool_calls 一律塌缩）；
 *   (b) 流式：边界 `message_end` **携带** wire `finish_reason` 的归一值。
 * 两步共用**同一张**归一表 `openAIFinishReason`（parseOpenAI.ts，与 parseAnthropic.ts:202
 * 的 `anthropicFinishReason` 同形），所以 chat() 与 stream() 对同一个 wire 值必然同解 ——
 * 改前缺的正是这份一致性。**没有**把 wire `'error'` 当截断（另一张卡的前提保持不变）。
 *
 * ## 判别性（"删哪行会红"）
 *   - 删掉 `openAIFinishReason` 里的 `case 'length': return 'length';`（或改回 `'error'`）
 *     ⇒ 用例 ①/②/②′ 红；
 *   - 删掉 `OpenAICompatibleProvider.ts:187` 的 `openAIFinishReason(...)` 改回旧三元
 *     ⇒ 用例 ① 红（非流式）；
 *   - 删掉 `OpenAIStreamParser.messageEnd()`（把两处收口改回 `{type:'message_end'}`）
 *     ⇒ 用例 ②/②′ 红（流式信号再次消失）；
 *   - 删掉 `parseOpenAIStreamChunk` 里把 `finish_reason` 记进 `state.finishReason` 的三行
 *     ⇒ `messageEnd()` 永远读到 `undefined` ⇒ 用例 ②/②′ 红；
 *   - 把 `messageEnd()` 放宽成"无条件携带"（连 `'stop'` 也挂）
 *     ⇒ 用例 ④ 的 `stop` 逐字不变断言红，且既有冻结用例
 *     parseOpenAI.test.ts:159 / streamProvider.test.ts:57 也会红；
 *   - 把 `openAIFinishReason` 的 `default` 从 `'error'` 改成 `'stop'`
 *     ⇒ 用例 ⑤ 红（content_filter/未知值被放宽成"正常收尾"）。
 *
 * ## 端到端（不在本包内，只作链路说明）
 *   llm 侧送达信号后，链路是：`message_end{finishReason:'length'}` →
 *   AgentLoop.ts:641-643 `wireFinish = chunk.finishReason` → AgentLoop.ts:667
 *   `normalizeFinishReason('length', …)` → `'length'`（AgentLoop.ts:86-90 原样透传）→
 *   AgentLoop.ts:337 `terminalFinishReason = response.finishReason` →
 *   AgentLoop.ts:429-432 `truncated ⇒ kind='error'` → AgentLoop.ts:486
 *   `turn/end{finishReason:'length'}`。**该链路的消费侧判据已由另一张卡在
 *   packages/core 里钉死**（AgentLoop.finish-reason.test.ts 的 ①′ 用手造
 *   `message_end{finishReason:'length'}` 验证），本卡补的正是"真实 OpenAI 流确实产出这个块"。
 *   本包不能 import @vessel/core（llm 的 package.json 只依赖 @vessel/shared），
 *   故下面用 `consumeLikeAgentLoop` 做**逐字重放**（用例 ⑥ 自带保真自检）。
 */

// ---------------------------------------------------------------------------
// 本地假上游（与 streamProvider.test.ts 的夹具同形，但不 import 那个文件 ——
// 本卡被明令不得改动它，且它不导出这些 helper）。
// ---------------------------------------------------------------------------

function listen(server: http.Server): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

/** 单响应 JSON 上游（非流式 chat() 用）。 */
async function fakeJsonServer(body: unknown): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  return listen(server);
}

/** 固定 SSE 体上游（流式 stream() 用）。 */
async function fakeSSEServer(sseBody: string): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(sseBody);
  });
  return listen(server);
}

/** `data: {json}` SSE 帧。 */
function sseLine(obj: unknown): string {
  return 'data: ' + JSON.stringify(obj);
}

async function chatOnce(url: string): Promise<ChatResponse> {
  const p = new OpenAICompatibleProvider({ baseUrl: url, model: 'deepseek-test', apiKey: 'k' });
  return p.chat({ model: 'deepseek-test', messages: [{ role: 'user', content: '写一篇很长的文章' }] });
}

async function streamOnce(url: string): Promise<StreamChunk[]> {
  const p = new OpenAICompatibleProvider({ baseUrl: url, model: 'deepseek-test', apiKey: 'k' });
  const out: StreamChunk[] = [];
  for await (const c of p.stream({ model: 'deepseek-test', messages: [{ role: 'user', content: '写一篇很长的文章' }] })) {
    out.push(c);
  }
  return out;
}

/** 把一条 SSE 逐行喂进解析器（含收口帧），收集全部 chunk。 */
function driveParser(lines: readonly string[]): StreamChunk[] {
  const p = new OpenAIStreamParser();
  const out: StreamChunk[] = [];
  for (const l of lines) out.push(...(l === '__FINISH__' ? p.finish() : p.feed(l)));
  return out;
}

/**
 * `AgentLoop` 消费侧规则的**逐字重放**（本包不能 import @vessel/core，见文件头说明）：
 *   - AgentLoop.ts:641-643 `case 'message_end': if (chunk.finishReason) wireFinish = chunk.finishReason;`
 *   - AgentLoop.ts:667     `normalizeFinishReason(wireFinish, toolCalls.length > 0)`
 *   - AgentLoop.ts:86-90   `if (wire === 'length' || wire === 'error') return wire;`
 *                          `if (wire === 'tool_calls' || hasToolCalls) return 'tool_calls';`
 *                          `return 'stop';`
 * 它**不是**本卡的判据（判据是"llm 侧到底送没送信号"），只是把下游后果重放出来；
 * 用例 ⑥ 把这张重放表逐条自检，真值源仍是 AgentLoop 本尊。
 */
function consumeLikeAgentLoop(chunks: readonly StreamChunk[]): ChatResponse['finishReason'] {
  let wire: string | undefined;
  let hasToolCalls = false;
  for (const c of chunks) {
    if (c.type === 'message_end') {
      if (c.finishReason) wire = c.finishReason;
    } else if (c.type === 'tool_call_start') {
      hasToolCalls = true;
    }
  }
  if (wire === 'length' || wire === 'error') return wire;
  if (wire === 'tool_calls' || hasToolCalls) return 'tool_calls';
  return 'stop';
}

/** 末块（收口 message_end）。 */
function lastChunk(chunks: readonly StreamChunk[]): StreamChunk {
  return chunks[chunks.length - 1]!;
}

describe('OpenAI finish_reason 送达（非流式 chat() + 流式 stream()）', () => {
  it("① 非流式：wire finish_reason='length' ⇒ ChatResponse.finishReason==='length'（改前塌缩成 'error' ⇒ 必红）", async () => {
    const fake = await fakeJsonServer({
      choices: [
        {
          message: { role: 'assistant', content: '这是一段被 max_tokens 截断的半截回答' },
          finish_reason: 'length',
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 64 },
    });
    try {
      const r = await chatOnce(fake.url);

      // 判别线：改前（旧三元）这里恒为 'error' —— 截断信号被塌缩，loop 看不见。
      expect(r.finishReason).toBe('length');
      expect(r.finishReason).not.toBe('error');

      // 半截回答本身不因改判而丢失，usage 语义逐字不变
      expect(r.content).toBe('这是一段被 max_tokens 截断的半截回答');
      expect(r.toolCalls).toEqual([]);
      expect(r.usage).toEqual({ inputTokens: 11, outputTokens: 64, cacheReadTokens: undefined });
    } finally {
      fake.close();
    }
  });

  it("② 流式：wire finish_reason='length' ⇒ 边界 message_end 带 'length'，消费侧归一出 ChatResponse.finishReason==='length'（改前不带 ⇒ 'stop' ⇒ 必红）", async () => {
    const sse = [
      sseLine({ model: 'deepseek-test', choices: [{ delta: { role: 'assistant', content: '半截' } }] }),
      sseLine({ choices: [{ delta: { content: '回答' } }] }),
      // OpenAI 真身：中途帧是 null，finish_reason 只出现在**最后一个** content delta 上
      sseLine({ choices: [{ delta: {}, finish_reason: null }] }),
      sseLine({ choices: [{ delta: {}, finish_reason: 'length' }] }),
      // usage 尾帧常带 choices: [] —— 不得把已经记下的 finish_reason 冲掉
      sseLine({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 64 } }),
      'data: [DONE]',
      '',
    ].join('\n');
    const fake = await fakeSSEServer(sse);
    try {
      const chunks = await streamOnce(fake.url);

      // 判别线 1：末块**携带**归一后的 finish_reason（改前是 `{type:'message_end'}`）
      expect(lastChunk(chunks)).toEqual({ type: 'message_end', finishReason: 'length' });
      // 判别线 2：消费侧（AgentLoop 的逐字重放）最终拿到 'length' 而不是 'stop'
      expect(consumeLikeAgentLoop(chunks)).toBe('length');
      expect(consumeLikeAgentLoop(chunks)).not.toBe('stop');

      // 既有 chunk 语义一个不少：文本、usage、收口顺序都不变
      expect(chunks.filter((c) => c.type === 'text_delta')).toEqual([
        { type: 'text_delta', text: '半截' },
        { type: 'text_delta', text: '回答' },
      ]);
      expect(chunks).toContainEqual({ type: 'usage', inputTokens: 11, outputTokens: 64, cacheReadTokens: undefined });
      expect(chunks.filter((c) => c.type === 'message_end')).toHaveLength(1);
    } finally {
      fake.close();
    }
  });

  it("②′ 同一条流在 EOF（无 [DONE]，走 finish()）上同样携带 'length' —— 信号不止挂在 [DONE] 那一支", () => {
    const chunks = driveParser([
      sseLine({ choices: [{ delta: { role: 'assistant', content: '半截' } }] }),
      sseLine({ choices: [{ delta: {}, finish_reason: 'length' }] }),
      '__FINISH__', // 连接被切断：没有 data: [DONE]
    ]);
    expect(lastChunk(chunks)).toEqual({ type: 'message_end', finishReason: 'length' });
    expect(consumeLikeAgentLoop(chunks)).toBe('length');
    // 末块仍只有一个（finish() 的既有语义不变）
    expect(chunks.filter((c) => c.type === 'message_end')).toHaveLength(1);
  });

  it("③ 负对照：wire 无 finish_reason ⇒ 仍归一到**既有值**（文本流 'stop' / 工具流 'tool_calls'），绝不变成 length/error", async () => {
    // ③-a 纯文本流，全程没有 finish_reason 帧
    const textSse = [
      sseLine({ model: 'm', choices: [{ delta: { role: 'assistant', content: '正常回答' } }] }),
      'data: [DONE]',
      '',
    ].join('\n');
    const textFake = await fakeSSEServer(textSse);
    try {
      const chunks = await streamOnce(textFake.url);
      const end = lastChunk(chunks);
      expect(end).toEqual({ type: 'message_end' });
      expect('finishReason' in end).toBe(false); // 没有凭空多出一个字段
      expect(consumeLikeAgentLoop(chunks)).toBe('stop');
    } finally {
      textFake.close();
    }

    // ③-b `finish_reason: null`（OpenAI 中间帧的真身）同样不算"有值"
    const nullSse = [
      sseLine({ choices: [{ delta: { content: '正常回答' }, finish_reason: null }] }),
      'data: [DONE]',
      '',
    ].join('\n');
    const nullFake = await fakeSSEServer(nullSse);
    try {
      const chunks = await streamOnce(nullFake.url);
      expect(lastChunk(chunks)).toEqual({ type: 'message_end' });
      expect(consumeLikeAgentLoop(chunks)).toBe('stop');
    } finally {
      nullFake.close();
    }

    // ③-c 工具流没有 finish_reason ⇒ 既有值仍是 'tool_calls'（不得变成 length/error）
    const toolSse = [
      sseLine({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: 'call_1', function: { name: 'Read', arguments: '{"path":"a.txt"}' } }],
            },
          },
        ],
      }),
      'data: [DONE]',
      '',
    ].join('\n');
    const toolFake = await fakeSSEServer(toolSse);
    try {
      const chunks = await streamOnce(toolFake.url);
      expect(lastChunk(chunks)).toEqual({ type: 'message_end' });
      expect(consumeLikeAgentLoop(chunks)).toBe('tool_calls');
    } finally {
      toolFake.close();
    }

    // ③-d 非流式缺失 finish_reason：保持**既有值** 'error'（本卡不动这条裁决；
    //      两条路径的共同点是：缺失**永远不得**被读成 'length'）
    const missingFake = await fakeJsonServer({
      choices: [{ message: { role: 'assistant', content: 'undefined 上游' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    try {
      const r = await chatOnce(missingFake.url);
      expect(r.finishReason).toBe('error'); // 改前/改后同值：既有行为不变
      expect(r.finishReason).not.toBe('length');
    } finally {
      missingFake.close();
    }
  });

  it('④ 负对照：`stop` 逐字不变；`tool_calls` 的**行为**逐字不变（新增的只是加法字段，附等价性证明）', async () => {
    // ④-a wire 'stop'：与 streamProvider.test.ts:34-61 同形的夹具，断言**整串 chunk 逐字相等**
    //      —— 这就是既有冻结用例钉死的 `{type:'message_end'}` 字面形状。
    const stopSse = [
      sseLine({ model: 'deepseek-test', choices: [{ delta: { role: 'assistant', content: 'Hi' } }] }),
      sseLine({ choices: [{ delta: { content: ' there' } }] }),
      sseLine({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      sseLine({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } }),
      'data: [DONE]',
      '',
    ].join('\n');
    const stopFake = await fakeSSEServer(stopSse);
    try {
      const chunks = await streamOnce(stopFake.url);
      expect(chunks).toEqual([
        { type: 'message_start' },
        { type: 'text_delta', text: 'Hi' },
        { type: 'text_delta', text: ' there' },
        { type: 'usage', inputTokens: 7, outputTokens: 3, cacheReadTokens: undefined },
        { type: 'message_end' },
      ]);
      expect(consumeLikeAgentLoop(chunks)).toBe('stop');
    } finally {
      stopFake.close();
    }

    // ④-b wire 'tool_calls'：块**类型序列**逐字不变，归一结果与改前同解（改前靠 hasToolCalls
    //      推出 'tool_calls'，现在由 message_end 明说 'tool_calls' —— 同值）。
    //      唯一变化是末块多了一个加法字段 `finishReason:'tool_calls'`（灰度兼容：旧消费者
    //      只读 `type`，不读该字段；`normalizeFinishReason` 对两种输入的输出可证相等）。
    const toolSse = [
      sseLine({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: 'call_1', function: { name: 'Read', arguments: '{"path":"a.txt"}' } }],
            },
          },
        ],
      }),
      sseLine({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      'data: [DONE]',
      '',
    ].join('\n');
    const toolFake = await fakeSSEServer(toolSse);
    try {
      const chunks = await streamOnce(toolFake.url);
      expect(chunks.map((c) => c.type)).toEqual([
        'message_start',
        'tool_call_start',
        'tool_call_end',
        'message_end',
      ]);
      expect(lastChunk(chunks)).toEqual({ type: 'message_end', finishReason: 'tool_calls' });
      expect(consumeLikeAgentLoop(chunks)).toBe('tool_calls'); // 改前也是 'tool_calls'
    } finally {
      toolFake.close();
    }

    // 结论的非流式对照：同两个值在 chat() 上逐字不变
    const chatStop = await fakeJsonServer({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {},
    });
    const chatTool = await fakeJsonServer({
      choices: [{ message: { content: '' }, finish_reason: 'tool_calls' }],
      usage: {},
    });
    try {
      expect((await chatOnce(chatStop.url)).finishReason).toBe('stop');
      expect((await chatOnce(chatTool.url)).finishReason).toBe('tool_calls');
    } finally {
      chatStop.close();
      chatTool.close();
    }
  });

  it("⑤ 其它 wire 值的裁决逐条钉住：非流式 content_filter / function_call / 未知值 / 缺失 ⇒ 'error'（=改前同值）；流式同上，缺失则不带字段 ⇒ 既有 'stop'（见 ③）", async () => {
    // ⑤-a 归一表本尊（两条路径唯一共用的一份）
    expect(openAIFinishReason('stop')).toBe('stop');
    expect(openAIFinishReason('tool_calls')).toBe('tool_calls');
    expect(openAIFinishReason('length')).toBe('length');
    expect(openAIFinishReason('content_filter')).toBe('error');
    expect(openAIFinishReason('function_call')).toBe('error');
    expect(openAIFinishReason('some_future_value')).toBe('error');
    expect(openAIFinishReason(undefined)).toBe('error');
    expect(openAIFinishReason('')).toBe('error');

    // ⑤-b 非流式各一条（改前这些值也都是 'error' ⇒ 本卡除 'length' 外不改动任何映射）
    for (const [wire, expected] of [
      ['content_filter', 'error'],
      ['function_call', 'error'],
      ['some_future_value', 'error'],
      ['error', 'error'],
    ] as const) {
      const fake = await fakeJsonServer({
        choices: [{ message: { content: 'x' }, finish_reason: wire }],
        usage: {},
      });
      try {
        expect((await chatOnce(fake.url)).finishReason, `wire=${wire}`).toBe(expected);
      } finally {
        fake.close();
      }
    }

    // ⑤-c 流式：同样这张表 —— content_filter 不得被放宽成 'stop'，也不得被误当 'length'
    const byWire = (wire: string): StreamChunk[] =>
      driveParser([sseLine({ choices: [{ delta: { content: 'x' } }] }), sseLine({ choices: [{ delta: {}, finish_reason: wire }] }), 'data: [DONE]']);
    expect(lastChunk(byWire('content_filter'))).toEqual({ type: 'message_end', finishReason: 'error' });
    expect(consumeLikeAgentLoop(byWire('content_filter'))).toBe('error');
    expect(consumeLikeAgentLoop(byWire('error'))).toBe('error');
    // 关键前提（另一张卡的边界）：wire 'error' 归 'error'，**不是** 'length' ⇒ loop 的截断判据不介入
    expect(consumeLikeAgentLoop(byWire('error'))).not.toBe('length');
  });

  it('⑥ 消费侧重放自检：本地重放对四种 wire 的判定与 AgentLoop.ts:86-90 的规则逐一相符（防这张表被改后悄悄漂移）', () => {
    expect(consumeLikeAgentLoop([{ type: 'message_end', finishReason: 'length' }])).toBe('length');
    expect(consumeLikeAgentLoop([{ type: 'message_end', finishReason: 'error' }])).toBe('error');
    expect(consumeLikeAgentLoop([{ type: 'message_end', finishReason: 'tool_calls' }])).toBe('tool_calls');
    expect(consumeLikeAgentLoop([{ type: 'message_end' }])).toBe('stop');
    // hasToolCalls 分支：没有 finish_reason 但有工具调用 ⇒ 'tool_calls'
    expect(
      consumeLikeAgentLoop([
        { type: 'message_end' },
        { type: 'tool_call_start', id: 'call_1', name: 'Read', arguments: '{}' },
      ]),
    ).toBe('tool_calls');
    // 等价性证明（④ 里"tool_calls 行为逐字不变"的依据）：wire 缺失与 wire 'tool_calls'
    // 在 hasToolCalls=true 时**同解**
    expect(consumeLikeAgentLoop([{ type: 'tool_call_start', id: 'c', name: 'N', arguments: '' }, { type: 'message_end' }])).toBe(
      consumeLikeAgentLoop([{ type: 'tool_call_start', id: 'c', name: 'N', arguments: '' }, { type: 'message_end', finishReason: 'tool_calls' }]),
    );
  });
});
