import type { Capability, CapabilityRequirements, ChatRequest, ProviderCapabilities, ProviderCapabilityValues } from '@vessel/shared';

const keys: (keyof ProviderCapabilities)[] = ['tools', 'parallelToolCalls', 'toolCallStreaming', 'structuredOutput', 'jsonSchema', 'reasoning', 'streaming', 'stopReason', 'multimodalInput', 'multimodalOutput', 'contextWindow', 'tokenUsage', 'costEstimation', 'promptCache', 'rateLimit', 'retry'];

/** Adapter declarations describe implemented wire support, not a successful upstream probe. */
export function capabilitiesFor(protocol: string, _model?: string, declarations?: Partial<ProviderCapabilities>): ProviderCapabilities {
  const result = Object.fromEntries(keys.map(key => [key, { status: 'unknown' }])) as ProviderCapabilities;
  if (['openai-compatible', 'anthropic', 'opencode-go', 'mock'].includes(protocol)) {
    for (const key of ['tools', 'reasoning', 'stopReason', 'tokenUsage'] as const) {
      result[key] = { status: 'declared', value: true, source: `${protocol} adapter` };
    }
    result.streaming = { status: 'declared', value: protocol !== 'opencode-go', source: `${protocol} adapter` };
    result.toolCallStreaming = { status: 'declared', value: protocol !== 'opencode-go', source: `${protocol} adapter` };
    for (const key of ['structuredOutput', 'jsonSchema', 'multimodalInput', 'multimodalOutput'] as const) {
      result[key] = { status: 'declared', value: false, source: `${protocol} adapter` };
    }
  }
  const effective = { ...result, ...declarations };
  // Upstream declarations cannot grant a feature this adapter cannot serialize.
  for (const key of ['structuredOutput', 'jsonSchema', 'multimodalInput', 'multimodalOutput'] as const) {
    if (result[key].status !== 'unknown') effective[key] = result[key];
  }
  if (protocol === 'opencode-go') {
    effective.streaming = result.streaming;
    effective.toolCallStreaming = result.toolCallStreaming;
  }
  return effective;
}

/** Only explicit endpoint metadata provides declarations; names are not evidence. */
export function discoverProviderCapabilities(metadata: Record<string, unknown>): ProviderCapabilities {
  const result = capabilitiesFor('unknown');
  const aliases: Partial<Record<keyof ProviderCapabilities, string[]>> = {
    tools: ['tools', 'supports_tools', 'tool_calling'], reasoning: ['reasoning', 'supports_reasoning'],
    streaming: ['streaming', 'supports_streaming'], contextWindow: ['context_window', 'contextWindow', 'max_context_length', 'context_length', 'max_model_len'],
  };
  const nested = typeof metadata.capabilities === 'object' && metadata.capabilities !== null ? metadata.capabilities as Record<string, unknown> : {};
  for (const key of keys) {
    const value = [key, ...(aliases[key] ?? [])].map(alias => nested[alias] ?? metadata[alias]).find(candidate => key === 'contextWindow' ? typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0 : typeof candidate === 'boolean');
    if (value !== undefined) (result as Record<string, Capability<unknown>>)[key] = { status: 'declared', value, source: 'model metadata' };
  }
  return result;
}

export class CapabilityMismatchError extends Error {
  override readonly name = 'CapabilityMismatchError';
  constructor(readonly provider: string, readonly model: string, readonly capability: keyof ProviderCapabilities, readonly required: unknown, readonly available: Capability<unknown>) {
    super(`Provider ${provider} model ${model}: required ${capability}=${String(required)}, available ${available.status === 'unknown' ? 'unknown' : String(available.value)} (${available.status})`);
  }
}

export function negotiateCapabilities(provider: string, model: string, capabilities: ProviderCapabilities, requirements: CapabilityRequirements): void {
  for (const key of Object.keys(requirements) as (keyof ProviderCapabilityValues)[]) {
    const required = requirements[key];
    if (required === undefined) continue;
    const available = capabilities[key];
    if (available.status === 'unknown' || (key === 'contextWindow' ? typeof available.value !== 'number' || available.value < Number(required) : available.value !== required)) {
      throw new CapabilityMismatchError(provider, model, key, required, available);
    }
  }
}

export function negotiateRequest(provider: string, request: ChatRequest, capabilities: ProviderCapabilities, streaming = false): void {
  negotiateCapabilities(provider, request.model, capabilities, request.requiredCapabilities ?? {});
  const requirements: CapabilityRequirements = {};
  if (request.tools?.length || request.messages.some(message => message.toolCalls?.length || message.role === 'tool')) requirements.tools = true;
  if (request.reasoningEffort !== undefined) requirements.reasoning = true;
  if (streaming) requirements.streaming = true;
  negotiateCapabilities(provider, request.model, capabilities, requirements);
}

export function providerCapabilities(protocol: string, declarations?: Partial<ProviderCapabilities>): ProviderCapabilities {
  return capabilitiesFor(protocol, undefined, declarations);
}
