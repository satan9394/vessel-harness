#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { VERSION } from '@cah/shared';
import { MockProvider, createProvider } from '@cah/llm';
import { composeHarness } from './compose.js';
import { ProviderStore, type ProviderConfig } from './providers/ProviderStore.js';
import { fetchOpenAIModels, modelsForProtocol } from './providers/modelFetcher.js';
import { createClackIO, runSetupWizard } from './providers/setup.js';
import { runChat } from './tui/chat.js';

const USAGE = `Composable Agent Harness CLI (V0.1)

用法:
  cah --help                      显示本帮助
  cah --version                   显示版本
  cah run [选项]                  单发模式：跑一轮用户输入
  cah run --bench <scenarioId>    基准模式：运行 benchmarks/ 场景并产出 JSONL 报告
  cah models [--provider p]       列出某供应商可用模型（OpenAI 兼容实时拉取 / Anthropic 内置清单）
  cah setup                       交互向导：搜索选供应商 → 输 key → 拉模型 → 空格勾选 → 提交
  cah provider list               列出所有供应商（* = 当前默认）
  cah provider current            显示当前默认供应商
  cah provider add <id> --protocol <p> --model <m> [--base-url] [--api-key]   添加供应商
  cah provider remove <id>        删除供应商
  cah provider switch|use <id>    切换当前默认供应商

run 选项:
  --prompt <text>                 用户输入（缺省从 stdin 读取）
  --workspace <dir>               工作区（默认当前目录）
  --provider <mock|openai-compatible|anthropic>   模型提供方（默认 mock）
  --model <name>                  模型名（OpenAI/Anthropic 协议需指定，或 CAH_MODEL）
  --base-url <url>                端点：openai-compatible 用 {base}/chat/completions，
                                  anthropic 用 {base}/v1/messages（或 CAH_BASE_URL）
  --api-key <key>                 API 密钥（或 CAH_API_KEY；本地端点可不填）
  --max-steps <n>                 单轮步数上限（默认 64）
  --permission <mode>             权限模式：read-only（只读探索）| workspace-write（默认，写工作区）|
                                  danger-full-access（全权限，高危可执行）
  --policy <path>                 系统级策略文件（默认 configs/policy.default.yaml）
  --behavior <path>               Behavior IR 文件（默认 configs/behavior.default.yaml）
  --session-dir <dir>             会话日志目录（默认 <workspace>/.harness/sessions/<id>）

provider 协议说明:
  openai-compatible    OpenAI chat/completions 协议：OpenAI / DeepSeek / Qwen / vLLM / Ollama 等
  anthropic            Anthropic Messages API 协议：Anthropic Claude 及兼容端点
  mock                 确定性离线脚本（测试 / 冒烟，不发网络请求）
`;

interface ParsedArgs {
  command: 'help' | 'version' | 'run';
  flags: Map<string, string>;
  positionals: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string>();
  const positionals: string[] = [];
  let command: ParsedArgs['command'] = 'run';
  let i = 0;
  while (i < argv.length) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') return { command: 'help', flags, positionals };
    if (a === '--version' || a === '-v') return { command: 'version', flags, positionals };
    if (a === 'run') { command = 'run'; i += 1; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val !== undefined && !val.startsWith('--')) {
        flags.set(key, val);
        i += 2;
      } else {
        flags.set(key, 'true');
        i += 1;
      }
      continue;
    }
    positionals.push(a);
    i += 1;
  }
  return { command, flags, positionals };
}

function repoRoot(): string {
  // workspace root of this repo = the harness project root (contains configs/)
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'configs', 'policy.default.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

async function cmdRun(flags: Map<string, string>): Promise<number> {
  const workspace = path.resolve(flags.get('workspace') ?? process.cwd());
  const root = repoRoot();
  const prompt = flags.get('prompt') ?? (process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8').trim());

  // provider resolution: explicit --provider wins; else the current default
  // provider from ~/.dsh (provider switch); else mock with a hint.
  const store = new ProviderStore();
  const explicitProvider = flags.get('provider');
  const currentId = explicitProvider ?? (store.getCurrent() !== 'mock' ? store.getCurrent() : 'mock');
  const currentCfg: ProviderConfig | undefined = currentId === 'mock' ? undefined : store.get(currentId);
  const providerName = explicitProvider ?? currentCfg?.protocol ?? 'mock';
  const model = flags.get('model') ?? process.env.CAH_MODEL ?? currentCfg?.model ?? 'mock-model';
  const baseUrl = flags.get('base-url') ?? process.env.CAH_BASE_URL ?? currentCfg?.baseUrl;
  const apiKey = flags.get('api-key') ?? process.env.CAH_API_KEY ?? currentCfg?.apiKey;
  let provider;
  if (providerName === 'openai-compatible' || providerName === 'anthropic') {
    if (!baseUrl) {
      console.error(`[cah] ${providerName} 需要 --base-url 或 CAH_BASE_URL（或先 cah provider add 配置）`);
      return 2;
    }
    provider = createProvider(providerName, { baseUrl, apiKey, model });
  } else {
    // default smoke script: read README.md (if prompt asks) then answer from the result
    const smokeScript = [
      {
        when: /阅读|read|总结|summary/i,
        ifNoToolResult: true,
        response: { toolCalls: [{ name: 'Read', arguments: { path: '{cwd}/README.md' } }] },
      },
      { when: /.*/, minToolResults: 1, response: { text: '已通过 Read 工具读取工作区文件。内容开头：\n{last_tool_result}' } },
    ];
    provider = new MockProvider(smokeScript, { model, vars: { cwd: workspace } });
  }

  const harness = await composeHarness({
    workspaceRoot: workspace,
    provider,
    model,
    policySystemPath: flags.get('policy') ?? path.join(root, 'configs', 'policy.default.yaml'),
    behaviorIRPath: flags.get('behavior') ?? path.join(root, 'configs', 'behavior.default.yaml'),
    maxSteps: Number(flags.get('max-steps') ?? 64),
    permission: (flags.get('permission') ?? 'workspace-write') as 'read-only' | 'workspace-write' | 'danger-full-access',
  });

  for (const w of harness.behaviorWarnings) console.warn(`[behavior] ${w}`);

  try {
    const result = await harness.loop.runTurn(prompt || '（无输入）');
    console.log('\n=== 最终回复 ===');
    console.log(result.finalText || '(无文本回复)');
    console.log(`\n=== turn ${result.turnId} kind=${result.kind} steps=${result.steps} toolCalls=${result.toolCalls} ===`);
    const denials = harness.session.replay().filter((r) => r.type === 'audit/denial');
    if (denials.length > 0) {
      console.log(`\n=== 策略拦截审计 (audit/denial × ${denials.length}) ===`);
      for (const d of denials) {
        console.log(`  - ${(d as { toolName: string }).toolName} ${(d as { reason: string }).reason} [ref=${(d as { ruleRef?: string }).ruleRef}]`);
      }
    }
    console.log(`会话日志: ${harness.session.logPath}`);
    return 0;
  } catch (err) {
    console.error(`[cah] run failed: ${(err as Error).message}`);
    return 1;
  } finally {
    await harness.close();
  }
}

async function cmdBench(flags: Map<string, string>): Promise<number> {
  const scenarioId = flags.get('bench');
  if (!scenarioId) {
    console.error('[cah] run --bench 需要 scenarioId（如 B001）');
    return 2;
  }
  const { runScenario } = await import('@cah/bench-runners');
  const workspace = path.resolve(flags.get('workspace') ?? process.cwd());
  const outDir = path.resolve(flags.get('out') ?? path.join(workspace, 'benchmarks', 'reports'));
  const providerName = flags.get('provider') ?? 'mock';
  const model = flags.get('model') ?? process.env.CAH_MODEL ?? 'mock-model';
  const provider =
    providerName === 'openai-compatible' || providerName === 'anthropic'
      ? createProvider(providerName, {
          baseUrl: flags.get('base-url') ?? process.env.CAH_BASE_URL ?? '',
          apiKey: flags.get('api-key') ?? process.env.CAH_API_KEY,
          model,
        })
      : null;
  const root = repoRoot();
  const report = await runScenario({
    scenarioId,
    repoRoot: root,
    reportsDir: outDir,
    provider,
    model,
    policyPath: path.join(root, 'configs', 'policy.default.yaml'),
    behaviorIRPath: path.join(root, 'configs', 'behavior.default.yaml'),
  });
  console.log(`\n=== benchmark ${report.scenarioId} ${report.success ? 'PASS' : 'FAIL'} (${report.durationMs}ms) ===`);
  for (const a of report.asserts) {
    console.log(`  [${a.result.toUpperCase()}] ${a.type}: ${a.target}`);
  }
  console.log(`报告: ${report.reportPath}`);
  return report.success ? 0 : 1;
}

/** `cah models [--provider p]` — list a provider's available models. */
async function cmdModels(flags: Map<string, string>): Promise<number> {
  const store = new ProviderStore();
  const id = flags.get('provider') ?? store.getCurrent();
  const cfg = store.get(id);
  if (!cfg) {
    console.error(`[cah] provider "${id}" 不存在（cah provider list 查看；cah provider add 添加）`);
    return 2;
  }
  if (cfg.protocol === 'mock') {
    console.log('(mock provider 是离线的，无模型列表)');
    return 0;
  }
  if (cfg.protocol === 'openai-compatible' && cfg.baseUrl) {
    try {
      const src = await fetchOpenAIModels(cfg.baseUrl, cfg.apiKey);
      console.log(`模型列表（${src.origin === 'live' ? '实时拉取' : src.note}）：`);
      for (const m of src.models) console.log(`  ${m}`);
      return 0;
    } catch (err) {
      console.error(`[cah] ${(err as Error).message}`);
      console.error('提示：可先用内置清单，或确认 base-url/api-key 正确。');
      return 1;
    }
  }
  // anthropic (no live enumeration) or openai-compatible without baseUrl
  const src = modelsForProtocol(cfg.protocol);
  console.log(src.note ? `模型列表（${src.note}）：` : '模型列表：');
  for (const m of src.models) console.log(`  ${m}`);
  return 0;
}

/** `cah provider <list|add|remove|switch|use|current> [...]` — manage providers. */
async function cmdProvider(args: string[], flags: Map<string, string>): Promise<number> {
  const store = new ProviderStore();
  const sub = args[0] ?? 'list';
  switch (sub) {
    case 'list': {
      const current = store.getCurrent();
      for (const p of store.list()) {
        const mark = p.id === current ? ' *' : '';
        const protocol = p.protocol === 'mock' ? '' : ` [${p.protocol}]`;
        console.log(`  ${p.id}${mark}${protocol}  ${p.name} (model: ${p.model})`);
      }
      return 0;
    }
    case 'current': {
      console.log(store.getCurrent());
      return 0;
    }
    case 'add': {
      const id = args[1];
      if (!id) {
        console.error('用法: cah provider add <id> --protocol <mock|openai-compatible|anthropic> [--base-url <url>] [--api-key <key>] --model <model> [--name <显示名>]');
        return 2;
      }
      const protocol = flags.get('protocol') as ProviderConfig['protocol'] | undefined;
      const model = flags.get('model');
      const cfg: ProviderConfig = {
        id,
        name: flags.get('name') ?? id,
        protocol: protocol ?? 'openai-compatible',
        baseUrl: flags.get('base-url'),
        apiKey: flags.get('api-key'),
        model: model ?? 'mock-model',
        note: flags.get('note'),
      };
      if ((cfg.protocol === 'openai-compatible' || cfg.protocol === 'anthropic') && !cfg.baseUrl) {
        console.error(`[cah] ${cfg.protocol} 需要 --base-url`);
        return 2;
      }
      try {
        store.add(cfg);
        console.log(`已添加 provider "${id}"（protocol=${cfg.protocol}, model=${cfg.model}）`);
        return 0;
      } catch (err) {
        console.error(`[cah] ${(err as Error).message}`);
        return 1;
      }
    }
    case 'remove': {
      const id = args[1];
      if (!id) {
        console.error('用法: cah provider remove <id>');
        return 2;
      }
      try {
        store.remove(id);
        console.log(`已移除 provider "${id}"`);
        return 0;
      } catch (err) {
        console.error(`[cah] ${(err as Error).message}`);
        return 1;
      }
    }
    case 'switch':
    case 'use': {
      const id = args[1];
      if (!id) {
        console.error(`用法: cah provider ${sub} <id>`);
        return 2;
      }
      try {
        store.setCurrent(id);
        console.log(`已切换到 provider "${id}"`);
        return 0;
      } catch (err) {
        console.error(`[cah] ${(err as Error).message}`);
        return 1;
      }
    }
    default: {
      console.error(`[cah] 未知 provider 子命令 "${sub}"（可用: list/add/remove/switch/use/current）`);
      return 2;
    }
  }
}

/** `cah setup` — interactive guided provider wizard (cc-switch-style UX). */
async function cmdSetup(_flags: Map<string, string>): Promise<number> {
  if (!process.stdin.isTTY) {
    console.log('cah setup 需要交互终端。非交互环境请用：cah provider add <id> --protocol <p> --base-url <url> --api-key <key> --model <model>');
    return 2;
  }
  const store = new ProviderStore();
  const io = createClackIO(store);
  const id = await runSetupWizard({ store, io });
  if (id) {
    console.log(`\n✔ 已保存供应商 "${id}"。用 cah run 开始（或 cah provider switch 切换）。`);
    return 0;
  }
  console.log('已取消，未做任何修改。');
  return 1;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  // subcommand forms: `cah provider <sub>`, `cah models`
  const first = parsed.positionals[0];
  if (first === 'provider') return cmdProvider(parsed.positionals.slice(1), parsed.flags);
  if (first === 'models') return cmdModels(parsed.flags);
  if (first === 'setup') return cmdSetup(parsed.flags);
  // bare `cah` (no subcommand): interactive TUI in a TTY; guide otherwise.
  if (first === undefined && parsed.command === 'run' && !parsed.flags.has('bench')) {
    if (!parsed.flags.has('prompt') && process.stdin.isTTY) {
      const root = repoRoot();
      return runChat({
        workspaceRoot: path.resolve(parsed.flags.get('workspace') ?? process.cwd()),
        policySystemPath: parsed.flags.get('policy') ?? path.join(root, 'configs', 'policy.default.yaml'),
        behaviorIRPath: parsed.flags.get('behavior') ?? path.join(root, 'configs', 'behavior.default.yaml'),
        permission: (parsed.flags.get('permission') ?? 'workspace-write') as 'read-only' | 'workspace-write' | 'danger-full-access',
      });
    }
    if (!parsed.flags.has('prompt')) {
      console.log('[cah] 交互模式需要终端。一次性任务请用：cah run --prompt "..."；配置供应商用 cah setup。');
      return 2;
    }
  }
  switch (parsed.command) {
    case 'help':
      console.log(USAGE);
      return 0;
    case 'version':
      console.log(`cah v${VERSION}`);
      return 0;
    case 'run':
      if (parsed.flags.has('bench')) return cmdBench(parsed.flags);
      return cmdRun(parsed.flags);
  }
  // bare `cah models` (no positionals parsed as command) — treat as run
  return cmdRun(parsed.flags);
}

// ESM entry
if (process.argv[1] && /cli\.(ts|js)$/.test(process.argv[1])) {
  main().then((code) => process.exit(code));
}
