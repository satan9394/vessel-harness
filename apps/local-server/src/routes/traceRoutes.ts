import type { SessionRecord } from '@vessel/shared';

/**
 * UI-017 read side: turn a session's append-only event log into a structured,
 * **sanitized** step trace. Raw prompt text, tool arguments and tool output are
 * never exported — only structure, counts and identifiers.
 */

export interface TraceStep {
  seq: number;
  ts: string;
  type: string;
  turnId?: string;
  step?: number;
  title: string;
  detail: Record<string, unknown>;
}

export interface TraceTurn {
  turnId: string;
  steps: TraceStep[];
}

export interface TraceReport {
  sessionId: string;
  turns: TraceTurn[];
  recordCount: number;
  /** field names that were stripped from the raw records. */
  redactedFields: string[];
}

const REDACTED_FIELDS = ['content', 'arguments', 'messages', 'prompt', 'finalText', 'text', 'result'] as const;

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function keys(value: unknown): string[] {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value as Record<string, unknown>).sort() : [];
}
function length(value: unknown): number | undefined {
  return typeof value === 'string' ? value.length : undefined;
}

function stepFor(record: SessionRecord): TraceStep {
  const raw = record as unknown as Record<string, unknown>;
  const type = String(raw.type ?? 'unknown');
  const base = { seq: Number(raw.seq ?? 0), ts: String(raw.ts ?? ''), type, turnId: str(raw.turnId), step: num(raw.step) };
  switch (type) {
    case 'turn/start':
      return { ...base, title: 'Turn started', detail: { source: str(raw.source) ?? 'user' } };
    case 'turn/end':
      return { ...base, title: 'Turn ended', detail: { kind: str(raw.kind), executionState: str(raw.executionState), outcomeReason: str(raw.outcomeReason), budget: raw.budgetCounters === undefined ? undefined : true } };
    case 'step/start':
      return { ...base, title: `Step ${base.step ?? '?'}`, detail: {} };
    case 'request/header':
      return { ...base, title: 'Model request', detail: { model: str(raw.model), estimateTokens: num(raw.estimateTokens), messageCount: num(raw.messageCount) } };
    case 'assistant/attempt':
    case 'assistant/message':
      return { ...base, title: 'Assistant message', detail: { textLength: length(raw.content), toolCalls: num(raw.toolCalls) } };
    case 'tool/call':
      return { ...base, title: `Tool call ${str(raw.toolName) ?? ''}`.trim(), detail: { toolName: str(raw.toolName), argumentKeys: keys(raw.arguments), argumentCount: keys(raw.arguments).length } };
    case 'tool/result':
      return { ...base, title: `Tool result ${str(raw.toolName) ?? ''}`.trim(), detail: { toolName: str(raw.toolName), ok: raw.error === undefined, outputLength: length(raw.content) } };
    case 'policy_decision':
    case 'audit/denial':
      return { ...base, title: 'Policy decision', detail: { verdict: str(raw.verdict), toolName: str(raw.toolName), ruleRef: str(raw.ruleRef), stage: str(raw.stage) } };
    default:
      return { ...base, title: type, detail: {} };
  }
}

export class TraceRoutes {
  constructor(private readonly records: (sessionId: string) => readonly SessionRecord[] | undefined) {}

  report(sessionId: string): TraceReport | undefined {
    const records = this.records(sessionId);
    if (!records) return undefined;
    const byTurn = new Map<string, TraceTurn>();
    for (const record of records) {
      const step = stepFor(record);
      const turnId = step.turnId ?? 'unassigned';
      const turn = byTurn.get(turnId) ?? { turnId, steps: [] };
      turn.steps.push(step);
      byTurn.set(turnId, turn);
    }
    const turns = [...byTurn.values()].map((turn) => ({ ...turn, steps: turn.steps.sort((a, b) => a.seq - b.seq) }))
      .sort((a, b) => (a.steps[0]?.seq ?? 0) - (b.steps[0]?.seq ?? 0));
    return { sessionId, turns, recordCount: records.length, redactedFields: [...REDACTED_FIELDS] };
  }
}
