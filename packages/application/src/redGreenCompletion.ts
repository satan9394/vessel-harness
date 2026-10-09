import type { ChatProvider, StreamChunk } from '@vessel/shared';
import type { PolicyEngine } from '@vessel/policy';

/** before_stop is observational in core; reject at the provider boundary instead. */
export function guardBugfixCompletion(provider: ChatProvider, policy: PolicyEngine, denied: (reason: string) => Promise<void>): ChatProvider {
  const check = async () => {
    const verdict = await policy.decide({ toolName: 'claim_task_complete', arguments: {} }, { requiredPermission: 'read' });
    if (verdict.action === 'deny') { await denied(verdict.reason!); throw new Error(verdict.reason); }
  };
  return {
    id: provider.id,
    defaultMaxOutputTokens: provider.defaultMaxOutputTokens,
    async chat(request) {
      const response = await provider.chat(request);
      if (!response.toolCalls.length) await check();
      return response;
    },
    ...(provider.stream ? { async *stream(request: Parameters<ChatProvider['chat']>[0]) {
      // Withhold candidate completion text until policy admits the terminal response.
      const chunks: StreamChunk[] = [];
      const tools = new Map<string, { arguments: string; ended: boolean }>();
      let bytes = 0;
      for await (const chunk of provider.stream!(request)) {
        bytes += JSON.stringify(chunk).length;
        if (bytes > 4 * 1024 * 1024) throw new Error('[Policy Deny] Completion stream exceeds evaluator buffer limit');
        chunks.push(chunk);
        if (chunk.type === 'tool_call_start') {
          if (!chunk.id || !chunk.name || tools.has(chunk.id)) throw new Error('[Policy Deny] Malformed tool stream');
          tools.set(chunk.id, { arguments: chunk.arguments, ended: false });
        }
        if (chunk.type === 'tool_call_delta' || chunk.type === 'tool_call_end') {
          const tool = tools.get(chunk.id);
          if (!tool || tool.ended) throw new Error('[Policy Deny] Malformed tool stream');
          if (chunk.type === 'tool_call_delta') tool.arguments += chunk.argumentsDelta;
          else tool.ended = true;
        }
      }
      for (const tool of tools.values()) {
        if (!tool.ended) throw new Error('[Policy Deny] Incomplete tool stream');
        let args: unknown;
        try { args = JSON.parse(tool.arguments || '{}'); } catch { throw new Error('[Policy Deny] Invalid tool arguments'); }
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('[Policy Deny] Invalid tool arguments');
      }
      if (!tools.size) await check();
      yield* chunks;
    } } : {}),
  };
}
