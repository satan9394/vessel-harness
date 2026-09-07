import type { ProviderName } from '@cah/llm';

/**
 * apps/cli/providers/presets.data.ts — provider catalog (V0.7, task 020).
 *
 * Sourced from docs/ideas/PROVIDER-TUI-RESEARCH.md §A3 (each base-url verified
 * against models.dev API and/or cc-switch source, 2026-09 snapshot) +
 * models.dev long-tail. Categories: official (intl official) / cn (China
 * official) / aggregator (stable gateways only — long-tail resellers are
 * deliberately EXCLUDED; use a custom base-url for those) / local / intl.
 *
 * Notes:
 *  - Protocol is openai-compatible for almost all (Anthropic-compatible CN
 *    endpoints need vendor-specific paths — see createProvider TODO); 'mock'
 *    stays built-in.
 *  - defaultModel may be '' → the wizard /v1/models fetch fills the real list.
 *  - github-copilot is OAuth-hosted — kept with auth:'oauth' + caution.
 */

export type ProviderCategory = 'official' | 'cn' | 'intl' | 'aggregator' | 'local';

export interface ProviderPreset {
  /** preset id (used as the suggested provider id) */
  id: string;
  /** display name shown in the picker */
  name: string;
  protocol: ProviderName;
  /** pre-filled endpoint ('' for mock) */
  baseUrl: string;
  /** suggested default model (may be '' → fetch fills) */
  defaultModel: string;
  hint?: string;
  category: ProviderCategory;
  /** auth model: api-key (default) | oauth | env | none */
  auth?: 'api-key' | 'oauth' | 'env' | 'none';
}

export const PROVIDER_CATALOG: ProviderPreset[] = [
  // ---- official (intl official) ----
  { id: 'anthropic', name: 'Anthropic（Claude 官方）', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-4-5', category: 'official', hint: 'Anthropic Messages API' },
  { id: 'openai', name: 'OpenAI（GPT 官方）', protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o', category: 'official', hint: 'Chat Completions' },
  { id: 'google-gemini', name: 'Google Gemini', protocol: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.5-flash', category: 'official', hint: 'OpenAI 兼容端点' },
  { id: 'xai', name: 'xAI（Grok）', protocol: 'openai-compatible', baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-code-fast-1', category: 'official' },
  { id: 'mistral', name: 'Mistral', protocol: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-large-latest', category: 'official' },
  { id: 'cohere', name: 'Cohere', protocol: 'openai-compatible', baseUrl: 'https://api.cohere.com/v2', defaultModel: 'command-a', category: 'official' },
  { id: 'groq', name: 'Groq', protocol: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', category: 'official' },
  { id: 'cerebras', name: 'Cerebras', protocol: 'openai-compatible', baseUrl: 'https://api.cerebras.ai/v1', defaultModel: 'gpt-oss-120b', category: 'official' },
  { id: 'togetherai', name: 'Together AI', protocol: 'openai-compatible', baseUrl: 'https://api.together.xyz/v1', defaultModel: '', category: 'official' },
  { id: 'fireworks', name: 'Fireworks AI', protocol: 'openai-compatible', baseUrl: 'https://api.fireworks.ai/inference/v1', defaultModel: '', category: 'official' },
  { id: 'perplexity', name: 'Perplexity', protocol: 'openai-compatible', baseUrl: 'https://api.perplexity.ai', defaultModel: 'sonar-reasoning-pro', category: 'official' },
  { id: 'nvidia', name: 'Nvidia NIM', protocol: 'openai-compatible', baseUrl: 'https://integrate.api.nvidia.com/v1', defaultModel: '', category: 'official' },
  { id: 'azure-openai', name: 'Azure OpenAI', protocol: 'openai-compatible', baseUrl: '', defaultModel: '', category: 'official', auth: 'env', hint: '需 Azure resource；base-url 交互填 <res>.openai.azure.com/openai/v1' },
  { id: 'cloudflare', name: 'Cloudflare Workers AI', protocol: 'openai-compatible', baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1', defaultModel: '', category: 'official', hint: '需 account id；base-url 交互替换 {account}' },
  { id: 'watsonx', name: 'IBM watsonx', protocol: 'openai-compatible', baseUrl: 'https://api.au-syd.ai.watson.cloud.ibm.com/ml/v1', defaultModel: '', category: 'official', hint: 'IBM 云；区域端点交互填' },
  { id: 'upstage', name: 'Upstage', protocol: 'openai-compatible', baseUrl: 'https://api.upstage.ai/v1/solar', defaultModel: '', category: 'intl' },
  { id: 'sakana', name: 'Sakana AI', protocol: 'openai-compatible', baseUrl: 'https://api.sakana.ai/v1', defaultModel: '', category: 'intl' },
  { id: 'poolside', name: 'Poolside', protocol: 'openai-compatible', baseUrl: 'https://api.poolside.ai/v1', defaultModel: '', category: 'intl' },

  // ---- cn (China official) ----
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', category: 'cn', hint: 'deepseek-chat / deepseek-reasoner' },
  { id: 'qwen', name: '通义千问 Qwen（DashScope）', protocol: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-max', category: 'cn' },
  { id: 'qwen-intl', name: 'Qwen（国际 DashScope）', protocol: 'openai-compatible', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', defaultModel: '', category: 'cn' },
  { id: 'kimi', name: 'Kimi（Moonshot）', protocol: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k2', category: 'cn' },
  { id: 'kimi-intl', name: 'Kimi（Moonshot 国际）', protocol: 'openai-compatible', baseUrl: 'https://api.moonshot.ai/v1', defaultModel: '', category: 'cn' },
  { id: 'glm', name: '智谱 GLM（Z.ai）', protocol: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-plus', category: 'cn' },
  { id: 'glm-intl', name: '智谱 Z.ai（国际）', protocol: 'openai-compatible', baseUrl: 'https://api.z.ai/api/paas/v4', defaultModel: '', category: 'cn' },
  { id: 'minimax', name: 'MiniMax', protocol: 'openai-compatible', baseUrl: 'https://api.minimaxi.com/v1', defaultModel: 'MiniMax-M2', category: 'cn', hint: '旧 minimax.chat 已作废' },
  { id: 'minimax-intl', name: 'MiniMax（国际）', protocol: 'openai-compatible', baseUrl: 'https://api.minimax.io/v1', defaultModel: '', category: 'cn' },
  { id: 'stepfun', name: '阶跃星辰 StepFun', protocol: 'openai-compatible', baseUrl: 'https://api.stepfun.com/v1', defaultModel: '', category: 'cn' },
  { id: 'doubao', name: '火山引擎豆包（Ark）', protocol: 'openai-compatible', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-1.5-pro-32k', category: 'cn' },
  { id: 'hunyuan', name: '腾讯混元（TokenHub）', protocol: 'openai-compatible', baseUrl: 'https://api.lkeap.cloud.tencent.com/v1', defaultModel: 'hunyuan-turbos-latest', category: 'cn' },
  { id: 'bailian', name: '阿里百炼（Claude 兼容）', protocol: 'anthropic', baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic', defaultModel: 'claude-sonnet-4-5', category: 'cn', hint: '走百炼 Anthropic 兼容路径' },
  { id: 'bailing', name: '百度千帆 Baidu Qianfan', protocol: 'openai-compatible', baseUrl: 'https://qianfan.baidubce.com/v2', defaultModel: 'ernie-4.5', category: 'cn' },
  { id: 'minimo', name: '小米 MiMo', protocol: 'openai-compatible', baseUrl: 'https://api.xiaomimimo.com/v1', defaultModel: '', category: 'cn' },
  { id: 'sensenova', name: '商汤 SenseNova', protocol: 'openai-compatible', baseUrl: 'https://token.sensenova.cn/v1', defaultModel: '', category: 'cn' },

  // ---- aggregator (stable gateways only) ----
  { id: 'openrouter', name: 'OpenRouter（聚合 200+ 模型）', protocol: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openrouter/auto', category: 'aggregator', hint: '聚合平台' },
  { id: 'siliconflow', name: '硅基流动 SiliconFlow', protocol: 'openai-compatible', baseUrl: 'https://api.siliconflow.cn/v1', defaultModel: 'deepseek-ai/DeepSeek-V3', category: 'aggregator', hint: '国产聚合' },
  { id: 'modelscope', name: 'ModelScope 魔搭', protocol: 'openai-compatible', baseUrl: 'https://api-inference.modelscope.cn/v1', defaultModel: 'Qwen/Qwen3-Coder', category: 'aggregator' },
  { id: 'novita', name: 'Novita AI', protocol: 'openai-compatible', baseUrl: 'https://api.novita.ai/v1', defaultModel: '', category: 'aggregator' },
  { id: 'huggingface', name: 'Hugging Face Inference', protocol: 'openai-compatible', baseUrl: 'https://router.huggingface.co/v1', defaultModel: '', category: 'aggregator' },
  { id: 'deepinfra', name: 'DeepInfra', protocol: 'openai-compatible', baseUrl: 'https://api.deepinfra.com/v1/openai', defaultModel: '', category: 'aggregator' },
  { id: 'github-copilot', name: 'GitHub Copilot（兼容端点）', protocol: 'openai-compatible', baseUrl: 'https://api.githubcopilot.com', defaultModel: '', category: 'aggregator', auth: 'oauth', hint: 'OAuth 托管账号，需登录' },
  { id: '302ai', name: '302.AI', protocol: 'openai-compatible', baseUrl: 'https://api.302.ai/v1', defaultModel: '', category: 'aggregator' },
  { id: 'nebulab', name: 'Nebius', protocol: 'openai-compatible', baseUrl: 'https://api.nebius.com/v1', defaultModel: '', category: 'aggregator' },
  { id: 'requesty', name: 'Requesty', protocol: 'openai-compatible', baseUrl: 'https://router.requesty.ai/v1', defaultModel: '', category: 'aggregator' },
  { id: 'oneapi', name: 'OneAPI（自部署网关）', protocol: 'openai-compatible', baseUrl: 'http://localhost:3000/v1', defaultModel: '', category: 'aggregator', hint: '自部署 OpenAI 兼容网关' },
  { id: 'newapi', name: 'NewAPI（自部署网关）', protocol: 'openai-compatible', baseUrl: '', defaultModel: '', category: 'aggregator', hint: '自部署；base-url 填你的域名' },

  // ---- local ----
  { id: 'ollama', name: 'Ollama（本地）', protocol: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3.1', category: 'local', hint: '本地' },
  { id: 'vllm', name: 'vLLM（自托管）', protocol: 'openai-compatible', baseUrl: 'http://localhost:8000/v1', defaultModel: '', category: 'local' },
  { id: 'lmstudio', name: 'LM Studio（本地）', protocol: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', defaultModel: '', category: 'local' },
  { id: 'llamacpp', name: 'llama.cpp server', protocol: 'openai-compatible', baseUrl: 'http://localhost:8080/v1', defaultModel: '', category: 'local' },
  { id: 'jan', name: 'Jan（本地）', protocol: 'openai-compatible', baseUrl: 'http://localhost:1337/v1', defaultModel: '', category: 'local' },

  // ---- mock (built-in, keep last) ----
  { id: 'mock', name: 'Mock（离线测试）', protocol: 'mock', baseUrl: '', defaultModel: 'mock', category: 'local', auth: 'none', hint: '内置离线 provider' },
];

export const PROVIDER_CATEGORY_LABELS: Record<ProviderCategory, string> = {
  official: '官方（国际）',
  cn: '国产官方',
  intl: '国际',
  aggregator: '聚合 / 网关',
  local: '本地 / 推理',
};

/** lookup by id */
export function findPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}
