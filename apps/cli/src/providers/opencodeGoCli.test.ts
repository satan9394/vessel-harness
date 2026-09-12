/**
 * task 103 — CLI/TUI 侧 opencode-go 协议适配（端到端，本地 mock HTTP 服务，不打真实网络）。
 *
 * Covers（≥6 例）:
 *   1. `vessel run --provider opencode-go` 端到端：请求带 x-opencode-session + 具名 UA + Bearer；
 *   2. 同一 mock 端点用通用 `--provider openai-compatible` → 400 MissingSessionID 被分类上抛
 *      （证明「头」是唯一差别，且错误文案带 kind 提示）；
 *   3. TUI `vessel chat` 走已存 preset id `opencode-go`：自动带会话头，且**一个会话内稳定**
 *      （多轮/多次请求复用同一 session id）；
 *   4. planProvider 解析：preset id → 专用 provider 名；baseUrl 优先级 flag > config > preset 兜底；
 *   5. 降级：mock 不构造真实 provider；缺 baseUrl 时 real provider 给出可操作提示；
 *   6. describeProviderError：分类错误附中文可操作提示（缺头/欠费/鉴权）。
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  OPENCODE_GO_PROVIDER_ID,
  OPENCODE_GO_SESSION_HEADER,
  OPENCODE_GO_USER_AGENT,
  classifyOpencodeGoError,
} from '@vessel/llm';
import { main } from '../cli.js';
import { runChat, type ChatSessionIO } from '../tui/chat.js';
import { ProviderStore } from './ProviderStore.js';
import { buildRealProvider, describeProviderError, missingBaseUrl, planProvider } from './providerFactory.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url)); // apps/cli/src/providers → repo root
const POLICY = path.join(REPO_ROOT, 'configs', 'policy.default.yaml');
const BEHAVIOR = path.join(REPO_ROOT, 'configs', 'behavior.default.yaml');
const TEST_KEY = 'sk-test-not-a-real-key';

interface SeenRequest {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: { model?: string; max_tokens?: number };
}

/**
 * 本地「Go 端点」替身。
 *   - 默认 strict：缺 `x-opencode-session` → 400 `MissingSessionID`（与实测一致）；
 *   - force-missing-session / force-credits：即使头齐全也返回该错误（验证 CLI 侧分类与提示）。
 */
async function startGoMock(
  mode: 'strict' | 'force-missing-session' | 'force-credits' = 'strict',
): Promise<{ baseUrl: string; seen: SeenRequest[]; close: () => Promise<void> }> {
  const seen: SeenRequest[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: SeenRequest['body'] = {};
      try {
        body = JSON.parse(raw) as SeenRequest['body'];
      } catch {
        body = {};
      }
      seen.push({ url: req.url ?? '', headers: req.headers, body });
      const json = (status: number, payload: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (mode === 'force-missing-session') {
        json(400, {
          type: 'error',
          error: { type: 'MissingSessionID', message: 'Error from provider (Console Go): Request is missing x-opencode-session.' },
        });
        return;
      }
      if (mode === 'force-credits') {
        json(401, {
          type: 'error',
          error: {
            type: 'CreditsError',
            message: 'Insufficient balance. Manage billing: https://opencode.ai/workspace/wrk_01M0D76E9KB5KKZFB43XQ6PY1D/billing',
          },
        });
        return;
      }
      if (!req.headers[OPENCODE_GO_SESSION_HEADER]) {
        json(400, {
          type: 'error',
          error: {
            type: 'MissingSessionID',
            message: 'Error from provider (Console Go): Request is missing x-opencode-session and cannot be routed efficiently.',
          },
        });
        return;
      }
      if (!req.headers.authorization) {
        json(401, { type: 'error', error: { type: 'CreditsError', message: 'Insufficient balance.' } });
        return;
      }
      json(200, {
        model: body.model ?? 'mimo-v2.5',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'GO-MOCK-PONG' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function captureBoth(): { text: () => string; restore: () => void } {
  const logs: string[] = [];
  const spyLog = vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
  const spyErr = vi.spyOn(console, 'error').mockImplementation((...a) => logs.push(a.join(' ')));
  return {
    text: () => logs.join('\n'),
    restore: () => {
      spyLog.mockRestore();
      spyErr.mockRestore();
    },
  };
}

/** Scripted TUI IO（无真实 TTY）。 */
function scriptedIO(inputs: string[]): { io: ChatSessionIO; output: string[] } {
  const output: string[] = [];
  let i = 0;
  return {
    output,
    io: {
      async readLine() {
        return i < inputs.length ? (inputs[i++] ?? null) : null;
      },
      write(line: string) {
        output.push(line);
      },
    },
  };
}

describe('103 — CLI 端到端：vessel run 走 opencode-go（mock HTTP 服务）', () => {
  let dir: string;
  // G-10：`main(['run', ...])` 与 `runChat()` 都会 new SessionRegistry()（缺省根），
  // 所以 session 根必须与 provider/usage 一起快照——否则会写真实 ~/.vessel/sessions.json（AGENTS.md §8）。
  const saved = {
    provider: process.env.VESSEL_PROVIDER_ROOT,
    usage: process.env.VESSEL_USAGE_ROOT,
    session: process.env.VESSEL_SESSION_ROOT,
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-oc-go-'));
    process.env.VESSEL_PROVIDER_ROOT = dir;
    process.env.VESSEL_USAGE_ROOT = dir;
    process.env.VESSEL_SESSION_ROOT = dir;
  });
  afterEach(() => {
    if (saved.provider === undefined) delete process.env.VESSEL_PROVIDER_ROOT;
    else process.env.VESSEL_PROVIDER_ROOT = saved.provider;
    if (saved.usage === undefined) delete process.env.VESSEL_USAGE_ROOT;
    else process.env.VESSEL_USAGE_ROOT = saved.usage;
    if (saved.session === undefined) delete process.env.VESSEL_SESSION_ROOT;
    else process.env.VESSEL_SESSION_ROOT = saved.session;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('run --provider opencode-go 注入 x-opencode-session + 具名 UA + Bearer，端到端成功', async () => {
    const mock = await startGoMock();
    try {
      const cap = captureBoth();
      const code = await main([
        'run',
        '--workspace', dir,
        '--prompt', 'ping',
        '--provider', OPENCODE_GO_PROVIDER_ID,
        '--base-url', mock.baseUrl,
        '--api-key', TEST_KEY,
        '--model', 'mimo-v2.5',
        '--policy', POLICY,
        '--behavior', BEHAVIOR,
      ]);
      cap.restore();
      expect(code).toBe(0);
      expect(cap.text()).toContain('GO-MOCK-PONG');
      expect(mock.seen.length).toBeGreaterThanOrEqual(1);
      const first = mock.seen[0]!;
      expect(first.url).toBe('/v1/chat/completions');
      expect(first.headers[OPENCODE_GO_SESSION_HEADER]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(first.headers['user-agent']).toBe(OPENCODE_GO_USER_AGENT);
      expect(first.headers.authorization).toBe(`Bearer ${TEST_KEY}`);
      expect(first.body.model).toBe('mimo-v2.5');
      // 推理模型预算：默认 max_tokens 留足思维链（102 语义在 CLI 侧同样成立）
      expect(first.body.max_tokens).toBe(8192);
    } finally {
      await mock.close();
    }
  });

  it('同一端点用通用 openai-compatible → 400 MissingSessionID 被分类并提示（证明头是唯一差别）', async () => {
    const mock = await startGoMock();
    try {
      const cap = captureBoth();
      const code = await main([
        'run',
        '--workspace', dir,
        '--prompt', 'ping',
        '--provider', 'openai-compatible',
        '--base-url', mock.baseUrl,
        '--api-key', TEST_KEY,
        '--model', 'mimo-v2.5',
        '--policy', POLICY,
        '--behavior', BEHAVIOR,
      ]);
      cap.restore();
      expect(code).toBe(1);
      const text = cap.text();
      // 通用客户端只能拿到原始 wire 错误：没有分类、没有可操作提示（这正是 103 要修的）
      expect(text).toContain('MissingSessionID');
      expect(text).toContain('x-opencode-session');
      expect(text).not.toContain('提示：');
      // 通用客户端确实没带会话头（这正是它 400 的原因）
      expect(mock.seen[0]!.headers[OPENCODE_GO_SESSION_HEADER]).toBeUndefined();
    } finally {
      await mock.close();
    }
  });

  it('opencode-go 收到 400 MissingSessionID → CLI 打印分类 + 可操作提示（不静默失败）', async () => {
    const mock = await startGoMock('force-missing-session');
    try {
      const cap = captureBoth();
      const code = await main([
        'run', '--workspace', dir, '--prompt', 'ping',
        '--provider', OPENCODE_GO_PROVIDER_ID, '--base-url', mock.baseUrl,
        '--api-key', TEST_KEY, '--model', 'mimo-v2.5',
        '--policy', POLICY, '--behavior', BEHAVIOR,
      ]);
      cap.restore();
      expect(code).toBe(1);
      const text = cap.text();
      expect(text).toContain('missing-session');
      expect(text).toContain('MissingSessionID');
      expect(text).toContain('提示：');
      expect(text).toContain('x-opencode-session');
    } finally {
      await mock.close();
    }
  });

  it('opencode-go 收到 401 CreditsError → 分类为 credits + 欠费提示，且文案不带内部标识', async () => {
    const mock = await startGoMock('force-credits');
    try {
      const cap = captureBoth();
      const code = await main([
        'run', '--workspace', dir, '--prompt', 'ping',
        '--provider', OPENCODE_GO_PROVIDER_ID, '--base-url', mock.baseUrl,
        '--api-key', TEST_KEY, '--model', 'mimo-v2.5',
        '--policy', POLICY, '--behavior', BEHAVIOR,
      ]);
      cap.restore();
      expect(code).toBe(1);
      const text = cap.text();
      expect(text).toContain('credits');
      expect(text).toContain('Insufficient balance');
      expect(text).toContain('余额');
      expect(text).not.toContain('wrk_01M0D76E9KB5KKZFB43XQ6PY1D');
      expect(text).not.toContain('https://opencode.ai/workspace');
    } finally {
      await mock.close();
    }
  });

  it('TUI runChat：已存 preset id opencode-go 自动带会话头，且一个会话内 session id 稳定', async () => {
    const mock = await startGoMock();
    try {
      const store = new ProviderStore({ rootDir: dir });
      store.add({
        id: OPENCODE_GO_PROVIDER_ID,
        name: 'OpenCode Go',
        protocol: 'openai-compatible',
        baseUrl: mock.baseUrl,
        apiKey: TEST_KEY,
        model: 'mimo-v2.5',
      });
      store.setCurrent(OPENCODE_GO_PROVIDER_ID);

      const { io, output } = scriptedIO(['ping', 'ping again', '/quit']);
      const code = await runChat({
        workspaceRoot: dir,
        policySystemPath: POLICY,
        behaviorIRPath: BEHAVIOR,
        store,
        io,
      });
      expect(code).toBe(0);
      expect(output.join('\n')).toContain('GO-MOCK-PONG');
      expect(mock.seen.length).toBeGreaterThanOrEqual(2);
      const ids = new Set(mock.seen.map((s) => s.headers[OPENCODE_GO_SESSION_HEADER]));
      expect(ids.size).toBe(1); // 同一 TUI 会话 → 同一 session id
      expect([...ids][0]).toMatch(/^[0-9a-f-]{36}$/);
      expect(mock.seen.every((s) => s.headers['user-agent'] === OPENCODE_GO_USER_AGENT)).toBe(true);
    } finally {
      await mock.close();
    }
  });
});

describe('103 — providerFactory 解析与降级（无网络）', () => {
  it('preset id opencode-go → 专用 provider 名；baseUrl 优先级 flag > config > preset 兜底', () => {
    const preset = planProvider({ config: { id: OPENCODE_GO_PROVIDER_ID, protocol: 'openai-compatible', model: 'mimo-v2.5' } });
    expect(preset.providerName).toBe(OPENCODE_GO_PROVIDER_ID);
    expect(preset.baseUrl).toBe('https://opencode.ai/zen/go/v1'); // preset SSOT 兜底
    expect(preset.real).toBe(true);

    const explicit = planProvider({ explicitProvider: OPENCODE_GO_PROVIDER_ID, model: 'mimo-v2.5' });
    expect(explicit).toMatchObject({ providerName: OPENCODE_GO_PROVIDER_ID, baseUrl: 'https://opencode.ai/zen/go/v1', real: true });

    const overridden = planProvider({
      config: { id: OPENCODE_GO_PROVIDER_ID, protocol: 'openai-compatible', baseUrl: 'http://config/v1', model: 'm' },
      baseUrl: 'http://flag/v1',
      model: 'flag-model',
    });
    expect(overridden).toMatchObject({ baseUrl: 'http://flag/v1', model: 'flag-model' });

    // 其它供应商照旧用协议名
    expect(planProvider({ config: { id: 'deepseek', protocol: 'openai-compatible', baseUrl: 'http://d/v1', model: 'x' } }).providerName).toBe(
      'openai-compatible',
    );
    expect(planProvider({ explicitProvider: 'mock' })).toMatchObject({ providerName: 'mock', real: false });
  });

  it('降级：mock 不构造真实 provider；缺 baseUrl 的真实 provider 有明确提示', () => {
    expect(buildRealProvider(planProvider({ explicitProvider: 'mock' }))).toBeNull();
    const noUrl = planProvider({ explicitProvider: 'openai-compatible', model: 'm' });
    expect(missingBaseUrl(noUrl)).toBe(true);
    expect(() => buildRealProvider(noUrl)).toThrow(/需要 base-url/);
    expect(missingBaseUrl(planProvider({ explicitProvider: OPENCODE_GO_PROVIDER_ID }))).toBe(false); // preset 兜底
  });

  /**
   * 第 1 条：`VESSEL_MODEL=`（空串/纯空白）被当成真模型名 ⇒ 请求体 `model: ""`，既不回落
   * `mock-model` 也不报错（同族的 `VESSEL_BASE_URL=` / `VESSEL_API_KEY=` 都会明确失败）。
   *
   * 生产调用点（静态证据链）：
   *   - `apps/cli/src/cli.ts:963` `cmdRun`：`model: flags.get('model') ?? process.env.VESSEL_MODEL`
   *     → 原样进 `planProvider`；`plan.model` 又直接进 `buildRealProvider` 的请求体与
   *     `MockProvider`（`:970`/`:1009`）。
   *   - `apps/cli/src/cli.ts:1348`（本卡改为取 `plan.model`）`cmdBench`；
   *   - `apps/cli/src/tui/chat.ts:511`（会话内 `/model` 覆盖，同一条解析）。
   * 旧实现 `model: input.model ?? input.config?.model ?? 'mock-model'`：`''` **不是 nullish**
   * ⇒ `plan.model === ''`。把 `unsetIfBlank(...)` 换回裸 `??` ⇒ ①/①-b/①-c 立即红。
   *
   * ③ 关于「会不会静默跑 mock」——先读码判断（不是猜）：
   *   `plan.real` 只由 **provider 名**决定（`REAL_PROVIDER_NAMES.has(providerName)`），与 model
   *   无关；`cmdRun` 的 `usingMockProvider = realProvider === null` 也只由 `plan.real` + baseUrl
   *   决定。所以空白 model 修复后，真实 provider **仍是真实 provider**（下面断言
   *   `buildRealProvider(real) !== null`），不会因为「回落成 `mock-model`」就静默切到离线 mock。
   *   落到的那个 `'mock-model'` 常量是**既有**语义（「model 未设置」的兜底），本次只是让
   *   `''` 与「根本没设 VESSEL_MODEL」**逐字走同一条路**（下面 `real.model === unset.model`）。
   */
  it('#1 空串/纯空白的 model ⇒ 按未设置（回落 config.model → 既有常量）；非空白逐字不变', () => {
    // ① 判别性：旧实现给出 `model: ''`（真发空模型名）
    expect(planProvider({ model: '' }).model).toBe('mock-model');
    expect(planProvider({ model: '   ' }).model).toBe('mock-model');

    // ①-b 同一判据适用于 config 里的 model（另一个来源，同样的 `??` 病）
    expect(planProvider({ config: { model: '  ' } }).model).toBe('mock-model');

    // ①-c 空显式值 ⇒ 落下一级：config.model（不是直接落到常量）
    expect(planProvider({ model: '', config: { model: 'cfg-model' } }).model).toBe('cfg-model');

    // ③ 真实 provider + 空 model：仍走真实 provider（不静默跑 mock），且与「未设置」逐字同路
    const real = planProvider({ explicitProvider: 'openai-compatible', baseUrl: 'http://real/v1', model: '' });
    const unset = planProvider({ explicitProvider: 'openai-compatible', baseUrl: 'http://real/v1' });
    expect(real.real).toBe(true);
    expect(real.model).toBe(unset.model); // 空串 == 未设置（本条即「按未设置」的定义）
    expect(buildRealProvider(real)).not.toBeNull();

    // ② 负对照：有值时行为逐字不变
    expect(planProvider({ model: 'gpt-4o' }).model).toBe('gpt-4o');
    expect(planProvider({ model: '  gpt-4o  ' }).model).toBe('  gpt-4o  '); // 非空白逐字（只统一「有没有值」，不 trim 值）
    expect(planProvider({ config: { model: 'cfg-model' } }).model).toBe('cfg-model');
    // flags（显式入参）优先于 config 的优先级不变
    expect(planProvider({ model: 'flag-model', config: { id: 'deepseek', protocol: 'openai-compatible', baseUrl: 'http://d/v1', model: 'cfg-model' } }).model).toBe(
      'flag-model',
    );
    // provider 名 / baseUrl / real 解析不受本修复影响（逐字不变）
    expect(planProvider({ explicitProvider: 'mock' })).toMatchObject({ providerName: 'mock', real: false, model: 'mock-model' });
  });

  it('describeProviderError：400 缺头 / 401 欠费 附中文可操作提示；未分类错误原样返回', () => {
    const missing = describeProviderError(classifyOpencodeGoError(400, '{"error":{"type":"MissingSessionID","message":"missing x-opencode-session"}}'));
    expect(missing).toContain('missing-session');
    expect(missing).toContain('x-opencode-session');

    const credits = describeProviderError(
      classifyOpencodeGoError(401, '{"error":{"type":"CreditsError","message":"Insufficient balance. https://opencode.ai/workspace/wrk_secret/billing"}}'),
    );
    expect(credits).toContain('credits');
    expect(credits).toContain('余额');
    expect(credits).not.toContain('wrk_secret');

    expect(describeProviderError(new Error('plain failure'))).toBe('plain failure');

    // AgentLoop 会用 new Error(...) 重新包装 provider 错误（kind 字段丢失）→ 仍能从文案还原提示
    const wrapped = describeProviderError(
      new Error('Model call failed after 1 attempt(s): opencode-go 400 MissingSessionID (missing-session): missing header'),
    );
    expect(wrapped).toContain('提示：');
    expect(wrapped).toContain('x-opencode-session');
  });
});
