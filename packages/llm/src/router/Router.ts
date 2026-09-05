import type { ChatProvider, Router, RouterHints } from '@cah/shared';

export interface SimpleRouterOptions {
  providers: Record<string, ChatProvider>;
  defaultProvider: string;
  defaultModel: string;
}

/** llm/router — model selection + provider resolution (fallback chain minimal). */
export class SimpleRouter implements Router {
  constructor(private readonly opts: SimpleRouterOptions) {}

  resolve(hints: RouterHints): { provider: ChatProvider; model: string } {
    const providerId = hints.provider ?? this.opts.defaultProvider;
    const provider = this.opts.providers[providerId];
    if (!provider) {
      throw new Error(`unknown provider: ${providerId} (available: ${Object.keys(this.opts.providers).join(', ')})`);
    }
    const model = hints.model ?? this.opts.defaultModel;
    return { provider, model };
  }
}
