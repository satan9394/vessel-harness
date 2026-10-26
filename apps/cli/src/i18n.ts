export type Locale = 'zh' | 'en';

const zh: Record<string, string> = {
  'usage.commands': `  vessel --help                      显示本帮助
  vessel --version                   显示版本
  vessel run [选项]                  单发模式：跑一轮用户输入
  vessel run --bench <scenarioId>    基准模式：运行 benchmarks/ 场景并产出 JSONL 报告
  vessel models [--provider p]       列出某供应商可用模型（OpenAI 兼容实时拉取 / Anthropic 内置清单）
  vessel setup                       交互向导：搜索选供应商 → 输 key → 拉模型 → 空格勾选 → 提交
  vessel usage [--cache] [--recent <n>] [--strict] [--since <date>] [--until <date>] [--by-day]
                                      使用统计（tokens/调用/成本分项 + 价格来源分布；
                                      --since/--until 本地日窗口、--by-day 按日列出；--strict 按不用兜底价重算）
  vessel usage recompute [--dry-run] [--since <date>] [--until <date>]
                                      按当前价目重算历史成本（保留 token，只重算 cost/来源；幂等）
  vessel pricing [model]               模型价目（configs/model-catalog.json，USD/1M tokens）
  vessel pricing sync [--dry-run] [--provider <p>] [--exclude <glob>]
                                      从 models.dev 同步价目到 model-catalog.json
                                      （超时 {syncTimeout}s + 重试 {syncRetries} 次；失败保留旧表并提示；
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
  vessel mcp list                    列出已配置的 MCP server（~/.vessel/mcp.json）
  vessel mcp add <name> --command <cmd> [--args a,b] [--cwd <dir>] [--env K=V,K2=V2]   添加 MCP server
  vessel mcp remove <name>           移除 MCP server
  vessel mcp disable <name>          停用 MCP server（零进程占用）
  vessel mcp enable <name>           启用 MCP server
  vessel mcp path                    打印 MCP 配置文件路径
  vessel migrate                     一次性迁移旧状态目录 ~/.dsh → ~/.vessel（数据复制 + 旧目录进回收站）
  vessel sessions list               列出历史会话（最近活动在前）
  vessel effects list [--session <id>]
                                     列出被未知副作用挡住写入的会话（journal 中未结算的 intent）
  vessel effects resolve --session <id> --key <key> --attempt <n> --applied|--not-applied --evidence "<说明>"
                                     人工回执并解除写入阻断（等价于 POST /api/sessions/:id/effects；旧调用仍不可重放）
  vessel resume <id>|--last           恢复历史会话（--last = 最近一条）
  vessel diff [<id>|--last]           会话改动的只读提示（Write/Edit 文件 + shell + git status；不回滚）
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
  vessel bench:runs <scenarioId> [--out <dir>] [--json]  只读列出已完成 run 与当前 harness 的指纹匹配
  vessel serve [--port <n>] [--workspace <dir>]  启动本地服务（默认 http://127.0.0.1:5678；工作区默认当前目录并自动入库，不开浏览器）
  vessel daemon start|stop|status    后台服务（--port <n>、--json）
  vessel mesh|swarm status|peers|ping <peer-id>   Mesh control plane
  vessel memory|mem rules|search <query>|stats   Workspace cognitive memory
  vessel doctor|diagnose [--probe-network] [--mods] System health diagnostics (--mods scans only Mods)
  vessel mod list|inspect <name>|verify <path>|audit <path> Static Mod inspection
  vessel serve --mode mcp-agent      通过 stdio 启动 MCP 子代理服务（协议仅占用 stdout）
  vessel web [--workspace <dir>]      启动本地服务并打开浏览器（工作区默认当前目录并自动入库）

run 选项:
  --prompt <text>                 用户输入（缺省从 stdin 读取）
  --workspace <dir>               工作区（默认当前目录）
  --provider <mock|openai-compatible|anthropic>   模型提供方（默认 mock）
  --model <name>                  模型名（OpenAI/Anthropic 协议需指定，或 VESSEL_MODEL）
  --base-url <url>                端点：openai-compatible 用 {base}/chat/completions，
                                  anthropic 用 {base}/v1/messages（或 VESSEL_BASE_URL）
  --api-key <key>                 API 密钥（或 VESSEL_API_KEY；本地端点可不填）
  --max-steps <n>                 单轮步数上限（默认 64）
  --mod <directory>               Explicitly load one dependency-free JS Mod in the restricted Worker
  --permission <mode>             权限模式：read-only（只读探索）| workspace-write（默认，写工作区）|
                                  danger-full-access（全权限，高危可执行）
  --policy <path>                 系统级策略文件（默认 configs/policy.default.yaml）
  --behavior <path>               Behavior IR 文件（默认 configs/behavior.default.yaml）
  --strict                        计价严格模式：只用模型专属价目（model/catalog），未收录模型按 0 计价并标「未收录」
  --json              以 JSON 输出（stdout 恰好一段可解析 JSON）：run / usage / provider list / models / sessions list / settings list / policy status / bench-report / bench:runs`,
  'usage.header': 'Vessel CLI v{version} — 可组合 Agent Harness（品牌 Vessel）',
  'usage.commandsHint': '用法:',
  'usage.footer': `provider 协议说明:
  openai-compatible    OpenAI chat/completions 协议：OpenAI / DeepSeek / Qwen / vLLM / Ollama 等
  anthropic            Anthropic Messages API 协议：Anthropic Claude 及兼容端点
  mock                 确定性离线脚本（测试 / 冒烟，不发网络请求）`,
};

const en: Record<string, string> = {
  'usage.commands': `  vessel --help                      Show this help
  vessel --version                   Show version
  vessel run [options]               One-shot mode: process one user input
  vessel run --bench <scenarioId>    Benchmark mode: run a benchmarks/ scenario and produce a JSONL report
  vessel models [--provider p]       List available provider models (live OpenAI-compatible fetch / built-in Anthropic list)
  vessel setup                       Interactive wizard: find provider -> enter key -> fetch models -> select with Space -> submit
  vessel usage [--cache] [--recent <n>] [--strict] [--since <date>] [--until <date>] [--by-day]
                                      Usage statistics (tokens/calls/cost breakdown + pricing source distribution;
                                      --since/--until use local-day windows; --by-day lists days; --strict recalculates without fallback pricing)
  vessel usage recompute [--dry-run] [--since <date>] [--until <date>]
                                      Recalculate historical costs using current pricing (preserve tokens, update cost/source only; idempotent)
  vessel pricing [model]               Model pricing (configs/model-catalog.json, USD/1M tokens)
  vessel pricing sync [--dry-run] [--provider <p>] [--exclude <glob>]
                                      Sync pricing from models.dev to model-catalog.json
                                      (timeout {syncTimeout}s + {syncRetries} retries; keep old pricing and notify on failure;
                                      preserve ~/.vessel/pricing.override.json)
  vessel pricing override [list]       User pricing overrides (~/.vessel/pricing.override.json; highest priority)
  vessel pricing override set <key> --input <n> --output <n> [--cache-read <n>] [--cache-write <n>]
                                      Override unit pricing (key = model or provider::model)
  vessel pricing override delete <key> Deletion tombstone: explicitly remove a built-in entry (price at 0, no fallback)
  vessel pricing override restore <key> Undo tombstone
  vessel pricing override repair --file <repairs.json>
                                      Value-guarded repair: change an override to 'to' only if its current value equals 'from'
  vessel provider list               List all providers (* = current default)
  vessel provider current            Show current default provider
  vessel provider add <id> --protocol <p> --model <m> [--base-url] [--api-key] [--cost-multiplier <n>]   Add provider
  vessel provider set <id> [--model <m>] [--base-url <u>] [--cost-multiplier <n>]   Edit provider (multiplier applies only to the total)
  vessel provider remove <id>        Remove provider
  vessel provider switch|use <id>    Switch current default provider
  vessel provider export [--out <file>]   Export configuration (redacted by default: keys use secretRef placeholders, never plaintext)
  vessel provider import <file> [--on-conflict skip|overwrite] [--dry-run] [--keep <n>]   Merge import (skip duplicate names by default)
  vessel provider endpoint list <id>            List candidate endpoints (* = default endpoint baseUrl)
  vessel provider endpoint add <id> <url> [--label <l>]     Add candidate endpoint
  vessel provider endpoint remove <id> <url>                Remove candidate endpoint
  vessel provider endpoint test <id> [--set-default]        Minimal endpoint probe + recommendations (preserve default endpoint unless requested)
  vessel provider endpoint test --all                       Probe endpoints for all providers
  vessel mcp list                    List configured MCP servers (~/.vessel/mcp.json)
  vessel mcp add <name> --command <cmd> [--args a,b] [--cwd <dir>] [--env K=V,K2=V2]   Add MCP server
  vessel mcp remove <name>           Remove MCP server
  vessel mcp disable <name>          Disable MCP server (no running process)
  vessel mcp enable <name>           Enable MCP server
  vessel mcp path                    Print MCP configuration path
  vessel migrate                     Migrate legacy state once: ~/.dsh -> ~/.vessel (copy data + move old directory to Recycle Bin)
  vessel sessions list               List historical sessions (most recently active first)
  vessel effects list [--session <id>]
                                     List sessions with writes blocked by unknown effects (unsettled journal intents)
  vessel effects resolve --session <id> --key <key> --attempt <n> --applied|--not-applied --evidence "<description>"
                                     Record a manual receipt and unblock writes (equivalent to POST /api/sessions/:id/effects; old calls remain non-replayable)
  vessel resume <id>|--last           Resume historical session (--last = most recent)
  vessel diff [<id>|--last]           Read-only session change hints (Write/Edit files + shell + git status; no rollback)
  vessel review handoff <request.json>   Generate external review handoff (.vessel/reviews/<id>/handoff.md; task 059)
  vessel review import <id> <result file>  Import external review results ([--source external|internal], persisted)
  vessel review list                 List external reviews
  vessel explain <term>              Explain a term in Chinese and English (alias: vessel term <term>; hint if absent)
  vessel list-terms                  List all terms (bilingual glossary)
  vessel guide [--locale zh|en]      Beginner guide (1: introduction 2: ask about terms 3: common commands 4: set theme/language;
                                      output follows settings locale, overridden by --locale)
  vessel settings list               Show settings descriptions and current values (theme/locale, bilingual descriptions + available values)
  vessel settings set <key> <value>  Set a value (theme: dark|light; locale: zh|en; explain invalid values)
  vessel policy status               Show effective policy layers (system/project: path / existence / declaration count / hash; read-only)
  vessel bench-report --input <json>  Benchmark dashboard: aggregate 076 RunResult[] (or 082 lane report) -> print CLI summary + write md/json (task 083)
  vessel bench:runs <scenarioId> [--out <dir>] [--json]  Read-only list of completed runs and fingerprint matches against the current harness
  vessel serve [--port <n>] [--workspace <dir>]  Start local server (default http://127.0.0.1:5678; workspace defaults to current directory and is registered automatically; no browser)
  vessel daemon start|stop|status    Background service (--port <n>, --json)
  vessel mesh|swarm status|peers|ping <peer-id>   Mesh control plane
  vessel memory|mem rules|search <query>|stats   Workspace cognitive memory
  vessel doctor|diagnose [--probe-network] [--mods] System health diagnostics (--mods scans only Mods)
  vessel mod list|inspect <name>|verify <path>|audit <path> Static Mod inspection
  vessel serve --mode mcp-agent      Start MCP subagent server over stdio (stdout reserved for the protocol)
  vessel web [--workspace <dir>]      Start local server and open browser (workspace defaults to current directory and is registered automatically)

run options:
  --prompt <text>                 User input (read from stdin by default)
  --workspace <dir>               Workspace (default: current directory)
  --provider <mock|openai-compatible|anthropic>   Model provider (default: mock)
  --model <name>                  Model name (required for OpenAI/Anthropic protocols, or VESSEL_MODEL)
  --base-url <url>                Endpoint: openai-compatible uses {base}/chat/completions,
                                  anthropic uses {base}/v1/messages (or VESSEL_BASE_URL)
  --api-key <key>                 API key (or VESSEL_API_KEY; optional for local endpoints)
  --max-steps <n>                 Maximum steps per turn (default: 64)
  --mod <directory>               Explicitly load one dependency-free JS Mod in the restricted Worker
  --permission <mode>             Permission mode: read-only (exploration) | workspace-write (default, write workspace) |
                                  danger-full-access (full permissions, high-risk execution allowed)
  --policy <path>                 System policy file (default: configs/policy.default.yaml)
  --behavior <path>               Behavior IR file (default: configs/behavior.default.yaml)
  --strict                        Strict pricing: model-specific pricing only (model/catalog); unknown models cost 0 and are marked 'unlisted'
  --json              Output JSON (stdout contains exactly one parseable JSON value): run / usage / provider list / models / sessions list / settings list / policy status / bench-report / bench:runs`,
  'usage.header': 'Vessel CLI v{version} — Composable Agent Harness (Vessel)',
  'usage.commandsHint': 'Usage:',
  'usage.footer': `Provider protocols:
  openai-compatible    OpenAI chat/completions: OpenAI / DeepSeek / Qwen / vLLM / Ollama, etc.
  anthropic            Anthropic Messages API: Anthropic Claude and compatible endpoints
  mock                 Deterministic offline script (tests / smoke checks, no network requests)`,
};

let locale: Locale = 'zh';

/**
 * CLI language: `vessel --lang en --help` (also `--help --lang en`).
 * --lang overrides VESSEL_LANG; absent both, use zh. Unknown or missing flag values use en.
 * Only the separate `--lang <value>` form is supported, matching the CLI argument parser.
 * This does not change the independent `vessel guide --locale` setting.
 */
export function resolveLocale(argv: readonly string[]): Locale {
  let value = process.env.VESSEL_LANG;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--lang') value = argv[++i] ?? '';
  }
  return value === undefined ? 'zh' : value === 'zh' ? 'zh' : 'en';
}

export function setLocale(value: Locale): void {
  locale = value;
}

export function currentLocale(): Locale {
  return locale;
}

/** Current language → English → literal key; unmatched placeholders remain unchanged. */
export function t(key: string, params: Record<string, string | number> = {}): string {
  const catalog = locale === 'zh' ? zh : en;
  const message = (Object.hasOwn(catalog, key) ? catalog[key] : undefined)
    ?? (Object.hasOwn(en, key) ? en[key] : undefined);
  if (message === undefined) return key;
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder);
}
