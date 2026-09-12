#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION, renameWithRetry } from '@vessel/shared';
import { inspectCombinedPolicy, inspectPolicyLayers, type PolicyLayerFact } from '@vessel/policy';
import { MockProvider } from '@vessel/llm';
import {
  composeHarness,
  createMcpConnections,
  SessionRegistry,
  type ComposedHarness,
  type ComposeOptions,
  type McpConnectionFailure,
  type SessionMeta,
} from '@vessel/application';
import { createVesselServer } from '@vessel/local-server';
import { ProviderStore, parseBackupKeep, type ProviderConfig } from './providers/ProviderStore.js';
import { createDefaultProviderStore } from './providers/defaultStore.js';
import {
  PROVIDER_EXPORT_VERSION,
  buildExport,
  importProviders,
  serializeExport,
  type ImportConflictStrategy,
} from './providers/providerTransfer.js';
import { DEFAULT_PROBE_TIMEOUT_MS, probeProviderEndpoints, suggestEndpoint } from './providers/endpointProbe.js';
import { buildRealProvider, describeProviderError, missingBaseUrl, planProvider } from './providers/providerFactory.js';
import { describeStartupFailure } from './startupError.js';
import { fetchOpenAIModels, modelsForProtocol } from '@vessel/application';
import { createClackIO, runSetupWizard } from './providers/setup.js';
import { runChat } from './tui/chat.js';
import { McpConfigStore } from './mcp/config.js';
import { VESSEL_LOGO, VESSEL_TAGLINE } from './brand.js';
import { UsageStore, isLocalDateKey, localDateKey, resolveUsageRoot } from './usage/UsageStore.js';
import { PricingOverrideStore, type PricingRepair } from './usage/pricingOverride.js';
import { runVesselMigration, type MigrationOptions, type MigrationResult } from './migrate.js';
import { cmdReview } from './review/reviewCommands.js';
import { cmdExplain, cmdListTerms, cmdGuide, cmdSettings } from './guide/guideCommands.js';
import { cmdSessionsList } from './sessions/commands.js';
import { resolveResumeTarget } from './sessions/resume.js';
import {
  loadModelCatalogDetailed,
  userModelCatalogPath,
  findCatalogModelByBase,
  findCatalogModelMatch,
  catalogPriceSource,
  listCatalogModels,
  type ModelCatalog,
} from './providers/modelCatalog.js';
import { syncModelCatalog, MODELS_DEV_URL, DEFAULT_SYNC_TIMEOUT_MS, MAX_SYNC_RETRIES } from './providers/pricingSync.js';
import { loadPricing, assertCostMultiplier, DEFAULT_COST_MULTIPLIER, type TokenPrice } from './providers/pricing.js';
import { emitJson, fail, isJson } from './output.js';
// 本卡：回合文本的**共用判据**（唯一实现，零依赖叶子模块）——CLI 与 TUI 各自 import 同一份，
// 不再各写一份（成环问题由"叶子模块"解决，见 turnText.ts 的文件头注释）。
import { isModelReplyKind, type TurnKind } from './turnText.js';
// 本卡：windowsShim 判定的**唯一实现**（零依赖叶子模块）——CLI 与 TUI 各自 import 同一份，
// 不再各写一份（改前两份 + 全仓零测试 ⇒ 只改一面必无声分叉，见 windowsShim.ts 的文件头）。
import { windowsShimHint } from './windowsShim.js';

const USAGE = `${VESSEL_LOGO}
Vessel CLI v${VERSION} — 可组合 Agent Harness（品牌 Vessel）

用法:
  vessel --help                      显示本帮助
  vessel --version                   显示版本
  vessel run [选项]                  单发模式：跑一轮用户输入
  vessel run --bench <scenarioId>    基准模式：运行 benchmarks/ 场景并产出 JSONL 报告
  vessel models [--provider p]       列出某供应商可用模型（OpenAI 兼容实时拉取 / Anthropic 内置清单）
  vessel setup                       交互向导：搜索选供应商 → 输 key → 拉模型 → 空格勾选 → 提交
  vessel usage [--recent <n>] [--strict] [--since <date>] [--until <date>] [--by-day]
                                      使用统计（tokens/调用/成本分项 + 价格来源分布；
                                      --since/--until 本地日窗口、--by-day 按日列出；--strict 按不用兜底价重算）
  vessel usage recompute [--dry-run] [--since <date>] [--until <date>]
                                      按当前价目重算历史成本（保留 token，只重算 cost/来源；幂等）
  vessel pricing [model]               模型价目（configs/model-catalog.json，USD/1M tokens）
  vessel pricing sync [--dry-run] [--provider <p>] [--exclude <glob>]
                                      从 models.dev 同步价目到 model-catalog.json
                                      （超时 ${DEFAULT_SYNC_TIMEOUT_MS / 1000}s + 重试 ${MAX_SYNC_RETRIES} 次；失败保留旧表并提示；
                                      不覆盖 ~/.vessel/pricing.override.json）
  vessel pricing override [list]       用户价目覆盖（~/.vessel/pricing.override.json；优先级最高）
  vessel pricing override set <key> --input <n> --output <n> [--cache-read <n>] [--cache-write <n>]
                                      覆盖单价（key = model 或 provider::model）
  vessel pricing override delete <key> 删除墓碑：显式删除内置条目（按 0 计价、不回退）
  vessel pricing override restore <key> 撤销墓碑
  vessel pricing override repair --file <repairs.json>
                                      值守卫式修复：仅当覆盖现值 = from 才改成 to
  vessel provider list               列出所有供应商（* = 当前默认）
  vessel provider current            显示当前默认供应商
  vessel provider add <id> --protocol <p> --model <m> [--base-url] [--api-key] [--cost-multiplier <n>]   添加供应商
  vessel provider set <id> [--model <m>] [--base-url <u>] [--cost-multiplier <n>]   修改供应商（倍率只乘总额）
  vessel provider remove <id>        删除供应商
  vessel provider switch|use <id>    切换当前默认供应商
  vessel provider export [--out <file>]   导出配置（默认脱敏：key 只写 secretRef 占位，永不含明文）
  vessel provider import <file> [--on-conflict skip|overwrite] [--dry-run] [--keep <n>]   合并导入（默认跳过同名）
  vessel provider endpoint list <id>            列出候选端点（* = 默认端点 baseUrl）
  vessel provider endpoint add <id> <url> [--label <l>]     添加候选端点
  vessel provider endpoint remove <id> <url>                移除候选端点
  vessel provider endpoint test <id> [--set-default]        端点最小探测 + 建议（默认不改默认端点）
  vessel provider endpoint test --all                       探测所有供应商的端点
  vessel migrate                     一次性迁移旧状态目录 ~/.dsh → ~/.vessel（数据复制 + 旧目录进回收站）
  vessel sessions list               列出历史会话（最近活动在前）
  vessel resume <id>|--last           恢复历史会话（--last = 最近一条）
  vessel review handoff <request.json>   生成外部评审 handoff（.vessel/reviews/<id>/handoff.md；task 059）
  vessel review import <id> <result 文件>  导入外部评审结果（[--source external|internal]，落库）
  vessel review list                 列出外部评审 reviews
  vessel explain <term>              术语中英双语解释（别名: vessel term <term>；未收录给提示）
  vessel list-terms                  列出全部术语（中英双语词库）
  vessel guide [--locale zh|en]      新手分步引导（①这是什么 ②怎么问术语 ③常用命令 ④怎么设置主题/语言；
                                      输出语言跟随 settings locale，--locale 可覆盖）
  vessel settings list               显示设置项说明与当前值（theme/locale，中英文说明 + 可选值）
  vessel settings set <key> <value>  设置（theme: dark|light；locale: zh|en；非法值给说明）
  vessel policy status               显示生效策略层次（system/project：路径 / 是否存在 / 声明条数 / 哈希；只读）
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
  --strict                        计价严格模式：只用模型专属价目（model/catalog），未收录模型按 0 计价并标「未收录」
  --json              以 JSON 输出（stdout 恰好一段可解析 JSON）：run / usage / provider list / models / sessions list / settings list / policy status / bench-report

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
 * 内置默认配置根：CLI **自带的** `configs/` 所在目录（G-15「装在哪儿就在哪儿」）。
 *
 * 查找顺序（自上而下，命中即返回；**包内优先**，结果不随 cwd 漂移）：
 *   ① **包内·模块目录** —— `<dirname(cli.js)>/configs/policy.default.yaml`。
 *      安装态命中 `node_modules/@vessel/cli/dist/configs/`（该目录由
 *      `apps/cli/scripts/copy-configs.mjs` 在 `npm run build` / `prepack` 时从仓库根复制而来）。
 *   ② **包内·上一级** —— `<dirname(cli.js)>/../configs/policy.default.yaml`。
 *      兼容 `src/` 与 `dist/` 两种形态（例如包根直接放 configs/ 的另一套布局）。
 *   ③ **模块位置上溯最多 6 级** —— 改动前的既有行为，逐字保留。开发态 `apps/cli/src`
 *      （或 `apps/cli/dist`）上溯 2 级即仓库根，命中仓库 `configs/`；安装态包内若没带
 *      configs，则 6 级内一级都命中不了。
 *   ④ **回落 `repoRoot()`** —— 从 **cwd** 上溯，再退化为 cwd；保持旧行为，不抛。
 *
 * 两种形态各自命中什么：
 *   - **开发态**（`npx tsx apps/cli/src/cli.ts`，或跑 `apps/cli/dist/cli.js` 且未 copy）：
 *     ① 落空（`apps/cli/src/configs` 不存在）→ ② 落空（`apps/cli/configs` 不存在）
 *     → ③ 命中 `<repo>/configs`。与改动前逐字相同。
 *   - **安装态**（`node_modules/@vessel/cli/dist/cli.js`）：① 命中 `<pkg>/dist/configs`
 *     （改动前 ③④ 全落空 → 拼出 `<cwd>/configs/*.yaml` 这种必然失败的路径）。
 *
 * `--policy` / `--behavior` 显式覆盖仍最高优先，语义不变（见 policyLayerCandidates / cmdRun）。
 *
 * `startDir` 仅为测试注入查找起点，缺省即本模块所在目录（运行时行为不变）。
 */
export function builtinConfigRoot(startDir: string = path.dirname(fileURLToPath(import.meta.url))): string {
  const moduleDir = startDir;
  // ①② 包内优先：模块目录（安装态 = dist/configs）与其上一级（兼容 src/ 布局）
  for (const pkgLocal of [moduleDir, path.dirname(moduleDir)]) {
    if (fs.existsSync(path.join(pkgLocal, 'configs', 'policy.default.yaml'))) return pkgLocal;
  }
  // ③ 既有行为：模块位置上溯最多 6 级（开发态在此命中仓库根）
  let dir = moduleDir;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'configs', 'policy.default.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // ④ 仍未命中：回落 repoRoot()（从 cwd 上溯，再退化为 cwd），保持旧行为、不抛
  return repoRoot();
}

/**
 * 读路径守卫（本卡修复）：内置配置的**默认路径不存在**时给一条明确警告，但**绝不失败**
 * （不改退出码、不抛——可用性优先）。
 *
 * 动机：`loadPricing`（providers/pricing.ts）与 `loadModelCatalog`
 * （providers/modelCatalog.ts）对缺失路径 **静默降级**（兜底 default 价 / 空目录）。
 * 安装态包内若没带 configs，用户拿到的是**静默错误**的价目（usage 成本算错、
 * `vessel models` 无价格注解）——比崩溃更难发现。这里把「静默」补成「明说」。
 *
 * `root` 必须与调用处传给 `loadPricing` / `loadModelCatalogDetailed` 的 root **同源同值**
 * （都来自 `builtinConfigRoot()`），因此这里检查的路径与真正读取的路径逐字一致
 * （`loadPricing(root)` 读的正是 `<root>/configs/pricing.json`；目录的**用户态层**
 * `~/.vessel/model-catalog.json` 优先级更高，但本函数检查的是「包内那份在不在」这个事实本身，
 * 与用户态无关——它也是「configs 没随包安装」的唯一可观测信号，故不因用户态命中而跳过）。
 * 只检查**默认**路径；`--catalog` / `--policy` 等显式覆盖不经此处。
 * `warn` 仅为测试注入（缺省 `console.warn`），不影响退出码与人类输出之外的任何行为。
 */
export function warnMissingBuiltinConfig(
  root: string,
  name: string,
  impact: string,
  warn: (message: string) => void = (message) => console.warn(message),
): void {
  const file = path.join(root, 'configs', name);
  if (fs.existsSync(file)) return;
  warn(
    `[vessel] 未找到内置配置：${file}\n` +
      `  ${impact}\n` +
      `  可能原因：configs 未随包安装（安装态应位于 <包>/dist/configs），或在非仓库目录运行。\n` +
      `  命令继续执行，但上述结果可能不准确。`,
  );
}

/**
 * 路径归一（用于「是不是同一个目录」的判等）：realpath 消 symlink / Windows 8.3 短路径，
 * win32 再小写归一（NTFS 大小写不敏感）。
 *
 * 关键点：**目标可能尚不存在**——`pricing sync` 的写目标目录可能还没建，而
 * `fs.realpathSync` 对不存在的路径会抛 ENOENT。故自底向上找**最近的已存在祖先**做
 * realpath，再把剩余（不存在的）路径段原样拼回；连根都不存在（实际不会发生）时退回
 * `path.resolve`。
 */
function normalizePathForCompare(input: string): string {
  const abs = path.resolve(input);
  let cur = abs;
  const missing: string[] = [];
  let real: string | null = null;
  for (;;) {
    try {
      real = fs.realpathSync(cur);
      break;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) break; // 已到根且仍不存在：退回 abs
      missing.push(path.basename(cur));
      cur = parent;
    }
  }
  const joined = real === null ? abs : path.join(real, ...missing.reverse());
  return process.platform === 'win32' ? joined.toLowerCase() : joined;
}

/**
 * `vessel pricing sync` 的**写目标 vs 用户态读取位置**判据（纯函数，便于不起网络直接断言两侧）。
 *
 * Round 20 起读路径是「**用户态 catalog 优先** → 回落包内 `<configRoot>/configs/
 * model-catalog.json`」：用户态目录 = `resolveUsageRoot()`（缺省 `~/.vessel`，
 * `VESSEL_USAGE_ROOT` 可覆盖，与 `pricing.override.json` 同根）。
 * 因此判据是「写目录 == 用户态目录吗」：
 *   - **相同** → 写进去的就是最高优先的那一层，`null`（默认路径即如此 → 零噪音、不再 warn）；
 *   - **不同** → 写进去最多只是**回落层**：用户态一旦有 catalog，这次同步的价格永远读不到
 *     （且在用户项目里凭空多一个 `configs/` 也不会被读）。
 *
 * 本函数只**判断并给出文案**：不写字、不改路径、不影响退出码（`--catalog` 语义不变）。
 *   - 写目录 = `path.dirname(path.resolve(catalogPath))`；
 *   - 读目录 = 调用方传入的 `readDir`（调用点传 `resolveUsageRoot()`）；
 *   - 归一后**相同** → `null`；**不同** → 返回 warn 文案（含写入绝对路径、用户态目录、后果与补救）。
 */
export function pricingSyncMismatchWarning(catalogPath: string, readDir: string): string | null {
  const target = path.resolve(catalogPath);
  if (normalizePathForCompare(path.dirname(target)) === normalizePathForCompare(readDir)) return null;
  return (
    `[vessel pricing sync] ⚠ 写入位置不是用户态目录：\n` +
    `  写入: ${target}\n` +
    `  用户态目录: ${readDir}（model-catalog.json 的最高优先级读取位置）\n` +
    `  后果：用户态已有 catalog 时，此次同步的价格不会被读到（用户数据优先于其它位置）。\n` +
    `  让它生效：--catalog "${path.join(readDir, 'model-catalog.json')}"，` +
    `或用 vessel pricing override set <model> 直接指定该模型价（覆盖优先级最高）。`
  );
}

/** G-15：project 级策略（POLICY-SPEC:457-458）——<workspace>/.harness/policy.yaml。
 *  存在才传（缺省是合法状态：project 层可选）；不存在返回 undefined，不报错。 */
function resolveProjectPolicyPath(workspaceRoot: string): string | undefined {
  const p = path.join(workspaceRoot, '.harness', 'policy.yaml');
  return fs.existsSync(p) ? p : undefined;
}

/**
 * G-17（BRIEF-15 AC2/AC4）：策略层次的**候选路径**——只算「该去哪儿找」，不判存在性。
 *
 * `vessel policy status` 与 cmdRun / TUI 的「部分装载」警告**共用本函数**，保证两处
 * 看到的是同一批路径、同一份事实（同源）。`--policy` 仍只覆盖 system 层（既有语义）。
 */
function policyLayerCandidates(flags: Map<string, string>): { systemPath: string; projectPath: string } {
  const workspace = path.resolve(flags.get('workspace') ?? process.cwd());
  return {
    systemPath: flags.get('policy') ?? path.join(builtinConfigRoot(), 'configs', 'policy.default.yaml'),
    projectPath: path.join(workspace, '.harness', 'policy.yaml'),
  };
}

/**
 * AC4 判据（纯函数，与 `vessel policy status` 同源）：**部分装载** = 至少一层有声明（>0）、
 * 且至少一层**不是有效声明**（`declarationCount === 0`，含缺失 / 存在但无效 / 合法但 0 条）。
 * 都缺 / 都齐 → 空数组（负对照：此时**不得**告警）。
 *
 * 闸门本身不变；**措辞**由下面三个谓词**三分**——"声明 0 条"不等于"文件不存在"。
 */
function partialPolicyLayers(layers: PolicyLayerFact[]): PolicyLayerFact[] {
  if (!layers.some((l) => l.declarationCount > 0)) return [];
  return layers.filter((l) => l.declarationCount === 0);
}

/**
 * 问题层三态（事实全部来自 `inspectPolicyLayers` 的 `exists` / `error` / `declarationCount`，
 * 本文件**不另算一套**）：
 *   ① 缺失（`!exists`）② 存在但无效（`exists && error`）③ 存在且合法却没贡献声明（其余）。
 */
function missingPolicyLayers(layers: PolicyLayerFact[]): PolicyLayerFact[] {
  return layers.filter((l) => !l.exists);
}
function invalidPolicyLayers(layers: PolicyLayerFact[]): PolicyLayerFact[] {
  return layers.filter((l) => l.exists && !!l.error);
}
function emptyDeclaredPolicyLayers(layers: PolicyLayerFact[]): PolicyLayerFact[] {
  return layers.filter((l) => l.exists && !l.error && l.declarationCount === 0);
}

/**
 * 问题层的「下一步怎么办」——**三分**，警告与 `policy status` 末尾那句共用（同源展示）：
 * - **缺失** → 到**该层路径**放置策略文件（`--policy` 覆盖 system 层）；
 * - **存在但无效** → **修复该文件**（附 `error` 摘要），**绝不说"放置"**——文件本来就在；
 * - **存在且合法但 0 条** → 如实说明该文件未贡献任何声明。
 */
function policyLayerFixHint(layer: PolicyLayerFact): string {
  const fallback =
    layer.layer === 'system' ? 'configs/policy.default.yaml' : '<workspace>/.harness/policy.yaml';
  const where = layer.path || fallback;
  if (!layer.exists) {
    return layer.layer === 'system'
      ? `补齐 system 层：在 ${where} 放置策略文件，或用 --policy <path> 显式指定`
      : `补齐 project 层：在 ${where} 放置策略文件`;
  }
  if (layer.error) {
    return layer.layer === 'system'
      ? `修复 system 层：${where} 已存在但无法解析（${layer.error}），修好该文件即可，也可用 --policy <path> 指向可用策略`
      : `修复 project 层：${where} 已存在但无法解析（${layer.error}），修好该文件即可，无需新建`;
  }
  return `${layer.layer} 层：${where} 合法但未贡献任何声明（0 条），检查文件内容是否为空`;
}

/**
 * AC4：部分装载警告（**不阻断运行**）——有层有声明而另一层不成时，按**三态**如实指认
 * 问题层（缺失 / 存在但无法解析 / 合法但 0 条声明）并给出各自正确的补救动作；
 * **不再把"存在但解析失败"误报成"缺失 + 请放置文件"**。
 *
 * 事实来自 `inspectPolicyLayers`（与 `policy status` 同一产物、同一判据），只写 stderr
 * （console.warn），不污染 stdout 的 JSON 通道。
 */
function warnPartialPolicyLoad(flags: Map<string, string>): void {
  const flagged = partialPolicyLayers(inspectPolicyLayers(policyLayerCandidates(flags)));
  if (flagged.length === 0) return;
  const missing = missingPolicyLayers(flagged);
  const invalid = invalidPolicyLayers(flagged);
  const empty = emptyDeclaredPolicyLayers(flagged);
  const summary = [
    missing.length > 0 ? `缺 ${missing.map((l) => l.layer).join('、')} 层` : '',
    invalid.length > 0 ? `${invalid.map((l) => l.layer).join('、')} 层存在但无法解析` : '',
    empty.length > 0 ? `${empty.map((l) => l.layer).join('、')} 层文件合法但未贡献任何声明` : '',
  ]
    .filter(Boolean)
    .join('；');
  // 有"存在但无效"的层时，装载路径（`loadPolicyArtifacts`）紧接着就会 fail-loud 抛错 ——
  // 别说"仍按现有层继续运行"（那会和随后那条"策略文件解析失败：…"自相矛盾）。
  const tail =
    invalid.length > 0
      ? '（解析失败的层不会被采用，非法策略会使装载 fail-loud 报错）'
      : '（仍按现有层继续运行，未完整生效）';
  console.warn(`[policy] 部分装载：${summary}${tail} —— ${flagged.map(policyLayerFixHint).join('；')}`);
}

/**
 * BRIEF-15「错误场景」：策略装载失败必须 **fail-loud 且含文件路径**。
 *
 * 背景：`<ws>/.harness/policy.yaml`（或 `--policy` 指定的 system 层）YAML 非法时，
 * `composeHarness` → `loadPolicyArtifacts` 抛出的是 **js-yaml 原文**（如
 * `unexpected end of the stream within a flow collection`），**不含文件路径** ——
 * 候选层不止一个（system / project），用户无从知道是哪个文件坏了，
 * 是"看着配了其实没配"的变体。
 *
 * 归因方式（零新依赖；**不改 `PolicyLoader` 的任何执法判定**）：复用**只读**的
 * `inspectPolicyLayers` 既有事实 —— 「文件存在、但解析出 0 条声明」即**该层解析失败**
 * （PolicyLoader.ts:86-95，与装载路径同一个 `parsePolicyYaml`，故归因同源）。
 *
 * 判定顺序：
 *   ① 有「存在但 0 条」的层 → **精确归因**，把这些路径逐条拼进消息；
 *   ② 否则看装载器自身的策略文案（`policy loader:` / `policy compile error:`，
 *      如两层文件都缺、或 YAML 合法但编译期拒绝未知 key）→ 列出**两层候选路径**
 *      （精确到层成本高，退化为让用户能逐个打开核对）；
 *   ③ 都不是（异常来自策略之外，如 behavior IR / 工具构造）→ **原样返回原异常**，
 *      绝不改写无关错误的文案。
 *
 * @returns 包装后的 `Error`（策略装载相关失败）；非策略失败时返回**原异常本身**。
 */
function wrapPolicyLoadFailure(err: unknown, flags: Map<string, string>): unknown {
  const candidates = policyLayerCandidates(flags);
  const reason = (err as Error | undefined)?.message ?? String(err);
  const layers = inspectPolicyLayers(candidates);

  // ① 精确归因：存在的层解析出 0 条 ⇒ 就是它坏（YAML 非法 / 结构不是 policy 映射 / 读不到）
  const broken = layers.filter((l) => l.exists && l.declarationCount === 0);
  if (broken.length > 0) {
    return new Error(`策略文件解析失败：${broken.map((l) => l.path).join(' 或 ')}（${reason}）`);
  }

  // ② 退化归因：装载器自己的策略文案，但层文件无法逐一定位 → 两层候选路径都列出
  if (/policy loader|policy compile error/i.test(reason)) {
    const declared = layers.filter((l) => l.declarationCount > 0);
    const suspects =
      declared.length === 1
        ? declared[0]!.path
        : `可能来自 ${candidates.systemPath} 或 ${candidates.projectPath}`;
    return new Error(`策略装载失败：${suspects}（${reason}）`);
  }

  // ③ 非策略失败：原样返回，保持既有错误文案与处理路径逐字不变
  return err;
}

/**
 * 目录读取 + 告警的统一入口（task 093 / Round 20）：**用户态 catalog 优先 → 包内兜底**。
 *
 *   - 用户态文件损坏 → 回落包内并打 `load.warning`（不静默当空表、不抛、不改退出码）；
 *   - 用户态文件是空表（`{}`）→ 空目录**生效**，同样打一条说明（不会"清了文件还在算旧价"）；
 *   - **包内检查保持逐字不变**（无条件 `warnMissingBuiltinConfig`）：包内快照缺失是
 *     「configs 没随包安装」的**唯一可观测信号**（release-gate 9 的 install-smoke 就靠它），
 *     用户态目录只是兜底优先级更高，不该把这条缺陷信号吞掉。
 */
function loadCatalogWithWarnings(root: string, builtinImpact: string): ModelCatalog {
  const load = loadModelCatalogDetailed(root);
  if (load.warning !== undefined) console.warn(load.warning);
  warnMissingBuiltinConfig(root, 'model-catalog.json', builtinImpact);
  return load.catalog;
}

/**
 * UsageStore 工厂（task 086/087/092）：价目表 + 目录价源 + 用户覆盖 + strict 开关。
 * 查价实现与 UsageProjection 共用 @vessel/shared/pricing。
 * 用户覆盖文件 `~/.vessel/pricing.override.json` 与内置 configs/pricing.json 分离，
 * 覆盖优先级最高（见 docs/PRICING.md §11）。
 */
function createUsageStore(opts: { strict?: boolean } = {}): UsageStore {
  // G-15 后续：价目/目录与策略**同源**——取 CLI 自带的那份 configs（安装态 = <包>/dist/configs），
  // 不再从 cwd 上溯（`repoRoot()` 在安装态找不到 configs/，会静默降级成兜底价 / 空目录）。
  const root = builtinConfigRoot();
  // 缺文件时 loadPricing / loadModelCatalog 静默返回兜底值：这里补一条明确警告，但不失败。
  warnMissingBuiltinConfig(root, 'pricing.json', '价目表降级为 default 兜底价（usage 成本可能算错）。');
  // 目录另有用户态层（`~/.vessel/model-catalog.json`，`pricing sync` 的默认落点）：
  // 读的是「用户态优先 → 包内兜底」，但包内缺失的告警照旧（那是 configs 没随包安装的信号）。
  const catalog = loadCatalogWithWarnings(root, '模型目录为空（目录价与 vessel models 的价格注解缺失）。');
  const override = new PricingOverrideStore({ rootDir: resolveUsageRoot() }).source();
  return new UsageStore({
    pricing: loadPricing(root),
    catalog: catalogPriceSource(catalog),
    override,
    strict: opts.strict,
    multiplierOf: providerCostMultiplierResolver(),
  });
}

/**
 * 成本倍率读盘失败告警的**进程内去重表**（key = `<providers.json 路径>\0<失败原因>`）。
 *
 * 去重策略与理由见 `warnCostMultiplierFallback`。只在读盘**失败**时增长，
 * 条目数 = 本进程出现过的坏文件数，量级可忽略。
 */
const warnedCostMultiplierFallbacks = new Set<string>();

/**
 * `providerCostMultiplierResolver()` 读盘失败时的**可见降级**告警（同一原因只打一次）。
 *
 * 去重策略：模块级 `Set<string>`，key = `<providers.json 路径>\0<失败原因>`。
 *   - **为什么是模块级**：一次用户操作可能构造多个 `UsageStore`（`createUsageStore()`
 *     在 `cmdRun` / TUI / usage 各命令各自调用一次），同一份坏文件会被读多遍；
 *     逐次告警 = 同一句话刷两遍。进程内每份坏文件只说一次：足够可见，也不刷屏。
 *   - **为什么 key 要带路径 + 原因，而不是一个布尔量**：布尔量会把「修好 A 之后 B 又坏了」
 *     一并吞掉（进程还没退出）；带路径后不同根目录互不影响——测试各自注入临时 root，
 *     用例之间不会因为前一个用例打过告警而漏报。
 *   - 告警点放在**读盘处**（构造解析器时一次），而不是返回的 `(provider) => number`
 *     闭包里：计费是按 provider 逐行解析的，放在闭包里就是「每条计费行刷一条」。
 *
 * 只做提示：不改退出码、不改金额口径（调用方仍按 `DEFAULT_COST_MULTIPLIER` 计算）。
 */
function warnCostMultiplierFallback(err: unknown, providersFile: string | undefined): void {
  const reason = err instanceof Error ? err.message : String(err);
  const file = providersFile ?? '（ProviderStore 构造失败，未取得路径）';
  const key = `${file}\u0000${reason}`;
  if (warnedCostMultiplierFallbacks.has(key)) return;
  warnedCostMultiplierFallbacks.add(key);
  console.warn(
    `[vessel] provider 成本倍率读取失败：${reason}\n` +
      `  受影响文件：${file}\n` +
      `  本次按默认倍率 1× 计算：所有 provider 的倍率一律当 1×（成本仍照常统计，但展示可能失真）。\n` +
      `  修复：vessel provider list（会 fail loud 报出同一原因）或手工修好该文件；本命令不改动、不删除原文。\n` +
      `  本告警同一原因在本次进程内只出现一次。`,
  );
}

/**
 * provider 成本倍率解析（task 094）：读 `~/.vessel/providers.json`（`VESSEL_PROVIDER_ROOT` 可覆盖）。
 *
 * 只用**读**路径（不建 CredentialStore，不碰密钥/迁移）；读盘失败（文件损坏等）
 * 仍按「没有倍率」处理——统计不该因为 provider 配置坏了就跑不出来。缺省倍率 1，金额口径不变。
 *
 * 但**降级必须可见**：`ProviderStore.rawLoad()` 对非法 JSON / 非数组 / 坏条目 / 非法配置
 * 一律 throw，所以下面的 `catch` 是**可达**的；原来只写一个 `{}` 就返回，会让
 * `providers.json` 一坏、**所有** provider 的倍率静默变成 1×、成本展示静默失真且零提示。
 * 现在补一条含**原因**与「本次按默认倍率 1× 计算」的告警（见 `warnCostMultiplierFallback`，
 * 同因同文件每进程一条）。倍率本身的修理由 `vessel provider` 命令 fail loud 暴露。
 *
 * 导出仅为测试（与 `warnMissingBuiltinConfig` / `pricingSyncMismatchWarning` 同例）。
 */
export function providerCostMultiplierResolver(): (provider: string) => number {
  let multipliers: Record<string, number> = {};
  let providersFile: string | undefined;
  try {
    const store = new ProviderStore({});
    providersFile = store.providersFile;
    multipliers = store.costMultipliers();
  } catch (err) {
    // 兜底保留（数值口径仍是 `?? DEFAULT_COST_MULTIPLIER`）：一个坏配置文件不该让统计/界面整体不可用。
    warnCostMultiplierFallback(err, providersFile);
    multipliers = {};
  }
  return (provider: string) => multipliers[provider] ?? DEFAULT_COST_MULTIPLIER;
}

/** 解析 `--cost-multiplier`（094）：非负有限数字，非法 fail loud（exit 2）。 */
function parseCostMultiplier(raw: string, label = '--cost-multiplier'): number {
  const value = Number(raw);
  return assertCostMultiplier(value, `${label}（收到 "${raw}"）`);
}

/**
 * 默认 ProviderStore（task 034；task 106 起收敛到 `createDefaultProviderStore`）。
 *
 * 语义不变：附加 CredentialStore —— Windows 优先 DPAPI 加密 secrets.json，其余显式
 * 降级 plaintext；apiKey 写入走 secretRef，providers.json 不再落明文，读取经 store
 * 解析回 apiKey。TUI（`runChat`）复用同一工厂，避免两条构造路径漂移。
 * 真实 ~/.vessel 下的凭据迁移只在 CLI 真正运行时触发（测试一律注入临时 root，绝不碰真实目录）。
 */
function defaultProviderStore(opts: { backupKeep?: number } = {}): ProviderStore {
  return createDefaultProviderStore(opts);
}

/** 原子写文本文件（<file>.tmp → rename），用于 `vessel provider export --out`。 */
function writeTextAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  renameWithRetry(tmp, file);
}

/**
 * 缺口 2（BRIEF-13 独立验收）：win32 下 `.cmd` / `.bat` **不是可执行文件**，必须经 shell
 * （cmd.exe）才能启动。`resolveSpawnCommand`（packages/tools，本卡不动）只对包管理器白名单
 * 开 shell，所以 `command: "some-tool.cmd"` 会走直连 spawn —— Node 对 .cmd/.bat 直接拒绝
 * （CVE-2024-27980 之后是显式 EINVAL），用户最终只看到一句含糊的 `spawn EINVAL`。
 *
 * 判定与 `resolveSpawnCommand` **逐字对齐**：win32 + `.cmd`/`.bat` 后缀 + 不在白名单。
 * 白名单命令（npx/npm/pnpm/yarn/uvx 自身不带后缀）由那边开 shell，命不中这里。
 *
 * 本卡（**windowsShim 判定共用**）：判定本体已搬进**零依赖叶子模块** `./windowsShim.js`
 * （**唯一实现**），本文件与 `tui/chat.ts` **各自 import 同一份**、都不再自带第二份
 * （改前是两份实现，且全仓零测试引用 ⇒ 只改一面必无声分叉：另一面对 `.cmd`/`.bat`
 * 要么硬 spawn 得含糊的 ENOENT/EINVAL、要么拒绝一条本来可用的命令）。本文件只
 * re-export 以保住既有导出面（`cli.windowsShimHint`，运行期身份守卫见
 * `cli.test.ts`「本卡①/②」）——语义、注释与用例都在 `windowsShim.ts` 与两面的本卡块里。
 */
export { windowsShimHint };

/**
 * G-11 MCP 半（BRIEF-13）：读 `~/.vessel/mcp.json` → 构造 transport → 写进 compose 选项。
 *
 * 失败语义（CLI 与 TUI **故意不同**，各按自己的处境取舍）：
 *  - **单个 server 起不来 → 降级**：warn 后跳过，其余 server 照常接上，不阻断本次运行
 *    （`createMcpConnections` 已按 server 逐个 try/catch，failures 由调用方打印）；
 *  - **配置本身坏了**（JSON 非法 / 缺 name·command / 重名…）→ **fail-loud**：返回错误描述，
 *    由调用方中止（非 0 退出）。非交互场景若静默降级，用户只会看到"工具没接上"、
 *    却不知道是 `mcp.json` 写错了 —— 本仓反复踩过的"文案说接上了、实际没接"。
 *
 * 返回 `null` = 成功（含"没配置文件 / 没 server"）；返回字符串 = 配置错误的人话描述。
 * TUI 侧对应物是 `chat.ts` 的 `loadMcpConnections()`：那里配置坏了只警告、不拒绝启动。
 */
function applyMcpConnections(opts: ComposeOptions): string | null {
  try {
    const servers = new McpConfigStore().load();
    if (servers.length > 0) {
      // 缺口 2：win32 下非白名单的 .cmd/.bat **不 spawn**（注定失败），直接记入 failures，
      // 走既有「未启动（已跳过）」输出通道并带上可操作原因 —— 不降级成含糊的 ENOENT/EINVAL。
      const spawnable: typeof servers = [];
      const shimFailures: McpConnectionFailure[] = [];
      for (const s of servers) {
        const hint = windowsShimHint(s.command);
        if (hint === null) spawnable.push(s);
        else shimFailures.push({ serverName: s.name, reason: hint });
      }
      const { connections, failures } = createMcpConnections(spawnable);
      if (connections.length > 0) opts.mcp = connections;
      for (const f of [...shimFailures, ...failures]) {
        console.warn(`[vessel] MCP server "${f.serverName}" 未启动（已跳过）：${f.reason}`);
      }
    }
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/**
 * `vessel policy status` — 只读地展示「生效策略来自哪些层」（G-17 / BRIEF-15 AC2/AC3）。
 *
 * **退出码（本卡裁决，取代此前的「恒为 0」）**：判据**只有一条** ——
 * `combined.compiled === false`（即 `compileError` 出现，`vessel run` 在同一组候选路径下
 * 会装载失败）⇒ **非 0（取 1）**；`compiled === true` ⇒ **0**（成功的只读查询照旧）。
 *
 * 复现（改前）：本函数两个出口都写死 `return 0`，与 `compiled` 无关 ——
 * `vessel policy status --json` 在 `compiled:false` 时**退 0**，于是 CI 里
 * `vessel policy status && vessel run …` 会在"策略根本装不起来"的仓库上继续往下跑。
 * 改动前那段注释（"只读查询不是错误 + 不混淆两类失败"）里**只有后半句成立**：
 * 「层文件缺失 / 存在但解析失败」与「合成后编译失败」确实是两类失败，但**这两类的区别由
 * body/文案承载**（逐层诊断行 + `--json` 的 `missing` / `invalid` / `compiled` /
 * `compileError`），**不需要、也不该用"一律退 0"来承载** —— 那等于让 CI 绿灯。
 *
 * 为什么取 `1` 而不是 `2`：
 *   - `vessel run` 在同一份坏策略上**本来就退 1**（`composeHarness` → `loadPolicyArtifacts`
 *     抛错 → 非 `--json` 由入口 `.catch` → `process.exit(1)`；`--json` 由 `main()` 的
 *     `fail(1, …)`）—— 两条命令对**同一个事实**给出同一个退出码，脚本里可互换判定；
 *   - `2` 在本 CLI 一致地留给「用法/校验错误」（缺参数、非法日期、未知子命令…），
 *     而这里的命令行用法完全正确。
 * 非 0 出口复用既有 `fail(code, msg, flags, …)`：`--json` 时 stderr 信封的 `code`
 * 与退出码**同源**（同一个数铸出），人类模式仍是 stderr 上的同一句人话。
 * 合成的**只读性质不变**：不写盘、不改执法、不阻断 —— 只多了一个退出码。
 *
 * `--json` 时 stdout 只有一段 JSON（`emitJson` 纪律；失败时**照常**产出该文档，
 * 信封只进 stderr），人话模式逐层打印
 * 层名 / 路径 / 是否存在 / 声明条数 / 哈希 + 生效层序 + 问题说明。
 *
 * 层次事实**三分**（缺失 / 存在但无法解析 / 存在且合法但 0 条声明），三态都可从输出读出：
 * JSON 的每一层都带 `error`（无效时非空），并单列 `invalid`；人类模式在该层行显示
 * 「解析失败：…」。事实与装载路径同源：`inspectPolicyLayers`
 * （packages/policy/src/risk/PolicyLoader.ts）。
 *
 * G-18（**口径分裂修复**）：逐层事实**看不到**「只有编译器才认得出」的错误——如
 * `shell.deny: [not-a-real-category]` 时各层齐备、无 `error`（界面说"该层有效"），
 * 而 `run` 的装载路径当场抛 `policy compile error: unknown shell.deny category`。
 * 故此处另加一项**合成后可编译性**（`inspectCombinedPolicy`，与 `loadPolicyArtifacts`
 * 同一次调用）：JSON 增 `compiled` / 失败时 `compileError`（**additive**，既有字段
 * `layers`/`effectiveOrder`/`missing`/`invalid`/`emptyDeclared` 语义与形状一律不变）；
 * 人类模式加一行「合成校验」，失败时**显而易见**地点明 `vessel run` 会失败。
 * 合成失败**不塞进** `layers[].error`——那会把"层文件本身解析失败"与"合成后编译失败"
 * 混为一谈，且后者归属哪一层是歧义的。逐层视角与合成视角各司其职。
 *
 * **判据边界的如实声明**：`compiled === false` 不仅覆盖上面那类"只有编译器才认得出的错"，
 * 也覆盖 `PolicyLoader.ts` 的 `policy loader: no policy declaration found`（两层都缺 /
 * 都解析不出声明）——`inspectCombinedPolicy` 的 JSDoc 明说这**同样是 `run` 的真实结局**。
 * 因此「一层都没有」现在也退 1；成因由消息正文与 `missing` / `invalid` 字段区分
 * （这正是"两类失败的区别由 body/文案承载"）。
 */
export function cmdPolicyStatus(flags: Map<string, string>): number {
  const candidates = policyLayerCandidates(flags);
  const layers = inspectPolicyLayers(candidates);
  // G-18：合成后可编译性 = 真实装载路径（`loadPolicyArtifacts`：mergeScopes → compilePolicy）
  // 的一次只读试跑；不抛、不写盘、不改执法。逐层 `layers` 与它**各司其职**，互不污染。
  const combined = inspectCombinedPolicy(candidates);
  // 生效层序 = 真正贡献了声明的层，按合成顺序（system 在前、project 在后）
  const effectiveOrder = layers.filter((l) => l.declarationCount > 0).map((l) => l.layer);
  // 问题层**三分**（与 AC4 警告**同一判据**）：`missing` 沿用既有形状（声明 0 条，AC3 已锁），
  // `invalid` / `emptyDeclared` 把"存在但无效"与"合法但 0 条"从 `missing` 里**显式拆出来**，
  // 消费方据此区分"文件不在"与"文件在但是坏的"。
  const missing = layers.filter((l) => l.declarationCount === 0);
  const absent = missingPolicyLayers(layers);
  const invalid = invalidPolicyLayers(layers);
  const emptyDeclared = emptyDeclaredPolicyLayers(layers);

  // 本卡裁决：合成后**不可编译** ⇒ 非 0（见函数头注释）。`compiled === true` 时为 `null`
  // ——成功路径**一个字节都不加**（不写 stderr、不改 stdout、退出码仍是 0）。
  // 两类失败（层文件缺失/解析失败 vs 合成后编译失败）的区别**由正文承载**，不由退出码：
  // 这里把成因写进消息，两类一律退 1。
  const compileFailure: string | null = combined.compiled
    ? null
    : `[vessel policy status] 合成策略无法编译：${combined.error}\n` +
      `  成因：${
        invalid.length > 0
          ? `${invalid.map((l) => l.layer).join('、')} 层存在但无法解析（层文件本身坏了）`
          : absent.length === layers.length
            ? '两层都缺（没有任何策略声明）'
            : '各层文件本身合法，但合成后编译失败（只有编译器才认得出的错误）'
      }。\n` +
      `  「层文件缺失 / 存在但解析失败」与「合成后编译失败」是**两类不同的失败**，` +
      `区别见上面的逐层诊断与 --json 的 missing / invalid / compiled / compileError 字段 —— ` +
      `**退出码不区分它们**（两类都退 1）。\n` +
      `  当前配置下 vessel run 会直接失败（同一条装载路径 mergeScopes → compilePolicy），` +
      `故退出码 1（与 vessel run 在同一份策略上的退出码一致；2 在本 CLI 留给用法/校验错误）。`;

  if (isJson(flags)) {
    emitJson({
      layers,
      effectiveOrder,
      missing: missing.map((l) => l.layer),
      invalid: invalid.map((l) => ({ layer: l.layer, path: l.path, error: l.error })),
      emptyDeclared: emptyDeclared.map((l) => l.layer),
      // G-18（**additive**）：既有字段不动，仅追加「合成后可编译性」；`compileError` 只在失败时出现
      // （成功时该键 `undefined`，`JSON.stringify` 会略去，消费方仍可只读 `compiled`）。
      compiled: combined.compiled,
      ...(combined.compiled ? {} : { compileError: combined.error }),
    });
    // 失败时**先**产出上面那份文档（消费方仍读得到 layers / compiled / compileError），
    // 再走既有 `fail` 出口：stdout 仍恰好一段 JSON（信封只进 stderr），退出码与信封同源。
    return compileFailure === null ? 0 : fail(1, compileFailure, flags);
  }

  console.log('[vessel] 生效策略层次（policy layers，只读）');
  for (const l of layers) {
    // 三态：缺失 / 解析失败（存在但无效）/ 存在（合法）
    const state = !l.exists ? '缺失' : l.error ? '解析失败' : '存在';
    const hash = l.hash ? `sha256:${l.hash}` : '-';
    const where = l.path || '(未配置路径)';
    const note = l.error ? `  解析失败：${l.error}` : '';
    console.log(`  ${l.layer.padEnd(7)} ${state}  声明 ${l.declarationCount} 条  ${hash}  ${where}${note}`);
  }
  console.log(
    effectiveOrder.length > 0
      ? `  生效层序: ${effectiveOrder.join(' > ')}（左侧为高层：profile/approval 取高层先声明者；deny 类列表取并集；低层只能加限制、不能放宽）`
      : '  生效层序: （无层生效——没有任何声明被装载）',
  );
  // G-18：合成后可编译性——逐层全绿也可能一编译就炸（如 shell.deny 未知类别）。
  // 文案**逐字不变**（失败必须显而易见）；退出码不在这里定，由函数末尾统一裁决
  // （`compiled === false` ⇒ 1，见函数头注释）。stdout 的诊断行一条不少 —— 退出码裁决
  // 不吞、不改渲染。
  console.log(
    combined.compiled
      ? '  合成校验: 可编译（与 vessel run 的装载路径同一套 mergeScopes → compilePolicy）'
      : `  合成校验: **无法编译** —— ${combined.error}（当前配置下 vessel run 会直接失败）`,
  );
  // 末尾说明同样**三分**措辞：缺 X 层 / X 层存在但无法解析 / X 层合法但 0 条声明。
  const problems = layers.filter((l) => !l.exists || !!l.error || l.declarationCount === 0);
  const issues = [
    absent.length > 0 ? `缺 ${absent.map((l) => l.layer).join('、')} 层` : '',
    invalid.length > 0 ? `${invalid.map((l) => l.layer).join('、')} 层存在但无法解析` : '',
    emptyDeclared.length > 0
      ? `${emptyDeclared.map((l) => l.layer).join('、')} 层文件合法但未贡献任何声明`
      : '',
  ]
    .filter(Boolean)
    .join('；');
  console.log(
    problems.length === 0
      ? '  缺失说明: 无（各层均已装载）。'
      : `  缺失说明: ${issues} —— ${problems.map(policyLayerFixHint).join('；')}`,
  );
  // 本卡裁决：人类模式同样在渲染完之后裁决退出码；失败说明走 stderr（既有 `fail` 出口的
  // human 闭包形态，与 `cmdBenchReport` 等一致），stdout 的只读诊断**逐字保留**。
  return compileFailure === null ? 0 : fail(1, compileFailure, flags, () => console.error(compileFailure));
}

/**
 * BRIEF-16 1C：mock 的**运行期可见性**（只加标注，不改 mock 行为/内容口径）。
 *
 * 实测痛点：无 provider 配置时默认 mock，`run --prompt '总结 README'` 真的读了工作区文件，
 * 回复里没有任何 mock 痕迹 → 新人确信"模型已接上"。两处标注共用本口径，且都只在
 * `usingMockProvider === true` 时生效（真实 provider 一个字节都不加）：
 * - `MOCK_PROVIDER_NOTICE`：回合开始**前**打到 **stderr** 的一行提示（stdout 零污染）；
 * - `MOCK_REPLY_MARK`：最终回复的**统一出口**前缀（见 `renderTurnFinalText` —— 它只给
 *   **模型回答**（`kind='success'`）加，非模型文本（error/budget/interrupted）不盖，见 `isModelReplyKind`）。
 */
const MOCK_PROVIDER_NOTICE =
  '[vessel] 当前使用内置 mock 模型（未连接真实模型）——配置真实模型：vessel setup 或 vessel provider add';
const MOCK_REPLY_MARK = '（mock 离线冒烟）';

/**
 * 给**模型回复**加 mock 标记的底层函数（BRIEF-16 1C②）。
 *
 * 读文件回显（`已通过 Read 工具读取工作区文件…`）、脚本命中回显、`fallbackText` 全部经此处，
 * 所以标记只加一次、不逐条改文案（也覆盖 chat() / stream() 两条 provider 路径）。
 * `usingMock === false`（真实 provider）时**逐字返回原串**（负对照）。
 * 幂等：文案自身已以 `（mock 离线冒烟）` 起头（如既有 `fallbackText`）时不重复叠加。
 *
 * **本函数的 `usingMock` 只回答"要不要加前缀"，不回答"这条文本是不是模型回答"**——
 * 后者由 `isModelReplyKind`（kind → 是否模型回答）判定，两步在 `renderTurnFinalText`
 * （`cmdRun` 的唯一出口）里合并。**不要在调用点直接用它 + 裸 `usingMockProvider`**：
 * 那正是本卡修的缺陷（`kind='error'` 的熔断文案被盖成"mock 离线冒烟…"）。
 *
 * 若将来 `run` 增加 `--json` 回复字段，标记必须继续走 `renderTurnFinalText`（把返回值放进
 * JSON 的回复字段），不得另起一行打印——`--json` 的 stdout 只允许出现一段 JSON。
 */
function renderFinalReply(finalText: string, usingMock: boolean): string {
  if (!finalText) return '(无文本回复)';
  if (!usingMock) return finalText;
  return finalText.startsWith(MOCK_REPLY_MARK) ? finalText : `${MOCK_REPLY_MARK}${finalText}`;
}

/**
 * BRIEF-18 —— 回合结束时的**唯一**呈现/退出码决策点（`TurnResult.kind` → 标题 + 退出码）。
 *
 * 复现（改前）：`cmdRun` 里 `runTurn` 是**正常返回**（只有抛异常才走 catch 的 `fail(1, …)`），
 * 旧写法 919 行无条件 `console.log('\n=== 最终回复 ===')`、933 行无条件 `return 0`。于是
 * `kind='error'`（熔断 `DenialLimitError` 把错误文案写进 `finalText`，AgentLoop.ts）
 * 时：**退出码 0 + 错误文案被印在「最终回复」标题下**——脚注里的 `kind=error` 人看得见、
 * 脚本看不见，`vessel run && 下一步` 会在失败后继续跑。
 *
 * 裁决（两个方向都钉死，防两类回归）：
 * - `error` ⇒ 标题**不冒充**最终回复（明示"回合以错误结束"，错误文本原样保留）+ 退出码 1
 *   （与既有 `fail(1, …)` 同一出口；`--json` 时信封的 `code` 由同一个数铸出，两者不可能不一致）。
 * - `success` ⇒ 标题与退出码**逐字不变**（`'\n=== 最终回复 ==='` / 0）——负对照：把一切都
 *   当成失败会让所有正常脚本报错。
 * - `budget` ⇒ **不算失败**：退出码 0、标题不变。理由：① `--max-steps` 是用户自己下的预算，
 *   且 budget 还覆盖"模型回了纯空文本"这条既有边界（AgentLoop.ts）；② 既有测试
 *   mockVisibility.test.ts:485-496 已**逐字钉住** budget 走 `=== 最终回复 ===` + `(无文本回复)`
 *   且 exit 0，并写明"改它是另一个决策，需独立验收"。可见性由既有的
 *   `=== turn … kind=budget … ===` 脚注行承担（stdout、可 grep；同处 :488 有断言）。
 * - `interrupted` ⇒ 退出码 0、标题不变。`vessel run` **当前到达不了**该分支：`cmdRun` 没有
 *   SIGINT → `loop.interrupt()` 的接线（全仓 SIGINT 只在 `startServe`，cli.ts:2256），真正的
 *   Ctrl+C 由 Node 默认信号处置直接终止进程，不经过这里；把它改成非零等于凭空发明一个失败信号。
 *
 * 取值联合**只有一处**（本卡收敛）：`turnText.ts` 的 `TurnKind`。此处原先写的是字面量
 * `'success' | 'error' | 'interrupted' | 'budget'`，而 `tui/chat.ts` 的 `TurnOutcomeLike`
 * 又各写了一份同样的字面量 —— 两份联合各自演进时，`switch` 的穷尽性检查会在一边生效、
 * 在另一边悄无声息。
 */
export type CliTurnKind = TurnKind;

/** 回合标题。刻意保留前导换行：`success` 时与旧写法逐字一致（一次 `console.log` 调用）。 */
export function turnHeader(kind: CliTurnKind): string {
  return kind === 'error' ? '\n=== 回合以错误结束 (kind=error) ===' : '\n=== 最终回复 ===';
}

/** 回合退出码：只有 `error` 非零；其余三种与今日一致（0）。 */
export function turnExitCode(kind: CliTurnKind): number {
  return kind === 'error' ? 1 : 0;
}

/**
 * 本卡 —— **哪些 kind 的 `finalText` 算「模型回答」**：CLI 侧的**唯一**口径。
 * 判据本体在 `turnText.ts` 的 `isModelReplyKind`（本卡收敛；此前是 CLI/TUI 各一份）。
 *
 * 复现（改前）：`renderFinalReply`（本文件 :780-783）只接 `(finalText, usingMock)` 两个入参，
 * 而 `cmdRun` 的唯一出口（原 :959）**无条件**把 `usingMockProvider` 传下去 ⇒ mock 会话里
 * `kind='error'` 的**harness 状态文案**（熔断 `DenialLimitError.message`，AgentLoop.ts
 * 把它写进 `finalText`）会被渲染成 `（mock 离线冒烟）same intent denied 3 times: …`。
 * 那句标记在断言"这条文本来自内置 mock 模型"，而它其实是 loop 的错误文案 ⇒
 * **说的和做的不一致**（正是 BRIEF-16 1C② 那句标记要防的事，被用在了它防不住的地方）。
 *
 * **TUI 侧早已按本口径处理**（所以本卡是"两个面不一致"，不是"两处都错"）：
 * `tui/chat.ts` 的 `renderTurnOutcome` 只把 `success` 交给 `renderTurnReply`（chat.ts:394-395），
 * `error` / `budget` / `interrupted` 三条各走自己的状态文案分支、**不盖**模型标记，
 * 且 chat.ts:377-380 写明了理由：**给非模型文本盖模型标记是另一种"说的和做的不一致"**。
 * 本卡的裁决就是把这句理由搬到 CLI —— 判据**只有一处**（`turnText.ts` 的 `isModelReplyKind`，
 * 本文件只 re-export），`cmdRun` 的唯一出口（`renderTurnFinalText`）调它。
 *
 * 逐条契约（与 TUI 逐字对齐；每条都有判别性用例，见 cli.test.ts「本卡」块）：
 *  - `success`     ⇒ 是模型回答 ⇒ mock 会话里**照旧**带标记（那是标记的**正当用途**，
 *                    也是"别把标记整个删掉"的负对照②）；
 *  - `error`       ⇒ harness 状态文案 ⇒ **不**盖标记，文本**原样保留**（不吞内容）；
 *  - `budget`      ⇒ 同上（本回合**没有**产出最终回复；空文本仍走 `(无文本回复)`）；
 *  - `interrupted` ⇒ 同上。
 * 真实 provider（`usingMock=false`）下四种 kind **逐字**返回原串（`renderFinalReply` 在
 * `usingMock=false` 时早退，本函数不改变这一条）。
 *
 * 为什么不把 kind 直接塞进 `renderFinalReply`：那个函数的语义是"给**模型回复**加标记"
 * （BRIEF-16 1C②），把 kind 塞进去会让"这条文本是不是模型回答"与"要不要加前缀"两件事
 * 重新耦合回一个函数里——恰恰是本次漂移的成因。这里显式分成两步。
 *
 * （乙）**已采用**（本卡修复）：判据搬进零依赖叶子模块 `apps/cli/src/turnText.ts`，
 * `cli.ts` 与 `tui/chat.ts` **各自 import 同一份实现**；`renderTurnOutcome` 的模型回复出口
 * `renderTurnReply` 也由同一个判据把门。本文件**不再自带判据**，只 re-export 以保持既有
 * 导出面（`cli.isModelReplyKind`）——语义、注释与用例都在 `turnText.ts` 与两面的「本卡」块里。
 *
 * **更正（本卡修；下面这段是旧文，留着做对照）**：本段原先写的是
 * 「（乙）的最小改法（本卡**未**采用，原因：本卡禁改 `tui/**`，且不许新增文件）…… ⇒
 * *一处口径、两个面共用*」—— 那句"一处口径、两个面共用"在**当时并不成立**，它描述的是
 * **没被采用的设想**；同一提交（`dfe55b9`）的提交信息却据此声称
 * "the two faces share one criterion" ⇒ **不实的提交信息**。事实是两份实现：
 * TUI 自己 `case 'success'`（第二份），CLI 一份；扩展时必然分叉 —— TUI 的 `switch` 穷尽
 * （新增 kind ⇒ 编译报错），CLI 那份对第五种 kind **静默返回 false**（不报错、悄悄走另一边）。
 * 现在（乙）已采用，判据只有 `turnText.ts` 一份，那句话才成立。
 * 判别性用例：`cli.test.ts`「本卡⑤/⑥/⑦」与 `tui/chat.test.ts`「本卡A/B」。
 */
export { isModelReplyKind };

/**
 * CLI 回合文本的**唯一渲染出口**（`cmdRun` 里就这一行 `console.log(...)`）。
 *
 * 与 TUI 的 `renderTurnOutcome`（chat.ts:385-397）同源口径：**非模型文本不盖模型标记**。
 * 真实 provider 与 `kind='success'` 的既有行为**逐字不变**（前者早退、后者仍走
 * `renderFinalReply` 的加标记分支）。
 */
export function renderTurnFinalText(kind: CliTurnKind, finalText: string, usingMock: boolean): string {
  return renderFinalReply(finalText, usingMock && isModelReplyKind(kind));
}

async function cmdRun(flags: Map<string, string>): Promise<number> {
  const workspace = path.resolve(flags.get('workspace') ?? process.cwd());
  // 默认 policy/behavior 取 CLI 自带的那份（与 cwd 无关）；--policy/--behavior 显式覆盖仍最高优先
  const configRoot = builtinConfigRoot();
  // G-17（BRIEF-15 AC4）：不静默部分装载 —— 有层有声明而另一层缺失时明确告警，但不阻断运行。
  warnPartialPolicyLoad(flags);
  const prompt = flags.get('prompt') ?? (process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8').trim());

  // provider resolution: explicit --provider wins; else the current default
  // provider from ~/.vessel (provider switch); else mock with a hint.
  const store = defaultProviderStore();
  const explicitProvider = flags.get('provider');
  const currentId = explicitProvider ?? (store.getCurrent() !== 'mock' ? store.getCurrent() : 'mock');
  const currentCfg: ProviderConfig | undefined = currentId === 'mock' ? undefined : store.get(currentId);
  // task 103: 供应商构造收敛到 providerFactory 一条路径 —— preset id `opencode-go`
  // 自动解析为专用 provider（x-opencode-session + 具名 UA），不再走通用 openai-compatible 客户端。
  const plan = planProvider({
    config: currentCfg,
    explicitProvider,
    baseUrl: flags.get('base-url') ?? process.env.VESSEL_BASE_URL,
    apiKey: flags.get('api-key') ?? process.env.VESSEL_API_KEY,
    model: flags.get('model') ?? process.env.VESSEL_MODEL,
  });
  const model = plan.model;
  if (missingBaseUrl(plan)) {
    const msg = `[vessel] ${plan.providerName} 需要 --base-url 或 VESSEL_BASE_URL（或先 vessel provider add 配置）`;
    return fail(2, msg, flags, () => console.error(msg));
  }
  const realProvider = buildRealProvider(plan);
  // BRIEF-16 1C：本次运行是否落在**离线 mock**。判据与下面 `realProvider ?? new MockProvider(...)`
  // 的构造分支共用**同一个变量**——`buildRealProvider` 对非真实 provider（plan.real=false）
  // 一律返回 `null`（providers/providerFactory.ts:107-108），所以"提示/标记"与实际使用的
  // provider 不可能各说各话（负对照：真实 provider 时该值为 false）。
  const usingMockProvider = realProvider === null;
  const provider =
    realProvider ??
    // default smoke script: read README.md (if prompt asks) then answer from the
    // result; a failed read gets a friendly hint instead of the raw TOOL_FAILURE
    // text; any other real input gets a deterministic readable fallback (G-01).
    new MockProvider(
      [
        {
          when: /阅读|read|总结|summary/i,
          ifNoToolResult: true,
          response: { toolCalls: [{ name: 'Read', arguments: { path: '{cwd}/README.md' } }] },
        },
        {
          when: /.*/,
          minToolResults: 1,
          whenToolResult: /^\[(TOOL_FAILURE|DENIED|INVALID_ARGS|TIMEOUT|SANDBOX_DENIAL)\]/,
          response: { text: '（mock）未能读取工作区 README.md——文件可能不存在或被拒。请确认工作区包含 README.md；要获得真实回答请配置模型：vessel setup。' },
        },
        { when: /.*/, minToolResults: 1, response: { text: '已通过 Read 工具读取工作区文件。内容开头：\n{last_tool_result}' } },
      ],
      {
        model,
        vars: { cwd: workspace },
        fallbackText: '（mock 离线冒烟）已收到你的输入。当前无匹配脚本应答——配置真实模型后即可获得完整回答：vessel setup（交互向导）或 vessel provider add。',
      },
    );

  // permission 提成局部变量：既传给 composeHarness，也用于 G-10 会话登记
  // （ComposeOptions.permission 是可选的，登记表的 permission 字段必填）。
  const permission = (flags.get('permission') ?? 'workspace-write') as 'read-only' | 'workspace-write' | 'danger-full-access';
  const composeOpts: ComposeOptions = {
    workspaceRoot: workspace,
    provider,
    model,
    policySystemPath: flags.get('policy') ?? path.join(configRoot, 'configs', 'policy.default.yaml'),
    // G-15：project 级策略（可选层）——工作区自带 <ws>/.harness/policy.yaml 时并入，缺失不报错
    policyProjectPath: resolveProjectPolicyPath(workspace),
    behaviorIRPath: flags.get('behavior') ?? path.join(configRoot, 'configs', 'behavior.default.yaml'),
    maxSteps: Number(flags.get('max-steps') ?? 64),
    // `vessel resume` 透传：不给 sessionId 时 Session.open 会新建空会话，恢复语义失效。
    sessionId: flags.get('session-id'),
    permission,
    // V0.9 usage statistics: record this session's model usage persistently
    // （task 086：--strict 只用模型专属价目，未收录模型按 0 计价）
    usageStore: createUsageStore({ strict: flags.has('strict') }),
    usageProvider: currentId,
  };
  // G-11 MCP 半：读 ~/.vessel/mcp.json → 构造 transport → 传给 composeHarness。
  // 配置非法由 McpConfigStore.load() fail-loud；**单个 server 起不来只降级**，不阻断本次运行。
  const mcpConfigError = applyMcpConnections(composeOpts);
  if (mcpConfigError !== null) {
    // 配置本身坏了：明确报错并中止（fail-loud），不要静默继续
    const msg = `[vessel] MCP 配置错误：${mcpConfigError}`;
    return fail(1, msg, flags, () => console.error(msg));
  }
  // 缺口 1（BRIEF-13 独立验收）：applyMcpConnections 里 `new StdioTransport(...)` 已经真的
  // **spawn 了子进程**；若随后 composeHarness 抛错，这些连接没有任何 harness 持有（连返回值
  // 都没有）→ 孤儿子进程 + 吊住事件循环。这里就地回收，与 TUI 侧 chat.ts 的同类兜底一致。
  // 成功那份由下方 finally 的 harness.close() 负责，此处只补**失败**路径。
  let harness: ComposedHarness;
  try {
    harness = await composeHarness(composeOpts);
  } catch (err) {
    for (const conn of composeOpts.mcp ?? []) {
      try {
        await conn.transport.close();
      } catch {
        /* 回收失败不掩盖原始错误 */
      }
    }
    // 原样 rethrow（唯一例外见下行）：非策略错误的信息与既有路径逐字一致（不包装、不改写）。
    // BRIEF-15「错误场景」：策略装载失败（典型：策略文件 YAML 非法）**必须让用户看到是哪个
    // 文件**——`wrapPolicyLoadFailure` 只包装策略相关的失败，其余异常原样返回（见其注释③）。
    throw wrapPolicyLoadFailure(err, flags);
  }

  // G-10：让 CLI 建的会话进入会话登记表，否则 `vessel sessions list` 看不到它、无法 resume。
  try {
    const registry = new SessionRegistry();
    const now = new Date().toISOString();
    // resume（--session-id 已存在）时保留原 createdAt，只让 put() 刷新 updatedAt（最近活动）。
    const existing = registry.get(harness.session.sessionId);
    const meta: SessionMeta = {
      id: harness.session.sessionId,
      workspaceRoot: composeOpts.workspaceRoot,
      provider: currentId,
      model: composeOpts.model,
      permission,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    registry.put(meta);
  } catch (err) {
    // 登记失败不得阻断本次运行（只提示）
    console.warn(`[vessel] 会话登记失败（不影响本次运行）：${(err as Error).message}`);
  }

  for (const w of harness.behaviorWarnings) console.warn(`[behavior] ${w}`);

  // BRIEF-16 1C①：**回合开始前**显式声明"这次没有真模型"。走 stderr —— stdout 的最终回复、
  // 以及 `--json` 的"stdout 只有一段 JSON"契约都不受影响（真实 provider 时整段不执行）。
  if (usingMockProvider) console.error(MOCK_PROVIDER_NOTICE);

  try {
    const result = await harness.loop.runTurn(prompt || '（无输入）');
    /**
     * 本卡（③）—— `--json` 下 `run` 的 **stdout 唯一出口**：`emitJson(...)` 一段 JSON。
     *
     * 复现（改前，静态可核）：本函数在 `--json` 下**没有任何** `emitJson`，而是依次
     * `console.log` 回合标题、模型回复、`=== turn … ===` 脚注、（可选）拦截审计、
     * `printEnforcementTelemetry` 若干行、`会话日志: …` ⇒ stdout 是一段人类文本，
     * `JSON.parse(stdout)` 必抛，违反 `output.ts` 的「`--json` 时 stdout **只允许**
     * 出现一段可解析 JSON」契约（`docs/CAPABILITY-MATRIX.md` 与
     * `EVALUATION-REPORT-13.md` 均已记为已知缺陷）。
     *
     * 形状**照本仓既有命令**（`usage` / `models` / `policy status` 的 `--json` 分支）：
     * `if (isJson(flags)) { emitJson(<平铺对象>); }`，**不自创信封**；字段名取
     * **同一批事实源**（`TurnResult` 的 kind/finalText/steps/toolCalls/turnId + 会话日志路径），
     * 与本函数人类分支打印的**是同一批值**（负对照：把任一字段写成别的来源即与人类输出分叉）。
     * 与 `usage` / `models` 不同的是**不在此提前 `return`**：本命令的退出码由 `kind` 决定（BRIEF-18），
     * 所以文档产出后仍要走到下面同一个 `turnExitCode` 出口——与 `cmdPolicyStatus` 同序。
     *
     * `finalText` 走 `renderTurnFinalText`（与人类分支**同一个**出口）：`renderFinalReply`
     * 的 JSDoc（本文件 :834-835）明确要求"若将来 `run` 增加 `--json` 回复字段，标记必须继续走
     * `renderTurnFinalText`（把返回值放进 JSON 的回复字段），不得另起一行打印"。
     *
     * 顺序与 `cmdPolicyStatus` 一致：**先**产出文档（失败不缩水产物），**再**定退出码 —— 下面
     * `exitCode !== 0` 时仍走既有 `fail()` 出口，信封只进 stderr、`code` 与退出码同源。
     *
     * 本卡③（**加法补齐**，不改既有字段）：人类分支能看到的量，`--json` 消费方也要能读到——
     *   - `durationMs`：`TurnResult` 的**既有**标量（`AgentLoop` 每回合都在算），此前只有字节
     *     消费方读不到；**如实声明**：人类分支今日**并不**打印它（`turnHeader` 只有标题、
     *     脚注只有 turnId/kind/steps/toolCalls），所以这一条不是"人看得见、脚本看不见"，
     *     而是"机器可读面缺一个已存在的标量"（见交付说明⑥）；
     *   - `enforcement`：人类分支的 `printEnforcementTelemetry` 那几行（计数/来源/沙箱状态/
     *     最近 3 条）的结构化形态。**取数与人类分支共用同一个函数**（`enforcementTelemetryDoc`，
     *     它就是 `printEnforcementTelemetry` 的唯一取数口径，人类行由它渲染出来）⇒ 两处不可能
     *     各说各话。形状**照实际渲染的字段**：counts / sources / status(backend/enabled/active/
     *     degraded/fallbackReason) / recent(source,type,ts,detail,meta) —— **不发明**字段，
     *     拿不到的（如本是自由文本拼接的东西）就不放。
     */
    if (isJson(flags)) {
      emitJson({
        kind: result.kind,
        finalText: renderTurnFinalText(result.kind, result.finalText, usingMockProvider),
        steps: result.steps,
        toolCalls: result.toolCalls,
        durationMs: result.durationMs,
        turnId: result.turnId,
        sessionLog: harness.session.logPath,
        enforcement: enforcementTelemetryDoc(harness),
      });
    } else {
      // BRIEF-18：标题由 kind 决定 —— `kind='error'` 时**不得**把 loop 的错误文案挂在
      // 「最终回复」标题下冒充模型回答（见 turnHeader 的注释）。success/budget/interrupted
      // 的标题逐字不变。
      console.log(turnHeader(result.kind));
      // 统一出口：mock 前缀只在这里加一次（读文件回显 / 脚本命中回显 / fallbackText 全覆盖）。
      // 本卡：**非模型文本不盖模型标记** —— kind 也是入参（`renderTurnFinalText`），
      // `kind='error'` 的熔断文案 / `budget` / `interrupted` 不再被盖成"（mock 离线冒烟）…"，
      // 与 TUI 的 `renderTurnOutcome` 同一口径（TUI 侧 :385-397，理由见那里的注释）。
      console.log(renderTurnFinalText(result.kind, result.finalText, usingMockProvider));
      console.log(`\n=== turn ${result.turnId} kind=${result.kind} steps=${result.steps} toolCalls=${result.toolCalls} ===`);
      const denials = harness.session.replay().filter((r) => r.type === 'audit/denial');
      if (denials.length > 0) {
        console.log(`\n=== 策略拦截审计 (audit/denial × ${denials.length}) ===`);
        for (const d of denials) {
          console.log(`  - ${(d as { toolName: string }).toolName} ${(d as { reason: string }).reason} [ref=${(d as { ruleRef?: string }).ruleRef}]`);
        }
      }
      // task 074 enforcement telemetry query seam (data face: list + counts + status)
      printEnforcementTelemetry(harness);
      console.log(`会话日志: ${harness.session.logPath}`);
    }
    // BRIEF-18：退出码由 kind 决定（唯一决策点 = turnExitCode）。`kind='error'`（熔断
    // DenialLimitError / 别的把错误文案写进 finalText 的路径）**必须**非零，否则
    // `vessel run && 下一步` 在失败后继续跑。仍然走既有 `fail()` 出口：`--json` 时 stderr 信封
    // 的 `code` 与退出码同源（同一个 exitCode），不可能不一致；人话模式下多一行 stderr
    // `[vessel] run failed: …`，与 catch 分支的既有口径一致。
    const exitCode = turnExitCode(result.kind);
    if (exitCode !== 0) {
      const msg = `[vessel] run failed: ${result.finalText || 'turn ended with kind=error'}`;
      return fail(exitCode, msg, flags, () => console.error(msg));
    }
    return 0;
  } catch (err) {
    const msg = `[vessel] run failed: ${describeProviderError(err)}`;
    return fail(1, msg, flags, () => console.error(msg));
  } finally {
    await harness.close();
  }
}

/**
 * 执法遥测文档（本卡③的 `--json` 新字段 `enforcement`）—— **形状照人类分支实际渲染的字段来**：
 *  - `counts`   ← 人类行 `  计数: k=v, …`（`snapshot().counts`，键序=首次出现序）；
 *  - `sources`  ← 人类行 `  来源: policy=… fs-confinement=… process-tree=… sandbox-status=…`
 *                 （`snapshot().sources` 的四个来源，原样一份，不另算）；
 *  - `status`   ← 人类行 `  状态: backend=… enabled=… active=… degraded=… (fallbackReason)`
 *                 （`snapshot().status()`，`null` = 该行**不打印**的那种情况）；
 *  - `recent`   ← 人类行 `    [source] type @ ts: detail {meta}`（`snapshot().recent(3)`）。
 * 字段名就是人类行里渲染出来的那几个，**没有发明**新概念。
 *
 * `null` 的两处（`backend` / `degraded` / `fallbackReason`）：人类行用 `?? 'none'` 把"没有"
 * 渲染成字面量 `none`，JSON 保留**原始值**（没有就是 `null`），因为 `backend:'none'` 本身
 * 也是合法取值，JSON 面能区分这两者、人类行不能——这是 JSON 的加法，不是改口径。
 */
interface EnforcementTelemetryDoc {
  counts: Record<string, number>;
  sources: Record<string, number>;
  status: {
    backend: string | null;
    enabled: boolean;
    active: boolean;
    degraded: string | null;
    fallbackReason: string | null;
  } | null;
  recent: {
    source: string;
    type: string;
    ts: number;
    detail: string;
    meta?: Record<string, unknown>;
  }[];
}

/**
 * 执法遥测的**唯一取数口径**：先 `reportStatus()`（把真实沙箱状态推进投影，本卡之前只有
 * 人类分支会调它——所以 `--json` 的 `status` 曾经**必然**是 `undefined`），再 `snapshot()`。
 *
 * 人类分支（`printEnforcementTelemetry`）与 `--json` 的 `enforcement` 字段**共用本函数**：
 * 前者把返回值渲染成那几行，后者直接序列化 ⇒ 两处值同源、不可能各说各话（"不许复制一份算法"）。
 * 副作用（有意，同 `printEnforcementTelemetry` 的注释）：每次调用都会记一条 `sandbox-status`
 * 的 `report` 事件；两条分支各自只调一次，不会重复记账。
 */
function enforcementTelemetryDoc(harness: ComposedHarness): EnforcementTelemetryDoc {
  const enforcement = harness.enforcement;
  // report the REAL runtime status (the same Sandbox instance the Shell tool
  // confines with) before snapshotting, so `status()` is production-reachable.
  enforcement.reportStatus(harness.sandbox.statusSnapshot());
  const snap = enforcement.snapshot();
  const st = snap.status();
  return {
    counts: snap.counts,
    sources: { ...snap.sources },
    status: st
      ? {
          backend: st.backend ?? null,
          enabled: st.enabled,
          active: st.active,
          degraded: st.degraded ?? null,
          fallbackReason: st.fallbackReason ?? null,
        }
      : null,
    recent: snap.recent(3).map((ev) => ({
      source: ev.source,
      type: ev.type,
      ts: ev.ts,
      detail: ev.detail,
      ...(ev.meta !== undefined ? { meta: ev.meta } : {}),
    })),
  };
}

/**
 * task 074 enforcement telemetry query seam (minimal CLI data face). Prints the
 * aggregated counts + last few enforcement events + sandbox status from the
 * harness's EnforcementProjection. The full query API (`events / counts /
 * recent(n) / status / treeAudit`) lives on the projection itself.
 *
 * 本卡③：取数搬进 `enforcementTelemetryDoc`（`--json` 的 `enforcement` 字段与这里**同一个**
 * 返回值），本函数只剩渲染 —— 逐字输出与搬之前**完全一致**（负对照：③-2 的逐行断言一条未动）。
 *
 * § 死 seam 接线（③）：这里先调用 `reportStatus()`，生产路径才真的拿到 sandbox
 * 状态。此前全仓只有测试调用它 ⇒ `snapshot().status()` 恒为 `undefined` ⇒ 下面那行
 * 状态**永不打印**，用户既看不到"生效"也看不到"未生效"，唯一信号是 stderr 的降级刷屏。
 * 读的是 `harness.sandbox`——Shell 工具真正用来 confine 的**同一个实例**
 * （`compose.ts` 暴露），不是从平台猜出来的；`active` 只在该实例真的附加成功后才为真。
 *
 * 副作用（有意）：即便本回合零拒绝、零逃逸，沙箱状态行也会打印。这正是一张
 * "状态可见性"卡要的效果；降级本身不会刷屏（Sandbox 侧按会话对每种 reason 只 warn
 * 一次，见 `Sandbox.warnedDegradations`）。
 */
function printEnforcementTelemetry(harness: ComposedHarness): void {
  const doc = enforcementTelemetryDoc(harness);
  console.log(`\n=== 安全执法遥测 (enforcement telemetry) ===`);
  const counts = Object.entries(doc.counts);
  if (counts.length > 0) {
    console.log(`  计数: ${counts.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  const srcs = doc.sources;
  console.log(`  来源: policy=${srcs.policy} fs-confinement=${srcs['fs-confinement']} process-tree=${srcs['process-tree']} sandbox-status=${srcs['sandbox-status']}`);
  const st = doc.status;
  if (st) {
    // `degraded` is the machine-readable "why confinement was not in force"
    // (or 'none' when it was): the point of this line is that a user can tell
    // 生效 from 未生效 without reading stderr.
    console.log(
      `  状态: backend=${st.backend ?? 'none'} enabled=${st.enabled} active=${st.active} degraded=${st.degraded ?? 'none'}${st.fallbackReason ? ` (${st.fallbackReason})` : ''}`,
    );
  }
  for (const ev of doc.recent) {
    const m = ev.meta && Object.keys(ev.meta).length > 0 ? ` ${JSON.stringify(ev.meta)}` : '';
    console.log(`    [${ev.source}] ${ev.type} @ ${ev.ts}: ${ev.detail}${m}`);
  }
}

/**
 * `@vessel/bench-runners`（`benchmarks/runners`，`private: true`）的模块类型。
 * 该包**不随 npm 包分发**，只有在仓库内以源码方式运行时才解析得到它。
 */
type BenchRunnersModule = typeof import('@vessel/bench-runners');

/**
 * 动态加载 `@vessel/bench-runners` 的注入缝（与 `serveRuntime` 同款：测试替换成员、
 * 用完还原）。仓库内靠 `apps/cli/tsconfig.json` 的 project reference + vitest alias 解析；
 * 安装态（tarball / registry 装出来的项目）必然解析不到——由 `loadBenchRunners` 兜成人话。
 */
export const benchRunnersRuntime = {
  load: (): Promise<BenchRunnersModule> => import('@vessel/bench-runners'),
};

/**
 * 是否「解析不到 bench-runners」这一类**模块解析失败**（而不是该包内部抛出的其它异常）。
 * 只认 Node 的解析错误码，以及**含该包名**的解析报错句式——不含包名的一律不算，
 * 避免把无关异常一并吞掉。
 */
function isBenchRunnersResolutionFailure(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') return true;
  const msg = err instanceof Error ? err.message : String(err);
  // Node ESM 缺包时是 `Cannot find package '<name>' imported from ...`，
  // 子路径缺失时是 `Cannot find module '<name>' ...`——两者都收，但必须带包名。
  return /Cannot find (module|package) ['"]@vessel\/bench-runners['"]/.test(msg);
}

/** 安装态加载不到 bench-runners 的「人话」文案；`hint` 给出仓库内的替代命令。 */
function benchRunnersUnavailableMessage(hint: string): string {
  return [
    '[vessel] 此功能需要在本仓库内以源码方式运行：@vessel/bench-runners 是 private 包（benchmarks/runners），不随 npm 包分发，安装态解析不到它。',
    `        仓库内请改用：${hint}`,
  ].join('\n');
}

/**
 * 动态加载 bench-runners：**只**把模块解析失败转成 `null`（调用方走既有 `fail` 出口，
 * 文案见 `benchRunnersUnavailableMessage`）；其它异常照旧向上抛，语义与改动前一致。
 */
async function loadBenchRunners(): Promise<BenchRunnersModule | null> {
  try {
    return await benchRunnersRuntime.load();
  } catch (err) {
    if (!isBenchRunnersResolutionFailure(err)) throw err;
    return null;
  }
}

async function cmdBench(flags: Map<string, string>): Promise<number> {
  const scenarioId = flags.get('bench');
  if (!scenarioId) {
    const msg = '[vessel] run --bench 需要 scenarioId（如 B001）';
    return fail(2, msg, flags, () => console.error(msg));
  }
  const runners = await loadBenchRunners();
  if (runners === null) {
    const msg = benchRunnersUnavailableMessage('npx tsx apps/cli/src/cli.ts run --bench <scenarioId>');
    return fail(2, msg, flags, () => console.error(msg));
  }
  const { runScenario } = runners;
  const workspace = path.resolve(flags.get('workspace') ?? process.cwd());
  const outDir = path.resolve(flags.get('out') ?? path.join(workspace, 'benchmarks', 'reports'));
  const providerName = flags.get('provider') ?? 'mock';
  // task 103: 与 cmdRun 同一条构造路径（--provider opencode-go 自动带 session 头 + 具名 UA）
  //
  // `VESSEL_MODEL=`（空串/纯空白）**按未设置**处理，唯一口径在 `planProvider`
  // （providers/providerFactory.ts 的 `unsetIfBlank`）——本处**不再**自带一份
  // `?? 'mock-model'` 回落：那样 provider 用 `plan.model`、而 harness/报告用本地 `model`，
  // 空串时同一次 bench 运行里就会出现两个不同的模型名（又一次「同一次运行两处口径」）。
  // 非空值与此前逐字相同（plan.model === 传入的 model）。
  const plan = planProvider({
    explicitProvider: providerName,
    baseUrl: flags.get('base-url') ?? process.env.VESSEL_BASE_URL,
    apiKey: flags.get('api-key') ?? process.env.VESSEL_API_KEY,
    model: flags.get('model') ?? process.env.VESSEL_MODEL,
  });
  const model = plan.model;
  const provider = buildRealProvider(plan);
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
    const message = `[vessel] provider "${id}" 不存在（vessel provider list 查看；vessel provider add 添加）`;
    return fail(2, message, flags, () => console.error(message));
  }
  if (cfg.protocol === 'mock') {
    if (isJson(flags)) {
      // mock 是内置离线脚本供应商，没有模型清单；`--json` 下仍只输出一段 JSON。
      emitJson({ models: [] });
      return 0;
    }
    console.log('(mock provider 是离线的，无模型列表)');
    return 0;
  }
  // V0.9: annotate each model with context window + USD/1M price from the model catalog
  // G-15 后续：目录同样取 CLI 自带的 configs（与 createUsageStore / cmdPricing 同源）；
  // Round 20：里面再走「用户态 catalog 优先 → 包内兜底」。
  const catalogRoot = builtinConfigRoot();
  const catalog = loadCatalogWithWarnings(catalogRoot, '模型上下文/价格注解缺失（模型列表将不带 ctx/价格）。');
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
      if (isJson(flags)) {
        emitJson({ models: src.models });
        return 0;
      }
      console.log(`模型列表（${src.origin === 'live' ? '实时拉取' : src.note}）：`);
      for (const m of src.models) console.log(line(m));
      return 0;
    } catch (err) {
      const detail = `[vessel] ${(err as Error).message}`;
      const hint = '提示：可先用内置清单，或确认 base-url/api-key 正确。';
      return fail(1, `${detail}\n${hint}`, flags, () => {
        console.error(detail);
        console.error(hint);
      });
    }
  }
  // anthropic (no live enumeration) or openai-compatible without baseUrl
  const src = modelsForProtocol(cfg.protocol);
  if (isJson(flags)) {
    emitJson({ models: src.models });
    return 0;
  }
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
      if (isJson(flags)) {
        // 只输出安全字段：ProviderConfig 含 apiKey（旧明文 / 经 CredentialStore 解析出的
        // 密钥），逐字段白名单输出，绝不整体展开外扩密钥。
        emitJson({
          providers: store.list().map((p) => ({
            id: p.id,
            name: p.name,
            protocol: p.protocol,
            model: p.model,
            baseUrl: p.baseUrl,
            models: p.models,
            endpoints: p.endpoints,
            secretRef: p.secretRef,
            costMultiplier: p.costMultiplier,
            note: p.note,
          })),
        });
        return 0;
      }
      for (const p of store.list()) {
        const mark = p.id === current ? ' *' : '';
        const protocol = p.protocol === 'mock' ? '' : ` [${p.protocol}]`;
        const mult = p.costMultiplier !== undefined ? ` ×${p.costMultiplier}` : '';
        const eps = p.endpoints !== undefined && p.endpoints.length > 0 ? ` +${p.endpoints.length} 端点` : '';
        console.log(`  ${p.id}${mark}${protocol}  ${p.name} (model: ${p.model})${mult}${eps}`);
      }
      return 0;
    }
    case 'current': {
      console.log(store.getCurrent());
      return 0;
    }
    case 'export': {
      return cmdProviderExport(store, flags);
    }
    case 'import': {
      return cmdProviderImport(args, flags);
    }
    case 'endpoint': {
      return cmdProviderEndpoint(args, flags);
    }
    case 'add': {
      const id = args[1];
      if (!id) {
        const msg = '用法: vessel provider add <id> --protocol <mock|openai-compatible|anthropic> [--base-url <url>] [--api-key <key>] --model <model> [--name <显示名>] [--cost-multiplier <n>]';
        return fail(2, msg, flags, () => console.error(msg));
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
      const multiplierRaw = flags.get('cost-multiplier');
      if (multiplierRaw !== undefined) {
        try {
          cfg.costMultiplier = parseCostMultiplier(multiplierRaw);
        } catch (error) {
          const msg = `[vessel provider add] ${(error as Error).message}`;
          return fail(2, msg, flags, () => console.error(msg));
        }
      }
      if ((cfg.protocol === 'openai-compatible' || cfg.protocol === 'anthropic') && !cfg.baseUrl) {
        const msg = `[vessel] ${cfg.protocol} 需要 --base-url`;
        return fail(2, msg, flags, () => console.error(msg));
      }
      try {
        store.add(cfg);
        const multNote = cfg.costMultiplier !== undefined ? `, costMultiplier=${cfg.costMultiplier}` : '';
        console.log(`已添加 provider "${id}"（protocol=${cfg.protocol}, model=${cfg.model}${multNote}）`);
        return 0;
      } catch (err) {
        const msg = `[vessel] ${(err as Error).message}`;
        return fail(1, msg, flags, () => console.error(msg));
      }
    }
    case 'set': {
      const id = args[1];
      if (!id) {
        const msgLines = [
          '用法: vessel provider set <id> [--name <显示名>] [--model <model>] [--base-url <url>] [--api-key <key>] [--cost-multiplier <n>]',
          '  --cost-multiplier：成本倍率（只乘总额，不改分项单价；缺省 1；<0 或非数字报错）',
        ];
        return fail(2, msgLines.join('\n'), flags, () => {
          for (const msgLine of msgLines) console.error(msgLine);
        });
      }
      const patch: Partial<Omit<ProviderConfig, 'id'>> = {};
      if (flags.has('name')) patch.name = flags.get('name');
      if (flags.has('model')) patch.model = flags.get('model');
      if (flags.has('base-url')) patch.baseUrl = flags.get('base-url');
      if (flags.has('api-key')) patch.apiKey = flags.get('api-key');
      if (flags.has('note')) patch.note = flags.get('note');
      if (flags.has('cost-multiplier')) {
        const raw = flags.get('cost-multiplier')!;
        try {
          patch.costMultiplier = parseCostMultiplier(raw);
        } catch (error) {
          const msg = `[vessel provider set] ${(error as Error).message}`;
          return fail(2, msg, flags, () => console.error(msg));
        }
      }
      if (Object.keys(patch).length === 0) {
        const msg = '[vessel provider set] 没有要修改的字段（--name/--model/--base-url/--api-key/--cost-multiplier）。';
        return fail(2, msg, flags, () => console.error(msg));
      }
      try {
        const next = store.update(id, patch);
        const mult = next.costMultiplier !== undefined ? ` costMultiplier=${next.costMultiplier}` : ' costMultiplier=1（缺省）';
        console.log(`已更新 provider "${id}"（model=${next.model},${mult}）`);
        if (patch.costMultiplier !== undefined && patch.costMultiplier !== DEFAULT_COST_MULTIPLIER) {
          console.log('  倍率只乘计费总额：总额 = 分项合计 × 倍率；分项单价不变（094）。');
        }
        return 0;
      } catch (err) {
        const msg = `[vessel provider set] ${(err as Error).message}`;
        return fail(1, msg, flags, () => console.error(msg));
      }
    }
    case 'remove': {
      const id = args[1];
      if (!id) {
        const msg = '用法: vessel provider remove <id>';
        return fail(2, msg, flags, () => console.error(msg));
      }
      try {
        store.remove(id);
        console.log(`已移除 provider "${id}"`);
        return 0;
      } catch (err) {
        const msg = `[vessel] ${(err as Error).message}`;
        return fail(1, msg, flags, () => console.error(msg));
      }
    }
    case 'switch':
    case 'use': {
      const id = args[1];
      if (!id) {
        const msg = `用法: vessel provider ${sub} <id>`;
        return fail(2, msg, flags, () => console.error(msg));
      }
      try {
        store.setCurrent(id);
        console.log(`已切换到 provider "${id}"`);
        return 0;
      } catch (err) {
        const msg = `[vessel] ${(err as Error).message}`;
        return fail(1, msg, flags, () => console.error(msg));
      }
    }
    default: {
      const msg = `[vessel] 未知 provider 子命令 "${sub}"（可用: list/add/set/remove/switch/use/current/export/import/endpoint）`;
      return fail(2, msg, flags, () => console.error(msg));
    }
  }
}

/** `vessel provider export [--out <file>]` — 导出配置（**默认脱敏，永不含明文密钥**；task 095）。 */
async function cmdProviderExport(store: ProviderStore, flags: Map<string, string>): Promise<number> {
  if (flags.has('with-secrets')) {
    const msgLines = [
      '[vessel provider export] --with-secrets 不支持：本项目没有任何「明文导出」路径（导出只写 secretRef 占位）。',
      '  迁移密钥请整体搬运 ~/.vessel（含 DPAPI 加密的 secrets.json），或在新机器执行',
      '  `vessel provider set <id> --api-key <key>` 重新录入（经 CredentialStore 加密落盘）。',
    ];
    return fail(2, msgLines.join('\n'), flags, () => {
      for (const msgLine of msgLines) console.error(msgLine);
    });
  }
  let file;
  try {
    file = buildExport(store);
  } catch (err) {
    const msg = `[vessel provider export] ${(err as Error).message}`;
    return fail(1, msg, flags, () => console.error(msg));
  }
  const text = serializeExport(file);
  const out = flags.get('out');
  if (out === undefined) {
    // stdout 只放 JSON（可重定向/管道）；人类可读提示走 stderr。
    console.log(text.replace(/\n$/, ''));
    console.error(`[vessel provider export] 已导出 ${file.count} 个供应商到 stdout（脱敏：剥离密钥 ${file.keysRedacted} 条）。`);
    return 0;
  }
  const target = path.resolve(out);
  try {
    writeTextAtomic(target, text);
  } catch (err) {
    const msg = `[vessel provider export] 写文件失败 ${target}: ${(err as Error).message}`;
    return fail(1, msg, flags, () => console.error(msg));
  }
  console.log(`已导出 ${file.count} 个供应商到 ${target}（格式 v${PROVIDER_EXPORT_VERSION}，脱敏：剥离密钥 ${file.keysRedacted} 条）`);
  console.log('  导出文件不含明文密钥；换机后需 `vessel provider set <id> --api-key <key>` 重新录入。');
  return 0;
}

/** `vessel provider import <file>` — 合并导入（同名冲突默认跳过；task 095）。 */
async function cmdProviderImport(args: string[], flags: Map<string, string>): Promise<number> {
  const file = args[1];
  if (!file) {
    const msgLines = [
      '用法: vessel provider import <file> [--on-conflict skip|overwrite] [--dry-run] [--keep <n>]',
      '  --on-conflict：同名 id 冲突策略（默认 skip 跳过；overwrite 用文件内容覆盖，但保留本机密钥引用）',
      '  --keep <n>：本次导入的备份保留份数（默认 5；0 = 不备份）',
    ];
    return fail(2, msgLines.join('\n'), flags, () => {
      for (const msgLine of msgLines) console.error(msgLine);
    });
  }
  const strategy = (flags.get('on-conflict') ?? 'skip') as ImportConflictStrategy;
  if (strategy !== 'skip' && strategy !== 'overwrite') {
    const msg = `[vessel provider import] 非法 --on-conflict "${String(strategy)}"（可用: skip | overwrite）`;
    return fail(2, msg, flags, () => console.error(msg));
  }
  let backupKeep: number | undefined;
  const keepRaw = flags.get('keep');
  if (keepRaw !== undefined) {
    try {
      backupKeep = parseBackupKeep(keepRaw, '--keep');
    } catch (err) {
      const msg = `[vessel provider import] ${(err as Error).message}`;
      return fail(2, msg, flags, () => console.error(msg));
    }
  }
  const store = defaultProviderStore(backupKeep !== undefined ? { backupKeep } : {});
  const target = path.resolve(file);
  let text: string;
  try {
    text = fs.readFileSync(target, 'utf8');
  } catch (err) {
    const msg = `[vessel provider import] 读不到文件 ${target}: ${(err as Error).message}`;
    return fail(1, msg, flags, () => console.error(msg));
  }
  let result;
  try {
    result = importProviders(store, text, { onConflict: strategy, dryRun: flags.has('dry-run') }, target);
  } catch (err) {
    const msg = `[vessel provider import] ${(err as Error).message}`;
    return fail(1, msg, flags, () => console.error(msg));
  }
  const label = result.written
    ? '已导入'
    : flags.has('dry-run')
      ? '[dry-run] 未写盘（预演结果）'
      : '无变更，未写盘（全部同名跳过）';
  console.log(
    `${label}：新增 ${result.added.length}，覆盖 ${result.overwritten.length}，跳过 ${result.skipped.length}`,
  );
  if (result.added.length > 0) console.log(`  新增: ${result.added.join(', ')}`);
  if (result.overwritten.length > 0) console.log(`  覆盖: ${result.overwritten.join(', ')}`);
  if (result.skipped.length > 0) console.log(`  跳过（同名冲突策略 ${strategy}）: ${result.skipped.join(', ')}`);
  if (result.strippedKeys.length > 0) {
    console.error(`[vessel provider import] 已剥离文件中的明文 apiKey（写盘永不落明文）: ${result.strippedKeys.join(', ')}`);
    console.error('  密钥请单独录入：vessel provider set <id> --api-key <key>（经 CredentialStore 加密落盘）。');
  }
  if (result.written && store.backupKeep > 0 && store.listBackups().length > 0) {
    console.log(`  写盘前已备份到 ${store.backupsDir}（每类保留 ${store.backupKeep} 份）。`);
  }
  return 0;
}

/** `vessel provider endpoint <list|add|remove|test>` — 多端点管理与测速（task 096）。 */
async function cmdProviderEndpoint(args: string[], flags: Map<string, string>): Promise<number> {
  const store = defaultProviderStore();
  const sub = args[1] ?? 'list';
  switch (sub) {
    case 'list': {
      const id = args[2];
      if (!id) {
        const msg = '用法: vessel provider endpoint list <id>';
        return fail(2, msg, flags, () => console.error(msg));
      }
      let eps;
      try {
        eps = store.effectiveEndpoints(id);
      } catch (err) {
        const msg = `[vessel] ${(err as Error).message}`;
        return fail(1, msg, flags, () => console.error(msg));
      }
      if (eps.length === 0) {
        console.log(`provider "${id}" 没有端点（baseUrl 与 endpoints 都为空）。`);
        return 0;
      }
      const baseUrl = store.get(id)?.baseUrl;
      console.log(`provider "${id}" 的端点（* = 默认端点 baseUrl）:`);
      for (const e of eps) {
        const mark = e.url === baseUrl ? ' *' : '  ';
        const label = e.label !== undefined ? `  [${e.label}]` : '';
        const src = e.source === 'baseUrl' ? '  (baseUrl 回退)' : '';
        console.log(`${mark} ${e.url}${label}${src}`);
      }
      return 0;
    }
    case 'add': {
      const id = args[2];
      const url = args[3];
      if (!id || !url) {
        const msg = '用法: vessel provider endpoint add <id> <url> [--label <标签>]';
        return fail(2, msg, flags, () => console.error(msg));
      }
      try {
        const pool = store.addEndpoint(id, url, flags.get('label'));
        console.log(`已为 provider "${id}" 添加端点 ${url}（现有候选 ${pool.length} 个；默认端点 baseUrl 不变）`);
        return 0;
      } catch (err) {
        const msg = `[vessel provider endpoint add] ${(err as Error).message}`;
        return fail(1, msg, flags, () => console.error(msg));
      }
    }
    case 'remove': {
      const id = args[2];
      const url = args[3];
      if (!id || !url) {
        const msg = '用法: vessel provider endpoint remove <id> <url>';
        return fail(2, msg, flags, () => console.error(msg));
      }
      try {
        const pool = store.removeEndpoint(id, url);
        console.log(`已移除 provider "${id}" 的端点 ${url}（剩余候选 ${pool.length} 个）`);
        return 0;
      } catch (err) {
        const msg = `[vessel provider endpoint remove] ${(err as Error).message}`;
        return fail(1, msg, flags, () => console.error(msg));
      }
    }
    case 'test': {
      return cmdProviderEndpointTest(store, args[2], flags);
    }
    default: {
      const msg = `[vessel] 未知 endpoint 子命令 "${sub}"（可用: list/add/remove/test）`;
      return fail(2, msg, flags, () => console.error(msg));
    }
  }
}

/**
 * `vessel provider endpoint test [<id>] [--all] [--set-default] [--timeout <ms>]`。
 *
 * 语义（任务卡 096 选型）：给 `<id>` 就测该 provider 的**全部候选端点**（比较才是
 * 目的）；`--all`（不带 id）测**所有已配置供应商**。默认只输出建议，**不改默认
 * 端点**；只有显式 `--set-default`（且只允许单个 id）才把 baseUrl 改成建议端点。
 */
async function cmdProviderEndpointTest(
  store: ProviderStore,
  id: string | undefined,
  flags: Map<string, string>,
): Promise<number> {
  const all = flags.has('all');
  if (!id && !all) {
    const msgLines = [
      '用法: vessel provider endpoint test <id> [--set-default] [--timeout <ms>]',
      '      vessel provider endpoint test --all [--timeout <ms>]',
    ];
    return fail(2, msgLines.join('\n'), flags, () => {
      for (const msgLine of msgLines) console.error(msgLine);
    });
  }
  if (flags.has('set-default') && !id) {
    const msg = '[vessel provider endpoint test] --set-default 需要指定单个 <id>（--all 会同时改多个供应商，拒绝执行）';
    return fail(2, msg, flags, () => console.error(msg));
  }
  let timeoutMs = DEFAULT_PROBE_TIMEOUT_MS;
  const rawTimeout = flags.get('timeout');
  if (rawTimeout !== undefined) {
    const n = Number(rawTimeout);
    if (!Number.isFinite(n) || n <= 0) {
      const msg = `[vessel provider endpoint test] 非法 --timeout "${rawTimeout}"（毫秒正整数）`;
      return fail(2, msg, flags, () => console.error(msg));
    }
    timeoutMs = Math.floor(n);
  }
  let targets: { id: string; cfg: ProviderConfig }[];
  if (id) {
    const cfg = store.get(id);
    if (!cfg) {
      const msg = `[vessel] provider "${id}" 不存在（vessel provider list 查看）`;
      return fail(2, msg, flags, () => console.error(msg));
    }
    targets = [{ id, cfg }];
  } else {
    targets = store.load().map((cfg) => ({ id: cfg.id, cfg }));
    if (targets.length === 0) {
      console.log('没有已配置的供应商（内置 mock 无需探测）。');
      return 0;
    }
  }
  let anyReachable = false;
  /**
   * 本卡（①）—— `--all` 的**逐供应商**判据载体：收集"**真的探测过**、且没有任何端点可达"
   * 的供应商 id。判据（裁决）：`--all` 下**任一所测供应商的全部端点都不可达 ⇒ 退出码非 0**，
   * 其余供应商可达**不能**把这个失败抵掉（旧写法 `anyReachable ? 0 : 1` 正是这个"抵消"）。
   *
   * 只统计**有端点可探测**的供应商：`pool.length === 0`（未配 baseUrl/endpoints）的供应商
   * **没有**被探测，不判定为失败——"全部端点不可达"这个判据对它**无端点可谈**，把它算成失败
   * 等于凭空发明一个新失败面（`--all` 会仅仅因为某个供应商没配端点就红）。该情形照旧逐条
   * 打印「没有端点可测」的既有提示行。
   */
  const providersAllUnreachable: string[] = [];
  const suggestions = new Map<string, { url: string; latencyMs: number }>();
  for (const t of targets) {
    const pool =
      t.cfg.endpoints !== undefined && t.cfg.endpoints.length > 0
        ? t.cfg.endpoints
        : t.cfg.baseUrl
          ? [{ url: t.cfg.baseUrl }]
          : [];
    if (pool.length === 0) {
      console.log(`provider "${t.id}": 没有端点可测（未配 baseUrl/endpoints）。`);
      continue;
    }
    console.log(`探测 provider "${t.id}" 的 ${pool.length} 个端点（GET {base}/models，不带凭据，超时 ${timeoutMs}ms）:`);
    const results = await probeProviderEndpoints(t.cfg, { timeoutMs });
    for (const r of results) {
      const state = r.ok ? '✔' : r.reachable ? '~' : '✖';
      const detail = r.reachable ? `HTTP ${r.status}` : (r.error ?? 'unreachable');
      const label = r.label !== undefined ? ` [${r.label}]` : '';
      console.log(`  ${state} ${r.url}${label}  ${detail}  ${r.latencyMs}ms`);
    }
    // `results.some(reachable)` 是**唯一的**"这个供应商算不算可达"判据（下面两处共用同一个布尔量，
    // 不可能各说各话）：它同时喂给单供应商模式的旧判据与 `--all` 的逐供应商判据。
    const providerReachable = results.some((r) => r.reachable);
    if (providerReachable) anyReachable = true;
    else providersAllUnreachable.push(t.id);
    const best = suggestEndpoint(results);
    if (!best) {
      console.log('  建议：无可用端点（全部不可达）——仅建议，未改动默认端点。');
      continue;
    }
    const isDefault = best.url === t.cfg.baseUrl;
    console.log(
      `  建议：${best.url}（${isDefault ? '已是默认端点' : '最快可达'}，${best.latencyMs}ms）——仅建议，未改动默认端点。`,
    );
    suggestions.set(t.id, { url: best.url, latencyMs: best.latencyMs });
  }
  if (flags.has('set-default') && id) {
    const best = suggestions.get(id);
    if (!best) {
      const msg = '[vessel provider endpoint test] 没有可达端点，未改动默认端点。';
      return fail(1, msg, flags, () => console.error(msg));
    }
    if (store.get(id)?.baseUrl === best.url) {
      console.log(`默认端点已是 ${best.url}，无需改动。`);
      return 0;
    }
    try {
      const next = store.update(id, { baseUrl: best.url });
      console.log(`已按建议把 provider "${id}" 的默认端点设为 ${next.baseUrl}（写盘前已备份到 ${store.backupsDir}）。`);
      return 0;
    } catch (err) {
      const msg = `[vessel] ${(err as Error).message}`;
      return fail(1, msg, flags, () => console.error(msg));
    }
  }
  /**
   * 本卡（①）裁决的落点：`--all`（无 `<id>`）下**只要有一家所测供应商全军覆没就退 1**，
   * 且**点名**是哪几家（不得只改码不改文案）。走既有 `fail()` 出口 ⇒ `--json` 时信封的
   * `code` 与退出码同源，非 `--json` 时文案落 stderr。
   *
   * 单供应商模式（`test <id>`：`id` 非空）**原样不动**——它本来就以该供应商为准，
   * 下面那行 `anyReachable ? 0 : 1` 与改动前逐字相同（`--set-default` 分支已在上方各自返回）。
   */
  if (all && !id && providersAllUnreachable.length > 0) {
    const msg =
      `[vessel provider endpoint test] 以下供应商的全部端点都不可达：${providersAllUnreachable.join('、')}` +
      `（--all 逐供应商判定：任一所测供应商的全部端点都不可达即退出码 1；其余供应商可达不能抵消它）。`;
    return fail(1, msg, flags, () => console.error(msg));
  }
  return anyReachable ? 0 : 1;
}

/** `vessel setup` — interactive guided provider wizard (cc-switch-style UX). */
async function cmdSetup(flags: Map<string, string>): Promise<number> {
  if (!process.stdin.isTTY) {
    const msg = 'vessel setup 需要交互终端。非交互环境请用：vessel provider add <id> --protocol <p> --base-url <url> --api-key <key> --model <model>';
    return fail(2, msg, flags, () => console.log(msg));
  }
  const store = defaultProviderStore();
  const io = createClackIO(store);
  const id = await runSetupWizard({ store, io });
  if (id) {
    console.log(`\n✔ 已保存供应商 "${id}"。用 vessel run 开始（或 vessel provider switch 切换）。`);
    return 0;
  }
  const msg = '已取消，未做任何修改。';
  return fail(1, msg, flags, () => console.log(msg));
}

/**
 * `vessel usage recompute [--dry-run] [--since <date>] [--until <date>]`（task 091）。
 *
 * 按**当前**价目重算历史成本：保留 token 原始值，只重算 cost / estimated /
 * pricingSource / 分项。幂等（同一价目连跑两次第二次零变更、不落盘）；
 * `--dry-run` 只出差异摘要。
 */
async function cmdUsageRecompute(flags: Map<string, string>): Promise<number> {
  const store = createUsageStore();
  const since = flags.get('since');
  const until = flags.get('until');
  for (const [name, value] of [['since', since], ['until', until]] as const) {
    if (value !== undefined && !isLocalDateKey(value)) {
      const msg = `[vessel usage recompute] --${name} 需要本地日 YYYY-MM-DD（收到 "${value}"）。`;
      return fail(2, msg, flags, () => console.error(msg));
    }
  }
  const dryRun = flags.has('dry-run') || flags.has('dryRun');
  const result = store.recompute({ dryRun, since, until });
  const usd = (n: number): string => `$${n.toFixed(4)}`;
  const delta = (n: number): string => `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(4)}`;
  const line = (label: string, s: { scanned: number; changed: number; beforeUsd: number; afterUsd: number; deltaUsd: number }): string =>
    `${label}: 扫描 ${s.scanned} · 受影响 ${s.changed} · ${usd(s.beforeUsd)} → ${usd(s.afterUsd)}（${delta(s.deltaUsd)}）`;

  console.log('=== vessel usage recompute（按当前价目重算历史成本）===');
  console.log(`窗口: ${since !== undefined || until !== undefined ? `${since ?? '(最早)'} ~ ${until ?? '(最新)'}（本地日，含首含尾）` : '全部历史'}`);
  console.log(line('累计条目', result.entries));
  console.log(line('日分桶', result.daily) + (result.dailySkipped > 0 ? `（跳过 ${result.dailySkipped} 天：无按模型子分项，089 之前的旧分桶不猜）` : ''));
  console.log(line('最近明细', result.recent));
  if (result.legacyRecomputed > 0) {
    console.log(`legacy 条目重算并标注: ${result.legacyRecomputed} 条（来源未知 → 按当前规则定来源，留 recomputedFromLegacy 痕迹）`);
  }
  const entryChanges = result.changes.filter((c) => c.scope === 'entry').sort((a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd));
  if (entryChanges.length > 0) {
    console.log('\n条目差异（按金额变化降序，最多 10 条）:');
    for (const c of entryChanges.slice(0, 10)) {
      console.log(`  ${c.key}: ${usd(c.beforeUsd)} → ${usd(c.afterUsd)}（${delta(c.deltaUsd)}）${c.beforeSource ?? '?'} → ${c.afterSource ?? '?'}${c.legacyRecomputed ? ' [legacy]' : ''}`);
    }
  }
  if (result.changed === 0) {
    console.log('\n无差异：当前价目下历史成本已是最新（幂等）。');
  } else if (dryRun) {
    console.log(`\n--dry-run：未落盘（共 ${result.changed} 处差异）。去掉 --dry-run 才会写入 ~/.vessel/usage.json。`);
  } else {
    console.log(`\n已落盘: ${result.changed} 处差异写入 ~/.vessel/usage.json（token 原始值未改动）。`);
  }
  return 0;
}

/**
 * `vessel usage [--recent <n>] [--strict] [--since <date>] [--until <date>] [--by-day]`
 * — persistent usage statistics (V0.9).
 *
 * task 086：显式标出「估算条目 / 价格来源分布」；`--strict` 按「只用模型专属
 * 价目（model/catalog）」的口径重算一遍，给出未收录条目与金额差（不写盘，只审计）。
 * task 089：按**本地日**分桶查询（`--since` / `--until` 含首含尾、`--by-day` 按日列出）；
 * 完整本地日与今日（未完整）分别合计，半天数据不混进完整日合计。
 * task 090：成本分项（input/output/cacheRead/cacheWrite）展示 + 推导价提示。
 * task 091：`vessel usage recompute` 子命令按当前价目重算历史成本（幂等 + dry-run）。
 */
async function cmdUsage(args: string[], flags: Map<string, string>): Promise<number> {
  if (args[0] === 'recompute') return cmdUsageRecompute(flags);
  const store = createUsageStore();

  const since = flags.get('since');
  const until = flags.get('until');
  for (const [name, value] of [['since', since], ['until', until]] as const) {
    if (value !== undefined && !isLocalDateKey(value)) {
      const message = `[vessel usage] --${name} 需要本地日 YYYY-MM-DD（收到 "${value}"）。`;
      return fail(2, message, flags, () => console.error(message));
    }
  }

  if (isJson(flags)) {
    // 字段与人类报表同源（totals/daily/byProvider/byModel/recent 全取自 UsageStore）。
    // 窗口口径必须与人类报表一致：复用同一批取值（since/until 取自 flags、条数同 1096 行口径）。
    emitJson({
      totals: store.totals(),
      daily: store.daily({ since, until }),
      byProvider: store.byProvider(),
      byModel: store.byModel(),
      recent: store.recent(Number(flags.get('recent') ?? 5)),
    });
    return 0;
  }

  const t = store.totals();
  console.log(`=== 使用统计（${path.join(resolveUsageRoot(), 'usage.json')}）===`);
  console.log(`总消耗: input ${t.inputTokens.toLocaleString()} · output ${t.outputTokens.toLocaleString()} · cache 读 ${t.cacheReadTokens.toLocaleString()} · cache 写 ${t.cacheCreationTokens.toLocaleString()} · 调用 ${t.calls}`);
  console.log(`估算成本: $${t.costUsd.toFixed(4)}（${t.providers} 供应商 / ${t.models} 模型）`);
  const b = t.costBreakdown;
  console.log(`成本分项: input $${b.inputUsd.toFixed(4)} · output $${b.outputUsd.toFixed(4)} · cacheRead $${b.cacheReadUsd.toFixed(4)} · cacheWrite $${b.cacheWriteUsd.toFixed(4)}`);
  if (t.multipliedEntries > 0 || t.mixedMultiplierEntries > 0) {
    // 094：倍率只乘总额，分项单价不变——所以「分项合计 ≠ 总额」时差额就是倍率。
    console.log(`成本倍率: ${t.multipliedEntries} 条条目含 provider 倍率${t.mixedMultiplierEntries > 0 ? `（另有 ${t.mixedMultiplierEntries} 条历次倍率不一致）` : ''}——总额 = 分项合计 × 倍率；分项合计 $${t.rawCostUsd.toFixed(4)}（分项单价未变）`);
  }
  if (t.cacheWriteDerivedCostUsd > 0) {
    console.log(`⚠ cache 写入分项含推导价 $${t.cacheWriteDerivedCostUsd.toFixed(4)}（价目缺 cacheWrite 字段，按 input×1.25 估算）。`);
  }
  if (t.entriesWithoutBreakdown > 0) {
    console.log(`历史条目 ${t.entriesWithoutBreakdown} 条无成本分项（089 之前写入，分项不可重建；金额仍计入总额）。`);
  }
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

  // ---- task 089：本地日口径（今日 / 本月 / 时间窗口 / 按日明细）----
  const todayKey = localDateKey(new Date());
  const monthStart = `${todayKey.slice(0, 7)}-01`;
  if (store.hasDailyData()) {
    const today = store.dailySummary({ since: todayKey, until: todayKey });
    const month = store.dailySummary({ since: monthStart, until: todayKey });
    const todayTotals = today.complete.days > 0 ? today.complete : today.partial;
    const monthTotals = { costUsd: month.complete.costUsd + month.partial.costUsd, calls: month.complete.calls + month.partial.calls };
    console.log(`今日（本地日 ${todayKey}，未完整）: $${todayTotals.costUsd.toFixed(4)} · ${todayTotals.calls} 次`);
    console.log(`本月（${monthStart} ~ ${todayKey}）: $${monthTotals.costUsd.toFixed(4)} · ${monthTotals.calls} 次`);
  } else if (store.migratedFromLegacy()) {
    console.log('无本地日分桶（089 之前的旧文件）：历史只保留累计，日分桶从下一次记录开始。');
  }

  if (since !== undefined || until !== undefined || flags.has('by-day')) {
    const rows = store.daily({ since, until });
    const summary = store.dailySummary({ since, until });
    const from = since ?? rows[0]?.date ?? '(无数据)';
    const to = until ?? rows[rows.length - 1]?.date ?? '(无数据)';
    console.log(`\n=== 时间窗口（本地日，含首含尾）${from} ~ ${to} ===`);
    console.log(`完整本地日合计: ${summary.complete.days} 天 · input ${summary.complete.inputTokens.toLocaleString()} · output ${summary.complete.outputTokens.toLocaleString()} · cache 读 ${summary.complete.cacheReadTokens.toLocaleString()} · cache 写 ${summary.complete.cacheCreationTokens.toLocaleString()} · ${summary.complete.calls} 次 · $${summary.complete.costUsd.toFixed(4)}`);
    if (summary.hasPartial) {
      console.log(`未完整本地日（今天/未来，不计入上面合计）: ${summary.partial.days} 天 · ${summary.partial.calls} 次 · $${summary.partial.costUsd.toFixed(4)}`);
    }
    if (rows.length === 0) {
      console.log('（窗口内没有记录）');
    } else if (flags.has('by-day')) {
      console.log('按日:');
      for (const r of rows) {
        const mark = r.complete ? '' : '（未完整）';
        console.log(`  ${r.date}${mark}: ${r.inputTokens.toLocaleString()}in/${r.outputTokens.toLocaleString()}out · cache 读 ${r.cacheReadTokens.toLocaleString()}/写 ${r.cacheCreationTokens.toLocaleString()} · ${r.calls} 次 · $${r.costUsd.toFixed(4)}`);
      }
    }
  }

  const byProv = store.byProvider();
  if (byProv.length > 0) {
    console.log('\n按供应商:');
    for (const p of byProv) {
      // 094：倍率只乘总额——把「分项合计 × 倍率」显式写出来，避免读者以为分项被漏算。
      const mult = p.costMultiplierMixed
        ? `（倍率不一致，分项合计 $${p.rawCostUsd.toFixed(4)}）`
        : p.costMultiplier !== undefined && p.costMultiplier !== DEFAULT_COST_MULTIPLIER
          ? `（分项合计 $${p.rawCostUsd.toFixed(4)} × ${p.costMultiplier}）`
          : '';
      console.log(`  ${p.provider}: ${p.inputTokens.toLocaleString()}in/${p.outputTokens.toLocaleString()}out · ${p.calls} 次 · $${p.costUsd.toFixed(4)}${mult}${p.estimated ? '（含估算）' : ''}`);
    }
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
      const cacheMark = r.cacheCreationTokens > 0 ? ` · cache 写 ${r.cacheCreationTokens.toLocaleString()}` : '';
      console.log(`  ${r.ts.slice(0, 19)} ${r.provider}/${r.model}: ${r.inputTokens}in/${r.outputTokens}out${cacheMark} · $${r.costUsd.toFixed(4)}${mark}`);
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

/**
 * 「内容已变，但没落盘」的统一文案（B2/C 修复）——`pricing override` 四个 mutator 共用。
 *
 * 为什么不复用 `fail(2, ...)`：2 在本族里是**用法 / 校验错误**（缺 `--input`、非法价、缺 key），
 * 而「命令合法但没生效」已有独立词表——`restore` 找不到墓碑就是 `1`。所以这里统一用 `1`：
 *   - 脚本能区分「先修参数再重试（2）」与「环境问题：磁盘 / 权限 / 文件被占用（1，可重试）」；
 *   - 更要紧的是**绝不会是 0**——`vessel pricing override set … && vessel usage recompute`
 *     这类串接不会在「其实没落盘」时继续按新价目跑。
 */
function overrideNotPersistedMessage(
  action: string,
  what: string,
  file: string,
  reason: string | undefined,
): string {
  return (
    `[vessel pricing override ${action}] ✘ 未写入：${what}\n` +
    `  原因：${reason ?? '未知'}\n` +
    `  覆盖文件未被改写（原路径内容保持不变或已留档，详见上面的 [vessel] 告警）：${file}\n` +
    '  本次覆盖 / 墓碑**未生效**：后续记录与 vessel usage recompute 仍按原价目计费。'
  );
}

/**
 * `vessel pricing override [list|set|delete|restore|repair]`（task 092）。
 *
 * 用户覆盖文件 `~/.vessel/pricing.override.json` 只存「覆盖 + 删除墓碑」，
 * 与内置 `configs/pricing.json` 分离：内置更新不冲用户覆盖，用户也不必 fork 内置文件。
 * `repair` 是值守卫式修复（仅当现值 = 旧值才改），用于随版本修正官方调价。
 */
async function cmdPricingOverride(args: string[], flags: Map<string, string>): Promise<number> {
  const store = new PricingOverrideStore({ rootDir: resolveUsageRoot() });
  const sub = args[0] ?? 'list';
  const numberFlag = (name: string): number | undefined => {
    const raw = flags.get(name);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new RangeError(`--${name} 需要非负数字（收到 "${raw}"）`);
    return n;
  };

  if (sub === 'list') {
    const entries = store.entries();
    const tombstones = store.tombstones();
    console.log(`=== 用户价目覆盖（${store.file}）===`);
    if (entries.length === 0) {
      console.log('（无覆盖条目）');
    } else {
      for (const e of entries) {
        console.log(`  ${e.key}: in $${e.price.input} / out $${e.price.output} / cache 读 $${e.price.cacheRead ?? 0} / cache 写 ${e.price.cacheWrite ?? '推导(input×1.25)'}（每 1M tokens）`);
      }
    }
    if (tombstones.length > 0) console.log(`删除墓碑: ${tombstones.join(' · ')}（命中即按 0 计价、不回退内置/目录）`);
    console.log('加载优先级: override > 内置 pricing.json > model-catalog > protocols > default');
    return 0;
  }

  if (sub === 'set') {
    const key = args[1];
    if (!key) {
      const msg = '用法: vessel pricing override set <model|provider::model> --input <n> --output <n> [--cache-read <n>] [--cache-write <n>]';
      return fail(2, msg, flags, () => console.error(msg));
    }
    try {
      const input = numberFlag('input');
      const output = numberFlag('output');
      if (input === undefined || output === undefined) {
        const msg = '[vessel pricing override set] 必须给 --input 与 --output（每 1M tokens USD）。';
        return fail(2, msg, flags, () => console.error(msg));
      }
      const price: TokenPrice = { input, output };
      const cacheRead = numberFlag('cache-read');
      const cacheWrite = numberFlag('cache-write');
      if (cacheRead !== undefined) price.cacheRead = cacheRead;
      if (cacheWrite !== undefined) price.cacheWrite = cacheWrite;
      // C 修复：只有**真的落盘**才报成功；被抑制 / 写失败时文案与退出码都按「未生效」走。
      const result = store.set(key, price);
      if (!result.persisted) {
        const msg = overrideNotPersistedMessage('set', `覆盖 "${key}"`, store.file, result.reason);
        return fail(1, msg, flags, () => console.error(msg));
      }
      console.log(`✔ 已写入覆盖: ${key} → in $${price.input} / out $${price.output}${price.cacheRead !== undefined ? ` / cache 读 $${price.cacheRead}` : ''}${price.cacheWrite !== undefined ? ` / cache 写 $${price.cacheWrite}` : ''}`);
      console.log('  生效于后续记录与 vessel usage recompute（覆盖优先级最高）。');
      return 0;
    } catch (error) {
      const msg = `[vessel pricing override set] ${(error as Error).message}`;
      return fail(2, msg, flags, () => console.error(msg));
    }
  }

  if (sub === 'delete') {
    const key = args[1];
    if (!key) {
      const msg = '用法: vessel pricing override delete <model|provider::model>   # 删除墓碑（按 0 计价、不回退）';
      return fail(2, msg, flags, () => console.error(msg));
    }
    try {
      const result = store.tombstone(key);
      if (!result.persisted) {
        const msg = overrideNotPersistedMessage('delete', `墓碑 "${key}"`, store.file, result.reason);
        return fail(1, msg, flags, () => console.error(msg));
      }
      console.log(`✔ 已删除内置条目 "${key}"（墓碑写入覆盖文件；该模型按 0 计价且不回退目录/协议/兜底）。`);
      console.log('  撤销: vessel pricing override restore ' + key);
      return 0;
    } catch (error) {
      const msg = `[vessel pricing override delete] ${(error as Error).message}`;
      return fail(2, msg, flags, () => console.error(msg));
    }
  }

  if (sub === 'restore') {
    const key = args[1];
    if (!key) {
      const msg = '用法: vessel pricing override restore <model|provider::model>';
      return fail(2, msg, flags, () => console.error(msg));
    }
    // C 修复：`found`（内存里有墓碑）与 `persisted`（真落盘了）**分开判**。
    // 旧实现只有前者，抑制写入时它仍为 true ⇒ 退出码 0，脚本误判已落盘。
    const result = store.restore(key);
    if (!result.found) {
      console.log(`未找到墓碑 "${key}"，无改动。`);
      return 1;
    }
    if (!result.persisted) {
      const msg = overrideNotPersistedMessage('restore', `撤销墓碑 "${key}"`, store.file, result.reason);
      return fail(1, msg, flags, () => console.error(msg));
    }
    console.log(`✔ 已撤销墓碑 "${key}"（回到内置/目录价）。`);
    return 0;
  }

  if (sub === 'repair') {
    const file = flags.get('file');
    if (!file) {
      const msgLines = [
        '用法: vessel pricing override repair --file <repairs.json>',
        '  repairs.json: [{"key":"claude-sonnet-4-5","from":{"input":3,"output":15,"cacheRead":0.3,"cacheWrite":3.75},"to":{"input":3.5,"output":17.5,"cacheRead":0.35,"cacheWrite":4.375}}]',
        '  语义：仅当覆盖现值 = from 时才改成 to（用户手改过的行不动）。',
      ];
      return fail(2, msgLines.join('\n'), flags, () => {
        for (const msgLine of msgLines) console.error(msgLine);
      });
    }
    try {
      const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as unknown;
      const list = Array.isArray(raw) ? raw : (raw as { repairs?: unknown }).repairs;
      if (!Array.isArray(list)) throw new RangeError('repairs.json 需要是数组或 { repairs: [...] }');
      const repairs: PricingRepair[] = list.map((item) => {
        const row = item as { key?: unknown; from?: unknown; to?: unknown };
        if (typeof row.key !== 'string' || row.key.trim() === '') throw new RangeError('repair 项缺少 key');
        return { key: row.key, from: row.from as TokenPrice, to: row.to as TokenPrice };
      });
      const result = store.repair(repairs);
      const outcomes = result.outcomes;
      const applied = outcomes.filter((o) => o.status === 'applied').length;
      // C 修复：`applied > 0 && !persisted` = 内存里改了、磁盘上没改 → 不得报「已生效」。
      const notPersisted = result.changed && !result.persisted;
      console.log(`=== 值守卫式修复（${store.file}）===`);
      for (const o of outcomes) {
        const note =
          o.status === 'applied'
            ? notPersisted
              ? '已改（未落盘）'
              : '已改'
            : o.status === 'skipped-absent'
              ? '跳过（无该覆盖键）'
              : '跳过（现值已被用户改过）';
        console.log(`  ${o.key}: ${note}`);
      }
      if (notPersisted) {
        console.log(`共 ${applied}/${outcomes.length} 条需要修改，但本次未落盘（无变更时不写文件）。`);
        const msg = overrideNotPersistedMessage('repair', `${applied} 条修复`, store.file, result.reason);
        return fail(1, msg, flags, () => console.error(msg));
      }
      console.log(`共 ${applied}/${outcomes.length} 条生效（无变更时不写文件）。`);
      return 0;
    } catch (error) {
      const msg = `[vessel pricing override repair] ${(error as Error).message}`;
      return fail(2, msg, flags, () => console.error(msg));
    }
  }

  const msg = `未知子命令 "${sub}"。用法: vessel pricing override [list|set|delete|restore|repair]`;
  return fail(2, msg, flags, () => console.error(msg));
}

/**
 * `vessel pricing sync [--dry-run] [--provider <p>] [--exclude <glob>]`（task 093）。
 *
 * 从 models.dev 拉价目，**增量 upsert** 目录文件：默认写用户态
 * `~/.vessel/model-catalog.json`（`VESSEL_USAGE_ROOT` 可覆盖，与读取的最高优先级层同源），
 * `--catalog <path>` 可换路径（语义不变）。
 * 语义（与 cc-switch 的差异见 `pricingSync.ts` 头注释）：
 *   - 拉取失败/超时（重试 1 次后）→ **保留旧表**，打印原因并 exit 1，绝不静默清空；
 *   - 不覆盖 `~/.vessel/pricing.override.json`（优先级链 override > 内置 > catalog 不变）；
 *   - `--dry-run` 只打印差异、不写盘；相同远端数据二次同步零变更、不写盘（幂等）；
 *   - 远端未覆盖的既有条目**保留**（同步不删条目）。
 */
async function cmdPricingSync(flags: Map<string, string>): Promise<number> {
  // Round 20：默认落点 = **用户态目录**（`~/.vessel/model-catalog.json`，`VESSEL_USAGE_ROOT`
  // 可覆盖）——与 `loadModelCatalog` 的最高优先级读取位置同源，于是默认路径下
  // 「写进去 = 下一次读得到」，且不再往用户项目目录里凭空造 `configs/`。
  // `--catalog <path>` 显式指定时仍按用户意图写该处（语义不变）。
  const readRoot = resolveUsageRoot();
  const catalogPath = path.resolve(flags.get('catalog') ?? userModelCatalogPath());
  const listFlag = (name: string): string[] =>
    (flags.get(name) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  const providers = listFlag('provider');
  const exclude = listFlag('exclude');
  const dryRun = flags.has('dry-run') || flags.has('dryRun');
  const url = flags.get('url') ?? MODELS_DEV_URL;
  let timeoutMs = DEFAULT_SYNC_TIMEOUT_MS;
  if (flags.has('timeout')) {
    const n = Number(flags.get('timeout'));
    if (!Number.isFinite(n) || n <= 0) {
      const msg = `[vessel pricing sync] --timeout 需要正数毫秒（收到 "${flags.get('timeout')}"）。`;
      return fail(2, msg, flags, () => console.error(msg));
    }
    timeoutMs = n;
  }

  // 写目标守卫（Round 20 改判据）：读路径是「用户态 catalog 优先 → 包内兜底」，所以判据是
  // 「写目录 == 用户态目录（resolveUsageRoot()）吗」。默认路径下两者相同 → 不 warn（零噪音）；
  // `--catalog` 指到别处 → 写进去最多只是回落层（用户态已有 catalog 时永远读不到），
  // 在**真正写盘之前**（syncModelCatalog 是唯一写盘点）说明白：只走 stderr warn，
  // 不失败、不改退出码，也不改 catalogPath / --catalog 语义。
  const mismatch = pricingSyncMismatchWarning(catalogPath, readRoot);
  if (mismatch !== null) console.warn(mismatch);

  const result = await syncModelCatalog({
    catalogPath,
    dryRun,
    providers: providers.length > 0 ? providers : undefined,
    exclude: exclude.length > 0 ? exclude : undefined,
    url,
    timeoutMs,
  });

  console.log('=== vessel pricing sync（models.dev → model-catalog.json）===');
  console.log(`远端: ${url}`);
  console.log(`目标: ${catalogPath}`);
  if (providers.length > 0 || exclude.length > 0) {
    console.log(`过滤: ${providers.length > 0 ? `provider=${providers.join('|')}` : 'provider=全部'}${exclude.length > 0 ? ` · exclude=${exclude.join('|')}` : ''}`);
  }

  if (result.status === 'offline') {
    const msgLines = [
      `\n⚠ 拉取/解析失败（已重试至多 ${MAX_SYNC_RETRIES} 次）：${result.error ?? 'unknown error'}`,
      `未改动 ${catalogPath}（保留旧表 ${result.total} 条）；目录价继续生效，可稍后重试。`,
    ];
    return fail(1, msgLines.join('\n'), flags, () => {
      for (const msgLine of msgLines) console.log(msgLine);
    });
  }

  const p = result.parsed;
  console.log(`\n远端解析: ${p.providers} 个供应商 / ${p.remoteModels} 条模型 → 收录 ${p.models.length} 条` +
    `（跳过：非文本 ${p.skipped.nonText} · 无价 ${p.skipped.noPrice} · 已弃用 ${p.skipped.deprecated} · 被排除 ${p.skipped.excluded + p.skipped.provider}）`);
  console.log(`差异: 新增 ${result.added.length} · 更新 ${result.updated.length} · 未变 ${result.unchanged} · 保留 ${result.kept.length}（远端未覆盖，未删除）`);
  for (const m of result.added.slice(0, 10)) {
    console.log(`  + ${m.provider}/${m.model}  in $${m.priceIn} / out $${m.priceOut}`);
  }
  if (result.added.length > 10) console.log(`  + …（另有 ${result.added.length - 10} 条新增）`);
  for (const u of result.updated.slice(0, 10)) {
    console.log(`  ~ ${u.after.provider}/${u.after.model}  in $${u.before.priceIn ?? '-'} → $${u.after.priceIn} · out $${u.before.priceOut ?? '-'} → $${u.after.priceOut}`);
  }
  if (result.updated.length > 10) console.log(`  ~ …（另有 ${result.updated.length - 10} 条更新）`);

  if (result.status === 'dry-run') {
    console.log('\n--dry-run：未写盘（去掉 --dry-run 才会写入）。');
    return 0;
  }
  if (result.status === 'unchanged') {
    console.log('\n无变更：远端数据与既有目录一致，未写盘（幂等）。');
    return 0;
  }
  console.log(`\n✔ 已写入 ${catalogPath}（原子写；共 ${result.total} 条）。`);
  console.log('  用户覆盖 ~/.vessel/pricing.override.json 未改动（优先级仍最高）。');
  return 0;
}

/** `vessel pricing [model]` — model price lookup (V0.9 + 085 归一提示 + 092 覆盖 + 093 同步). */
async function cmdPricing(args: string[], flags: Map<string, string>): Promise<number> {
  // G-15 后续：读路径取 CLI 自带的 configs（与 createUsageStore / cmdModels 同源）。
  // Round 20：`pricing sync` 的**默认写目标**同样是用户态目录（`~/.vessel/model-catalog.json`），
  // 与这里读到的最高优先级层同源（用户态 catalog 优先 → 包内兜底）。
  const root = builtinConfigRoot();
  if (args[0] === 'override') return cmdPricingOverride(args.slice(1), flags);
  if (args[0] === 'sync') return cmdPricingSync(flags);
  // 读路径（列表/单模型查询）才碰目录：缺文件时明确告警但不失败（override/sync 不经此，避免噪音）
  const catalog = loadCatalogWithWarnings(root, '模型目录为空（价格查询与列表将无条目）。');
  const target = flags.get('model') ?? args[0];
  if (target) {
    // 092：先看用户覆盖 / 删除墓碑（它们优先于目录价）
    const override = new PricingOverrideStore({ rootDir: resolveUsageRoot() }).source();
    const overrideHit = override.findMatch?.(target);
    const tombstone = override.findDeleted?.(target);
    const match = findCatalogModelMatch(catalog, target);
    if (!match && !overrideHit && tombstone === undefined) {
      const msg = `未找到模型 "${target}" 的目录条目（可用 vessel pricing 列出）。`;
      return fail(1, msg, flags, () => console.log(msg));
    }
    if (match) {
      const entry = match.entry;
      console.log(`模型: ${entry.model}（${entry.provider}）`);
      if (match.key !== target) {
        console.log(`  归一匹配: "${target}" → "${match.key}"（${match.exact ? '精确' : '家族前缀'}）`);
      }
      console.log(`  上下文: ${entry.contextWindow?.toLocaleString() ?? '?'} tokens · 输出上限: ${entry.outputLimit?.toLocaleString() ?? '?'}`);
      console.log(`  价格: in $${entry.priceIn} / out $${entry.priceOut} / cache 读 $${entry.priceCache ?? 0} / cache 写 $${entry.priceCacheWrite ?? '推导(input×1.25)'}（每 1M tokens）`);
    } else {
      console.log(`模型: ${target}（未收录在 model-catalog.json）`);
    }
    if (overrideHit) {
      console.log(`  用户覆盖: in $${overrideHit.price.input} / out $${overrideHit.price.output} / cache 读 $${overrideHit.price.cacheRead ?? 0} / cache 写 ${overrideHit.price.cacheWrite ?? '推导(input×1.25)'}（键 "${overrideHit.key}"，优先级最高）`);
    }
    if (tombstone !== undefined) {
      console.log(`  删除墓碑: 命中 "${tombstone}" → 按 0 计价，不回退内置/目录/协议/兜底。`);
    }
    return 0;
  }
  console.log('=== 模型价目（configs/model-catalog.json，USD/1M tokens）===');
  for (const m of listCatalogModels(catalog)) {
    console.log(`  ${m.provider.padEnd(16)} ${m.model.padEnd(28)} in $${m.priceIn ?? '-'} out $${m.priceOut ?? '-'} ctx ${(m.contextWindow ?? 0).toLocaleString()}`);
  }
  console.log(`\n共 ${catalog.models.length} 条。查询单个: vessel pricing --model <id>`);
  return 0;
}

/**
 * `vessel migrate` 的**执行缝**（与 `serveRuntime` / `benchRunnersRuntime` 同款：测试替换成员、
 * 用完还原；默认实现就是 `runVesselMigration`，**生产路径零变化**）。
 *
 * 为什么需要它（本卡证据性质的如实声明）：`runVesselMigration` 的默认 recycler 走 PowerShell
 * 回收站——在本机（win32）要么成功、要么压根构造不出来；而本卡的裁决（**回收尝试失败 ⇒ 非 0**、
 * **平台不支持 ⇒ 0**、**`~/.vessel` 已存在但旧根仍在 ⇒ 先补做回收**）必须有一条**走真实
 * `main(['migrate'])`** 的判别性用例。有了这个缝，用例可以注入 `recycled === false`
 * （含 `recycleError` / `recycleUnsupported`）等结局，而**不必**去碰真实 `~/.dsh` / `~/.vessel`
 * （AGENTS.md §8：默认路径的用例不得读写真实用户态目录）。
 */
export const migrateRuntime = {
  run: (opts?: MigrationOptions): Promise<MigrationResult> => runVesselMigration(opts),
};

/**
 * `vessel migrate` — one-time ~/.dsh → ~/.vessel state migration (task 033).
 *
 * **退出码（①②裁决，三条分流；别再把它们混成一锅）**：
 *  1. **平台不支持回收**（`res.recycleUnsupported`：`defaultRecycle` 在非 Windows 上恒抛）
 *     ⇒ **0** —— 数据确实已迁移成功/早已就绪，**不是**失败；但**必须**在输出里说清
 *     「旧目录仍在原处、本平台无法自动回收、请手工处理」，**不许**说成"已回收"
 *     （把这条算成 1，会让 Linux/macOS 上一次成功的迁移也退 1，脚本就此停住）；
 *  2. **尝试回收后失败**（有实现但抛错 ⇒ `recycleError` 有值且非"不支持"）⇒ **1**。
 *     数据**确实**已到 `~/.vessel`，所以走非 0 的同时文案必须说清「数据已迁移成功，
 *     但旧目录未能回收」，并且**不回滚、不删除任何东西**；
 *  3. `recycled === true` / `legacy-absent` / 「旧根已不在的 vessel-present」
 *     三条既有文案与退出码**逐字不变**（负对照）。
 *
 * **② 短路分支**：`~/.vessel` 已存在时**不再无条件退 0**——`runVesselMigration` 先看旧根
 * 是否仍在（执行到那里必然仍在，见其注释）⇒ 本次**只补做回收**，结局同样走上面 1/2/3 的分流。
 * 所以本函数对 `reason === 'vessel-present'` 的四种取值：
 *   - `recycled` ⇒ 退 0，且说清"数据早已在 ~/.vessel，本次完成的是回收"；
 *   - `recycleUnsupported` ⇒ 退 0 + 手工提示（①，**不许**说"已回收"）；
 *   - `recycleError` ⇒ 退 1（②）；
 *   - 三者都没有（旧根已不在、本次未尝试回收）⇒ 既有文案**逐字不变**、退 0。
 *
 * `recycleError` 一旦有值，文案里的"再跑一次会怎样"必须与②的新行为一致：**再跑会再试一次
 * 回收**（成功即退 0、仍失败即再退 1），**不得**再声称"会跳过并退 0"——那是①之前的旧事实。
 */
async function cmdMigrate(): Promise<number> {
  const res = await migrateRuntime.run();
  if (res.status === 'skipped' && res.reason === 'legacy-absent') {
    console.log('[vessel migrate] 未发现旧状态目录 ~/.dsh，无需迁移。');
    return 0;
  }
  if (res.status === 'skipped' && res.reason === 'vessel-present') {
    if (res.recycled) {
      // ②：数据早已在 ~/.vessel（本次没复制），本次真正完成的是"回收"这一步。
      console.log('[vessel migrate] 已存在 ~/.vessel，数据早已就绪；本次完成的是回收。');
      console.log('[vessel migrate] 旧目录 ~/.dsh 已送进回收站。');
      return 0;
    }
    if (res.recycleUnsupported) {
      // ①：平台不支持 ⇒ 退 0（数据早已就绪，不是失败），但必须说清旧目录仍在原处。
      console.warn(unsupportedRecycleNotice(res));
      return 0;
    }
    if (res.recycleError !== undefined) {
      // ②：这次**真的尝试过**回收且失败 ⇒ 非 0。数据早已就绪、不回滚不删除。
      console.warn(
        '[vessel migrate] 数据早已在 ~/.vessel（本次无需再复制），' +
          `但旧目录 ~/.dsh 本次未能自动回收（${res.recycleError}）。\n` +
          '  已就绪的数据不回滚、不删除；请手工把旧目录移入回收站（不要永久删除）。\n' +
          '  注意：再次运行 vessel migrate 会再尝试一次回收：成功即退 0，仍失败则再次退 1。',
      );
      return 1;
    }
    // 旧根已不在 ⇒ 真正的"无需再迁"（生产里这条由上面的 `legacy-absent` 承担；本分支是
    // 调用方注入的"未尝试回收"形状）⇒ 既有文案**逐字不变**、退 0（负对照）。
    console.log('[vessel migrate] 已存在 ~/.vessel（跳过；保留 ~/.dsh 未动）。');
    return 0;
  }
  console.log(`[vessel migrate] 已把 ~/.dsh 复制到 ~/.vessel（${res.copiedCount} 个条目）。`);
  if (res.recycled) {
    console.log('[vessel migrate] 旧目录 ~/.dsh 已送进回收站。');
    return 0;
  }
  if (res.recycleUnsupported) {
    // ①：数据已迁移成功；"本平台做不到回收"**不是**失败 ⇒ 退 0 + 手工提示。
    console.warn(unsupportedRecycleNotice(res));
    return 0;
  }
  // ②：回收失败：数据已就位**不算失败**（不回滚、不删除），失败的是"旧目录回收"这一步——
  // 文案两件事都说清，退出码非 0（`USAGE` 承诺过回收；"主体动作已完成"不足以让脚本判定成功）。
  const msg =
    `[vessel migrate] 数据已迁移成功（${res.copiedCount} 个条目已复制到 ~/.vessel），` +
    `但旧目录 ~/.dsh 未能自动回收（${res.recycleError ?? 'unknown'}）。\n` +
    `  已复制的数据不回滚、不删除；请手工把旧目录移入回收站（不要永久删除）。\n` +
    `  注意：再次运行 vessel migrate 会因 ~/.vessel 已存在而跳过复制，但会再尝试一次回收：` +
    `成功即退 0，仍失败则再次退 1——本次退 1 表示"承诺的回收这一步没做成"。`;
  console.warn(msg);
  return 1;
}

/**
 * ① 的**唯一**文案出口：平台**不支持**自动回收（与"尝试后失败"分开）。
 *
 * 三件事必须同时说清：① 数据已就绪（迁移成功 or 早已在 ~/.vessel）；② 旧目录**仍在原处**、
 * 本平台无法自动回收；③ 请**手工**处理。**不许**出现"已送进回收站"这类说法——那是假的。
 * 成因（含平台与路径）取自 `res.recycleError`（即 `RecycleUnsupportedError` 的原文），
 * 不另写一份平台判据。退出码由调用方给 **0**（数据已就绪，不是失败）。
 */
function unsupportedRecycleNotice(res: MigrationResult): string {
  const head =
    res.status === 'migrated'
      ? `[vessel migrate] 数据已迁移成功（${res.copiedCount} 个条目已复制到 ~/.vessel），`
      : '[vessel migrate] 数据早已在 ~/.vessel（本次无需再复制），';
  return (
    `${head}但本平台无法自动回收旧目录（退 0：数据已就绪，不是失败）。\n` +
    `  ${res.recycleError ?? 'unknown'}\n` +
    '  旧目录 ~/.dsh 仍在原处：本次没有把它送进回收站，也没有做任何删除；' +
    '请手工处理（不要永久删除）。'
  );
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
 *
 * **退出码（本卡裁决）**：`rep.totals.failed > 0` ⇒ `1`；`failed === 0` ⇒ `0`。
 *
 * 复现（改前）：本函数**恒 `return 0`**，与 `totals.failed` 无关 ⇒ CI 里
 * `vessel bench-report --input <lane.json>` 永远成功，哪怕报告里每一行都是
 * failed / 回合未正常收尾（后者见 `report/report.ts` 的 `status='failed'` + `⚠`）。
 * 本命令是 076/082 真实模型 lane 在 CI 里的**判定入口**，而退出码是脚本唯一能读的
 * 信号 —— 同族先例有两处，口径一致：
 *   - `vessel run` 的 `kind='error'` ⇒ 非零（`turnExitCode`，cli.ts:811-813）；
 *   - `vessel run --bench` ⇒ `report.success ? 0 : 1`（cli.ts:1124）。
 * 所以「有失败却报成功」在退出码这一面的一致做法是**非零**，取 `1`（`2` 在本族里
 * 留给用法/校验错误：缺 `--input`、非法 JSON 形状、runners 不可用）。
 *
 * **顺序不可调换**：渲染 + 落盘**先**做完，退出码**后**定。失败不该让产物消失 ——
 * CI 红灯之后，人仍要能拿到那份 md/json 复盘（`writeReportFiles` 的返回路径同时
 * 进人话文案，照旧落**本命令的人类文案通道**：非 `--json` = stdout，`--json` = stderr，见下）。
 *
 * 口径**只有一条**：判据是报告已有的 `totals.failed`（`aggregateRows` 按精确枚举
 * `status === 'failed'` 计数，已包含「回合未正常收尾」行）——**不**另设一套
 * 「异常收尾行」计数，避免两套口径漂移。
 *
 * **`--json` 通道契约（本卡裁决）**：`output.ts` 规定「`--json` 时 stdout **只允许**出现
 * **一段可解析 JSON**」。改动前本函数在 `--json` 下把**两条人类文案都 `console.log`**
 * （CLI 摘要表 + 「报告已写入」路径块），而 stdout 上**没有任何 JSON** ⇒
 * `vessel bench-report --input x.json --json` 的 stdout 是**非 JSON 的人类表格**，
 * `JSON.parse(stdout)` 必抛（`--json` 等于没生效）。修法**照本仓既有做法**
 * （`usage` / `models` / `policy status` 的 `--json` 分支都是 `emitJson(...)` 单一出口）：
 *   - **人类文案**（摘要 + 产物路径）在 `--json` 时改走 **stderr**（下面的 `say()`），
 *     非 `--json` 时**逐字仍走 stdout**（负对照：既有 stdout 一个字节都不变）；
 *   - **stdout 的唯一出口**是 `emitJson(rep)`：与 `writeReportFiles` 落盘的 `.json` 产物
 *     **同一份文档**（同一个 `rep`、同一 `JSON.stringify(rep, null, 2)` 缩进），
 *     消费方不必猜 stdout 的形状，`cli.test.ts` 也据此断言「stdout 恰好一段 JSON」。
 *   - **退出码语义一个字节都不动**：仍是 `totals.failed > 0 ⇒ fail(1, …)`（本卡不回退
 *     上一张卡的裁决），`--json` 下信封照旧只进 stderr、`code` 与退出码同源。
 * 顺序不变：**渲染 + 落盘先做完**（失败不吞产物），退出码**后**定。
 */
async function cmdBenchReport(flags: Map<string, string>): Promise<number> {
  const input = flags.get('input');
  if (!input) {
    const msg = '[vessel] bench-report 需要 --input <runResults.json>（076 RunResult[] 或 082 lane report JSON）';
    return fail(2, msg, flags, () => console.error(msg));
  }
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(input, 'utf8'));
  } catch (err) {
    const msg = `[vessel] 无法读取/解析输入 JSON: ${(err as Error).message}`;
    return fail(2, msg, flags, () => console.error(msg));
  }
  const runners = await loadBenchRunners();
  if (runners === null) {
    const msg = benchRunnersUnavailableMessage('npx tsx apps/cli/src/cli.ts bench-report --input <runResults.json>');
    return fail(2, msg, flags, () => console.error(msg));
  }
  const { buildReportFromRunResults, buildReport, rowsFromLaneReport, renderCliSummary, writeReportFiles } = runners;

  const isArray = Array.isArray(json);
  const isLaneReport = !isArray && typeof json === 'object' && (json as { modelSummaries?: unknown })?.modelSummaries !== undefined;

  let rep;
  if (isArray) {
    rep = buildReportFromRunResults(json as Parameters<typeof buildReportFromRunResults>[0]);
  } else if (isLaneReport) {
    const rows = rowsFromLaneReport(json as Parameters<typeof rowsFromLaneReport>[0]);
    rep = buildReport(rows, 'task-082 real-model lane report');
  } else {
    const msg = '[vessel] bench-report 输入必须是 076 RunResult[] 数组或 082 RealModelLaneReport JSON';
    return fail(2, msg, flags, () => console.error(msg));
  }

  const outDir = path.resolve(flags.get('out') ?? path.join(repoRoot(), 'benchmarks', 'reports'));
  /**
   * 人类文案出口（本卡）：非 `--json` = **stdout**（既有行为逐字不变）；`--json` = **stderr**
   * ——`output.ts` 的契约是「`--json` 时 stdout 只允许出现一段可解析 JSON」，而下面的
   * `emitJson(rep)` 才是 stdout 的唯一出口。文案一条不少，只是换了通道。
   */
  const say = (line: string): void => {
    if (isJson(flags)) console.error(line);
    else console.log(line);
  };
  say(renderCliSummary(rep));
  const paths = writeReportFiles(rep, outDir);
  // `--json`：stdout 的唯一出口。放在落盘**之后**（写盘失败就不该先宣告一份文档）；
  // 与 writeReportFiles 写出的 `.json` 是同一份文档（同 `rep`、同 stringify 参数）。
  if (isJson(flags)) emitJson(rep);
  say(`\n报告已写入:\n  ${paths.mdPath}\n  ${paths.jsonPath}`);
  // 判定发生在渲染 + 落盘**之后**（见函数头注释：失败不吞产物）。走既有 `fail` 出口：
  // `--json` 时 stderr 信封的 `code` 由同一个数铸出，退出码与信封不可能不一致。
  if (rep.totals.failed > 0) {
    const msg =
      `[vessel] bench-report: ${rep.totals.failed}/${rep.totals.runs} 行 failed（含回合未正常收尾行）⇒ 退出码 1。` +
      `报告已写入 ${paths.mdPath} 与 ${paths.jsonPath}（产物未因失败而丢弃）。`;
    return fail(1, msg, flags, () => console.error(msg));
  }
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
      const portMsg = '[vessel] 端口被占用，试 --port 5679';
      return fail(2, portMsg, flags, () => console.error(portMsg));
    }
    const msg = `[vessel] 启动本地服务失败: ${(err as Error).message}`;
    return fail(2, msg, flags, () => console.error(msg));
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
      const portMsg = '[vessel] 端口被占用，试 --port 5679';
      return fail(2, portMsg, flags, () => console.error(portMsg));
    }
    const msg = `[vessel] 启动本地服务失败: ${(err as Error).message}`;
    return fail(2, msg, flags, () => console.error(msg));
  }
  serveRuntime.open(handle.url);
  try {
    return await serveRuntime.park();
  } finally {
    await handle.close();
  }
}

/**
 * 命令分派（原 `main()` 主体，逐字未改）。
 *
 * 异常语义保持「向上抛」：非 `--json` 时由下面的 `main()` 原样重新抛出，交给入口
 * `.catch` 走 `describeStartupFailure` 人话渲染 + exit 1（与改动前逐字一致）。
 */
async function dispatch(parsed: ParsedArgs): Promise<number> {
  // subcommand forms: `vessel provider <sub>`, `vessel models`
  const first = parsed.positionals[0];
  if (first === 'provider') return cmdProvider(parsed.positionals.slice(1), parsed.flags);
  if (first === 'models') return cmdModels(parsed.flags);
  if (first === 'setup') return cmdSetup(parsed.flags);
  if (first === 'usage') return cmdUsage(parsed.positionals.slice(1), parsed.flags);
  if (first === 'pricing') return cmdPricing(parsed.positionals.slice(1), parsed.flags);
  if (first === 'migrate') return cmdMigrate();
  if (first === 'review') return cmdReview(parsed.positionals.slice(1), parsed.flags);
  if (first === 'explain' || first === 'term') return cmdExplain(parsed.positionals.slice(1), parsed.flags);
  if (first === 'list-terms') return cmdListTerms(parsed.positionals.slice(1), parsed.flags);
  if (first === 'guide') return cmdGuide(parsed.positionals.slice(1), parsed.flags);
  if (first === 'settings') return cmdSettings(parsed.positionals.slice(1), parsed.flags);
  if (first === 'policy') {
    // G-17（BRIEF-15 AC2/AC3）：只读查询，默认子命令 status；未知子命令 fail(2)
    const sub = parsed.positionals[1] ?? 'status';
    if (sub !== 'status') {
      const message = `未知 policy 子命令 ${sub}。可用：vessel policy status`;
      return fail(2, message, parsed.flags, () => console.error(message));
    }
    return cmdPolicyStatus(parsed.flags);
  }
  if (first === 'bench-report') return cmdBenchReport(parsed.flags);
  if (first === 'serve') return cmdServe(parsed.flags);
  if (first === 'web') return cmdWeb(parsed.flags);
  if (first === 'sessions') {
    const sub = parsed.positionals[1] ?? 'list';
    if (sub !== 'list') {
      const message = `未知 sessions 子命令 ${sub}。可用：vessel sessions list`;
      return fail(2, message, parsed.flags, () => console.error(message));
    }
    return cmdSessionsList({ json: isJson(parsed.flags) });
  }
  if (first === 'resume') {
    const args = parsed.positionals.slice(1);
    // Agent 侦察结论：Session.open 对任意 id 都会建目录，故"不存在的 id"必须在此拦住，
    // 否则 resume 会静默退化成"新建空会话"。
    const target = resolveResumeTarget(args, { last: parsed.flags.has('last') });
    if (!target.ok) {
      const msg = `[vessel] ${target.message}`;
      return fail(target.exitCode, msg, parsed.flags, () => console.error(msg));
    }
    parsed.flags.set('workspace', target.meta.workspaceRoot);
    parsed.flags.set('session-id', target.meta.id);
    if (!isJson(parsed.flags)) {
      console.log(`[vessel] 恢复会话 ${target.meta.id}（${target.meta.workspaceRoot}）`);
    }
    // 交互终端下无 --prompt 时进入 TUI 恢复（sessionId 显式取该会话登记 id）；
    // 有 --prompt 仍走一次性 cmdRun。非 TTY 保持原行为（cmdRun 自行报错）。
    if (!parsed.flags.has('prompt') && process.stdin.isTTY) {
      const configRoot = builtinConfigRoot();
      // G-17（BRIEF-15 AC4）：TUI 分支同样不静默部分装载（与 cmdRun 同一判据、同一产物）
      warnPartialPolicyLoad(parsed.flags);
      return runChat({
        store: defaultProviderStore(),
        workspaceRoot: target.meta.workspaceRoot,
        policySystemPath: parsed.flags.get('policy') ?? path.join(configRoot, 'configs', 'policy.default.yaml'),
        // G-15：project 级策略（可选层）——工作区根与本分支传给 runChat 的 workspaceRoot 同源
        policyProjectPath: resolveProjectPolicyPath(target.meta.workspaceRoot),
        behaviorIRPath: parsed.flags.get('behavior') ?? path.join(configRoot, 'configs', 'behavior.default.yaml'),
        permission: (parsed.flags.get('permission') ?? target.meta.permission) as
          | 'read-only'
          | 'workspace-write'
          | 'danger-full-access',
        usageStore: createUsageStore({ strict: parsed.flags.has('strict') }),
        sessionId: target.meta.id,
      });
    }
    return cmdRun(parsed.flags);
  }
  // G-02: any other first positional is an unknown/misspelled subcommand
  // (`vessel foo`, `vessel chat`, ...) → explicit error + exit 2, NEVER a
  // silent run. TUI's real entry is the no-arg `vessel`.
  if (first !== undefined) {
    const message = `未知命令 ${first}。可用：vessel --help`;
    return fail(2, message, parsed.flags, () => console.error(message));
  }
  // bare `vessel` (no subcommand): interactive TUI in a TTY; guide otherwise.
  if (first === undefined && parsed.command === 'run' && !parsed.flags.has('bench')) {
    if (!parsed.flags.has('prompt') && process.stdin.isTTY) {
      const configRoot = builtinConfigRoot();
      // G-17（BRIEF-15 AC4）：TUI 分支同样不静默部分装载（与 cmdRun 同一判据、同一产物）
      warnPartialPolicyLoad(parsed.flags);
      return runChat({
        store: defaultProviderStore(),
        workspaceRoot: path.resolve(parsed.flags.get('workspace') ?? process.cwd()),
        policySystemPath: parsed.flags.get('policy') ?? path.join(configRoot, 'configs', 'policy.default.yaml'),
        // G-15：project 级策略（可选层）——工作区根与本分支传给 runChat 的 workspaceRoot 同源
        policyProjectPath: resolveProjectPolicyPath(path.resolve(parsed.flags.get('workspace') ?? process.cwd())),
        behaviorIRPath: parsed.flags.get('behavior') ?? path.join(configRoot, 'configs', 'behavior.default.yaml'),
        permission: (parsed.flags.get('permission') ?? 'workspace-write') as 'read-only' | 'workspace-write' | 'danger-full-access',
        usageStore: createUsageStore({ strict: parsed.flags.has('strict') }),
        sessionId: parsed.flags.get('session-id'),
      });
    }
    if (!parsed.flags.has('prompt')) {
      const msg = '[vessel] 交互模式需要终端。一次性任务请用：vessel run --prompt "..."；配置供应商用 vessel setup。';
      return fail(2, msg, parsed.flags, () => console.log(msg));
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

/**
 * CLI 入口（`main()` 的唯一导出名，签名与语义对调用方不变）。
 *
 * BRIEF-10 验收 4 的兜底出口：`--json` 下命令抛出的异常（如 `providers.json` 损坏时
 * `ProviderStore` 的 `providers file corrupted (...)` 冒泡）**不得**再走人话渲染——
 * 就地转成 stderr 上的 `{error:{message,code}}` 信封 + 退出码 1。
 *
 * 为什么在 `main()` 内部兜底而不是改入口 `.catch`：入口处在 `main().then(...).catch(...)`，
 * 那时 `parsed.flags`（`parseArgs` 的产物）在 `main()` 作用域内，入口拿不到；在此处
 * 分流是唯一无需暴露解析结果、也不改 `parseArgs` 的做法。
 *
 * 非 `--json` 分支**故意重新抛出**：入口 `.catch` 的 `describeStartupFailure` 渲染
 * （P0 崩溃面契约，见 `cli.crashSurface.test.ts`：`main()` 在默认模式必须 reject）与
 * 退出码 1 保持逐字不变。
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  try {
    return await dispatch(parsed);
  } catch (err) {
    if (!isJson(parsed.flags)) throw err;
    return fail(1, describeStartupFailure(err).message, parsed.flags);
  }
}

// ESM entry
if (process.argv[1] && /cli\.(ts|js)$/.test(process.argv[1])) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      // G-03: unified failure exit — never a raw unhandled stack.
      console.error(describeStartupFailure(err).message);
      process.exit(1);
    });
}
