import type { EventBus } from '@vessel/core';

export interface SubagentSummary {
  id: string;
  name: string;
  provider: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  worktreePath?: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  lastError?: string;
}

export interface SubagentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}
export interface SubagentSeamOptions {
  getActiveRuns?: () => Promise<SubagentSummary[]>;
  cancelRun?: (id: string) => Promise<boolean>;
}
export interface SubagentDetail {
  summary: SubagentSummary;
  logs: { phase: string; message: string; ts: number }[];
  usage: SubagentUsage;
}
export type SubagentEventKind = 'subagent:start' | 'subagent:step' | 'subagent:end';
export interface SubagentDelta {
  id: string;
  summary?: SubagentSummary;
  phase?: string;
  message?: string;
  usage?: SubagentUsage;
}
function summarySnapshot(summary: SubagentSummary): SubagentSummary {
  return {
    id: summary.id, name: summary.name.slice(0, 128), provider: summary.provider.slice(0, 128),
    status: summary.status, worktreePath: summary.worktreePath,
    startedAt: summary.startedAt, endedAt: summary.endedAt,
    exitCode: summary.exitCode, lastError: summary.lastError?.slice(0, 512),
  };
}
/** Compact process facts; prompts, arguments and result artifacts stay private. */
export class SubagentSeam {
  constructor(private readonly options: SubagentSeamOptions = {}) {}
  private readonly runs = new Map<string, SubagentDetail>();
  private readonly cancelers = new Map<string, (id: string) => boolean>();
  private readonly listeners = new Set<(kind: SubagentEventKind, delta: SubagentDelta) => void>();
  async listSubagents(): Promise<SubagentSummary[]> {
    if (this.options.getActiveRuns) return (await this.options.getActiveRuns()).map(summarySnapshot);
    return [...this.runs.values()].map(({ summary }) => summarySnapshot(summary));
  }
  detail(id: string): SubagentDetail | undefined {
    const run = this.runs.get(id);
    return run ? { summary: { ...run.summary }, logs: run.logs.map(log => ({ ...log })), usage: { ...run.usage } } : undefined;
  }
  async cancelSubagent(id: string): Promise<boolean> {
    if (this.options.cancelRun) return this.options.cancelRun(id);
    const run = this.runs.get(id);
    return run?.summary.status === 'running' && (this.cancelers.get(id)?.(id) ?? false);
  }
  subscribe(listener: (kind: SubagentEventKind, delta: SubagentDelta) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  registerRun(summary: SubagentSummary, cancel?: (id: string) => boolean): void {
    const compact = summarySnapshot(summary);
    this.runs.set(summary.id, { summary: compact, logs: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    if (cancel) this.cancelers.set(summary.id, cancel);
    this.emit('subagent:start', { id: summary.id, summary: { ...compact } });
  }
  attach(bus: EventBus, cancel: (id: string) => boolean): () => void {
    const offs = [
      bus.on('subagent_start', payload => {
        const p = payload as { delegateId: string; preset?: string; childAgentId?: string; provider?: string; startedAt?: string };
        // Native delegates have a different cancellation owner and stream IDs.
        if (!p.delegateId.startsWith('external_')) return;
        this.registerRun({ id: p.delegateId, name: p.preset ?? p.childAgentId ?? 'Vessel', provider: p.provider ?? 'vessel', status: 'running', startedAt: p.startedAt ?? new Date().toISOString() }, cancel);
      }),
      bus.on('subagent_step', payload => {
        const p = payload as { delegateId: string; phase?: string; worktreePath?: string };
        const run = this.runs.get(p.delegateId);
        if (!run) return;
        if (p.worktreePath) run.summary.worktreePath = p.worktreePath;
        this.step(p.delegateId, p.phase ?? 'execution', 'Isolated workspace ready');
      }),
      bus.on('model_stream_delta', payload => {
        const p = payload as { turnId: string; chunk?: { type: string; text?: string; name?: string } };
        if (!this.runs.has(p.turnId) || !p.chunk) return;
        // ponytail: reasoning and tool arguments are intentionally omitted.
        if (p.chunk.type === 'text_delta') this.step(p.turnId, 'execution', p.chunk.text ?? '');
        if (p.chunk.type === 'tool_call_start') this.step(p.turnId, 'tool', p.chunk.name ?? 'Tool');
      }),
      bus.on('model_stream_end', payload => {
        const p = payload as { turnId: string; usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number } };
        const run = this.runs.get(p.turnId);
        if (!run || !p.usage) return;
        run.usage = { inputTokens: p.usage.inputTokens ?? 0, outputTokens: p.usage.outputTokens ?? 0, cacheReadTokens: p.usage.cacheReadTokens ?? 0, cacheWriteTokens: p.usage.cacheCreationTokens ?? 0 };
        this.emit('subagent:step', { id: p.turnId, usage: { ...run.usage } });
      }),
      bus.on('subagent_stop', payload => {
        const p = payload as { delegateId: string; exitCode?: number; result?: { stopReason?: string; diagnostic?: string }; isError?: boolean };
        const run = this.runs.get(p.delegateId);
        if (!run) return;
        run.summary.status = p.result?.stopReason === 'aborted' ? 'cancelled' : p.isError || p.result?.stopReason && p.result.stopReason !== 'completed' ? 'failed' : 'completed';
        run.summary.endedAt = new Date().toISOString();
        run.summary.exitCode = p.exitCode;
        run.summary.lastError = p.result?.diagnostic?.slice(0, 512);
        this.cancelers.delete(p.delegateId);
        this.emit('subagent:end', { id: p.delegateId, summary: { ...run.summary } });
        const completed = [...this.runs.values()].filter(item => item.summary.status !== 'running');
        for (const item of completed.slice(0, Math.max(0, completed.length - 100))) this.runs.delete(item.summary.id);
      }),
    ];
    return () => {
      for (const off of offs) off();
      for (const [id, handler] of this.cancelers) if (handler === cancel) this.cancelers.delete(id);
    };
  }
  private step(id: string, phase: string, message: string): void {
    const run = this.runs.get(id)!;
    const log = { phase, message: message.slice(0, 512), ts: Date.now() };
    run.logs.push(log);
    if (run.logs.length > 100) run.logs.shift();
    this.emit('subagent:step', { id, summary: { ...run.summary }, phase, message: log.message });
  }
  private emit(kind: SubagentEventKind, delta: SubagentDelta): void {
    for (const listener of this.listeners) listener(kind, delta);
  }
}
