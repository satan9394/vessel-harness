import type { Lang, ModelMessages } from '../../i18n';
import type { PresetInfo, ProviderCategory } from './presets.generated';

// Preset data lives in packages/application/src/providers/presets.data.ts (single source).
// presets.generated.ts is produced by `scripts/sync-web-presets.mjs`; run its --write after
// changing the shared catalog, and --check in CI. Do not hand-edit the generated file.
export type { ProviderCategory, PresetInfo } from './presets.generated';
export { PROVIDER_PRESETS_CATALOG } from './presets.generated';

export const PRESET_CATEGORIES: { id: ProviderCategory | 'all'; labelKey: keyof ModelMessages }[] = [
  { id: 'all', labelKey: 'presetCategoryAll' },
  { id: 'cn', labelKey: 'presetCategoryCn' },
  { id: 'official', labelKey: 'presetCategoryOfficial' },
  { id: 'aggregator', labelKey: 'presetCategoryAggregator' },
  { id: 'local', labelKey: 'presetCategoryLocal' },
  { id: 'intl', labelKey: 'presetCategoryIntl' },
];

// Display translations only; the shared catalog above retains connection metadata parity.
const ENGLISH_PRESETS: Record<string, { name?: string; hint?: string }> = {
  lark: { name: 'Lark (Volcengine Ark)', hint: 'Volcengine Ark endpoint for Doubao models and custom endpoints' },
  anthropic: { name: 'Anthropic (official Claude)' },
  openai: { name: 'OpenAI (official GPT)' },
  'google-gemini': { hint: 'OpenAI-compatible endpoint' },
  'azure-openai': { hint: 'Requires an Azure resource; enter <res>.openai.azure.com/openai/v1 as the base URL' },
  cloudflare: { hint: 'Requires an account ID; replace {account} in the base URL' },
  watsonx: { hint: 'IBM Cloud; enter your regional endpoint' },
  'amazon-bedrock': { name: 'Amazon Bedrock (Claude and more)', hint: 'Requires regional AWS SigV4 credentials from the environment; replace {region} in the base URL' },
  'google-vertex': { name: 'Google Vertex AI (Gemini and more)', hint: 'Requires a GCP project, region and ADC credentials; replace {location} in the base URL' },
  baseten: { hint: 'Hosted inference; use your deployed model name' },
  scaleway: { hint: 'Hosts open models including Llama and Qwen' },
  opencode: { hint: 'Official OpenCode gateway (OpenAI compatible); OPENCODE_API_KEY' },
  'opencode-go': { hint: 'OpenCode Go subscription endpoint (OpenAI compatible)' },
  'kimi-coding': { name: 'Kimi For Coding', hint: 'Moonshot coding endpoint (Anthropic compatible); requires a Kimi For Coding subscription' },
  'doubao-seed': { name: 'Doubao Seed (Coding Plan)', hint: 'Volcengine Coding Plan subscription endpoint' },
  qwen: { name: 'Qwen (DashScope)' },
  'qwen-intl': { name: 'Qwen (international DashScope)' },
  'kimi-intl': { name: 'Kimi (international Moonshot)' },
  glm: { name: 'GLM (Z.ai)' },
  'glm-intl': { name: 'Z.ai (international)' },
  minimax: { hint: 'The old minimax.chat endpoint is retired' },
  'minimax-intl': { name: 'MiniMax (international)' },
  stepfun: { name: 'StepFun' },
  doubao: { name: 'Doubao (Volcengine Ark)' },
  hunyuan: { name: 'Tencent Hunyuan (TokenHub)' },
  bailian: { name: 'Alibaba Bailian (Claude compatible)', hint: 'Uses the Bailian Anthropic-compatible endpoint' },
  bailing: { name: 'Baidu Qianfan' },
  minimo: { name: 'Xiaomi MiMo' },
  sensenova: { name: 'SenseNova' },
  openrouter: { name: 'OpenRouter (200+ models)', hint: 'Model aggregator' },
  siliconflow: { name: 'SiliconFlow', hint: 'China-based model aggregator' },
  modelscope: { name: 'ModelScope' },
  'github-copilot': { name: 'GitHub Copilot (compatible endpoint)', hint: 'OAuth account; sign-in required' },
  oneapi: { name: 'OneAPI (self-hosted gateway)', hint: 'Self-hosted OpenAI-compatible gateway' },
  newapi: { name: 'NewAPI (self-hosted gateway)', hint: 'Self-hosted; enter your domain as the base URL' },
  aihubmix: { hint: 'Third-party relay with multiple models; verify availability for your use' },
  cherryin: { hint: 'Third-party relay (cc-switch catalog)' },
  ppio: { hint: 'Third-party relay' },
  subrouter: { hint: 'Third-party aggregator' },
  therouter: { hint: 'Third-party relay (cc-switch catalog)' },
  soleapi: { hint: 'Third-party relay (Anthropic family)' },
  zetaapi: { hint: 'Third-party relay' },
  runapi: { hint: 'Third-party relay (Anthropic family)' },
  pipellm: { hint: 'Third-party relay' },
  qiniu: { name: 'Qiniu', hint: 'Third-party relay' },
  packycode: { hint: 'Subscription service (cc-switch catalog); enter your base URL' },
  commandgota: { hint: 'Official CommandCode gateway; supports DeepSeek and GPT' },
  ollama: { name: 'Ollama (local)', hint: 'Local endpoint' },
  vllm: { name: 'vLLM (self-hosted)' },
  lmstudio: { name: 'LM Studio (local)' },
  jan: { name: 'Jan (local)' },
  mock: { name: 'Mock (offline testing)', hint: 'Built-in offline provider' },
};

export function localizePreset(preset: PresetInfo, lang: Lang): PresetInfo {
  return lang === 'zh' ? preset : { ...preset, ...ENGLISH_PRESETS[preset.id] };
}
