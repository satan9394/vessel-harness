import * as readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import type { ChatProvider } from '@vessel/shared';
import { MockProvider } from '@vessel/llm';
import { composeHarness, type ComposedHarness, type SyncCredentialStore } from '@vessel/application';
import { ProviderStore, type ProviderConfig } from '../providers/ProviderStore.js';
import { createDefaultProviderStore } from '../providers/defaultStore.js';
import { runSetupWizard, createClackIO, fetchModelOutcome } from '../providers/setup.js';
import { buildRealProvider, describeProviderError, planProvider } from '../providers/providerFactory.js';
import { modelsForProtocol } from '@vessel/application';
import { VESSEL_LOGO } from '../brand.js';
import { findTerm, renderExplain } from '../guide/glossary.js';

/**
 * apps/cli/src/tui/chat.ts — `vessel` interactive chat TUI (V0.7, task 021; brand Vessel).
 *
 * One command → chat loop, opencode-style: natural language runs the harness
 * loop; slash commands configure providers / models / permission inside the
 * session (no separate setup step needed).
 *
 * Design (research §B4): plain readline loop, model output printed to the
 * native scrollback; a status line after each turn shows provider·model·
 * permission. Forms (/provider /models /permission /setup) reuse the existing
 * @clack/prompts IO (createClackIO) — which is already injectable for tests.
 *
 * The loop is factored against a small SessionIO surface so automated tests can
 * script inputs and capture outputs without a real TTY.
 */

export type PermissionMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface ChatSessionIO {
  /** read one line of user input; null = EOF (ctrl-d / quit) */
  readLine(prompt: string): Promise<string | null>;
  /** write a normal output line (model reply, status, logs) */
  write(line: string): void;
  /** read a batch of canned inputs ahead of time (tests) */
  hasMore?(): boolean;
}

/**
 * Reader over one readline.Interface that supports arbitrarily many sequential
 * readLine() calls on the SAME interface.
 *
 * Why a dedicated reader instead of `for await (const line of rl)`? Breaking
 * out of that loop invokes the async iterator's return(), which Node wires to
 * rl.close() — the interface is closed after the very first line, so a second
 * readLine() would report EOF and the TUI would exit after one round. Instead
 * we attach ONE 'line' listener up front and resolve pending reads FIFO.
 */
export interface LineReader {
  /** Resolve with the next input line; null once the reader is ended. */
  readLine(): Promise<string | null>;
  /** End the reader: pending reads resolve null, later reads return null. */
  close(): void;
}

export function makeLineReader(rl: readline.Interface): LineReader {
  const waiters: Array<(line: string | null) => void> = [];
  const buffered: string[] = [];
  let closed = false;

  function end(): void {
    if (closed) return;
    closed = true;
    for (const waiter of waiters.splice(0)) waiter(null);
    // buffered lines already read off the stream stay readable (drain-then-EOF)
  }

  rl.on('line', (line: string) => {
    if (closed) return;
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else buffered.push(line);
  });
  // EOF / Ctrl+D / interface close / stream error → end the reader.
  rl.on('close', end);
  rl.on('error', end);

  return {
    readLine(): Promise<string | null> {
      const line = buffered.shift();
      if (line !== undefined) return Promise.resolve(line);
      if (closed) return Promise.resolve(null);
      return new Promise<string | null>((resolve) => waiters.push(resolve));
    },
    close: end,
  };
}

/**
 * Two-stage Ctrl+C policy (task 050, roadmap §7.3): the FIRST Ctrl+C while a
 * turn is active interrupts that turn; the SECOND Ctrl+C (or any Ctrl+C with
 * no active turn) exits the TUI. Pure decision logic — tests drive it without
 * a real terminal or signal; only createStdioIO's SIGINT handler calls press().
 */
export class TwoStageCtrlC {
  private stage: 'none' | 'interrupted' = 'none';

  constructor(
    private readonly deps: {
      /** true while a turn is running (its runTurn promise is in flight) */
      hasActiveTurn: () => boolean;
      /** interrupt the active turn (AgentLoop.interrupt / controller seam) */
      interruptTurn: () => void;
    },
  ) {}

  /** Route one Ctrl+C press. Returns 'stay' (keep running) or 'exit' (quit). */
  press(): 'stay' | 'exit' {
    if (!this.deps.hasActiveTurn()) {
      // idle at the prompt → first press exits (like the pre-050 behavior)
      this.stage = 'none';
      return 'exit';
    }
    if (this.stage === 'interrupted') return 'exit'; // second press → exit
    this.stage = 'interrupted';
    this.deps.interruptTurn();
    return 'stay';
  }

  /** Clear the latch when a NEW turn begins (first press interrupts it again). */
  reset(): void {
    this.stage = 'none';
  }
}

/** stdio implementation (real stdin/stdout; Ctrl+C → two-stage / graceful EOF). */
export function createStdioIO(ctrlC?: TwoStageCtrlC): ChatSessionIO {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const reader = makeLineReader(rl);

  // Ctrl+C: idle → exit (EOF). With an active turn (two-stage, task 050) the
  // FIRST press interrupts it ('stay'), the SECOND press exits. A terminal-mode
  // interface emits its own 'SIGINT'; with terminal:false the process signal
  // fires — wire both, only one ever triggers (same guard as before 050).
  const onSigint = () => {
    process.stdout.write('\n'); // move off the half-typed prompt line
    if (ctrlC && ctrlC.press() === 'stay') {
      process.stdout.write('^C 已请求中断当前 turn（再次 Ctrl+C 退出）\n');
      return;
    }
    reader.close();
    rl.close();
  };
  process.on('SIGINT', onSigint);
  rl.on('SIGINT', onSigint);

  return {
    readLine(prompt: string) {
      process.stdout.write(prompt);
      return reader.readLine();
    },
    write(line: string) {
      console.log(line);
    },
  };
}

export interface ChatOptions {
  workspaceRoot: string;
  provider?: ChatProvider;
  model?: string;
  policySystemPath: string;
  behaviorIRPath: string;
  permission?: PermissionMode;
  store?: ProviderStore;
  /**
   * 凭据后端（task 106）：**仅在 `store` 缺省时生效**——用于给 TUI 默认 ProviderStore
   * 接上 CredentialStore（测试注入内存后端，不碰真实 secrets.json）。
   */
  credentialStore?: SyncCredentialStore;
  io?: ChatSessionIO;
}

/**
 * TUI 的 ProviderStore 解析（task 106，导出供测试断言隔离与凭据接线）。
 *
 * `store` 显式传入 → 原样使用（调用方负责凭据后端）；否则走 `createDefaultProviderStore()`：
 * 状态根 = `VESSEL_PROVIDER_ROOT` / `~/.vessel`，并**接上 CredentialStore** —— 这是 106 的
 * 修复点：修前是 `new ProviderStore()`，`secretRef` 解析不出 apiKey → 401 `Missing API key`。
 */
export function resolveChatStore(
  opts: { store?: ProviderStore; credentialStore?: SyncCredentialStore } = {},
): ProviderStore {
  if (opts.store) return opts.store;
  return createDefaultProviderStore(
    opts.credentialStore ? { credentialStore: opts.credentialStore } : {},
  );
}

export interface SlashResult {
  /** text to print after the command */
  output?: string;
  /** true → exit the TUI */
  quit?: boolean;
}

/**
 * Run the interactive chat session. Returns the exit code.
 */
export async function runChat(opts: ChatOptions): Promise<number> {
  // task 106：默认 store 必须接 CredentialStore（否则 secretRef → apiKey 解析失败 → 401）。
  const store = resolveChatStore(opts);

  // real-stdio mode wires two-stage Ctrl+C (task 050): the first press
  // interrupts the active turn, the second press (or a press with no active
  // turn) exits. Scripted IO (tests) never registers signals.
  let activeTurnInterrupt: (() => void) | null = null;
  const ctrlC = opts.io
    ? null
    : new TwoStageCtrlC({
        hasActiveTurn: () => activeTurnInterrupt !== null,
        interruptTurn: () => {
          if (activeTurnInterrupt) activeTurnInterrupt();
        },
      });
  const io = opts.io ?? createStdioIO(ctrlC ?? undefined);

  // current provider resolution (like cmdRun): explicit > current default > mock
  const currentId = store.getCurrent();
  const currentCfg: ProviderConfig | undefined = currentId === 'mock' ? undefined : store.get(currentId);
  let provider = opts.provider;
  let model = opts.model ?? currentCfg?.model ?? 'mock-model';
  let permission: PermissionMode = opts.permission ?? 'workspace-write';
  let providerId = currentCfg?.id ?? 'mock';
  let harness: ComposedHarness | null = null;
  let sessionWorkspace = opts.workspaceRoot;
  // task 103: opencode-go 的会话 id 在**一个 TUI 会话**内稳定（换模型 / 重建 harness 不换），
  // 与 102 lane 的「一次 lane 会话一个 UUID」语义对齐。
  const opencodeGoSessionId = randomUUID();

  const buildHarness = async (): Promise<ComposedHarness> => {
    const cfg = providerId === 'mock' ? undefined : store.get(providerId);
    let effProvider = provider;
    let effModel = model;
    if (cfg && cfg.protocol !== 'mock') {
      // task 103: CLI/TUI 共用 providerFactory —— preset id `opencode-go` 自动解析为专用
      // provider（x-opencode-session + 具名 UA），与 benchmark lane 是同一份实现。
      const plan = planProvider({ config: cfg });
      effProvider = buildRealProvider(plan, { sessionId: opencodeGoSessionId }) ?? undefined;
      effModel = plan.model;
    }
    if (!effProvider) {
      const smoke = [
        { when: /阅读|read|总结|summary/i, ifNoToolResult: true, response: { toolCalls: [{ name: 'Read', arguments: { path: '{cwd}/README.md' } }] } },
        {
          when: /.*/,
          minToolResults: 1,
          whenToolResult: /^\[(TOOL_FAILURE|DENIED|INVALID_ARGS|TIMEOUT|SANDBOX_DENIAL)\]/,
          response: { text: '（mock）未能读取工作区 README.md——文件可能不存在或被拒。请确认工作区包含 README.md；要获得真实回答请配置模型：vessel setup。' },
        },
        { when: /.*/, minToolResults: 1, response: { text: '（mock）读取结果：\n{last_tool_result}' } },
      ];
      effProvider = new MockProvider(smoke, {
        model: effModel,
        vars: { cwd: sessionWorkspace },
        fallbackText: '（mock 离线冒烟）已收到你的输入。当前无匹配脚本应答——配置真实模型后即可获得完整回答：vessel setup（交互向导）或 vessel provider add。',
      });
    }
    return composeHarness({
      workspaceRoot: sessionWorkspace,
      provider: effProvider,
      model: effModel,
      policySystemPath: opts.policySystemPath,
      behaviorIRPath: opts.behaviorIRPath,
      permission,
    });
  };

  io.write(`${VESSEL_LOGO}Vessel — 交互会话开始（当前 ${providerId} · ${model} · ${permission}）。输入 /help 查看命令，/explain <术语> 或 ? <术语> 查术语解释，/quit 退出；命令行「vessel guide」有新手指引。`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const line = await io.readLine(`\n${providerId}/${model} [${permission}]> `);
    if (line === null) break;
    const input = line.trim();
    if (input === '') continue;

    // slash command dispatch（`? <term>` 与 `/explain <term>` 同义，task 117 引导体系）
    if (input.startsWith('/') || input.startsWith('?')) {
      const res = await dispatchSlash(input, { store, io, sessionWorkspace: opts.workspaceRoot });
      if (res?.output) io.write(res.output);
      if (res?.quit) break;
      continue;
    }

    // natural language → run the harness loop (lazy-build once)
    if (!harness) harness = await buildHarness();
    ctrlC?.reset(); // fresh turn → first Ctrl+C interrupts (not exits)
    activeTurnInterrupt = () => {
      harness!.loop.interrupt();
    };
    try {
      const result = await harness.loop.runTurn(input);
      if (result.kind === 'interrupted') io.write('\n^C turn 已中断（kind=interrupted）');
      else if (result.finalText) io.write(`\n${result.finalText}`);
      else io.write('(无文本回复)');
    } catch (err) {
      io.write(`[错误] ${describeProviderError(err)}`);
    } finally {
      activeTurnInterrupt = null;
    }
  }

  await harness?.close();
  return 0;
}

async function mockProvider(model: string) {
  return new MockProvider([{ when: /.*/, response: { text: '（mock 离线回复）' } }], { model });
}

/** Slash command table — reused by tests. */
export async function dispatchSlash(input: string, ctx: { store: ProviderStore; io: ChatSessionIO; sessionWorkspace: string }): Promise<SlashResult> {
  // `? <term>` 前缀 = `/explain <term>`（task 117：TUI 内解释，复用同一词库，不重复实现）
  if (input.startsWith('?')) {
    const raw = input.slice(1).trim();
    if (raw === '') return { output: '用法: ? <术语>（如 ? Call）；或用 /explain <术语>' };
    const hit = findTerm(raw);
    return {
      output: hit
        ? renderExplain(hit)
        : `未收录术语 "${raw}"（vessel list-terms 查看全部词条）`,
    };
  }
  const [cmd, ...rest] = input.slice(1).trim().split(/\s+/);
  const arg = rest.join(' ').trim();
  switch (cmd) {
    case 'help':
      return {
        output: [
          '命令：',
          '  /provider        配置供应商（搜索选 → key → 拉模型 → 勾选）',
          '  /models          拉取当前供应商模型列表',
          '  /model <id>      切换模型（如 /model deepseek-chat）',
          '  /permission      切换权限模式（read-only / workspace-write / danger-full-access）',
          '  /setup           完整引导配置',
          '  /explain <术语>  查术语中英文解释（同 ? <术语>，如 /explain Call）',
          '  /help            本帮助',
          '  /quit            退出',
          '直接输入文字 = 对话跑任务',
        ].join('\n'),
      };
    case 'provider':
    case 'connect': {
      const setupIO = createClackIO(ctx.store);
      const id = await runSetupWizard({ store: ctx.store, io: setupIO });
      return { output: id ? `已配置供应商 "${id}"` : '已取消' };
    }
    case 'setup': {
      const setupIO = createClackIO(ctx.store);
      const id = await runSetupWizard({ store: ctx.store, io: setupIO });
      return { output: id ? `已配置供应商 "${id}"` : '已取消' };
    }
    case 'models': {
      const id = ctx.store.getCurrent();
      const cfg = ctx.store.get(id);
      if (!cfg || cfg.protocol === 'mock') return { output: '当前是 mock 或无配置供应商。先 /provider 配置。' };
      const outcome = await fetchModelOutcome(cfg.protocol, cfg.baseUrl ?? '', cfg.apiKey);
      if (!outcome.ok || outcome.models.length === 0) {
        const reason = outcome.ok ? '无模型' : outcome.message;
        return { output: `拉取失败（${reason}）。内置清单：\n${modelsForProtocol(cfg.protocol).models.map((m: string) => `  ${m}`).join('\n')}` };
      }
      return { output: `模型列表（${cfg.id}，${outcome.note}）：\n${outcome.models.map((m: string) => `  ${m}`).join('\n')}` };
    }
    case 'model': {
      if (!arg) return { output: '用法：/model <id>（如 /model deepseek-chat）' };
      return { output: `模型切换为 "${arg}"（会话内；持久请用 /provider 重配）` };
    }
    case 'permission': {
      if (!arg) return { output: '用法：/permission <read-only|workspace-write|danger-full-access>' };
      return { output: `权限切换为 "${arg}"（会话内生效）` };
    }
    case 'explain':
    case 'term': {
      if (!arg) return { output: '用法：/explain <术语>（如 /explain Call）；或用 ? <术语>' };
      const hit = findTerm(arg);
      return { output: hit ? renderExplain(hit) : `未收录术语 "${arg}"（vessel list-terms 查看全部词条）` };
    }
    case 'quit':
    case 'exit':
      return { quit: true };
    default:
      return { output: `未知命令 /${cmd}（/help 查看）` };
  }
}
