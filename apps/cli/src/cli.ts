#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { VERSION } from '@vessel/shared';
import { MockProvider, createProvider } from '@vessel/llm';
import { composeHarness, createCredentialStore, type EnforcementProjection } from '@vessel/application';
import { createVesselServer } from '@vessel/local-server';
import { ProviderStore, type ProviderConfig } from './providers/ProviderStore.js';
import { fetchOpenAIModels, modelsForProtocol } from './providers/modelFetcher.js';
import { createClackIO, runSetupWizard } from './providers/setup.js';
import { runChat } from './tui/chat.js';
import { VESSEL_LOGO, VESSEL_TAGLINE } from './brand.js';
import { UsageStore } from './usage/UsageStore.js';
import { runVesselMigration } from './migrate.js';
import { cmdReview } from './review/reviewCommands.js';
import { loadModelCatalog, findCatalogModelByBase, findCatalogModelMatch, catalogPriceSource, listCatalogModels } from './providers/modelCatalog.js';
import { loadPricing } from './providers/pricing.js';

const USAGE = `${VESSEL_LOGO}
Vessel CLI v${VERSION} — 可组合 Agent Harness（品牌 Vessel）

用法:
  vessel --help                      显示本帮助
  vessel --version                   显示版本
  vessel run [选项]                  单发模式：跑一轮用户输入
  vessel run --bench <scenarioId>    基准模式：运行 benchmarks/ 场景并产出 JSONL 报告
  vessel models [--provider p]       列出某供应商可用模型（OpenAI 兼容实时拉取 / Anthropic 内置清单）
  vessel setup                       交互向导：搜索选供应商 → 输 key → 拉模型 → 空格勾选 → 提交
  vessel usage [--recent <n>] [--strict]  查看使用统计（tokens/调用/成本 + 价格来源分布；--strict 按不用兜底价重算）
  vessel pricing [model]               模型价目（configs/model-catalog.json，USD/1M tokens）
  vessel provider list               列出所有供应商（* = 当前默认）
  vessel provider current            显示当前默认供应商
  vessel provider add <id> --protocol <p> --model <m> [--base-url] [--api-key]   添加供应商
  vessel provider remove <id>        删除供应商
  vessel provider switch|use <id>    切换当前默认供应商
  vessel migrate                     一次性迁移旧状态目录 ~/.dsh → ~/.vessel（数据复制 + 旧目录进回收站）
  vessel review handoff <request.json>   生成外部评审 handoff（.vessel/reviews/<id>/handoff.md；task 059）
  vessel review import <id> <result 文件>  导入外部评审结果（[--source external|internal]，落库）
  vessel review list                 列出外部评审 reviews
  vessel bench-report --input <json>  基准报告看板：聚合 076 RunResult[]（或 082 lane report）→ 打印 CLI 摘要表 + 写 md/json（任务 083）
  vessel serve [--port <n>]          启动本地服务（默认 http://127.0.0.1:5678，不开浏览器）
  vessel web                         启动本地服务并打开浏览器

run 选项:
  --prompt <text>                 用户输入（缺省从 stdin 读取）
  --workspace <dir>               工作区（默认当前目录）
  --provider <mock|openai-compatible|anthropic>   模型提供方（默认 mock）
  --model <name>                  模型名（OpenAI/Anthropic 协议需指定，或 VESSEL_MODEL）
  --base-url <url>                端点：openai-compatible 用 {base}/chat/completions，
                                  anthropic 用 {base}/v1/messages（或 VESSEL_BASE_URL）
  --api-key <key>                 API 密钥（或 VESSEL_API_KEY；本地端点可不填）
  --max-steps <n>                 单轮步数上限（默认 64）
  --permission <mode>             权限模式：read-only（只读探索）| workspace-write（默认，写工作区）|
                                  danger-full-access（全权限，高危可执行）
  --policy <path>                 系统级策略文件（默认 configs/policy.default.yaml）
  --behavior <path>               Behavior IR 文件（默认 configs/behavior.default.yaml）
  --session-dir <dir>             会话日志目录（默认 <workspace>/.harness/sessions/<id>）
  --strict                        计价严格模式：只用模型专属价目（model/catalog），未收录模型按 0 计价并标「未收录」

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

/**
 * UsageStore 工厂（task 086/087）：价目表 + 目录价源 + strict 开关。
 * 查价实现与 UsageProjection 共用 @vessel/shared/pricing。
 */
function createUsageStore(opts: { strict?: boolean } = {}): UsageStore {
  const root = repoRoot();
  return new UsageStore({
    pricing: loadPricing(root),
    catalog: catalogPriceSource(loadModelCatalog(root)),
    strict: opts.strict,
  });
}

/**
 * 默认 ProviderStore（task 034）：附加 CredentialStore —— Windows 优先 DPAPI 加密
 * secrets.json，其余显式降级 plaintext。apiKey 写入走 secretRef，providers.json 不再
 * 落明文；读取经 store 解析回 apiKey。真实 ~/.vessel 下的凭据迁移只在 CLI 真正运行
 * 时触发（测试一律注入 rootDir/temp，绝不碰真实目录）。
 */
function defaultProviderStore(): ProviderStore {
  const credentialStore = createCredentialStore();
  return new ProviderStore({ credentialStore });
}

async function cmdRun(flags: Map<string, string>): Promise<number> {
  const workspace = path.resolve(flags.get('workspace') ?? process.cwd());
  const root = repoRoot();
  const prompt = flags.get('prompt') ?? (process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8').trim());

  // provider resolution: explicit --provider wins; else the current default
  // provider from ~/.vessel (provider switch); else mock with a hint.
  const store = defaultProviderStore();
  const explicitProvider = flags.get('provider');
  const currentId = explicitProvider ?? (store.getCurrent() !== 'mock' ? store.getCurrent() : 'mock');
  const currentCfg: ProviderConfig | undefined = currentId === 'mock' ? undefined : store.get(currentId);
  const providerName = explicitProvider ?? currentCfg?.protocol ?? 'mock';
  const model = flags.get('model') ?? process.env.VESSEL_MODEL ?? currentCfg?.model ?? 'mock-model';
  const baseUrl = flags.get('base-url') ?? process.env.VESSEL_BASE_URL ?? currentCfg?.baseUrl;
  const apiKey = flags.get('api-key') ?? process.env.VESSEL_API_KEY ?? currentCfg?.apiKey;
  let provider;
  if (providerName === 'openai-compatible' || providerName === 'anthropic') {
    if (!baseUrl) {
      console.error(`[vessel] ${providerName} 需要 --base-url 或 VESSEL_BASE_URL（或先 vessel provider add 配置）`);
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
    // V0.9 usage statistics: record this session's model usage persistently
    // （task 086：--strict 只用模型专属价目，未收录模型按 0 计价）
    usageStore: createUsageStore({ strict: flags.has('strict') }),
    usageProvider: currentId,
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
    // task 074 enforcement telemetry query seam (data face: list + counts + status)
    printEnforcementTelemetry(harness.enforcement);
    console.log(`会话日志: ${harness.session.logPath}`);
    return 0;
  } catch (err) {
    console.error(`[vessel] run failed: ${(err as Error).message}`);
    return 1;
  } finally {
    await harness.close();
  }
}

/**
 * task 074 enforcement telemetry query seam (minimal CLI data face). Prints the
 * aggregated counts + last few enforcement events + sandbox status from the
 * harness's EnforcementProjection. The full query API (`events / counts /
 * recent(n) / status / treeAudit`) lives on the projection itself.
 */
function printEnforcementTelemetry(enforcement: EnforcementProjection): void {
  const snap = enforcement.snapshot();
  if (snap.events.length === 0) return;
  console.log(`\n=== 安全执法遥测 (enforcement telemetry) ===`);
  const counts = Object.entries(snap.counts);
  if (counts.length > 0) {
    console.log(`  计数: ${counts.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  const srcs = snap.sources;
  console.log(`  来源: policy=${srcs.policy} fs-confinement=${srcs['fs-confinement']} process-tree=${srcs['process-tree']} sandbox-status=${srcs['sandbox-status']}`);
  const st = snap.status();
  if (st) {
    console.log(`  状态: backend=${st.backend ?? 'none'} enabled=${st.enabled} active=${st.active}${st.fallbackReason ? ` (${st.fallbackReason})` : ''}`);
  }
  for (const ev of snap.recent(3)) {
    const m = ev.meta && Object.keys(ev.meta).length > 0 ? ` ${JSON.stringify(ev.meta)}` : '';
    console.log(`    [${ev.source}] ${ev.type} @ ${ev.ts}: ${ev.detail}${m}`);
  }
}

async function cmdBench(flags: Map<string, string>): Promise<number> {
  const scenarioId = flags.get('bench');
  if (!scenarioId) {
    console.error('[vessel] run --bench 需要 scenarioId（如 B001）');
    return 2;
  }
  const { runScenario } = await import('@vessel/bench-runners');
  const workspace = path.resolve(flags.get('workspace') ?? process.cwd());
  const outDir = path.resolve(flags.get('out') ?? path.join(workspace, 'benchmarks', 'reports'));
  const providerName = flags.get('provider') ?? 'mock';
  const model = flags.get('model') ?? process.env.VESSEL_MODEL ?? 'mock-model';
  const provider =
    providerName === 'openai-compatible' || providerName === 'anthropic'
      ? createProvider(providerName, {
          baseUrl: flags.get('base-url') ?? process.env.VESSEL_BASE_URL ?? '',
          apiKey: flags.get('api-key') ?? process.env.VESSEL_API_KEY,
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

/** `vessel models [--provider p]` — list a provider's available models. */
async function cmdModels(flags: Map<string, string>): Promise<number> {
  const store = defaultProviderStore();
  const id = flags.get('provider') ?? store.getCurrent();
  const cfg = store.get(id);
  if (!cfg) {
    console.error(`[vessel] provider "${id}" 不存在（vessel provider list 查看；vessel provider add 添加）`);
    return 2;
  }
  if (cfg.protocol === 'mock') {
    console.log('(mock provider 是离线的，无模型列表)');
    return 0;
  }
  // V0.9: annotate each model with context window + USD/1M price from the model catalog
  const catalog = loadModelCatalog(repoRoot());
  const line = (m: string): string => {
    const e = findCatalogModelByBase(catalog, m);
    if (!e) return `  ${m}`;
    const ctx = e.contextWindow ? (e.contextWindow / 1000).toFixed(0) + 'k' : '-';
    const price = e.priceIn != null ? `in $${e.priceIn} / out $${e.priceOut ?? '-'}` : '';
    return `  ${m.padEnd(30)} ctx ${ctx.padEnd(7)} ${price}`;
  };
  if (cfg.protocol === 'openai-compatible' && cfg.baseUrl) {
    try {
      const src = await fetchOpenAIModels(cfg.baseUrl, cfg.apiKey);
      console.log(`模型列表（${src.origin === 'live' ? '实时拉取' : src.note}）：`);
      for (const m of src.models) console.log(line(m));
      return 0;
    } catch (err) {
      console.error(`[vessel] ${(err as Error).message}`);
      console.error('提示：可先用内置清单，或确认 base-url/api-key 正确。');
      return 1;
    }
  }
  // anthropic (no live enumeration) or openai-compatible without baseUrl
  const src = modelsForProtocol(cfg.protocol);
  console.log(src.note ? `模型列表（${src.note}）：` : '模型列表：');
  for (const m of src.models) console.log(line(m));
  return 0;
}

/** `vessel provider <list|add|remove|switch|use|current> [...]` — manage providers. */
async function cmdProvider(args: string[], flags: Map<string, string>): Promise<number> {
  const store = defaultProviderStore();
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
        console.error('用法: vessel provider add <id> --protocol <mock|openai-compatible|anthropic> [--base-url <url>] [--api-key <key>] --model <model> [--name <显示名>]');
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
        console.error(`[vessel] ${cfg.protocol} 需要 --base-url`);
        return 2;
      }
      try {
        store.add(cfg);
        console.log(`已添加 provider "${id}"（protocol=${cfg.protocol}, model=${cfg.model}）`);
        return 0;
      } catch (err) {
        console.error(`[vessel] ${(err as Error).message}`);
        return 1;
      }
    }
    case 'remove': {
      const id = args[1];
      if (!id) {
        console.error('用法: vessel provider remove <id>');
        return 2;
      }
      try {
        store.remove(id);
        console.log(`已移除 provider "${id}"`);
        return 0;
      } catch (err) {
        console.error(`[vessel] ${(err as Error).message}`);
        return 1;
      }
    }
    case 'switch':
    case 'use': {
      const id = args[1];
      if (!id) {
        console.error(`用法: vessel provider ${sub} <id>`);
        return 2;
      }
      try {
        store.setCurrent(id);
        console.log(`已切换到 provider "${id}"`);
        return 0;
      } catch (err) {
        console.error(`[vessel] ${(err as Error).message}`);
        return 1;
      }
    }
    default: {
      console.error(`[vessel] 未知 provider 子命令 "${sub}"（可用: list/add/remove/switch/use/current）`);
      return 2;
    }
  }
}

/** `vessel setup` — interactive guided provider wizard (cc-switch-style UX). */
async function cmdSetup(_flags: Map<string, string>): Promise<number> {
  if (!process.stdin.isTTY) {
    console.log('vessel setup 需要交互终端。非交互环境请用：vessel provider add <id> --protocol <p> --base-url <url> --api-key <key> --model <model>');
    return 2;
  }
  const store = defaultProviderStore();
  const io = createClackIO(store);
  const id = await runSetupWizard({ store, io });
  if (id) {
    console.log(`\n✔ 已保存供应商 "${id}"。用 vessel run 开始（或 vessel provider switch 切换）。`);
    return 0;
  }
  console.log('已取消，未做任何修改。');
  return 1;
}

/**
 * `vessel usage [--recent <n>] [--strict]` — persistent usage statistics (V0.9).
 *
 * task 086：显式标出「估算条目 / 价格来源分布」；`--strict` 按「只用模型专属
 * 价目（model/catalog）」的口径重算一遍，给出未收录条目与金额差（不写盘，只审计）。
 */
async function cmdUsage(flags: Map<string, string>): Promise<number> {
  const store = createUsageStore();
  const t = store.totals();
  console.log('=== 使用统计（~/.vessel/usage.json）===');
  console.log(`总消耗: input ${t.inputTokens.toLocaleString()} · output ${t.outputTokens.toLocaleString()} · cache ${t.cacheReadTokens.toLocaleString()} · 调用 ${t.calls}`);
  console.log(`估算成本: $${t.costUsd.toFixed(4)}（${t.providers} 供应商 / ${t.models} 模型）`);
  const dist = store.pricingSourceDistribution();
  if (dist.length > 0) {
    console.log(`价格来源分布: ${dist.map((d) => `${d.source} ${d.entries}条`).join(' · ')}`);
  }
  if (t.estimatedEntries > 0) {
    const countOf = (s: string) => dist.find((d) => d.source === s)?.entries ?? 0;
    console.log(
      `⚠ 含估算条目 ${t.estimatedEntries} 条（非该模型专属价目：protocol 级 ${countOf('protocol')} 条 / default 兜底 ${countOf('default')} 条 / 来源未知 ${countOf('legacy')} 条；估算金额 $${t.estimatedCostUsd.toFixed(4)}）`,
    );
  } else if (t.calls > 0) {
    console.log('价格来源全部命中模型专属价目（model/catalog），无估算条目。');
  }
  if (t.unpricedEntries > 0) {
    console.log(`未收录条目 ${t.unpricedEntries} 条（strict 模式下按 0 计价，token 已保留待回填）。`);
  }
  if (t.legacyEntries > 0) {
    console.log(`来源未知条目 ${t.legacyEntries} 条（085 之前的记录，未保存来源，可能是 default 兜底）。`);
  }
  const byProv = store.byProvider();
  if (byProv.length > 0) {
    console.log('\n按供应商:');
    for (const p of byProv) console.log(`  ${p.provider}: ${p.inputTokens.toLocaleString()}in/${p.outputTokens.toLocaleString()}out · ${p.calls} 次 · $${p.costUsd.toFixed(4)}${p.estimated ? '（含估算）' : ''}`);
  }
  const byModel = store.byModel();
  if (byModel.length > 0) {
    console.log('\n按模型:');
    for (const m of byModel.slice(0, 10)) {
      const mark = m.pricingSource === 'default' || m.pricingSource === 'legacy' ? '（估算）' : m.pricingSource === 'unpriced' ? '（未收录）' : '';
      console.log(`  ${m.provider}/${m.model}: $${m.costUsd.toFixed(4)} · ${m.calls} 次${mark}`);
    }
  }
  const recent = store.recent(Number(flags.get('recent') ?? 5));
  if (recent.length > 0) {
    console.log(`\n最近 ${recent.length} 条:`);
    for (const r of recent) {
      const mark = r.estimated ? '（估算）' : r.pricingSource === 'unpriced' ? '（未收录）' : '';
      console.log(`  ${r.ts.slice(0, 19)} ${r.provider}/${r.model}: ${r.inputTokens}in/${r.outputTokens}out · $${r.costUsd.toFixed(4)}${mark}`);
    }
  }
  if (flags.has('strict')) {
    const audit = store.strictAudit();
    console.log('\n=== --strict 审计（只用模型专属价目 model/catalog）===');
    console.log(`strict 口径成本: $${audit.costUsd.toFixed(4)}（当前 $${t.costUsd.toFixed(4)}，差 $${audit.deltaUsd.toFixed(4)}）`);
    console.log(`未收录模型 ${audit.unpricedEntries} 条 → 按 0 计价（这些条目当前记了 $${audit.unpricedCostUsd.toFixed(4)}，属猜测成本）`);
    if (audit.unpricedEntries === 0) console.log('没有未收录模型：所有条目在 strict 口径下同样可计价。');
  }
  return 0;
}

/** `vessel pricing [model]` — model price lookup (V0.9 + 085 归一提示). */
async function cmdPricing(modelArg: string | undefined, flags: Map<string, string>): Promise<number> {
  const root = repoRoot();
  const catalog = loadModelCatalog(root);
  const target = flags.get('model') ?? modelArg;
  if (target) {
    const match = findCatalogModelMatch(catalog, target);
    if (!match) {
      console.log(`未找到模型 "${target}" 的目录条目（可用 vessel pricing 列出）。`);
      return 1;
    }
    const entry = match.entry;
    console.log(`模型: ${entry.model}（${entry.provider}）`);
    if (match.key !== target) {
      console.log(`  归一匹配: "${target}" → "${match.key}"（${match.exact ? '精确' : '家族前缀'}）`);
    }
    console.log(`  上下文: ${entry.contextWindow?.toLocaleString() ?? '?'} tokens · 输出上限: ${entry.outputLimit?.toLocaleString() ?? '?'}`);
    console.log(`  价格: in $${entry.priceIn} / out $${entry.priceOut} / cache $${entry.priceCache ?? 0}（每 1M tokens）`);
    return 0;
  }
  console.log('=== 模型价目（configs/model-catalog.json，USD/1M tokens）===');
  for (const m of listCatalogModels(catalog)) {
    console.log(`  ${m.provider.padEnd(16)} ${m.model.padEnd(28)} in $${m.priceIn ?? '-'} out $${m.priceOut ?? '-'} ctx ${(m.contextWindow ?? 0).toLocaleString()}`);
  }
  console.log(`\n共 ${catalog.models.length} 条。查询单个: vessel pricing --model <id>`);
  return 0;
}

/** `vessel migrate` — one-time ~/.dsh → ~/.vessel state migration (task 033). */
async function cmdMigrate(): Promise<number> {
  const res = await runVesselMigration();
  if (res.status === 'skipped' && res.reason === 'legacy-absent') {
    console.log('[vessel migrate] 未发现旧状态目录 ~/.dsh，无需迁移。');
    return 0;
  }
  if (res.status === 'skipped' && res.reason === 'vessel-present') {
    console.log('[vessel migrate] 已存在 ~/.vessel（跳过；保留 ~/.dsh 未动）。');
    return 0;
  }
  console.log(`[vessel migrate] 已把 ~/.dsh 复制到 ~/.vessel（${res.copiedCount} 个条目）。`);
  if (res.recycled) {
    console.log('[vessel migrate] 旧目录 ~/.dsh 已送进回收站。');
  } else {
    console.warn(`[vessel migrate] 旧目录 ~/.dsh 未能自动回收（${res.recycleError ?? 'unknown'}\n  数据已在 ~/.vessel，请手工把旧目录移入回收站（不要永久删除）。`);
  }
  return 0;
}

export interface ServeHandle {
  /** bound URL, e.g. http://127.0.0.1:5678 (echoes the real bound port). */
  url: string;
  /** stop the http server; resolves once it has fully closed. */
  close(): Promise<void>;
}

/** `vessel serve` body (task 044): create + listen the local server and print its address. */
export async function startServe(opts: { port?: number; workspace?: string } = {}): Promise<ServeHandle> {
  const port = Number(opts.port ?? 5678);
  const workspace = path.resolve(opts.workspace ?? process.cwd());
  const server = createVesselServer({ port, staticDir: undefined });
  try {
    await server.listen();
  } catch (err) {
    // 端口被占：明确提示并建议换端口（return 2 由调用方决定，这里只区分成功/失败）
    const cause = (err as { code?: string }).code;
    if (cause === 'EADDRINUSE' || /listen EADDRINUSE/.test(String(err))) {
      throw Object.assign(err as Error, { vesselEaddrInUse: true });
    }
    throw err;
  }
  const url = `http://127.0.0.1:${server.port}`;
  console.log(`Vessel local server: ${url}`);
  console.log(`工作区: ${workspace}`);
  return {
    url,
    close: () => server.close(),
  };
}

/** Turn a bind failure into a friendly, actionable exit. */
function isPortTaken(err: unknown): boolean {
  return err instanceof Error && (
    (err as { vesselEaddrInUse?: boolean }).vesselEaddrInUse === true ||
    /EADDRINUSE/.test(err.message)
  );
}

/**
 * `vessel bench-report <runResults.json> [--out <dir>]` (task 083 dashboard).
 *
 * Reads a JSON array of 076 RunResult objects, aggregates them into a
 * BenchmarkReport, prints the CLI dashboard summary to stdout, and persists
 * `<dir>/benchmark-report-<ts>.md` + `.json` (JSON consumed by task-084 release
 * gates). Also accepts a 082 RealModelLaneReport JSON — its run rows are
 * converted via rowsFromLaneReport.
 */
async function cmdBenchReport(flags: Map<string, string>): Promise<number> {
  const input = flags.get('input');
  if (!input) {
    console.error('[vessel] bench-report 需要 --input <runResults.json>（076 RunResult[] 或 082 lane report JSON）');
    return 2;
  }
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(input, 'utf8'));
  } catch (err) {
    console.error(`[vessel] 无法读取/解析输入 JSON: ${(err as Error).message}`);
    return 2;
  }
  const { buildReportFromRunResults, buildReport, rowsFromLaneReport, renderCliSummary, writeReportFiles } =
    await import('@vessel/bench-runners');

  const isArray = Array.isArray(json);
  const isLaneReport = !isArray && typeof json === 'object' && (json as { modelSummaries?: unknown })?.modelSummaries !== undefined;

  let rep;
  if (isArray) {
    rep = buildReportFromRunResults(json as Parameters<typeof buildReportFromRunResults>[0]);
  } else if (isLaneReport) {
    const rows = rowsFromLaneReport(json as Parameters<typeof rowsFromLaneReport>[0]);
    rep = buildReport(rows, 'task-082 real-model lane report');
  } else {
    console.error('[vessel] bench-report 输入必须是 076 RunResult[] 数组或 082 RealModelLaneReport JSON');
    return 2;
  }

  const outDir = path.resolve(flags.get('out') ?? path.join(repoRoot(), 'benchmarks', 'reports'));
  console.log(renderCliSummary(rep));
  const paths = writeReportFiles(rep, outDir);
  console.log(`\n报告已写入:\n  ${paths.mdPath}\n  ${paths.jsonPath}`);
  return 0;
}

/**
 * Park the process (keep the event loop alive) until Ctrl+C / SIGTERM.
 * Exposed as a seam so tests can replace it with an immediately-resolving
 * no-op and assert serve dispatch without ever really hanging.
 */
export async function parkServe(): Promise<number> {
  return new Promise<number>(() => {
    const ping = setInterval(() => {}, 1 << 30); // keep the loop alive
    const stop = () => clearInterval(ping);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

/** `vessel serve [--port <n>]` — launch the local server, stay resident. */
export async function cmdServe(flags: Map<string, string>): Promise<number> {
  const port = Number(flags.get('port') ?? 5678);
  let handle: ServeHandle;
  try {
    handle = await startServe({ port, workspace: flags.get('workspace') });
  } catch (err) {
    if (isPortTaken(err)) {
      console.error('[vessel] 端口被占用，试 --port 5679');
      return 2;
    }
    console.error(`[vessel] 启动本地服务失败: ${(err as Error).message}`);
    return 2;
  }
  try {
    return await serveRuntime.park();
  } finally {
    await handle.close();
  }
}

/** Open the system default browser at `url` (zero-dependency). Never blocks. */
export function openBrowser(url: string): void {
  const { platform } = process;
  try {
    if (platform === 'win32') {
      // `cmd /c start "" <url>` — the empty "" is the window title; without it
      // URLs starting with an HTTP scheme can be swallowed as a title.
      spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
    } else if (platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else if (platform === 'linux') {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
    } else {
      console.log(`[vessel] 请手动打开浏览器访问 ${url}`);
    }
  } catch {
    console.log(`[vessel] 无法自动打开浏览器，请手动访问 ${url}`);
  }
}

/**
 * Runtime seam for `vessel serve|web`. Tests stub `park` (so dispatch never
 * hangs) and `open` (so no browser spawn). Replace members in place.
 */
export const serveRuntime = {
  park: parkServe,
  open(url: string): void {
    openBrowser(url);
  },
};

/** `vessel web` — launch the server and open the default browser. */
export async function cmdWeb(flags: Map<string, string>): Promise<number> {
  const port = Number(flags.get('port') ?? 5678);
  let handle: ServeHandle;
  try {
    handle = await startServe({ port, workspace: flags.get('workspace') });
  } catch (err) {
    if (isPortTaken(err)) {
      console.error('[vessel] 端口被占用，试 --port 5679');
      return 2;
    }
    console.error(`[vessel] 启动本地服务失败: ${(err as Error).message}`);
    return 2;
  }
  serveRuntime.open(handle.url);
  try {
    return await serveRuntime.park();
  } finally {
    await handle.close();
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  // subcommand forms: `vessel provider <sub>`, `vessel models`
  const first = parsed.positionals[0];
  if (first === 'provider') return cmdProvider(parsed.positionals.slice(1), parsed.flags);
  if (first === 'models') return cmdModels(parsed.flags);
  if (first === 'setup') return cmdSetup(parsed.flags);
  if (first === 'usage') return cmdUsage(parsed.flags);
  if (first === 'pricing') return cmdPricing(parsed.positionals[1], parsed.flags);
  if (first === 'migrate') return cmdMigrate();
  if (first === 'review') return cmdReview(parsed.positionals.slice(1), parsed.flags);
  if (first === 'bench-report') return cmdBenchReport(parsed.flags);
  if (first === 'serve') return cmdServe(parsed.flags);
  if (first === 'web') return cmdWeb(parsed.flags);
  // bare `vessel` (no subcommand): interactive TUI in a TTY; guide otherwise.
  if (first === undefined && parsed.command === 'run' && !parsed.flags.has('bench')) {
    if (!parsed.flags.has('prompt') && process.stdin.isTTY) {
      const root = repoRoot();
      return runChat({
        store: defaultProviderStore(),
        workspaceRoot: path.resolve(parsed.flags.get('workspace') ?? process.cwd()),
        policySystemPath: parsed.flags.get('policy') ?? path.join(root, 'configs', 'policy.default.yaml'),
        behaviorIRPath: parsed.flags.get('behavior') ?? path.join(root, 'configs', 'behavior.default.yaml'),
        permission: (parsed.flags.get('permission') ?? 'workspace-write') as 'read-only' | 'workspace-write' | 'danger-full-access',
      });
    }
    if (!parsed.flags.has('prompt')) {
      console.log('[vessel] 交互模式需要终端。一次性任务请用：vessel run --prompt "..."；配置供应商用 vessel setup。');
      return 2;
    }
  }
  switch (parsed.command) {
    case 'help':
      console.log(USAGE);
      return 0;
    case 'version':
      console.log(`${VESSEL_LOGO}Vessel CLI v${VERSION} — ${VESSEL_TAGLINE}`);
      return 0;
    case 'run':
      if (parsed.flags.has('bench')) return cmdBench(parsed.flags);
      return cmdRun(parsed.flags);
  }
  // bare `vessel models` (no positionals parsed as command) — treat as run
  return cmdRun(parsed.flags);
}

// ESM entry
if (process.argv[1] && /cli\.(ts|js)$/.test(process.argv[1])) {
  main().then((code) => process.exit(code));
}
