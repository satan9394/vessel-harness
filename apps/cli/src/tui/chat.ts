import * as readline from 'node:readline';
import type { ChatProvider } from '@cah/shared';
import { createProvider, MockProvider } from '@cah/llm';
import { composeHarness, type ComposedHarness } from '../compose.js';
import { ProviderStore, type ProviderConfig } from '../providers/ProviderStore.js';
import { runSetupWizard, createClackIO, fetchModelOutcome } from '../providers/setup.js';
import { modelsForProtocol } from '../providers/modelFetcher.js';

/**
 * apps/cli/src/tui/chat.ts — `cah` interactive chat TUI (V0.7, task 021).
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

/** stdio implementation. */
export function createStdioIO(): ChatSessionIO {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const queue: string[] = [];
  return {
    async readLine(prompt: string) {
      process.stdout.write(prompt);
      if (queue.length > 0) return queue.shift() ?? null;
      for await (const line of rl) {
        return line;
      }
      return null;
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
  io?: ChatSessionIO;
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
  const store = opts.store ?? new ProviderStore();
  const io = opts.io ?? createStdioIO();

  // current provider resolution (like cmdRun): explicit > current default > mock
  const currentId = store.getCurrent();
  const currentCfg: ProviderConfig | undefined = currentId === 'mock' ? undefined : store.get(currentId);
  let provider = opts.provider;
  let model = opts.model ?? currentCfg?.model ?? 'mock-model';
  let permission: PermissionMode = opts.permission ?? 'workspace-write';
  let providerId = currentCfg?.id ?? 'mock';
  let harness: ComposedHarness | null = null;
  let sessionWorkspace = opts.workspaceRoot;

  const buildHarness = async (): Promise<ComposedHarness> => {
    const cfg = providerId === 'mock' ? undefined : store.get(providerId);
    let effProvider = provider;
    let effModel = model;
    if (cfg && cfg.protocol !== 'mock') {
      effProvider = createProvider(cfg.protocol, { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model });
      effModel = cfg.model;
    }
    if (!effProvider) {
      const smoke = [
        { when: /阅读|read|总结/i, ifNoToolResult: true, response: { toolCalls: [{ name: 'Read', arguments: { path: '{cwd}/README.md' } }] } },
        { when: /.*/, minToolResults: 1, response: { text: '（mock）读取结果：\n{last_tool_result}' } },
      ];
      effProvider = new MockProvider(smoke, { model: effModel, vars: { cwd: sessionWorkspace } });
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

  io.write(`cah — 交互会话开始（当前 ${providerId} · ${model} · ${permission}）。输入 /help 查看命令，/quit 退出。`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const line = await io.readLine(`\n${providerId}/${model} [${permission}]> `);
    if (line === null) break;
    const input = line.trim();
    if (input === '') continue;

    // slash command dispatch
    if (input.startsWith('/')) {
      const res = await dispatchSlash(input, { store, io, sessionWorkspace: opts.workspaceRoot });
      if (res?.output) io.write(res.output);
      if (res?.quit) break;
      continue;
    }

    // natural language → run the harness loop (lazy-build once)
    if (!harness) harness = await buildHarness();
    try {
      const result = await harness.loop.runTurn(input);
      if (result.finalText) io.write(`\n${result.finalText}`);
      else io.write('(无文本回复)');
    } catch (err) {
      io.write(`[错误] ${(err as Error).message}`);
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
    case 'quit':
    case 'exit':
      return { quit: true };
    default:
      return { output: `未知命令 /${cmd}（/help 查看）` };
  }
}
