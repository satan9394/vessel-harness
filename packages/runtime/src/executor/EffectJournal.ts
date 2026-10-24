import * as fs from 'node:fs';
import { canonicalArgumentsHash, type CanonicalToolInvocation, type ToolCall, type ToolExecutionResult, type ToolSpec } from '@vessel/shared';

type Effect = NonNullable<ToolSpec['effects']>;
interface Intent { kind: 'intent'; key: string; attempt: number; effects: Effect; invocation: CanonicalToolInvocation }
interface Outcome { kind: 'outcome'; key: string; attempt: number; status: 'observed' | 'outcome_unknown' }
export interface EffectReconciliation {
  key: string;
  attempt: number;
  invocationHash: string;
  resolution: 'applied' | 'not_applied';
  evidence: string;
}
interface Reconciliation extends EffectReconciliation { kind: 'reconciliation'; reconciledAt: string }
type Entry = Intent | Outcome | Reconciliation;

/**
 * Did this invocation finish? Not "did it succeed" — those are different questions, and conflating
 * them bricked sessions: Shell reports a non-zero exit code as TOOL_FAILURE, so running `npm test`
 * with one failing assertion marked the effect unknown and blocked every later write in the session
 * (measured in a real model session, card 276).
 *
 * Unknown means: we cannot tell whether the dispatch ran to completion. That is the case when the
 * tool threw after dispatch, when it was killed or timed out mid-flight, or when it says so itself.
 * A tool that returns a result — even a failing one — has told us its attempt ended, which is an
 * observation. Replay of that exact invocation stays prohibited either way.
 */
function outcomeUnknown(result: ToolExecutionResult): boolean {
  const error = result.error;
  if (!error) return false;
  if (result.meta.dispatchThrew === true) return true;
  if (error.errorClass === 'TIMEOUT' || error.errorClass === 'UNKNOWN') return true;
  return error.detail?.timedOut === true || error.detail?.killed === true;
}

/** Durable dispatch boundary. Unknown writes are reconciled by a caller, never replayed.
 * The owning Session supplies its existing single-writer lease for this journal.
 */
export class EffectJournal {
  private readonly entries: Entry[];
  constructor(private readonly file: string) {
    this.entries = [];
    if (!fs.existsSync(file)) return;
    const data = fs.readFileSync(file);
    let offset = 0;
    let repairAt: number | undefined;
    while (offset < data.length) {
      const newline = data.indexOf(10, offset);
      const end = newline === -1 ? data.length : newline;
      const line = data.subarray(offset, end).toString('utf8');
      if (line.trim()) {
        try {
          const entry = JSON.parse(line) as Entry;
          this.validateEntry(entry);
          this.entries.push(entry);
        }
        catch (error) {
          // Only an unterminated tail can be a torn append. Interior corruption
          // must fail closed rather than silently dropping durable effect history.
          if (newline !== -1 || !(error instanceof SyntaxError)) throw error;
          repairAt = offset;
          break;
        }
      }
      offset = end + 1;
    }
    if (repairAt !== undefined || (data.length > 0 && data[data.length - 1] !== 10)) {
      const fd = fs.openSync(file, 'r+');
      try {
        if (repairAt !== undefined) fs.ftruncateSync(fd, repairAt);
        else fs.writeSync(fd, '\n', data.length);
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
    }
  }
  private validateEntry(entry: Entry): void {
    if (!entry || typeof entry.key !== 'string' || !Number.isSafeInteger(entry.attempt) || entry.attempt < 1) throw new Error('invalid_effect_record');
    const intents = this.entries.filter((item): item is Intent => item.kind === 'intent' && item.key === entry.key);
    const intent = intents.at(-1);
    if (entry.kind === 'intent') {
      if (entry.attempt !== (intent?.attempt ?? 0) + 1 || !entry.invocation || !['read_only', 'idempotent_write', 'non_idempotent', 'externally_irreversible'].includes(entry.effects)) throw new Error('invalid_effect_intent');
      if (intent && (intent.effects !== 'read_only' || this.settled(intent))) throw new Error('effect_replay_in_journal');
      if (intent && canonicalArgumentsHash(intent.invocation) !== canonicalArgumentsHash(entry.invocation)) throw new Error('effect_identity_changed');
    } else {
      if (!intent || intent.attempt !== entry.attempt || this.settled(intent)) throw new Error('out_of_order_effect_record');
      if (entry.kind === 'outcome') {
        if (!['observed', 'outcome_unknown'].includes(entry.status)) throw new Error('invalid_effect_outcome');
      } else if (entry.kind === 'reconciliation') {
        if (entry.invocationHash !== canonicalArgumentsHash(intent.invocation) || !['applied', 'not_applied'].includes(entry.resolution)
          || typeof entry.evidence !== 'string' || !entry.evidence.trim()) throw new Error('invalid_effect_reconciliation');
      } else throw new Error('invalid_effect_record');
    }
  }
  private append(entry: Entry): void {
    const fd = fs.openSync(this.file, 'a');
    try { fs.writeSync(fd, JSON.stringify(entry) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    this.entries.push(entry);
  }
  pending(): Intent[] {
    return structuredClone(this.entries.filter((entry): entry is Intent => entry.kind === 'intent'
      && !this.entries.some(later => later.kind === 'intent' && later.key === entry.key && later.attempt > entry.attempt)
      && !this.settled(entry)));
  }
  private settled(intent: Intent): boolean {
    return this.entries.some(entry => entry.key === intent.key && entry.attempt === intent.attempt
      && (entry.kind === 'reconciliation' || entry.kind === 'outcome' && entry.status === 'observed'));
  }
  /** Operator receipt releases the write barrier, never dispatches this key again. */
  reconcile(input: EffectReconciliation): void {
    if (!input || !['applied', 'not_applied'].includes(input.resolution) || typeof input.evidence !== 'string'
      || !input.evidence.trim() || input.evidence.length > 2048 || !Number.isSafeInteger(input.attempt)) throw new Error('invalid_reconciliation');
    const intent = this.entries.find((entry): entry is Intent => entry.kind === 'intent' && entry.key === input.key && entry.attempt === input.attempt);
    if (!intent || canonicalArgumentsHash(intent.invocation) !== input.invocationHash) throw new Error('reconciliation_identity_mismatch');
    const previous = this.entries.find(entry => entry.kind === 'reconciliation' && entry.key === input.key && entry.attempt === input.attempt);
    if (previous?.kind === 'reconciliation' && previous.resolution === input.resolution && previous.evidence === input.evidence) return;
    if (!this.pending().some(entry => entry.key === input.key && entry.attempt === input.attempt)) throw new Error('reconciliation_conflict');
    this.append({ kind: 'reconciliation', key: input.key, attempt: input.attempt, invocationHash: input.invocationHash,
      resolution: input.resolution, evidence: input.evidence, reconciledAt: new Date().toISOString() });
  }
  begin(call: ToolCall, tool: ToolSpec, invocation: CanonicalToolInvocation, key = call.toolCallId): void {
    const previous = this.entries.filter((entry): entry is Intent => entry.kind === 'intent' && entry.key === key).at(-1);
    const effects = tool.effects ?? (tool.requiredPermission === 'read' ? 'read_only' : 'non_idempotent');
    if (!previous && effects !== 'read_only' && this.pending().some(intent => intent.effects !== 'read_only')) {
      const blocking = this.pending().filter(intent => intent.effects !== 'read_only')
        .map(intent => `${intent.key}#${intent.attempt}(${intent.effects})`).join(', ');
      throw new Error(`OUTCOME_UNKNOWN: pending session effect requires reconciliation before further writes (${blocking}; journal ${this.file})`);
    }
    if (previous) {
      if (previous.effects !== effects) throw new Error('Effect classification changed during recovery');
      if (canonicalArgumentsHash(previous.invocation) !== canonicalArgumentsHash(invocation)) throw new Error('Invocation identity changed during recovery');
      const complete = this.settled(previous);
      if (complete || effects !== 'read_only') throw new Error(complete ? 'Invocation already observed; replay prohibited' : 'OUTCOME_UNKNOWN: effect reconciliation required');
    }
    this.append({ kind: 'intent', key, attempt: (previous?.attempt ?? 0) + 1, effects, invocation });
  }
  finish(call: ToolCall, result: ToolExecutionResult, key = call.toolCallId): void {
    const intent = this.entries.filter((entry): entry is Intent => entry.kind === 'intent' && entry.key === key).at(-1);
    if (!intent) throw new Error('Missing execution intent');
    if (this.settled(intent)) throw new Error('Invocation already observed; replay prohibited');
    this.append({ kind: 'outcome', key: intent.key, attempt: intent.attempt, status: intent.effects !== 'read_only' && outcomeUnknown(result) ? 'outcome_unknown' : 'observed' });
  }
}
