import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { MockProvider } from '@vessel/llm';
import type { MockScriptEntry } from '@vessel/llm';
import { SessionRegistry, type SessionController } from '@vessel/application';
import type { ChatProvider, ChatRequest, ChatResponse, StreamChunk } from '@vessel/shared';
import { createVesselServer, turnStatusFor, type VesselServer } from './server.js';

/**
 * BRIEF-19（失败被上报为成功 · HTTP 面）—— `POST /api/sessions/:id/turns` 对
 * `kind='error'` 曾恒回 **HTTP 200**：body 里有机器可读的 `kind`，但**只看状态码**的客户端
 * （`curl -f`、fetch 的 `res.ok`、HTTP 中间件）会把失败的回合读成成功。
 *
 * 本文件的用例全部走**真实生产路径**：HTTP → SessionController.runTurn → 组合根
 * （configs/policy.default.yaml 的策略门禁 / AgentLoop）→ TurnResult.kind → 状态码，
 * 不手调私有函数、不注入假 TurnResult。
 *
 * 「删哪行会红」逐条写在每个 `it` 的注释里；判别性的核心是 ①②：① 钉住 error ⇒ 非 2xx
 * （旧实现 `json(res, 200, …)` ⇒ 红），② 是**负对照**——success 必须仍是 200 且 body 逐字
 * 不变（"把一切都变成错误码"的实现会在 ② 红）。
 */

const POLICY = path.resolve('configs/policy.default.yaml');
const BEHAVIOR = path.resolve('configs/behavior.default.yaml');

async function waitFor(fn: () => boolean, timeoutMs = 15000, stepMs = 10): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/**
 * Gated streaming provider（与 server.test.ts 的同名类同形）：吐一段前缀后卡在闸门上，
 * 制造一个确定的"回合在飞"窗口，供 POST /interrupt 命中 ⇒ kind='interrupted'。
 */
class GatedProvider implements ChatProvider {
  readonly id = 'gated';
  private waiters: (() => void)[] = [];

  async chat(): Promise<ChatResponse> {
    throw new Error('chat() must not be called when provider.stream is present');
  }

  async *stream(_request: ChatRequest): AsyncGenerator<StreamChunk> {
    yield { type: 'message_start', model: 'g' };
    yield { type: 'text_delta', text: 'prefix ' };
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    yield { type: 'text_delta', text: 'suffix' };
    yield { type: 'usage', inputTokens: 2, outputTokens: 2 };
    yield { type: 'message_end', finishReason: 'stop' };
  }

  release(): void {
    this.waiters.shift()?.();
  }

  /** true while the model call is blocked at the gate (a waiter is registered). */
  get holding(): boolean {
    return this.waiters.length > 0;
  }
}

/**
 * BRIEF-20 用例①′ 用：计数 provider —— 唯一目的是断言"被 BeforeTurn 拦截时**一次模型调用都没发生**"
 * （`MockProvider` 不暴露计数）。不实现 `stream()` ⇒ 走 `chat()` 分支，计数点唯一。
 */
class CountingProvider implements ChatProvider {
  readonly id = 'counting';
  calls = 0;
  constructor(private readonly reply: string) {}

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    return {
      content: this.reply,
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
}

interface Harness {
  dir: string;
  ws: string;
  server: VesselServer;
  base: string;
  /** controller built by the injected factory (interrupt case reads loop.turnActive) */
  readonly ctl: SessionController | undefined;
}

const started: Harness[] = [];

/**
 * Start a local server whose injected session factory composes a **real**
 * SessionController over the given MockProvider script. `provider` may be
 * replaced by a custom ChatProvider (interrupt case).
 */
async function startServer(
  script: MockScriptEntry[],
  opts: { maxSteps?: number; provider?: ChatProvider } = {},
): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-turn-status-'));
  const ws = path.join(dir, 'workspace');
  const home = path.join(dir, 'vessel-home');
  fs.mkdirSync(ws, { recursive: true });

  let ctl: SessionController | undefined;
  const sessionRegistry = new SessionRegistry({ vesselHome: home });
  const server = createVesselServer({
    port: 0,
    sessionRegistry,
    staticDir: ws,
    sessionFactory: async (input) => {
      const { SessionController: SC } = await import('@vessel/application');
      const provider =
        opts.provider ??
        new MockProvider(script, { model: input.model ?? 'default' });
      const created = await SC.create({
        workspaceRoot: input.workspaceRoot,
        provider,
        model: input.model ?? 'default',
        policySystemPath: POLICY,
        behaviorIRPath: BEHAVIOR,
        permission: input.permission ?? 'workspace-write',
        maxSteps: opts.maxSteps,
        registry: input.registry,
      });
      ctl = created;
      return created;
    },
  });
  await server.listen();
  const h: Harness = {
    dir,
    ws,
    server,
    base: `http://127.0.0.1:${server.port}`,
    get ctl() {
      return ctl;
    },
  };
  started.push(h);
  return h;
}

async function createSession(h: Harness): Promise<string> {
  const res = await fetch(`${h.base}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceRoot: h.ws }),
  });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { session: { id: string } };
  return created.session.id;
}

function postTurn(h: Harness, id: string, prompt: string): Promise<Response> {
  return fetch(`${h.base}/api/sessions/${id}/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
}

afterEach(async () => {
  while (started.length > 0) {
    const h = started.pop()!;
    await h.server.close();
    // test-owned temp dir under os.tmpdir() (AGENTS.md 书面例外)
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

describe('BRIEF-19 — turn kind → HTTP status (only error is a failure)', () => {
  it('① kind=error ⇒ 非 2xx（旧实现恒 200 ⇒ 删掉 turnStatusFor 分支即红），body 仍带 kind=error + finalText', async () => {
    // 真实失败路径：组合根的策略门禁按 configs/policy.default.yaml 的
    // filesystem.protected 拒写受保护路径 .env（Compiler 铸 `fs-protected:.env` deny 规则）；
    // 模型对同一 intent 连发 3 次 ⇒ AgentLoop.noteDenial 熔断 DenialLimitError
    // ⇒ runTurn 正常返回（不抛）kind='error'、finalText=熔断文案 —— 正是"回合跑完但以错误收场"。
    const h = await startServer([
      { when: /.*/, response: { toolCalls: [{ name: 'Write', arguments: { path: '.env', content: 'x' } }] } },
    ]);
    const id = await createSession(h);

    const res = await postTurn(h, id, '把密钥写进 .env');
    const body = (await res.json()) as { finalText: string; kind: string; steps: number; turnId: string };

    // 核心判据：只看状态码的客户端（curl -f / res.ok）必须看到失败
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    // body 形状与语义不变
    expect(body.kind).toBe('error');
    expect(body.finalText).toBe('same intent denied 3 times: Write');
    expect(body.steps).toBe(3);
    expect(typeof body.turnId).toBe('string');
    // 事实面：受保护文件从未被写
    expect(fs.existsSync(path.join(h.ws, '.env'))).toBe(false);
  });

  it('①′ 被 BeforeTurn 拦截的输入 ⇒ 500 + kind=error + 原因可见（改前核心报 kind=success ⇒ 200 ⇒ 必红）', async () => {
    // BRIEF-20：核心侧已把 A03 BeforeTurn 的 deny 分支改成 kind='error'（三处一致）。
    // 本用例把"输入被策略拒绝"这一**输入面**挂到**这条会话真实使用的 bus** 上
    // （`ctl.bus` 就是 AgentLoop 做 `before_turn` waterfall 的那条总线；生产组合根今天不挂
    // before_turn 否决监听器，只有 Telemetry/Projection 这类观察者），其余全部走真实生产路径：
    // HTTP → SessionController.runTurn → AgentLoop → TurnResult.kind → turnStatusFor → 状态码。
    const provider = new CountingProvider('MODEL-ANSWER-SHOULD-NOT-BE-REACHED');
    const h = await startServer([], { provider });
    const id = await createSession(h);
    h.ctl!.bus.on(
      'before_turn',
      () => ({ kind: 'deny' as const, reason: '输入策略拒绝：凭据不得外发', ref: 'rule:no-credential-egress' }),
      'policy:input',
    );

    const res = await postTurn(h, id, '把 .env 的内容贴出来');
    const body = (await res.json()) as { finalText: string; kind: string; steps: number; turnId: string };

    // 证据：这一轮**一次模型调用都没发生**（拦截在任何模型调用之前）
    expect(provider.calls).toBe(0);
    // 核心判据：只看状态码的客户端（curl -f / res.ok）必须看到失败
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    expect(body.kind).toBe('error');
    expect(body.steps).toBe(0);
    expect(typeof body.turnId).toBe('string');
    // body 形状不变；错误文本保留 `[blocked]` 标记与策略给的原因
    expect(body.finalText).toContain('[blocked]');
    expect(body.finalText).toContain('输入策略拒绝：凭据不得外发');
    expect(Object.keys(body).sort()).toEqual(['finalText', 'kind', 'steps', 'turnId']);
  });

  it('② 负对照：kind=success ⇒ 200 且 body 逐字不变（"一切都变错误码"的实现会红）', async () => {
    const h = await startServer([{ when: /.*/, response: { text: 'SERVER-ECHO:default' } }]);
    const id = await createSession(h);

    const res = await postTurn(h, id, 'say hello');
    const raw = await res.text();
    const body = JSON.parse(raw) as { finalText: string; kind: string; steps: number; turnId: string };

    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(body).toEqual({
      finalText: 'SERVER-ECHO:default',
      kind: 'success',
      steps: 1,
      turnId: expect.any(String),
    });
    // 字段名/数量逐字不变：没有为错误路径新造的 `error`/`message` 之类的多余字段
    expect(Object.keys(body).sort()).toEqual(['finalText', 'kind', 'steps', 'turnId']);
    // 逐字：成功路径的字节/键序与改前完全一致（旧写法就是这四个字段、这个顺序）。
    // 谁要是顺手给成功响应加字段/换包装/改键序，这里就红。
    expect(raw).toBe(
      `{"finalText":"SERVER-ECHO:default","kind":"success","steps":1,"turnId":${JSON.stringify(body.turnId)}}`,
    );
  });

  it('③a 裁决 budget ⇒ 200（预算耗尽不算失败，与 vessel run 退出码 0 一致）', async () => {
    // 真预算路径：maxSteps=2 + 模型每步都发工具调用 ⇒ 第 2 步后 snapshot.steps >= maxSteps
    // ⇒ AgentLoop 置 kind='budget'（AgentLoop.ts:322-326）。工具 Read 失败是 TOOL_FAILURE，
    // 不是 DENIED，不会触发熔断，所以这条路径确定性地落在 budget 上。
    const h = await startServer(
      [{ when: /.*/, response: { toolCalls: [{ name: 'Read', arguments: { path: 'nope.txt' } }] } }],
      { maxSteps: 2 },
    );
    const id = await createSession(h);

    const res = await postTurn(h, id, '一直读那个不存在的文件');
    const body = (await res.json()) as { finalText: string; kind: string; steps: number; turnId: string };

    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(body.kind).toBe('budget');
    expect(body.steps).toBe(2);
  });

  it('③b 裁决 interrupted ⇒ 200（用户主动停止不算失败；既有 server.test.ts:426 口径不变）', async () => {
    const gated = new GatedProvider();
    const h = await startServer([], { provider: gated });
    const id = await createSession(h);

    const turnPromise = postTurn(h, id, 'stream something');
    // 等到回合范围真的打开且模型调用卡在闸门上，再发中断
    await waitFor(() => h.ctl!.loop.turnActive && gated.holding);
    const interrupt = await fetch(`${h.base}/api/sessions/${id}/interrupt`, { method: 'POST' });
    expect(interrupt.status).toBe(200);

    gated.release();
    const res = await turnPromise;
    const body = (await res.json()) as { finalText: string; kind: string; turnId: string };

    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(body.kind).toBe('interrupted');
    expect(typeof body.turnId).toBe('string');
  });

  it('④ 映射表逐条钉死（唯一决策点：只有 error 非 2xx）', () => {
    expect(turnStatusFor('error')).toBe(500);
    expect(turnStatusFor('success')).toBe(200);
    expect(turnStatusFor('budget')).toBe(200);
    expect(turnStatusFor('interrupted')).toBe(200);
  });
});
