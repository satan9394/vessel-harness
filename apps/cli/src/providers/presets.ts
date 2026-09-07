import type { ProviderName } from '@cah/llm';

/**
 * apps/cli/providers/presets — built-in provider presets for the `cah setup`
 * wizard (and as the searchable source when the user picks a vendor).
 *
 * Each preset pre-fills protocol + baseUrl (+ a sensible default model), so the
 * user only needs to paste an API key. "custom" lets them type their own
 * endpoint (aggregators / self-hosted / anything not listed).
 */

export interface ProviderPreset {
  /** preset id (used as the suggested provider id) */
  id: string;
  /** display name shown in the picker */
  name: string;
  protocol: ProviderName;
  /** pre-filled endpoint ('' for mock) */
  baseUrl: string;
  /** suggested default model */
  defaultModel: string;
  /** hint shown under the entry */
  hint?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'anthropic', name: 'Anthropic（Claude 官方）', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-4-5', hint: 'Anthropic Messages API' },
  { id: 'openai', name: 'OpenAI（GPT 官方）', protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o', hint: 'OpenAI Chat Completions' },
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', hint: 'deepseek-chat / deepseek-reasoner' },
  { id: 'qwen', name: '通义千问 Qwen（阿里云 DashScope）', protocol: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-max', hint: 'DashScope OpenAI 兼容模式' },
  { id: 'kimi', name: 'Kimi（Moonshot）', protocol: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k2', hint: 'Moonshot' },
  { id: 'glm', name: '智谱 GLM（Z.ai）', protocol: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-plus', hint: 'Zhipu / Z.ai' },
  { id: 'minimax', name: 'MiniMax', protocol: 'openai-compatible', baseUrl: 'https://api.minimax.chat/v1', defaultModel: 'MiniMax-M2', hint: '' },
  { id: 'hunyuan', name: '腾讯混元', protocol: 'openai-compatible', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', defaultModel: 'hunyuan-turbos-latest', hint: '' },
  { id: 'openrouter', name: 'OpenRouter（聚合 200+ 模型）', protocol: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openrouter/auto', hint: '聚合平台' },
  { id: 'vllm', name: 'vLLM（自托管）', protocol: 'openai-compatible', baseUrl: 'http://localhost:8000/v1', defaultModel: '', hint: '本地推理服务' },
  { id: 'ollama', name: 'Ollama（本地）', protocol: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3.1', hint: '本地' },
  { id: 'mock', name: 'Mock（离线测试）', protocol: 'mock', baseUrl: '', defaultModel: 'mock', hint: '内置离线 provider' },
];

/** Preset lookup by id. */
export function findPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/** Provider list for a vendor preset: model fetch by protocol, live when possible. */
export function presetProtocol(p: ProviderPreset): ProviderName {
  return p.protocol;
}
