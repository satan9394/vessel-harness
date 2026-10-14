import { it, expect } from 'vitest';
import { assertCompactionConservation } from './assertCompactionConservation.js';

it('retains goal, explicit denial references and ordered call/result pairs', () => {
  expect(() => assertCompactionConservation({ originalMessages: [], preservedGoalPrefix: 'protect core', requiredDenialEventIds: ['deny:1'],
    compactedMessages: [{ role: 'user', content: 'Goal: protect core', metadata: { denialEventIds: ['deny:1'] } },
      { role: 'assistant', content: '', toolCalls: [{ id: 'a' }] }, { role: 'tool', content: '', toolCallId: 'a' }] })).not.toThrow();
});

it.each([
  [{ originalMessages: [{ role: 'user', content: 'goal' }, { role: 'user', content: 'Do not touch core', metadata: { preserveVerbatim: true } }], compactedMessages: [{ role: 'user', content: 'goal' }] }, 'constraint_lost'],
  [{ originalMessages: [], latestInstruction: 'local only', compactedMessages: [{ role: 'user', content: 'goal' }] }, 'latest_instruction_lost'],
  [{ originalMessages: [], requiredToolPairs: [{ toolCallId: 'read', callText: 'Read(file.ts)', resultText: 'file contents' }], compactedMessages: [{ role: 'user', content: 'Read(file.ts)' }] }, 'tool_pair_lost'],
] as const)('rejects loss in fidelity fixtures', (input, violationType) => {
  try { assertCompactionConservation(input); throw new Error('accepted'); }
  catch (error) { expect(error).toHaveProperty('violationType', violationType); }
});
it.each([
  [{ preservedGoalPrefix: 'protect core', compactedMessages: [{ role: 'user', content: 'lost' }] }, 'goal_lost'],
  [{ requiredDenialEventIds: ['deny:1'], compactedMessages: [{ role: 'user', content: 'deny:1' }] }, 'denial_lost'],
  [{ compactedMessages: [{ role: 'assistant', content: '', toolCalls: [{ id: 'a' }] }] }, 'orphaned_tool_call'],
  [{ compactedMessages: [{ role: 'tool', content: '', toolCallId: 'a' }] }, 'orphaned_tool_result'],
] as const)('rejects a conservation violation', (input, violationType) => {
  try { assertCompactionConservation({ originalMessages: [], ...input }); throw new Error('accepted'); }
  catch (error) { expect(error).toHaveProperty('violationType', violationType); }
});
