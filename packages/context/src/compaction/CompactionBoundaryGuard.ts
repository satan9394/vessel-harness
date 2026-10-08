import type { SessionRecord } from '@vessel/shared';

export class CompactionBoundaryGuard {
  /** Calls belong to an attempt in a started turn, not globally to a provider ID.
   * Only a matching durable end abandons them. A leading legacy/truncated span
   * without a start can close at its end, before any explicit start is seen.
   */
  static accountToolCalls(records: readonly SessionRecord[]) {
    type Scope = { turnId?: string; pending: Map<string, SessionRecord[]>; ended?: boolean; lastToolIndex?: number };
    const legacy: Scope = { pending: new Map() };
    const openTurns: Scope[] = [];
    let current = legacy;
    let sawStart = false;
    let pendingCount = 0;
    const abandoned = new Map<SessionRecord, Set<string>>();
    const balancedCandidates: { index: number; scopes: Scope[] }[] = [];
    for (const [index, record] of records.entries()) {
      if (record.type === 'turn/start') {
        sawStart = true;
        current = { turnId: record.turnId, pending: new Map() };
        openTurns.push(current);
      }
      if (record.type === 'assistant/attempt') for (const call of record.toolCalls) {
        current.lastToolIndex = index;
        const owners = current.pending.get(call.toolCallId) ?? [];
        owners.push(record); current.pending.set(call.toolCallId, owners); pendingCount++;
      }
      if (record.type === 'tool/call' && !current.pending.has(record.toolCallId)) {
        current.pending.set(record.toolCallId, [record]); pendingCount++;
      }
      if (record.type === 'tool/call' || record.type === 'tool/result') current.lastToolIndex = index;
      if (record.type === 'tool/result') {
        const owners = current.pending.get(record.toolCallId);
        if (owners?.length) { owners.pop(); pendingCount--; }
        if (owners?.length === 0) current.pending.delete(record.toolCallId);
      }
      if (record.type === 'turn/end') {
        const scope = openTurns.findLast(turn => turn.turnId === record.turnId) ?? (!sawStart ? legacy : undefined);
        if (scope) {
          for (const [id, owners] of scope.pending) for (const owner of owners) {
            const ids = abandoned.get(owner) ?? new Set<string>();
            ids.add(id); abandoned.set(owner, ids); pendingCount--;
          }
          scope.pending.clear();
          scope.ended = true;
          if (scope !== legacy) openTurns.splice(openTurns.indexOf(scope), 1);
          if (current === scope) current = openTurns.at(-1) ?? legacy;
        }
      }
      if (pendingCount === 0) balancedCandidates.push({ index, scopes: [...openTurns] });
    }
    // A retained tail must not lose the start that scopes later tool records.
    // Balanced cuts inside an ended turn remain valid after its last tool record.
    const balancedAfter = new Set(balancedCandidates.filter(({ index, scopes }) =>
      scopes.every(scope => scope.ended && index >= (scope.lastToolIndex ?? -1))).map(({ index }) => index));
    return { abandoned, balancedAfter, hasPendingToolCalls: pendingCount > 0 };
  }
  static canTriggerCompaction(state: { turnIndex: number; hasPendingToolCalls: boolean; activeMicroTurn: boolean }): boolean {
    return state.turnIndex === 0 && !state.hasPendingToolCalls && !state.activeMicroTurn;
  }

  static canCompactHistory(turnIndex: number, records: readonly SessionRecord[]): boolean {
    const { hasPendingToolCalls } = this.accountToolCalls(records);
    return this.canTriggerCompaction({ turnIndex, hasPendingToolCalls, activeMicroTurn: turnIndex > 0 });
  }
}
