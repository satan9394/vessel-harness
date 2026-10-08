import type { CacheUsageMetrics, ChatProvider, ChatUsage, ChatRequest } from '@vessel/shared';

/** Preserve optional wire metadata around a core consumer which folds only base usage fields. */
export function observeProviderCacheUsage(provider: ChatProvider) {
  let pending: CacheUsageMetrics | undefined;
  const remember = (usage: ChatUsage) => {
    const metrics = usage.cacheMetrics ?? pending;
    if (metrics) { usage.cacheMetrics = metrics; }
    pending = undefined;
  };
  const observed: ChatProvider = {
    id: provider.id,
    defaultMaxOutputTokens: provider.defaultMaxOutputTokens,
    chat: async request => { pending = undefined; const response = await provider.chat(request); if (response.usage.cacheMetrics) response.usage.cacheMetrics = { ...response.usage.cacheMetrics, provider: provider.id, model: request.model }; remember(response.usage); return response; },
    ...(provider.stream ? { stream: async function* (request: ChatRequest) {
      pending = undefined;
      for await (const chunk of provider.stream!(request)) {
        if (chunk.type === 'usage' && chunk.cacheMetrics) pending = { ...chunk.cacheMetrics, provider: provider.id, model: request.model };
        yield chunk;
      }
    } } : {}),
  };
  return { provider: observed, annotate: remember };
}
