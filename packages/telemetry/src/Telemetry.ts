import type {
  MetricId,
  MetricValue,
  ReportLine,
  SessionRecord,
} from '@vessel/shared';
import type { EventBus } from '@vessel/core';
import { EventBus as Bus, Session } from '@vessel/core';

export interface TelemetryCounters {
  turns: number;
  steps: number;
  toolCalls: number;
  retries: number;
  invalidArgs: number;
  denials: number;
  compactions: number;
  evaluatorRejects: number;
  approvalAsks: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/**
 * telemetry — event subscriber (emit bypass, ARCHITECTURE §4.11).
 * Computes BENCHMARK-SPEC M02–M14 (subset available offline) from bus events +
 * session replay; exports JSONL report lines (§4.2 format).
 */
export class Telemetry {
  private counters: TelemetryCounters = {
    turns: 0, steps: 0, toolCalls: 0, retries: 0, invalidArgs: 0, denials: 0,
    compactions: 0, evaluatorRejects: 0, approvalAsks: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
  };

  private unsubs: (() => void)[] = [];

  attach(bus: Bus): void {
    this.unsubs.push(
      bus.on('before_turn', () => { this.counters.turns += 1; }),
      bus.on('after_model', (_p, _c) => { this.counters.steps += 1; }, 'telemetry:steps'),
      bus.on('after_model', (p) => {
        const payload = p as { usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } };
        if (payload.usage) {
          this.recordUsage(payload.usage.inputTokens ?? 0, payload.usage.outputTokens ?? 0, payload.usage.cacheReadTokens);
        }
      }, 'telemetry:usage'),
      bus.on('after_tool', () => { this.counters.toolCalls += 1; }, 'telemetry:toolcalls'),
      bus.on('llm_retry', () => { this.counters.retries += 1; }, 'telemetry:retries'),
      bus.on('policy_decision', (p) => {
        const payload = p as { verdict?: string };
        if (payload.verdict === 'deny') this.counters.denials += 1;
      }, 'telemetry:denials'),
    );
  }

  recordEvaluatorReject(): void {
    this.counters.evaluatorRejects += 1;
  }

  recordUsage(input: number, output: number, cacheRead?: number): void {
    this.counters.inputTokens += input;
    this.counters.outputTokens += output;
    this.counters.cacheReadTokens += (cacheRead ?? 0);
  }

  finalize(session: Session): TelemetryCounters {
    const replay = session.replay();
    for (const r of replay) {
      this.finalizeRecord(r);
    }
    return { ...this.counters };
  }

  private finalizeRecord(r: SessionRecord): void {
    switch (r.type) {
      case 'tool/result':
        if (r.error?.errorClass === 'INVALID_ARGS') this.counters.invalidArgs += 1;
        break;
      case 'audit/denial':
        this.counters.denials += 1;
        break;
      case 'compaction/start':
        this.counters.compactions += 1;
        break;
      default:
        break;
    }
  }

  metrics(extra?: { durationMs?: number; time?: number }): MetricValue[] {
    const c = this.counters;
    const out: MetricValue[] = [
      { metric: 'M02', name: 'Turns', value: c.turns, unit: 'turn', source: 'before_turn' },
      { metric: 'M03', name: 'ToolCalls', value: c.toolCalls, unit: 'count', source: 'after_tool' },
      { metric: 'M04', name: 'InvalidToolCalls', value: c.invalidArgs, unit: 'count', source: 'tool/result:INVALID_ARGS' },
      { metric: 'M05', name: 'Retries', value: c.retries, unit: 'count', source: 'llm_retry' },
      { metric: 'M06', name: 'InputTokens', value: c.inputTokens, unit: 'token', source: 'usage-ledger', detail: { cacheRead: c.cacheReadTokens } },
      { metric: 'M07', name: 'OutputTokens', value: c.outputTokens, unit: 'token', source: 'usage-ledger' },
      { metric: 'M09', name: 'Compactions', value: c.compactions, unit: 'count', source: 'compaction/start' },
      { metric: 'M12', name: 'SafetyViolations', value: c.denials, unit: 'count', source: 'audit/denial' },
      { metric: 'M13', name: 'EvaluatorRejects', value: c.evaluatorRejects, unit: 'count', source: 'evaluator' },
      { metric: 'M14', name: 'Autonomy', value: c.approvalAsks, unit: 'count', source: 'approval/asked', detail: { steers: 0, approval_asks: c.approvalAsks, interrupts: 0, human_answers: 0, machine_answers: 0 } },
    ];
    if (extra?.durationMs !== undefined) {
      out.push({ metric: 'M10', name: 'Time', value: extra.durationMs, unit: 'ms', source: 'runner-timer' });
    }
    return out;
  }

  reportLines(opts: {
    runId: string;
    scenarioId: string;
    harness: string;
    mode: 'offline' | 'live';
    ts: string;
    metrics: MetricValue[];
    events: { kind: string; payload: Record<string, unknown> }[];
    asserts: ReportLine[];
    env: Record<string, unknown>;
  }): ReportLine[] {
    const meta: ReportLine = {
      type: 'meta', runId: opts.runId, ts: opts.ts, scenarioId: opts.scenarioId,
      harness: opts.harness, arm: null, mode: opts.mode, env: opts.env,
    };
    const metricLines: ReportLine[] = opts.metrics.map((m) => ({
      type: 'metric', runId: opts.runId, ts: opts.ts, metric: m.metric as MetricId,
      name: m.name, value: m.value, unit: m.unit, source: m.source,
      approx: m.approx, detail: m.detail,
    }));
    const eventLines: ReportLine[] = opts.events.map((e) => ({
      type: 'event', runId: opts.runId, ts: opts.ts, kind: e.kind, payload: e.payload,
    }));
    return [meta, ...metricLines, ...eventLines, ...opts.asserts];
  }

  detach(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }
}

export type { EventBus };
