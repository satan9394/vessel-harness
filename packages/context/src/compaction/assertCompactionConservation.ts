import type { CompactionConservationCheckInput } from '@vessel/shared';

export class CompactionConservationError extends Error {
  constructor(public readonly violationType: 'goal_lost' | 'denial_lost' | 'orphaned_tool_call' | 'orphaned_tool_result', message: string) {
    super(`Compaction conservation violation [${violationType}]: ${message}`);
    this.name = 'CompactionConservationError';
  }
}

export function assertCompactionConservation(input: CompactionConservationCheckInput): void {
  const originalGoal = input.originalMessages.find(message => message.role === 'system' || message.role === 'user');
  const goal = input.preservedGoalPrefix ?? (typeof originalGoal?.content === 'string' ? originalGoal.content : undefined);
  if (goal && !String(input.compactedMessages[0]?.content ?? '').includes(goal)) {
    throw new CompactionConservationError('goal_lost', 'Missing original goal');
  }
  for (const message of input.originalMessages) {
    if (message.metadata?.preserveVerbatim === true && typeof message.content === 'string'
      && !String(input.compactedMessages[0]?.content ?? '').includes(message.content)) {
      throw new CompactionConservationError('goal_lost', 'Missing preserved user constraint');
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
}
