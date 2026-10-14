import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChatProvider, ChatRequest, ChatResponse, StreamChunk } from '@vessel/shared';

export interface ModelSelection { provider: string; model: string }

/** Local composition seam: the controller keeps its bus, lease and conversation. */
export class SessionModelHub implements ChatProvider {
  readonly id = 'local-model-hub';
  // ponytail: Retain the server output default; actual endpoint limits/prices are not inferred.
  readonly defaultMaxOutputTokens = 4096;
  private auditFile?: string;
  constructor(private selected: ModelSelection, private target: ChatProvider) {}
  get selection(): ModelSelection { return { ...this.selected }; }
  get capabilities() { return this.target.capabilities; }
  attach(sessionDir: string): void { this.auditFile = path.join(sessionDir, 'model-delegations.jsonl'); }
  select(selection: ModelSelection, target: ChatProvider): void { this.selected = { ...selection }; this.target = target; }
  private delegate(request: ChatRequest): { provider: ChatProvider; request: ChatRequest } {
    if (!this.auditFile) throw new Error('model_hub_not_attached');
    const selected = this.selection;
    // Write before transport, including compaction/retry calls. Never write config, keys or prompts.
    fs.appendFileSync(this.auditFile, JSON.stringify({ ts: new Date().toISOString(), ...selected, requestKind: request.requestKind ?? 'main' }) + '\n');
    return { provider: this.target, request: { ...request, model: selected.model } };
  }
  chat(request: ChatRequest): Promise<ChatResponse> {
    const delegated = this.delegate(request);
    return delegated.provider.chat(delegated.request);
  }
  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const delegated = this.delegate(request);
    if (delegated.provider.stream) { yield* delegated.provider.stream(delegated.request); return; }
    const response = await delegated.provider.chat(delegated.request);
    yield { type: 'message_start', model: delegated.request.model };
    if (response.reasoningContent) yield { type: 'reasoning_delta', text: response.reasoningContent };
    if (response.content) yield { type: 'text_delta', text: response.content };
    for (const call of response.toolCalls) {
      yield { type: 'tool_call_start', id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) };
      yield { type: 'tool_call_end', id: call.id };
    }
    yield { type: 'usage', ...response.usage };
    yield { type: 'message_end', finishReason: response.finishReason };
  }
}
