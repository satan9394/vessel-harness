/** Evidence-bearing capabilities. Unknown is never equivalent to supported. */
export type Capability<T> =
  ({ status: 'detected' | 'declared'; value: T; source?: string }
  | { status: 'unknown' }) & { evidence?: { observedAt: number; expiresAt: number; origin: 'provider_metadata' | 'probe' | 'user_override' } };

export interface ProviderCapabilityValues {
  tools: boolean;
  parallelToolCalls: boolean;
  toolCallStreaming: boolean;
  structuredOutput: boolean;
  jsonSchema: boolean;
  reasoning: boolean;
  streaming: boolean;
  stopReason: boolean;
  multimodalInput: boolean;
  multimodalOutput: boolean;
  contextWindow: number;
  tokenUsage: boolean;
  costEstimation: boolean;
  promptCache: boolean;
  rateLimit: boolean;
  retry: boolean;
}
export type ProviderCapabilities = { [K in keyof ProviderCapabilityValues]: Capability<ProviderCapabilityValues[K]> };
export type CapabilityRequirements = Partial<ProviderCapabilityValues>;
