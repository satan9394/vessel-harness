import type { CompactionConservationCheckInput } from '@vessel/shared';

export class CompactionConservationError extends Error {
  constructor(public readonly violationType: 'goal_lost' | 'constraint_lost' | 'latest_instruction_lost' | 'denial_lost' | 'tool_pair_lost' | 'orphaned_tool_call' | 'orphaned_tool_result' | 'keep_id_lost', message: string) {
    super(`Compaction conservation violation [${violationType}]: ${message}`);
    this.name = 'CompactionConservationError';
  }
}

export function assertCompactionConservation(input: CompactionConservationCheckInput): void {
  const preservedText = input.compactedMessages.map(message => String(message.content ?? '')).join('\n');
  const originalGoal = input.originalMessages.find(message => message.role === 'system' || message.role === 'user');
  const goal = input.preservedGoalPrefix ?? (typeof originalGoal?.content === 'string' ? originalGoal.content : undefined);
  if (goal && !preservedText.includes(goal)) {
    throw new CompactionConservationError('goal_lost', 'Missing original goal');
  }
  for (const message of input.originalMessages) {
    if (message.metadata?.preserveVerbatim === true && typeof message.content === 'string'
      && !preservedText.includes(message.content)) {
      throw new CompactionConservationError('constraint_lost', 'Missing preserved user constraint');
    }
  }
  if (input.latestInstruction && !preservedText.includes(input.latestInstruction)) {
    throw new CompactionConservationError('latest_instruction_lost', 'Missing latest instruction');
  }
  for (const pair of input.requiredToolPairs ?? []) {
    if (!preservedText.includes(pair.callText) || !preservedText.includes(pair.resultText)) {
      throw new CompactionConservationError('tool_pair_lost', pair.toolCallId);
    }
  }
  const references = input.compactedMessages.flatMap(message => {
    const ids = message.metadata?.denialEventIds;
    return Array.isArray(ids) ? ids : [];
  });
  for (const id of input.requiredDenialEventIds ?? []) {
    if (!references.includes(id)) throw new CompactionConservationError('denial_lost', id);
  }
  const pending = new Set<string>();
  for (const message of input.compactedMessages) {
    for (const call of message.toolCalls ?? []) {
      if (pending.has(call.id)) throw new CompactionConservationError('orphaned_tool_call', `Duplicate ${call.id}`);
      pending.add(call.id);
    }
    if (message.role === 'tool') {
      if (!message.toolCallId || !pending.delete(message.toolCallId)) throw new CompactionConservationError('orphaned_tool_result', message.toolCallId ?? 'missing id');
    }
  }
  if (pending.size) throw new CompactionConservationError('orphaned_tool_call', [...pending].join(', '));
  if (input.requiredKeepIds?.length) {
    const presentIds = new Set<string>();
    for (const message of input.compactedMessages) {
      if (typeof message.id === 'string') presentIds.add(message.id);
      const meta = message.metadata;
      if (typeof meta?.keepID === 'string') presentIds.add(meta.keepID);
      if (typeof meta?.keepId === 'string') presentIds.add(meta.keepId);
      if (Array.isArray(meta?.keepIds)) {
        for (const id of meta.keepIds) if (typeof id === 'string') presentIds.add(id);
      }
    }
    for (const id of input.requiredKeepIds) {
      if (!presentIds.has(id)) {
        throw new CompactionConservationError('keep_id_lost', id);
      }
    }
  }
}
