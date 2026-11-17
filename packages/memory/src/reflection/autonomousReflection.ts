import { createHash } from 'node:crypto';
import type { SessionRecord, TeamEndPayload } from '@vessel/shared';
import { HybridMemoryStore, extractReflectiveRule, normalizeRuleTrigger, type ReflectiveRule } from '../sqlite/HybridMemoryStore.js';

export interface SessionTrajectoryEvent {
  type: 'policy_denial' | 'tool_failure' | 'evaluator_reject';
  trigger: string;
  errorDetail: string;
  remedyAction?: string;
  resolved: boolean;
  /** Stable production provenance; callers supplying plain trajectories may omit it. */
  sourceSequence?: number;
  sourceId?: string;
}
export interface ReflectionOptions {
  /** Severity scale: tool failure = 1, policy denial = 2, evaluator rejection = 3. */
  minSeverity?: number;
  autoPersist?: boolean;
}
export type ReflectedRule = ReflectiveRule & {
  /** Stable source of the trajectory event that produced this rule; returned only, never persisted. */
  evidenceSource?: { sourceSequence?: number; sourceId?: string };
};
type Lesson = Omit<ReflectiveRule, 'id' | 'frequency' | 'updatedAt'>;
const severity = { tool_failure: 1, policy_denial: 2, evaluator_reject: 3 } as const;

/** Deterministic templates never promote arbitrary stderr or remedy text into instructions. */
export class AutonomousReflectionEngine {
  constructor(private memoryStore: HybridMemoryStore) {}
  async extractLessonsFromTrajectory(events: SessionTrajectoryEvent[]): Promise<Lesson[]> {
    return events.map(event => {
      if (!(event.type in severity) || typeof event.trigger !== 'string' || !event.trigger.trim() || event.trigger.length > 2048 || typeof event.errorDetail !== 'string' || typeof event.resolved !== 'boolean') throw new RangeError('Invalid trajectory event');
      const category = event.type === 'evaluator_reject' ? 'architecture_constraint' : event.type;
      const detail = `${event.errorDetail} ${event.remedyAction ?? ''}`;
      const action = event.type === 'policy_denial' ? 'Check the current policy and choose an allowed action; do not bypass enforcement.' :
        event.type === 'evaluator_reject' ? /clean.?room/i.test(detail) ? 'Use the local specifications and independently implement the behavior.' : /thin.?core|core[^\n\r\u2028\u2029]{0,200}import|dependenc/i.test(detail) ? 'Keep mechanisms outside Core and verify the active acceptance criteria.' : 'Verify the active acceptance criteria with independent evidence.' :
        /ENOENT|not found|missing path/i.test(detail) ? 'Verify the current workspace path and required file before retrying.' :
        /EACCES|EPERM|permission/i.test(detail) ? 'Check current permissions and choose an authorized workspace path.' :
        /INVALID_ARGS|invalid argument/i.test(detail) ? 'Validate tool arguments against the current tool schema before retrying.' :
        'Inspect current inputs and tool retry safety before retrying; avoid repeating side effects.';
      // Only short identifier-like trigger facts enter the context. Free-form text is untrusted.
      const triggerCondition = /^[\p{L}\p{N}_./: -]{1,256}$/u.test(event.trigger) ? event.trigger.trim().replace(/\s+/g, ' ') : `${event.type} observed`;
      return { category, triggerCondition,
        lesson: event.type === 'policy_denial' ? 'A previous action was denied by the active policy.' : event.type === 'evaluator_reject' ? 'A previous evaluation rejected an architecture constraint.' :
          event.resolved ? 'A previous tool invocation recovered after a failure.' : 'A previous tool invocation failed.',
        recommendedAction: action, confidence: event.resolved ? 0.85 : 0.55 };
    });
  }
  async processSessionEnd(sessionId: string, events: SessionTrajectoryEvent[], options: ReflectionOptions = {}): Promise<ReflectedRule[]> {
    if (!sessionId || sessionId.length > 256 || !Number.isFinite(options.minSeverity ?? 0) || (options.minSeverity ?? 0) < 0 || (options.minSeverity ?? 0) > 3) throw new RangeError('Invalid reflection options');
    const lessons = await this.extractLessonsFromTrajectory(events);
    const result: ReflectedRule[] = [];
    for (let i = 0; i < lessons.length; i++) {
      const event = events[i]!; const lesson = lessons[i]!;
      if (severity[event.type] < (options.minSeverity ?? 0)) continue;
      const source = createHash('sha256').update(JSON.stringify([sessionId, event.sourceId ?? event.sourceSequence ?? i, lesson.category, normalizeRuleTrigger(lesson.triggerCondition)])).digest('hex');
      const provenance = event.sourceSequence === undefined && event.sourceId === undefined ? {} : { evidenceSource: {
        ...(event.sourceSequence !== undefined ? { sourceSequence: event.sourceSequence } : {}),
        ...(event.sourceId !== undefined ? { sourceId: event.sourceId } : {}),
      } };
      if (options.autoPersist === false) result.push({ ...lesson, id: source, frequency: 0, updatedAt: 0, ...provenance });
      else result.push({ ...await this.memoryStore.upsertReflectiveRule(lesson, source, event.sourceSequence === undefined ? undefined : { sessionId, seq: event.sourceSequence }), ...provenance });
    }
    return result;
  }
}

/** Replay pairs a tool failure only with a later successful invocation of the same tool. */
export function collectSessionTrajectory(records: readonly SessionRecord[]): SessionTrajectoryEvent[] {
  const events: SessionTrajectoryEvent[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!; const rule = extractReflectiveRule(record);
    if (!rule) continue;
    // ponytail: only the next same-tool result within this turn is a recovery candidate.
    let laterSuccess = false;
    if (record.type === 'tool/result') for (const later of records.slice(i + 1)) {
      if (later.type === 'turn/start' || later.type === 'turn/end') break;
      if (later.type === 'tool/result' && later.toolName === record.toolName) { laterSuccess = !later.error; break; }
    }
    events.push({ type: rule.category === 'policy_denial' ? 'policy_denial' : 'tool_failure', trigger: rule.triggerCondition,
      errorDetail: record.type === 'tool/result' ? `${record.error?.errorClass ?? ''} ${record.error?.detail?.code ?? ''}` : 'policy denied',
      resolved: Boolean(laterSuccess || record.type === 'tool/result' && !record.error), sourceSequence: record.seq });
  }
  return events;
}
export function collectEvaluatorTrajectory(payload: TeamEndPayload): SessionTrajectoryEvent[] {
  return payload.members.filter(member => member.role === 'evaluator' && member.review && member.review.verdict !== 'met').map(member => ({
    type: 'evaluator_reject', trigger: 'evaluator architecture constraint', errorDetail: member.review!.unmet.join(' '), resolved: false,
    sourceId: `${payload.teamRunId}:${member.memberId}`,
  }));
}
