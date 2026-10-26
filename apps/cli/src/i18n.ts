export type Locale = 'zh' | 'en';

const zh: Record<string, string> = {
  'usage.header': 'Vessel CLI v{version} — 可组合 Agent Harness（品牌 Vessel）',
  'usage.commandsHint': '用法:',
  'usage.footer': `provider 协议说明:
  openai-compatible    OpenAI chat/completions 协议：OpenAI / DeepSeek / Qwen / vLLM / Ollama 等
  anthropic            Anthropic Messages API 协议：Anthropic Claude 及兼容端点
  mock                 确定性离线脚本（测试 / 冒烟，不发网络请求）`,
};

const en: Record<string, string> = {
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
