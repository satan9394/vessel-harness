import * as fs from 'node:fs';
import { canonicalArgumentsHash, type CanonicalToolInvocation, type ToolCall, type ToolExecutionResult, type ToolSpec } from '@vessel/shared';

type Effect = NonNullable<ToolSpec['effects']>;
interface Intent { kind: 'intent'; key: string; attempt: number; effects: Effect; invocation: CanonicalToolInvocation }
interface Outcome { kind: 'outcome'; key: string; attempt: number; status: 'observed' | 'outcome_unknown' }
type Entry = Intent | Outcome;

/** Durable dispatch boundary. Unknown writes are reconciled by a caller, never replayed.
 * The owning Session supplies its existing single-writer lease for this journal.
 */
export class EffectJournal {
  private readonly entries: Entry[];
  constructor(private readonly file: string) {
    this.entries = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Entry) : [];
  }
  private append(entry: Entry): void {
    const fd = fs.openSync(this.file, 'a');
    try { fs.writeSync(fd, JSON.stringify(entry) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    this.entries.push(entry);
  }
  pending(): Intent[] {
    return this.entries.filter((entry): entry is Intent => entry.kind === 'intent' && !this.entries.some(outcome => outcome.kind === 'outcome' && outcome.key === entry.key && outcome.attempt === entry.attempt && outcome.status === 'observed'));
  }
  begin(call: ToolCall, tool: ToolSpec, invocation: CanonicalToolInvocation, key = call.toolCallId): void {
    const previous = this.entries.filter((entry): entry is Intent => entry.kind === 'intent' && entry.key === key).at(-1);
    const effects = tool.effects ?? (tool.requiredPermission === 'read' ? 'read_only' : 'non_idempotent');
    if (!previous && effects !== 'read_only' && this.pending().some(intent => intent.effects !== 'read_only')) {
      throw new Error('OUTCOME_UNKNOWN: pending session effect requires reconciliation before further writes');
    }
    if (previous) {
      if (previous.effects !== effects) throw new Error('Effect classification changed during recovery');
      if (canonicalArgumentsHash(previous.invocation) !== canonicalArgumentsHash(invocation)) throw new Error('Invocation identity changed during recovery');
      const complete = this.entries.some(entry => entry.kind === 'outcome' && entry.key === key && entry.attempt === previous.attempt && entry.status === 'observed');
      if (complete || effects !== 'read_only') throw new Error(complete ? 'Invocation already observed; replay prohibited' : 'OUTCOME_UNKNOWN: effect reconciliation required');
    }
    this.append({ kind: 'intent', key, attempt: (previous?.attempt ?? 0) + 1, effects, invocation });
  }
  finish(call: ToolCall, result: ToolExecutionResult, key = call.toolCallId): void {
    const intent = this.entries.filter((entry): entry is Intent => entry.kind === 'intent' && entry.key === key).at(-1);
    if (!intent) throw new Error('Missing execution intent');
    this.append({ kind: 'outcome', key: intent.key, attempt: intent.attempt, status: result.error && intent.effects !== 'read_only' ? 'outcome_unknown' : 'observed' });
  }
}
