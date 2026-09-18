/**
 * mockVisibility.test.ts — BRIEF-16 1C（mock 运行期可见性）的**判别性**验收。
 *
 * 背景（EVALUATION-REPORT-22.md 复评 P1：「1C 代码 ACCEPT 但测试不真实」）：
 * 1C 已在 `cli.ts`（`MOCK_PROVIDER_NOTICE` → stderr；`renderFinalReply` 给最终回复加
 * `（mock 离线冒烟）` 前缀）与 `tui/chat.ts`（`TUI_MOCK_PROVIDER_NOTICE` / `renderTurnReply`）
 * 落地，但全仓 **0 处**断言过 `MOCK_PROVIDER_NOTICE` / `TUI_MOCK_PROVIDER_NOTICE` /
 * 「未连接真实模型」；唯一触碰标记的 `policyStatus.test.ts:347,379` 把 `toContain` 打在
 * `fallbackText` 上——而 `fallbackText`（`cli.ts` 的 mock 脚本 `fallbackText` / `chat.ts` 的对应常量）**自身就以该标记开头**，
 * 于是把 `renderFinalReply` 整段删掉那两条依旧绿（零判别力）。同理
 * `cli.test.ts:171` / `opencodeGoCli.test.ts:187` 用的是子串阳性断言
 * （`toContain('CLI-106-MARKER')`），给真 provider 回复加个 mock 前缀也打断不了它。
 *
 * 2026-09-18 更新（task 131）：`MOCK_PROVIDER_NOTICE` / `MOCK_REPLY_MARK` / `fallbackText` 与
 * 渲染助手已收敛到零依赖叶子模块 `turnText.ts` **唯一一份**，CLI 与 TUI 各自 import 同一份；
 * 上面的 `TUI_MOCK_PROVIDER_NOTICE` 名称已不存在（历史描述保留）。
 *
 * 本文件每条断言都打在**真实路径**上（真实 `main()` / 真实 `runChat()`，不替换被测量对象），
 * 并逐条具备「修复前会红」或「负对照」的判别性：
 *
 *   1) CLI 正例（fallback 路径）：空 provider 配置 → stderr 含提示、stdout 零污染、
 *      最终回复行 `startsWith` 标记。注意本条**单独不具判别力**（fallbackText 自带标记），
 *      它的价值是锁「提示走 stderr」这条通道契约 —— 正是复评点名缺失的那处断言。
 *   2) 【强判别】CLI 正例：prompt 命中 mock 冒烟脚本（/总结/）+ 工作区存在 README.md
 *      → 走「脚本命中回显」，回显文案「已通过 Read 工具读取工作区文件。…」（`cli.ts` 的 mock 脚本命中回显分支）
 *      **自身不带标记**，只有 `renderFinalReply` 生效才会以标记开头。**修复前必红。**
 *   3) CLI 幂等：fallback 与脚本回显两条路径的标记各出现**恰好一次**（`split` 计数），
 *      防「文案自带 + 出口再加」叠成两层。回显那条**修复前必红**（0 次 ≠ 1 次）。
 *   4) CLI 负对照（真 provider）：临时 provider 根里注册一个指向 **loopback 127.0.0.1**
 *      的 openai-compatible 供应商并设为当前（零真实网络）→ stderr 无提示、最终回复行
 *      逐字等于 provider 返回的文本、不含标记。用严格等值 + 阴性断言，
 *      **不用**弱 `toContain` 阳性断言。
 *   5) TUI 正例：`runChat`（空 provider 根 → 内置 mock）→ 输出含提示、回显回复行以标记开头。
 *      **修复前必红。**
 *   6) TUI 负对照：注入的 provider（`chat.ts` 的 `opts.provider` 注入分支）与经 store 解析出的 loopback
 *      真 provider（`chat.ts` 的 store 解析分支）两条入口，都不含提示、回复不含标记。
 *   7) AC2 边界（复评指出）：mock **空回复**（无 finalText）走 `(无文本回复)` 分支且**不带标记**
 *      —— `renderFinalReply` / `renderTurnReply` 的 `if (!finalText)` 分支在 mock 判定**之前**
 *      返回（`cli.ts` 的 `renderFinalReply` / `chat.ts` 的 `renderTurnReply` 的同一早退分支）。本条**如实断言当前行为**并注明这是已知边界：
 *      不为让它绿而放宽断言，也不顺手改实现。
 *      走真实内置 mock：`--max-steps 1` 时脚本第一步发 Read 工具调用 → `snapshot.steps >= maxSteps`
 *      → `kind=budget`、`finalText=''`（AgentLoop.ts:314-317）。
 *
 * 隔离纪律（AGENTS.md §8）：四个状态根 + `VESSEL_MCP_ROOT` 全部 `mkdtempSync` 注入、
 * `afterEach` 还原并清理；`VESSEL_BASE_URL` / `VESSEL_API_KEY` / `VESSEL_MODEL` 在本文件内
 * 一律摘除后还原——`planProvider`（providerFactory.ts:83-91）里 flags/env 的优先级**高于**
 * 已存配置的 baseUrl，不摘掉的话机器上带着真端点就会把负对照打成真实网络请求。
 *
 * 关于 `--json`：`cmdRun` 目前**没有** `--json` 成功回复分支（`cmdRun` 的成功分支无条件
 * `console.log` 人类文案；`isJson` 只在 `fail()` 失败出口生效，见 `fail()` 的注释），
 * 因此本文件不设 JSON 回复用例——没有可断言的 JSON 回复字段，硬造一个只会是假绿。
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncCredentialStore } from '@vessel/application';
import { MockProvider } from '@vessel/llm';
import { main } from './cli.js';
import { runChat, type ChatSessionIO } from './tui/chat.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url)); // apps/cli/src → repo root
const POLICY = path.join(REPO_ROOT, 'configs', 'policy.default.yaml');
const BEHAVIOR = path.join(REPO_ROOT, 'configs', 'behavior.default.yaml');

/**
 * 两个标注的**字面量**（逐字取自 `turnText.ts` 的 `MOCK_PROVIDER_NOTICE` / `MOCK_REPLY_MARK`；
 * 本文件不 import 生产常量来算期望值 —— 那样"把文案改掉"永远不会红，是自证式断言）。
 *
 * 两处文案现已由零依赖叶子模块 `turnText.ts` 提供**唯一一份**（CLI 与 TUI 各自 import 同一份，
 * task 131），源码层面有编译期约束；本文件仍用同一份字面量同时断言两条路径的输出，
 * 任一侧漂移都会有一半用例变红。
 */
const MOCK_NOTICE =
  '[vessel] 当前使用内置 mock 模型（未连接真实模型）——配置真实模型：vessel setup 或 vessel provider add';
const MOCK_NOTICE_KEY = '未连接真实模型';
const MOCK_REPLY_MARK = '（mock 离线冒烟）';

/** 最终回复行在 stdout 里的定位标记（`cmdRun` 打印的固定表头）。 */
const FINAL_REPLY_HEADER = '=== 最终回复 ===';

/**
 * 状态根 + 端点覆盖项。后三条（VESSEL_BASE_URL / VESSEL_API_KEY / VESSEL_MODEL）会被
 * cmdRun 当作 flags 的回落值**覆盖**已存配置（providerFactory.ts:83-91）——摘掉它们，
 * 负对照才在任何机器上都只打 127.0.0.1。
 */
const ENV_KEYS = [
  'VESSEL_PROVIDER_ROOT',
  'VESSEL_USAGE_ROOT',
  'VESSEL_SESSION_ROOT',
  'VESSEL_SETTINGS_ROOT',
  'VESSEL_MCP_ROOT',
  'VESSEL_BASE_URL',
  'VESSEL_API_KEY',
  'VESSEL_MODEL',
] as const;

let providerRoot: string;
let usageRoot: string;
let sessionRoot: string;
let settingsRoot: string;
let mcpRoot: string;
let ws: string;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  providerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-mockvis-prov-'));
  usageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-mockvis-usage-'));
  sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-mockvis-sess-'));
  settingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-mockvis-set-'));
  // VESSEL_MCP_ROOT 指到空目录：cmdRun / runChat 都会读 mcp.json，
  // 不隔离就可能在真实 ~/.vessel/mcp.json 有效时**真的 spawn MCP 子进程**。
  mcpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-mockvis-mcp-'));
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-mockvis-ws-'));

  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
  process.env.VESSEL_PROVIDER_ROOT = providerRoot;
  process.env.VESSEL_USAGE_ROOT = usageRoot;
  process.env.VESSEL_SESSION_ROOT = sessionRoot;
  process.env.VESSEL_SETTINGS_ROOT = settingsRoot;
  process.env.VESSEL_MCP_ROOT = mcpRoot;
  delete process.env.VESSEL_BASE_URL;
  delete process.env.VESSEL_API_KEY;
  delete process.env.VESSEL_MODEL;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const prev = saved.get(key);
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
  for (const d of [providerRoot, usageRoot, sessionRoot, settingsRoot, mcpRoot, ws]) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

/**
 * 收集 stdout / stderr / warn。口径与 `jsonErrorExits.test.ts` 的 `capture()` 一致
 * （`main()` 与 `fail()` 都走 `console.*`）；额外暴露 `lines()` = 逐次 `console.log` 的
 * **原始参数**（一次调用 = 一条），因为最终回复可能自身含换行，用 join 后的字符串
 * 无法可靠地切出「最终回复所在行」。
 */
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const warn: string[] = [];
  const spyLog = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    out.push(a.join(' '));
  });
  const spyErr = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    err.push(a.join(' '));
  });
  const spyWarn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
    warn.push(a.join(' '));
  });
  return {
    lines: (): string[] => out,
    out: (): string => out.join('\n'),
    err: (): string => err.join('\n'),
    warn: (): string => warn.join('\n'),
    clear: (): void => {
      out.length = 0;
      err.length = 0;
      warn.length = 0;
    },
    restore: (): void => {
      spyLog.mockRestore();
      spyErr.mockRestore();
      spyWarn.mockRestore();
    },
  };
}

type Cap = ReturnType<typeof capture>;

/**
 * `=== 最终回复 ===` 表头的**下一行** = `cmdRun` 打印的最终回复。
 * 取不到就断言失败（而不是回落到空串把断言变成空转）。
 */
function finalReplyLine(cap: Cap): string {
  const lines = cap.lines();
  const at = lines.findIndex((l) => l.includes(FINAL_REPLY_HEADER));
  expect(at).toBeGreaterThanOrEqual(0);
  const reply = lines[at + 1];
  expect(reply).toBeDefined();
  return reply ?? '';
}

/** TUI 侧：输出里第一条含 `needle` 的行（`io.write` 一次调用 = 一条）。 */
function tuiReplyLine(output: string[], needle: string): string {
  const line = output.find((l) => l.includes(needle));
  expect(line).toBeDefined();
  return line ?? '';
}

/** 标记出现次数：`（mock 离线冒烟）` 在回复里出现几次（幂等判定用）。 */
function markCount(text: string): number {
  return text.split(MOCK_REPLY_MARK).length - 1;
}

/** Scripted chat IO（照 chat.test.ts）：喂输入数组、收集输出行。 */
function scriptedIO(inputs: string[]): { io: ChatSessionIO; output: string[] } {
  const output: string[] = [];
  let i = 0;
  return {
    output,
    io: {
      async readLine() {
        if (i < inputs.length) return inputs[i++] ?? null;
        return null; // EOF
      },
      write(line: string) {
        output.push(line);
      },
    },
  };
}

/**
 * 本地 loopback 端点替身（照 cli.test.ts / chat.test.ts，**不发起真实网络**）：
 * 记录请求头，SSE 与 JSON 两种形态都回同一段固定文本（AgentLoop 是 stream-first）。
 */
async function startLoopback(
  marker: string,
): Promise<{ baseUrl: string; seen: http.IncomingHttpHeaders[]; close: () => Promise<void> }> {
  const seen: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      seen.push(req.headers);
      let stream = false;
      try {
        stream = (JSON.parse(raw) as { stream?: boolean }).stream === true;
      } catch {
        stream = false;
      }
      if (stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: marker }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 3, completion_tokens: 2 },
          })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: marker } }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
      );
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

/** 内存凭据后端（照 chat.test.ts）：不碰真实 secrets.json。 */
function memoryCredentialStore(seed: Record<string, string> = {}): SyncCredentialStore {
  const map = new Map(Object.entries(seed));
  const k = (service: string, account: string): string => `${service}/${account}`;
  return {
    backend: 'memory-test',
    setSync: (service, account, secret) => {
      map.set(k(service, account), secret);
    },
    getSync: (service, account) => map.get(k(service, account)) ?? null,
    deleteSync: (service, account) => {
      map.delete(k(service, account));
    },
  };
}

/** 在临时 provider 根里注册一个 loopback openai-compatible 供应商并设为当前（零真实网络）。 */
function useLoopbackProvider(id: string, baseUrl: string): void {
  fs.writeFileSync(
    path.join(providerRoot, 'providers.json'),
    JSON.stringify([{ id, name: id, protocol: 'openai-compatible', baseUrl, model: 'm' }]),
    'utf8',
  );
  fs.writeFileSync(path.join(providerRoot, 'current.json'), JSON.stringify({ id }), 'utf8');
}

/** CLI 单发命令的统一参数（显式给策略/行为，避免依赖 builtin configs 的解析位置）。 */
const runArgs = (prompt: string, extra: string[] = []): string[] => [
  'run',
  '--workspace',
  ws,
  '--prompt',
  prompt,
  '--policy',
  POLICY,
  '--behavior',
  BEHAVIOR,
  ...extra,
];

describe('BRIEF-16 1C mock 运行期可见性：真实 main()/runChat() 上的判别性断言', () => {
  it('1) CLI 正例（fallback 路径）：空 provider 配置 → stderr 有 mock 提示、stdout 零污染、回复行以标记开头', async () => {
    const cap = capture();
    try {
      const code = await main(runArgs('你好呀'));
      expect(code).toBe(0);

      // ① 提示存在，且走 **stderr**（既不是 stdout，也不是 warn 通道）——1C① 的通道契约
      expect(cap.err()).toContain(MOCK_NOTICE_KEY);
      expect(cap.err()).toContain(MOCK_NOTICE);
      expect(cap.out()).not.toContain(MOCK_NOTICE_KEY);
      expect(cap.warn()).not.toContain(MOCK_NOTICE_KEY);

      // ② 最终回复行以标记**开头**。刻意不用 toContain：fallbackText 自带该串，
      //    toContain 在修复前后都绿（复评点名的零判别力写法）。
      const reply = finalReplyLine(cap);
      expect(reply.startsWith(MOCK_REPLY_MARK)).toBe(true);
      // 阳性控制：确实是 fallback 文案，不是别的分支（本条的判别力仅限通道契约）
      expect(reply).toContain('已收到你的输入');
    } finally {
      cap.restore();
    }
  });

  it('2) 【强判别】CLI 正例：脚本命中回显（Read README）行也以标记开头 —— 修复前必红', async () => {
    fs.writeFileSync(path.join(ws, 'README.md'), '# VIS-README\nMOCK-VIS-GOLDEN-1\n', 'utf8');

    const cap = capture();
    try {
      const code = await main(runArgs('总结当前工作区 README'));
      expect(code).toBe(0);
      expect(cap.err()).toContain(MOCK_NOTICE_KEY);

      const reply = finalReplyLine(cap);
      // 阳性控制一：确实走了「脚本命中回显」分支（`cli.ts` 的脚本命中回显分支），而不是 fallbackText
      expect(reply).toContain('已通过 Read 工具读取工作区文件');
      // 阳性控制二：回显内容真的来自工作区文件（回合不是空转）
      expect(reply).toContain('MOCK-VIS-GOLDEN-1');
      // 判别点：回显文案自身**不带**标记，只有 renderFinalReply 生效才会以标记开头。
      // 删掉 renderFinalReply → 本行 RED（回显整段逐字打印）。
      expect(reply.startsWith(MOCK_REPLY_MARK)).toBe(true);
    } finally {
      cap.restore();
    }
  });

  it('3) 幂等：fallback 与脚本回显两条路径的标记各恰好出现一次（不叠两层）', async () => {
    fs.writeFileSync(path.join(ws, 'README.md'), '# VIS-README\n', 'utf8');

    const cap = capture();
    try {
      // 路径 A：fallbackText 自身就以标记开头 → 出口**不得**再叠一层
      expect(await main(runArgs('你好呀'))).toBe(0);
      const fallback = finalReplyLine(cap);
      expect(fallback.startsWith(MOCK_REPLY_MARK)).toBe(true);
      expect(markCount(fallback)).toBe(1);

      // 路径 B：回显文案不带标记 → 出口恰好加一次（修复前为 0 → RED）
      cap.clear();
      expect(await main(runArgs('总结当前工作区 README'))).toBe(0);
      const echo = finalReplyLine(cap);
      expect(echo).toContain('已通过 Read 工具读取工作区文件');
      expect(markCount(echo)).toBe(1);
    } finally {
      cap.restore();
    }
  });

  it('4) CLI 负对照（真 provider）：loopback 供应商 → 无 mock 提示、回复逐字不加标记', async () => {
    const endpoint = await startLoopback('CLI-VIS-REAL-MARKER');
    try {
      useLoopbackProvider('visreal', endpoint.baseUrl);

      const cap = capture();
      try {
        const code = await main(runArgs('ping'));
        expect(code).toBe(0);
        // 阳性控制：请求真的打到了 loopback（证明临时根里的供应商确实被采用）
        expect(endpoint.seen.length).toBeGreaterThanOrEqual(1);

        // 负对照一：真实 provider 一个字节都不加
        expect(cap.err()).not.toContain(MOCK_NOTICE_KEY);
        expect(cap.err()).not.toContain(MOCK_NOTICE);

        // 负对照二：逐字等值 + 阴性断言（**不用**弱 toContain 阳性断言：
        // 那种写法给真实回复加个 mock 前缀也打断不了）
        const reply = finalReplyLine(cap);
        expect(reply.trim()).toBe('CLI-VIS-REAL-MARKER');
        expect(reply).not.toContain(MOCK_REPLY_MARK);
        expect(cap.out()).not.toContain(MOCK_REPLY_MARK);
      } finally {
        cap.restore();
      }
    } finally {
      await endpoint.close();
    }
  });

  it('5) TUI 正例：空 provider 根 → 提示 + 脚本回显回复行以标记开头（修复前必红）', async () => {
    fs.writeFileSync(path.join(ws, 'README.md'), '# TUI-VIS-README\n', 'utf8');

    const { io, output } = scriptedIO(['总结 README', '/quit']);
    const code = await runChat({
      workspaceRoot: ws,
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      io,
    });

    expect(code).toBe(0);
    // 提示经可注入的 io.write 输出（`chat.ts` 的提示输出处），且与 cli.ts 的常量**逐字同一句**
    expect(output.some((l) => l.includes(MOCK_NOTICE))).toBe(true);
    expect(output.join('\n')).toContain(MOCK_NOTICE_KEY);
    // 每会话一行：本用例只建一次 harness，不得重复刷屏
    expect(output.filter((l) => l.includes(MOCK_NOTICE)).length).toBe(1);

    const reply = tuiReplyLine(output, '（mock）读取结果');
    expect(reply).toContain('# TUI-VIS-README'); // 阳性控制：回显真的来自工作区文件
    // 判别点：TUI 的回显文案自身不带标记，只有 renderTurnReply 生效才会以标记开头
    expect(reply.trimStart().startsWith(MOCK_REPLY_MARK)).toBe(true);
  });

  it('6) TUI 负对照：注入的 provider 与 store 解析出的 loopback 真 provider 都不带标记', async () => {
    // —— 入口 A：`opts.provider` 注入（`chat.ts` 的 `opts.provider` 负对照分支；provider 根为空 → 内置 mock 分支不进）——
    const injected = scriptedIO(['ping', '/quit']);
    const fakeProvider = new MockProvider([{ when: /.*/, response: { text: 'TUI-VIS-INJECTED' } }], { model: 'm' });
    const codeA = await runChat({
      workspaceRoot: ws,
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      io: injected.io,
      provider: fakeProvider,
    });
    expect(codeA).toBe(0);
    const textA = injected.output.join('\n');
    expect(textA).toContain('TUI-VIS-INJECTED'); // 阳性控制：回合真的用了注入的 provider
    expect(textA).not.toContain(MOCK_NOTICE_KEY);
    expect(textA).not.toContain(MOCK_REPLY_MARK);

    // —— 入口 B：store 解析出的真实（loopback）provider（`chat.ts` 的 store 解析分支）——
    const endpoint = await startLoopback('TUI-VIS-REAL-MARKER');
    try {
      useLoopbackProvider('tuisreal', endpoint.baseUrl);

      const real = scriptedIO(['ping', '/quit']);
      const codeB = await runChat({
        workspaceRoot: ws,
        policySystemPath: POLICY,
        behaviorIRPath: BEHAVIOR,
        io: real.io,
        credentialStore: memoryCredentialStore(),
      });
      expect(codeB).toBe(0);
      expect(endpoint.seen.length).toBeGreaterThanOrEqual(1);

      const reply = tuiReplyLine(real.output, 'TUI-VIS-REAL-MARKER');
      expect(reply.length).toBeGreaterThan(0);
      expect(reply).not.toContain(MOCK_REPLY_MARK); // 真实 provider 回复逐字不加
      const textB = real.output.join('\n');
      expect(textB).not.toContain(MOCK_NOTICE_KEY);
      expect(textB).not.toContain(MOCK_REPLY_MARK);
    } finally {
      await endpoint.close();
    }
  });

  it('7) AC2 已知边界：mock 空回复（无 finalText）走 (无文本回复)，**不带**标记（如实断言，不放宽）', async () => {
    fs.writeFileSync(path.join(ws, 'README.md'), '# VIS-README\n', 'utf8');

    const cap = capture();
    try {
      // `--max-steps 1`：脚本第一步（/总结/ → ifNoToolResult）发 Read 工具调用，
      // 工具执行完 snapshot.steps(1) >= maxSteps(1) → AgentLoop.ts:314-317 置 kind='budget'、
      // finalText 保持 ''（finalText 只在「纯文本即停」分支被赋值，AgentLoop.ts:273）。
      // 全程是**真实内置 mock** 路径（下行的 usingMockProvider=true 由提示行证明）。
      const code = await main(runArgs('总结当前工作区 README', ['--max-steps', '1']));
      expect(code).toBe(0);
      expect(cap.err()).toContain(MOCK_NOTICE_KEY); // 这次确实用着内置 mock
      expect(cap.out()).toContain('kind=budget'); // 且确实停在「工具调用后没有最终文本」这条路径

      const reply = finalReplyLine(cap);
      // 已知边界（EVALUATION-REPORT-22 指出）：renderFinalReply 的 `if (!finalText)` 分支
      // 在 mock 判定**之前**就返回（`renderFinalReply` 的早退），所以空回复不带标记。这里如实锁住现状：
      // 不为了让断言变绿而放宽，也不改实现把它改成带标记（那是另一个决策，需独立验收）。
      expect(reply).toBe('(无文本回复)');
      expect(reply).not.toContain(MOCK_REPLY_MARK);
      expect(markCount(cap.out())).toBe(0); // 整个 stdout 一个标记都没有
    } finally {
      cap.restore();
    }
  });
});

/**
 * 静态守卫（task 131）：mock 文案与标记只有**一份实现**。
 *
 * 改前 `cli.ts`（`MOCK_PROVIDER_NOTICE` / `MOCK_REPLY_MARK` / `fallbackText`）与 `tui/chat.ts`
 * （`TUI_*` 同款）各写一份、只差变量名，注释自称"必须逐字同步"但全仓无测试绑定。此用例断言：
 * 两侧都**不再本地定义**这些常量，且都从叶子模块 `turnText.ts` import 同一份。
 * （改回内联 ⇒ 本用例红。）
 */
describe('mock 文案唯一实现（静态守卫）', () => {
  const srcRoot = fileURLToPath(new URL('.', import.meta.url)); // apps/cli/src
  const read = (rel: string): string => fs.readFileSync(path.join(srcRoot, rel), 'utf8');
  const cliSrc = read('cli.ts');
  const chatSrc = read('tui/chat.ts');
  const turnSrc = read('turnText.ts');

  it('两面都不再本地定义 mock 文案/标记，改从 turnText.ts import', () => {
    const localDef = /const\s+(?:TUI_)?MOCK_(?:REPLY_MARK|PROVIDER_NOTICE)\s*=/;
    expect(cliSrc).not.toMatch(localDef);
    expect(chatSrc).not.toMatch(localDef);
    expect(cliSrc).toMatch(/import\s*\{[^}]*\bapplyMockReplyMark\b[^}]*\}\s*from\s*'\.\/turnText\.js'/);
    expect(chatSrc).toMatch(/import\s*\{[^}]*\bapplyMockReplyMark\b[^}]*\}\s*from\s*'\.\.\/turnText\.js'/);
  });

  it('唯一实现（含渲染助手）在 turnText.ts', () => {
    expect(turnSrc).toMatch(/export\s+const\s+MOCK_REPLY_MARK\s*=/);
    expect(turnSrc).toMatch(/export\s+const\s+MOCK_PROVIDER_NOTICE\s*=/);
    expect(turnSrc).toMatch(/export\s+const\s+MOCK_FALLBACK_TEXT\s*=/);
    expect(turnSrc).toMatch(/export\s+function\s+applyMockReplyMark\b/);
    // 叶子模块仍零 import（否则"共用"会重新引入 cli.ts ↔ tui/chat.ts 成环）
    expect(turnSrc).not.toMatch(/^(?!\s*\*)\s*import\b/m);
  });
});
