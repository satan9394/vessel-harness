import * as crypto from 'node:crypto';
import { AgentLoop, type LoopDeps, type TurnResult } from '@vessel/core';
import type { ChatProvider, ChatRequest, ChatUsage, ChatResponse, SessionRecord, StreamChunk } from '@vessel/shared';
import { canonicalArgumentsHash } from '@vessel/shared';
import { ExecutionRun, ExecutionBudgetError, type ExecutionBudget, type ExecutionState } from '@vessel/engine';

type ExecutionTurnResult = TurnResult & { runId: string; outcomeReason: string; executionState: ExecutionState };

/** Application-owned lifecycle around the unchanged thin loop. All provider attempts share one budget. */
export class ExecutionLoop extends AgentLoop {
  private readonly original: LoopDeps;
  private readonly budget: ExecutionBudget;
  private activeRun?: ExecutionRun;
  private runId = '';
  private turnId = '';
  private reason = '';
  private denied = false;
  private continueRequested = false;
  private committedKind?: TurnResult['kind'];
  private running = false;
  private timer?: ReturnType<typeof setTimeout>;
  private budgetFailure?: ExecutionBudgetError;
  private requestMetadata: Record<string, unknown> = {};
  private latestEnvelope: Record<string, unknown> = {};
  private commitAttempted = false;
  private poisoned = false;
  private providerFailure?: unknown;
  get executionRunId(): string { return this.runId; }
  get executionTurnId(): string { return this.turnId; }

  /** Recovery never repeats an unfinished invocation or reuses its spent budget. */
  async recoverIncompleteRuns(): Promise<void> {
    const records = this.original.session.replay();
    const latest = new Map<string, Extract<SessionRecord, { type: 'run/state' }>>();
    for (const record of records) if (record.type === 'run/state') latest.set(record.runId, record);
    for (const record of latest.values()) {
      if (['COMPLETED', 'DENIED', 'FAILED', 'CANCELLED', 'EXHAUSTED'].includes(record.state)) continue;
      const tail = records.filter(event => event.seq > record.seq);
      const pending = tail.some(event => event.type === 'tool/call' && !tail.some(result => result.type === 'tool/result' && result.toolCallId === event.toolCallId && result.seq > event.seq));
      const terminal = [...tail].reverse().find(event => event.type === 'turn/end' && event.runId === record.runId && typeof event.executionState === 'string' && ['COMPLETED', 'DENIED', 'FAILED', 'CANCELLED', 'EXHAUSTED'].includes(event.executionState));
      await this.original.session.appendSync({ type: 'run/state', runId: record.runId, budget: record.budget, startedAt: record.startedAt,
        counters: terminal?.budgetCounters ?? record.counters, revision: record.revision + 1,
        state: terminal?.executionState ?? 'CANCELLED', outcomeReason: terminal?.outcomeReason ?? (pending ? 'OUTCOME_UNKNOWN' : 'recovery_incomplete_run'), surface: false });
    }
  }

  constructor(deps: LoopDeps, budget?: Partial<ExecutionBudget>) {
    let self: ExecutionLoop;
    const session = new Proxy(deps.session, { get(target, key) {
      if (key === 'appendSync') return async (record: Omit<SessionRecord, 'seq' | 'ts'>) => {
        if (record.type === 'turn/start') self.turnId = String(record.turnId);
        if (record.type === 'tool/call') { self.limit(() => self.activeRun!.tool()); await self.checkpoint(); }
        if (record.type === 'audit/denial' && record.stage === 'before_turn') { self.denied = true; self.reason = String(record.reason ?? 'admission_denied'); }
        if (record.type === 'request/header') record = { ...record, ...self.headerMetadata() };
        if (record.type === 'turn/end') return self.commit(record);
        return target.appendSync(record);
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const bus = new Proxy(deps.bus, { get(target, key) {
      if (key === 'serial') return async (...args: Parameters<typeof target.serial>) => {
        const result = await target.serial(...args);
        if (args[0] === 'before_stop' && result.vetoed) self.continueRequested = true;
        return result;
      };
      if (key === 'emit') return async (...args: Parameters<typeof target.emit>) => {
        if (args[0] === 'before_model') {
          const envelope = (args[1] as { envelope: Record<string, unknown> }).envelope;
          self.captureEnvelope(envelope);
        }
        if (args[0] === 'after_turn') args[1] = { ...args[1] as object, kind: self.committedKind ?? (args[1] as { kind: string }).kind };
        return target.emit(...args);
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const provider: ChatProvider = {
      id: deps.provider.id, defaultMaxOutputTokens: deps.provider.defaultMaxOutputTokens,
      chat: async request => {
        const prepared = await self.prepareModel(request);
        try { const result = await deps.provider.chat(prepared.request); self.usage(result, prepared.estimate); self.activeRun!.counters.consecutiveErrors = 0; self.providerFailure = undefined; return result; }
        catch (error) { self.modelFailure(error); throw error; }
      },
    };
    if (deps.provider.stream) provider.stream = async function* (request): AsyncIterable<StreamChunk> {
      const prepared = await self.prepareModel(request);
      let usage: Partial<ChatUsage> = {}; let accountedInput = prepared.estimate; let accountedOutput = 0; let accountedCost = 0; let text = '';
      try {
        for await (const chunk of deps.provider.stream!(prepared.request)) {
          if (chunk.type === 'text_delta' || chunk.type === 'reasoning_delta') text += chunk.text;
          if (chunk.type === 'tool_call_start') text += chunk.arguments;
          if (chunk.type === 'tool_call_delta') text += chunk.argumentsDelta;
          if (chunk.type === 'usage') usage = { ...usage, ...Object.fromEntries(Object.entries(chunk).filter(([key, value]) => key !== 'type' && value !== undefined)) };
          const input = usage.inputTokens ?? prepared.estimate;
          const output = Math.max(usage.outputTokens ?? 0, Math.ceil(text.length / 4));
          const cost = usage.costEstimate ?? 0;
          const counts = self.activeRun!.counters;
          counts.inputTokens += input - accountedInput; counts.outputTokens += output - accountedOutput; counts.estimatedCost += cost - accountedCost;
          accountedInput = input; accountedOutput = output; accountedCost = cost;
          self.limit(() => self.activeRun!.check());
          yield chunk;
        }
        self.activeRun!.counters.consecutiveErrors = 0;
        self.providerFailure = undefined;
      } catch (error) { self.modelFailure(error); throw error; }
    };
    super({ ...deps, session, bus, provider,
      buildContext: async step => { const envelope = await deps.buildContext(step); self.captureEnvelope(envelope); return envelope; },
      modelErrorRecovery: deps.modelErrorRecovery ? { ...deps.modelErrorRecovery, recover: async (...args) => {
        const envelope = await deps.modelErrorRecovery!.recover(...args); if (envelope) self.captureEnvelope(envelope); return envelope;
      } } : undefined,
      runTool: async (call, ctx) => {
      const result = await deps.runTool(call, ctx); self.limit(() => self.activeRun!.check()); return result;
    } });
    self = this; this.original = deps;
    this.budget = { maxModelSteps: deps.maxSteps ?? 64, maxToolCalls: 256, maxElapsedMs: 30 * 60_000, maxConsecutiveErrors: 5, ...budget };
    // Validate before any run can open a scope.
    new ExecutionRun(this.budget);
  }

  private async prepareModel(request: ChatRequest) {
    const run = this.activeRun!; this.limit(() => run.model());
    const estimate = Math.ceil(JSON.stringify({ messages: request.messages, tools: request.tools ?? [] }).length / 4);
    run.counters.inputTokens += estimate; this.limit(() => run.check());
    const remaining = this.budget.maxOutputTokens === undefined ? undefined : this.budget.maxOutputTokens - run.counters.outputTokens;
    if (remaining !== undefined && remaining <= 0) this.limit(() => { throw new ExecutionBudgetError('maxOutputTokens'); });
    await this.checkpoint();
    return { estimate, request: { ...request, ...(remaining === undefined ? {} : { maxTokens: Math.min(request.maxTokens ?? remaining, remaining) }) } };
  }
  private async checkpoint(): Promise<void> {
    const run = this.activeRun!; run.revision++;
    try { await this.original.session.appendSync({ type: 'run/state', runId: this.runId, state: run.state, revision: run.revision, counters: { ...run.counters }, budget: this.budget, startedAt: run.startedAt, outcomeReason: this.reason, surface: false }); }
    catch (error) { this.poisoned = true; throw error; }
  }
  private captureEnvelope(envelope: object): void {
    const fields = envelope as Record<string, unknown>;
    this.latestEnvelope = fields;
    this.requestMetadata = Object.fromEntries(['schemaVersion', 'sessionId', 'projectionRevision', 'basedOnEventSequence', 'requestHash', 'dependencyHash'].filter(key => fields[key] !== undefined).map(key => [key, fields[key]]));
  }
  private headerMetadata(): Record<string, unknown> {
    const envelope = this.latestEnvelope;
    const remaining = this.budget.maxOutputTokens === undefined ? undefined : this.budget.maxOutputTokens - this.activeRun!.counters.outputTokens;
    const maxTokens = remaining === undefined ? envelope.maxOutputTokens : Math.min((envelope.maxOutputTokens as number | undefined) ?? remaining, remaining);
    const actual = JSON.parse(JSON.stringify({ model: envelope.model, messages: envelope.messages, tools: (envelope.tools as unknown[])?.length ? envelope.tools : undefined, maxTokens, temperature: this.original.temperature ?? 0, reasoningEffort: this.original.reasoningEffort }));
    return { ...this.requestMetadata, actualRequestHash: canonicalArgumentsHash(actual) };
  }
  private usage(response: ChatResponse, estimate: number) {
    const run = this.activeRun!;
    const usage = response.usage;
    const outputEstimate = Math.ceil((response.content.length + (response.reasoningContent?.length ?? 0) + response.toolCalls.reduce((sum, call) => sum + JSON.stringify(call.arguments).length, 0)) / 4);
    run.counters.inputTokens += usage.inputTokens - estimate; run.counters.outputTokens += Math.max(usage.outputTokens, outputEstimate); run.counters.estimatedCost += usage.costEstimate ?? 0; this.limit(() => run.check());
  }
  private modelFailure(error: unknown) {
    if (!(error instanceof ExecutionBudgetError)) { this.providerFailure = error; this.activeRun!.counters.consecutiveErrors++; }
    this.limit(() => this.activeRun!.check());
  }
  private limit(action: () => void): void {
    try { action(); } catch (error) { if (error instanceof ExecutionBudgetError) this.budgetFailure = error; throw error; }
  }

  private async commit(record: Omit<SessionRecord, 'seq' | 'ts'>) {
    this.turnId = String(record.turnId);
    const run = this.activeRun!;
    let kind = record.kind as TurnResult['kind'];
    if (this.reason === 'cancelled') kind = 'interrupted';
    if (kind === 'success') {
      try { run.check(); } catch (error) { if (!(error instanceof ExecutionBudgetError)) throw error; this.reason = error.outcomeReason; kind = 'budget'; }
      if (kind === 'success') {
        const verdict = await this.original.bus.waterfall('before_turn_commit', {
          runId: this.runId, turnId: this.turnId, candidateKind: kind, counters: { ...run.counters },
          forceContinue: () => { this.continueRequested = true; },
        }, { listenerErrorPolicy: 'fail-closed' });
        if (verdict.result.kind === 'deny' || verdict.result.kind === 'ask') {
          this.denied = true; this.reason = verdict.result.reason ?? 'commit_denied'; kind = 'error';
          await this.original.session.appendSync({ type: 'audit/denial', toolCallId: this.turnId, toolName: 'turn_commit', stage: 'before_turn_commit', reason: this.reason, surface: false });
        }
        if (this.reason === 'cancelled') kind = 'interrupted';
        try { run.check(); } catch (error) { if (!(error instanceof ExecutionBudgetError)) throw error; this.reason = error.outcomeReason; kind = 'budget'; }
      }
    }
    if (this.reason === 'maxElapsedMs') kind = 'budget';
    if (this.continueRequested && kind === 'success') {
      try { run.check(); if (run.counters.modelSteps >= this.budget.maxModelSteps) throw new ExecutionBudgetError('maxModelSteps'); }
      catch (error) { if (!(error instanceof ExecutionBudgetError)) throw error; this.reason = error.outcomeReason; kind = 'budget'; }
    }
    this.committedKind = kind;
    if (!(this.continueRequested && kind === 'success') && this.timer) clearTimeout(this.timer);
    this.commitAttempted = true;
    return this.original.session.appendSync({ ...record, kind, runId: this.runId,
      outcomeReason: this.reason || (this.continueRequested && kind === 'success' ? 'continuation_requested' : kind),
      executionState: this.continueRequested && kind === 'success' ? 'SUSPENDED' : this.terminalState(kind),
      budgetCounters: { ...run.counters }, surface: false });
  }

  private terminalState(kind: TurnResult['kind']): ExecutionState {
    return kind === 'success' ? 'COMPLETED' : kind === 'budget' ? 'EXHAUSTED' : kind === 'interrupted' ? 'CANCELLED' : this.denied ? 'DENIED' : 'FAILED';
  }

  override interrupt(): boolean {
    if (this.reason === 'cancelled') return false;
    if (this.committedKind && !this.continueRequested) return false;
    const interrupted = super.interrupt();
    const accepted = interrupted || this.running && (!this.committedKind || this.continueRequested);
    if (accepted) this.reason = 'cancelled';
    return accepted;
  }

  override async runTurn(input: string): Promise<ExecutionTurnResult> {
    if (this.poisoned) throw new Error('Session publication failed; close and reopen before running again');
    if (this.running) throw new Error('A run already owns this session');
    this.running = true; this.reason = ''; this.denied = false; this.turnId = ''; this.budgetFailure = undefined; this.continueRequested = false; this.committedKind = undefined; this.providerFailure = undefined;
    this.runId = `run_${crypto.randomUUID()}`;
    const run = this.activeRun = new ExecutionRun(this.budget);
    let deferredError: unknown; let hasDeferredError = false; let failureCommitted = false;
    const persist = async () => this.original.session.appendSync({ type: 'run/state', runId: this.runId, state: run.state, revision: run.revision, counters: { ...run.counters }, budget: this.budget, startedAt: run.startedAt, outcomeReason: this.reason, surface: false });
    try {
      run.transition('PREPARING'); await persist(); run.transition('RUNNING'); await persist();
      this.timer = setTimeout(() => { this.reason = 'maxElapsedMs'; super.interrupt(); }, this.budget.maxElapsedMs);
      let result: TurnResult;
      let attempt = 0;
      do {
        this.committedKind = undefined; this.commitAttempted = false;
        await this.original.session.appendSync({ type: 'run/attempt', runId: this.runId, attemptId: `${this.runId}:${++attempt}`, counters: { ...run.counters }, surface: false });
        if (this.reason === 'cancelled' || this.reason === 'maxElapsedMs') {
          result = { turnId: this.turnId, kind: this.reason === 'cancelled' ? 'interrupted' : 'budget', steps: run.counters.modelSteps, toolCalls: run.counters.toolCalls, finalText: this.reason, durationMs: Date.now() - run.startedAt };
          break;
        }
        this.continueRequested = false;
        try { result = await super.runTurn(attempt === 1 ? input : 'Continue the current task; completion was not approved.'); }
        catch (error) {
          if (this.commitAttempted || this.poisoned) { this.poisoned = true; throw error; }
          const exhausted = this.budgetFailure ?? (error instanceof ExecutionBudgetError ? error : undefined);
          this.reason = exhausted ? exhausted.outcomeReason : this.reason === 'cancelled' || this.reason === 'maxElapsedMs' ? this.reason : String(error);
          if (!exhausted && this.reason !== 'cancelled' && this.reason !== 'maxElapsedMs') { deferredError = this.providerFailure ?? error; hasDeferredError = true; }
          result = { turnId: this.turnId || `turn_${crypto.randomUUID()}`, kind: exhausted ? 'budget' : this.interrupted ? 'interrupted' : 'error', steps: run.counters.modelSteps, toolCalls: run.counters.toolCalls, finalText: this.reason, durationMs: Date.now() - run.startedAt };
          await this.commit({ type: 'turn/end', turnId: result.turnId, kind: result.kind, stats: { steps: result.steps, toolCalls: result.toolCalls, durationMs: result.durationMs }, surface: false });
          await this.original.bus.emit('after_turn', { turnId: result.turnId, kind: result.kind });
        }
        result = { ...result, kind: this.committedKind ?? result.kind };
        // Cancellation between continuation attempts must survive the next core scope reset.
        if (this.reason === 'cancelled') result.kind = 'interrupted';
        else if (this.reason === 'maxElapsedMs') result.kind = 'budget';
        if (this.continueRequested && result.kind === 'success') {
          run.transition('SUSPENDED'); await persist();
          if (this.reason === 'cancelled') result.kind = 'interrupted';
          else if (this.reason === 'maxElapsedMs') result.kind = 'budget';
          else {
            run.transition('RUNNING'); await persist();
            if (this.reason === 'cancelled') result.kind = 'interrupted';
            else if (this.reason === 'maxElapsedMs') result.kind = 'budget';
          }
        }
      } while (this.continueRequested && result.kind === 'success');
      const state = this.terminalState(result.kind);
      if (state === 'COMPLETED') { run.transition('FINALIZING'); await persist(); }
      run.transition(state); await persist();
      if (hasDeferredError) { failureCommitted = true; throw deferredError; }
      return { ...result, steps: run.counters.modelSteps, toolCalls: run.counters.toolCalls, durationMs: Date.now() - run.startedAt, runId: this.runId, outcomeReason: this.reason || result.kind, executionState: state };
    } catch (error) { if (!failureCommitted) this.poisoned = true; throw error; }
    finally { if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.running = false; this.activeRun = undefined; }
  }
}
